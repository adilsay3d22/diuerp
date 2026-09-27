// CORE (Phase 7): help desk (CORE-13), messaging (CORE-9), search (CORE-14), TA delegation (CORE-3).
import { all, get, run, insert, audit, tx, each } from "../lib/db.ts";
import { notify, usersWithRole, userRoles, ROLES, type Role } from "./core.ts";

// ---------- Help desk
export const OFFICES = {
  registrar: { label: "Registrar's office", roles: ["registrar"] }, exam: { label: "Exam & academic office", roles: ["exam_controller"] },
  accounts: { label: "Accounts office", roles: ["accounts_officer", "finance_head"] }, transport: { label: "Transport office", roles: ["transport_officer"] },
  admission: { label: "Admission office", roles: ["admissions_officer"] }, department: { label: "Department office", roles: ["dept_head"] },
  it: { label: "IT support", roles: ["super_admin"] }, facilities: { label: "Facilities", roles: ["super_admin"] },
} as const;
export type Office = keyof typeof OFFICES;
export const TICKET_CATEGORIES: Record<string, { office: Office; sla: number }> = {
  "Transport complaint": { office: "transport", sla: 48 }, "Bus, route or driver issue": { office: "transport", sla: 24 },
  "Room or timetable change": { office: "registrar", sla: 72 }, "Student record correction": { office: "registrar", sla: 72 },
  "Results or exam issue": { office: "exam", sla: 72 }, "Fees or payment issue": { office: "accounts", sla: 48 },
  "Admission question": { office: "admission", sla: 48 }, "Department request": { office: "department", sla: 72 },
  "Account or login problem": { office: "it", sla: 24 }, "Facility issue (classroom, lab, Wi-Fi)": { office: "facilities", sla: 72 },
};
export type Ticket = { id: number; requester_id: number; office: string; category: string; subject: string; status: string; assignee_id: number | null;
  sla_due: string; ref: string | null; at: string; resolved_at: string | null; requester: string; requester_uni: string; assignee: string | null; last_at: string; dept_id: number | null };
const TICKET_SQL = `SELECT t.*, u.name AS requester, u.uni_id AS requester_uni, a.name AS assignee,
  COALESCE((SELECT MAX(at) FROM ticket_messages m WHERE m.ticket_id = t.id), t.at) AS last_at,
  (SELECT p.dept_id FROM students s JOIN programs p ON p.id = s.program_id WHERE s.user_id = t.requester_id
   UNION SELECT dept_id FROM teachers WHERE user_id = t.requester_id LIMIT 1) AS dept_id
  FROM tickets t JOIN users u ON u.id = t.requester_id LEFT JOIN users a ON a.id = t.assignee_id`;

export async function createTicket(userId: number, t: { category: string; subject: string; body: string; ref?: string; fileId?: number | null }) {
  const cat = TICKET_CATEGORIES[t.category];
  if (!cat) throw new Error("Pick a category.");
  if (!t.subject || !t.body) throw new Error("Give your request a subject and describe it.");
  return await tx(async () => {
    const id = await insert(`INSERT INTO tickets (requester_id, office, category, subject, sla_due, ref) VALUES (?,?,?,?, datetime('now', '+${cat.sla} hours'), ?)`,
      userId, cat.office, t.category, t.subject, t.ref ?? null);
    await insert("INSERT INTO ticket_messages (ticket_id, user_id, body, file_id) VALUES (?,?,?,?)", id, userId, t.body, t.fileId ?? null);
    await notify(await officeStaff((await get<Ticket>(`${TICKET_SQL} WHERE t.id = ?`, id))!), `New request: ${t.subject}`, t.category, `/admin/helpdesk/${id}`, "helpdesk");
    await audit(userId, "create", "ticket", id);
    return id;
  });
}
async function officeStaff(t: Ticket) {
  const roles = OFFICES[t.office as Office]?.roles ?? [];
  const users = (await each(roles, (r) => usersWithRole(r as Role))).flat();
  if (t.office !== "department") return users;
  return (await all<{ user_id: number }>("SELECT user_id FROM user_roles WHERE role = 'dept_head' AND dept_id = ?", t.dept_id ?? 0)).map((r) => r.user_id);
}
export const ticket = async (id: number) => await get<Ticket>(`${TICKET_SQL} WHERE t.id = ?`, id);
export const myTickets = async (userId: number) => await all<Ticket>(`${TICKET_SQL} WHERE t.requester_id = ? ORDER BY last_at DESC`, userId);
export function officesFor(roles: { role: string; dept_id: number | null }[]) {
  return (Object.keys(OFFICES) as Office[]).filter((o) => roles.some((r) => (OFFICES[o].roles as readonly string[]).includes(r.role)));
}
export async function queue(roles: { role: string; dept_id: number | null }[], status: string) {
  const offices = officesFor(roles);
  if (!offices.length) return [];
  const dept = roles.find((r) => r.role === "dept_head")?.dept_id ?? null;
  const open = status === "open" ? "t.status IN ('open','in_progress')" : "t.status IN ('resolved','closed')";
  return (await all<Ticket>(`${TICKET_SQL} WHERE t.office IN (${offices.map(() => "?").join(",")}) AND ${open} ORDER BY t.sla_due`, ...offices))
    .filter((t) => t.office !== "department" || t.dept_id === dept);
}
export function canSeeTicket(userId: number, roles: { role: string; dept_id: number | null }[], t: Ticket) {
  if (t.requester_id === userId) return "requester" as const;
  const offices = officesFor(roles);
  if (offices.includes(t.office as Office) && (t.office !== "department" || roles.some((r) => r.role === "dept_head" && r.dept_id === t.dept_id))) return "staff" as const;
  return null;
}
export const ticketMessages = async (id: number, includeInternal: boolean) => await all<{ id: number; body: string; at: string; name: string; user_id: number; internal: number; file_id: number | null; file_name: string | null }>(
  `SELECT m.*, u.name, f.name AS file_name FROM ticket_messages m JOIN users u ON u.id = m.user_id LEFT JOIN files f ON f.id = m.file_id
   WHERE m.ticket_id = ? AND (m.internal = 0 OR ?) ORDER BY m.id`, id, includeInternal ? 1 : 0);
