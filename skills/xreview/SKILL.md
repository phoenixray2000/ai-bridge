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

### 铁律 — GPT is MANDATORY in any gating review while it has quota

A gating review (phase boundary, plan review / Layer 0, critical task, closing gate)
that runs **must include GPT** unless `~/.claude/ai-model` carries `-gpt` (GPT quota
dead). **Single-vendor Gemini is FORBIDDEN as a gate.** Gemini is the *second voice
alongside* GPT (perspective diff), never a substitute for it — a Gemini-only gate
isn't a "lighter" review, it's a broken one that dropped the gold standard.

The one legitimate way to make review lighter is **frequency** — run a gate on fewer
tasks (only critical tasks get task-level review; non-critical rely on the continuous
layer + phase boundary). Lightness is NEVER "swap GPT for cheaper Gemini-only". If
you're tempted to skip GPT to save cost, the correct move is to not run that gate at
all (trust verify), not to run a degraded one. If GPT genuinely has no quota, set
`-gpt` (which swaps to Opus, NOT to Gemini-only) and say so.

An explicit single-vendor argument (`gpt`/`gemini`) is ONLY for an **ad-hoc one-shot
opinion** (`/aibridge:gemini` for a quick second look) — NEVER for a managed gate.
If any gate's panel collapses to one external voice, **say so loudly** and never pass
a single-perspective review off as cross-vendor. Dual-sign evidence relaxes to
whatever vendors ran — but a missing GPT (without `-gpt`) is a defect, not a relaxation.

### When agy (Gemini) fails — DEGRADE, never hammer

agy is flaky (~25% of isolated calls return empty; `ai_exec`/`ai_review` already do a
GENTLE bounded retry internally — 2 attempts, 8s de-clustered backoff). **Keep that one
retry — it recovers most flakes** (the 8s gap keeps it de-clustered, so it does NOT
provoke OAuth; only *clustered* rapid restarts do). ONLY if it STILL fails (result
carries `degrade: true`, i.e. the one retry is exhausted) do you skip Gemini — do
**NOT** re-invoke agy in a loop on top of the internal retry to force a Gemini result:
**clustered agy cold-starts provoke a full browser OAuth `prompt=consent` re-login**
(a Google account-risk-control exposure, observed even with a valid token). Instead
**SKIP the Gemini seat for this round**: run GPT-solo (GPT is the anchor — 铁律 holds),
and **note in the verdict that Gemini was absent this round**. Do NOT spin up a
clean-Opus substitute — that is ONLY for `-gpt` (GPT genuinely dead); when GPT is alive,
GPT-solo is sufficient and a seat-swap arbitration just burns bandwidth. A flake does
NOT advance the round counter — it is the same round, minus Gemini. Losing Gemini's
second voice occasionally is fine; provoking repeated OAuth to keep it is not.

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

### Visual conformance — when a visual contract exists

If the change ships UI and the spec pins a **visual contract** (a demo + load-bearing
visual assertions, see `smart-plan` Phase 1), the review carries an extra dimension:
**does the rendered output honor the demo's load-bearing decisions?** Two levels, by
design (no pixel-diff — brittle, high-noise):
- The **DOM/structural assertions** are the plan's verify job (control exists, section
  order, each state's distinct treatment) — deterministic floor.
- xreview adds the **judgment** the floor can't hold: give the reviewer the demo path +
  the changed UI files + the visual assertions, and ask whether the implementation
  honors the demo's hierarchy / grouping / affordances / state treatments. Findings
  cite the violated **load-bearing** assertion — incidental demo details (placeholder
  text, default colors) are NOT contract and must not be flagged (additive-finding gate
  applies: don't gold-plate against the demo's incidental pixels).
This is the visual analog of catching 假接入: the gate must check the real rendered
outcome against the design intent, not a proxy ("the component file exists").

## Output contract — append to EVERY `ai_review` prompt (canonical, SPOT)

Reviewers (codex/agy) default to chatty, interactive behavior — they ask "shall I
fix this?", request confirmation, or start editing. That breaks the model: the
reviewer's job is to *find*, the orchestrator's job is to *dispatch fixes*. It also
makes evidence files un-gateable. So every `ai_review` prompt — here AND in
`smart-plan` Phase 4 (plan review) — must end with this block, reproduced verbatim:

