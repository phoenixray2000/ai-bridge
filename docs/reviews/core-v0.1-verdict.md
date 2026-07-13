# core-v0.1 cross-vendor review — arbitration verdict

Reviewers: GPT 5.5 (high) + Gemini 3.1 Pro (high), filesystem-blind, material inline.
Arbiter: orchestrator (Fable, author). Date: 2026-06-11.

## Rejected (false positives)

| Finding | Source | Why rejected |
|---|---|---|
| [CRIT] `writeEvidence` not exported → module load fails | GPT | Artifact of my truncated review paste; real `vendors.mjs:397` exports it. Lesson: never trim review material. |
| [MED] `git status --porcelain` omits untracked | GPT | Factually wrong — porcelain shows untracked (`??`) by default. |

## Confirmed — fixed this round

| # | Finding | Source | Severity | Fix |
|---|---|---|---|---|
| 1 | `callVendor` gpt branch: `parseCodexJson`→null falls through to `ok:true` raw stdout | both | high | early-return error when `--json` yields no parseable events (fail loud) |
| 2 | `run`: `stdout += Buffer` corrupts multibyte UTF-8 split across chunks (mojibake) | Gemini | high | `setEncoding("utf8")` on both streams — critical for our Chinese I/O |
| 3 | `extractAnswerFromDb` longest-dup heuristic can return the **prompt** instead of the answer (review prompts are huge + echoed) | both | high | thread prompt through, exclude it from candidates; verify recovered answer ≠ prompt |
| 4 | `recoverAgyAnswer` cwd→id is global; **review passes no cwd → process.cwd() collision** under concurrency → wrong run's answer | both | high | select newest conversation db with mtime ≥ run start, verify prompt-marker presence, not cwd map |
| 5 | `embedFiles` checks size **after** `readFileSync` (whole file in memory first) | GPT | med | `statSync` size accumulate before read |
| 6 | `assertSafeExecCwd` reports "not a git repo" when git is missing (ENOENT) | Gemini | low | distinguish ENOENT → "git not installed/PATH" |
| 7 | `convId` from cache used as path component unchecked (traversal) | GPT | low | obsoleted by #4 (now from readdir of conversations dir); UUID-validate anyway |

## Confirmed — deferred (need empirical agy work, not blind change)

| # | Finding | Source | Why deferred |
|---|---|---|---|
| 8 | digest grants `--dangerously-skip-permissions`+`--add-dir` → write/exec for a read-only summarize | both | Real overreach. But removing it makes agy `-p` prompt-and-hang for dir scans. Fix = verify agy `--sandbox` works headless; until then digest defaults to embed-only (no fs) and dir-scan path is documented-risk. Backlog. |
| 9 | `run`/`killTree`: Unix kills only direct child (orphans), Windows taskkill unobserved → possible hang if it fails | GPT | Real robustness gap; needs detached process-group kill + secondary timeout. Backlog. |
| — | `run` unbounded stdout buffer | GPT | Bounded in practice (model output limits); backlog. |
| — | `protoStrings` over-permissive recursion | both | Root of #3; mitigated by #3's prompt-exclusion + targeted selection. Backlog: field-number-aware extraction. |

## Dispatch

All round-1 fixes are subtle author-side edits to ai-bridge's own recovery core → orchestrator direct (not dispatched to executor). Re-run `smoke:live` after.
