---
name: route
description: Intelligent model-routing entry point. Use when about to execute a task and you need to decide which model/vendor runs it — classifies by complexity (low/high) + critical flag, reads the current execution scenario, dispatches to the right leg (Claude subagent, GPT via ai_exec, Gemini via agy, or ai_digest), and reports the routing decision. This skill holds the CANONICAL scenario×complexity→model table that all other ai-bridge skills defer to.
---

# route — model dispatch

Classify → look up → dispatch (+ escalate on resistance). Routing intelligence
belongs at plan-time; if a task needs "smart" routing at execution time, the plan
is too thin — fix the plan, don't improvise the model.
*Rationale/history: `docs/model-selection-methodology.md`. Skills are the
behavioral SPOT; on conflict, skills win.*

## Step 1 — classify

- **complexity** `low` | `high` — how much intelligence execution needs; picks
  the tier within the scenario pool (Step 3).
- **critical** (optional flag) — *irreversible* (cutover / delete / storage
  write-migration) OR *foundational* (high blast radius: later tasks depend on
  it). Raises the tier + must be isolated into its OWN phase (Step 6). Does NOT
  trigger a task-level cross-vendor review (that layer was removed).

| Class | Signal | Leg |
|---|---|---|
| **digest** | bulk material in, facts out; judgment ≈ 0 | `ai_digest` (never read the raw material yourself) |
| **execute (low)** | plan has complete code + verify | executor per scenario, low tier |
| **execute (high)** | plan left on-site decisions | executor per scenario, high tier |
| **review** | check a diff/output against spec | `xreview` (cross-vendor) |
| **open-ended** | spec/plan/architecture | NOT routable — drafting → **planner** (`smart-plan`), arbitration stays orchestrator |

## Role → model (operational SPOT — edit here on model retirement)

| Role | Model (tier) |
|---|---|
| **planner** (spec/plan/arch) | **Opus 4.8 (high)** (Fable retired → Opus with a one-tier bump) |
| **orchestrator** (acceptance, arbitration, subtle fixes) | Opus 4.8 (medium), main session |
| **reviewer** | GPT 5.5 high · Gemini Pro high |
| **digester** | Gemini Flash |
| executor | scenario × complexity table below |

## Step 2 — read the knob

```
cat ~/.claude/ai-model    # "<scenario> [-gpt]"; missing → gpt (default)
```

`<scenario>` ∈ gpt/sonnet/gemini/opus. `-gpt` (GPT quota dead) is the ONLY
availability modifier — GPT is the sole top-tier-AND-exhaustible reviewer;
Gemini is ~always available, Opus is your own pool.

## Step 3 — look up (CANONICAL TABLE)

Scenario picks the executor pool; complexity picks the tier inside it (low →
medium, high → high). The executor never silently jumps pools — that's
escalation (Step 5).

| scenario | low | high | review panel |
|---|---|---|---|
| **gpt** (default) | GPT 5.5 medium | GPT 5.5 high | GPT high + Gemini |
| **sonnet** | Sonnet 4.6 medium | Sonnet 4.6 high | GPT high + Gemini |
| **gemini** | Gemini 3.1 Pro (High) | **Sonnet 4.6 high** | GPT high + Opus medium |
| **opus** | Opus medium | Opus high | GPT high + Gemini |

- **Gemini is the weak executor**: low complexity already needs Pro High; high
  complexity leaves the pool for Sonnet high.
- **GPT is MANDATORY in every gating panel while it has quota** — see xreview
  「铁律」(SPOT). Single-vendor Gemini gates are forbidden; lightness =
  frequency (fewer/smaller phases), never vendor-dropping.
- The executor's own vendor leaves the panel only when it isn't GPT (gemini
  scenario → Opus takes the seat). Orchestrator two-stage is always on top.
- **This table is for CODE review only.** Plan review (Layer 0) uses a FIXED
  external panel — the plan's author is always the planner, not the scenario
  executor. See `smart-plan` Phase 4.

### `-gpt` modifier (GPT quota dead)

Swap the GPT panel slot for a **clean-window Opus 4.8 medium** subagent (fresh
`model: opus`, own evidence file); never dispatch execution to GPT.

| state | panel |
|---|---|
| `sonnet -gpt` / `opus -gpt` | Gemini + Opus |
| `gemini -gpt` | Opus only — single external voice, **say so loudly** |

`gpt -gpt` is incoherent → rejected on write. The Claude pool always keeps
spec/plan/arch, orchestration + acceptance, arbitration, subtle fixes.

## Step 4 — dispatch

- **Claude executor** → Agent tool (`model: sonnet`/`opus`), fresh subagent,
  plan task verbatim, clean window.
- **GPT executor** → `ai_exec` `vendor:"gpt"`, `cwd` = repo, `report_path` set;
  reference the plan by path.
- **Gemini executor** → `ai_exec` `vendor:"gemini"`. **digest** → `ai_digest`.

## Step 5 — escalate on resistance, never preemptively

