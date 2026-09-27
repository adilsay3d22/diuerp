import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth.ts";
import { accounts, admission } from "@/modules/index.ts";
import { Money, Stamp, DocHeader, fmtDate, taka } from "@/components/ui";
import { PrintButton } from "../../../receipt/[no]/print";

export const metadata: Metadata = { title: "Admission document" };

// CORE-12 documents: payment slip, admit card, offer letter. Printed or saved as PDF from the browser.
export default async function AdmissionDoc({ params }: PageProps<"/admission/[id]/[doc]">) {
  const s = await requireUser();
  const { id, doc } = await params;
  const a = await admission.application(Number(id));
  if (!a) notFound();
  const staff = s.roles.some((r) => ["admissions_officer", "registrar", "cashier"].includes(r.role));
  if (a.user_id !== s.user.id && !staff) notFound();
  const c = (await admission.cycle(a.cycle_id))!;
  const data = JSON.parse(a.data_json) as Record<string, string>;
  const ok = { slip: true, admit: !!a.test_slot, offer: ["selected", "accepted", "admission_paid", "enrolled"].includes(a.status) }[doc];
  if (!ok) notFound();
  const acc = await accounts.applicationAccount(a.id);
  const title = { slip: "Payment slip", admit: "Admit card", offer: "Offer letter" }[doc as "slip" | "admit" | "offer"];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 print:py-0">
      <div className="no-print mb-6 flex justify-end"><PrintButton /></div>
      <article className="relative overflow-hidden rounded-[1.75rem] bg-card p-8 shadow-panel print:rounded-none print:p-0 print:shadow-none">
        <DocHeader title={title} sub={<>Admission Office · <span className="num font-semibold text-ink">{a.ref}</span></>} />
        <dl className="mt-6 grid grid-cols-[9rem_1fr] gap-y-2 text-[0.9375rem]">
          <dt className="text-meta">Applicant</dt><dd className="font-semibold">{a.name}</dd>
          <dt className="text-meta">NID / birth reg.</dt><dd className="num">{data.nid}</dd>
          <dt className="text-meta">Program</dt><dd>{a.program}</dd>
          <dt className="text-meta">Intake</dt><dd>{c.intake}</dd>
          {doc === "admit" && <><dt className="text-meta">Test</dt><dd className="font-semibold">{a.test_slot}</dd><dt className="text-meta">Room & seat</dt><dd className="font-semibold">{a.test_room}</dd></>}
        </dl>
        {doc === "slip" && (
          <div className="mt-6 border-y border-rule py-5">
            {acc.lines.map((l) => <p key={l.id} className="flex justify-between text-[0.9375rem]"><span>{l.description}</span><Money v={l.amount} /></p>)}
            <p className="mt-3 flex justify-between text-[1.125rem] font-semibold"><span>Payable</span><span>{taka(acc.due)}</span></p>
            <p className="mt-3 text-[0.8125rem] text-meta">Pay at the DIU Accounts counter (Sunday to Thursday, 9:00–16:00). Quote {a.ref}.</p>
          </div>
        )}
        {doc === "admit" && (
          <p className="mt-6 text-[0.875rem] text-strong">Bring this card, your NID or birth certificate, and a pen. Arrive 30 minutes early. Phones are not allowed in the hall.</p>
        )}
        {doc === "offer" && (
          <div className="mt-6 space-y-3 text-[0.9375rem] leading-relaxed">
            <p>Dear {a.name},</p>
            <p>We are pleased to offer you a place in the <b>{a.program}</b> program for the {c.intake} intake{a.merit_rank ? `, at merit position ${a.merit_rank}` : ""}.</p>
            <p>To confirm your seat, accept the offer in the admission portal and pay the admission fee. Your student ID is issued at enrollment.</p>
            <p className="pt-4">Admission Office<br />Daffodil International University</p>
          </div>
        )}
        {doc === "offer" && <div className="mt-6 flex justify-end"><Stamp tone="ok" big>Offer issued {fmtDate(a.decided_at)}</Stamp></div>}
      </article>
    </main>
  );
}
