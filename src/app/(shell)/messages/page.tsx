import type { Metadata } from "next";
import Link from "next/link";
import { Users, MessageCircle } from "lucide-react";
import { requireUser } from "@/lib/auth.ts";
import { comms } from "@/modules/index.ts";
import { startThreadAction } from "../../actions.ts";
import { PageHeader, Sheet, Button, Field, Empty, Avatar, inputCls, areaCls, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Messages" };

export default async function Inbox({ searchParams }: PageProps<"/messages">) {
  const s = await requireUser();
  const threads = await comms.inbox(s.user.id);
  const people = await comms.contacts(s.user.id);
  const to = Number((await searchParams).to) || undefined;
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Messages" meta="Conversations with your teachers, students and colleagues. For offices, use the help desk." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Sheet flush>
          {threads.length === 0 ? <Empty icon={MessageCircle} title="No conversations yet">Start one on the right. Class conversations open from each course page.</Empty> : (
            <ul className="px-2 py-2">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link href={`/messages/${t.id}`} className={`flex items-start gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-muted ${t.unread ? "bg-brand-soft/60" : ""}`}>
                    <Avatar name={t.kind === "section" ? t.subject : t.people} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-[0.9375rem] ${t.unread ? "font-semibold" : ""}`}>{t.kind === "section" && <Users aria-hidden size={14} className="mr-1 inline text-meta" />}{t.subject}</span>
                        <span className="num shrink-0 text-[0.75rem] text-meta">{fmtDateTime(t.last_at)}</span>
                      </span>
                      <span className="block truncate text-[0.8125rem] text-meta">{t.kind === "section" ? "Class" : t.people} · {t.last_from}: {t.last_body}</span>
                    </span>
                    {t.unread > 0 && <span className="num self-center rounded-full bg-brand px-1.5 text-[0.6875rem] font-semibold leading-5 text-on-dark">{t.unread}<span className="sr-only"> unread</span></span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
        <Sheet title="New message" className="self-start">
          {people.length === 0 ? <p className="text-[0.875rem] text-meta">You can message your teachers and mentor once you are registered. Offices are reached through the help desk.</p> : (
            <form action={startThreadAction} className="space-y-3">
              <Field label="To">
                <select name="to" required defaultValue={to ?? ""} className={inputCls}>
                  <option value="" disabled>Choose a person</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.uni_id}</option>)}
                </select>
              </Field>
              <Field label="Subject"><input autoComplete="off" name="subject" required className={inputCls} /></Field>
              <Field label="Message"><textarea name="body" required className={areaCls} /></Field>
              <Button className="w-full">Send</Button>
            </form>
          )}
        </Sheet>
      </div>
    </>
  );
}
