// M1 Admission & Registrar: academic master data, offerings, student records.
import { all, get, run, insert, audit, tx } from "../lib/db.ts";
import { clash } from "../lib/rules.ts";
import { createUser, notify } from "./core.ts";
import { emit } from "./events.ts";
import { importResult } from "./student.ts";

export type Semester = { id: number; code: string; name: string; start_date: string; end_date: string; status: string;
  reg_open: number; adddrop_open: number; withdraw_open: number; due_date: string | null };

export const semesters = async () => await all<Semester>("SELECT * FROM semesters ORDER BY code DESC");
export const currentSemester = async () =>
  await get<Semester>("SELECT * FROM semesters WHERE status = 'active' ORDER BY code DESC LIMIT 1") ?? (await semesters())[0];
export const semester = async (id: number) => await get<Semester>("SELECT * FROM semesters WHERE id = ?", id);

export const studentByUser = async (userId: number) => await get<StudentRow>(`${STUDENT_SQL} WHERE s.user_id = ?`, userId);
export const studentById = async (id: number) => await get<StudentRow>(`${STUDENT_SQL} WHERE s.id = ?`, id);
export const teacherByUser = async (userId: number) =>
  await get<{ id: number; employee_id: string; dept_id: number; designation: string; name: string }>(
    "SELECT t.*, u.name FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.user_id = ?", userId);

const STUDENT_SQL = `SELECT s.*, u.name, u.email, u.phone, u.blood_group, u.emergency_contact, p.name AS program, p.total_credits,
  p.dept_id, d.short AS dept FROM students s JOIN users u ON u.id = s.user_id JOIN programs p ON p.id = s.program_id
  JOIN departments d ON d.id = p.dept_id`;
export type StudentRow = { id: number; user_id: number; student_id: string; reg_id: string; program_id: number; batch: string; section: string;
  status: string; name: string; email: string; phone: string | null; blood_group: string | null; emergency_contact: string | null;
  program: string; total_credits: number; dept_id: number; dept: string };

export async function searchStudents(q: string) {
  const like = `%${q}%`;
  return await all<StudentRow>(`${STUDENT_SQL} WHERE s.student_id LIKE ? OR u.name LIKE ? OR s.reg_id LIKE ? ORDER BY s.student_id LIMIT 50`, like, like, like);
}

// Offerings with schedule text
export type Offering = { id: number; course_id: number; code: string; title: string; credits: number; type: string; section: string;
  semester_id: number; semester: string; capacity: number; teacher_id: number | null; teacher: string | null; proposed: string | null;
  proposed_teacher_id: number | null; enrolled: number; dept_id: number; teacher_designation: string | null; teacher_email: string | null };
const OFFERING_SQL = `SELECT o.id, o.course_id, c.code, c.title, c.credits, c.type, o.section, o.semester_id, sm.code AS semester, o.capacity,
  o.teacher_id, tu.name AS teacher, t.designation AS teacher_designation, tu.email AS teacher_email, o.proposed_teacher_id, pu.name AS proposed, c.dept_id,
  (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = o.id AND e.status = 'confirmed') AS enrolled
  FROM offerings o JOIN courses c ON c.id = o.course_id JOIN semesters sm ON sm.id = o.semester_id
  LEFT JOIN teachers t ON t.id = o.teacher_id LEFT JOIN users tu ON tu.id = t.user_id
  LEFT JOIN teachers pt ON pt.id = o.proposed_teacher_id LEFT JOIN users pu ON pu.id = pt.user_id`;
export const offerings = async (semesterId: number) => await all<Offering>(`${OFFERING_SQL} WHERE o.semester_id = ? ORDER BY c.code, o.section`, semesterId);
export const offering = async (id: number) => await get<Offering>(`${OFFERING_SQL} WHERE o.id = ?`, id);
export const teacherOfferings = async (teacherId: number, semesterId: number) =>
  await all<Offering>(`${OFFERING_SQL} WHERE o.teacher_id = ? AND o.semester_id = ? ORDER BY c.code`, teacherId, semesterId);

