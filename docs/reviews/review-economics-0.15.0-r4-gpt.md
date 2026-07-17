# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\Git\ai-bridge)
- written: 2026-07-17T06:30:41.220Z

---
我将按 `codebase-recon` 与 `code-review-close` 的审查流程核验整段 diff；只读，不修改任何文件。最终严格只输出 findings 与 verdict。

[MAJOR] skills/xreview/SKILL.md:79 — 当轮 evidence 使用 `-rN` 标签，但单一 verdict 保留基础标签；`check-review-evidence.mjs` 又从同一个 `--label` 推导两者，导致 R2+ 要么找不到 `<round-label>-verdict.md`，要么用基础标签误验 R1 evidence，无法满足当轮 verdict anchoring → 分离 gate label 与 round label，让 checker 按 round label 验证当轮 evidence，同时验证单一 gate verdict 中引用了该轮文件（grounding: acceptance contract 3；`docs/reviews/review-economics-0.15.0-verdict.md` Round 3）。

[MAJOR] skills/xreview/SKILL.md:107 — 在 `docs/reviews` 内先生成未忽略的 diff scratch，再启动 Gemini，会使每个 Gemini-seated round 的 fresh dispatch 都从 dirty tree 开始，直接违反 `skills/route/SKILL.md:179` 的 CLEAN-TREE INVARIANT 及“仅 on-red resume 可 dirty”铁律 → 将 materialized diff 放到 Git 天然忽略且 Gemini 可读取的 scratch 路径（如 Git dir 下的专用目录），保留逐轮独立生成和仲裁后删除的生命周期。

[MAJOR] README.md:119 — 面向消费仓的新 gate wiring 示例仍把 `--verdict`、`--verdict-lines` 标成可选，照此接线会绕过本次新增的强制 verdict anchoring → 将两项改为新 gate wiring 的必选参数，并仅把省略行为注明为既有 legacy label／ad-hoc one-shot 的 forward-only 例外。

VERDICT: NEEDS-FIX
