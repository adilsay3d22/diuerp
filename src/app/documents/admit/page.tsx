import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createHmac } from "node:crypto";
import QRCode from "qrcode";
import { requireRole } from "@/lib/auth.ts";
import { registrar, services } from "@/modules/index.ts";
import { DocHeader, fmtDate } from "@/components/ui";
import { PrintButton } from "../../receipt/[no]/print";

export const metadata: Metadata = { title: "Admit card" };

// CORE-12 / STU-U-9: printable admit card with a verification QR code.
export default async function Admit({ searchParams }: PageProps<"/documents/admit">) {
  const s = await requireRole("student");
  const st = (await registrar.studentByUser(s.user.id))!;
  const sem = await registrar.currentSemester();
  const stage = (await searchParams).stage === "midterm" ? "midterm" : "final";
  const { clear, exams } = await services.admitCard(st.id, sem.id, stage);
  if (!clear.ok || !exams.some((e) => e.room)) notFound();
  const code = createHmac("sha256", process.env.GATEWAY_SECRET ?? "dev-sandbox-secret").update(`admit:${st.student_id}:${sem.code}:${stage}`).digest("hex").slice(0, 12).toUpperCase();
  const qr = await QRCode.toString(`DIU-ADMIT ${st.student_id} ${sem.code} ${stage} ${code}`, { type: "svg", margin: 0, width: 96 });
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 print:py-0">
      <div className="no-print mb-6 flex justify-end"><PrintButton /></div>
      <article className="relative overflow-hidden rounded-[1.75rem] bg-card p-8 shadow-panel print:rounded-none print:p-0 print:shadow-none">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1"><DocHeader title="Admit card" sub={`${stage === "final" ? "Final" : "Mid-term"} examination · ${sem.name}`} /></div>
          <div className="h-24 w-24 shrink-0" aria-label={`Verification code ${code}`} dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
        <dl className="mt-5 grid grid-cols-[8rem_1fr] gap-y-1.5 text-[0.9375rem]">
          <dt className="text-meta">Name</dt><dd className="font-semibold">{st.name}</dd>
          <dt className="text-meta">Student ID</dt><dd className="num">{st.student_id}</dd>
          <dt className="text-meta">Program</dt><dd>{st.program} · batch {st.batch}, section {st.section}</dd>
        </dl>
        <table className="register mt-6">
          <thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Room</th><th className="r">Seat</th></tr></thead>
          <tbody>{exams.map((e) => <tr key={e.id}><td>{fmtDate(e.date)}</td><td className="num">{e.start}–{e.end}</td><td>{e.code} {e.title}</td><td>{e.room}</td><td className="r num">{e.seat}</td></tr>)}</tbody>
        </table>
        <p className="mt-6 text-[0.8125rem] text-meta">Bring this card and your ID card. Phones and smart watches are not allowed. Verification code <span className="num font-semibold text-ink">{code}</span>.</p>
      </article>
    </main>
  );
}
