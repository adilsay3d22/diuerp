// CORE: identity, roles, notifications, notices, settings, audit.
import { randomInt, timingSafeEqual } from "node:crypto";
import { all, get, run, insert, audit, hashPassword, tx } from "../lib/db.ts";

export const ROLES = {
  applicant: { label: "Applicant", side: "app" },
  student: { label: "Student", side: "app" },
  teacher: { label: "Teacher", side: "app" },
  ta: { label: "Teaching Assistant", side: "app" },
  driver: { label: "Driver / Bus assistant", side: "app" },
  admissions_officer: { label: "Admissions Officer", side: "admin" },
  registrar: { label: "Registrar", side: "admin" },
  exam_controller: { label: "Exam Controller", side: "admin" },
  dept_head: { label: "Department Head", side: "admin" },
  cashier: { label: "Cashier", side: "admin" },
  accounts_officer: { label: "Accounts Officer", side: "admin" },
  finance_head: { label: "Finance Head", side: "admin" },
  transport_officer: { label: "Transport Officer", side: "admin" },
  super_admin: { label: "Super Admin", side: "admin" },
} as const;
export type Role = keyof typeof ROLES;

export type User = { id: number; uni_id: string; email: string; name: string; phone: string | null; status: string;
  blood_group: string | null; emergency_contact: string | null };

export const userRoles = async (userId: number) =>
  await all<{ role: Role; dept_id: number | null }>("SELECT role, dept_id FROM user_roles WHERE user_id = ? ORDER BY rowid", userId);

export async function createUser(u: { uni_id: string; email: string; name: string; phone?: string; password: string }, roles: { role: Role; dept_id?: number }[]) {
  return await tx(async () => {
    const id = await insert("INSERT INTO users (uni_id, email, name, phone, password_hash) VALUES (?,?,?,?,?)",
      u.uni_id, u.email.toLowerCase(), u.name, u.phone ?? null, hashPassword(u.password));
    for (const r of roles) await run("INSERT INTO user_roles (user_id, role, dept_id) VALUES (?,?,?)", id, r.role, r.dept_id ?? null);
    return id;
  });
}

// CORE-8: every module notifies through here. Category comes from where the notification points.
export const CATEGORIES = {
  fees: { label: "Fees and payments", critical: true }, exam: { label: "Exams and results", critical: true },
  admission: { label: "Admission", critical: true }, account: { label: "Account and security", critical: true },
  academic: { label: "Classes, attendance and courses", critical: false }, transport: { label: "Transport", critical: false },
  messages: { label: "Messages", critical: false }, helpdesk: { label: "Help desk", critical: false }, general: { label: "Notices and other", critical: false },
} as const;
export type Category = keyof typeof CATEGORIES;
export function categoryOf(href: string): Category {
  const m: [RegExp, Category][] = [
    [/^\/(app\/fees|receipt|admin\/accounts|admin\/cashier)/, "fees"], [/^\/(app\/results|app\/clearance|app\/exams|admin\/exam)/, "exam"],
    [/^\/(app\/admission|admin\/admissions|admin\/registrar\/enroll)/, "admission"], [/^\/(profile|login)/, "account"],
    [/^\/(app\/transport|admin\/transport)/, "transport"], [/^\/messages/, "messages"], [/^\/helpdesk|^\/admin\/helpdesk/, "helpdesk"],
    [/^\/(app|admin\/department)/, "academic"],
  ];
  return m.find(([re]) => re.test(href))?.[1] ?? "general";
}
export const prefs = async (userId: number) => {
  const rows = await all<{ category: string; email: number; sms: number; muted: number }>("SELECT * FROM notification_prefs WHERE user_id = ?", userId);
  return Object.fromEntries((Object.keys(CATEGORIES) as Category[]).map((c) => {
    const p = rows.find((r) => r.category === c);
    return [c, { email: p ? !!p.email : true, sms: p ? !!p.sms : CATEGORIES[c].critical, muted: p ? !!p.muted && !CATEGORIES[c].critical : false }];
  })) as Record<Category, { email: boolean; sms: boolean; muted: boolean }>;
};
export async function setPrefs(userId: number, values: Record<string, { email: boolean; sms: boolean; muted: boolean }>) {
  for (const [c, v] of Object.entries(values)) {
    if (!(c in CATEGORIES)) continue;
    await run("INSERT OR REPLACE INTO notification_prefs (user_id, category, email, sms, muted) VALUES (?,?,?,?,?)", userId, c, +v.email, +v.sms,
      CATEGORIES[c as Category].critical ? 0 : +v.muted);
  }
}

