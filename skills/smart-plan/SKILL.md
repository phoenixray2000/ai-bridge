---
name: smart-plan
description: Write an implementation plan with the correct model binding AND cross-vendor design review. Use whenever you're about to write a plan from a spec. Clarification stays in the orchestrator session; DRAFTING is forced onto the planner-role subagent (Opus 4.8 high); the draft is then gated by a mechanical route-fields check AND a cross-vendor plan review (Layer 0) across 6 design dimensions before any task dispatches. This catches design bugs at plan-edit cost, before they compound into code.
---

# smart-plan — model-bound planning

`superpowers:writing-plans` governs HOW a plan is written but not WHO writes it.
Invoked bare from an Opus session, the plan gets written by Opus — violating the
methodology's most expensive rule (spec/plan/arch must be the planner model,
currently Opus 4.8 high — Fable retired) and producing a plan with no route fields. This skill closes
both holes.

## Phase 1 — clarify (stays in orchestrator, current session)

Align scope with the user, read the spec, gather context. This is
conversation-dense, not intelligence-dense — keep it here. Converge the
discussion into a written spec/decision doc; **the spec file is the handoff
artifact, not the chat history**. If the eventual drafting brief can't be
covered by the spec, the spec is incomplete — go back and fill it, don't try to
ferry "the discussion" to the subagent.

## Phase 2 — draft (forced onto the planner model)

Dispatch an Agent as the **planner** role — see the role→model table in the
`route` skill for the current assignment (now **`model: opus`**; Fable retired,
reassigned to Opus 4.8 with a one-tier bump). Trigger high-tier thinking in the
subagent prompt (e.g. "ultrathink") to honor the planner's high tier, since the
Agent tool has no separate effort knob. The subagent prompt must:
- If `superpowers:writing-plans` is available, instruct the subagent to invoke
  it first and follow its discipline. Otherwise use the built-in plan format.
- Require **every task to carry a `complexity` field (`low` | `high`)** plus an
  optional **`critical`** flag — set it when the task is *irreversible* (cutover /
  delete / storage write-migration) OR *foundational* (high blast radius: later
  tasks depend on it). These are two orthogonal axes — a task can be `low` +
  `critical`. NOT a hardcoded model name — the model is resolved at execution time
  by `route` × current scenario × complexity. The one explicit exception: an
  irreversible-cutover pre-flight audit may pin `Opus max` in the step.
- Keep **phases small** — the phase-boundary cross-vendor review is the quality
  catch-all for non-critical tasks; small phases make it fire while work is fresh.
- Receive the spec path + repo context, NOT this session's chat transcript.

## Phase 3 — exit check (orchestrator, mechanical gate)

Accept the subagent's plan and verify: every task has a `complexity` field;
critical tasks carry the flag (→ task-level cross-vendor review); finishing/deletion
tasks reserve their final "whole-repo zero-reference" check for the orchestrator.
Missing `complexity` → bounce it back. The plan format contract becomes a gate, not
something the author has to remember. This is a *mechanical* check — it does not
read the plan's design judgment. That's Phase 4.

## Phase 4 — plan-level cross-vendor review (Layer 0 of the review architecture)

Intelligence belongs at plan time (methodology P1) — so review value is highest
there too. The plan is the densest-judgment artifact in the whole flow, and until
now it was the *only* one with no cross-vendor pass. A design bug caught here costs
one plan edit; the same bug caught in code costs a rebuilt phase. This is the
earliest, highest-leverage review in the system — one review *track* per plan (not
per task), iterated over rounds until it converges.

**Round count is NOT the cost signal — convergence is.** A genuinely intricate plan
(exact reconciliation, multi-provider invariants, hard-cut schema) legitimately needs
several rounds and earns its keep catching ~dozens of real design bugs before any
code exists; that depth is proportional, not waste. So there is **no round cap** (a cap
would cut off a hard plan before its architecture settles and ship something worse).
The guard against churn is the convergence trajectory (below) + the additive-finding
gate — not a limit on rounds.

After the mechanical gate passes, run a cross-vendor review **of the plan itself**:

