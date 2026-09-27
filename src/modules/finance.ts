// M4 (Phase 7): service fees (W10), automatic and scholarship waivers (FIN-A-7, FIN-U-7; W7), installment plans and refunds (FIN-U-8),
// reminders (FIN-A-12), online payment gateway (FIN-U-4), reconciliation and bank deposits (FIN-A-10).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { all, get, run, insert, audit, tx, num, today } from "../lib/db.ts";
import { gpa } from "../lib/rules.ts";
import { notify } from "./core.ts";
import { on } from "./events.ts";
import { semesters, semester, currentSemester, studentById } from "./registrar.ts";
import { approvalHandlers, applicationAccount, ensureInvoice, invoices, nextReceipt, recordPayment, requestApproval, summary } from "./accounts.ts";

const line = async (invoiceId: number, head: string, description: string, amount: number, ref: string, by: number | null) =>
  await insert("INSERT INTO invoice_lines (invoice_id, head, description, amount, ref, by_user) VALUES (?,?,?,?,?,?)", invoiceId, head, description, amount, ref, by);

// ---------- W10: service application fees land on the current semester invoice
on("application.submitted", async ({ requestId, studentId, amount, description, by }) => {
  const inv = await ensureInvoice(studentId, (await currentSemester()).id);
  if (!(await get("SELECT 1 FROM invoice_lines WHERE ref = ?", `req:${requestId}`))) await line(inv, "service", description, amount, `req:${requestId}`, by);
});

// ---------- Waiver grants: a percentage of a semester's tuition, kept in step as courses are added or dropped
export async function syncGrants(studentId: number, semesterId: number) {
  const grants = await all<{ id: number; percent: number; detail: string }>("SELECT id, percent, detail FROM waiver_grants WHERE student_id = ? AND semester_id = ?", studentId, semesterId);
  if (!grants.length) return;
  const inv = await ensureInvoice(studentId, semesterId);
  const tuition = (await all<{ amount: number }>("SELECT amount FROM invoice_lines WHERE invoice_id = ? AND head = 'tuition_per_credit'", inv)).reduce((t, l) => t + l.amount, 0);
  for (const g of grants) {
    const credited = -(await all<{ amount: number }>("SELECT amount FROM invoice_lines WHERE invoice_id = ? AND ref LIKE ?", inv, `grant:${g.id}:%`)).reduce((t, l) => t + l.amount, 0);
    const diff = Math.round((tuition * g.percent) / 100) - credited;
    if (diff) await line(inv, "waiver", `${g.detail} ${g.percent}% on tuition`, -diff, `grant:${g.id}:${Date.now()}${Math.random().toString(36).slice(2, 6)}`, null);
  }
}
export async function grant(studentId: number, semesterId: number, source: string, percent: number, detail: string) {
  await run("INSERT OR IGNORE INTO waiver_grants (student_id, semester_id, source, percent, detail) VALUES (?,?,?,?,?)", studentId, semesterId, source, percent, detail);
  await syncGrants(studentId, semesterId);
}
on("enrollment.confirmed", async ({ studentId, offeringId }) => {
  const s = await get<{ semester_id: number }>("SELECT semester_id FROM offerings WHERE id = ?", offeringId);
  if (s) await syncGrants(studentId, s.semester_id);
});
on("enrollment.dropped", async ({ studentId, offeringId }) => {
  const s = await get<{ semester_id: number }>("SELECT semester_id FROM offerings WHERE id = ?", offeringId);
  if (s) await syncGrants(studentId, s.semester_id);
});
export const grantsFor = async (studentId: number) => await all<{ id: number; semester: string; source: string; percent: number; detail: string; at: string }>(
  "SELECT g.*, s.name AS semester FROM waiver_grants g JOIN semesters s ON s.id = g.semester_id WHERE g.student_id = ? ORDER BY s.code DESC", studentId);

