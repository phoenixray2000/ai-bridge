# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-15T19:06:02.306Z

---
我会按 `codebase-recon` 的证据流程做整份 diff 复审；仅检查并验证，不修改任何文件。

[MAJOR] src/jobs.mjs:449 — 取消流程未正确处理 runner 在命令行核验前已退出的竞态：`alreadyGone` 会继续写成 `cancelled`，而 `identityMismatch` 分支忽略 `markTerminal` 的 CAS 结果，可能在实际终态已是 `completed` 时仍声称“marked failed”，违反 `DESIGN.md` 中“runner 死亡应 FAILED、终态先写者胜”的契约并误导机械编排 → 将 `alreadyGone` 与 `identityMismatch` 统一按 runner 已死亡对账为 `failed`，检查终态 CAS 返回值；若 CAS 已输给其他终态，则返回实际终态，只有确认杀死对应 runner 后才写 `cancelled`。

VERDICT: NEEDS-FIX
