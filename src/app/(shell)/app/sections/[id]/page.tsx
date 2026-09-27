import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth.ts";
import { num, today, weekday } from "@/lib/db.ts";
import { registrar, teacher, comms, services } from "@/modules/index.ts";
import * as A from "../../../../actions.ts";
import { Users, CalendarCheck, UserCheck, ClipboardCheck } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, StatusStamp, Button, Empty, Field, Tabs, Bento, Stat, Note, Avatar, inputCls, areaCls, btn, fmtDate, fmtDateTime } from "@/components/ui";
import { ConfirmButton, MarkAll } from "@/components/client";

export const metadata: Metadata = { title: "Section" };

export default async function Section({ params, searchParams }: PageProps<"/app/sections/[id]">) {
  const s = await requireRole("teacher", "ta");
  const id = Number((await params).id);
  const o = await registrar.offering(id);
  // Teachers see their own sections; a TA sees only what the teacher delegated (CORE-3).
  const scope = s.role === "ta" ? await comms.delegatedScope(s.user.id, id) : null;
  if (!o || (s.role === "teacher" ? o.teacher_id !== (await registrar.teacherByUser(s.user.id))?.id : !scope)) notFound();
  const ta = s.role === "ta";
  const q = await searchParams;
  const tab = typeof q.tab === "string" ? q.tab : "attendance";
  const roster = await teacher.roster(id);
  const all = [["attendance", "Attendance"], ["assessments", ta ? "Marks" : "Assessments & marks"], ["grades", "Grade sheet"], ["insights", "Insights"], ["roster", `Roster (${roster.length})`],
    ["materials", "Materials"], ["exams", "Exams"], ["announce", "Announce"], ["assistants", "Assistants"]];
  const allowed = ta ? ["attendance", ...(scope === "marks" ? ["assessments"] : []), "roster"] : all.map(([k]) => k);
  const tabs = all.filter(([k]) => allowed.includes(k)).map(([k, l]) => ({ href: `?tab=${k}`, label: l, active: tab === k }));
  if (!allowed.includes(tab)) notFound();
  return (
    <>
      <PageHeader eyebrow="Teaching" title={`${o.code} ${o.title}`} meta={`Section ${o.section} · ${o.semester} · ${o.credits} credits · ${registrar.scheduleText(await registrar.slotsFor([id]))}`}
        actions={<>
          {!ta && <form action={A.openSectionThreadAction}><input type="hidden" name="offering_id" value={id} /><Button size="sm" variant="secondary">Class conversation</Button></form>}
          {ta ? <Stamp tone="info">{comms.SCOPES[scope as keyof typeof comms.SCOPES]}</Stamp> : <StatusStamp status={(await teacher.sheetStatus(id)).status} />}
        </>} />
      {await (async () => {
        const sum = (await teacher.attendanceSummary(id)).filter((r) => r.total > 0);
        const avg = sum.length ? Math.round(sum.reduce((t, r) => t + r.percent, 0) / sum.length) : null;
        return (
          <Bento className="xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <Stat dark icon={Users} label="Students" value={<>{roster.length}<span className="text-[0.9375rem] text-on-dark-muted">/{o.capacity}</span></>} sub={`Section ${o.section} · ${o.semester}`} />
            <Stat icon={CalendarCheck} label="Classes held" value={(await teacher.sessions(id)).length} sub="attendance sessions" />
            <Stat icon={UserCheck} label="Avg attendance" value={avg != null ? `${avg}%` : "—"} tone={avg != null && avg < await num("attendance_threshold", 70) ? "danger" : undefined} sub={`threshold ${await num("attendance_threshold", 70)}%`} />
            <Stat icon={ClipboardCheck} label="Assessments" value={(await teacher.assessments(id)).length} sub={`weights ${(await teacher.assessments(id)).reduce((t, a) => t + a.weight, 0)}%`} />
          </Bento>
        );
      })()}
      <Tabs tabs={tabs} />
      {tab === "attendance" && <AttendanceTab id={id} q={q} roster={roster} />}
      {tab === "assessments" && <AssessmentsTab id={id} q={q} roster={roster} ta={ta} />}
      {tab === "insights" && <InsightsTab id={id} />}
      {tab === "exams" && <ExamsTab id={id} />}
      {tab === "assistants" && <AssistantsTab id={id} />}
      {tab === "grades" && <GradesTab id={id} />}
      {tab === "roster" && <RosterTab roster={roster} />}
      {tab === "materials" && <MaterialsTab id={id} />}
      {tab === "announce" && (
        <Sheet title="Post a section announcement" className="max-w-2xl">
          <form action={A.postNoticeAction} className="space-y-4">
            <input type="hidden" name="audience" value="section" /><input type="hidden" name="audience_ref" value={id} /><input type="hidden" name="category" value="Class" />
            <Field label="Title"><input autoComplete="off" name="title" required className={inputCls} /></Field>
            <Field label="Message" hint="Every registered student gets a notification."><textarea name="body" required className={areaCls} /></Field>
            <Button>Post to {roster.length} students</Button>
          </form>
        </Sheet>
      )}
    </>
  );
}

