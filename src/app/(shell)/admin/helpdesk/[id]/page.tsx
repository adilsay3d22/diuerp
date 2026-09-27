import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth.ts";
import { comms } from "@/modules/index.ts";
import { PageHeader, btn } from "@/components/ui";
import { TicketView } from "@/components/ticket";

export const metadata: Metadata = { title: "Request" };

export default async function StaffTicket({ params }: PageProps<"/admin/helpdesk/[id]">) {
  const s = await requireUser();
  const t = await comms.ticket(Number((await params).id));
  if (!t || comms.canSeeTicket(s.user.id, s.roles, t) !== "staff") notFound();
  return (
    <>
      <PageHeader eyebrow="Help desk" title={t.subject} meta={`#${t.id} · from ${t.requester}`} actions={<Link href="/admin/helpdesk" className={btn("ghost", "sm")}>Queue</Link>} />
      <TicketView t={t} as="staff" userId={s.user.id} />
    </>
  );
}
