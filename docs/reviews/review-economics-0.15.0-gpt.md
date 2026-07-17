# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\Git\ai-bridge)
- written: 2026-07-17T06:05:08.798Z

---
我将按 `codebase-recon` 的证据核验流程，只读检查 `git status`、未提交 diff、相关全文与行号；不会修改文件。

[MAJOR] skills/xreview/SKILL.md:3 — frontmatter 仍声明默认双 vendor，且第 117 行无条件写成“R1 双席、R2+ GPT 单席”，均与 `-gpt` 全轮保留降级面板的例外冲突 → 将 frontmatter 攑为 cadence-governed panel，并让启动指令仅引用本文件的 Seat cadence，不再复述席位组合。

[MAJOR] skills/xreview/SKILL.md:59 — agy 失败路径无条件写成 “GPT-solo”，但 `-gpt` 时根本没有 GPT，降级面板的 flake 行为因此未定义 → 分支写清：正常面板跳过 Gemini 后由 GPT 单席完成；`-gpt` 面板跳过 Gemini 后由既有 Opus 单席完成并明确标记 thin，均不得追加重试或换席。

[MAJOR] skills/xreview/SKILL.md:76 — 所有轮次复用 `<label>-<vendor>.md`；R2+ 不再运行 Gemini 后，R1 的 Gemini 文件仍非空，`check-review-evidence.mjs` 可把它当作当前轮证据，直接破坏第 202 行的 “from THIS round” verdict anchoring → 定义可机械区分轮次的 evidence identity，并让 checker 按当前轮实际席位验证，确保旧轮文件不能替当前轮过闸，同时保留 R1 证据可审计。（grounding: acceptance contract 1 and 3）

[MAJOR] skills/xreview/SKILL.md:109 — materialized diff 被要求等“整个 gate completes”才删除；多轮 gate 中它会跨过 R1 仲裁提交点，与仅 R1 使用该文件及 CLEAN-TREE INVARIANT 冲突，`skills/route/SKILL.md:209` 也保留了同一错误生命周期 → 改为 Gemini 所在轮收集完成后、该轮仲裁与 checkpoint 前立即删除，并同步 route 的表述。

[MAJOR] skills/route/SKILL.md:69 — route 本地复述“R2+ GPT-solo”却遗漏 `-gpt` 例外，第 213 行 closing-gate 指令再次作出同样的无条件声明；这既违反 SPOT discipline，也会在 GPT 已死时派发不存在的席位 → 两处均只引用 xreview Seat cadence SPOT，不在 route 复制 cadence 或例外。

[MAJOR] skills/smart-plan/SKILL.md:142 — 本地副本写“所有其他轮次 GPT-solo”，与第 140 行 `-gpt` 的 Gemini+Opus 面板冲突；第 148 行又假定 flake 后必有 GPT anchor，第 161 行则仍要求每轮 “Start both vendors”，正常 R2+ 也会错误启动 Gemini → 删除这些通用 cadence/degrade 副本，统一引用 xreview SPOT，仅保留 plan-review 固定面板这一 plan 特有规则。

[MINOR] docs/model-selection-methodology.md:39 — rationale 仍在第 39、49、109、132、144 行宣称旧的“plan R1 + closing gate / middle rounds GPT-solo”规则，与新的“每个 gate 仅首轮第二席、`-gpt` 例外”不一致 → 将这些历史说明统一刷新为新 cadence，并明确文档仍仅为 rationale。

VERDICT: NEEDS-FIX
