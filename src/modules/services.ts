// M2 (Phase 7): add/drop/withdraw, section change, service applications (W4, W10), exams & seat plans,
// evaluations admin, mentoring, academic reports. STU-U-2,4,9,12–15; STU-A-3,6–9; TCH-U-11,15,16; TCH-A-3.
import { all, get, run, insert, audit, tx, num, today } from "../lib/db.ts";
import { gpa } from "../lib/rules.ts";
import { notify, usersWithRole } from "./core.ts";
import { emit, on } from "./events.ts";
import { currentSemester, offering, semester, studentById, calendar, rooms } from "./registrar.ts";
import { drop, enrollments, latestResults, transcript, creditsEarned } from "./student.ts";
import { clearanceFor, studentChargePaid, summary } from "./accounts.ts";

// ---------- Add/drop and withdrawal (STU-U-4, W4)
export async function dropOwn(userId: number, studentId: number, enrollmentId: number) {
  const e = await get<{ student_id: number; offering_id: number; status: string }>("SELECT * FROM enrollments WHERE id = ?", enrollmentId);
  if (!e || e.student_id !== studentId) throw new Error("Enrollment not found.");
  if (!(await semester((await offering(e.offering_id))!.semester_id))!.adddrop_open) throw new Error("The add/drop window is closed.");
  await drop(userId, enrollmentId, "Dropped by student during add/drop");
}
export async function withdraw(userId: number, studentId: number, enrollmentId: number, reason: string) {
  const e = await get<{ student_id: number; offering_id: number; status: string }>("SELECT * FROM enrollments WHERE id = ?", enrollmentId);
  if (!e || e.student_id !== studentId || e.status !== "confirmed") throw new Error("Enrollment not found.");
  if (!(await semester((await offering(e.offering_id))!.semester_id))!.withdraw_open) throw new Error("The withdrawal window is closed.");
  if (!reason) throw new Error("Give a reason for withdrawing.");
  // Withdrawal keeps the course charges (no refund) and records W on the transcript later.
  await run("UPDATE enrollments SET status = 'withdrawn', reason = ?, by_user = ? WHERE id = ?", reason, userId, enrollmentId);
  await audit(userId, "withdraw", "enrollment", enrollmentId, "confirmed", reason);
}

// ---------- Service requests: section change, improvement/retake, certificate, transcript, convocation
export const KINDS = {
  section_change: { label: "Section change", fee: null, office: "Department Head" },
  improvement: { label: "Improvement / retake exam", fee: "improvement_fee", office: "Exam Controller" },
  certificate: { label: "Certificate", fee: "certificate_fee", office: "Academic Office" },
  transcript: { label: "Transcript", fee: "transcript_fee", office: "Academic Office" },
  convocation: { label: "Convocation", fee: "convocation_fee", office: "Academic Office" },
} as const;
export type Kind = keyof typeof KINDS;
export const REQ_STATUS: Record<string, string> = {
  submitted: "Waiting for approval", fee_due: "Fee due", processing: "Processing", ready: "Ready to collect", delivered: "Delivered",
  approved: "Approved", rejected: "Rejected", cancelled: "Cancelled",
};
export type Request = { id: number; student_id: number; kind: Kind; offering_id: number | null; target_offering_id: number | null; detail: string | null; status: string;
  note: string | null; at: string; updated_at: string | null; student: string; student_code: string; course: string | null; target: string | null; dept_id: number | null };
const REQ_SQL = `SELECT r.*, u.name AS student, s.student_id AS student_code, c.code || ' ' || o.section AS course, tc.code || ' ' || t.section AS target, c.dept_id
  FROM student_requests r JOIN students s ON s.id = r.student_id JOIN users u ON u.id = s.user_id
  LEFT JOIN offerings o ON o.id = r.offering_id LEFT JOIN courses c ON c.id = o.course_id
  LEFT JOIN offerings t ON t.id = r.target_offering_id LEFT JOIN courses tc ON tc.id = t.course_id`;
export const myRequests = async (studentId: number) => await all<Request>(`${REQ_SQL} WHERE r.student_id = ? ORDER BY r.id DESC`, studentId);
export const requests = async (kinds: Kind[], statuses: string[]) => await all<Request>(
  `${REQ_SQL} WHERE r.kind IN (${kinds.map(() => "?").join(",")}) AND r.status IN (${statuses.map(() => "?").join(",")}) ORDER BY r.id`, ...kinds, ...statuses);
