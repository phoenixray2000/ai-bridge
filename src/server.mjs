#!/usr/bin/env node
// ai-bridge: MCP server exposing GPT (codex CLI) and Gemini (agy CLI) as
// role-shaped tools. review/exec are ASYNC JOBS (start → status/result/cancel):
// a blocking call would tie a 20-40min vendor run to the Claude session's
// lifetime (stdio idle-timeout, session crashes) and a harness retry would
// double-launch agy (clustered cold-starts provoke browser OAuth). Jobs run in
// detached runner processes with all state on disk — they survive session
// death and are recoverable from a fresh session. digest stays synchronous
// (typically well under a minute).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { callVendor, embedFiles, assertSafeExecCwd, DEFAULT_TIMEOUT_MS } from "./vendors.mjs";
import { startJob, readJob, readResult, waitJob, cancelJob, isTerminal, jobsRoot, findRunning, readRequest, listJobs } from "./jobs.mjs";

// Version derives from package.json (single source — release bumps land here too).
const pkg = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
const server = new McpServer({ name: "ai-bridge", version: pkg.version });

const vendorSchema = z.enum(["gpt", "gemini"]);
const effortSchema = z.enum(["low", "medium", "high", "xhigh"]);

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function startedText({ jobId, alreadyRunning }, request) {
  // On an idempotency hit, the params in force are the ORIGINAL job's (a
  // differently-phrased retry may carry e.g. another timeout that is NOT
  // applied — never echo the new request as if it were).
  const shown = alreadyRunning ? (readRequest(jobId) ?? request) : request;
  const lines = [
    alreadyRunning
      ? `job already running (idempotency-key match — NOT relaunched; params below are the ORIGINAL job's): ${jobId}`
      : `job started: ${jobId}`,
    `kind=${shown.kind} vendor=${shown.vendor} effort=${shown.effort} timeout=${Math.round(shown.timeoutMs / 60000)}min`,
  ];
  if (shown.evidence_path) lines.push(`evidence_path: ${shown.evidence_path}`);
  if (shown.report_path) lines.push(`report_path: ${shown.report_path}`);
  lines.push(`next: ai_job_result {"job_id":"${jobId}"} (long-polls; repeat while it reports running)`);
  return textResult(lines.join("\n"));
}

function describeVendorFailure(result) {
  const parts = [`${result.error}`];
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  if (result.stdout) parts.push(`partial stdout:\n${result.stdout}`);
  if (result.commandLine) parts.push(`command: ${result.commandLine}`);
  return parts.join("\n\n");
}

// Job-layer functions THROW on persistent state corruption / lock contention
// (fail loud beats silent double-launch); surface those as tool errors.
const guarded = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (error) {
    return textResult(String(error?.message ?? error), true);
  }
};

function elapsedSeconds(meta) {
  const end = meta.finished_at ? Date.parse(meta.finished_at) : Date.now();
  return Math.max(0, Math.round((end - Date.parse(meta.started_at)) / 1000));
}

function terminalText(meta) {
  if (meta.state === "completed") {
    const result = readResult(meta.id);
    if (!result) return textResult(`job ${meta.id} completed but result.json is missing/torn — re-check ai_job_result once`, true);
    const extras = [];
    if (result.note) extras.push(`[note: ${result.note}]`);
    if (result.sessionId) extras.push(`[session: ${result.sessionId}]`);
    if (meta.evidence_path) extras.push(`[evidence written: ${meta.evidence_path}]`);
    return textResult(result.output + (extras.length ? `\n\n${extras.join("\n")}` : ""));
  }
  if (meta.state === "cancelled") {
    return textResult(`job ${meta.id} was cancelled after ${elapsedSeconds(meta)}s`, true);
  }
  // failed: prefer the structured vendor FAILURE (carries degrade/skip-seat
  // guidance for agy), fall back to the reconciler's error. A result with
  // ok=true here means the runner died between result.json and the completed
  // marker — that's the reconciler's story, not a vendor failure.
  const result = readResult(meta.id);
  const detail = result && result.ok === false
    ? describeVendorFailure(result)
    : (meta.error ?? "unknown failure");
  return textResult(`job ${meta.id} FAILED after ${elapsedSeconds(meta)}s\n\n${detail}`, true);
}

