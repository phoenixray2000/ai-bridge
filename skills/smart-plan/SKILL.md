---
name: smart-plan
description: Write an implementation plan with the correct model binding AND cross-vendor design review. Use whenever you're about to write a plan from a spec. Clarification stays in the orchestrator session; DRAFTING is forced onto the planner-role subagent (Opus 4.8 high); the draft is then gated by a mechanical route-fields check AND a cross-vendor plan review (Layer 0) before any task dispatches. This catches design bugs at plan-edit cost, before they compound into code.
---

# smart-plan — model-bound planning

A plan drafted casually in the session has the wrong author (the planner role
exists for a reason) and no route fields. This skill closes both holes.
*Rationale/history: `docs/model-selection-methodology.md`. Skills are the
behavioral SPOT; on conflict, skills win.*

## Phase 1 — clarify (orchestrator, current session)

Align scope, read the spec, gather context — conversation-dense, keep it here.
Converge into a written spec/decision doc: **the spec file is the handoff
artifact, not the chat history**. If the drafting brief can't be covered by the
spec, the spec is incomplete — fill it, don't ferry "the discussion".

### Requirements not converged → grill, then WRITE BACK

- No shared understanding yet → run `/grilling`: interview the user **one
  question at a time**; anything answerable from the codebase, answer from the
  codebase instead of asking.