Start at the (scenario, complexity) cell. The SAME model iterates 1–2 rounds
first (feedback is cheap); only persistent red escalates — **by MODEL to Opus**:
non-opus scenario → **Opus high** → still stuck → **Opus max**; opus scenario →
**Opus max** (only Opus-on-Opus reaches max). Escalation tracks *resistance*,
not importance; target the failing point, never re-run the whole task.
Same-model retry uses resume (Continuation case 1); escalation to Opus is always
a **fresh Opus subagent + handoff brief** (can't resume across models). The one
preemptive max: irreversible-cutover pre-flight audit, written into the plan.

## Step 6 — critical tasks

A critical task keeps its complexity-derived executor, plus:
- **tier raised**, executor told to be more careful;
- **isolated into its OWN phase** (`smart-plan` enforces; Layer 0 checks). Its
  phase-boundary review then fires **before any consumer wires in** — catching
  the type-correct-but-semantically-wrong interface defect the compiler can't.
- irreversible-cutover: its phase review runs at **GPT xhigh** + an **Opus-max
  pre-flight audit** (Claude pool) as an explicit plan step.

Critical is a flag, not a tier — `low` + critical is legal (one-line
irreversible deletion).

## Review layers (summary)

**L0** plan-level cross-vendor (`smart-plan` Phase 4) → **L1** continuous per
task (TDD: failing test → implement → pass; verify/redlines/typecheck;
orchestrator two-stage — free; compiler + next task's typecheck catch type-level
breaks) → **L2** phase-boundary cross-vendor (the ONLY execution-stage
cross-vendor layer — keep phases small) → **Closing gate** + **Reality gate**
(below).

## Step 7 — report

One line after dispatching: complexity + critical?, active scenario, which
model/leg got the work. Routing must be legible.

## Managed loop vs one-shot

Output has an acceptance contract (verify + spec check) → **managed loop**:
dispatch → verify + two-stage review → on red arbitrate (small fix direct /
`ai_exec resume`) → green → next task. No contract (bare `/aibridge:gpt`) →
one-shot.

## Continuation — handoff-first; resume is a CLOSED 2-case exception

Default = **fresh-spawn + handoff brief** (clean window beats full context; a
resumed session drags every dead-end back in). **Brief = 5 fields, always:**
① done (task/commit) ② remaining ③ tried-and-failed ④ key `file:line` anchors
⑤ acceptance contract. One brief serves same-model continuation AND cross-model
escalation.

**Resume ONLY in exactly these two cases:**
1. **Same-diff review-fix, same vendor** — applying confirmed xreview findings
   to the diff the SAME executor just produced (GPT `ai_exec resume`; the
   managed-loop on-red path).
2. **One tightly-coupled task driven turn-by-turn in one sitting, no compaction
   crossed** — Claude subagent via `run_in_background` + SendMessage.

The list is closed — "feels like it needs the context" is NOT a third case.
Never resume for: the next plan task, a different model (impossible), a context
that went down a failed path, across compaction / lost agent, or Gemini (agy has
no resume). When in doubt, handoff.

## Closing gate — whole-implementation xreview (Layer 3-final)

When the last task goes green, do NOT declare done:
1. `xreview` the **full plan diff** (`git diff <plan-base>..HEAD` vs spec),
   label `final-<plan-name>`.
2. Arbitrate into `final-<plan-name>-verdict.md` (additive-finding gate applies).
3. Dispatch confirmed fixes through the managed loop, re-verify.
4. **Re-run the WHOLE-diff xreview until `VERDICT: GREEN`.**

**"Whole diff" is a LITERAL contract — a focused re-review CANNOT clear the
gate.** Each round re-reviews the entire diff afresh, not just the patched
spots: a fix can regress or break a seam elsewhere, and this pass exists for
exactly that integration coverage. (Deliberate exception to focused re-review —
per-finding arbitration and Step-5 escalation narrow to the disputed point
because they are not gates; this IS the gate.) It catches what per-phase reviews
structurally can't: cross-phase integration breaks, seams two phases each
half-built. Scope: managed-loop plan execution only.

## Reality gate — artifact vs REALITY (final, after the closing xreview)

Layers 0–3 check the artifact against the *spec*; none check it against
*reality* — code can be correct against a false premise (empty prod table, stale
deployed dist, wilder real inputs than the fixtures). Before "done", two
non-optional checks:

1. **Execution-site freshness** — assert what actually runs IS the code just
   built (dist mtime later than deploy start / `build_commit`), **NOT**
   "`healthz` is 200" (process-alive ≠ new-code-running). Never claim a fix
   verified without it.
2. **One live smoke against REAL data** — run the change end-to-end once on real
   production input (not a fixture) and assert the behavior at the real
   execution site.

"Done" is NOT claimable from green tests + green closing xreview alone. If
deploy is the user's call, downgrade the claim honestly — *"merged &
review-GREEN; NOT yet verified against reality — pending deploy + live smoke"* —
and the two obligations travel with the handoff as OPEN gates. Scope: any plan a
live system consumes; a pure refactor with no runtime surface skips
**explicitly** (a silent skip reads as "gated" when it wasn't).
