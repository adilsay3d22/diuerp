import type { Metadata } from "next";
import { Check, Clock, X, Mail } from "lucide-react";
import { studentCtx } from "@/lib/page.ts";
import { num } from "@/lib/db.ts";
import { registrar, student, services } from "@/modules/index.ts";
import { registerAction, dropOwnAction, withdrawAction, submitRequestAction } from "../../../actions.ts";
import { PageHeader, Sheet, Stamp, StatusStamp, Button, Empty, inputCls } from "@/components/ui";
import { SectionPicker, type SectionOption } from "@/components/client";

export const metadata: Metadata = { title: "Course registration" };

type Offering = Awaited<ReturnType<typeof registrar.offerings>>[number];
type Slot = Awaited<ReturnType<typeof registrar.slotsFor>>[number];

// STU-U-3/4: the semester's offered courses, one card each. Pick a section, see who teaches it, enroll;
// afterwards a student may request one section change per course (approved by the Department Head).
export default async function Register() {
  const { st, sem } = await studentCtx();
  const mine = await student.enrollments(st.id, sem.id, ["confirmed", "waitlisted"]);
  const credits = mine.filter((m) => m.status === "confirmed").reduce((s, m) => s + m.credits, 0);
  const max = await num("max_credits", 21);
  // Offered courses: this semester's sections in the student's department, grouped by course
  const offs = (await registrar.offerings(sem.id)).filter((o) => o.capacity > 0 && o.dept_id === st.dept_id);
  const slots = await registrar.slotsFor(offs.map((o) => o.id));
  // Completed courses sink to the bottom; the rest keep course-code order
  const passed = new Set((await student.latestResults(st.id)).filter((r) => r.letter !== "F").map((r) => r.course_id));
  const courses = [...new Map(offs.map((o) => [o.course_id, o])).values()].sort((a, b) => Number(passed.has(a.course_id)) - Number(passed.has(b.course_id)));
  const mySection = `${st.batch}_${st.section}`;
  const registered = courses.filter((c) => mine.some((m) => m.course_id === c.course_id)).length;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Course registration" meta={`${sem.name} · ${courses.length} courses offered · ${registered} registered`}
        actions={sem.reg_open ? <Stamp tone="ok">Registration open</Stamp> : sem.adddrop_open ? <Stamp tone="info">Add/drop open</Stamp> : <Stamp tone="bad">Registration closed</Stamp>} />

      <section aria-label="Registration summary" className="mb-6 grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-brand-deep p-7 text-on-dark">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.65),transparent_65%)]" />
          <p className="eyebrow relative text-[0.625rem] text-brand-green">Credits registered</p>
          <p className="relative mt-3 flex items-baseline gap-2"><span className="num text-[3rem] font-medium leading-none tracking-[-0.05em]">{credits}</span><span className="num text-on-dark-muted">/ {max}</span></p>
          <div className="relative mt-6 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Credits registered" aria-valuenow={credits} aria-valuemin={0} aria-valuemax={max}>
            <div className="h-full rounded-full bg-brand-green" style={{ width: `${Math.min(100, (credits / max) * 100)}%` }} />
          </div>
        </div>
        <div className="rounded-[1.75rem] bg-card p-6 shadow-panel">
          <p className="text-[0.8125rem] text-meta">Your section</p>
          <p className="num mt-1 text-[1.5rem] font-medium tracking-[-0.04em] text-heading">{mySection}</p>
          <ul className="mt-4 space-y-1.5 text-[0.8125rem] text-strong">
            {["Prerequisites", "Credit limit", "Time clashes", "Seats left"].map((x) => <li key={x} className="flex items-center gap-2"><Check aria-hidden size={14} strokeWidth={2.25} className="text-success" />{x} checked on register</li>)}
          </ul>
        </div>
      </section>

      {courses.length === 0 ? <Sheet><Empty title="No courses offered yet">The Registrar publishes this semester’s courses before registration opens.</Empty></Sheet> : (
        <div className="grid gap-5 xl:grid-cols-2">
          {courses.map((c) => {
            const sections = offs.filter((o) => o.course_id === c.course_id).sort((a, b) => a.section.localeCompare(b.section));
            const enrolled = mine.find((m) => m.course_id === c.course_id);
            return (
              <CourseCard key={c.course_id} c={c} sections={sections} slots={slots} enrolled={enrolled} studentId={st.id} semesterId={sem.id}
                mySection={mySection} adddrop={!!sem.adddrop_open} withdraw={!!sem.withdraw_open} />
            );
          })}
        </div>
      )}
      <p className="mt-6 max-w-[80ch] text-[0.8125rem] leading-relaxed text-meta">
        Add/drop is {sem.adddrop_open ? "open: dropping reverses the course charges" : "closed"}. Withdrawal is {sem.withdraw_open ? "open: you keep the charges and the course shows W" : "closed"}.
        You can request one section change per course; your Department Head approves it.
      </p>
    </>
  );
}

