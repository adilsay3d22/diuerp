import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth.ts";
import { admission, registrar } from "@/modules/index.ts";
import * as A from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Button, Field, Empty, Tabs, Progress, inputCls, btn, fmtDate } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { AppStatus } from "../../../app/applicant";

export const metadata: Metadata = { title: "Admission cycle" };

export default async function CyclePage({ params, searchParams }: PageProps<"/admin/admissions/[id]">) {
  await requireRole("admissions_officer");
  const c = await admission.cycle(Number((await params).id));
  if (!c) notFound();
  const status = String((await searchParams).status ?? "");
  const programs = await admission.cyclePrograms(c.id);
  const apps = await admission.cycleApplications(c.id, status || undefined);
  const all = await admission.cycleApplications(c.id);
  const count = (s: string) => all.filter((a) => a.status === s).length;
  const dup = await admission.duplicates(c.id);
  const testing = all.filter((a) => a.status === "test_scheduled");
  const tabs = [["", "All"], ["submitted", "Fee due"], ["under_review", "To review"], ["shortlisted", "Shortlisted"], ["test_scheduled", "Test"], ["selected", "Selected"], ["waitlisted", "Waitlisted"], ["rejected", "Rejected"]]
    .map(([k, l]) => ({ href: `?status=${k}`, label: l, active: status === k, count: k ? count(k) : undefined }));

  return (
    <>
      <PageHeader eyebrow="Admission office" title={c.name} meta={`Intake ${c.intake} · deadline ${fmtDate(c.deadline)} · ${all.length} applications`} actions={<Link href="/admin/admissions" className={btn("ghost", "sm")}>All cycles</Link>} />
      <div className="mb-6 flex flex-wrap gap-4">
        {programs.map((p) => (
          <div key={p.program_id} className="min-w-64 flex-1 rounded-[1.75rem] bg-card p-6 shadow-panel">
            <p className="text-[0.8125rem] text-meta">{p.name}</p>
            <p className="mt-3 flex items-baseline gap-2"><span className="num text-[2rem] font-medium leading-none tracking-[-0.05em] text-heading">{p.applied}</span><span className="text-[0.8125rem] text-meta">applied</span></p>
            <p className="mb-2 mt-4 flex justify-between text-[0.8125rem] text-meta"><span>Seats filled</span><span className="num text-ink">{p.selected}/{p.seats}</span></p>
            <Progress value={p.selected} max={p.seats || 1} label={`${p.name} seats filled`} />
          </div>
        ))}
      </div>

      <Tabs tabs={tabs} />
      <Sheet flush className="mb-6">
        {apps.length === 0 ? <Empty title="No applications here" /> : (
          <Table>
            <thead><tr><th>Applicant</th><th>Program</th><th className="r">HSC</th><th className="r">Score</th><th className="r">Merit</th><th>Status</th></tr></thead>
            <tbody>
              {apps.map((a) => {
                const d = JSON.parse(a.data_json) as Record<string, string>;
                return (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/admin/admissions/application/${a.id}`} className="font-medium text-brand hover:underline">{a.name}</Link>
                      <span className="num ml-2 text-[0.75rem] text-meta">{a.ref}</span>
                      {dup.has(a.id) && <span className="ml-2"><Stamp tone="bad">Possible duplicate</Stamp></span>}
                    </td>
                    <td>{a.program}</td><td className="r num">{d.hsc_gpa ?? "—"}</td><td className="r num">{a.test_score ?? "—"}</td><td className="r num">{a.merit_rank ?? "—"}</td>
                    <td><AppStatus status={a.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Sheet>

      <div className="grid gap-6 xl:grid-cols-2">
        <Sheet title={`Schedule the test · ${count("shortlisted")} shortlisted`}>
          <form action={A.scheduleTestsAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="cycle_id" value={c.id} />
            <Field label="Date"><input autoComplete="off" name="date" type="date" defaultValue={c.test_date ?? ""} required className={inputCls} /></Field>
            <Field label="Start time"><input autoComplete="off" name="start" type="time" defaultValue="10:00" required className={inputCls} /></Field>
            <Field label="Rooms" hint="Comma separated" className="sm:col-span-2"><input autoComplete="off" spellCheck={false} name="rooms" required defaultValue={(await registrar.rooms()).filter((r) => r.type === "theory").map((r) => r.number).join(", ")} className={inputCls} /></Field>
            <Field label="Seats per room"><input autoComplete="off" name="per_room" type="number" min="1" defaultValue={40} className={inputCls} /></Field>
            <div className="flex items-end"><Button disabled={!count("shortlisted")}>Assign slots and notify</Button></div>
          </form>
        </Sheet>

        <Sheet title={`Scores · ${testing.length} sat the test`} flush>
          {testing.length === 0 ? <Empty title="No one waiting for a score" /> : (
            <form action={A.enterScoresAction}>
              <input type="hidden" name="cycle_id" value={c.id} />
              <Table>
                <thead><tr><th>Applicant</th><th>Seat</th><th className="r">Score / 100</th><th className="r">Merit</th></tr></thead>
                <tbody>
                  {testing.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name} <span className="num text-[0.75rem] text-meta">{a.ref}</span></td><td className="text-[0.8125rem]">{a.test_room}</td>
                      <td className="r"><input autoComplete="off" name={`s_${a.id}`} aria-label={`Score for ${a.name}`} type="number" step="0.5" min="0" max="100" defaultValue={a.test_score ?? ""} className={`${inputCls} ml-auto w-24 text-right`} /></td>
                      <td className="r num">{a.merit_rank ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="flex flex-wrap gap-2 border-t border-rule px-6 py-4">
                <Button name="intent" value="save" variant="secondary">Save scores</Button>
                <Button name="intent" value="rank">Save and rank merit list</Button>
              </div>
            </form>
          )}
          {testing.some((a) => a.merit_rank) && (
            <form action={A.publishAdmissionAction} className="border-t border-rule bg-brand-soft px-6 py-4">
              <input type="hidden" name="cycle_id" value={c.id} />
              <ConfirmButton message="Publish results? Top-ranked applicants up to each program's seats are selected; the rest are waitlisted. Everyone is notified." className={btn("primary")}>
                Publish results and seat allocation
              </ConfirmButton>
            </form>
          )}
        </Sheet>
      </div>
    </>
  );
}
