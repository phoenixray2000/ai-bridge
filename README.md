# ai-bridge

MCP server exposing **GPT (codex CLI)** and **Gemini (agy CLI)** as role-shaped
tools for cross-vendor development workflows. General-purpose: no project
coupling, no fixed directories — install once at user scope, use from any repo.

Encodes the roles of the model-selection methodology
(`docs/model-selection-methodology.md` — rationale; the skills are the
behavioral SPOT):

| Tool | Role | Access | Default |
|---|---|---|---|
| `ai_review_start` | adversarial cross-vendor review → **detached background job** | read-only **by reference** on `cwd` — gpt runs git itself; **gemini reads a MATERIALIZED diff file** (headless `--sandbox` auto-denies command tools; use `git diff --output=<file>`, never shell `>`); omit `cwd` only for repo-less snippets | effort `high`, budget 25 min; `expect_verdict: true` on gate calls |
| `ai_exec_start` | mechanical task execution → **detached background job** | write, confined to the given `cwd` (clean-git-tree guard, checked synchronously at start) | effort `medium`, budget 25 min |
| `ai_job_status` / `ai_job_result` / `ai_job_cancel` / `ai_job_list` | job lifecycle: instant state + liveness diagnostics / long-poll collect (300s default) / kill tree / cross-session discovery (newest first) | jobs live on disk (`~/.ai-bridge/jobs`), survive session death, readable from a new session; terminal jobs GC after 7 days (evidence/report files unaffected) | — |
| `ai_digest` | context offload (P4): bulky material in, summary out — **synchronous** (digests are short) | embedded files (no fs) or read on `cwd` | Gemini Flash, effort `medium` |

**Why async jobs**: a blocking MCP call ties a 20-40min vendor run to the Claude
session — the stdio idle-timeout (default 30 min) aborts silently-long reviews,
a session crash kills the in-flight run, and the harness retry then re-launches
agy (clustered cold-starts provoke browser OAuth). Start returns in
milliseconds; the **idempotency key** (kind+vendor+cwd+prompt+effort+paths,
plus `expect_verdict` when true) maps any retry back to the original running
job instead of double-launching; a job_id lost with a dead session is found
again via `ai_job_list` (never re-send a re-phrased prompt — it misses the key).

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
  the caller SKIPS the Gemini seat for the round (the remaining seat anchors —
  GPT normally, Opus under `-gpt`, flagged thin), never loops.
  Policy has offline tests (`scripts/smoke.mjs`, injected runner).
- **codex --json**: clean answer text, session id (feeds `resume` for
  managed-loop fix rounds), token usage.
- **dirty-tree guard**: `ai_exec_start` refuses a cwd that is not a clean git
  tree unless `allow_dirty: true` — git is the safety net for agent writes.
  Real-file writes under danger-full-access verified on Windows.
- **jobs reconcile loudly**: a job whose detached runner died without a
  terminal marker is reported FAILED with the runner-log tail — never eternal
  "running". agy's `--print-timeout` follows the job's `timeout_minutes`
  (it was a hardcoded 15m that silently killed long whole-batch reviews).
- **wedge watchdog (lazy CPU probe)**: vendor stdout/stderr tees to
  `<jobDir>/stdout.log`; after 10 min of silence the runner takes a baseline
  plus two follow-up CPU samples of the vendor process tree (three samples,
  5 min apart) — both deltas flat = dead connection →
  kill + budget-bounded retry (review only — a wedged **exec** is never
  auto-retried: the killed attempt may have made writes; inspect the tree and
  resume deliberately; synchronous `ai_digest` runs without the watchdog).
  Healthy path costs nothing; diagnostics land in
  `progress.json` (shown by `ai_job_status`). Knobs:
  `AI_BRIDGE_WEDGE_SILENCE_MS` / `AI_BRIDGE_WEDGE_PROBE_GAP_MS`.
- **`timeout_minutes` is a JOB-LEVEL budget**: retries spend the remainder
  (never restart the clock); under 60s left the job fails instead of retrying.
- **VERDICT exit contract**: `expect_verdict: true` (mandatory on gate calls)
  fails a review whose output lacks the terminal `VERDICT:` line — exit 0 +
  non-empty is not proof of a review (evidence still written for forensics).
- **auto-denied = permanent**: agy stderr matching the headless auto-denied
  signature fails immediately with the materialized-diff guidance — no retry,
  no store recovery. Recovered store answers get a plausibility floor (a bare
  token like `run_command` is a recovery failure, not an answer).
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
# normal panel (GPT anchoring):
node <ai-bridge>/scripts/check-review-evidence.mjs --label phase-b --vendors gpt,gemini --dir docs/reviews --verdict --verdict-lines
# -gpt (GPT quota dead — vendors must match the gate's ACTUAL R1 panel):
node <ai-bridge>/scripts/check-review-evidence.mjs --label phase-b --vendors gemini,opus --dir docs/reviews --verdict --verdict-lines --gpt-dead
```

Dual-sign = all listed vendor files present and non-empty; `--verdict` requires
the arbitration record (the anti-confabulation anchor) and `--verdict-lines`
enforces the terminal `VERDICT: GREEN|NEEDS-FIX` line per vendor file — **both
are MANDATORY on any new gate wiring** (xreview verdict-wiring rule; omitting
them is legal only on pre-existing legacy labels — forward-only, no retrofit —
and ad-hoc one-shot reviews never wire the checker at all). Wire the gate's
ROOT label (R1 evidence + the single `<label>-verdict.md`); per-round `-rN`
evidence anchoring is the arbitration contract inside the verdict file, not the
checker's job. GPT missing without `--gpt-dead` fails loud (single-vendor
Gemini gates are forbidden). Repo-agnostic.

## Usage notes

- `ai_review_start`: **by reference, never inline** — pass `cwd` and reference
  changed paths / spec path in the prompt (gpt: live diff range; gemini: a
  materialized diff file via `git diff --output=<file>`, prompt forbids running
  commands). Append the xreview Output contract verbatim and pass
  `expect_verdict: true` on gate calls. Write `evidence_path` under the
  consuming repo's review-evidence dir. Collect with `ai_job_result`; while it
  reports running, call it again — never re-start. `timeout_minutes` per the
  xreview table: regular 25 (omit) / closing-gate whole-diff 90 / huge batch or
  cutover 120–180; when unsure take the larger tier.
- `ai_exec_start`: `cwd` is the blast radius; keep the tree clean (or pass
  `allow_dirty` knowingly). Use `report_path` to keep stdout to a summary. The
  completed result carries the vendor session id for `resume`.
- `ai_digest`: output should be facts, not judgment. Judgment-feeding reads stay
  in the Claude pool (methodology P4 boundary).
