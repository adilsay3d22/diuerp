"use server";
// Every action re-checks role and scope server-side (CORE-1). Errors come back to the page as ?err=.
import { headers } from "next/headers";
import { storeFile } from "@/lib/storage.ts";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { get, insert, run, audit, hashPassword, checkPassword, showCodes } from "@/lib/db.ts";
import { requireRole, requireUser, login, logout, switchRole, homeFor, deptScope, verifyMfa, resendMfa, type Session } from "@/lib/auth.ts";
import { core, registrar, student, teacher, accounts, admission, transport, comms, services, finance } from "@/modules/index.ts";

const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(f(fd, k));

async function done(fn: () => unknown, ok: string | (() => string), to?: () => string) {
  const ref = (await headers()).get("referer");
  let u = new URL(ref ?? "/", "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("err");
  let err: string | null = null;
  try {
    await fn();
  } catch (e) {
    err = e instanceof Error ? e.message : "Something went wrong. Try again.";
    if (/UNIQUE constraint/.test(err)) err = "That record already exists.";
  }
  if (!err && to) u = new URL(to(), "http://x"); // success can land somewhere new; errors stay on the form
  u.searchParams.set(err ? "err" : "ok", err ?? (typeof ok === "function" ? ok() : ok));
  revalidatePath("/", "layout");
  redirect(u.pathname + u.search);
}

// ---------- Identity
export async function loginAction(fd: FormData) {
  const err = await login(f(fd, "id"), f(fd, "password"));
  if (err === "MFA") redirect("/login/verify");
  if (err === "UNVERIFIED") redirect(`/apply/verify?email=${encodeURIComponent(f(fd, "id"))}`);
  if (err) redirect(`/login?err=${encodeURIComponent(err)}`);
  redirect("/");
}
export async function logoutAction() {
  await logout();
  redirect("/login");
}
export async function switchRoleAction(fd: FormData) {
  await switchRole(f(fd, "role"));
  redirect(homeFor(f(fd, "role") as core.Role));
}
export async function updateProfileAction(fd: FormData) {
  const s = await requireUser();
  return await done(async () => await core.updateProfile(s.user.id, { phone: f(fd, "phone"), emergency_contact: f(fd, "emergency_contact"), blood_group: f(fd, "blood_group") }), "Profile saved");
}
export async function changePasswordAction(fd: FormData) {
  const s = await requireUser();
  return await done(async () => {
    const u = (await get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", s.user.id))!;
    if (!checkPassword(f(fd, "current"), u.password_hash)) throw new Error("Current password is incorrect.");
    if (f(fd, "next").length < 8) throw new Error("Use at least 8 characters for the new password.");
    await run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(f(fd, "next")), s.user.id);
    await audit(s.user.id, "change_password", "user", s.user.id);
  }, "Password changed");
}
export async function readNotificationsAction() {
  const s = await requireUser();
  return await done(async () => await run("UPDATE notifications SET read = 1 WHERE user_id = ?", s.user.id), "All marked as read");
}

// ---------- Notices (CORE-10). Admins post to any audience; teachers only to their own sections.
export async function postNoticeAction(fd: FormData) {
  const s = await requireUser();
  const audience = f(fd, "audience");
  const ref = f(fd, "audience_ref");
  const admin = core.ROLES[s.role].side === "admin";
  if (!admin && !(s.role === "teacher" && audience === "section" && await ownsOffering(s, Number(ref)))) redirect("/?denied=1");
  return await done(async () => {
    if (!f(fd, "title") || !f(fd, "body")) throw new Error("Give the notice a title and a message.");
    await core.postNotice(s.user.id, { title: f(fd, "title"), body: f(fd, "body"), category: f(fd, "category") || "General", audience, audience_ref: ref || undefined });
  }, "Notice posted");
}

// ---------- Super admin (CORE-17)
export async function setSettingsAction(fd: FormData) {
  const s = await requireRole("super_admin");
  return await done(async () => {
    for (const st of core.SETTINGS) {
      const v = f(fd, st.key);
      if (v === "" || Number.isNaN(Number(v)) || Number(v) < 0) throw new Error(`${st.label} must be a number.`);
      await core.setSetting(s.user.id, st.key, v);
    }
  }, "Settings saved");
}
export async function grantRoleAction(fd: FormData) {
  const s = await requireRole("super_admin");
  return await done(async () => {
    const role = f(fd, "role") as core.Role;
    if (!(role in core.ROLES)) throw new Error("Unknown role");
    await run("INSERT INTO user_roles (user_id, role, dept_id) VALUES (?,?,?)", n(fd, "user_id"), role, f(fd, "dept_id") ? n(fd, "dept_id") : null);
    await audit(s.user.id, "grant_role", "user", n(fd, "user_id"), undefined, role);
  }, "Role granted");
}
export async function revokeRoleAction(fd: FormData) {
  const s = await requireRole("super_admin");
  return await done(async () => {
    const uid = n(fd, "user_id");
    if ((await core.userRoles(uid)).length <= 1) throw new Error("A user must keep at least one role. Deactivate the account instead.");
    await run("DELETE FROM user_roles WHERE user_id = ? AND role = ?", uid, f(fd, "role"));
    await run("DELETE FROM sessions WHERE user_id = ? AND role = ?", uid, f(fd, "role"));
    await audit(s.user.id, "revoke_role", "user", uid, f(fd, "role"));
  }, "Role revoked");
}
export async function setUserStatusAction(fd: FormData) {
  const s = await requireRole("super_admin");
  return await done(async () => {
    if (n(fd, "user_id") === s.user.id) throw new Error("You cannot deactivate yourself.");
    await run("UPDATE users SET status = ? WHERE id = ?", f(fd, "status"), n(fd, "user_id"));
    if (f(fd, "status") !== "active") await run("DELETE FROM sessions WHERE user_id = ?", n(fd, "user_id"));
    await audit(s.user.id, "set_status", "user", n(fd, "user_id"), undefined, f(fd, "status"));
  }, "Account updated");
}
export async function resetPasswordAction(fd: FormData) {
  const s = await requireRole("super_admin");
  const temp = randomBytes(5).toString("hex");
  return await done(async () => {
    await run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(temp), n(fd, "user_id"));
    await run("DELETE FROM sessions WHERE user_id = ?", n(fd, "user_id"));
    await audit(s.user.id, "reset_password", "user", n(fd, "user_id"));
  }, `Temporary password: ${temp} — share it with the user privately.`);
}

