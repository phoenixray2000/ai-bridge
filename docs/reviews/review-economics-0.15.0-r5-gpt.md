# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\Git\ai-bridge)
- written: 2026-07-17T06:36:34.348Z

---
[MAJOR] README.md:119 — `--vendors gpt,gemini` 后追加 `--gpt-dead` 仍会强制查找 GPT 证据，无法表示 `-gpt` 的降级 R1 面板，导致按示例接线的 gate 必然失败；第 51 行还错误地无条件声称由 GPT 锚定 → 分别列出正常模式与 `-gpt` 模式的接线示例，明确 `--vendors` 必须匹配该 gate 的实际 R1 面板，并将 agy 降级说明改为由剩余席位锚定（正常为 GPT，`-gpt` 为 Opus）
VERDICT: NEEDS-FIX
