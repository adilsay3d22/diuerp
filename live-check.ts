// Checks a deployed site page by page for every demo role. Run: node --env-file=.env.turso live-check.ts https://your-site.vercel.app
// Uses short-lived sessions written straight into the database (like smoke.ts), then removes them.
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) throw new Error("Pass the site URL, e.g. https://diuerp.vercel.app");
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const one = async (sql: string, ...args: (string | number)[]) => (await db.execute({ sql, args })).rows[0];
const section = Number((await one("SELECT id FROM offerings WHERE capacity > 0 ORDER BY id LIMIT 1"))?.id ?? 1);
const studentRec = Number((await one("SELECT id FROM students ORDER BY id LIMIT 1"))?.id ?? 1);
const cycle = Number((await one("SELECT id FROM admission_cycles ORDER BY id LIMIT 1"))?.id ?? 1);

const plan: [string, string, string[]][] = [
  ["student", "241-45-013", ["/app", "/app/register", "/app/routine", "/app/courses", "/app/attendance", "/app/exams", "/app/clearance", "/app/results", "/app/services",
    "/app/fees", "/app/fees?tab=ledger", "/app/transport", "/app/mentor", "/app/calendar", "/notices", "/messages", "/helpdesk", "/notifications", "/profile", "/search?q=CSE"]],
  ["teacher", "710001301", ["/app", "/app/sections", `/app/sections/${section}`, `/app/sections/${section}?tab=assessments`, `/app/sections/${section}?tab=grades`,
    `/app/sections/${section}?tab=insights`, `/app/sections/${section}?tab=roster`, "/app/routine", "/app/mentees", "/app/evaluations"]],
  ["dept_head", "710001234", ["/admin/department", "/admin/students", `/admin/students/${studentRec}`]],
  ["registrar", "REG-0001", ["/admin/registrar", "/admin/registrar/catalogue", "/admin/registrar/rooms", "/admin/registrar/semesters", "/admin/registrar/enroll", "/admin/registrar/import", "/admin/students"]],
  ["exam_controller", "EXC-0001", ["/admin/exam", "/admin/exam/changes", "/admin/exam/schedule", "/admin/exam/requests", "/admin/exam/evaluations", "/admin/exam/mentors", "/admin/exam/reports"]],
  ["cashier", "CSH-0001", ["/admin/cashier", "/admin/cashier?q=241-45-013", "/admin/cashier/shift"]],
  ["accounts_officer", "ACC-0001", ["/admin/accounts", "/admin/accounts/approvals", "/admin/accounts/invoicing", "/admin/accounts/waivers", "/admin/accounts/reconcile", "/admin/accounts/fees"]],
  ["finance_head", "FIN-0001", ["/admin/accounts", "/admin/accounts/fees"]],
  ["admissions_officer", "ADS-0001", ["/admin/admissions", `/admin/admissions/${cycle}`]],
  ["transport_officer", "TRO-0001", ["/admin/transport", "/admin/transport/map", "/admin/transport/trips", "/admin/transport/passes", "/admin/transport/routes", "/admin/transport/fleet"]],
  ["driver", "TRN-0001", ["/app", "/helpdesk"]],
  ["super_admin", "ADM-0001", ["/admin/system", "/admin/system/settings", "/admin/system/audit", "/admin/system/outbox"]],
];

let bad = 0, n = 0, slow = 0;
const tokens: string[] = [];
for (const [role, uni, urls] of plan) {
  const u = await one("SELECT id FROM users WHERE uni_id = ?", uni);
  if (!u) { console.log("MISSING ACCOUNT", uni); bad++; continue; }
  const token = randomBytes(16).toString("hex");
  tokens.push(token);
  await db.execute({ sql: "INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?, datetime('now','+15 minutes'))", args: [token, Number(u.id), role] });
  for (const url of urls) {
    const t0 = Date.now();
    const r = await fetch(base + url, { headers: { cookie: `erp_session=${token}` }, redirect: "manual" });
    const body = await r.text();
    const ms = Date.now() - t0;
    n++;
    if (ms > 3000) slow++;
    if (r.status !== 200 || /Application error|Internal Server Error|This page could not load/.test(body)) { bad++; console.log("FAIL", role, url, r.status, r.headers.get("location") ?? ""); }
  }
  console.log(`${role.padEnd(18)} ${urls.length} pages ok`);
}
// Role guard on the live site: a student is sent away from office pages
{
  const u = await one("SELECT id FROM users WHERE uni_id = '241-45-013'");
  const token = randomBytes(16).toString("hex");
  tokens.push(token);
  await db.execute({ sql: "INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,'student', datetime('now','+15 minutes'))", args: [token, Number(u!.id)] });
  for (const url of ["/admin/accounts", "/admin/system"]) {
    const r = await fetch(base + url, { headers: { cookie: `erp_session=${token}` }, redirect: "manual" });
    if (r.status !== 307) { bad++; console.log("GUARD FAIL", url, r.status); }
  }
}
for (const t of tokens) await db.execute({ sql: "DELETE FROM sessions WHERE token = ?", args: [t] });
console.log(bad ? `${bad} problems in ${n} pages` : `all ${n} pages OK on ${base} (${slow} slower than 3 s)`);
db.close();
