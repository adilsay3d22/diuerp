import type { Metadata } from "next";
import Link from "next/link";
import { studentCtx } from "@/lib/page.ts";
import { num } from "@/lib/db.ts";
import { accounts, registrar, finance } from "@/modules/index.ts";
import { payOnlineAction, applyScholarshipAction, requestInstallmentsAction, requestRefundAction } from "../../../actions.ts";
import { all } from "@/lib/db.ts";
import { Wallet, Receipt, BadgePercent, CircleCheck } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, StatusStamp, Money, Button, Empty, Field, Tabs, Bento, Stat, Note, inputCls, areaCls, fmtDate, fmtDateTime, taka } from "@/components/ui";

export const metadata: Metadata = { title: "Fees & payments" };

export default async function Fees({ searchParams }: PageProps<"/app/fees">) {
  const { st } = await studentCtx();
  const q = await searchParams;
  const tab = typeof q.tab === "string" ? q.tab : "invoices";
  const fin = await accounts.summary(st.id);
  const invs = await accounts.invoices(st.id);
  const semFilter = Number(q.sem) || undefined;
  const tabs = [["invoices", "Invoices"], ["ledger", "Ledger"], ["waivers", "Waivers"], ["scholarships", "Scholarships"], ["plans", "Installments & refunds"]].map(([k, l]) => ({ href: `?tab=${k}`, label: l, active: tab === k }));

  return (
    <>
      <PageHeader eyebrow="Student services" title="Fees & payments" meta={`${st.student_id} · ${st.program}`} />
      <Bento>
        <Stat dark icon={Wallet} label={fin.due < 0 ? "Advance (credit)" : "Due now"} value={taka(fin.due)} sub={fin.other > 0 ? <>Includes <Money v={fin.other} /> late fees and adjustments</> : fin.due > 0 ? "Pay online or at the Accounts counter" : "You are fully paid up"} />
        <Stat icon={Receipt} label="Total payable" value={taka(fin.payable)} sub="all invoices" />
        <Stat icon={BadgePercent} label="Waivers & credits" value={fin.credits ? `−${taka(fin.credits)}` : taka(0)} tone={fin.credits ? "success" : undefined} sub="scholarships, waivers" />
        <Stat icon={CircleCheck} label="Paid" value={taka(fin.paid)} sub="receipts on your ledger" />
      </Bento>
      <div className="mb-6">
        <Sheet title="Pay online" sub="Sandbox gateway: no real money moves. The receipt posts to your ledger instantly.">
          {fin.due <= 0 ? <Note tone="ok">Nothing to pay. Thank you.</Note> : (
            <form action={payOnlineAction} className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Amount (৳)" hint={`Pay in full or at least ${taka(Math.min(fin.due, await num("partial_min", 1000)))}`}>
                <input autoComplete="off" name="amount" type="number" inputMode="numeric" min={Math.min(fin.due, await num("partial_min", 1000))} max={fin.due} defaultValue={fin.due} required className={inputCls} />
              </Field>
              <Field label="Method">
                <select name="method" className={inputCls}>{["bKash", "Nagad", "Rocket", "Card"].map((m) => <option key={m}>{m}</option>)}</select>
              </Field>
              <Button className="sm:mb-[1.375rem]">Pay {taka(fin.due)}</Button>
            </form>
          )}
        </Sheet>
      </div>

      <Tabs tabs={tabs} />
      {tab === "invoices" && (
        <div className="space-y-6">
          {invs.length === 0 && <Sheet><Empty title="No invoices yet">An invoice is raised when you register courses.</Empty></Sheet>}
          {[...invs].reverse().map((inv) => (
            <Sheet key={inv.id} flush title={inv.name} sub={<>Invoice for semester <span className="num">{inv.code}</span> · due {fmtDate(inv.due_date)}</>} actions={<StatusStamp status={inv.status} />}>
              <Table>
                <thead><tr><th>Fee head</th><th>Description</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id}><td className="whitespace-nowrap">{accounts.HEADS[l.head as keyof typeof accounts.HEADS] ?? l.head}</td><td>{l.description}</td><td className="r"><Money v={l.amount} /></td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={2}>Total · paid <Money v={inv.paid} /> · due <Money v={inv.due} /></td><td className="r"><Money v={inv.total} /></td></tr>
                </tfoot>
              </Table>
            </Sheet>
          ))}
        </div>
      )}
      {tab === "ledger" && <Ledger studentId={st.id} semFilter={semFilter} />}
      {tab === "waivers" && (
        <Sheet flush>
          {(await accounts.waivers(st.id)).length === 0 ? <Empty title="No waivers awarded">Result-based waivers are applied automatically after results publish. Scholarships are under their own tab.</Empty> : (
            <Table>
              <thead><tr><th>Semester</th><th>Waiver</th><th className="r">Rate</th><th>Reason</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {(await accounts.waivers(st.id)).map((w, i) => (
                  <tr key={i}><td>{w.semester}</td><td>{w.description}</td><td className="r num">{w.percent ? `${w.percent}%` : "—"}</td><td>{w.reason ?? "—"}</td><td className="r"><Money v={w.amount} /></td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Sheet>
      )}
      {tab === "scholarships" && <Scholarships studentId={st.id} />}
      {tab === "plans" && <Plans studentId={st.id} due={fin.due} />}
    </>
  );
}

async function Scholarships({ studentId }: { studentId: number }) {
  const open = await finance.circulars(true);
  const mine = await finance.scholarshipApps(undefined, studentId);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Sheet title="Open circulars" flush>
        {open.length === 0 ? <Empty title="No open scholarships right now">New circulars are announced in notifications.</Empty> : (
          <ul className="px-6 pb-4">
            {open.map((c) => {
              const applied = mine.some((a) => a.circular_id === c.id);
              return (
                <li key={c.id} className="border-b border-rule py-4 last:border-0">
                  <p className="font-medium">{c.title} <span className="text-[0.8125rem] font-normal text-meta">· {c.percent}% of {c.semester} tuition · apply by {fmtDate(c.deadline)}</span></p>
                  <p className="mt-1 max-w-[65ch] text-[0.875rem] text-strong">{c.body}</p>
                  {applied ? <p className="mt-2 text-[0.8125rem] text-meta">You have applied.</p> : (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[0.875rem] font-medium text-brand">Apply</summary>
                      <form action={applyScholarshipAction} className="mt-3 space-y-3">
                        <input type="hidden" name="circular_id" value={c.id} />
                        <Field label="Why should you receive it?"><textarea name="statement" required className={areaCls} /></Field>
                        <Field label="Supporting document (optional)"><input name="file" type="file" className={`${inputCls} py-1.5`} /></Field>
                        <Button size="sm">Submit application</Button>
                      </form>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
      <Sheet title="My scholarship applications" flush>
        {mine.length === 0 ? <Empty title="None yet" /> : (
          <Table>
            <thead><tr><th>Scholarship</th><th>Applied</th><th>Status</th></tr></thead>
            <tbody>{mine.map((a) => <tr key={a.id}><td>{a.title}{a.note && <span className="block text-[0.8125rem] text-meta">{a.note}</span>}</td><td className="text-[0.8125rem]">{fmtDateTime(a.at)}</td>
              <td>{a.status === "awarded" ? <Stamp tone="ok">Awarded</Stamp> : a.status === "rejected" ? <Stamp tone="bad">Not awarded</Stamp> : <Stamp tone="wait">Under review</Stamp>}</td></tr>)}</tbody>
          </Table>
        )}
      </Sheet>
    </div>
  );
}

async function Plans({ studentId, due }: { studentId: number; due: number }) {
  const plans = await finance.plans(studentId);
  const refunds = await all<{ id: number; amount: number; status: string; at: string; reason: string }>(
    "SELECT id, amount, status, at, reason FROM approvals WHERE kind = 'refund' AND student_id = ? ORDER BY id DESC", studentId);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Sheet title="Installment plan">
        {plans.map((p) => (
          <div key={p.id} className="mb-4">
            <p className="flex items-center gap-2 text-[0.9375rem] font-medium">{p.semester} <StatusStamp status={p.status} /></p>
            <ul className="mt-2 space-y-1 text-[0.875rem]">
              {(JSON.parse(p.schedule_json) as { due: string; amount: number }[]).map((x, i) => <li key={i} className="flex justify-between"><span>Installment {i + 1} · by {fmtDate(x.due)}</span><Money v={x.amount} /></li>)}
            </ul>
          </div>
        ))}
        {due > 0 && !plans.some((p) => ["pending", "approved"].includes(p.status)) ? (
          <form action={requestInstallmentsAction} className="flex flex-wrap items-end gap-3">
            <Field label="Split this semester's dues into"><select name="parts" className={inputCls}><option value={2}>2 installments</option><option value={3}>3 installments</option><option value={4}>4 installments</option></select></Field>
            <Button variant="secondary">Request plan</Button>
          </form>
        ) : !plans.length && <p className="text-[0.875rem] text-meta">Nothing due, so no plan is needed.</p>}
        <p className="mt-3 text-[0.8125rem] text-meta">With an approved plan, paying the first installment clears you for the mid-term.</p>
      </Sheet>
      <Sheet title="Refund of advance">
        {refunds.map((r) => <p key={r.id} className="mb-2 flex items-center justify-between text-[0.875rem]"><span>{taka(r.amount)} · {fmtDateTime(r.at)}</span><StatusStamp status={r.status} /></p>)}
        {due < 0 ? (
          <form action={requestRefundAction} className="space-y-3">
            <Field label={`Amount (up to ${taka(-due)})`}><input autoComplete="off" name="amount" type="number" min="1" max={-due} defaultValue={-due} className={inputCls} /></Field>
            <Field label="Reason and how to pay you" hint="bKash number or bank account"><input autoComplete="off" name="reason" required className={inputCls} /></Field>
            <Button variant="secondary">Request refund</Button>
          </form>
        ) : <p className="text-[0.875rem] text-meta">You can request a refund when your balance is in advance (paid more than charged).</p>}
      </Sheet>
    </div>
  );
}

async function Ledger({ studentId, semFilter }: { studentId: number; semFilter?: number }) {
  const rows = await accounts.ledger(studentId, semFilter);
  return (
    <Sheet flush actions={
      <nav aria-label="Semester" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-panel">
        <Link href="?tab=ledger" className={`rounded-xl px-3 py-1 text-[0.8125rem] font-medium ${!semFilter ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>All</Link>
        {(await registrar.semesters()).map((s) => (
          <Link key={s.id} href={`?tab=ledger&sem=${s.id}`} className={`rounded-xl px-3 py-1 text-[0.8125rem] font-medium ${semFilter === s.id ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>{s.code}</Link>
        ))}
      </nav>
    } title="Ledger">
      <Table>
        <thead><tr><th>Date</th><th>Description</th><th className="r">Charge</th><th className="r">Payment</th><th className="r">Waiver</th><th className="r">Balance</th><th>Channel</th><th>Receipt</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap text-meta">{fmtDateTime(r.at)}</td><td>{r.description}</td>
              <td className="r num">{r.charge ? <Money v={r.charge} /> : ""}</td><td className="r num">{r.payment ? <Money v={r.payment} /> : ""}</td>
              <td className="r num">{r.waiver ? <Money v={r.waiver} /> : ""}</td>
              <td className={`r font-semibold ${r.balance > 0 ? "" : "text-success"}`}><Money v={r.balance} /></td>
              <td className="capitalize">{r.channel}{r.cashier ? ` · ${r.cashier}` : ""}</td>
              <td>{r.receipt && <Link href={`/receipt/${r.receipt}`} className="num font-medium text-brand hover:underline">{r.receipt}</Link>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {semFilter && <p className="px-6 py-3 text-[0.75rem] text-meta">Payments are shown in every semester view because they settle the oldest charges first.</p>}
    </Sheet>
  );
}
