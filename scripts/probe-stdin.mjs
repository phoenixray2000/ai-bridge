// Hypothesis test: does keeping stdin open (vs closed) make agy flush
// transcript.jsonl reliably under piped stdio?
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { agyBin } from "../src/vendors.mjs";

const BRAIN = path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");
const PROMPT = "Reply with exactly the single word: PONG";

function newestConversationSince(t) {
  return readdirSync(BRAIN)
    .map((name) => ({ name, mtime: statSync(path.join(BRAIN, name)).mtimeMs }))
    .filter((e) => e.mtime >= t)
    .sort((a, b) => b.mtime - a.mtime)[0];
}

function transcriptOf(id) {
  const p = path.join(BRAIN, id, ".system_generated", "logs", "transcript.jsonl");
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

for (const stdinMode of ["pipe", "ignore"]) {
  const started = Date.now();
  const child = spawn(agyBin(), ["--model", "Gemini 3.5 Flash (Low)", "-p", PROMPT], {
    cwd: "D:/git/ai-bridge",
    stdio: [stdinMode, "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
    setTimeout(() => { child.kill(); resolve("timeout"); }, 180000);
  });
  // give any async flush a moment, then check transcript
  await new Promise((r) => setTimeout(r, 2000));
  const conv = newestConversationSince(started);
  const transcript = conv ? transcriptOf(conv.name) : null;
  const hasAnswer = transcript?.includes("PLANNER_RESPONSE");
  console.log(
    `stdin=${stdinMode}: exit=${exitCode} ${Date.now() - started}ms stdout[${stdout.trim().length}]` +
    ` conv=${conv?.name?.slice(0, 8) ?? "none"} transcript=${transcript === null ? "missing" : transcript.length + "B"} answer=${!!hasAnswer}`,
  );
}
