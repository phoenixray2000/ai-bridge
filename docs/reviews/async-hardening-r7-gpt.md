# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-16T13:19:54.736Z

---
我会按 `codebase-recon` 的证据链做整份 diff 的独立审查；本轮只读，不修改任何文件，最终严格按你给定的 findings/verdict 合约输出。

[MAJOR] src/vendors.mjs:848 — Gemini exec 因 wedge 停止重试后落入 review 专用的 “SKIP this Gemini seat” 错误分支，既隐藏 partial stdout/stderr，也未提示检查可能已被修改的工作树，违反 R6 的安全处置约定 → 在 exec wedge 分支直接返回 role-specific 失败，保留 stdout/stderr，并明确要求检查 cwd 后再决定是否继续。

[MINOR] src/vendors.mjs:287 — `lastOutputAt` 在尚无任何 stdout 时就初始化为启动时间，导致诊断面板永远不会显示 “never”；R6 后 stderr 活跃时还会被误称为 “last output” → 将最后 stdout 时间初始化为 null，单独保留 watchdog 静默基线，并在状态面板明确显示 “last stdout”。

[MINOR] DESIGN.md:83 — 设计文档仍宣称 wedge attempt 会预算内重试，README.md:66 也作同样承诺，但 R6 已规定 exec wedge 不得自动重试 → 同步两处文档，明确只有 review/digest 可有界重试，exec 直接失败并要求人工检查工作树。

VERDICT: NEEDS-FIX