server.tool(
  "ai_review_start",
  "Start a cross-vendor review as a DETACHED background job; returns a job_id " +
    "immediately (collect with ai_job_result). Review is BY REFERENCE: pass cwd = " +
    "the repo; the prompt carries only INSTRUCTIONS + file paths / spec paths — " +
    "NOT inlined code (argv-limit truncation). VENDOR-SPECIFIC diff access: " +
    "vendor=gpt runs git itself from cwd (danger-full-access, live diff range in " +
    "the prompt is fine); vendor=gemini runs headless --sandbox where command " +
    "tools are AUTO-DENIED — its prompt must reference a MATERIALIZED diff FILE " +
    "(git diff <base>..<head> > file) and explicitly forbid running commands, or " +
    "the review dies silently. Omit cwd ONLY for a repo-less snippet inlined in " +
    "the prompt. evidence_path lands the raw output for the phase gate. " +
    "Idempotent: identical params while a job is still running return the ORIGINAL " +
    "job_id (a harness retry never double-launches a vendor).",
  {
    vendor: vendorSchema,
    prompt: z.string().describe("Review instructions + file paths (NOT inlined code, when cwd is set). " +
      "gpt: may include a live diff range to run; gemini: reference a materialized diff file, forbid commands."),
    cwd: z.string().optional().describe("Repo the reviewer reads from (read-only). Omit only for repo-less snippets inlined in the prompt."),
    effort: effortSchema.default("high"),
    evidence_path: z.string().optional().describe("Absolute path; raw output is written here for the verify gate"),
    expect_verdict: z.boolean().default(false)
      .describe("Gate reviews (xreview/smart-plan) MUST pass true: the job only completes if the " +
        "last non-empty output line matches 'VERDICT: GREEN|NEEDS-FIX|RED'; malformed output fails " +
        "the job (evidence still written) instead of completing with garbage. Leave false for " +
        "ad-hoc one-shot opinions."),
    timeout_minutes: z.number().int().min(1).max(240).optional()
      .describe("JOB-LEVEL time budget in minutes (default 25) — retries spend the remainder, never " +
        "restart the clock. Regular phase/plan review: omit. Closing-gate whole-diff: 90. Huge batch " +
        "(≥100 files / ≥50 commits) or irreversible-cutover xhigh: 120-180. When unsure take the larger " +
        "tier — an oversized ceiling costs nothing, an undersized one kills a legitimate long review."),
  },
  guarded(async ({ vendor, prompt, cwd, effort, evidence_path, expect_verdict, timeout_minutes }) => {
    const request = {
      kind: "review", vendor, prompt, cwd, effort, evidence_path, expect_verdict,
      timeoutMs: (timeout_minutes ? timeout_minutes * 60 : DEFAULT_TIMEOUT_MS / 1000) * 1000,
    };
    return startedText(startJob(request), request);
  }),
);

