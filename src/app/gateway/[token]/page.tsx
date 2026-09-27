import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { randomBytes } from "node:crypto";
import { finance, admission, registrar } from "@/modules/index.ts";
import { Lock } from "lucide-react";
import { Crest, Note, btn, taka } from "@/components/ui";

export const metadata: Metadata = { title: "Secure payment" };

// Sandbox stand-in for the provider's hosted payment page. It posts a signed result to our callback,
// exactly as SSLCommerz or bKash would. Replace with a redirect to the real provider in production.
export default async function Gateway({ params }: PageProps<"/gateway/[token]">) {
  const s = await finance.gatewaySession((await params).token);
  if (!s) notFound();
  const payer = s.student_id ? (await registrar.studentById(s.student_id))?.name : (await admission.application(s.application_id!))?.name;
  const txn = `SBX${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
  const form = (status: "success" | "cancel", label: string, cls: string) => (
    <form action="/api/gateway/callback" method="post">
      <input type="hidden" name="token" value={s.token} /><input type="hidden" name="status" value={status} />
      <input type="hidden" name="amount" value={s.amount} /><input type="hidden" name="txn_id" value={txn} />
      <input type="hidden" name="signature" value={finance.sign(s.token, status, s.amount, txn)} />
      <button className={cls}>{label}</button>
    </form>
  );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-[1.75rem] bg-card shadow-lift">
        <div className="relative overflow-hidden bg-brand-deep px-7 pb-7 pt-6 text-on-dark">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.6),transparent_65%)]" />
          <p className="eyebrow relative flex items-center gap-2 text-brand-green"><Lock aria-hidden size={12} strokeWidth={2} />Sandbox payment gateway</p>
          <div className="relative mt-5 flex items-center gap-3">
            <Crest size={40} />
            <p className="text-[0.9375rem] leading-snug">Paying<br /><span className="font-semibold">Daffodil International University</span></p>
          </div>
          <p className="num relative mt-6 text-[2.75rem] font-medium leading-none tracking-[-0.05em]">{taka(s.amount)}</p>
          <p className="relative mt-2 text-[0.875rem] text-on-dark-muted">{payer} · via {s.method}</p>
        </div>
        <div className="px-7 py-6">
          {s.status !== "initiated" ? (
            <Note tone="info">This payment is already {s.status}.</Note>
          ) : (
            <div className="space-y-2">
              {form("success", `Pay ${taka(s.amount)}`, btn("primary") + " h-11 w-full")}
              {form("cancel", "Cancel", btn("ghost") + " h-11 w-full text-meta")}
            </div>
          )}
          <p className="mt-6 text-[0.75rem] text-meta">No real money moves in the sandbox. Transaction <span className="num">{txn}</span>.</p>
        </div>
      </div>
    </main>
  );
}
