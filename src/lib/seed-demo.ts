// Classroom demo data: `npm run seed:demo` (wipes the database: data/erp.db locally, or Turso when TURSO_DATABASE_URL is set). Small enough to follow on a projector:
// one or two accounts per sector, two courses with two sections each, one bus route, one open admission cycle.
// Pair it with DIU-ERP-Demo-Script.pdf. All data is synthetic; every password is diu12345.
import { run, insert, get, today, resetDatabase, DB_URL } from "./db.ts";
import { core, registrar, student, accounts, admission, transport, services, finance } from "../modules/index.ts";

console.log(`Resetting ${DB_URL.startsWith("file:") ? DB_URL : "the Turso database"}…`);
await resetDatabase();

const PW = "diu12345";
const mk = async (uni_id: string, name: string, roles: { role: core.Role; dept_id?: number }[], phone: string) =>
  await core.createUser({ uni_id, email: `${uni_id.toLowerCase().replace(/[^a-z0-9]/g, "")}@diu.edu.bd`, name, phone, password: PW }, roles);
const day = (offset: number) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

for (const s of core.SETTINGS) await run("INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)", s.key, s.def);

// ---------- Academic structure
const fsit = await insert("INSERT INTO faculties (code, name) VALUES ('FSIT', 'Faculty of Science and Information Technology')");
const cse = await insert("INSERT INTO departments (faculty_id, code, short, name) VALUES (?, '15', 'CSE', 'Computer Science and Engineering')", fsit);
const prog = await insert("INSERT INTO programs (dept_id, name, degree, total_credits) VALUES (?, 'B.Sc. in CSE', 'B.Sc.', 148)", cse);
await accounts.setFee(0, prog, "admission", 25000);
await accounts.setFee(0, prog, "semester_fee", 9500);
await accounts.setFee(0, prog, "tuition_per_credit", 4500);
await accounts.setFee(0, prog, "lab_fee", 3000);

// ---------- People: one or two per sector
await mk("ADM-0001", "System Administrator", [{ role: "super_admin" }], "01700000001");
const reg = await mk("REG-0001", "Farhana Kabir", [{ role: "registrar" }], "01700000002");
const exc = await mk("EXC-0001", "Mizanur Rahman", [{ role: "exam_controller" }], "01700000003");
await mk("CSH-0001", "Rakib Hasan", [{ role: "cashier" }], "01700000004");
const acc = await mk("ACC-0001", "Nusrat Jahan", [{ role: "accounts_officer" }], "01700000005");
const fin = await mk("FIN-0001", "Anwar Hossain", [{ role: "finance_head" }], "01700000006");
const ads = await mk("ADS-0001", "Tahsin Ara", [{ role: "admissions_officer" }], "01700000007");
const tro = await mk("TRO-0001", "Kamal Uddin", [{ role: "transport_officer" }], "01713493050");
const headUser = await mk("710001234", "Dr. Sheak Rashed Haider", [{ role: "teacher" }, { role: "dept_head", dept_id: cse }], "01711000234");
const tanvirUser = await mk("710001301", "Tanvir Ahmed", [{ role: "teacher" }], "01711000301");
await run("UPDATE departments SET head_user_id = ? WHERE id = ?", headUser, cse);
const tHead = await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?, '710001234', ?, 'Professor')", headUser, cse);
const tTanvir = await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?, '710001301', ?, 'Senior Lecturer')", tanvirUser, cse);

