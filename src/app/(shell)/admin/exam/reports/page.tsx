import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireRole } from "@/lib/auth.ts";
import { pickSemester } from "@/lib/page.ts";
import { registrar, services } from "@/modules/index.ts";
import { PageHeader, Sheet, Table, Stamp, Tabs, Segmented, Empty, Progress, btn } from "@/components/ui";

export const metadata: Metadata = { title: "Academic reports" };

// STU-A-9: registration statistics, result analysis, probation list, graduation eligibility.
export default async function Reports({ searchParams }: PageProps<"/admin/exam/reports">) {
  await requireRole("exam_controller");
  const q = await searchParams;
  const sem = await pickSemester(q.sem);
  const view = String(q.view ?? "registration");
  const tabs = [["registration", "Registration"], ["results", "Result analysis"], ["probation", "Probation"], ["graduation", "Graduation eligibility"]]
    .map(([k, l]) => ({ href: `?view=${k}&sem=${sem.id}`, label: l, active: view === k }));
  const csv = (r: string) => <a href={`/admin/export/${r}?sem=${sem.id}`} className={btn("ghost", "sm")}><Download aria-hidden size={14} />CSV</a>;
  const standing = view === "probation" || view === "graduation" ? await services.standing() : [];
  return (
    <>
      <PageHeader eyebrow="Controller of Examinations" title="Academic reports" meta={sem.name} actions={<Segmented label="Semester" items={(await registrar.semesters()).map((x) => ({ href: `?view=${view}&sem=${x.id}`, label: x.code, active: x.id === sem.id }))} />} />
      <Tabs tabs={tabs} />
      {view === "registration" && (
        <Sheet flush actions={csv("registration")}>
          <Table>
            <thead><tr><th>Section</th><th className="r">Capacity</th><th className="r">Registered</th><th className="r">Waitlist</th><th className="r">Dropped</th><th className="r">Withdrawn</th><th className="r">Fill</th></tr></thead>
            <tbody>
              {(await services.registrationStats(sem.id)).map((r) => (
                <tr key={`${r.code}${r.section}`}>
                  <td><span className="num font-medium text-brand">{r.code}</span> {r.section} <span className="text-meta">{r.title}</span></td><td className="r num">{r.capacity}</td><td className="r num">{r.confirmed}</td>
                  <td className="r num">{r.waitlisted || "—"}</td><td className="r num">{r.dropped || "—"}</td><td className="r num">{r.withdrawn || "—"}</td>
                  <td className="r"><span className="flex items-center justify-end gap-2"><span className="num w-10 text-right">{Math.round((r.confirmed / r.capacity) * 100)}%</span><span className="w-20"><Progress value={r.confirmed} max={r.capacity} label={`${r.code} ${r.section} fill`} /></span></span></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
      )}
      {view === "results" && await (async () => {
        const rows = await services.resultAnalysis(sem.id);
        return (
          <Sheet flush actions={csv("results")}>
            {rows.length === 0 ? <Empty title={`No published results for ${sem.name}`} /> : (
              <Table>
                <thead><tr><th>Section</th><th className="r">Students</th><th className="r">Average GP</th><th className="r">Pass rate</th><th>Grades</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.code}${r.section}`}>
                      <td><span className="num font-medium text-brand">{r.code}</span> {r.section}</td><td className="r num">{r.n}</td><td className="r num">{r.avg.toFixed(2)}</td>
                      <td className={`r num ${r.pass < 80 ? "font-semibold text-danger" : ""}`}>{r.pass}%</td>
                      <td><span className="flex flex-wrap gap-1">{Object.entries(r.dist).sort().map(([l, n]) => <span key={l} className="num rounded-md bg-muted px-1.5 py-0.5 text-[0.75rem] text-strong">{l}×{n}</span>)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Sheet>
        );
      })()}
      {view === "probation" && (() => {
        const rows = standing.filter((s) => s.cgpa != null && (s.cgpa < 2 || (s.sgpa ?? 4) < 2));
        return (
          <Sheet flush actions={csv("probation")}>
            {rows.length === 0 ? <Empty title="No students on academic probation" /> : (
              <Table>
                <thead><tr><th>Student</th><th>Program</th><th className="r">Last SGPA</th><th className="r">CGPA</th></tr></thead>
                <tbody>{rows.map((s) => <tr key={s.id}><td><Link href={`/admin/students/${s.id}`} className="text-brand hover:underline">{s.name}</Link> <span className="num text-[0.75rem] text-meta">{s.student_id}</span></td><td>{s.program}</td><td className="r num">{s.sgpa?.toFixed(2)}</td><td className="r num font-semibold text-danger">{s.cgpa?.toFixed(2)}</td></tr>)}</tbody>
              </Table>
            )}
            <p className="px-6 py-4 text-[0.8125rem] text-meta">Probation: CGPA or last semester GPA below 2.00.</p>
          </Sheet>
        );
      })()}
      {view === "graduation" && (
        <Sheet flush actions={csv("graduation")}>
          <Table>
            <thead><tr><th>Student</th><th>Program</th><th className="r">Credits</th><th className="r">CGPA</th><th>Status</th></tr></thead>
            <tbody>
              {[...standing].sort((a, b) => b.earned / b.total_credits - a.earned / a.total_credits).map((s) => (
                <tr key={s.id}>
                  <td>{s.name} <span className="num text-[0.75rem] text-meta">{s.student_id}</span></td><td>{s.program}</td>
                  <td className="r num">{s.earned}/{s.total_credits}</td><td className="r num">{s.cgpa?.toFixed(2) ?? "—"}</td>
                  <td>{s.conv ? <Stamp tone="ok">Eligible</Stamp> : <Stamp tone="neutral">{Math.round((s.earned / s.total_credits) * 100)}% done</Stamp>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
      )}
    </>
  );
}
