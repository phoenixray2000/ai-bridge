# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-16T12:24:12.331Z

---
我会使用 `codebase-recon` 做整段 diff 的独立、证据化复审，并严格保持只读。最终回复仅包含 findings 与 VERDICT。

[MAJOR] skills/xreview/SKILL.md:87 — Spec §8 的物化命令未先创建 `docs/reviews`；首次在尚无该目录的消费仓运行时，`git diff --output=...` 必然失败，Gemini gate 无法启动 → 在 xreview 与 smart-plan 流程中先确保父目录存在，再生成物化 diff（grounding: spec §8）。

[MAJOR] src/vendors.mjs:268 — `stdoutBytes`、`cpuSamples` 和 watchdog 状态均在每次 `run()` 时重置；Gemini 重试会用 attempt 2 的数据覆盖 attempt 1 的 wedge 诊断，终态状态页既非累计字节，也丢失首次判死记录 → 在 `callVendor`/runner 层聚合各 attempt 的进度后再写 `progress.json`，保留累计字节和采样历史（grounding: spec §4c）。

[MINOR] src/vendors.mjs:275 — 两个公开 watchdog 环境变量未经有限正数校验；非数字或 `Infinity` 会令 Node 定时器退化为近即时轮询/采样，造成 CPU 空转或误判 wedge → 解析后用 `Number.isFinite` 校验并对非法值 fail loud 或采用明确默认值。

[MINOR] skills/gpt/SKILL.md:16 — 活跃行为 skill 仍宣称 `ai_job_result` long-poll 为 120s，且 `docs/model-selection-methodology.md:267` 保留同一旧值，与 schema 和 Spec §2 的 300s 不一致 → 将所有现行调用文档一次性统一为 300s。

[MINOR] README.md:64 — 文档称“CPU 采样两次”却又要求“两次 flat delta”；实现和 smoke 实际需要基线加两次后续采样，共三次，DESIGN.md:81 也有相同矛盾 → 明确写成“三次采样、形成两个间隔增量”。

VERDICT: NEEDS-FIX
