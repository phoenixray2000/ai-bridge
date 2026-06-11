#!/usr/bin/env node
// Generic phase-gate: assert that cross-vendor review evidence exists before a
// phase is allowed to tag/merge. Repo-agnostic — any project wires one line of
// its verify chain to call this. The evidence path convention is set by the
// xreview skill: <reviews-dir>/<label>-<vendor>.md.
//
// Usage:
//   node check-review-evidence.mjs --label phase-b --vendors gpt,gemini [--dir <reviews-dir>] [--verdict]
//
// Exits 0 if every <label>-<vendor>.md exists and is non-empty (dual-sign =
// all listed vendors present). Exits 1 with a loud listing otherwise. With
// --verdict, also requires <label>-verdict.md (the arbitration record).
import { existsSync, statSync } from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const label = arg("label");
const vendors = arg("vendors", "gpt,gemini").split(",").map((v) => v.trim()).filter(Boolean);
const dir = path.resolve(arg("dir", path.join("docs", "superpowers", "reviews")));
const requireVerdict = has("verdict");

if (!label) {
  console.error("ERROR: --label is required (e.g. --label phase-b)");
  process.exit(2);
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
    `\nRun /ai-bridge:xreview for this phase (vendors: ${vendors.join(" + ")})` +
    (requireVerdict ? " and record the arbitration verdict" : "") + " before tagging.",
  );
  process.exit(1);
}

console.log(`review gate OK: ${label} — ${required.map((f) => path.basename(f)).join(", ")}`);
