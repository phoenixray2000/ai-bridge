// Smoke test. Offline by default: arg-builder assertions + MCP handshake.
// `--live` additionally fires one real call per vendor (burns a tiny amount of
// GPT + Gemini quota).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  codexArgs, agyArgs, geminiModel, callVendor, parseCodexJson, run,
  isImplausibleRecoveredAnswer, _setRunImplForTests, _setCpuProbeImplForTests,
} from "../src/vendors.mjs";
import {
  startJob, readJob, readResult, waitJob, cancelJob, writeJson, markRunning, markTerminal,
  listJobs, idempotencyKey, _setKillImplForTests,
} from "../src/jobs.mjs";

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

// agy --print-timeout follows the job's kill timer (was a hardcoded 15m that
// silently killed long whole-batch reviews)
assert.equal(reviewRef[reviewRef.indexOf("--print-timeout") + 1], "25m", "default follows DEFAULT_TIMEOUT_MS");
const longReview = agyArgs({ role: "review", prompt: "P", effort: "high", cwd: "D:/repo", timeoutMs: 60 * 60 * 1000 });
assert.equal(longReview[longReview.indexOf("--print-timeout") + 1], "60m");
console.log("ok arg builders");

// --- agy retry/degrade policy (offline — live agy stress is banned) ----------
// Fake runner simulates the observed failure modes; recovery is exercised for
// real (no fresh conversation in the store during the test → it throws → retry).
{
  // Pin the policy knobs (a user env could change attempt counts) and stub the
  // conversation-store recovery (never touch the real AGY_HOME during tests —
  // a concurrent real agy conversation would make recovery "succeed" flakily).
  const savedEnv = { A: process.env.AI_BRIDGE_AGY_ATTEMPTS, B: process.env.AI_BRIDGE_AGY_BACKOFF_MS };
  process.env.AI_BRIDGE_AGY_ATTEMPTS = "2";
  process.env.AI_BRIDGE_AGY_BACKOFF_MS = "0"; // keep the test fast
  const recoveryFails = () => { throw new Error("no conversation (test stub)"); };
  // timeoutMs is now a JOB-LEVEL budget (#5): keep it well above the 60s
  // retry floor so this block tests the RETRY POLICY, not budget exhaustion.
  const base = { vendor: "gemini", role: "review", prompt: "policy-test", effort: "high", timeoutMs: 300_000 };
  const seq = (results) => {
    let i = 0;
    _setRunImplForTests(async () => results[Math.min(i++, results.length - 1)], recoveryFails);
    return () => i;
  };
  const OK = { ok: true, exitCode: 0, stdout: "ANSWER", stderr: "" };
  const EMPTY = { ok: true, exitCode: 0, stdout: "", stderr: "" };
  const TIMEOUT = { ok: false, exitCode: null, stdout: "", stderr: "", timedOut: true };
  const CRASH = { ok: false, exitCode: 1, stdout: "", stderr: "boom" };

  // clean first-attempt success — no retry, no note
  let calls = seq([OK]);
  let r = await callVendor(base);
  assert.ok(r.ok && r.output === "ANSWER" && !r.note && calls() === 1);

  // empty stdout -> recovery fails (no fresh conversation) -> ONE retry -> success
  calls = seq([EMPTY, OK]);
  r = await callVendor(base);
  assert.ok(r.ok && r.output === "ANSWER" && /retry/.test(r.note ?? ""), `retry note missing: ${JSON.stringify(r)}`);
  assert.equal(calls(), 2);

  // both attempts empty -> degrade:true; error instructs SKIP (never seat-swap /
  // clean-Opus — that stale 0.7.3 wording contradicted the skip policy)
  calls = seq([EMPTY, EMPTY]);
  r = await callVendor(base);
  assert.ok(!r.ok && r.degrade === true && /SKIP/.test(r.error), `degrade/skip missing: ${JSON.stringify(r)}`);
  assert.ok(!/clean Opus|seat-swap.*fills/i.test(r.error), "degrade message must not instruct a seat swap");
  assert.equal(calls(), 2, "must stop at maxAttempts (2), never hammer");

  // fast crash IS retryable
  calls = seq([CRASH, OK]);
  r = await callVendor(base);
  assert.ok(r.ok && calls() === 2, "fast crash must retry once");

  // a true TIMEOUT is NOT retried (would burn another print-timeout window)
  calls = seq([TIMEOUT, OK]);
  r = await callVendor(base);
  assert.ok(!r.ok && /timed out/.test(r.error) && calls() === 1, `timeout must not retry: ${JSON.stringify(r)}`);

  _setRunImplForTests(null, null);
  if (savedEnv.A === undefined) delete process.env.AI_BRIDGE_AGY_ATTEMPTS; else process.env.AI_BRIDGE_AGY_ATTEMPTS = savedEnv.A;
  if (savedEnv.B === undefined) delete process.env.AI_BRIDGE_AGY_BACKOFF_MS; else process.env.AI_BRIDGE_AGY_BACKOFF_MS = savedEnv.B;
  console.log("ok agy retry/degrade policy (offline, store-isolated)");
}

