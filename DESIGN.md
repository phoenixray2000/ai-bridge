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
│   ├─ server.mjs         # 工具定义：ai_review / ai_exec / ai_digest
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

## 5. MCP 工具契约

三工具通用：**双通道返回**——stdout 回执 ≤10 行结构化摘要（status/改动文件/verify 结果/遗留），
详细报告落 `<repo>/docs/exec-reports/<task>-<vendor>.md`（digest 例外，只回摘要）。

### ai_review(vendor, prompt, effort=high, evidence_path?)
- 无文件系统访问（材料全进 prompt）；gpt → codex `--sandbox read-only`，gemini → agy 不加 `--add-dir`。
- evidence_path 落原始产出，供 verify 闸门机械检查。

### ai_exec(vendor, prompt, cwd, effort=medium, resume?, allow_dirty?)
- cwd 指哪写哪（main 检出合法）；**dirty-tree guard**：工作树有未提交改动即拒绝，`allow_dirty: true` 显式越过；worktree 仅为并行执行时的建议。
- 返回带 vendor session id；`resume: <id>` 续同一会话发修正指令（codex exec resume）——托管回环的回路。
- 发布物 = prompt + plan.md 路径（exec 类让 CLI 自己读盘省 token）。

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
plan 内 task 一律托管回环：编排发 ai_exec → verify + 两段 review → 红了仲裁
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
