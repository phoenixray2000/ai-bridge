---
name: ai-model
description: View or switch the current execution scenario (which model executes tasks). Use when checking what scenario is active, or switching it because a quota pool's water level changed. State lives in ~/.claude/ai-model (single line). The scenario→model mapping itself is in the route skill.
---

# ai-model — execution scenario state

The execution scenario decides which model gets the execution volume (the bulk
consumer). Four scenarios, named by the preferred executor: **gpt** (default),
**sonnet**, **gemini**, **opus**. Full per-class mapping is the canonical table
in the `route` skill — this skill only manages the state.

State file: `~/.claude/ai-model`, one lowercase word. Missing = `gpt`.

## No argument — show current

```
cat ~/.claude/ai-model 2>/dev/null || echo "gpt (default, no state file)"
```

Report the active scenario in one line. Do not query quota water levels — that
was deliberately dropped; the user decides when to switch.

## With argument — switch

Validate the argument is one of `gpt|sonnet|gemini|opus`, then:

```
echo <scenario> > ~/.claude/ai-model
```

Confirm the new scenario. The change is global: every session's *next* dispatch
reads the file fresh (routing never caches the scenario in-session), so the
switch takes effect everywhere immediately — no restart.

## Why switch

Claude pool (Fable/Opus/Sonnet, shared 5x) is the chronic bottleneck → default
**gpt** keeps execution off it. Switch to **sonnet** when GPT quota is tight,
**gemini**/**opus** for specific needs. Switching moves only execution volume;
the Claude pool always retains spec/plan, orchestration, arbitration, subtle
fixes (see route invariants).