// --- job-level time budget + stderr signature + recovery plausibility --------
{
  const savedEnv = { A: process.env.AI_BRIDGE_AGY_ATTEMPTS, B: process.env.AI_BRIDGE_AGY_BACKOFF_MS };
  process.env.AI_BRIDGE_AGY_ATTEMPTS = "2";
  process.env.AI_BRIDGE_AGY_BACKOFF_MS = "0";
  const recoveryFails = () => { throw new Error("no conversation (test stub)"); };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const OK = { ok: true, exitCode: 0, stdout: "ANSWER", stderr: "" };
  const EMPTY = { ok: true, exitCode: 0, stdout: "", stderr: "" };

  // #5 budget: attempt 2 gets the REMAINING budget, never the full amount again
  {
    const seen = [];
    let i = 0;
    const rs = [EMPTY, OK];
    _setRunImplForTests(async (bin, args, opts) => {
      seen.push(opts.timeoutMs);
      await sleep(150);
      return rs[Math.min(i++, rs.length - 1)];
    }, recoveryFails);
    const r = await callVendor({ vendor: "gemini", role: "review", prompt: "budget-1", effort: "high", timeoutMs: 120_000 });
    assert.ok(r.ok && i === 2, `budget retry must still run: ${JSON.stringify(r)}`);
    assert.ok(seen[0] >= 119_000, `attempt 1 gets ~the full budget, got ${seen[0]}`);
    assert.ok(seen[1] < seen[0] && seen[1] > seen[0] - 10_000, `attempt 2 must get the REMAINDER (got ${seen[1]} after ${seen[0]})`);
  }

  // #5 budget: remaining < 60s → no retry, fail with the budget explanation
  {
    let i = 0;
    _setRunImplForTests(async () => {
      i++;
      await sleep(120);
      return EMPTY;
    }, recoveryFails);
    const r = await callVendor({ vendor: "gemini", role: "review", prompt: "budget-2", effort: "high", timeoutMs: 60_050 });
    assert.ok(!r.ok && i === 1, `must not retry on an exhausted budget (attempts=${i}): ${JSON.stringify(r)}`);
    assert.match(r.error, /budget.*exhausted/s);
  }

  // #4/#5: a watchdog kill is a RETRYABLE failure (budget-bounded)
  {
    const WEDGED = { ok: false, exitCode: 1, stdout: "", stderr: "", wedged: true };
    let i = 0;
    const rs = [WEDGED, OK];
    _setRunImplForTests(async () => rs[Math.min(i++, rs.length - 1)], recoveryFails);
    const r = await callVendor({ vendor: "gemini", role: "review", prompt: "wedge-retry", effort: "high", timeoutMs: 300_000 });
    assert.ok(r.ok && i === 2, `wedge kill must retry within budget: ${JSON.stringify(r)}`);
  }

  // #7a: auto-denied signature on stderr → PERMANENT failure, ONE attempt, no recovery
  {
    const DENIED = {
      ok: true, exitCode: 0, stdout: "",
      stderr: 'Error: a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied',
    };
    let i = 0;
    let recoveries = 0;
    _setRunImplForTests(async () => { i++; return DENIED; }, () => { recoveries++; return { answer: "x", source: "db" }; });
    const r = await callVendor({ vendor: "gemini", role: "review", prompt: "denied-1", effort: "high", timeoutMs: 300_000 });
    assert.ok(!r.ok && r.degrade === true, `auto-denied must fail with degrade: ${JSON.stringify(r)}`);
    assert.equal(i, 1, "auto-denied is PERMANENT — exactly one attempt");
    assert.equal(recoveries, 0, "auto-denied must not attempt store recovery");
    assert.match(r.error, /auto-denied/);
    assert.match(r.error, /materialize the diff/i);
  }

  // #7a: the signature is permanent on a NONZERO exit too (same condition,
  // different exit shape) — never a second cold start
  {
    const DENIED_CRASH = {
      ok: false, exitCode: 1, stdout: "",
      stderr: 'a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied',
    };
    let i = 0;
    _setRunImplForTests(async () => { i++; return DENIED_CRASH; }, recoveryFails);
    const r = await callVendor({ vendor: "gemini", role: "review", prompt: "denied-2", effort: "high", timeoutMs: 300_000 });
    assert.ok(!r.ok && r.degrade === true && i === 1, `nonzero-exit auto-denied must be permanent: attempts=${i} ${JSON.stringify(r)}`);
    assert.match(r.error, /auto-denied/);
  }

  // #7b: recovery returning a bare tool token is a recovery FAILURE → retry
  {
    let i = 0;
    const rs = [EMPTY, OK];
    _setRunImplForTests(
      async () => rs[Math.min(i++, rs.length - 1)],
      () => ({ answer: "run_command", source: "db", convId: "t" }),
    );
    const r = await callVendor({ vendor: "gemini", role: "review", prompt: "implausible-1", effort: "high", timeoutMs: 300_000 });
    assert.ok(r.ok && r.output === "ANSWER" && i === 2, `bare-token recovery must be rejected → retry: ${JSON.stringify(r)}`);
    assert.match(r.note ?? "", /retry/);
  }

  // #7b: a plausible recovered answer still recovers (the channel is not dead)
  {
    let i = 0;
    _setRunImplForTests(
      async () => { i++; return EMPTY; },
      () => ({ answer: "This is a real recovered review answer, long enough and with whitespace.", source: "transcript", convId: "t" }),
    );
    const r = await callVendor({ vendor: "gemini", role: "review", prompt: "plausible-1", effort: "high", timeoutMs: 300_000 });
    assert.ok(r.ok && i === 1 && /recovered from transcript/.test(r.note ?? ""), `plausible recovery must work: ${JSON.stringify(r)}`);
  }

  // plausibility floor unit checks
  assert.ok(isImplausibleRecoveredAnswer("run_command"));
  assert.ok(isImplausibleRecoveredAnswer("some_very_long_snake_case_single_token_that_exceeds_forty_characters"));
  assert.ok(isImplausibleRecoveredAnswer(""));
  assert.ok(!isImplausibleRecoveredAnswer("No findings.\nVERDICT: GREEN")); // short but real-shaped (has whitespace, len ok? — whitespace present)
  assert.ok(!isImplausibleRecoveredAnswer("A real answer with spaces that is comfortably long enough to pass the floor."));

  _setRunImplForTests(null, null);
  if (savedEnv.A === undefined) delete process.env.AI_BRIDGE_AGY_ATTEMPTS; else process.env.AI_BRIDGE_AGY_ATTEMPTS = savedEnv.A;
  if (savedEnv.B === undefined) delete process.env.AI_BRIDGE_AGY_BACKOFF_MS; else process.env.AI_BRIDGE_AGY_BACKOFF_MS = savedEnv.B;
  console.log("ok job budget + stderr signature + recovery plausibility (offline)");
}

