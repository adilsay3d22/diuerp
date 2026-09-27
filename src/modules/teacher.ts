// M3 Teacher: attendance, assessments, marks, grade sheets, materials, submissions.
import { all, get, run, insert, audit, tx, num, dhaka } from "../lib/db.ts";
import { courseTotal, grade, pct } from "../lib/rules.ts";
import { notify, usersWithRole } from "./core.ts";
import { emit } from "./events.ts";

export type RosterRow = { student_id: number; code: string; name: string; email: string; phone: string | null; batch: string; section: string; type: string };
export const roster = async (offeringId: number) => await all<RosterRow>(
  `SELECT s.id AS student_id, s.student_id AS code, u.name, u.email, u.phone, s.batch, s.section, e.type FROM enrollments e
   JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id
   WHERE e.offering_id = ? AND e.status IN ('confirmed','completed') ORDER BY s.student_id`, offeringId);

// ---------- Attendance (TCH-U-4..6, TCH-A-3)
const LATEST = `SELECT r.* FROM attendance_records r WHERE r.approved = 1 AND r.id = (SELECT MAX(id) FROM attendance_records r2
  WHERE r2.session_id = r.session_id AND r2.student_id = r.student_id AND r2.approved = 1)`;

export async function attendanceSheet(offeringId: number, date: string, slotId: number) {
  const s = await get<{ id: number; at: string }>("SELECT id, at FROM attendance_sessions WHERE offering_id = ? AND date = ? AND slot_id = ?", offeringId, date, slotId);
  const marks = s ? await all<{ student_id: number; status: string }>(`${LATEST} AND r.session_id = ?`, s.id) : [];
  return { session: s, marks: Object.fromEntries(marks.map((m) => [m.student_id, m.status])) as Record<number, string> };
}

export async function correctionOpen(sessionAt: string) {
  return Date.now() - new Date(sessionAt + "Z").getTime() < await num("correction_hours", 48) * 3600_000;
}

export async function saveAttendance(by: number, offeringId: number, date: string, slotId: number, roomId: number | null, marks: Record<number, string>, reason: string) {
  return await tx(async () => {
    const existing = await attendanceSheet(offeringId, date, slotId);
    let sessionId = existing.session?.id;
    const late = existing.session && !(await correctionOpen(existing.session.at));
    if (late && !reason) throw new Error("The correction window has passed. Give a reason; the Department Head must approve.");
    if (!sessionId) sessionId = await insert("INSERT INTO attendance_sessions (offering_id, date, slot_id, room_id, taken_by) VALUES (?,?,?,?,?)", offeringId, date, slotId, roomId, by);
    let changed = 0;
    for (const [sid, status] of Object.entries(marks)) {
      if (existing.marks[Number(sid)] === status) continue;
      await insert("INSERT INTO attendance_records (session_id, student_id, status, reason, entered_by, approved) VALUES (?,?,?,?,?,?)",
        sessionId, Number(sid), status, reason || null, by, late ? 0 : 1);
      changed++;
    }
    if (existing.session) await audit(by, late ? "request_correction" : "correct", "attendance", sessionId, existing.marks, marks);
    if (!late) await checkThreshold(offeringId);
    return { late: !!late, changed };
  });
}

async function checkThreshold(offeringId: number) {
  const t = await num("attendance_threshold", 70);
  for (const r of (await attendanceSummary(offeringId))) {
    if (r.total >= 4 && r.percent < t) await emit("attendance.below_threshold", { studentId: r.student_id, offeringId, percent: r.percent });
  }
}

export async function attendanceSummary(offeringId: number) {
  const rows = await all<{ student_id: number; present: number; late: number; absent: number }>(
    `SELECT r.student_id, SUM(r.status = 'present') AS present, SUM(r.status = 'late') AS late, SUM(r.status = 'absent') AS absent
     FROM (${LATEST}) r JOIN attendance_sessions s ON s.id = r.session_id WHERE s.offering_id = ? GROUP BY r.student_id`, offeringId);
  const by = new Map(rows.map((r) => [r.student_id, r]));
  return (await roster(offeringId)).map((st) => {
    const r = by.get(st.student_id) ?? { present: 0, late: 0, absent: 0 };
    const total = r.present + r.late + r.absent;
    return { ...st, present: r.present, late: r.late, absent: r.absent, total, percent: pct(r.present + r.late, total) };
  });
}

export async function studentAttendance(studentId: number, offeringIds: number[]) {
  return await Promise.all(offeringIds.map(async (oid) => {
    const s = (await attendanceSummary(oid)).find((r) => r.student_id === studentId);
    return { offering_id: oid, present: s?.present ?? 0, late: s?.late ?? 0, absent: s?.absent ?? 0, total: s?.total ?? 0, percent: s?.percent ?? 100 };
  }));
}

