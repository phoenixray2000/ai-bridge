# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-06T05:06:33.419Z

---
[MAJOR] package.json:8 — `engines.node` 仍允许 Node 22.0–22.12，但运行时代码直接 `import { DatabaseSync } from "node:sqlite"` 且启动命令没有 `--experimental-sqlite`，这些被允许的版本会安装通过但 MCP server/smoke 无法启动 → 将 `package.json`、`package-lock.json` 和 README prerequisites 对齐为 `>=22.13.0`。

[MINOR] docs/model-selection-methodology.md:115 — 文档仍写旧 slash 前缀 `/ai-bridge:ai-model`，与插件名 `aibridge`、README 的 `/aibridge:*` 和 `check-review-evidence` 的 `/aibridge:xreview` 不一致；同文件第 194 行也有同样旧前缀 → 全部改为 `/aibridge:ai-model`。

VERDICT: NEEDS-FIX
