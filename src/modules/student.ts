// M2 Student: enrollments, results publication, evaluations, grade changes.
import { all, get, run, insert, audit, tx, num, keep } from "../lib/db.ts";
import { clash, gpa, grade, registrationProblems } from "../lib/rules.ts";
import { notify } from "./core.ts";
import { emit, on } from "./events.ts";
import { offering, semester, slotsFor } from "./registrar.ts";
import { gradeSheet, gradesheetsByStatus, markPublished } from "./teacher.ts";

export type EnrollmentRow = { id: number; offering_id: number; status: string; type: string; code: string; title: string; credits: number;
  section: string; course_id: number; teacher: string | null; semester_id: number; course_type: string };
export const enrollments = async (studentId: number, semesterId: number, statuses = ["confirmed", "waitlisted", "completed"]) =>
  await all<EnrollmentRow>(`SELECT e.id, e.offering_id, e.status, e.type, c.code, c.title, c.credits, c.type AS course_type, o.section, o.course_id, o.semester_id,
    u.name AS teacher FROM enrollments e JOIN offerings o ON o.id = e.offering_id JOIN courses c ON c.id = o.course_id
    LEFT JOIN teachers t ON t.id = o.teacher_id LEFT JOIN users u ON u.id = t.user_id
    WHERE e.student_id = ? AND o.semester_id = ? AND e.status IN (${statuses.map(() => "?").join(",")}) ORDER BY c.code`, studentId, semesterId, ...statuses);

const passedCourseIds = async (studentId: number) => new Set((await latestResults(studentId)).filter((r) => r.letter !== "F").map((r) => r.course_id));

// STU-U-3 registration checks
export async function checkRegistration(studentId: number, offeringId: number) {
  const o = (await offering(offeringId))!;
  const sem = (await semester(o.semester_id))!;
  const mine = await enrollments(studentId, o.semester_id, ["confirmed", "waitlisted"]);
  const passed = await passedCourseIds(studentId);
  const missing = (await all<{ id: number; code: string }>("SELECT c.id, c.code FROM course_prereqs p JOIN courses c ON c.id = p.prereq_id WHERE p.course_id = ?", o.course_id))
    .filter((p) => !passed.has(p.id)).map((p) => p.code);
  const mySlots = await slotsFor(mine.map((m) => m.offering_id));
  const clashes = (await slotsFor([offeringId])).flatMap((s) => mySlots.filter((m) => clash(m, s)).map((m) => mine.find((x) => x.offering_id === m.offering_id)!.code));
  const credits = mine.filter((m) => m.status === "confirmed").reduce((s, m) => s + m.credits, 0) + o.credits;
  const problems = registrationProblems({ windowOpen: !!sem.reg_open, missingPrereqs: missing, creditsAfter: credits, maxCredits: await num("max_credits", 21),
    clashesWith: [...new Set(clashes)], alreadyTaken: mine.some((m) => m.course_id === o.course_id) });
  // A passed course is not taken again through registration; improvement goes through Applications & services.
  if (passed.has(o.course_id)) problems.unshift("Already completed. To improve the grade, apply under Applications & services");
  return problems;
}

export async function register(by: number, studentId: number, offeringId: number) {
  return await tx(async () => {
    const problems = await checkRegistration(studentId, offeringId);
    if (problems.length) throw new Error(problems.join(". "));
    const o = (await offering(offeringId))!;
    const type = await get("SELECT 1 FROM results r JOIN offerings x ON x.id = r.offering_id WHERE r.student_id = ? AND x.course_id = ?", studentId, o.course_id) ? "retake" : "regular";
    const status = o.enrolled >= o.capacity ? "waitlisted" : "confirmed";
    await insert("INSERT INTO enrollments (student_id, offering_id, type, status, by_user) VALUES (?,?,?,?,?)", studentId, offeringId, type, status, by);
    await audit(by, "register", "enrollment", offeringId, undefined, { studentId, status });
    if (status === "confirmed") await emit("enrollment.confirmed", { studentId, offeringId, by });
    return status;
  });
}

