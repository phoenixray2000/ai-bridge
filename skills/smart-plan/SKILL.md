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

### When a UI demo / mockup exists — capture it as a VISUAL CONTRACT

A demo carries visual/UX decisions text can't fully hold (hierarchy, which
controls exist, grouping & order, distinct state treatments, affordances). If it
stays a throwaway "reference", the implementer reinterprets the gaps and the
shipped page drifts far from the demo. The fix is SPOT: the demo joins the spec as
an authoritative artifact, not a sketch. So when a demo exists:

1. **Pin the demo by path** in the spec as the authoritative visual source.
2. **Distill its LOAD-BEARING decisions into explicit visual assertions** —
   information hierarchy, which controls exist, grouping/order, each state's
   distinct rendered treatment, key affordances. **Mark each as contract vs.
   illustrative** — incidental choices (placeholder text, lorem, default colors)
   are NOT contract. Asserting the whole demo pixel-for-pixel over-constrains and
   breeds gold-plating churn; the load-bearing assertions are the floor-and-ceiling.
3. These assertions are **checkable** (Phase 2 wires them into verify + xreview),
   which is what makes "looks nothing like the demo" a caught defect rather than a
   silently-shipped one — the visual analog of "verify must prove the JS is really
   wired, not just that the HTML renders".

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
- **When a visual contract exists** (Phase 1): every UI task must carry the relevant
  **load-bearing visual assertions as acceptance criteria**, and its **verify script
  must assert them at the DOM/structural level against the RENDERED output** (parse the
  rendered HTML/DOM: control exists, section order, each state's distinct treatment) —
  NOT a screenshot pixel-diff (brittle), NOT "the component file exists" (that's the
  假接入 proxy). The judgment-level "does it honor the demo's feel" check is xreview's
  visual-conformance dimension, not the plan's verify.
- End the plan with a mandatory **closing gate: whole-implementation xreview** —
  after the last real task, a final cross-vendor review of the ENTIRE plan diff
  (`git diff <plan-base>..HEAD` vs the spec), loop-until-green, before done. This is
  the execution-side mirror of Phase 4 / Layer 0 and catches cross-phase integration
  breaks the per-phase reviews can't (see `route` "Closing gate"). It is a step, not
  a model choice — the planner just writes it in as the terminal gate.
- Receive the spec path + repo context, NOT this session's chat transcript.

## Phase 3 — exit check (orchestrator, mechanical gate)

Accept the subagent's plan and verify: every task has a `complexity` field;
critical tasks carry the flag (→ task-level cross-vendor review); finishing/deletion
tasks reserve their final "whole-repo zero-reference" check for the orchestrator;
**the plan ends with the closing whole-implementation xreview gate**; **if a visual
contract exists, every UI task references its load-bearing assertions and its verify
asserts them at the DOM level**. Missing `complexity`, the closing gate, or (when a
demo exists) the visual-contract wiring → bounce it back. The plan format contract
becomes a gate, not something the author has to remember. This is a *mechanical* check — it does
not read the plan's design judgment. That's Phase 4.

## Phase 4 — plan-level cross-vendor review (Layer 0 of the review architecture)

Intelligence belongs at plan time (methodology P1) — so review value is highest
there too. The plan is the densest-judgment artifact in the whole flow, and until
now it was the *only* one with no cross-vendor pass. A design bug caught here costs
one plan edit; the same bug caught in code costs a rebuilt phase. This is the
earliest, highest-leverage review in the system — one review *track* per plan (not
per task), iterated over rounds until it converges.

**GREEN = the latest round has no BLOCKER/MAJOR** — do NOT chase findings to zero.
MINORs are recorded and carried into execution as tracked cleanups; once no
BLOCKER/MAJOR remain, the plan is executable. The old "loop to 0 findings + a clean
confirmation round" burned a trailing pure-confirmation round (the `3→3→0` / `1→1→0`
tails) — dropped, saving ~1 round per plan (typically 4→3).

**A flake is NOT a round.** An agy empty-stdout retry or a GPT `token_revoked`
seat-handling is retried/handled WITHIN the same round; only a findings-producing
cross-vendor pass advances the round counter. Flakes must not pollute the trajectory
or burn toward the cap.

