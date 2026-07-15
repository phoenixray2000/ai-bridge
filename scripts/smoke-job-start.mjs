// Test helper for smoke.mjs: one startJob call in a SEPARATE process, so the
// cross-process idempotency claim (mkdir key mutex) is exercised for real.
// Reads the request JSON from argv[2]; prints the startJob result as JSON.
// If AI_BRIDGE_TEST_GO_FILE is set, spins until that file exists first — a
// start barrier so two contenders hit the check-then-create window together.
import { existsSync } from "node:fs";
import { startJob } from "../src/jobs.mjs";

const goFile = process.env.AI_BRIDGE_TEST_GO_FILE;
if (goFile) {
  const deadline = Date.now() + 10_000;
  while (!existsSync(goFile)) {
    if (Date.now() > deadline) throw new Error("go-file barrier timeout");
  }
}
const request = JSON.parse(process.argv[2]);
const result = startJob(request);
console.log(JSON.stringify(result));
