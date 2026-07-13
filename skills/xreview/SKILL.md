---
name: xreview
description: Cross-vendor adversarial review of a diff. Use at phase boundaries or whenever you want independent outside opinions on a change. Defaults to both vendors (GPT + Gemini) in parallel; pass a single vendor to restrict. Each vendor's raw output lands in its own evidence file; you (orchestrator) arbitrate into a verdict file — vendors never merge each other's findings.
---

# xreview — cross-vendor review

Review value is **perspective difference**, not repetition. The orchestrator's
two-stage review is always in play as the continuous layer; xreview adds outside
vendors whose blind spots don't overlap.
*Rationale/history: `docs/model-selection-methodology.md`. Skills are the
behavioral SPOT; on conflict, skills win.*

## Panel — from `~/.claude/ai-model`

Per-scenario panel (canonical table in `route`):

| scenario | panel | with `-gpt` (GPT dead) |
|---|---|---|
| gpt | GPT high + Gemini | (n/a) |
| sonnet | GPT high + Gemini | Gemini + Opus |
| gemini | GPT high + Opus medium | Opus only — thin, **say so** |
| opus | GPT high + Gemini | Gemini + Opus |

`-gpt` swaps GPT's slot for a **clean-window Opus 4.8 medium** subagent (fresh
`model: opus`, own evidence file `<label>-opus.md`).

### 铁律 — GPT is MANDATORY in any gating review while it has quota

A gating review (Layer 0 / phase boundary / closing gate) **must include GPT**
unless the knob carries `-gpt`. **Single-vendor Gemini gates are FORBIDDEN** —
Gemini is the second voice *alongside* GPT, never a substitute. Lightness =
**frequency** (fewer/smaller phases), never "swap GPT for cheaper Gemini-only";
if tempted to skip GPT to save cost, don't run the gate at all (trust verify).
A single-vendor argument (`gpt`/`gemini`) is for ad-hoc one-shot opinions ONLY,
never a managed gate. If a panel collapses to one external voice, **say so
loudly**. Missing GPT without `-gpt` is a defect, not a relaxation (the phase
gate `check-review-evidence.mjs` fails loud on it unless `--gpt-dead`).

### agy (Gemini) failure — one internal retry, then SKIP, never hammer

`ai_review` already retries agy once internally (2 attempts, 8s de-clustered
backoff — recovers most flakes without provoking OAuth; only *clustered* rapid
restarts do). If it still fails (`degrade: true`): **skip the Gemini seat this
round** — GPT-solo (铁律 holds), note Gemini absent in the verdict. Do NOT loop
agy on top of the internal retry (clustered cold-starts provoke a browser OAuth
re-consent — account-risk exposure), do NOT spin up a clean-Opus substitute
(that is only for `-gpt`). A flake does not advance the round counter.

## How — review by reference, never inline

Per panel vendor, MCP `ai_review` with:
- `cwd: <repo>` — the reviewer reads files / runs git itself. **Never paste
  code/diffs into the prompt** (Windows argv limit truncates; lossy trimming).
- `prompt`: instructions + references — diff range (`git diff <base>..<head>`),
  changed paths, spec path.
- `effort`: default high; **xhigh for cutover diffs**.
- `evidence_path`: `<repo>/docs/reviews/<label>-<vendor>.md`.

Inline (omit `cwd`) only for a repo-less snippet. Run panel vendors
concurrently.

### Visual conformance — when a visual contract exists

If the change ships UI and the spec pins a visual contract (`smart-plan` Phase
1), add the dimension: **does the rendered output honor the demo's load-bearing
decisions?** Two levels, no pixel-diff: DOM/structural assertions are the plan's
verify job (deterministic floor); xreview adds the judgment layer — give the
reviewer the demo path + changed UI files + the assertions, ask whether
hierarchy / grouping / affordances / state treatments are honored. Findings must
cite a **load-bearing** assertion; incidental demo details (placeholder text,
default colors) are not contract — don't flag them.

## Output contract — append VERBATIM to EVERY `ai_review` prompt (SPOT)

Reviewers default to chatty/interactive behavior, which breaks find-vs-dispatch
and makes evidence un-gateable. Every `ai_review` prompt (here AND `smart-plan`
Phase 4) ends with:

