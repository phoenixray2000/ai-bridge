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

Parse: a `<scenario>` word (`gpt`/`sonnet`/`gemini`/`opus`) plus an optional
`-gpt` flag (GPT quota is dead). That one flag is the ONLY availability modifier —
GPT is the sole reviewer that is both top-tier AND exhaustible. Gemini is cheap /
~always available; Opus is your own Claude pool (can't be quota-dead). This one
line drives both execution and the review panel.

## Step 3 — look up the model (CANONICAL TABLE)

| scenario | mechanical | judgment | review panel |
|---|---|---|---|
| **gpt** (default) | GPT 5.5 medium | GPT 5.5 high | GPT high + Gemini |
| **sonnet** | Sonnet 4.6 medium | Opus 4.8 medium | GPT high + Gemini |
| **gemini** | Gemini 3.1 Pro | Opus medium | GPT high + Opus medium |
| **opus** | Opus medium (subagent) | Opus medium | GPT high + Gemini |

Notes on the panel:
- **GPT is in every panel when it has quota** — its review is the gold standard,
  worth keeping even in the gpt scenario (it reviews its own output, but Gemini +
  the orchestrator's two-stage still supply the cross-vendor perspective; GPT high
  is pure added strength, and Opus backfill does NOT match it).
- The **executor's own vendor leaves** the panel only when it isn't GPT: gemini
  scenario → Gemini steps out, Opus takes the seat.
- The **orchestrator two-stage review (continuous layer) is always on top**, every
  scenario, every task — the guaranteed floor.

### `-gpt` modifier (GPT quota dead)

When the line carries `-gpt`: **swap the GPT slot in the panel for a clean-window
Opus 4.8 medium** subagent (fresh `model: opus`, own evidence file — distinct from
the context-saturated orchestrator review), and never dispatch execution to GPT.

| state | panel becomes |
|---|---|
| `sonnet -gpt` | Gemini + Opus |
| `opus -gpt` | Gemini + Opus |
| `gemini -gpt` | Opus only → with the orchestrator that's a single external voice; **say so loudly** (thin this round) |

`gpt -gpt` is incoherent (kills the executor) → rejected on write.

Execution invariant: **mechanical is always medium** — judgment space is
compressed; escalate to high only on actual resistance (Step 5). Claude pool always
keeps spec/plan/arch (planner = Opus 4.8 high), orchestration + per-task
acceptance, review arbitration, subtle fixes — regardless of scenario.

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
