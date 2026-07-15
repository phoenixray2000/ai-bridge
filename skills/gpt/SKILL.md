---
name: gpt
description: One-shot direct call to GPT (via the ai_review_start/ai_exec_start + ai_job_result MCP tools backed by codex CLI). Use for a standalone question or task with NO acceptance contract — a quick second opinion, a self-contained lookup, an ad-hoc generation. For plan-driven tasks that need verify + review, use the route skill (managed loop) instead.
---

# gpt — direct one-shot

A bare call to GPT for work that has no verify/spec-check waiting on it. This is
deliberately *not* the managed loop — one question, one answer, done.

## How

- Pure question / generation (no file writes) → `ai_review_start` with
  `vendor: "gpt"` (read-only *intent*; codex runs danger-full-access — the only
  working mode on Windows — with git as the safety net), then collect with
  `ai_job_result` (long-polls 120s; a short call usually completes in one
  collect — repeat while it reports running, never re-start). Repo material
  goes **by reference**: pass `cwd` + paths, never inline files (argv
  truncation); inline only a repo-less snippet.
- Needs to write files → `ai_exec_start` with `vendor: "gpt"`, `cwd` set, and
  the dirty-tree guard applies (commit first or pass `allow_dirty`); collect
  the same way.

Effort defaults: review high, exec medium. Override only on resistance.

## When NOT to use this

If the output will be checked against a spec or run through verify, it's a plan
task — use `route` so it goes through the managed loop (dispatch → verify →
review → arbitrate → resume). The presence of an acceptance contract is the line
between this skill and `route`.
