# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-16T12:52:21.796Z

---
我会使用 `codebase-recon` 做全量差异与行为链路复核，严格只审查、不改文件；最终答复将仅包含约定的 findings 和 verdict。

[MAJOR] src/vendors.mjs:807 — GPT 的 watchdog wedge 路径直接失败且从不重试，违反 Spec §4(b)“该 attempt 按可重试故障处理”及“误杀=一次有界重试”；一次启发式误判会直接打断强制 GPT gate → 为 GPT wedge 增加一次受同一 job deadline 和 60s 剩余预算门约束的重试，并补充离线回归测试

[MINOR] src/server.mjs:155 — `ai_exec_start.timeout_minutes` 仍被描述为 per-vendor kill timer，但 Gemini 执行任务已按 Spec §5 将其作为跨重试的 job-level budget，工具契约会误导调用方 → 改为明确说明重试消耗剩余预算且剩余不足 60s 时停止重试

VERDICT: NEEDS-FIX