export type SlotRow = { offering_id: number; slot_id: number; room_id: number; day: string; start: string; end: string; room: string };
export const DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"];
export async function slotsFor(offeringIds: number[]) {
  if (!offeringIds.length) return [];
  return (await all<SlotRow>(`SELECT os.offering_id, os.slot_id, os.room_id, ts.day, ts.start, ts."end", r.number AS room FROM offering_slots os
    JOIN time_slots ts ON ts.id = os.slot_id JOIN rooms r ON r.id = os.room_id
    WHERE os.offering_id IN (${offeringIds.map(() => "?").join(",")})`, ...offeringIds))
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start.localeCompare(b.start));
}
export const scheduleText = (slots: SlotRow[]) => slots.map((s) => `${s.day} ${s.start}–${s.end} · ${s.room}`).join("; ");

// REG-A-1 master data
export async function addCourse(by: number, c: { dept_id: number; code: string; title: string; credits: number; type: string; prereqs: string[] }) {
  return await tx(async () => {
    const id = await insert("INSERT INTO courses (dept_id, code, title, credits, type) VALUES (?,?,?,?,?)", c.dept_id, c.code.toUpperCase(), c.title, c.credits, c.type);
    for (const p of c.prereqs) {
      const pr = await get<{ id: number }>("SELECT id FROM courses WHERE code = ?", p.toUpperCase());
      if (!pr) throw new Error(`Unknown prerequisite ${p}`);
      await run("INSERT INTO course_prereqs VALUES (?,?)", id, pr.id);
    }
    await audit(by, "create", "course", id, undefined, c);
    return id;
  });
}

// REG-A-4 offerings with clash detection (room, teacher, section)
export async function offeringClashes(semesterId: number, section: string, teacherId: number | null, slots: { slot_id: number; room_id: number }[], ignoreOfferingId = 0) {
  const existing = await all<SlotRow & { section: string; teacher_id: number | null; code: string }>(
    `SELECT os.offering_id, os.slot_id, os.room_id, ts.day, ts.start, ts."end", r.number AS room, o.section, o.teacher_id, c.code
     FROM offering_slots os JOIN offerings o ON o.id = os.offering_id JOIN time_slots ts ON ts.id = os.slot_id
     JOIN rooms r ON r.id = os.room_id JOIN courses c ON c.id = o.course_id WHERE o.semester_id = ? AND o.id != ?`, semesterId, ignoreOfferingId);
  const problems: string[] = [];
  for (const s of slots) {
    const ts = (await get<{ day: string; start: string; end: string }>('SELECT day, start, "end" FROM time_slots WHERE id = ?', s.slot_id))!;
    for (const e of existing.filter((e) => clash(e, ts))) {
      const where = `${e.code} ${e.section} (${e.day} ${e.start})`;
      if (e.room_id === s.room_id) problems.push(`Room ${e.room} already used by ${where}`);
      if (teacherId && e.teacher_id === teacherId) problems.push(`Teacher already teaching ${where}`);
      if (e.section === section) problems.push(`Section ${section} already has ${where}`);
    }
  }
  return [...new Set(problems)];
}

export async function createOffering(by: number, o: { course_id: number; semester_id: number; section: string; teacher_id: number | null; capacity: number;
  slots: { slot_id: number; room_id: number }[] }) {
  const problems = await offeringClashes(o.semester_id, o.section, o.teacher_id, o.slots);
  if (problems.length) throw new Error(problems.join(". "));
  return await tx(async () => {
    const id = await insert("INSERT INTO offerings (course_id, semester_id, section, teacher_id, capacity) VALUES (?,?,?,?,?)",
      o.course_id, o.semester_id, o.section, o.teacher_id, o.capacity);
    for (const s of o.slots) await run("INSERT INTO offering_slots VALUES (?,?,?)", id, s.slot_id, s.room_id);
    await run("INSERT INTO gradesheets (offering_id) VALUES (?)", id);
    await audit(by, "create", "offering", id, undefined, o);
    return id;
  });
}

export async function assignTeacher(by: number, offeringId: number, teacherId: number | null) {
  const o = (await offering(offeringId))!;
  if (teacherId) {
    const slots = (await slotsFor([offeringId])).map((s) => ({ slot_id: s.slot_id, room_id: s.room_id }));
    const p = await offeringClashes(o.semester_id, "\u0000", teacherId, slots, offeringId);
    if (p.length) throw new Error(p.join(". "));
  }
  await run("UPDATE offerings SET teacher_id = ?, proposed_teacher_id = NULL WHERE id = ?", teacherId, offeringId);
  await audit(by, "assign_teacher", "offering", offeringId, o.teacher_id, teacherId);
}

