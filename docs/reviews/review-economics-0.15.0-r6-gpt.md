# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\Git\ai-bridge)
- written: 2026-07-17T06:45:07.510Z

---
我将使用 codebase-recon 做只读全量 diff 复审，并按 UTF-8 核验仓库规则与仲裁记录；不会修改文件。

[MAJOR] skills/xreview/SKILL.md:61 — agy 降级后允许剩余席位完成本轮，但 mandatory ROOT wiring 仍按 R1 panel 要求 Gemini 证据；失败的 Gemini job 不写 evidence，导致任何 R1 degrade（含 `-gpt`）都无法过闸 → 增加显式、机器可验的 Gemini-degraded gate 路径：继续强制 GPT/Opus 锚点证据与 arbitration verdict，校验其中的 Gemini-absent 标记，但不要求失败席位的 evidence（grounding: acceptance contract 1 — agy degrade under `-gpt`）。

[MAJOR] src/vendors.mjs:860 — 运行时降级错误仍无条件声称 “GPT anchors”，与 `-gpt` 下由 Opus 锚定的新规则冲突，会在 GPT 配额已死时给调用方错误指令 → 将消息改为引用 xreview degrade SPOT 的 vendor-neutral 表述，并同步对应 smoke assertion。

[MAJOR] skills/xreview/SKILL.md:255 — oscillation redesign 被要求“在同一 gate 以 R1 重入”，会复用并覆盖根标签的既有 R1 evidence，也会重置并绕过 8-round backstop，与第 79–82 行的逐轮不可覆盖规则冲突 → 同一 gate 在 redesign 后继续使用下一个单调递增的 round/evidence label，且 8-round 计数不重置。

VERDICT: NEEDS-FIX
