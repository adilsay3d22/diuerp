import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { weekday } from "@/lib/db.ts";
import { pickSemester } from "@/lib/page.ts";
import { registrar, student } from "@/modules/index.ts";
import { PageHeader, Sheet, Empty } from "@/components/ui";

export const metadata: Metadata = { title: "Routine" };

export default async function Routine({ searchParams }: PageProps<"/app/routine">) {
  const s = await requireRole("student", "teacher");
  const sem = await pickSemester((await searchParams).sem);
  let items: { offering_id: number; code: string; title: string; section: string; who: string | null }[] = [];
  if (s.role === "student") {
    const st = (await registrar.studentByUser(s.user.id))!;
    items = (await student.enrollments(st.id, sem.id, ["confirmed", "completed"])).map((e) => ({ offering_id: e.offering_id, code: e.code, title: e.title, section: e.section, who: e.teacher }));
  } else {
    const t = (await registrar.teacherByUser(s.user.id))!;
    items = (await registrar.teacherOfferings(t.id, sem.id)).map((o) => ({ offering_id: o.id, code: o.code, title: o.title, section: o.section, who: `${o.enrolled} students` }));
  }
  const slots = await registrar.slotsFor(items.map((i) => i.offering_id));
  const today = weekday();
  const days = registrar.DAYS.filter((d) => slots.some((x) => x.day === d));

  return (
    <>
      <PageHeader eyebrow="Academics" title={s.role === "student" ? "Class routine" : "Teaching timetable"} meta={`${sem.name} · ${sem.code}`}
        actions={
          <nav aria-label="Semester" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-panel">
            {(await registrar.semesters()).map((x) => (
              <Link key={x.id} href={`?sem=${x.id}`} aria-current={x.id === sem.id ? "true" : undefined}
                className={`rounded-xl px-3 py-1 text-[0.8125rem] font-medium ${x.id === sem.id ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>{x.code}</Link>
            ))}
          </nav>
        } />
      {days.length === 0 ? <Sheet><Empty title="No classes this semester">{s.role === "student" ? "Register courses to see your routine." : "No sections are assigned to you this semester."}</Empty></Sheet> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {days.map((d) => (
            <Sheet key={d} className={d === today ? "ring-2 ring-brand" : ""} title={<>{fullDay(d)}{d === today && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[0.6875rem] font-medium text-on-dark">Today</span>}</>}
              sub={`${slots.filter((x) => x.day === d).length} class${slots.filter((x) => x.day === d).length === 1 ? "" : "es"}`} flush>
              <ul>
                {slots.filter((x) => x.day === d).map((x) => {
                  const it = items.find((i) => i.offering_id === x.offering_id)!;
                  return (
                    <li key={`${x.offering_id}-${x.slot_id}`} className="grid grid-cols-[4.5rem_1fr] gap-3 border-t border-rule px-6 py-3.5">
                      <span className="num border-r-2 border-brand/20 pr-3 text-[0.8125rem] font-medium text-heading">{x.start}<br /><span className="font-normal text-meta">{x.end}</span></span>
                      <span className="min-w-0 text-[0.875rem]">
                        <span className="num font-medium text-brand">{it.code}</span> <span className="num text-meta">· {it.section}</span><br />
                        <span className="text-meta">{it.title}</span><br />
                        <span className="text-[0.8125rem] text-strong">{x.room}{it.who ? ` · ${it.who}` : ""}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Sheet>
          ))}
        </div>
      )}
    </>
  );
}

const fullDay = (d: string) => ({ Sat: "Saturday", Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday" })[d] ?? d;
