import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth.ts";
import { comms } from "@/modules/index.ts";
import { PageHeader, btn } from "@/components/ui";
import { TicketView } from "@/components/ticket";

export const metadata: Metadata = { title: "Request" };

export default async function MyTicket({ params }: PageProps<"/helpdesk/[id]">) {
  const s = await requireUser();
  const t = await comms.ticket(Number((await params).id));
  if (!t || t.requester_id !== s.user.id) notFound();
  return (
    <>
      <PageHeader eyebrow="Help desk" title={t.subject} meta={`#${t.id} · ${comms.OFFICES[t.office as comms.Office]?.label}`} actions={<Link href="/helpdesk" className={btn("ghost", "sm")}>All requests</Link>} />
      <TicketView t={t} as="requester" userId={s.user.id} />
    </>
  );
}
