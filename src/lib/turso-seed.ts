// Load seed data into Turso: `npm run turso:demo` (classroom demo) or `npm run turso:full` (full test data).
// Seeds a temporary local file with the normal seed script, then copies every table to Turso in large batches,
// which takes seconds instead of thousands of one-by-one network round trips. Reads credentials from .env.turso.
import { createClient, type InStatement } from "@libsql/client";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) throw new Error("Put TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.turso first (see DEPLOY.md).");
const which = process.argv[2] === "full" ? "seed.ts" : "seed-demo.ts";

// 1. Seed a throwaway local file (hide the Turso URL so db.ts picks the file)
const file = join(tmpdir(), `erp-seed-${Date.now()}.db`);
delete process.env.TURSO_DATABASE_URL;
process.env.DB_PATH = file;
await import(`./${which}`);

// 2. Replace everything in Turso with the local copy
const src = createClient({ url: `file:${file}` });
const dst = createClient({ url, authToken });
const old = (await dst.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%'")).rows.map((r) => String(r.name));
if (old.length) await dst.executeMultiple(`PRAGMA foreign_keys = OFF; ${old.map((t) => `DROP TABLE IF EXISTS "${t}";`).join(" ")}`);
const objects = (await src.execute("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'index', rowid")).rows;
await dst.batch(objects.map((o) => String(o.sql)), "write");
let total = 0;
for (const o of objects.filter((x) => x.type === "table")) {
  const t = String(o.name);
  const res = await src.execute(`SELECT * FROM "${t}"`);
  if (!res.rows.length) continue;
  const cols = res.columns.map((c) => `"${c}"`).join(", ");
  const marks = res.columns.map(() => "?").join(", ");
  const stmts: InStatement[] = res.rows.map((r) => ({ sql: `INSERT INTO "${t}" (${cols}) VALUES (${marks})`, args: res.columns.map((c) => r[c]) }));
  for (let i = 0; i < stmts.length; i += 400) await dst.batch(stmts.slice(i, i + 400), "write");
  total += stmts.length;
}
// 3. Check the copy
const users = Number((await dst.execute("SELECT COUNT(*) AS n FROM users")).rows[0].n);
console.log(`Turso now holds the ${process.argv[2] === "full" ? "full test" : "classroom demo"} data: ${objects.length} tables and indexes, ${total} rows, ${users} accounts.`);
src.close();
dst.close();
