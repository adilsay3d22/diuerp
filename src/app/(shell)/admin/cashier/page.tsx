import type { Metadata } from "next";
import Link from "next/link";
import { Search, ReceiptText, Banknote } from "lucide-react";
import { requireRole } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { registrar, accounts, admission } from "@/modules/index.ts";
import { counterPaymentAction, requestReversalAction } from "../../../actions.ts";
import { PageHeader, Sheet, Table, StatusStamp, Stamp, Money, Button, Empty, Field, Stat, inputCls, fmtDateTime, fmtDate, taka } from "@/components/ui";

export const metadata: Metadata = { title: "Counter" };
const METHODS = ["cash", "cheque", "bank draft", "bKash (manual ref)", "Nagad (manual ref)"];

export default async function Cashier({ searchParams }: PageProps<"/admin/cashier">) {
  const s = await requireRole("cashier");
  const q = String((await searchParams).q ?? "").trim();
  const matches = q ? await registrar.searchStudents(q) : [];
  const apps = q ? await admission.search(q) : [];
  const st = matches.length === 1 && !apps.length ? matches[0] : undefined;
  const app = apps.length === 1 && !matches.length ? apps[0] : undefined;
  const today = await all<{ receipt_no: string; amount: number; method: string; at: string; student_id: string; name: string }>(
    `SELECT p.receipt_no, p.amount, p.method, p.at, s.student_id, u.name FROM payments p JOIN students s ON s.id = p.student_id JOIN users u ON u.id = s.user_id
     WHERE p.cashier_id = ? AND date(p.at, '+6 hours') = date('now', '+6 hours') ORDER BY p.id DESC`, s.user.id);

  return (
    <>
      <PageHeader eyebrow="Accounts counter" title="Counter" meta={`Cashier: ${s.user.name}`} />
      <section className="mb-6 grid gap-4 lg:grid-cols-[1.6fr_1fr_1fr]">
        <form role="search" className="relative flex flex-col justify-between gap-5 overflow-hidden rounded-[1.75rem] bg-brand-deep p-6 text-on-dark">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.6),transparent_65%)]" />
          <label htmlFor="q" className="relative text-[0.8125rem] text-on-dark-muted">Find a student or applicant</label>
          <div className="relative flex gap-2">
            <input id="q" name="q" type="search" defaultValue={q} autoFocus spellCheck={false} placeholder="253-15-0001, APP-00001 or a name…" className={`${inputCls} h-12 border-white/15 bg-white/[0.07] text-[0.9375rem] text-on-dark placeholder:text-on-dark-muted/70 focus:bg-white/10`} autoComplete="off" />
            <Button className="h-12 bg-brand-green px-5 text-navy-900 hover:bg-brand-green/90"><Search aria-hidden size={16} />Find</Button>
          </div>
        </form>
        <Stat icon={ReceiptText} label="Receipts today" value={today.length} sub="issued at this counter" />
        <Stat icon={Banknote} label="Collected today" value={taka(today.reduce((t, p) => t + p.amount, 0))} sub={<Link href="/admin/cashier/shift" className="text-brand hover:underline">Close shift</Link>} />
      </section>

      {app && <ApplicantAtCounter id={app.id} />}
      {q && apps.length > 1 && (
        <Sheet flush className="mb-6" title="Applicants">
          <Table>
            <thead><tr><th>Application</th><th>Name</th><th>Program</th><th className="r">Due</th></tr></thead>
            <tbody>{await Promise.all(apps.map(async (a) => <tr key={a.id}><td><Link href={`?q=${a.ref}`} className="num font-medium text-brand hover:underline">{a.ref}</Link></td><td>{a.name}</td><td>{a.program}</td><td className="r"><Money v={(await accounts.applicationAccount(a.id)).due} /></td></tr>))}</tbody>
          </Table>
        </Sheet>
      )}
      {q && !st && !app && (matches.length > 0 || apps.length === 0) && (
        <Sheet flush className="mb-6">
          {matches.length === 0 ? <Empty title={`No student matches “${q}”`} /> : (
            <Table>
              <thead><tr><th>Student ID</th><th>Name</th><th>Program</th><th className="r">Due</th></tr></thead>
              <tbody>{await Promise.all(matches.map(async (m) => <tr key={m.id}><td><Link href={`?q=${m.student_id}`} className="num font-medium text-brand hover:underline">{m.student_id}</Link></td><td>{m.name}</td><td>{m.program}</td><td className="r"><Money v={(await accounts.summary(m.id)).due} /></td></tr>))}</tbody>
            </Table>
          )}
        </Sheet>
      )}

      {st && <StudentAtCounter id={st.id} />}

      <Sheet flush title="My receipts today" className="mt-6">
        {today.length === 0 ? <Empty title="No payments yet today" /> : (
          <Table>
            <thead><tr><th>Receipt</th><th>Time</th><th>Student</th><th>Method</th><th className="r">Amount</th></tr></thead>
            <tbody>{today.map((p) => <tr key={p.receipt_no}><td><Link href={`/receipt/${p.receipt_no}`} className="num font-medium text-brand hover:underline">{p.receipt_no}</Link></td><td className="text-[0.8125rem]">{fmtDateTime(p.at)}</td><td>{p.name} <span className="num text-[0.75rem] text-meta">{p.student_id}</span></td><td className="capitalize">{p.method}</td><td className="r"><Money v={p.amount} /></td></tr>)}</tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}

async function StudentAtCounter({ id }: { id: number }) {
  const st = (await registrar.studentById(id))!;
  const fin = await accounts.summary(id);
  const invs = (await accounts.invoices(id)).filter((i) => i.due > 0);
  const pays = (await accounts.payments(id)).slice(-6).reverse();
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-6">
        <Sheet flush title={<>{st.name} <span className="num font-normal text-meta">· {st.student_id} · {st.program}</span></>} actions={<span className="text-[0.875rem]">Due <b className={fin.due > 0 ? "text-danger" : "text-success"}>{taka(fin.due)}</b></span>}>
          {invs.length === 0 ? <Empty title="No open invoices">This student owes nothing.</Empty> : (
            <Table>
              <thead><tr><th>Semester</th><th>Due date</th><th className="r">Total</th><th className="r">Paid</th><th className="r">Due</th><th>Status</th></tr></thead>
              <tbody>{invs.map((i) => <tr key={i.id}><td>{i.name}</td><td>{fmtDate(i.due_date)}</td><td className="r"><Money v={i.total} /></td><td className="r"><Money v={i.paid} /></td><td className="r font-semibold text-danger"><Money v={i.due} /></td><td><StatusStamp status={i.status} /></td></tr>)}</tbody>
            </Table>
          )}
        </Sheet>
        <Sheet flush title="Recent payments">
          {pays.length === 0 ? <Empty title="No payments yet" /> : (
            <Table>
              <thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th className="r">Amount</th><th>Wrong entry?</th></tr></thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/receipt/${p.receipt_no}`} className="num font-medium text-brand hover:underline">{p.receipt_no}</Link></td>
                    <td className="text-[0.8125rem]">{fmtDateTime(p.at)}</td><td className="capitalize">{p.method} · {p.channel}</td><td className="r"><Money v={p.amount} /></td>
                    <td>
                      {p.amount < 0 ? <Stamp tone="neutral">Reversal</Stamp> : p.reversed ? <Stamp tone="bad">Reversed</Stamp> : (
                        <form action={requestReversalAction} className="flex gap-1.5">
                          <input type="hidden" name="payment_id" value={p.id} /><input type="hidden" name="student_id" value={id} />
                          <input autoComplete="off" name="reason" required placeholder="Reason…" aria-label={`Reason to reverse ${p.receipt_no}`} className={`${inputCls} h-9 min-w-36`} />
                          <Button size="sm" variant="danger" confirm="Ask the Finance Head to reverse this receipt?">Request reversal</Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Sheet>
      </div>
      <Sheet title="Record payment" className="self-start">
        <form action={counterPaymentAction} className="space-y-3">
          <input type="hidden" name="student_id" value={id} />
          <Field label="Amount (৳)"><input autoComplete="off" name="amount" type="number" min="1" inputMode="numeric" required defaultValue={fin.due > 0 ? fin.due : ""} className={`${inputCls} num h-12 text-[1.25rem] font-semibold`} /></Field>
          <Field label="Method"><select name="method" className={inputCls}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Reference" hint="Cheque number, draft number or mobile-banking TrxID"><input autoComplete="off" name="reference" className={inputCls} spellCheck={false} /></Field>
          <Button className="w-full">Record and issue receipt</Button>
          <p className="text-[0.75rem] text-meta">Payments settle the oldest invoice first. Receipts are numbered in sequence and cannot be deleted.</p>
        </form>
      </Sheet>
    </div>
  );
}

async function ApplicantAtCounter({ id }: { id: number }) {
  const a = (await admission.application(id))!;
  const acc = await accounts.applicationAccount(id);
  return (
    <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Sheet flush title={<>{a.name} <span className="num font-normal text-meta">· {a.ref} · applicant, {a.program}</span></>} actions={<span className="text-[0.875rem]">Due <b className={acc.due > 0 ? "text-danger" : "text-success"}>{taka(acc.due)}</b></span>}>
        <Table>
          <tbody>
            {acc.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="r"><Money v={l.amount} /></td></tr>)}
            {acc.payments.map((p) => <tr key={p.receipt_no}><td className="text-meta">Paid · <Link href={`/receipt/${p.receipt_no}`} className="text-brand hover:underline">{p.receipt_no}</Link></td><td className="r"><Money v={-p.amount} /></td></tr>)}
          </tbody>
        </Table>
      </Sheet>
      <Sheet title="Record payment" className="self-start">
        {acc.due <= 0 ? <p className="text-[0.875rem] text-meta">Nothing due.</p> : (
          <form action={counterPaymentAction} className="space-y-3">
            <input type="hidden" name="application_id" value={id} />
            <Field label="Amount (৳)"><input autoComplete="off" name="amount" type="number" min="1" required defaultValue={acc.due} className={`${inputCls} num h-12 text-[1.25rem] font-semibold`} /></Field>
            <Field label="Method"><select name="method" className={inputCls}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
            <Field label="Reference"><input autoComplete="off" name="reference" className={inputCls} spellCheck={false} /></Field>
            <Button className="w-full">Record and issue receipt</Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}
