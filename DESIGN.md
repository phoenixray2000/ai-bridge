# ai-bridge 机制层设计

> 定稿 2026-06-11。策略层是本仓
> `docs/model-selection-methodology.md`；
> 本文档是机制层实现规格——策略如何不靠人肉记忆地被执行。
> 通用能力：不绑定任何项目，user-scope 安装，所有仓库可用。

## 1. 架构判断（两条，机制层一切设计由此推出）

1. **路由智能前置到计划期**。plan 逐 task 标「类型」（机械/判断/高危），执行期只剩三个机械动作：查表（类型 × 当期场景 → 模型）、遇阻升档（medium→high→max）、显式覆盖（斜杠命令）。执行期还需要"智能"路由 = 计划期路由判断没做完。
2. **路由器就是编排会话本身**。Claude 侧派发能力（Agent tool model 参数）是编排独占的，外部路由服务物理上够不着；会话自身模型只能用户 /model 切，因此所有"切模型"环节一律设计成"派发"而非"切换"。

## 2. 打包形态：一个 Claude Code plugin

仓库即插件，装一次得到全部：

```
ai-bridge/
├─ .claude-plugin/        # plugin manifest（含 MCP server 注册）
├─ src/                   # MCP server（stdio）
│   ├─ server.mjs         # 工具定义：ai_review_start / ai_exec_start / ai_job_* / ai_digest
│   ├─ jobs.mjs           # 异步 job 层（落盘状态/幂等键/heartbeat 活性/终态先写者胜）
│   ├─ job-runner.mjs     # detached runner（跨会话存活的执行体）
│   └─ vendors.mjs        # codex/agy 命令构造 + 运行 + 回读
├─ skills/                # 七条斜杠命令（/ai-bridge 列全族）
│   ├─ route/ gpt/ gemini/ digest/ smart-plan/ xreview/ ai-model/
├─ scripts/smoke.mjs      # 离线 + --live 实弹冒烟
└─ DESIGN.md NOTES.md README.md
```

## 3. 角色赋值表（模型名的唯一出处）

| 角色 | 当前赋值 | 退役降级 |
|---|---|---|
| planner（spec/plan/架构成文） | Fable 5 | → Opus 4.8，档位上调一级 |
| orchestrator（编排/验收/仲裁） | Opus 4.8 medium | 用户会话模型，建议值 |
| mech-executor / judge-executor | 按场景表（§4） | — |
| reviewer-gpt | GPT 5.5 high（xhigh 留切换 diff） | codex 默认模型，不指定 |
| reviewer-gemini | Gemini Pro (High) | 动态发现（§6） |
| digester | Gemini Flash (Medium) | 动态发现 |

其余一切（skill 文本、plan、prompt 模板）引用角色名，不出现模型名。

## 4. 执行场景（状态：`~/.claude/ai-model`，单行小写）

| 场景 | 机械型 | 判断型 | 关键节点 review 面板 |
|---|---|---|---|
| gpt（默认） | GPT 5.5 medium | GPT 5.5 high | GPT high + Gemini |
| sonnet | Sonnet medium | Fable/Opus medium | GPT high + Gemini |
| gemini | Gemini 3.1 Pro | Opus medium | GPT high + Opus medium |
| opus | Opus medium（subagent） | Opus medium | GPT high + Gemini |

通则：机械一律 medium；review 面板必须含非执行厂商；routing 每次派发**现读**状态文件（不缓存）。

## 5. MCP 工具契约（0.13.0 起 review/exec 为异步 job；0.14.0 硬化八件套）

同步阻塞调用把 20-40min 的 vendor 运行绑死在 Claude 会话上（stdio 空闲超时默认
30min 掐静默长调用；会话崩溃连带杀 MCP server 和管道子进程；harness 重试再冷启
agy = OAuth 风控暴露）。故 review/exec 改为 **detached job**：start 毫秒级返回
job_id，runner 独立进程、全状态落盘 `~/.ai-bridge/jobs/<id>/`，跨会话可恢复；
**幂等键**（kind+vendor+cwd+prompt+effort+paths，`expect_verdict` 仅为 true 时
参与）让重试命中原 job 不重复启动；job_id 随死会话丢失时用 `ai_job_list` 找回。