export const request = async (id: number) => await get<Request>(`${REQ_SQL} WHERE r.id = ?`, id);

const openRequest = async (studentId: number, kind: Kind, offeringId: number | null) => await get(
  "SELECT 1 FROM student_requests WHERE student_id = ? AND kind = ? AND COALESCE(offering_id, 0) = ? AND status IN ('submitted','fee_due','processing')", studentId, kind, offeringId ?? 0);

// Eligible improvement/retake courses: failed (retake) or below B (improvement), latest attempt only.
export async function improvable(studentId: number) {
  const sem = await currentSemester();
  return await Promise.all((await latestResults(studentId)).filter((r) => r.gp_c < 300).map(async (r) => ({
    ...r, kind: r.letter === "F" ? "Retake" : "Improvement",
    targets: await all<{ id: number; section: string }>("SELECT id, section FROM offerings WHERE course_id = ? AND semester_id = ? AND capacity > 0", r.course_id, sem.id),
  })));
}

export async function convocationCheck(studentId: number) {
  const st = (await studentById(studentId))!;
  const latest = await latestResults(studentId);
  const cg = gpa(latest.map((r) => ({ credits: r.credits, gp: r.gp_c / 100 })));
  const earned = await creditsEarned(studentId);
  const failed = latest.filter((r) => r.letter === "F").map((r) => r.code);
  const due = (await summary(studentId)).due;
  const unmet = [
    ...(earned < st.total_credits ? [`Complete ${st.total_credits} credits (you have ${earned})`] : []),
    ...(cg < 2 ? [`Reach a CGPA of 2.00 (yours is ${cg.toFixed(2)})`] : []),
    ...(failed.length ? [`Clear failed courses: ${failed.join(", ")}`] : []),
    ...(due > 0 ? [`Pay outstanding dues of ৳${due.toLocaleString("en-IN")}`] : []),
  ];
  return { eligible: unmet.length === 0, unmet, cgpa: cg, earned, required: st.total_credits };
}

export async function submitRequest(userId: number, studentId: number, kind: Kind, r: { offering_id?: number; target_offering_id?: number; detail?: string; copies?: number }) {
  if (!(kind in KINDS)) throw new Error("Unknown request.");
  return await tx(async () => {
    if ((await openRequest(studentId, kind, r.offering_id ?? null))) throw new Error("You already have an open request of this kind.");
    let detail = r.detail ?? "";
    if (kind === "section_change") {
      const from = await get<{ offering_id: number; course_id: number; semester_id: number }>(
        "SELECT e.offering_id, o.course_id, o.semester_id FROM enrollments e JOIN offerings o ON o.id = e.offering_id WHERE e.student_id = ? AND e.offering_id = ? AND e.status = 'confirmed'", studentId, r.offering_id ?? 0);
      const to = r.target_offering_id ? await offering(r.target_offering_id) : undefined;
      if (!from || !to || to.course_id !== from.course_id || to.semester_id !== from.semester_id || to.id === from.offering_id) throw new Error("Pick another section of the same course.");
      if (to.enrolled >= to.capacity) throw new Error("That section is full.");
      if (!detail) throw new Error("Say why you need the change.");
      if ((await sectionChangeUsed(studentId, from.course_id, from.semester_id))) throw new Error(`You have already used your one section change for ${to.code}.`);
    }
    if (kind === "improvement") {
      const c = (await improvable(studentId)).find((x) => x.offering_id === r.offering_id);
      if (!c) throw new Error("That course is not eligible for improvement or retake.");
      if (!c.targets.some((t) => t.id === r.target_offering_id)) throw new Error(`${c.code} is not offered this semester; apply when it is.`);
      detail = `${c.kind}: ${c.code} (current grade ${c.letter})`;
    }
    if (kind === "convocation") {
      const chk = await convocationCheck(studentId);
      if (!chk.eligible) throw new Error(`Not eligible yet: ${chk.unmet.join("; ")}.`);
    }
    if (kind === "certificate" || kind === "transcript") {
      const copies = Math.max(1, Math.min(10, Math.round(r.copies ?? 1)));
      detail = `${copies} ${copies === 1 ? "copy" : "copies"} · ${detail || "Pickup from the Academic Office"}`;
    }
    const feeKey = KINDS[kind].fee;
    const status = feeKey ? "fee_due" : "submitted";
    const id = await insert("INSERT INTO student_requests (student_id, kind, offering_id, target_offering_id, detail, status) VALUES (?,?,?,?,?,?)",
      studentId, kind, r.offering_id ?? null, r.target_offering_id ?? null, detail, status);
    if (feeKey) {
      const copies = kind === "certificate" || kind === "transcript" ? Number(detail.split(" ")[0]) : 1;
      await emit("application.submitted", { requestId: id, studentId, amount: await num(feeKey, 1000) * copies, description: `${KINDS[kind].label} request #${id}`, by: userId });
      if ((await studentChargePaid(studentId, `req:${id}`))) await setStatus(id, "processing");
    } else {
      const deptHeads = (await all<{ user_id: number }>("SELECT user_id FROM user_roles WHERE role = 'dept_head' AND dept_id = ?", (await offering(r.offering_id!))!.dept_id)).map((x) => x.user_id);
      await notify(deptHeads, "Section change request", detail, "/admin/department");
    }
    await audit(userId, "submit", "student_request", id, undefined, { kind, detail });
    return id;
  });
}
async function setStatus(id: number, status: string, note?: string, by?: number) {
  await run("UPDATE student_requests SET status = ?, note = COALESCE(?, note), decided_by = COALESCE(?, decided_by), updated_at = datetime('now') WHERE id = ?", status, note ?? null, by ?? null, id);
  const r = (await request(id))!;
  const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", r.student_id))!.user_id;
  await notify([uid], `${KINDS[r.kind].label}: ${REQ_STATUS[status]}`, note ?? r.detail ?? "", "/app/services");
  if (status === "processing") await notify(await usersWithRole("exam_controller"), `${KINDS[r.kind].label} to process`, `${r.student_code} · ${r.detail ?? ""}`, "/admin/exam/requests");
}
// W10: once the fee line is paid the request goes to the office queue
on("invoice.paid", async ({ studentId }) => {
  if (!studentId) return;
  for (const r of (await all<{ id: number }>("SELECT id FROM student_requests WHERE student_id = ? AND status = 'fee_due'", studentId)))
    if ((await studentChargePaid(studentId, `req:${r.id}`))) await setStatus(r.id, "processing");
});