export async function replyTicket(userId: number, id: number, body: string, internal: boolean, fileId: number | null, as: "requester" | "staff") {
  const t = (await ticket(id))!;
  if (!body) throw new Error("Write a message.");
  if (t.status === "closed") throw new Error("This request is closed. Open a new one.");
  await insert("INSERT INTO ticket_messages (ticket_id, user_id, body, file_id, internal) VALUES (?,?,?,?,?)", id, userId, body, fileId, as === "staff" && internal ? 1 : 0);
  if (as === "staff") {
    if (t.status === "open") await run("UPDATE tickets SET status = 'in_progress', assignee_id = COALESCE(assignee_id, ?) WHERE id = ?", userId, id);
    if (!internal) await notify([t.requester_id], `Reply on: ${t.subject}`, body.slice(0, 140), `/helpdesk/${id}`, "helpdesk");
  } else {
    if (t.status === "resolved") await run("UPDATE tickets SET status = 'in_progress', resolved_at = NULL WHERE id = ?", id);
    await notify(t.assignee_id ? [t.assignee_id] : await officeStaff(t), `Update on: ${t.subject}`, body.slice(0, 140), `/admin/helpdesk/${id}`, "helpdesk");
  }
}
export async function setTicketStatus(userId: number, id: number, status: string) {
  if (!["open", "in_progress", "resolved", "closed"].includes(status)) throw new Error("Unknown status");
  const t = (await ticket(id))!;
  await run("UPDATE tickets SET status = ?, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN datetime('now') ELSE NULL END, assignee_id = COALESCE(assignee_id, ?) WHERE id = ?",
    status, status, userId, id);
  await audit(userId, "status", "ticket", id, t.status, status);
  if (status === "resolved") await notify([t.requester_id], `Resolved: ${t.subject}`, "Reply if the problem is not fixed.", `/helpdesk/${id}`, "helpdesk");
}
export const slaBreached = (t: Ticket) => ["open", "in_progress"].includes(t.status) && t.sla_due < new Date().toISOString().replace("T", " ").slice(0, 19);

