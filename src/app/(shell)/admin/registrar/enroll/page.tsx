import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { admission, registrar } from "@/modules/index.ts";
import { enrollStudentAction, enrollApplicantAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Button, Field, Empty, Avatar, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Enroll student" };

export default async function Enroll() {
  await requireRole("registrar");
  const sem = await registrar.currentSemester();
  const ready = await admission.readyToEnroll();
  return (
    <>
      <PageHeader eyebrow="Registrar's office" title="Enroll a confirmed applicant" meta="Creates the student ID, registration ID and login, and raises the admission fee in Accounts." />
      <Sheet title="Admitted applicants ready to enroll" flush className="mb-6">
        {ready.length === 0 ? <Empty title="No one waiting">Applicants appear here once they accept the offer and pay the admission fee.</Empty> : (
          <Table>
            <thead><tr><th>Applicant</th><th>Program</th><th>Intake</th><th>Batch · Section</th></tr></thead>
            <tbody>
              {ready.map((a) => (
                <tr key={a.id}>
                  <td><span className="flex items-center gap-2.5"><Avatar name={a.name} size={30} /><span className="font-medium">{a.name}<span className="num block text-[0.75rem] font-normal text-meta">{a.ref}</span></span></span></td><td>{a.program}</td><td>{a.cycle}</td>
                  <td>
                    <form action={enrollApplicantAction} className="flex gap-1.5">
                      <input type="hidden" name="application_id" value={a.id} />
                      <input autoComplete="off" name="batch" required placeholder="Batch…" aria-label={`Batch for ${a.name}`} className={`${inputCls} h-9 w-20`} spellCheck={false} />
                      <input autoComplete="off" name="section" required placeholder="Sec.…" aria-label={`Section for ${a.name}`} className={`${inputCls} h-9 w-16`} spellCheck={false} />
                      <Button size="sm">Enroll</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
      <Sheet className="max-w-3xl" title="Direct enrollment" sub="For transfers and cases outside an admission cycle">
        <form action={enrollStudentAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" className="sm:col-span-2"><input name="name" required autoComplete="off" className={inputCls} /></Field>
          <Field label="Email"><input name="email" type="email" required autoComplete="off" spellCheck={false} className={inputCls} /></Field>
          <Field label="Mobile"><input autoComplete="off" name="phone" type="tel" required className={inputCls} placeholder="01XXXXXXXXX" /></Field>
          <Field label="Program" className="sm:col-span-2">
            <select name="program_id" className={inputCls}>{(await registrar.programs()).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.dept})</option>)}</select>
          </Field>
          <Field label="Batch"><input autoComplete="off" name="batch" required className={inputCls} placeholder="44…" spellCheck={false} /></Field>
          <Field label="Section"><input autoComplete="off" name="section" required className={inputCls} placeholder="A…" spellCheck={false} /></Field>
          <Field label="Intake semester" className="sm:col-span-2">
            <select name="semester_id" defaultValue={sem.id} className={inputCls}>{(await registrar.semesters()).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select>
          </Field>
          <div className="sm:col-span-2"><Button>Enroll student</Button></div>
        </form>
      </Sheet>
    </>
  );
}
