# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\Git\ai-bridge)
- written: 2026-07-17T06:14:04.329Z

---
我将使用 `codebase-recon` 做全量 diff 复审；全程只读，不修改文件。

[MAJOR] skills/route/SKILL.md:211 — 仍要求 materialized diff 等整个 gate 关闭后才删除，与本文件第 216–217 行及 xreview 的“Gemini 入席轮仲裁后、checkpoint 前删除”规则冲突，会破坏 CLEAN-TREE INVARIANT → 删除该旧生命周期表述，仅引用 xreview Gemini-seat 生命周期 SPOT。

[MAJOR] skills/xreview/SKILL.md:40 — `-gpt` 例外被写成 Gemini + Opus 全轮双席，但同文件第 22 行规定 `gemini -gpt` 只有 Opus 单席，Seat cadence SPOT 对该场景产生冲突 → 改为“降级后的 R1 面板原样保持至所有轮次”，并明确 `gemini -gpt` 始终为 Opus-only、持续标记 thin；同步勘误指针的“双席”措辞。

[MAJOR] skills/xreview/SKILL.md:247 — 仅将“跨系统 contract”变更送回 Layer 0，放过了其他 contract-changing redesign，与验收合同要求的所有 contract-changing redesign 均过 smart-plan Layer 0 不符 → 去掉 `cross-system` 限定，规定任何 machinery-deleting 或 contract-changing redesign 都先过 Layer 0，再从 R1 重入。

[MAJOR] skills/smart-plan/SKILL.md:142 — 仍在本地复述“Gemini 只坐首轮”及第 149–152 行的降级席位组成，而不是纯粹委托 xreview SPOT；这正是 R1 finding 6 要消除的双源规则，后续可再次与 `-gpt`/场景例外漂移 → 保留 plan-review 固定 R1 面板这一特有规则，其余 cadence 与 agy degrade 仅引用 xreview 对应 SPOT，不复述席位组成。

VERDICT: NEEDS-FIX