// --- wedge watchdog (offline: real child processes, fake CPU probe) ----------
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ai-bridge-wd-"));
  const progressEvents = [];
  const onProgress = (p) => progressEvents.push(p);

  // silent vendor + flat CPU → watchdog kills it well before the timeout ceiling
  {
    let probes = 0;
    _setCpuProbeImplForTests(async () => { probes++; return 5; }); // flat CPU
    const teePath = path.join(tmp, "wedge-stdout.log");
    const t0 = Date.now();
    const r = await run(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], {
      timeoutMs: 55_000, teePath,
      watchdog: { silenceMs: 300, probeGapMs: 100, pollMs: 50, onProgress },
    });
    assert.ok(r.wedged === true && r.ok === false, `silent+flat-CPU must be killed as wedged: ${JSON.stringify(r)}`);
    assert.ok(Date.now() - t0 < 30_000, "wedge kill must fire long before the timeout ceiling");
    assert.ok(probes >= 3, `needs 3 samples (2 zero deltas) before the kill, got ${probes}`);
    const wedgedEvent = progressEvents.find((p) => p.watchdog === "wedged");
    assert.ok(wedgedEvent, "progress must record the wedged verdict");
    assert.ok(wedgedEvent.cpuSamples.length >= 2, "progress must carry the CPU samples");
  }

  // vendor that KEEPS TALKING → the probe never starts
  {
    let probes = 0;
    _setCpuProbeImplForTests(async () => { probes++; return 5; });
    const teePath = path.join(tmp, "chatty-stdout.log");
    const r = await run(process.execPath, ["-e", "let n=0; const t=setInterval(()=>{ console.log('tick'+(n++)); if(n>=10){clearInterval(t);} }, 60)"], {
      timeoutMs: 55_000, teePath,
      watchdog: { silenceMs: 400, probeGapMs: 100, pollMs: 50, onProgress },
    });
    assert.ok(r.ok && !r.wedged, `chatty vendor must complete normally: ${JSON.stringify(r)}`);
    assert.equal(probes, 0, "probe must NEVER start while output flows (healthy path is zero-cost)");
    assert.match(readFileSync(teePath, "utf8"), /tick0[\s\S]*tick9/, "stdout must tee to the log file in real time");
  }

  // CPU ALIVE during silence (server-side long thinking) → observed, NOT killed
  {
    let cpu = 0;
    _setCpuProbeImplForTests(async () => { cpu += 3; return cpu; }); // rising CPU
    const r = await run(process.execPath, ["-e", "setTimeout(()=>{ console.log('DONE'); }, 900)"], {
      timeoutMs: 55_000,
      watchdog: { silenceMs: 200, probeGapMs: 80, pollMs: 40, onProgress },
    });
    assert.ok(r.ok && !r.wedged && r.stdout.includes("DONE"), `alive-CPU silence must survive to completion: ${JSON.stringify(r)}`);
  }

  // NEGATIVE CPU delta (a child of the tree exited) is process activity, not
  // death — must back off to observing, never count toward the wedge verdict
  {
    let n = 0;
    _setCpuProbeImplForTests(async () => (n++ % 2 === 0 ? 50 : 20)); // every delta is a big NEGATIVE/positive swing
    const r = await run(process.execPath, ["-e", "setTimeout(()=>{ console.log('SURVIVED'); }, 700)"], {
      timeoutMs: 55_000,
      watchdog: { silenceMs: 150, probeGapMs: 60, pollMs: 30, onProgress },
    });
    assert.ok(r.ok && !r.wedged && r.stdout.includes("SURVIVED"), `negative-delta probe must spare the vendor: ${JSON.stringify(r)}`);
    assert.ok(n >= 2, "probe must actually have sampled");
  }

  _setCpuProbeImplForTests(null);
  rmSync(tmp, { recursive: true, force: true });
  console.log("ok wedge watchdog (silent→killed, chatty→no probe, thinking→spared)");
}

