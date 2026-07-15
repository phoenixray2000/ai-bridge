# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-15T19:14:37.320Z

---
我会按 `codebase-recon` 的证据流程审阅整个未提交 diff；只读核验，不修改任何文件。最终严格按你给定的两段式输出契约返回。

初步覆盖面已确认：这是 16 个已跟踪文件的改动，加 3 个核心未跟踪实现文件及 5 份历史审查记录。当前处于广查阶段，下一步会把协议实现、旧同步行为、技能文档和 smoke 测试逐条交叉核验。

协议主路径与旧同步工具的行为映射已经核对完。暂未形成可交付的 BLOCKER/MAJOR；我正在针对竞态、进程身份、终态 CAS、文档指令可机械执行性和测试是否真实命中这些边界做反证检查，并会参考 R1–R5 记录避免重提已否决项。

[MAJOR] src/jobs.mjs:229 — 心跳过期后直接进入 `markTerminal(failed)`，未在锁内重新核验 heartbeat 或 runner 身份；系统休眠、调度停顿等情况下，仍存活的 runner 会被永久标为 failed，随后无法取消，而 vendor 仍可能继续修改工作树，误导机械编排（grounding: DESIGN.md:76） → 在 key lock 内重新读取 heartbeat，并用现有命令行身份校验确认 runner 已消失后才能写 failed；若身份仍匹配则保持非终态，并补充“旧 heartbeat + 活 runner”回归测试。

VERDICT: NEEDS-FIX
