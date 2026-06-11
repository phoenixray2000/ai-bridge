---
name: digest
description: Context offload — digest bulky raw material (logs, dumps, generated code, large files, repo-wide scans, doc lookups) into a facts-only summary WITHOUT reading it into your own context. Use the moment you're about to open something large whose output is fact-extraction, not judgment. Burns the non-bottleneck Gemini pool, not the Claude pool, and keeps the orchestrator window clean.
---

# digest — context offload (methodology P4)

Quota burns not only on *thinking* but on *reading bulk material*. Reading a
500KB log yourself double-charges: it burns the Claude pool AND pollutes your
context window (which is more precious than quota — once it's full of raw
material your later judgment degrades). Offload it.

## The rule of thumb — output nature, not material size

- Output is **fact-extraction** ("which error clusters, when did each first
  appear", "how does this API work", "which files reference X") → **digest it**;
  errors get caught by downstream verify / cross-checks.
- Output is **judgment input** (architecture understanding for writing a plan,
  close reading for arbitration) → **do NOT offload**; the value is in the
  judgment after reading, and a model that doesn't know the repo's intent will
  drop the load-bearing detail as noise. Keep it in the Claude pool.

## How

MCP `ai_digest`:
- Small file set → `files: [...]` (contents embedded, ≤400KB total, reader gets
  no fs access).
- Repo-wide scan → `cwd: <dir>` (reader gets read access to that directory).
- `vendor` defaults gemini (Flash tier — digestion needs no deep reasoning).
- `prompt` = exactly what facts to extract.

You receive only the summary (~1–2KB), never the raw material. If you find
yourself about to `Read` a big file before deciding what to do with it — stop,
that's this skill's cue.
