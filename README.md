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

Vendor mapping:

- `gpt` → `codex exec` with `--sandbox read-only|workspace-write` and
  `-c model_reasoning_effort="<effort>"`.
- `gemini` → `agy -p` with `--model "Gemini 3.1 Pro (High|Low)"` (review/exec)
  or `--model "Gemini 3.5 Flash (...)"` (digest). Effort is encoded in agy's
  model display name. Review passes **no** `--add-dir`: the reviewer is
  filesystem-blind by construction.

Fail-loud guards:

- agy exiting 0 with empty stdout (the known 1.0.x headless symptom) is an
  **error** pointing at the transcript dir — never a silent empty review.
- `ai_digest` file embedding rejects >400KB instead of truncating.

## Prerequisites

- Node ≥ 20
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

# register for all projects (user scope):
claude mcp add -s user ai-bridge -- node D:\git\ai-bridge\src\server.mjs
```

## Usage notes

- `ai_review`: include the **full diff and spec context in the prompt**; write
  `evidence_path` under the consuming repo's review-evidence dir so its verify
  gate can check existence.
- `ai_exec`: `cwd` must be an isolated worktree — that is the blast radius.
- `ai_digest`: output should be facts ("which error clusters, which files
  reference X"), not judgment. Judgment-feeding reads stay in the Claude pool
  (methodology P4 boundary).
