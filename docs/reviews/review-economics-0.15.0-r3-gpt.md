# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\Git\ai-bridge)
- written: 2026-07-17T06:21:25.965Z

---
[MAJOR] skills/xreview/SKILL.md:115 — “later rounds never need”物化 diff 与 `-gpt` 下 R1 面板全轮保持不变相冲突；Gemini 在 R2+ 仍入席却拿不到 diff，`skills/smart-plan/SKILL.md:158` 也遗漏了 plan R2+ delta 文件 → 规定每个 Gemini 入席轮都生成独立的当轮物化 diff（尤其 `-gpt` R2+），仲裁后删除且禁止跨轮复用，并同步 smart-plan 的 delta 指令。

[MAJOR] skills/smart-plan/SKILL.md:190 — Layer-0 仍固定使用 `plan-<name>-<vendor>.md` 和 `plan-<name>-verdict.md`，与 xreview 要求 R2+ 使用独立 round label 相冲突；实际写入会覆盖旧轮证据，或使 checker 的当轮 label 找不到对应 verdict → 改为直接遵循 xreview 的当轮 label：R1 使用根 label，R2+ 使用 `-rN`，证据与该轮仲裁文件均采用同一 label。

VERDICT: NEEDS-FIX
