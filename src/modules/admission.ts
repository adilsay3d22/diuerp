// M1 Admission: applicant accounts, cycles, applications, tests, merit lists, offers (ADM-U-1..7, ADM-A-1..6; W1, W2).
import { all, get, run, insert, audit, tx, num, today, each } from "../lib/db.ts";
import { createUser, notify, usersWithRole, issueCode as coreIssue, checkCode } from "./core.ts";
import { emit, on } from "./events.ts";
import { enrollStudent, semester } from "./registrar.ts";
import { applicationAccount, fee, raiseApplicationCharge } from "./accounts.ts";

export type Cycle = { id: number; name: string; intake_semester_id: number; deadline: string; status: string; docs_json: string; fields_json: string;
  test_date: string | null; intake: string };
export type Application = { id: number; user_id: number; cycle_id: number; program_id: number; status: string; data_json: string; reason: string | null;
  test_slot: string | null; test_room: string | null; test_score: number | null; merit_rank: number | null; student_id: number | null;
  submitted_at: string | null; decided_at: string | null; accepted_at: string | null; at: string;
  name: string; email: string; phone: string | null; program: string; cycle: string; ref: string };

export const appRef = (id: number) => `APP-${String(id).padStart(5, "0")}`;
export const STEPS = ["draft", "submitted", "under_review", "shortlisted", "test_scheduled", "selected", "accepted", "admission_paid", "enrolled"] as const;
export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", submitted: "Submitted · fee due", under_review: "Under review", shortlisted: "Shortlisted", test_scheduled: "Test scheduled",
  selected: "Selected", waitlisted: "Waitlisted", rejected: "Not selected", accepted: "Offer accepted · fee due", admission_paid: "Ready to enroll",
  enrolled: "Enrolled", declined: "Offer declined",
};

// ---------- Applicant accounts (ADM-U-1): verified by a one-time code
export async function signup(u: { name: string; email: string; phone: string; password: string }) {
  if (!u.name || !/^\S+@\S+\.\S+$/.test(u.email) || !/^01\d{9}$/.test(u.phone)) throw new Error("Enter your name, a valid email and an 11-digit mobile number (01XXXXXXXXX).");
  if (u.password.length < 8) throw new Error("Use at least 8 characters for your password.");
  if ((await get("SELECT 1 FROM users WHERE email = ?", u.email.toLowerCase()))) throw new Error("An account with this email already exists. Sign in instead.");
  return await tx(async () => {
    const n = ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'applicant'"))?.n ?? 0) + 1;
    const id = await createUser({ uni_id: `APL-${String(n).padStart(5, "0")}`, email: u.email, name: u.name, phone: u.phone, password: u.password }, [{ role: "applicant" }]);
    await run("UPDATE users SET status = 'unverified' WHERE id = ?", id);
    return await issueCode(id);
  });
}
export const issueCode = async (userId: number) => await coreIssue(userId, "Verify your DIU applicant account");
export async function verify(email: string, code: string) {
  const u = await get<{ id: number }>("SELECT id FROM users WHERE email = ? AND status = 'unverified'", email.toLowerCase());
  if (!u || !(await checkCode(u.id, code))) throw new Error("That code is wrong or has expired. Request a new one.");
  await run("UPDATE users SET status = 'active' WHERE id = ?", u.id);
  await audit(u.id, "verify", "user", u.id);
}

// ---------- Cycles (ADM-A-1)
const CYCLE_SQL = "SELECT c.*, s.name AS intake FROM admission_cycles c JOIN semesters s ON s.id = c.intake_semester_id";
export const cycles = async () => await all<Cycle>(`${CYCLE_SQL} ORDER BY c.id DESC`);
export const openCycles = async () => await all<Cycle>(`${CYCLE_SQL} WHERE c.status = 'open' AND c.deadline >= ? ORDER BY c.deadline`, today());
export const cycle = async (id: number) => await get<Cycle>(`${CYCLE_SQL} WHERE c.id = ?`, id);
export const cyclePrograms = async (cycleId: number) => await all<{ program_id: number; name: string; seats: number; applied: number; selected: number }>(
  `SELECT cp.program_id, p.name, cp.seats,
   (SELECT COUNT(*) FROM applications a WHERE a.cycle_id = cp.cycle_id AND a.program_id = cp.program_id AND a.status != 'draft') AS applied,
   (SELECT COUNT(*) FROM applications a WHERE a.cycle_id = cp.cycle_id AND a.program_id = cp.program_id AND a.status IN ('selected','accepted','admission_paid','enrolled')) AS selected
   FROM cycle_programs cp JOIN programs p ON p.id = cp.program_id WHERE cp.cycle_id = ? ORDER BY p.name`, cycleId);

