import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { transport } from "@/modules/index.ts";
import { PageHeader, Sheet, Table, Stamp, Empty, fmtDateTime } from "@/components/ui";
import { LiveMap } from "@/components/live";

export const metadata: Metadata = { title: "Live fleet map" };

// TRN-A-7: every bus on an active trip, from the drivers' phones.
export default async function FleetMap() {
  await requireRole("transport_officer");
  const live = await transport.livePositions();
  const running = (await transport.todayTrips()).filter((t) => t.status === "running");
  return (
    <>
      <PageHeader eyebrow="Transport office" title="Live fleet map" meta="Positions come from drivers' phones while a trip is running." />
      <Sheet className="mb-6" title="Fleet" sub="OpenStreetMap · refreshes every 15 seconds"><LiveMap height={480} /></Sheet>
      <Sheet title="Running trips" flush>
        {running.length === 0 ? <Empty title="No trips running right now" /> : (
          <Table>
            <thead><tr><th>Route</th><th>Bus · driver</th><th>Direction</th><th>Last position</th></tr></thead>
            <tbody>
              {running.map((t) => {
                const p = live.find((l) => l.trip_id === t.id);
                return (
                  <tr key={t.id}>
                    <td className="num font-medium text-brand">{t.route}</td><td>{t.bus} · {t.driver}</td><td>{t.direction === "to_campus" ? "To campus" : "From campus"}</td>
                    <td>{p ? <span className="num text-[0.8125rem]">{p.lat.toFixed(4)}, {p.lng.toFixed(4)} · {fmtDateTime(p.at)}</span> : <Stamp tone="wait">No GPS yet</Stamp>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