```
--- OUTPUT CONTRACT (obey exactly) ---
You are a REVIEWER, not an editor. Do NOT modify any code. Do NOT ask questions.
Do NOT request confirmation. Do NOT offer to fix anything — "shall I fix this?" /
"需要我修吗" is FORBIDDEN. The author side dispatches fixes, not you.

Output ONLY these two things, nothing else:
1. A findings list. Each finding as one block:
     [BLOCKER|MAJOR|MINOR] <file>:<line> — <problem> → <concrete fix>
   (No findings is a valid result — then write exactly: No findings.)
   If a finding proposes NEW capability ("also build X"), cite the spec section
   that requires it, or mark it "(grounding: <source>)" — an addition the spec's
   non-goals exclude is NOT a finding, do not raise it.
2. The VERY LAST LINE must be exactly one of:
     VERDICT: GREEN        (no BLOCKER and no MAJOR; MINORs allowed)
     VERDICT: NEEDS-FIX    (at least one BLOCKER or MAJOR)
Nothing may follow the VERDICT line.
```

Severity → verdict is mechanical (any BLOCKER/MAJOR ⇒ NEEDS-FIX). The terminal
`VERDICT:` line makes evidence machine-checkable —
`check-review-evidence.mjs --verdict-lines` asserts it per vendor file. A file
without it is malformed: re-run, don't hand-summarize. The reviewer's VERDICT is
its opinion; the `<label>-verdict.md` arbitration decides.

## Arbitration — yours, never the vendors'

Never ask one vendor to merge the other's findings — merging IS arbitration,
and that's the author side's (Claude pool) job:
1. **Both-flagged** → high confidence, prioritize.
2. **Single-flagged** → judge each true/false (this is where perspective pays).
3. **Conflicting on a P0 boundary** → take the disputed point itself to max;
   arbitrate only the dispute.

Write `<repo>/docs/reviews/<label>-verdict.md`: per finding —
source / accepted-or-rejected / reason / dispatch target. Confirmed fixes dispatch per scenario (low-complexity
→ executor, subtle → orchestrator direct); false positives rejected with a
written reason — never accept wholesale.

### Verdict anchoring — command output only, never memory (anti-confabulation)

The verdict's three load-bearing facts must be pasted from commands run NOW,
this round — hand-typing any of them from memory is exactly how a fabricated
GREEN gets written (2026-07-10 incident: a verdict claimed a 5-file/157-line
diff plus per-line Gemini findings while `git diff` was empty and no
`ai_review` call had ever been made in the session):

1. **Diff header**: re-run `git diff --stat <base>..<head>` immediately before
   writing the verdict; paste its raw output into the verdict header. Empty
   diff → **ABORT, no verdict file may exist** — nothing was reviewed.
2. **Vendor presence**: a vendor's findings section may exist ONLY if that
   vendor's evidence file exists non-empty (`test -s <label>-<vendor>.md`)
   from THIS round's `ai_review` call. No evidence file → vendor is ABSENT:
   say so; zero findings content attributed to it.
3. **Commit hashes**: every hash cited must be copied from `git log` output
   run this round, never recalled.

### Ground every ADDITIVE finding before accepting it

Findings that flag existing defects pass straight through — the gate fires only
on **"build something new"** proposals ("also handle X", "add a Y layer"):
- **Foreclosed by an existing contract?** Check spec 非目标 + actual source; if
  already excluded / premise already false → **reject**, cite the line. Never
  let a later round harden it. (This is THE failure mode that turns healthy
  multi-round review into churn.)
- **Rests on an unverified code belief?** Ground against source before accepting.
- **A genuine spec gap?** Then it's a **spec change** — re-open the spec; don't
  improvise machinery inside the review loop.

Removing machinery is always fine; the gate is asymmetric by design.

### Loop convergence + round accounting (SPOT for every looping gate)

- **GREEN = latest round's arbitrated findings have no BLOCKER/MAJOR.** Don't
  chase zero — surviving MINORs carry into execution as tracked cleanups (drops
  the trailing pure-confirmation round).
- **A flake is not a round.** agy empty-stdout / GPT token_revoked are handled
  WITHIN the round (retry / skip seat per the degrade policy); only a
  findings-producing pass advances the counter.
- **Escalation cap: 8 real rounds without GREEN → STOP, escalate to the user**
  (continue / restructure spec / abort). Never auto-green, never grind past.
