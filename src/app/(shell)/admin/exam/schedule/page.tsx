import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { registrar, services } from "@/modules/index.ts";
import { scheduleExamAction, seatPlanAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Button, Field, Empty, Tabs, inputCls, btn, fmtDate } from "@/components/ui";
import { ConfirmButton } from "@/components/client";

export const metadata: Metadata = { title: "Exam schedule & seats" };

export default async function Schedule({ searchParams }: PageProps<"/admin/exam/schedule">) {
  await requireRole("exam_controller");
  const sem = await registrar.currentSemester();
  const stage = (await searchParams).stage === "midterm" ? "midterm" : "final";
  const list = await services.exams(sem.id, stage);
  const offs = (await registrar.offerings(sem.id)).filter((o) => o.capacity > 0 && o.enrolled > 0);
  const window = (await registrar.calendar(sem.id)).find((c) => c.type === stage);
  const rooms = await registrar.rooms();
  return (
    <>
      <PageHeader eyebrow="Controller of Examinations" title="Exam schedule & seats" meta={`${sem.name}${window ? ` · ${stage} window ${fmtDate(window.start_date)} – ${fmtDate(window.end_date)}` : ""}`} />
      <Tabs tabs={[{ href: "?stage=midterm", label: "Mid-term", active: stage === "midterm" }, { href: "?stage=final", label: "Final", active: stage === "final" }]} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Sheet title="Scheduled" flush>
          {list.length === 0 ? <Empty title="Nothing scheduled yet" /> : (
            <Table>
              <thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Rooms</th><th className="r">Seated</th><th>Paper</th></tr></thead>
              <tbody>
                {await Promise.all(list.map(async (x) => {
                  const p = (await services.papers(x.id))[0];
                  return (
                    <tr key={x.id}>
                      <td className="whitespace-nowrap font-medium">{fmtDate(x.date)}</td><td className="num">{x.start}–{x.end}</td>
                      <td><span className="num font-medium text-brand">{x.code}</span> {x.section} <span className="text-meta">{x.title}</span></td><td className="text-[0.8125rem]">{x.rooms ?? "—"}</td>
                      <td className="r num">{x.seated || "—"}</td>
                      <td>{p ? <a href={`/files/${p.file_id}`} className="text-[0.8125rem] text-brand hover:underline">{p.name}</a> : <Stamp tone="wait">Awaited</Stamp>}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </Table>
          )}
        </Sheet>
        <div className="space-y-6">
          <Sheet title="Schedule an exam">
            <form action={scheduleExamAction} className="space-y-3">
              <input type="hidden" name="stage" value={stage} />
              <Field label="Section"><select name="offering_id" className={inputCls}>{offs.map((o) => <option key={o.id} value={o.id}>{o.code} {o.section} · {o.enrolled} students</option>)}</select></Field>
              <Field label="Date"><input autoComplete="off" name="date" type="date" required min={window?.start_date} max={window?.end_date} defaultValue={window?.start_date} className={inputCls} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><input autoComplete="off" name="start" type="time" defaultValue={stage === "final" ? "09:30" : "10:00"} required className={inputCls} /></Field>
                <Field label="End"><input autoComplete="off" name="end" type="time" defaultValue={stage === "final" ? "12:30" : "11:30"} required className={inputCls} /></Field>
              </div>
              <Button className="w-full">Save</Button>
              <p className="text-[0.75rem] text-meta">Students sitting two exams at once are detected and refused.</p>
            </form>
          </Sheet>
          <Sheet title="Generate seat plans">
            <form action={seatPlanAction} className="space-y-3">
              <input type="hidden" name="semester_id" value={sem.id} /><input type="hidden" name="stage" value={stage} />
              <fieldset>
                <legend className="mb-2 text-[0.8125rem] font-medium text-strong">Rooms (every other seat is used)</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {rooms.map((r) => (
                    <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-rule px-3 py-2 text-[0.8125rem] has-[:checked]:border-brand has-[:checked]:bg-brand-soft"><input type="checkbox" name="rooms" value={r.number} defaultChecked={r.type === "theory"} />{r.number} <span className="text-meta">({Math.floor(r.capacity / 2)})</span></label>
                  ))}
                </div>
              </fieldset>
              <ConfirmButton message="Generate seat plans for every scheduled exam in this stage? Existing plans are replaced and students are notified." className={`${btn("primary")} w-full`} disabled={!list.length}>
                Generate and notify students
              </ConfirmButton>
            </form>
          </Sheet>
        </div>
      </div>
    </>
  );
}
