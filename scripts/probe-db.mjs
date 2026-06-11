// Validate: the conversation .db contains the model answer even when
// transcript.jsonl is 0B. Walk protobuf wire format collecting strings.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CONV = path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations");

export function protoStrings(buf, depth = 0, out = []) {
  let i = 0;
  while (i < buf.length) {
    let shift = 0n, key = 0n, ok = false;
    while (i < buf.length) {
      const b = buf[i++];
      key |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) { ok = true; break; }
      shift += 7n;
      if (shift > 63n) break;
    }
    if (!ok) break;
    const wire = Number(key & 7n);
    if (wire === 0) { // varint
      while (i < buf.length && buf[i] & 0x80) i++;
      i++;
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else if (wire === 2) { // length-delimited
      let len = 0n; shift = 0n; ok = false;
      while (i < buf.length) {
        const b = buf[i++];
        len |= BigInt(b & 0x7f) << shift;
        if (!(b & 0x80)) { ok = true; break; }
        shift += 7n;
        if (shift > 63n) break;
      }
      if (!ok) break;
      const n = Number(len);
      if (n < 0 || i + n > buf.length) break;
      const slice = buf.subarray(i, i + n);
      i += n;
      const text = slice.toString("utf8");
      const printable = text.length > 0 && !text.includes("�") && /^[\x09\x0A\x0D\x20-\x7E-￿]*$/.test(text);
      if (printable && /[\x20-\x7E一-鿿]/.test(text)) out.push(text);
      if (depth < 6 && n > 1) protoStrings(slice, depth + 1, out); // also try as nested message
    } else break; // invalid wire type
  }
  return out;
}

if (process.argv[1]?.endsWith("probe-db.mjs")) {
  const newest = readdirSync(CONV)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ f, m: statSync(path.join(CONV, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .slice(0, 2);
  for (const { f } of newest) {
    const db = new DatabaseSync(path.join(CONV, f), { readOnly: true });
    const rows = db.prepare("SELECT idx, step_type, step_payload FROM steps WHERE step_type = 23 ORDER BY idx DESC").all();
    db.close();
    console.log(`== ${f} (${rows.length} planner steps)`);
    for (const row of rows.slice(0, 1)) {
      const strings = protoStrings(Buffer.from(row.step_payload));
      const longest = strings.sort((a, b) => b.length - a.length).slice(0, 5);
      console.log(`  idx=${row.idx} strings=${strings.length}; top: ${JSON.stringify(longest)}`);
    }
  }
}
