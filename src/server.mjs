#!/usr/bin/env node
// ai-bridge: MCP server exposing GPT (codex CLI) and Gemini (agy CLI) as
// role-shaped tools — review (read-only + evidence), exec (worktree-confined),
// digest (context offload, summary back). See README for the methodology this
// encodes.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callVendor, writeEvidence, embedFiles } from "./vendors.mjs";

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
    "sandbox) or Gemini (agy). cwd MUST be an isolated worktree — the agent gets " +
    "write access there. Use for mechanical tasks whose plan already contains the " +
    "complete code and verify steps.",
  {
    vendor: vendorSchema,
    prompt: z.string().describe("Complete task instructions from the plan"),
    cwd: z.string().describe("Isolated worktree directory the agent may modify"),
    effort: effortSchema.default("medium"),
  },
  async ({ vendor, prompt, cwd, effort }) => {
    const result = await callVendor({ vendor, role: "exec", prompt, effort, cwd });
    if (!result.ok) return describeFailure(result);
    return textResult(result.output);
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
