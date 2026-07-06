# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-06T04:47:16.461Z

---
我会按 review 流程读取相关 skill 和仓库 diff，只做审查不改文件。

Using `code-review-sweep` for a no-edit review of the working tree; final format will follow your stricter output contract rather than the skill’s longer template.

我已经确认审查范围是 working tree 的未提交改动。接下来重点逐行对比三个 skill 的 HEAD 版本和当前版本，优先找行为规则被弱化或丢失的地方。

刚才的 PowerShell 片段被外层变量展开吃掉了；我会用转义后的命令重新读带行号文件。

源码部分里我重点看 `callVendor` 的 agy 分支和 smoke 的 fake runner。一个测试点需要核对：当前“离线”测试是否仍会触碰真实 agy conversation store。

我会再用规则关键词过滤 deleted lines，避免漏掉“必须/禁止/阈值/例外”这类压缩时最容易丢的行为约束。

目前候选问题主要集中在“规则压缩后文字指向的操作位置/外部状态是否还确定”。我会继续缩小到差异中的关键词，而不是把删掉的解释性段落当成问题。

`Select-String` 的 switch 参数写法在 5.1 下不接受这个形式；我会省掉它，默认就是不区分大小写。

我会跑一次离线 smoke，主要验证新增 fake-runner 测试和 MCP handshake 是否按当前环境通过；这不触发 live vendor calls。

[MAJOR] skills/smart-plan/SKILL.md:21 — 视觉契约触发条件从旧版“UI demo / mockup exists”缩窄成“UI demo exists”，静态 mockup 不再明确进入 visual contract，属于行为规则丢失 → 恢复“demo / mockup”触发条件，并在 Phase 1/Phase 4 相关引用中保持同等适用。

[MAJOR] scripts/smoke.mjs:79 — 号称 offline 的 EMPTY retry/degrade 断言仍会调用真实 `recoverAgyAnswer()` 读取用户真实 AGY_HOME conversation store；若测试期间存在新鲜无关 conversation，EMPTY 路径会被“恢复成功”而不是 retry/degrade，测试既会抖动也不再验证声称的策略 → 给 recovery 加测试注入点或把 recovery 指向临时空 store，并在这些 case 中确定性地让 recovery 失败。

[MINOR] scripts/smoke.mjs:62 — 测试断言“maxAttempts (2)”但只固定了 `AI_BRIDGE_AGY_BACKOFF_MS`，没有固定/恢复 `AI_BRIDGE_AGY_ATTEMPTS`；用户环境若设为 3，会导致调用次数和断言语义改变 → 在该 block 中保存原 env，显式设置 `AI_BRIDGE_AGY_ATTEMPTS="2"` 和 backoff，并用 `finally` 恢复 env 与 `_setRunImplForTests(null)`。

[MINOR] skills/xreview/SKILL.md:114 — 仲裁文件路径从旧版 `<repo>/docs/superpowers/reviews/<label>-verdict.md` 弱化为裸 `<label>-verdict.md`，与同文件的 evidence_path 目录约定不一致，容易把 verdict 写到错误位置 → 恢复完整 `<repo>/docs/superpowers/reviews/<label>-verdict.md` 路径约束。

VERDICT: NEEDS-FIX