export async function decideRequest(by: number, id: number, action: "approve" | "reject" | "ready" | "delivered", note: string) {
  await tx(async () => {
    const r = await request(id);
    if (!r) throw new Error("Request not found.");
    if (action === "reject") {
      if (!note) throw new Error("Give the reason.");
      if (!["submitted", "processing"].includes(r.status)) throw new Error("This request can no longer be rejected.");
      return await setStatus(id, "rejected", note, by);
    }
    if (r.kind === "section_change") {
      if (r.status !== "submitted") throw new Error("Already decided.");
      const e = await get<{ id: number }>("SELECT id FROM enrollments WHERE student_id = ? AND offering_id = ? AND status = 'confirmed'", r.student_id, r.offering_id!);
      if (!e) throw new Error("The student is no longer in the original section.");
      const to = (await offering(r.target_offering_id!))!;
      if (to.enrolled >= to.capacity) throw new Error("The new section is now full.");
      await drop(by, e.id, `Section change to ${to.code} ${to.section}`);
      await insert("INSERT INTO enrollments (student_id, offering_id, status, reason, by_user) VALUES (?,?,'confirmed',?,?)", r.student_id, to.id, `Section change #${id}`, by);
      await emit("enrollment.confirmed", { studentId: r.student_id, offeringId: to.id, by });
      return await setStatus(id, "approved", note || undefined, by);
    }
    if (r.status !== "processing" && !(action === "delivered" && r.status === "ready")) throw new Error("Only paid requests can be processed.");
    if (r.kind === "improvement") {
      if (action !== "approve") throw new Error("Approve or reject improvement requests.");
      const retake = (r.detail ?? "").startsWith("Retake");
      // The request fee covers the course; no tuition line is raised.
      await insert("INSERT INTO enrollments (student_id, offering_id, type, status, reason, by_user) VALUES (?,?,?, 'confirmed', ?, ?)",
        r.student_id, r.target_offering_id!, retake ? "retake" : "improvement", `Request #${id}`, by);
      return await setStatus(id, "approved", note || undefined, by);
    }
    if (r.kind === "convocation") return await setStatus(id, action === "approve" ? "approved" : action, note || undefined, by);
    await setStatus(id, action === "approve" ? "ready" : action, note || undefined, by);
  });
  await audit(by, action, "student_request", id, undefined, note);
}