async function CourseCard({ c, sections, slots, enrolled, studentId, semesterId, mySection, adddrop, withdraw }: {
  c: Offering; sections: Offering[]; slots: Slot[]; enrolled: Awaited<ReturnType<typeof student.enrollments>>[number] | undefined;
  studentId: number; semesterId: number; mySection: string; adddrop: boolean; withdraw: boolean;
}) {
  const prereqs = await student.prereqStatus(studentId, c.course_id, semesterId);
  const schedule = (id: number) => registrar.scheduleText(slots.filter((s) => s.offering_id === id));
  // Course-level problems block every section; a time clash is specific to one section.
  const check = new Map(await Promise.all(sections.map(async (o) => [o.id, await student.checkRegistration(studentId, o.id)] as const)));
  const courseProblems = [...new Set([...check.values()].flat().filter((p) => !p.startsWith("Time clash")))];
  const blocked = !enrolled && sections.every((o) => check.get(o.id)!.some((p) => !p.startsWith("Time clash")));

  return (
    <Sheet title={<><span className="num mr-2 rounded-lg bg-brand-soft px-2 py-0.5 text-[0.8125rem] font-medium text-brand">{c.code}</span>{c.title}</>}
      actions={enrolled ? <StatusStamp status={enrolled.status} /> : null}>
      <div className="-mt-1 mb-4 flex flex-wrap gap-1.5 text-[0.75rem]">
        <span className="rounded-lg bg-muted px-2 py-0.5 font-medium ring-1 ring-inset ring-rule text-strong">{c.credits} credits</span>
        <span className="rounded-lg bg-muted px-2 py-0.5 font-medium ring-1 ring-inset ring-rule capitalize text-strong">{c.type === "lab" ? "Lab" : "Theory"}</span>
        <span className="rounded-lg bg-muted px-2 py-0.5 font-medium ring-1 ring-inset ring-rule text-strong">
          {sections.length === 1 ? "1 section" : `Sections ${letterOf(sections[0].section)}–${letterOf(sections[sections.length - 1].section)}`} · {sections.reduce((t, o) => t + Math.max(0, o.capacity - o.enrolled), 0)} seats left
        </span>
      </div>

      <div className="mb-4">
        <p className="eyebrow mb-2 text-meta">Prerequisites</p>
        {prereqs.length === 0 ? <p className="text-[0.8125rem] text-meta">None</p> : (
          <ul className="space-y-1">
            {prereqs.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-[0.8125rem]">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${p.status === "completed" ? "bg-tint-green text-success" : p.status === "in_progress" ? "bg-tint-amber text-warning-ink" : "bg-tint-red text-danger"}`}>
                  {p.status === "completed" ? <Check aria-hidden size={12} strokeWidth={3} /> : p.status === "in_progress" ? <Clock aria-hidden size={12} strokeWidth={2.5} /> : <X aria-hidden size={12} strokeWidth={3} />}
                </span>
                <span className="flex-1"><b className="font-medium">{p.code}</b> <span className="text-meta">{p.title}</span></span>
                <span className={p.status === "completed" ? "text-success" : p.status === "in_progress" ? "text-warning-ink" : "text-danger"}>
                  {p.status === "completed" ? `Completed · ${p.letter}` : p.status === "in_progress" ? "In progress" : "Not completed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {enrolled ? <Enrolled e={enrolled} sections={sections} schedule={schedule} studentId={studentId} semesterId={semesterId} adddrop={adddrop} withdraw={withdraw} /> : (
        <form action={registerAction}>
          <fieldset disabled={blocked}>
            <SectionPicker name="offering_id" label={`Choose a section (${sections.length} available)`}
              options={await Promise.all(sections.map((o) => option(o, check.get(o.id)!.find((p) => p.startsWith("Time clash")) ?? null, mySection)))}
              initial={(sections.find((o) => o.section === mySection && !check.get(o.id)!.some((p) => p.startsWith("Time clash")))
                ?? sections.find((o) => !check.get(o.id)!.some((p) => p.startsWith("Time clash"))) ?? sections[0]).id} />
          </fieldset>
          {blocked
            ? <ul className="mt-3 space-y-0.5 text-[0.8125rem] text-danger">{courseProblems.map((p) => <li key={p}>{p}</li>)}</ul>
            : <Button className="mt-3">Register</Button>}
        </form>
      )}
    </Sheet>
  );
}

const letterOf = (section: string) => section.split("_")[1] ?? section;
async function option(o: Offering, clash: string | null, mySection?: string): Promise<SectionOption> {
  const sch = registrar.scheduleText(await registrar.slotsFor([o.id]));
  return { id: o.id, section: o.section, letter: letterOf(o.section), left: o.capacity - o.enrolled, capacity: o.capacity, schedule: sch,
    teacher: o.teacher, designation: o.teacher_designation, email: o.teacher_email, clash, mine: o.section === mySection };
}

function Faculty({ o }: { o: Offering }) {
  if (!o.teacher) return <span className="block text-[0.8125rem] text-meta">Faculty to be announced</span>;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.8125rem]">
      <span className="text-ink">{o.teacher}</span>
      {o.teacher_designation && <span className="text-meta">{o.teacher_designation}</span>}
      {o.teacher_email && <a href={`mailto:${o.teacher_email}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Mail aria-hidden size={12} />{o.teacher_email}</a>}
    </span>
  );
}

async function Enrolled({ e, sections, schedule, studentId, semesterId, adddrop, withdraw }: {
  e: Awaited<ReturnType<typeof student.enrollments>>[number]; sections: Offering[]; schedule: (id: number) => string;
  studentId: number; semesterId: number; adddrop: boolean; withdraw: boolean;
}) {
  const cur = sections.find((o) => o.id === e.offering_id);
  const others = sections.filter((o) => o.id !== e.offering_id);
  const change = await services.sectionChangeFor(studentId, e.course_id, semesterId);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-brand-soft px-4 py-3 text-[0.875rem] ring-1 ring-inset ring-brand/10">
        <p className="font-semibold">Section {letterOf(e.section)} <span className="font-normal text-meta">({e.section})</span>{e.status === "waitlisted" && <span className="ml-1.5 font-normal text-warning-ink">· on the waitlist</span>}</p>
        <p className="text-[0.8125rem] text-meta">{schedule(e.offering_id) || "Schedule to be announced"}</p>
        {cur && <Faculty o={cur} />}
      </div>

      {e.status === "confirmed" && (
        change ? (
          <p className="text-[0.8125rem]">
            <span className="font-medium">Section change {change.status === "submitted" ? "requested" : change.status}</span>
            {change.target && <span className="text-meta"> · to section {change.target}</span>}
            {change.status === "submitted" && <span className="text-meta"> · waiting for your Department Head</span>}
            {change.note && <span className="block text-meta">{change.note}</span>}
            <span className="block text-[0.75rem] text-meta">You have used your one section change for this course.</span>
          </p>
        ) : others.length > 0 ? (
          <details className="rounded-2xl border border-rule bg-muted px-4 py-3">
            <summary className="cursor-pointer text-[0.875rem] font-medium text-brand">Request a section change</summary>
            <form action={submitRequestAction} className="mt-3 space-y-3">
              <input type="hidden" name="kind" value="section_change" /><input type="hidden" name="offering_id" value={e.offering_id} />
              <SectionPicker name="target_offering_id" label="Move to"
                options={await Promise.all(others.map((o) => option(o, o.enrolled >= o.capacity ? "This section is full" : null)))}
                initial={(others.find((o) => o.enrolled < o.capacity) ?? others[0]).id} />
              <input autoComplete="off" name="detail" required placeholder="Why do you need the change?…" aria-label="Reason for section change" className={inputCls} />
              <Button size="sm" variant="secondary">Send request</Button>
              <p className="text-[0.75rem] text-meta">You can request a change only once for this course.</p>
            </form>
          </details>
        ) : <p className="text-[0.8125rem] text-meta">This course has only one section.</p>
      )}

      {(adddrop || withdraw) && (
        adddrop ? (
          <form action={dropOwnAction}><input type="hidden" name="enrollment_id" value={e.id} /><Button size="sm" variant="danger" confirm={`Drop ${e.code}? The course charges are reversed.`}>Drop {e.code}</Button></form>
        ) : e.status === "confirmed" && (
          <form action={withdrawAction} className="flex gap-2"><input type="hidden" name="enrollment_id" value={e.id} />
            <input autoComplete="off" name="reason" required placeholder="Reason…" aria-label="Reason for withdrawal" className={`${inputCls} h-8`} />
            <Button size="sm" variant="danger" confirm="Withdraw from this course? You keep the charges and the course shows W.">Withdraw</Button></form>
        )
      )}
    </div>
  );
}
