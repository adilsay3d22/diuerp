import type { Metadata } from "next";
import { Check, Lock } from "lucide-react";
import { studentCtx } from "@/lib/page.ts";
import { accounts } from "@/modules/index.ts";
import { PageHeader, Sheet, Stamp, LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Exam clearance" };
const LABEL: Record<string, string> = { registration: "Registration", midterm: "Mid-term exam", final: "Final exam" };

export default async function Clearance() {
  const { st, sem } = await studentCtx();
  const rows = await accounts.clearanceFor(st.id, sem.id);
  return (
    <>
      <PageHeader eyebrow="Academics" title="Exam clearance" meta={`${sem.name} · Updated the moment a payment or attendance record changes`} />
      <Sheet flush>
        <ol aria-label="Clearance stages" className="relative px-6 py-4">
          {rows.map((r, i) => (
            <li key={r.exam} className="relative flex gap-4 pb-6 last:pb-2">
              {i < rows.length - 1 && <span aria-hidden className="absolute left-[15px] top-9 h-[calc(100%-2.25rem)] w-px bg-rule" />}
              <span aria-hidden className={`relative z-[1] mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card ${r.ok ? "bg-brand-green text-on-dark" : "bg-tint-red text-danger"}`}>
                {r.ok ? <Check size={16} strokeWidth={2.5} /> : <Lock size={14} strokeWidth={2.25} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold tracking-[-0.01em] text-heading">{LABEL[r.exam]}{r.ok ? <Stamp tone="ok">Cleared</Stamp> : <Stamp tone="bad">Blocked</Stamp>}</p>
                <p className={`mt-1 text-[0.875rem] ${r.ok ? "text-meta" : "text-strong"}`}>{r.reason}</p>
                {!r.ok && (r.reason.includes("fees") || r.reason.includes("dues")
                  ? <LinkButton href="/app/fees" size="sm" variant="primary" className="mt-3">Pay fees</LinkButton>
                  : <LinkButton href="/app/attendance" size="sm" className="mt-3">See attendance</LinkButton>)}
              </div>
            </li>
          ))}
        </ol>
      </Sheet>
      <p className="mt-4 max-w-[70ch] text-[0.8125rem] text-meta">Admit cards are issued only when the stage is cleared. If you have a documented reason (medical, financial hardship), the Accounts Office can grant an exception.</p>
    </>
  );
}