- **Convergence = write-back.** Every resolved question lands as a decision
  line in the spec (decision + one-line why; overturned alternatives get an
  "excluded: <reason>" line so later review rounds can't relitigate them). An
  unwritten decision is a LOST decision — the planner never sees this chat
  (Phase 2), so the failure mode is silent loss, not a loud error.
- **The user confirms the updated spec (show the spec diff), not the chat.**
  Their memory of the answers is minutes old — a missing line is caught now or
  never.

### When a UI demo / mockup exists — capture it as a VISUAL CONTRACT

A demo carries visual/UX decisions text can't hold; left as a throwaway
reference, the shipped page drifts. So:
1. **Pin the demo by path** in the spec as the authoritative visual source.
2. **Distill its LOAD-BEARING decisions into explicit assertions** — hierarchy,
   which controls exist, grouping/order, each state's distinct treatment,
   affordances. **Mark contract vs. illustrative** — incidental choices
   (placeholder text, default colors) are NOT contract; whole-demo
   pixel-assertion over-constrains and breeds gold-plating.
3. Phase 2 wires these into verify + xreview, making visual drift a caught
   defect (the visual analog of "verify the JS is wired, not that HTML renders").

## Phase 2 — draft (forced onto the planner model)

Dispatch an Agent as the **planner** role (`route` role table; now
`model: opus`) with high-tier thinking ("ultrathink"). The subagent prompt must:
- Use the built-in plan format (self-contained, no external skill). The plan
  is a FILE in the repo — `docs/plans/<name>.md` unless the user pins another
  path (Phase 4 reviews it by reference). Header = spec path + plan-base
  commit + the spec's GLOBAL CONSTRAINTS (redlines, platform limits — tasks
  are dispatched verbatim, so constraints not in the plan never reach the
  executor); tasks grouped into phases; each code task carries a goal,
  `file:line`/symbol anchors, steps exact enough for a clean-window executor
  (`low` tasks: the complete code/commands — route's low leg assumes the plan
  already decided everything; no "add validation"-style placeholders; `high`
  tasks may leave NAMED on-site decisions), a runnable **verify** (command +
  expected observable), an **acceptance check** — the spec clause it satisfies
  PLUS the observable that proves that clause holds (a section number alone is
  not decidable; verify + acceptance is the contract the managed loop runs
  on) — and a closing **commit step** (green → commit that task's changes,
  staging only related files; an uncommitted task trips the next `ai_exec_start`'s
  dirty-tree guard and escapes the closing gate's `<plan-base>..HEAD` range).
  **Read-only tasks** (reality-premise grounding, audits) carry command +
  expected evidence as their verify and explicitly SKIP the execution
  contract's TDD steps and the commit step — nothing changes, nothing commits.
- **Every task carries `complexity` (`low`|`high`)** + optional **`critical`**
  (irreversible: cutover/delete/storage write-migration; OR foundational: later
  tasks depend on it). Orthogonal — `low`+critical is legal. NO hardcoded model
  names (resolved at execution by `route` × scenario × complexity); the one
  exception: an irreversible-cutover pre-flight audit may pin `Opus max`.
- **A `critical` task MUST be isolated into its OWN phase.** No per-task
  cross-vendor review exists anymore; a critical task's early coverage comes
  from its own phase's boundary review, firing **before any consumer wires in**
  (catches type-correct-but-semantically-wrong interfaces the compiler can't).
  Never bury a critical task in a multi-task phase.
- **Keep phases small — hard cap 8 tasks per phase.** Phase-boundary review is
  the ONLY execution-stage cross-vendor layer; with no per-task review beneath
  it, an oversized phase turns its gate into a huge-batch review (multi-round
  blowup, 60min+ vendor runs). More than 8 tasks → split the phase; likewise
  split when a phase's expected diff would exceed ~100 files.
- **When a visual contract exists**: every UI task carries the relevant
  load-bearing assertions as acceptance, and its verify asserts them at the
  **DOM/structural level against RENDERED output** — not a pixel-diff (brittle),
  not "the component file exists" (假接入 proxy). The judgment-level check is
  xreview's visual-conformance dimension.
- **Ground every REALITY PREMISE with an on-site check task.** A reality premise
  = a load-bearing assumption NOT legible in the code being changed, which a
  synthetic fixture passes GREEN on regardless ("table X is populated", "the
  only consumer of Y is Z", "the build chain includes P"). Each gets an explicit
  grounding step **before** the dependent work, whose verify reads the **real
  authority** (read-only prod query / whole-repo consumer grep / toolchain
  check) — not a fixture, not the author's belief. (Execution-side mirror:
  `route` Reality gate.)
- End the plan with the mandatory **closing gate** step: whole-implementation
  xreview of the entire plan diff, loop-until-green (see `route` Closing gate).
- Receive the spec path + repo context, NOT this session's chat transcript.

## Phase 3 — exit check (orchestrator, mechanical gate)

Bounce the plan back if any of these is missing:
- the built-in format's required fields: the plan file exists non-empty at
  its pinned path; header has spec path + plan-base commit + the spec's
  global constraints; every task sits
  in a phase and has a goal, anchors, executor-ready steps, a runnable verify
  (command + expected observable), an acceptance check (spec clause + proving
  observable), and a commit step (read-only tasks: command + expected
  evidence instead, TDD/commit exempt) — a missing plan-base also breaks the
  closing gate's whole-diff range;
- every task has `complexity`;
- **every `critical` task sits in its own phase**;
- **no phase exceeds 8 tasks** (Phase-2 hard cap);
- finishing/deletion tasks reserve the final "whole-repo zero-reference" check
  for the orchestrator;
- the plan ends with the closing whole-implementation xreview gate;
- visual contract exists → every UI task references its assertions + DOM-level
  verify;
- every reality premise has a grounding step placed before its dependent task.

Mechanical only — design judgment is Phase 4.

## Phase 4 — plan-level cross-vendor review (Layer 0)

The plan is the densest-judgment artifact; a design bug caught here costs one
plan edit vs a rebuilt phase. One review *track* per plan, iterated to
convergence. **Convergence/round accounting: xreview「Loop convergence」(SPOT)**
— GREEN = latest round has no BLOCKER/MAJOR (MINORs carry into execution);
flakes don't advance rounds; 8 real rounds without GREEN → stop and escalate to
the user.

- **Panel — FIXED external panel, NOT route's per-scenario table.** The plan's
  author is ALWAYS the planner (Opus), independent of scenario — executor-keyed
  panel logic drops GPT in the gpt scenario (a real bug). Panel = **GPT +
  Gemini, GPT mandatory** (铁律; GPT is especially load-bearing here — the only
  same-family fallback shares the Opus planner's blind spots, and GPT has
  solo-caught MAJORs both other voices missed).
  - `-gpt` (quota dead) → Gemini + clean-window Opus, **flag the round as thin
    on independence** (Opus reviewer = author's family). Never Gemini-only.
  - **Gemini seat = each gate's FIRST round only — xreview「Seat cadence」
    (SPOT, incl. the `-gpt` exception)**; here that means plan-track R1 and
    the closing gate's R1. (Gemini's plan value is narrow — design-eye
    findings — against a ledger of hallucinated findings, missed BLOCKERs,
    rogue edits. The anchor seat alone is NOT the forbidden Gemini-solo: the
    gold standard is present; independence is preserved at the heaviest
    gates' first look.)
  - **agy flake** → one internal retry happens inside the review job; if it still
    fails, skip Gemini this round and note the absence — who carries the round
    is xreview's degrade policy (SPOT), never restated here. Never loop agy,
    never seat-swap.
- **By reference, async** — `ai_review_start` with `cwd`, prompt gives spec
  path + plan path; reviewers read from disk, **`expect_verdict: true`** (gate
  call — malformed output must fail the job, not reach arbitration). The
  **Gemini seat's prompt must forbid running commands**(「只读文件,禁跑任何
  命令——沙箱 auto-deny」): agy reviews headless `--sandbox`, command tools are
  auto-denied; anything it needs (plan, spec, the closing gate's materialized
  diff) must exist AS A FILE — materialize a diff with `git diff --output=docs/reviews/<label>-diff.txt ...`
  (never shell `>` — PS5.1 re-encodes to UTF-16; ensure `docs/reviews` exists
  first, `--output` does not create directories)
  if the round reviews changes, and delete it after the round (xreview
  Gemini-seat rule; GPT seat unchanged — it runs git itself). Start the
  round's seated vendors (Seat cadence, SPOT), collect each with
  `ai_job_result` (repeat while running — never re-start; lost job_id after
  a crash → `ai_job_list`).
- **R1 full, R2+ delta.** R1 reviews the whole plan; from R2 review only the
  fixes to the previous round's findings + the plan's changed sections. (Plan
  review only — the closing gate stays literal whole-diff: code regresses
  across seams, a text plan's sections are modular.)
- **Output contract** — append xreview's verbatim block (SPOT) to every prompt;
  for a plan, `<file>:<line>` points at the plan/spec location.
- **Dimensions** (design, not implementation):
  1. **Decomposition & sequencing** — phases right-sized, dependency order sound?
  2. **Completeness w.r.t. the spec's 目标** — gaps the spec REQUIRES; a
     capability beyond the spec is NOT a finding (additive gate).
  3. **Route-field honesty + critical phase-isolation** — `complexity` truthful?
     `critical` flags right? **every critical task in its own phase?** (buried
     critical = BLOCKER-class finding — the sole early-coverage mechanism).
  4. **Interface / contract soundness** — foundational tasks' interfaces right?
     Everything downstream compounds on them.
  5. **Verify-contract adequacy** — every task has a real verify + spec check
     (no verify = can't run the managed loop).
  6. **Spec alignment** — did the planner drift?
  7. **Visual-contract wiring** (when a demo / mockup exists) — UI tasks carry
     the assertions + DOM-level verify?
  8. **Reality-premise grounding** — every prod-data / environment /
     consumer-set premise has an on-site grounding step before its dependent
     task? An ungrounded one is a finding.
- **Evidence + arbitration** — per vendor:
  `<repo>/docs/reviews/plan-<name>-<vendor>.md`; orchestrator
  arbitrates into `plan-<name>-verdict.md` (never vendor-merged). Apply the
  **additive-finding gate** (xreview, SPOT).
- **Verdict records the convergence trajectory** — per real round: findings
  count + max severity + did the architecture settle? Rising count from
  REMOVING machinery = healthy; from ADDING machinery = scope-creep warning
  (re-run the additive gate on each new item).
- **On red** — confirmed design flaw → planner revises; deep architectural
  dispute → orchestrator arbitrates; genuine spec gap → re-open the spec
  (Phase 1). Loop until GREEN **before any execution dispatch**.
- **On GREEN, before the first dispatch: commit checkpoint** — stage and
  commit the spec updates, the pinned plan file, and the Layer-0
  evidence/verdict (only these), then assert the tree is clean: the first
  `ai_exec_start` hits the dirty-tree guard otherwise (route managed loop keeps the
  tree clean from here on).
- **Clean terminal artifact** — the plan converges to a clean final state;
  round-by-round history lives in the verdict file, NEVER inside the plan (no
  "added X then removed X" archaeology in the deliverable).
