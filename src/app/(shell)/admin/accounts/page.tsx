import type { Metadata } from "next";
import Link from "next/link";
import { Download, Banknote, CircleAlert, Receipt, Stamp } from "lucide-react";
import { requireRole } from "@/lib/auth.ts";
import { registrar, accounts } from "@/modules/index.ts";
import { PageHeader, Sheet, Table, Money, Empty, Bento, Stat, btn, taka } from "@/components/ui";

export const metadata: Metadata = { title: "Finance dashboard" };

export default async function Finance() {
  await requireRole("accounts_officer", "finance_head");
  const sem = await registrar.currentSemester();
  const d = await accounts.dashboard(sem.id);
  const collected = d.collection.reduce((t, c) => t + c.total, 0);
  const outstanding = d.byProgram.reduce((t, p) => t + p.due, 0);
  const pending = (await accounts.approvalsList()).length;
  const billed = d.revenue.filter((r) => r.total > 0).reduce((t, r) => t + r.total, 0);
  const waived = -d.revenue.filter((r) => r.head === "waiver").reduce((t, r) => t + r.total, 0);
  const csv = (r: string) => <a href={`/admin/export/${r}`} className={btn("ghost", "sm")}><Download aria-hidden size={14} />CSV</a>;

  return (
    <>
      <PageHeader eyebrow="Accounts office" title="Finance dashboard" meta={`${sem.name} · ${new Date().toLocaleDateString("en-GB", { dateStyle: "full", timeZone: "Asia/Dhaka" })}`} />
      <Bento>
        <Stat dark icon={Banknote} label="Collected today" value={taka(collected)} sub={`${d.collection.reduce((t, c) => t + c.n, 0)} receipts across all counters and online`} />
        <Stat icon={CircleAlert} label="Outstanding dues" value={taka(outstanding)} tone={outstanding ? "danger" : "success"} sub={`${d.defaulters.length} past the due date`} />
        <Stat icon={Receipt} label={`Billed for ${sem.code}`} value={taka(billed)} sub={`${taka(waived)} waived`} />
        <Stat href={pending ? "/admin/accounts/approvals" : undefined} icon={Stamp} label="Awaiting approval" value={pending} tone={pending ? "warning" : undefined} sub={pending ? "Review now" : "Nothing waiting"} />
      </Bento>

      <div className="grid gap-6 xl:grid-cols-2">
        <Sheet flush title="Today's collection by counter and method" actions={csv("collection")}>
          {d.collection.length === 0 ? <Empty title="No payments today yet" /> : (
            <Table>
              <thead><tr><th>Counter</th><th>Method</th><th className="r">Receipts</th><th className="r">Amount</th></tr></thead>
              <tbody>{d.collection.map((c, i) => <tr key={i}><td>{c.cashier}</td><td className="capitalize">{c.method}</td><td className="r num">{c.n}</td><td className="r"><Money v={c.total} /></td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td className="r"><Money v={collected} /></td></tr></tfoot>
            </Table>
          )}
        </Sheet>
        <Sheet flush title={`Revenue by fee head · ${sem.code}`}>
          <Table>
            <thead><tr><th>Fee head</th><th className="r">Amount</th></tr></thead>
            <tbody>{d.revenue.map((r) => (
              <tr key={r.head}>
                <td><span className="block">{accounts.HEADS[r.head as keyof typeof accounts.HEADS] ?? r.head}</span>
                  {r.total > 0 && billed > 0 && <span className="mt-1.5 block h-1 w-full max-w-56 rounded-full bg-track"><span className="block h-1 rounded-full bg-brand" style={{ width: `${(r.total / billed) * 100}%` }} /></span>}</td>
                <td className={`r ${r.total < 0 ? "text-success" : ""}`}><Money v={r.total} /></td>
              </tr>
            ))}</tbody>
          </Table>
        </Sheet>
        <Sheet flush title="Outstanding dues by program and batch" actions={csv("dues")}>
          <Table>
            <thead><tr><th>Program</th><th>Batch</th><th className="r">Students owing</th><th className="r">Outstanding</th></tr></thead>
            <tbody>{d.byProgram.map((p) => <tr key={`${p.program}${p.batch}`}><td>{p.program}</td><td className="num">{p.batch}</td><td className="r num">{p.n}</td><td className="r font-semibold"><Money v={p.due} /></td></tr>)}</tbody>
          </Table>
        </Sheet>
        <Sheet flush title="Defaulters (past due date)" actions={csv("defaulters")}>
          {d.defaulters.length === 0 ? <Empty title="No defaulters" /> : (
            <Table>
              <thead><tr><th>Student</th><th>Program</th><th className="r">Due</th></tr></thead>
              <tbody>{d.defaulters.map((s) => <tr key={s.id}><td><Link href={`/admin/students/${s.id}`} className="text-brand hover:underline">{s.name}</Link> <span className="num text-[0.75rem] text-meta">{s.student_id}</span></td><td>{s.program}</td><td className="r font-semibold text-danger"><Money v={s.due} /></td></tr>)}</tbody>
            </Table>
          )}
        </Sheet>
      </div>
    </>
  );
}