// ---------- Result-based waiver rules, applied automatically after results publish (FIN-A-7, W7)
export const rules = async () => await all<{ id: number; name: string; min_sgpa: number; min_credits: number; percent: number; active: number }>("SELECT * FROM waiver_rules ORDER BY percent DESC");
export async function saveRule(by: number, r: { id?: number; name: string; min_sgpa: number; min_credits: number; percent: number; active: number }) {
  if (!r.name || !(r.min_sgpa >= 0 && r.min_sgpa <= 4) || !(r.percent > 0 && r.percent <= 100)) throw new Error("Name, SGPA 0–4 and a percentage 1–100 are required.");
  if (r.id) await run("UPDATE waiver_rules SET name = ?, min_sgpa = ?, min_credits = ?, percent = ?, active = ? WHERE id = ?", r.name, r.min_sgpa, r.min_credits, r.percent, r.active, r.id);
  else await insert("INSERT INTO waiver_rules (name, min_sgpa, min_credits, percent) VALUES (?,?,?,?)", r.name, r.min_sgpa, r.min_credits, r.percent);
  await audit(by, "save", "waiver_rule", r.id ?? "new", undefined, r);
}
export async function applyRules(semesterId: number, studentIds: number[]) {
  const pub = (await semester(semesterId))!;
  const next = (await semesters()).filter((s) => s.code > pub.code).sort((a, b) => a.code.localeCompare(b.code))[0];
  if (!next) return 0;
  const active = (await rules()).filter((r) => r.active);
  let n = 0;
  for (const sid of studentIds) {
    const rows = await all<{ credits: number; gp_c: number }>(
      `SELECT c.credits, r.gp_c FROM results r JOIN offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
       WHERE r.student_id = ? AND o.semester_id = ? AND r.id = (SELECT MAX(id) FROM results x WHERE x.student_id = r.student_id AND x.offering_id = r.offering_id)`, sid, semesterId);
    const sg = gpa(rows.map((r) => ({ credits: r.credits, gp: r.gp_c / 100 })));
    const cr = rows.reduce((t, r) => t + r.credits, 0);
    const best = active.find((r) => sg >= r.min_sgpa && cr >= r.min_credits);
    if (!best) continue;
    await grant(sid, next.id, "rule", best.percent, `${best.name} (${pub.name} SGPA ${sg.toFixed(2)})`);
    await notify([(await studentById(sid))!.user_id], `Waiver awarded: ${best.percent}% for ${next.name}`, `${best.name}, based on your ${pub.name} SGPA of ${sg.toFixed(2)}.`, "/app/fees?tab=waivers");
    n++;
  }
  return n;
}
on("result.published", async ({ semesterId, studentIds }) => { await applyRules(semesterId, studentIds); });

// ---------- Scholarships (FIN-U-7)
export const circulars = async (openOnly = false) => await all<{ id: number; title: string; body: string; semester_id: number; semester: string; percent: number; deadline: string; applied: number }>(
  `SELECT c.*, s.name AS semester, (SELECT COUNT(*) FROM scholarship_apps a WHERE a.circular_id = c.id) AS applied FROM circulars c
   JOIN semesters s ON s.id = c.semester_id ${openOnly ? "WHERE c.deadline >= ?" : "WHERE ? = ?"} ORDER BY c.deadline DESC`, ...(openOnly ? [today()] : [1, 1]));
export async function createCircular(by: number, c: { title: string; body: string; semester_id: number; percent: number; deadline: string }) {
  if (!c.title || !c.body || !c.deadline || !(c.percent > 0 && c.percent <= 100)) throw new Error("Title, details, deadline and a percentage are required.");
  const id = await insert("INSERT INTO circulars (title, body, semester_id, percent, deadline, created_by) VALUES (?,?,?,?,?,?)", c.title, c.body, c.semester_id, c.percent, c.deadline, by);
  await notify((await all<{ user_id: number }>("SELECT user_id FROM students WHERE status = 'active'")).map((r) => r.user_id), `Scholarship open: ${c.title}`, `Apply by ${c.deadline}.`, "/app/fees?tab=scholarships");
  await audit(by, "create", "circular", id, undefined, c);
}
export async function applyScholarship(studentId: number, circularId: number, statement: string, fileId: number | null) {
  const c = await get<{ deadline: string }>("SELECT deadline FROM circulars WHERE id = ?", circularId);
  if (!c || c.deadline < today()) throw new Error("This circular is closed.");
  if (!statement) throw new Error("Tell the committee why you should receive it.");
  await insert("INSERT INTO scholarship_apps (circular_id, student_id, statement, file_id) VALUES (?,?,?,?)", circularId, studentId, statement, fileId);
}
export const scholarshipApps = async (circularId?: number, studentId?: number) => await all<{ id: number; circular_id: number; title: string; student: string; student_code: string;
  statement: string; file_id: number | null; status: string; note: string | null; at: string; cgpa: number | null; percent: number }>(
  `SELECT a.*, c.title, c.percent, u.name AS student, s.student_id AS student_code, NULL AS cgpa FROM scholarship_apps a JOIN circulars c ON c.id = a.circular_id
   JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id WHERE (? IS NULL OR a.circular_id = ?) AND (? IS NULL OR a.student_id = ?) ORDER BY a.id DESC`,
  circularId ?? null, circularId ?? null, studentId ?? null, studentId ?? null);
