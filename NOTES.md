# NOTES — live backlog only

Resolved investigations live in git history (this file used to carry the full
agy-headless debugging journal; see commits ≤ fc3e7d7 if you need the
archaeology). Rationale for design decisions: `docs/model-selection-methodology.md`.

## Open backlog

- **Gemini 模型动态发现**:被 agy TTY drip 病灶连坐(`agy models` 管道下也空输出)。
  现行:静态模型名 + `AI_BRIDGE_GEMINI_PRO`/`AI_BRIDGE_GEMINI_FLASH` env override。
  agy 上游修复 stdout 后按原设计实施(失败驱动刷新,家族+档位匹配)。
- **run/killTree 健壮性**(GPT med,core-v0.1 review):Unix 只杀直接子进程(孤儿)、
  Windows taskkill 不观测结果 → 失败可能挂死。改 detached 进程组 kill + 二级超时。
  (0.13.0 部分缓解:`ai_job_cancel` 走 taskkill /T /F 杀整棵 runner 树。)
- **run stdout 无上限**(GPT med):实际被模型输出上限兜底,低优。
- **protoStrings 过度递归**(双签 low):prompt 排除已缓解;彻底解需按 field-number
  定位答案字段而非盲扫。

- **corrupt job.json 阻塞 startJob(设计如此,fail-loud)**:持久损坏的 job.json 在
  幂等扫描中抛错(静默当"不存在"会重复启动 vendor)。恢复=删除对应
  `~/.ai-bridge/jobs/<id>` 目录。若误伤频发再考虑隔离(quarantine rename)方案。

## Key operational facts (load-bearing, verified)

- **agy 非 TTY stdout 非确定性丢答案**(~25% 孤立调用空;答案**通常**也不在 conversation
  store——压测中 store 恢复命中率≈0,恢复只是 best-effort 的一次廉价读)。TTY 100% 可靠。修法=有界重试(2 次,8s 去聚簇退避,`AI_BRIDGE_AGY_ATTEMPTS`
  / `AI_BRIDGE_AGY_BACKOFF_MS`),超时不重试,用尽返回 `degrade:true`。
  **禁止批量压测 agy / 禁止聚簇重试**:密集冷启动会 provoke 浏览器 OAuth
  `prompt=consent` 重授权(实测:keyring 持有效 token 后 5 秒仍弹)——账号风控暴露。
  重试策略有离线测试(`scripts/smoke.mjs`,注入 runner,勿用实弹验证)。
- **agy `-p` 读 stdin 到 EOF**——spawn 必须关 stdin,否则永不退出。
- **codex Windows 只有 `danger-full-access` 沙箱能启动工具**(read-only/workspace-write
  的 helper 报 `orchestrator_helper_launch_failed`)。git clean-tree guard 是安全网。
  **已实测(2026-06-17)**:该模式下 exec 真能写文件(临时 git 仓 PROOF.txt 验证)。
- **codex 接受 `model_reasoning_effort="xhigh"`**(已实测 2026-06-17)——cutover diff
  review 依赖它,安全。
- **codex prompt 走 stdin(`-`)**:Windows argv ~32KB 限制会截断 inline 大 prompt。
- **plugin 部署**:同版本号 install 会拉旧 zip 缓存 → 必须 bump 版本;uninstall 不清旧
  cache 目录;以 `installed_plugins.json` 的 installPath 为准。`git push` 绝不接管道
  (吞退出码,失败后级联 uninstall 曾致插件破损态)。
- **Claude Code MCP 超时机制**(官方文档,2026-07 查实):工具调用总时长默认 ~28h
  (`MCP_TOOL_TIMEOUT` / `.mcp.json` 每服务器 `timeout`);**stdio 空闲超时默认 30min**
  (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`,无响应/无进度即掐)——同步长 review 被杀的
  主嫌;会话进程死亡("resume with a fresh process")会连带杀 stdio MCP server 及其
  管道子进程。review/exec 异步 job 化(0.13.0)整类消除:detached runner + 落盘状态
  + 幂等键(重试回原 job,不重复冷启 agy)。