export const sessions = async (offeringId: number) => await all<{ id: number; date: string; day: string; start: string; present: number; total: number }>(
  `SELECT s.id, s.date, ts.day, ts.start, (SELECT COUNT(*) FROM (${LATEST}) r WHERE r.session_id = s.id AND r.status != 'absent') AS present,
   (SELECT COUNT(*) FROM (${LATEST}) r WHERE r.session_id = s.id) AS total
   FROM attendance_sessions s JOIN time_slots ts ON ts.id = s.slot_id WHERE s.offering_id = ? ORDER BY s.date DESC`, offeringId);

export const pendingCorrections = async (deptId: number) => await all<{ id: number; code: string; section: string; date: string; student: string; student_code: string;
  status: string; reason: string; by_name: string; at: string }>(
  `SELECT r.id, c.code, o.section, s.date, u.name AS student, st.student_id AS student_code, r.status, r.reason, bu.name AS by_name, r.at
   FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id JOIN offerings o ON o.id = s.offering_id
   JOIN courses c ON c.id = o.course_id JOIN students st ON st.id = r.student_id JOIN users u ON u.id = st.user_id
   LEFT JOIN users bu ON bu.id = r.entered_by WHERE r.approved = 0 AND r.approved_by IS NULL AND c.dept_id = ? ORDER BY r.at`, deptId);

export async function decideCorrection(by: number, recordId: number, approve: boolean) {
  const r = await get<{ entered_by: number }>("SELECT entered_by FROM attendance_records WHERE id = ?", recordId);
  if (!r) throw new Error("Not found");
  if (r.entered_by === by) throw new Error("You cannot approve your own correction.");
  await run("UPDATE attendance_records SET approved = ?, approved_by = ? WHERE id = ?", approve ? 1 : 0, by, recordId);
  await audit(by, approve ? "approve" : "reject", "attendance_correction", recordId);
}

// ---------- Assessments & marks (TCH-U-7..10)
export type Assessment = { id: number; offering_id: number; type: string; title: string; max_marks: number; weight: number; published: number;
  instructions: string | null; due_at: string | null };
export const assessments = async (offeringId: number) =>
  await all<Assessment>("SELECT * FROM assessments WHERE offering_id = ? ORDER BY CASE type WHEN 'quiz' THEN 1 WHEN 'assignment' THEN 2 WHEN 'attendance' THEN 3 WHEN 'mid' THEN 4 ELSE 5 END, id", offeringId);

export const sheetStatus = async (offeringId: number) =>
  await get<{ status: string; comment: string | null; submitted_at: string | null }>("SELECT status, comment, submitted_at FROM gradesheets WHERE offering_id = ?", offeringId)
  ?? { status: "draft", comment: null, submitted_at: null };
const editable = async (offeringId: number) => ["draft", "returned"].includes((await sheetStatus(offeringId)).status);
async function assertEditable(offeringId: number) {
  if (!(await editable(offeringId))) throw new Error("The grade sheet is submitted and locked. Changes go through a grade-change request.");
}

export async function addAssessment(by: number, a: Omit<Assessment, "id" | "published">) {
  await assertEditable(a.offering_id);
  const id = await insert("INSERT INTO assessments (offering_id, type, title, max_marks, weight, instructions, due_at) VALUES (?,?,?,?,?,?,?)",
    a.offering_id, a.type, a.title, a.max_marks, a.weight, a.instructions, a.due_at);
  await audit(by, "create", "assessment", id, undefined, a);
}
export async function removeAssessment(by: number, id: number) {
  const a = (await get<Assessment>("SELECT * FROM assessments WHERE id = ?", id))!;
  await assertEditable(a.offering_id);
  if ((await get("SELECT 1 FROM marks WHERE assessment_id = ?", id))) throw new Error("Marks exist for this assessment; it cannot be removed.");
  await run("DELETE FROM assessments WHERE id = ?", id);
  await audit(by, "delete", "assessment", id, a);
}
export async function togglePublish(by: number, id: number) {
  await run("UPDATE assessments SET published = 1 - published WHERE id = ?", id);
  await audit(by, "toggle_publish", "assessment", id);
}

