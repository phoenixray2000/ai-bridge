---
name: smart-plan
description: Write an implementation plan with the correct model binding. Use whenever you're about to write a plan from a spec — clarification stays in the orchestrator session, but DRAFTING is forced onto the planner model (a Fable subagent) regardless of what model the current session runs, and the output is checked to carry per-task route fields. This prevents the trap of an Opus/Sonnet session silently writing a plan that the methodology requires Fable to write.
---

# smart-plan — model-bound planning

`superpowers:writing-plans` governs HOW a plan is written but not WHO writes it.
Invoked bare from an Opus session, the plan gets written by Opus — violating the
methodology's most expensive rule (spec/plan/arch must be the planner model,
currently Fable) and producing a plan with no route fields. This skill closes
both holes.

## Phase 1 — clarify (stays in orchestrator, current session)

Align scope with the user, read the spec, gather context. This is
conversation-dense, not intelligence-dense — keep it here. Converge the
discussion into a written spec/decision doc; **the spec file is the handoff
artifact, not the chat history**. If the eventual drafting brief can't be
covered by the spec, the spec is incomplete — go back and fill it, don't try to
ferry "the discussion" to the subagent.

## Phase 2 — draft (forced onto the planner model)

Dispatch an Agent with `model: fable` (the planner role; if Fable is retired,
reassign per the methodology's degradation path — Opus 4.8 with one tier up).
The subagent prompt must:
- If `superpowers:writing-plans` is available, instruct the subagent to invoke
  it first and follow its discipline. Otherwise use the built-in plan format.
- Require **every task to carry a `type` field: mechanical / judgment / hazard**
  (NOT a hardcoded model name — the model is resolved at execution time by
  `route` × current scenario). Special nodes the plan-time analysis already
  pins (e.g. an irreversible-cutover pre-flight audit at max) may name the model
  explicitly as an exception.
- Receive the spec path + repo context, NOT this session's chat transcript.

## Phase 3 — exit check (orchestrator)

Accept the subagent's plan and verify: every task has a `type` field; hazard
tasks are flagged for extra review; finishing/deletion tasks reserve their
final "whole-repo zero-reference" check for the orchestrator. Missing a `type`
field → bounce it back. The plan format contract becomes a mechanical gate, not
something the author has to remember.
