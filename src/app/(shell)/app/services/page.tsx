import type { Metadata } from "next";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { studentCtx } from "@/lib/page.ts";
import { num } from "@/lib/db.ts";
import { services } from "@/modules/index.ts";
import { submitRequestAction } from "../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Button, Field, Empty, inputCls, taka, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Applications & services" };
const TONE: Record<string, "ok" | "bad" | "wait" | "info" | "neutral"> = {
  submitted: "wait", fee_due: "wait", processing: "info", ready: "ok", delivered: "ok", approved: "ok", rejected: "bad", cancelled: "neutral",
};

export default async function Services() {
  const { st } = await studentCtx();
  const mine = await services.myRequests(st.id);
  const imp = await services.improvable(st.id);
  const conv = await services.convocationCheck(st.id);
  const transcriptReady = mine.some((r) => r.kind === "transcript" && ["ready", "delivered"].includes(r.status));
  return (
    <>
      <PageHeader eyebrow="Student services" title="Applications & services" meta="Improvement exams, certificates, transcripts and convocation. Fees go on your invoice; processing starts when paid." />
      <Sheet title="My applications" flush className="mb-6">
        {mine.length === 0 ? <Empty title="No applications yet" /> : (
          <Table>
            <thead><tr><th>Application</th><th>Details</th><th>Submitted</th><th>Status</th><th /></tr></thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{services.KINDS[r.kind].label} <span className="num text-[0.75rem] text-meta">#{r.id}</span></td>
                  <td className="text-[0.8125rem]">{r.detail}{r.target ? ` → ${r.target}` : ""}{r.note && <span className="block text-meta">{r.note}</span>}</td>
                  <td className="whitespace-nowrap text-[0.8125rem]">{fmtDateTime(r.at)}</td>
                  <td><Stamp tone={TONE[r.status] ?? "neutral"}>{services.REQ_STATUS[r.status]}</Stamp></td>
                  <td className="r">
                    {r.status === "fee_due" && <Link href="/app/fees" className="text-[0.8125rem] font-medium text-brand hover:underline">Pay</Link>}
                    {r.kind === "transcript" && ["ready", "delivered"].includes(r.status) && <Link href="/documents/transcript" className="text-[0.8125rem] font-medium text-brand hover:underline">View transcript</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>

      <div className="grid gap-6 xl:grid-cols-2">
        <Sheet title="Improvement or retake exam" actions={<span className="text-[0.8125rem] text-meta">{taka(await num("improvement_fee", 3000))} per course</span>}>
          {imp.length === 0 ? <p className="text-[0.875rem] text-meta">No eligible courses. Courses graded below B can be improved; failed courses can be retaken.</p> : (
            <form action={submitRequestAction} className="space-y-3">
              <input type="hidden" name="kind" value="improvement" />
              <Field label="Course">
                <select name="offering_id" className={inputCls}>
                  {imp.map((c) => <option key={c.offering_id} value={c.offering_id}>{c.kind}: {c.code} {c.title} ({c.letter}, {c.semester_name})</option>)}
                </select>
              </Field>
              <Field label="Section this semester" hint="Only courses offered this semester can be taken">
                <select name="target_offering_id" className={inputCls}>
                  {imp.flatMap((c) => c.targets.map((t) => <option key={t.id} value={t.id}>{c.code} · {t.section}</option>))}
                  {imp.every((c) => !c.targets.length) && <option value="">Not offered this semester</option>}
                </select>
              </Field>
              <Button disabled={imp.every((c) => !c.targets.length)}>Apply</Button>
            </form>
          )}
        </Sheet>

        <Sheet title="Certificate or transcript">
          <form action={submitRequestAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Document">
              <select name="kind" className={inputCls}>
                <option value="transcript">Transcript · {taka(await num("transcript_fee", 1500))} each</option>
                <option value="certificate">Certificate · {taka(await num("certificate_fee", 1000))} each</option>
              </select>
            </Field>
            <Field label="Copies"><input autoComplete="off" name="copies" type="number" min="1" max="10" defaultValue={1} className={inputCls} /></Field>
            <Field label="Purpose and delivery" className="sm:col-span-2"><input autoComplete="off" name="detail" placeholder="Job application · pickup from office…" className={inputCls} /></Field>
            <div><Button>Apply</Button></div>
          </form>
          {transcriptReady && <p className="mt-3 text-[0.875rem]"><Link href="/documents/transcript" className="font-medium text-brand hover:underline">Your transcript is ready to view</Link></p>}
        </Sheet>

        <Sheet title="Convocation" sub="Graduation ceremony registration" className="xl:col-span-2">
          <ul className="mb-5 grid gap-2 text-[0.9375rem] sm:grid-cols-2">
            <Req ok={conv.earned >= conv.required}>Credits: {conv.earned} of {conv.required}</Req>
            <Req ok={conv.cgpa >= 2}>CGPA {conv.cgpa.toFixed(2)} (minimum 2.00)</Req>
            {conv.unmet.filter((u) => !u.startsWith("Complete") && !u.startsWith("Reach")).map((u) => <Req key={u} ok={false}>{u}</Req>)}
          </ul>
          <form action={submitRequestAction}>
            <input type="hidden" name="kind" value="convocation" />
            <Button disabled={!conv.eligible}>{conv.eligible ? `Apply for convocation · ${taka(await num("convocation_fee", 8000))}` : "Not eligible yet"}</Button>
          </form>
        </Sheet>
      </div>
    </>
  );
}

const Req = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <li className="flex items-center gap-2.5 rounded-2xl border border-rule px-6 py-3">
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${ok ? "bg-brand-green text-on-dark" : "bg-tint-red text-danger"}`}>{ok ? <Check aria-hidden size={13} strokeWidth={3} /> : <X aria-hidden size={13} strokeWidth={3} />}</span>
    <span>{children}</span><span className="sr-only">{ok ? "met" : "not met"}</span>
  </li>
);