// ---------- Registrar (M1)
export async function addDepartmentAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => {
    const id = await insert("INSERT INTO departments (faculty_id, code, short, name) VALUES (?,?,?,?)", n(fd, "faculty_id"), f(fd, "code"), f(fd, "short").toUpperCase(), f(fd, "name"));
    await audit(s.user.id, "create", "department", id);
  }, "Department added");
}
export async function addProgramAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => {
    if (!f(fd, "name") || !(n(fd, "total_credits") > 0)) throw new Error("Name and total credits are required.");
    const id = await insert("INSERT INTO programs (dept_id, name, degree, total_credits) VALUES (?,?,?,?)", n(fd, "dept_id"), f(fd, "name"), f(fd, "degree"), n(fd, "total_credits"));
    await audit(s.user.id, "create", "program", id);
  }, "Program added");
}
export async function addCourseAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => {
    if (!f(fd, "code") || !f(fd, "title") || !(n(fd, "credits") > 0)) throw new Error("Code, title and credits are required.");
    await registrar.addCourse(s.user.id, { dept_id: n(fd, "dept_id"), code: f(fd, "code"), title: f(fd, "title"), credits: n(fd, "credits"), type: f(fd, "type"),
      prereqs: f(fd, "prereqs").split(/[,\s]+/).filter(Boolean) });
  }, "Course added");
}
export async function addRoomAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => {
    const id = await insert("INSERT INTO rooms (number, capacity, type) VALUES (?,?,?)", f(fd, "number").toUpperCase(), n(fd, "capacity"), f(fd, "type"));
    await audit(s.user.id, "create", "room", id);
  }, "Room added");
}
export async function addSlotAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => {
    if (!(f(fd, "start") < f(fd, "end"))) throw new Error("End time must be after start time.");
    const id = await insert('INSERT INTO time_slots (day, start, "end") VALUES (?,?,?)', f(fd, "day"), f(fd, "start"), f(fd, "end"));
    await audit(s.user.id, "create", "time_slot", id);
  }, "Time slot added");
}
export async function createSemesterAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => await registrar.createSemester(s.user.id, { code: f(fd, "code"), name: f(fd, "name"), start_date: f(fd, "start_date"), end_date: f(fd, "end_date"), due_date: f(fd, "due_date") }), "Semester created");
}
export async function setWindowAction(fd: FormData) {
  const s = await requireRole("registrar");
  const field = f(fd, "field") as "reg_open" | "adddrop_open" | "withdraw_open" | "status";
  if (!["reg_open", "adddrop_open", "withdraw_open", "status"].includes(field)) redirect("/?denied=1");
  return await done(async () => await registrar.setWindow(s.user.id, n(fd, "semester_id"), field, field === "status" ? f(fd, "value") : n(fd, "value")), "Semester updated");
}
export async function addCalendarEventAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => {
    if (f(fd, "end_date") < f(fd, "start_date")) throw new Error("End date is before the start date.");
    const id = await insert("INSERT INTO calendar_events (semester_id, type, title, start_date, end_date) VALUES (?,?,?,?,?)",
      n(fd, "semester_id"), f(fd, "type"), f(fd, "title"), f(fd, "start_date"), f(fd, "end_date") || f(fd, "start_date"));
    await audit(s.user.id, "create", "calendar_event", id);
  }, "Calendar event published");
}
export async function createOfferingAction(fd: FormData) {
  const s = await requireRole("registrar");
  const slots = fd.getAll("slot_id").map(Number).map((slot_id, i) => ({ slot_id, room_id: Number(fd.getAll("room_id")[i]) })).filter((x) => x.slot_id && x.room_id);
  return await done(async () => {
    if (!slots.length) throw new Error("Pick at least one slot and room.");
    await registrar.createOffering(s.user.id, { course_id: n(fd, "course_id"), semester_id: n(fd, "semester_id"), section: f(fd, "section"),
      teacher_id: n(fd, "teacher_id") || null, capacity: n(fd, "capacity"), slots });
  }, "Section created");
}
export async function assignTeacherAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => await registrar.assignTeacher(s.user.id, n(fd, "offering_id"), n(fd, "teacher_id") || null), "Teacher assigned");
}
export async function enrollStudentAction(fd: FormData) {
  const s = await requireRole("registrar");
  const password = randomBytes(5).toString("hex");
  let id = "";
  return await done(async () => {
    for (const k of ["name", "email", "phone", "batch", "section"]) if (!f(fd, k)) throw new Error(`${k[0].toUpperCase() + k.slice(1)} is required.`);
    id = (await registrar.enrollStudent(s.user.id, { name: f(fd, "name"), email: f(fd, "email"), phone: f(fd, "phone"), program_id: n(fd, "program_id"),
      batch: f(fd, "batch"), section: f(fd, "section"), semester_id: n(fd, "semester_id"), password })).studentId;
  }, () => `Student ${id} enrolled. Temporary password: ${password} (hand it to the student privately).`);
}
export async function setStudentStatusAction(fd: FormData) {
  const s = await requireRole("registrar");
  return await done(async () => {
    if (!f(fd, "reason")) throw new Error("A reason is required.");
    await registrar.setStudentStatus(s.user.id, n(fd, "student_id"), f(fd, "status"), f(fd, "reason"));
  }, "Status changed");
}
export async function importAction(fd: FormData) {
  const s = await requireRole("registrar");
  const file = fd.get("file");
  const text = file instanceof File && file.size ? await file.text() : f(fd, "csv");
  let count = 0;
  return await done(async () => { count = await registrar.importCsv(s.user.id, f(fd, "kind"), text); }, () => `Imported ${count} row(s)`);
}

// ---------- Department head (TCH-A-1..3)
async function inDept(s: Session, offeringId: number) {
  const o = await registrar.offering(offeringId);
  return !!o && o.dept_id === deptScope(s);
}
export async function proposeTeacherAction(fd: FormData) {
  const s = await requireRole("dept_head");
  if (!(await inDept(s, n(fd, "offering_id")))) redirect("/?denied=1");
  return await done(async () => await registrar.proposeTeacher(s.user.id, n(fd, "offering_id"), n(fd, "teacher_id")), "Proposal sent to the Registrar");
}
export async function decideGradesheetAction(fd: FormData) {
  const s = await requireRole("dept_head");
  if (!(await inDept(s, n(fd, "offering_id")))) redirect("/?denied=1");
  const approve = f(fd, "decision") === "approve";
  return await done(async () => await teacher.decideGradesheet(s.user.id, n(fd, "offering_id"), approve, f(fd, "comment")), approve ? "Grade sheet approved" : "Grade sheet returned to the teacher");
}
export async function decideCorrectionAction(fd: FormData) {
  const s = await requireRole("dept_head");
  return await done(async () => await teacher.decideCorrection(s.user.id, n(fd, "record_id"), f(fd, "decision") === "approve"), "Correction decided");
}

