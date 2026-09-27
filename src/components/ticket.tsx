import { Paperclip } from "lucide-react";
import { comms } from "@/modules/index.ts";
import { replyTicketAction, ticketStatusAction } from "@/app/actions.ts";
import { Sheet, Stamp, Button, Field, Facts, Avatar, areaCls, inputCls, fmtDateTime } from "./ui";

export const TicketStatus = ({ t }: { t: comms.Ticket }) => {
  const late = comms.slaBreached(t);
  const map: Record<string, ["ok" | "bad" | "wait" | "info" | "neutral", string]> = {
    open: ["wait", "Open"], in_progress: ["info", "In progress"], resolved: ["ok", "Resolved"], closed: ["neutral", "Closed"],
  };
  const [tone, label] = map[t.status] ?? ["neutral", t.status];
  return <span className="inline-flex gap-1.5"><Stamp tone={tone}>{label}</Stamp>{late && <Stamp tone="bad">Past SLA</Stamp>}</span>;
};

export async function TicketView({ t, as, userId }: { t: comms.Ticket; as: "requester" | "staff"; userId: number }) {
  const msgs = await comms.ticketMessages(t.id, as === "staff");
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        {msgs.map((m) => {
          const mine = m.user_id === userId;
          return (
            <article key={m.id} className={`max-w-[46rem] rounded-3xl px-5 py-4 shadow-panel ${m.internal ? "bg-tint-amber ring-1 ring-inset ring-warning/20" : mine ? "ml-auto bg-brand-soft" : "bg-card"}`}>
              <p className="flex items-center gap-2 text-[0.75rem] text-meta"><Avatar name={m.name} size={22} /><span className="font-medium text-strong">{m.name}</span>{m.internal ? " · internal note" : ""} · <span className="num">{fmtDateTime(m.at)}</span></p>
              <p className="mt-1 whitespace-pre-wrap text-[0.9375rem]">{m.body}</p>
              {m.file_id && <a href={`/files/${m.file_id}`} className="mt-2 inline-flex items-center gap-1 text-[0.8125rem] text-brand hover:underline"><Paperclip aria-hidden size={14} />{m.file_name}</a>}
            </article>
          );
        })}
        {t.status !== "closed" && (
          <Sheet>
            <form action={replyTicketAction} className="space-y-3">
              <input type="hidden" name="ticket_id" value={t.id} />
              <Field label={as === "staff" ? "Reply" : "Add a message"}><textarea name="body" required className={areaCls} /></Field>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Attachment (optional)" className="min-w-52 flex-1"><input name="file" type="file" className={`${inputCls} py-1.5`} /></Field>
                {as === "staff" && (
                  <>
                    <Field label="Then set status">
                      <select name="status" defaultValue="" className={inputCls}><option value="">Keep</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>
                    </Field>
                    <label className="flex h-10 items-center gap-2 text-[0.8125rem] text-strong"><input type="checkbox" name="internal" value="1" />Internal note</label>
                  </>
                )}
                <Button>Send</Button>
              </div>
            </form>
          </Sheet>
        )}
      </div>
      <div className="space-y-4">
        <Sheet title="Details">
          <Facts rows={[["Request", `#${t.id}`], ["Status", <TicketStatus key="s" t={t} />], ["Office", comms.OFFICES[t.office as comms.Office]?.label ?? t.office],
            ["Category", t.category], ["From", `${t.requester} (${t.requester_uni})`], ["Handled by", t.assignee ?? "Not yet"], ["Opened", fmtDateTime(t.at)],
            ["Answer due", fmtDateTime(t.sla_due)], ...(t.ref ? [["Reference", t.ref] as [string, string]] : [])]} />
        </Sheet>
        <form action={ticketStatusAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="ticket_id" value={t.id} />
          {as === "requester" && t.status !== "closed" && <Button name="status" value="closed" variant="secondary" size="sm">Close request</Button>}
          {as === "staff" && t.status !== "closed" && <Button name="status" value="closed" variant="secondary" size="sm">Close</Button>}
          {as === "staff" && t.status === "closed" && <Button name="status" value="open" variant="secondary" size="sm">Reopen</Button>}
        </form>
      </div>
    </div>
  );
}