// ---------- Courses, rooms, slots
const course = async (code: string, title: string, credits: number, prereqs: string[] = []) => await registrar.addCourse(0, { dept_id: cse, code, title, credits, type: "theory", prereqs });
await course("CSE113", "Programming and Problem Solving", 3);
await course("CSE133", "Data Structures", 3, ["CSE113"]);
const cCse221 = await course("CSE221", "Algorithms", 3, ["CSE133"]);
const cCse231 = await course("CSE231", "Database Management Systems", 3, ["CSE133"]);
const r1 = await insert("INSERT INTO rooms (number, capacity, type) VALUES ('AB4-501', 60, 'theory')");
const r2 = await insert("INSERT INTO rooms (number, capacity, type) VALUES ('AB4-502', 60, 'theory')");
await insert("INSERT INTO rooms (number, capacity, type) VALUES ('AB4-601', 60, 'theory')");
for (const d of registrar.DAYS) for (const [s, e] of [["08:30", "10:00"], ["10:00", "11:30"], ["11:30", "13:00"], ["13:00", "14:30"], ["14:30", "16:00"]])
  await insert('INSERT INTO time_slots (day, start, "end") VALUES (?,?,?)', d, s, e);
const slot = async (d: string, t: string) => (await get<{ id: number }>("SELECT id FROM time_slots WHERE day = ? AND start = ?", d, t))!.id;

// ---------- Semesters: last semester (with results), this semester (registration open), next (admission intake)
const s261 = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, due_date) VALUES ('261', 'Spring 2026', '2026-01-10', '2026-04-30', 'closed', '2026-02-20')");
const s263 = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, reg_open, due_date) VALUES ('263', 'Fall 2026', '2026-09-01', '2026-12-31', 'active', 1, ?)", day(30));
const s271 = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, due_date) VALUES ('271', 'Spring 2027', '2027-01-10', '2027-04-30', 'upcoming', '2027-02-20')");
for (const [type, title, a, b] of [["registration", "Course registration", "2026-08-20", "2026-12-31"], ["classes", "Classes begin", "2026-09-06", "2026-09-06"],
  ["midterm", "Mid-term examinations", "2026-10-25", "2026-11-02"], ["final", "Final examinations", "2026-12-12", "2026-12-24"]])
  await insert("INSERT INTO calendar_events (semester_id, type, title, start_date, end_date) VALUES (?,?,?,?,?)", s263, type, title, a, b);

// Two courses this semester, sections A and B, each with a mid-term (40%) and final (60%) already planned
const sections: Record<string, number> = {};
for (const [key, c, sec, teacherId, times, room] of [
  ["CSE221_A", cCse221, "42_A", tTanvir, [["Sun", "08:30"], ["Tue", "08:30"]], r1], ["CSE221_B", cCse221, "42_B", tTanvir, [["Mon", "10:00"], ["Wed", "10:00"]], r2],
  ["CSE231_A", cCse231, "42_A", tHead, [["Sun", "11:30"], ["Tue", "11:30"]], r1], ["CSE231_B", cCse231, "42_B", tHead, [["Mon", "13:00"], ["Wed", "13:00"]], r2],
] as [string, number, string, number, [string, string][], number][]) {
  sections[key] = await registrar.createOffering(0, { course_id: c, semester_id: s263, section: sec, teacher_id: teacherId, capacity: 40,
    slots: await Promise.all(times.map(async ([d, t]) => ({ slot_id: await slot(d, t), room_id: room }))) });
  for (const [type, title, max, weight] of [["mid", "Mid-term", 25, 40], ["final", "Final", 40, 60]] as const)
    await insert("INSERT INTO assessments (offering_id, type, title, max_marks, weight) VALUES (?,?,?,?,?)", sections[key], type, title, max, weight);
}

// ---------- Students: Adil is the demo student (nothing registered yet); Sharon is a classmate already in section A
const mkStudent = async (id: string, name: string, phone: string) => {
  const uid = await mk(id, name, [{ role: "student" }], phone);
  return await insert("INSERT INTO students (user_id, student_id, reg_id, program_id, batch, section, admitted_semester_id) VALUES (?,?,?,?, '42', 'A', ?)",
    uid, id, `REG-${id}`, prog, s261);
};
const asad = await mkStudent("241-45-013", "Adil", "01711000001");
const nafisa = await mkStudent("241-35-114", "Sharon", "01711000002");
// Last semester's results (so CSE133 counts as a completed prerequisite and there is a CGPA)
for (const [sid, code, total] of [["241-45-013", "CSE113", "86"], ["241-45-013", "CSE133", "78"], ["241-35-114", "CSE113", "74"], ["241-35-114", "CSE133", "81"]])
  await student.importResult(reg, { student_id: sid, course: code, semester: "261", section: "42_A", total }, "seed");
