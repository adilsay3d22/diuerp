import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { registrar, accounts } from "@/modules/index.ts";
import { setFeeAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Money, Button, Field, Note, inputCls, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Fee structures" };
const EDITABLE = ["admission", "semester_fee", "tuition_per_credit", "lab_fee"] as const;

export default async function Fees() {
  const s = await requireRole("accounts_officer", "finance_head");
  const rows = await accounts.feeStructures();
  return (
    <>
      <PageHeader eyebrow="Accounts office" title="Fee structures" meta="Each change is a new version; charges already raised keep the amount they were raised with." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Sheet flush>
          <Table>
            <thead><tr><th>Program</th><th>Fee head</th><th className="r">Amount</th><th className="r">Version</th><th>Changed</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td>{r.program}</td><td>{accounts.HEADS[r.head as keyof typeof accounts.HEADS]}</td><td className="r font-semibold"><Money v={r.amount} /></td><td className="r"><span className="num rounded-md bg-muted px-1.5 py-0.5 text-[0.75rem] text-strong">v{r.version}</span></td><td className="text-[0.8125rem] text-meta">{fmtDateTime(r.at)}{r.by_name ? ` · ${r.by_name}` : ""}</td></tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
        {s.role === "finance_head" ? (
          <Sheet title="New fee version" className="self-start">
            <form action={setFeeAction} className="space-y-3">
              <Field label="Program"><select name="program_id" className={inputCls}>{(await registrar.programs()).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Fee head"><select name="head" className={inputCls}>{EDITABLE.map((h) => <option key={h} value={h}>{accounts.HEADS[h]}</option>)}</select></Field>
              <Field label="Amount (৳)"><input autoComplete="off" name="amount" type="number" min="0" required className={inputCls} /></Field>
              <Button>Save new version</Button>
            </form>
          </Sheet>
        ) : <Note tone="info" className="self-start">Only the Finance Head can change fee structures.</Note>}
      </div>
    </>
  );
}
