// Vendor command construction + execution. Pure arg-builders are exported
// separately from the runner so the smoke test can assert on them offline.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, appendFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const IS_WIN = process.platform === "win32";
const AGY_HOME = path.join(os.homedir(), ".gemini", "antigravity-cli");

// ---------------------------------------------------------------------------
// Binary resolution: PATH first, then known install locations, env override wins.
// ---------------------------------------------------------------------------
function resolveBin(envVar, name, fallbacks) {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  for (const p of fallbacks) {
    if (existsSync(p)) return p;
  }
  return name; // trust PATH
}

export function codexBin() {
  return resolveBin("AI_BRIDGE_CODEX_BIN", "codex", [
    path.join(os.homedir(), "AppData", "Local", "Programs", "OpenAI", "Codex", "bin", IS_WIN ? "codex.exe" : "codex"),
  ]);
}

export function agyBin() {
  return resolveBin("AI_BRIDGE_AGY_BIN", "agy", [
    path.join(os.homedir(), "AppData", "Local", "agy", "bin", IS_WIN ? "agy.exe" : "agy"),
  ]);
}

// ---------------------------------------------------------------------------
// Model / effort mapping
// ---------------------------------------------------------------------------
// agy encodes effort in the model display name. Names are agy-version-dependent;
// override via env if an agy update renames them.
const GEMINI_PRO = process.env.AI_BRIDGE_GEMINI_PRO ?? "Gemini 3.1 Pro";
const GEMINI_FLASH = process.env.AI_BRIDGE_GEMINI_FLASH ?? "Gemini 3.5 Flash";

export function geminiModel(family, effort) {
  if (family === "flash") {
    const tier = { low: "Low", medium: "Medium", high: "High" }[effort] ?? "Medium";
    return `${GEMINI_FLASH} (${tier})`;
  }
  // Pro only ships Low/High; medium and above land on High.
  return `${GEMINI_PRO} (${effort === "low" ? "Low" : "High"})`;
}

// ---------------------------------------------------------------------------
// Arg builders (pure, testable)
// ---------------------------------------------------------------------------
// The prompt is fed via stdin (`-`), not argv — a large prompt as a single
// Windows argv arg hits the ~32KB CreateProcess limit and gets truncated.
// Sandbox is danger-full-access: it's the only codex mode whose tool launcher
// works on this Windows setup (read-only/workspace-write helpers fail with
// orchestrator_helper_launch_failed). git is the safety net — exec is
// dirty-tree-guarded; review is instructed read-only and never committed.
export function codexArgs({ effort, resume }) {
  if (resume) {
    return ["exec", "resume", "--json", "-c", `model_reasoning_effort="${effort}"`, resume, "-"];
  }
  return [
    "exec",
    "--skip-git-repo-check",
    "--sandbox", "danger-full-access",
    "--json",
    "-c", `model_reasoning_effort="${effort}"`,
    "-",
  ];
}

// codex --json emits JSONL events; the answer is item.completed/agent_message,
// the session id arrives in thread.started (feeds `resume`).
export function parseCodexJson(stdout) {
  let threadId = null;
  let usage = null;
  let sawEvent = false;
  const texts = [];
  const errors = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    sawEvent = true;
    if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
      texts.push(event.item.text);
    }
    if (event.type === "turn.completed") usage = event.usage ?? null;
    if (event.type === "error") errors.push(event.message ?? JSON.stringify(event));
  }
  if (!sawEvent) return null;
  return { threadId, text: texts.join("\n\n"), usage, errors };
}