### ai_review_start(vendor, prompt, cwd?, effort=high, evidence_path?, expect_verdict?, timeout_minutes?)
- by-reference：prompt 只带指令+路径，reviewer 从 cwd 自己读盘。**diff 通道分
  vendor**：gpt（codex danger-full-access）自己跑 git；gemini（agy `--add-dir
  --sandbox` 只读）headless 下命令类工具被 auto-denied——prompt 必须引用**物化
  diff 文件**（`git diff --output=<file>`，勿用 shell `>`——PS5.1 重定向转
  UTF-16）并明令禁跑命令。
- evidence_path 由 runner 在完成时落原始产出，供 verify 闸门机械检查。
- `expect_verdict: true`（gate 调用必传）：输出末非空行不匹配
  `VERDICT: GREEN|NEEDS-FIX|RED` → job 直接 failed（evidence 照落供取证），
  封「completed 但是垃圾」（exit 0 + 非空 ≠ 审查）。
- `timeout_minutes` 为 **job 级预算**：重试花剩余额度、不重置时钟；剩余 <60s
  不再重试直接失败。表：常规 25（缺省）/ 收尾门 whole-diff 90 / 超大 batch 或
  不可逆切换 120–180，拿不准取大一档。

### 僵死看门狗（惰性 CPU 探针）
- vendor stdout/stderr 实时 tee 到 `<jobDir>/stdout.log`；健康路径零成本。
- stdout 静默满 10min（`AI_BRIDGE_WEDGE_SILENCE_MS`）才启动探针：对 vendor
  进程树 CPU 取基线 + 两次后续采样（共三次，各间隔
  `AI_BRIDGE_WEDGE_PROBE_GAP_MS`=5min），**两个增量**均在容差内 → 判死斩杀。
  review 在 job 预算内有界重试（同步 ai_digest 不经 runner、无看门狗）；
  **exec 判死不自动重试**（被斩 attempt
  可能已写盘，盲目重放会重复非幂等操作）——响亮失败并指引检查工作树后人工
  resume。任一增量显著（正负皆算活）→ 回静默观察。
- 采样/里程碑写 `<jobDir>/progress.json`，`ai_job_status` 展示（终态照示——
  wedge 事后取证正是终态场景）。
- 诚实边界：「服务端长思考」vs「死连接」只能启发式区分；误杀=一次有界重试,
  漏杀=预算天花板兜底。
- agy 空 stdout 先查 stderr：命中 auto-denied 签名 → **永久失败**（不重试不
  恢复），error 附物化 diff 指引;恢复通道答案有合理性下限（裸 token 如
  `run_command` 视为恢复失败）。

### ai_exec_start(vendor, prompt, cwd, effort=medium, resume?, allow_dirty?, report_path?, timeout_minutes?)
- **dirty-tree guard 在 start 时同步检查**（脏树立刻失败，不产 job）；cwd 指哪写哪。
- 完成结果带 vendor session id；`resume: <id>` 续同一会话发修正指令——托管回环的回路。
- 发布物 = prompt + plan.md 路径（exec 类让 CLI 自己读盘省 token）；report_path
  双通道（详细报告落盘、stdout 只回 ≤10 行摘要）。

### ai_job_status / ai_job_result(wait_seconds=300) / ai_job_cancel / ai_job_list(limit=20)
- result 为 long-poll：到点未完成返回 running（非错误），继续 collect、勿重 start。
  早返回使大默认窗口对短任务零代价（120 默认曾让收尾门 ~45 次 poll）。
- list 按 started_at 降序列最近 N 个 job（id/kind/vendor/state/时间/evidence/
  report），跨会话找回 job_id 的通道;逐 dir 经对账读取,坏 job.json 以
  UNREADABLE 条目呈现,jobs root 读失败(非 ENOENT)响亮抛出。
