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
| **open-ended** | writing spec/plan, architecture arbitration | NOT routable here — planner stays Fable (`smart-plan`), arbitration stays orchestrator |

## Step 2 — read the current execution scenario

```
cat ~/.claude/ai-model        # one of: gpt | sonnet | gemini | opus; missing → gpt (default)
```

## Step 3 — look up the model (CANONICAL TABLE)

| scenario | mechanical | judgment | review panel |
|---|---|---|---|
| **gpt** (default) | GPT 5.5 medium | GPT 5.5 high | GPT high + Gemini |
| **sonnet** | Sonnet 4.6 medium | Fable/Opus medium | GPT high + Gemini |
| **gemini** | Gemini 3.1 Pro | Opus medium | GPT high + Opus medium |
| **opus** | Opus medium (subagent) | Opus medium | GPT high + Gemini |

Invariants (do not violate regardless of scenario):
- **mechanical is always medium** — judgment space is compressed; don't prepay a
  reasoning tier. Escalate to high only on actual resistance (see Step 5).
- **review panel must include a non-executing vendor** — in the gemini scenario
  Gemini is the executor, so it leaves the panel and Opus medium takes its seat.
- **Claude pool always keeps four things** no matter the scenario:
  spec/plan/arch (Fable), orchestration + per-task acceptance (Opus), review
  arbitration (Opus), subtle fixes.

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
