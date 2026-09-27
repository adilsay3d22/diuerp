// Dry run of the classroom demo against a copy of the demo database. Run: DB_PATH=<copy> node rehearse.ts
import assert from "node:assert/strict";
const { get, insert, today } = await import("./src/lib/db.ts");
const { core, registrar, student, teacher, accounts, admission, transport, services, finance, comms } = await import("./src/modules/index.ts");

const uid = async (uni: string) => (await get<{ id: number }>("SELECT id FROM users WHERE uni_id = ?", uni))!.id;
const off = async (code: string, sec: string) => (await get<{ id: number }>("SELECT o.id FROM offerings o JOIN courses c ON c.id = o.course_id WHERE c.code = ? AND o.section = ? AND o.semester_id = 2", code, sec))!.id;
const asadU = await uid("241-45-013"), asad = (await registrar.studentByUser(asadU))!.id;
const sem = await registrar.currentSemester();
const step = (n: string) => console.log("✓", n);

// Part 1: student
await student.register(asadU, asad, await off("CSE221", "42_A")); await student.register(asadU, asad, await off("CSE231", "42_A"));
step(`registered 2 courses; invoice due ৳${(await accounts.summary(asad)).due}`);
const due1 = (await accounts.summary(asad)).due;
const url = await finance.startGateway({ studentId: asad, amount: due1, method: "bKash", returnTo: "/app/fees" });
const tok = url.split("/").pop()!;
assert.equal((await finance.completeGateway(tok, "success", due1, "DEMO1", finance.sign(tok, "success", due1, "DEMO1"))).status, "paid");
assert.equal((await accounts.summary(asad)).due, 0); step("paid online");
await services.submitRequest(asadU, asad, "section_change", { offering_id: await off("CSE231", "42_A"), target_offering_id: await off("CSE231", "42_B"), detail: "Clash with my job" });
step("section change requested");
const route = (await transport.routes())[0];
const pass = await transport.applyPass(asadU, asad, route.id, (await transport.stops(route.id))[0].id); step("pass applied");
const th = await comms.startThread(asadU, [await uid("710001301")], "Question about the mid-term", "Sir, is chapter 4 included?"); step("message sent");

// Part 2: teacher
const tan = await uid("710001301");
const a221 = await off("CSE221", "42_A");
const sl = (await registrar.slotsFor([a221]))[0];
const roster = await teacher.roster(a221);
assert.equal(roster.length, 2);
await teacher.saveAttendance(tan, a221, today(), sl.slot_id, sl.room_id, Object.fromEntries(roster.map((r) => [r.student_id, "present"])), "");
const [mid, fin] = await teacher.assessments(a221);
const nafisa = roster.find((r) => r.student_id !== asad)!.student_id;
await teacher.enterMarks(tan, mid.id, { [asad]: { score: "22" }, [nafisa]: { score: "18" } });
await teacher.enterMarks(tan, fin.id, { [asad]: { score: "36" }, [nafisa]: { score: "30" } });
await teacher.togglePublish(tan, mid.id);
const g = (await teacher.gradeSheet(a221)).rows.find((r) => r.student_id === asad)!;
step(`marks: Adil total ${g.total} = ${g.letter}`);
await teacher.submitGradesheet(tan, a221); await comms.postMessage(tan, th, "Yes, chapters 1 to 4."); step("grade sheet submitted, reply sent");

// Part 3: department head, exam controller, transport officer
const head = await uid("710001234");
await teacher.decideGradesheet(head, a221, true, "");
const req = (await services.requests(["section_change"], ["submitted"]))[0];
await services.decideRequest(head, req.id, "approve", ""); step("dept head approved grade sheet and section change");
await student.publishResults(await uid("EXC-0001"), sem.id); step("results published");
await transport.decidePass(await uid("TRO-0001"), pass, true, "");
step(`pass approved, transport fee on invoice: due ৳${(await accounts.summary(asad)).due}`);