// ---------- Messaging
const isStaff = async (userId: number) => (await userRoles(userId)).some((r) => ROLES[r.role]?.side === "admin");
async function teacherIdOf(userId: number) {
  return (await get<{ id: number }>("SELECT id FROM teachers WHERE user_id = ?", userId))?.id ?? null;
}
// Who a user may message: staff anyone; teachers their current students, mentees and colleagues; students their teachers and mentor.
export async function contacts(userId: number) {
  if ((await isStaff(userId))) return await all<{ id: number; name: string; uni_id: string }>("SELECT id, name, uni_id FROM users WHERE id != ? AND status = 'active' ORDER BY name LIMIT 500", userId);
  const tid = await teacherIdOf(userId);
  const ids = new Set<number>();
  const add = (rows: { user_id: number }[]) => rows.forEach((r) => ids.add(r.user_id));
  if (tid) {
    add(await all(`SELECT s.user_id FROM enrollments e JOIN students s ON s.id = e.student_id JOIN offerings o ON o.id = e.offering_id
      JOIN semesters sm ON sm.id = o.semester_id WHERE o.teacher_id = ? AND e.status = 'confirmed' AND sm.status = 'active'`, tid));
    add(await all("SELECT s.user_id FROM mentors m JOIN students s ON s.id = m.student_id WHERE m.teacher_id = ?", tid));
    add(await all("SELECT user_id FROM teachers WHERE id != ?", tid));
  }
  const st = await get<{ id: number }>("SELECT id FROM students WHERE user_id = ?", userId);
  if (st) {
    add(await all(`SELECT t.user_id FROM enrollments e JOIN offerings o ON o.id = e.offering_id JOIN teachers t ON t.id = o.teacher_id
      JOIN semesters sm ON sm.id = o.semester_id WHERE e.student_id = ? AND e.status = 'confirmed' AND sm.status = 'active'`, st.id));
    add(await all("SELECT t.user_id FROM mentors m JOIN teachers t ON t.id = m.teacher_id WHERE m.student_id = ?", st.id));
  }
  ids.delete(userId);
  if (!ids.size) return [];
  return await all<{ id: number; name: string; uni_id: string }>(`SELECT id, name, uni_id FROM users WHERE id IN (${[...ids].join(",")}) ORDER BY name`);
}
export const canMessage = async (from: number, to: number) => (await contacts(from)).some((c) => c.id === to);

export async function startThread(userId: number, toIds: number[], subject: string, body: string) {
  if (!toIds.length || !subject || !body) throw new Error("Pick a recipient and write a subject and message.");
  const allowed = new Set((await contacts(userId)).map((c) => c.id));
  if (toIds.some((t) => !allowed.has(t))) throw new Error("You can't message that person here. Use the help desk for offices.");
  return await tx(async () => {
    const id = await insert("INSERT INTO threads (subject, kind, created_by) VALUES (?, 'direct', ?)", subject, userId);
    for (const u of [userId, ...toIds]) await run("INSERT OR IGNORE INTO thread_members (thread_id, user_id) VALUES (?,?)", id, u);
    await postMessage(userId, id, body);
    return id;
  });
}
// Teacher ↔ section group thread; membership follows the roster.
export async function sectionThread(offeringId: number) {
  const o = (await get<{ teacher_user: number | null; code: string; section: string }>(
    "SELECT t.user_id AS teacher_user, c.code, o.section FROM offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN teachers t ON t.id = o.teacher_id WHERE o.id = ?", offeringId))!;
  let id = (await get<{ id: number }>("SELECT id FROM threads WHERE kind = 'section' AND offering_id = ?", offeringId))?.id;
  if (!id) id = await insert("INSERT INTO threads (subject, kind, offering_id, created_by) VALUES (?, 'section', ?, ?)", `${o.code} ${o.section} class`, offeringId, o.teacher_user ?? 0);
  const members = await all<{ user_id: number }>("SELECT s.user_id FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.offering_id = ? AND e.status IN ('confirmed','completed')", offeringId);
  for (const u of [...members.map((m) => m.user_id), ...(o.teacher_user ? [o.teacher_user] : [])]) await run("INSERT OR IGNORE INTO thread_members (thread_id, user_id) VALUES (?,?)", id, u);
  return id;
}
export async function postMessage(userId: number, threadId: number, body: string) {
  if (!body.trim()) throw new Error("Write a message.");
  const t = await get<{ kind: string; offering_id: number | null; subject: string }>("SELECT * FROM threads WHERE id = ?", threadId);
  if (!t || !(await get("SELECT 1 FROM thread_members WHERE thread_id = ? AND user_id = ?", threadId, userId))) throw new Error("You are not in this conversation.");
  // In a section thread only the teacher posts announcements-style; students reply too (it's a class channel).
  const id = await insert("INSERT INTO messages (thread_id, user_id, body) VALUES (?,?,?)", threadId, userId, body.trim());
  await run("UPDATE thread_members SET last_read = ? WHERE thread_id = ? AND user_id = ?", id, threadId, userId);
  const others = (await all<{ user_id: number }>("SELECT user_id FROM thread_members WHERE thread_id = ? AND user_id != ?", threadId, userId)).map((r) => r.user_id);
  const from = (await get<{ name: string }>("SELECT name FROM users WHERE id = ?", userId))!.name;
  await notify(others, `${from}: ${t.subject}`, body.slice(0, 140), `/messages/${threadId}`, "messages");
}
export const inbox = async (userId: number) => await all<{ id: number; subject: string; kind: string; last_body: string | null; last_at: string | null; last_from: string | null; unread: number; people: string }>(
  `SELECT t.id, t.subject, t.kind, m.body AS last_body, m.at AS last_at, u.name AS last_from,
   (SELECT COUNT(*) FROM messages x WHERE x.thread_id = t.id AND x.id > tm.last_read AND x.user_id != ?) AS unread,
   (SELECT GROUP_CONCAT(pu.name, ', ') FROM thread_members pm JOIN users pu ON pu.id = pm.user_id WHERE pm.thread_id = t.id AND pm.user_id != ? LIMIT 4) AS people
   FROM threads t JOIN thread_members tm ON tm.thread_id = t.id AND tm.user_id = ?
   LEFT JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE thread_id = t.id) LEFT JOIN users u ON u.id = m.user_id
   WHERE m.id IS NOT NULL ORDER BY m.id DESC LIMIT 200`, userId, userId, userId);
