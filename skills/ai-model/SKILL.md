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

`~/.claude/ai-model` = `<scenario>` optionally followed by `-gpt`.

- scenario ∈ `gpt` (default) | `sonnet` | `gemini` | `opus` — the execution side.
- `-gpt` — GPT quota is dead: drop GPT from review (swap in a clean-window Opus)
  and never dispatch execution to GPT.

`-gpt` is the ONLY availability flag, on purpose: GPT is the single reviewer that
is both **top-tier and exhaustible**, so it's the one thing worth toggling.
Gemini is cheap / ~always available; Opus is your own Claude pool (can't be
quota-dead). So there's no `-gemini` / `-opus` — they'd be category errors.

```
sonnet          # sonnet executes; GPT alive → review GPT + Gemini
sonnet -gpt     # sonnet executes; GPT dead → review Gemini + Opus
gpt -gpt        # INCOHERENT — kills the executor; reject on write
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

Parse the argument into `<scenario>` + optional `-gpt`. **Validate:**
- scenario is one of `gpt|sonnet|gemini|opus`;
- the only flag is `-gpt` (reject `-gemini`/`-opus` — category errors, see Format);
- **`gpt -gpt` is incoherent** (kills the executor) → refuse and explain.

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
to move execution volume when GPT (or any pool) is tight. Add `-gpt` when GPT's
quota is fully dead so it also leaves the review panel (Opus covers its slot).
Keep GPT in review whenever it has any quota — it's the strongest reviewer. Switching
moves only execution volume + panel composition; the Claude pool always retains
spec/plan, orchestration, arbitration, subtle fixes (see route invariants).
