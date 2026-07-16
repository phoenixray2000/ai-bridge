# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-16T06:15:36.508Z

---
我将使用 `codebase-recon` 做整段差异的证据化复审，并严格只交付约定的 findings 与最终 verdict。

[MAJOR] src/vendors.mjs:301 — CPU 探针各 generation 共用单一 `probeTimer/probeWake`；旧探针休眠时若输出触发新 generation，后者会覆盖取消句柄，`finish()` 只能唤醒最新探针，旧定时器仍可让 runner 滞留至 `probeGapMs`（spec §4b） → 为每个 generation 保存独立取消句柄，并在输出、替换探针及 `finish()` 时取消全部未决休眠；增加 `silenceMs < probeGapMs` 的重叠回归测试。

[MAJOR] skills/xreview/SKILL.md:87 — Gemini 核心物化命令使用 `git diff ... > file`；在本项目支持的 Windows PowerShell 5.1 中，原生输出会被转码为 UTF-16，diff 可能乱码或带 NUL，直接破坏 spec §8 的只读文件审查通道；相同命令还出现在 smart-plan、server 工具说明和失败指引中 → 全部改用 Git 自身的字节安全输出参数 `git diff --output=<file> <base>..<head>`。

[MAJOR] src/jobs.mjs:295 — `listJobs()` 将 jobs root 的所有读取错误都吞成空数组，权限或 I/O 故障会被 `ai_job_list` 谎报为“no jobs”，从而破坏 spec §1 的跨会话找回与防重复启动目标 → 仅在 `ENOENT` 时返回空列表，其余错误抛出并由 guarded handler 响亮呈现。

[MAJOR] README.md:13 — 活跃使用文档仍宣称所有 reviewer 都会自行运行 git，且 README:113 仍建议 closing gate 使用已被实证否决的 60 分钟；DESIGN.md 也保留 `wait_seconds=120` 并遗漏新工具/参数，调用者按文档操作仍会重现 spec §§2、3、8 要修复的问题 → 一次性同步 README、DESIGN 和相关 skill：Gemini 物化 diff、300 秒默认、90/120–180 分钟表、`ai_job_list` 与 `expect_verdict`。

[MINOR] src/vendors.mjs:403 — `run()` 在 verdict 校验前对整个 Gemini stdout 调用 `trim()`，会抹掉首个非空行的前导空格，因此仅输出 `"  VERDICT: GREEN"` 时会被正规化并绕过 spec §6 的 raw-line 锚定检查 → 只移除尾部空白（如 `trimEnd()`），保留输出开头的原始字符，并补充 verdict 为首行时的缩进回归测试。

[MINOR] src/server.mjs:219 — `ai_job_status` 仅对非终态任务附加 `progressText`，任务一旦 wedge/失败便隐藏最后输出、CPU 样本和 watchdog 判定，不满足 spec §4c 对 status 诊断面板的完整要求 → 终态状态同样附加已落盘的 progress，再追加 `ai_job_result` 提示。

VERDICT: NEEDS-FIX
