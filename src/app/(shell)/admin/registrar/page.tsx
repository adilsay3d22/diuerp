import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { pickSemester } from "@/lib/page.ts";
import { registrar } from "@/modules/index.ts";
import { createOfferingAction, assignTeacherAction } from "../../../actions.ts";
import { Library, Users, UserX, Plus } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Button, Field, Bento, Stat, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Course offerings" };

export default async function Offerings({ searchParams }: PageProps<"/admin/registrar">) {
  await requireRole("registrar");
  const sem = await pickSemester((await searchParams).sem);
  const offs = (await registrar.offerings(sem.id)).filter((o) => o.capacity > 0);
  const slots = await registrar.slotsFor(offs.map((o) => o.id));
  const teachers = await registrar.teachers();
  const proposals = offs.filter((o) => o.proposed_teacher_id);
  const allSlots = await registrar.timeSlots();
  const rooms = await registrar.rooms();

  return (
    <>
      <PageHeader eyebrow="Registrar's office" title="Course offerings" meta={`${sem.name} · ${sem.code} · ${offs.length} sections`}
        actions={<nav aria-label="Semester" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-panel">{(await registrar.semesters()).map((x) => (
          <Link key={x.id} href={`?sem=${x.id}`} className={`rounded-xl px-3 py-1 text-[0.8125rem] font-medium ${x.id === sem.id ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>{x.code}</Link>
        ))}</nav>} />

      <Bento>
        <Stat dark icon={Library} label="Sections this semester" value={offs.length} sub={`${new Set(offs.map((o) => o.course_id)).size} courses offered`} />
        <Stat icon={Users} label="Seats filled" value={`${offs.reduce((t, o) => t + o.enrolled, 0)}`} sub={<>of <span className="num">{offs.reduce((t, o) => t + o.capacity, 0)}</span> across all sections</>} />
        <Stat icon={UserX} label="Without a teacher" value={offs.filter((o) => !o.teacher_id).length} tone={offs.some((o) => !o.teacher_id) ? "warning" : "success"} sub="sections to staff" />
        <Stat href="#new" icon={Plus} label="Create a section" value={<span className="text-[1.25rem] tracking-[-0.03em]">New section</span>} sub="clash-checked" />
      </Bento>
      {proposals.length > 0 && (
        <Sheet title="Teacher proposals from departments" className="mb-6" flush actions={<Stamp tone="wait">{proposals.length} waiting</Stamp>}>
          <Table>
            <thead><tr><th>Section</th><th>Current</th><th>Proposed</th><th /></tr></thead>
            <tbody>
              {proposals.map((o) => (
                <tr key={o.id}>
                  <td><span className="num font-medium text-brand">{o.code}</span> {o.section}</td><td>{o.teacher ?? "Unassigned"}</td><td className="font-semibold">{o.proposed}</td>
                  <td className="r">
                    <form action={assignTeacherAction}><input type="hidden" name="offering_id" value={o.id} /><input type="hidden" name="teacher_id" value={o.proposed_teacher_id!} />
                      <Button size="sm">Accept and assign</Button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
      )}

      <Sheet flush title="Sections" className="mb-6">
        <Table>
          <thead><tr><th>Course</th><th>Section</th><th>Schedule</th><th className="r">Seats</th><th>Teacher</th></tr></thead>
          <tbody>
            {offs.map((o) => (
              <tr key={o.id}>
                <td><span className="num font-medium text-brand">{o.code}</span> <span className="text-meta">{o.title}</span></td>
                <td className="num">{o.section}</td>
                <td className="text-[0.8125rem]">{registrar.scheduleText(slots.filter((s) => s.offering_id === o.id))}</td>
                <td className={`r num ${o.enrolled >= o.capacity ? "font-semibold text-danger" : ""}`}>{o.enrolled}/{o.capacity}</td>
                <td>
                  <form action={assignTeacherAction} className="flex gap-2">
                    <input type="hidden" name="offering_id" value={o.id} />
                    <select name="teacher_id" defaultValue={o.teacher_id ?? ""} aria-label={`Teacher for ${o.code} ${o.section}`} className={`${inputCls} h-9 min-w-44`}>
                      <option value="">Unassigned</option>
                      {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <Button size="sm" variant="secondary">Save</Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Sheet>

      <Sheet title="Create a section" id="new">
        <form action={createOfferingAction} className="grid gap-4 md:grid-cols-4">
          <input type="hidden" name="semester_id" value={sem.id} />
          <Field label="Course" className="md:col-span-2">
            <select name="course_id" className={inputCls}>{(await registrar.courses()).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select>
          </Field>
          <Field label="Section" hint="Batch_Section, e.g. 42_E"><input autoComplete="off" name="section" required pattern="[0-9A-Za-z]+_[A-Za-z0-9]+" className={inputCls} spellCheck={false} /></Field>
          <Field label="Capacity"><input autoComplete="off" name="capacity" type="number" min="1" defaultValue={45} required className={inputCls} /></Field>
          <Field label="Teacher" className="md:col-span-2">
            <select name="teacher_id" className={inputCls}><option value="">Assign later</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </Field>
          {[0, 1, 2].map((i) => (
            <fieldset key={i} className="grid grid-cols-2 gap-2 md:col-span-2">
              <legend className="mb-2 text-[0.8125rem] font-medium text-strong">Class {i + 1}{i ? " (optional)" : ""}</legend>
              <select name="slot_id" aria-label={`Class ${i + 1} time`} className={inputCls}><option value="">Time</option>{allSlots.map((s) => <option key={s.id} value={s.id}>{s.day} {s.start}–{s.end}</option>)}</select>
              <select name="room_id" aria-label={`Class ${i + 1} room`} className={inputCls}><option value="">Room</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.number} ({r.type}, {r.capacity})</option>)}</select>
            </fieldset>
          ))}
          <div className="flex items-end md:col-span-2"><Button>Create section</Button><span className="ml-3 text-[0.8125rem] text-meta">Room, teacher and section clashes are checked.</span></div>
        </form>
      </Sheet>
    </>
  );
}
