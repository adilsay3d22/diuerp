import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth.ts";
import { accounts, admission } from "@/modules/index.ts";
import * as A from "../../../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Button, Field, Facts, inputCls, btn, taka, fmtDateTime } from "@/components/ui";
import { AppStatus } from "../../../../app/applicant";

export const metadata: Metadata = { title: "Application review" };

export default async function Review({ params }: PageProps<"/admin/admissions/application/[id]">) {
  await requireRole("admissions_officer");
  const a = await admission.application(Number((await params).id));
  if (!a) notFound();
  const d = JSON.parse(a.data_json) as Record<string, string>;
  const docs = await admission.docs(a.id);
  const acc = await accounts.applicationAccount(a.id);
  return (
    <>
      <PageHeader eyebrow="Admission office" title={a.name} meta={<><span className="num">{a.ref}</span> · {a.program} · <Link href={`/admin/admissions/${a.cycle_id}`} className="text-brand hover:underline">{a.cycle}</Link></>} actions={<AppStatus status={a.status} />} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Sheet title="Documents" flush>
            <Table>
              <thead><tr><th>Document</th><th>File</th><th>Check</th></tr></thead>
              <tbody>
                {docs.map((x) => (
                  <tr key={x.id}>
                    <td className="font-medium">{x.name}</td>
                    <td>{x.file_id ? <a href={`/files/${x.file_id}`} className="text-brand hover:underline">{x.file_name}</a> : "—"}</td>
                    <td>
                      {x.status === "ok" ? <Stamp tone="ok">Verified</Stamp> : x.status === "flagged" ? <><Stamp tone="bad">Asked to re-upload</Stamp><p className="mt-1 text-[0.8125rem] text-meta">{x.note}</p></> : (
                        <form action={A.reviewDocAction} className="flex flex-wrap gap-1.5">
                          <input type="hidden" name="doc_id" value={x.id} />
                          <Button size="sm" name="decision" value="ok">Verify</Button>
                          <input autoComplete="off" name="note" placeholder="Problem (to flag)…" aria-label={`Problem with ${x.name}`} className={`${inputCls} h-8 w-44`} />
                          <Button size="sm" variant="danger" name="decision" value="flag">Flag</Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Sheet>
          {a.status === "under_review" && (
            <Sheet title="Decision">
              <form action={A.decideApplicationAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="application_id" value={a.id} />
                <Button name="decision" value="approve">Shortlist for test</Button>
                <Field label="Reason (to reject)" className="min-w-64 flex-1"><input autoComplete="off" name="reason" className={inputCls} /></Field>
                <Button name="decision" value="reject" variant="danger" confirm="Reject this request? The person is notified.">Reject</Button>
              </form>
            </Sheet>
          )}
        </div>
        <div className="space-y-6">
          <Sheet title="Applicant">
            <Facts rows={[["Email", a.email], ["Mobile", a.phone], ["NID / birth reg.", d.nid], ["Date of birth", d.dob], ["SSC GPA", d.ssc_gpa], ["HSC GPA", d.hsc_gpa],
              ["Guardian", d.guardian], ["Address", d.address], ["Submitted", fmtDateTime(a.submitted_at)], ["Test", a.test_slot ? `${a.test_slot} · ${a.test_room}` : "—"],
              ["Score / merit", a.test_score != null ? `${a.test_score} · #${a.merit_rank ?? "—"}` : "—"]]} />
          </Sheet>
          <Sheet title="Fees">
            <dl className="grid grid-cols-3 gap-3 text-[0.8125rem]">
              {([["Charged", taka(acc.total), ""], ["Paid", taka(acc.paid), "text-success"], ["Due", taka(acc.due), acc.due > 0 ? "text-danger" : "text-success"]] as const).map(([k, v, c]) => (
                <div key={k} className="flex flex-col-reverse rounded-2xl bg-muted px-3 py-3"><dt className="mt-1 text-meta">{k}</dt><dd className={`num text-[1.0625rem] font-semibold ${c}`}>{v}</dd></div>
              ))}
            </dl>
            {a.test_slot && <Link href={`/admission/${a.id}/admit`} className={`${btn("secondary", "sm")} mt-3`}>Admit card</Link>}
          </Sheet>
        </div>
      </div>
    </>
  );
}
