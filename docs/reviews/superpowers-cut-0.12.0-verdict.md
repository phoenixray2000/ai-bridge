# superpowers-cut-0.12.0 — verdict:GREEN(R9 用户批准确认轮)

## 锚定(命令输出,本轮实跑)

`git diff --stat HEAD` 尾部(写本文件前实跑):

```
 scripts/check-review-evidence.mjs                  |  2 +-
 skills/route/SKILL.md                              | 44 ++++++++++++++++--
 skills/smart-plan/SKILL.md                         | 54 ++++++++++++++++++++--
 skills/xreview/SKILL.md                            |  4 +-
 20 files changed, 124 insertions(+), 21 deletions(-)
```

vendor 在场:GPT 8 份证据文件(superpowers-cut-0.12.0-gpt{,-r2..-r8}.md)全部非空在盘。Gemini 未入席(skill 文本 dogfood 惯例 GPT-solo,同 slim-0.11.0)。

## 改动内容

superpowers 依赖退役:smart-plan Phase 1 grilling+回写仪式、Phase 2 内建 plan 格式(替代 writing-plans)、Phase 3 格式机械检查、route Step 4 TDD 执行契约、`docs/superpowers/`→`docs/reviews` hard-cut、methodology §8、版本 0.12.0。

## 收敛轨迹(全部 whole-diff 轮)

| 轮 | findings | 裁决 |
|---|---|---|
| R1 | 3 MAJOR(验收条款不可判定/Phase 3 不接格式/执行契约丢「实现后见绿」) | 全采纳 |
| R2 | 1 MAJOR(Phase 3 漏 goal+phase 归属) | 采纳 |
| R3 | 1 MAJOR(丢逐 task commit 规则→dirty-tree guard 卡死) | 采纳 |
| R4 | 4 MAJOR(plan 未落盘/无 no-placeholder/只读 task 与 TDD+commit 矛盾/evidence 卡 guard) | 全采纳(收敛式) |
| R5 | 1 MAJOR(首次派发前 plan+L0 evidence 即脏树) | 采纳 |
| R6 | 2 MAJOR(global constraints 丢失/resume 与收尾 evidence 生命周期) | #1 部分采纳(constraints 进 header;**Consumes/Produces 驳回**:L0 维度4 判断职责,从未用过的机制,additive gate);#2 采纳 |
| R7 | 3 MAJOR(Phase 3 漏查 constraints/派发漏带 constraints/L2 evidence 同族) | 全采纳 |
| R8 | 1 MAJOR(红轮 evidence 先写后派修复,仍卡 guard) | 采纳,已修(收成 CLEAN-TREE INVARIANT 单一不变式) |

**轨迹判读**:R3 起全部 findings 收敛于同一主题——dirty-tree guard × 仓内 evidence 落盘的生命周期;每轮是上一轮补丁的更小同族缺口,R8 修复以单一不变式(任何写仓步骤以 commit 收尾、每次 fresh 派发从净树出发、on-red resume 唯一豁免)从根源封族。架构未震荡,无 scope-creep(唯一加法型提案已驳回)。

## 状态

R8 = NEEDS-FIX;其 fix(CLEAN-TREE INVARIANT)应用后按 8 轮硬顶规则停环上报,用户批准 R9 确认轮。

**R9(2026-07-14,用户批准,超顶合规):`git diff bc714cd..HEAD`(commit 8670c5b,29 files, +278/-21,写前实跑)全量复审 → No findings,VERDICT: GREEN**(evidence: superpowers-cut-0.12.0-gpt-r9.md 非空在盘)。SMOKE PASS。终态 GREEN,0.12.0 放行部署。
