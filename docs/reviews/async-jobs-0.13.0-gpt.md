# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-15T18:12:18.512Z

---
我会按 `codebase-recon` 的证据优先流程审查未提交差异，并严格保持只读；最终仅输出约定的 findings 与 verdict。

[BLOCKER] src/jobs.mjs:164 — 幂等检查与任务创建是无跨进程锁的 check-then-act；两个 MCP server 同时重试时可双双通过检查并各自启动 agy，直接破坏“绝不双发”的核心安全约束 → 用按 key 的原子 claim/跨进程锁包住查找与创建，原子发布唯一 job_id，并增加双进程 barrier 并发测试。

[MAJOR] src/server.mjs:127 — `ai_exec_start` 在幂等查找前执行 dirty-tree guard；运行中的原任务一旦写脏工作树，相同参数的重试会被 guard 拒绝，无法返回原 job_id → 先在原子 key claim 内查找现有运行任务，仅由新任务的获胜创建者执行 guard，guard 失败时释放 claim。

[MAJOR] src/jobs.mjs:183 — runner 已启动后 server 才首次写 `job.json`；runner 可先写稀疏 `running/completed` 状态，随后被 server 覆盖成 `starting`，或反向覆盖并丢失 id/key/started_at/evidence_path，最终可能误报 FAILED、重复启动或导致结果读取异常 → spawn 前写完整初始元数据，建立明确的 ready/ownership 协议，再由单一受控状态机补 PID 和推进状态。

[MAJOR] src/jobs.mjs:41 — `writeJson` 先删除正式文件再 rename，制造可见缺口；失败后又直接覆盖并吞掉所有异常，而 `readJob` 会把缺失/半写 JSON 立即当作 unknown job，因此可能返回不存在的已启动任务或把永久缺失的 result 标成 completed → 实现带重试且失败可传播的原子替换，读取端区分真实不存在与瞬时解析失败并重试，result 持久化失败时不得写 completed。

[BLOCKER] src/jobs.mjs:58 — 活性判断只验证数值 PID；PID 被复用时死任务会永久显示 running，而 `ai_job_cancel` 会对复用后的无关进程执行 `taskkill /T /F` → 持久化并核验进程创建时间、runner 命令行/job nonce 等不可复用身份；身份不匹配时对账为 FAILED，禁止 kill。

[MAJOR] src/jobs.mjs:208 — cancel 使用一次陈旧读取，忽略 `taskkill` 退出状态并无条件写 cancelled；它可覆盖刚完成的 terminal 状态，或在 kill 失败、vendor 仍运行时谎报取消，之后 runner 还能把 cancelled 改回 completed → runner 与 canceller 通过同一跨进程锁/CAS 推进终态，检查 kill 结果并重新读取状态，仅在确认目标身份及退出后写 cancelled。

[MAJOR] src/jobs.mjs:27 — 未校验的 `job_id` 直接参与 `path.join`；含 `..` 的输入可越出 jobs root，读取或覆写其他目录中的 `job.json/result.json`，并可借伪造 PID 触发 taskkill → 对所有公开 job 操作使用严格 job-id 格式校验，并在解析后断言路径仍位于 jobs root 内。

[MINOR] scripts/smoke.mjs:153 — 幂等测试只在单进程内顺序调用，取消测试只断言即时状态；即使存在跨 server 双启动、spawn/init 覆盖、kill 失败或 terminal 回写竞态，测试仍会通过 → 用独立 Node 进程同步起跑测试唯一 job，注入初始化/终态竞态，并在 fake delay 之后验证取消状态稳定且进程确已退出。

[MINOR] DESIGN.md:103 — 活跃文档仍指示编排调用已移除的 `ai_exec`；`docs/model-selection-methodology.md:172`、DESIGN.md:21 及两个 plugin manifest 描述也仍保留旧工具名 → 将所有非历史记录统一改为 `ai_exec_start`/`ai_review_start` 加 `ai_job_result` 收集流程，并补入 jobs/runner 模块说明。

VERDICT: NEEDS-FIX
