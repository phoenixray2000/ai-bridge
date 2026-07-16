# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-16T05:57:49.610Z

---
我会使用 `codebase-recon` 做证据驱动的全量 diff 审查；只读取规范、历史与当前实现并运行非修改性验证，不改任何文件。

[MAJOR] src/vendors.mjs:143 — `killTree` 在 Windows 上 fire-and-forget `taskkill` 且忽略失败，在 POSIX 只杀根进程；看门狗或超时可能无法终止进程树，使 attempt 逃逸 job 预算（spec §4/§5） → 等待并校验平台级进程树终止结果；Windows 检查 `taskkill` 退出状态并可靠回退，POSIX 使用独立进程组，终止确认前不得结束 kill 流程

[MAJOR] src/vendors.mjs:313 — CPU 探针间隔使用不可取消的 `setTimeout`；进程在 probing 中关闭后 `run()` 虽已 resolve，定时器仍让 detached runner 最多存活 5 分钟，且自定义阈值下旧探针可能与新探针串扰 → 将 probe delay 做成可取消且会完成等待的定时器，在 output/finish 时取消，并用 probe generation 隔离失效探针；补充 close-during-probe 回归测试

[MAJOR] src/vendors.mjs:318 — 代码仅把正向 CPU 增量视为活跃；子进程退出会使进程树累计 CPU 下降，负增量被错误当成“零增量”，可能斩杀健康 vendor → 只有绝对增量位于零容差内才累计 flat delta，任何显著正或负变化都应退回 observing；补充子进程退出导致总量下降的测试

[MAJOR] src/vendors.mjs:640 — 60 秒重试下限只在 backoff 前检查；backoff 实际超时或系统休眠后仍以 `Math.max(1, remainder)` 启动预算不足甚至已过 deadline 的新 attempt → backoff 完成后重新计算 remainder，并在构造参数及 spawn 前再次执行 `< MIN_RETRY_BUDGET_MS` 检查；测试非零 backoff 跨过下限的场景

[MAJOR] src/vendors.mjs:657 — auto-denied 永久失败识别位于 `if (r.ok)` 内；同一 stderr 签名若伴随非零退出码，会绕过识别并执行第二次 agy 冷启动，违反 spec §7 的“不重试、不恢复” → 对所有空 stdout 结果在 recovery/通用退出重试之前检查签名，并增加非零退出码用例

[MAJOR] src/jobs.mjs:123 — 无条件把 `expect_verdict:false` 加入 hash 基材会改变升级前所有 review 和 exec 的幂等键；0.14 服务无法找回仍在运行的 0.13 detached job，review 会重复启动，exec 还可能被已变脏工作树挡住 → 仅在 `expect_verdict === true` 时加入新 discriminator，使 false/缺省及非 review 请求保持原 key，同时固定跨版本 hash 回归测试

[MAJOR] src/server.mjs:99 — `ai_review_start` 的工具说明仍要求 reviewer 自己运行 git，并把 diff range 作为通用 prompt 输入；这与 Gemini 必须读取物化 diff、禁止运行命令的 spec §8 和 skill 规则直接矛盾，会复现本次 auto-denied 事故 → 将工具及 `prompt` 字段说明改为 vendor-specific：GPT 使用 live diff range 并运行 git，Gemini 只读取预先物化的 diff 文件且不得运行命令

[MINOR] src/job-runner.mjs:106 — 先对末行调用 `trim()` 再匹配，会接受带前导空白的 `VERDICT`，比 spec 指定的 `^VERDICT: ...\s*$` 和 skill 的“exactly”契约更宽松 → 用 trim 仅定位最后非空行，对保留前导空白的原始行应用规范 regex，并增加前导空白应失败的测试

VERDICT: NEEDS-FIX
