# 调试纪要：agy headless 输出问题（已解决，2026-06-11）

**状态：已解决。** 恢复链 stdout → transcript.jsonl → conversations/<id>.db 已实现并实弹验证
（短答案 PONG + 长答案 1..50+DONE 均正确恢复，thinking 文本被去重启发式正确排除）。
`smoke:live` 全绿。以下保留根因记录与排除项。

**排除项**：
- stdin 保持打开（解法①）：agy `-p` 会读管道 stdin 直到 EOF——stdin 开着进程永不退出。stdin 必须关闭。
- `agy models` 管道下同样空输出（同一 TTY drip 病灶）→ **模型动态发现暂缓**（设计待办 4），
  现行：静态名 + env override；agy 上游修复 stdout 后再启用发现。
- .db 答案提取：type-15 step 的 protobuf payload，最终答案文本出现两次（流式累积+终值），
  取"出现≥2次的最长非噪声字符串"，fallback 最长。噪声=UUID/bot-id/sessionID/纯数字/不含空白的 16-30 位 token。

## 现象

非 TTY（stdout 为管道）时 `agy -p` 恒为 exit 0 + 空 stdout、空 stderr。
TTY 下正常（Ray 终端实测 PONG / 1..50+DONE 均完整）。
cwd、`--dangerously-skip-permissions`、单跑/连跑均不影响结论（probe 矩阵见 scripts/probe-agy.mjs）。

## 根因（cli.log 证实）

print mode 的输出走 `text_drip` 打字机渲染器（面向 TTY）；管道时渲染输出被丢弃。
日志中 `Drip stopped: lastStepIdx=2, charIdx=4, length=4` 证明 4 字符的 PONG 已经
从模型回来——答案从未写入 stdout，不是没拿到答案。

次生问题：非 TTY 下答完立即 shutdown，`brain/<id>/.system_generated/logs/transcript.jsonl`
经常 0B（flush race）——SinanTufekci 的 transcript 回读方案在本机**不可靠**。

## 可靠数据源

- `conversations/<id>.db`：SQLite，即使 transcript 0B 时也有完整数据（139KB+）。
  `steps` 表：idx/step_type/status/step_payload(blob, 疑似 protobuf)。
  idx=3 / step_type=23 疑似 planner response（含答案文本）。
- `cache/last_conversations.json`：cwd → conversation id 映射（注意：失败的运行也会
  更新映射，回读时必须校验新鲜度 + prompt 匹配，否则拿到陈旧答案）。

## 设计待办（状态）

1. ✅ **resume**：codex 全面切 `--json`（thread.started 给 session id、agent_message 给干净答案、turn.completed 给 usage）；ai_exec 返回 `[session: <id>]`，`resume: <id>` 走 `codex exec resume`。
2. ✅ **dirty-tree guard**：`assertSafeExecCwd`——非 git 仓或有未提交改动即拒绝，`allow_dirty: true` 越过；worktree 降级为并行执行建议。
3. ✅ **双通道返回**：ai_exec 的 `report_path` 参数自动在 prompt 末尾追加"报告落盘 + stdout ≤10 行摘要"指令。
4. ⏸ **Gemini 模型动态发现**：被 agy TTY 病灶连坐（`agy models` 管道下也空）。暂缓，现行静态名+env override；上游修复后按原设计实施（失败驱动刷新，家族+档位匹配）。
5. ✅ **plan.md 路径发布**：写进 ai_exec 工具描述（exec 类让 CLI 读盘；review 类无 fs 访问走嵌入）。

## core-v0.1 跨厂商 review backlog（deferred，verdict 见 docs/superpowers/reviews/core-v0.1-verdict.md）

- ✅ **digest 写权限过宽**（双签 high）：已解。实测 `agy --add-dir <repo> --sandbox -p` 在 headless 下能读文件、不挂、无写/exec——digest+cwd 与 review+cwd 均改用 `--sandbox`。
- **run/killTree 健壮性**（GPT med）：Unix 只杀直接子进程（孤儿）、Windows taskkill 不观测→失败可能挂死。改 detached 进程组 kill + 二级超时。
- **run stdout 无上限**（GPT med）：实际被模型输出上限兜底，低优。
- **protoStrings 过度递归**（双签 low）：#3 的 prompt 排除已缓解；彻底解需按 field-number 定位答案字段而非盲扫。
- **codex 是否接受 `model_reasoning_effort="xhigh"`**（我方）：方法论 cutover diff 用 xhigh，需实测 codex 是否接受该档位值，否则 xhigh 调用会失败。
- **codex Windows 沙箱只有 danger-full-access 可用**（我方，实测）：`--sandbox read-only`/`workspace-write` 的 helper 在本机报 `orchestrator_helper_launch_failed: program not found`，无法启动工具/读文件；只有 `danger-full-access` 能跑。故 codex 全部走 danger-full-access + git 安全网。⚠️ 衍生风险待验：ai_exec 用 workspace-write 在 Windows 上可能根本写不了文件（smoke 只测过 PONG 无写）——需实测 exec 真实改文件，可能也得切 danger-full-access。
- **review/exec prompt 改走 codex stdin（`-`）**：Windows argv ~32KB 限制是 inline 截断真因；codex 从 stdin 读 prompt 绕开。agy 仍 argv（但 by-reference 后 prompt 很小）。

## 待试解法（优先序）

1. spawn 时保持 stdin 打开（input_loop 可能因 stdin EOF 提前 shutdown；
   若 shutdown 推迟，transcript flush 可能恢复可靠 → 最薄的修法）。
2. 解析 conversations/<id>.db（protobuf blob 提取文本；无依赖可手撕 varint 或带 protobufjs）。
3. node-pty ConPTY 伪终端骗 agy 认为在 TTY（重依赖，最后手段）。
4. 上游修复跟踪（agy >1.0.7 可能改善；README 的 env override 已预留模型名变更）。
