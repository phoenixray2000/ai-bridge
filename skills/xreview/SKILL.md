---
name: xreview
description: Cross-vendor adversarial review of a diff. Use at phase boundaries or whenever you want independent outside opinions on a change. Defaults to both vendors (GPT + Gemini) in parallel; pass a single vendor to restrict. Each vendor's raw output lands in its own evidence file; you (orchestrator) arbitrate into a verdict file — vendors never merge each other's findings.
---

# xreview — cross-vendor review

Extra review's value is **perspective difference**, not repetition. The
orchestrator's two-stage review (spec-conformance + code-quality) is always in
play as the continuous layer; xreview adds outside vendors whose blind spots
don't overlap.

## Panel selection

Default: **both** GPT + Gemini, in parallel. Argument `gpt` or `gemini`
restricts to one. The panel must contain at least one **non-executing** vendor —
if the current scenario's executor is GPT, GPT reviewing its own output is
same-source; prefer Gemini-led (or add Opus medium) in that case. The orchestrator
(Claude) review is always present regardless.

## How

For each panel vendor, MCP `ai_review` with:
- the **full diff and spec context inline in the prompt** (reviewer is
  filesystem-blind — it has no repo access by design);
- `vendor` and `effort` (default high; xhigh for cutover diffs);
- `evidence_path: <repo>/docs/superpowers/reviews/<label>-<vendor>.md` so each
  vendor's raw output is captured for the verify gate (dual-sign = both files
  must exist).

Run the panel vendors concurrently (independent MCP calls in one turn).

## Arbitration — yours, never the vendors'

Do NOT ask one vendor to merge the other's findings — merging IS arbitration,
and arbitration is the author side's job (Claude pool). After both return:

1. **Both-flagged** → high confidence, prioritize.
2. **Single-flagged** → normal; this is exactly where perspective difference
   pays — judge each true/false.
3. **Conflicting verdicts** → on a P0-boundary conflict, take the disputed point
   itself to max; arbitrate only the dispute, don't re-review the whole diff.

Write the arbitration to `<repo>/docs/superpowers/reviews/<label>-verdict.md`:
per finding — source / accepted-or-rejected / reason / dispatch target. The
audit chain is complete: two raw opinions + one disposition record. Confirmed
fixes dispatch per the current scenario (mechanical → executor, subtle →
orchestrator direct); false positives are rejected with a written reason (never
accept a cross-vendor finding wholesale — they don't know the repo's conventions).
