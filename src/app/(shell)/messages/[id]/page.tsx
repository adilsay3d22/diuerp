import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth.ts";
import { comms } from "@/modules/index.ts";
import { postMessageAction } from "../../../actions.ts";
import { PageHeader, Button, Avatar, btn, areaCls, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Conversation" };

export default async function Thread({ params }: PageProps<"/messages/[id]">) {
  const s = await requireUser();
  const t = await comms.openThread(s.user.id, Number((await params).id));
  if (!t) notFound();
  return (
    <>
      <PageHeader eyebrow="Inbox" title={t.subject} meta={t.kind === "section" ? `Class conversation · ${t.people.length + 1} people` : `With ${t.people.join(", ")}`}
        actions={<Link href="/messages" className={btn("ghost", "sm")}>All messages</Link>} />
      <div className="mx-auto max-w-3xl">
        <ol className="space-y-3">
          {t.messages.map((m, i) => {
            const mine = m.user_id === s.user.id;
            const showName = !mine && (i === 0 || t.messages[i - 1].user_id !== m.user_id);
            return (
              <li key={m.id} className={`flex items-end gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                {!mine && <span className={showName ? "" : "invisible"}><Avatar name={m.name} size={30} /></span>}
                <div className={`flex max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
                  {showName && <span className="mb-1 ml-1 text-[0.75rem] font-medium text-strong">{m.name}</span>}
                  <p className={`whitespace-pre-wrap px-4 py-2.5 text-[0.9375rem] leading-relaxed ${mine ? "rounded-[20px] rounded-br-md bg-brand text-on-dark" : "rounded-[20px] rounded-bl-md bg-card text-ink shadow-panel"}`}>{m.body}</p>
                  <time className="num mx-1 mt-1 text-[0.6875rem] text-meta">{fmtDateTime(m.at)}</time>
                </div>
              </li>
            );
          })}
        </ol>
        <form action={postMessageAction} className="sticky bottom-4 mt-6 flex items-end gap-2 rounded-[1.75rem] bg-card p-2 shadow-lift">
          <input type="hidden" name="thread_id" value={t.id} />
          <label htmlFor="body" className="sr-only">Message</label>
          <textarea id="body" name="body" required rows={1} placeholder="Message…" className={`${areaCls} min-h-10 flex-1 resize-none border-0 focus:ring-0`} />
          <Button>Send</Button>
        </form>
      </div>
    </>
  );
}
