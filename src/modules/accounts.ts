// M4 Accounts: the only place money is recorded. Amounts are whole taka integers.
import { all, get, run, insert, audit, tx, num, today, keep } from "../lib/db.ts";
import { clearance, paidRatio } from "../lib/rules.ts";
import { notify } from "./core.ts";
import { emit, on } from "./events.ts";
import { offering, semester, studentById } from "./registrar.ts";
import { enrollments } from "./student.ts";
import { studentAttendance } from "./teacher.ts";

export const HEADS = {
  admission: "Admission fee",
  semester_fee: "Semester fee",
  tuition_per_credit: "Tuition (per credit)",
  lab_fee: "Lab fee (per lab course)",
  late_fee: "Late fee",
  waiver: "Waiver",
  adjustment: "Adjustment",
  application_fee: "Application fee",
  transport: "Transport",
  service: "Academic services",
  refund: "Refund",
} as const;

export const fee = async (programId: number, head: string) =>
  (await get<{ amount: number }>("SELECT amount FROM fee_structures WHERE program_id = ? AND head = ? ORDER BY id DESC LIMIT 1", programId, head))?.amount ?? 0;

export async function feeStructures() {
  return await all<{ id: number; program: string; program_id: number; head: string; amount: number; at: string; by_name: string | null; version: number }>(
    `SELECT f.*, p.name AS program, u.name AS by_name,
     (SELECT COUNT(*) FROM fee_structures f2 WHERE f2.program_id = f.program_id AND f2.head = f.head AND f2.id <= f.id) AS version
     FROM fee_structures f JOIN programs p ON p.id = f.program_id LEFT JOIN users u ON u.id = f.created_by
     WHERE f.id = (SELECT MAX(id) FROM fee_structures f3 WHERE f3.program_id = f.program_id AND f3.head = f.head) ORDER BY p.name, f.head`);
}
export async function setFee(by: number, programId: number, head: string, amount: number) {
  if (!(amount >= 0)) throw new Error("Amount must be zero or more.");
  const before = await fee(programId, head);
  await insert("INSERT INTO fee_structures (program_id, head, amount, created_by) VALUES (?,?,?,?)", programId, head, Math.round(amount), by);
  await audit(by, "version", "fee_structure", `${programId}:${head}`, before, amount);
}

export async function ensureInvoice(studentId: number, semesterId: number) {
  const ex = await get<{ id: number }>("SELECT id FROM invoices WHERE student_id = ? AND semester_id = ?", studentId, semesterId);
  if (ex) return ex.id;
  const sem = (await semester(semesterId))!;
  return await insert("INSERT INTO invoices (student_id, semester_id, due_date) VALUES (?,?,?)", studentId, semesterId, sem.due_date ?? sem.start_date);
}
async function addLine(invoiceId: number, head: string, description: string, amount: number, ref: string | null, by: number | null) {
  await insert("INSERT INTO invoice_lines (invoice_id, head, description, amount, ref, by_user) VALUES (?,?,?,?,?,?)", invoiceId, head, description, amount, ref, by);
}
const hasRef = async (invoiceId: number, ref: string) => !!(await get("SELECT 1 FROM invoice_lines WHERE invoice_id = ? AND ref = ?", invoiceId, ref));

// ---------- Event listeners (W2, W3, W4)
on("applicant.enrolled", async ({ studentId, semesterId, by, applicationId }) => {
  const st = (await studentById(studentId))!;
  if (applicationId) {
    // Money paid as an applicant becomes part of the student ledger
    await run("UPDATE invoices SET student_id = ?, semester_id = ? WHERE application_id = ?", studentId, semesterId, applicationId);
    await run("UPDATE payments SET student_id = ? WHERE application_id = ?", studentId, applicationId);
  }
  const inv = await ensureInvoice(studentId, semesterId);
  if (!(await hasRef(inv, "admission"))) await addLine(inv, "admission", HEADS.admission, await fee(st.program_id, "admission"), "admission", by);
});