// ---------- Teacher (M3)
async function ownsOffering(s: Session, offeringId: number) {
  const t = await registrar.teacherByUser(s.user.id);
  return !!t && (await registrar.offering(offeringId))?.teacher_id === t.id;
}
// Teachers own their sections; a delegated TA (CORE-3) may take attendance, and enter marks if granted.
async function teacherOf(offeringId: number, need: "teacher" | "attendance" | "marks" = "teacher") {
  const s = await requireRole("teacher", "ta");
  if (s.role === "teacher" && await ownsOffering(s, offeringId)) return s;
  const scope = s.role === "ta" && need !== "teacher" ? await comms.delegatedScope(s.user.id, offeringId) : null;
  if (scope && (need === "attendance" || scope === "marks")) return s;
  redirect("/?denied=1");
}
export async function saveAttendanceAction(fd: FormData) {
  const oid = n(fd, "offering_id");
  const s = await teacherOf(oid, "attendance");
  const marks: Record<number, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("st_") && ["present", "absent", "late"].includes(String(v))) marks[Number(k.slice(3))] = String(v);
  const [slotId, roomId] = f(fd, "slot").split(":").map(Number);
  let msg = "Attendance saved";
  return await done(async () => {
    if (!f(fd, "date") || !slotId) throw new Error("Pick the date and class slot.");
    if (f(fd, "date") > new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" })) throw new Error("You cannot take attendance for a future date.");
    const r = await teacher.saveAttendance(s.user.id, oid, f(fd, "date"), slotId, roomId || null, marks, f(fd, "reason"));
    if (r.late) msg = `Correction sent to the Department Head for approval (${r.changed} change${r.changed === 1 ? "" : "s"})`;
  }, () => msg);
}
export async function addAssessmentAction(fd: FormData) {
  const oid = n(fd, "offering_id");
  const s = await teacherOf(oid);
  return await done(async () => {
    if (!f(fd, "title") || !(n(fd, "max_marks") > 0) || !(n(fd, "weight") > 0)) throw new Error("Title, max marks and weight are required.");
    await teacher.addAssessment(s.user.id, { offering_id: oid, type: f(fd, "type"), title: f(fd, "title"), max_marks: n(fd, "max_marks"), weight: n(fd, "weight"),
      instructions: f(fd, "instructions") || null, due_at: f(fd, "due_at") || null });
  }, "Assessment added");
}
export async function removeAssessmentAction(fd: FormData) {
  const a = await get<{ offering_id: number }>("SELECT offering_id FROM assessments WHERE id = ?", n(fd, "assessment_id"));
  const s = await teacherOf(a?.offering_id ?? 0);
  return await done(async () => await teacher.removeAssessment(s.user.id, n(fd, "assessment_id")), "Assessment removed");
}
export async function togglePublishAction(fd: FormData) {
  const a = await get<{ offering_id: number }>("SELECT offering_id FROM assessments WHERE id = ?", n(fd, "assessment_id"));
  const s = await teacherOf(a?.offering_id ?? 0);
  return await done(async () => await teacher.togglePublish(s.user.id, n(fd, "assessment_id")), "Visibility updated");
}
export async function enterMarksAction(fd: FormData) {
  const aid = n(fd, "assessment_id");
  const a = await get<{ offering_id: number }>("SELECT offering_id FROM assessments WHERE id = ?", aid);
  const s = await teacherOf(a?.offering_id ?? 0, "marks");
  const scores: Record<number, { score: string; feedback?: string }> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("m_")) (scores[Number(k.slice(2))] ??= { score: "" }).score = String(v).trim();
    if (k.startsWith("fb_")) (scores[Number(k.slice(3))] ??= { score: "" }).feedback = String(v).trim();
  }
  return await done(async () => await teacher.enterMarks(s.user.id, aid, scores), "Marks saved");
}
export async function importMarksAction(fd: FormData) {
  const aid = n(fd, "assessment_id");
  const a = await get<{ offering_id: number }>("SELECT offering_id FROM assessments WHERE id = ?", aid);
  const s = await teacherOf(a?.offering_id ?? 0, "marks");
  const file = fd.get("file");
  const text = file instanceof File && file.size ? await file.text() : f(fd, "csv");
  return await done(async () => {
    const ids = new Map((await teacher.roster(a!.offering_id)).map((r) => [r.code, r.student_id]));
    const scores: Record<number, { score: string }> = {};
    for (const [i, r] of registrar.parseCsv(text).entries()) {
      const sid = ids.get(r.student_id);
      if (!sid) throw new Error(`Row ${i + 2}: ${r.student_id || "(blank)"} is not on this section's roster.`);
      scores[sid] = { score: r.score };
    }
    await teacher.enterMarks(s.user.id, aid, scores);
  }, "Marks imported");
}
export async function submitGradesheetAction(fd: FormData) {
  const s = await teacherOf(n(fd, "offering_id"));
  return await done(async () => await teacher.submitGradesheet(s.user.id, n(fd, "offering_id")), "Grade sheet submitted to the Department Head. It is now locked.");
}
export async function requestGradeChangeAction(fd: FormData) {
  const s = await teacherOf(n(fd, "offering_id"));
  return await done(async () => await student.requestGradeChange(s.user.id, n(fd, "offering_id"), n(fd, "student_id"), n(fd, "total"), f(fd, "reason")), "Grade-change request sent to the Exam Controller");
}

