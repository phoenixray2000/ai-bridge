# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-15T18:44:25.575Z

---
[MAJOR] src/jobs.mjs:240 — `findRunning` 已持有请求 key 的锁，却会对所有 job 调用 `readJob`；对账无关 stale job 时又获取另一 key 锁，两个 MCP 进程分别持有 A/B 锁即可形成交叉等待，导致并行 start 中至少一方报 `key lock busy` → 锁内先严格读取 `job.json` 并按目标 key 过滤，只对同 key job 执行活性对账；无关 job 的对账移到锁外。

[MAJOR] src/jobs.mjs:150 — stale-steal 仅按 30 秒目录 mtime 判定，未确认 holder 已死亡；而锁内 `findRunning` 是无时限的全目录扫描，活 holder 超过 30 秒后可被后来者 rename 掉，两者随即并发执行 check-then-create，重新允许双启动 → owner 记录可验证的进程创建身份，仅在确认 owner 已死亡时回收锁，禁止单凭租期年龄偷取活锁（grounding: DESIGN.md:61）。

[MAJOR] src/jobs.mjs:396 — “30 秒内 heartbeat”只能证明该 PID 曾属于 runner，不能证明取消时仍是同一进程；runner 在最后一次 heartbeat 后异常退出且 PID/PGID 被复用时，cancel 会杀掉无关进程树 → heartbeat 持久化不可复用的进程创建身份或 job nonce，并在 kill 前核验当前 PID/进程组仍匹配；不匹配时禁止 kill 并对账为 failed（grounding: src/jobs.mjs:20-22; DESIGN.md:77）。

[MINOR] scripts/smoke.mjs:199 — 所谓 pre-boot cancel 测试没有确保 cancel 先于 runner heartbeat；若子进程先启动，测试走的是正常 tree-kill 路径，即使 `markRunning` 重新无条件复活终态也可能通过 → 直接构造 starting job，先 `markTerminal(cancelled)`，再调用 `markRunning` 并断言拒绝且状态不变；现有端到端测试可作为补充，无需增加锁内 pause hook。

[MINOR] src/server.mjs:188 — 工具契约宣称 terminal result “stable and re-readable”，但 `gcOldJobs` 会在下一次 start 时删除超过 7 天的终态目录，旧 job_id 随后变成 unknown，与机械调用方看到的持久性承诺不一致 → 在工具描述、README 和 DESIGN 明确 7 天保留窗口及过期语义，或取消该自动删除策略。

VERDICT: NEEDS-FIX