// ---------- Exams, seat plans, admit cards, question papers (STU-A-3, STU-U-9, TCH-U-11)
export type Exam = { id: number; semester_id: number; stage: string; offering_id: number; date: string; start: string; end: string; rooms: string | null;
  code: string; title: string; section: string; teacher_user: number | null; seated: number; papers: number };
const EXAM_SQL = `SELECT x.*, c.code, c.title, o.section, t.user_id AS teacher_user,
  (SELECT COUNT(*) FROM seat_plans sp WHERE sp.exam_id = x.id) AS seated, (SELECT COUNT(*) FROM question_papers q WHERE q.exam_id = x.id) AS papers
  FROM exams x JOIN offerings o ON o.id = x.offering_id JOIN courses c ON c.id = o.course_id LEFT JOIN teachers t ON t.id = o.teacher_id`;
export const exams = async (semesterId: number, stage: string) => await all<Exam>(`${EXAM_SQL} WHERE x.semester_id = ? AND x.stage = ? ORDER BY x.date, x.start, c.code`, semesterId, stage);
export const exam = async (id: number) => await get<Exam>(`${EXAM_SQL} WHERE x.id = ?`, id);
export const offeringExams = async (offeringId: number) => await all<Exam>(`${EXAM_SQL} WHERE x.offering_id = ? ORDER BY x.date`, offeringId);