await run("UPDATE semesters SET status = 'closed' WHERE id = ?", s261);
// Sharon registered and paid, so Tanvir's section has a classmate on the roster
for (const k of ["CSE221_A", "CSE231_A"]) await student.register(0, nafisa, sections[k]);
await accounts.recordPayment((await get<{ id: number }>("SELECT id FROM users WHERE uni_id = 'CSH-0001'"))!.id, { studentId: nafisa, amount: (await accounts.summary(nafisa)).due, method: "cash", channel: "counter" });

// Results need a course evaluation first; a good result earns a waiver on next semester's tuition
await services.saveEvalForm(exc, s261, ["The teacher explained concepts clearly", "Assessments matched what was taught"], false); // last semester: window closed, grades visible
await services.saveEvalForm(exc, s263, ["The teacher explained concepts clearly", "Assessments matched what was taught"], true);
await finance.saveRule(fin, { name: "Dean's list", min_sgpa: 3.75, min_credits: 3, percent: 25, active: 1 });

// ---------- Transport: one route, one bus, one driver; trips for the next two weeks
const driverUni = await transport.addCrew(tro, { name: "Abdul Karim", kind: "driver", phone: "01715000001", email: "abdul.karim@diu.edu.bd", licence_no: "DK-0412-2019", licence_expiry: "2027-03-31", password: PW });
const route = await transport.saveRoute(tro, { number: "05", name: "Mirpur – Campus", distance_km: 24, fee: 6000, return_time: "16:30", active: 1 });
for (const [name, p, d, lat, lng] of [["Mirpur 10", "07:00", "17:40", 23.8069, 90.3687], ["Agargaon", "07:25", "17:15", 23.7786, 90.3794], ["Campus", "07:45", "16:30", 23.8773, 90.3206]] as const)
  await transport.addStop(tro, route, { name, pickup_time: p, drop_time: d, lat, lng });
await transport.saveBus(tro, { number: "12", registration: "Dhaka Metro-Ba 11-4521", capacity: 40, status: "active", route_id: route,
  driver_id: (await get<{ id: number }>("SELECT c.id FROM crew c JOIN users u ON u.id = c.user_id WHERE u.uni_id = ?", driverUni))!.id, assistant_id: null,
  fitness_expiry: "2027-06-30", insurance_expiry: "2027-06-30" });
for (let o = 0; o <= 14; o++) { try { await transport.generateTrips(tro, day(o)); } catch { /* Friday or holiday */ } }

// ---------- Admission: one open cycle for the next intake
await admission.createCycle(ads, { name: "Spring 2027 undergraduate", intake_semester_id: s271, deadline: day(60), test_date: day(7),
  docs: ["SSC certificate", "HSC certificate", "Passport-size photo"], fields: [], seats: { [prog]: 30 } });

// ---------- One notice, then a clean slate for notifications and logs
await core.postNotice(reg, { title: "Fall 2026 registration is open", body: "Register your courses from Course registration. Pick the section that suits you; you can request one section change per course.", category: "Academic", audience: "all" });
await run("DELETE FROM notifications");
await run("DELETE FROM outbox");
await run("DELETE FROM job_runs");
await run("INSERT INTO job_runs (job, day) SELECT 'transport_expiry', ? UNION SELECT 'fee_due', ? UNION SELECT 'sla', ?", today(), today(), today());
console.log(`Demo data ready: Adil ${asad}, Sharon ${nafisa}, ${Object.keys(sections).length} sections. Password for every account: ${PW}`);
