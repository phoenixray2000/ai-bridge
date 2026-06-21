---
name: route
description: Intelligent model-routing entry point. Use when about to execute a task and you need to decide which model/vendor runs it — classifies by complexity (low/high) + critical flag, reads the current execution scenario, dispatches to the right leg (Claude subagent, GPT via ai_exec, Gemini via agy, or ai_digest), and reports the routing decision. This skill holds the CANONICAL scenario×complexity→model table that all other ai-bridge skills defer to.
---

# route — model dispatch

You are the router. Routing intelligence belongs at plan-time; at execution
time routing is three mechanical acts: **classify → look up → dispatch** (plus
escalate-on-resistance and explicit override). If a task needs real "smart"
routing at execution time, the plan was written too thin — fix the plan, don't
improvise the model.

## Step 1 — classify the task

Two orthogonal axes, not one list of types:
- **complexity** ∈ `low` | `high` — how much intelligence executing it needs.
  Sets the tier within the scenario pool (Step 3).
- **critical** (optional flag) — asymmetric cost if wrong, in either sense:
  *irreversible* (cutover, delete, storage write-migration) OR *foundational*
  (high blast radius — later tasks depend on it: an interface, a shared
  abstraction). Triggers extra review, NOT a different executor (Step 6).

| Class | Signal | Leg |
|---|---|---|
| **digest** | bulk material in, facts out (logs, dumps, repo scans, doc lookups); judgment ≈ 0 | `ai_digest` (never read the raw material yourself) |
| **execute (low)** | plan has complete code + verify; execution = transcribe + run verify | executor leg per scenario, low tier |
| **execute (high)** | plan left on-site decisions (tuning, classification, reconcile-with-reality) | executor leg per scenario, high tier |
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
| low / high complexity executor | per scenario × complexity table below | — |

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

Scenario picks the executor pool; **complexity picks the tier inside it** (low →
medium, high → high). The executor stays consistent within a scenario — judgment
does NOT silently jump to a pricier model; that's what escalation is for (Step 5).

| scenario | low complexity | high complexity | review panel |
|---|---|---|---|
| **gpt** (default) | GPT 5.5 medium | GPT 5.5 high | GPT high + Gemini |
| **sonnet** | Sonnet 4.6 medium | Sonnet 4.6 high | GPT high + Gemini |
| **gemini** | Gemini 3.1 Pro (High) | **Sonnet 4.6 high** | GPT high + Opus medium |
| **opus** | Opus medium | Opus high | GPT high + Gemini |

- **gemini is the weak executor**: even low complexity needs Pro **High** tier, and
  high complexity leaves the pool entirely for **Sonnet high** (Gemini high isn't
  enough). So the gemini scenario only offloads *easy* work to Gemini.

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

Claude pool always keeps spec/plan/arch (planner = Opus 4.8 high), orchestration +
per-task acceptance, review arbitration, subtle fixes — regardless of scenario.

## Step 4 — dispatch

- **Claude executor** (sonnet/opus rows, or gemini-scenario high complexity) →
  Agent tool with `model: sonnet` or `model: opus`, a fresh subagent with the
  task's complete instructions. Pass the plan task verbatim; clean window.
- **GPT executor** → MCP `ai_exec` with `vendor: "gpt"`, `cwd` = the repo,
  `report_path` set so detailed output lands on disk and stdout stays a summary.
  Reference the plan by path in the prompt (the agent reads it from disk).
- **Gemini executor** → MCP `ai_exec` with `vendor: "gemini"`.
- **digest** → MCP `ai_digest`.

## Step 5 — escalate on resistance, never preemptively

Start at the (scenario, complexity) cell. On a red that the cell's model can't
break, **escalate by MODEL to Opus** — not by re-trying a pricier tier of the
same model:

- non-opus scenario stuck → **Opus high** → still stuck → **Opus max**
- opus scenario stuck → **Opus max** (Opus escalating itself is the only path to max)