export async function createCycle(by: number, c: { name: string; intake_semester_id: number; deadline: string; test_date: string; docs: string[]; fields: string[]; seats: Record<number, number> }) {
  if (!c.name || !c.deadline) throw new Error("Name and deadline are required.");
  if (!Object.values(c.seats).some((n) => n > 0)) throw new Error("Give at least one program some seats.");
  return await tx(async () => {
    const id = await insert("INSERT INTO admission_cycles (name, intake_semester_id, deadline, test_date, docs_json, fields_json, created_by) VALUES (?,?,?,?,?,?,?)",
      c.name, c.intake_semester_id, c.deadline, c.test_date || null, JSON.stringify(c.docs), JSON.stringify(c.fields), by);
    for (const [pid, seats] of Object.entries(c.seats)) if (seats > 0) await run("INSERT INTO cycle_programs VALUES (?,?,?)", id, Number(pid), seats);
    await audit(by, "create", "admission_cycle", id, undefined, c);
    return id;
  });
}
export async function setCycleStatus(by: number, id: number, status: string) {
  await run("UPDATE admission_cycles SET status = ? WHERE id = ?", status, id);
  await audit(by, "set_status", "admission_cycle", id, undefined, status);
}

// ---------- Applications (ADM-U-2, U-3, U-5)
const APP_SQL = `SELECT a.*, u.name, u.email, u.phone, p.name AS program, c.name AS cycle, 'APP-' || substr('00000' || a.id, -5) AS ref
  FROM applications a JOIN users u ON u.id = a.user_id JOIN programs p ON p.id = a.program_id JOIN admission_cycles c ON c.id = a.cycle_id`;
export const application = async (id: number) => await get<Application>(`${APP_SQL} WHERE a.id = ?`, id);
export const myApplications = async (userId: number) => await all<Application>(`${APP_SQL} WHERE a.user_id = ? ORDER BY a.id DESC`, userId);
export const cycleApplications = async (cycleId: number, status?: string) =>
  await all<Application>(`${APP_SQL} WHERE a.cycle_id = ? AND a.status != 'draft' AND (? IS NULL OR a.status = ?) ORDER BY a.program_id, a.merit_rank IS NULL, a.merit_rank, a.id`,
    cycleId, status ?? null, status ?? null);
export const docs = async (applicationId: number) => await all<{ id: number; name: string; file_id: number | null; file_name: string | null; status: string; note: string | null; at: string }>(
  `SELECT d.*, f.name AS file_name FROM application_docs d LEFT JOIN files f ON f.id = d.file_id WHERE d.application_id = ?
   AND d.id = (SELECT MAX(id) FROM application_docs d2 WHERE d2.application_id = d.application_id AND d2.name = d.name) ORDER BY d.name`, applicationId);

const editable = (a: { status: string }, c: Cycle) => ["draft", "submitted", "under_review"].includes(a.status) && c.deadline >= today() && c.status === "open";

