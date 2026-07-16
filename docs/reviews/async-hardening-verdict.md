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