export function agyArgs({ role, prompt, effort, cwd, family, timeoutMs }) {
  const model = geminiModel(family ?? (role === "digest" ? "flash" : "pro"), effort);
  // agy's own print-timeout follows the job's kill timer (it used to be a
  // hardcoded 15m that silently killed long whole-batch reviews while our
  // timer still had 10 minutes left).
  const minutes = Math.max(1, Math.ceil((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60000));
  const args = ["--model", model, "--print-timeout", `${minutes}m`];
  if (role === "exec") {
    // exec needs to WRITE — full permissions. cwd is the (clean-guarded) repo.
    args.push("--add-dir", cwd, "--dangerously-skip-permissions");
  } else if (cwd) {
    // review / digest with a repo: read + terminal-restricted, NOT dangerous.
    // Verified empirically: `agy --add-dir <repo> --sandbox -p` reads files
    // under headless mode without hanging or write/exec capability. The agent
    // reads the referenced files itself — no inlining, no argv-limit truncation.
    args.push("--add-dir", cwd, "--sandbox");
  }
  // no cwd → inline fallback: material travels in the prompt (fs-blind).
  args.push("-p", prompt);
  return args;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
export const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;

// Test seam: callVendor spawns through this indirection so the retry/degrade
// policy (bounded attempts / backoff / timeout-no-retry / degrade:true) can be
// exercised OFFLINE — live agy stress-testing is banned (clustered cold-starts
// provoke browser OAuth). Production never touches this; it defaults to run.
let runImpl = (...args) => run(...args);
let recoverImpl = (...args) => recoverAgyAnswer(...args);
export function _setRunImplForTests(fn, recoverFn) {
  runImpl = fn ?? ((...args) => run(...args));
  recoverImpl = recoverFn ?? ((...args) => recoverAgyAnswer(...args));
}

function killTree(child) {
  if (IS_WIN) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    child.kill("SIGKILL");
  }
}

// ---------------------------------------------------------------------------
// Wedge watchdog: lazy CPU probe over the vendor process TREE.
//
// Failure mode (batch-E, 85min): agy holds a dead connection — zero stdout,
// zero CPU — forever; the kill timer only fires at the full timeout ceiling,
// and diagnosis needed MANUAL CPU sampling. The watchdog automates exactly
// that diagnosis, lazily: the healthy path costs nothing (in-memory time
// comparison); only after silenceMs of NO output does it take CPU samples
// (probeGapMs apart), and only two consecutive ZERO deltas kill the vendor.
// Honest boundary: "server-side long thinking" vs "dead connection" is a
// heuristic — a false kill costs one budget-bounded retry (#5), a miss falls
// back to the timeout ceiling; both are bounded.
// ---------------------------------------------------------------------------
async function realCpuProbe(rootPid) {
  // One-shot listing of every process (pid, ppid, cpuSeconds); the tree sum is
  // computed here — the vendor may do its real work in a child process.
  const list = (bin, args) =>
    new Promise((res) => {
      let out = "";
      let c;
      try {
        c = spawn(bin, args, { windowsHide: true });
      } catch {
        res("");
        return;
      }
      c.stdout.setEncoding("utf8");
      c.stdout.on("data", (d) => (out += d));
      c.on("error", () => res(""));
      c.on("close", () => res(out));
    });
  const rows = [];
  if (IS_WIN) {
    const out = await list("powershell", [
      "-NoProfile", "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $_.KernelModeTime, $_.UserModeTime }",
    ]);
    for (const line of out.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 4) continue;
      const [pid, ppid, k, u] = parts.map(Number);
      if (!Number.isFinite(pid) || !Number.isFinite(k) || !Number.isFinite(u)) continue;
      rows.push({ pid, ppid, seconds: (k + u) / 1e7 }); // Kernel/UserModeTime are 100ns units
    }
  } else {
    const out = await list("ps", ["-ax", "-o", "pid=,ppid=,time="]);
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)/);
      if (!m) continue;
      const [, pid, ppid, dd, hh, mm, ss] = m;
      rows.push({ pid: Number(pid), ppid: Number(ppid), seconds: (Number(dd ?? 0) * 24 + Number(hh ?? 0)) * 3600 + Number(mm) * 60 + Number(ss) });
    }
  }
  const cpu = new Map();
  const byParent = new Map();
  for (const { pid, ppid, seconds } of rows) {
    cpu.set(pid, seconds);
    if (!byParent.has(ppid)) byParent.set(ppid, []);
    byParent.get(ppid).push(pid);
  }
  if (!cpu.has(rootPid)) return null; // root gone / listing failed → probe inconclusive, never a kill verdict
  let total = 0;
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length) {
    const p = queue.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    total += cpu.get(p) ?? 0;
    for (const c of byParent.get(p) ?? []) queue.push(c);
  }
  return total;
}
let cpuProbeImpl = realCpuProbe;
export function _setCpuProbeImplForTests(fn) {
  cpuProbeImpl = fn ?? realCpuProbe;
}

