// Full test dataset: `npm run seed` (wipes the database: data/erp.db locally, or Turso when TURSO_DATABASE_URL is set). Runs through the real domain functions.
// All data is synthetic. Every seeded account uses the password in SEED_PASSWORD (see README).
import { run, insert, get, all, today, each, resetDatabase, DB_URL } from "./db.ts";
import { core, registrar, student, teacher, accounts } from "../modules/index.ts";

export const SEED_PASSWORD = "diu12345";
const pw = SEED_PASSWORD;

if (process.argv.includes("--if-empty")) {
  try { if ((await get("SELECT 1 FROM users LIMIT 1"))) process.exit(0); } catch { /* fresh db */ }
} else {
  console.log(`Resetting ${DB_URL.startsWith("file:") ? DB_URL : "the Turso database"}…`);
  await resetDatabase();
}

const SYS = 0;
const mk = async (uni_id: string, name: string, roles: { role: core.Role; dept_id?: number }[], phone = "01700000000") =>
  await core.createUser({ uni_id, email: `${uni_id.toLowerCase().replace(/[^a-z0-9]/g, "")}@diu.edu.bd`, name, phone, password: pw }, roles);

// ---------- Settings
for (const s of core.SETTINGS) await run("INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)", s.key, s.def);

// ---------- Faculty, departments, programs
const fsit = await insert("INSERT INTO faculties (code, name) VALUES ('FSIT', 'Faculty of Science and Information Technology')");
const cse = await insert("INSERT INTO departments (faculty_id, code, short, name) VALUES (?, '15', 'CSE', 'Computer Science and Engineering')", fsit);
const swe = await insert("INSERT INTO departments (faculty_id, code, short, name) VALUES (?, '35', 'SWE', 'Software Engineering')", fsit);
const pCse = await insert("INSERT INTO programs (dept_id, name, degree, total_credits) VALUES (?, 'B.Sc. in CSE', 'B.Sc.', 148)", cse);
const pSwe = await insert("INSERT INTO programs (dept_id, name, degree, total_credits) VALUES (?, 'B.Sc. in SWE', 'B.Sc.', 145)", swe);

// ---------- Staff
await mk("ADM-0001", "System Administrator", [{ role: "super_admin" }]);
await mk("REG-0001", "Farhana Kabir", [{ role: "registrar" }]);
await mk("EXC-0001", "Mizanur Rahman", [{ role: "exam_controller" }]);
const cashierId = await mk("CSH-0001", "Rakib Hasan", [{ role: "cashier" }]);
await mk("ACC-0001", "Nusrat Jahan", [{ role: "accounts_officer" }]);
await mk("FIN-0001", "Anwar Hossain", [{ role: "finance_head" }]);
const headUser = await mk("710001234", "Dr. Sheak Rashed Haider", [{ role: "teacher" }, { role: "dept_head", dept_id: cse }]);
const t1User = await mk("710001301", "Tanvir Ahmed", [{ role: "teacher" }]);
const t2User = await mk("710001302", "Sadia Afrin", [{ role: "teacher" }]);
const t3User = await mk("710001303", "Mahmudul Islam", [{ role: "teacher" }]);
await run("UPDATE departments SET head_user_id = ? WHERE id = ?", headUser, cse);
const tHead = await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?, '710001234', ?, 'Professor')", headUser, cse);
const t1 = await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?, '710001301', ?, 'Senior Lecturer')", t1User, cse);
const t2 = await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?, '710001302', ?, 'Lecturer')", t2User, cse);
const t3 = await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?, '710001303', ?, 'Assistant Professor')", t3User, swe);

// ---------- Fees
for (const p of [pCse, pSwe]) {
  await accounts.setFee(SYS, p, "admission", 25000);
  await accounts.setFee(SYS, p, "semester_fee", 9500);
  await accounts.setFee(SYS, p, "tuition_per_credit", p === pCse ? 4500 : 4200);
  await accounts.setFee(SYS, p, "lab_fee", 3000);
}

// ---------- Courses
const C: Record<string, number> = {};
const course = async (code: string, title: string, credits: number, type = "theory", prereqs: string[] = [], dept = cse) =>
  (C[code] = await registrar.addCourse(SYS, { dept_id: dept, code, title, credits, type, prereqs }));
await course("CSE112", "Computer Fundamentals", 3);
await course("CSE113", "Programming and Problem Solving", 3);
await course("CSE114", "Programming and Problem Solving Lab", 1.5, "lab");
await course("MAT101", "Mathematics I: Differential and Integral Calculus", 3);
await course("ENG101", "English I", 3);
await course("CSE131", "Discrete Mathematics", 3);
await course("CSE133", "Data Structures", 3, "theory", ["CSE113"]);
await course("CSE134", "Data Structures Lab", 1.5, "lab", ["CSE114"]);
await course("MAT102", "Mathematics II: Linear Algebra", 3, "theory", ["MAT101"]);
await course("CSE221", "Algorithms", 3, "theory", ["CSE133"]);
await course("CSE222", "Algorithms Lab", 1.5, "lab", ["CSE134"]);
await course("CSE231", "Database Management Systems", 3, "theory", ["CSE133"]);
await course("CSE232", "Database Management Systems Lab", 1.5, "lab", ["CSE134"]);
await course("CSE233", "Object Oriented Programming", 3, "theory", ["CSE113"]);
await course("STA101", "Statistics and Probability", 3);
await course("SWE131", "Introduction to Software Engineering", 3, "theory", [], swe);

// ---------- Rooms & slots
const R: Record<string, number> = {};
for (const [n, cap, type] of [["AB4-501", 60, "theory"], ["AB4-502", 60, "theory"], ["AB4-601", 45, "theory"], ["AB4-701", 40, "lab"], ["AB4-702", 40, "lab"]] as const)
  R[n] = await insert("INSERT INTO rooms (number, capacity, type) VALUES (?,?,?)", n, cap, type);
const TIMES = [["08:30", "10:00"], ["10:00", "11:30"], ["11:30", "13:00"], ["13:00", "14:30"], ["14:30", "16:00"]];
for (const d of registrar.DAYS) for (const [s, e] of TIMES) await insert('INSERT INTO time_slots (day, start, "end") VALUES (?,?,?)', d, s, e);
const slot = async (day: string, start: string) => (await get<{ id: number }>("SELECT id FROM time_slots WHERE day = ? AND start = ?", day, start))!.id;