- runner 死而无终态标记 → 对账为响亮 FAILED（附 runner.log 尾部），绝不永久 running。
- cancel 杀整棵 runner 进程树（taskkill /T /F；杀前核验命令行确属本 job 的
  runner——heartbeat 只证明 pid 曾属于我们，PID 复用时拒杀并对账 failed）。
- 终态 job 保留 7 天后 GC（evidence/report 落盘文件不受影响）。

### ai_digest(prompt, files?|cwd?, vendor=gemini, effort=medium)
- files ≤400KB 嵌入（读者无 fs 访问）；cwd 授目录读权限（全仓扫描）。产出=事实摘要，不是判断。

## 6. 版本与模型发现

- Claude 腿：只用别名（sonnet/opus/fable），天然免疫升级。
- GPT 腿：不指定模型，继承 codex 配置默认；只传 reasoning effort。
- Gemini 腿：`agy models` 动态发现，按**家族关键词 + 档位后缀**匹配（版本号不参与）；
  清单缓存落盘（带 agy 版本+时间戳）。**刷新失败驱动**：匹配未命中 → 自动重跑发现再试一次 →
  仍未命中 fail loud 列出可用名。辅助触发：启动时 agy 版本号与缓存不符。env override 人工旁路。
- CLI 升级后跑 `smoke:live` 作验收闸门（两 vendor 各一发 PONG）。

## 7. 斜杠命令规格

| 命令 | 行为 |
|---|---|
| `route <任务>` | 总入口：分类（消化/机械/判断/review）→ 读场景查表 → 派腿，报告路由理由 |
| `gpt / gemini <prompt>` | 直达一次性调用（无验收契约） |
| `digest <files\|dir> <指令>` | 材料不进编排上下文，digester 读完只回摘要 |
| `smart-plan <spec>` | 澄清留编排（未收敛先 grilling + 回写 spec）→ 成文派 planner subagent（内建 plan 格式）→ 出口检查 route 字段；brief 盖不住讨论 = 先回去补 spec |
| `xreview <diff范围> [gpt\|gemini]` | 默认双签并行；证据各落 `reviews/<标识>-<vendor>.md`，编排仲裁出 `-verdict.md`（采纳/驳回/理由/派发），不让外厂互相合并 |
| `ai-model [场景]` | 无参显示当前场景；带参写状态文件 |

## 8. 托管回环 vs 一次性调用

界定标准一条：**产出有没有验收契约（verify + spec 对照）在等**。
plan 内 task 一律托管回环：编排发 ai_exec_start（ai_job_result 收）→ verify + 两段 review → 红了仲裁
（小修直改 / 需 vendor 继续则 resume 续会话）→ 绿了下一个 task。
plan 外的 /gpt /gemini 是一次性，问完即终。

## 9. 闸门

- verify 链检查 review 证据文件存在（phase 边界双签 = 两个文件都在）。
- 已知上游问题：agy 1.0.7 headless 管道下 stdout 静默（TTY drip 渲染器）+
  transcript flush race——解法与回读策略见 NOTES.md；bridge 对空产出 fail loud，绝不静默放行。

## 10. 落地顺序

1. ✅ ai-bridge MCP 收尾（agy 回读打通 + 设计待办）→ `smoke:live` 全绿
2. ✅ plugin 化：skills 七条 + plugin.json + .mcp.json 捆绑 + marketplace.json
   （`/plugin marketplace add phoenixray2000/ai-bridge` → `/plugin install ai-bridge@ai-bridge`）
3. ✅ verify 闸门：`scripts/check-review-evidence.mjs`（仓无关，消费仓 verify 链调一行）
4. （可选）场景切换建议自动化（水位过线提示，切换动作保留人手）

ai-bridge 与任何消费仓零耦合：route 字段约定在 smart-plan skill、闸门是通用脚本。
"Phase B 试运行" 是首次真实使用的观察时机，不是构建依赖——能力此刻已就绪。
