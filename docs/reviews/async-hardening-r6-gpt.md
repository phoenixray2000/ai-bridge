# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-16T13:09:07.715Z

---
我会使用 `codebase-recon` 做整段 diff 的证据化复审；全程只读，不修改任何文件。

[MAJOR] src/vendors.mjs:657 — R5 在重试循环外只构造一次 Codex 参数，并在第二次 attempt 原样复用参数和 prompt；fresh exec 会另开会话重放可能已产生副作用的任务，带 `resume` 的 exec 则向原会话重复发送同一修正指令，可能重复非幂等操作（grounding: spec §4b） → wedge 后从首轮 JSONL 提取 `thread_id`，第二轮重建为针对该线程的 `exec resume` 并发送明确的继续指令，同时覆盖 fresh/resume exec 回归测试。

[MAJOR] src/vendors.mjs:443 — stderr 数据也进入 `onOutput()`，从而刷新 `lastOutputAt`、累计到 `stdoutBytes`，并中止 CPU 探针；周期性 stderr 会让 stdout 已静默且 CPU 持平的死连接永远绕过 spec §4b 看门狗，直到预算天花板 → 将 tee 与健康信号拆开：两条流都写日志，但仅 stdout 更新 `lastOutputAt`/`stdoutBytes`、取消探针，并增加 stderr-only 且 CPU-flat 的回归测试。

VERDICT: NEEDS-FIX