export async function scheduleExam(by: number, e: { offering_id: number; stage: string; date: string; start: string; end: string }) {
  if (!["midterm", "final"].includes(e.stage) || !e.date || !e.start || !(e.start < e.end)) throw new Error("Stage, date and a valid time range are required.");
  const o = (await offering(e.offering_id))!;
  const window = (await calendar(o.semester_id)).find((c) => c.type === e.stage);
  if (window && (e.date < window.start_date || e.date > window.end_date)) throw new Error(`The ${e.stage} window is ${window.start_date} to ${window.end_date}.`);
  // Clash: a student may not sit two exams at once
  const clash = await get<{ code: string }>(
    `SELECT c.code FROM exams x JOIN offerings o ON o.id = x.offering_id JOIN courses c ON c.id = o.course_id
     WHERE x.stage = ? AND x.date = ? AND x.start < ? AND ? < x."end" AND x.offering_id != ? AND EXISTS (
       SELECT 1 FROM enrollments a JOIN enrollments b ON a.student_id = b.student_id WHERE a.offering_id = x.offering_id AND b.offering_id = ?
       AND a.status = 'confirmed' AND b.status = 'confirmed')`, e.stage, e.date, e.end, e.start, e.offering_id, e.offering_id);
  if (clash) throw new Error(`Students in this section also sit ${clash.code} at that time.`);
  await run(`INSERT INTO exams (semester_id, stage, offering_id, date, start, "end") VALUES (?,?,?,?,?,?)
       ON CONFLICT(stage, offering_id) DO UPDATE SET date = excluded.date, start = excluded.start, "end" = excluded."end"`, o.semester_id, e.stage, e.offering_id, e.date, e.start, e.end);
  await audit(by, "schedule", "exam", `${e.stage}:${e.offering_id}`, undefined, e);
}
// Seat everyone sitting exams in the same slot across the chosen rooms, alternating courses so neighbours differ.
export async function generateSeatPlans(by: number, semesterId: number, stage: string, roomNumbers: string[]) {
  const rs = (await rooms()).filter((r) => roomNumbers.includes(r.number));
  if (!rs.length) throw new Error("Pick at least one room.");
  return await tx(async () => {
    const list = await exams(semesterId, stage);
    const slots = [...new Set(list.map((x) => `${x.date} ${x.start}`))];
    let seated = 0;
    for (const s of slots) {
      const inSlot = list.filter((x) => `${x.date} ${x.start}` === s);
      const queues = await Promise.all(inSlot.map(async (x) => await all<{ student_id: number; exam_id: number }>(
        "SELECT e.student_id, ? AS exam_id FROM enrollments e JOIN students st ON st.id = e.student_id WHERE e.offering_id = ? AND e.status = 'confirmed' ORDER BY st.student_id", x.id, x.offering_id)));
      const order: { student_id: number; exam_id: number }[] = [];
      while (queues.some((q) => q.length)) for (const q of queues) if (q.length) order.push(q.shift()!);
      const capacity = rs.reduce((t, r) => t + Math.floor(r.capacity / 2), 0); // every other seat
      if (order.length > capacity) throw new Error(`${s}: ${order.length} candidates but ${capacity} exam seats in those rooms.`);
      for (const x of inSlot) await run("DELETE FROM seat_plans WHERE exam_id = ?", x.id);
      let i = 0;
      for (const r of rs) for (let seat = 1; seat <= Math.floor(r.capacity / 2) && i < order.length; seat++, i++)
        await run("INSERT INTO seat_plans (exam_id, student_id, room, seat) VALUES (?,?,?,?)", order[i].exam_id, order[i].student_id, r.number, seat * 2 - 1);
      for (const x of inSlot) await run("UPDATE exams SET rooms = ? WHERE id = ?", [...new Set((await all<{ room: string }>("SELECT room FROM seat_plans WHERE exam_id = ?", x.id)).map((r) => r.room))].join(", "), x.id);
      seated += order.length;
    }
    await audit(by, "seat_plan", "exams", `${semesterId}:${stage}`, undefined, { rooms: roomNumbers, seated });
    await notify((await all<{ user_id: number }>(`SELECT DISTINCT s.user_id FROM seat_plans sp JOIN exams x ON x.id = sp.exam_id JOIN students s ON s.id = sp.student_id WHERE x.semester_id = ? AND x.stage = ?`,
      semesterId, stage)).map((r) => r.user_id), `${stage === "final" ? "Final" : "Mid-term"} seat plan published`, "Download your admit card.", "/app/exams");
    return seated;
  });
}
export async function studentExams(studentId: number, semesterId: number, stage: string) {
  return await all<{ id: number; code: string; title: string; date: string; start: string; end: string; room: string | null; seat: number | null }>(
    `SELECT x.id, c.code, c.title, x.date, x.start, x."end", sp.room, sp.seat FROM exams x JOIN offerings o ON o.id = x.offering_id JOIN courses c ON c.id = o.course_id
     JOIN enrollments e ON e.offering_id = x.offering_id AND e.student_id = ? AND e.status = 'confirmed'
     LEFT JOIN seat_plans sp ON sp.exam_id = x.id AND sp.student_id = e.student_id WHERE x.semester_id = ? AND x.stage = ? ORDER BY x.date, x.start`, studentId, semesterId, stage);
}
export async function admitCard(studentId: number, semesterId: number, stage: string) {
  const clear = (await clearanceFor(studentId, semesterId)).find((c) => c.exam === stage)!;
  return { clear, exams: await studentExams(studentId, semesterId, stage) };
}
export async function uploadPaper(userId: number, examId: number, fileId: number) {
  const x = await exam(examId);
  if (!x || x.teacher_user !== userId) throw new Error("You can only upload papers for your own sections.");
  await insert("INSERT INTO question_papers (exam_id, file_id, uploaded_by) VALUES (?,?,?)", examId, fileId, userId);
  await audit(userId, "upload", "question_paper", examId);
  await notify(await usersWithRole("exam_controller"), `Question paper uploaded: ${x.code} ${x.section}`, `${x.stage} on ${x.date}`, "/admin/exam/schedule");
}
export const papers = async (examId: number) => await all<{ id: number; file_id: number; name: string; at: string; by_name: string }>(
  "SELECT q.id, q.file_id, f.name, q.at, u.name AS by_name FROM question_papers q JOIN files f ON f.id = q.file_id JOIN users u ON u.id = q.uploaded_by WHERE q.exam_id = ? ORDER BY q.id DESC", examId);

