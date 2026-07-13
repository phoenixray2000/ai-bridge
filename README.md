# ai-bridge

MCP server exposing **GPT (codex CLI)** and **Gemini (agy CLI)** as role-shaped
tools for cross-vendor development workflows. General-purpose: no project
coupling, no fixed directories — install once at user scope, use from any repo.

Encodes the roles of the model-selection methodology
(`docs/model-selection-methodology.md` — rationale; the skills are the
behavioral SPOT):

| Tool | Role | Access | Default |
|---|---|---|---|
| `ai_review` | adversarial cross-vendor review | read-only **by reference** on `cwd` (reviewer reads files / runs git itself); omit `cwd` only for repo-less snippets | effort `high` |
| `ai_exec` | mechanical task execution | write, confined to the given `cwd` (clean-git-tree guard) | effort `medium` |
| `ai_digest` | context offload (P4): bulky material in, summary out | embedded files (no fs) or read on `cwd` | Gemini Flash, effort `medium` |

Seven routing skills surface as `/aibridge:*` slash commands: `route`
(dispatcher + canonical scenario table), `ai-model` (scenario state),
`gpt` / `gemini` (one-shot), `digest` (P4 offload), `smart-plan`
(model-bound planning + Layer-0 plan review), `xreview` (cross-vendor review).

Vendor mapping:

- `gpt` → `codex exec --json` with `--sandbox danger-full-access` (the only
  codex mode whose tool launcher works on this Windows setup; the clean-git-tree
  guard is the safety net) and `-c model_reasoning_effort="<effort>"`
  (`xhigh` verified accepted). Prompt travels via **stdin** (`-`) — Windows argv
  ~32KB would truncate it.
- `gemini` → `agy -p` with `--model "Gemini 3.1 Pro (High|Low)"` (review/exec)
  or `--model "Gemini 3.5 Flash (...)"` (digest); effort is encoded in agy's
  model display name. Review/digest with `cwd` use `--add-dir <cwd> --sandbox`
  (read, no write); exec uses `--add-dir <cwd> --dangerously-skip-permissions`.

Reliability:

- **agy flake handling**: agy under piped (non-TTY) stdout non-deterministically
  returns empty (~25% of isolated calls; the answer is not in its conversation
  store either). The bridge does a **bounded, de-clustered retry** (2 attempts,
  8s backoff — clustered cold-starts provoke a browser OAuth re-consent, an
  account-risk exposure; never stress-test agy). Exhausted → `degrade: true`:
  the caller SKIPS the Gemini seat for the round (GPT anchors), never loops.
  Policy has offline tests (`scripts/smoke.mjs`, injected runner).
- **codex --json**: clean answer text, session id (feeds `resume` for
  managed-loop fix rounds), token usage.
- **dirty-tree guard**: `ai_exec` refuses a cwd that is not a clean git tree
  unless `allow_dirty: true` — git is the safety net for agent writes.
  Real-file writes under danger-full-access verified on Windows.
- `ai_digest` file embedding rejects >400KB instead of truncating.

## Prerequisites

- Node ≥ 22.13.0 (node:sqlite unflagged)
- `codex` CLI logged in (`codex login`)
- `agy` CLI logged in (run `agy` once interactively)

Binary discovery: PATH, then default Windows install locations. Override with
`AI_BRIDGE_CODEX_BIN` / `AI_BRIDGE_AGY_BIN`. If an agy update renames models,
override `AI_BRIDGE_GEMINI_PRO` / `AI_BRIDGE_GEMINI_FLASH`. Retry knobs:
`AI_BRIDGE_AGY_ATTEMPTS` (default 2) / `AI_BRIDGE_AGY_BACKOFF_MS` (default 8000).

## Install & deploy

```powershell
npm install
npm run smoke          # offline: arg builders + retry policy + MCP handshake
npm run smoke:live     # + one tiny real call per vendor (burns quota)

# --- Install as a plugin (recommended: bundles MCP server + 7 skills) ---
# in Claude Code:
#   /plugin marketplace add phoenixray2000/ai-bridge
#   /plugin install aibridge@phoenixray2000
# (plugin name is "aibridge" — no hyphen; a hyphen breaks slash-menu matching)
# Redeploy after changes: bump the version in .claude-plugin/*.json (same-version
# reinstall serves a stale zip), push, then marketplace update + reinstall.

# --- Or register just the MCP server, no skills (standalone) ---
claude mcp add -s user ai-bridge -- node --no-warnings D:\git\ai-bridge\src\server.mjs
```

## Phase-gate (any repo)

`scripts/check-review-evidence.mjs` asserts cross-vendor review evidence exists
before a phase tags/merges — wire one line into a consuming repo's verify chain:

```
node <ai-bridge>/scripts/check-review-evidence.mjs --label phase-b --vendors gpt,gemini --dir docs/reviews [--verdict] [--verdict-lines] [--gpt-dead]
```

Dual-sign = all listed vendor files present and non-empty; `--verdict` also
requires the arbitration record; `--verdict-lines` enforces the terminal
`VERDICT: GREEN|NEEDS-FIX` line per vendor file; GPT missing without
`--gpt-dead` fails loud (single-vendor Gemini gates are forbidden). Repo-agnostic.

## Usage notes

- `ai_review`: **by reference, never inline** — pass `cwd` and reference the
  diff range / changed paths / spec path in the prompt; the reviewer reads them
  itself. Append the xreview Output contract verbatim. Write `evidence_path`
  under the consuming repo's review-evidence dir.
- `ai_exec`: `cwd` is the blast radius; keep the tree clean (or pass
  `allow_dirty` knowingly). Use `report_path` to keep stdout to a summary.
- `ai_digest`: output should be facts, not judgment. Judgment-feeding reads stay
  in the Claude pool (methodology P4 boundary).