// ponytail: console provider; set up SMTP / an SMS gateway here. Every send is logged in outbox either way.
export async function deliver(userId: number | null, channel: "email" | "sms", to: string | null, subject: string, body: string) {
  if (!to) return;
  if (process.env.NODE_ENV !== "test") console.log(`[${channel}] -> ${to}: ${subject}`);
  await run("INSERT INTO outbox (user_id, channel, to_addr, subject, body) VALUES (?,?,?,?,?)", userId, channel, to, subject, body);
}

export async function notify(userIds: number[], title: string, body = "", href = "", category: Category = categoryOf(href)) {
  for (const id of new Set(userIds)) {
    const p = (await prefs(id))[category];
    await run("INSERT INTO notifications (user_id, title, body, href, category, read) VALUES (?,?,?,?,?,?)", id, title, body, href, category, p.muted ? 1 : 0);
    if (p.muted) continue;
    const u = await get<{ email: string; phone: string | null }>("SELECT email, phone FROM users WHERE id = ?", id);
    if (!u) continue;
    if (p.email) await deliver(id, "email", u.email, title, body);
    if (p.sms) await deliver(id, "sms", u.phone, title, `${title}. ${body}`.slice(0, 160));
  }
}

// One-time codes (applicant verification CORE-4/ADM-U-1, 2-step login CORE-5)
export async function issueCode(userId: number, purpose = "Your DIU ERP code") {
  const code = String(randomInt(100000, 1000000));
  await run("INSERT OR REPLACE INTO otps (user_id, code, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))", userId, code);
  const u = await get<{ email: string; phone: string | null }>("SELECT email, phone FROM users WHERE id = ?", userId);
  await deliver(userId, "email", u?.email ?? null, purpose, `${code} is your code. It expires in 10 minutes.`);
  await deliver(userId, "sms", u?.phone ?? null, purpose, `${code} is your DIU ERP code.`);
  return code;
}
export async function checkCode(userId: number, code: string) {
  const o = await get<{ code: string }>("SELECT code FROM otps WHERE user_id = ? AND expires_at > datetime('now')", userId);
  if (!o || !timingSafeEqual(Buffer.from(o.code), Buffer.from(code.trim().padEnd(6).slice(0, 6)))) return false;
  await run("DELETE FROM otps WHERE user_id = ?", userId);
  return true;
}
export const usersWithRole = async (role: Role) =>
  (await all<{ user_id: number }>("SELECT user_id FROM user_roles WHERE role = ?", role)).map((r) => r.user_id);

