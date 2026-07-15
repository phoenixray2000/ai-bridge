---
name: gemini
description: One-shot direct call to Gemini (via the ai_review_start + ai_job_result MCP tools backed by agy CLI). Use for a standalone cross-vendor second opinion or self-contained task with NO acceptance contract. For bulk-material digestion use the digest skill; for plan-driven tasks use route.
---

# gemini — direct one-shot

A bare call to Gemini for work with no verify/spec-check waiting. Gemini's value
is perspective difference (non-overlapping blind spots) and its independent,
non-bottleneck quota.

## How

- Cross-vendor opinion / generation → `ai_review_start` with
  `vendor: "gemini"` (repo material by reference via `cwd`, or inline a
  repo-less snippet), then collect with `ai_job_result` (long-polls; repeat
  while running, never re-start).
- Effort defaults high; override only on resistance.

Note: agy's piped-stdout flake is handled inside the job (one gentle internal
retry, then a loud degrade error) — you just get the answer or the failure.

## When NOT to use this

- Bulk material to summarize → use `digest` (keeps it out of your context window).
- Output checked against spec/verify → it's a plan task, use `route`.