export async function decideScholarship(by: number, id: number, approve: boolean, note: string) {
  await tx(async () => {
    const a = await get<{ circular_id: number; student_id: number; status: string }>("SELECT * FROM scholarship_apps WHERE id = ?", id);
    if (!a || a.status !== "submitted") throw new Error("Already decided.");
    if (!approve && !note) throw new Error("Give the reason.");
    const c = (await get<{ title: string; percent: number; semester_id: number }>("SELECT * FROM circulars WHERE id = ?", a.circular_id))!;
    await run("UPDATE scholarship_apps SET status = ?, decided_by = ?, note = ? WHERE id = ?", approve ? "awarded" : "rejected", by, note || null, id);
    if (approve) await grant(a.student_id, c.semester_id, `scholarship:${a.circular_id}`, c.percent, c.title);
    await notify([(await studentById(a.student_id))!.user_id], approve ? `Scholarship awarded: ${c.title}` : `Scholarship not awarded: ${c.title}`, note, "/app/fees?tab=scholarships");
    await audit(by, approve ? "award" : "reject", "scholarship_app", id, undefined, note);
  });
}

// ---------- Installment plans and refunds (FIN-U-8), approved by a finance officer
export async function requestInstallments(userId: number, studentId: number, parts: number) {
  const sem = await currentSemester();
  const inv = (await invoices(studentId)).find((i) => i.semester_id === sem.id);
  if (!inv || inv.due <= 0) throw new Error("Nothing is due this semester.");
  if (!(parts >= 2 && parts <= 4)) throw new Error("Choose 2 to 4 installments.");
  if ((await get("SELECT 1 FROM installment_plans WHERE student_id = ? AND semester_id = ? AND status IN ('pending','approved')", studentId, sem.id))) throw new Error("You already have a plan for this semester.");
  // Spread evenly between now and the final exam window
  const end = (await get<{ start_date: string }>("SELECT start_date FROM calendar_events WHERE semester_id = ? AND type = 'final'", sem.id))?.start_date ?? sem.end_date;
  const start = new Date(today() + "T00:00:00Z").getTime();
  const step = (new Date(end + "T00:00:00Z").getTime() - start) / parts;
  const each = Math.floor(inv.due / parts);
  const schedule = Array.from({ length: parts }, (_, i) => ({
    due: new Date(start + step * (i + 1) - 864e5 * 3).toISOString().slice(0, 10), amount: i === parts - 1 ? inv.due - each * (parts - 1) : each,
  }));
  return await tx(async () => {
    const plan = await insert("INSERT INTO installment_plans (student_id, semester_id, schedule_json) VALUES (?,?,?)", studentId, sem.id, JSON.stringify(schedule));
    await requestApproval(userId, { kind: "installment", ref_id: plan, student_id: studentId, semester_id: sem.id, amount: inv.due,
      detail: schedule.map((s) => `৳${s.amount.toLocaleString("en-IN")} by ${s.due}`).join(", "), reason: `Installment plan (${parts} parts)` });
  });
}
approvalHandlers.installment = async (a, by, approve) => {
  await run("UPDATE installment_plans SET status = ?, approval_id = ? WHERE id = ?", approve ? "approved" : "rejected", a.id, a.ref_id);
  await notify([(await studentById(a.student_id))!.user_id], approve ? "Installment plan approved" : "Installment plan not approved", a.detail, "/app/fees");
};
export const plans = async (studentId: number) => await all<{ id: number; semester: string; schedule_json: string; status: string; at: string }>(
  "SELECT p.*, s.name AS semester FROM installment_plans p JOIN semesters s ON s.id = p.semester_id WHERE p.student_id = ? ORDER BY p.id DESC", studentId);