export async function saveApplication(userId: number, cycleId: number, programId: number, data: Record<string, string>, submit: boolean) {
  const c = await cycle(cycleId);
  if (!c || c.status !== "open" || c.deadline < today()) throw new Error("This admission cycle is closed.");
  if (!(await cyclePrograms(cycleId)).some((p) => p.program_id === programId)) throw new Error("Pick a program offered in this cycle.");
  return await tx(async () => {
    const ex = await get<Application>("SELECT * FROM applications WHERE user_id = ? AND cycle_id = ?", userId, cycleId);
    if (ex && !editable(ex, c)) throw new Error("This application can no longer be edited.");
    const id = ex?.id ?? await insert("INSERT INTO applications (user_id, cycle_id, program_id) VALUES (?,?,?)", userId, cycleId, programId);
    await run("UPDATE applications SET program_id = ?, data_json = ? WHERE id = ?", programId, JSON.stringify(data), id);
    if (submit) {
      const required = ["nid", "dob", "ssc_gpa", "hsc_gpa", "guardian", ...(JSON.parse(c.fields_json) as string[])];
      const missing = required.filter((k) => !data[k]);
      const LABEL: Record<string, string> = { nid: "NID or birth registration number", dob: "date of birth", ssc_gpa: "SSC GPA", hsc_gpa: "HSC GPA", guardian: "guardian" };
      if (missing.length) throw new Error(`Please fill in: ${missing.map((k) => LABEL[k] ?? k).join(", ")}.`);
      const have = (await docs(id)).map((d) => d.name);
      const needDocs = (JSON.parse(c.docs_json) as string[]).filter((d) => !have.includes(d));
      if (needDocs.length) throw new Error(`Upload: ${needDocs.join(", ")}.`);
      if (!ex || ex.status === "draft") {
        await run("UPDATE applications SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?", id);
        await raiseApplicationCharge(userId, id, c.intake_semester_id, "application_fee", "Application fee", await num("application_fee", 1200), "application_fee");
      }
    }
    await audit(userId, submit ? "submit" : "save", "application", id);
    return id;
  });
}

export async function uploadDoc(userId: number, applicationId: number, name: string, fileId: number) {
  const a = await get<Application>("SELECT * FROM applications WHERE id = ? AND user_id = ?", applicationId, userId);
  const c = a && await cycle(a.cycle_id);
  if (!a || !c) throw new Error("Application not found.");
  if (!(JSON.parse(c.docs_json) as string[]).includes(name)) throw new Error("Unknown document.");
  const cur = (await docs(applicationId)).find((d) => d.name === name);
  if (!editable(a, c) && cur?.status !== "flagged") throw new Error("Documents can only be replaced before the deadline or when an officer asks.");
  await insert("INSERT INTO application_docs (application_id, name, file_id) VALUES (?,?,?)", applicationId, name, fileId);
}

// ---------- Review (ADM-A-2)
export async function reviewDoc(by: number, docId: number, ok: boolean, note: string) {
  const d = await get<{ application_id: number; name: string }>("SELECT application_id, name FROM application_docs WHERE id = ?", docId);
  if (!d) throw new Error("Document not found.");
  if (!ok && !note) throw new Error("Tell the applicant what is wrong with the document.");
  await run("UPDATE application_docs SET status = ?, note = ? WHERE id = ?", ok ? "ok" : "flagged", note || null, docId);
  await audit(by, ok ? "approve" : "flag", "application_doc", docId, undefined, note);
  if (!ok) await notify([(await application(d.application_id))!.user_id], `Please re-upload: ${d.name}`, note, `/app/admission/${d.application_id}`);
}
export async function decide(by: number, id: number, approve: boolean, reason: string) {
  const a = await application(id);
  if (!a || a.status !== "under_review") throw new Error("Only applications under review can be decided.");
  if (!approve && !reason) throw new Error("Give the reason for rejection.");
  if (approve && (await docs(id)).some((d) => d.status !== "ok")) throw new Error("Approve every document first.");
  await run("UPDATE applications SET status = ?, reason = ?, decided_at = datetime('now') WHERE id = ?", approve ? "shortlisted" : "rejected", reason || null, id);
  await audit(by, approve ? "shortlist" : "reject", "application", id, undefined, reason);
  await notify([a.user_id], approve ? "Shortlisted for the admission test" : "Application not accepted", approve ? "Your test slot will be announced soon." : reason, `/app/admission/${id}`);
}

