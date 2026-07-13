# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox read-only --json -c model_reasoning_effort="high" <prompt>
- written: 2026-06-11T12:16:38.095Z

---
我会按代码审查口径直接给结论：只列会导致错误结果、安全边界失效或运行不稳的问题，跳过风格项。

[CRITICAL] `server.mjs:4` — imports `writeEvidence` from `./vendors.mjs`, but `vendors.mjs` does not export it — exact code will fail at ESM module load before any MCP tool registers — add/export `writeEvidence`, or remove the import and evidence/report paths until implemented.

[HIGH] `recoverAgyAnswer` lines 167-178 — cwd→conversation recovery can return another run’s answer — `last_conversations.json` is global per cwd, and freshness only checks DB `mtimeMs >= since - 2000`; a concurrent/recent agy run in the same cwd, or a failed run that touches an old DB, can pass and return stale/wrong content — capture a run-specific conversation id if possible, otherwise add a unique prompt marker and verify the recovered transcript/DB row belongs to this invocation and was created after `started`.

[HIGH] `readTranscriptAnswer` / `recoverAgyAnswer` lines 155-177 — transcript recovery ignores freshness entirely — once DB mtime passes, it returns the last `PLANNER_RESPONSE DONE` from transcript even if that content predates the current run — check transcript mtime and entry timestamp if available, or validate against a per-run marker.

[HIGH] `agyArgs` lines 66-71 / MCP `ai_digest` cwd path — digest grants `--dangerously-skip-permissions` with `--add-dir` even for read-only summarization — a prompt-injected or buggy agy digest can write inside `cwd`, so the “digest” tool is not read-only — remove dangerous permission skipping for digest, require explicit write intent, or digest from embedded files / read-only temp copy.

[HIGH] `embedFiles` lines 224-231 / MCP file inputs — arbitrary file paths can be read and sent to external CLIs — there is no restriction to `cwd`, no symlink/UNC/device rejection, and size is checked only after reading the whole file — require files to resolve under an approved root, `stat` before reading, reject non-regular files, and enforce per-file and total byte limits before `readFileSync`.

[HIGH] `callVendor` GPT branch lines 189-197 and final return line 212 — malformed/missing Codex JSONL can silently return raw stdout as success — with `--json`, `parseCodexJson()` returning `null` should be a protocol failure, not a successful answer; currently empty or non-JSON stdout can become `ok: true` — make “no parseable JSONL / no agent message” an error and surface stderr/stdout for diagnosis.

[MEDIUM] `extractAnswerFromDb` lines 141-153 — answer selection can pick prompt/context/noise instead of the model answer — `protoStrings` extracts every printable length-delimited field, then chooses longest duplicated string; embedded files, prompt text, repeated metadata, or duplicated reasoning fields can outrank the real answer — prefer transcript content; for DB fallback, identify the actual response field/path empirically, exclude prompt marker/input, and fail closed when ambiguous.

[MEDIUM] `recoverAgyAnswer` lines 170-174 — `convId` from cache is trusted as a path component — corrupted or malicious `last_conversations.json` can make `path.join(AGY_HOME, "conversations", `${convId}.db`)` escape the conversations directory via `../` — validate `convId` against the expected id format and confirm the resolved DB path stays under `AGY_HOME/conversations`.

[MEDIUM] `run` / `killTree` lines 75-90 — timeout handling can leave subprocesses running or hang forever — on Unix `child.kill()` kills only the direct process, not descendants; on Windows `taskkill` is spawned but not observed, so if it fails the promise may never resolve — start children in a process group where supported and kill the group; on Windows wait for `taskkill` and add a hard fallback/secondary timeout.

[MEDIUM] `run` lines 87-88 — stdout/stderr accumulation is unbounded — a CLI that streams logs or binary output can exhaust memory before timeout — enforce maximum captured bytes and truncate with an explicit error/note.

[MEDIUM] `assertSafeExecCwd` lines 215-220 — dirty check can give false safety — `git status --porcelain` may omit untracked files depending on config, ignores ignored files, and does not establish the repo root/scope being protected — use `git rev-parse --show-toplevel`, `git status --porcelain=v1 -uall --ignore-submodules=none`, and make the returned repo root part of the execution/report context.

[LOW] `protoStrings` lines 94-127 — parser is bounded, so I do not see an infinite-loop bug, but it is permissive enough to mis-extract — it treats any printable length-delimited payload as text and recursively parses ordinary strings as nested protobufs, creating plausible false candidates — keep recursion bounded, but add field-number sanity checks, avoid recursing into already accepted human text unless it looks structurally protobuf-like, and return provenance/path with each string so selection can be constrained.

最高优先级：先修 `server.mjs` 的 missing export，否则服务无法启动；启动问题修完后，立刻把 agy recovery 改成“只接受本次调用的答案”，否则这是最危险的静默错误结果来源。
