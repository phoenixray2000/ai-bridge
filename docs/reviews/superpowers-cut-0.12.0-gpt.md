# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-13T16:52:57.852Z

---
我会按 `codebase-recon` 的证据流程核对未提交 diff、变更前版本与全仓引用；只审查，不修改文件。

[MAJOR] skills/smart-plan/SKILL.md:51 — 内建格式只要求引用 spec section，未要求 `route` 托管回环和 Phase 4 所需的可判定 spec check，计划可能只有“测试通过 + 章节编号”而没有需求验收条件 → 为每个 task 增加显式 acceptance/spec check，写明证明对应 spec 条款成立的可观察结果

[MAJOR] skills/smart-plan/SKILL.md:87 — Phase 3 没有检查新内建格式的必填项，缺失 plan-base、goal、anchors、steps、verify observable 或 spec 映射的计划仍可通过机械出口，且缺 plan-base 会直接破坏 Closing gate 的全量 diff → 将 Phase 2 定义的全部 header/task 字段逐项加入 Phase 3 bounce 清单

[MAJOR] skills/route/SKILL.md:105 — 用 Execution contract 替换旧 L1 的 `failing test → implement → pass` 后，只保留了实现前 RED，丢失实现后重跑同一测试并观察 GREEN 的硬规则；“之后跑 verify”不能证明执行者完成了红绿闭环 → 在第 1 条中明确要求实现后重跑同一测试至通过，再运行完整 verify

VERDICT: NEEDS-FIX
