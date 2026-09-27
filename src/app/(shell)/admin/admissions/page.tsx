import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { admission, registrar } from "@/modules/index.ts";
import { createCycleAction, setCycleStatusAction } from "../../../actions.ts";
import { ClipboardList, FileText, UserCheck } from "lucide-react";
import { PageHeader, Sheet, Table, StatusStamp, Button, Field, Empty, Bento, Stat, inputCls, areaCls, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Admission cycles" };

export default async function Cycles() {
  await requireRole("admissions_officer");
  const list = await admission.cycles();
  const progs = (await Promise.all(list.map((c) => admission.cyclePrograms(c.id)))).flat();
  return (
    <>
      <PageHeader eyebrow="Admission office" title="Admission cycles" meta="Open a cycle, review applications, run the test and publish the merit list." />
      <Bento className="xl:grid-cols-[1.4fr_1fr_1fr]">
        <Stat dark icon={ClipboardList} label="Open cycles" value={list.filter((c) => c.status === "open").length} sub={`${list.length} cycle${list.length === 1 ? "" : "s"} in total`} />
        <Stat icon={FileText} label="Applications" value={progs.reduce((s, p) => s + p.applied, 0)} sub="across every cycle" />
        <Stat icon={UserCheck} label="Selected" value={progs.reduce((s, p) => s + p.selected, 0)} sub="offers made" />
      </Bento>
      <Sheet flush title="Cycles" className="mb-6">
        {list.length === 0 ? <Empty title="No cycles yet">Open the first one below.</Empty> : (
          <Table>
            <thead><tr><th>Cycle</th><th>Intake</th><th>Deadline</th><th className="r">Seats</th><th className="r">Applied</th><th className="r">Selected</th><th>Status</th><th /></tr></thead>
            <tbody>
              {await Promise.all(list.map(async (c) => {
                const ps = await admission.cyclePrograms(c.id);
                return (
                  <tr key={c.id}>
                    <td><Link href={`/admin/admissions/${c.id}`} className="font-medium text-brand hover:underline">{c.name}</Link></td>
                    <td>{c.intake}</td><td className="whitespace-nowrap">{fmtDate(c.deadline)}</td>
                    <td className="r num">{ps.reduce((s, p) => s + p.seats, 0)}</td><td className="r num">{ps.reduce((s, p) => s + p.applied, 0)}</td><td className="r num">{ps.reduce((s, p) => s + p.selected, 0)}</td>
                    <td><StatusStamp status={c.status === "open" ? "active" : "closed"} /></td>
                    <td className="r">
                      <form action={setCycleStatusAction}><input type="hidden" name="cycle_id" value={c.id} /><input type="hidden" name="status" value={c.status === "open" ? "closed" : "open"} />
                        <Button size="sm" variant="secondary">{c.status === "open" ? "Close" : "Reopen"}</Button></form>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </Table>
        )}
      </Sheet>

      <Sheet title="Open a new cycle" className="max-w-4xl">
        <form action={createCycleAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><input autoComplete="off" name="name" required placeholder="Spring 2027 undergraduate…" className={inputCls} /></Field>
          <Field label="Intake semester">
            <select name="intake_semester_id" className={inputCls}>{(await registrar.semesters()).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select>
          </Field>
          <Field label="Application deadline"><input autoComplete="off" name="deadline" type="date" required className={inputCls} /></Field>
          <Field label="Test date (optional)"><input autoComplete="off" name="test_date" type="date" className={inputCls} /></Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-[0.8125rem] font-medium text-strong">Seats per program (leave 0 to exclude)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {(await registrar.programs()).map((p) => (
                <Field key={p.id} label={p.name}><input autoComplete="off" name={`seats_${p.id}`} type="number" min="0" defaultValue={0} className={inputCls} /></Field>
              ))}
            </div>
          </fieldset>
          <Field label="Required documents" hint="One per line"><textarea name="docs" className={areaCls} defaultValue={"SSC certificate\nHSC certificate\nNID or birth certificate\nPassport-size photo"} /></Field>
          <Field label="Extra questions (optional)" hint="One per line, e.g. Quota category"><textarea name="fields" className={areaCls} /></Field>
          <div><Button>Open cycle</Button></div>
        </form>
      </Sheet>
    </>
  );
}
