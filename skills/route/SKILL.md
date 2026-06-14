---
name: route
description: Intelligent model-routing entry point. Use when about to execute a task and you need to decide which model/vendor runs it — classifies the task (digest / mechanical / judgment / review), reads the current execution scenario, dispatches to the right leg (Claude subagent, GPT via ai_exec, Gemini via agy, or ai_digest), and reports the routing decision. This skill holds the CANONICAL scenario→model table that all other ai-bridge skills defer to.
---

# route — model dispatch

You are the router. Routing intelligence belongs at plan-time; at execution
time routing is three mechanical acts: **classify → look up → dispatch** (plus
escalate-on-resistance and explicit override). If a task needs real "smart"
routing at execution time, the plan was written too thin — fix the plan, don't
improvise the model.

## Step 1 — classify the task

| Class | Signal | Leg |
|---|---|---|
| **digest** | bulk material in, facts out (logs, dumps, repo scans, doc lookups); judgment space ≈ 0 | `ai_digest` (never read the raw material yourself) |
| **mechanical** | plan contains complete code + verify steps; execution = transcribe + run verify | executor leg per scenario |
| **judgment** | plan gave direction but left on-site decisions (tuning, classification, reconcile-with-reality) | executor leg per scenario |
| **review** | check a diff/output against spec | `xreview` skill (cross-vendor) |
| **open-ended** | writing spec/plan, architecture arbitration | NOT routable here — drafting goes to the **planner** role (`smart-plan`), arbitration stays orchestrator |

## Role → model (operational SPOT — change here on model retirement)

Stable role names; the model is the current assignment. Everything else
references the role, so a model swap is a one-line edit here.

| Role | Model (tier) | Notes |
|---|---|---|
| **planner** (spec/plan/arch drafting) | **Opus 4.8 (high)** | was Fable 5; Fable retired → reassigned to Opus 4.8 with a one-tier bump (medium→high) as intelligence compensation |
| **orchestrator** (this session: acceptance, arbitration, subtle fixes) | Opus 4.8 (medium) | user's session model; the methodology's recommended value |
| **reviewer** | GPT 5.5 high · Gemini Pro high | cross-vendor panel |
| **digester** | Gemini Flash | context offload |
| mechanical / judgment executor | per scenario table below | — |

## Step 2 — read the current routing knob

```
cat ~/.claude/ai-model        # "<scenario> [-vendor ...]"; missing → gpt (default)
```

Parse: a `<scenario>` word (`gpt`/`sonnet`/`gemini`/`opus`) plus optional
`-gpt`/`-gemini` exclusions (that vendor is quota-dead). This one line drives both
execution and the derived review panel — there are no separate switch files.

## Step 3 — look up the model (CANONICAL TABLE)

| scenario | mechanical | judgment |
|---|---|---|
| **gpt** (default) | GPT 5.5 medium | GPT 5.5 high |
| **sonnet** | Sonnet 4.6 medium | Opus 4.8 medium |
| **gemini** | Gemini 3.1 Pro | Opus medium |
| **opus** | Opus medium (subagent) | Opus medium |

Execution invariants:
- **mechanical is always medium** — judgment space is compressed; don't prepay a
  reasoning tier. Escalate to high only on actual resistance (see Step 5).
- **never dispatch to an excluded vendor** — exclusions can't hit the executor
  (validated on write), so this only bites if state was hand-edited; fail loud.
- **Claude pool always keeps four things** no matter the scenario:
  spec/plan/arch (planner = Opus 4.8 high), orchestration + per-task acceptance
  (Opus), review arbitration (Opus), subtle fixes.

### Review panel — DERIVED (no separate switch)

Build the panel from `(scenario, exclusions)` by one rule:

> Keep **2 non-author, model-distinct reviewers**, preferring external vendors
> (GPT, Gemini) over Opus; drop any excluded (dead) vendor; if the externals fall
> short of 2, **backfill with a clean-window Opus 4.8 medium** subagent. The
> orchestrator's own two-stage review (continuous layer) is always present on top.

"Author" = the execution side: in gpt/gemini scenarios the executor vendor is the
author; in sonnet/opus scenarios the Claude pool is the author (so Opus is
author-side and only backfills when externals are short).

| scenario | exclusions | derived panel |
|---|---|---|
| gpt | — | Gemini + Opus (GPT is author) |
| gemini | — | GPT + Opus (Gemini is author) |
| sonnet | — | GPT + Gemini |
| opus | — | GPT + Gemini |
| sonnet | -gpt | Gemini + **Opus backfill** |
| gpt | -gemini | **Opus backfill** only external is GPT(author)→ Opus; loud: thin |

If the rule can't reach 2 distinct non-author reviewers even with Opus (e.g. both
externals dead in a Claude scenario → only Opus, partially author-side), review
is orchestrator-only (Opus two-stage) — **say so loudly**; never pass a
single-perspective review off as cross-vendor. The Opus backfill is a FRESH
`model: opus` subagent (clean window, own evidence file) — distinct from the
context-saturated orchestrator review.

## Step 4 — dispatch

- **Claude executor** (sonnet/opus rows) → Agent tool with `model: sonnet` or
  `model: opus`. Mechanical → a fresh subagent with the task's complete
  instructions. Pass the plan task verbatim; the subagent has a clean window.
- **GPT executor** → MCP `ai_exec` with `vendor: "gpt"`, `cwd` = the repo,
  `report_path` set so detailed output lands on disk and stdout stays a summary.
  Reference the plan by path in the prompt (the agent reads it from disk).
- **Gemini executor** → MCP `ai_exec` with `vendor: "gemini"`.
- **digest** → MCP `ai_digest`.

## Step 5 — escalate on resistance, never preemptively

Default medium. First red → retry medium. Second red unbroken → high. Third red
/ irreversible cutover / P0 dispute → max. Tier tracks the problem's
*resistance*, not its *importance*. Escalation targets the specific failing
point, never re-runs the whole task at a higher tier.

## Step 6 — report the routing decision

After dispatching, tell the user in one line: what class you assigned, which
scenario was active, and which model/leg got the work. Routing must be legible,
not silent.

## Managed loop vs one-shot

If this task's output has an acceptance contract waiting (verify + spec check) —
i.e. it's a plan task — run the **managed loop**: dispatch → verify + two-stage
review → on red, arbitrate (small fix directly / continue the vendor via
`ai_exec` `resume`) → green → next task. A bare `/ai-bridge:gpt` call with no
contract is one-shot. The contract is the dividing line.