on("enrollment.confirmed", async ({ studentId, offeringId, by }) => {
  const st = (await studentById(studentId))!;
  const o = (await offering(offeringId))!;
  const inv = await ensureInvoice(studentId, o.semester_id);
  const ref = `enr:${offeringId}`;
  if (await hasRef(inv, ref) && !(await hasRef(inv, `drop:${offeringId}`))) return; // idempotent
  if (!(await hasRef(inv, "semester_fee"))) await addLine(inv, "semester_fee", HEADS.semester_fee, await fee(st.program_id, "semester_fee"), "semester_fee", by);
  await addLine(inv, "tuition_per_credit", `Tuition ${o.code} (${o.credits} cr)`, Math.round(o.credits * await fee(st.program_id, "tuition_per_credit")), ref, by);
  if (o.type === "lab") await addLine(inv, "lab_fee", `Lab fee ${o.code}`, await fee(st.program_id, "lab_fee"), ref, by);
});

on("enrollment.dropped", async ({ studentId, offeringId, by }) => {
  const o = (await offering(offeringId))!;
  const inv = await ensureInvoice(studentId, o.semester_id);
  // ponytail: full refund of the course charges; add add-drop/withdrawal percentage rules when finance defines them.
  const lines = await all<{ head: string; amount: number }>("SELECT head, amount FROM invoice_lines WHERE invoice_id = ? AND ref = ?", inv, `enr:${offeringId}`);
  for (const l of lines) await addLine(inv, l.head, `Drop refund ${o.code}`, -l.amount, `drop:${offeringId}`, by);
});

// ---------- Balances
export async function charges(studentId: number) {
  return await all<{ id: number; semester_id: number; head: string; description: string; amount: number; at: string }>(
    `SELECT l.id, i.semester_id, l.head, l.description, l.amount, l.at FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
     WHERE i.student_id = ? ORDER BY l.at, l.id`, studentId);
}
export const payments = async (studentId: number) => await all<{ id: number; receipt_no: string; amount: number; method: string; channel: string;
  reference: string | null; cashier: string | null; at: string; reverses_id: number | null; reversed: number }>(
  `SELECT p.*, u.name AS cashier, EXISTS(SELECT 1 FROM payments r WHERE r.reverses_id = p.id) AS reversed
   FROM payments p LEFT JOIN users u ON u.id = p.cashier_id WHERE p.student_id = ? ORDER BY p.at, p.id`, studentId);

export async function summary(studentId: number) {
  const ch = await charges(studentId);
  const payable = ch.filter((c) => c.amount > 0 && c.head !== "waiver").reduce((s, c) => s + c.amount, 0);
  const credits = ch.filter((c) => c.amount < 0).reduce((s, c) => s - c.amount, 0);
  const paid = (await payments(studentId)).reduce((s, p) => s + p.amount, 0);
  const other = ch.filter((c) => c.head === "late_fee" || c.head === "adjustment").reduce((s, c) => s + c.amount, 0);
  return { payable, credits, paid, due: payable - credits - paid, other };
}

export async function invoices(studentId: number) {
  const ch = await charges(studentId);
  const paid = (await payments(studentId)).reduce((s, p) => s + p.amount, 0);
  let pool = paid;
  return (await all<{ id: number; semester_id: number; due_date: string; code: string; name: string }>(
    "SELECT i.*, s.code, s.name FROM invoices i JOIN semesters s ON s.id = i.semester_id WHERE i.student_id = ? ORDER BY s.code", studentId))
    .map((inv) => {
      const lines = ch.filter((c) => c.semester_id === inv.semester_id);
      const total = lines.reduce((s, l) => s + l.amount, 0);
      const covered = Math.max(0, Math.min(total, pool)); // FIFO: older invoices absorb payments first
      pool -= covered;
      const due = total - covered;
      const status = due <= 0 ? "paid" : inv.due_date < today() ? "overdue" : covered > 0 ? "partial" : "unpaid";
      return { ...inv, lines, total, paid: covered, due, status };
    });
}