// ---------- Semesters
const s253 = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, due_date) VALUES ('253', 'Fall 2025', '2025-09-01', '2025-12-31', 'closed', '2025-10-15')");
const s261 = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, due_date) VALUES ('261', 'Spring 2026', '2026-01-10', '2026-04-30', 'closed', '2026-02-20')");
const s263 = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, reg_open, due_date) VALUES ('263', 'Fall 2026', '2026-09-01', '2026-12-31', 'active', 1, '2026-10-15')");
for (const [type, title, a, b] of [
  ["registration", "Course registration", "2026-08-20", "2026-09-12"], ["classes", "Classes begin", "2026-09-06", "2026-09-06"],
  ["registration", "Add / drop window", "2026-09-06", "2026-09-19"], ["holiday", "Durga Puja", "2026-10-19", "2026-10-22"],
  ["midterm", "Mid-term examinations", "2026-10-25", "2026-11-02"], ["holiday", "Victory Day", "2026-12-16", "2026-12-16"],
  ["final", "Final examinations", "2026-12-12", "2026-12-24"], ["deadline", "Grade sheet submission deadline", "2026-12-31", "2026-12-31"],
]) await insert("INSERT INTO calendar_events (semester_id, type, title, start_date, end_date) VALUES (?,?,?,?,?)", s263, type, title, a, b);

// ---------- Students (batch 42, section E; plus one SWE)
const NAMES = ["Asad Adil", "Nafisa Tabassum", "Rifat Chowdhury", "Sumaiya Islam", "Tahmid Hasan", "Farzana Akter", "Imran Hossain", "Jannatul Ferdous", "Shakil Ahmed", "Mehjabin Rahman"];
const students = await each(NAMES, async (name, i) => {
  const code = `253-15-${String(i + 1).padStart(4, "0")}`;
  const uid = await mk(code, name, [{ role: "student" }], `0171${String(1000000 + i * 7919).slice(-7)}`);
  return await insert("INSERT INTO students (user_id, student_id, reg_id, program_id, batch, section, admitted_semester_id) VALUES (?,?,?,?,?,?,?)",
    uid, code, `REG-${code}`, pCse, "42", "E", s253);
});
await run("UPDATE users SET blood_group = 'B+', emergency_contact = 'Adil Hossain (father) 01711000000' WHERE uni_id = '253-15-0001'");
const sweUid = await mk("263-35-0001", "Kazi Mahir", [{ role: "student" }]);
const sweStudent = await insert("INSERT INTO students (user_id, student_id, reg_id, program_id, batch, section, admitted_semester_id) VALUES (?,'263-35-0001','REG-263-35-0001',?,'31','A',?)", sweUid, pSwe, s263);

// Admission fee for everyone in their first semester (W2)
for (const id of [...students, sweStudent]) {
  const inv = await accounts.ensureInvoice(id, id === sweStudent ? s263 : s253);
  await insert("INSERT INTO invoice_lines (invoice_id, head, description, amount, ref) VALUES (?, 'admission', 'Admission fee', 25000, 'admission')", inv);
}