So: any pool hands off to Opus **high** first; only Opus-on-Opus reaches **max**.
On resistance, the SAME model iterates one or two rounds first (feedback is cheap)
— only persistent red escalates the model. Escalation tracks *resistance*, not
*importance*; it targets the specific failing point, never re-runs the whole task,
and carries the failure context to Opus (codex `resume` for GPT, a fresh
context-loaded Opus subagent for Claude). Irreversible-cutover pre-flight audits
are the one preemptive max (written into the plan, see critical).

## Step 6 — critical tasks (orthogonal to complexity)

A task flagged **critical** (irreversible OR foundational, see Step 1) keeps its
complexity-derived executor, but additionally:
- gets a **task-level cross-vendor review** (`xreview`) — not just the continuous
  layer. This is where early cross-vendor coverage goes: the high-blast-radius and
  irreversible tasks, caught before later work compounds on them;
- if it's an irreversible-cutover pre-flight audit, run it at **Opus max** (the one
  preemptive max), written into the plan step.

Critical is a flag, not a tier — a task can be `low` complexity AND critical (e.g.
a one-line but irreversible deletion). Non-critical tasks rely on the continuous
layer (orchestrator two-stage + verify) per task, and the **phase-boundary**
cross-vendor review as the catch-all — so keep phases small enough that the
phase-boundary `xreview` fires while the work is still fresh.

The review architecture has **four layers**, earliest first:
- **Layer 0 — plan-level cross-vendor review** (`smart-plan` Phase 4): the plan
  itself is reviewed cross-vendor before any task dispatches. Densest-judgment
  artifact, cheapest fix, fires once per plan — design bugs (decomposition, missing
  edge cases, dishonest route fields, wrong interface) caught before any code exists.
- **Layer 1 — continuous** (orchestrator two-stage + verify/redlines/typecheck):
  per task, every task, free.
- **Layer 2 — task-level cross-vendor**: critical tasks only (this step).
- **Layer 3 — phase-boundary cross-vendor**: full-diff catch-all for everything else.

## Step 7 — report the routing decision

After dispatching, tell the user in one line: complexity + critical?, active
scenario, and which model/leg got the work. Routing must be legible, not silent.

## Managed loop vs one-shot

If this task's output has an acceptance contract waiting (verify + spec check) —
i.e. it's a plan task — run the **managed loop**: dispatch → verify + two-stage
review → on red, arbitrate (small fix directly / continue the vendor via
`ai_exec` `resume`) → green → next task. A bare `/ai-bridge:gpt` call with no
contract is one-shot. The contract is the dividing line.

## Closing gate — whole-implementation xreview (Layer 3-final)

When the **last** task of a plan goes green, do NOT declare done yet. Practice
shows a final cross-vendor review **of the entire accumulated diff** catches
substantive problems the per-phase reviews structurally cannot: cross-phase
integration breaks, emergent inconsistencies, a seam two phases each half-built.
Phase-boundary review (Layer 3) sees one phase's diff; this sees the whole.

So the managed loop has a mandatory closing step — automatic, not optional:

1. Run `xreview` on the **full plan diff** (`git diff <plan-base>..HEAD`, all changed
   paths, against the spec) — same panel/contract/evidence as any xreview, label
   `final-<plan-name>`.
2. **Arbitrate** into `final-<plan-name>-verdict.md` (same additive-finding gate —
   a whole-diff reviewer is just as prone to "you should also build X").
3. **Dispatch the confirmed fixes** through the same managed loop (low-complexity →
   executor, subtle → orchestrator direct), re-verify.
4. **Re-run the whole-diff xreview** until it returns `VERDICT: GREEN`. Only then is
   the plan done.

This is the execution-side mirror of Layer 0: Layer 0 gates the plan before any code;
this gates the whole implementation before done. Both are whole-artifact cross-vendor
passes; both loop-until-green. Scope: plan execution only (the managed loop) — a
one-shot call has no whole-diff to close on.
