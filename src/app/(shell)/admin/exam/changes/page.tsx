import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { student } from "@/modules/index.ts";
import { decideGradeChangeAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, StatusStamp, Button, Empty, Tabs, fmtDateTime } from "@/components/ui";
import { grade } from "@/lib/rules.ts";

export const metadata: Metadata = { title: "Grade changes" };

export default async function Changes({ searchParams }: PageProps<"/admin/exam/changes">) {
  const s = await requireRole("exam_controller");
  const status = ["approved", "rejected"].includes(String((await searchParams).status)) ? String((await searchParams).status) : "pending";
  const rows = await student.gradeChanges(status);
  return (
    <>
      <PageHeader eyebrow="Controller of Examinations" title="Grade-change requests" meta="Approval appends a corrected result; the original stays on record with the reason." />
      <Tabs tabs={["pending", "approved", "rejected"].map((x) => ({ href: `?status=${x}`, label: x[0].toUpperCase() + x.slice(1), active: status === x }))} />
      <Sheet flush>
        {rows.length === 0 ? <Empty title={`No ${status} requests`} /> : (
          <Table>
            <thead><tr><th>Requested</th><th>Student</th><th>Course</th><th className="r">Old</th><th className="r">New</th><th>Reason</th><th>By</th><th>{status === "pending" ? "Decision" : "Status"}</th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap text-[0.8125rem]">{fmtDateTime(g.at)}</td>
                  <td>{g.student}<br /><span className="num text-[0.75rem] text-meta">{g.student_code}</span></td>
                  <td><span className="num font-medium text-brand">{g.code}</span> <span className="num">{g.section}</span></td>
                  <td className="r num">{(g.old_total_c / 100).toFixed(2)} <span className="text-meta">{grade(g.old_total_c / 100).letter}</span></td>
                  <td className="r num font-semibold text-brand">{(g.new_total_c / 100).toFixed(2)} {grade(g.new_total_c / 100).letter}</td>
                  <td className="max-w-72 text-[0.8125rem]">{g.reason}</td><td className="text-[0.8125rem]">{g.by_name}</td>
                  <td>
                    {status !== "pending" ? <StatusStamp status={status} /> : g.requested_by === s.user.id ? <span className="text-[0.75rem] text-meta">Your request: another controller decides</span> : (
                      <form action={decideGradeChangeAction} className="flex gap-1.5">
                        <input type="hidden" name="id" value={g.id} />
                        <Button size="sm" name="decision" value="approve">Approve</Button>
                        <Button size="sm" variant="danger" name="decision" value="reject" confirm="Reject this request? The person is notified.">Reject</Button>
                      </form>
                    )}
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
