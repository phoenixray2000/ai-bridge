# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-16T13:34:16.012Z

---
[MINOR] README.md:66 — 文档声称 wedge watchdog 会保护并重试 digest，但 `ai_digest` 是同步调用且未传入 `teePath`/`onProgress`，实际不会启用 watchdog → 将 README.md 与 DESIGN.md:83 的 “review/digest” 改为 “review”，不要扩展 spec §4 明确限定在 runner 内的能力

[MINOR] src/vendors.mjs:813 — auto-denied 永久失败仅保留 stderr 前 600 字符，可能丢失实际签名及上下文，不满足 spec §7 的“error 附 stderr 原文”诊断契约 → 在结构化失败中返回完整 `stderr`，error 仅保留分类与物化 diff 指引

[MINOR] src/server.mjs:217 — R7 已将 watchdog 活性定义和状态面板改为 stdout-only，但 MCP 工具描述仍写 “last-output age”，会让调用方误以为 stderr 也会刷新活性 → 将描述及相邻注释统一改为 “last-stdout age”

VERDICT: GREEN