server.tool(
  "ai_exec_start",
  "Start an implementation task as a DETACHED background job; returns a job_id " +
    "immediately (collect with ai_job_result — the completed result carries the " +
    "vendor session id for `resume`). GPT runs codex danger-full-access (the only " +
    "codex mode whose tool launcher works on this Windows setup; the clean-git-tree " +
    "guard is the safety net) — the guard is checked HERE, synchronously, so a " +
    "dirty tree fails fast before any job spawns. Reference plan files by path in " +
    "the prompt. For parallel runs against the same repo use separate worktrees. " +
    "Idempotent: identical params while running return the original job_id.",
  {
    vendor: vendorSchema,
    prompt: z.string().describe("Complete task instructions from the plan (may reference plan.md by path)"),
    cwd: z.string().describe("Directory the agent may modify (clean git tree unless allow_dirty)"),
    effort: effortSchema.default("medium"),
    resume: z.string().optional().describe("Vendor session id from a previous exec job to continue (gpt only)"),
    allow_dirty: z.boolean().default(false).describe("Proceed even if cwd has uncommitted changes / is not a git repo"),
    report_path: z.string().optional().describe("Absolute path; the agent is instructed to write its detailed report here and keep stdout to a short summary"),
    timeout_minutes: z.number().int().min(1).max(240).optional()
      .describe("Vendor kill timer (default 25). Raise for long implementation tasks."),
  },
  guarded(async ({ vendor, prompt, cwd, effort, resume, allow_dirty, report_path, timeout_minutes }) => {
    let fullPrompt = prompt;
    if (report_path) {
      fullPrompt +=
        `\n\n输出要求：完成后将详细报告（过程、决策、改动说明）写入 ${report_path}；` +
        "你的最终回复只输出 ≤10 行结构化摘要：status / 改动文件列表 / verify 结果 / 遗留问题。";
    }
    const request = {
      kind: "exec", vendor, prompt: fullPrompt, cwd, effort, resume, report_path,
      timeoutMs: (timeout_minutes ? timeout_minutes * 60 : DEFAULT_TIMEOUT_MS / 1000) * 1000,
    };
    // Idempotency lookup BEFORE the dirty-tree guard: the original run
    // legitimately dirties the tree, and a harness retry of the same request
    // must map back to that job — not get eaten by the guard.
    const existing = findRunning(request);
    if (existing) return startedText({ jobId: existing.id, alreadyRunning: true }, request);
    try {
      assertSafeExecCwd(cwd, allow_dirty);
    } catch (error) {
      // Race: the original job may have started (and dirtied the tree) between
      // the lookup above and the guard — re-check before surfacing the error,
      // or the retry contract ("identical params return the original job_id")
      // breaks exactly when it matters.
      const raced = findRunning(request);
      if (raced) return startedText({ jobId: raced.id, alreadyRunning: true }, request);
      return textResult(String(error?.message ?? error), true);
    }
    return startedText(startJob(request), request);
  }),
);

// Liveness diagnostics from the runner's progress.json (#4c): last-output age,
// stdout volume, CPU-probe activity, watchdog verdict — the panel that made the
// 85min wedged agy diagnosable only by MANUAL CPU sampling.
function progressText(jobId) {
  let p;
  try {
    p = JSON.parse(readFileSync(path.join(jobsRoot(), jobId, "progress.json"), "utf8"));
  } catch {
    return "";
  }
  const lines = [];
  const age = p.lastOutputAt ? Math.round((Date.now() - Date.parse(p.lastOutputAt)) / 1000) : null;
  lines.push(`last output: ${age === null ? "never" : `${age}s ago`} | stdout: ${p.stdoutBytes ?? 0} bytes | watchdog: ${p.watchdog ?? "off"}`);
  if (p.cpuSamples?.length) {
    lines.push(`cpu samples: ${p.cpuSamples.map((s) => (s.cpuSeconds === null ? "?" : `${Number(s.cpuSeconds).toFixed(1)}s`)).join(" → ")}`);
  }
  return `\n${lines.join("\n")}`;
}

server.tool(
  "ai_job_status",
  "Instant state of a background job: starting/running/completed/failed/cancelled " +
    "+ elapsed seconds + liveness diagnostics (last-output age, stdout bytes, CPU-probe " +
    "watchdog state). A job whose runner died without finishing is reported as " +
    "FAILED here (never eternal 'running'). Works across sessions — jobs live on " +
    `disk (${jobsRoot()}).`,
  { job_id: z.string() },
  guarded(async ({ job_id }) => {
    const meta = readJob(job_id);
    if (!meta) return textResult(`unknown job: ${job_id}`, true);
    return textResult(
      `job ${meta.id}: ${meta.state} (kind=${meta.kind} vendor=${meta.vendor}, elapsed ${elapsedSeconds(meta)}s)` +
        (isTerminal(meta.state) ? "\nnext: ai_job_result to collect the output" : progressText(meta.id)),
    );
  }),
);

