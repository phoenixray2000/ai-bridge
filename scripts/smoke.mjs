// Smoke test. Offline by default: arg-builder assertions + MCP handshake.
// `--live` additionally fires one real call per vendor (burns a tiny amount of
// GPT + Gemini quota).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexArgs, agyArgs, geminiModel, callVendor } from "../src/vendors.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const live = process.argv.includes("--live");

// --- arg builders -----------------------------------------------------------
assert.deepEqual(codexArgs({ role: "review", prompt: "P", effort: "high" }), [
  "exec", "--skip-git-repo-check", "--sandbox", "read-only",
  "-c", 'model_reasoning_effort="high"', "P",
]);
assert.deepEqual(codexArgs({ role: "exec", prompt: "P", effort: "medium" })[3], "workspace-write");

const review = agyArgs({ role: "review", prompt: "P", effort: "high" });
assert.ok(!review.includes("--add-dir"), "review must be filesystem-blind");
assert.ok(!review.includes("--dangerously-skip-permissions"));
assert.equal(review[review.indexOf("--model") + 1], "Gemini 3.1 Pro (High)");

const exec = agyArgs({ role: "exec", prompt: "P", effort: "medium", cwd: "D:/wt" });
assert.ok(exec.includes("--add-dir") && exec.includes("D:/wt"));
assert.ok(exec.includes("--dangerously-skip-permissions"));

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
