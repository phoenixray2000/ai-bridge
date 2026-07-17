# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\Git\ai-bridge)
- written: 2026-07-17T08:52:14.631Z

---
我会按 `codebase-recon` 的只读审查流程核验整个 diff、仲裁记录与相关历史；不会修改文件。

[MAJOR] README.md:120 — 接线示例把正常模式和 `-gpt` 分别硬编码为 `gpt,gemini` 与 `gemini,opus`，但 `gemini` 场景的 R1 面板实际为 `gpt,opus`、`gemini -gpt` 为 `opus`，且任何场景发生 R1 agy degrade 后都须移除 Gemini；照示例会要求不存在的证据并永久红闸，与 seated-vendors invocation rule 冲突 → 明确示例仅适用于对应的无降级场景，并规定所有模式的 `--vendors` 均取 R1 实际成功入席者，同时补明 `gemini` 场景及 R1 degrade 后的参数组合。

VERDICT: NEEDS-FIX
