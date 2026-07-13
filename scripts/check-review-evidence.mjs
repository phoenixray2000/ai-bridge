#!/usr/bin/env node
// Generic phase-gate: assert that cross-vendor review evidence exists before a
// phase is allowed to tag/merge. Repo-agnostic — any project wires one line of
// its verify chain to call this. The evidence path convention is set by the
// xreview skill: <reviews-dir>/<label>-<vendor>.md.
//
// Usage:
//   node check-review-evidence.mjs --label phase-b --vendors gpt,gemini [--dir <reviews-dir>] [--verdict] [--verdict-lines]
//
// Exits 0 if every <label>-<vendor>.md exists and is non-empty (dual-sign =
// all listed vendors present). Exits 1 with a loud listing otherwise. With
// --verdict, also requires <label>-verdict.md (the arbitration record). With
// --verdict-lines, also enforces the xreview Output contract: each vendor
// evidence file's last non-empty line must be `VERDICT: GREEN` or
// `VERDICT: NEEDS-FIX` (a file without it is malformed — re-run, don't summarize).
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const label = arg("label");
const vendors = arg("vendors", "gpt,gemini").split(",").map((v) => v.trim()).filter(Boolean);
const dir = path.resolve(arg("dir", path.join("docs", "reviews")));
const requireVerdict = has("verdict");
const requireVerdictLines = has("verdict-lines");
const gptDead = has("gpt-dead");

if (!label) {
  console.error("ERROR: --label is required (e.g. --label phase-b)");
  process.exit(2);
}

// 铁律: GPT is MANDATORY in any gating review unless GPT quota is dead (then the
// panel swaps to Opus, never to Gemini-only). A gate without GPT and without an
// explicit --gpt-dead is the single-vendor-Gemini leak — fail loud, don't pass it.
if (!gptDead && !vendors.includes("gpt")) {
  console.error(`REVIEW GATE FAILED for "${label}": GPT missing from a gating review (vendors: ${vendors.join(", ")}).`);
  console.error(`GPT is mandatory while it has quota — single-vendor Gemini is forbidden as a gate.`);
  console.error(`If GPT quota is genuinely dead, pass --gpt-dead (panel should then carry opus, not gemini-only).`);
  process.exit(1);
}

const required = vendors.map((v) => path.join(dir, `${label}-${v}.md`));
if (requireVerdict) required.push(path.join(dir, `${label}-verdict.md`));

const missing = [];
const empty = [];
for (const f of required) {
  if (!existsSync(f)) missing.push(f);
  else if (statSync(f).size === 0) empty.push(f);
}

if (missing.length || empty.length) {
  console.error(`REVIEW GATE FAILED for "${label}" (dir: ${dir})`);
  for (const f of missing) console.error(`  missing: ${f}`);
  for (const f of empty) console.error(`  empty:   ${f}`);
  console.error(
    `\nRun /aibridge:xreview for this phase (vendors: ${vendors.join(" + ")})` +
    (requireVerdict ? " and record the arbitration verdict" : "") + " before tagging.",
  );
  process.exit(1);
}

// Output-contract enforcement: each vendor evidence file must end with a
// terminal `VERDICT: GREEN|NEEDS-FIX` line. Only the vendor files, not the
// arbitration verdict.md (that's the orchestrator's own disposition record).
if (requireVerdictLines) {
  const verdictRe = /^VERDICT:\s*(GREEN|NEEDS-FIX)\s*$/;
  const bad = [];
  const verdicts = [];
  for (const v of vendors) {
    const f = path.join(dir, `${label}-${v}.md`);
    const lines = readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
    const last = lines[lines.length - 1] ?? "";
    const m = last.match(verdictRe);
    if (!m) bad.push({ f, last });
    else verdicts.push({ v, verdict: m[1] });
  }
  if (bad.length) {
    console.error(`REVIEW GATE FAILED for "${label}": malformed evidence (Output contract violated)`);
    for (const { f, last } of bad) {
      console.error(`  ${f}\n    last non-empty line: ${last ? JSON.stringify(last) : "(file blank)"}`);
    }
    console.error(`\nEvery vendor file must end with exactly: VERDICT: GREEN  or  VERDICT: NEEDS-FIX`);
    console.error(`Re-run the review for the offending vendor — do not hand-summarize.`);
    process.exit(1);
  }
  const summary = verdicts.map(({ v, verdict }) => `${v}=${verdict}`).join(", ");
  console.log(`review verdicts: ${label} — ${summary}`);
}

console.log(`review gate OK: ${label} — ${required.map((f) => path.basename(f)).join(", ")}`);
