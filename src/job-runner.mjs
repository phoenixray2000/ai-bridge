#!/usr/bin/env node
// Detached job runner: executes ONE vendor call described by <jobDir>/request.json
// and leaves every trace on disk (job.json state, result.json, runner.log,
// heartbeat.json). It has NO live link to the MCP server that spawned it — the
// server (or a server in a brand-new session) reads the job dir. All vendor
// behavior (codex --json parsing, agy gentle retry/degrade, evidence writing)
// stays in vendors.mjs; this file is only the detached harness around callVendor.
//
// Protocol (see jobs.mjs header): job.json is server-written once before spawn
// and runner-owned afterwards; liveness is the 5s heartbeat (bare PID would
// fake-alive after PID recycling); terminal transitions go through
// markTerminal — first writer wins, so a completed job can't be overwritten by
// a late cancel or vice versa.
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { callVendor, writeEvidence } from "./vendors.mjs";
import { writeJson, markTerminal, markRunning } from "./jobs.mjs";

const jobDirArg = process.argv[2];
if (!jobDirArg) {
  process.exit(2);
}
const jobId = path.basename(jobDirArg);
const log = (line) => {
  try {
    appendFileSync(path.join(jobDirArg, "runner.log"), `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    /* logging must never kill the run */
  }
};

const beat = () => {
  try {
    writeJson(path.join(jobDirArg, "heartbeat.json"), { pid: process.pid, at: Date.now() });
  } catch {
    /* a missed beat is tolerated; the freshness window is 30s */
  }
};

async function main() {
  const request = JSON.parse(readFileSync(path.join(jobDirArg, "request.json"), "utf8"));
  beat();
  const heartbeat = setInterval(beat, 5000);
  // Lock-guarded CAS: a cancel that landed before this boot wins — exit
  // without touching the vendor (an unconditional write would resurrect it).
  const started = markRunning(jobId, process.pid);
  if (!started.ok) {
    clearInterval(heartbeat);
    log(`not starting: ${started.error}`);
    return;
  }
  log(`running: kind=${request.kind} vendor=${request.vendor} effort=${request.effort}`);

  try {
    let result;
    if (request.fake && process.env.AI_BRIDGE_ALLOW_FAKE_JOBS === "1") {
      // Offline-test hook (mirrors vendors.mjs _setRunImplForTests): honored only
      // under an explicit env gate so production requests can never fake a run.
      await new Promise((res) => setTimeout(res, request.fake.delayMs ?? 0));
      result = request.fake.result;
    } else {
      result = await callVendor({
        vendor: request.vendor,
        role: request.kind,
        prompt: request.prompt,
        effort: request.effort,
        cwd: request.cwd,
        family: request.family,
        resume: request.resume,
        timeoutMs: request.timeoutMs,
        // diagnostics: vendor output tees to stdout.log; the wedge watchdog's
        // milestones land in progress.json (surfaced by ai_job_status)
        teePath: path.join(jobDirArg, "stdout.log"),
        onProgress: (p) => {
          try {
            writeJson(path.join(jobDirArg, "progress.json"), p);
          } catch {
            /* diagnostics must never kill the run */
          }
        },
      });
    }

    // Evidence lands BEFORE the verdict-contract check below — a malformed
    // review still leaves its raw output on disk for forensics.
    if (result.ok && request.evidence_path) {
      writeEvidence(request.evidence_path, {
        vendor: request.vendor,
        role: request.kind,
        effort: request.effort,
        commandLine: result.commandLine,
        output: result.output,
      });
    }

    // VERDICT exit contract (review gates): exit 0 + non-empty is NOT proof of
    // a review — batch-E marked the literal token `run_command` as completed.
    // A gated review must END with a machine-checkable verdict line, or it is
    // a FAILURE, never a completed job handing garbage to the arbitration.
    if (result.ok && request.expect_verdict) {
      // Last non-empty line, RAW except the trailing EOL: the contract says the
      // line is exactly `VERDICT: ...` — leading whitespace is malformed too.
      const last = String(result.output ?? "")
        .split(/\r?\n/)
        .reverse()
        .find((l) => l.trim() !== "")
        ?.replace(/\s+$/, "") ?? "";
      if (!/^VERDICT: (GREEN|NEEDS-FIX|RED)$/.test(last)) {
        result = {
          ok: false,
          commandLine: result.commandLine,
          error:
            `review output is MALFORMED: expect_verdict requires the last non-empty line to match ` +
            `"VERDICT: GREEN|NEEDS-FIX|RED", got: "${last.slice(0, 120)}". The output was NOT accepted as a review.` +
            (request.evidence_path ? ` Raw output kept at ${request.evidence_path} for forensics.` : "") +
            ` Re-run with the OUTPUT CONTRACT appended to the prompt; for Gemini/agy, reference a materialized diff file and forbid running commands.`,
        };
      }
    }
    // result.json MUST land before the completed marker — a job may never read
    // as completed with no result (writeJson throws on final failure and the
    // catch below marks the job failed instead).
    writeJson(path.join(jobDirArg, "result.json"), result);
    const marked = markTerminal(jobId, { state: result.ok ? "completed" : "failed" });
    log(`terminal: ${result.ok ? "completed" : "failed"} (markTerminal ok=${marked.ok}${marked.ok ? "" : `, ${marked.error}`})`);
  } finally {
    clearInterval(heartbeat);
  }
}

main().catch((error) => {
  log(`fatal: ${error?.stack ?? error}`);
  try {
    writeJson(path.join(jobDirArg, "result.json"), { ok: false, error: String(error?.message ?? error) });
  } catch {
    /* the terminal marker below still carries the error */
  }
  try {
    markTerminal(jobId, { state: "failed", error: String(error?.message ?? error) });
  } catch {
    /* reconciler will surface it via the dead heartbeat */
  }
  process.exit(1);
});
