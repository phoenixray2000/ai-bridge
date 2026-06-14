---
name: ai-model
description: View or switch the execution scenario AND vendor availability in one knob. Use when checking the active routing, switching which model executes (gpt/sonnet/gemini/opus), or marking a vendor as quota-dead. State lives in ~/.claude/ai-model (single line). The review panel is fully derived from this — there are no separate disable / opus-panel switches.
---

# ai-model — the single routing knob

One file, one line, drives everything: which model executes, and which vendors
are alive. The review panel is **derived** from it (see route skill) — there are
deliberately NO separate `ai-disabled` / `ai-xreview-opus` files (folded in to
kill cross-switch conflicts and surface).

## Format

`~/.claude/ai-model` = `<scenario>` optionally followed by `-<vendor>` exclusions.

- scenario ∈ `gpt` (default) | `sonnet` | `gemini` | `opus` — the execution side.
- `-<vendor>` ∈ `-gpt` | `-gemini` — that external vendor is quota-dead: dropped
  from review panels and never dispatched.

```
sonnet          # sonnet executes; all vendors alive
sonnet -gpt     # sonnet executes; GPT is dead (drop from review)
gpt -gpt        # INCOHERENT — executor excluded; reject on write
```

Missing file = `gpt` (default).

## No argument — show current

```
cat ~/.claude/ai-model 2>/dev/null || echo "gpt (default)"
```

Report the active scenario + any exclusions in one line, then state the derived
review panel (apply the route skill's derivation rule). Do not query quota water
levels — the user decides when to switch.

## With argument — switch

Parse the argument into `<scenario>` + optional `-<vendor>` tokens. **Validate:**
- scenario is one of `gpt|sonnet|gemini|opus`;
- exclusions are `gpt`/`gemini`;
- **the scenario's executor is not itself excluded** (`gpt -gpt`, `gemini -gemini`
  are incoherent → refuse and explain).

Then write the whole line:

```
echo "<scenario> [-vendor ...]" > ~/.claude/ai-model
```

Confirm the new state AND the derived review panel. The change is global: every
session's next dispatch reads the file fresh (never cached), so it takes effect
everywhere immediately — no restart.

## Why switch

Claude pool (Opus/Sonnet, shared 5x; Fable retired) is the chronic bottleneck →
default **gpt** keeps execution off it. Switch to **sonnet**/**gemini**/**opus**
to move execution volume when GPT (or any pool) is tight. Add `-gpt`/`-gemini`
when that vendor's quota is dead so it also leaves the review panel. Switching
moves only execution volume + panel composition; the Claude pool always retains
spec/plan, orchestration, arbitration, subtle fixes (see route invariants).
