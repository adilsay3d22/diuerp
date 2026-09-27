import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { pickSemester } from "@/lib/page.ts";
import { registrar, teacher } from "@/modules/index.ts";
import { publishResultsAction } from "../../../actions.ts";
import { ChevronRight, FileCheck2 } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Empty, btn, fmtDateTime } from "@/components/ui";
import { ConfirmButton } from "@/components/client";

export const metadata: Metadata = { title: "Result publication" };

export default async function Exam({ searchParams }: PageProps<"/admin/exam">) {
  await requireRole("exam_controller");
  const sem = await pickSemester((await searchParams).sem);
  const approved = await teacher.gradesheetsByStatus("dept-approved", { semesterId: sem.id });
  const offs = (await registrar.offerings(sem.id)).filter((o) => o.capacity > 0);
  const counts = await Promise.all(["draft", "returned", "submitted", "dept-approved", "published"].map(async (st) => [st, (await teacher.gradesheetsByStatus(st, { semesterId: sem.id })).length] as const));
  const waiting = [...await teacher.gradesheetsByStatus("draft", { semesterId: sem.id }), ...await teacher.gradesheetsByStatus("returned", { semesterId: sem.id }), ...await teacher.gradesheetsByStatus("submitted", { semesterId: sem.id })];

  return (
    <>
      <PageHeader eyebrow="Controller of Examinations" title="Result publication" meta={`${sem.name} · ${offs.length} sections`}
        actions={<nav aria-label="Semester" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-panel">{(await registrar.semesters()).map((x) => (
          <Link key={x.id} href={`?sem=${x.id}`} className={`rounded-xl px-3 py-1 text-[0.8125rem] font-medium ${x.id === sem.id ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>{x.code}</Link>
        ))}</nav>} />
      <section aria-label="Grade sheet pipeline" className="mb-6 overflow-hidden rounded-[1.75rem] bg-card shadow-panel">
        <p className="eyebrow border-b border-rule px-6 py-3 text-meta">Grade sheet pipeline · {sem.code}</p>
        <ol className="grid grid-cols-2 sm:grid-cols-5">
          {counts.map(([st, n], i) => (
            <li key={st} className={`relative px-6 py-5 ${i ? "border-l border-rule" : ""} ${st === "dept-approved" && n ? "bg-brand-soft" : ""}`}>
              <p className="flex items-center gap-2 text-[0.75rem] capitalize text-meta"><span className="num flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[0.625rem] font-semibold text-strong">{i + 1}</span>{st.replace("-", " ")}</p>
              <p className={`num mt-3 text-[2rem] font-medium leading-none tracking-[-0.05em] ${st === "published" ? "text-success" : st === "returned" && n ? "text-danger" : "text-heading"}`}>{n}</p>
              {i < counts.length - 1 && <ChevronRight aria-hidden size={16} className="absolute -right-2 top-1/2 z-[1] hidden -translate-y-1/2 rounded-full bg-card text-field sm:block" />}
            </li>
          ))}
        </ol>
      </section>

      <Sheet flush title="Department-approved, ready to publish" className="mb-6"
        actions={approved.length > 0 && (
          <form action={publishResultsAction}>
            <input type="hidden" name="semester_id" value={sem.id} />
            <ConfirmButton message={`Publish ${approved.length} grade sheet(s)? Students are notified and results become final; later changes need a grade-change request.`} className={btn("primary", "sm")}>
              Publish {approved.length} sheet{approved.length === 1 ? "" : "s"}
            </ConfirmButton>
          </form>
        )}>
        {approved.length === 0 ? <Empty icon={FileCheck2} title="Nothing waiting for publication">Grade sheets appear here after the Department Head approves them.</Empty> : (
          <Table>
            <thead><tr><th>Course</th><th>Section</th><th>Teacher</th><th className="r">Students</th><th>Submitted</th><th>Status</th></tr></thead>
            <tbody>
              {approved.map((g) => (
                <tr key={g.offering_id}><td><span className="num font-medium text-brand">{g.code}</span> <span className="text-meta">{g.title}</span></td><td>{g.section}</td><td>{g.teacher}</td><td className="r num">{g.students}</td><td className="text-[0.8125rem]">{fmtDateTime(g.submitted_at)}</td><td><Stamp tone="info">Dept. approved</Stamp></td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>

      <Sheet flush title="Still with teachers or departments">
        {waiting.length === 0 ? <Empty title="Every sheet is in" /> : (
          <Table>
            <thead><tr><th>Course</th><th>Section</th><th>Teacher</th><th>Stage</th></tr></thead>
            <tbody>
              {await Promise.all(waiting.map(async (g) => {
                const st = (await teacher.sheetStatus(g.offering_id)).status;
                return <tr key={g.offering_id}><td><span className="num font-medium text-brand">{g.code}</span></td><td>{g.section}</td><td>{g.teacher ?? "Unassigned"}</td><td>{st === "submitted" ? <Stamp tone="wait">With department head</Stamp> : st === "returned" ? <Stamp tone="bad">Returned to teacher</Stamp> : <Stamp tone="neutral">Teacher drafting</Stamp>}</td></tr>;
              }))}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
