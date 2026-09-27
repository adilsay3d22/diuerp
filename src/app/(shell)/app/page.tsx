import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Wallet, BookOpen, Bus, CalendarClock, PenLine, ClipboardCheck } from "lucide-react";
import { requireRole } from "@/lib/auth.ts";
import { get, all, today, weekday } from "@/lib/db.ts";
import { core, registrar, student, teacher, accounts, transport } from "@/modules/index.ts";
import { ApplicantDash } from "./applicant";
import { DriverDash } from "./driver";
import { PageHeader, Sheet, Table, Stamp, StatusStamp, Money, Empty, DateBlock, LinkButton, Bento, Stat, Crest, fmtDate, taka } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const s = await requireRole("student", "teacher", "applicant", "driver");
  if (s.role === "applicant") return <ApplicantDash userId={s.user.id} name={s.user.name} />;
  if (s.role === "driver") return <DriverDash userId={s.user.id} name={s.user.name} />;
  return s.role === "student" ? <StudentDash userId={s.user.id} roles={s.roles} /> : <TeacherDash userId={s.user.id} roles={s.roles} />;
}

type Roles = { role: string; dept_id: number | null }[];

async function Notices({ userId, roles }: { userId: number; roles: Roles }) {
  const list = await core.noticesFor(userId, roles, { limit: 4 });
  return (
    <Sheet title="Latest notices" flush actions={<Link href="/notices" className="text-[0.8125rem] font-medium text-brand hover:underline">All notices</Link>}>
      {list.length === 0 ? <Empty title="No notices yet" /> : (
        <ul>
          {list.map((n) => (
            <li key={n.id} className="flex gap-3 border-b border-rule px-6 py-3.5 last:border-0">
              <DateBlock date={n.at} />
              <div className="min-w-0">
                <p className="text-[0.875rem] font-semibold leading-snug text-ink">{n.title}</p>
                <p className="mt-0.5 text-[0.75rem] text-meta">{n.category} · {n.by_name}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function TodayClasses({ rows, empty }: { rows: { key: string; time: string; course: string; room: string; extra?: React.ReactNode }[]; empty: string }) {
  return (
    <Sheet title={`Today · ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dhaka" })}`} flush>
      {rows.length === 0 ? <Empty title="No classes today">{empty}</Empty> : (
        <ul>
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-6 py-3.5 last:border-0">
              <span className="num w-28 shrink-0 text-[0.8125rem] font-medium text-heading">{r.time}</span>
              <span className="min-w-0 flex-1 text-[0.875rem] text-ink">{r.course}</span>
              <span className="text-[0.8125rem] text-meta">{r.room}</span>
              {r.extra}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

async function StudentDash({ userId, roles }: { userId: number; roles: Roles }) {
  const st = (await registrar.studentByUser(userId))!;
  const sem = await registrar.currentSemester();
  const ens = await student.enrollments(st.id, sem.id, ["confirmed"]);
  const slots = await registrar.slotsFor(ens.map((e) => e.offering_id));
  const day = weekday();
  const todays = slots.filter((x) => x.day === day).map((x) => {
    const e = ens.find((e) => e.offering_id === x.offering_id)!;
    return { key: `${x.offering_id}-${x.slot_id}`, time: `${x.start}–${x.end}`, course: `${e.code} ${e.title} · ${e.section}`, room: x.room };
  });
  const tr = await student.transcript(st.id);
  const cgpa = tr.at(-1)?.cgpa ?? 0;
  const earned = await student.creditsEarned(st.id);
  const fin = await accounts.summary(st.id);
  const pass = await transport.studentPass(st.id, sem.id);
  const inv = (await accounts.invoices(st.id)).find((i) => i.semester_id === sem.id);
  const att = await teacher.studentAttendance(st.id, ens.map((e) => e.offering_id));
  const threshold = Number((await get<{ value: string }>("SELECT value FROM settings WHERE key = 'attendance_threshold'"))?.value ?? 70);

  // What's due: fees, assignments, evaluations, attendance, exams
  const due: { key: string; what: React.ReactNode; when: string; stamp: React.ReactNode; href: string }[] = [];
  if (inv && inv.due > 0) due.push({ key: "fee", what: <>Semester fees: <Money v={inv.due} /> outstanding</>, when: fmtDate(inv.due_date), stamp: <StatusStamp status={inv.status} />, href: "/app/fees" });
  for (const a of (await all<{ id: number; title: string; due_at: string; code: string; offering_id: number }>(
    `SELECT a.id, a.title, a.due_at, c.code, a.offering_id FROM assessments a JOIN offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
     WHERE a.type = 'assignment' AND a.due_at >= ? AND a.offering_id IN (${ens.map(() => "?").join(",") || "NULL"})
     AND NOT EXISTS (SELECT 1 FROM submissions sb WHERE sb.assessment_id = a.id AND sb.student_id = ?) ORDER BY a.due_at`, today(), ...ens.map((e) => e.offering_id), st.id)))
    due.push({ key: `a${a.id}`, what: `${a.code}: ${a.title}`, when: fmtDate(a.due_at.slice(0, 10)), stamp: <Stamp tone="wait">Not submitted</Stamp>, href: `/app/courses/${a.offering_id}` });
  const pubSem = tr.at(-1);
  if (pubSem) for (const e of (await student.pendingEvaluations(st.id, pubSem.semester_id)))
    due.push({ key: `e${e.offering_id}`, what: `Evaluate ${e.code} to unlock ${pubSem.name} results`, when: "Now", stamp: <Stamp tone="info">Evaluation</Stamp>, href: "/app/results" });
  ens.forEach((e, i) => {
    if (att[i].total >= 4 && att[i].percent < threshold)
      due.push({ key: `att${e.offering_id}`, what: `${e.code} attendance is ${att[i].percent}% (needs ${threshold}%)`, when: "Before finals", stamp: <Stamp tone="bad">Below threshold</Stamp>, href: "/app/attendance" });
  });
  const exam = (await registrar.calendar(sem.id)).find((c) => ["midterm", "final"].includes(c.type) && c.end_date >= today());
  if (exam) due.push({ key: "exam", what: exam.title, when: fmtDate(exam.start_date), stamp: <Stamp tone="neutral">Exam</Stamp>, href: "/app/clearance" });

  return (
    <>
      <PageHeader eyebrow={`${sem.name} · ${sem.code}`} title={`Good ${greeting()}, ${st.name.split(" ")[0]}`} meta={st.program} />
      <Bento>
        <Hero eyebrow={st.dept} name={st.name} line={<span className="num">{st.student_id} · Batch {st.batch} · Section {st.section}</span>}
          stats={[["CGPA", cgpa.toFixed(2)], ["Credits", <>{earned}<span className="text-[0.9375rem] text-on-dark-muted">/{st.total_credits}</span></>]]}
          progress={{ value: earned, max: st.total_credits, label: "Credits completed" }} />
        <Stat href="/app/fees" icon={Wallet} label="Fees" value={taka(fin.due)} tone={fin.due > 0 ? "danger" : undefined}
          sub={<>{fin.due < 0 ? "Advance on account" : fin.due > 0 ? "Due this semester" : "Nothing due"} · <Money v={fin.paid} /> paid</>} />
        <Stat href="/app/courses" icon={BookOpen} label="This semester" value={ens.length} sub={`course${ens.length === 1 ? "" : "s"} · ${ens.reduce((t, e) => t + e.credits, 0)} credits`} />
        <Stat href="/app/transport" icon={Bus} label="Transport" value={pass ? <span className="flex items-center gap-2">R{pass.route}{pass.status === "active" && <span aria-hidden className="breathe h-2 w-2 rounded-full bg-brand-green" />}</span> : "—"}
          sub={pass ? <>{pass.stop} <span className="num">{pass.pickup_time}</span> · {pass.status.replace("_", " ")}</> : "No pass this semester"} />
      </Bento>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Sheet title="What's due" flush>
            {due.length === 0 ? <Empty title="You're all caught up">Nothing is due. New assignments, fees and evaluations will appear here first.</Empty> : (
              <ul className="px-2 pb-2">
                {due.map((d) => (
                  <li key={d.key}>
                    <Link href={d.href} className="group flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-muted">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] text-ink">{d.what}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-meta">{d.stamp}{d.when}</span>
                      </span>
                      <ChevronRight aria-hidden size={18} strokeWidth={1.75} className="shrink-0 text-field transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
          <TodayClasses rows={todays} empty={ens.length ? "Enjoy the day off. Your weekly routine is under Class routine." : "Register courses to build your routine."} />
          <Sheet title="CGPA by semester">
            {tr.length === 0 ? <Empty title="No published results yet">Your CGPA trend appears after the first semester’s results.</Empty> : <CgpaChart points={tr.map((t) => ({ label: t.semester, name: t.name, cgpa: t.cgpa, sgpa: t.sgpa }))} />}
          </Sheet>
        </div>
        <div className="space-y-6">
          <Notices userId={userId} roles={roles} />
        </div>
      </div>
    </>
  );
}

function CgpaChart({ points }: { points: { label: string; name: string; cgpa: number; sgpa: number }[] }) {
  const W = 560, H = 180, P = { l: 36, r: 16, t: 14, b: 28 };
  const x = (i: number) => P.l + (points.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (points.length - 1));
  const y = (v: number) => P.t + (1 - (v - 2) / 2) * (H - P.t - P.b); // 2.00 to 4.00
  const line = (k: "cgpa" | "sgpa") => points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(Math.max(2, p[k]))}`).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`CGPA trend: ${points.map((p) => `${p.name} ${p.cgpa.toFixed(2)}`).join(", ")}`}>
        {[2, 2.5, 3, 3.5, 4].map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="stroke-rule" />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" className="fill-meta font-mono text-[11px]">{v.toFixed(1)}</text>
          </g>
        ))}
        <path d={line("sgpa")} fill="none" className="stroke-field" strokeWidth={1.5} strokeDasharray="4 4" />
        <path d={line("cgpa")} fill="none" className="stroke-accent" strokeWidth={2.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(Math.max(2, p.cgpa))} r={4.5} className="fill-card stroke-accent" strokeWidth={2.5} />
            <text x={x(i)} y={y(Math.max(2, p.cgpa)) - 10} textAnchor="middle" className="fill-navy-800 font-mono text-[12px] font-medium">{p.cgpa.toFixed(2)}</text>
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-meta text-[11px]">{p.name}</text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 flex gap-5 text-[0.75rem] text-meta">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />CGPA</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-meta" />Semester GPA</span>
      </figcaption>
    </figure>
  );
}

async function TeacherDash({ userId, roles }: { userId: number; roles: Roles }) {
  const t = (await registrar.teacherByUser(userId))!;
  const sem = await registrar.currentSemester();
  const offs = await registrar.teacherOfferings(t.id, sem.id);
  const slots = await registrar.slotsFor(offs.map((o) => o.id));
  const day = weekday();
  const d = today();
  const todays = await Promise.all(slots.filter((x) => x.day === day).map(async (x) => {
    const o = offs.find((o) => o.id === x.offering_id)!;
    const taken = (await teacher.attendanceSheet(o.id, d, x.slot_id)).session;
    return {
      key: `${o.id}-${x.slot_id}`, time: `${x.start}–${x.end}`, course: `${o.code} ${o.title} · ${o.section}`, room: x.room,
      extra: taken ? <Stamp tone="ok">Attendance taken</Stamp> : <LinkButton size="sm" variant="primary" href={`/app/sections/${o.id}?tab=attendance&slot=${x.slot_id}:${x.room_id}`}>Take attendance</LinkButton>,
    };
  }));
  const deadline = (await registrar.calendar(sem.id)).find((c) => c.type === "deadline");
  return (
    <>
      <PageHeader eyebrow={`${sem.name} · ${sem.code}`} title={`Good ${greeting()}, ${t.name}`} meta={t.designation} />
      <Bento>
        <Hero eyebrow={(await get<{ name: string }>("SELECT name FROM departments WHERE id = ?", t.dept_id))?.name ?? "Faculty"} name={t.name} line={<>{t.designation} · <span className="num">{t.employee_id}</span></>}
          stats={[["Sections", offs.length], ["Students", offs.reduce((n, o) => n + o.enrolled, 0)]]} />
        <Stat icon={CalendarClock} label="Classes today" value={todays.length} sub={todays[0] ? <>Next at <span className="num">{todays[0].time.split("–")[0]}</span></> : "No classes today"} />
        <Stat icon={PenLine} label="To grade" value={(await Promise.all(offs.map((o) => teacher.ungradedCount(o.id)))).reduce((n, x) => n + x, 0)} sub="submissions waiting" />
        <Stat href="/app/sections" icon={ClipboardCheck} label="Grade sheets" value={`${(await Promise.all(offs.map((o) => teacher.sheetStatus(o.id)))).filter((x) => ["submitted", "dept-approved", "published"].includes(x.status)).length}/${offs.length}`}
          sub={deadline ? <>Due {fmtDate(deadline.start_date)}</> : "submitted"} />
      </Bento>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <TodayClasses rows={todays} empty="No classes today. Your weekly timetable is under Timetable." />
          <Sheet title="My sections" flush actions={deadline && <span className="text-[0.8125rem] text-meta">Grade sheets due {fmtDate(deadline.start_date)}</span>}>
            {offs.length === 0 ? <Empty title="No sections assigned">The Registrar assigns sections each semester. Your Department Head can propose you for one.</Empty> : (
              <Table>
                <thead><tr><th>Course</th><th>Section</th><th className="r">Students</th><th className="r">To grade</th><th>Grade sheet</th></tr></thead>
                <tbody>
                  {await Promise.all(offs.map(async (o) => (
                    <tr key={o.id}>
                      <td><Link href={`/app/sections/${o.id}`} className="font-medium text-brand hover:underline">{o.code}</Link> <span className="text-meta">{o.title}</span></td>
                      <td className="num">{o.section}</td><td className="r num">{o.enrolled}</td>
                      <td className="r num">{await teacher.ungradedCount(o.id) || "—"}</td>
                      <td><StatusStamp status={(await teacher.sheetStatus(o.id)).status} /></td>
                    </tr>
                  )))}
                </tbody>
              </Table>
            )}
          </Sheet>
        </div>
        <Notices userId={userId} roles={roles} />
      </div>
    </>
  );
}

// Brand hero tile: crest watermark, identity, two big numbers, optional progress
function Hero({ eyebrow, name, line, stats, progress }: { eyebrow: string; name: string; line: React.ReactNode; stats: [string, React.ReactNode][]; progress?: { value: number; max: number; label: string } }) {
  return (
    <div className="relative flex min-h-36 flex-col overflow-hidden rounded-[1.75rem] bg-brand-deep p-7 text-on-dark sm:col-span-2 xl:col-span-1 xl:row-span-1">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.65),transparent_65%)]" />
      <Crest size={150} className="pointer-events-none absolute -bottom-8 -right-6 opacity-[0.07]" />
      <div className="relative flex flex-1 flex-col justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow text-[0.625rem] text-brand-green">{eyebrow}</p>
          <p className="mt-2 text-[1.375rem] font-semibold tracking-[-0.03em]">{name}</p>
          <p className="mt-1 text-[0.8125rem] text-on-dark-muted">{line}</p>
        </div>
        <dl className="flex gap-10">
          {stats.map(([k, v]) => <div key={k} className="flex flex-col-reverse"><dt className="mt-1 text-[0.75rem] text-on-dark-muted">{k}</dt><dd className="num text-[2.5rem] font-medium leading-none tracking-[-0.05em]">{v}</dd></div>)}
        </dl>
      </div>
      {progress && (
        <div className="relative mt-auto pt-6">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={progress.label} aria-valuenow={progress.value} aria-valuemin={0} aria-valuemax={progress.max}>
            <div className="h-full rounded-full bg-brand-green" style={{ width: `${Math.min(100, (progress.value / progress.max) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Dhaka" }));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