export async function requestRefund(userId: number, studentId: number, amount: number, reason: string) {
  const adv = -(await summary(studentId)).due;
  if (!(amount > 0) || amount > adv) throw new Error(adv > 0 ? `You can request up to ৳${adv.toLocaleString("en-IN")}.` : "You have no advance balance to refund.");
  if (!reason) throw new Error("Give a reason and how you want to be paid (bKash number or bank account).");
  await requestApproval(userId, { kind: "refund", student_id: studentId, amount: Math.round(amount), detail: "Refund of advance", reason });
}
approvalHandlers.refund = async (a, by, approve) => {
  if (approve) {
    if (a.amount > -(await summary(a.student_id)).due) throw new Error("The advance balance is now smaller than the refund.");
    await insert("INSERT INTO payments (receipt_no, student_id, amount, method, channel, reference, cashier_id) VALUES (?,?,?, 'refund', 'counter', ?, ?)",
      await nextReceipt(), a.student_id, -a.amount, `Refund #${a.id}`, by);
  }
  await notify([(await studentById(a.student_id))!.user_id], approve ? `Refund approved: ৳${a.amount.toLocaleString("en-IN")}` : "Refund not approved", "", "/app/fees?tab=ledger");
};

// ---------- Reminders (FIN-A-12)
export async function sendReminders(by: number, semesterId: number) {
  const sem = (await semester(semesterId))!;
  const ids = await all<{ student_id: number }>("SELECT student_id FROM invoices WHERE semester_id = ? AND student_id IS NOT NULL", semesterId);
  let n = 0;
  for (const { student_id } of ids) {
    const inv = (await invoices(student_id)).find((i) => i.semester_id === semesterId);
    if (!inv || inv.due <= 0) continue;
    await notify([(await studentById(student_id))!.user_id], inv.status === "overdue" ? `Overdue: ৳${inv.due.toLocaleString("en-IN")} for ${sem.name}` : `Reminder: ৳${inv.due.toLocaleString("en-IN")} due ${inv.due_date}`,
      "Pay online from Fees & payments, or at the Accounts counter.", "/app/fees");
    n++;
  }
  await audit(by, "send_reminders", "invoices", semesterId, undefined, { n });
  return n;
}

// ---------- Online payment gateway (FIN-U-4). A provider-shaped flow: start → hosted page → signed callback.
// ponytail: sandbox provider; set GATEWAY_SECRET and point the callback at SSLCommerz/bKash when credentials exist.
const SECRET = () => process.env.GATEWAY_SECRET ?? "dev-sandbox-secret";
export const sign = (token: string, status: string, amount: number, txn: string) =>
  createHmac("sha256", SECRET()).update(`${token}|${status}|${amount}|${txn}`).digest("hex");
export async function startGateway(p: { studentId?: number; applicationId?: number; amount: number; method: string; returnTo: string }) {
  const amount = Math.round(p.amount);
  const due = p.studentId ? (await summary(p.studentId)).due : (await applicationAccount(p.applicationId!)).due;
  if (!(amount > 0) || amount > due) throw new Error(`Enter an amount up to ৳${Math.max(0, due).toLocaleString("en-IN")}.`);
  if (amount < Math.min(due, await num("partial_min", 1000))) throw new Error(`The minimum online payment is ৳${await num("partial_min", 1000)}.`);
  const token = randomBytes(16).toString("hex");
  await insert("INSERT INTO gateway_sessions (token, student_id, application_id, amount, method, return_to) VALUES (?,?,?,?,?,?)",
    token, p.studentId ?? null, p.applicationId ?? null, amount, p.method, p.returnTo);
  return `/gateway/${token}`;
}
export const gatewaySession = async (token: string) => await get<{ token: string; student_id: number | null; application_id: number | null; amount: number; method: string;
  return_to: string; status: string; txn_id: string | null }>("SELECT * FROM gateway_sessions WHERE token = ?", token);
