import type { Metadata } from "next";
import Link from "next/link";
import { teacherCtx } from "@/lib/page.ts";
import { get, today } from "@/lib/db.ts";
import { services, student } from "@/modules/index.ts";
import { addSlotsAction, logMeetingAction } from "../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Button, Field, Empty, Avatar, inputCls, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Mentees" };

export default async function Mentees() {
  const { t } = await teacherCtx();
  const list = await services.mentees(t.id);
  const slots = await services.slots(t.id);
  const when = (s: string) => new Date(s.replace(" ", "T") + ":00+06:00").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" });
  return (
    <>
      <PageHeader eyebrow="Teaching" title="Mentees" meta={`${list.length} students assigned to you for academic advising`} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Sheet title="Students" flush>
            {list.length === 0 ? <Empty title="No mentees assigned">The Academic Office assigns mentors by batch.</Empty> : (
              <Table>
                <thead><tr><th>Student</th><th>Batch · Section</th><th className="r">CGPA</th><th>Last meeting</th><th /></tr></thead>
                <tbody>
                  {await Promise.all(list.map(async (m) => {
                    const cg = (await student.transcript(m.id)).at(-1)?.cgpa;
                    const last = (await services.meetings(m.id))[0];
                    return (
                      <tr key={m.id}>
                        <td><span className="flex items-center gap-3"><Avatar name={m.name} size={30} /><span>{m.name}<span className="num block text-[0.75rem] text-meta">{m.student_id}</span></span></span></td><td className="num">{m.batch}_{m.section}</td>
                        <td className={`r num ${cg != null && cg < 2.5 ? "font-semibold text-danger" : ""}`}>{cg?.toFixed(2) ?? "—"}</td>
                        <td className="text-[0.8125rem]">{last ? `${fmtDate(last.date)} · ${last.reason}` : <span className="text-meta">None yet</span>}</td>
                        <td className="r"><Link href={`/messages?to=${(await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", m.id))?.user_id}`} className="text-[0.8125rem] font-medium text-brand hover:underline">Message</Link></td>
                      </tr>
                    );
                  }))}
                </tbody>
              </Table>
            )}
          </Sheet>
          <Sheet title="Record a meeting">
            <form action={logMeetingAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Student"><select name="student_id" className={inputCls}>{list.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.student_id}</option>)}</select></Field>
              <Field label="Date"><input autoComplete="off" name="date" type="date" defaultValue={today()} required className={inputCls} /></Field>
              <Field label="Reason" className="sm:col-span-2"><input autoComplete="off" name="reason" required className={inputCls} placeholder="Course load planning…" /></Field>
              <Field label="Agreed action" className="sm:col-span-2"><input autoComplete="off" name="action" className={inputCls} /></Field>
              <Field label="Next meeting"><input autoComplete="off" name="next_meeting" type="date" className={inputCls} /></Field>
              <Field label="Attachment (optional)"><input name="file" type="file" className={`${inputCls} py-1.5`} /></Field>
              <div><Button disabled={!list.length}>Save meeting</Button></div>
            </form>
            <p className="mt-3 text-[0.8125rem] text-meta">The student can see the record on their Mentor page.</p>
          </Sheet>
        </div>
        <div className="space-y-6">
          <Sheet title="Advising slots" flush>
            {slots.length === 0 ? <Empty title="No upcoming slots" /> : (
              <ul className="px-6 pb-3">
                {slots.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 border-b border-rule py-3 text-[0.875rem] last:border-0">
                    <span>{when(s.start_at)} · {s.minutes} min<span className="block text-[0.75rem] text-meta">{s.place}{s.topic ? ` · ${s.topic}` : ""}</span></span>
                    {s.student ? <Stamp tone="info">{s.student}</Stamp> : <Stamp tone="neutral">Open</Stamp>}
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
          <Sheet title="Publish slots">
            <form action={addSlotsAction} className="grid grid-cols-2 gap-3">
              <Field label="Date"><input autoComplete="off" name="date" type="date" min={today()} required className={inputCls} /></Field>
              <Field label="From"><input autoComplete="off" name="start" type="time" defaultValue="14:00" required className={inputCls} /></Field>
              <Field label="Slots"><input autoComplete="off" name="count" type="number" min="1" max="12" defaultValue={4} className={inputCls} /></Field>
              <Field label="Minutes each"><input autoComplete="off" name="minutes" type="number" min="10" step="5" defaultValue={20} className={inputCls} /></Field>
              <Field label="Place" className="col-span-2"><input autoComplete="off" name="place" required defaultValue="Room 710, AB4" className={inputCls} /></Field>
              <div><Button>Publish</Button></div>
            </form>
          </Sheet>
        </div>
      </div>
    </>
  );
}
