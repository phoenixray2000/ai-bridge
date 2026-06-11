---
name: gemini
description: One-shot direct call to Gemini (via the ai_review MCP tool backed by agy CLI). Use for a standalone cross-vendor second opinion or self-contained task with NO acceptance contract. For bulk-material digestion use the digest skill; for plan-driven tasks use route.
---

# gemini — direct one-shot

A bare call to Gemini for work with no verify/spec-check waiting. Gemini's value
is perspective difference (non-overlapping blind spots) and its independent,
non-bottleneck quota.

## How

- Cross-vendor opinion / generation → MCP `ai_review` with `vendor: "gemini"`,
  material inline in the prompt (the reviewer is filesystem-blind by design).
- Effort defaults high; override only on resistance.

Note: the bridge recovers Gemini's answer through agy's conversation store
(agy's piped-stdout quirk) — that's transparent to you; you just get the answer
or a loud error.

## When NOT to use this

- Bulk material to summarize → use `digest` (keeps it out of your context window).
- Output checked against spec/verify → it's a plan task, use `route`.