// Idempotent (NFR-7): a retried callback for a finished session returns the same outcome without posting again.
export async function completeGateway(token: string, status: string, amount: number, txn: string, signature: string) {
  const s = await gatewaySession(token);
  if (!s) throw new Error("Unknown payment session.");
  const expected = Buffer.from(sign(token, status, amount, txn));
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), expected)) throw new Error("Payment signature is invalid.");
  if (amount !== s.amount) throw new Error("Amount does not match the payment session.");
  if (s.status !== "initiated") return { ...s, receipt: (await get<{ receipt_no: string }>("SELECT receipt_no FROM payments WHERE reference = ?", s.txn_id ?? ""))?.receipt_no };
  if (status !== "success") {
    await run("UPDATE gateway_sessions SET status = 'cancelled' WHERE token = ?", token);
    return { ...s, status: "cancelled", receipt: undefined };
  }
  const receipt = await recordPayment(null, { studentId: s.student_id ?? undefined, applicationId: s.application_id ?? undefined, amount, method: s.method, channel: "online", reference: txn });
  await run("UPDATE gateway_sessions SET status = 'paid', txn_id = ? WHERE token = ?", txn, token);
  return { ...s, status: "paid", receipt };
}

// ---------- Reconciliation (FIN-A-10)
export async function importSettlements(by: number, rows: Record<string, string>[], gateway: string) {
  let n = 0;
  await tx(async () => {
    for (const [i, r] of rows.entries()) {
      if (!r.txn_id || !(Number(r.amount) > 0) || !r.settled_on) throw new Error(`Row ${i + 2}: txn_id, amount and settled_on are required.`);
      n += Number((await run("INSERT OR IGNORE INTO settlements (txn_id, amount, settled_on, gateway, imported_by) VALUES (?,?,?,?,?)", r.txn_id, Math.round(Number(r.amount)), r.settled_on, gateway, by)).changes);
    }
  });
  await audit(by, "import", "settlements", gateway, undefined, { n });
  return n;
}
export async function reconcile(from: string, to: string) {
  const pays = await all<{ receipt_no: string; reference: string | null; amount: number; method: string; at: string }>(
    "SELECT receipt_no, reference, amount, method, at FROM payments WHERE channel = 'online' AND amount > 0 AND date(at, '+6 hours') BETWEEN ? AND ?", from, to);
  const sets = await all<{ txn_id: string; amount: number; settled_on: string; gateway: string }>("SELECT * FROM settlements WHERE settled_on BETWEEN ? AND date(?, '+7 days')", from, to);
  const byTxn = new Map(sets.map((s) => [s.txn_id, s]));
  const rows = pays.map((p) => {
    const s = p.reference ? byTxn.get(p.reference) : undefined;
    if (s) byTxn.delete(p.reference!);
    return { ...p, settled: s?.amount ?? null, settled_on: s?.settled_on ?? null, state: !s ? "unsettled" : s.amount === p.amount ? "matched" : "mismatch" };
  });
  return { rows, orphans: [...byTxn.values()] };
}
export async function recordDeposit(by: number, d: { deposited_on: string; amount: number; bank_ref: string; note: string }) {
  if (!d.deposited_on || !(d.amount > 0) || !d.bank_ref) throw new Error("Date, amount and bank reference are required.");
  await insert("INSERT INTO bank_deposits (deposited_on, amount, bank_ref, note, by_user) VALUES (?,?,?,?,?)", d.deposited_on, Math.round(d.amount), d.bank_ref, d.note || null, by);
  await audit(by, "create", "bank_deposit", d.bank_ref, undefined, d);
}
export async function cashVsDeposits(days = 14) {
  const cash = await all<{ day: string; total: number }>(
    "SELECT date(at, '+6 hours') AS day, SUM(amount) AS total FROM payments WHERE channel = 'counter' AND method = 'cash' AND date(at, '+6 hours') >= date('now', ?) GROUP BY 1", `-${days} days`);
  const dep = await all<{ day: string; total: number; refs: string }>(
    "SELECT deposited_on AS day, SUM(amount) AS total, GROUP_CONCAT(bank_ref, ', ') AS refs FROM bank_deposits WHERE deposited_on >= date('now', ?) GROUP BY 1", `-${days} days`);
  const daysSet = [...new Set([...cash.map((c) => c.day), ...dep.map((d) => d.day)])].sort().reverse();
  return daysSet.map((day) => ({ day, cash: cash.find((c) => c.day === day)?.total ?? 0, deposited: dep.find((d) => d.day === day)?.total ?? 0, refs: dep.find((d) => d.day === day)?.refs ?? "" }));
}