// FIN-U-3 ledger with running balance
export async function ledger(studentId: number, semesterId?: number) {
  const rows = [
    ...(await charges(studentId)).map((c) => ({ at: c.at, semester_id: c.semester_id, description: c.description,
      charge: c.amount > 0 ? c.amount : 0, payment: 0, waiver: c.amount < 0 ? -c.amount : 0, channel: "", cashier: "", receipt: "" })),
    ...(await payments(studentId)).map((p) => ({ at: p.at, semester_id: 0, description: p.amount < 0 ? `Reversal of ${p.reference}` : `Payment (${p.method})`,
      charge: 0, payment: p.amount, waiver: 0, channel: p.channel, cashier: p.cashier ?? "", receipt: p.receipt_no })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  let bal = 0;
  const withBal = rows.map((r) => ({ ...r, balance: (bal += r.charge - r.payment - r.waiver) }));
  return semesterId ? withBal.filter((r) => r.semester_id === semesterId || r.semester_id === 0) : withBal;
}

// ---------- Payments (FIN-A-2, FIN-U-4)
export async function nextReceipt() {
  const year = today().slice(0, 4);
  const last = await get<{ receipt_no: string }>("SELECT receipt_no FROM payments WHERE receipt_no LIKE ? ORDER BY id DESC LIMIT 1", `R${year}-%`);
  const n = last ? Number(last.receipt_no.split("-")[1]) + 1 : 1;
  return `R${year}-${String(n).padStart(6, "0")}`;
}

export type Payer = { studentId?: number; applicationId?: number };
const payerDue = async (p: Payer) => (p.studentId ? (await summary(p.studentId)).due : (await applicationAccount(p.applicationId!)).due);

export async function recordPayment(by: number | null, p: Payer & { amount: number; method: string; channel: "counter" | "online"; reference?: string }) {
  const amount = Math.round(p.amount);
  if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");
  if (!p.studentId === !p.applicationId) throw new Error("A payment belongs to exactly one student or applicant.");
  const due = await payerDue(p);
  if (p.channel === "online") {
    // NFR-7: a retried gateway callback with the same transaction id must not double-credit
    if (p.reference && await get("SELECT 1 FROM payments WHERE reference = ? AND channel = 'online'", p.reference)) return (await get<{ receipt_no: string }>(
      "SELECT receipt_no FROM payments WHERE reference = ?", p.reference))!.receipt_no;
    if (amount > due) throw new Error(`You can pay at most ৳${Math.max(0, due).toLocaleString("en-IN")}.`);
    if (amount < Math.min(due, await num("partial_min", 1000))) throw new Error(`The minimum online payment is ৳${await num("partial_min", 1000)}.`);
  }
  return await tx(async () => {
    const receipt = await nextReceipt();
    const id = await insert("INSERT INTO payments (receipt_no, student_id, application_id, amount, method, channel, reference, cashier_id) VALUES (?,?,?,?,?,?,?,?)",
      receipt, p.studentId ?? null, p.applicationId ?? null, amount, p.method, p.channel, p.reference ?? null, p.channel === "counter" ? by : null);
    await audit(by, "payment", "payment", id, undefined, { ...p, receipt });
    await emit("invoice.paid", { studentId: p.studentId, applicationId: p.applicationId, paymentId: id });
    return receipt;
  });
}

export const receipt = async (no: string) => await get<{ id: number; receipt_no: string; amount: number; method: string; channel: string; reference: string | null;
  at: string; cashier: string | null; student_id: number | null; application_id: number | null; reverses_id: number | null }>(
  "SELECT p.*, u.name AS cashier FROM payments p LEFT JOIN users u ON u.id = p.cashier_id WHERE p.receipt_no = ?", no);

on("invoice.paid", async ({ studentId, paymentId }) => {
  if (!studentId) return; // applicant notifications are sent by the admission module
  const p = (await get<{ receipt_no: string; amount: number }>("SELECT receipt_no, amount FROM payments WHERE id = ?", paymentId))!;
  const st = (await studentById(studentId))!;
  if (p.amount > 0) await notify([st.user_id], `Payment received: ৳${p.amount.toLocaleString("en-IN")}`, `Receipt ${p.receipt_no}`, `/receipt/${p.receipt_no}`);
});

// ---------- Applicant accounts (ADM-U-4, ADM-U-7). One invoice per application, moved to the student on enrollment (W2).
export async function raiseApplicationCharge(by: number | null, applicationId: number, semesterId: number, head: string, description: string, amount: number, ref: string) {
  let inv = (await get<{ id: number }>("SELECT id FROM invoices WHERE application_id = ?", applicationId))?.id;
  if (!inv) inv = await insert("INSERT INTO invoices (application_id, semester_id, due_date) VALUES (?,?,?)", applicationId, semesterId, today());
  if (!(await hasRef(inv, ref))) await addLine(inv, head, description, amount, ref, by);
}
export async function applicationAccount(applicationId: number) {
  const lines = await all<{ id: number; head: string; description: string; amount: number; ref: string; at: string }>(
    "SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.application_id = ? ORDER BY l.id", applicationId);
  const pays = await all<{ id: number; receipt_no: string; amount: number; method: string; channel: string; at: string }>(
    "SELECT * FROM payments WHERE application_id = ? ORDER BY id", applicationId);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const paid = pays.reduce((s, p) => s + p.amount, 0);
  return { lines, payments: pays, total, paid, due: total - paid, covered: (ref: string) => covered(lines, paid, ref) };
}

// FIFO: is the charge with this ref fully covered by payments, oldest charges first?
function covered(lines: { amount: number; ref: string | null }[], paid: number, ref: string) {
  let pool = paid;
  for (const l of lines) {
    pool -= l.amount;
    if (l.ref === ref) return l.amount > 0 && pool >= 0;
  }
  return false;
}
export async function studentChargePaid(studentId: number, ref: string) {
  const lines = await all<{ amount: number; ref: string | null }>(
    "SELECT l.amount, l.ref FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.student_id = ? ORDER BY l.at, l.id", studentId);
  return covered(lines, (await payments(studentId)).reduce((s, p) => s + p.amount, 0), ref);
}

// ---------- Maker-checker approvals (FIN-A-3, FIN-A-7, FIN-A-8)
// Extra approval kinds (installment, refund) register how they are applied; see finance.ts.
export const approvalHandlers: Record<string, (a: { id: number; student_id: number; semester_id: number; amount: number; ref_id: number; detail: string }, by: number, approve: boolean) => Promise<unknown>> = {};

export async function requestApproval(by: number, a: { kind: "reversal" | "waiver" | "adjustment" | "installment" | "refund"; ref_id?: number; student_id: number; semester_id?: number;
  amount?: number; percent?: number; detail?: string; reason: string }) {
  if (!a.reason) throw new Error("A reason is required.");
  if (a.kind === "reversal") {
    const p = await get<{ amount: number }>("SELECT amount FROM payments WHERE id = ? AND reverses_id IS NULL", a.ref_id ?? 0);
    if (!p) throw new Error("Payment not found.");
    if (await get("SELECT 1 FROM payments WHERE reverses_id = ?", a.ref_id!) || await get("SELECT 1 FROM approvals WHERE kind = 'reversal' AND ref_id = ? AND status = 'pending'", a.ref_id!))
      throw new Error("This payment is already reversed or has a pending reversal.");
  }
  if (a.kind === "waiver" && !(a.percent! > 0 && a.percent! <= 100)) throw new Error("Waiver must be between 1 and 100%.");
  const id = await insert("INSERT INTO approvals (kind, ref_id, student_id, semester_id, amount, percent, detail, reason, requested_by) VALUES (?,?,?,?,?,?,?,?,?)",
    a.kind, a.ref_id ?? null, a.student_id, a.semester_id ?? null, a.amount ?? null, a.percent ?? null, a.detail ?? null, a.reason, by);
  await audit(by, "request", a.kind, id, undefined, a);
}

export async function decideApproval(by: number, id: number, approve: boolean) {
  await tx(async () => {
    const a = await get<{ kind: string; ref_id: number; student_id: number; semester_id: number; amount: number; percent: number; detail: string;
      reason: string; requested_by: number; status: string }>("SELECT * FROM approvals WHERE id = ?", id);
    if (!a || a.status !== "pending") throw new Error("Request is not pending.");
    if (a.requested_by === by) throw new Error("Maker-checker: you cannot approve a request you made.");
    await run("UPDATE approvals SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?", approve ? "approved" : "rejected", by, id);
    await audit(by, approve ? "approve" : "reject", a.kind, id);
    if (approvalHandlers[a.kind]) return await approvalHandlers[a.kind]({ ...a, id }, by, approve);
    if (!approve) return;
    if (a.kind === "reversal") {
      const p = (await get<{ amount: number; receipt_no: string; method: string; channel: string }>("SELECT * FROM payments WHERE id = ?", a.ref_id))!;
      await insert("INSERT INTO payments (receipt_no, student_id, amount, method, channel, reference, cashier_id, reverses_id) VALUES (?,?,?,?,?,?,?,?)",
        await nextReceipt(), a.student_id, -p.amount, p.method, p.channel, p.receipt_no, by, a.ref_id);
    } else if (a.kind === "waiver") {
      const inv = await ensureInvoice(a.student_id, a.semester_id);
      const tuition = (await all<{ amount: number }>("SELECT amount FROM invoice_lines WHERE invoice_id = ? AND head = 'tuition_per_credit'", inv)).reduce((s, l) => s + l.amount, 0);
      await insert("INSERT INTO invoice_lines (invoice_id, head, description, amount, ref, by_user) VALUES (?,?,?,?,?,?)",
        inv, "waiver", `${a.detail || "Waiver"} ${a.percent}% on tuition`, -Math.round((tuition * a.percent) / 100), `waiver:${id}`, by);
    } else if (a.kind === "adjustment") {
      const inv = await ensureInvoice(a.student_id, a.semester_id);
      await insert("INSERT INTO invoice_lines (invoice_id, head, description, amount, ref, by_user) VALUES (?,?,?,?,?,?)",
        inv, "adjustment", a.detail || "Adjustment", a.amount, `adj:${id}`, by);
    }
  });
}

export const approvalsList = async (status = "pending") => await all<{ id: number; kind: string; student_code: string; student: string; semester: string | null;
  amount: number | null; percent: number | null; detail: string | null; reason: string; by_name: string; requested_by: number; at: string; receipt: string | null }>(
  `SELECT a.*, s.student_id AS student_code, u.name AS student, sm.code AS semester, bu.name AS by_name, p.receipt_no AS receipt,
   COALESCE(a.amount, p.amount) AS amount FROM approvals a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
   LEFT JOIN semesters sm ON sm.id = a.semester_id JOIN users bu ON bu.id = a.requested_by LEFT JOIN payments p ON a.kind = 'reversal' AND p.id = a.ref_id
   WHERE a.status = ? ORDER BY a.at DESC`, status);

export const waivers = async (studentId: number) => await all<{ semester: string; description: string; amount: number; percent: number | null; reason: string | null; at: string }>(
  `SELECT sm.name AS semester, l.description, -l.amount AS amount, a.percent, a.reason, l.at FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
   JOIN semesters sm ON sm.id = i.semester_id LEFT JOIN approvals a ON l.ref = 'waiver:' || a.id WHERE i.student_id = ? AND l.head = 'waiver' ORDER BY sm.code`, studentId);

// ---------- Clearance (FIN-A-9, STU-U-8), computed on read from ledger + attendance
export async function clearanceFor(studentId: number, semesterId: number) {
  const sem = (await semester(semesterId))!;
  const ch = await charges(studentId);
  const prev = (await keep(ch, async (c) => ((await semester(c.semester_id))?.code ?? "") < sem.code)).reduce((s, c) => s + c.amount, 0);
  const cur = ch.filter((c) => c.semester_id === semesterId).reduce((s, c) => s + c.amount, 0);
  const paid = (await payments(studentId)).reduce((s, p) => s + p.amount, 0);
  const t = await num("attendance_threshold", 70);
  const ens = await enrollments(studentId, semesterId, ["confirmed"]);
  const att = await studentAttendance(studentId, ens.map((e) => e.offering_id));
  const low = ens.filter((e, i) => att[i].total > 0 && att[i].percent < t).map((e) => e.code);
  const exceptions = (await all<{ exam: string }>("SELECT exam FROM clearance_exceptions WHERE student_id = ? AND semester_id = ?", studentId, semesterId)).map((e) => e.exam);
  const plan = await get<{ schedule_json: string }>("SELECT schedule_json FROM installment_plans WHERE student_id = ? AND semester_id = ? AND status = 'approved'", studentId, semesterId);
  const first = plan ? (JSON.parse(plan.schedule_json) as { amount: number }[])[0]?.amount : undefined;
  const midPct = first && cur > 0 ? Math.min(await num("clear_mid_pct", 50), Math.ceil((first / cur) * 100)) : await num("clear_mid_pct", 50);
  return clearance({ prevDue: prev - paid, ratio: paidRatio(prev, cur, paid), midPct, finalPct: await num("clear_final_pct", 100), lowAttendance: low, exceptions });
}
export async function grantException(by: number, studentId: number, semesterId: number, exam: string, reason: string) {
  if (!reason) throw new Error("A reason is required.");
  await run("INSERT OR REPLACE INTO clearance_exceptions VALUES (?,?,?,?,?)", studentId, semesterId, exam, by, reason);
  await audit(by, "grant_exception", "clearance", `${studentId}:${semesterId}:${exam}`, undefined, reason);
}

// ---------- Cashier shift (FIN-A-4)
export async function shiftTotals(cashierId: number) {
  const since = (await get<{ closed_at: string }>("SELECT closed_at FROM shifts WHERE cashier_id = ? ORDER BY id DESC LIMIT 1", cashierId))?.closed_at ?? "1970-01-01";
  const rows = await all<{ method: string; total: number; n: number }>(
    "SELECT method, SUM(amount) AS total, COUNT(*) AS n FROM payments WHERE cashier_id = ? AND channel = 'counter' AND at > ? GROUP BY method", cashierId, since);
  return { since, rows };
}
export async function closeShift(by: number, counted: Record<string, number>) {
  const { since, rows } = await shiftTotals(by);
  const system = Object.fromEntries(rows.map((r) => [r.method, r.total]));
  const methods = new Set([...Object.keys(system), ...Object.keys(counted)]);
  const difference = [...methods].reduce((s, m) => s + (counted[m] ?? 0) - (system[m] ?? 0), 0);
  await insert("INSERT INTO shifts (cashier_id, opened_at, closed_at, system_json, counted_json, difference) VALUES (?,?,datetime('now'),?,?,?)",
    by, since, JSON.stringify(system), JSON.stringify(counted), difference);
  await audit(by, "close", "shift", by, system, { counted, difference });
  return difference;
}
export const shifts = async (cashierId?: number) => await all<{ id: number; cashier: string; opened_at: string; closed_at: string; system_json: string; counted_json: string; difference: number }>(
  `SELECT sh.*, u.name AS cashier FROM shifts sh JOIN users u ON u.id = sh.cashier_id WHERE ? IS NULL OR sh.cashier_id = ? ORDER BY sh.id DESC LIMIT 20`,
  cashierId ?? null, cashierId ?? null);

// ---------- Bulk operations (FIN-A-6) and late fees
export async function bulkGenerate(by: number, programId: number, batch: string, semesterId: number) {
  return await tx(async () => {
    const sts = await all<{ id: number }>("SELECT id FROM students WHERE program_id = ? AND batch = ? AND status = 'active'", programId, batch);
    let n = 0;
    for (const s of sts) {
      const inv = await ensureInvoice(s.id, semesterId);
      if (!(await hasRef(inv, "semester_fee"))) { await addLine(inv, "semester_fee", HEADS.semester_fee, await fee(programId, "semester_fee"), "semester_fee", by); n++; }
    }
    await audit(by, "bulk_generate", "invoice", semesterId, undefined, { programId, batch, n });
    return n;
  });
}
export async function applyLateFees(by: number, semesterId: number) {
  return await tx(async () => {
    const amt = await num("late_fee", 500);
    let n = 0;
    const ids = await all<{ student_id: number }>("SELECT student_id FROM invoices WHERE semester_id = ?", semesterId);
    for (const { student_id } of ids) {
      const inv = (await invoices(student_id)).find((i) => i.semester_id === semesterId)!;
      if (inv.status === "overdue" && !(await hasRef(inv.id, "late_fee"))) { await addLine(inv.id, "late_fee", HEADS.late_fee, amt, "late_fee", by); n++; }
    }
    await audit(by, "apply_late_fees", "invoice", semesterId, undefined, { n });
    return n;
  });
}

// ---------- Dashboard (FIN-A-11)
export async function dashboard(semesterId: number) {
  const d = today();
  const collection = await all<{ cashier: string; method: string; channel: string; total: number; n: number }>(
    `SELECT COALESCE(u.name, 'Online') AS cashier, p.method, p.channel, SUM(p.amount) AS total, COUNT(*) AS n FROM payments p
     LEFT JOIN users u ON u.id = p.cashier_id WHERE date(p.at, '+6 hours') = ? GROUP BY 1, 2, 3 ORDER BY total DESC`, d);
  const students = await all<{ id: number; student_id: string; name: string; program: string; batch: string }>(
    "SELECT s.id, s.student_id, u.name, p.name AS program, s.batch FROM students s JOIN users u ON u.id = s.user_id JOIN programs p ON p.id = s.program_id");
  const dues = await Promise.all(students.map(async (s) => ({ ...s, due: (await summary(s.id)).due, overdue: (await invoices(s.id)).some((i) => i.status === "overdue") })));
  // ponytail: per-student balance in JS; fine for thousands, use a SQL view at 25k students.
  const byProgram = Object.values(dues.reduce<Record<string, { program: string; batch: string; due: number; n: number }>>((acc, s) => {
    const k = `${s.program}|${s.batch}`;
    acc[k] ??= { program: s.program, batch: s.batch, due: 0, n: 0 };
    if (s.due > 0) { acc[k].due += s.due; acc[k].n++; }
    return acc;
  }, {}));
  const revenue = await all<{ head: string; total: number }>(
    `SELECT l.head, SUM(l.amount) AS total FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.semester_id = ? GROUP BY l.head ORDER BY total DESC`, semesterId);
  return { collection, byProgram, defaulters: dues.filter((s) => s.overdue && s.due > 0).sort((a, b) => b.due - a.due), revenue };
}

// ---------- Transport charges (W8)
on("pass.requested", async ({ passId, studentId, semesterId, routeId, amount, by }) => {
  const inv = await ensureInvoice(studentId, semesterId);
  const r = await get<{ number: string }>("SELECT number FROM routes WHERE id = ?", routeId);
  if (!(await hasRef(inv, `pass:${passId}`))) await addLine(inv, "transport", `Transport pass, Route ${r?.number}`, amount, `pass:${passId}`, by);
});
on("pass.cancelled", async ({ passId, studentId, semesterId, by }) => {
  const inv = await ensureInvoice(studentId, semesterId);
  const l = await get<{ amount: number }>("SELECT amount FROM invoice_lines WHERE invoice_id = ? AND ref = ?", inv, `pass:${passId}`);
  // ponytail: full credit on cancellation; add a pro-rata rule when finance defines one.
  if (l && !(await hasRef(inv, `pass-cancel:${passId}`))) await addLine(inv, "transport", "Transport pass cancelled", -l.amount, `pass-cancel:${passId}`, by);
});
