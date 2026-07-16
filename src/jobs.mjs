// Async job layer: every review/exec runs as a DETACHED runner process whose
// entire state lives on disk under the jobs root. Rationale (hard-won):
// - A blocking MCP call ties the vendor run's fate to the Claude session:
//   stdio idle-timeout aborts silently-long reviews, and a session crash
//   ("resume with a fresh process") kills the stdio MCP server AND the
//   in-flight codex/agy child — the whole review is lost and the harness
//   retry re-launches agy (clustered cold-starts provoke browser OAuth).
// - Detached runner + on-disk state decouples all of it: the MCP call returns
//   in milliseconds, the runner survives session death, a NEW session's MCP
//   server reads the same job dir, and the idempotency key maps a retry back
//   to the original job instead of double-launching.
//
// Ownership protocol (multiple MCP server processes may share the jobs root):
// - key claim: keys/<sha256>/ mkdir mutex serializes check-then-create across
//   processes — the "never double-launch" guarantee does not rest on a racy
//   read.
// - job.json: written ONCE by the server BEFORE spawning the runner; owned by
//   the runner afterwards (server-side spawn pid lives in spawn.json — a
//   separate single-writer file, so nothing clobbers).
// - liveness: heartbeat.json (runner refreshes every 5s), not bare PID
//   aliveness — Windows recycles PIDs, and a recycled PID would fake-alive a
//   dead job forever (and make cancel kill an unrelated process).
// - terminal states: FIRST WRITER WINS — cancel and the runner both re-check
//   before writing; a job never leaves a terminal state.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, renameSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const IS_WIN = process.platform === "win32";

// Synchronous sleep without a CPU-burning spin (these paths are sync by
// design — startJob must be atomic under a mutex; contention is ms-scale).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function jobsRoot() {
  return process.env.AI_BRIDGE_JOBS_ROOT ?? path.join(os.homedir(), ".ai-bridge", "jobs");
}

const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function jobDir(jobId) {
  if (!JOB_ID_RE.test(jobId)) return null; // path-traversal guard ("../..")
  const dir = path.join(jobsRoot(), jobId);
  const rel = path.relative(jobsRoot(), dir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return dir;
}
const jobFile = (jobId, name) => {
  const dir = jobDir(jobId);
  return dir ? path.join(dir, name) : null;
};

// strict=true (job.json / result.json): persistent corruption or EACCES after
// retries THROWS — swallowing it as null would make findRunning treat an
// unreadable RUNNING job as absent and double-launch the vendor. strict=false
// (heartbeat/spawn, best-effort files): null on any failure — a corrupt
// heartbeat self-heals on the next 5s beat and must not crash liveness checks.
function readJson(p, { strict = false } = {}) {
  if (!p) return null;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      lastError = error;
      sleepSync(40 * (attempt + 1));
    }
  }
  if (strict) throw new Error(`unreadable ${path.basename(p)} for a job that may be running: ${lastError?.message ?? lastError}`);
  return null;
}

// Atomic replace: write temp then rename ONTO the target (no pre-delete — a
// delete-then-rename leaves a visible gap where the job "does not exist").
// Node's renameSync overwrites on Windows (MOVEFILE_REPLACE_EXISTING). On the
// final failure this THROWS — a caller that cannot persist a state transition
// must not pretend it happened.
export function writeJson(p, obj) {
  const payload = JSON.stringify(obj, null, 2);
  const tmp = `${p}.tmp-${process.pid}-${randomBytes(2).toString("hex")}`;
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      writeFileSync(tmp, payload, "utf8");
      renameSync(tmp, p);
      return;
    } catch (error) {
      lastError = error;
      sleepSync(50 * (attempt + 1)); // brief backoff (AV scan window)
    }
  }
  rmSync(tmp, { force: true });
  throw lastError;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
export const isTerminal = (state) => TERMINAL.has(state);

