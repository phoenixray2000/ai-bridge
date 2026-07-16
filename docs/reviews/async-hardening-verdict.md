# async-jobs hardening — dogfood review verdict (GPT whole-diff loop)

Spec: `docs/specs/async-jobs-hardening-spec.md` (8 items).
Panel: GPT high solo (dogfood loop per spec 执行惯例; Gemini seat not applicable —
this diff IS the change that makes the Gemini seat viable for whole-batch review).

## Round 1 — 2026-07-16

Diff header (`git diff --stat e5788d5..HEAD`, pasted from command output this round):

```
 scripts/smoke.mjs          | 250 +++++++++++++++++++++++++++++++++++++-
 skills/route/SKILL.md      |   6 +-
 skills/smart-plan/SKILL.md |  12 +-
 skills/xreview/SKILL.md    |  52 ++++++--
 src/job-runner.mjs         |  35 ++++++
 src/jobs.mjs               |  44 +++++++
 src/server.mjs             |  71 +++++++++--
 src/vendors.mjs            | 291 +++++++++++++++++++++++++++++++++++++++++----
 8 files changed, 711 insertions(+), 50 deletions(-)
```

Evidence: `async-hardening-r1-gpt.md` (job 2026-07-16T05-49-03-353Z-review-gpt-e7c55c,
non-empty, this round). GPT verdict: NEEDS-FIX (7 MAJOR, 1 MINOR).

| # | finding | severity | ruling | reason |
|---|---|---|---|---|
| 1 | killTree fire-and-forget; wedge/timeout kill may fail silently, attempt escapes budget | MAJOR | **ACCEPT (partial)** | Real: watchdog now depends on kill actually working; a failed kill leaves run() unresolved until the ceiling. Fix: Windows switches to spawnSync taskkill with status check + root-kill fallback. POSIX single-root kill is pre-existing 0.13 behavior on a non-deployed platform — annotated, not rebuilt (additive gate). |
| 2 | probe setTimeout uncancelable: runner lingers up to probeGapMs after close; stale probe can interleave with a new probe (state crosstalk) | MAJOR | **ACCEPT** | Both halves verified in code: the awaited sleep holds the event loop post-close, and `wdState !== "probing"` cannot distinguish MY probe from a NEWER probe. Fix: cancelable sleep (cleared+woken on finish) + probe generation counter. |
| 3 | negative CPU delta (child of the tree exiting) counts as a flat delta → healthy vendor killed | MAJOR | **ACCEPT** | Tree-sum drops when a subprocess exits; that is process-structure activity, not death. Fix: only \|delta\| ≤ tolerance counts as flat; any significant move (either sign) backs off to observing. |
| 4 | 60s retry floor checked only BEFORE backoff; sleep/suspend across backoff can start an attempt with no budget | MAJOR | **ACCEPT** | Real (system-sleep is a known local failure mode). Fix: re-check remaining budget after the backoff sleep. |
| 5 | auto-denied stderr signature only checked in the exit-0 branch; nonzero exit + same signature retries (2nd cold start) | MAJOR | **ACCEPT** | The observed incident was exit-0, but the signature means the same permanent condition regardless of exit code. Fix: check the signature on every non-success result before any retry/recovery. |
| 6 | idempotencyKey unconditionally adds expect_verdict:false → every pre-0.14 in-flight job unrecoverable by key (review double-launch; exec eaten by dirty-tree guard) | MAJOR | **ACCEPT** | Cross-version key stability is exactly what the key exists for. Fix: add the discriminator ONLY when expect_verdict is true; false/absent hashes identically to 0.13. |
| 7 | ai_review_start tool description still says "the reviewer reads files and runs git itself" — contradicts the Gemini materialized-diff rule (§8) | MAJOR | **ACCEPT** | Tool text is what the orchestrator model actually reads at call time; a contradictory description re-creates the incident. Fix: vendor-specific description. |
| 8 | VERDICT last-line check trims leading whitespace — looser than the spec regex `^VERDICT: ...` | MINOR | **ACCEPT** | Spec pins the anchored regex on the last non-empty line. Fix: locate the last non-empty line, strip only the trailing EOL, match the anchored regex against the raw line. |

Dispatch: all 8 fixed in this round's follow-up commit (orchestrator direct — single-file-scale
edits, subtle concurrency fixes stay in the author session). New regression tests: nonzero-exit
signature, cross-version key stability, leading-whitespace VERDICT, negative-delta probe.
R1 fixes landed as fb55b8d.

## Round 2 — 2026-07-16

Whole diff re-reviewed afresh (e5788d5..fb55b8d + evidence commits). Evidence:
`async-hardening-r2-gpt.md` (job 2026-07-16T06-05-17-973Z-review-gpt-aa68bb, non-empty,
this round). GPT verdict: NEEDS-FIX (4 MAJOR, 2 MINOR).

