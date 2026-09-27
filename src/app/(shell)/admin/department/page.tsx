import type { Metadata } from "next";
import Link from "next/link";
import { requireRole, deptScope } from "@/lib/auth.ts";
import { num, today } from "@/lib/db.ts";
import { registrar, teacher, services } from "@/modules/index.ts";
import * as A from "../../../actions.ts";
import { FileCheck2, ArrowLeftRight, ClipboardPen, TriangleAlert, ChevronRight } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, StatusStamp, Button, Empty, Field, Bento, Stat, inputCls, fmtDate, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Department desk" };

export default async function Department() {
  const s = await requireRole("dept_head");
  const dept = deptScope(s)!;
  const d = (await registrar.departments()).find((x) => x.id === dept)!;
  const sem = await registrar.currentSemester();
  const sheets = await teacher.gradesheetsByStatus("submitted", { deptId: dept });
  const corrections = await teacher.pendingCorrections(dept);
  const offs = (await registrar.offerings(sem.id)).filter((o) => o.dept_id === dept && o.capacity > 0);
  const teachers = (await registrar.teachers()).filter((t) => t.dept_id === dept);
  const threshold = await num("attendance_threshold", 70);
  const changes = (await services.requests(["section_change"], ["submitted"])).filter((x) => x.dept_id === dept);
  // TCH-A-4: classes held vs classes the timetable says should have happened since classes began
  const start = (await registrar.calendar(sem.id)).find((c) => c.type === "classes")?.start_date ?? sem.start_date;
  const expected = async (offeringId: number) => {
    const days = (await registrar.slotsFor([offeringId])).map((x) => x.day);
    let n = 0;
    for (let d = new Date(start + "T00:00:00Z"); d.toISOString().slice(0, 10) < today(); d.setUTCDate(d.getUTCDate() + 1))
      n += days.filter((x) => x === d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })).length;
    return n;
  };
  const compliance = await Promise.all(offs.filter((o) => o.teacher).map(async (o) => ({ o, held: (await teacher.sessions(o.id)).length, due: await expected(o.id) })));
  const atRisk = (await Promise.all(offs.map(async (o) => (await teacher.attendanceSummary(o.id)).filter((r) => r.total >= 4 && r.percent < threshold).map((r) => ({ ...r, course: `${o.code} ${o.section}` }))))).flat();

  return (
    <>
      <PageHeader eyebrow="Department" title={`${d.short} department desk`} meta={`${d.name} · ${sem.name}`} />
      <Bento>
        <Stat dark icon={FileCheck2} label="Grade sheets to approve" value={sheets.length} sub={`${offs.length} sections in ${d.short} this semester`} />
        <Stat icon={ArrowLeftRight} label="Section changes" value={changes.length} tone={changes.length ? "warning" : undefined} sub="student requests" />
        <Stat icon={ClipboardPen} label="Attendance corrections" value={corrections.length} tone={corrections.length ? "warning" : undefined} sub="past the edit window" />
        <Stat icon={TriangleAlert} label="Students at risk" value={atRisk.length} tone={atRisk.length ? "danger" : "success"} sub={`below ${threshold}% attendance`} />
      </Bento>
      <div className="space-y-6">
        <Sheet flush title="Grade sheets awaiting approval" actions={sheets.length ? <Stamp tone="wait">{sheets.length} waiting</Stamp> : null}>
          {sheets.length === 0 ? <Empty title="No grade sheets waiting">Submitted sheets land here. Approve to send them to the Exam Controller, or return with a comment.</Empty> : await Promise.all(sheets.map(async (g) => {
            const gs = await teacher.gradeSheet(g.offering_id);
            const dist = gs.rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.letter]: (a[r.letter] ?? 0) + 1 }), {});
            return (
              <details key={g.offering_id} className="group border-b border-rule last:border-0">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4 transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
                  <ChevronRight aria-hidden size={16} className="text-meta transition-transform group-open:rotate-90" />
                  <span className="num font-medium text-brand">{g.code} {g.section}</span><span className="text-meta">{g.title} · {g.teacher}</span>
                  <span className="ml-auto flex flex-wrap gap-1">{Object.entries(dist).map(([l, n]) => <span key={l} className="num rounded-md bg-muted px-1.5 py-0.5 text-[0.75rem] text-strong">{l}×{n}</span>)}</span>
                  <span className="text-[0.75rem] text-meta">submitted {fmtDateTime(g.submitted_at)}</span>
                </summary>
                <div className="border-t border-rule">
                  <Table>
                    <thead><tr><th>Student</th>{gs.assessments.map((a) => <th key={a.id} className="r">{a.title}</th>)}<th className="r">Total</th><th>Grade</th></tr></thead>
                    <tbody>{gs.rows.map((r) => <tr key={r.student_id}><td>{r.name}</td>{r.scores.map((x, i) => <td key={i} className="r num">{x}</td>)}<td className="r num font-semibold">{r.total.toFixed(2)}</td><td className="num font-semibold text-brand">{r.letter}</td></tr>)}</tbody>
                  </Table>
                  <form action={A.decideGradesheetAction} className="flex flex-wrap items-end gap-3 border-t border-rule bg-muted/50 px-6 py-4">
                    <input type="hidden" name="offering_id" value={g.offering_id} />
                    <Field label="Comment (required to return)" className="min-w-64 flex-1"><input autoComplete="off" name="comment" className={inputCls} /></Field>
                    <Button name="decision" value="approve">Approve</Button>
                    <Button name="decision" value="return" variant="danger" confirm="Return the grade sheet to the teacher for changes?">Return to teacher</Button>
                  </form>
                </div>
              </details>
            );
          }))}
        </Sheet>

        <Sheet flush title="Section change requests" actions={changes.length ? <Stamp tone="wait">{changes.length} waiting</Stamp> : null}>
          {changes.length === 0 ? <Empty title="No section change requests" /> : (
            <Table>
              <thead><tr><th>Student</th><th>From</th><th>To</th><th>Reason</th><th /></tr></thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.student} <span className="num text-[0.75rem] text-meta">{c.student_code}</span></td><td className="num">{c.course}</td><td className="num font-medium text-brand">{c.target}</td>
                    <td className="text-[0.8125rem]">{c.detail}</td>
                    <td className="r">
                      <form action={A.decideServiceRequestAction} className="flex justify-end gap-1.5">
                        <input type="hidden" name="request_id" value={c.id} />
                        <Button size="sm" name="action" value="approve">Approve</Button>
                        <input autoComplete="off" name="note" placeholder="Reason (to reject)…" aria-label="Reason to reject" className={`${inputCls} h-8 w-36`} />
                        <Button size="sm" variant="danger" name="action" value="reject" confirm="Reject this request? The person is notified.">Reject</Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Sheet>

        <Sheet flush title="Late attendance corrections">
          {corrections.length === 0 ? <Empty title="No corrections waiting" /> : (
            <Table>
              <thead><tr><th>Class</th><th>Student</th><th>Change to</th><th>Reason</th><th>Requested by</th><th /></tr></thead>
              <tbody>
                {corrections.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">{c.code} {c.section} · {fmtDate(c.date)}</td><td>{c.student} <span className="num text-[0.75rem] text-meta">{c.student_code}</span></td>
                    <td><StatusStamp status={c.status} /></td><td className="text-[0.8125rem]">{c.reason}</td><td className="text-[0.8125rem]">{c.by_name}</td>
                    <td className="r">
                      <form action={A.decideCorrectionAction} className="flex justify-end gap-1.5">
                        <input type="hidden" name="record_id" value={c.id} />
                        <Button size="sm" name="decision" value="approve">Approve</Button>
                        <Button size="sm" variant="danger" name="decision" value="reject" confirm="Reject this request? The person is notified.">Reject</Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Sheet>

        <div className="grid gap-6 xl:grid-cols-2">
          <Sheet flush title="Teacher assignments" actions={<span className="text-[0.75rem] text-meta">Proposals go to the Registrar</span>}>
            <Table>
              <thead><tr><th>Section</th><th>Assigned</th><th>Propose</th></tr></thead>
              <tbody>
                {offs.map((o) => (
                  <tr key={o.id}>
                    <td><span className="num font-medium text-brand">{o.code}</span> {o.section}</td>
                    <td>{o.teacher ?? <span className="text-danger">Unassigned</span>}{o.proposed && <span className="block text-[0.75rem] text-meta">Proposed: {o.proposed}</span>}</td>
                    <td>
                      <form action={A.proposeTeacherAction} className="flex gap-1.5">
                        <input type="hidden" name="offering_id" value={o.id} />
                        <select name="teacher_id" aria-label={`Propose teacher for ${o.code} ${o.section}`} defaultValue={o.proposed_teacher_id ?? o.teacher_id ?? ""} className={`${inputCls} h-9`}>
                          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <Button size="sm" variant="secondary">Propose</Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Sheet>
          <Sheet flush title={`Students below ${threshold}% attendance`}>
            {atRisk.length === 0 ? <Empty title="No one at risk" /> : (
              <Table>
                <thead><tr><th>Student</th><th>Course</th><th className="r">%</th></tr></thead>
                <tbody>{atRisk.map((r) => <tr key={`${r.student_id}-${r.course}`}><td><Link href={`/admin/students/${r.student_id}`} className="text-brand hover:underline">{r.name}</Link></td><td>{r.course}</td><td className="r num font-semibold text-danger">{r.percent}%</td></tr>)}</tbody>
              </Table>
            )}
          </Sheet>
        </div>

        <Sheet flush title="Attendance compliance" actions={<span className="text-[0.75rem] text-meta">Classes held vs timetable since {fmtDate(start)}</span>}>
          <Table>
            <thead><tr><th>Section</th><th>Teacher</th><th className="r">Held</th><th className="r">Scheduled</th><th>Compliance</th></tr></thead>
            <tbody>
              {compliance.map(({ o, held, due }) => {
                const pct = due ? Math.round((Math.min(held, due) / due) * 100) : 100;
                return (
                  <tr key={o.id}>
                    <td><span className="num font-medium text-brand">{o.code}</span> {o.section}</td><td>{o.teacher}</td><td className="r num">{held}</td><td className="r num">{due}</td>
                    <td>{pct >= 90 ? <Stamp tone="ok">{pct}%</Stamp> : pct >= 70 ? <Stamp tone="wait">{pct}%</Stamp> : <Stamp tone="bad">{pct}%</Stamp>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Sheet>

        <Sheet flush title="Grade sheet status">
          <Table>
            <thead><tr><th>Section</th><th>Teacher</th><th className="r">Classes held</th><th>Grade sheet</th></tr></thead>
            <tbody>{await Promise.all(offs.map(async (o) => <tr key={o.id}><td><span className="num font-medium text-brand">{o.code}</span> {o.section}</td><td>{o.teacher ?? "—"}</td><td className="r num">{(await teacher.sessions(o.id)).length}</td><td><StatusStamp status={(await teacher.sheetStatus(o.id)).status} /></td></tr>))}</tbody>
          </Table>
        </Sheet>
      </div>
    </>
  );
}
