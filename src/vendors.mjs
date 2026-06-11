// Vendor command construction + execution. Pure arg-builders are exported
// separately from the runner so the smoke test can assert on them offline.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const IS_WIN = process.platform === "win32";

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
export function codexArgs({ role, prompt, effort }) {
  // review must not write; exec is confined to its spawn cwd (a worktree).
  const sandbox = role === "exec" ? "workspace-write" : "read-only";
  return [
    "exec",
    "--skip-git-repo-check",
    "--sandbox", sandbox,
    "-c", `model_reasoning_effort="${effort}"`,
    prompt,
  ];
}

export function agyArgs({ role, prompt, effort, cwd, family }) {
  const model = geminiModel(family ?? (role === "digest" ? "flash" : "pro"), effort);
  const args = ["--model", model, "--print-timeout", role === "exec" ? "30m" : "15m"];
  if (role === "exec") {
    // exec needs file access; callers must point cwd at an isolated worktree.
    args.push("--add-dir", cwd, "--dangerously-skip-permissions");
  } else if (role === "digest" && cwd) {
    // digest over a directory: grant read access to that directory only.
    // agy has no read-only approval mode, so the blast radius is the cwd we add.
    args.push("--add-dir", cwd, "--dangerously-skip-permissions");
  }
  // review: no --add-dir at all — material travels in the prompt, reviewer is
  // filesystem-blind by construction.
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

export function run(bin, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      resolve({ ok: false, exitCode: null, stdout: "", stderr: String(error) });
      return;
    }
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
// High-level vendor calls
// ---------------------------------------------------------------------------
export async function callVendor({ vendor, role, prompt, effort, cwd, family, timeoutMs }) {
  let result;
  let commandLine;
  if (vendor === "gpt") {
    const args = codexArgs({ role, prompt, effort });
    commandLine = `codex ${args.slice(0, -1).join(" ")} <prompt>`;
    result = await run(codexBin(), args, { cwd, timeoutMs });
  } else {
    const args = agyArgs({ role, prompt, effort, cwd, family });
    commandLine = `agy ${args.slice(0, -1).join(" ")} <prompt>`;
    result = await run(agyBin(), args, { cwd, timeoutMs });
  }

  // Fail loud on the known agy 1.0.x headless symptom: clean exit, empty stdout.
  // We verified stdout works on this machine; if it ever regresses we want an
  // error pointing at the transcript dir, not a silent empty review.
  if (vendor === "gemini" && result.ok && result.stdout === "") {
    return {
      ok: false,
      commandLine,
      error:
        "agy exited 0 but printed nothing — likely the agy -p stdout bug. " +
        `Inspect ${path.join(os.homedir(), ".gemini", "antigravity-cli", "brain")} for the transcript before retrying.`,
      stderr: result.stderr,
    };
  }
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
  let total = 0;
  const blocks = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    total += Buffer.byteLength(content, "utf8");
    if (total > MAX_EMBED_BYTES) {
      throw new Error(
        `embedded files exceed ${MAX_EMBED_BYTES} bytes at ${file}; pass cwd instead so agy reads from disk`,
      );
    }
    blocks.push(`<file path="${file}">\n${content}\n</file>`);
  }
  return blocks.join("\n\n");
}