// Files (CORE-11)
const ALLOWED = /\.(pdf|docx?|pptx?|xlsx?|zip|png|jpe?g|txt|csv|md)$/i;
const MAX_BYTES = 4 * 1024 * 1024; // Vercel caps a request body at 4.5 MB
async function saveUpload(by: number, file: FormDataEntryValue | null) {
  if (!(file instanceof File) || !file.size) return null;
  if (file.size > MAX_BYTES) throw new Error("Files must be 4 MB or smaller. Compress the PDF or photo and try again.");
  if (!ALLOWED.test(file.name)) throw new Error("Upload a PDF, Office document, image, text or ZIP file.");
  // ponytail: no virus scan (CORE-11); add ClamAV on this path before exposing uploads to the internet.
  const path = await storeFile(await file.arrayBuffer(), file.type);
  return await insert("INSERT INTO files (path, name, type, size, uploaded_by) VALUES (?,?,?,?,?)", path, file.name.slice(0, 200), file.type, file.size, by);
}
export async function addMaterialAction(fd: FormData) {
  const oid = n(fd, "offering_id");
  const s = await teacherOf(oid);
  let fileId: number | null = null;
  try { fileId = await saveUpload(s.user.id, fd.get("file")); } catch (e) { return await done(() => { throw e; }, ""); }
  return await done(async () => {
    const url = f(fd, "url");
    if (!f(fd, "title")) throw new Error("Give the material a title.");
    if (!url && !fileId) throw new Error("Attach a file or paste a link.");
    if (url && !/^https?:\/\//.test(url)) throw new Error("Links must start with http:// or https://");
    await teacher.addMaterial(s.user.id, { offering_id: oid, week: n(fd, "week") || 1, title: f(fd, "title"), kind: fileId ? "file" : "link", url: url || null, file_id: fileId });
  }, "Material published");
}

// ---------- Student (M2)
async function me() {
  const s = await requireRole("student");
  const st = await registrar.studentByUser(s.user.id);
  if (!st) redirect("/login");
  return { s, st };
}
export async function registerAction(fd: FormData) {
  const { s, st } = await me();
  let status = "";
  return await done(async () => { status = await student.register(s.user.id, st.id, n(fd, "offering_id")); }, () => (status === "waitlisted" ? "The section is full; you are on the waitlist" : "Registered. Tuition has been added to your invoice."));
}
export async function evaluationAction(fd: FormData) {
  const { st } = await me();
  const answers: Record<string, number> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("q:")) answers[k.slice(2)] = Number(v);
  return await done(async () => await student.submitEvaluation(st.id, n(fd, "offering_id"), n(fd, "rating"), f(fd, "comment"), answers), "Thanks. Your evaluation is anonymous to the teacher.");
}
export async function submitAssignmentAction(fd: FormData) {
  const { s, st } = await me();
  let fileId: number | null = null;
  try { fileId = await saveUpload(s.user.id, fd.get("file")); } catch (e) { return await done(() => { throw e; }, ""); }
  return await done(async () => {
    if (!fileId && !f(fd, "note")) throw new Error("Attach your file or write a note.");
    await teacher.submitAssignment(st.id, n(fd, "assessment_id"), fileId, f(fd, "note"));
  }, "Submitted");
}
// FIN-U-4: sandbox gateway. A real gateway posts back to a callback route with this same idempotent reference.
export async function payOnlineAction(fd: FormData) {
  const { st } = await me();
  let url = "";
  return await done(async () => { url = await finance.startGateway({ studentId: st.id, amount: n(fd, "amount"), method: f(fd, "method"), returnTo: "/app/fees?tab=ledger" }); },
    "Complete the payment", () => url);
}

// ---------- Exam controller (STU-A-2, A-4, A-5)
export async function publishResultsAction(fd: FormData) {
  const s = await requireRole("exam_controller");
  return await done(async () => await student.publishResults(s.user.id, n(fd, "semester_id")), "Results published and students notified");
}
export async function decideGradeChangeAction(fd: FormData) {
  const s = await requireRole("exam_controller");
  return await done(async () => await student.decideGradeChange(s.user.id, n(fd, "id"), f(fd, "decision") === "approve"), "Grade change decided");
}
export async function forceEnrollAction(fd: FormData) {
  const s = await requireRole("exam_controller", "registrar");
  return await done(async () => await student.forceEnroll(s.user.id, n(fd, "student_id"), n(fd, "offering_id"), f(fd, "reason")), "Student enrolled (override recorded)");
}
export async function dropEnrollmentAction(fd: FormData) {
  const s = await requireRole("exam_controller", "registrar");
  return await done(async () => await student.drop(s.user.id, n(fd, "enrollment_id"), f(fd, "reason")), "Enrollment dropped; charges reversed");
}

// ---------- Accounts (M4)
export async function counterPaymentAction(fd: FormData) {
  const s = await requireRole("cashier");
  let receipt = "";
  return await done(async () => {
    receipt = await accounts.recordPayment(s.user.id, { studentId: n(fd, "student_id") || undefined, applicationId: n(fd, "application_id") || undefined, amount: n(fd, "amount"), method: f(fd, "method"), channel: "counter", reference: f(fd, "reference") || undefined });
  }, () => `Payment recorded. Receipt ${receipt}`);
}
export async function requestReversalAction(fd: FormData) {
  const s = await requireRole("cashier", "accounts_officer");
  return await done(async () => await accounts.requestApproval(s.user.id, { kind: "reversal", ref_id: n(fd, "payment_id"), student_id: n(fd, "student_id"), reason: f(fd, "reason") }), "Reversal requested; waiting for approval");
}
export async function requestWaiverAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  return await done(async () => await accounts.requestApproval(s.user.id, { kind: "waiver", student_id: n(fd, "student_id"), semester_id: n(fd, "semester_id"), percent: n(fd, "percent"),
    detail: f(fd, "detail") || "Waiver", reason: f(fd, "reason") }), "Waiver requested; a second officer must approve it");
}
export async function requestAdjustmentAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  return await done(async () => {
    if (!n(fd, "amount")) throw new Error("Enter a non-zero amount (negative for a credit).");
    await accounts.requestApproval(s.user.id, { kind: "adjustment", student_id: n(fd, "student_id"), semester_id: n(fd, "semester_id"), amount: Math.round(n(fd, "amount")),
      detail: f(fd, "detail") || "Adjustment", reason: f(fd, "reason") });
  }, "Adjustment requested; a second officer must approve it");
}
export async function decideApprovalAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  const kind = (await get<{ kind: string }>("SELECT kind FROM approvals WHERE id = ?", n(fd, "id")))?.kind;
  if (kind === "reversal" && s.role !== "finance_head") return await done(() => { throw new Error("Only the Finance Head approves reversals."); }, "");
  return await done(async () => await accounts.decideApproval(s.user.id, n(fd, "id"), f(fd, "decision") === "approve"), f(fd, "decision") === "approve" ? "Approved and posted to the ledger" : "Rejected");
}
export async function setFeeAction(fd: FormData) {
  const s = await requireRole("finance_head");
  return await done(async () => await accounts.setFee(s.user.id, n(fd, "program_id"), f(fd, "head"), n(fd, "amount")), "New fee version saved; it applies to charges raised from now on");
}
export async function bulkGenerateAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  let count = 0;
  return await done(async () => { count = await accounts.bulkGenerate(s.user.id, n(fd, "program_id"), f(fd, "batch"), n(fd, "semester_id")); }, () => `Semester fee added for ${count} student(s)`);
}
export async function applyLateFeesAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  return await done(async () => await accounts.applyLateFees(s.user.id, n(fd, "semester_id")), "Late fees applied to overdue invoices");
}
export async function grantExceptionAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  return await done(async () => await accounts.grantException(s.user.id, n(fd, "student_id"), n(fd, "semester_id"), f(fd, "exam"), f(fd, "reason")), "Clearance exception granted");
}
export async function closeShiftAction(fd: FormData) {
  const s = await requireRole("cashier");
  const counted: Record<string, number> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("c_")) counted[k.slice(2)] = Math.round(Number(v) || 0);
  let diff = 0;
  return await done(async () => { diff = await accounts.closeShift(s.user.id, counted); }, () => (diff === 0 ? "Shift closed. Counted cash matches the system." : `Shift closed with a difference of ৳${diff} (recorded).`));
}

