# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-13T17:28:47.397Z

---
我将使用 codebase-recon 技能核实整个 `git diff HEAD`、相关现有契约与历史意图；全程只读，不修改任何文件。

[MAJOR] skills/smart-plan/SKILL.md:103 — Phase 3 的 header 检查漏掉了 Phase 2 强制要求的 `GLOBAL CONSTRAINTS`，缺失平台限制或 redlines 的计划仍能机械放行 → 将“逐字携带 spec 的 GLOBAL CONSTRAINTS”加入 Phase 3 必填项检查

[MAJOR] skills/route/SKILL.md:90 — Claude executor 只收到 plan task verbatim，而 GLOBAL CONSTRAINTS 仅位于 plan header；clean-window executor 实际看不到这些约束 → 规定每个 execute-class 派发都同时携带 header 的 GLOBAL CONSTRAINTS、目标 task 与 execution contract，或明确引用并读取 pinned plan 的这两部分

[MAJOR] skills/route/SKILL.md:161 — task GREEN 后的 checkpoint 发生在 L2 phase-boundary xreview 之前；L2 在已提交 task 上生成 evidence/verdict 后若直接 GREEN，这些文件会使工作树变脏并阻断下一次 `ai_exec` → 在每个 L2 仲裁结束后增加 checkpoint，提交该 gate 的 evidence/verdict 及相关修复并断言 clean，再派发下一 task
VERDICT: NEEDS-FIX
