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

## Round 2 (2026-07-17)

Whole-diff re-review of `170d809..HEAD` (post-R1-fix). Evidence:
review-economics-0.15.0-r2-gpt.md (non-empty, this round; GPT-solo per dogfood
convention). Fix-stage diff header (git diff --stat, run at arbitration):

```
 docs/model-selection-methodology.md | 2 +-
 skills/route/SKILL.md               | 4 ++--
 skills/smart-plan/SKILL.md          | 6 +++---
 skills/xreview/SKILL.md             | 5 +++--
 4 files changed, 9 insertions(+), 8 deletions(-)
```

| # | finding | ruling |
|---|---|---|
| 1 | [MAJOR] route closing-gate step 1 still says "delete that diff file when the gate closes" — conflicts with the new Gemini-seated-round lifecycle | **ACCEPT** — defer to xreview lifecycle |
| 2 | [MAJOR] xreview Seat-cadence -gpt exception phrased "keeps both seats" — conflicts with `gemini -gpt` = Opus-only panel | **ACCEPT** — rephrased as "degraded R1 panel carries unchanged through all rounds"; methodology errata synced |
| 3 | [MAJOR] oscillation exit limits Layer-0 routing to CROSS-SYSTEM contract changes; reviewer wants ALL contract-changing redesigns | **REJECT** — the authoritative agreement (user, 2026-07-17) scopes Layer-0 to machinery-deletion OR cross-system contract change; the reviewer graded against drifted prompt wording, not the contract. Local redesigns are covered by gate re-entry at R1. |
| 4 | [MAJOR] smart-plan still restates cadence + degrade composition locally | **PARTIAL ACCEPT** — composition restatements stripped (flake line now pure delegation); the plan-gate MAPPING ("here that means plan-track R1 / closing R1") stays — it maps which gates exist in the plan flow, it does not duplicate composition; plan-review's fixed R1 panel stays (reviewer itself marked it plan-specific) |

Round verdict: NEEDS-FIX → dispatch fixes, R3 re-review.

## Round 3 (2026-07-17)

Whole-diff re-review of `170d809..HEAD`. Evidence:
review-economics-0.15.0-r3-gpt.md (non-empty, this round; GPT-solo). Fix-stage
diff header (git diff --stat, run at arbitration):

```
 skills/smart-plan/SKILL.md | 15 +++++++++------
 skills/xreview/SKILL.md    |  8 +++++---
 2 files changed, 14 insertions(+), 9 deletions(-)
```

| # | finding | ruling |
|---|---|---|
| 1 | [MAJOR] materialized-diff lifecycle said "later rounds never need it" — false under -gpt (Gemini seated R2+); smart-plan's file list same gap | **ACCEPT** — every Gemini-seated round materializes its own per-round diff, no cross-round reuse; smart-plan synced |
| 2 | [MAJOR] smart-plan Layer-0 evidence naming fixed at `plan-<name>-<vendor>.md`, conflicting with per-round labels | **ACCEPT** — R2+ evidence uses `plan-<name>-rN-<vendor>.md`; the single `plan-<name>-verdict.md` stays, its per-round sections cite that round's labeled files |

Round verdict: NEEDS-FIX → dispatch fixes, R4 re-review.

## Round 4 (2026-07-17)

Whole-diff re-review of `170d809..HEAD`. Evidence:
review-economics-0.15.0-r4-gpt.md (non-empty, this round; GPT-solo). Fix-stage
diff header (git diff --stat, run at arbitration):

```
 README.md               | 16 +++++++++++-----
 skills/xreview/SKILL.md |  8 ++++++--
 2 files changed, 17 insertions(+), 7 deletions(-)
```

| # | finding | ruling |
|---|---|---|
| 1 | [MAJOR] per-round labels vs single verdict vs checker's single --label derivation — R2+ label wiring can't find a verdict / root wiring "mis-verifies" R1 evidence | **PARTIAL ACCEPT** — resolved by pinning the convention in text: checker wires the gate's ROOT label (R1 evidence + single verdict; existence/shape only), round identity is the arbitration contract inside the verdict. Checker redesign REJECTED (additive; forward-only scope) |
| 2 | [MAJOR] materialized diff in docs/reviews = dirty tree at every Gemini-seated round's dispatch, violating CLEAN-TREE INVARIANT | **REJECT** — review-job launches are not guarded dispatches (the dirty-tree guard sits on `ai_exec_start`); mid-round evidence files are equally uncommitted, so the scratch adds no new dirty-state class; the lifecycle deletes it at arbitration, BEFORE any guarded fix dispatch or round commit. Relocation to a git-ignored dir is additive machinery with no failing scenario. |
| 3 | [MAJOR] README gate-wiring example still marks --verdict/--verdict-lines optional | **ACCEPT** — README updated: both mandatory on new wirings, legacy/ad-hoc exemption noted, ROOT-label wiring documented |

Round verdict: NEEDS-FIX → dispatch fixes, R5 re-review.
