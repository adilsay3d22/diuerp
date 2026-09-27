import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createHash } from "node:crypto";
import { requireUser } from "@/lib/auth.ts";
import { accounts, admission, registrar } from "@/modules/index.ts";
import { Stamp, Money, DocHeader, fmtDateTime } from "@/components/ui";
import { PrintButton } from "./print";
import QRCode from "qrcode";

export const metadata: Metadata = { title: "Receipt" };

export default async function Receipt({ params }: PageProps<"/receipt/[no]">) {
  const s = await requireUser();
  const r = await accounts.receipt((await params).no);
  if (!r) notFound();
  const st = r.student_id ? (await registrar.studentById(r.student_id))! : null;
  const app = r.application_id ? (await admission.application(r.application_id))! : null;
  const payer = st
    ? { user: st.user_id, name: st.name, idLabel: "Student ID", id: st.student_id, detail: `${st.program}, batch ${st.batch}` }
    : { user: app!.user_id, name: app!.name, idLabel: "Application", id: app!.ref, detail: app!.program };
  const staff = s.roles.some((x) => ["cashier", "accounts_officer", "finance_head"].includes(x.role));
  if (payer.user !== s.user.id && !staff) notFound();
  // Verification code: anyone at the counter can recompute it from the receipt number, payer and amount.
  const verify = createHash("sha256").update(`${r.receipt_no}|${payer.id}|${r.amount}|${r.at}`).digest("hex").slice(0, 12).toUpperCase();
  const reversal = r.amount < 0;
  const qr = await QRCode.toString(`DIU-RECEIPT ${r.receipt_no} ${payer.id} ${r.amount} ${verify}`, { type: "svg", margin: 0, width: 88 });
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 print:py-0">
      <div className="no-print mb-6 flex justify-between">
        <Link href={staff ? "/admin/cashier" : st ? "/app/fees?tab=ledger" : `/app/admission/${app!.id}`} className="text-[0.875rem] font-medium text-brand hover:underline">← Back</Link>
        <PrintButton />
      </div>
      <article className="relative overflow-hidden rounded-[1.75rem] bg-card p-8 shadow-panel print:rounded-none print:p-0 print:shadow-none">
        <DocHeader title="Money receipt" sub={<><span className="num font-semibold text-ink">{r.receipt_no}</span> · {fmtDateTime(r.at)}</>} />
        <dl className="mt-6 grid grid-cols-[9rem_1fr] gap-y-2 text-[0.9375rem]">
          <dt className="text-meta">Received from</dt><dd className="font-semibold">{payer.name}</dd>
          <dt className="text-meta">{payer.idLabel}</dt><dd className="num">{payer.id}</dd>
          <dt className="text-meta">Program</dt><dd>{payer.detail}</dd>
          <dt className="text-meta">Method</dt><dd className="capitalize">{r.method} · {r.channel}{r.reference ? ` · ref ${r.reference}` : ""}</dd>
          <dt className="text-meta">Received by</dt><dd>{r.cashier ?? "Online gateway"}</dd>
        </dl>
        <div className="mt-6 flex items-end justify-between rounded-2xl bg-muted px-5 py-5">
          <span className="text-[0.9375rem] font-semibold">{reversal ? "Amount reversed" : "Amount received"}</span>
          <span className="text-[2.25rem] font-medium tracking-[-0.05em] text-heading"><Money v={r.amount} /></span>
        </div>
        <div className="mt-8 flex items-end justify-between">
          <div className="mr-4 h-[88px] w-[88px] shrink-0" aria-label={`Verification QR, code ${verify}`} dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="flex-1 text-[0.75rem] text-meta">Verification code <span className="num font-semibold text-ink">{verify}</span><br />Computer-generated receipt; no signature required.</p>
          {reversal ? <Stamp tone="bad" big>Reversed</Stamp> : <Stamp tone="ok" big>Paid</Stamp>}
        </div>
      </article>
    </main>
  );
}
