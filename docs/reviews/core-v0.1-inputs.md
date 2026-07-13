# core-v0.1 review — 输入审计记录（供核查）

记录两个 reviewer 各自实际收到了什么，以及**已知的覆盖缺陷**。完整 prompt 正文见本会话 transcript 中的两次 `ai_review` 工具调用（各约 7–8KB，内联了源码）。

## 调用方式

不是 Agent 工具，是 MCP `ai_review`（codex/agy 后端）两次并发调用：
- `ai_review(vendor="gpt", effort="high", evidence_path=...core-v0.1-gpt.md)`
- `ai_review(vendor="gemini", effort="high", evidence_path=...core-v0.1-gemini.md)`

## 各 reviewer 实际收到的材料

| 材料 | 发给 GPT | 发给 Gemini |
|---|---|---|
| 框架/上下文说明（agy stdout 怪癖、codex --json、关注点清单） | ✅ | ✅ |
| `src/vendors.mjs` | ✅ 全文内联，**但删了 `writeEvidence` 函数体**（省篇幅） | ✅ 全文内联（压缩版，逻辑完整） |
| `src/server.mjs` | ⚠️ 仅给了**注释块摘要**，并注明"focus on vendors.mjs" | ❌ **完全没给**（prompt 里只有 vendors.mjs） |
| 关注点清单（编号 1–7） | ✅ 偏通用 | ✅ 偏具体（点名了 longest-dup 选 prompt、mtime race、多字节 mojibake 等） |

## 已知覆盖缺陷（核查重点）

1. **`writeEvidence` 被我从给 GPT 的 vendors.mjs 里删掉** → 直接导致 GPT 报了那条假 CRITICAL "未导出"。真实代码 `vendors.mjs` 是导出的。**教训：review 材料绝不可裁剪。**
2. **`server.mjs` 实质未被审查**：GPT 只看了摘要、Gemini 没看到。三个 MCP 工具处理器（输入校验、错误返回路径、digest 的 cwd 写权限注入点）**没有真正过 reviewer 的眼**。本轮 verdict 里 server.mjs 相关项（如 digest 写权限）是我自己识别+reviewer 从 agyArgs 间接推出的，不是 server.mjs 全文审查的结果。
3. **Gemini 的关注点清单比 GPT 更具引导性**（我点名了几个具体怀疑点）→ 两家并非完全独立盲审，存在我的引导偏差。

## 结论对核查的影响

- 双签的高置信项（fallthrough / mojibake / prompt 误取 / 并发串答）仍可信——它们来自 vendors.mjs 全文，两家都看到了。
- **server.mjs 需要补一轮真正的全文审查**（下一轮 xreview 的候选），当前对它的信心不足。
- 我引导偏差的存在意味着"两家独立"打折，但视角差仍部分有效（Gemini 抓到 mojibake、GPT 抓到 embedFiles 先读后查，互不重叠）。
