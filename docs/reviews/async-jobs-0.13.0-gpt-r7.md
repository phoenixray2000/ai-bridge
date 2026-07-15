# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-15T19:24:43.767Z

---
我会按 `codebase-recon` 的证据链做整份 diff 复审，只核验会真实破坏或误导机械执行的 BLOCKER/MAJOR；全程只读，不修改文件。

[MAJOR] src/jobs.mjs:453 — `readJob` 会保留“心跳过期但命令行身份仍匹配”的活 runner，然而 `cancelJob` 只使用新鲜 heartbeat 的 PID；此时会跳过 `killImpl`、直接写入 `cancelled`，实际 runner/vendor 进程树仍存活（已复现） → 对 `running` 且无新鲜 heartbeat 的任务，使用 `meta.pid ?? spawn.json.pid` 并经现有命令行身份校验后执行 tree-kill；仅确认杀死后写 `cancelled`，`starting` 的 pre-boot CAS 路径保持不变。

VERDICT: NEEDS-FIX