// ---------- Evaluations admin (STU-A-6, TCH-U-16)
export const DEFAULT_QUESTIONS = [
  "The teacher explained concepts clearly", "Classes started and ended on time", "Assessments matched what was taught",
  "The teacher was available for help", "Course materials were useful",
];
export async function evalForm(semesterId: number) {
  const f = await get<{ questions_json: string; open: number }>("SELECT * FROM eval_forms WHERE semester_id = ?", semesterId);
  return { questions: f ? (JSON.parse(f.questions_json) as string[]) : DEFAULT_QUESTIONS, open: f ? !!f.open : true, exists: !!f };
}
export async function saveEvalForm(by: number, semesterId: number, questions: string[], open: boolean) {
  if (!questions.length) throw new Error("Add at least one question.");
  await run("INSERT INTO eval_forms (semester_id, questions_json, open) VALUES (?,?,?) ON CONFLICT(semester_id) DO UPDATE SET questions_json = excluded.questions_json, open = excluded.open",
    semesterId, JSON.stringify(questions), open ? 1 : 0);
  await audit(by, "save", "eval_form", semesterId, undefined, { questions, open });
}
export const MIN_RESPONSES = 3; // below this, results stay hidden to protect anonymity
export async function evalResults(semesterId: number, teacherId?: number) {
  const q = (await evalForm(semesterId)).questions;
  return await Promise.all((await all<{ offering_id: number; code: string; title: string; section: string; teacher: string | null; teacher_id: number | null; enrolled: number }>(
    `SELECT o.id AS offering_id, c.code, c.title, o.section, u.name AS teacher, o.teacher_id,
     (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = o.id AND e.status IN ('confirmed','completed')) AS enrolled
     FROM offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN teachers t ON t.id = o.teacher_id LEFT JOIN users u ON u.id = t.user_id
     WHERE o.semester_id = ? AND o.capacity > 0 AND (? IS NULL OR o.teacher_id = ?) ORDER BY u.name, c.code`, semesterId, teacherId ?? null, teacherId ?? null))
    .map(async (o) => {
      const rows = await all<{ rating: number; comment: string | null; answers_json: string | null }>("SELECT rating, comment, answers_json FROM evaluations WHERE offering_id = ?", o.offering_id);
      const n = rows.length;
      const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
      const hidden = n < MIN_RESPONSES;
      return {
        ...o, n, hidden, overall: hidden ? null : avg(rows.map((r) => r.rating)),
        perQuestion: hidden ? [] : q.map((text) => ({ text, avg: avg(rows.map((r) => (JSON.parse(r.answers_json ?? "{}") as Record<string, number>)[text]).filter((v) => v != null)) })),
        // Comments are shuffled so order can't identify anyone
        comments: hidden ? [] : rows.map((r) => r.comment).filter(Boolean).sort() as string[],
      };
    }));
}

// ---------- Mentoring (STU-A-8, STU-U-15, TCH-U-15)
export async function assignMentors(by: number, programId: number, batch: string, section: string, teacherId: number) {
  return await tx(async () => {
    const ids = await all<{ id: number; user_id: number }>("SELECT id, user_id FROM students WHERE program_id = ? AND batch = ? AND (? = '' OR section = ?) AND status = 'active'",
      programId, batch, section, section);
    if (!ids.length) throw new Error("No active students match.");
    for (const s of ids) await run("INSERT OR REPLACE INTO mentors (student_id, teacher_id, assigned_by) VALUES (?,?,?)", s.id, teacherId, by);
    const t = (await get<{ user_id: number; name: string }>("SELECT t.user_id, u.name FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.id = ?", teacherId))!;
    await notify(ids.map((s) => s.user_id), "Your mentor", `${t.name} is your academic mentor.`, "/app/mentor");
    await notify([t.user_id], `${ids.length} new mentees`, `Batch ${batch}${section ? `, section ${section}` : ""}`, "/app/mentees");
    await audit(by, "assign_mentors", "mentors", teacherId, undefined, { programId, batch, section, n: ids.length });
    return ids.length;
  });
}
export const mentorAssignments = async () => await all<{ teacher_id: number; teacher: string; n: number; batches: string }>(
  `SELECT m.teacher_id, u.name AS teacher, COUNT(*) AS n, GROUP_CONCAT(DISTINCT s.batch || '_' || s.section) AS batches FROM mentors m
   JOIN teachers t ON t.id = m.teacher_id JOIN users u ON u.id = t.user_id JOIN students s ON s.id = m.student_id GROUP BY m.teacher_id ORDER BY u.name`);
export const mentorOf = async (studentId: number) => await get<{ teacher_id: number; name: string; email: string; phone: string | null; designation: string; user_id: number }>(
  `SELECT m.teacher_id, u.name, u.email, u.phone, t.designation, u.id AS user_id FROM mentors m JOIN teachers t ON t.id = m.teacher_id JOIN users u ON u.id = t.user_id WHERE m.student_id = ?`, studentId);
export const mentees = async (teacherId: number) => await all<{ id: number; student_id: string; name: string; batch: string; section: string; program: string }>(
  `SELECT s.id, s.student_id, u.name, s.batch, s.section, p.name AS program FROM mentors m JOIN students s ON s.id = m.student_id JOIN users u ON u.id = s.user_id
   JOIN programs p ON p.id = s.program_id WHERE m.teacher_id = ? ORDER BY s.student_id`, teacherId);
