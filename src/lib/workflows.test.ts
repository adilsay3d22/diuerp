// Integration checks for cross-module workflows (spec §11) on a throwaway database file.
import { test } from "node:test";
import assert from "node:assert/strict";

// A throwaway file, not :memory: (a libSQL transaction takes over the connection, and a fresh :memory: connection is empty).
process.env.DB_PATH = (await import("node:path")).join((await import("node:os")).tmpdir(), `erp-test-${process.pid}.db`);
(process.env as Record<string, string>).NODE_ENV = "test";
const { run, insert, get } = await import("./db.ts");
const { core, registrar, student, accounts, admission, transport, services, finance, comms, teacher } = await import("../modules/index.ts");

const fac = await insert("INSERT INTO faculties (code, name) VALUES ('F', 'Faculty')");
const dept = await insert("INSERT INTO departments (faculty_id, code, short, name) VALUES (?, '15', 'CSE', 'CSE')", fac);
const prog = await insert("INSERT INTO programs (dept_id, name, degree, total_credits) VALUES (?, 'B.Sc. in CSE', 'B.Sc.', 148)", dept);
for (const [h, a] of [["admission", 20000], ["semester_fee", 9000], ["tuition_per_credit", 4000], ["lab_fee", 3000]] as const) await accounts.setFee(0, prog, h, a);
const sem = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, reg_open, due_date) VALUES ('263','Fall 2026','2026-09-01','2026-12-31','active',1,'2099-01-01')");
const officer = await core.createUser({ uni_id: "ADS", email: "ads@x.bd", name: "Officer", password: "x" }, [{ role: "admissions_officer" }]);
const course = await registrar.addCourse(0, { dept_id: dept, code: "CSE101", title: "Intro", credits: 3, type: "theory", prereqs: [] });
const room = await insert("INSERT INTO rooms (number, capacity, type) VALUES ('R1', 40, 'theory')");
const slot = await insert("INSERT INTO time_slots (day, start, \"end\") VALUES ('Sun', '08:30', '10:00')");
const off = await registrar.createOffering(0, { course_id: course, semester_id: sem, section: "1_A", teacher_id: null, capacity: 40, slots: [{ slot_id: slot, room_id: room }] });

let studentId = 0;

test("W1 + W2: applicant pays, is selected, and becomes a student with the same login and ledger", async () => {
  const cyc = await admission.createCycle(officer, { name: "Cycle", intake_semester_id: sem, deadline: "2099-01-01", test_date: "", docs: ["SSC"], fields: [], seats: { [prog]: 1 } });
  const code = await admission.signup({ name: "Test Applicant", email: "a@example.com", phone: "01800000000", password: "password1" });
  await admission.verify("a@example.com", code);
  const uid = (await get<{ id: number }>("SELECT id FROM users WHERE email = 'a@example.com'"))!.id;
  const data = { nid: "1", dob: "2006-01-01", ssc_gpa: "5", hsc_gpa: "5", guardian: "G" };
  const app = await admission.saveApplication(uid, cyc, prog, data, false);
  const file = await insert("INSERT INTO files (path, name, uploaded_by) VALUES ('x', 'x.pdf', ?)", uid);
  await admission.uploadDoc(uid, app, "SSC", file);
  await admission.saveApplication(uid, cyc, prog, data, true);
  assert.equal((await admission.application(app))!.status, "submitted");
  await accounts.recordPayment(null, { applicationId: app, amount: 1200, method: "bKash", channel: "online", reference: "T1" });
  assert.equal((await admission.application(app))!.status, "under_review", "W1: fee paid moves to review");
  // Retried gateway callback must not double-credit (NFR-7)
  await accounts.recordPayment(null, { applicationId: app, amount: 1200, method: "bKash", channel: "online", reference: "T1" });
  assert.equal((await accounts.applicationAccount(app)).paid, 1200);
  for (const d of (await admission.docs(app))) await admission.reviewDoc(officer, d.id, true, "");
  await admission.decide(officer, app, true, "");
  await admission.scheduleTests(officer, cyc, "2026-10-10", "10:00", ["R1"], 10);
  await admission.enterScores(officer, { [app]: 80 });
  await admission.rankMerit(officer, cyc);
  await admission.publishResults(officer, cyc);
  assert.equal((await admission.application(app))!.status, "selected");
  await admission.respondToOffer(uid, app, true);
  await accounts.recordPayment(null, { applicationId: app, amount: 20000, method: "Nagad", channel: "online", reference: "T2" });
  assert.equal((await admission.application(app))!.status, "admission_paid");
  const r = await admission.enroll(officer, app, "44", "A");
  studentId = r.id;
  assert.equal((await get<{ uni_id: string }>("SELECT uni_id FROM users WHERE id = ?", uid))!.uni_id, r.studentId, "W2: login becomes the student ID");
  assert.deepEqual((await core.userRoles(uid)).map((x) => x.role), ["student"]);
  const s = await accounts.summary(studentId);
  assert.equal(s.paid, 21200, "applicant payments move to the student ledger");
  assert.equal(s.payable, 21200, "admission fee is not charged twice");
});