// --- ai_job_list (#1): cross-session discovery ---------------------------------
{
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "ai-bridge-list-"));
  const savedRoot = process.env.AI_BRIDGE_JOBS_ROOT;
  process.env.AI_BRIDGE_JOBS_ROOT = tmpRoot;

  const mk = (id, patch) => {
    mkdirSync(path.join(tmpRoot, id), { recursive: true });
    writeJson(path.join(tmpRoot, id, "job.json"), {
      id, key: `k-${id}`, kind: "review", vendor: "gpt", state: "completed",
      evidence_path: null, report_path: null, finished_at: "2026-07-16T02:00:00.000Z",
      ...patch,
    });
  };
  mk("job-old", { started_at: "2026-07-16T01:00:00.000Z" });
  mk("job-new", { started_at: "2026-07-16T03:00:00.000Z", state: "failed", error: "x" });
  mk("job-mid", { started_at: "2026-07-16T02:00:00.000Z", vendor: "gemini", evidence_path: "D:/ev/mid.md" });

  const all = listJobs({ limit: 20 });
  assert.deepEqual(all.map((j) => j.id), ["job-new", "job-mid", "job-old"], `newest-first ordering broken: ${JSON.stringify(all.map((j) => j.id))}`);
  assert.equal(all[0].state, "failed");
  assert.equal(all[1].vendor, "gemini");
  assert.equal(all[1].evidence_path, "D:/ev/mid.md");
  assert.ok(all.every((j) => "kind" in j && "started_at" in j && "finished_at" in j && "report_path" in j), "list entries must carry the full field set");
  assert.deepEqual(listJobs({ limit: 2 }).map((j) => j.id), ["job-new", "job-mid"], "limit must truncate after sorting");

  if (savedRoot === undefined) delete process.env.AI_BRIDGE_JOBS_ROOT; else process.env.AI_BRIDGE_JOBS_ROOT = savedRoot;
  rmSync(tmpRoot, { recursive: true, force: true });
  console.log("ok ai_job_list (3 fake jobs: order, fields, limit)");
}

