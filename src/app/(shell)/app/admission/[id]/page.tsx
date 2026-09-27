import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { requireRole } from "@/lib/auth.ts";
import { num } from "@/lib/db.ts";
import { accounts, admission } from "@/modules/index.ts";
import * as A from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Money, Button, Field, Facts, Empty, Note, inputCls, btn, fmtDateTime, taka } from "@/components/ui";
import { AppStatus } from "../../applicant";

export const metadata: Metadata = { title: "My application" };

const TRACK = [
  ["submitted", "Submitted"], ["under_review", "Under review"], ["test_scheduled", "Admission test"], ["selected", "Result"],
  ["accepted", "Offer accepted"], ["admission_paid", "Admission fee paid"], ["enrolled", "Enrolled"],
] as const;
const ORDER = ["draft", "submitted", "under_review", "shortlisted", "test_scheduled", "selected", "waitlisted", "accepted", "admission_paid", "enrolled"];

export default async function ApplicationPage({ params }: PageProps<"/app/admission/[id]">) {
  const s = await requireRole("applicant", "student");
  const a = await admission.application(Number((await params).id));
  if (!a || a.user_id !== s.user.id) notFound();
  const acc = await accounts.applicationAccount(a.id);
  const docs = await admission.docs(a.id);
  const data = JSON.parse(a.data_json) as Record<string, string>;
  const at = ORDER.indexOf(a.status);
  const ended = ["rejected", "declined"].includes(a.status);

  return (
    <>
      <PageHeader eyebrow="Admission" title={`${a.program}`} meta={<><span className="num">{a.ref}</span> · {a.cycle}</>} actions={<AppStatus status={a.status} />} />

      <Sheet className="mb-6" title="Progress" sub="Every step updates here the moment the office acts on it.">
        <ol className="grid gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {TRACK.map(([k, label], i) => {
            const done = !ended && at >= ORDER.indexOf(k) && !(k === "selected" && a.status === "waitlisted");
            const current = !ended && (TRACK[i + 1] ? at >= ORDER.indexOf(k) && at < ORDER.indexOf(TRACK[i + 1][0]) : done);
            return (
              <li key={k} aria-current={current ? "step" : undefined} className={`flex flex-col gap-2 rounded-2xl border px-3 py-3 ${current ? "border-brand bg-brand-soft" : done ? "border-rule bg-card" : "border-dashed border-field"}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-[0.75rem] font-semibold ${done ? "bg-brand-green text-on-dark" : current ? "bg-brand text-on-dark" : "bg-segment text-meta"}`}>
                  {done ? <Check aria-hidden size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className={`text-[0.8125rem] leading-snug ${done || current ? "font-medium text-ink" : "text-meta"}`}>{label}</span>
              </li>
            );
          })}
        </ol>
        {a.reason && ended && <Note tone="bad" className="mt-4">{a.reason}</Note>}
      </Sheet>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          {(a.status === "selected" || a.status === "accepted" || a.status === "admission_paid" || a.status === "enrolled") && (
            <Sheet title="Your offer" actions={<Link href={`/admission/${a.id}/offer`} className={btn("secondary", "sm")}>Offer letter</Link>}>
              <p className="text-[0.9375rem] text-ink">You are selected for <b>{a.program}</b>{a.merit_rank ? `, merit position ${a.merit_rank}` : ""}.</p>
              {a.status === "selected" && (
                <form action={A.respondOfferAction} className="mt-4 flex flex-wrap gap-3">
                  <input type="hidden" name="application_id" value={a.id} />
                  <Button name="decision" value="accept">Accept offer</Button>
                  <Button name="decision" value="decline" variant="secondary">Decline</Button>
                </form>
              )}
              {a.status === "accepted" && <p className="mt-2 text-[0.875rem] text-meta">Pay the admission fee below to confirm your seat.</p>}
              {a.status === "admission_paid" && <p className="mt-2 text-[0.875rem] text-meta">Seat confirmed. The Registrar will enroll you and your student ID will appear here.</p>}
              {a.status === "enrolled" && <p className="mt-2 text-[0.875rem] text-success">You are enrolled. Sign in with your new student ID and the same password.</p>}
            </Sheet>
          )}

          {(a.test_slot || a.test_score != null) && (
            <Sheet title="Admission test" actions={a.test_slot && <Link href={`/admission/${a.id}/admit`} className={btn("secondary", "sm")}>Admit card</Link>}>
              <Facts rows={[["When", a.test_slot], ["Where", a.test_room], ["Score", a.test_score != null && ["selected", "waitlisted", "accepted", "admission_paid", "enrolled", "declined"].includes(a.status) ? `${a.test_score} / 100` : "Published with results"],
                ["Merit position", a.merit_rank != null && at >= ORDER.indexOf("selected") ? String(a.merit_rank) : "—"]]} />
            </Sheet>
          )}

          <Sheet title="Documents" flush>
            <Table>
              <thead><tr><th>Document</th><th>File</th><th>Status</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.name}</td>
                    <td className="text-[0.8125rem]">{d.file_id ? <a href={`/files/${d.file_id}`} className="text-brand hover:underline">{d.file_name}</a> : "—"}</td>
                    <td>
                      {d.status === "ok" ? <Stamp tone="ok">Verified</Stamp> : d.status === "flagged" ? (
                        <div className="space-y-2">
                          <Stamp tone="bad">Re-upload needed</Stamp>
                          <p className="text-[0.8125rem] text-danger">{d.note}</p>
                          <form action={A.reuploadDocAction} className="flex gap-2">
                            <input type="hidden" name="application_id" value={a.id} /><input type="hidden" name="name" value={d.name} />
                            <input name="file" type="file" required aria-label={`New file for ${d.name}`} className={`${inputCls} h-8 py-1 text-[0.8125rem]`} />
                            <Button size="sm">Upload</Button>
                          </form>
                        </div>
                      ) : <Stamp tone="wait">Checking</Stamp>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Sheet>

          <Sheet title="Details you gave">
            <Facts rows={[["NID / birth reg.", data.nid], ["Date of birth", data.dob], ["SSC GPA", data.ssc_gpa], ["HSC GPA", data.hsc_gpa], ["Guardian", data.guardian], ["Address", data.address],
              ...Object.entries(data).filter(([k]) => !["nid", "dob", "ssc_gpa", "hsc_gpa", "guardian", "address"].includes(k)) as [string, string][]]} />
          </Sheet>
        </div>

        <div className="space-y-6">
          <Sheet title="Fees" flush actions={acc.due > 0 && <Link href={`/admission/${a.id}/slip`} className={btn("ghost", "sm")}>Bank / counter slip</Link>}>
            {acc.lines.length === 0 ? <Empty title="Nothing to pay yet" /> : (
              <Table>
                <tbody>
                  {acc.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="r"><Money v={l.amount} /></td></tr>)}
                  {acc.payments.map((p) => <tr key={p.receipt_no}><td className="text-meta">Paid · <Link href={`/receipt/${p.receipt_no}`} className="text-brand hover:underline">{p.receipt_no}</Link> · {fmtDateTime(p.at)}</td><td className="r text-success"><Money v={-p.amount} /></td></tr>)}
                </tbody>
                <tfoot><tr><td>{acc.due > 0 ? "Due" : "Balance"}</td><td className={`r ${acc.due > 0 ? "text-danger" : "text-success"}`}>{taka(acc.due)}</td></tr></tfoot>
              </Table>
            )}
            {acc.due > 0 && (
              <form action={A.payApplicationAction} className="space-y-4 border-t border-rule px-6 py-5">
                <input type="hidden" name="application_id" value={a.id} /><input type="hidden" name="amount" value={acc.due} />
                <Field label="Pay online with">
                  <select name="method" className={inputCls}>{["bKash", "Nagad", "Rocket", "Card"].map((m) => <option key={m}>{m}</option>)}</select>
                </Field>
                <Button className="w-full">Pay {taka(acc.due)}</Button>
                <p className="text-[0.75rem] text-meta">Sandbox gateway: no real money moves. Or print the slip and pay at the Accounts counter.</p>
              </form>
            )}
          </Sheet>
          <p className="px-1 text-[0.8125rem] text-meta">Application fee {taka(await num("application_fee", 1200))}, non-refundable. Submitted {fmtDateTime(a.submitted_at)}.</p>
        </div>
      </div>
    </>
  );
}