// ---------- Admission (M1): applicants
const devCode = (code: string) => (showCodes() ? `&dev=${code}` : "");
export async function signupAction(fd: FormData) {
  let code = "";
  try {
    code = await admission.signup({ name: f(fd, "name"), email: f(fd, "email"), phone: f(fd, "phone"), password: f(fd, "password") });
  } catch (e) {
    redirect(`/apply?err=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/apply/verify?email=${encodeURIComponent(f(fd, "email"))}${devCode(code)}`);
}
export async function verifyAction(fd: FormData) {
  try {
    await admission.verify(f(fd, "email"), f(fd, "code"));
  } catch (e) {
    redirect(`/apply/verify?email=${encodeURIComponent(f(fd, "email"))}&err=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/login?ok=${encodeURIComponent("Email verified. Sign in to start your application.")}`);
}
export async function resendCodeAction(fd: FormData) {
  const u = await get<{ id: number }>("SELECT id FROM users WHERE email = ? AND status = 'unverified'", f(fd, "email").toLowerCase());
  const code = u ? await admission.issueCode(u.id) : "";
  redirect(`/apply/verify?email=${encodeURIComponent(f(fd, "email"))}&ok=${encodeURIComponent("A new code is on its way.")}${code ? devCode(code) : ""}`);
}
export async function saveApplicationAction(fd: FormData) {
  const s = await requireRole("applicant");
  const cycleId = n(fd, "cycle_id");
  const c = await admission.cycle(cycleId);
  const data: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("d_")) data[k.slice(2)] = String(v).trim();
  const submit = f(fd, "intent") === "submit";
  let id = 0;
  return await done(async () => {
    if (!c) throw new Error("Admission cycle not found.");
    id = await admission.saveApplication(s.user.id, cycleId, n(fd, "program_id"), data, false);
    for (const [i, name] of (JSON.parse(c.docs_json) as string[]).entries()) {
      const fileId = await saveUpload(s.user.id, fd.get(`doc_${i}`));
      if (fileId) await admission.uploadDoc(s.user.id, id, name, fileId);
    }
    if (submit) await admission.saveApplication(s.user.id, cycleId, n(fd, "program_id"), data, true);
  }, submit ? "Application submitted. Pay the application fee to send it for review." : "Draft saved",
    submit ? () => `/app/admission/${id}` : undefined);
}
export async function reuploadDocAction(fd: FormData) {
  const s = await requireRole("applicant");
  return await done(async () => {
    const fileId = await saveUpload(s.user.id, fd.get("file"));
    if (!fileId) throw new Error("Choose a file.");
    await admission.uploadDoc(s.user.id, n(fd, "application_id"), f(fd, "name"), fileId);
  }, "Document replaced; it goes back to the officer for checking");
}
export async function respondOfferAction(fd: FormData) {
  const s = await requireRole("applicant");
  const accept = f(fd, "decision") === "accept";
  return await done(async () => await admission.respondToOffer(s.user.id, n(fd, "application_id"), accept),
    accept ? "Offer accepted. Pay the admission fee to confirm your seat." : "Offer declined");
}
export async function payApplicationAction(fd: FormData) {
  const s = await requireRole("applicant");
  const a = await admission.application(n(fd, "application_id"));
  if (!a || a.user_id !== s.user.id) redirect("/?denied=1");
  let url = "";
  return await done(async () => { url = await finance.startGateway({ applicationId: a.id, amount: n(fd, "amount"), method: f(fd, "method"), returnTo: `/app/admission/${a.id}` }); },
    "Complete the payment", () => url);
}

// ---------- Admission (M1): officers and registrar
export async function createCycleAction(fd: FormData) {
  const s = await requireRole("admissions_officer");
  const seats: Record<number, number> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("seats_")) seats[Number(k.slice(6))] = Number(v) || 0;
  const list = (k: string) => f(fd, k).split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
  return await done(async () => await admission.createCycle(s.user.id, { name: f(fd, "name"), intake_semester_id: n(fd, "intake_semester_id"), deadline: f(fd, "deadline"),
    test_date: f(fd, "test_date"), docs: list("docs"), fields: list("fields"), seats }), "Admission cycle opened");
}
export async function setCycleStatusAction(fd: FormData) {
  const s = await requireRole("admissions_officer");
  return await done(async () => await admission.setCycleStatus(s.user.id, n(fd, "cycle_id"), f(fd, "status") === "open" ? "open" : "closed"), "Cycle updated");
}
export async function reviewDocAction(fd: FormData) {
  const s = await requireRole("admissions_officer");
  return await done(async () => await admission.reviewDoc(s.user.id, n(fd, "doc_id"), f(fd, "decision") === "ok", f(fd, "note")), "Document reviewed");
}
export async function decideApplicationAction(fd: FormData) {
  const s = await requireRole("admissions_officer");
  const ok = f(fd, "decision") === "approve";
  return await done(async () => await admission.decide(s.user.id, n(fd, "application_id"), ok, f(fd, "reason")), ok ? "Shortlisted for the test" : "Application rejected");
}
export async function scheduleTestsAction(fd: FormData) {
  const s = await requireRole("admissions_officer");
  let count = 0;
  return await done(async () => {
    count = await admission.scheduleTests(s.user.id, n(fd, "cycle_id"), f(fd, "date"), f(fd, "start"), f(fd, "rooms").split(",").map((r) => r.trim()).filter(Boolean), n(fd, "per_room"));
  }, () => `${count} candidate(s) scheduled and notified`);
}
export async function enterScoresAction(fd: FormData) {
  const s = await requireRole("admissions_officer");
  const scores: Record<number, number> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("s_") && String(v).trim() !== "") scores[Number(k.slice(2))] = Number(v);
  const rank = f(fd, "intent") === "rank";
  return await done(async () => { await admission.enterScores(s.user.id, scores); if (rank) await admission.rankMerit(s.user.id, n(fd, "cycle_id")); }, rank ? "Scores saved and merit list ranked" : "Scores saved");
}
export async function publishAdmissionAction(fd: FormData) {
  const s = await requireRole("admissions_officer");
  let count = 0;
  return await done(async () => { count = await admission.publishResults(s.user.id, n(fd, "cycle_id")); }, () => `Results published to ${count} applicant(s)`);
}
export async function enrollApplicantAction(fd: FormData) {
  const s = await requireRole("registrar");
  let sid = "";
  return await done(async () => { sid = (await admission.enroll(s.user.id, n(fd, "application_id"), f(fd, "batch"), f(fd, "section"))).studentId; },
    () => `Enrolled as ${sid}. Their applicant login now signs in with this student ID.`);
}

