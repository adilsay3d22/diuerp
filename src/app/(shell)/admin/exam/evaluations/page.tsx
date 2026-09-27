import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { pickSemester } from "@/lib/page.ts";
import { registrar, services } from "@/modules/index.ts";
import { saveEvalFormAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Button, Field, Segmented, Stamp, areaCls, inputCls } from "@/components/ui";
import { EvalCard } from "@/components/evals";

export const metadata: Metadata = { title: "Teaching evaluations" };

// STU-A-6: design the form, open or close it, and read anonymised results per teacher and course.
export default async function Evaluations({ searchParams }: PageProps<"/admin/exam/evaluations">) {
  await requireRole("exam_controller");
  const sem = await pickSemester((await searchParams).sem);
  const form = await services.evalForm(sem.id);
  const rows = await services.evalResults(sem.id);
  return (
    <>
      <PageHeader eyebrow="Controller of Examinations" title="Teaching evaluations" meta={`${sem.name} · results hidden below ${services.MIN_RESPONSES} responses`}
        actions={<Segmented label="Semester" items={(await registrar.semesters()).map((x) => ({ href: `?sem=${x.id}`, label: x.code, active: x.id === sem.id }))} />} />
      <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <Sheet title="Form" actions={form.open ? <Stamp tone="ok">Open</Stamp> : <Stamp tone="neutral">Closed</Stamp>} className="self-start">
          <form action={saveEvalFormAction} className="space-y-3">
            <input type="hidden" name="semester_id" value={sem.id} />
            <Field label="Questions (one per line, rated 1–5)"><textarea name="questions" rows={7} defaultValue={form.questions.join("\n")} className={areaCls} /></Field>
            <Field label="Window"><select name="open" defaultValue={form.open ? "1" : "0"} className={inputCls}><option value="1">Open: students must evaluate before seeing results</option><option value="0">Closed</option></select></Field>
            <Button>Save form</Button>
            <p className="text-[0.75rem] text-meta">An overall rating and an optional comment are always asked.</p>
          </form>
        </Sheet>
        <div className="grid gap-4 lg:grid-cols-2">{rows.map((r) => <EvalCard key={r.offering_id} r={r} showTeacher />)}</div>
      </div>
    </>
  );
}