| # | finding | severity | ruling | reason |
|---|---|---|---|---|
| 1 | probe generations share a single probeTimer/probeWake handle — an old probe's pending sleep survives replacement; runner can linger ≤probeGapMs post-close | MAJOR | **ACCEPT** | Verified: the R1 fix only cancels the LATEST sleep. Fix: pending sleeps tracked as a Set, canceled on mid-probe output AND on finish. |
| 2 | `git diff ... > file` in the skill/tool texts re-encodes to UTF-16 under PS5.1 (Out-File default), corrupting the materialized diff | MAJOR | **ACCEPT** | Real and nasty — the primary shell here IS PS5.1. Fix: `git diff --output=<file>` everywhere (xreview, smart-plan, server tool text, vendors error guidance). |
| 3 | listJobs swallows ALL readdir errors into an empty list — EPERM/EIO reads as "no jobs", defeating the anti-double-launch purpose | MAJOR | **ACCEPT** | Fix: ENOENT → empty list; anything else throws (guarded handler surfaces it). |
| 4 | README/DESIGN drift: "reviewer runs git itself", closing-gate 60min advice, wait_seconds=120, missing ai_job_list/expect_verdict | MAJOR | **ACCEPT** | Docs are what a caller actually follows. Fix: README table/reliability/usage-notes + DESIGN §5 synced to the 0.14 contract. |
| 5 | run() full-trims stdout — an output that IS just "  VERDICT: GREEN" gets normalized past the raw-line anchor | MINOR | **ACCEPT** | Fix: stdout trimEnd only; gemini emptiness test trims both ends explicitly. Regression test added. |
| 6 | ai_job_status hides progress diagnostics on terminal states — exactly when a wedge post-mortem needs them | MINOR | **ACCEPT** | Fix: progress shown for terminal states too, next-step hint kept. |

Dispatch: all 6 fixed (orchestrator direct). R2 fixes landed as f7155b7.

## Round 3 — 2026-07-16

Whole diff re-reviewed afresh. Evidence: `async-hardening-r3-gpt.md`
(job 2026-07-16T12-13-00-770Z-review-gpt-3ec46e, non-empty, this round).
GPT verdict: NEEDS-FIX (2 MAJOR, 3 MINOR).

| # | finding | severity | ruling | reason |
|---|---|---|---|---|
| 1 | `git diff --output` does not create parent dirs — first run in a fresh consuming repo fails | MAJOR | **ACCEPT** | Fix: xreview + smart-plan instruct ensuring the dir exists first. |
| 2 | progress.json reset per attempt — attempt 2 overwrites attempt 1's wedge diagnostics | MAJOR | **ACCEPT** | Fix: callVendor aggregates — each payload carries its attempt number + prior attempts' final snapshots; ai_job_status renders them. |
| 3 | wedge env knobs unvalidated — NaN/Infinity degrade Node timers to ~1ms spins | MINOR | **ACCEPT** | Fix: finite-positive validation with fallback to defaults. |
| 4 | skills/gpt + methodology still say 120s long-poll | MINOR | **ACCEPT** | Fix: synced to 300s. |
| 5 | README/DESIGN say "two samples" while the implementation takes baseline + two (three samples, two deltas) | MINOR | **ACCEPT** | Fix: wording corrected in both. |

Dispatch: all 5 fixed (orchestrator direct). R3 fixes landed as 0252aca.

## Round 4 — 2026-07-16

Whole diff re-reviewed afresh. Evidence: `async-hardening-r4-gpt.md`
(job 2026-07-16T12-32-53-877Z-review-gpt-fd73ad, non-empty, this round).
GPT verdict: NEEDS-FIX (2 MAJOR, 1 MINOR).

| # | finding | severity | ruling | reason |
|---|---|---|---|---|
| 1 | a stale async CPU probe resolving after finish() still pushes samples + emits progress — can overwrite the next attempt's / terminal progress.json | MAJOR | **ACCEPT** | Fix: emitProgress refuses once settled; finish emits the final snapshot BEFORE closing the gate; sample() drops stale results. |
| 2 | probe child process has no timeout and an undrained stderr pipe — a hung Get-CimInstance freezes "probing" forever and holds the runner alive | MAJOR | **ACCEPT** | Fix: 20s hard timeout (kill + inconclusive), stderr ignored. |
| 3 | envMs accepts values past 2^31-1 — Node timer overflow fires at ~1ms (instant sampling, false wedge) | MINOR | **ACCEPT** | Fix: upper bound clamp with fallback to default. |

Dispatch: all 3 fixed (orchestrator direct). R4 fixes landed as 8de2ced.

## Round 5 — 2026-07-16

Whole diff re-reviewed afresh. Evidence: `async-hardening-r5-gpt.md`
(job 2026-07-16T12-45-11-665Z-review-gpt-98427c, non-empty, this round).
GPT verdict: NEEDS-FIX (1 MAJOR, 1 MINOR).

| # | finding | severity | ruling | reason |
|---|---|---|---|---|
| 1 | GPT wedge kill fails outright, never retries — spec #4b says a wedge is a retryable fault ("误杀=一次有界重试"), and a false kill dead-ends a mandatory-GPT gate | MAJOR | **ACCEPT** | Fix: gpt leg gets ONE wedge-only retry within the same job budget (60s floor, remainder-only, no backoff needed — codex has no OAuth clustering risk); progress payloads carry attempt + prior snapshot. Offline tests: retry-success, double-wedge fail after exactly 2, no-retry under the floor. |
| 2 | ai_exec_start timeout_minutes description still reads per-vendor kill timer, not job-level budget | MINOR | **ACCEPT** | Fix: description synced to budget semantics. |

Dispatch: both fixed (orchestrator direct).