// ---------- Transport (M5)
export async function applyPassAction(fd: FormData) {
  const { s, st } = await me();
  return await done(async () => await transport.applyPass(s.user.id, st.id, n(fd, "route_id"), n(fd, "stop_id")), "Pass requested. The Transport Office will approve it shortly.");
}
export async function passRequestAction(fd: FormData) {
  const { st } = await me();
  return await done(async () => await transport.requestChange(st.id, f(fd, "kind"), n(fd, "route_id") || null, n(fd, "stop_id") || null, f(fd, "reason")), "Request sent to the Transport Office");
}
export async function decidePassAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  return await done(async () => await transport.decidePass(s.user.id, n(fd, "pass_id"), f(fd, "decision") === "approve", f(fd, "note")), "Pass decided");
}
export async function decidePassRequestAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  return await done(async () => await transport.decideRequest(s.user.id, n(fd, "request_id"), f(fd, "decision") === "approve"), "Request decided");
}
export async function saveRouteAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  return await done(async () => await transport.saveRoute(s.user.id, { id: n(fd, "id") || undefined, number: f(fd, "number"), name: f(fd, "name"), distance_km: n(fd, "distance_km") || null,
    fee: n(fd, "fee"), return_time: f(fd, "return_time") || "16:30", active: f(fd, "active") === "0" ? 0 : 1 }), "Route saved");
}
export async function addStopAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  return await done(async () => await transport.addStop(s.user.id, n(fd, "route_id"), { name: f(fd, "name"), pickup_time: f(fd, "pickup_time"), drop_time: f(fd, "drop_time") }), "Stop added");
}
export async function removeStopAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  return await done(async () => await transport.removeStop(s.user.id, n(fd, "stop_id")), "Stop removed");
}
export async function addCrewAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  const password = randomBytes(5).toString("hex");
  let id = "";
  return await done(async () => {
    id = await transport.addCrew(s.user.id, { name: f(fd, "name"), phone: f(fd, "phone"), email: f(fd, "email"), kind: f(fd, "kind"),
      licence_no: f(fd, "licence_no"), licence_expiry: f(fd, "licence_expiry"), password });
  }, () => `Added. Sign-in ID ${id}, temporary password ${password} (share it privately).`);
}
export async function saveBusAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  return await done(async () => await transport.saveBus(s.user.id, { id: n(fd, "id") || undefined, number: f(fd, "number"), registration: f(fd, "registration"), capacity: n(fd, "capacity"),
    status: f(fd, "status") || "active", route_id: n(fd, "route_id") || null, driver_id: n(fd, "driver_id") || null, assistant_id: n(fd, "assistant_id") || null,
    fitness_expiry: f(fd, "fitness_expiry"), insurance_expiry: f(fd, "insurance_expiry") }), "Bus saved");
}
export async function generateTripsAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  let count = 0;
  return await done(async () => { count = await transport.generateTrips(s.user.id, f(fd, "date")); }, () => (count ? `${count} trip(s) created` : "Trips already exist for that day"));
}
export async function disruptionAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  return await done(async () => await transport.publishDisruption(s.user.id, n(fd, "trip_id"), f(fd, "kind") === "cancel" ? "cancel" : "delay", n(fd, "minutes"), f(fd, "note")), "Riders notified");
}
export async function resolveReportAction(fd: FormData) {
  const s = await requireRole("transport_officer");
  return await done(async () => await transport.resolveReport(s.user.id, n(fd, "report_id")), "Marked resolved");
}
export async function tripAction(fd: FormData) {
  const s = await requireRole("driver");
  const start = f(fd, "do") === "start";
  return await done(async () => await (start ? transport.startTrip : transport.endTrip)(s.user.id, n(fd, "trip_id")), start ? "Trip started" : "Trip ended");
}
export async function reportTripAction(fd: FormData) {
  const s = await requireRole("driver");
  let fileId: number | null = null;
  try { fileId = await saveUpload(s.user.id, fd.get("photo")); } catch (e) { return await done(() => { throw e; }, ""); }
  return await done(async () => await transport.report(s.user.id, n(fd, "trip_id"), f(fd, "kind"), f(fd, "note"), n(fd, "minutes"), fileId), "Reported. The Transport Office and riders have been alerted.");
}

// =================== Phase 7 ===================
// ---------- 2-step login and notification preferences (CORE-5, CORE-8)
export async function verifyMfaAction(fd: FormData) {
  const err = await verifyMfa(f(fd, "code"));
  if (err) redirect(`/login/verify?err=${encodeURIComponent(err)}`);
  redirect("/");
}
export async function resendMfaAction() {
  await resendMfa();
  redirect(`/login/verify?ok=${encodeURIComponent("A new code is on its way.")}`);
}
export async function savePrefsAction(fd: FormData) {
  const s = await requireUser();
  const values: Record<string, { email: boolean; sms: boolean; muted: boolean }> = {};
  for (const c of Object.keys(core.CATEGORIES)) values[c] = { email: fd.has(`${c}:email`), sms: fd.has(`${c}:sms`), muted: fd.has(`${c}:muted`) };
  return await done(async () => await core.setPrefs(s.user.id, values), "Notification settings saved");
}
export async function toggleMfaAction(fd: FormData) {
  const s = await requireUser();
  return await done(async () => {
    await run("UPDATE users SET mfa_enabled = ? WHERE id = ?", f(fd, "on") === "1" ? 1 : 0, s.user.id);
    await audit(s.user.id, "mfa_toggle", "user", s.user.id, undefined, f(fd, "on"));
  }, f(fd, "on") === "1" ? "2-step sign-in is on. You'll need a code each time you sign in." : "2-step sign-in is off");
}