Round count is not the primary cost signal — the convergence trajectory (below) is —
but pathological churn IS capped: **at 8 real rounds without GREEN, STOP and escalate
to the user** for an architectural call (continue / restructure the spec / abort). The
cap is an **escalation trigger, not an auto-green** — it never ships a worse plan, it
hands judgment to a human (a 13-round churn should hit a mechanism, not grind on).

After the mechanical gate passes, run a cross-vendor review **of the plan itself**:

- **Panel — FIXED external panel, NOT the per-scenario code-review table.** A plan's
  author is ALWAYS the **planner (Opus 4.8 high)**, independent of the execution
  scenario. So the panel does NOT vary by scenario and does NOT borrow code-review's
  "executor's own vendor leaves the panel" logic — that logic is keyed to the *scenario
  executor*, which is irrelevant when the author is always Opus. Mis-applying it drops
  GPT in the gpt scenario — the exact bug this fixes.
  - **Plan-review panel = GPT + Gemini, fixed** — both external to the Opus author =
    maximal independence. **GPT is mandatory** (铁律, see xreview) and is *especially*
    load-bearing here: the only same-family fallback is Opus, which shares the Opus
    planner's blind spots (weak independence). Empirically GPT has solo-caught MAJORs
    that both other voices missed on a plan.
  - **`-gpt` (GPT quota dead)** → Gemini + a clean-window Opus, but **say loudly this
    round is thin on independence**: the Opus reviewer is the SAME family as the Opus
    planner (correlated blind spots), so treat its agreement with caution. Never drop to
    Gemini-only.
  - **Gemini seat = R1 + closing gate only; GPT-solo on middle rounds.** Ledger:
    Gemini's real plan value is narrow (design-eye findings — visual-coverage gaps, CSS
    specificity), while it has produced hallucinated "unimplemented" findings (pure
    arbitration cost), missed BLOCKERs GPT caught, and rogue-edited the tree. So run
    **GPT + Gemini on R1** (design breadth) and again at the **closing gate**; **R2..R(n-1)
    = GPT solo**. GPT-solo is NOT the forbidden Gemini-solo — GPT (the gold standard) is
    present, and GPT-external + the orchestrator two-stage keep cross-vendor perspective;
    full independence is preserved at the two heaviest gates (R1 + endgame), which is enough.
  - **agy flake → SKIP Gemini this round** (GPT anchors, note Gemini absent) — do NOT
    spin up the clean-Opus substitute (that is only for `-gpt`, GPT genuinely dead) and
    do NOT start a seat-swap arbitration to force a Gemini vote. Clustered agy restarts
    provoke a browser OAuth re-consent (see xreview degrade policy); a Gemini flake on
    R1 / closing gate simply runs that round GPT-solo.
- **By reference, never inline** — MCP `ai_review` with `cwd: <repo>`, prompt gives
  the **spec path + plan path** and tells each reviewer to read both from disk and
  critique the plan against the spec. Same anti-truncation discipline as code review.
- **R1 full, R2+ delta.** R1 reviews the whole plan. From R2, review only the **delta**:
  the fixes to the previous round's findings + the plan's changed sections (the plan
  diff since last round). Late-round real catches are regressions / misfixes, which live
  in that delta; full re-reads of unchanged sections are pure cost. (Plan review ONLY —
  the **closing gate stays literal whole-diff**, because *code* fixes regress across
  seams; a *text plan's* sections are modular, so delta is safe here but not there.)
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
  7. **Visual-contract wiring** (only when a demo / visual contract exists) — do the UI
     tasks carry the load-bearing visual assertions as acceptance, and does their verify
     assert them at the DOM level against rendered output (not pixel-diff, not "file
     exists")? A UI plan that will visibly drift from the demo must be caught HERE,
     before code — not after the page ships looking wrong.
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
  **real** round (flakes excluded) appends: round N, findings (count + max severity), and
  **did the architecture settle?** The trajectory is the churn instrument; the 8-round
  escalation cap is the hard backstop behind it. Read it qualitatively: a falling
  max-severity that bottoms at **no BLOCKER/MAJOR is GREEN** (not "count = 0"); a round
  where the count **rises** is fine *if the cause is REMOVING machinery* (a simplification
  touches many sites) but a **warning sign if the cause is ADDING machinery** (review-
  induced scope creep — re-run the additive-finding gate on every new item). "Findings
  9→5→3→2(all MINOR)→GREEN, architecture settled at round 4" is a clean trajectory.
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
