import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth.ts";
import { comms } from "@/modules/index.ts";
import { Inbox } from "lucide-react";
import { PageHeader, Sheet, Table, Empty, Tabs, fmtDateTime } from "@/components/ui";
import { TicketStatus } from "@/components/ticket";

export const metadata: Metadata = { title: "Help desk queue" };

export default async function Queue({ searchParams }: PageProps<"/admin/helpdesk">) {
  const s = await requireUser();
  const active = s.roles.filter((r) => r.role === s.role);
  const offices = comms.officesFor(active);
  if (!offices.length) redirect("/?denied=1");
  const status = (await searchParams).status === "done" ? "done" : "open";
  const list = await comms.queue(active, status);
  return (
    <>
      <PageHeader eyebrow="Help desk" title="Help desk queue" meta={offices.map((o) => comms.OFFICES[o].label).join(" · ")} />
      <Tabs tabs={[{ href: "?status=open", label: "Open", active: status === "open", count: status === "open" ? list.length : undefined }, { href: "?status=done", label: "Resolved & closed", active: status === "done" }]} />
      <Sheet flush>
        {list.length === 0 ? <Empty icon={Inbox} title={status === "open" ? "Queue is clear" : "Nothing resolved yet"} /> : (
          <Table>
            <thead><tr><th>Request</th><th>From</th><th>Category</th><th>Status</th><th>Answer due</th><th>Handled by</th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/admin/helpdesk/${t.id}`} className="font-medium text-brand hover:underline">{t.subject}</Link> <span className="num text-[0.75rem] text-meta">#{t.id}</span></td>
                  <td>{t.requester} <span className="num text-[0.75rem] text-meta">{t.requester_uni}</span></td>
                  <td className="text-[0.8125rem]">{t.category}</td><td><TicketStatus t={t} /></td>
                  <td className="num whitespace-nowrap text-[0.8125rem]">{fmtDateTime(t.sla_due)}</td><td className="text-[0.8125rem]">{t.assignee ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
