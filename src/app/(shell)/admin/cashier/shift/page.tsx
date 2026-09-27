import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { accounts } from "@/modules/index.ts";
import { closeShiftAction } from "../../../../actions.ts";
import { Banknote, History } from "lucide-react";
import { PageHeader, Sheet, Table, Money, Empty, Stat, inputCls, btn, fmtDateTime } from "@/components/ui";
import { ConfirmButton } from "@/components/client";

export const metadata: Metadata = { title: "Close shift" };

export default async function Shift() {
  const s = await requireRole("cashier");
  const { since, rows } = await accounts.shiftTotals(s.user.id);
  const past = await accounts.shifts(s.user.id);
  const total = rows.reduce((t, r) => t + r.total, 0);
  return (
    <>
      <PageHeader eyebrow="Accounts counter" title="Close shift" meta={`Open since ${since.startsWith("1970") ? "your first payment" : fmtDateTime(since)}`} />
      <div className="mb-6 grid max-w-5xl gap-4 sm:grid-cols-[1.4fr_1fr]">
        <Stat dark icon={Banknote} label="System total this shift" value={<Money v={total} />} sub={`${rows.reduce((t, r) => t + r.n, 0)} receipts`} />
        <Stat icon={History} label="Closed shifts" value={past.length} sub="kept on record" />
      </div>
      <Sheet flush title="Count and close" sub="Enter what is physically in the drawer for each method" className="mb-6 max-w-5xl">
        {rows.length === 0 ? <Empty title="Nothing collected in this shift" /> : (
          <form action={closeShiftAction}>
            <Table>
              <thead><tr><th>Method</th><th className="r">Receipts</th><th className="r">System total</th><th className="r">Counted</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.method}>
                    <td className="capitalize">{r.method}</td><td className="r num">{r.n}</td><td className="r"><Money v={r.total} /></td>
                    <td className="r"><input autoComplete="off" name={`c_${r.method}`} aria-label={`Counted ${r.method}`} type="number" min="0" required inputMode="numeric" className={`${inputCls} ml-auto w-36 text-right`} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td /><td className="r"><Money v={total} /></td><td /></tr></tfoot>
            </Table>
            <div className="border-t border-rule px-6 py-5">
              <ConfirmButton message="Close the shift? Any difference between counted and system totals is recorded." className={btn("primary")}>Close shift</ConfirmButton>
            </div>
          </form>
        )}
      </Sheet>
      <Sheet flush title="Previous shifts" className="max-w-5xl">
        {past.length === 0 ? <Empty title="No closed shifts yet" /> : (
          <Table>
            <thead><tr><th>Closed</th><th className="r">System</th><th className="r">Counted</th><th className="r">Difference</th></tr></thead>
            <tbody>
              {past.map((p) => {
                const sum = (j: string) => Object.values(JSON.parse(j) as Record<string, number>).reduce((a, b) => a + b, 0);
                return <tr key={p.id}><td>{fmtDateTime(p.closed_at)}</td><td className="r"><Money v={sum(p.system_json)} /></td><td className="r"><Money v={sum(p.counted_json)} /></td><td className={`r font-semibold ${p.difference ? "text-danger" : "text-success"}`}><Money v={p.difference} signed /></td></tr>;
              })}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