// Part 4: student sees it all
assert.equal((await student.pendingEvaluations(asad, sem.id)).length, 2);
for (const e of (await student.pendingEvaluations(asad, sem.id))) await student.submitEvaluation(asad, e.offering_id, 5, "", { "The teacher explained concepts clearly": 5, "Assessments matched what was taught": 4 });
const tr = (await student.transcript(asad)).at(-1)!;
step(`results unlocked: ${tr.name} SGPA ${tr.sgpa}, CGPA ${tr.cgpa}`);
const grant = await get<{ percent: number }>("SELECT percent FROM waiver_grants WHERE student_id = ?", asad);
step(`waiver for next semester: ${grant?.percent}%`);
assert.equal((await student.enrollments(asad, sem.id, ["confirmed"])).find((e) => e.code === "CSE231")!.section, "42_B");
const due2 = (await accounts.summary(asad)).due;
const u2 = (await finance.startGateway({ studentId: asad, amount: due2, method: "Nagad", returnTo: "/app/transport" })).split("/").pop()!;
await finance.completeGateway(u2, "success", due2, "DEMO2", finance.sign(u2, "success", due2, "DEMO2"));
assert.equal((await transport.studentPass(asad, sem.id))!.status, "active"); step("transport fee paid, pass active on bus " + (await transport.studentPass(asad, sem.id))!.bus);

// Part 5: driver
const drv = await uid("TRN-0001");
const trip = (await transport.crewTrips(drv, today())).find((t) => t.direction === "to_campus");
if (trip) { await transport.startTrip(drv, trip.id); await transport.markBoarded(drv, trip.id, { token: transport.passToken(pass) }, "qr"); step("driver started trip and scanned Adil's pass"); }
else console.log("! no trip today (Friday/holiday) — skip the driver part or generate trips for another day");

// Part 6: admission end to end
const code = await admission.signup({ name: "Demo Applicant", email: "demo.applicant@example.com", phone: "01899000000", password: "password123" });
await admission.verify("demo.applicant@example.com", code);
const apU = (await get<{ id: number }>("SELECT id FROM users WHERE email = 'demo.applicant@example.com'"))!.id;
const cyc = (await admission.openCycles())[0];
const data = { nid: "19992690001234", dob: "2007-05-10", ssc_gpa: "5", hsc_gpa: "4.83", guardian: "Parent, 01711000000", address: "Mirpur, Dhaka" };
const app = await admission.saveApplication(apU, cyc.id, (await registrar.programs())[0].id, data, false);
for (const d of JSON.parse(cyc.docs_json) as string[]) await admission.uploadDoc(apU, app, d, await insert("INSERT INTO files (path, name, uploaded_by) VALUES ('x', ?, ?)", `${d}.pdf`, apU));
await admission.saveApplication(apU, cyc.id, (await registrar.programs())[0].id, data, true);
assert.equal(admission.appRef(app), "APP-00001");
await accounts.recordPayment(await uid("CSH-0001"), { applicationId: app, amount: 1200, method: "cash", channel: "counter" });
assert.equal((await admission.application(app))!.status, "under_review"); step("applicant submitted, paid at counter → under review");
const ad = await uid("ADS-0001");
for (const d of (await admission.docs(app))) await admission.reviewDoc(ad, d.id, true, "");
await admission.decide(ad, app, true, "");
await admission.scheduleTests(ad, cyc.id, cyc.test_date!, "10:00", ["AB4-501"], 40);
await admission.enterScores(ad, { [app]: 82 }); await admission.rankMerit(ad, cyc.id); await admission.publishResults(ad, cyc.id);
assert.equal((await admission.application(app))!.status, "selected"); step("admissions: verified, test, score, published → selected");
await admission.respondToOffer(apU, app, true);
const u3 = (await finance.startGateway({ applicationId: app, amount: (await accounts.applicationAccount(app)).due, method: "bKash", returnTo: "/app" })).split("/").pop()!;
await finance.completeGateway(u3, "success", 25000, "DEMO3", finance.sign(u3, "success", 25000, "DEMO3"));
assert.equal((await admission.application(app))!.status, "admission_paid");
const r = await admission.enroll(await uid("REG-0001"), app, "44", "A");
step(`registrar enrolled applicant as ${r.studentId}; roles now: ${(await core.userRoles(apU)).map((x) => x.role)}`);
console.log(`collected today: ৳${(await accounts.dashboard(sem.id)).collection.reduce((t, c) => t + c.total, 0).toLocaleString("en-IN")}`);
console.log("REHEARSAL OK");