const LATEST_MARK = `SELECT m.* FROM marks m WHERE m.id = (SELECT MAX(id) FROM marks m2 WHERE m2.assessment_id = m.assessment_id AND m2.student_id = m.student_id)`;
export async function marksFor(offeringId: number) {
  return await all<{ assessment_id: number; student_id: number; score_c: number | null; feedback: string | null }>(
    `SELECT m.assessment_id, m.student_id, m.score_c, m.feedback FROM (${LATEST_MARK}) m JOIN assessments a ON a.id = m.assessment_id WHERE a.offering_id = ?`, offeringId);
}

export async function enterMarks(by: number, assessmentId: number, scores: Record<number, { score: string; feedback?: string }>) {
  const a = (await get<Assessment>("SELECT * FROM assessments WHERE id = ?", assessmentId))!;
  await assertEditable(a.offering_id);
  const current = new Map((await marksFor(a.offering_id)).filter((m) => m.assessment_id === assessmentId).map((m) => [m.student_id, m]));
  await tx(async () => {
    for (const [sid, v] of Object.entries(scores)) {
      if (v.score === "" && !current.has(Number(sid))) continue;
      const n = v.score === "" ? null : Number(v.score);
      if (n !== null && (Number.isNaN(n) || n < 0 || n > a.max_marks)) throw new Error(`Score must be between 0 and ${a.max_marks}`);
      const c = n === null ? null : Math.round(n * 100);
      const prev = current.get(Number(sid));
      if (prev && prev.score_c === c && (prev.feedback ?? "") === (v.feedback ?? prev.feedback ?? "")) continue;
      await insert("INSERT INTO marks (assessment_id, student_id, score_c, feedback, entered_by) VALUES (?,?,?,?,?)", assessmentId, Number(sid), c, v.feedback ?? prev?.feedback ?? null, by);
    }
  });
  await audit(by, "enter_marks", "assessment", assessmentId);
}

export async function gradeSheet(offeringId: number) {
  const as = await assessments(offeringId);
  const ms = await marksFor(offeringId);
  const weightTotal = as.reduce((s, a) => s + a.weight, 0);
  const rows = (await roster(offeringId)).map((st) => {
    const scores = as.map((a) => {
      const m = ms.find((m) => m.assessment_id === a.id && m.student_id === st.student_id);
      return m?.score_c == null ? null : m.score_c / 100;
    });
    const total = courseTotal(as.map((a, i) => ({ score: scores[i], max: a.max_marks, weight: a.weight })));
    return { ...st, scores, total, ...grade(total) };
  });
  return { assessments: as, rows, weightTotal };
}

export async function submitGradesheet(by: number, offeringId: number) {
  await assertEditable(offeringId);
  const g = await gradeSheet(offeringId);
  if (Math.abs(g.weightTotal - 100) > 0.001) throw new Error(`Assessment weights total ${g.weightTotal}%, they must total 100%.`);
  const missing = g.rows.filter((r) => r.scores.some((s) => s === null)).length;
  if (missing) throw new Error(`${missing} student(s) have missing marks. Enter 0 where a student did not sit.`);
  await run("UPDATE gradesheets SET status = 'submitted', submitted_at = datetime('now'), comment = NULL WHERE offering_id = ?", offeringId);
  await audit(by, "submit", "gradesheet", offeringId);
  await emit("gradesheet.submitted", { offeringId, by });
}

export async function decideGradesheet(by: number, offeringId: number, approve: boolean, comment: string) {
  if ((await sheetStatus(offeringId)).status !== "submitted") throw new Error("Only submitted grade sheets can be approved or returned.");
  if (!approve && !comment) throw new Error("Say what needs fixing when returning a grade sheet.");
  await run("UPDATE gradesheets SET status = ?, comment = ?, approved_by = ? WHERE offering_id = ?", approve ? "dept-approved" : "returned", comment || null, by, offeringId);
  await audit(by, approve ? "approve" : "return", "gradesheet", offeringId, undefined, comment);
  if (approve) await emit("gradesheet.approved", { offeringId, by });
  else {
    const t = await get<{ user_id: number }>("SELECT t.user_id FROM offerings o JOIN teachers t ON t.id = o.teacher_id WHERE o.id = ?", offeringId);
    if (t) await notify([t.user_id], "Grade sheet returned", comment, `/app/sections/${offeringId}?tab=grades`);
  }
}