```
--- OUTPUT CONTRACT (obey exactly) ---
You are a REVIEWER, not an editor. Do NOT modify any code. Do NOT ask questions.
Do NOT request confirmation. Do NOT offer to fix anything — "shall I fix this?" /
"需要我修吗" is FORBIDDEN. The author side dispatches fixes, not you.

Output ONLY these two things, nothing else:
1. A findings list. Each finding as one block:
     [BLOCKER|MAJOR|MINOR] <file>:<line> — <problem> → <concrete fix>
   (No findings is a valid result — then write exactly: No findings.)
   If a finding proposes NEW capability ("also build X"), cite the spec section
   that requires it, or mark it "(grounding: <source>)" — an addition the spec's
   non-goals exclude is NOT a finding, do not raise it.
2. The VERY LAST LINE must be exactly one of:
     VERDICT: GREEN        (no BLOCKER and no MAJOR; MINORs allowed)
     VERDICT: NEEDS-FIX    (at least one BLOCKER or MAJOR)
Nothing may follow the VERDICT line.
```

Severity → verdict is mechanical: any BLOCKER/MAJOR ⇒ `NEEDS-FIX`, else `GREEN`.
The last-line `VERDICT:` token is what makes the evidence file machine-checkable —
the phase gate `check-review-evidence.mjs --verdict-lines` asserts each vendor file
ends with one and fails loudly otherwise. A review whose evidence file has no
terminal `VERDICT:` line is malformed; re-run it, don't hand-summarize. The
orchestrator still arbitrates findings (below) — the reviewer's `VERDICT` is its own
opinion, NOT the final disposition (the gate reports the vendor verdicts; the
`<label>-verdict.md` arbitration record is where GREEN/NEEDS-FIX is *decided*).

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

### Ground every ADDITIVE finding before accepting it

Adversarial review is biased toward *addition* — a reviewer scores by finding more
to do. Most of that is gold: real bugs, fail-loud holes, grounding errors (a plan
referencing code that doesn't exist). Keep all of it. But a finding that proposes
**building something new** ("you should ALSO handle X", "add a Y block/path/layer")
gets one extra gate before it enters the artifact:

- **Is it foreclosed by an existing contract?** Check the spec's non-goals (§非目标)
  and the actual source. If the spec already excluded it, or source already proves
  the premise false → **reject the finding**, cite the spec section / source line.
  Do NOT build it, do NOT let a later round harden it. (This is the one failure mode
  that turns a healthy multi-round review into churn: a reviewer proposed work the
  contract had already answered, and nobody checked the contract for two rounds.)
- **Does it rest on a code belief not yet verified?** Then ground it against source
  *before* accepting — confirm the premise, don't build on the hypothesis.
- **Is it a genuine spec gap** (the spec is wrong/incomplete, only visible now)? Then
  it is a **spec change**, not a plan patch — route it back to clarify (re-open the
  spec), don't improvise new machinery inside the review loop.

Additive findings that survive this gate are real and welcome. The gate is narrow: it
only fires on "add new capability", never on "this existing thing is wrong/unsafe"
(those — the bulk of review value — pass straight through). Removing machinery is
always fine; the gate is asymmetric by design.

### Loop convergence + round accounting (SPOT for any looping gate)

- **GREEN = the latest round's arbitrated findings have no BLOCKER/MAJOR.** Do NOT
  chase findings to zero. Surviving MINORs are recorded and **carried into execution as
  tracked cleanups**, not a barrier to GREEN. This drops the trailing pure-confirmation
  round (`3→3→0`, `1→1→0` tails).
- **A flake is not a round.** An agy empty-stdout retry or a GPT `token_revoked` seat
  handling is resolved WITHIN the current round (retry same round / skip the flaked seat
  per the degrade policy above); only a findings-producing cross-vendor pass advances the
  round counter. Flakes must not inflate the trajectory or the escalation cap.
- **Escalation cap.** At **8 real rounds** without GREEN, STOP and escalate to the user
  for an architectural call — never auto-green a non-converged gate, never grind past it.
