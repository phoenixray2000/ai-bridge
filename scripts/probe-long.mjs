import { callVendor } from "../src/vendors.mjs";

const r = await callVendor({
  vendor: "gemini", role: "digest", family: "flash", effort: "low",
  prompt: "List the numbers 1 to 50, one per line, then end with the word DONE. No other text.",
  cwd: "D:/git/ai-bridge",
  timeoutMs: 5 * 60 * 1000,
});
if (!r.ok) {
  console.error("FAIL:", r.error);
  process.exit(1);
}
const lines = r.output.trim().split("\n");
console.log(`note=${r.note ?? "stdout"} lines=${lines.length} first=${lines[0]} last=${lines.at(-1)}`);
console.log(/^1$/.test(lines[0]) && /DONE/.test(lines.at(-1)) && lines.length >= 51 ? "LONG-ANSWER OK" : "LONG-ANSWER MISMATCH:\n" + r.output.slice(0, 400));