export function idempotencyKey(request) {
  // Everything that makes a run "the same run". A retry after a harness error
  // resends identical params and MUST map to the original job (double-launching
  // agy = clustered cold-start = OAuth risk). Round N vs N+1 prompts differ, so
  // legitimate re-reviews never collide.
  const material = JSON.stringify({
    kind: request.kind,
    vendor: request.vendor,
    cwd: request.cwd ?? null,
    prompt: request.prompt,
    effort: request.effort ?? null,
    resume: request.resume ?? null,
    evidence_path: request.evidence_path ?? null,
    report_path: request.report_path ?? null,
    // Different exit contract = different run (a verdict-gated review must not
    // dedupe onto an ungated one). Added CONDITIONALLY so expect_verdict:false /
    // absent hashes byte-identically to pre-0.14 keys — an in-flight job started
    // by an older server stays recoverable across the upgrade.
    ...(request.expect_verdict ? { expect_verdict: true } : {}),
  });
  return createHash("sha256").update(material, "utf8").digest("hex");
}

// --- cross-process key mutex (mkdir is atomic on every platform) ------------
// Ownership rules that make steal/release safe:
// - the holder writes owner.json (unique token) into the lock dir; release
//   removes the dir ONLY if the token is still ours — a holder whose lock was
//   stolen must not delete the stealer's lock.
// - stealing a stale lock is rename-then-delete: renameSync is atomic, so of
//   two waiters that both judge the lock stale, exactly ONE wins the rename;
//   the loser just retries the claim. No unowned check-then-delete.
// - re-entrant within a process (heldLocks): the reconciler runs under
//   markTerminal's lock while findRunning may already hold the same key.
const LOCK_STALE_MS = 30_000;
const LOCK_HARD_CAP_MS = 5 * 60_000;
const heldLocks = new Set();

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM"; // exists, not ours
  }
}

function withKeyLock(key, fn) {
  if (heldLocks.has(key)) return fn(); // re-entrant: already ours
  const lockDir = path.join(jobsRoot(), ".locks", key);
  const token = `${process.pid}-${randomBytes(4).toString("hex")}`;
  mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(lockDir); // atomic claim
      writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ token, pid: process.pid, at: Date.now() }), "utf8");
      break;
    } catch {
      // Steal only a lock whose HOLDER IS DEAD (age alone is not death — a
      // live-but-slow holder must never lose its mutex mid-critical-section).
      // PID-recycled false-alive would wedge the lock; the 5-minute hard cap
      // breaks that tie. Steal itself is atomic rename (one stealer wins).
      try {
        const age = Date.now() - statSync(lockDir).mtimeMs;
        const owner = readJson(path.join(lockDir, "owner.json"));
        const ownerDead = owner?.pid ? !pidExists(owner.pid) : true;
        if ((age > LOCK_STALE_MS && ownerDead) || age > LOCK_HARD_CAP_MS) {
          const grave = `${lockDir}.stale-${randomBytes(3).toString("hex")}`;
          renameSync(lockDir, grave); // atomic: one stealer wins
          rmSync(grave, { recursive: true, force: true });
        }
      } catch {
        /* lost the steal race or lock vanished — just retry the claim */
      }
      if (Date.now() > deadline) throw new Error(`key lock busy: ${key.slice(0, 12)}…`);
      sleepSync(100); // claims are millisecond-scale
    }
  }
  heldLocks.add(key);
  try {
    return fn();
  } finally {
    heldLocks.delete(key);
    try {
      const owner = JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8"));
      if (owner.token === token) rmSync(lockDir, { recursive: true, force: true });
    } catch {
      /* lock stolen or already gone — the stealer owns it now, leave it */
    }
  }
}

// --- liveness: heartbeat over bare PID (PIDs get recycled) -------------------
const HEARTBEAT_FRESH_MS = 30_000;
const SPAWN_GRACE_MS = 30_000;

function isLive(jobId, meta) {
  const hb = readJson(jobFile(jobId, "heartbeat.json"));
  if (hb && Date.now() - hb.at < HEARTBEAT_FRESH_MS) return true;
  // Boot grace: job.json (with started_at) lands BEFORE the runner spawns, so
  // a fresh job whose runner hasn't written its first beat yet must not be
  // reconciled as dead — that terminal marker would be unrevertable (first
  // writer wins) and orphan the real run.
  if (meta.started_at && Date.now() - Date.parse(meta.started_at) < SPAWN_GRACE_MS) return true;
  return false;
}