export async function addSlots(teacherId: number, date: string, start: string, count: number, minutes: number, place: string) {
  if (!date || !start || !(count >= 1 && count <= 12) || !(minutes >= 10) || !place) throw new Error("Date, start, number of slots, length and place are required.");
  if (date < today()) throw new Error("Pick a future date.");
  for (let i = 0; i < count; i++) {
    const t = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + i * minutes;
    await insert("INSERT INTO mentor_slots (teacher_id, start_at, minutes, place) VALUES (?,?,?,?)", teacherId, `${date} ${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`, minutes, place);
  }
}
export const slots = async (teacherId: number) => await all<{ id: number; start_at: string; minutes: number; place: string; student_id: number | null; topic: string | null; student: string | null }>(
  `SELECT ms.*, u.name AS student FROM mentor_slots ms LEFT JOIN students s ON s.id = ms.student_id LEFT JOIN users u ON u.id = s.user_id
   WHERE ms.teacher_id = ? AND ms.start_at >= ? ORDER BY ms.start_at`, teacherId, today());
export async function bookSlot(studentId: number, slotId: number, topic: string) {
  const m = await mentorOf(studentId);
  const s = await get<{ teacher_id: number; student_id: number | null; start_at: string }>("SELECT * FROM mentor_slots WHERE id = ?", slotId);
  if (!m || !s || s.teacher_id !== m.teacher_id) throw new Error("That slot is not with your mentor.");
  if (s.student_id) throw new Error("Someone just booked that slot. Pick another.");
  if ((await get("SELECT 1 FROM mentor_slots WHERE student_id = ? AND start_at >= ?", studentId, today()))) throw new Error("You already have an upcoming booking.");
  await run("UPDATE mentor_slots SET student_id = ?, topic = ? WHERE id = ? AND student_id IS NULL", studentId, topic || null, slotId);
  const st = (await studentById(studentId))!;
  await notify([m.user_id], `Advising booked: ${st.name}`, `${s.start_at}${topic ? ` · ${topic}` : ""}`, "/app/mentees");
}
export async function cancelBooking(studentId: number, slotId: number) {
  await run("UPDATE mentor_slots SET student_id = NULL, topic = NULL WHERE id = ? AND student_id = ?", slotId, studentId);
}
export async function logMeeting(teacherId: number, userId: number, m: { student_id: number; date: string; reason: string; action: string; next_meeting: string; file_id: number | null }) {
  if (!(await mentees(teacherId)).some((s) => s.id === m.student_id)) throw new Error("Only your mentees.");
  if (!m.date || !m.reason) throw new Error("Date and reason are required.");
  await insert("INSERT INTO mentor_meetings (teacher_id, student_id, date, reason, action, next_meeting, file_id) VALUES (?,?,?,?,?,?,?)",
    teacherId, m.student_id, m.date, m.reason, m.action || null, m.next_meeting || null, m.file_id);
  await audit(userId, "log", "mentor_meeting", m.student_id);
  const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", m.student_id))!.user_id;
  await notify([uid], "Mentor meeting recorded", m.reason, "/app/mentor");
}
export const meetings = async (studentId: number) => await all<{ id: number; date: string; reason: string; action: string | null; next_meeting: string | null; file_id: number | null; file_name: string | null; teacher: string }>(
  `SELECT mm.*, f.name AS file_name, u.name AS teacher FROM mentor_meetings mm LEFT JOIN files f ON f.id = mm.file_id JOIN teachers t ON t.id = mm.teacher_id
   JOIN users u ON u.id = t.user_id WHERE mm.student_id = ? ORDER BY mm.date DESC`, studentId);