// --- idempotency key cross-version stability (#6 fix) -------------------------
{
  const req = { kind: "review", vendor: "gpt", prompt: "key-stability", effort: "high", timeoutMs: 60000 };
  // expect_verdict false/absent must hash byte-identically to a pre-0.14 request
  // (in-flight jobs started by an older server stay recoverable across upgrade)
  assert.equal(idempotencyKey(req), idempotencyKey({ ...req, expect_verdict: false }), "expect_verdict:false must not change the key");
  assert.notEqual(idempotencyKey(req), idempotencyKey({ ...req, expect_verdict: true }), "expect_verdict:true must be a different run");
  console.log("ok idempotency key cross-version stability");
}

// --- async job layer (offline: fake runner under an explicit env gate) -------
{
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "ai-bridge-jobs-"));
  const savedEnv = { R: process.env.AI_BRIDGE_JOBS_ROOT, F: process.env.AI_BRIDGE_ALLOW_FAKE_JOBS };
  process.env.AI_BRIDGE_JOBS_ROOT = tmpRoot;
  process.env.AI_BRIDGE_ALLOW_FAKE_JOBS = "1";

  // 1. start → detached runner completes → result + evidence on disk
  const evidencePath = path.join(tmpRoot, "ev", "fake-review.md");
  const okReq = {
    kind: "review", vendor: "gemini", prompt: "job-test-1", effort: "high",
    evidence_path: evidencePath, timeoutMs: 60000,
    fake: { delayMs: 700, result: { ok: true, output: "FAKE-ANSWER", commandLine: "fake" } },
  };
  const started = startJob(okReq);
  assert.ok(!started.alreadyRunning);
  let meta = await waitJob(started.jobId, 20000);
  assert.equal(meta.state, "completed", `job did not complete: ${JSON.stringify(meta)}`);
  assert.equal(readResult(started.jobId).output, "FAKE-ANSWER");
  assert.ok(existsSync(evidencePath) && readFileSync(evidencePath, "utf8").includes("FAKE-ANSWER"), "runner writes evidence");

  // 2. idempotency: identical params while running → ORIGINAL job, no relaunch;
  //    long-poll before completion reports non-terminal; cancel kills the tree
  const slowReq = {
    kind: "review", vendor: "gemini", prompt: "job-test-slow", effort: "high", timeoutMs: 60000,
    fake: { delayMs: 30000, result: { ok: true, output: "NEVER", commandLine: "fake" } },
  };
  const slow1 = startJob(slowReq);
  const slow2 = startJob(slowReq);
  assert.equal(slow2.jobId, slow1.jobId, "identical params must return the original job");
  assert.ok(slow2.alreadyRunning);
  meta = await waitJob(slow1.jobId, 300);
  assert.ok(meta.state === "starting" || meta.state === "running", "long-poll deadline reports non-terminal state");
  assert.ok(cancelJob(slow1.jobId).ok);
  assert.equal(readJob(slow1.jobId).state, "cancelled");
  assert.ok(!cancelJob(slow1.jobId).ok, "terminal job cannot be cancelled");
  // after cancellation the key is free again → a re-start launches a NEW job
  const slow3 = startJob({ ...slowReq, fake: { delayMs: 0, result: { ok: true, output: "RESTARTED", commandLine: "fake" } } });
  assert.notEqual(slow3.jobId, slow1.jobId);
  await waitJob(slow3.jobId, 20000);

  // 3. cancel is STABLE: the runner (killed or racing) must not flip a
  //    cancelled job back to completed (first terminal writer wins)
  await new Promise((res) => setTimeout(res, 2500));
  assert.equal(readJob(slow1.jobId).state, "cancelled", "terminal state must not be overwritten");

  // 4. CROSS-PROCESS double start: two separate processes released by a go-file
  //    barrier race the same key — the mkdir mutex must hand both the SAME job
  const raceReq = {
    kind: "review", vendor: "gemini", prompt: "job-test-race", effort: "high", timeoutMs: 60000,
    fake: { delayMs: 15000, result: { ok: true, output: "RACE", commandLine: "fake" } },
  };
  const helper = path.join(root, "scripts", "smoke-job-start.mjs");
  const goFile = path.join(tmpRoot, "GO");
  const spawnStart = () => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [helper, JSON.stringify(raceReq)], {
      windowsHide: true,
      env: { ...process.env, AI_BRIDGE_TEST_GO_FILE: goFile },
    });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`helper exit ${code}: ${out}`))));
  });
  const p1 = spawnStart();
  const p2 = spawnStart();
  await new Promise((res) => setTimeout(res, 400)); // both booted, spinning on the barrier
  writeJson(goFile, { go: true });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.jobId, r2.jobId, `cross-process race double-launched: ${r1.jobId} vs ${r2.jobId}`);
  assert.ok(r1.alreadyRunning !== r2.alreadyRunning, "exactly one process must be the creator");
  assert.ok(cancelJob(r1.jobId).ok);

  // 4b. PRE-BOOT cancel: cancel lands before the runner's first heartbeat —
  //     the runner's starting→running CAS must see the terminal state and exit
  //     without executing (no result.json, state stays cancelled)
  const preboot = startJob({
    kind: "review", vendor: "gemini", prompt: "job-test-preboot", effort: "high", timeoutMs: 60000,
    fake: { delayMs: 8000, result: { ok: true, output: "RESURRECTED", commandLine: "fake" } },
  });
  const prebootCancel = cancelJob(preboot.jobId);
  assert.ok(prebootCancel.ok, `early cancel must succeed: ${JSON.stringify(prebootCancel)}`);
  await new Promise((res) => setTimeout(res, 3000)); // give the runner time to boot and (not) run
  const prebootState = readJob(preboot.jobId).state;
  assert.ok(["cancelled", "failed"].includes(prebootState), `runner must not resurrect a cancelled job (got ${prebootState})`);
  assert.equal(readResult(preboot.jobId), null, "early-cancelled job must produce no result");

  // 4c. kill failure must NOT be reported (or persisted) as cancelled
  const killFail = startJob({
    kind: "review", vendor: "gemini", prompt: "job-test-killfail", effort: "high", timeoutMs: 60000,
    fake: { delayMs: 20000, result: { ok: true, output: "X", commandLine: "fake" } },
  });
  await waitJob(killFail.jobId, 4000); // let the runner boot and heartbeat
  _setKillImplForTests(() => ({ ok: false, detail: "stub kill failure" }));
  const failedCancel = cancelJob(killFail.jobId);
  assert.ok(!failedCancel.ok && /kill failed/.test(failedCancel.error), `must refuse to lie: ${JSON.stringify(failedCancel)}`);
  assert.ok(!["cancelled"].includes(readJob(killFail.jobId).state), "state must not read cancelled after a failed kill");
  _setKillImplForTests(null);
  assert.ok(cancelJob(killFail.jobId).ok, "real kill then succeeds");

  // 5. reconcile: non-terminal job with stale heartbeat + expired boot grace →
  //    loud FAILED, not limbo (heartbeat-based: a recycled PID can't fake-alive)
  const deadDir = path.join(tmpRoot, "dead-job-1");
  mkdirSync(deadDir, { recursive: true });
  writeJson(path.join(deadDir, "job.json"), {
    id: "dead-job-1", key: "k", kind: "review", vendor: "gemini",
    state: "running", pid: 4999999, started_at: new Date(Date.now() - 120000).toISOString(),
  });
  writeJson(path.join(deadDir, "heartbeat.json"), { pid: 4999999, at: Date.now() - 120000 });
  meta = readJob("dead-job-1");
  assert.equal(meta.state, "failed");
  assert.match(meta.error, /runner is gone/);

  // 6. path traversal: job ids that escape the jobs root are rejected
  assert.equal(readJob("../../etc/passwd"), null);
  assert.equal(readJob("..\\..\\x"), null);

  // 7. deterministic CAS unit: markRunning against an already-cancelled job is
  //    REFUSED (the pre-boot-cancel e2e above depends on timing; this doesn't)
  const casDir = path.join(tmpRoot, "cas-job-1");
  mkdirSync(casDir, { recursive: true });
  writeJson(path.join(casDir, "job.json"), {
    id: "cas-job-1", key: "cas-key", kind: "review", vendor: "gemini",
    state: "starting", pid: null, started_at: new Date().toISOString(),
  });
  assert.ok(markTerminal("cas-job-1", { state: "cancelled" }).ok);
  const casRefused = markRunning("cas-job-1", 12345);
  assert.ok(!casRefused.ok && casRefused.state === "cancelled", "markRunning must refuse a terminal job");
  assert.equal(readJob("cas-job-1").state, "cancelled", "state must be unchanged after refused markRunning");

  // 7b. STALE heartbeat + LIVE runner (system-sleep scenario): the reconciler
  //     must NOT mark failed while a live process's cmdline references the job
  const sleepJobId = "sleepy-job-1";
  const decoy = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 20000)", sleepJobId], { windowsHide: true });
  const sleepDir = path.join(tmpRoot, sleepJobId);
  mkdirSync(sleepDir, { recursive: true });
  writeJson(path.join(sleepDir, "job.json"), {
    id: sleepJobId, key: "sleepy-key", kind: "review", vendor: "gemini",
    state: "running", pid: decoy.pid, started_at: new Date(Date.now() - 120000).toISOString(),
  });
  writeJson(path.join(sleepDir, "heartbeat.json"), { pid: decoy.pid, at: Date.now() - 120000 });
  assert.equal(readJob(sleepJobId).state, "running", "live runner with a stalled heartbeat must not be reconciled failed");
  decoy.kill();

  // 8. VERDICT exit contract (#6): a gated review that completes WITHOUT a
  //    terminal VERDICT line is a FAILURE (evidence still written), never a
  //    completed job handing garbage downstream ("run_command" incident)
  const malformedEv = path.join(tmpRoot, "ev", "malformed.md");
  const malformed = startJob({
    kind: "review", vendor: "gemini", prompt: "verdict-test-malformed", effort: "high",
    expect_verdict: true, evidence_path: malformedEv, timeoutMs: 60000,
    fake: { delayMs: 0, result: { ok: true, output: "run_command", commandLine: "fake" } },
  });
  meta = await waitJob(malformed.jobId, 20000);
  assert.equal(meta.state, "failed", `malformed gated review must FAIL: ${JSON.stringify(meta)}`);
  assert.match(readResult(malformed.jobId).error, /MALFORMED/i);
  assert.ok(existsSync(malformedEv) && readFileSync(malformedEv, "utf8").includes("run_command"), "evidence must still land for forensics");

  const wellformed = startJob({
    kind: "review", vendor: "gemini", prompt: "verdict-test-wellformed", effort: "high",
    expect_verdict: true, timeoutMs: 60000,
    fake: { delayMs: 0, result: { ok: true, output: "[MINOR] a.mjs:1 — nit → fix\nVERDICT: GREEN\n", commandLine: "fake" } },
  });
  meta = await waitJob(wellformed.jobId, 20000);
  assert.equal(meta.state, "completed", `well-formed gated review must complete: ${JSON.stringify(meta)}`);

  const ungated = startJob({
    kind: "review", vendor: "gemini", prompt: "verdict-test-ungated", effort: "high", timeoutMs: 60000,
    fake: { delayMs: 0, result: { ok: true, output: "just an ad-hoc opinion, no verdict line", commandLine: "fake" } },
  });
  meta = await waitJob(ungated.jobId, 20000);
  assert.equal(meta.state, "completed", "expect_verdict unset → old behavior unchanged");

  // leading whitespace on the VERDICT line is MALFORMED (the contract says
  // the line is exactly `VERDICT: ...`)
  const indented = startJob({
    kind: "review", vendor: "gemini", prompt: "verdict-test-indented", effort: "high",
    expect_verdict: true, timeoutMs: 60000,
    fake: { delayMs: 0, result: { ok: true, output: "findings\n  VERDICT: GREEN", commandLine: "fake" } },
  });
  meta = await waitJob(indented.jobId, 20000);
  assert.equal(meta.state, "failed", "indented VERDICT line must be rejected as malformed");

  // expect_verdict participates in the idempotency key: a gated re-send must
  // NOT dedupe onto a running UNGATED job with the same prompt
  const dedupBase = {
    kind: "review", vendor: "gemini", prompt: "verdict-test-key", effort: "high", timeoutMs: 60000,
    fake: { delayMs: 8000, result: { ok: true, output: "VERDICT: GREEN", commandLine: "fake" } },
  };
  const ungatedRun = startJob(dedupBase);
  const gatedRun = startJob({ ...dedupBase, expect_verdict: true });
  assert.notEqual(gatedRun.jobId, ungatedRun.jobId, "different exit contract must be a different job");
  cancelJob(ungatedRun.jobId);
  cancelJob(gatedRun.jobId);

  // 9. persistently corrupt job.json must THROW (fail loud), never read as
  //    "job absent" — that silent null is exactly what re-launches a vendor.
  //    (Kept LAST: the corrupt dir poisons every later startJob/findRunning scan.)
  const corruptDir = path.join(tmpRoot, "corrupt-job-1");
  mkdirSync(corruptDir, { recursive: true });
  writeFileSync(path.join(corruptDir, "job.json"), "{not json", "utf8");
  assert.throws(() => readJob("corrupt-job-1"), /unreadable job\.json/);

  if (savedEnv.R === undefined) delete process.env.AI_BRIDGE_JOBS_ROOT; else process.env.AI_BRIDGE_JOBS_ROOT = savedEnv.R;
  if (savedEnv.F === undefined) delete process.env.AI_BRIDGE_ALLOW_FAKE_JOBS; else process.env.AI_BRIDGE_ALLOW_FAKE_JOBS = savedEnv.F;
  rmSync(tmpRoot, { recursive: true, force: true });
  console.log("ok async job layer (offline, fake runner)");
}

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
        assert.deepEqual(names, ["ai_digest", "ai_exec_start", "ai_job_cancel", "ai_job_list", "ai_job_result", "ai_job_status", "ai_review_start"]);
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