// ---------- Help desk (CORE-13)
export async function createTicketAction(fd: FormData) {
  const s = await requireUser();
  let id = 0;
  return await done(async () => {
    const fileId = await saveUpload(s.user.id, fd.get("file"));
    id = await comms.createTicket(s.user.id, { category: f(fd, "category"), subject: f(fd, "subject"), body: f(fd, "body"), ref: f(fd, "ref") || undefined, fileId });
  }, "Request sent. You'll be notified when the office replies.", () => `/helpdesk/${id}`);
}
export async function replyTicketAction(fd: FormData) {
  const s = await requireUser();
  const t = await comms.ticket(n(fd, "ticket_id"));
  const as = t && comms.canSeeTicket(s.user.id, s.roles, t);
  if (!t || !as) redirect("/?denied=1");
  return await done(async () => {
    const fileId = await saveUpload(s.user.id, fd.get("file"));
    await comms.replyTicket(s.user.id, t.id, f(fd, "body"), f(fd, "internal") === "1", fileId, as);
    if (as === "staff" && f(fd, "status")) await comms.setTicketStatus(s.user.id, t.id, f(fd, "status"));
  }, "Sent");
}
export async function ticketStatusAction(fd: FormData) {
  const s = await requireUser();
  const t = await comms.ticket(n(fd, "ticket_id"));
  const as = t && comms.canSeeTicket(s.user.id, s.roles, t);
  if (!t || !as || (as === "requester" && f(fd, "status") !== "closed")) redirect("/?denied=1");
  return await done(async () => await comms.setTicketStatus(s.user.id, t.id, f(fd, "status")), "Status updated");
}

// ---------- Messaging (CORE-9)
export async function startThreadAction(fd: FormData) {
  const s = await requireUser();
  let id = 0;
  return await done(async () => { id = await comms.startThread(s.user.id, fd.getAll("to").map(Number).filter(Boolean), f(fd, "subject"), f(fd, "body")); }, "Sent", () => `/messages/${id}`);
}
export async function postMessageAction(fd: FormData) {
  const s = await requireUser();
  return await done(async () => await comms.postMessage(s.user.id, n(fd, "thread_id"), f(fd, "body")), "Sent");
}
export async function openSectionThreadAction(fd: FormData) {
  const oid = n(fd, "offering_id");
  const s = await requireUser();
  const allowed = s.role === "teacher" ? await ownsOffering(s, oid)
    : !!(await get("SELECT 1 FROM enrollments e JOIN students st ON st.id = e.student_id WHERE e.offering_id = ? AND st.user_id = ? AND e.status IN ('confirmed','completed')", oid, s.user.id));
  if (!allowed) redirect("/?denied=1");
  let id = 0;
  return await done(async () => { id = await comms.sectionThread(oid); }, "Class conversation", () => `/messages/${id}`);
}

// ---------- TA delegation (CORE-3)
export async function delegateAction(fd: FormData) {
  const s = await requireRole("teacher");
  let name = "";
  return await done(async () => { name = await comms.delegate(s.user.id, n(fd, "offering_id"), f(fd, "uni_id"), f(fd, "scope"), n(fd, "days")); }, () => `${name} can now help with this section`);
}
export async function revokeDelegationAction(fd: FormData) {
  const s = await requireRole("teacher");
  return await done(async () => await comms.revokeDelegation(s.user.id, n(fd, "id")), "Access removed");
}

// ---------- Student services (STU-U-4, U-12–15)
export async function dropOwnAction(fd: FormData) {
  const { s, st } = await me();
  return await done(async () => await services.dropOwn(s.user.id, st.id, n(fd, "enrollment_id")), "Course dropped. The charges are reversed on your invoice.");
}
export async function withdrawAction(fd: FormData) {
  const { s, st } = await me();
  return await done(async () => await services.withdraw(s.user.id, st.id, n(fd, "enrollment_id"), f(fd, "reason")), "Withdrawn from the course");
}
export async function submitRequestAction(fd: FormData) {
  const { s, st } = await me();
  const kind = f(fd, "kind") as services.Kind;
  return await done(async () => await services.submitRequest(s.user.id, st.id, kind, { offering_id: n(fd, "offering_id") || undefined, target_offering_id: n(fd, "target_offering_id") || undefined,
    detail: f(fd, "detail"), copies: n(fd, "copies") || 1 }),
    kind === "section_change" ? "Request sent to the Department Head" : "Application submitted. Pay the fee to send it for processing.");
}
export async function decideServiceRequestAction(fd: FormData) {
  const r = await services.request(n(fd, "request_id"));
  const s = await requireRole("exam_controller", "dept_head");
  if (!r) redirect("/?denied=1");
  if (r.kind === "section_change" ? !(s.role === "dept_head" && r.dept_id === deptScope(s)) : s.role !== "exam_controller") redirect("/?denied=1");
  return await done(async () => await services.decideRequest(s.user.id, r.id, f(fd, "action") as "approve", f(fd, "note")), "Request updated");
}

// ---------- Exams (STU-A-3, TCH-U-11)
export async function scheduleExamAction(fd: FormData) {
  const s = await requireRole("exam_controller");
  return await done(async () => await services.scheduleExam(s.user.id, { offering_id: n(fd, "offering_id"), stage: f(fd, "stage"), date: f(fd, "date"), start: f(fd, "start"), end: f(fd, "end") }), "Exam scheduled");
}
export async function seatPlanAction(fd: FormData) {
  const s = await requireRole("exam_controller");
  let count = 0;
  return await done(async () => { count = await services.generateSeatPlans(s.user.id, n(fd, "semester_id"), f(fd, "stage"), fd.getAll("rooms").map(String)); },
    () => `Seat plans generated for ${count} candidate sittings. Students can download admit cards.`);
}
export async function uploadPaperAction(fd: FormData) {
  const s = await requireRole("teacher");
  return await done(async () => {
    const fileId = await saveUpload(s.user.id, fd.get("file"));
    if (!fileId) throw new Error("Choose the question paper file.");
    await services.uploadPaper(s.user.id, n(fd, "exam_id"), fileId);
  }, "Question paper uploaded. Only the Exam Controller can open it before the exam.");
}