// ---------- Tests and merit (ADM-A-3)
export async function scheduleTests(by: number, cycleId: number, date: string, start: string, rooms: string[], perRoom: number) {
  if (!date || !start || !rooms.length || !(perRoom > 0)) throw new Error("Date, start time, rooms and seats per room are required.");
  return await tx(async () => {
    const apps = await cycleApplications(cycleId, "shortlisted");
    await each(apps, async (a, i) => {
      const room = rooms[Math.floor(i / perRoom)];
      if (!room) throw new Error(`Not enough seats: ${apps.length} candidates, ${rooms.length * perRoom} seats.`);
      await run("UPDATE applications SET status = 'test_scheduled', test_slot = ?, test_room = ? WHERE id = ?", `${date} ${start}`, `${room}, seat ${(i % perRoom) + 1}`, a.id);
      await notify([a.user_id], "Admission test scheduled", `${date} at ${start}, ${room}. Download your admit card.`, `/app/admission/${a.id}`);
    });
    await audit(by, "schedule_tests", "admission_cycle", cycleId, undefined, { date, start, rooms, n: apps.length });
    return apps.length;
  });
}
export async function enterScores(by: number, scores: Record<number, number>) {
  await tx(async () => {
    for (const [id, s] of Object.entries(scores)) {
      if (!(s >= 0 && s <= 100)) throw new Error("Scores must be between 0 and 100.");
      await run("UPDATE applications SET test_score = ? WHERE id = ? AND status = 'test_scheduled'", s, Number(id));
    }
  });
  await audit(by, "enter_scores", "application", Object.keys(scores).length);
}
export async function rankMerit(by: number, cycleId: number) {
  await tx(async () => {
    for (const p of (await cyclePrograms(cycleId))) {
      const apps = await all<{ id: number }>(
        `SELECT id FROM applications WHERE cycle_id = ? AND program_id = ? AND test_score IS NOT NULL AND status = 'test_scheduled'
         ORDER BY test_score DESC, CAST(json_extract(data_json, '$.hsc_gpa') AS REAL) DESC, CAST(json_extract(data_json, '$.ssc_gpa') AS REAL) DESC, id`, cycleId, p.program_id);
      await each(apps, async (a, i) => await run("UPDATE applications SET merit_rank = ? WHERE id = ?", i + 1, a.id));
    }
  });
  await audit(by, "rank", "admission_cycle", cycleId);
}
// ADM-A-4: publish; top ranks up to seats are selected, the rest waitlisted.
export async function publishResults(by: number, cycleId: number) {
  return await tx(async () => {
    let n = 0;
    for (const p of (await cyclePrograms(cycleId))) {
      const free = p.seats - p.selected;
      const ranked = await all<{ id: number; user_id: number; merit_rank: number }>(
        "SELECT id, user_id, merit_rank FROM applications WHERE cycle_id = ? AND program_id = ? AND status = 'test_scheduled' AND merit_rank IS NOT NULL ORDER BY merit_rank",
        cycleId, p.program_id);
      await each(ranked, async (a, i) => {
        const sel = i < free;
        await run("UPDATE applications SET status = ?, decided_at = datetime('now') WHERE id = ?", sel ? "selected" : "waitlisted", a.id);
        await notify([a.user_id], sel ? `Selected for ${p.name}` : `Waitlisted for ${p.name}`, sel ? "Accept your offer and pay the admission fee to confirm your seat." : `Merit position ${a.merit_rank}. We will notify you if a seat opens.`, `/app/admission/${a.id}`);
        n++;
      });
    }
    await audit(by, "publish_results", "admission_cycle", cycleId, undefined, { n });
    return n;
  });
}

