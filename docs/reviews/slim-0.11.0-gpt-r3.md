# ai-bridge review evidence
- vendor: gpt
- effort: high
- command: codex exec --skip-git-repo-check --sandbox danger-full-access --json -c model_reasoning_effort="high" - <stdin-prompt> (cwd=D:\git\ai-bridge)
- written: 2026-07-06T04:59:59.702Z

---
[MAJOR] package.json:8 — README requires Node ≥22 and the runtime imports `node:sqlite`, but package engines still allow Node 20, so installs can pass on a runtime that cannot start the server → change `engines.node` to `>=22` and regenerate `package-lock.json`.

[MINOR] package-lock.json:3 — lockfile root version remains `0.1.0` while `package.json` / plugin / marketplace are `0.11.0`, leaving release metadata inconsistent → regenerate/update the lockfile so both root version fields are `0.11.0`.

[MINOR] src/vendors.mjs:403 — the agy retry comment still says final failure drops Gemini to “clean Opus”, contradicting the new SKIP/no-seat-swap policy enforced by code and smoke → update the comment to say final failure skips the Gemini seat with GPT anchoring.

[MINOR] scripts/check-review-evidence.mjs:62 — failure guidance still tells users to run `/ai-bridge:xreview`, but the plugin slash prefix is now `/aibridge:*` → update the emitted command string to `/aibridge:xreview` and keep usage text aligned.

[MINOR] docs/model-selection-methodology.md:143 — Layer 0 is still described as “六维” while the current `smart-plan` gate enforces eight dimensions including visual-contract wiring and reality-premise grounding → update the rationale summary to eight dimensions or remove the stale count.

[MINOR] skills/gpt/SKILL.md:14 — direct GPT skill still describes `ai_review` as “read-only sandbox” with full inline material, conflicting with current codex `danger-full-access` reality and by-reference repo review guidance → update the skill text to describe danger-full-access/read-only intent and `cwd` by-reference review for repo material.
VERDICT: GREEN