function tailOf(p, lines = 12) {
  try {
    const raw = readFileSync(p, "utf8").trim();
    if (!raw) return "";
    return raw.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

// Reconcile disk state with reality: a non-terminal job with no live runner
// died without a terminal marker — surface that as a loud failure with what
// the runner managed to log, never as eternal "running" (fail loud over limbo).
// The transition goes through markTerminal (lock + fresh re-read): a runner
// completing concurrently wins, and the reconciler backs off.
export function readJob(jobId) {
  const p = jobFile(jobId, "job.json");
  if (!p) return null;
  const meta = readJson(p, { strict: true });
  if (!meta) return null;
  if (!isTerminal(meta.state) && !isLive(jobId, meta)) {
    // Last check before the unrevertable failed marker: a stale heartbeat is
    // NOT proof of death — a system sleep/suspend stalls the beat while the
    // runner survives (and resumes). If a live process's command line still
    // references this job, leave the state alone; the next beat lands within
    // 5s of resume.
    const pid = meta.pid ?? readJson(jobFile(jobId, "spawn.json"))?.pid;
    if (pid && (processCommandLine(pid) ?? "").includes(jobId)) return meta;
    markTerminal(jobId, {
      state: "failed",
      error:
        "runner is gone without a terminal marker (session shutdown, crash, or killed). " +
        `runner.log tail:\n${tailOf(jobFile(jobId, "runner.log")) || "(empty)"}`,
    });
    return readJson(p, { strict: true }) ?? meta;
  }
  return meta;
}

export function readResult(jobId) {
  return readJson(jobFile(jobId, "result.json"), { strict: true });
}

// Running job with this request's key, or null. Exposed so ai_exec_start can
// map a retry to the original job BEFORE the dirty-tree guard — the original
// run legitimately dirties the tree, and the guard must not eat the retry.
//
// Deadlock discipline: this runs INSIDE the request key's lock (startJob).
// It must therefore never touch another key's lock — so unrelated jobs get a
// bare key-filter read (no reconciliation); only same-key candidates go
// through readJob's reconcile path (same key ⇒ re-entrant, no cross-lock).
// Two servers each holding key A/B while reconciling B/A would otherwise
// cross-wait to the lock timeout.
export function findRunning(request) {
  const key = idempotencyKey(request);
  let dirs;
  try {
    dirs = readdirSync(jobsRoot());
  } catch {
    return null;
  }
  for (const id of dirs) {
    if (!JOB_ID_RE.test(id)) continue;
    const bare = readJson(jobFile(id, "job.json"), { strict: true });
    if (!bare || bare.key !== key) continue; // foreign key: hands off entirely
    const meta = readJob(id); // reconcile only our own key's candidates
    if (meta && !isTerminal(meta.state)) return meta;
  }
  return null;
}

// Cross-session job discovery: a job_id normally lives only in the context of
// the session that started it — after a crash/compaction the id is gone and a
// re-send with different phrasing misses the idempotency key (batch-E: two
// parallel GPT xhigh runs of the SAME closing gate). listJobs makes the jobs
// root browsable so a fresh session finds and re-attaches to the original job.
export function listJobs({ limit = 20 } = {}) {
  let dirs;
  try {
    dirs = readdirSync(jobsRoot());
  } catch {
    return [];
  }
  const jobs = [];
  for (const id of dirs) {
    if (!JOB_ID_RE.test(id)) continue;
    try {
      const meta = readJob(id); // reconciled read — a dead runner lists as failed, not eternal running
      if (!meta) continue;
      jobs.push({
        id: meta.id ?? id,
        kind: meta.kind ?? null,
        vendor: meta.vendor ?? null,
        state: meta.state,
        started_at: meta.started_at ?? null,
        finished_at: meta.finished_at ?? null,
        evidence_path: meta.evidence_path ?? null,
        report_path: meta.report_path ?? null,
      });
    } catch (error) {
      // one corrupt job must not hide the rest of the list — but it must not
      // hide ITSELF either (fail loud as a visible unreadable entry)
      jobs.push({ id, state: "unreadable", error: String(error?.message ?? error) });
    }
  }
  // started_at descending; unreadable entries fall back to the id, which opens
  // with the same timestamp (colons/dots dashed) — normalize so both compare.
  const sortKey = (j) => String(j.started_at ?? j.id ?? "").replace(/[:.]/g, "-");
  jobs.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  return jobs.slice(0, Math.max(1, limit));
}

// Lazy GC so the jobs root doesn't grow forever: terminal jobs older than 7
// days are pruned on the next start. Non-terminal jobs are never touched.
const GC_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function gcOldJobs() {
  let dirs;
  try {
    dirs = readdirSync(jobsRoot());
  } catch {
    return;
  }
  const now = Date.now();
  for (const id of dirs) {
    if (!JOB_ID_RE.test(id)) continue;
    try {
      const meta = readJson(jobFile(id, "job.json"));
      const mtime = statSync(jobDir(id)).mtimeMs;
      if (meta && isTerminal(meta.state) && now - mtime > GC_AGE_MS) {
        rmSync(jobDir(id), { recursive: true, force: true });
      }
    } catch {
      /* skip */
    }
  }
}

export function startJob(request) {
  mkdirSync(jobsRoot(), { recursive: true });
  gcOldJobs();
  const key = idempotencyKey(request);

  // The whole check-then-create runs under a cross-process mutex: two servers
  // retrying the same request cannot both pass the "nothing running" check.
  return withKeyLock(key, () => {
    const existing = findRunning(request);
    if (existing) return { jobId: existing.id, alreadyRunning: true };

    const jobId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${request.kind}-${request.vendor}-${randomBytes(3).toString("hex")}`;
    const dir = jobDir(jobId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "request.json"), JSON.stringify(request, null, 2), "utf8");
    // Full metadata lands BEFORE the runner spawns — job.json is server-written
    // exactly once, then owned by the runner; no write can clobber another.
    writeJson(path.join(dir, "job.json"), {
      id: jobId,
      key,
      kind: request.kind,
      vendor: request.vendor,
      state: "starting",
      pid: null,
      evidence_path: request.evidence_path ?? null,
      report_path: request.report_path ?? null,
      started_at: new Date().toISOString(),
    });

    const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "job-runner.mjs");
    // Fully detached: no inherited stdio (a pipe back to us would die with the
    // session), no parent linkage. The runner logs to files in its job dir.
    const child = spawn(process.execPath, [runnerPath, dir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    writeJson(path.join(dir, "spawn.json"), { pid: child.pid, at: Date.now() });
    return { jobId, alreadyRunning: false };
  });
}

export async function waitJob(jobId, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const meta = readJob(jobId);
    if (!meta) return null;
    if (isTerminal(meta.state)) return meta;
    if (Date.now() >= deadline) return meta;
    await new Promise((res) => setTimeout(res, Math.min(1500, Math.max(50, deadline - Date.now()))));
  }
}

// Terminal transition helper — FIRST WRITER WINS. Both the runner and cancel
// go through this: re-read under the job's key lock, refuse if already
// terminal. A job never leaves a terminal state.
export function markTerminal(jobId, patch) {
  const p = jobFile(jobId, "job.json");
  if (!p) return { ok: false, error: `invalid job id: ${jobId}` };
  const meta = readJson(p, { strict: true });
  if (!meta) return { ok: false, error: `unknown job: ${jobId}` };
  return withKeyLock(meta.key ?? jobId, () => {
    const fresh = readJson(p, { strict: true }) ?? meta;
    if (isTerminal(fresh.state)) return { ok: false, error: `job already ${fresh.state}`, state: fresh.state };
    writeJson(p, { ...fresh, ...patch, finished_at: new Date().toISOString() });
    return { ok: true };
  });
}

// Kill implementation is injectable for offline tests (a kill failure must
// NOT be written as "cancelled" — that lie would let the vendor keep writing
// while the orchestrator believes it stopped).
function processCommandLine(pid) {
  if (IS_WIN) {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
      { encoding: "utf8", windowsHide: true },
    );
    return r.status === 0 ? (r.stdout ?? "").trim() : null;
  }
  const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : null;
}

function realKillTree(pid, { jobId } = {}) {
  // A heartbeat proves the pid WAS our runner, not that it still is: the
  // runner can die right after a beat and the OS can recycle the pid within
  // the freshness window. Verify the live process's command line references
  // THIS job before killing anything.
  if (jobId) {
    const cmdline = processCommandLine(pid);
    if (cmdline === null || cmdline === "") return { ok: true, alreadyGone: true };
    if (!cmdline.includes(jobId)) {
      return { ok: false, identityMismatch: true, detail: `pid ${pid} was recycled to an unrelated process — refusing to kill` };
    }
  }
  if (IS_WIN) {
    const r = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    if (r.error) return { ok: false, detail: String(r.error) };
    // 128 = process not found (already exited) — that's a successful outcome.
    if (r.status !== 0 && r.status !== 128) return { ok: false, detail: `taskkill exit ${r.status}` };
    return { ok: true };
  }
  try {
    // detached spawn made the runner a process-group leader on POSIX — kill
    // the whole group, or the vendor child would survive as an orphan.
    process.kill(-pid, "SIGKILL");
    return { ok: true };
  } catch (error) {
    if (error?.code === "ESRCH") return { ok: true }; // already gone
    return { ok: false, detail: String(error) };
  }
}
let killImpl = realKillTree;
export function _setKillImplForTests(fn) {
  killImpl = fn ?? realKillTree;
}

// Runner's starting→running transition — same lock discipline as terminal
// writes. If a cancel landed BEFORE the runner booted (pre-first-heartbeat),
// the runner must see it here and exit WITHOUT executing the vendor call; an
// unconditional "running" write would resurrect a cancelled job.
export function markRunning(jobId, pid) {
  const p = jobFile(jobId, "job.json");
  if (!p) return { ok: false, error: `invalid job id: ${jobId}` };
  const meta = readJson(p, { strict: true });
  if (!meta) return { ok: false, error: `unknown job: ${jobId}` };
  return withKeyLock(meta.key ?? jobId, () => {
    const fresh = readJson(p, { strict: true }) ?? meta;
    if (isTerminal(fresh.state)) return { ok: false, error: `job already ${fresh.state}`, state: fresh.state };
    writeJson(p, { ...fresh, state: "running", pid });
    return { ok: true };
  });
}

export function readRequest(jobId) {
  return readJson(jobFile(jobId, "request.json"), { strict: true });
}

export function cancelJob(jobId) {
  const meta = readJob(jobId);
  if (!meta) return { ok: false, error: `unknown job: ${jobId}` };
  if (isTerminal(meta.state)) return { ok: false, error: `job already ${meta.state}` };
  // Kill only a runner we can positively identify as OURS: a fresh heartbeat
  // carries the runner's own pid. A dead runner with a recycled PID has a
  // stale heartbeat → no kill; the reconciler marks it failed instead.
  // Candidate pid: a fresh heartbeat is best, but a sleep-stalled live runner
  // (kept alive by the reconciler's identity check) has NO fresh beat — fall
  // back to the runner/spawn pid. killImpl's command-line identity check is
  // the guard either way: recycled/gone pids route to reconcileDead below,
  // never to a blind kill or a false "cancelled".
  const hb = readJson(jobFile(jobId, "heartbeat.json"));
  const killablePid =
    (hb && Date.now() - hb.at < HEARTBEAT_FRESH_MS ? hb.pid : null) ??
    meta.pid ??
    readJson(jobFile(jobId, "spawn.json"))?.pid ??
    null;
  // Runner-already-dead paths (identity mismatch = pid recycled; alreadyGone =
  // exited before the check): nothing was killed, so "cancelled" would be a
  // lie — reconcile as failed, and honor the terminal CAS: if the runner beat
  // us to completed/failed, report THAT state, never claim "marked failed".
  const reconcileDead = (why) => {
    const marked = markTerminal(jobId, { state: "failed", error: `${why}; cancel found nothing to kill` });
    if (!marked.ok && marked.state) return { ok: true, note: `job had already finished as ${marked.state} — nothing to cancel` };
    return { ok: true, note: `runner was already dead (${why}); job marked failed` };
  };
  if (killablePid) {
    const killed = killImpl(killablePid, { jobId });
    if (killed.identityMismatch) return reconcileDead("pid recycled after the last heartbeat");
    if (killed.alreadyGone) return reconcileDead("runner exited before the cancel");
    if (!killed.ok) {
      // Do NOT write cancelled — the runner (and its vendor child) may still
      // be executing. Report the truth and leave the job running.
      return { ok: false, error: `kill failed (${killed.detail}) — job is still running; retry or let it finish` };
    }
  }
  const marked = markTerminal(jobId, { state: "cancelled" });
  if (!marked.ok && marked.state) {
    // lost the race to the runner's own terminal write — report the truth
    return { ok: false, error: `job finished as ${marked.state} before the cancel landed` };
  }
  return marked;
}
