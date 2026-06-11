// Diagnostic probe: isolate why agy -p produces nothing under piped stdio.
// Variables: cwd (trusted home vs fresh dir) × --dangerously-skip-permissions.
import { run, agyBin } from "../src/vendors.mjs";
import os from "node:os";

const PROMPT = "Reply with exactly the single word: PONG";
const MODEL = "Gemini 3.5 Flash (Low)";
const cases = [
  { label: "A: cwd=home, plain", cwd: os.homedir(), args: ["--model", MODEL, "-p", PROMPT] },
  { label: "B: cwd=repo, skip-permissions", cwd: "D:/git/ai-bridge", args: ["--dangerously-skip-permissions", "--model", MODEL, "-p", PROMPT] },
  { label: "C: cwd=repo, plain", cwd: "D:/git/ai-bridge", args: ["--model", MODEL, "-p", PROMPT] },
];

for (const c of cases) {
  const started = Date.now();
  const r = await run(agyBin(), c.args, { cwd: c.cwd, timeoutMs: 180000 });
  console.log(`${c.label} -> exit=${r.exitCode} timedOut=${!!r.timedOut} ${Date.now() - started}ms`);
  console.log(`  stdout[${r.stdout.length}]: ${r.stdout.slice(0, 120)}`);
  if (r.stderr) console.log(`  stderr[${r.stderr.length}]: ${r.stderr.slice(0, 300)}`);
}