// Notices (CORE-10). audience: all | role | department | section; audience_ref holds the role / dept id / offering id.
export async function noticesFor(userId: number, roles: { role: string; dept_id: number | null }[], opts: { category?: string; limit?: number } = {}) {
  const deptIds = (await all<{ dept_id: number }>(
    `SELECT p.dept_id FROM students s JOIN programs p ON p.id = s.program_id WHERE s.user_id = ?
     UNION SELECT dept_id FROM teachers WHERE user_id = ?`, userId, userId)).map((r) => String(r.dept_id));
  const sections = (await all<{ id: number }>(
    `SELECT e.offering_id AS id FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.user_id = ? AND e.status = 'confirmed'
     UNION SELECT o.id FROM offerings o JOIN teachers t ON t.id = o.teacher_id WHERE t.user_id = ?`, userId, userId)).map((r) => String(r.id));
  const roleNames = roles.map((r) => r.role);
  return (await all<{ id: number; title: string; body: string; category: string; audience: string; audience_ref: string | null; at: string; by_name: string; dept: string | null; course: string | null }>(
    `SELECT n.*, u.name AS by_name, d.short AS dept, c.code || ' ' || o.section AS course FROM notices n
     LEFT JOIN users u ON u.id = n.posted_by
     LEFT JOIN departments d ON n.audience = 'department' AND d.id = CAST(n.audience_ref AS INTEGER)
     LEFT JOIN offerings o ON n.audience = 'section' AND o.id = CAST(n.audience_ref AS INTEGER)
     LEFT JOIN courses c ON c.id = o.course_id ORDER BY n.at DESC, n.id DESC`))
    .filter((n) => n.audience === "all"
      || (n.audience === "role" && roleNames.includes(n.audience_ref as never))
      || (n.audience === "department" && deptIds.includes(String(n.audience_ref)))
      || (n.audience === "section" && sections.includes(String(n.audience_ref)))
      || roleNames.some((r) => ROLES[r as Role]?.side === "admin"))
    .filter((n) => !opts.category || n.category === opts.category)
    .slice(0, opts.limit ?? 100);
  // ponytail: filters in JS over all notices; move to SQL when notices exceed a few thousand.
}

export async function postNotice(by: number, n: { title: string; body: string; category: string; audience: string; audience_ref?: string }) {
  const id = await insert("INSERT INTO notices (title, body, category, audience, audience_ref, posted_by) VALUES (?,?,?,?,?,?)",
    n.title, n.body, n.category, n.audience, n.audience_ref ?? null, by);
  await audit(by, "create", "notice", id, undefined, n);
  if (n.audience === "section") {
    const ids = await all<{ user_id: number }>(
      "SELECT s.user_id FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.offering_id = ? AND e.status = 'confirmed'", Number(n.audience_ref));
    await notify(ids.map((r) => r.user_id), n.title, n.body.slice(0, 140), "/app/notices");
  }
  return id;
}

export async function updateProfile(userId: number, p: { phone: string; emergency_contact: string; blood_group: string }) {
  const before = await get("SELECT phone, emergency_contact, blood_group FROM users WHERE id = ?", userId);
  await run("UPDATE users SET phone = ?, emergency_contact = ?, blood_group = ? WHERE id = ?", p.phone, p.emergency_contact, p.blood_group, userId);
  await audit(userId, "update", "profile", userId, before, p);
}

export async function setSetting(by: number, key: string, value: string) {
  const before = (await get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key))?.value;
  await run("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  await audit(by, "update", "setting", key, before, value);
}

export const SETTINGS = [
  { key: "attendance_threshold", label: "Attendance threshold for exam eligibility (%)", def: "70" },
  { key: "max_credits", label: "Maximum credits per semester", def: "21" },
  { key: "correction_hours", label: "Attendance correction window (hours)", def: "48" },
  { key: "clear_mid_pct", label: "Fees paid for mid-term clearance (%)", def: "50" },
  { key: "clear_final_pct", label: "Fees paid for final clearance (%)", def: "100" },
  { key: "late_fee", label: "Late fee per overdue invoice (৳)", def: "500" },
  { key: "partial_min", label: "Minimum online partial payment (৳)", def: "1000" },
  { key: "application_fee", label: "Admission application fee (৳)", def: "1200" },
  { key: "certificate_fee", label: "Certificate fee (৳)", def: "1000" },
  { key: "transcript_fee", label: "Transcript fee (৳)", def: "1500" },
  { key: "improvement_fee", label: "Improvement / retake exam fee per course (৳)", def: "3000" },
  { key: "convocation_fee", label: "Convocation fee (৳)", def: "8000" },
];