// STU-A-2 overrides
export async function forceEnroll(by: number, studentId: number, offeringId: number, reason: string) {
  if (!reason) throw new Error("A reason is required for an override.");
  return await tx(async () => {
    if ((await get("SELECT 1 FROM enrollments WHERE student_id = ? AND offering_id = ? AND status IN ('confirmed','waitlisted')", studentId, offeringId)))
      throw new Error("Already enrolled in this section.");
    await insert("INSERT INTO enrollments (student_id, offering_id, status, reason, by_user) VALUES (?,?,'confirmed',?,?)", studentId, offeringId, reason, by);
    await audit(by, "force_enroll", "enrollment", offeringId, undefined, { studentId, reason });
    await emit("enrollment.confirmed", { studentId, offeringId, by });
  });
}

export async function drop(by: number, enrollmentId: number, reason: string) {
  if (!reason) throw new Error("A reason is required to drop.");
  return await tx(async () => {
    const e = await get<{ student_id: number; offering_id: number; status: string }>("SELECT * FROM enrollments WHERE id = ?", enrollmentId);
    if (!e || !["confirmed", "waitlisted"].includes(e.status)) throw new Error("Enrollment is not active.");
    await run("UPDATE enrollments SET status = 'dropped', reason = ?, by_user = ? WHERE id = ?", reason, by, enrollmentId);
    await audit(by, "drop", "enrollment", enrollmentId, e.status, { reason });
    if (e.status !== "confirmed") return;
    await emit("enrollment.dropped", { studentId: e.student_id, offeringId: e.offering_id, by });
    // Promote the first waitlisted student
    const w = await get<{ id: number; student_id: number }>("SELECT id, student_id FROM enrollments WHERE offering_id = ? AND status = 'waitlisted' ORDER BY id LIMIT 1", e.offering_id);
    if (w) {
      await run("UPDATE enrollments SET status = 'confirmed' WHERE id = ?", w.id);
      await emit("enrollment.confirmed", { studentId: w.student_id, offeringId: e.offering_id, by });
      const u = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", w.student_id))!;
      await notify([u.user_id], "Waitlist: you're in", `A seat opened in ${(await offering(e.offering_id))?.code} and you are now registered.`, "/app/register");
    }
  });
}

export async function prereqStatus(studentId: number, courseId: number, semesterId: number) {
  const done = new Map((await latestResults(studentId)).map((r) => [r.course_id, r]));
  const now = new Set((await enrollments(studentId, semesterId, ["confirmed"])).map((e) => e.course_id));
  return (await all<{ id: number; code: string; title: string }>(
    "SELECT c.id, c.code, c.title FROM course_prereqs p JOIN courses c ON c.id = p.prereq_id WHERE p.course_id = ? ORDER BY c.code", courseId))
    .map((p) => {
      const r = done.get(p.id);
      const status = r && r.letter !== "F" ? "completed" : now.has(p.id) ? "in_progress" : "missing";
      return { ...p, status, letter: r?.letter ?? null } as { id: number; code: string; title: string; status: "completed" | "in_progress" | "missing"; letter: string | null };
    });
}

// ---------- Results (STU-A-4, STU-U-10)
export type ResultRow = { id: number; offering_id: number; course_id: number; code: string; title: string; credits: number; total_c: number; letter: string;
  gp_c: number; semester_id: number; semester: string; semester_name: string; at: string };
const RESULT_SQL = `SELECT r.id, r.offering_id, o.course_id, c.code, c.title, c.credits, r.total_c, r.letter, r.gp_c, o.semester_id, sm.code AS semester,
  sm.name AS semester_name, r.at FROM results r JOIN offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
  JOIN semesters sm ON sm.id = o.semester_id WHERE r.student_id = ? AND r.id = (SELECT MAX(id) FROM results r2 WHERE r2.student_id = r.student_id AND r2.offering_id = r.offering_id)`;
export const results = async (studentId: number) => await all<ResultRow>(`${RESULT_SQL} ORDER BY sm.code, c.code`, studentId);

// Latest attempt per course counts toward CGPA (spec §14.2 open question; "latest replaces").
export async function latestResults(studentId: number, uptoSemesterCode = "999") {
  const byCourse = new Map<number, ResultRow>();
  for (const r of (await results(studentId))) if (r.semester <= uptoSemesterCode) byCourse.set(r.course_id, r);
  return [...byCourse.values()];
}