export const gradesheetsByStatus = async (status: string, filter: { deptId?: number; semesterId?: number } = {}) =>
  await all<{ offering_id: number; code: string; title: string; section: string; teacher: string | null; submitted_at: string | null; semester: string; students: number }>(
  `SELECT g.offering_id, c.code, c.title, o.section, u.name AS teacher, g.submitted_at, sm.code AS semester,
   (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = o.id AND e.status = 'confirmed') AS students
   FROM gradesheets g JOIN offerings o ON o.id = g.offering_id JOIN courses c ON c.id = o.course_id JOIN semesters sm ON sm.id = o.semester_id
   LEFT JOIN teachers t ON t.id = o.teacher_id LEFT JOIN users u ON u.id = t.user_id
   WHERE g.status = ? AND (? IS NULL OR c.dept_id = ?) AND (? IS NULL OR o.semester_id = ?) ORDER BY c.code`,
  status, filter.deptId ?? null, filter.deptId ?? null, filter.semesterId ?? null, filter.semesterId ?? null);

// Called by M2 when it publishes results
export async function markPublished(offeringId: number) {
  await run("UPDATE gradesheets SET status = 'published', published_at = datetime('now') WHERE offering_id = ?", offeringId);
}

// ---------- Materials & submissions (TCH-U-8, TCH-U-12)
export const materials = async (offeringId: number) =>
  await all<{ id: number; week: number; title: string; kind: string; url: string | null; file_id: number | null; file_name: string | null }>(
    "SELECT m.*, f.name AS file_name FROM materials m LEFT JOIN files f ON f.id = m.file_id WHERE offering_id = ? ORDER BY week, m.id", offeringId);
export async function addMaterial(by: number, m: { offering_id: number; week: number; title: string; kind: string; url: string | null; file_id: number | null }) {
  const id = await insert("INSERT INTO materials (offering_id, week, title, kind, url, file_id) VALUES (?,?,?,?,?,?)", m.offering_id, m.week, m.title, m.kind, m.url, m.file_id);
  await audit(by, "create", "material", id, undefined, m);
}

export const submissions = async (assessmentId: number) =>
  await all<{ id: number; student_id: number; file_id: number | null; file_name: string | null; note: string | null; at: string }>(
    `SELECT sb.*, f.name AS file_name FROM submissions sb LEFT JOIN files f ON f.id = sb.file_id WHERE sb.assessment_id = ?
     AND sb.id = (SELECT MAX(id) FROM submissions s2 WHERE s2.assessment_id = sb.assessment_id AND s2.student_id = sb.student_id)`, assessmentId);
export async function submitAssignment(studentId: number, assessmentId: number, fileId: number | null, note: string) {
  const a = await get<Assessment>("SELECT * FROM assessments WHERE id = ? AND type = 'assignment'", assessmentId);
  if (!a) throw new Error("Assignment not found");
  if (a.due_at && dhaka(a.due_at) < new Date()) throw new Error("The deadline has passed.");
  await insert("INSERT INTO submissions (assessment_id, student_id, file_id, note) VALUES (?,?,?,?)", assessmentId, studentId, fileId, note || null);
}

// Teacher dashboard: ungraded submissions
export const ungradedCount = async (offeringId: number) => (await get<{ n: number }>(
  `SELECT COUNT(*) AS n FROM submissions sb JOIN assessments a ON a.id = sb.assessment_id WHERE a.offering_id = ?
   AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.assessment_id = sb.assessment_id AND m.student_id = sb.student_id AND m.score_c IS NOT NULL)`, offeringId))?.n ?? 0;

// Notify on threshold and on approved sheets
import { on } from "./events.ts";
on("attendance.below_threshold", async ({ studentId, offeringId, percent }) => {
  const u = await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", studentId);
  const c = await get<{ code: string }>("SELECT c.code FROM offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = ?", offeringId);
  const title = `Attendance warning: ${c?.code}`;
  if (u && !(await get("SELECT 1 FROM notifications WHERE user_id = ? AND title = ? AND at > datetime('now','-7 days')", u.user_id, title)))
    await notify([u.user_id], title, `Your attendance is ${percent}%. Below ${await num("attendance_threshold", 70)}% you cannot sit the final exam.`, "/app/attendance");
});
on("gradesheet.approved", async ({ offeringId }) => {
  const c = await get<{ code: string; section: string }>("SELECT c.code, o.section FROM offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = ?", offeringId);
  await notify(await usersWithRole("exam_controller"), `Grade sheet approved: ${c?.code} ${c?.section}`, "Ready for publication.", "/admin/exam");
});
on("gradesheet.submitted", async ({ offeringId }) => {
  const h = await get<{ head_user_id: number; code: string; section: string }>(
    "SELECT d.head_user_id, c.code, o.section FROM offerings o JOIN courses c ON c.id = o.course_id JOIN departments d ON d.id = c.dept_id WHERE o.id = ?", offeringId);
  if (h?.head_user_id) await notify([h.head_user_id], `Grade sheet submitted: ${h.code} ${h.section}`, "Waiting for your approval.", "/admin/department");
});