export function run(bin, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, input, teePath, watchdog } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      // stdin: pipe when we have input to feed (codex reads the prompt from
      // stdin via `-`, dodging the Windows ~32KB argv limit), else ignore.
      child = spawn(bin, args, { cwd, stdio: [input != null ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      resolve({ ok: false, exitCode: null, stdout: "", stderr: String(error) });
      return;
    }
    if (input != null) {
      child.stdin.on("error", () => {}); // ignore EPIPE if the child exits early
      child.stdin.end(input);
    }
    // Decode as UTF-8 via the stream's StringDecoder so a multibyte char split
    // across chunk boundaries isn't corrupted (our prompts/answers are often
    // Chinese — naive Buffer→string concat would mojibake).
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let wedged = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    // --- wedge watchdog (enabled only when the caller passes `watchdog`) ----
    let lastOutputAt = Date.now();
    let resumeAt = Date.now(); // observation restarts here after an inconclusive/alive probe
    let outBytes = 0;
    const cpuSamples = [];
    let wdState = watchdog ? "observing" : "off";
    let pollTimer = null;
    let lastProgressWrite = 0;
    const silenceMs = watchdog?.silenceMs ?? Math.max(1, Number(process.env.AI_BRIDGE_WEDGE_SILENCE_MS ?? 600_000));
    const probeGapMs = watchdog?.probeGapMs ?? Math.max(1, Number(process.env.AI_BRIDGE_WEDGE_PROBE_GAP_MS ?? 300_000));
    const pollMs = watchdog?.pollMs ?? Math.min(30_000, Math.max(50, Math.floor(silenceMs / 4)));
    const emitProgress = (force = false) => {
      if (!watchdog?.onProgress) return;
      const now = Date.now();
      if (!force && now - lastProgressWrite < 2000) return; // throttle: milestones + 2s cadence, not per-chunk
      lastProgressWrite = now;
      try {
        watchdog.onProgress({
          lastOutputAt: new Date(lastOutputAt).toISOString(),
          stdoutBytes: outBytes,
          cpuSamples: cpuSamples.slice(-6),
          watchdog: wdState,
        });
      } catch {
        /* progress reporting must never kill the run */
      }
    };
    const runProbe = async () => {
      wdState = "probing";
      emitProgress(true);
      const sample = async () => {
        let s = null;
        try {
          s = await cpuProbeImpl(child.pid);
        } catch {
          s = null;
        }
        cpuSamples.push({ at: new Date().toISOString(), cpuSeconds: s });
        emitProgress(true);
        return s;
      };
      const backOff = () => {
        // inconclusive or CPU-alive: NOT a wedge — return to silent observation
        if (wdState === "probing") wdState = "observing";
        resumeAt = Date.now();
      };
      let prev = await sample();
      if (settled || wdState !== "probing") return; // output arrived / process exited mid-probe
      if (prev === null) return backOff();
      for (let i = 0; i < 2; i++) {
        await new Promise((res) => setTimeout(res, probeGapMs));
        if (settled || wdState !== "probing") return;
        const s = await sample();
        if (settled || wdState !== "probing") return;
        if (s === null) return backOff();
        if (s - prev > 0.05) return backOff(); // CPU moved: server-side long thinking, leave it alone
        prev = s;
      }
      // two consecutive zero CPU deltas with silent stdout → dead connection
      wdState = "wedged";
      wedged = true;
      emitProgress(true);
      killTree(child);
    };
    if (watchdog) {
      pollTimer = setInterval(() => {
        if (wdState !== "observing") return;
        if (Date.now() - Math.max(lastOutputAt, resumeAt) >= silenceMs) runProbe();
        else emitProgress();
      }, pollMs);
    }
    const onOutput = (d) => {
      lastOutputAt = Date.now();
      outBytes += Buffer.byteLength(d);
      if (teePath) {
        try {
          appendFileSync(teePath, d);
        } catch {
          /* tee is diagnostics, never fatal */
        }
      }
      if (wdState === "probing") {
        // output arrived mid-probe: the vendor is alive — abort the probe
        wdState = "observing";
        resumeAt = Date.now();
      }
      emitProgress();
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      emitProgress(true);
      resolve(result);
    };

    child.stdout.on("data", (d) => {
      stdout += d;
      onOutput(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      onOutput(d);
    });
    child.on("error", (error) => {
      finish({ ok: false, exitCode: null, stdout, stderr: stderr + String(error) });
    });
    child.on("close", (code) => {
      finish({
        ok: !timedOut && !wedged && code === 0,
        exitCode: code,
        timedOut,
        wedged,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// agy answer recovery
//
// agy 1.0.x renders print-mode output through a TTY "drip" renderer: with
// stdout piped, the answer is silently discarded (exit 0, empty stdout), and
// the fast shutdown often races the brain transcript flush (0-byte files).
// Recovery from the conversation store is BEST-EFFORT ONLY: probes show the
// empty-stdout flake is usually an early failure whose answer never reached
// the store either (recovery hit rate ≈ 0 in stress runs). The PRIMARY
// mitigation is the bounded de-clustered retry in callVendor; this one cheap
// store read runs before each re-call because it's ~free when it does hit.
// Recovery order: transcript.jsonl → conversations/<id>.db; both failing is
// simply "retry" (and after max attempts, degrade — never a silent empty answer).
// ---------------------------------------------------------------------------

// Minimal protobuf wire-format walk collecting printable strings (we have no
// schema for step_payload; the answer is a string field in the type-15 step).
export function protoStrings(buf, depth = 0, out = []) {
  let i = 0;
  const readVarint = () => {
    let shift = 0n;
    let value = 0n;
    while (i < buf.length) {
      const b = buf[i++];
      value |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return value;
      shift += 7n;
      if (shift > 63n) return null;
    }
    return null;
  };
  while (i < buf.length) {
    const key = readVarint();
    if (key === null) break;
    const wire = Number(key & 7n);
    if (wire === 0) {
      if (readVarint() === null) break;
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else if (wire === 2) {
      const len = readVarint();
      if (len === null) break;
      const n = Number(len);
      if (n < 0 || i + n > buf.length) break;
      const slice = buf.subarray(i, i + n);
      i += n;
      const text = slice.toString("utf8");
      if (text.length > 0 && !text.includes("�") && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
        out.push(text);
      }
      if (depth < 6 && n > 1) protoStrings(slice, depth + 1, out);
    } else break;
  }
  return out;
}

const NOISE_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^bot-[0-9a-f-]{36}$/i,
  /^sessionID$/,
  /^-?\d+$/,
];

function isNoise(s) {
  const t = s.trim();
  if (!t) return true;
  if (NOISE_PATTERNS.some((re) => re.test(t))) return true;
  // opaque single tokens (trace ids, base64-ish handles)
  if (!/\s/.test(t) && t.length >= 16 && t.length <= 30 && /^[A-Za-z0-9_-]+$/.test(t)) return true;
  return false;
}

// Returns { strings } from the latest planner-response payload. `prompt`, when
// given, is excluded from candidates — the prompt is echoed into the payload
// and for review/digest calls it dwarfs the answer, so the longest-dup
// heuristic would otherwise return the prompt itself (both reviewers flagged).
export function extractAnswerFromDb(dbPath, { prompt } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let row;
  try {
    row = db.prepare("SELECT step_payload FROM steps WHERE step_type = 15 ORDER BY idx DESC").get();
  } finally {
    db.close();
  }
  if (!row?.step_payload) {
    throw new Error("no planner-response step (type 15) in conversation db");
  }
  const promptNorm = prompt?.trim();
  const candidates = protoStrings(Buffer.from(row.step_payload))
    .filter((s) => !isNoise(s))
    .filter((s) => {
      if (!promptNorm) return true;
      const t = s.trim();
      // drop the prompt itself, or any candidate that embeds the whole prompt
      // (a metadata wrapper around it). Do NOT drop candidates that are merely
      // substrings of the prompt — a short answer can legitimately be one.
      return t !== promptNorm && !t.includes(promptNorm);
    });
  if (!candidates.length) {
    throw new Error("no answer-like strings in planner-response payload (after prompt exclusion)");
  }
  // The final answer text appears in two fields (streaming accumulator +
  // final); prefer the longest duplicated string, fall back to longest.
  const counts = new Map();
  for (const s of candidates) counts.set(s, (counts.get(s) ?? 0) + 1);
  const dups = [...counts.keys()].filter((s) => counts.get(s) >= 2);
  const pool = dups.length ? dups : candidates;
  return pool.sort((a, b) => b.length - a.length)[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pick the conversation created by THIS run: the newest conversation db whose
// mtime is at/after run start. Replaces the old cwd→id cache lookup, which
// collided under concurrency — review/digest calls pass no cwd, so they all
// mapped to process.cwd() and a parallel call would return the wrong answer.
function newestConversationSince(since) {
  const dir = path.join(AGY_HOME, "conversations");
  let best = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".db")) continue;
    const id = name.slice(0, -3);
    if (!UUID_RE.test(id)) continue;
    const mtime = statSync(path.join(dir, name)).mtimeMs;
    if (mtime < since - 2000) continue; // predates this run
    if (!best || mtime > best.mtime) best = { id, mtime };
  }
  return best?.id ?? null;
}

function readTranscriptAnswer(convId) {
  const p = path.join(AGY_HOME, "brain", convId, ".system_generated", "logs", "transcript.jsonl");
  let raw;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    return null;
  }
  let answer = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.source === "MODEL" && entry.type === "PLANNER_RESPONSE" && entry.status === "DONE" && entry.content) {
        answer = entry.content;
      }
    } catch {
      // partial line from a racy flush — ignore
    }
  }
  return answer;
}

// Plausibility floor for RECOVERED answers (batch-E: recovery fished the
// literal denied-tool token `run_command` out of the session store and passed
// it off as the review — isNoise only blocks 16-30 char opaque tokens, an
// 11-char snake_case name sailed through). A short REAL answer being rejected
// here just falls back to the normal retry — acceptable cost.
export function isImplausibleRecoveredAnswer(answer) {
  const t = String(answer ?? "").trim();
  if (!t) return true;
  if (t.length < 40 && !/\s/.test(t)) return true; // bare short token (tool names, ids)
  if (/^[a-z_]+$/.test(t)) return true; // snake_case single token of any length
  return false;
}

export function recoverAgyAnswer({ since, prompt }) {
  const convId = newestConversationSince(since);
  if (!convId) {
    throw new Error(
      `no conversation created at/after this run in ${path.join(AGY_HOME, "conversations")} — agy likely failed before answering`,
    );
  }
  const dbPath = path.join(AGY_HOME, "conversations", `${convId}.db`);
  // transcript is the same convId's structured log — already run-fresh via the
  // mtime gate above; prefer it (clean PLANNER_RESPONSE) over db heuristic.
  const fromTranscript = readTranscriptAnswer(convId);
  if (fromTranscript) return { answer: fromTranscript, source: "transcript", convId };
  return { answer: extractAnswerFromDb(dbPath, { prompt }), source: "db", convId };
}

// ---------------------------------------------------------------------------
// High-level vendor calls
// ---------------------------------------------------------------------------
export async function callVendor({ vendor, role, prompt, effort, cwd, family, timeoutMs, resume, teePath, onProgress }) {
  // Watchdog + tee are enabled by the detached runner (which passes teePath /
  // onProgress); direct synchronous calls (digest) skip them.
  const watchdog = onProgress ? { onProgress } : teePath ? {} : undefined;
  let result;
  let commandLine;
  if (vendor === "gpt") {
    const args = codexArgs({ effort, resume });
    commandLine = `codex ${args.join(" ")} <stdin-prompt>${cwd ? ` (cwd=${cwd})` : ""}`;
    // prompt via stdin (the trailing `-`); codex reads files/runs git from cwd.
    result = await runImpl(codexBin(), args, { cwd, timeoutMs, input: prompt, teePath, watchdog });
    if (result.ok) {
      const parsed = parseCodexJson(result.stdout);
      // We always pass --json; no parseable events means something is wrong
      // (auth banner, crash, codex CLI change). Fail loud — never hand back
      // raw stdout as a successful answer.
      if (!parsed) {
        return { ok: false, commandLine, error: "codex --json produced no parseable events", stdout: result.stdout, stderr: result.stderr };
      }
      if (parsed.errors.length) {
        return { ok: false, commandLine, error: parsed.errors.join("; "), sessionId: parsed.threadId };
      }
      if (!parsed.text) {
        return { ok: false, commandLine, error: "codex completed without an agent message", sessionId: parsed.threadId };
      }
      return { ok: true, commandLine, output: parsed.text, sessionId: parsed.threadId, usage: parsed.usage };
    }
    // result not ok → shared failure handler below
  } else {
    // gemini (agy): under piped (non-TTY) stdout, agy's drip renderer discards
    // the answer NON-deterministically (~25% of isolated calls: clean exit 0, empty
    // stdout; the answer is NOT in the conversation store either — verified by probe,
    // so there's nothing to recover locally, only a re-call gets it).
    //
    // CRITICAL — retries must stay GENTLE and DE-CLUSTERED. Each agy call is a fresh
    // process that re-inits auth from the SHARED keyring token. At normal spacing that
    // is a silent token load (no browser). But CLUSTERED cold-starts (rapid retries /
    // stress) contend on auth init and provoke agy to open a full browser OAuth
    // `prompt=consent` flow — EVEN with a valid non-expired keyring token (observed:
    // browser.go consumerOAuth 5s after a valid keyring load). Repeated interactive
    // OAuth is a Google account-risk-control exposure. So: FEW attempts, LONG backoff
    // (never cluster), and on final failure the caller SKIPS the Gemini seat for the
    // round (GPT anchors; no seat-swap) — never hammer. A true TIMEOUT is not retried.
    // The clean-context one-shot model is a VIRTUE (fresh independent review); a
    // persistent session would auth once but POLLUTE context — rejected. The only
    // deterministic escalation is a PTY (one-shot + fake TTY: no drip, still clean
    // context, no cluster), gated behind a native dep — not done here.
    // timeoutMs is a JOB-LEVEL BUDGET, not per-attempt (a per-attempt timer let
    // attempt 1 burn the full 90min, exit 0 empty, and attempt 2 burn ANOTHER
    // 90min — 180min against the user's 90min intuition). Every attempt gets
    // the REMAINING budget; under MIN_RETRY_BUDGET_MS we fail instead of
    // retrying. Watchdog kills (#4) consume the same budget by construction.
    const totalMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + totalMs;
    const MIN_RETRY_BUDGET_MS = 60_000;
    const maxAttempts = Math.max(1, Number(process.env.AI_BRIDGE_AGY_ATTEMPTS ?? 2));
    // LONG backoff before a retry: the first process must have fully exited and
    // released keyring/auth so the retry is a de-clustered normal-cadence call, not a
    // contending one. 8s ≫ the ~0.7s keyring-settle window; keeps us far from the
    // clustering that provokes browser OAuth.
    const backoffMs = Math.max(0, Number(process.env.AI_BRIDGE_AGY_BACKOFF_MS ?? 8000));
    let lastErr = "unknown";
    let attemptsRun = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        if (deadline - Date.now() - backoffMs < MIN_RETRY_BUDGET_MS) {
          lastErr += `; job time budget (${Math.round(totalMs / 60000)}min) exhausted — not retrying`;
          break;
        }
        if (backoffMs > 0) await new Promise((res) => setTimeout(res, backoffMs));
      }
      attemptsRun = attempt;
      const remainingMs = Math.max(1, deadline - Date.now());
      // args are rebuilt per attempt so agy's own --print-timeout follows the
      // REMAINING budget, not the original total.
      const args = agyArgs({ role, prompt, effort, cwd, family, timeoutMs: remainingMs });
      commandLine = `agy ${args.slice(0, -1).join(" ")} <prompt>`;
      const attemptSince = Date.now();
      const r = await runImpl(agyBin(), args, { cwd, timeoutMs: remainingMs, teePath, watchdog });
      const tag = attempt > 1 ? ` (agy attempt ${attempt}/${maxAttempts})` : "";
      if (r.ok && r.stdout !== "") {
        return { ok: true, commandLine, output: r.stdout, ...(attempt > 1 ? { note: `succeeded on retry${tag}` } : {}) };
      }
      if (r.ok) {
        // exit 0 + empty stdout: the DIAGNOSIS lives on stderr — check it FIRST.
        // Headless --sandbox auto-denies command-class tools; a prompt that asks
        // the reviewer to run commands (git diff etc.) fails PERMANENTLY: no
        // retry or store-recovery can ever help (batch-E burned 3 retries + a
        // fake `run_command` "answer" on exactly this).
        if (/auto-denied|required the "command" permission/.test(r.stderr ?? "")) {
          return {
            ok: false, commandLine, degrade: true,
            error:
              `agy auto-denied a command-class tool under headless --sandbox — PERMANENT failure, retry/recovery cannot help (the prompt asks the reviewer to RUN COMMANDS, which headless mode cannot grant).\n` +
              `stderr: ${(r.stderr ?? "").trim().slice(0, 600)}\n` +
              `Fix: materialize the diff to a file first (git diff <base>..<head> > docs/reviews/<label>-diff.txt) and instruct the reviewer to READ FILES ONLY — never run commands (xreview Gemini-seat rule).`,
          };
        }
        // ONE cheap store-recovery check (probe shows it rarely has the answer —
        // the flake is an early failure, not a discarded completion — but the
        // single read is ~free, so try before re-calling).
        try {
          const recovered = recoverImpl({ since: attemptSince, prompt });
          // Plausibility floor: the store also contains denied-tool names and
          // ids; a bare token is NOT an answer (treat as recovery failure → retry).
          if (isImplausibleRecoveredAnswer(recovered.answer)) {
            throw new Error(`recovered candidate rejected as implausible: "${String(recovered.answer).trim().slice(0, 60)}"`);
          }
          return { ok: true, commandLine, output: recovered.answer, note: `answer recovered from ${recovered.source}${tag}` };
        } catch (error) {
          lastErr = `empty stdout + recovery failed: ${error?.message ?? error}`;
          continue; // retryable
        }
      }
      if (r.timedOut) {
        lastErr = `timed out after ${remainingMs} ms (job budget ${totalMs} ms)`;
        break; // do NOT retry a full timeout — the budget is gone by definition
      }
      if (r.wedged) {
        lastErr = "watchdog killed a wedged vendor (stdout silent, CPU flat across two probes — dead connection)";
        continue; // retryable, bounded by the remaining job budget
      }
      lastErr = `exit ${r.exitCode}${r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ""}`;
      // fast crash / transient re-login → retryable
    }
    return { ok: false, commandLine, degrade: true, error: `agy failed after ${attemptsRun} gentle attempt(s): ${lastErr}. SKIP this Gemini seat for the round (GPT anchors; note Gemini absent in the verdict) — do NOT re-invoke agy in a loop (clustered cold-starts provoke a browser OAuth re-consent) and do NOT seat-swap. Inspect ${path.join(AGY_HOME, "conversations")}` };
  }

  // gpt-only from here (the gemini branch returns in all paths above).
  if (!result.ok) {
    return {
      ok: false,
      commandLine,
      error: result.wedged
        ? "watchdog killed a wedged vendor (stdout silent, CPU flat across two probes — dead connection)"
        : result.timedOut
          ? `timed out after ${timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`
          : `exit code ${result.exitCode}`,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }
  return { ok: true, commandLine, output: result.stdout };
}

// ---------------------------------------------------------------------------
// Dirty-tree guard: git is the safety net for agentic writes — uncommitted
// changes are the only unrecoverable loss. exec into a dirty (or non-git)
// cwd requires explicit allow_dirty.
// ---------------------------------------------------------------------------
export function assertSafeExecCwd(cwd, allowDirty) {
  if (allowDirty) return;
  const r = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", windowsHide: true });
  if (r.error?.code === "ENOENT") {
    throw new Error("git is not installed or not on PATH — cannot verify a safe exec cwd; install git or pass allow_dirty: true");
  }
  if (r.error || r.status !== 0) {
    throw new Error(`${cwd} is not a git repository — no safety net for agent writes; pass allow_dirty: true to proceed`);
  }
  const dirty = r.stdout.trim();
  if (dirty) {
    throw new Error(
      `${cwd} has uncommitted changes — an agent run could clobber them irrecoverably. ` +
      `Commit/stash first, or pass allow_dirty: true.\n${dirty.split("\n").slice(0, 10).join("\n")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Evidence + file embedding helpers
// ---------------------------------------------------------------------------
export function writeEvidence(evidencePath, { vendor, role, effort, commandLine, output }) {
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  const header = [
    `# ai-bridge ${role} evidence`,
    `- vendor: ${vendor}`,
    `- effort: ${effort}`,
    `- command: ${commandLine}`,
    `- written: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ].join("\n");
  writeFileSync(evidencePath, header + output + "\n", "utf8");
}

const MAX_EMBED_BYTES = 400 * 1024;

export function embedFiles(files) {
  // Stat-and-sum before reading anything — a multi-GB path shouldn't be slurped
  // into memory just to fail the size check afterward.
  let total = 0;
  for (const file of files) {
    const st = statSync(file);
    if (!st.isFile()) {
      throw new Error(`not a regular file: ${file}`);
    }
    total += st.size;
    if (total > MAX_EMBED_BYTES) {
      throw new Error(
        `embedded files exceed ${MAX_EMBED_BYTES} bytes at ${file}; pass cwd instead so agy reads from disk`,
      );
    }
  }
  return files
    .map((file) => `<file path="${file}">\n${readFileSync(file, "utf8")}\n</file>`)
    .join("\n\n");
}
