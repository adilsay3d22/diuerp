import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { accounts } from "@/modules/index.ts";
import { decideApprovalAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, StatusStamp, Money, Button, Empty, Tabs, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Approvals" };

export default async function Approvals({ searchParams }: PageProps<"/admin/accounts/approvals">) {
  const s = await requireRole("accounts_officer", "finance_head");
  const status = ["approved", "rejected"].includes(String((await searchParams).status)) ? String((await searchParams).status) : "pending";
  const rows = await accounts.approvalsList(status);
  return (
    <>
      <PageHeader eyebrow="Accounts office" title="Approvals" meta="Maker-checker: whoever requests a reversal, waiver or adjustment cannot approve it. Reversals need the Finance Head." />
      <Tabs tabs={["pending", "approved", "rejected"].map((x) => ({ href: `?status=${x}`, label: x[0].toUpperCase() + x.slice(1), active: status === x }))} />
      <Sheet flush>
        {rows.length === 0 ? <Empty title={`No ${status} requests`} /> : (
          <Table>
            <thead><tr><th>Requested</th><th>Type</th><th>Student</th><th>Detail</th><th className="r">Amount</th><th>Reason</th><th>By</th><th>{status === "pending" ? "Decision" : "Status"}</th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const mine = a.requested_by === s.user.id;
                const blocked = a.kind === "reversal" && s.role !== "finance_head";
                return (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-[0.8125rem]">{fmtDateTime(a.at)}</td>
                    <td><Stamp tone={a.kind === "reversal" ? "bad" : a.kind === "waiver" ? "info" : "neutral"}>{a.kind}</Stamp></td>
                    <td>{a.student}<br /><span className="num text-[0.75rem] text-meta">{a.student_code}</span></td>
                    <td className="text-[0.8125rem]">{a.kind === "reversal" ? `Receipt ${a.receipt}` : `${a.detail ?? ""}${a.percent ? ` · ${a.percent}%` : ""}${a.semester ? ` · ${a.semester}` : ""}`}</td>
                    <td className="r num">{a.amount != null ? <Money v={a.amount} /> : "—"}</td>
                    <td className="max-w-64 text-[0.8125rem]">{a.reason}</td><td className="text-[0.8125rem]">{a.by_name}</td>
                    <td>
                      {status !== "pending" ? <StatusStamp status={status} /> : mine ? <span className="text-[0.75rem] text-meta">Your request</span> : blocked ? <span className="text-[0.75rem] text-meta">Finance Head decides</span> : (
                        <form action={decideApprovalAction} className="flex gap-1.5">
                          <input type="hidden" name="id" value={a.id} />
                          <Button size="sm" name="decision" value="approve">Approve</Button>
                          <Button size="sm" variant="danger" name="decision" value="reject" confirm="Reject this request? The person is notified.">Reject</Button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
