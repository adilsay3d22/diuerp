// Renders every page for every role against the running dev server (http://localhost:3000). Run: node smoke.ts
import { run, get } from "./src/lib/db.ts";
import { randomBytes } from "node:crypto";

const thread = (await get<{ id: number }>("SELECT id FROM threads WHERE kind = 'direct' LIMIT 1"))?.id ?? 1;
const pages: [string, string, string[]][] = [
  ["student", "253-15-0001", ["/app", "/app/register", "/app/routine", "/app/courses", "/app/courses/11", "/app/attendance", "/app/clearance", "/app/results",
    "/app/fees", "/app/fees?tab=ledger", "/app/fees?tab=waivers", "/app/fees?tab=scholarships", "/app/fees?tab=plans", "/app/calendar", "/app/transport",
    "/app/exams", "/app/exams?stage=midterm", "/app/services", "/app/mentor", "/notices", "/profile", "/notifications", "/messages", `/messages/${thread}`,
    "/helpdesk", "/helpdesk/1", "/search?q=CSE", "/documents/admit?stage=midterm", "/api/calendar", "/api/live"]],
  ["teacher", "710001234", ["/app", "/app/sections", "/app/sections/10", "/app/sections/10?tab=assessments", "/app/sections/10?tab=grades", "/app/sections/10?tab=insights",
    "/app/sections/10?tab=roster", "/app/sections/10?tab=materials", "/app/sections/10?tab=exams", "/app/sections/10?tab=announce", "/app/sections/10?tab=assistants",
    "/app/routine", "/app/evaluations", "/messages"]],
  ["teacher", "710001301", ["/app/mentees", "/app/evaluations", `/messages/${thread}`]],
  ["ta", "253-15-0002", ["/app/sections", "/app/sections/10", "/app/sections/10?tab=roster"]],
  ["dept_head", "710001234", ["/admin/department", "/admin/students", "/admin/students/1", "/admin/helpdesk"]],
  ["registrar", "REG-0001", ["/admin/registrar", "/admin/registrar/catalogue", "/admin/registrar/catalogue?tab=programs", "/admin/registrar/rooms", "/admin/registrar/semesters",
    "/admin/registrar/enroll", "/admin/registrar/import", "/admin/students", "/admin/students/1", "/admission/1/offer", "/admin/helpdesk", "/documents/transcript?student=1"]],
  ["exam_controller", "EXC-0001", ["/admin/exam", "/admin/exam?sem=2", "/admin/exam/changes", "/admin/exam/changes?status=approved", "/admin/exam/schedule",
    "/admin/exam/schedule?stage=midterm", "/admin/exam/requests", "/admin/exam/requests?view=unpaid", "/admin/exam/evaluations", "/admin/exam/evaluations?sem=2",
    "/admin/exam/mentors", "/admin/exam/reports", "/admin/exam/reports?view=results&sem=2", "/admin/exam/reports?view=probation", "/admin/exam/reports?view=graduation",
    "/admin/export/registration", "/admin/export/graduation", "/documents/transcript?student=1"]],
  ["cashier", "CSH-0001", ["/admin/cashier", "/admin/cashier?q=253-15-0003", "/admin/cashier?q=253", "/admin/cashier/shift", "/receipt/R2026-000001", "/admin/cashier?q=APP-00004", "/admin/cashier?q=a"]],
  ["accounts_officer", "ACC-0001", ["/admin/accounts", "/admin/accounts/approvals", "/admin/accounts/invoicing", "/admin/accounts/fees", "/admin/accounts/waivers",
    "/admin/accounts/waivers?tab=scholarships", "/admin/accounts/waivers?tab=granted", "/admin/accounts/reconcile", "/admin/accounts/reconcile?tab=cash",
    "/admin/students/1", "/admin/export/defaulters", "/admin/helpdesk", "/admin/helpdesk/3"]],
  ["finance_head", "FIN-0001", ["/admin/accounts", "/admin/accounts/fees", "/admin/accounts/waivers"]],
  ["applicant", "APL-00002", ["/app", "/app/admission/2", "/admission/2/admit", "/admission/2/offer", "/admission/2/slip", "/notices", "/helpdesk"]],
  ["admissions_officer", "ADS-0001", ["/admin/admissions", "/admin/admissions/1", "/admin/admissions/1?status=under_review", "/admin/admissions/application/5"]],
  ["transport_officer", "TRO-0001", ["/admin/transport", "/admin/transport/map", "/admin/transport/trips", "/admin/transport/passes", "/admin/transport/passes?status=active",
    "/admin/transport/routes", "/admin/transport/routes?route=new", "/admin/transport/fleet", "/admin/helpdesk", "/admin/helpdesk/2", "/api/live"]],
  ["driver", "TRN-0001", ["/app", "/helpdesk"]],
  ["super_admin", "ADM-0001", ["/admin/system", "/admin/system/settings", "/admin/system/audit", "/admin/system/outbox", "/admin/export/audit", "/search?q=a", "/admin/helpdesk"]],
];

let bad = 0;
for (const [role, uni, urls] of pages) {
  const u = (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = ?", uni))!;
  const token = randomBytes(16).toString("hex");
  await run("INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?, datetime('now','+1 hour'))", token, u.id, role);
  for (const url of urls) {
    const r = await fetch("http://localhost:3000" + url, { headers: { cookie: `erp_session=${token}` }, redirect: "manual" });
    const t = await r.text();
    const err = r.status !== 200 || /Unhandled Runtime Error|Application error|Internal Server Error|__next_error__/.test(t);
    if (err) { bad++; console.log("FAIL", role, url, r.status, r.headers.get("location") ?? "", (t.match(/"message":"([^"]{0,200})/) ?? [])[1] ?? ""); }
  }
  await run("DELETE FROM sessions WHERE token = ?", token);
}
// Role guard: a student must not reach admin pages
{
  const u = (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = '253-15-0001'"))!;
  const token = randomBytes(16).toString("hex");
  await run("INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,'student', datetime('now','+1 hour'))", token, u.id);
  for (const url of ["/admin/accounts", "/admin/exam/requests", "/admin/helpdesk"]) {
    const r = await fetch("http://localhost:3000" + url, { headers: { cookie: `erp_session=${token}` }, redirect: "manual" });
    if (r.status !== 307) { bad++; console.log("GUARD FAIL", url, r.status); }
  }
  await run("DELETE FROM sessions WHERE token = ?", token);
}
// Public pages, brand assets and the 404 page
for (const [url, want] of [["/login", 200], ["/apply", 200], ["/login/forgot", 200], ["/apply/verify?email=a%40b.c", 200], ["/brand/diu-crest.png", 200],
  ["/brand/diu-wordmark.png", 200], ["/icon.png", 200], ["/no-such-page", 404]] as const) {
  const r = await fetch("http://localhost:3000" + url, { redirect: "manual" });
  if (r.status !== want) { bad++; console.log("PUBLIC FAIL", url, r.status); }
}
console.log(bad ? `${bad} failures` : "all pages OK");