test("W3: registration adds tuition to the invoice", async () => {
  await student.register(0, studentId, off);
  const inv = (await accounts.invoices(studentId)).find((i) => i.semester_id === sem)!;
  assert.ok(inv.lines.some((l) => l.description.startsWith("Tuition CSE101") && l.amount === 12000));
  assert.ok(inv.lines.some((l) => l.head === "semester_fee" && l.amount === 9000));
});

test("W8: a transport pass activates only when its charge is paid", async () => {
  const officerT = await core.createUser({ uni_id: "TRO", email: "t@x.bd", name: "T", password: "x" }, [{ role: "transport_officer" }]);
  const route = await transport.saveRoute(officerT, { number: "05", name: "Mirpur", distance_km: 20, fee: 6000, return_time: "16:30", active: 1 });
  await transport.addStop(officerT, route, { name: "Mirpur 10", pickup_time: "07:00", drop_time: "" });
  await transport.saveBus(officerT, { number: "12", registration: "X", capacity: 1, status: "active", route_id: route, driver_id: null, assistant_id: null, fitness_expiry: "", insurance_expiry: "" });
  const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", studentId))!.user_id;
  const pass = await transport.applyPass(uid, studentId, route, (await transport.stops(route))[0].id);
  await transport.decidePass(officerT, pass, true, "");
  assert.equal((await transport.studentPass(studentId, sem))!.status, "awaiting_payment");
  const due = (await accounts.summary(studentId)).due;
  await accounts.recordPayment(null, { studentId, amount: due - 1, method: "bKash", channel: "online", reference: "T3" });
  assert.equal((await transport.studentPass(studentId, sem))!.status, "awaiting_payment", "partly paid: oldest charges settle first");
  await accounts.recordPayment(0, { studentId, amount: 1, method: "cash", channel: "counter" });
  assert.equal((await transport.studentPass(studentId, sem))!.status, "active");
  assert.equal((await transport.studentPass(studentId, sem))!.bus, "12");
  // Capacity: the only seat is taken
  await run("INSERT INTO students (user_id, student_id, reg_id, program_id, batch, section) VALUES (?, 'S2', 'R2', ?, '44', 'A')",
    await core.createUser({ uni_id: "S2", email: "s2@x.bd", name: "S2", password: "x" }, [{ role: "student" }]), prog);
  const s2 = (await get<{ id: number; user_id: number }>("SELECT id, user_id FROM students WHERE student_id = 'S2'"))!;
  await assert.rejects(async () => await transport.applyPass(s2.user_id, s2.id, route, (await transport.stops(route))[0].id), /full/);
});

test("W10: a paid certificate request moves to processing; W4: dropping during add/drop reverses charges", async () => {
  const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", studentId))!.user_id;
  await run("UPDATE settings SET value = '1000' WHERE key = 'certificate_fee'");
  const req = await services.submitRequest(uid, studentId, "certificate", { copies: 2, detail: "Bank" });
  assert.equal((await services.request(req))!.status, "fee_due");
  assert.ok((await accounts.charges(studentId)).some((c) => c.description.includes(`#${req}`)), "fee line raised in Accounts");
  await accounts.recordPayment(null, { studentId, amount: (await accounts.summary(studentId)).due, method: "bKash", channel: "online", reference: "T10" });
  assert.equal((await services.request(req))!.status, "processing");

  await run("UPDATE semesters SET adddrop_open = 1 WHERE id = ?", sem);
  const before = await accounts.summary(studentId);
  const e = (await get<{ id: number }>("SELECT id FROM enrollments WHERE student_id = ? AND offering_id = ? AND status = 'confirmed'", studentId, off))!;
  await services.dropOwn(uid, studentId, e.id);
  const after = await accounts.summary(studentId);
  assert.equal(after.credits - before.credits, 12000, "tuition for the dropped course is credited back");
});

test("W7: a result-based waiver rule grants next semester's waiver automatically", async () => {
  const next = await insert("INSERT INTO semesters (code, name, start_date, end_date, status, due_date) VALUES ('271','Spring 2027','2027-01-10','2027-04-30','upcoming','2027-02-20')");
  await finance.saveRule(0, { name: "Dean's list", min_sgpa: 3.75, min_credits: 3, percent: 25, active: 1 });
  const o2 = await registrar.createOffering(0, { course_id: await registrar.addCourse(0, { dept_id: dept, code: "CSE102", title: "Two", credits: 3, type: "theory", prereqs: [] }),
    semester_id: sem, section: "1_A", teacher_id: null, capacity: 40, slots: [] });
  await insert("INSERT INTO enrollments (student_id, offering_id, status) VALUES (?,?, 'confirmed')", studentId, o2);
  await teacher.addAssessment(0, { offering_id: o2, type: "final", title: "Final", max_marks: 100, weight: 100, instructions: null, due_at: null });
  await teacher.enterMarks(0, (await teacher.assessments(o2))[0].id, { [studentId]: { score: "90" } });
  await teacher.submitGradesheet(0, o2);
  const head = await core.createUser({ uni_id: "HD", email: "hd@x.bd", name: "Head", password: "x" }, [{ role: "dept_head", dept_id: dept }]);
  await teacher.decideGradesheet(head, o2, true, "");
  await student.publishResults(0, sem);
  const g = await get<{ percent: number }>("SELECT percent FROM waiver_grants WHERE student_id = ? AND semester_id = ?", studentId, next);
  assert.equal(g?.percent, 25);
  // Tuition registered later in that semester is waived too
  const o3 = await registrar.createOffering(0, { course_id: await registrar.addCourse(0, { dept_id: dept, code: "CSE201", title: "Three", credits: 3, type: "theory", prereqs: [] }),
    semester_id: next, section: "1_A", teacher_id: null, capacity: 40, slots: [] });
  await run("UPDATE semesters SET reg_open = 1 WHERE id = ?", next);
  await student.register(0, studentId, o3);
  const lines = (await accounts.charges(studentId)).filter((c) => c.semester_id === next);
  assert.equal(lines.filter((l) => l.head === "waiver").reduce((t, l) => t + l.amount, 0), -3000, "25% of ৳12,000 tuition");
});