export async function transcript(studentId: number) {
  const all = await results(studentId);
  const sems = [...new Map(all.map((r) => [r.semester, r])).values()];
  return await Promise.all(sems.map(async (s) => {
    const rows = all.filter((r) => r.semester === s.semester);
    const latest = await latestResults(studentId, s.semester);
    return {
      semester_id: s.semester_id, semester: s.semester, name: s.semester_name, rows,
      credits: rows.reduce((t, r) => t + r.credits, 0),
      sgpa: gpa(rows.map((r) => ({ credits: r.credits, gp: r.gp_c / 100 }))),
      cgpa: gpa(latest.map((r) => ({ credits: r.credits, gp: r.gp_c / 100 }))),
    };
  }));
}
export const creditsEarned = async (studentId: number) => (await latestResults(studentId)).filter((r) => r.letter !== "F").reduce((s, r) => s + r.credits, 0);

export async function publishResults(by: number, semesterId: number) {
  return await tx(async () => {
    const sheets = await gradesheetsByStatus("dept-approved", { semesterId });
    if (!sheets.length) throw new Error("No department-approved grade sheets to publish.");
    const studentIds = new Set<number>();
    for (const s of sheets) {
      for (const r of (await gradeSheet(s.offering_id)).rows) {
        await insert("INSERT INTO results (student_id, offering_id, total_c, letter, gp_c, by_user) VALUES (?,?,?,?,?,?)",
          r.student_id, s.offering_id, Math.round(r.total * 100), r.letter, Math.round(r.gp * 100), by);
        await run("UPDATE enrollments SET status = 'completed' WHERE student_id = ? AND offering_id = ? AND status = 'confirmed'", r.student_id, s.offering_id);
        studentIds.add(r.student_id);
      }
      await markPublished(s.offering_id);
    }
    await audit(by, "publish", "results", semesterId, undefined, { sheets: sheets.length });
    await emit("result.published", { semesterId, studentIds: [...studentIds], by });
    return sheets.length;
  });
}

// STU-A-5 grade change: requester cannot approve; approval appends a new result row.
export async function requestGradeChange(by: number, offeringId: number, studentId: number, newTotal: number, reason: string) {
  const cur = await get<{ total_c: number }>("SELECT total_c FROM results WHERE student_id = ? AND offering_id = ? ORDER BY id DESC LIMIT 1", studentId, offeringId);
  if (!cur) throw new Error("No published result for this student in this section.");
  if (!reason) throw new Error("A reason is required.");
  if (!(newTotal >= 0 && newTotal <= 100)) throw new Error("Total must be between 0 and 100.");
  const id = await insert("INSERT INTO grade_changes (offering_id, student_id, old_total_c, new_total_c, reason, requested_by) VALUES (?,?,?,?,?,?)",
    offeringId, studentId, cur.total_c, Math.round(newTotal * 100), reason, by);
  await audit(by, "request", "grade_change", id, cur.total_c, newTotal);
}
export async function decideGradeChange(by: number, id: number, approve: boolean) {
  await tx(async () => {
    const g = await get<{ offering_id: number; student_id: number; new_total_c: number; requested_by: number; status: string; reason: string }>("SELECT * FROM grade_changes WHERE id = ?", id);
    if (!g || g.status !== "pending") throw new Error("Request is not pending.");
    if (g.requested_by === by) throw new Error("You cannot approve your own request.");
    await run("UPDATE grade_changes SET status = ?, decided_by = ? WHERE id = ?", approve ? "approved" : "rejected", by, id);
    if (approve) {
      const gr = grade(g.new_total_c / 100);
      await insert("INSERT INTO results (student_id, offering_id, total_c, letter, gp_c, reason, by_user) VALUES (?,?,?,?,?,?,?)",
        g.student_id, g.offering_id, g.new_total_c, gr.letter, Math.round(gr.gp * 100), `Grade change #${id}: ${g.reason}`, by);
      const u = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", g.student_id))!;
      await notify([u.user_id], "Grade updated", `A grade change was approved for ${(await offering(g.offering_id))?.code}.`, "/app/results");
    }
    await audit(by, approve ? "approve" : "reject", "grade_change", id);
  });
}
export const gradeChanges = async (status = "pending") => await all<{ id: number; code: string; section: string; student: string; student_code: string;
  old_total_c: number; new_total_c: number; reason: string; by_name: string; at: string; requested_by: number }>(
  `SELECT g.*, c.code, o.section, u.name AS student, s.student_id AS student_code, bu.name AS by_name FROM grade_changes g
   JOIN offerings o ON o.id = g.offering_id JOIN courses c ON c.id = o.course_id JOIN students s ON s.id = g.student_id
   JOIN users u ON u.id = s.user_id JOIN users bu ON bu.id = g.requested_by WHERE g.status = ? ORDER BY g.at`, status);