// TCH-A-1: department head proposes, registrar finalises
export async function proposeTeacher(by: number, offeringId: number, teacherId: number) {
  await run("UPDATE offerings SET proposed_teacher_id = ? WHERE id = ?", teacherId, offeringId);
  await audit(by, "propose_teacher", "offering", offeringId, undefined, teacherId);
}

// REG-A-3 / REG-A-5
export async function createSemester(by: number, s: { code: string; name: string; start_date: string; end_date: string; due_date: string }) {
  const id = await insert("INSERT INTO semesters (code, name, start_date, end_date, due_date) VALUES (?,?,?,?,?)", s.code, s.name, s.start_date, s.end_date, s.due_date);
  await audit(by, "create", "semester", id, undefined, s);
}
export async function setWindow(by: number, semesterId: number, field: "reg_open" | "adddrop_open" | "withdraw_open" | "status", value: string | number) {
  const before = await semester(semesterId);
  if (field === "status" && value === "active") await run("UPDATE semesters SET status = 'closed' WHERE status = 'active'");
  await run(`UPDATE semesters SET ${field} = ? WHERE id = ?`, value, semesterId);
  await audit(by, "update", "semester", semesterId, before?.[field], value);
}
export const calendar = async (semesterId: number) =>
  await all<{ id: number; type: string; title: string; start_date: string; end_date: string }>(
    "SELECT * FROM calendar_events WHERE semester_id = ? ORDER BY start_date", semesterId);

// REG-A-6: enroll a confirmed applicant as a student (publishes applicant.enrolled)
export async function enrollStudent(by: number, s: { name: string; email: string; phone: string; program_id: number; batch: string; section: string; semester_id: number; password: string;
  existingUserId?: number; applicationId?: number }) {
  return await tx(async () => {
    const prog = await get<{ code: string }>("SELECT d.code FROM programs p JOIN departments d ON d.id = p.dept_id WHERE p.id = ?", s.program_id);
    const sem = await semester(s.semester_id);
    if (!prog || !sem) throw new Error("Unknown program or semester");
    const prefix = `${sem.code}-${prog.code}-`;
    const n = ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM students WHERE student_id LIKE ?", `${prefix}%`))?.n ?? 0) + 1;
    const studentId = `${prefix}${String(n).padStart(4, "0")}`;
    let userId = s.existingUserId;
    if (userId) {
      // The applicant login becomes the student login: same password, new ID.
      await run("UPDATE users SET uni_id = ? WHERE id = ?", studentId, userId);
      await run("DELETE FROM user_roles WHERE user_id = ? AND role = 'applicant'", userId);
      await run("INSERT INTO user_roles (user_id, role) VALUES (?, 'student')", userId);
      await run("DELETE FROM sessions WHERE user_id = ?", userId);
    } else userId = await createUser({ uni_id: studentId, email: s.email, name: s.name, phone: s.phone, password: s.password }, [{ role: "student" }]);
    const id = await insert("INSERT INTO students (user_id, student_id, reg_id, program_id, batch, section, admitted_semester_id) VALUES (?,?,?,?,?,?,?)",
      userId, studentId, `REG-${studentId}`, s.program_id, s.batch, s.section, s.semester_id);
    await audit(by, "enroll", "student", id, undefined, { studentId, ...s, password: undefined });
    await emit("applicant.enrolled", { studentId: id, semesterId: s.semester_id, by, applicationId: s.applicationId });
    await notify([userId], "Welcome to DIU", s.existingUserId ? `Your student ID is ${studentId}. Sign in with it and your existing password.`
      : `Your student ID is ${studentId}. Sign in with it and change your password from Profile.`, "/app");
    return { id, studentId };
  });
}

export async function setStudentStatus(by: number, studentId: number, status: string, reason: string) {
  const before = (await studentById(studentId))?.status;
  await run("UPDATE students SET status = ? WHERE id = ?", status, studentId);
  await audit(by, "status_change", "student", studentId, before, { status, reason });
  if (status === "graduated" && before !== "graduated") await emit("student.graduated", { studentId, by });
}

