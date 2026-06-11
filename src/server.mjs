#!/usr/bin/env node
// ai-bridge: MCP server exposing GPT (codex CLI) and Gemini (agy CLI) as
// role-shaped tools — review (read-only + evidence), exec (worktree-confined),
// digest (context offload, summary back). See README for the methodology this
// encodes.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callVendor, writeEvidence, embedFiles, assertSafeExecCwd } from "./vendors.mjs";

const server = new McpServer({ name: "ai-bridge", version: "0.1.0" });

const vendorSchema = z.enum(["gpt", "gemini"]);
const effortSchema = z.enum(["low", "medium", "high", "xhigh"]);

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function describeFailure(result) {
  const parts = [`${result.error}`];
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  if (result.stdout) parts.push(`partial stdout:\n${result.stdout}`);
  parts.push(`command: ${result.commandLine}`);
  return textResult(parts.join("\n\n"), true);
}

server.tool(
  "ai_review",
  "Cross-vendor adversarial code review. Sends the prompt (include the full diff " +
    "and spec context inline — the reviewer has NO filesystem access) to GPT (codex) " +
    "or Gemini (agy) and returns the review. Optionally writes the raw output to " +
    "evidence_path for phase-gate verification.",
  {
    vendor: vendorSchema,
    prompt: z.string().describe("Review instructions + full material (diff, spec excerpts) inline"),
    effort: effortSchema.default("high"),
    evidence_path: z.string().optional().describe("Absolute path; raw output is written here for the verify gate"),
  },
  async ({ vendor, prompt, effort, evidence_path }) => {
    const result = await callVendor({ vendor, role: "review", prompt, effort });
    if (!result.ok) return describeFailure(result);
    if (evidence_path) {
      writeEvidence(evidence_path, { vendor, role: "review", effort, commandLine: result.commandLine, output: result.output });
    }
    return textResult(result.output + (evidence_path ? `\n\n[evidence written: ${evidence_path}]` : ""));
  },
);

server.tool(
  "ai_exec",
  "Execute a self-contained implementation task via GPT (codex, workspace-write " +
    "sandbox) or Gemini (agy). The agent gets write access to cwd; cwd must be a " +
    "git repo with a clean working tree (override with allow_dirty). Reference " +
    "plan files by path in the prompt — the agent reads them from disk. Returns " +
    "a session id; pass it as `resume` to continue the same vendor session with " +
    "follow-up instructions (managed-loop fix rounds). For parallel runs against " +
    "the same repo, point cwd at separate worktrees.",
  {
    vendor: vendorSchema,
    prompt: z.string().describe("Complete task instructions from the plan (may reference plan.md by path)"),
    cwd: z.string().describe("Directory the agent may modify (clean git tree unless allow_dirty)"),
    effort: effortSchema.default("medium"),
    resume: z.string().optional().describe("Vendor session id from a previous ai_exec to continue (gpt only)"),
    allow_dirty: z.boolean().default(false).describe("Proceed even if cwd has uncommitted changes / is not a git repo"),
    report_path: z.string().optional().describe("Absolute path; the agent is instructed to write its detailed report here and keep stdout to a short summary"),
  },
  async ({ vendor, prompt, cwd, effort, resume, allow_dirty, report_path }) => {
    try {
      assertSafeExecCwd(cwd, allow_dirty);
    } catch (error) {
      return textResult(String(error?.message ?? error), true);
    }
    let fullPrompt = prompt;
    if (report_path) {
      fullPrompt +=
        `\n\n输出要求：完成后将详细报告（过程、决策、改动说明）写入 ${report_path}；` +
        "你的最终回复只输出 ≤10 行结构化摘要：status / 改动文件列表 / verify 结果 / 遗留问题。";
    }
    const result = await callVendor({ vendor, role: "exec", prompt: fullPrompt, effort, cwd, resume });
    if (!result.ok) return describeFailure(result);
    const sessionLine = result.sessionId ? `\n\n[session: ${result.sessionId}]` : "";
    return textResult(result.output + sessionLine);
  },
);

server.tool(
  "ai_digest",
  "Context offload: digest bulky raw material (logs, dumps, generated code, docs) " +
    "into a summary WITHOUT burning Claude-pool tokens or polluting the orchestrator " +
    "context window. Defaults to Gemini Flash. Pass small file sets via `files` " +
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
    if (!result.ok) return describeFailure(result);
    return textResult(result.output);
  },
);

await server.connect(new StdioServerTransport());
