# async-jobs-0.13.0 — verdict:GREEN(R8 收环)

## 锚定(命令输出,本轮实跑)

`git diff --cached --stat` 尾部(写本文件前实跑):

```
 src/server.mjs                           | 226 +++++++++++---
 src/vendors.mjs                          |  12 +-
 27 files changed, 1241 insertions(+), 115 deletions(-)
```

vendor 在场:GPT 8 份证据文件(async-jobs-0.13.0-gpt{,-r2..-r8}.md)全部非空在盘。GPT-solo dogfood(skill/插件自身变更惯例)。

## 改动内容

0.13.0:review/exec 硬切异步 job(`ai_review_start`/`ai_exec_start`/`ai_job_status`/`ai_job_result`(long-poll)/`ai_job_cancel`,digest 保持同步)。动因(已量实):stdio 空闲超时 30min 掐静默长审查、会话崩溃连坐管道内 vendor、harness 重试重复冷启 agy(OAuth 风控)。新增 src/jobs.mjs(落盘 job 层)+ src/job-runner.mjs(detached runner);agy `--print-timeout` 跟随 `timeout_minutes`(原 15m 硬编码是长审查隐性杀手);7 个 skill/文档面同步;smoke 新增 job 层离线测试群(fake runner env 门控)。

## 收敛轨迹(全部 whole-diff 轮)

| 轮 | findings | 裁决 |
|---|---|---|
| R1 | 2 BLOCKER + 5 MAJOR + 2 MINOR(跨进程幂等竞态/exec guard 吃掉重试/job.json 写序竞态/writeJson 可见缺口/PID 复用假活+误杀/cancel 竞态/路径穿越/测试与文档) | 全采纳 |
| R2 | 1 BLOCKER + 6 MAJOR + 1 MINOR(pre-boot cancel 复活/reconciler 绕锁/偷锁无主权/readJson 吞损坏/taskkill 不验结果/posix 孤儿/幂等命中回显撒谎) | 全采纳;「锁内暂停点」测试钩驳回(互斥区内塞测试机制) |
| R3 | 3 MAJOR + 2 MINOR(跨 key 锁交叉等待/活 holder 被偷锁/heartbeat 窗口 PID 复用误杀/测试确定性/GC 与持久性承诺矛盾) | 全采纳 |
| R4 | 2 MAJOR + 1 MINOR(guard 竞态重查/cancel 回复丢 note/failed 路径 undefined) | 全采纳 |
| R5 | 1 MAJOR(alreadyGone 误写 cancelled + identityMismatch 无视 CAS) | 采纳(reconcileDead 统一) |
| R6 | 1 MAJOR(系统休眠致活 runner 被永久 failed) | 采纳(对账前命令行身份终验+decoy 回归测试) |
| R7 | 1 MAJOR(heartbeat 过期的活 runner cancel 漏杀) | 采纳(候选 pid 三级回落,身份核验兜底) |
| R8 | **No findings → VERDICT: GREEN** | 收环 |

**轨迹判读**:7→8→5→3→1→1→1→0,单调收敛;R3 起全部围绕分布式状态机的同族缝隙(锁/活性/终态 CAS),无 scope-creep(两项加法驳回有案)。

## 验证

- 离线 SMOKE PASS(arg builders / agy retry 政策 / job 层 12 项含跨进程 barrier 竞态、pre-boot cancel、kill 失败诚实性、休眠场景、路径穿越、损坏 fail-loud / MCP 握手 6 工具)。
- 实弹 3 次(非聚簇):detached runner 全链 PONG + 运行中幂等命中原 job(重写前 1 次、重写后 1 次、终态协议 1 次)。