type Q = Record<string, string | string[] | undefined>;
type Roster = Awaited<ReturnType<typeof teacher.roster>>;

async function AttendanceTab({ id, q, roster }: { id: number; q: Q; roster: Roster }) {
  const slots = await registrar.slotsFor([id]);
  const date = typeof q.date === "string" ? q.date : today();
  const dayOf = new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const slotKey = typeof q.slot === "string" ? q.slot : (() => { const s = slots.find((x) => x.day === (date === today() ? weekday() : dayOf)) ?? slots[0]; return s ? `${s.slot_id}:${s.room_id}` : ""; })();
  const [slotId] = slotKey.split(":").map(Number);
  const sheet = slotId ? await teacher.attendanceSheet(id, date, slotId) : { session: undefined, marks: {} as Record<number, string> };
  const locked = sheet.session && !(await teacher.correctionOpen(sheet.session.at));
  const summary = await teacher.attendanceSummary(id);
  const threshold = await num("attendance_threshold", 70);
  const sessions = await teacher.sessions(id);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <Sheet title={sheet.session ? "Edit attendance" : "Take attendance"} flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-rule px-6 py-4">
          <input type="hidden" name="tab" value="attendance" />
          <Field label="Date"><input autoComplete="off" type="date" name="date" defaultValue={date} max={today()} className={inputCls} /></Field>
          <Field label="Class" className="min-w-56 flex-1">
            <select name="slot" defaultValue={slotKey} className={inputCls}>
              {slots.map((s) => <option key={s.slot_id} value={`${s.slot_id}:${s.room_id}`}>{s.day} {s.start}–{s.end} · {s.room}</option>)}
            </select>
          </Field>
          <Button variant="secondary">Load</Button>
        </form>
        {roster.length === 0 ? <Empty title="No students registered" /> : (
          <form action={A.saveAttendanceAction}>
            <input type="hidden" name="offering_id" value={id} /><input type="hidden" name="date" value={date} /><input type="hidden" name="slot" value={slotKey} />
            <div className="flex flex-wrap items-center gap-2 px-6 py-3">
              <MarkAll status="present" label="All present" /><MarkAll status="absent" label="All absent" />
              <span className="ml-auto text-[0.8125rem] text-meta">
                {sheet.session ? (locked ? "Correction window closed: changes need Department Head approval." : `Saved ${fmtDateTime(sheet.session.at)} · editable for ${await num("correction_hours", 48)} h`) : "Everyone starts as present."}
              </span>
            </div>
            <ul>
              {roster.map((r) => {
                const cur = sheet.marks[r.student_id] ?? "present";
                return (
                  <li key={r.student_id} className="flex items-center gap-3 border-t border-rule px-6 py-2">
                    <Avatar name={r.name} size={32} /><span className="min-w-0 flex-1 text-[0.875rem]"><span className="font-medium text-heading">{r.name}</span><br /><span className="num text-[0.75rem] text-meta">{r.code}</span></span>
                    <fieldset className="flex shrink-0 gap-1 rounded-xl bg-muted p-1">
                      <legend className="sr-only">Attendance for {r.name}</legend>
                      {([["present", "P", "has-[:checked]:bg-brand-green"], ["late", "L", "has-[:checked]:bg-warning"], ["absent", "A", "has-[:checked]:bg-danger"]] as const).map(([v, l, c]) => (
                        <label key={v} className={`flex h-9 w-10 cursor-pointer items-center justify-center rounded-lg font-mono text-[0.8125rem] font-semibold text-meta transition-colors hover:bg-card has-[:checked]:text-on-dark has-[:checked]:shadow-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${c}`}>
                          <input type="radio" name={`st_${r.student_id}`} value={v} defaultChecked={cur === v} className="sr-only" />
                          <span aria-hidden>{l}</span><span className="sr-only">{v}</span>
                        </label>
                      ))}
                    </fieldset>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-end gap-3 border-t border-rule px-6 py-4">
              {locked && <Field label="Reason for correction" className="min-w-64 flex-1"><input autoComplete="off" name="reason" required className={inputCls} /></Field>}
              <Button>{locked ? "Request correction" : "Save attendance"}</Button>
            </div>
          </form>
        )}
      </Sheet>
      <div className="space-y-6">
        <Sheet title="Attendance report" flush actions={<span className="text-[0.8125rem] text-meta">Threshold {threshold}%</span>}>
          <Table>
            <thead><tr><th>Student</th><th className="r">P</th><th className="r">L</th><th className="r">A</th><th className="r">%</th></tr></thead>
            <tbody>
              {summary.map((r) => (
                <tr key={r.student_id}>
                  <td><span className="text-[0.875rem]">{r.name}</span></td>
                  <td className="r num">{r.present}</td><td className="r num">{r.late}</td><td className="r num">{r.absent}</td>
                  <td className={`r num font-semibold ${r.total && r.percent < threshold ? "text-danger" : ""}`}>{r.total ? r.percent : "—"}{r.total > 0 && r.percent < threshold && <span className="sr-only"> below threshold</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
        <Sheet title={`Classes held (${sessions.length})`} flush>
          {sessions.length === 0 ? <Empty title="No classes recorded yet" /> : (
            <ul className="max-h-80 overflow-y-auto">
              {sessions.map((s) => (
                <li key={s.id} className="flex justify-between border-b border-rule px-6 py-2 text-[0.8125rem] last:border-0">
                  <a className="text-brand hover:underline" href={`?tab=attendance&date=${s.date}&slot=${slots.find((x) => x.day === s.day && x.start === s.start)?.slot_id}:${slots.find((x) => x.day === s.day && x.start === s.start)?.room_id}`}>{fmtDate(s.date)} · {s.day} {s.start}</a>
                  <span className="num text-meta">{s.present}/{s.total} present</span>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      </div>
    </div>
  );
}

async function AssessmentsTab({ id, q, roster, ta = false }: { id: number; q: Q; roster: Roster; ta?: boolean }) {
  const as = await teacher.assessments(id);
  const status = (await teacher.sheetStatus(id)).status;
  const editable = ["draft", "returned"].includes(status);
  const planEditable = editable && !ta;
  const total = as.reduce((s, a) => s + a.weight, 0);
  const sel = as.find((a) => a.id === Number(q.a)) ?? as[0];
  const marks = await teacher.marksFor(id);
  const subs = sel?.type === "assignment" ? await teacher.submissions(sel.id) : [];
  return (
    <div className="space-y-6">
      <Sheet title="Assessment plan" flush actions={Math.abs(total - 100) < 0.001 ? <Stamp tone="ok">Weights total 100%</Stamp> : <Stamp tone="wait">Weights total {total}%</Stamp>}>
        <Table>
          <thead><tr><th>Assessment</th><th>Type</th><th className="r">Max marks</th><th className="r">Weight</th><th>Students see marks</th><th /></tr></thead>
          <tbody>
            {as.map((a) => (
              <tr key={a.id} className={a.id === sel?.id ? "selected" : ""}>
                <td><a href={`?tab=assessments&a=${a.id}`} className="font-semibold hover:underline">{a.title}</a>{a.due_at && <span className="ml-2 text-[0.75rem] opacity-75">due {a.due_at.replace("T", " ")}</span>}</td>
                <td className="capitalize">{a.type}</td><td className="r num">{a.max_marks}</td><td className="r num">{a.weight}%</td>
                <td>
                  {ta ? (a.published ? "Published" : "Hidden") : <form action={A.togglePublishAction}><input type="hidden" name="assessment_id" value={a.id} />
                    <button className={`text-[0.8125rem] font-medium hover:underline ${a.published ? "text-success" : "text-brand"}`}>{a.published ? "Published · hide" : "Hidden · publish"}</button>
                  </form>}
                </td>
                <td className="r num">{planEditable && (
                  <form action={A.removeAssessmentAction}><input type="hidden" name="assessment_id" value={a.id} /><Button variant="ghost" size="sm" className="text-danger hover:bg-tint-red" aria-label={`Remove ${a.title}`} confirm={`Remove ${a.title} from the assessment plan? Its marks are deleted.`}>Remove</Button></form>
                )}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {planEditable && (
          <form action={A.addAssessmentAction} className="grid gap-3 border-t border-rule px-6 py-4 sm:grid-cols-6">
            <input type="hidden" name="offering_id" value={id} />
            <Field label="Type"><select name="type" className={inputCls}>{["quiz", "assignment", "attendance", "mid", "final"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Title" className="sm:col-span-2"><input autoComplete="off" name="title" required className={inputCls} /></Field>
            <Field label="Max marks"><input autoComplete="off" name="max_marks" type="number" step="0.5" min="1" required className={inputCls} /></Field>
            <Field label="Weight %"><input autoComplete="off" name="weight" type="number" step="0.5" min="0.5" required className={inputCls} /></Field>
            <Field label="Due (assignments)"><input autoComplete="off" name="due_at" type="datetime-local" className={inputCls} /></Field>
            <Field label="Instructions (assignments)" className="sm:col-span-5"><input autoComplete="off" name="instructions" className={inputCls} /></Field>
            <div className="flex items-end"><Button className="w-full">Add</Button></div>
          </form>
        )}
      </Sheet>

      {sel && (
        <Sheet title={`Marks · ${sel.title}`} flush actions={<span className="text-[0.8125rem] text-meta">Out of {sel.max_marks}</span>}>
          {roster.length === 0 ? <Empty title="No students registered" /> : (
            <form action={A.enterMarksAction}>
              <input type="hidden" name="assessment_id" value={sel.id} />
              <Table>
                <thead><tr><th>Student</th>{sel.type === "assignment" && <th>Submission</th>}<th className="r">Marks</th>{sel.type === "assignment" && <th>Feedback</th>}</tr></thead>
                <tbody>
                  {roster.map((r) => {
                    const m = marks.find((m) => m.assessment_id === sel.id && m.student_id === r.student_id);
                    const sub = subs.find((s) => s.student_id === r.student_id);
                    return (
                      <tr key={r.student_id}>
                        <td><span className="font-semibold">{r.name}</span> <span className="num text-[0.75rem] text-meta">{r.code}</span></td>
                        {sel.type === "assignment" && <td className="text-[0.8125rem]">{sub ? (sub.file_id ? <a href={`/files/${sub.file_id}`} className="text-brand hover:underline">{sub.file_name}</a> : sub.note) : <span className="text-meta">None</span>}</td>}
                        <td className="r"><input autoComplete="off" aria-label={`Marks for ${r.name}`} name={`m_${r.student_id}`} type="number" step="0.25" min="0" max={sel.max_marks} inputMode="decimal"
                          defaultValue={m?.score_c == null ? "" : m.score_c / 100} disabled={!editable} className={`${inputCls} w-24 text-right`} /></td>
                        {sel.type === "assignment" && <td><input autoComplete="off" aria-label={`Feedback for ${r.name}`} name={`fb_${r.student_id}`} defaultValue={m?.feedback ?? ""} disabled={!editable} className={inputCls} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              {editable && <div className="border-t border-rule px-6 py-4"><Button>Save marks</Button></div>}
            </form>
          )}
          {editable && (
            <form action={A.importMarksAction} className="flex flex-wrap items-end gap-3 border-t border-rule bg-muted/50 px-6 py-4">
              <input type="hidden" name="assessment_id" value={sel.id} />
              <Field label="Import from spreadsheet (CSV)" hint="Columns: student_id,score. Save your Excel sheet as CSV." className="min-w-64 flex-1">
                <input type="file" name="file" accept=".csv,text/csv" required className={`${inputCls} py-1.5`} />
              </Field>
              <Button variant="secondary">Import</Button>
              <a download="marks-template.csv" href={`data:text/csv,student_id,score%0A${roster.map((r) => `${r.code},`).join("%0A")}`} className={btn("ghost")}>Download template</a>
            </form>
          )}
        </Sheet>
      )}
    </div>
  );
}

async function GradesTab({ id }: { id: number }) {
  const g = await teacher.gradeSheet(id);
  const st = await teacher.sheetStatus(id);
  const editable = ["draft", "returned"].includes(st.status);
  return (
    <div className="space-y-6">
      {st.status === "returned" && st.comment && (
        <Note tone="bad"><b className="text-danger">Returned by the Department Head:</b> {st.comment}</Note>
      )}
      <Sheet flush title="Grade sheet" actions={<StatusStamp status={st.status} big={!editable} />}>
        <Table>
          <thead>
            <tr><th>Student</th>{g.assessments.map((a) => <th key={a.id} className="r">{a.title}<br /><span className="font-normal text-meta">/{a.max_marks} · {a.weight}%</span></th>)}<th className="r">Total</th><th>Grade</th></tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.student_id}>
                <td><span className="font-semibold">{r.name}</span> <span className="num text-[0.75rem] text-meta">{r.code}</span></td>
                {r.scores.map((s, i) => <td key={i} className={`r num ${s === null ? "text-danger" : ""}`}>{s ?? "—"}</td>)}
                <td className="r num font-semibold text-heading">{r.total.toFixed(2)}</td>
                <td className={`num ${r.letter === "F" ? "font-semibold text-danger" : "font-semibold text-brand"}`}>{r.letter}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {editable && (
          <form action={A.submitGradesheetAction} className="flex flex-wrap items-center gap-3 border-t border-rule px-6 py-4">
            <input type="hidden" name="offering_id" value={id} />
            <ConfirmButton message="Submit the grade sheet? It locks immediately; later changes need a grade-change request." className={btn("primary")}>Submit for approval</ConfirmButton>
            <span className="text-[0.8125rem] text-meta">Weights must total 100% and every student needs a mark (enter 0 for absent).</span>
          </form>
        )}
      </Sheet>
      {st.status === "published" && (
        <Sheet title="Request a grade change" className="max-w-3xl">
          <form action={A.requestGradeChangeAction} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="offering_id" value={id} />
            <Field label="Student" className="sm:col-span-2"><select name="student_id" className={inputCls}>{g.rows.map((r) => <option key={r.student_id} value={r.student_id}>{r.code} · {r.name}</option>)}</select></Field>
            <Field label="Corrected total (0–100)"><input autoComplete="off" name="total" type="number" step="0.01" min="0" max="100" required className={inputCls} /></Field>
            <div />
            <Field label="Reason" className="sm:col-span-3"><input autoComplete="off" name="reason" required className={inputCls} /></Field>
            <div className="flex items-end"><Button className="w-full">Send request</Button></div>
          </form>
        </Sheet>
      )}
    </div>
  );
}

function RosterTab({ roster }: { roster: Roster }) {
  return (
    <Sheet flush>
      {roster.length === 0 ? <Empty title="No students registered yet" /> : (
        <Table>
          <thead><tr><th>Student ID</th><th>Name</th><th>Batch · Section</th><th>Email</th><th>Phone</th><th>Type</th></tr></thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.student_id}>
                <td className="num">{r.code}</td><td><span className="flex items-center gap-2.5"><Avatar name={r.name} size={28} /><span className="font-medium">{r.name}</span></span></td><td className="num">{r.batch}_{r.section}</td>
                <td><a href={`mailto:${r.email}`} className="text-brand hover:underline">{r.email}</a></td><td className="num">{r.phone ?? "—"}</td><td className="capitalize">{r.type}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Sheet>
  );
}

async function MaterialsTab({ id }: { id: number }) {
  const mats = await teacher.materials(id);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Sheet flush title="Published materials">
        {mats.length === 0 ? <Empty title="Nothing published yet">Notes, slides, PDFs and links you add appear on each student’s course page by week.</Empty> : (
          <Table>
            <thead><tr><th className="r">Week</th><th>Title</th><th>Item</th></tr></thead>
            <tbody>
              {mats.map((m) => (
                <tr key={m.id}><td className="r num">{m.week}</td><td className="font-medium">{m.title}</td>
                  <td>{m.file_id ? <a href={`/files/${m.file_id}`} className="text-brand hover:underline">{m.file_name}</a> : <a href={m.url!} target="_blank" rel="noreferrer" className="text-brand hover:underline">Link</a>}</td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
      <Sheet title="Add material" className="self-start">
        <form action={A.addMaterialAction} className="space-y-3">
          <input type="hidden" name="offering_id" value={id} />
          <Field label="Week"><input autoComplete="off" name="week" type="number" min="1" max="20" defaultValue={1} className={inputCls} /></Field>
          <Field label="Title"><input autoComplete="off" name="title" required className={inputCls} /></Field>
          <Field label="File" hint="PDF, Office, image or ZIP up to 4 MB"><input name="file" type="file" className={`${inputCls} py-1.5`} /></Field>
          <Field label="…or a link (video, drive folder)"><input autoComplete="off" name="url" type="url" placeholder="https://" className={inputCls} /></Field>
          <Button>Publish</Button>
        </form>
      </Sheet>
    </div>
  );
}

// TCH-U-14: who is slipping, from attendance and marks so far
async function InsightsTab({ id }: { id: number }) {
  const t = await num("attendance_threshold", 70);
  const att = new Map((await teacher.attendanceSummary(id)).map((a) => [a.student_id, a]));
  const g = await teacher.gradeSheet(id);
  const marked = g.assessments.map((a, i) => ({ a, i })).filter(({ i }) => g.rows.some((r) => r.scores[i] !== null));
  const weight = marked.reduce((w, { a }) => w + a.weight, 0);
  const rows = g.rows.map((r) => {
    const earned = marked.reduce((t2, { a, i }) => t2 + ((r.scores[i] ?? 0) / a.max_marks) * a.weight, 0);
    const running = weight ? Math.round((earned / weight) * 100) : null;
    const at = att.get(r.student_id);
    const risks = [...(at && at.total >= 4 && at.percent < t ? [`Attendance ${at.percent}%`] : []), ...(running != null && running < 45 ? [`Marks so far ${running}%`] : [])];
    return { ...r, running, attendance: at?.total ? at.percent : null, risks };
  }).sort((a, b) => b.risks.length - a.risks.length || (a.running ?? 100) - (b.running ?? 100));
  const buckets = [[0, 40], [40, 50], [50, 60], [60, 70], [70, 80], [80, 101]].map(([lo, hi]) => ({ label: hi > 100 ? "80+" : `${lo}–${hi - 1}`, n: rows.filter((r) => r.running != null && r.running >= lo && r.running < hi).length }));
  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Sheet title="Marks so far">
        <p className="mb-4 text-[0.8125rem] text-meta">{weight ? `Based on ${marked.length} assessment${marked.length === 1 ? "" : "s"} worth ${weight}% of the course.` : "No marks entered yet."}</p>
        <ol className="space-y-2" aria-label="Distribution of marks so far">
          {buckets.map((b) => (
            <li key={b.label} className="grid grid-cols-[3.5rem_1fr_1.5rem] items-center gap-2 text-[0.8125rem]">
              <span className="num text-meta">{b.label}%</span>
              <span className="h-2 rounded-full bg-track"><span className="block h-2 rounded-full bg-brand" style={{ width: `${(b.n / max) * 100}%` }} /></span>
              <span className="num text-right">{b.n}</span>
            </li>
          ))}
        </ol>
      </Sheet>
      <Sheet title="Students" flush>
        <Table>
          <thead><tr><th>Student</th><th className="r">Attendance</th><th className="r">Marks so far</th><th>Watch</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.student_id}>
                <td>{r.name} <span className="num text-[0.75rem] text-meta">{r.code}</span></td>
                <td className={`r num ${r.attendance != null && r.attendance < t ? "font-semibold text-danger" : ""}`}>{r.attendance ?? "—"}{r.attendance != null && "%"}</td>
                <td className={`r num ${r.running != null && r.running < 45 ? "font-semibold text-danger" : ""}`}>{r.running ?? "—"}{r.running != null && "%"}</td>
                <td>{r.risks.length ? <span className="flex flex-wrap gap-1">{r.risks.map((x) => <Stamp key={x} tone="bad">{x}</Stamp>)}</span> : <Stamp tone="ok">On track</Stamp>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Sheet>
    </div>
  );
}

// TCH-U-11: question papers go to a restricted area only the Exam Controller can open
async function ExamsTab({ id }: { id: number }) {
  const exams = await services.offeringExams(id);
  return (
    <Sheet title="Exams" flush>
      {exams.length === 0 ? <Empty title="No exams scheduled yet">The Exam Controller schedules mid-term and final exams.</Empty> : (
        <Table>
          <thead><tr><th>Exam</th><th>When</th><th>Rooms</th><th>Question paper</th></tr></thead>
          <tbody>
            {exams.map((x) => (
              <tr key={x.id}>
                <td className="capitalize font-medium">{x.stage}</td><td className="whitespace-nowrap">{fmtDate(x.date)} · {x.start}–{x.end}</td><td className="text-[0.8125rem]">{x.rooms ?? "Seat plan pending"}</td>
                <td>
                  {x.papers > 0 && <Stamp tone="ok">Uploaded</Stamp>}
                  <form action={A.uploadPaperAction} className="mt-1.5 flex gap-2">
                    <input type="hidden" name="exam_id" value={x.id} />
                    <input name="file" type="file" required accept=".pdf,.doc,.docx" aria-label={`${x.stage} question paper`} className={`${inputCls} h-8 py-1 text-[0.8125rem]`} />
                    <Button size="sm" variant="secondary">{x.papers ? "Replace" : "Upload"}</Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="px-6 py-4 text-[0.8125rem] text-meta">Papers stay sealed: other teachers and students cannot open them.</p>
    </Sheet>
  );
}

// CORE-3: time-bound help from a teaching assistant
async function AssistantsTab({ id }: { id: number }) {
  const list = await comms.delegationsFor(id);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Sheet title="Teaching assistants" flush>
        {list.length === 0 ? <Empty title="No assistants">Give a TA time-limited access to take attendance, or to enter marks too.</Empty> : (
          <Table>
            <thead><tr><th>Assistant</th><th>Can do</th><th>Until</th><th /></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td>{d.name} <span className="num text-[0.75rem] text-meta">{d.uni_id}</span></td><td>{comms.SCOPES[d.scope as keyof typeof comms.SCOPES]}</td>
                  <td className="text-[0.8125rem]">{fmtDateTime(d.expires_at)}</td>
                  <td className="r"><form action={A.revokeDelegationAction}><input type="hidden" name="id" value={d.id} /><Button size="sm" variant="danger" confirm="Remove this assistant's access now?">Remove</Button></form></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
      <Sheet title="Add an assistant" className="self-start">
        <form action={A.delegateAction} className="space-y-3">
          <input type="hidden" name="offering_id" value={id} />
          <Field label="Their university ID" hint="A senior student or colleague"><input autoComplete="off" name="uni_id" required className={inputCls} placeholder="253-15-0002…" spellCheck={false} /></Field>
          <Field label="They can"><select name="scope" className={inputCls}>{Object.entries(comms.SCOPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="For how many days"><input autoComplete="off" name="days" type="number" min="1" max="180" defaultValue={14} className={inputCls} /></Field>
          <Button>Give access</Button>
          <p className="text-[0.75rem] text-meta">They can never submit the grade sheet or change the assessment plan.</p>
        </form>
      </Sheet>
    </div>
  );
}
