import { run, codexBin } from "../src/vendors.mjs";

const r = await run(
  codexBin(),
  ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--json",
    "-c", 'model_reasoning_effort="low"', "Reply with exactly: PONG"],
  { timeoutMs: 300000 },
);
console.log("exit=" + r.exitCode);
for (const line of r.stdout.split("\n").filter(Boolean)) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { console.log("RAW:", line.slice(0, 140)); continue; }
  const keys = Object.keys(parsed);
  console.log("EVENT:", parsed.type ?? keys.join(","), JSON.stringify(parsed).slice(0, 180));
}
