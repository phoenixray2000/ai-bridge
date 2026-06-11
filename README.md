# ai-bridge

MCP server exposing **GPT (codex CLI)** and **Gemini (agy CLI)** as role-shaped
tools for cross-vendor development workflows. General-purpose: no project
coupling, no fixed directories — register once at user scope, use from any repo.

Encodes the roles of the model-selection methodology (see
`collab-runtime/docs/superpowers/model-selection-methodology.md`):

| Tool | Role | Access | Default |
|---|---|---|---|
| `ai_review` | adversarial cross-vendor review | **none** — material travels in the prompt | effort `high` |
| `ai_exec` | mechanical task execution | write, confined to the given worktree `cwd` | effort `medium` |
| `ai_digest` | context offload (P4): bulky material in, summary out | embedded files (no fs) or read on `cwd` | Gemini Flash, effort `medium` |

Seven routing skills surface as `/ai-bridge:*` slash commands: `route`
(dispatcher + canonical scenario table), `ai-model` (scenario state),
`gpt` / `gemini` (one-shot), `digest` (P4 offload), `smart-plan`
(model-bound planning), `xreview` (cross-vendor review).

Vendor mapping:

- `gpt` → `codex exec` with `--sandbox read-only|workspace-write` and
  `-c model_reasoning_effort="<effort>"`.
- `gemini` → `agy -p` with `--model "Gemini 3.1 Pro (High|Low)"` (review/exec)
  or `--model "Gemini 3.5 Flash (...)"` (digest). Effort is encoded in agy's
  model display name. Review passes **no** `--add-dir`: the reviewer is
  filesystem-blind by construction.

Reliability:

- **agy answer recovery**: agy 1.0.x discards print-mode output when stdout is
  piped (TTY drip renderer). The bridge recovers the answer via
  transcript.jsonl → conversations/<id>.db (protobuf extraction), with
  freshness validation; all sources failing is a loud error, never a silent
  empty answer. See NOTES.md.
- **codex --json**: clean answer text, session id (feeds `resume` for
  managed-loop fix rounds), token usage.
- **dirty-tree guard**: `ai_exec` refuses a cwd that is not a clean git tree
  unless `allow_dirty: true` — git is the safety net for agent writes.
- `ai_digest` file embedding rejects >400KB instead of truncating.

## Prerequisites

- Node ≥ 22 (uses node:sqlite)
- `codex` CLI logged in (`codex login`)
- `agy` CLI logged in (run `agy` once interactively)

Binary discovery: PATH, then default Windows install locations. Override with
`AI_BRIDGE_CODEX_BIN` / `AI_BRIDGE_AGY_BIN`. If an agy update renames models,
override `AI_BRIDGE_GEMINI_PRO` / `AI_BRIDGE_GEMINI_FLASH`.

## Install & deploy

```powershell
npm install
npm run smoke          # offline: arg builders + MCP handshake
npm run smoke:live     # + one tiny real call per vendor (burns quota)

# --- Install as a plugin (recommended: bundles MCP server + 7 skills) ---
# in Claude Code:
#   /plugin marketplace add phoenixray2000/ai-bridge
#   /plugin install ai-bridge@ai-bridge
# This wires the MCP server (via .mcp.json + ${CLAUDE_PLUGIN_ROOT}) AND the
# /ai-bridge:* skills together. If you previously ran the standalone
# `claude mcp add -s user ai-bridge`, remove it to avoid a duplicate server:
#   claude mcp remove -s user ai-bridge

# --- Or register just the MCP server, no skills (standalone) ---
claude mcp add -s user ai-bridge -- node --no-warnings D:\git\ai-bridge\src\server.mjs
```

## Usage notes

- `ai_review`: include the **full diff and spec context in the prompt**; write
  `evidence_path` under the consuming repo's review-evidence dir so its verify
  gate can check existence.
- `ai_exec`: `cwd` must be an isolated worktree — that is the blast radius.
- `ai_digest`: output should be facts ("which error clusters, which files
  reference X"), not judgment. Judgment-feeding reads stay in the Claude pool
  (methodology P4 boundary).
