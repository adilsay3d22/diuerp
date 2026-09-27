import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { studentCtx } from "@/lib/page.ts";
import { services } from "@/modules/index.ts";
import { bookSlotAction, cancelBookingAction } from "../../../actions.ts";
import { PageHeader, Sheet, Table, Button, Empty, Field, Avatar, inputCls, btn, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Mentor" };

export default async function Mentor() {
  const { st } = await studentCtx();
  const m = await services.mentorOf(st.id);
  const slots = m ? await services.slots(m.teacher_id) : [];
  const mine = slots.filter((s) => s.student_id === st.id);
  const open = slots.filter((s) => !s.student_id);
  const log = await services.meetings(st.id);
  const when = (s: string) => new Date(s.replace(" ", "T") + ":00+06:00").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" });
  return (
    <>
      <PageHeader eyebrow="Student services" title="Mentor" meta="Your academic advisor, advising slots and meeting records." />
      {!m ? <Sheet><Empty title="No mentor assigned yet">The Academic Office assigns mentors to each batch.</Empty></Sheet> : (
        <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="space-y-6">
            <Sheet>
              <div className="flex items-center gap-4">
                <Avatar name={m.name} size={56} />
                <div className="min-w-0"><p className="eyebrow text-brand">Your mentor</p><p className="mt-1 text-[1.125rem] font-semibold tracking-[-0.02em] text-heading">{m.name}</p><p className="text-[0.875rem] text-meta">{m.designation}</p></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/messages?to=${m.user_id}`} className={btn("primary", "sm")}>Message</Link>
                <a href={`mailto:${m.email}`} className={btn("secondary", "sm")}><Mail aria-hidden size={14} />Email</a>
                {m.phone && <a href={`tel:${m.phone}`} className={btn("secondary", "sm")}><Phone aria-hidden size={14} />Call</a>}
              </div>
            </Sheet>
            <Sheet title="Advising" flush>
              {mine.map((s) => (
                <form key={s.id} action={cancelBookingAction} className="mx-6 mb-3 flex items-center justify-between gap-2 rounded-2xl bg-brand-soft px-4 py-3 ring-1 ring-inset ring-brand/10">
                  <input type="hidden" name="slot_id" value={s.id} />
                  <span className="text-[0.875rem]"><b>Booked:</b> {when(s.start_at)} · {s.place}</span>
                  <Button size="sm" variant="ghost" confirm="Cancel this advising booking?">Cancel</Button>
                </form>
              ))}
              {mine.length === 0 && (open.length === 0 ? <Empty title="No open slots">Your mentor hasn’t published advising times yet.</Empty> : (
                <form action={bookSlotAction} className="space-y-4 px-6 pb-6">
                  <Field label="Time"><select name="slot_id" className={inputCls}>{open.map((s) => <option key={s.id} value={s.id}>{when(s.start_at)} · {s.minutes} min · {s.place}</option>)}</select></Field>
                  <Field label="What do you want to discuss?"><input autoComplete="off" name="topic" className={inputCls} placeholder="Course plan for next semester…" /></Field>
                  <Button className="w-full">Book</Button>
                </form>
              ))}
            </Sheet>
          </div>
          <Sheet title="Meeting records" flush>
            {log.length === 0 ? <Empty title="No meetings recorded yet" /> : (
              <Table>
                <thead><tr><th>Date</th><th>Reason</th><th>Agreed action</th><th>Next</th></tr></thead>
                <tbody>
                  {log.map((x) => (
                    <tr key={x.id}>
                      <td className="whitespace-nowrap">{fmtDate(x.date)}</td><td>{x.reason}</td>
                      <td>{x.action ?? "—"}{x.file_id && <a href={`/files/${x.file_id}`} className="block text-[0.8125rem] text-brand hover:underline">{x.file_name}</a>}</td>
                      <td className="whitespace-nowrap">{fmtDate(x.next_meeting)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Sheet>
        </div>
      )}
    </>
  );
}