// REG-A-8 bulk import (CSV, header row required)
// ponytail: naive CSV split (no quoted commas); use a CSV parser when the old portal export needs it.
export function parseCsv(text: string) {
  const [head, ...rows] = text.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split(",").map((c) => c.trim()));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.toLowerCase(), r[i] ?? ""])));
}

export async function importCsv(by: number, kind: string, text: string) {
  const rows = parseCsv(text);
  return await tx(async () => {
    for (const [i, r] of rows.entries()) {
      const line = `Row ${i + 2}`;
      const need = (k: string) => { if (!r[k]) throw new Error(`${line}: missing ${k}`); return r[k]; };
      if (kind === "courses") {
        const dept = await get<{ id: number }>("SELECT id FROM departments WHERE short = ?", need("dept"));
        if (!dept) throw new Error(`${line}: unknown dept ${r.dept}`);
        await addCourse(by, { dept_id: dept.id, code: need("code"), title: need("title"), credits: Number(need("credits")), type: r.type || "theory",
          prereqs: r.prereqs ? r.prereqs.split(";").filter(Boolean) : [] });
      } else if (kind === "teachers") {
        const dept = await get<{ id: number }>("SELECT id FROM departments WHERE short = ?", need("dept"));
        if (!dept) throw new Error(`${line}: unknown dept ${r.dept}`);
        const uid = await createUser({ uni_id: need("employee_id"), email: need("email"), name: need("name"), phone: r.phone, password: need("password") }, [{ role: "teacher" }]);
        await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?,?,?,?)", uid, r.employee_id, dept.id, r.designation || "Lecturer");
      } else if (kind === "students") {
        const prog = await get<{ id: number }>("SELECT id FROM programs WHERE name = ? OR id = ?", need("program"), Number(r.program) || 0);
        if (!prog) throw new Error(`${line}: unknown program ${r.program}`);
        const uid = await createUser({ uni_id: need("student_id"), email: need("email"), name: need("name"), phone: r.phone, password: need("password") }, [{ role: "student" }]);
        await insert("INSERT INTO students (user_id, student_id, reg_id, program_id, batch, section) VALUES (?,?,?,?,?,?)",
          uid, r.student_id, r.reg_id || `REG-${r.student_id}`, prog.id, need("batch"), need("section"));
      } else if (kind === "results") {
        await importResult(by, r, line); // M2 owns results
      } else throw new Error("Unknown import type");
    }
    await audit(by, "import", kind, rows.length);
    return rows.length;
  });
}

export const teachers = async () => await all<{ id: number; name: string; employee_id: string; dept_id: number; designation: string }>(
  "SELECT t.id, u.name, t.employee_id, t.dept_id, t.designation FROM teachers t JOIN users u ON u.id = t.user_id ORDER BY u.name");
export const departments = async () => await all<{ id: number; code: string; short: string; name: string; faculty: string; head: string | null }>(
  "SELECT d.*, f.code AS faculty, u.name AS head FROM departments d LEFT JOIN faculties f ON f.id = d.faculty_id LEFT JOIN users u ON u.id = d.head_user_id ORDER BY d.short");
export const programs = async () => await all<{ id: number; name: string; degree: string; total_credits: number; dept: string; dept_id: number }>(
  "SELECT p.*, d.short AS dept FROM programs p JOIN departments d ON d.id = p.dept_id ORDER BY p.name");
export const courses = async () => await all<{ id: number; code: string; title: string; credits: number; type: string; dept: string; prereqs: string | null }>(
  `SELECT c.*, d.short AS dept, (SELECT GROUP_CONCAT(pc.code, ', ') FROM course_prereqs cp JOIN courses pc ON pc.id = cp.prereq_id WHERE cp.course_id = c.id) AS prereqs
   FROM courses c LEFT JOIN departments d ON d.id = c.dept_id ORDER BY c.code`);
export const rooms = async () => await all<{ id: number; number: string; capacity: number; type: string }>("SELECT * FROM rooms ORDER BY number");
export const timeSlots = async () => (await all<{ id: number; day: string; start: string; end: string }>('SELECT id, day, start, "end" FROM time_slots'))
  .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start.localeCompare(b.start));
