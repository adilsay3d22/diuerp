import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { admission } from "@/modules/index.ts";
import { PageHeader, Sheet, Stamp, Empty, LinkButton, Crest, fmtDate } from "@/components/ui";

const TONE: Record<string, "ok" | "bad" | "wait" | "info" | "neutral"> = {
  draft: "neutral", submitted: "wait", under_review: "info", shortlisted: "info", test_scheduled: "info", selected: "ok", waitlisted: "wait",
  rejected: "bad", accepted: "wait", admission_paid: "ok", enrolled: "ok", declined: "neutral",
};
export const AppStatus = ({ status }: { status: string }) => <Stamp tone={TONE[status] ?? "neutral"}>{admission.STATUS_LABEL[status] ?? status}</Stamp>;

export async function ApplicantDash({ userId, name }: { userId: number; name: string }) {
  const mine = await admission.myApplications(userId);
  const open = (await admission.openCycles()).filter((c) => !mine.some((a) => a.cycle_id === c.id));
  return (
    <>
      <PageHeader eyebrow="Admission" title={`Welcome, ${name.split(" ")[0]}`} meta="Track your application from submission to enrollment." />
      <div className="relative mb-6 flex flex-wrap items-center gap-6 overflow-hidden rounded-[1.75rem] bg-brand-deep p-7 text-on-dark">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.65),transparent_65%)]" />
        <Crest size={64} className="relative" />
        <div className="relative min-w-0 flex-1">
          <p className="eyebrow text-[0.625rem] text-brand-green">Daffodil International University</p>
          <p className="mt-2 max-w-[48ch] text-[1.25rem] font-semibold leading-snug tracking-[-0.03em]">{mine.length ? `You have ${mine.length} application${mine.length === 1 ? "" : "s"} in progress.` : "Start your application to join DIU."}</p>
        </div>
        {open[0] && <LinkButton href={`/app/admission/apply/${open[0].id}`} variant="primary" className="relative">Start application</LinkButton>}
      </div>
      <div className="space-y-6">
        <Sheet title="My applications" flush>
          {mine.length === 0 ? <Empty title="No applications yet">Pick an open admission cycle below to start.</Empty> : (
            <ul className="px-2 pb-1">
              {mine.map((a) => (
                <li key={a.id}>
                  <Link href={a.status === "draft" ? `/app/admission/apply/${a.cycle_id}` : `/app/admission/${a.id}`} className="group flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-muted">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] text-ink">{a.program} · {a.cycle}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-meta"><AppStatus status={a.status} /><span className="num">{a.ref}</span></span>
                    </span>
                    <ChevronRight aria-hidden size={18} strokeWidth={1.75} className="shrink-0 text-field transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
        <Sheet title="Open for applications" flush>
          {open.length === 0 ? <Empty title="No other cycles open">New admission cycles are announced on the university website.</Empty> : (
            <ul className="pb-1">
              {await Promise.all(open.map(async (c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 border-t border-rule px-6 py-4 first:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] text-ink">{c.name}</span>
                    <span className="text-[0.8125rem] text-meta">Intake {c.intake} · closes {fmtDate(c.deadline)} · {(await admission.cyclePrograms(c.id)).map((p) => p.name).join(", ")}</span>
                  </span>
                  <LinkButton href={`/app/admission/apply/${c.id}`} variant="primary" size="sm">Start application</LinkButton>
                </li>
              )))}
            </ul>
          )}
        </Sheet>
      </div>
    </>
  );
}
