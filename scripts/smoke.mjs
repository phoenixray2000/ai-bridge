// Smoke test. Offline by default: arg-builder assertions + MCP handshake.
// `--live` additionally fires one real call per vendor (burns a tiny amount of
// GPT + Gemini quota).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexArgs, agyArgs, geminiModel, callVendor, parseCodexJson } from "../src/vendors.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const live = process.argv.includes("--live");

// --- arg builders -----------------------------------------------------------
// prompt via stdin (`-`); danger-full-access is the only working codex mode on Windows
assert.deepEqual(codexArgs({ effort: "high" }), [
  "exec", "--skip-git-repo-check", "--sandbox", "danger-full-access", "--json",
  "-c", 'model_reasoning_effort="high"', "-",
]);
assert.deepEqual(codexArgs({ effort: "medium", resume: "abc-123" }), [
  "exec", "resume", "--json", "-c", 'model_reasoning_effort="medium"', "abc-123", "-",
]);

const parsed = parseCodexJson([
  '{"type":"thread.started","thread_id":"t-1"}',
  '{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"HELLO"}}',
  '{"type":"turn.completed","usage":{"output_tokens":5}}',
].join("\n"));
assert.equal(parsed.threadId, "t-1");
assert.equal(parsed.text, "HELLO");
assert.equal(parseCodexJson("plain text output"), null);

// review without cwd → fs-blind inline fallback
const reviewBlind = agyArgs({ role: "review", prompt: "P", effort: "high" });
assert.ok(!reviewBlind.includes("--add-dir"), "review without cwd is fs-blind");
assert.equal(reviewBlind[reviewBlind.indexOf("--model") + 1], "Gemini 3.1 Pro (High)");

// review WITH cwd → read-by-reference: --add-dir + --sandbox, never dangerous
const reviewRef = agyArgs({ role: "review", prompt: "P", effort: "high", cwd: "D:/repo" });
assert.ok(reviewRef.includes("--add-dir") && reviewRef.includes("D:/repo"));
assert.ok(reviewRef.includes("--sandbox"), "review-by-reference uses --sandbox read mode");
assert.ok(!reviewRef.includes("--dangerously-skip-permissions"), "review must never get write");

// exec → write access
const exec = agyArgs({ role: "exec", prompt: "P", effort: "medium", cwd: "D:/wt" });
assert.ok(exec.includes("--add-dir") && exec.includes("--dangerously-skip-permissions"));

// digest with cwd → --sandbox read, NOT dangerous (fixes review finding #8)
const digestDir = agyArgs({ role: "digest", prompt: "P", effort: "medium", family: "flash", cwd: "D:/repo" });
assert.ok(digestDir.includes("--sandbox") && !digestDir.includes("--dangerously-skip-permissions"), "digest dir-scan is read-only");

const digest = agyArgs({ role: "digest", prompt: "P", effort: "medium", family: "flash" });
assert.ok(!digest.includes("--add-dir"), "file-embed digest grants no fs access");
assert.equal(digest[digest.indexOf("--model") + 1], "Gemini 3.5 Flash (Medium)");

assert.equal(geminiModel("pro", "medium"), "Gemini 3.1 Pro (High)"); // pro has no Medium tier
console.log("ok arg builders");

// --- MCP handshake -----------------------------------------------------------
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, "src", "server.mjs")], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffer = "";
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error("handshake timeout"));
  }, 15000);
  child.stdout.on("data", (d) => {
    buffer += d;
    for (const line of buffer.split("\n")) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id === 2) {
        const names = msg.result.tools.map((t) => t.name).sort();
        assert.deepEqual(names, ["ai_digest", "ai_exec", "ai_review"]);
        clearTimeout(timer);
        child.kill();
        console.log("ok mcp handshake: " + names.join(", "));
        resolve();
      }
    }
  });
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
});

// --- live calls --------------------------------------------------------------
if (live) {
  const gemini = await callVendor({
    vendor: "gemini", role: "digest", family: "flash", effort: "low",
    prompt: "Reply with exactly the single word: PONG",
    timeoutMs: 5 * 60 * 1000,
  });
  assert.ok(gemini.ok, `gemini live failed: ${gemini.error} ${gemini.stderr ?? ""}`);
  assert.match(gemini.output, /PONG/);
  console.log("ok live gemini: " + gemini.output.slice(0, 40));

  const gpt = await callVendor({
    vendor: "gpt", role: "review", effort: "low",
    prompt: "Reply with exactly the single word: PONG",
    timeoutMs: 5 * 60 * 1000,
  });
  assert.ok(gpt.ok, `gpt live failed: ${gpt.error} ${gpt.stderr ?? ""}`);
  assert.match(gpt.output, /PONG/);
  console.log("ok live gpt: " + gpt.output.slice(-40));
} else {
  console.log("skipped live calls (pass --live)");
}

console.log("SMOKE PASS");