- **Panel** — identical derivation to code `xreview`: take it from `~/.claude/ai-model`
  (route's canonical per-scenario panel; `-gpt` swaps GPT's slot for a clean-window
  Opus medium). No new panel logic. Do NOT duplicate the table — defer to `route`.
- **By reference, never inline** — MCP `ai_review` with `cwd: <repo>`, prompt gives
  the **spec path + plan path** and tells each reviewer to read both from disk and
  critique the plan against the spec. Same anti-truncation discipline as code review.
- **Output contract** — append the SAME block defined in `xreview` ("Output
  contract", SPOT) to every plan-review prompt: findings only
  (`[BLOCKER|MAJOR|MINOR] <file>:<line> — <problem> → <fix>`), no questions / no
  offer-to-fix, last line `VERDICT: GREEN` or `VERDICT: NEEDS-FIX`. For a plan the
  `<file>:<line>` points at the plan/spec location (task name or section).
- **Plan-review dimensions** (distinct from code review — these check *design*, not
  implementation):
  1. **Decomposition & sequencing** — phases right-sized? dependency order sound?
     any task depend on an earlier task's output it can't have yet?
  2. **Completeness *w.r.t. the spec's 目标*** — tasks/edge-cases/rollbacks the spec
     REQUIRES but the plan missed. Anchor to the spec, not to some absolute ideal —
     "complete" means covers the spec's goals, NOT "everything one could imagine
     building". A gap the spec asked for is a finding; a capability beyond the spec is
     not (see the additive-finding gate below).
  3. **Route-field honesty (meta-review)** — is each `complexity` rated truthfully?
     are `critical` flags right (no irreversible / foundational task left unflagged)?
     This is the one place the routing *inputs* themselves get audited.
  4. **Interface / contract soundness** — for foundational tasks, is the interface
     they establish actually right? Everything downstream compounds on it; this is
     the single highest-leverage thing to get correct.
  5. **Verify-contract adequacy** — does every task carry a real acceptance contract
     (verify + spec check)? A task with no verify can't run the managed loop.
  6. **Spec alignment** — does the plan implement the spec, or did the planner drift?
- **Evidence + arbitration** — each vendor's findings land in
  `<repo>/docs/superpowers/reviews/plan-<name>-<vendor>.md`; **you (orchestrator)
  arbitrate** into `plan-<name>-verdict.md` — never ask one vendor to merge the
  other's. Same rule as code xreview: cross-vendor reviewers don't know the repo's
  intent, so disposition is the author side's (Claude pool) call. Apply the **ground-
  every-additive-finding gate** (`xreview` arbitration, SPOT): a finding proposing NEW
  capability is rejected if the spec's 非目标 or source already forecloses it — the one
  failure mode that turns a healthy multi-round review into churn (a reviewer proposes
  spec-excluded work, nobody checks the contract, later rounds harden it).
- **Verdict must record the convergence trajectory.** In `plan-<name>-verdict.md`, each
  round appends: round N, findings (count + max severity), and **did the architecture
  settle?** This is the real churn instrument (not a round cap). Read it qualitatively:
  a falling count that bottoms at 0 is healthy convergence; a round where the count
  **rises** is fine *if the cause is REMOVING machinery* (a simplification touches many
  sites) but a **warning sign if the cause is ADDING machinery** (review-induced scope
  creep — re-run the additive-finding gate on every new item). "Findings 9→5→3→5→2→0,
  architecture settled at round 4" is a clean trajectory; the round-4 bump was a
  removal.
- **On red** — a confirmed design flaw goes back to the **planner** role (Opus 4.8
  high) to revise; a deep architectural dispute stays with the **orchestrator**
  (open-ended arbitration never leaves the orchestrator). Re-review the revision.
  Loop until green **before any execution dispatch** — the plan does not enter the
  managed loop until Layer 0 is clean.
- **Clean terminal artifact (SPOT).** The plan converges to a clean terminal state;
  the round-by-round history lives in `plan-<name>-verdict.md`, **NOT** inside the plan.
  A plan must not accumulate "added X then removed X" archaeology — that leaks the
  review loop into the deliverable and buries what the implementer must build. On
  green, the handoff is a clean plan + the separate verdict trail.
