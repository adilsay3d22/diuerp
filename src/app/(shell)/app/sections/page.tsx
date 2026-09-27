import type { Metadata } from "next";
import Link from "next/link";
import { pickSemester } from "@/lib/page.ts";
import { requireRole } from "@/lib/auth.ts";
import { registrar, teacher, comms } from "@/modules/index.ts";
import { Users, ArrowRight } from "lucide-react";
import { PageHeader, Sheet, StatusStamp, Empty, Progress } from "@/components/ui";

export const metadata: Metadata = { title: "My sections" };

export default async function Sections({ searchParams }: PageProps<"/app/sections">) {
  const s = await requireRole("teacher", "ta");
  const sem = await pickSemester((await searchParams).sem);
  // A TA sees only sections delegated to them (CORE-3)
  const delegated = s.role === "ta" ? await comms.taOfferings(s.user.id) : [];
  const offs = s.role === "ta" ? (await Promise.all(delegated.map(async (d) => (await registrar.offering(d.offering_id))!))).filter(Boolean)
    : await registrar.teacherOfferings((await registrar.teacherByUser(s.user.id))!.id, sem.id);
  const slots = await registrar.slotsFor(offs.map((o) => o.id));
  return (
    <>
      <PageHeader eyebrow="Teaching" title="My sections" meta={`${sem.name} · ${sem.code}`}
        actions={<nav aria-label="Semester" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-panel">{(await registrar.semesters()).map((x) => (
          <Link key={x.id} href={`?sem=${x.id}`} className={`rounded-xl px-3 py-1 text-[0.8125rem] font-medium ${x.id === sem.id ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>{x.code}</Link>
        ))}</nav>} />
      {offs.length === 0 ? <Sheet><Empty icon={Users} title="No sections this semester">Sections assigned to you by the Registrar appear here.</Empty></Sheet> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {await Promise.all(offs.map(async (o) => (
            <Link key={o.id} href={`/app/sections/${o.id}`} className="group flex flex-col rounded-[1.75rem] bg-card p-6 shadow-panel transition-[transform,box-shadow] duration-300 ease-(--ease-out-expo) hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex items-start justify-between gap-3">
                <span className="num rounded-lg bg-brand-soft px-2 py-0.5 text-[0.8125rem] font-medium text-brand">{o.code} · {o.section}</span>
                <StatusStamp status={(await teacher.sheetStatus(o.id)).status} />
              </div>
              <p className="mt-3 text-[1.125rem] font-semibold tracking-[-0.02em] text-heading">{o.title}</p>
              <p className="mt-1 text-[0.8125rem] text-meta">{registrar.scheduleText(slots.filter((s) => s.offering_id === o.id)) || "Schedule to be announced"}</p>
              <div className="mt-auto pt-5">
                <p className="mb-2 flex justify-between text-[0.8125rem] text-meta"><span>Students</span><span className="num text-ink">{o.enrolled}/{o.capacity}</span></p>
                <Progress value={o.enrolled} max={o.capacity} label={`${o.code} enrolment`} />
              </div>
              <span className="mt-5 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand">Open section<ArrowRight aria-hidden size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          )))}
        </div>
      )}
    </>
  );
}