server.tool(
  "ai_job_list",
  "List recent background jobs (newest first) — the cross-session recovery path: " +
    "after a session crash/compaction the job_id from the old context is gone, and " +
    "a re-phrased re-send misses the idempotency key and double-launches the vendor. " +
    "FIND the original job here first; collect it with ai_job_result.",
  { limit: z.number().int().min(1).max(100).default(20) },
  guarded(async ({ limit }) => {
    const jobs = listJobs({ limit });
    if (!jobs.length) return textResult(`no jobs under ${jobsRoot()}`);
    const lines = jobs.map((j) => {
      if (j.state === "unreadable") return `${j.id}  UNREADABLE: ${j.error}`;
      const paths = [
        j.evidence_path ? `evidence=${j.evidence_path}` : null,
        j.report_path ? `report=${j.report_path}` : null,
      ].filter(Boolean);
      return `${j.id}  ${j.state}  kind=${j.kind} vendor=${j.vendor} started=${j.started_at}` +
        (j.finished_at ? ` finished=${j.finished_at}` : "") +
        (paths.length ? `\n    ${paths.join(" ")}` : "");
    });
    return textResult(lines.join("\n"));
  }),
);

server.tool(
  "ai_job_result",
  "Collect a job's result, LONG-POLLING up to wait_seconds (default 300 — early " +
    "return makes a large window free for short runs) so a short run completes " +
    "within one call. If still running at the deadline it " +
    "returns a non-error 'running' line — call ai_job_result again (do NOT " +
    "re-start the job; the idempotency key would catch it, but the correct move " +
    "is simply to keep collecting). Terminal results are stable and re-readable " +
    "for 7 days (then garbage-collected; evidence/report files are unaffected): " +
    "completed → the vendor output (+ session id / evidence note); failed → the " +
    "structured failure (agy failures carry the degrade/skip-seat guidance).",
  {
    job_id: z.string(),
    wait_seconds: z.number().int().min(0).max(600).default(300),
  },
  guarded(async ({ job_id, wait_seconds }) => {
    const meta = await waitJob(job_id, wait_seconds * 1000);
    if (!meta) return textResult(`unknown job: ${job_id}`, true);
    if (!isTerminal(meta.state)) {
      return textResult(`job ${meta.id}: still ${meta.state} after ${elapsedSeconds(meta)}s — call ai_job_result again`);
    }
    return terminalText(meta);
  }),
);

server.tool(
  "ai_job_cancel",
  "Cancel a running background job (kills the runner's whole process tree). " +
    "Terminal jobs cannot be cancelled.",
  { job_id: z.string() },
  guarded(async ({ job_id }) => {
    const r = cancelJob(job_id);
    if (!r.ok) return textResult(r.error, true);
    // ok !== "written cancelled": an identity-mismatch cancel reconciles the
    // job as failed instead (runner was already dead) — report the truth.
    return textResult(r.note ? `job ${job_id}: ${r.note}` : `job ${job_id} cancelled`);
  }),
);

server.tool(
  "ai_digest",
  "Context offload: digest bulky raw material (logs, dumps, generated code, docs) " +
    "into a summary WITHOUT burning Claude-pool tokens or polluting the orchestrator " +
    "context window. Defaults to Gemini Flash. SYNCHRONOUS (digests are short); " +
    "review/exec use the async job tools instead. Pass small file sets via `files` " +
    "(contents are embedded; reader gets no fs access) or a directory via `cwd` " +
    "(reader gets read access to that directory). Output should be facts, not judgment.",
  {
    prompt: z.string().describe("What to extract/summarize"),
    files: z.array(z.string()).optional().describe("Absolute file paths to embed into the prompt (≤400KB total)"),
    cwd: z.string().optional().describe("Directory to grant read access for repo-wide scans"),
    vendor: vendorSchema.default("gemini"),
    effort: effortSchema.default("medium"),
  },
  async ({ prompt, files, cwd, vendor, effort }) => {
    let fullPrompt = prompt;
    if (files?.length) {
      let embedded;
      try {
        embedded = embedFiles(files);
      } catch (error) {
        return textResult(String(error?.message ?? error), true);
      }
      fullPrompt = `${prompt}\n\nMaterial follows:\n\n${embedded}`;
    }
    const result = await callVendor({ vendor, role: "digest", prompt: fullPrompt, effort, cwd, family: "flash" });
    if (!result.ok) return textResult(describeVendorFailure(result), true);
    return textResult(result.output);
  },
);

await server.connect(new StdioServerTransport());