export async function openThread(userId: number, id: number) {
  if (!(await get("SELECT 1 FROM thread_members WHERE thread_id = ? AND user_id = ?", id, userId))) return null;
  const t = (await get<{ id: number; subject: string; kind: string; offering_id: number | null }>("SELECT * FROM threads WHERE id = ?", id))!;
  const msgs = await all<{ id: number; body: string; at: string; user_id: number; name: string }>(
    "SELECT m.*, u.name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.thread_id = ? ORDER BY m.id", id);
  if (msgs.length) await run("UPDATE thread_members SET last_read = ? WHERE thread_id = ? AND user_id = ?", msgs.at(-1)!.id, id, userId);
  const people = (await all<{ name: string }>("SELECT u.name FROM thread_members tm JOIN users u ON u.id = tm.user_id WHERE tm.thread_id = ? AND tm.user_id != ?", id, userId)).map((p) => p.name);
  return { ...t, messages: msgs, people };
}
export const unreadMessages = async (userId: number) => (await get<{ n: number }>(
  `SELECT COUNT(*) AS n FROM messages m JOIN thread_members tm ON tm.thread_id = m.thread_id AND tm.user_id = ? WHERE m.id > tm.last_read AND m.user_id != ?`, userId, userId))!.n;

// ---------- Delegation (CORE-3): a teacher grants a TA time-bound access to one section.
export const SCOPES = { attendance: "Attendance only", marks: "Attendance and marks" } as const;
export async function delegate(teacherUserId: number, offeringId: number, taUniId: string, scope: string, days: number) {
  if (!(scope in SCOPES)) throw new Error("Pick what the assistant can do.");
  if (!(days >= 1 && days <= 180)) throw new Error("Access can last 1 to 180 days.");
  const owns = await get("SELECT 1 FROM offerings o JOIN teachers t ON t.id = o.teacher_id WHERE o.id = ? AND t.user_id = ?", offeringId, teacherUserId);
  if (!owns) throw new Error("You can only delegate your own sections.");
  const ta = await get<{ id: number; name: string }>("SELECT id, name FROM users WHERE lower(uni_id) = lower(?) AND status = 'active'", taUniId.trim());
  if (!ta || ta.id === teacherUserId) throw new Error("No active user with that ID.");
  return await tx(async () => {
    await run("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'ta')", ta.id);
    const id = await insert(`INSERT INTO delegations (teacher_user_id, ta_user_id, offering_id, scope, expires_at) VALUES (?,?,?,?, datetime('now', '+${Math.round(days)} days'))`,
      teacherUserId, ta.id, offeringId, scope);
    await audit(teacherUserId, "delegate", "offering", offeringId, undefined, { ta: ta.id, scope, days });
    await notify([ta.id], "You have been added as a teaching assistant", `${SCOPES[scope as keyof typeof SCOPES]}, for ${days} days. Switch to the Teaching Assistant role.`, "/app/sections", "academic");
    return ta.name;
  });
}
export async function revokeDelegation(teacherUserId: number, id: number) {
  await run("UPDATE delegations SET revoked = 1 WHERE id = ? AND teacher_user_id = ?", id, teacherUserId);
  await audit(teacherUserId, "revoke", "delegation", id);
}
export const delegationsFor = async (offeringId: number) => await all<{ id: number; name: string; uni_id: string; scope: string; expires_at: string }>(
  `SELECT d.id, u.name, u.uni_id, d.scope, d.expires_at FROM delegations d JOIN users u ON u.id = d.ta_user_id
   WHERE d.offering_id = ? AND d.revoked = 0 AND d.expires_at > datetime('now') ORDER BY d.id`, offeringId);