// ---------- Reports (STU-A-9)
export async function registrationStats(semesterId: number) {
  return (await all<{ code: string; title: string; section: string; capacity: number; confirmed: number; waitlisted: number; dropped: number; withdrawn: number }>(
    `SELECT c.code, c.title, o.section, o.capacity,
     SUM(e.status IN ('confirmed','completed')) AS confirmed, SUM(e.status = 'waitlisted') AS waitlisted, SUM(e.status = 'dropped') AS dropped, SUM(e.status = 'withdrawn') AS withdrawn
     FROM offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN enrollments e ON e.offering_id = o.id
     WHERE o.semester_id = ? AND o.capacity > 0 GROUP BY o.id ORDER BY c.code, o.section`, semesterId))
    .map((r) => ({ ...r, confirmed: r.confirmed ?? 0, waitlisted: r.waitlisted ?? 0, dropped: r.dropped ?? 0, withdrawn: r.withdrawn ?? 0 }));
}
export async function resultAnalysis(semesterId: number) {
  const rows = await all<{ offering_id: number; code: string; section: string; letter: string; gp_c: number }>(
    `SELECT r.offering_id, c.code, o.section, r.letter, r.gp_c FROM results r JOIN offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
     WHERE o.semester_id = ? AND r.id = (SELECT MAX(id) FROM results r2 WHERE r2.student_id = r.student_id AND r2.offering_id = r.offering_id)`, semesterId);
  const by = new Map<number, typeof rows>();
  for (const r of rows) by.set(r.offering_id, [...(by.get(r.offering_id) ?? []), r]);
  return [...by.values()].map((rs) => ({
    code: rs[0].code, section: rs[0].section, n: rs.length,
    avg: Math.round((rs.reduce((t, r) => t + r.gp_c, 0) / rs.length)) / 100,
    pass: Math.round((rs.filter((r) => r.letter !== "F").length / rs.length) * 100),
    dist: rs.reduce<Record<string, number>>((d, r) => ({ ...d, [r.letter]: (d[r.letter] ?? 0) + 1 }), {}),
  }));
}
export async function standing() {
  const sts = await all<{ id: number; student_id: string; name: string; program: string; batch: string; total_credits: number }>(
    `SELECT s.id, s.student_id, u.name, p.name AS program, s.batch, p.total_credits FROM students s JOIN users u ON u.id = s.user_id JOIN programs p ON p.id = s.program_id
     WHERE s.status = 'active' ORDER BY s.student_id`);
  // ponytail: per-student transcript in JS; precompute CGPA on result.published at 25k students.
  return await Promise.all(sts.map(async (s) => {
    const tr = await transcript(s.id);
    const last = tr.at(-1);
    return { ...s, cgpa: last?.cgpa ?? null, sgpa: last?.sgpa ?? null, earned: await creditsEarned(s.id), conv: (await convocationCheck(s.id)).eligible };
  }));
}

// STU-U-2: academic calendar as .ics
export async function ics(semesterId: number) {
  const sem = (await semester(semesterId))!;
  const d = (x: string) => x.replace(/-/g, "");
  const next = (x: string) => { const t = new Date(x + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10).replace(/-/g, ""); };
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DIU ERP//Academic Calendar//EN", `X-WR-CALNAME:DIU ${esc(sem.name)}`,
    ...(await calendar(semesterId)).flatMap((e) => ["BEGIN:VEVENT", `UID:diu-cal-${e.id}@diu.edu.bd`, `DTSTAMP:${d(today())}T000000Z`,
      `DTSTART;VALUE=DATE:${d(e.start_date)}`, `DTEND;VALUE=DATE:${next(e.end_date)}`, `SUMMARY:${esc(e.title)}`, `CATEGORIES:${e.type}`, "END:VEVENT"]),
    "END:VCALENDAR"].join("\r\n");
}

// Latest section change request for a course this semester (a student gets one per course).
export const sectionChangeFor = async (studentId: number, courseId: number, semesterId: number) => await get<{ id: number; status: string; target: string | null; note: string | null }>(
  `SELECT r.id, r.status, r.note, t.section AS target FROM student_requests r JOIN offerings o ON o.id = r.offering_id LEFT JOIN offerings t ON t.id = r.target_offering_id
   WHERE r.student_id = ? AND r.kind = 'section_change' AND o.course_id = ? AND o.semester_id = ? ORDER BY r.id DESC LIMIT 1`, studentId, courseId, semesterId);
const sectionChangeUsed = async (studentId: number, courseId: number, semesterId: number) => !!(await sectionChangeFor(studentId, courseId, semesterId));

export const sectionOptions = async (courseId: number, semesterId: number, exceptId: number) =>
  await all<{ id: number; section: string; enrolled: number; capacity: number }>(
    `SELECT o.id, o.section, o.capacity, (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = o.id AND e.status = 'confirmed') AS enrolled
     FROM offerings o WHERE o.course_id = ? AND o.semester_id = ? AND o.id != ? AND o.capacity > 0`, courseId, semesterId, exceptId);
export { enrollments };
