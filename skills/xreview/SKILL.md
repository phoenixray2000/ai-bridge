---
name: xreview
description: Cross-vendor adversarial review of a diff. Use at phase boundaries or whenever you want independent outside opinions on a change. Panel seating follows the in-file Seat-cadence rule (second seat sits first-look rounds only — a gate's R1 and the post-redesign round after an oscillation exit); pass a single vendor to restrict. Each vendor's raw output lands in its own evidence file; you (orchestrator) arbitrate into a verdict file — vendors never merge each other's findings.
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

### Seat cadence — second seat sits FIRST-LOOK rounds only (SPOT)

The panel above is the panel of a gate's **first-look rounds**: its R1, and —
after an oscillation exit (Loop convergence below) — the first round reviewing
the reworked design. On every other round the second seat (Gemini; Opus medium
in the gemini scenario) stands down — **GPT-solo**. Grounding (2026-06/07 month audit): the second seat's
real catches concentrate at first seating (design-eye / enumeration
completeness / fresh-perspective findings); R2+ rounds verify fixes, which is
exactly where Gemini's misfire mode lives (19 of 21 arbitrated false positives
were Gemini's, incl. one 8-false-BLOCKER "not implemented" hallucination against
fully implemented code) — every misfire burns Claude-pool arbitration plus the
mandatory post-Gemini `git status` rogue check. 铁律 is untouched: GPT anchors
every round, and GPT-solo is not the forbidden Gemini-solo. Exception: under
`-gpt` the degraded R1 panel carries UNCHANGED through all rounds — with no GPT
anchor there is no strong solo seat to stand down to (`gemini -gpt` stays
Opus-only every round, thin, keep saying so).

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

The review job already retries agy once internally (2 attempts, 8s de-clustered
backoff — recovers most flakes without provoking OAuth; only *clustered* rapid
restarts do). If it still fails (`degrade: true`): **skip the Gemini seat this
round** — GPT-solo (铁律 holds; under `-gpt` the Opus seat carries the round
alone — single voice, **flag the round as thin**), note Gemini absent in the
verdict. Do NOT loop
agy on top of the internal retry (clustered cold-starts provoke a browser OAuth
re-consent — account-risk exposure), do NOT spin up a clean-Opus substitute
(that is only for `-gpt`). A flake does not advance the round counter.

## How — async jobs, review by reference, never inline

Reviews run as DETACHED background jobs (they survive session death; a harness
retry maps back to the original job via the idempotency key — never a
double-launch). Per panel vendor, `ai_review_start` with:
- `cwd: <repo>` — the reviewer reads files from disk (GPT additionally runs git
  itself; Gemini CANNOT — see the Gemini-seat rule below). **Never paste
  code/diffs into the prompt** (Windows argv limit truncates; lossy trimming).
- `prompt`: instructions + references — diff range (GPT: `git diff
  <base>..<head>`; Gemini: the materialized diff FILE), changed paths, spec path.
- `effort`: default high; **xhigh for cutover diffs**.
- `evidence_path`: `<repo>/docs/reviews/<label>-<vendor>.md`. **Rounds get
  distinct labels** (`<label>-r2`, `-r3`, …) — never overwrite a previous
  round's evidence; a round's verdict may cite only files bearing THAT round's
  label (feeds Verdict-anchoring fact 2).
- `expect_verdict: true` — **mandatory on every gate call** (phase / Layer 0 /
  closing). The job then FAILS instead of completing when the output lacks the
  terminal `VERDICT:` line — a malformed review can never reach arbitration as
  a "completed" result. Leave unset only for ad-hoc one-shot opinions.
- `timeout_minutes` — a JOB-LEVEL budget (retries spend the remainder). Pinned
  table; **when unsure take the larger tier** (ceiling cost is asymmetric: an
  oversized budget costs nothing — early return; an undersized one kills a
  legitimate long review and forces a full re-run):

  | review shape | timeout_minutes |
  |---|---|
  | regular phase / plan review | default 25 (omit) |
  | closing-gate whole-diff | **90** |
  | huge batch (≥100 files or ≥50 commits) / irreversible-cutover xhigh | **120–180** |

  (Grounded: batch-E's 206-file closing gate legitimately ran 60min+ per vendor.)

### Gemini seat — MATERIALIZED DIFF ONLY, never "run git yourself"

The agy review leg runs `--sandbox` headless: command-class tools are
**auto-denied** (read-only file access is all it has). A prompt that tells the
reviewer to run `git diff` is therefore a guaranteed silent death on any
whole-batch gate (exit 0, empty stdout; small phase reviews only read files,
which is why this never surfaced before batch-E). So for the **Gemini seat**:
1. Materialize the diff first (ensure the target dir exists — `git diff
   --output` does NOT create parent directories; in a fresh consuming repo
   `mkdir docs/reviews` first):
   `git diff --output=docs/reviews/<label>-diff.txt <base>..<head>`
   (**`--output=`, never shell `>`** — PowerShell 5.1 redirection re-encodes
   native stdout as UTF-16 and corrupts the diff file).
2. The prompt references that file (plus changed paths / spec path) and states
   explicitly: **"只读文件,禁跑任何命令(沙箱会 auto-deny)"**.
3. EVERY Gemini-seated round materializes its OWN diff file for that round's
   range (matters under `-gpt`, where the seat persists past R1) — never reuse
   a previous round's file (stale snapshot). DELETE it once the round is
   collected and arbitrated — before that round's commit checkpoint (scratch,
   not evidence).

