# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-15T18:27:46.219Z

---
我将按 `codebase-recon` 的证据流程对 `git diff HEAD` 与新增文件做全量只读复审，并严格按指定格式交付结论。

[BLOCKER] src/job-runner.mjs:46 — runner 无条件把 `job.json` 改回 `running`；若 cancel 落在首个 heartbeat 前，它会先成功标记 `cancelled`，随后延迟启动的 runner 复活并执行，最终变成 `completed` → 将 `starting → running` 改为 key-lock 下的终态感知 CAS；发现已取消就立即退出，并增加确定性的 pre-heartbeat cancel 回归测试。

[MAJOR] src/jobs.mjs:184 — reconciler 绕过 `markTerminal` 和 key lock 直接写 `failed`，可覆盖并发先落盘的 `completed/cancelled`，破坏“终态先写者胜” → 通过锁内 fresh re-read 的统一终态 helper 对账；同时拆分 `findRunning` 的锁内读取，避免改造后发生同 key 重入。

[MAJOR] src/jobs.mjs:133 — stale-steal 是无所有权的 check-delete：两个等待者都可判定旧锁过期，后者会删除前者刚取得的新锁；旧 holder 的 `finally` 也会删除偷锁者的锁，使互斥失效并重新允许双启动 → 为 lease 写入唯一 owner token，过期回收采用原子 rename/claim，并仅允许 owner 释放自己的锁。

[MAJOR] src/jobs.mjs:73 — `readJson` 重试后把所有持续性 JSON 损坏、EACCES 和 I/O 错误都吞成 `null`；`findRunning` 因而会把不可读的在跑 job 当作不存在并重复启动 → 仅对 `ENOENT` 返回 `null`，瞬态重试耗尽后抛出最后错误并 fail loud；增加持久损坏 `job.json` 不得重启的测试。

[MAJOR] src/jobs.mjs:328 — Windows cancel 完全忽略 `taskkill` 的 `error/status`，即使拒绝访问或命令失败仍写入 `cancelled`，agent/vendor 可继续修改工作树 → 校验 kill 结果；失败时重新读取终态并响亮报错，不得宣称或落盘 `cancelled`，并以失败的 tree-kill stub 验证。

[MAJOR] src/jobs.mjs:331 — 非 Windows 分支只向 runner PID 发信号，runner 启动的 vendor 子进程会成为孤儿继续执行，与“kills the runner's whole process tree”契约冲突 → 使用独立进程组并终止整个组，增加 descendant 存活断言测试（grounding: src/server.mjs:193-194; DESIGN.md:77）。

[MAJOR] src/jobs.mjs:107 — 幂等键遗漏会改变执行行为的 `timeoutMs`；用更长 `timeout_minutes` 重发会命中旧 job，而 `startedText` 却显示新 timeout，机械调用方会误以为 kill timer 已延长 → 将 `timeoutMs` 纳入 key，或复用时返回并展示原 job 的真实请求参数。

[MINOR] scripts/smoke.mjs:183 — 两个 helper 仅被同时 spawn，没有 barrier 强制它们在 check-before-create 窗口重叠；即使移除 mutex，常见的串行调度仍可让该测试通过 → 增加进程 ready barrier 和锁内测试暂停点，确定性证明两个 contender 无法同时越过空查找（grounding: src/jobs.mjs:14-16）。

VERDICT: NEEDS-FIX
