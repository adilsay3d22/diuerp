import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { registrar } from "@/modules/index.ts";
import { createSemesterAction, setWindowAction, addCalendarEventAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, StatusStamp, Button, Field, DateBlock, inputCls, fmtDate, btn } from "@/components/ui";
import { ConfirmButton } from "@/components/client";

export const metadata: Metadata = { title: "Semesters & calendar" };

function Toggle({ id, field, on, label }: { id: number; field: string; on: number; label: string }) {
  return (
    <form action={setWindowAction}>
      <input type="hidden" name="semester_id" value={id} /><input type="hidden" name="field" value={field} /><input type="hidden" name="value" value={on ? 0 : 1} />
      <button aria-label={`${on ? "Close" : "Open"} ${label}`} role="switch" aria-checked={!!on} className="flex items-center gap-2 text-[0.8125rem] text-meta">
        <span className={`relative h-[22px] w-9 rounded-full transition-colors duration-200 ${on ? "bg-brand-green" : "bg-field"}`}>
          <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-card shadow-sm transition-[left] duration-200 ${on ? "left-[16px]" : "left-[2px]"}`} />
        </span>
        {on ? "Open" : "Closed"}
      </button>
    </form>
  );
}

export default async function Semesters() {
  await requireRole("registrar");
  const sems = await registrar.semesters();
  const cur = await registrar.currentSemester();
  const events = await registrar.calendar(cur.id);
  return (
    <>
      <PageHeader eyebrow="Registrar's office" title="Semesters & calendar" meta="Open and close registration windows; publish the academic calendar." />
      <Sheet flush title="Semesters" className="mb-6">
        <Table>
          <thead><tr><th>Code</th><th>Name</th><th>Dates</th><th>Fees due</th><th>Status</th><th>Registration</th><th>Add / drop</th><th>Withdrawal</th><th /></tr></thead>
          <tbody>
            {sems.map((s) => (
              <tr key={s.id}>
                <td className="num font-semibold">{s.code}</td><td>{s.name}</td>
                <td className="whitespace-nowrap text-[0.8125rem]">{fmtDate(s.start_date)} – {fmtDate(s.end_date)}</td>
                <td className="whitespace-nowrap text-[0.8125rem]">{fmtDate(s.due_date)}</td>
                <td><StatusStamp status={s.status} /></td>
                <td><Toggle id={s.id} field="reg_open" on={s.reg_open} label="registration" /></td>
                <td><Toggle id={s.id} field="adddrop_open" on={s.adddrop_open} label="add/drop" /></td>
                <td><Toggle id={s.id} field="withdraw_open" on={s.withdraw_open} label="withdrawal" /></td>
                <td className="r">
                  {s.status !== "active" && (
                    <form action={setWindowAction}>
                      <input type="hidden" name="semester_id" value={s.id} /><input type="hidden" name="field" value="status" /><input type="hidden" name="value" value="active" />
                      <ConfirmButton message={`Make ${s.name} the active semester? The current one will be closed.`} className={btn("secondary", "sm")}>Make active</ConfirmButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <form action={createSemesterAction} className="grid gap-3 border-t border-rule px-6 py-4 sm:grid-cols-6">
          <Field label="Code" hint="Fall 2026 = 263"><input autoComplete="off" name="code" required pattern="\d{3}" className={inputCls} spellCheck={false} /></Field>
          <Field label="Name"><input autoComplete="off" name="name" required className={inputCls} placeholder="Spring 2027…" /></Field>
          <Field label="Starts"><input autoComplete="off" name="start_date" type="date" required className={inputCls} /></Field>
          <Field label="Ends"><input autoComplete="off" name="end_date" type="date" required className={inputCls} /></Field>
          <Field label="Fees due"><input autoComplete="off" name="due_date" type="date" required className={inputCls} /></Field>
          <div className="flex items-end"><Button className="w-full">Create semester</Button></div>
        </form>
      </Sheet>

      <Sheet flush title={`Academic calendar · ${cur.name}`}>
        <Table>
          <thead><tr><th>Dates</th><th>Event</th><th>Type</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}><td className="whitespace-nowrap"><span className="flex items-center gap-3"><DateBlock date={e.start_date} />{e.end_date !== e.start_date && <span className="text-[0.8125rem] text-meta">to {fmtDate(e.end_date)}</span>}</span></td><td className="font-semibold text-heading">{e.title}</td><td className="capitalize">{e.type}</td></tr>
            ))}
          </tbody>
        </Table>
        <form action={addCalendarEventAction} className="grid gap-3 border-t border-rule px-6 py-4 sm:grid-cols-6">
          <input type="hidden" name="semester_id" value={cur.id} />
          <Field label="Event" className="sm:col-span-2"><input autoComplete="off" name="title" required className={inputCls} /></Field>
          <Field label="Type"><select name="type" className={inputCls}>{["registration", "classes", "midterm", "final", "holiday", "deadline"].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="From"><input autoComplete="off" name="start_date" type="date" required className={inputCls} /></Field>
          <Field label="To"><input autoComplete="off" name="end_date" type="date" className={inputCls} /></Field>
          <div className="flex items-end"><Button className="w-full">Publish</Button></div>
        </form>
      </Sheet>
    </>
  );
}
