import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth.ts";
import { today } from "@/lib/db.ts";
import { pickSemester } from "@/lib/page.ts";
import { registrar } from "@/modules/index.ts";
import { PageHeader, Sheet, Stamp, Empty, DateBlock, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Academic calendar" };
const TONE = { registration: "info", classes: "ok", midterm: "wait", final: "bad", holiday: "neutral", deadline: "wait" } as const;

export default async function Calendar({ searchParams }: PageProps<"/app/calendar">) {
  await requireUser();
  const sem = await pickSemester((await searchParams).sem);
  const events = await registrar.calendar(sem.id);
  const d = today();
  return (
    <>
      <PageHeader eyebrow="Campus" title="Academic calendar" meta={<>{sem.name} · {fmtDate(sem.start_date)} to {fmtDate(sem.end_date)} · <a href={`/api/calendar?sem=${sem.id}`} className="text-brand hover:underline">Add to my phone calendar (.ics)</a></>}
        actions={<nav aria-label="Semester" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-panel">{(await registrar.semesters()).map((x) => (
          <Link key={x.id} href={`?sem=${x.id}`} className={`rounded-xl px-3 py-1 text-[0.8125rem] font-medium ${x.id === sem.id ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>{x.code}</Link>
        ))}</nav>} />
      <Sheet flush>
        {events.length === 0 ? <Empty title="No events published">The Registrar publishes the calendar before the semester starts.</Empty> : (
          <ol className="py-2">
            {events.map((e) => {
              const now = e.start_date <= d && d <= e.end_date;
              return (
                <li key={e.id} className={`flex items-center gap-4 border-t border-rule px-6 py-4 first:border-0 ${e.end_date < d ? "opacity-55" : ""} ${now ? "bg-brand-soft" : ""}`}>
                  <DateBlock date={e.start_date} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold tracking-[-0.01em] text-heading">{e.title}</p>
                    <p className="text-[0.8125rem] text-meta">{fmtDate(e.start_date)}{e.end_date !== e.start_date && <> – {fmtDate(e.end_date)}</>}{now && <span className="ml-2 font-medium text-brand">Happening now</span>}</p>
                  </div>
                  <Stamp tone={TONE[e.type as keyof typeof TONE] ?? "neutral"}>{e.type}</Stamp>
                </li>
              );
            })}
          </ol>
        )}
      </Sheet>
    </>
  );
}
