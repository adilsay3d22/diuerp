import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createHmac } from "node:crypto";
import QRCode from "qrcode";
import { requireUser } from "@/lib/auth.ts";
import { get } from "@/lib/db.ts";
import { registrar, student } from "@/modules/index.ts";
import { DocHeader } from "@/components/ui";
import { PrintButton } from "../../receipt/[no]/print";

export const metadata: Metadata = { title: "Academic transcript" };

// CORE-12: official transcript. Students see it once a transcript request is ready; the Exam Controller and Registrar any time (?student=).
export default async function Transcript({ searchParams }: PageProps<"/documents/transcript">) {
  const s = await requireUser();
  const staff = s.roles.some((r) => ["exam_controller", "registrar"].includes(r.role));
  const q = Number((await searchParams).student);
  const st = staff && q ? await registrar.studentById(q) : await registrar.studentByUser(s.user.id);
  if (!st) notFound();
  if (!staff && !(await get("SELECT 1 FROM student_requests WHERE student_id = ? AND kind = 'transcript' AND status IN ('ready','delivered')", st.id))) notFound();
  const tr = await student.transcript(st.id);
  const last = tr.at(-1);
  const code = createHmac("sha256", process.env.GATEWAY_SECRET ?? "dev-sandbox-secret").update(`transcript:${st.student_id}:${last?.cgpa}`).digest("hex").slice(0, 12).toUpperCase();
  const qr = await QRCode.toString(`DIU-TRANSCRIPT ${st.student_id} CGPA ${last?.cgpa.toFixed(2)} ${code}`, { type: "svg", margin: 0, width: 96 });
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 print:py-0">
      <div className="no-print mb-6 flex justify-end"><PrintButton /></div>
      <article className="relative overflow-hidden rounded-[1.75rem] bg-card p-8 shadow-panel print:rounded-none print:p-0 print:shadow-none">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1"><DocHeader title="Academic transcript" sub="Office of the Controller of Examinations" /></div>
          <div className="h-24 w-24 shrink-0" aria-label={`Verification code ${code}`} dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
        <dl className="mt-5 grid grid-cols-[8rem_1fr] gap-y-1.5 text-[0.9375rem]">
          <dt className="text-meta">Name</dt><dd className="font-semibold">{st.name}</dd>
          <dt className="text-meta">Student ID</dt><dd className="num">{st.student_id} · {st.reg_id}</dd>
          <dt className="text-meta">Program</dt><dd>{st.program}</dd>
        </dl>
        {tr.map((t) => (
          <section key={t.semester} className="mt-6 break-inside-avoid">
            <h2 className="eyebrow mb-2 text-brand">{t.name}</h2>
            <table className="register">
              <thead><tr><th>Course</th><th>Title</th><th className="r">Credits</th><th>Grade</th><th className="r">Point</th></tr></thead>
              <tbody>{t.rows.map((r) => <tr key={r.id}><td className="num">{r.code}</td><td>{r.title}</td><td className="r num">{r.credits}</td><td>{r.letter}</td><td className="r num">{(r.gp_c / 100).toFixed(2)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={2}>SGPA {t.sgpa.toFixed(2)}</td><td className="r num">{t.credits}</td><td colSpan={2} className="r">CGPA {t.cgpa.toFixed(2)}</td></tr></tfoot>
            </table>
          </section>
        ))}
        <p className="mt-8 text-[0.8125rem] text-meta">Credits earned {await student.creditsEarned(st.id)} of {st.total_credits}. Verification code <span className="num font-semibold text-ink">{code}</span>. Grading follows the UGC uniform scale.</p>
      </article>
    </main>
  );
}
