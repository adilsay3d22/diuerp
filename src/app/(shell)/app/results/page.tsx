import type { Metadata } from "next";
import { studentCtx } from "@/lib/page.ts";
import { SCALE } from "@/lib/rules.ts";
import { student, services } from "@/modules/index.ts";
import { evaluationAction } from "../../../actions.ts";
import { GraduationCap, TrendingUp, Layers } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Button, Empty, Field, Bento, Stat, areaCls } from "@/components/ui";

export const metadata: Metadata = { title: "Results" };

export default async function Results() {
  const { st } = await studentCtx();
  const tr = (await student.transcript(st.id)).reverse();
  return (
    <>
      <PageHeader eyebrow="Academics" title="Results" meta={`${st.student_id} · ${st.program} · Credits earned ${await student.creditsEarned(st.id)} of ${st.total_credits}`} />
      {tr.length > 0 && (
        <Bento className="xl:grid-cols-[1.4fr_1fr_1fr]">
          <Stat dark icon={GraduationCap} label="Cumulative GPA" value={tr[0].cgpa.toFixed(2)} sub={`after ${tr[0].name}`} />
          <Stat icon={TrendingUp} label="Latest SGPA" value={(await student.pendingEvaluations(st.id, tr[0].semester_id)).length ? "—" : tr[0].sgpa.toFixed(2)} sub={tr[0].name} />
          <Stat icon={Layers} label="Credits earned" value={<>{await student.creditsEarned(st.id)}<span className="text-[0.9375rem] text-meta">/{st.total_credits}</span></>} sub={`${tr.length} semester${tr.length === 1 ? "" : "s"} with results`} />
        </Bento>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          {tr.length === 0 && <Sheet><Empty title="No results published yet">Results appear here when the Exam Controller publishes them.</Empty></Sheet>}
          {await Promise.all(tr.map(async (sem) => {
            const pending = await student.pendingEvaluations(st.id, sem.semester_id);
            return (
              <Sheet key={sem.semester} title={`${sem.name} · ${sem.semester}`} flush
                actions={pending.length ? <Stamp tone="wait">Locked</Stamp> : <span className="num flex gap-3 text-[0.8125rem] text-meta"><span>SGPA <b className="font-semibold text-heading">{sem.sgpa.toFixed(2)}</b></span><span>CGPA <b className="font-semibold text-brand">{sem.cgpa.toFixed(2)}</b></span></span>}>
                {pending.length ? (
                  <div className="px-6 pb-6">
                    <p className="mb-4 max-w-[70ch] text-[0.875rem] text-strong">Submit a teaching evaluation for each course to unlock this semester’s grades. Teachers only ever see anonymised totals.</p>
                    <div className="space-y-3">
                      {await Promise.all(pending.map(async (e) => (
                        <form key={e.offering_id} action={evaluationAction} className="rounded-2xl border border-rule bg-muted/50 p-5">
                          <input type="hidden" name="offering_id" value={e.offering_id} />
                          <p className="font-semibold text-heading"><span className="num text-brand">{e.code}</span> <span className="font-normal text-meta">{e.title} · {e.teacher ?? "—"}</span></p>
                          {(await services.evalForm(sem.semester_id)).questions.map((q) => (
                            <fieldset key={q} className="mt-3">
                              <legend className="mb-1 text-[0.8125rem] font-medium text-strong">{q}</legend>
                              <div className="flex flex-wrap gap-1.5">
                                {[1, 2, 3, 4, 5].map((v) => (
                                  <label key={v} className="num flex h-9 w-10 cursor-pointer items-center justify-center rounded-xl border border-field bg-card text-[0.8125rem] transition-colors hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-on-dark has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand">
                                    <input type="radio" name={`q:${q}`} value={v} required className="sr-only" />{v}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          ))}
                          <fieldset className="mt-3">
                            <legend className="mb-1 text-[0.8125rem] font-semibold text-strong">Overall, how effective was the teaching?</legend>
                            <div className="flex flex-wrap gap-2">
                              {["Poor", "Fair", "Good", "Very good", "Excellent"].map((l, i) => (
                                <label key={l} className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-field bg-card px-3 py-1.5 text-[0.8125rem] transition-colors hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-on-dark has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand">
                                  <input type="radio" name="rating" value={i + 1} required className="sr-only" />{i + 1} · {l}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          <Field label="Comment (optional)" className="mt-3"><textarea name="comment" className={`${areaCls} min-h-16`} /></Field>
                          <Button size="sm" className="mt-3">Submit evaluation</Button>
                        </form>
                      )))}
                    </div>
                  </div>
                ) : (
                  <Table>
                    <thead><tr><th>Course</th><th className="r">Credits</th><th className="r">Marks</th><th>Grade</th><th className="r">Grade point</th></tr></thead>
                    <tbody>
                      {sem.rows.map((r) => (
                        <tr key={r.id}>
                          <td><span className="num font-medium text-brand">{r.code}</span> <span className="text-meta">{r.title}</span></td>
                          <td className="r num">{r.credits}</td><td className="r num">{(r.total_c / 100).toFixed(2)}</td>
                          <td className={`num ${r.letter === "F" ? "font-semibold text-danger" : "font-semibold text-heading"}`}>{r.letter}</td>
                          <td className="r num">{(r.gp_c / 100).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>Semester total</td><td className="r num">{sem.credits}</td><td /><td>SGPA</td><td className="r num">{sem.sgpa.toFixed(2)}</td></tr></tfoot>
                  </Table>
                )}
              </Sheet>
            );
          }))}
        </div>
        <Sheet title="Grading scale" flush className="self-start">
          <Table>
            <thead><tr><th>Marks</th><th>Grade</th><th className="r">Point</th></tr></thead>
            <tbody>
              {SCALE.map(([min, l, gp], i) => (
                <tr key={l}><td className="num">{min}{i === 0 ? "+" : `–${SCALE[i - 1][0] - 1}`}</td><td className="num font-semibold text-heading">{l}</td><td className="r num">{gp.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </Table>
          <p className="px-6 py-4 text-[0.75rem] text-meta">For a retaken course, the latest attempt counts toward CGPA.</p>
        </Sheet>
      </div>
    </>
  );
}
