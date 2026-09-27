import type { Metadata } from "next";
import Link from "next/link";
import { studentCtx } from "@/lib/page.ts";
import { all } from "@/lib/db.ts";
import { gpa } from "@/lib/rules.ts";
import { student } from "@/modules/index.ts";
import { BookOpen, Layers, GraduationCap, LineChart } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Empty, Bento, Stat } from "@/components/ui";
import { SelectNav } from "@/components/client";

export const metadata: Metadata = { title: "My courses" };

// Current and past semesters: materials and marks stay reachable, and finished courses show their result.
export default async function Courses({ searchParams }: PageProps<"/app/courses">) {
  const { st, sem: current } = await studentCtx();
  // Semesters the student actually studied in, newest first; the active semester is always listed
  const taken = await all<{ id: number; code: string; name: string }>(
    `SELECT DISTINCT sm.id, sm.code, sm.name FROM enrollments e JOIN offerings o ON o.id = e.offering_id JOIN semesters sm ON sm.id = o.semester_id
     WHERE e.student_id = ? AND e.status IN ('confirmed','completed','withdrawn') ORDER BY sm.code DESC`, st.id);
  const list = taken.some((s) => s.id === current.id) ? taken : [{ id: current.id, code: current.code, name: current.name }, ...taken];
  const wanted = Number((await searchParams).sem);
  const sem = list.find((s) => s.id === wanted) ?? list[0];
  const isCurrent = sem.id === current.id;

  const ens = await student.enrollments(st.id, sem.id, ["confirmed", "completed", "withdrawn"]);
  // Grades show once published, unless the semester's evaluations are still owed (same rule as Results)
  const locked = (await student.pendingEvaluations(st.id, sem.id)).length > 0;
  const results = new Map((await student.results(st.id)).filter((r) => r.semester_id === sem.id).map((r) => [r.offering_id, r]));
  const graded = ens.map((e) => results.get(e.offering_id)).filter((r) => r != null);
  const sgpa = graded.length && !locked ? gpa(graded.map((r) => ({ credits: r.credits, gp: r.gp_c / 100 }))) : null;
  const credits = ens.filter((e) => e.status !== "withdrawn").reduce((t, e) => t + e.credits, 0);
  const status = (s: string, done: boolean) =>
    s === "withdrawn" ? <Stamp tone="neutral">Withdrawn</Stamp> : done || s === "completed" ? <Stamp tone="ok">Completed</Stamp> : <Stamp tone="info">In progress</Stamp>;

  return (
    <>
      <PageHeader eyebrow="Academics" title="My courses" meta={`${sem.name} · ${ens.length} course${ens.length === 1 ? "" : "s"} · ${credits} credits${sgpa != null ? ` · SGPA ${sgpa.toFixed(2)}` : ""}`}
        actions={<SelectNav name="sem" label="Semester" value={String(sem.id)} options={list.map((s) => ({ value: String(s.id), label: `${s.name}${s.id === current.id ? " (current)" : ""}` }))} />} />
      {ens.length > 0 && (
        <Bento className="xl:grid-cols-[1fr_1fr_1fr_1.4fr]">
          <Stat icon={BookOpen} label="Courses" value={ens.length} sub={isCurrent ? "this semester" : sem.name} />
          <Stat icon={Layers} label="Credits" value={credits} sub="counted toward your load" />
          <Stat icon={GraduationCap} label="SGPA" value={sgpa != null ? sgpa.toFixed(2) : "—"} sub={locked ? "Submit evaluations to see grades" : sgpa != null ? "published results" : "not published yet"} />
          <Stat href="/app/results" icon={LineChart} label="Full grade history" value={<span className="text-[1.25rem] tracking-[-0.03em]">Results</span>} sub="Transcript by semester" />
        </Bento>
      )}
      <Sheet flush>
        {ens.length === 0 ? (
          <Empty title={isCurrent ? "No courses this semester" : `No courses in ${sem.name}`}>
            {isCurrent && <><Link href="/app/register" className="font-medium text-brand hover:underline">Register courses</Link> to see them here.</>}
          </Empty>
        ) : (
          <Table>
            <thead><tr><th>Course</th><th className="r">Credits</th><th>Section</th><th>Teacher</th><th>Status</th><th>Grade</th><th className="r">Point</th></tr></thead>
            <tbody>
              {ens.map((e) => {
                const r = results.get(e.offering_id);
                return (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/app/courses/${e.offering_id}`} className="num font-medium text-brand hover:underline">{e.code}</Link> <span className="text-meta">{e.title}</span>
                      {e.type !== "regular" && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[0.6875rem] capitalize text-strong">{e.type}</span>}
                    </td>
                    <td className="r num">{e.credits}</td><td className="num">{e.section}</td><td>{e.teacher ?? "TBA"}</td>
                    <td>{status(e.status, !!r)}</td>
                    <td className={`num ${r?.letter === "F" && !locked ? "font-semibold text-danger" : "font-semibold text-heading"}`}>
                      {!r ? <span className="font-normal text-meta">{e.status === "withdrawn" ? "W" : "—"}</span> : locked ? <span className="font-normal text-meta">Evaluate to see</span> : r.letter}
                    </td>
                    <td className="r num">{r && !locked ? (r.gp_c / 100).toFixed(2) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Sheet>
      <p className="mt-4 text-[0.8125rem] text-meta">
        {isCurrent ? "Open a course for its materials, assignments, announcements and marks." : "Past courses keep their materials and marks. The full grade history is under "}
        {!isCurrent && <Link href="/app/results" className="text-brand hover:underline">Results</Link>}
        {locked && !isCurrent && " Grades appear after you submit the course evaluations there."}
      </p>
    </>
  );
}
