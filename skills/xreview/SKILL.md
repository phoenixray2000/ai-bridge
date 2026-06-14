---
name: xreview
description: Cross-vendor adversarial review of a diff. Use at phase boundaries or whenever you want independent outside opinions on a change. Defaults to both vendors (GPT + Gemini) in parallel; pass a single vendor to restrict. Each vendor's raw output lands in its own evidence file; you (orchestrator) arbitrate into a verdict file — vendors never merge each other's findings.
---

# xreview — cross-vendor review

Extra review's value is **perspective difference**, not repetition. The
orchestrator's two-stage review (spec-conformance + code-quality) is always in
play as the continuous layer; xreview adds outside vendors whose blind spots
don't overlap.

## Panel selection — from `~/.claude/ai-model`

The panel is not a separate setting; take it from the routing knob's per-scenario
panel (see the `route` skill's canonical table):

| scenario | panel | with `-gpt` (GPT dead) |
|---|---|---|
| gpt | GPT high + Gemini | (n/a) |
| sonnet | GPT high + Gemini | Gemini + Opus |
| gemini | GPT high + Opus medium | Opus only — thin, **say so** |
| opus | GPT high + Gemini | Gemini + Opus |

**GPT stays in the panel whenever it has quota** — gold-standard reviewer, kept
even in the gpt scenario; Gemini + the orchestrator two-stage supply cross-vendor
coverage and GPT high is added strength (Opus backfill does NOT match it). The
`-gpt` flag swaps GPT's slot for a clean-window **Opus 4.8 medium** subagent
(fresh `model: opus`, own evidence file `<label>-opus.md` — distinct from your
context-saturated orchestrator review). The orchestrator two-stage review is
always on top.

An explicit argument (`gpt`/`gemini`) forces a single vendor for this one run.
If a panel collapses to one external voice, **say so loudly** — never pass a
single-perspective review off as cross-vendor. Dual-sign evidence relaxes to
whatever vendors ran.

## How — review by reference, never inline

For each panel vendor, MCP `ai_review` with:
- `cwd: <repo>` — the reviewer reads files and runs git **itself** from here.
  **Do NOT paste code/diffs into the prompt** — inlining hits the Windows argv
  limit (truncation) and forces lossy trimming. Reference instead.
- `prompt`: instructions + **what to review by reference** — the diff range
  (`git diff <base>..<head>`), the changed file paths, and the spec path. Tell
  the reviewer to read those and review against the spec. It has read-only
  access (codex danger-full-access + git net; agy `--sandbox`).
- `effort` (default high; xhigh for cutover diffs);
- `evidence_path: <repo>/docs/superpowers/reviews/<label>-<vendor>.md` (dual-sign
  = both vendor files must exist for the gate).

Only inline (omit `cwd`) for a standalone snippet that isn't in any repo.

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
fixes dispatch per the current scenario (low-complexity → executor, subtle →
orchestrator direct); false positives are rejected with a written reason (never
accept a cross-vendor finding wholesale — they don't know the repo's conventions).
