# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-06T04:53:06.588Z

---
[MAJOR] src/vendors.mjs:444 — Gemini degrade 的生产错误信息仍指示 “clean Opus fills it”，但当前 xreview/smart-plan 规则明确要求 agy 失败后 skip Gemini seat、never seat-swap；新 smoke 只断言 `/DEGRADE/`，不会抓到这个反向指令 → 把错误信息和上方注释改成 “skip this Gemini seat, GPT anchors, note absence”，并让 smoke 断言不再包含 clean-Opus/seat-swap 语义。

[MINOR] README.md:23 — README 仍写 GPT 使用 `read-only|workspace-write`，并在同段/Usage notes 继续描述 review inline/fs-blind，这与当前 `codexArgs()` 的 `danger-full-access`、`src/server.mjs` 的 by-reference review 描述和 xreview 规则不一致 → 更新 README 的 vendor mapping/usage notes：GPT 为 danger-full-access + git safety net，repo review 通过 `cwd` by reference，不再要求把完整 diff/code inline。

[MINOR] src/server.mjs:11 — MCP server metadata 仍暴露 version `0.1.0`，但 package/plugin/marketplace 已 bump 到 `0.11.0`，发布面版本不一致 → 将 server version 对齐到 `0.11.0`，或从 package metadata 派生。
VERDICT: NEEDS-FIX