export const delegatedScope = async (userId: number, offeringId: number) => (await get<{ scope: string }>(
  "SELECT scope FROM delegations WHERE ta_user_id = ? AND offering_id = ? AND revoked = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1", userId, offeringId))?.scope ?? null;
export const taOfferings = async (userId: number) => await all<{ offering_id: number; scope: string; expires_at: string }>(
  "SELECT offering_id, scope, expires_at FROM delegations WHERE ta_user_id = ? AND revoked = 0 AND expires_at > datetime('now')", userId);

// ---------- Global search (CORE-14), scoped to what the active role may see
export type Hit = { title: string; sub: string; href: string };
export async function search(userId: number, role: Role, roles: { role: string; dept_id: number | null }[], q: string, pages: { href: string; label: string }[]) {
  const like = `%${q.trim()}%`;
  const groups: { label: string; hits: Hit[] }[] = [];
  const push = (label: string, hits: Hit[]) => hits.length && groups.push({ label, hits: hits.slice(0, 8) });
  push("Pages", pages.filter((p) => p.label.toLowerCase().includes(q.trim().toLowerCase())).map((p) => ({ title: p.label, sub: "Go to page", href: p.href })));
  const staffRoles = ["registrar", "exam_controller", "dept_head", "accounts_officer", "finance_head"];
  if (staffRoles.includes(role)) {
    const dept = role === "dept_head" ? roles.find((r) => r.role === "dept_head")?.dept_id : null;
    push("Students", (await all<{ id: number; student_id: string; name: string; program: string; dept_id: number }>(
      `SELECT s.id, s.student_id, u.name, p.name AS program, p.dept_id FROM students s JOIN users u ON u.id = s.user_id JOIN programs p ON p.id = s.program_id
       WHERE s.student_id LIKE ? OR u.name LIKE ? LIMIT 20`, like, like)).filter((s) => !dept || s.dept_id === dept)
      .map((s) => ({ title: s.name, sub: `${s.student_id} · ${s.program}`, href: `/admin/students/${s.id}` })));
  }
  if (role === "cashier") push("Students", (await all<{ student_id: string; name: string }>("SELECT s.student_id, u.name FROM students s JOIN users u ON u.id = s.user_id WHERE s.student_id LIKE ? OR u.name LIKE ? LIMIT 8", like, like))
    .map((s) => ({ title: s.name, sub: s.student_id, href: `/admin/cashier?q=${s.student_id}` })));
  if (["admissions_officer", "registrar", "cashier"].includes(role)) push("Applications", (await all<{ id: number; name: string; status: string }>(
    `SELECT a.id, u.name, a.status FROM applications a JOIN users u ON u.id = a.user_id WHERE u.name LIKE ? OR 'APP-' || substr('00000' || a.id, -5) LIKE ? LIMIT 8`, like, like))
    .map((a) => ({ title: a.name, sub: `APP-${String(a.id).padStart(5, "0")} · ${a.status.replace("_", " ")}`, href: role === "cashier" ? `/admin/cashier?q=APP-${String(a.id).padStart(5, "0")}` : `/admin/admissions/application/${a.id}` })));
  push("Courses", (await all<{ code: string; title: string; credits: number }>("SELECT code, title, credits FROM courses WHERE code LIKE ? OR title LIKE ? LIMIT 8", like, like))
    .map((c) => ({ title: `${c.code} ${c.title}`, sub: `${c.credits} credits`, href: role === "registrar" ? "/admin/registrar/catalogue" : role === "student" ? "/app/register" : "/app/routine" })));
  push("Notices", (await all<{ id: number; title: string; category: string }>("SELECT id, title, category FROM notices WHERE title LIKE ? OR body LIKE ? ORDER BY id DESC LIMIT 8", like, like))
    .map((n) => ({ title: n.title, sub: n.category, href: `/notices?category=${n.category}` })));
  if (role === "super_admin") push("People", (await all<{ name: string; uni_id: string }>("SELECT name, uni_id FROM users WHERE name LIKE ? OR uni_id LIKE ? OR email LIKE ? LIMIT 8", like, like, like))
    .map((u) => ({ title: u.name, sub: u.uni_id, href: `/admin/system?q=${encodeURIComponent(u.uni_id)}` })));
  push("Help desk", [...await myTickets(userId), ...await queue(roles, "open")].filter((t) => t.subject.toLowerCase().includes(q.trim().toLowerCase()))
    .map((t) => ({ title: t.subject, sub: `#${t.id} · ${t.status.replace("_", " ")}`, href: t.requester_id === userId ? `/helpdesk/${t.id}` : `/admin/helpdesk/${t.id}` })));
  return groups;
}
