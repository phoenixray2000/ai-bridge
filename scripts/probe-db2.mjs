import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { protoStrings } from "./probe-db.mjs";

for (const id of [
  "75eb672f-aa6a-48a4-8936-29d23b6f0ce1", // repo cwd, transcript 0B
  "ddf47fb5-2f41-4a76-880a-ae1c25dff4f6", // repo cwd, stdin-ignore probe
  "ba8f4aa5-8f93-4ecb-b637-4657d45d4ba9", // home cwd, 1..50 DONE success
]) {
  const db = new DatabaseSync(
    path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations", `${id}.db`),
    { readOnly: true },
  );
  const row = db.prepare("SELECT step_payload FROM steps WHERE step_type = 15 ORDER BY idx DESC").get();
  db.close();
  const strings = protoStrings(Buffer.from(row.step_payload)).sort((a, b) => b.length - a.length);
  console.log(id.slice(0, 8), JSON.stringify(strings.slice(0, 3).map((s) => s.slice(0, 90))));
}