// ---------- Helpers to run a whole semester through the real flow
type Off = { code: string; section: string; teacher: number; cap: number; slots: [string, string, string][] };
async function offer(sem: number, o: Off) {
  return await registrar.createOffering(SYS, { course_id: C[o.code], semester_id: sem, section: o.section, teacher_id: o.teacher, capacity: o.cap,
    slots: await Promise.all(o.slots.map(async ([d, t, r]) => ({ slot_id: await slot(d, t), room_id: R[r] }))) });
}
async function plan(offeringId: number, lab: boolean) {
  const rows: [string, string, number, number][] = lab
    ? [["assignment", "Lab reports", 20, 30], ["attendance", "Attendance", 10, 10], ["final", "Lab final", 60, 60]]
    : [["quiz", "Quiz average", 15, 15], ["assignment", "Assignment", 5, 5], ["attendance", "Attendance", 7, 7], ["mid", "Mid-term", 25, 25], ["final", "Final", 40, 48]];
  for (const [type, title, max, weight] of rows) await teacher.addAssessment(SYS, { offering_id: offeringId, type, title, max_marks: max, weight, instructions: null, due_at: null });
}
// Deterministic "ability" per student so grades look plausible across semesters.
const ability = (sid: number) => 0.55 + ((sid * 37) % 40) / 100;
async function markAll(offeringId: number, seedN: number) {
  for (const a of (await teacher.assessments(offeringId))) {
    const scores: Record<number, { score: string }> = {};
    for (const r of (await teacher.roster(offeringId))) {
      const jitter = (((r.student_id * 13 + a.id * 7 + seedN) % 17) - 8) / 100;
      scores[r.student_id] = { score: String(Math.round(Math.min(1, Math.max(0.2, ability(r.student_id) + jitter)) * a.max_marks * 2) / 2) };
    }
    await teacher.enterMarks(SYS, a.id, scores);
  }
}
async function backdate(table: string, fromId: number, at: string) {
  await run(`UPDATE ${table} SET at = ? WHERE id > ?`, at, fromId);
}
const maxId = async (t: string) => (await get<{ m: number }>(`SELECT COALESCE(MAX(id), 0) AS m FROM ${t}`))!.m;
const examUser = (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = 'EXC-0001'"))!.id;
const regUser = (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = 'REG-0001'"))!.id;
const accUser = (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = 'ACC-0001'"))!.id;
const finUser = (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = 'FIN-0001'"))!.id;

async function runPastSemester(sem: number, offs: Off[], who: number[], payDate: string, chargeDate: string, pubDate: string) {
  const [l0, p0, r0, e0] = await Promise.all(["invoice_lines", "payments", "results", "enrollments"].map(maxId));
  await run("UPDATE semesters SET reg_open = 1 WHERE id = ?", sem);
  const ids = await each(offs, async (o) => await offer(sem, o));
  for (const sid of who) for (const id of ids) await student.register(SYS, sid, id);
  await run("UPDATE semesters SET reg_open = 0 WHERE id = ?", sem);
  await each(ids, async (id, i) => { await plan(id, (await registrar.offering(id))!.type === "lab"); await markAll(id, sem * 10 + i); await teacher.submitGradesheet(SYS, id); await teacher.decideGradesheet(headUser, id, true, ""); });
  await student.publishResults(examUser, sem);
  for (const sid of who) for (const id of ids) await student.submitEvaluation(sid, id, 3 + ((sid + id) % 3), "");
  await backdate("invoice_lines", l0, chargeDate);
  await backdate("enrollments", e0, chargeDate);
  await backdate("results", r0, pubDate);
  for (const sid of who) await accounts.recordPayment(cashierId, { studentId: sid, amount: (await accounts.summary(sid)).due, method: sid % 3 ? "cash" : "bKash (manual ref)", channel: "counter", reference: sid % 3 ? undefined : `BK${sid}${sem}` });
  await backdate("payments", p0, payDate);
}

// Fall 2025
await runPastSemester(s253, [
  { code: "CSE112", section: "42_E", teacher: t1, cap: 45, slots: [["Sat", "08:30", "AB4-501"], ["Mon", "08:30", "AB4-501"]] },
  { code: "CSE113", section: "42_E", teacher: tHead, cap: 45, slots: [["Sat", "10:00", "AB4-501"], ["Mon", "10:00", "AB4-501"]] },
  { code: "CSE114", section: "42_E", teacher: t2, cap: 40, slots: [["Sun", "08:30", "AB4-701"], ["Sun", "10:00", "AB4-701"]] },
  { code: "MAT101", section: "42_E", teacher: t1, cap: 45, slots: [["Tue", "08:30", "AB4-502"], ["Thu", "08:30", "AB4-502"]] },
  { code: "ENG101", section: "42_E", teacher: t2, cap: 45, slots: [["Tue", "10:00", "AB4-502"], ["Thu", "10:00", "AB4-502"]] },
], students, "2025-10-10 10:30:00", "2025-09-05 09:00:00", "2026-01-05 12:00:00");

// Spring 2026
await runPastSemester(s261, [
  { code: "CSE131", section: "42_E", teacher: t1, cap: 45, slots: [["Sat", "08:30", "AB4-501"], ["Mon", "08:30", "AB4-501"]] },
  { code: "CSE133", section: "42_E", teacher: tHead, cap: 45, slots: [["Sat", "10:00", "AB4-501"], ["Mon", "10:00", "AB4-501"]] },
  { code: "CSE134", section: "42_E", teacher: t2, cap: 40, slots: [["Sun", "08:30", "AB4-701"], ["Sun", "10:00", "AB4-701"]] },
  { code: "MAT102", section: "42_E", teacher: t1, cap: 45, slots: [["Tue", "08:30", "AB4-502"], ["Thu", "08:30", "AB4-502"]] },
], students, "2026-02-15 11:00:00", "2026-01-12 09:00:00", "2026-05-20 12:00:00");

// One student failed Discrete Math: a retake story for results and registration
{
  const off = (await get<{ id: number }>("SELECT id FROM offerings WHERE course_id = ? AND semester_id = ?", C.CSE131, s261))!.id;
  const sid = students[8];
  await student.requestGradeChange(t1User, off, sid, 38, "Final exam script re-checked: two answers were not marked");
  await student.decideGradeChange(examUser, (await get<{ id: number }>("SELECT MAX(id) AS id FROM grade_changes"))!.id, true);
}

// ---------- Fall 2026 (active)
const cur: Off[] = [
  { code: "CSE221", section: "42_E", teacher: tHead, cap: 45, slots: [["Sat", "08:30", "AB4-501"], ["Mon", "08:30", "AB4-501"]] },
  { code: "CSE222", section: "42_E", teacher: t2, cap: 40, slots: [["Sun", "08:30", "AB4-701"], ["Sun", "10:00", "AB4-701"]] },
  { code: "CSE231", section: "42_E", teacher: t1, cap: 45, slots: [["Sat", "10:00", "AB4-502"], ["Tue", "10:00", "AB4-502"]] },
  { code: "CSE232", section: "42_E", teacher: t2, cap: 40, slots: [["Wed", "08:30", "AB4-702"], ["Wed", "10:00", "AB4-702"]] },
  { code: "CSE233", section: "42_E", teacher: t1, cap: 45, slots: [["Mon", "11:30", "AB4-601"], ["Thu", "11:30", "AB4-601"]] },
  { code: "STA101", section: "42_E", teacher: t1, cap: 45, slots: [["Tue", "13:00", "AB4-601"], ["Thu", "13:00", "AB4-601"]] },
  { code: "CSE131", section: "43_A", teacher: t2, cap: 3, slots: [["Sun", "13:00", "AB4-502"], ["Tue", "14:30", "AB4-502"]] },
  { code: "SWE131", section: "31_A", teacher: t3, cap: 40, slots: [["Sat", "13:00", "AB4-601"], ["Mon", "13:00", "AB4-601"]] },
];
const [l0, e0] = await Promise.all(["invoice_lines", "enrollments"].map(maxId));
const curIds = await each(cur, async (o) => await offer(s263, o));
const byCode = (code: string, section = "42_E") => curIds[cur.findIndex((o) => o.code === code && o.section === section)];
for (const sid of students.slice(0, 7)) for (const code of ["CSE221", "CSE222", "CSE231", "CSE232", "CSE233"]) await student.register(sid, sid, await byCode(code));
await student.register(students[8], students[8], await byCode("CSE131", "43_A"));
await student.register(sweStudent, sweStudent, await byCode("SWE131", "31_A"));
await backdate("invoice_lines", l0, "2026-09-02 10:00:00");
await backdate("enrollments", e0, "2026-09-02 10:00:00");
// Proposal waiting for the registrar (TCH-A-1)
await registrar.proposeTeacher(headUser, await byCode("STA101"), t2);
await run("UPDATE offerings SET teacher_id = NULL WHERE id = ?", await byCode("STA101"));

// Assessments for the current semester, quizzes 1 and 2 marked and published
for (const code of ["CSE221", "CSE222", "CSE231", "CSE232", "CSE233"]) {
  const id = await byCode(code);
  const lab = code.endsWith("2");
  await teacher.addAssessment(SYS, { offering_id: id, type: "quiz", title: "Quiz 1", max_marks: 10, weight: lab ? 10 : 5, instructions: null, due_at: null });
  if (!lab) await teacher.addAssessment(SYS, { offering_id: id, type: "quiz", title: "Quiz 2", max_marks: 10, weight: 5, instructions: null, due_at: null });
  await teacher.addAssessment(SYS, { offering_id: id, type: "assignment", title: lab ? "Lab report 1" : "Assignment 1", max_marks: 10, weight: lab ? 20 : 5,
    instructions: lab ? "Implement Dijkstra and Bellman-Ford; compare on the given graphs. Submit a PDF report with code." : "Solve problem set 1 (asymptotic analysis). Handwritten scans are fine.",
    due_at: "2026-10-05T23:59" });
  await teacher.addAssessment(SYS, { offering_id: id, type: "mid", title: "Mid-term", max_marks: 25, weight: lab ? 20 : 25, instructions: null, due_at: null });
  await teacher.addAssessment(SYS, { offering_id: id, type: "final", title: "Final", max_marks: 40, weight: lab ? 50 : 60, instructions: null, due_at: null });
  const quizzes = (await teacher.assessments(id)).filter((a) => a.type === "quiz");
  for (const q of quizzes) {
    const scores: Record<number, { score: string }> = {};
    for (const r of (await teacher.roster(id))) scores[r.student_id] = { score: String(Math.round(ability(r.student_id) * 10 + ((r.student_id + q.id) % 3) - 1)) };
    await teacher.enterMarks(SYS, q.id, scores);
    await teacher.togglePublish(SYS, q.id);
  }
  await teacher.addMaterial(SYS, { offering_id: id, week: 1, title: "Course outline and marks distribution", kind: "link", url: "https://daffodilvarsity.edu.bd", file_id: null });
  await teacher.addMaterial(SYS, { offering_id: id, week: 2, title: lab ? "Lab 1 handout" : "Lecture 2 slides", kind: "link", url: "https://daffodilvarsity.edu.bd", file_id: null });
}

// Attendance for the first three weeks (classes from 6 Sep 2026)
{
  const [a0] = await Promise.all(["attendance_records"].map(maxId));
  for (const [i, id] of curIds.entries()) {
    const slots = await registrar.slotsFor([id]);
    for (let d = new Date("2026-09-06T00:00:00Z"); d < new Date("2026-09-26T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      for (const s of slots.filter((s) => s.day === day)) {
        const marks: Record<number, string> = {};
        for (const r of (await teacher.roster(id))) {
          const v = (r.student_id * 7 + d.getUTCDate() * 3 + i) % 10;
          // Student 7 skips a lot, to show the warning
          marks[r.student_id] = r.student_id === students[6] ? (v < 5 ? "absent" : "present") : v === 0 ? "absent" : v === 1 ? "late" : "present";
        }
        const date = d.toISOString().slice(0, 10);
        await teacher.saveAttendance(cur[i].teacher === tHead ? headUser : SYS, id, date, s.slot_id, s.room_id, marks, "");
        await run("UPDATE attendance_sessions SET at = ? WHERE offering_id = ? AND date = ?", `${date} 10:00:00`, id, date);
      }
    }
  }
  await run("UPDATE attendance_records SET at = (SELECT at FROM attendance_sessions s WHERE s.id = session_id) WHERE id > ?", a0);
}

// ---------- Payments this semester: a mix of paid, partial, and nothing
{
  const p0 = await maxId("payments");
  const pay = async (sid: number, amount: number, method: string, channel: "counter" | "online", ref?: string) =>
    await accounts.recordPayment(channel === "counter" ? cashierId : null, { studentId: sid, amount, method, channel, reference: ref });
  await pay(students[0], 40000, "bKash", "online", "TXN8K2QJ4F1");
  await pay(students[1], (await accounts.summary(students[1])).due, "cash", "counter");
  await pay(students[2], 30000, "cash", "counter");
  await pay(students[3], 20000, "Nagad", "online", "NG77310042");
  await pay(students[4], (await accounts.summary(students[4])).due, "cheque", "counter", "DBBL 004512");
  await backdate("payments", p0, "2026-09-10 11:00:00");
  // Today's counter collection, for the dashboard and shift close
  await pay(students[5], 25000, "cash", "counter");
  await pay(sweStudent, 15000, "cash", "counter");
}

// Waiver: requested by accounts officer, approved by finance head (maker-checker)
await accounts.requestApproval(accUser, { kind: "waiver", student_id: students[0], semester_id: s263, percent: 25, detail: "Result-based waiver (SGPA ≥ 3.75)", reason: "Spring 2026 SGPA qualifies" });
await accounts.decideApproval(finUser, (await get<{ id: number }>("SELECT MAX(id) AS id FROM approvals"))!.id, true);
// Pending reversal for the finance team to review
{
  const p = (await get<{ id: number }>("SELECT id FROM payments WHERE student_id = ? ORDER BY id DESC LIMIT 1", students[2]))!;
  await accounts.requestApproval(cashierId, { kind: "reversal", ref_id: p.id, student_id: students[2], reason: "Entered against the wrong student ID" });
}

// Notices
const noticeAt = async (id: number, at: string) => await run("UPDATE notices SET at = ? WHERE id = ?", at, id);
await noticeAt(await core.postNotice(regUser, { title: "Fall 2026 course registration closes 12 September", body: "Register your courses from Student Portal → Course Registration. Students with dues from Spring 2026 must clear them at the Accounts counter before registering.", category: "Academic", audience: "all" }), "2026-08-20 09:00:00");
await noticeAt(await core.postNotice(examUser, { title: "Mid-term examination schedule published", body: "Mid-term examinations for Fall 2026 run 25 October – 2 November. Seat plans will be available in the portal one week before the exams. Clearance requires at least 50% of semester fees paid.", category: "Exam", audience: "all" }), "2026-09-20 15:00:00");
await noticeAt(await core.postNotice(headUser, { title: "CSE: Project showcase proposals due 15 October", body: "Batches 40–43 can submit capstone and course project proposals for the department showcase. One page, PDF, to the department office.", category: "Department", audience: "department", audience_ref: String(cse) }), "2026-09-18 11:00:00");
await noticeAt(await core.postNotice(accUser, { title: "Pay semester fees online with bKash or Nagad", body: "Online payments now post to your ledger instantly with a receipt. Counter payments are accepted Sunday to Thursday, 9:00–16:00.", category: "Accounts", audience: "role", audience_ref: "student" }), "2026-09-03 10:00:00");
await noticeAt(await core.postNotice(headUser, { title: "CSE221: Quiz 2 on Monday", body: "Quiz 2 covers divide and conquer and recurrences. Bring your ID card.", category: "Class", audience: "section", audience_ref: String(await byCode("CSE221")) }), "2026-09-24 17:00:00");

await run("DELETE FROM notifications");
{
  const u = async (i: number) => (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", students[i]))!.user_id;
  await core.notify([await u(0)], "Waiver approved: 25% on Fall 2026 tuition", "Result-based waiver for Spring 2026 SGPA.", "/app/fees?tab=waivers");
  await core.notify([await u(0)], "Payment received: ৳40,000", "Online payment via bKash.", "/app/fees?tab=ledger");
  await core.notify([await u(6)], "Attendance warning: CSE221", "Your attendance is below 70%. Below the threshold you cannot sit the final exam.", "/app/attendance");
  await core.notify([headUser], "Proposal pending: STA101 42_E", "Your teacher proposal is waiting for the Registrar.", "/admin/department");
}

// ================= Fall 2026: batch 42 in sections A–J =================
// Every batch-42 course runs in ten sections. Each section keeps section E's weekly pattern shifted to another
// time row (so its own timetable never clashes), has its own rooms, and draws faculty from the department pool.
{
  const TIMES = ["08:30", "10:00", "11:30", "13:00", "14:30"];
  const LETTERS = "ABCDEFGHIJ".split("");
  const base: Record<string, [string, number][]> = {
    CSE221: [["Sat", 0], ["Mon", 0]], CSE222: [["Sun", 0], ["Sun", 1]], CSE231: [["Sat", 1], ["Tue", 1]],
    CSE232: [["Wed", 0], ["Wed", 1]], CSE233: [["Mon", 2], ["Thu", 2]], STA101: [["Tue", 3], ["Thu", 3]],
  };
  const pool = [tHead, t1, t2];
  for (const [emp, name, desig] of [["710001304", "Farzana Yasmin", "Lecturer"], ["710001305", "Kamrul Hasan", "Lecturer"], ["710001306", "Nazmul Alam", "Senior Lecturer"],
    ["710001307", "Ayesha Siddiqua", "Lecturer"], ["710001308", "Rezaul Karim", "Assistant Professor"], ["710001309", "Shamima Nasrin", "Lecturer"],
    ["710001310", "Mahbub Rahman", "Lecturer"], ["710001311", "Tahmina Akter", "Senior Lecturer"]]) {
    const uid = await mk(emp, name, [{ role: "teacher" }]);
    pool.push(await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?,?,?,?)", uid, emp, cse, desig));
  }
  const slotId = async (day: string, start: string) => (await get<{ id: number }>("SELECT id FROM time_slots WHERE day = ? AND start = ?", day, start))!.id;
  await each(Object.keys(base), async (code, ci) => {
    const courseId = (await get<{ id: number; type: string }>("SELECT id, type FROM courses WHERE code = ?", code))!;
    await each(LETTERS, async (letter, k) => {
      if (letter === "E") return; // section E already exists with its students
      const theoryRoom = (await get<{ id: number }>("SELECT id FROM rooms WHERE number = ?", `AB6-${101 + k}`))?.id ?? await insert("INSERT INTO rooms (number, capacity, type) VALUES (?, 50, 'theory')", `AB6-${101 + k}`);
      const labRoom = (await get<{ id: number }>("SELECT id FROM rooms WHERE number = ?", `AB6-L${k + 1}`))?.id ?? await insert("INSERT INTO rooms (number, capacity, type) VALUES (?, 40, 'lab')", `AB6-L${k + 1}`);
      const shift = (k - 4 + 5) % 5;
      const slots = await Promise.all(base[code].map(async ([day, t]) => ({ slot_id: await slotId(day, TIMES[(t + shift) % 5]), room_id: courseId.type === "lab" ? labRoom : theoryRoom })));
      const capacity = courseId.type === "lab" ? 40 : letter === "J" ? 30 : 45;
      // Try teachers in turn; the offering's own clash check refuses anyone already teaching at that time
      for (let i = 0; i < pool.length; i++) {
        try {
          await registrar.createOffering(0, { course_id: courseId.id, semester_id: s263, section: `42_${letter}`, teacher_id: pool[(ci * 3 + k + i) % pool.length], capacity, slots });
          return;
        } catch { /* teacher busy at that time: try the next one */ }
      }
      await registrar.createOffering(0, { course_id: courseId.id, semester_id: s263, section: `42_${letter}`, teacher_id: null, capacity, slots });
    });
  });
}

// ================= Phase 5: Admission =================
{
  const { admission } = await import("../modules/index.ts");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const adm = await mk("ADS-0001", "Tahsin Ara", [{ role: "admissions_officer" }], "01711223344");
  const s271 = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, due_date) VALUES ('271', 'Spring 2027', '2027-01-10', '2027-04-30', 'upcoming', '2027-02-20')");
  const cyc = await admission.createCycle(adm, {
    name: "Spring 2027 undergraduate", intake_semester_id: s271, deadline: "2026-12-20", test_date: "2026-10-10",
    docs: ["SSC certificate", "HSC certificate", "NID or birth certificate", "Passport-size photo"], fields: ["Quota category"], seats: { [pCse]: 2, [pSwe]: 2 },
  });
  mkdirSync("data/uploads", { recursive: true });
  const fakeFile = async (by: number, name: string) => {
    const path = `data/uploads/seed-${by}-${name.replace(/\W+/g, "-")}.pdf`;
    writeFileSync(path, "%PDF-1.4\n% synthetic seed document\n");
    return await insert("INSERT INTO files (path, name, type, size, uploaded_by) VALUES (?,?,?,?,?)", path, `${name}.pdf`, "application/pdf", 40, by);
  };
  type P = { name: string; email: string; phone: string; program: number; score?: number; hsc: string; stage: string };
  const people: P[] = [
    { name: "Rahim Uddin", email: "rahim.uddin@example.com", phone: "01811000001", program: pCse, score: 82, hsc: "5.00", stage: "paid" },
    { name: "Tasnim Haque", email: "tasnim.haque@example.com", phone: "01811000002", program: pCse, score: 78.5, hsc: "4.83", stage: "selected" },
    { name: "Arnob Saha", email: "arnob.saha@example.com", phone: "01811000003", program: pCse, score: 71, hsc: "4.67", stage: "waitlisted" },
    { name: "Mim Akter", email: "mim.akter@example.com", phone: "01811000004", program: pSwe, score: 74, hsc: "4.50", stage: "accepted" },
    { name: "Sabbir Rahman", email: "sabbir.rahman@example.com", phone: "01811000005", program: pCse, hsc: "4.25", stage: "review" },
    { name: "Ishrat Jahan", email: "ishrat.jahan@example.com", phone: "01811000006", program: pSwe, hsc: "4.92", stage: "submitted" },
    { name: "Fahim Kabir", email: "fahim.kabir@example.com", phone: "01811000007", program: pCse, hsc: "4.10", stage: "draft" },
  ];
  const cycleRow = (await admission.cycle(cyc))!;
  const apps = await each(people, async (p, i) => {
    const code = await admission.signup({ name: p.name, email: p.email, phone: p.phone, password: pw });
    await admission.verify(p.email, code);
    const uid = (await get<{ id: number }>("SELECT id FROM users WHERE email = ?", p.email))!.id;
    const data = { nid: `19${99 + i}2690${String(1000000 + i * 7331).slice(-7)}`, dob: `200${6 + (i % 3)}-0${1 + (i % 9)}-1${i}`, ssc_gpa: "5.00", hsc_gpa: p.hsc,
      guardian: `Guardian of ${p.name.split(" ")[0]}, 0171100000${i}`, address: ["Mirpur 10, Dhaka", "Uttara Sector 7, Dhaka", "Dhanmondi 27, Dhaka", "Savar, Dhaka"][i % 4], "Quota category": "None" };
    const id = await admission.saveApplication(uid, cyc, p.program, data, false);
    for (const d of JSON.parse(cycleRow.docs_json) as string[]) await admission.uploadDoc(uid, id, d, await fakeFile(uid, d));
    if (p.stage !== "draft") await admission.saveApplication(uid, cyc, p.program, data, true);
    return { ...p, id, uid };
  });
  // Application fees: two at the counter, the rest online
  for (const a of apps.filter((a) => !["draft", "submitted"].includes(a.stage)))
    await accounts.recordPayment(a.id % 2 ? cashierId : null, { applicationId: a.id, amount: 1200, method: a.id % 2 ? "cash" : "bKash", channel: a.id % 2 ? "counter" : "online", reference: a.id % 2 ? undefined : `APPFEE${a.id}` });
  // Review: verify documents, one flagged
  for (const a of apps.filter((a) => !["draft", "submitted"].includes(a.stage))) {
    for (const d of (await admission.docs(a.id))) await admission.reviewDoc(adm, d.id, !(a.stage === "review" && d.name === "HSC certificate"), a.stage === "review" && d.name === "HSC certificate" ? "Scan is cut off at the bottom; the result table is not readable." : "");
    if (a.stage !== "review") await admission.decide(adm, a.id, true, "");
  }
  await admission.scheduleTests(adm, cyc, "2026-10-10", "10:00", ["AB4-501", "AB4-502"], 40);
  await admission.enterScores(adm, Object.fromEntries(apps.filter((a) => a.score).map((a) => [a.id, a.score!])));
  await admission.rankMerit(adm, cyc);
  await admission.publishResults(adm, cyc);
  for (const a of apps.filter((a) => a.stage === "paid" || a.stage === "accepted")) await admission.respondToOffer(a.uid, a.id, true);
  const rahim = apps[0];
  await accounts.recordPayment(null, { applicationId: rahim.id, amount: (await accounts.applicationAccount(rahim.id)).due, method: "Nagad", channel: "online", reference: `ADM${rahim.id}` });
}

// ================= Phase 6: Transport =================
{
  const { transport } = await import("../modules/index.ts");
  const trOfficer = await mk("TRO-0001", "Kamal Uddin", [{ role: "transport_officer" }], "01713493050");
  const crewIds: Record<string, number> = {};
  for (const [name, kind, phone, lic, exp] of [
    ["Abdul Karim", "driver", "01715000001", "DK-0412-2019", "2027-03-31"], ["Rashed Mia", "assistant", "01715000002", "", ""],
    ["Mofizur Rahman", "driver", "01715000003", "DK-7781-2016", "2026-10-15"], ["Jewel Hossain", "assistant", "01715000004", "", ""],
    ["Nurul Islam", "driver", "01715000005", "DK-2290-2021", "2028-01-20"],
  ] as const) {
    const uni = await transport.addCrew(trOfficer, { name, kind, phone, email: `${name.toLowerCase().replace(/\W+/g, ".")}@diu.edu.bd`, licence_no: lic, licence_expiry: exp, password: pw });
    crewIds[name] = (await get<{ id: number }>("SELECT c.id FROM crew c JOIN users u ON u.id = c.user_id WHERE u.uni_id = ?", uni))!.id;
  }
  const route = async (number: string, name: string, km: number, fee: number, ret: string, stops: [string, string, string][]) => {
    const id = await transport.saveRoute(trOfficer, { number, name, distance_km: km, fee, return_time: ret, active: 1 });
    for (const [n, p, d] of stops) await transport.addStop(trOfficer, id, { name: n, pickup_time: p, drop_time: d });
    return id;
  };
  const r05 = await route("05", "Mirpur – Campus", 24, 6000, "16:30", [["Mirpur 10", "07:00", "17:40"], ["Mirpur 2", "07:10", "17:30"], ["Agargaon", "07:25", "17:15"], ["Campus", "07:45", "16:30"]]);
  const r03 = await route("03", "Uttara – Campus", 21, 5500, "16:30", [["Uttara Sector 7", "06:50", "17:35"], ["Airport", "07:05", "17:20"], ["Abdullahpur", "07:15", "17:10"], ["Campus", "07:50", "16:30"]]);
  const r08 = await route("08", "Dhanmondi – Campus", 29, 6500, "16:45", [["Dhanmondi 27", "06:40", "18:00"], ["Kalabagan", "06:50", "17:50"], ["Shyamoli", "07:05", "17:35"], ["Gabtoli", "07:15", "17:25"], ["Campus", "07:45", "16:45"]]);
  const bus = async (number: string, reg: string, cap: number, routeId: number | null, d: string | null, a: string | null, fit: string, ins: string, status = "active") =>
    await transport.saveBus(trOfficer, { number, registration: reg, capacity: cap, status, route_id: routeId, driver_id: d ? crewIds[d] : null, assistant_id: a ? crewIds[a] : null, fitness_expiry: fit, insurance_expiry: ins });
  await bus("12", "Dhaka Metro-Ba 11-4521", 40, r05, "Abdul Karim", "Rashed Mia", "2026-10-12", "2027-06-30");
  await bus("07", "Dhaka Metro-Ba 14-0833", 40, r03, "Mofizur Rahman", "Jewel Hossain", "2027-02-28", "2027-02-28");
  await bus("15", "Dhaka Metro-Ba 15-7710", 30, r08, "Nurul Islam", null, "2027-05-31", "2026-10-20");
  await bus("21", "Dhaka Metro-Ba 11-9002", 40, null, null, null, "2026-12-31", "2026-12-31", "maintenance");

  // Passes: active, awaiting payment, waiting approval
  const stopOf = async (routeId: number, name: string) => (await transport.stops(routeId)).find((s) => s.name === name)!.id;
  const passFor = async (i: number, routeId: number, stop: string) => await transport.applyPass((await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", students[i]))!.user_id, students[i], routeId, await stopOf(routeId, stop));
  const pAsad = await passFor(0, r05, "Mirpur 10");
  const pNafisa = await passFor(1, r05, "Agargaon");
  const pRifat = await passFor(2, r03, "Airport");
  await passFor(3, r08, "Shyamoli");
  for (const p of [pAsad, pNafisa, pRifat]) await transport.decidePass(trOfficer, p, true, "");
  for (const i of [0, 1]) await accounts.recordPayment(null, { studentId: students[i], amount: (await accounts.summary(students[i])).due, method: "bKash", channel: "online", reference: `TRNSEED${i}` });

  // Trips: the last five service days completed (for on-time stats), today scheduled with a live delay
  const day = (offset: number) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  for (let o = -7; o <= 0; o++) {
    try { await transport.generateTrips(trOfficer, day(o)); } catch { /* Friday or holiday */ }
  }
  await run("UPDATE trips SET status = 'completed', started_at = date || ' ' || CASE WHEN id % 5 = 0 THEN '01:12:00' ELSE '00:58:00' END, ended_at = date || ' ' || '02:00:00' WHERE date < ?", day(0));
  const morning = await get<{ id: number }>("SELECT id FROM trips WHERE route_id = ? AND date = ? AND direction = 'to_campus'", r05, day(0));
  if (morning) {
    const karim = (await get<{ user_id: number }>("SELECT user_id FROM crew WHERE id = ?", crewIds["Abdul Karim"]))!.user_id;
    await transport.report(karim, morning.id, "delay", "Heavy traffic at Mirpur 10 roundabout.", 15, null);
  }
}


// ================= Phase 7 =================
{
  const { comms, services, finance, transport } = await import("../modules/index.ts");
  const uid = async (uni: string) => (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = ?", uni))!.id;
  const stUser = async (i: number) => (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", students[i]))!.user_id;
  const s263 = (await get<{ id: number }>("SELECT id FROM semesters WHERE code = '263'"))!.id;
  const s261 = (await get<{ id: number }>("SELECT id FROM semesters WHERE code = '261'"))!.id;
  const off = async (code: string, section = "42_E") => (await get<{ id: number }>("SELECT o.id FROM offerings o JOIN courses c ON c.id = o.course_id WHERE c.code = ? AND o.section = ? AND o.semester_id = ?", code, section, s263))!.id;
  const tanvir = (await get<{ id: number }>("SELECT id FROM teachers WHERE employee_id = '710001301'"))!.id;

  // Stop coordinates for live maps (approximate, Dhaka)
  const coords: Record<string, [number, number]> = {
    "Mirpur 10": [23.8069, 90.3687], "Mirpur 2": [23.8049, 90.3613], "Agargaon": [23.7786, 90.3794], "Campus": [23.8773, 90.3206],
    "Uttara Sector 7": [23.874, 90.3985], "Airport": [23.8513, 90.4086], "Abdullahpur": [23.8805, 90.4047],
    "Dhanmondi 27": [23.7561, 90.374], "Kalabagan": [23.7485, 90.3822], "Shyamoli": [23.7747, 90.3653], "Gabtoli": [23.7837, 90.3446],
  };
  for (const [name, [lat, lng]] of Object.entries(coords)) await run("UPDATE route_stops SET lat = ?, lng = ? WHERE name = ?", lat, lng, name);

  // Live bus on Route 05: the delayed morning trip is running with GPS positions and one rider boarded
  const karim = await uid("TRN-0001");
  const trip05 = await get<{ id: number }>("SELECT t.id FROM trips t JOIN routes r ON r.id = t.route_id WHERE r.number = '05' AND t.date = ? AND t.direction = 'to_campus'", today());
  if (trip05) {
    await run("UPDATE trips SET status = 'running', started_at = datetime('now', '-25 minutes') WHERE id = ?", trip05.id);
    for (const [i, [lat, lng]] of ([[23.8069, 90.3687], [23.8055, 90.3640], [23.8049, 90.3613]] as [number, number][]).entries())
      await run("INSERT INTO trip_positions (trip_id, lat, lng, speed, at) VALUES (?,?,?,?, datetime('now', ?))", trip05.id, lat, lng, 18, `-${(2 - i) * 4} minutes`);
    await transport.markBoarded(karim, trip05.id, { studentId: students[0] }, "qr");
  }

  // Result-based waiver rules (applied after the next results publish)
  const fin = await uid("FIN-0001");
  await finance.saveRule(fin, { name: "Dean's list", min_sgpa: 3.75, min_credits: 12, percent: 25, active: 1 });
  await finance.saveRule(fin, { name: "Merit", min_sgpa: 3.5, min_credits: 12, percent: 10, active: 1 });

  // Scholarship circular with an application
  const acc = await uid("ACC-0001");
  const s271 = (await get<{ id: number }>("SELECT id FROM semesters WHERE code = '271'"))!.id;
  await finance.createCircular(acc, { title: "Need-based scholarship, Spring 2027", body: "For students with family income below ৳40,000 a month and CGPA 3.00 or above. Attach an income certificate from the ward councillor.", semester_id: s271, percent: 30, deadline: "2026-11-30" });
  await finance.applyScholarship(students[3], (await get<{ id: number }>("SELECT MAX(id) AS id FROM circulars"))!.id, "My father is a school teacher and supports four of us. I have kept a CGPA above 3.4.", null);

  // Installment plan request waiting for approval
  await finance.requestInstallments(await stUser(6), students[6], 3);

  // Gateway settlements: one matched, one short-settled
  await finance.importSettlements(acc, [{ txn_id: "TXN8K2QJ4F1", amount: "40000", settled_on: "2026-09-11" }, { txn_id: "NG77310042", amount: "19650", settled_on: "2026-09-12" }], "bKash / Nagad");
  await finance.recordDeposit(acc, { deposited_on: "2026-09-10", amount: 30000, bank_ref: "DBBL-DEP-771203", note: "Counter 1" });

  // Evaluation forms: Spring closed with results, Fall open
  const exc = await uid("EXC-0001");
  await services.saveEvalForm(exc, s261, services.DEFAULT_QUESTIONS, false);
  await services.saveEvalForm(exc, s263, services.DEFAULT_QUESTIONS, true);

  // Mentors: batch 42 section E with Tanvir Ahmed; advising slots and a meeting record
  await services.assignMentors(exc, (await get<{ program_id: number }>("SELECT program_id FROM students WHERE id = ?", students[0]))!.program_id, "42", "E", tanvir);
  const tomorrow = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  await services.addSlots(tanvir, tomorrow, "14:00", 4, 20, "Room 710, AB4");
  await services.bookSlot(students[6], (await get<{ id: number }>("SELECT MIN(id) AS id FROM mentor_slots"))!.id, "Attendance and catching up in CSE221");
  await services.logMeeting(tanvir, await uid("710001301"), { student_id: students[0], date: "2026-09-15", reason: "Course load planning for Fall 2026", action: "Keep 13.5 credits; join the ICPC practice group", next_meeting: "2026-10-20", file_id: null });

  // A pending section change: CSE231 section E to section F
  const cse231f = await off("CSE231", "42_F");
  await services.submitRequest(await stUser(2), students[2], "section_change", { offering_id: await off("CSE231"), target_offering_id: cse231f, detail: "Clash with my part-time job on Saturday mornings" });

  // Service applications: a paid transcript (processing) and a certificate awaiting its fee
  await services.submitRequest(await stUser(0), students[0], "transcript", { copies: 2, detail: "Higher studies application · pickup from office" });
  await accounts.recordPayment(null, { studentId: students[0], amount: (await accounts.summary(students[0])).due, method: "bKash", channel: "online", reference: "SEEDTRANSCRIPT" });
  await services.submitRequest(await stUser(1), students[1], "certificate", { copies: 1, detail: "Bank loan · courier" });

  // Mid-term schedule, seat plans and a question paper
  const dates = ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"];
  await each(["CSE221", "CSE222", "CSE231", "CSE232", "CSE233"], async (c, i) => await services.scheduleExam(exc, { offering_id: await off(c), stage: "midterm", date: dates[i], start: "10:00", end: "11:30" }));
  await services.generateSeatPlans(exc, s263, "midterm", ["AB4-501", "AB4-502"]);
  {
    const head = await uid("710001234");
    const path = "data/uploads/seed-question-cse221-mid.pdf";
    (await import("node:fs")).writeFileSync(path, "%PDF-1.4\n% synthetic question paper\n");
    const fileId = await insert("INSERT INTO files (path, name, type, size, uploaded_by) VALUES (?,?,?,?,?)", path, "CSE221-midterm.pdf", "application/pdf", 40, head);
    await services.uploadPaper(head, (await get<{ id: number }>("SELECT x.id FROM exams x WHERE x.offering_id = ? AND x.stage = 'midterm'", await off("CSE221")))!.id, fileId);
  }

  // TA: the department head lets a senior student take attendance in CSE221
  await comms.delegate(await uid("710001234"), await off("CSE221"), "253-15-0002", "attendance", 30);

  // Help desk: an open facility issue, a transport complaint in progress, a resolved fees question
  const t1 = await comms.createTicket(await stUser(0), { category: "Facility issue (classroom, lab, Wi-Fi)", subject: "Projector in AB4-501 flickers", body: "The projector in AB4-501 flickers every few minutes during the 8:30 class. It has been like this all week." });
  const t2 = await comms.createTicket(await stUser(1), { category: "Transport complaint", subject: "Route 05 left Agargaon early", body: "On Tuesday the bus left Agargaon at 7:20 instead of 7:25 and three of us missed it." });
  await comms.replyTicket(await uid("TRO-0001"), t2, "Thanks for reporting. We have spoken to the driver; the bus will wait until the scheduled time. Please tell us if it happens again.", false, null, "staff");
  const t3 = await comms.createTicket(await stUser(4), { category: "Fees or payment issue", subject: "Cheque payment not showing", body: "I paid by cheque (DBBL 004512) but want to confirm it has cleared." });
  await comms.replyTicket(acc, t3, "Your cheque cleared and is on your ledger as receipt R2026-000017.", false, null, "staff");
  await comms.setTicketStatus(acc, t3, "resolved");
  await run("UPDATE tickets SET at = datetime('now', '-3 days'), sla_due = datetime('now', '-4 hours') WHERE id = ?", t1);

  // Messages: a direct thread and the CSE221 class conversation
  const th = await comms.startThread(await stUser(0), [await uid("710001301")], "Question about CSE231 assignment 1", "Sir, should the ER diagram in assignment 1 include the weak entities?");
  await comms.postMessage(await uid("710001301"), th, "Yes, include them and mark the identifying relationships. Keep it to one page.");
  const cls = await comms.sectionThread(await off("CSE221"));
  await comms.postMessage(await uid("710001234"), cls, "Reminder: Quiz 2 on Monday covers divide and conquer and recurrences.");
  await comms.postMessage(await stUser(3), cls, "Will the master theorem be included, sir?");
  await comms.postMessage(await uid("710001234"), cls, "Yes, cases 1 to 3.");

  await run("UPDATE outbox SET at = datetime('now', '-1 hour')");
}

const n = (await all("SELECT id FROM users")).length;
console.log(`Seeded ${n} users. Password for every account: ${pw}`);
