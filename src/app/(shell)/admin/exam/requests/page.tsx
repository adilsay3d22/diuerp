import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { services } from "@/modules/index.ts";
import { decideServiceRequestAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Button, Empty, Tabs, inputCls, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Service requests" };
const KINDS: services.Kind[] = ["improvement", "certificate", "transcript", "convocation"];

// STU-A-7: paid applications arrive here (W10).
export default async function Requests({ searchParams }: PageProps<"/admin/exam/requests">) {
  await requireRole("exam_controller");
  const view = String((await searchParams).view ?? "todo");
  const statuses = view === "todo" ? ["processing"] : view === "ready" ? ["ready"] : view === "unpaid" ? ["fee_due"] : ["approved", "delivered", "rejected"];
  const list = await services.requests(KINDS, statuses);
  return (
    <>
      <PageHeader eyebrow="Controller of Examinations" title="Service requests" meta="Improvement exams, certificates, transcripts and convocation. Requests arrive once the fee is paid." />
      <Tabs tabs={[["todo", "To process"], ["ready", "Ready to collect"], ["unpaid", "Awaiting fee"], ["done", "Done"]].map(([k, l]) => ({ href: `?view=${k}`, label: l, active: view === k }))} />
      <Sheet flush>
        {list.length === 0 ? <Empty title="Nothing here" /> : (
          <Table>
            <thead><tr><th>Request</th><th>Student</th><th>Details</th><th>Received</th><th>Action</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{services.KINDS[r.kind].label} <span className="num text-[0.75rem] text-meta">#{r.id}</span></td>
                  <td><Link href={`/admin/students/${r.student_id}`} className="text-brand hover:underline">{r.student}</Link> <span className="num text-[0.75rem] text-meta">{r.student_code}</span></td>
                  <td className="text-[0.8125rem]">{r.detail}{r.target ? ` → ${r.target}` : ""}</td>
                  <td className="whitespace-nowrap text-[0.8125rem]">{fmtDateTime(r.updated_at ?? r.at)}</td>
                  <td>
                    {view === "todo" && (
                      <form action={decideServiceRequestAction} className="flex flex-wrap gap-1.5">
                        <input type="hidden" name="request_id" value={r.id} />
                        {r.kind === "transcript" && <Link href={`/documents/transcript?student=${r.student_id}`} className="self-center text-[0.8125rem] text-brand hover:underline">Preview</Link>}
                        <Button size="sm" name="action" value="approve">{r.kind === "improvement" ? "Approve & enroll" : r.kind === "convocation" ? "Approve" : "Mark ready"}</Button>
                        <input autoComplete="off" name="note" placeholder="Note / reason…" aria-label="Note" className={`${inputCls} h-8 w-36`} />
                        <Button size="sm" variant="danger" name="action" value="reject" confirm="Reject this request? The person is notified.">Reject</Button>
                      </form>
                    )}
                    {view === "ready" && (
                      <form action={decideServiceRequestAction}><input type="hidden" name="request_id" value={r.id} /><input type="hidden" name="note" value="" />
                        <Button size="sm" name="action" value="delivered">Mark delivered</Button></form>
                    )}
                    {(view === "done" || view === "unpaid") && <Stamp tone={r.status === "rejected" ? "bad" : r.status === "fee_due" ? "wait" : "ok"}>{services.REQ_STATUS[r.status]}</Stamp>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