// STU-U-11 evaluations gate the semester's results
// Evaluations gate results only while the semester's evaluation window is open (STU-A-6 opens and closes it).
export async function pendingEvaluations(studentId: number, semesterId: number) {
  if ((await get("SELECT 1 FROM eval_forms WHERE semester_id = ? AND open = 0", semesterId))) return [];
  return keep(await enrollments(studentId, semesterId, ["confirmed", "completed"]),
    async (e) => !(await get("SELECT 1 FROM evaluations WHERE student_id = ? AND offering_id = ?", studentId, e.offering_id)));
}
export async function submitEvaluation(studentId: number, offeringId: number, rating: number, comment: string, answers: Record<string, number> = {}) {
  if (!(rating >= 1 && rating <= 5)) throw new Error("Choose a rating from 1 to 5.");
  if (Object.values(answers).some((v) => !(v >= 1 && v <= 5))) throw new Error("Answer every question from 1 to 5.");
  if (!(await get("SELECT 1 FROM enrollments WHERE student_id = ? AND offering_id = ? AND status IN ('confirmed','completed')", studentId, offeringId)))
    throw new Error("You are not enrolled in this section.");
  await run("INSERT OR IGNORE INTO evaluations (student_id, offering_id, rating, comment, answers_json) VALUES (?,?,?,?,?)", studentId, offeringId, rating, comment || null, JSON.stringify(answers));
}

// REG-A-8 historical results, called by the registrar import
export async function importResult(by: number, r: Record<string, string>, line: string) {
  const st = await get<{ id: number }>("SELECT id FROM students WHERE student_id = ?", r.student_id);
  const c = await get<{ id: number }>("SELECT id FROM courses WHERE code = ?", r.course);
  const sm = await get<{ id: number }>("SELECT id FROM semesters WHERE code = ?", r.semester);
  const total = Number(r.total);
  if (!st || !c || !sm || Number.isNaN(total)) throw new Error(`${line}: unknown student, course, semester or bad total`);
  const section = r.section || "IMP";
  let off = await get<{ id: number }>("SELECT id FROM offerings WHERE course_id = ? AND semester_id = ? AND section = ?", c.id, sm.id, section);
  if (!off) {
    off = { id: await insert("INSERT INTO offerings (course_id, semester_id, section, capacity) VALUES (?,?,?,0)", c.id, sm.id, section) };
    await run("INSERT INTO gradesheets (offering_id, status, published_at) VALUES (?, 'published', datetime('now'))", off.id);
  }
  await insert("INSERT INTO enrollments (student_id, offering_id, status, reason, by_user) VALUES (?,?,'completed','Imported',?)", st.id, off.id, by);
  const g = grade(total);
  await insert("INSERT INTO results (student_id, offering_id, total_c, letter, gp_c, reason, by_user) VALUES (?,?,?,?,?,'Imported',?)",
    st.id, off.id, Math.round(total * 100), g.letter, Math.round(g.gp * 100), by);
}

on("result.published", async ({ studentIds, semesterId }) => {
  const users = await Promise.all(studentIds.map(async (id) => (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", id))!.user_id));
  await notify(users, `Results published: ${(await semester(semesterId))?.name}`, "Submit your course evaluations to unlock them.", "/app/results");
});
