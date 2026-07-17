# review-economics-0.15.0 — arbitration verdict

Dogfood loop (GPT-solo, repo convention). Scope: uncommitted working-tree diff
across skills/xreview, skills/route, skills/smart-plan (seat cadence + oscillation
exit + verdict wiring + phase cap).

## Round 1 (2026-07-17)

Diff header (git diff --stat, run at arbitration):

```
 skills/route/SKILL.md      |  6 +++++-
 skills/smart-plan/SKILL.md | 23 ++++++++++++++---------
 skills/xreview/SKILL.md    | 40 +++++++++++++++++++++++++++++++++++++++-
 3 files changed, 58 insertions(+), 11 deletions(-)

(注:上稿曾手写此表被自查逮到,已用当场 `git diff --stat` 输出替换 — 锚点规则生效实录)
```

Evidence: review-economics-0.15.0-gpt.md (non-empty, this round). Gemini absent
(dogfood convention, GPT-solo).

| # | finding | ruling |
|---|---|---|
| 1 | [MAJOR] xreview:3 + :117 — frontmatter/"Start" line restate panel composition without the -gpt exception | **ACCEPT** — reference Seat cadence instead of restating |
| 2 | [MAJOR] xreview:59 — agy-failure path says "GPT-solo" unconditionally; undefined under -gpt | **ACCEPT** — add -gpt branch (Opus seat solo that round, mark thin) |
| 3 | [MAJOR] xreview:76 — evidence reuse across rounds could defeat "from THIS round" anchoring | **PARTIAL ACCEPT** — the de-facto per-round label convention (`<label>-rN`) becomes explicit text at evidence_path + anchoring; checker changes REJECTED (checker is invoked per-label; forward-only clause already scopes it; no new machinery — additive gate) |
| 4 | [MAJOR] xreview:109 — materialized diff deleted only "after the gate completes"; stale under cadence (Gemini sits R1 only); route:209 same | **ACCEPT** — delete after the Gemini-seated round's collection+arbitration; sync route |
| 5 | [MAJOR] route:69 + :213 — local cadence restatements omit -gpt exception (SPOT drift) | **ACCEPT** — defer to SPOT, drop restated composition |
| 6 | [MAJOR] smart-plan:142/:148/:161 — local cadence copy conflicts with -gpt panel; "Start both vendors" survives | **ACCEPT** — defer to SPOT; fix Start line; flake line points at degrade policy incl. -gpt |
| 7 | [MINOR] methodology doc stale cadence statements | **ACCEPT as dated errata note** — doc is rationale/history and self-disclaims vs skills; one dated pointer, no history rewrite |

Round verdict: NEEDS-FIX → dispatch fixes, R2 re-review.
