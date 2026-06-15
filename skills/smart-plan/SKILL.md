---
name: smart-plan
description: Write an implementation plan with the correct model binding. Use whenever you're about to write a plan from a spec — clarification stays in the orchestrator session, but DRAFTING is forced onto the planner-role subagent (see route skill's role table for the current model) regardless of what model the current session runs, and the output is checked to carry per-task route fields. This prevents the trap of a session silently writing a plan with the wrong model.
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
cheapest, earliest, highest-leverage review in the system — and it fires **once per
plan**, so unlike per-task code review it has no frequency cost.

After the mechanical gate passes, run a cross-vendor review **of the plan itself**:

- **Panel** — identical derivation to code `xreview`: take it from `~/.claude/ai-model`
  (route's canonical per-scenario panel; `-gpt` swaps GPT's slot for a clean-window
  Opus medium). No new panel logic. Do NOT duplicate the table — defer to `route`.
- **By reference, never inline** — MCP `ai_review` with `cwd: <repo>`, prompt gives
  the **spec path + plan path** and tells each reviewer to read both from disk and
  critique the plan against the spec. Same anti-truncation discipline as code review.
- **Plan-review dimensions** (distinct from code review — these check *design*, not
  implementation):
  1. **Decomposition & sequencing** — phases right-sized? dependency order sound?
     any task depend on an earlier task's output it can't have yet?
  2. **Completeness** — missing tasks, unhandled edge cases, untested paths, an
     irreversible step with no rollback / no pre-flight audit.
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
  intent, so disposition is the author side's (Claude pool) call.
- **On red** — a confirmed design flaw goes back to the **planner** role (Opus 4.8
  high) to revise; a deep architectural dispute stays with the **orchestrator**
  (open-ended arbitration never leaves the orchestrator). Re-review the revision.
  Loop until green **before any execution dispatch** — the plan does not enter the
  managed loop until Layer 0 is clean.
