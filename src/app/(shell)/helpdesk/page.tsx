import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, LifeBuoy } from "lucide-react";
import { requireUser } from "@/lib/auth.ts";
import { comms } from "@/modules/index.ts";
import { createTicketAction } from "../../actions.ts";
import { PageHeader, Sheet, Button, Field, Empty, inputCls, areaCls, fmtDateTime } from "@/components/ui";
import { TicketStatus } from "@/components/ticket";

export const metadata: Metadata = { title: "Help desk" };

export default async function HelpDesk({ searchParams }: PageProps<"/helpdesk">) {
  const s = await requireUser();
  const q = await searchParams;
  const mine = await comms.myTickets(s.user.id);
  const preset = typeof q.category === "string" ? q.category : "";
  return (
    <>
      <PageHeader eyebrow="Help desk" title="Help desk" meta="Ask an office for help or report a problem. Every request is tracked until it is resolved." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Sheet title="My requests" flush>
          {mine.length === 0 ? <Empty icon={LifeBuoy} title="No requests yet">Use the form to reach the Registrar, Exams, Accounts, Transport, IT or Facilities.</Empty> : (
            <ul className="px-2 pb-1">
              {mine.map((t) => (
                <li key={t.id}>
                  <Link href={`/helpdesk/${t.id}`} className="group flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-muted">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] text-ink">{t.subject}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-meta"><TicketStatus t={t} /><span className="num">#{t.id}</span> · {t.category} · updated {fmtDateTime(t.last_at)}</span>
                    </span>
                    <ChevronRight aria-hidden size={18} strokeWidth={1.75} className="shrink-0 text-field transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
        <Sheet title="New request" className="self-start">
          <form action={createTicketAction} className="space-y-3">
            <Field label="What is it about?">
              <select name="category" defaultValue={preset} required className={inputCls}>
                <option value="" disabled>Choose a category</option>
                {Object.entries(comms.TICKET_CATEGORIES).map(([c, v]) => <option key={c} value={c}>{c} · {comms.OFFICES[v.office].label}</option>)}
              </select>
            </Field>
            <Field label="Subject"><input autoComplete="off" name="subject" required defaultValue={typeof q.subject === "string" ? q.subject : ""} className={inputCls} /></Field>
            <Field label="Details"><textarea name="body" required className={areaCls} /></Field>
            {typeof q.ref === "string" && <input type="hidden" name="ref" value={q.ref} />}
            <Field label="Attachment (optional)"><input name="file" type="file" className={`${inputCls} py-1.5`} /></Field>
            <Button className="w-full">Send request</Button>
          </form>
        </Sheet>
      </div>
    </>
  );
}
