import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { Mail } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Empty, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Email & SMS log" };

export default async function Outbox() {
  await requireRole("super_admin");
  const rows = await all<{ id: number; channel: string; to_addr: string; subject: string; body: string | null; status: string; at: string }>(
    "SELECT * FROM outbox ORDER BY id DESC LIMIT 200");
  return (
    <>
      <PageHeader eyebrow="System administration" title="Email & SMS log" meta="Every message the system sent, newest first. Delivery provider: console (development). Configure SMTP and an SMS gateway before going live." />
      <Sheet flush>
        {rows.length === 0 ? <Empty icon={Mail} title="Nothing sent yet">Emails and SMS appear here as the system sends them.</Empty> : (
          <Table>
            <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num whitespace-nowrap text-[0.8125rem]">{fmtDateTime(r.at)}</td><td><span className="num rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] uppercase text-strong">{r.channel}</span></td>
                  <td className="num text-[0.8125rem]">{r.to_addr}</td><td className="max-w-md truncate" title={r.body ?? ""}>{r.subject}</td>
                  <td><Stamp tone={r.status === "sent" ? "ok" : "bad"}>{r.status}</Stamp></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