// ---------- Offer (ADM-U-7)
export async function respondToOffer(userId: number, id: number, accept: boolean) {
  return await tx(async () => {
    const a = await application(id);
    if (!a || a.user_id !== userId || a.status !== "selected") throw new Error("There is no open offer on this application.");
    if (!accept) {
      await run("UPDATE applications SET status = 'declined' WHERE id = ?", id);
      await promoteWaitlist(a.cycle_id, a.program_id);
    } else {
      await run("UPDATE applications SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?", id);
      await raiseApplicationCharge(userId, id, (await cycle(a.cycle_id))!.intake_semester_id, "admission", "Admission fee", await fee(a.program_id, "admission"), "admission");
      if ((await applicationAccount(id)).covered("admission")) await markPaid(id);
    }
    await audit(userId, accept ? "accept_offer" : "decline_offer", "application", id);
  });
}
async function promoteWaitlist(cycleId: number, programId: number) {
  const next = await get<{ id: number; user_id: number }>(
    "SELECT id, user_id FROM applications WHERE cycle_id = ? AND program_id = ? AND status = 'waitlisted' ORDER BY merit_rank LIMIT 1", cycleId, programId);
  if (!next) return;
  await run("UPDATE applications SET status = 'selected', decided_at = datetime('now') WHERE id = ?", next.id);
  await notify([next.user_id], "A seat opened: you are selected", "Accept your offer and pay the admission fee to confirm.", `/app/admission/${next.id}`);
}
async function markPaid(id: number) {
  await run("UPDATE applications SET status = 'admission_paid' WHERE id = ?", id);
  await notify(await usersWithRole("registrar"), `Ready to enroll: ${appRef(id)}`, "Admission fee paid.", "/admin/registrar/enroll");
}

// W1: application and admission fees move the application forward
on("invoice.paid", async ({ applicationId, paymentId }) => {
  if (!applicationId) return;
  const a = (await application(applicationId))!;
  const acc = await applicationAccount(applicationId);
  const p = (await get<{ receipt_no: string; amount: number }>("SELECT receipt_no, amount FROM payments WHERE id = ?", paymentId))!;
  await notify([a.user_id], `Payment received: ৳${p.amount.toLocaleString("en-IN")}`, `Receipt ${p.receipt_no}`, `/receipt/${p.receipt_no}`);
  if (a.status === "submitted" && acc.covered("application_fee")) await run("UPDATE applications SET status = 'under_review' WHERE id = ?", applicationId);
  if (a.status === "accepted" && acc.covered("admission")) await markPaid(applicationId);
});

// ---------- Enrollment (REG-A-6 from an application, W2): the applicant's login becomes the student's login.
export async function enroll(by: number, id: number, batch: string, section: string) {
  return await tx(async () => {
    const a = await application(id);
    if (!a || a.status !== "admission_paid") throw new Error("Only applicants who paid the admission fee can be enrolled.");
    if (!batch || !section) throw new Error("Batch and section are required.");
    const c = (await cycle(a.cycle_id))!;
    const r = await enrollStudent(by, { name: a.name, email: a.email, phone: a.phone ?? "", program_id: a.program_id, batch, section, semester_id: c.intake_semester_id,
      password: "", existingUserId: a.user_id, applicationId: id });
    await run("UPDATE applications SET status = 'enrolled', student_id = ? WHERE id = ?", r.id, id);
    return r;
  });
}
export const readyToEnroll = async () => await all<Application>(`${APP_SQL} WHERE a.status = 'admission_paid' ORDER BY a.id`);

// ADM-A-5 duplicate detection by NID, phone or email within a cycle
export async function duplicates(cycleId: number) {
  const apps = await cycleApplications(cycleId);
  const seen = new Map<string, number[]>();
  for (const a of apps) {
    const d = JSON.parse(a.data_json) as Record<string, string>;
    for (const k of [`nid:${d.nid}`, `phone:${a.phone}`, `email:${a.email}`]) if (!k.endsWith(":undefined")) seen.set(k, [...(seen.get(k) ?? []), a.id]);
  }
  return new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
}

export const intakeName = async (c: Cycle) => (await semester(c.intake_semester_id))?.name ?? "";

// FIN-A-1: cashier looks up applicants by reference or name (only applications with money due or paid)
export const search = async (q: string) => await all<Application>(
  `${APP_SQL} WHERE a.status NOT IN ('draft','enrolled') AND ('APP-' || substr('00000' || a.id, -5) = upper(?) OR u.name LIKE ?) ORDER BY a.id DESC LIMIT 20`, q.trim(), `%${q.trim()}%`);
