import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { today } from "@/lib/db.ts";
import { transport } from "@/modules/index.ts";
import { generateTripsAction, disruptionAction } from "../../../../actions.ts";
import { Bus } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, StatusStamp, Button, Empty, inputCls, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Trips" };

export default async function Trips({ searchParams }: PageProps<"/admin/transport/trips">) {
  await requireRole("transport_officer");
  const date = String((await searchParams).date ?? today());
  const list = await transport.trips(date);
  return (
    <>
      <PageHeader eyebrow="Transport office" title="Trips" meta={`${fmtDate(date)} · generated from each route's schedule; holidays from the academic calendar are skipped.`}
        actions={
          <form className="flex items-end gap-2">
            <label className="sr-only" htmlFor="date">Date</label>
            <input autoComplete="off" id="date" name="date" type="date" defaultValue={date} className={`${inputCls} w-40`} />
            <Button variant="secondary">Show</Button>
          </form>
        } />
      <Sheet flush>
        {list.length === 0 ? (
          <Empty icon={Bus} title={`No trips for ${fmtDate(date)}`}>
            Generate them from each route’s timetable. Fridays and calendar holidays have no service.
            <form action={generateTripsAction} className="mt-4"><input type="hidden" name="date" value={date} /><Button>Generate trips</Button></form>
          </Empty>
        ) : (
          <Table>
            <thead><tr><th>Time</th><th>Route</th><th>Direction</th><th>Bus · crew</th><th>Status</th><th>Delay or cancel</th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td className="num font-medium">{t.scheduled}</td>
                  <td><span className="num font-medium text-brand">{t.route}</span> <span className="text-meta">{t.route_name}</span></td>
                  <td>{t.direction === "to_campus" ? "To campus" : "From campus"}</td>
                  <td className="text-[0.8125rem]">{t.bus ?? "—"}{t.driver ? ` · ${t.driver}` : ""}</td>
                  <td>
                    <StatusStamp status={t.status === "running" ? "active" : t.status === "scheduled" ? "upcoming" : t.status} />
                    {t.delay_min ? <span className="ml-1.5"><Stamp tone="wait">{t.delay_min} min</Stamp></span> : null}
                    {t.note && <p className="mt-1 max-w-56 text-[0.75rem] text-meta">{t.note}</p>}
                  </td>
                  <td>
                    {!["completed", "cancelled"].includes(t.status) && (
                      <form action={disruptionAction} className="flex flex-wrap gap-1.5">
                        <input type="hidden" name="trip_id" value={t.id} />
                        <input autoComplete="off" name="minutes" type="number" min="1" placeholder="Min…" aria-label="Delay in minutes" className={`${inputCls} h-9 w-16`} />
                        <input autoComplete="off" name="note" required placeholder="Message to riders…" aria-label="Message to riders" className={`${inputCls} h-9 w-44`} />
                        <Button size="sm" variant="secondary" name="kind" value="delay">Delay</Button>
                        <Button size="sm" variant="danger" name="kind" value="cancel" confirm="Cancel this trip? Every rider on the route is notified.">Cancel</Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
      {list.length > 0 && <p className="mt-3 text-[0.8125rem] text-meta">Riders on the route are notified the moment you publish a delay or cancellation.</p>}
    </>
  );
}
