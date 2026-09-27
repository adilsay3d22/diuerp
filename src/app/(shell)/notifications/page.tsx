import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { readNotificationsAction } from "../../actions.ts";
import { Bell } from "lucide-react";
import { PageHeader, Sheet, Empty, Button, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Notifications" };

export default async function Notifications() {
  const s = await requireUser();
  const rows = await all<{ id: number; title: string; body: string; href: string; read: number; at: string }>(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 100", s.user.id);
  const unread = rows.filter((r) => !r.read).length;
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notifications" meta={`${unread} unread`}
        actions={unread > 0 && <form action={readNotificationsAction}><Button variant="secondary" size="sm">Mark all as read</Button></form>} />
      <Sheet flush>
        {rows.length === 0 ? <Empty icon={Bell} title="Nothing yet">Payments, grade releases, attendance warnings and office decisions will appear here.</Empty> : (
          <ul>
            {rows.map((r) => (
              <li key={r.id} className={`flex gap-4 border-b border-rule px-6 py-4 last:border-0 ${r.read ? "" : "bg-brand-soft/60"}`}>
                <span aria-hidden className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${r.read ? "bg-muted text-meta" : "bg-brand text-on-dark"}`}><Bell size={15} strokeWidth={1.75} /></span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[0.9375rem] ${r.read ? "text-strong" : "font-semibold text-ink"}`}>
                    {r.href ? <Link href={r.href} className="hover:underline">{r.title}</Link> : r.title}
                    {!r.read && <span className="sr-only"> (unread)</span>}
                  </p>
                  {r.body && <p className="text-[0.875rem] text-meta">{r.body}</p>}
                </div>
                <time className="num shrink-0 text-[0.75rem] text-meta">{fmtDateTime(r.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