The **GPT seat is unchanged** — codex runs danger-full-access and runs git
itself; do NOT feed it the materialized diff (live git beats a stale snapshot).
Rejected alternative: granting agy a command allow-rule — a review seat with
arbitrary command execution violates read-only, and agy has a rogue-edit record.

Start every vendor the Seat-cadence rule seats this round first, then collect
each with `ai_job_result` (long-polls
300s; while it reports running, call it again — do NOT re-start). After a
session crash/restart, `ai_job_result` with the old job_id recovers the
finished review instead of re-running it; if the job_id is lost with the dead
session, `ai_job_list` finds it (never re-send a re-phrased prompt — it misses
the idempotency key and double-launches the vendor). Inline (omit `cwd`) only
for a repo-less snippet.

### Visual conformance — when a visual contract exists

If the change ships UI and the spec pins a visual contract (`smart-plan` Phase
1), add the dimension: **does the rendered output honor the demo's load-bearing
decisions?** Two levels, no pixel-diff: DOM/structural assertions are the plan's
verify job (deterministic floor); xreview adds the judgment layer — give the
reviewer the demo path + changed UI files + the assertions, ask whether
hierarchy / grouping / affordances / state treatments are honored. Findings must
cite a **load-bearing** assertion; incidental demo details (placeholder text,
default colors) are not contract — don't flag them.

## Output contract — append VERBATIM to EVERY review prompt (SPOT)

Reviewers default to chatty/interactive behavior, which breaks find-vs-dispatch
and makes evidence un-gateable. Every review prompt (here AND `smart-plan`
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

**Gate wiring must enforce the verdict file** — any NEW
`check-review-evidence.mjs` wiring for a gate passes `--verdict` (and
`--verdict-lines`), wired on the gate's **ROOT label** (R1 evidence + the
single `<label>-verdict.md`; per-round `-rN` evidence anchoring is the
arbitration contract inside the verdict, not the checker's job — the checker
asserts existence/shape, arbitration asserts round identity). The `--vendors`
passed are the R1 round's **ACTUALLY seated** vendors: a seat that degraded out
of R1 (agy skip) is dropped from `--vendors` for that invocation and recorded
as absent in the verdict — a static vendor list that demands evidence from a
seat that never sat turns a legitimate degrade into a permanent red. The
verdict file is the anti-confabulation anchor (below) —
a gate whose GREEN lives only in conversation is exactly the 2026-07-10
fabrication vector, and cross-session handoffs cite it as the sole verifiable
record. Forward-only: do NOT retrofit pre-existing gate labels or repair old
evidence-only series; ad-hoc one-shot reviews never wire the checker and owe no
verdict.

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
   from THIS round's review job. No evidence file → vendor is ABSENT:
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
- **Oscillation exit: 2 consecutive rounds of same-family BLOCKER/MAJOR on the
  SAME mechanism → stop looping, redesign that mechanism.** Same-family test:
  each round's accepted fix is another patch on the same lock / state machine /
  path convention (grounded: plan-wechat-storage-unification burned R2–R4
  finding new races in one hand-rolled lock; the converging move was DELETING
  the mechanism, available two rounds earlier). At arbitration, judge the
  family; on the second consecutive hit, the verdict records the oscillation
  call + reason, and the exit switches from "dispatch fixes, next round" to a
  redesign of the mechanism — orchestrator decides autonomously (no user
  approval point; the review-fix loop is the wrong tool for a design defect).
  A redesign that deletes machinery or changes a cross-system contract goes
  through Layer 0 (`smart-plan` Phase 4). The reworked design re-enters THIS
  gate on the **next monotonic round label** (`-rN+1` — never reuse/overwrite
  earlier labels) with the **round counter NOT reset** (the oscillation already
  spent those rounds; a reset would bypass the 8-round backstop); because the
  round reviews a new design, it is a first-look round for seating — the
  second seat returns for it (Seat cadence). The 8-round cap below stays as
  the backstop for everything else.
- **Escalation cap: 8 real rounds without GREEN → STOP, escalate to the user**
  (continue / restructure spec / abort). Never auto-green, never grind past.
