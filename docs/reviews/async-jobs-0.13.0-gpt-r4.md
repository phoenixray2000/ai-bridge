# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-15T18:56:16.422Z

---
[MAJOR] src/server.mjs:154 — `ai_exec_start` 的幂等查询与 dirty-tree guard 之间仍有竞态：并发重试可先查无任务，随后原任务启动并写脏仓库，重试便被 guard 拒绝且拿不到原 job_id，违反“运行中相同参数返回原 job_id”的契约 → guard 失败时再次执行 `findRunning(request)`，若原任务已出现则返回其 job_id，仅在仍查无时报告脏树错误。

[MAJOR] src/server.mjs:214 — `cancelJob` 在 PID identity mismatch 时返回 `ok + note` 并把任务对账为 failed，但 MCP handler 丢弃 note、无条件回复 `job ... cancelled`，与真实终态相反 → 根据返回的 note/state 输出“runner 已死亡、job 标记 failed”，仅在确实写入 cancelled 时回复 cancelled。

[MINOR] src/server.mjs:85 — reconciler 若恰在成功的 `result.json` 落盘后、completed 标记前发现 runner 死亡，会把 job 标记 failed；此处却把任意 result 都当作失败结构，最终输出 `undefined` 而不是契约承诺的 runner-log tail → 仅当 `result.ok === false` 时调用 `describeVendorFailure`，否则使用 `meta.error` 的 reconciler 诊断。

VERDICT: NEEDS-FIX
