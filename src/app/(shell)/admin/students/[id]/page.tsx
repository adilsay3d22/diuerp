import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, deptScope } from "@/lib/auth.ts";
import { audit } from "@/lib/db.ts";
import { registrar, student, teacher, accounts } from "@/modules/index.ts";
import * as A from "../../../../actions.ts";
import { STAFF } from "@/lib/page.ts";
import { PageHeader, Sheet, Table, Stamp, StatusStamp, Money, Button, Field, Facts, Empty, Avatar, inputCls, taka } from "@/components/ui";

export const metadata: Metadata = { title: "Student record" };

export default async function Student360({ params }: PageProps<"/admin/students/[id]">) {
  const s = await requireRole(...STAFF);
  const st = await registrar.studentById(Number((await params).id));
  if (!st || (s.role === "dept_head" && st.dept_id !== deptScope(s))) notFound();
  await audit(s.user.id, "view", "student_360", st.id); // NFR-5: personal-data access is logged
  const sem = await registrar.currentSemester();
  const ens = await student.enrollments(st.id, sem.id, ["confirmed", "waitlisted"]);
  const att = await teacher.studentAttendance(st.id, ens.map((e) => e.offering_id));
  const tr = await student.transcript(st.id);
  const fin = await accounts.summary(st.id);
  const clr = await accounts.clearanceFor(st.id, sem.id);
  const canEnroll = s.role === "registrar" || s.role === "exam_controller";
  const money = s.role === "accounts_officer" || s.role === "finance_head";
  const offs = (await registrar.offerings(sem.id)).filter((o) => o.capacity > 0 && !ens.some((e) => e.offering_id === o.id));

  return (
    <>
      <PageHeader eyebrow="Student records" title="Student record" meta={<Link href="/admin/students" className="text-brand hover:underline">← All students</Link>} actions={<StatusStamp status={st.status} />} />
      <section className="relative mb-6 grid gap-6 overflow-hidden rounded-[1.75rem] bg-brand-deep p-7 text-on-dark md:grid-cols-[1fr_auto]">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.65),transparent_65%)]" />
        <div className="relative flex items-center gap-5">
          <Avatar name={st.name} size={64} />
          <div className="min-w-0">
            <p className="eyebrow text-[0.625rem] text-brand-green">{st.program}</p>
            <p className="mt-2 text-[1.5rem] font-semibold tracking-[-0.03em]">{st.name}</p>
            <p className="num mt-1 text-[0.8125rem] text-on-dark-muted">{st.student_id} · Batch {st.batch} · Section {st.section}</p>
          </div>
        </div>
        <dl className="relative flex gap-8 self-end">
          {([["CGPA", tr.at(-1)?.cgpa.toFixed(2) ?? "—"], ["Credits", `${await student.creditsEarned(st.id)}/${st.total_credits}`], ["Due", taka(fin.due)]] as const).map(([k, v]) => (
            <div key={k} className="flex flex-col-reverse"><dt className="mt-1 text-[0.75rem] text-on-dark-muted">{k}</dt><dd className="num text-[1.75rem] font-medium leading-none tracking-[-0.05em]">{v}</dd></div>
          ))}
        </dl>
      </section>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr_1fr]">
        <Sheet title="Profile">
          <Facts rows={[["Registration ID", st.reg_id], ["Email", st.email], ["Phone", st.phone], ["Blood group", st.blood_group], ["Emergency contact", st.emergency_contact],
            ["CGPA", tr.at(-1)?.cgpa.toFixed(2) ?? "—"], ["Credits earned", `${await student.creditsEarned(st.id)} / ${st.total_credits}`]]} />
          {s.role === "registrar" && (
            <form action={A.setStudentStatusAction} className="mt-4 grid grid-cols-2 gap-2">
              <input type="hidden" name="student_id" value={st.id} />
              <Field label="Change status"><select name="status" defaultValue={st.status} className={inputCls}>{["active", "on-leave", "dropped", "graduated"].map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Reason"><input autoComplete="off" name="reason" required className={inputCls} /></Field>
              <Button size="sm" variant="secondary" className="col-span-2 justify-self-start">Record status change</Button>
            </form>
          )}
        </Sheet>
        <Sheet title="Dues" actions={<Link href={`/admin/cashier?q=${st.student_id}`} className="text-[0.8125rem] font-medium text-brand hover:underline">Open at counter</Link>}>
          <dl className="space-y-1.5 text-[0.875rem]">
            <div className="flex justify-between"><dt className="text-meta">Payable</dt><dd><Money v={fin.payable} /></dd></div>
            <div className="flex justify-between"><dt className="text-meta">Waivers & credits</dt><dd><Money v={-fin.credits} /></dd></div>
            <div className="flex justify-between"><dt className="text-meta">Paid</dt><dd><Money v={fin.paid} /></dd></div>
            <div className="flex justify-between border-t border-rule pt-1.5 font-semibold"><dt>Due</dt><dd className={fin.due > 0 ? "text-danger" : "text-success"}>{taka(fin.due)}</dd></div>
          </dl>
          <h3 className="eyebrow mb-3 mt-6 text-meta">Clearance · {sem.code}</h3>
          <ul className="space-y-1.5">
            {clr.map((c) => <li key={c.exam} className="flex items-center justify-between gap-2 text-[0.8125rem]"><span className="capitalize">{c.exam}</span>{c.ok ? <Stamp tone="ok">Cleared</Stamp> : <span title={c.reason}><Stamp tone="bad">Blocked</Stamp></span>}</li>)}
          </ul>
        </Sheet>
        <Sheet title={`Attendance · ${sem.code}`} flush>
          {ens.length === 0 ? <Empty title="Not registered this semester" /> : (
            <Table>
              <thead><tr><th>Course</th><th className="r">Classes</th><th className="r">%</th></tr></thead>
              <tbody>{ens.map((e, i) => <tr key={e.id}><td className="num font-medium text-brand">{e.code}</td><td className="r num">{att[i].total}</td><td className={`r num font-semibold ${att[i].total && att[i].percent < 70 ? "text-danger" : ""}`}>{att[i].total ? att[i].percent : "—"}</td></tr>)}</tbody>
            </Table>
          )}
        </Sheet>
      </div>

      <Sheet title={`Registration · ${sem.name}`} flush className="mt-6">
        <Table>
          <thead><tr><th>Course</th><th>Section</th><th className="r">Credits</th><th>Status</th>{canEnroll && <th>Drop (override)</th>}</tr></thead>
          <tbody>
            {ens.map((e) => (
              <tr key={e.id}>
                <td><span className="num font-medium text-brand">{e.code}</span> <span className="text-meta">{e.title}</span></td><td className="num">{e.section}</td><td className="r num">{e.credits}</td><td><StatusStamp status={e.status} /></td>
                {canEnroll && (
                  <td>
                    <form action={A.dropEnrollmentAction} className="flex gap-2">
                      <input type="hidden" name="enrollment_id" value={e.id} />
                      <input autoComplete="off" name="reason" required placeholder="Reason…" aria-label={`Reason to drop ${e.code}`} className={`${inputCls} h-9 min-w-40`} />
                      <Button size="sm" variant="danger" confirm="Drop this student from the course?">Drop</Button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
        {canEnroll && (
          <form action={A.forceEnrollAction} className="grid gap-3 border-t border-rule px-6 py-4 md:grid-cols-[1fr_1fr_auto]">
            <input type="hidden" name="student_id" value={st.id} />
            <Field label="Force-enroll (skips prerequisite, capacity and window checks)">
              <select name="offering_id" className={inputCls}>{offs.map((o) => <option key={o.id} value={o.id}>{o.code} {o.section} · {o.enrolled}/{o.capacity}</option>)}</select>
            </Field>
            <Field label="Reason (recorded)"><input autoComplete="off" name="reason" required className={inputCls} /></Field>
            <div className="flex items-end"><Button variant="secondary">Enroll</Button></div>
          </form>
        )}
      </Sheet>

      {money && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Sheet title="Request a waiver">
            <form action={A.requestWaiverAction} className="space-y-3">
              <input type="hidden" name="student_id" value={st.id} /><input type="hidden" name="semester_id" value={sem.id} />
              <Field label="Category"><input autoComplete="off" name="detail" required className={inputCls} placeholder="Merit / freedom fighter quota / sibling…" /></Field>
              <Field label={`Percent of ${sem.code} tuition`}><input autoComplete="off" name="percent" type="number" min="1" max="100" required className={inputCls} /></Field>
              <Field label="Reason"><input autoComplete="off" name="reason" required className={inputCls} /></Field>
              <Button size="sm">Send for approval</Button>
            </form>
          </Sheet>
          <Sheet title="Request an adjustment">
            <form action={A.requestAdjustmentAction} className="space-y-3">
              <input type="hidden" name="student_id" value={st.id} /><input type="hidden" name="semester_id" value={sem.id} />
              <Field label="Description"><input autoComplete="off" name="detail" required className={inputCls} placeholder="Library fine…" /></Field>
              <Field label="Amount (৳)" hint="Negative for a credit to the student"><input autoComplete="off" name="amount" type="number" required className={inputCls} /></Field>
              <Field label="Reason"><input autoComplete="off" name="reason" required className={inputCls} /></Field>
              <Button size="sm">Send for approval</Button>
            </form>
          </Sheet>
          <Sheet title="Grant clearance exception">
            <form action={A.grantExceptionAction} className="space-y-3">
              <input type="hidden" name="student_id" value={st.id} /><input type="hidden" name="semester_id" value={sem.id} />
              <Field label="Stage"><select name="exam" className={inputCls}><option value="registration">Registration</option><option value="midterm">Mid-term</option><option value="final">Final</option></select></Field>
              <Field label="Reason"><input autoComplete="off" name="reason" required className={inputCls} /></Field>
              <Button size="sm" variant="secondary">Grant exception</Button>
            </form>
          </Sheet>
        </div>
      )}

      {s.role === "registrar" && (
        <Sheet title="Transfer-in credit" className="mt-6">
          <form action={A.transferCreditAction} className="grid gap-3 sm:grid-cols-5">
            <input type="hidden" name="student_id" value={st.id} />
            <Field label="Course code"><input autoComplete="off" name="course" required className={inputCls} placeholder="MAT101…" spellCheck={false} /></Field>
            <Field label="Counted in semester"><select name="semester" className={inputCls}>{(await registrar.semesters()).map((x) => <option key={x.id} value={x.code}>{x.name}</option>)}</select></Field>
            <Field label="Equivalent marks"><input autoComplete="off" name="total" type="number" min="0" max="100" step="0.5" required className={inputCls} /></Field>
            <div className="flex items-end sm:col-span-2"><Button variant="secondary">Record transfer</Button></div>
          </form>
          <p className="mt-2 text-[0.75rem] text-meta">For students transferring in: the course is recorded with a transfer marker and counts toward credits and CGPA.</p>
        </Sheet>
      )}

      <Sheet title="Results" flush className="mt-6">
        {tr.length === 0 ? <Empty title="No published results" /> : (
          <Table>
            <thead><tr><th>Semester</th><th>Course</th><th className="r">Credits</th><th className="r">Marks</th><th>Grade</th><th className="r">SGPA</th><th className="r">CGPA</th></tr></thead>
            <tbody>
              {tr.flatMap((t) => t.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i === 0 ? t.name : ""}</td><td><span className="num font-medium text-brand">{r.code}</span> <span className="text-meta">{r.title}</span></td><td className="r num">{r.credits}</td>
                  <td className="r num">{(r.total_c / 100).toFixed(2)}</td><td className={`num ${r.letter === "F" ? "font-semibold text-danger" : "font-semibold text-heading"}`}>{r.letter}</td>
                  <td className="r num">{i === 0 ? t.sgpa.toFixed(2) : ""}</td><td className="r num">{i === 0 ? t.cgpa.toFixed(2) : ""}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
