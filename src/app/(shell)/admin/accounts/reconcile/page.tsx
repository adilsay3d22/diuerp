import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { today, daysAgo } from "@/lib/db.ts";
import { finance } from "@/modules/index.ts";
import { importSettlementsAction, recordDepositAction } from "../../../../actions.ts";
import { CircleCheck, Clock, CircleAlert } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Money, Button, Field, Empty, Tabs, Stat, inputCls, areaCls, fmtDate, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Reconciliation" };

// FIN-A-10: online payments vs gateway settlements; counter cash vs bank deposits.
export default async function Reconcile({ searchParams }: PageProps<"/admin/accounts/reconcile">) {
  await requireRole("accounts_officer", "finance_head");
  const q = await searchParams;
  const tab = q.tab === "cash" ? "cash" : "online";
  const from = String(q.from ?? daysAgo(30));
  const to = String(q.to ?? today());
  return (
    <>
      <PageHeader eyebrow="Accounts office" title="Reconciliation" meta="Match what the ledger says against what actually reached the bank." />
      <Tabs tabs={[{ href: "?tab=online", label: "Online settlements", active: tab === "online" }, { href: "?tab=cash", label: "Counter cash & deposits", active: tab === "cash" }]} />
      {tab === "online" ? <Online from={from} to={to} /> : <Cash />}
    </>
  );
}

async function Online({ from, to }: { from: string; to: string }) {
  const { rows, orphans } = await finance.reconcile(from, to);
  const count = (s: string) => rows.filter((r) => r.state === s).length;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat icon={CircleCheck} label="Matched" value={count("matched")} tone="success" sub="ledger equals settlement" />
          <Stat icon={Clock} label="Not settled yet" value={count("unsettled")} tone={count("unsettled") ? "warning" : undefined} sub="waiting for the gateway" />
          <Stat icon={CircleAlert} label="Amount differs" value={count("mismatch")} tone={count("mismatch") ? "danger" : undefined} sub="needs a look" />
        </div>
        <form className="flex flex-wrap items-end gap-3 rounded-[1.75rem] bg-card px-6 py-5 shadow-panel">
          <input type="hidden" name="tab" value="online" />
          <Field label="From"><input autoComplete="off" name="from" type="date" defaultValue={from} className={inputCls} /></Field>
          <Field label="To"><input autoComplete="off" name="to" type="date" defaultValue={to} className={inputCls} /></Field>
          <Button variant="secondary">Show</Button>
          
        </form>
        <Sheet flush>
          {rows.length === 0 ? <Empty title="No online payments in this range" /> : (
            <Table>
              <thead><tr><th>Receipt</th><th>Paid</th><th>Transaction</th><th className="r">Ledger</th><th className="r">Settled</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.receipt_no}>
                    <td><Link href={`/receipt/${r.receipt_no}`} className="num text-brand hover:underline">{r.receipt_no}</Link></td>
                    <td className="whitespace-nowrap text-[0.8125rem]">{fmtDateTime(r.at)} · {r.method}</td><td className="num text-[0.8125rem]">{r.reference}</td>
                    <td className="r"><Money v={r.amount} /></td><td className="r num">{r.settled != null ? <Money v={r.settled} /> : "—"}</td>
                    <td>{r.state === "matched" ? <Stamp tone="ok">Matched {fmtDate(r.settled_on)}</Stamp> : r.state === "mismatch" ? <Stamp tone="bad">Amount differs</Stamp> : <Stamp tone="wait">Not settled</Stamp>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Sheet>
        {orphans.length > 0 && (
          <Sheet title="Settled but not in the ledger" flush>
            <Table>
              <thead><tr><th>Transaction</th><th>Gateway</th><th>Settled</th><th className="r">Amount</th></tr></thead>
              <tbody>{orphans.map((o) => <tr key={o.txn_id}><td className="num">{o.txn_id}</td><td>{o.gateway}</td><td>{fmtDate(o.settled_on)}</td><td className="r"><Money v={o.amount} /></td></tr>)}</tbody>
            </Table>
          </Sheet>
        )}
      </div>
      <Sheet title="Import settlement report" className="self-start">
        <form action={importSettlementsAction} className="space-y-3">
          <Field label="Gateway"><select name="gateway" className={inputCls}><option>bKash</option><option>Nagad</option><option>SSLCommerz</option><option>Card acquirer</option></select></Field>
          <Field label="CSV file" hint="Columns: txn_id, amount, settled_on"><input name="file" type="file" accept=".csv" className={`${inputCls} py-1.5`} /></Field>
          <Field label="…or paste"><textarea name="csv" spellCheck={false} className={`${areaCls} font-mono text-[0.75rem]`} placeholder={"txn_id,amount,settled_on\nTXN8K2QJ4F1,40000,2026-09-11"} /></Field>
          <Button>Import</Button>
          <p className="text-[0.75rem] text-meta">Rows already imported are skipped.</p>
        </form>
      </Sheet>
    </div>
  );
}

async function Cash() {
  const rows = await finance.cashVsDeposits(21);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Sheet flush>
        {rows.length === 0 ? <Empty title="No counter cash in the last three weeks" /> : (
          <Table>
            <thead><tr><th>Day</th><th className="r">Cash collected</th><th className="r">Deposited</th><th className="r">Difference</th><th>Bank reference</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day}>
                  <td className="whitespace-nowrap">{fmtDate(r.day)}</td><td className="r"><Money v={r.cash} /></td><td className="r"><Money v={r.deposited} /></td>
                  <td className={`r font-medium ${r.deposited - r.cash ? "text-danger" : "text-success"}`}><Money v={r.deposited - r.cash} signed /></td><td className="text-[0.8125rem]">{r.refs || "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="px-6 py-4 text-[0.8125rem] text-meta">Deposits are matched by day. A deposit for two days of cash shows as a surplus on one day and a shortfall on the other.</p>
      </Sheet>
      <Sheet title="Record a bank deposit" className="self-start">
        <form action={recordDepositAction} className="space-y-3">
          <Field label="Cash collected on"><input autoComplete="off" name="deposited_on" type="date" defaultValue={today()} required className={inputCls} /></Field>
          <Field label="Amount (৳)"><input autoComplete="off" name="amount" type="number" min="1" required className={inputCls} /></Field>
          <Field label="Bank deposit slip no."><input autoComplete="off" name="bank_ref" required className={inputCls} spellCheck={false} /></Field>
          <Field label="Note"><input autoComplete="off" name="note" className={inputCls} /></Field>
          <Button>Record deposit</Button>
        </form>
      </Sheet>
    </div>
  );
}
