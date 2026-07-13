# ai-bridge review evidence
- vendor: gemini
- effort: high
- command: agy --model Gemini 3.1 Pro (High) --print-timeout 15m -p <prompt>
- written: 2026-06-11T12:18:06.667Z

---
Here is a review of the `ai-bridge` codebase, ranked by severity from highest to lowest.

**[SEVERITY: CRITICAL]** `callVendor` — Unhandled `parseCodexJson` fallthrough 
**Problem:** If `vendor === "gpt"` and `parseCodexJson(result.stdout)` returns `null` (e.g., if Codex outputs plain text instead of JSONL, or the output is completely malformed), the `if (parsed)` block is skipped. The function then falls completely through the `gpt` branch and hits the final return statement.
**Why it matters:** The final return statement evaluates `if (!result.ok)` (which is `false` since the process exited 0) and returns `{ ok:true, commandLine, output: result.stdout }`. Instead of propagating a parsing error, it falsely reports success and returns the raw, unparsed string to the caller, violating the API contract.
**Suggested fix:** Add an early return if parsing fails: `if (!parsed) return { ok:false, commandLine, error:"failed to parse codex json", stdout: result.stdout };`

**[SEVERITY: HIGH]** `extractAnswerFromDb` — Longest-duplicate heuristic selects user prompt
**Problem:** The code identifies the LLM's answer by finding strings that appear 2+ times and picking the longest one. 
**Why it matters:** The user's original prompt is embedded in the DB payload (often multiple times, such as in the `prompt` field and `history`). If the user submits a large prompt (e.g., pasting extensive source code) and the LLM's generated response is shorter than the prompt, this heuristic will wrongly return the user's own prompt as the answer.
**Suggested fix:** Pass the original prompt text into `extractAnswerFromDb` and explicitly filter it out of the `candidates` pool, or implement a stricter protobuf path traversal instead of a blind text search.

**[SEVERITY: HIGH]** `run` — Multibyte string concatenation causes Mojibake
**Problem:** `child.stdout.on("data", (d) => (stdout += d))` concatenates `Buffer` objects to a string, which implicitly invokes `d.toString('utf8')` on every individual chunk.
**Why it matters:** If a multibyte UTF-8 character (like an emoji or non-English text) happens to be split across a TCP/pipe chunk boundary, `toString()` will fail to decode it, permanently corrupting the character into the replacement symbol (``). This results in silent data corruption.
**Suggested fix:** Call `child.stdout.setEncoding("utf8")` and `child.stderr.setEncoding("utf8")` before attaching the data listeners. Node's internal string decoder will buffer partial byte sequences until the next chunk arrives.

**[SEVERITY: HIGH]** `agyArgs` — Privilege escalation in read-only digest mode
**Problem:** For `role === "digest"`, the code conditionally appends `--dangerously-skip-permissions`.
**Why it matters:** A "digest" is intended to be a read-only summarization of the workspace. By skipping permissions, you grant the LLM full autonomous capabilities to write files or execute terminal commands without user confirmation. A hallucination or prompt injection could result in destructive changes to the repository.
**Suggested fix:** Remove `--dangerously-skip-permissions` for the `digest` role. Ensure `agy` respects a strictly read-only sandbox.

**[SEVERITY: MEDIUM]** `recoverAgyAnswer` — Global CWD cache creates race conditions
**Problem:** The function relies on matching the normalized `cwd` to a conversation ID in a globally shared `last_conversations.json` cache file.
**Why it matters:** If two instances of `ai-bridge` run concurrently in the same working directory (e.g., overlapping editor actions), the second run will overwrite the cache mapping. The first run will then look up the DB and conversation ID of the second run. This mixes up responses across sessions and can falsely fail the `mtimeMs < since - 2000` check. Furthermore, `toLowerCase()` on the path will break on case-sensitive file systems (like Linux) if paths are queried with different casing.
**Suggested fix:** Do not rely on a CWD cache. Extract the `conversation_id` explicitly from `agy`'s CLI output (stdout/stderr) during the run. 

**[SEVERITY: LOW]** `protoStrings` — Exponential recursion on arbitrary binary data
**Problem:** `if (depth<6 && n>1) protoStrings(slice, depth+1, out);` assumes that *any* extracted string (`wire===2`) is also a valid nested protobuf message, and recursively parses it.
**Why it matters:** Large blocks of plain text or random binary data will coincidentally contain bytes that look like valid protobuf varints and lengths. Recursively parsing English text as protobuf will extract garbage "noise" strings and waste CPU cycles.
**Suggested fix:** Stop blindly recursing into every `wire===2` string unless the specific field index is known to be a nested message.

**[SEVERITY: LOW]** `assertSafeExecCwd` — Misleading error when git is missing
**Problem:** If the `git` executable is not installed or not in the `PATH`, `spawnSync` returns an `error` object (`ENOENT`). The function catches this via `if (r.error)` but throws the message: `${cwd} is not a git repository`.
**Why it matters:** It leads users to troubleshoot their git repository state rather than realizing they just need to install git or fix their PATH.
**Suggested fix:** Check `if (r.error?.code === 'ENOENT') throw new Error("git is not installed or not in PATH");` before the main error throw.

***

### Single Highest-Priority Fix

**Fix the `callVendor` fallthrough.** 
A core wrapper function returning `{ ok: true }` when it fundamentally failed to parse the underlying tool's output destroys the reliability of the system. Downstream consumers will receive a raw, unparsed JSON string masquerading as a successful answer, causing confusing downstream failures that are hard to trace. Add the `if (!parsed)` early return.
