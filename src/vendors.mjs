// Vendor command construction + execution. Pure arg-builders are exported
// separately from the runner so the smoke test can assert on them offline.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from "node:fs";
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

export function agyArgs({ role, prompt, effort, cwd, family }) {
  const model = geminiModel(family ?? (role === "digest" ? "flash" : "pro"), effort);
  const args = ["--model", model, "--print-timeout", role === "exec" ? "30m" : "15m"];
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
const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;

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

export function run(bin, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, input } = {}) {
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
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, stdout, stderr: stderr + String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        exitCode: code,
        timedOut,
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
// The conversation SQLite store is written reliably, so recovery order is:
// stdout → transcript.jsonl → conversations/<id>.db. All three failing is a
// loud error, never a silent empty answer.
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
export async function callVendor({ vendor, role, prompt, effort, cwd, family, timeoutMs, resume }) {
  let result;
  let commandLine;
  if (vendor === "gpt") {
    const args = codexArgs({ effort, resume });
    commandLine = `codex ${args.join(" ")} <stdin-prompt>${cwd ? ` (cwd=${cwd})` : ""}`;
    // prompt via stdin (the trailing `-`); codex reads files/runs git from cwd.
    result = await run(codexBin(), args, { cwd, timeoutMs, input: prompt });
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
    // the answer NON-deterministically (clean exit 0, empty stdout) and it also
    // throws a transient re-login now and then. A single call "mostly works" but
    // flakes. A real TTY is 100% reliable but needs a PTY native dep — the no-dep
    // STABLE method is a BOUNDED RETRY: re-run the whole attempt (spawn + empty-
    // stdout recovery from the conversation store agy reliably persists to) until
    // one lands. A true TIMEOUT is not retried (it would burn another print-timeout).
    const args = agyArgs({ role, prompt, effort, cwd, family });
    commandLine = `agy ${args.slice(0, -1).join(" ")} <prompt>`;
    const maxAttempts = Math.max(1, Number(process.env.AI_BRIDGE_AGY_ATTEMPTS ?? 4));
    let lastErr = "unknown";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptSince = Date.now();
      const r = await run(agyBin(), args, { cwd, timeoutMs });
      const tag = attempt > 1 ? ` (agy attempt ${attempt}/${maxAttempts})` : "";
      if (r.ok && r.stdout !== "") {
        return { ok: true, commandLine, output: r.stdout, ...(attempt > 1 ? { note: `succeeded on retry${tag}` } : {}) };
      }
      if (r.ok) {
        // exit 0 + empty stdout = drip discarded the answer; recover it.
        try {
          const recovered = recoverAgyAnswer({ since: attemptSince, prompt });
          return { ok: true, commandLine, output: recovered.answer, note: `answer recovered from ${recovered.source} (agy piped-stdout bug)${tag}` };
        } catch (error) {
          lastErr = `empty stdout + recovery failed: ${error?.message ?? error}`;
          continue; // retryable
        }
      }
      if (r.timedOut) {
        lastErr = `timed out after ${timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`;
        break; // do NOT retry a full timeout
      }
      lastErr = `exit ${r.exitCode}${r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ""}`;
      // fast crash / transient re-login → retryable
    }
    return { ok: false, commandLine, error: `agy failed after ${maxAttempts} attempt(s): ${lastErr} — inspect ${path.join(AGY_HOME, "conversations")}` };
  }

  // gpt-only from here (the gemini branch returns in all paths above).
  if (!result.ok) {
    return {
      ok: false,
      commandLine,
      error: result.timedOut
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
