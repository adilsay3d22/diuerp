import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Link2 } from "lucide-react";
import { studentCtx } from "@/lib/page.ts";
import { get, dhaka } from "@/lib/db.ts";
import { core, registrar, teacher } from "@/modules/index.ts";
import { submitAssignmentAction, openSectionThreadAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Button, Empty, Field, DateBlock, inputCls, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Course" };

export default async function Course({ params }: PageProps<"/app/courses/[id]">) {
  const { s, st } = await studentCtx();
  const id = Number((await params).id);
  if (!(await get("SELECT 1 FROM enrollments WHERE student_id = ? AND offering_id = ? AND status IN ('confirmed','completed')", st.id, id))) notFound();
  const o = (await registrar.offering(id))!;
  const mats = await teacher.materials(id);
  const as = await teacher.assessments(id);
  const marks = (await teacher.marksFor(id)).filter((m) => m.student_id === st.id);
  const assignments = as.filter((a) => a.type === "assignment");
  const announcements = (await core.noticesFor(s.user.id, s.roles)).filter((n) => n.audience === "section" && n.audience_ref === String(id));
  const weeks = [...new Set(mats.map((m) => m.week))];

  return (
    <>
      <PageHeader eyebrow="Academics" title={`${o.code} ${o.title}`} meta={`Section ${o.section} · ${o.credits} credits · ${o.teacher ?? "Teacher TBA"} · ${registrar.scheduleText(await registrar.slotsFor([id]))}`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Sheet title="Assignments" flush>
            {assignments.length === 0 ? <Empty title="No assignments yet" /> : (
              <ul>
                {await Promise.all(assignments.map(async (a) => {
                  const sub = (await teacher.submissions(a.id)).find((x) => x.student_id === st.id);
                  const m = marks.find((m) => m.assessment_id === a.id);
                  const open = !a.due_at || dhaka(a.due_at) > new Date();
                  return (
                    <li key={a.id} className="border-t border-rule px-6 py-5 first:border-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold tracking-[-0.01em] text-heading">{a.title}</p>
                          <p className="text-[0.8125rem] text-meta">Due {a.due_at ? dhaka(a.due_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }) : "—"} · {a.max_marks} marks · {a.weight}% of total</p>
                        </div>
                        {sub ? <Stamp tone="ok">Submitted</Stamp> : open ? <Stamp tone="wait">Not submitted</Stamp> : <Stamp tone="bad">Missed</Stamp>}
                      </div>
                      {a.instructions && <p className="mt-2 max-w-[70ch] text-[0.875rem] text-strong">{a.instructions}</p>}
                      {sub && <p className="mt-2 text-[0.8125rem] text-meta">Your submission: {sub.file_id ? <a href={`/files/${sub.file_id}`} className="font-medium text-brand hover:underline">{sub.file_name}</a> : sub.note} · {fmtDateTime(sub.at)}</p>}
                      {m && a.published === 1 && <p className="mt-2 text-[0.875rem]"><b>Marks:</b> {m.score_c === null ? "—" : m.score_c / 100} / {a.max_marks}{m.feedback && <> · <span className="text-meta">{m.feedback}</span></>}</p>}
                      {open && (
                        <form action={submitAssignmentAction} className="mt-3 flex flex-wrap items-end gap-3">
                          <input type="hidden" name="assessment_id" value={a.id} />
                          <Field label={sub ? "Replace submission" : "Your file"} className="min-w-56 flex-1"><input name="file" type="file" className={`${inputCls} py-1.5`} /></Field>
                          <Field label="Note (optional)" className="min-w-40 flex-1"><input autoComplete="off" name="note" className={inputCls} /></Field>
                          <Button size="md">Submit</Button>
                        </form>
                      )}
                    </li>
                  );
                }))}
              </ul>
            )}
          </Sheet>

          <Sheet title="Materials" flush>
            {mats.length === 0 ? <Empty title="No materials yet">Your teacher’s notes, slides and links will appear here, organised by week.</Empty> : weeks.map((w) => (
              <div key={w} className="border-b border-rule last:border-0">
                <p className="eyebrow border-y border-rule bg-muted px-6 py-2 text-meta">Week {w}</p>
                <ul>
                  {mats.filter((m) => m.week === w).map((m) => (
                    <li key={m.id} className="flex items-center gap-2.5 px-6 py-3 text-[0.875rem]">
                      {m.file_id ? <FileText aria-hidden size={16} className="text-icon" /> : <Link2 aria-hidden size={16} className="text-icon" />}
                      <a href={m.file_id ? `/files/${m.file_id}` : m.url!} target={m.file_id ? undefined : "_blank"} rel="noreferrer" className="text-brand hover:underline">{m.title}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Sheet>

          <Sheet title="Marks" flush>
            <Table>
              <thead><tr><th>Assessment</th><th className="r">Max</th><th className="r">Weight</th><th className="r">Your marks</th></tr></thead>
              <tbody>
                {as.map((a) => {
                  const m = marks.find((m) => m.assessment_id === a.id);
                  return (
                    <tr key={a.id}>
                      <td>{a.title}</td><td className="r num">{a.max_marks}</td><td className="r num">{a.weight}%</td>
                      <td className="r num font-semibold">{a.published && m?.score_c != null ? m.score_c / 100 : <span className="font-normal text-meta">Not published</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Sheet>
        </div>
        <Sheet title="Announcements" flush className="self-start">
          {announcements.length === 0 ? <Empty title="No announcements" /> : (
            <ul>
              {announcements.map((n) => (
                <li key={n.id} className="flex gap-3 border-b border-rule px-6 py-3.5 last:border-0">
                  <DateBlock date={n.at} />
                  <div><p className="text-[0.875rem] font-semibold">{n.title}</p><p className="mt-1 text-[0.8125rem] text-strong">{n.body}</p></div>
                </li>
              ))}
            </ul>
          )}
          <form action={openSectionThreadAction} className="border-t border-rule px-6 py-4">
            <input type="hidden" name="offering_id" value={id} />
            <button className="text-[0.875rem] font-medium text-brand hover:underline">Open class conversation</button>
          </form>
          <p className="border-t border-rule px-6 py-3 text-[0.75rem] text-meta"><Link href="/app/courses" className="hover:underline">← All courses</Link></p>
        </Sheet>
      </div>
    </>
  );
}