// ---------- Evaluations admin (STU-A-6)
export async function saveEvalFormAction(fd: FormData) {
  const s = await requireRole("exam_controller");
  const questions = f(fd, "questions").split(/\r?\n/).map((q) => q.trim()).filter(Boolean);
  return await done(async () => await services.saveEvalForm(s.user.id, n(fd, "semester_id"), questions, f(fd, "open") === "1"), "Evaluation form saved");
}

// ---------- Mentoring (STU-A-8, STU-U-15, TCH-U-15)
export async function assignMentorsAction(fd: FormData) {
  const s = await requireRole("exam_controller");
  let count = 0;
  return await done(async () => { count = await services.assignMentors(s.user.id, n(fd, "program_id"), f(fd, "batch"), f(fd, "section"), n(fd, "teacher_id")); }, () => `Mentor assigned to ${count} students`);
}
export async function addSlotsAction(fd: FormData) {
  const s = await requireRole("teacher");
  const t = (await registrar.teacherByUser(s.user.id))!;
  return await done(async () => await services.addSlots(t.id, f(fd, "date"), f(fd, "start"), n(fd, "count"), n(fd, "minutes"), f(fd, "place")), "Advising slots published");
}
export async function bookSlotAction(fd: FormData) {
  const { st } = await me();
  return await done(async () => await services.bookSlot(st.id, n(fd, "slot_id"), f(fd, "topic")), "Booked. Your mentor has been notified.");
}
export async function cancelBookingAction(fd: FormData) {
  const { st } = await me();
  return await done(async () => await services.cancelBooking(st.id, n(fd, "slot_id")), "Booking cancelled");
}
export async function logMeetingAction(fd: FormData) {
  const s = await requireRole("teacher");
  const t = (await registrar.teacherByUser(s.user.id))!;
  return await done(async () => {
    const fileId = await saveUpload(s.user.id, fd.get("file"));
    await services.logMeeting(t.id, s.user.id, { student_id: n(fd, "student_id"), date: f(fd, "date"), reason: f(fd, "reason"), action: f(fd, "action"), next_meeting: f(fd, "next_meeting"), file_id: fileId });
  }, "Meeting recorded; the student can see it");
}

// ---------- Registrar: credit transfer (REG-A-7)
export async function transferCreditAction(fd: FormData) {
  const s = await requireRole("registrar");
  const st = await registrar.studentById(n(fd, "student_id"));
  return await done(async () => {
    if (!st) throw new Error("Student not found.");
    await student.importResult(s.user.id, { student_id: st.student_id, course: f(fd, "course").toUpperCase(), semester: f(fd, "semester"), section: "TRF", total: f(fd, "total") }, "Transfer");
    await audit(s.user.id, "credit_transfer", "student", st.id, undefined, { course: f(fd, "course"), total: f(fd, "total") });
  }, "Transferred credit recorded");
}

// ---------- Finance (FIN-A-7, A-10, A-12, FIN-U-7, U-8)
export async function saveRuleAction(fd: FormData) {
  const s = await requireRole("finance_head");
  return await done(async () => await finance.saveRule(s.user.id, { id: n(fd, "id") || undefined, name: f(fd, "name"), min_sgpa: n(fd, "min_sgpa"), min_credits: n(fd, "min_credits"),
    percent: n(fd, "percent"), active: f(fd, "active") === "0" ? 0 : 1 }), "Waiver rule saved; it applies the next time results are published");
}
export async function createCircularAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  return await done(async () => await finance.createCircular(s.user.id, { title: f(fd, "title"), body: f(fd, "body"), semester_id: n(fd, "semester_id"), percent: n(fd, "percent"), deadline: f(fd, "deadline") }),
    "Circular published and students notified");
}
export async function applyScholarshipAction(fd: FormData) {
  const { s, st } = await me();
  return await done(async () => {
    const fileId = await saveUpload(s.user.id, fd.get("file"));
    await finance.applyScholarship(st.id, n(fd, "circular_id"), f(fd, "statement"), fileId);
  }, "Application submitted");
}
export async function decideScholarshipAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  return await done(async () => await finance.decideScholarship(s.user.id, n(fd, "id"), f(fd, "decision") === "award", f(fd, "note")), "Decision recorded");
}
export async function requestInstallmentsAction(fd: FormData) {
  const { s, st } = await me();
  return await done(async () => await finance.requestInstallments(s.user.id, st.id, n(fd, "parts")), "Plan requested. Accounts will review it.");
}
export async function requestRefundAction(fd: FormData) {
  const { s, st } = await me();
  return await done(async () => await finance.requestRefund(s.user.id, st.id, n(fd, "amount"), f(fd, "reason")), "Refund requested. Accounts will review it.");
}
export async function sendRemindersAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  let count = 0;
  return await done(async () => { count = await finance.sendReminders(s.user.id, n(fd, "semester_id")); }, () => `Reminders sent to ${count} student(s) by app, email and SMS`);
}
export async function importSettlementsAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head");
  const file = fd.get("file");
  const text = file instanceof File && file.size ? await file.text() : f(fd, "csv");
  let count = 0;
  return await done(async () => { count = await finance.importSettlements(s.user.id, registrar.parseCsv(text), f(fd, "gateway") || "Gateway"); }, () => `${count} settlement row(s) imported`);
}
export async function recordDepositAction(fd: FormData) {
  const s = await requireRole("accounts_officer", "finance_head", "cashier");
  return await done(async () => await finance.recordDeposit(s.user.id, { deposited_on: f(fd, "deposited_on"), amount: n(fd, "amount"), bank_ref: f(fd, "bank_ref"), note: f(fd, "note") }), "Bank deposit recorded");
}

// ---------- Transport boarding (TRN-D-3)
export async function boardAction(fd: FormData) {
  const s = await requireRole("driver");
  let name = "";
  return await done(async () => { name = await transport.markBoarded(s.user.id, n(fd, "trip_id"), f(fd, "token") ? { token: f(fd, "token") } : { studentId: n(fd, "student_id") }, f(fd, "token") ? "qr" : "list"); },
    () => `${name} boarded`);
}
export async function boardQr(tripId: number, token: string) {
  const s = await requireRole("driver");
  try {
    return { ok: true, name: await transport.markBoarded(s.user.id, tripId, { token }, "qr") };
  } catch (e) {
    return { ok: false, name: (e as Error).message };
  }
}
