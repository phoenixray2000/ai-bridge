# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-13T17:11:06.724Z

---
我会按 `codebase-recon` 的证据流程，对 `git diff HEAD` 做整轮只读复审，并先核对仓库规则与历史设计依据；不会修改文件。

这轮属于修复后关闭轮；我会补用 `code-review-close` 核对 R1–R3 issue ledger 的闭合，并继续保持 whole-diff 复审范围。

[MAJOR] skills/smart-plan/SKILL.md:51 — 内建格式未要求把 plan 保存到仓库文件，旧 `writing-plans` 的落盘规则被丢失，而 Phase 4 又必须通过 `plan path` 按引用评审；机械执行时 planner 可以只返回聊天文本，导致 Layer 0 无文件可审 → 明确 plan 的落盘路径约定（如 `docs/plans/YYYY-MM-DD-<name>.md`，允许用户覆盖），并在 Phase 3 检查文件存在且非空

[MAJOR] skills/smart-plan/SKILL.md:53 — “steps exact enough”取代了旧格式的完整代码、精确命令及禁止 placeholder 规则，却又被 Phase 3 当成机械字段；包含“add validation”“handle edge cases”或未定义 symbol 的薄任务仍可通过出口，无法由 clean-window executor 确定执行 → 恢复明确的 no-placeholder 清单，要求代码步骤给出具体修改内容、命令及预期输出，并将可机械检查项加入 Phase 3

[MAJOR] skills/smart-plan/SKILL.md:78 — 该规则强制为 reality premise 创建只读 on-site check task，但同一格式又要求每个 task 提交改动，`route` 还向每个 execute-class task 强制下发“失败测试→实现→通过”；纯查询、全仓 grep 或 toolchain check 没有实现和改动可提交，因此合法计划会被机械合同卡死 → 为既有只读 grounding/gate task 定义非变更型格式（命令、预期证据、验收结果），明确免除 TDD 与 commit step，并在 Phase 3 按任务类型检查必填项（grounding: skills/smart-plan/SKILL.md:78-85）

[MAJOR] skills/smart-plan/SKILL.md:58 — 新增的 task 内 commit step 仍未闭合真实 dirty-tree 生命周期：`ai_exec` 的 repo 内 report、phase/closing xreview evidence 与 verdict、以及首次提交后的 review-fix 都产生于该 commit 之后；下一次 `ai_exec`/`resume` 会被 dirty-tree guard 拒绝，未再提交的修复也不会进入 `<plan-base>..HEAD` → 在 Layer 0 后、每轮 accepted fix 后及每个 phase gate 后增加“仅暂存本轮相关文件→提交→断言工作树 clean”的编排级 checkpoint，再允许下一次执行派发

VERDICT: NEEDS-FIX
