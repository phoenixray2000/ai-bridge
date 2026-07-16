# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-16T12:42:22.442Z

---
我将按 `codebase-recon` 的证据流程审查整个指定 diff；只读，不修改文件，最终严格仅输出 findings 与 verdict。

[MAJOR] src/vendors.mjs:339 — 已结束 attempt 的异步 CPU probe 仍会追加样本并触发 `onProgress`；它可在下一 attempt 甚至 job 终态后覆盖 `progress.json`，使 R3 的 `priorAttempts` 聚合再次丢失或错乱（spec §4c） → probe 返回后先检查 `stale()`，并为 attempt 回调增加 active/generation guard，`runImpl` 返回后冻结该 attempt 的最终快照

[MAJOR] src/vendors.mjs:175 — CPU 探针子进程没有超时、取消或 stderr drain；`Get-CimInstance` 一旦挂起会让 watchdog 永久停在 `probing`，且 vendor 结束后仍可能把 detached runner 挂住，失去 spec §4b 的预算兜底 → 给探针子进程设置短超时并完整 drain 输出，跟踪活动探针，在 `finish()` 时终止并结算它

[MINOR] src/vendors.mjs:282 — `envMs` 接受任意有限正数，但 Node 对超过 `2^31-1` 的 timer 延迟会降为约 1ms；超大的 `AI_BRIDGE_WEDGE_PROBE_GAP_MS` 因而会把预期长间隔变成近乎即时的两次采样并可能误杀 → 将 timer 配置限制在 Node 支持的 `1..2^31-1` 范围，越界回退默认值并补 overflow 回归测试

VERDICT: NEEDS-FIX