test("Gateway: signed callback posts once; a forged or replayed callback cannot double-credit", async () => {
  const due = (await accounts.summary(studentId)).due;
  await accounts.recordPayment(0, { studentId, amount: Math.max(1, -due + 5000), method: "cash", channel: "counter" }); // make sure something is due
  await run("INSERT INTO invoice_lines (invoice_id, head, description, amount, ref) VALUES (?, 'adjustment', 'Test charge', 5000, 'gw-test')", await accounts.ensureInvoice(studentId, sem));
  const amount = (await accounts.summary(studentId)).due;
  const url = await finance.startGateway({ studentId, amount, method: "bKash", returnTo: "/app/fees" });
  const token = url.split("/").pop()!;
  await assert.rejects(async () => await finance.completeGateway(token, "success", amount, "GW1", "forged"), /signature/);
  const paidBefore = (await accounts.summary(studentId)).paid;
  const ok = await finance.completeGateway(token, "success", amount, "GW1", finance.sign(token, "success", amount, "GW1"));
  assert.equal(ok.status, "paid");
  await finance.completeGateway(token, "success", amount, "GW1", finance.sign(token, "success", amount, "GW1"));
  assert.equal((await accounts.summary(studentId)).paid - paidBefore, amount, "replay does not post again");
});

test("Help desk routes to the right office; TA delegation is scoped and expires", async () => {
  const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", studentId))!.user_id;
  const tro = await core.createUser({ uni_id: "TR2", email: "tr2@x.bd", name: "Transport", password: "x" }, [{ role: "transport_officer" }]);
  const t = await comms.createTicket(uid, { category: "Transport complaint", subject: "Late bus", body: "Twenty minutes late." });
  assert.equal(comms.canSeeTicket(tro, await core.userRoles(tro), (await comms.ticket(t))!), "staff");
  assert.equal(comms.canSeeTicket(officer, await core.userRoles(officer), (await comms.ticket(t))!), null, "admissions office cannot see a transport ticket");

  const teacherUser = await core.createUser({ uni_id: "T9", email: "t9@x.bd", name: "Teacher", password: "x" }, [{ role: "teacher" }]);
  const tid = await insert("INSERT INTO teachers (user_id, employee_id, dept_id, designation) VALUES (?, 'T9', ?, 'Lecturer')", teacherUser, dept);
  await run("UPDATE offerings SET teacher_id = ? WHERE id = ?", tid, off);
  await comms.delegate(teacherUser, off, "S2", "attendance", 7);
  const ta = (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = 'S2'"))!.id;
  assert.equal(await comms.delegatedScope(ta, off), "attendance");
  assert.ok((await core.userRoles(ta)).some((r) => r.role === "ta"));
  await run("UPDATE delegations SET expires_at = datetime('now', '-1 minute')");
  assert.equal(await comms.delegatedScope(ta, off), null, "expired delegation grants nothing");
});

test("Section change: one request per course, even after a rejection", async () => {
  const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", studentId))!.user_id;
  const c = await registrar.addCourse(0, { dept_id: dept, code: "CSE301", title: "Sections", credits: 3, type: "theory", prereqs: [] });
  const a = await registrar.createOffering(0, { course_id: c, semester_id: sem, section: "1_A", teacher_id: null, capacity: 40, slots: [] });
  const b = await registrar.createOffering(0, { course_id: c, semester_id: sem, section: "1_B", teacher_id: null, capacity: 40, slots: [] });
  await run("UPDATE semesters SET reg_open = 1 WHERE id = ?", sem);
  await student.register(0, studentId, a);
  const req = await services.submitRequest(uid, studentId, "section_change", { offering_id: a, target_offering_id: b, detail: "Clash" });
  const head = (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = 'HD'"))!.id;
  await services.decideRequest(head, req, "reject", "No seats in lab");
  await assert.rejects(async () => await services.submitRequest(uid, studentId, "section_change", { offering_id: a, target_offering_id: b, detail: "Again" }), /one section change/);
  assert.match((await student.checkRegistration(studentId, a))[0], /Already registered|Already completed/);
});
