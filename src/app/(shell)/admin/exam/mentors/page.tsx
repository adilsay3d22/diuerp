import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { registrar, services } from "@/modules/index.ts";
import { assignMentorsAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Button, Field, Empty, Avatar, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Mentors" };

// STU-A-8: assign a mentor to a whole batch or section at once.
export default async function Mentors() {
  await requireRole("exam_controller");
  const list = await services.mentorAssignments();
  const unassigned = await all<{ program: string; batch: string; section: string; n: number }>(
    `SELECT p.name AS program, s.batch, s.section, COUNT(*) AS n FROM students s JOIN programs p ON p.id = s.program_id
     WHERE s.status = 'active' AND s.id NOT IN (SELECT student_id FROM mentors) GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`);
  return (
    <>
      <PageHeader eyebrow="Controller of Examinations" title="Mentors" meta="Every student gets an academic mentor from their department." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Sheet title="Assigned" flush>
            {list.length === 0 ? <Empty title="No mentors assigned yet" /> : (
              <Table>
                <thead><tr><th>Mentor</th><th className="r">Mentees</th><th>Batches</th></tr></thead>
                <tbody>{list.map((m) => <tr key={m.teacher_id}><td><span className="flex items-center gap-2.5"><Avatar name={m.teacher} size={28} /><span className="font-medium">{m.teacher}</span></span></td><td className="r num">{m.n}</td><td className="text-[0.8125rem]">{m.batches}</td></tr>)}</tbody>
              </Table>
            )}
          </Sheet>
          <Sheet title="Without a mentor" flush>
            {unassigned.length === 0 ? <Empty title="Everyone has a mentor" /> : (
              <Table>
                <thead><tr><th>Program</th><th>Batch · Section</th><th className="r">Students</th></tr></thead>
                <tbody>{unassigned.map((u) => <tr key={`${u.program}${u.batch}${u.section}`}><td>{u.program}</td><td className="num">{u.batch}_{u.section}</td><td className="r num">{u.n}</td></tr>)}</tbody>
              </Table>
            )}
          </Sheet>
        </div>
        <Sheet title="Assign in bulk" className="self-start">
          <form action={assignMentorsAction} className="space-y-3">
            <Field label="Program"><select name="program_id" className={inputCls}>{(await registrar.programs()).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Batch"><input autoComplete="off" name="batch" required className={inputCls} placeholder="42…" spellCheck={false} /></Field>
              <Field label="Section" hint="Blank = whole batch"><input autoComplete="off" name="section" className={inputCls} placeholder="E…" spellCheck={false} /></Field>
            </div>
            <Field label="Mentor"><select name="teacher_id" className={inputCls}>{(await registrar.teachers()).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.designation}</option>)}</select></Field>
            <Button className="w-full">Assign</Button>
            <p className="text-[0.75rem] text-meta">Replaces any current mentor for those students. Both sides are notified.</p>
          </form>
        </Sheet>
      </div>
    </>
  );
}
