# 调试纪要：agy headless 输出问题（2026-06-11 暂停点）

状态：ai-bridge 代码骨架完成，离线冒烟全绿（arg builders + MCP 握手）；
`smoke:live` 的 gemini 段红，gpt 段未测。被 fail-loud 守卫拦下的是一个真实上游问题。

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

## 待试解法（优先序）

1. spawn 时保持 stdin 打开（input_loop 可能因 stdin EOF 提前 shutdown；
   若 shutdown 推迟，transcript flush 可能恢复可靠 → 最薄的修法）。
2. 解析 conversations/<id>.db（protobuf blob 提取文本；无依赖可手撕 varint 或带 protobufjs）。
3. node-pty ConPTY 伪终端骗 agy 认为在 TTY（重依赖，最后手段）。
4. 上游修复跟踪（agy >1.0.7 可能改善；README 的 env override 已预留模型名变更）。
