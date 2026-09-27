import { Phone, MessageSquare, MapPin } from "lucide-react";
import { all, today } from "@/lib/db.ts";
import { transport } from "@/modules/index.ts";
import { tripAction, reportTripAction, boardAction } from "../../actions.ts";
import { TripTracker, QrBoarding } from "@/components/live";
import { PageHeader, Sheet, StatusStamp, Stamp, Button, Field, Empty, Note, inputCls, areaCls, btn } from "@/components/ui";

// Driver / bus assistant: one-handed, phone-first (NFR-10).
export async function DriverDash({ userId, name }: { userId: number; name: string }) {
  const trips = await transport.crewTrips(userId, today());
  const office = (await all<{ name: string; phone: string | null }>(
    "SELECT u.name, u.phone FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role = 'transport_officer' AND u.phone IS NOT NULL LIMIT 1"))[0];
  return (
    <>
      <PageHeader eyebrow="Transport duty" title={`Hello, ${name.split(" ")[0]}`} meta={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dhaka" })}
        actions={office && (
          <>
            <a href={`tel:${office.phone}`} className={btn("secondary")}><Phone aria-hidden size={16} />Call office</a>
            <a href={`sms:${office.phone}`} className={btn("ghost")}><MessageSquare aria-hidden size={16} />Message</a>
          </>
        )} />
      {trips.length === 0 ? <Sheet><Empty title="No trips assigned today">If this looks wrong, call the Transport Office.</Empty></Sheet> : (
        <div className="space-y-6">
          {await Promise.all(trips.map(async (t) => {
            const stops = await transport.stops(t.route_id);
            const ordered = t.direction === "to_campus" ? stops : [...stops].reverse();
            const riders = await transport.riders(t.route_id);
            return (
              <Sheet key={t.id} title={`Route ${t.route} · ${t.direction === "to_campus" ? "To campus" : "From campus"} · ${t.scheduled}`}
                actions={<>{t.bus && <span className="num rounded-lg bg-brand-soft px-2 py-0.5 text-[0.75rem] font-medium text-brand">Bus {t.bus}</span>}
                  {t.status === "running" ? <Stamp tone="ok">On the road</Stamp> : <StatusStamp status={t.status === "scheduled" ? "upcoming" : t.status} />}</>}>
                <form action={tripAction}>
                  <input type="hidden" name="trip_id" value={t.id} />
                  {(t.status === "scheduled" || t.status === "delayed") && <Button name="do" value="start" className="h-14 w-full text-[1.0625rem]">Start trip</Button>}
                  {t.status === "running" && <Button name="do" value="end" variant="secondary" className="h-14 w-full text-[1.0625rem]">End trip</Button>}
                </form>
                {t.status === "running" && <TripTracker tripId={t.id} />}
                {t.note && <Note tone="wait" className="mt-3">{t.note}</Note>}
                {t.status === "running" && t.direction === "to_campus" && <Boarding tripId={t.id} routeId={t.route_id} />}
                <ol className="mt-4 space-y-1">
                  {ordered.map((s) => {
                    const here = riders.filter((r) => r.stop === s.name);
                    return (
                      <li key={s.id} className="flex items-start gap-3 rounded-xl px-2 py-2">
                        <MapPin aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand" />
                        <span className="min-w-0 flex-1">
                          <span className="text-[0.9375rem] text-ink">{s.name}</span>
                          {here.length > 0 && <span className="block text-[0.8125rem] text-meta">{here.length} rider{here.length === 1 ? "" : "s"}: {here.map((r) => r.name).join(", ")}</span>}
                        </span>
                        <span className="num text-[0.875rem] text-meta">{t.direction === "to_campus" ? s.pickup_time : s.drop_time ?? ""}</span>
                      </li>
                    );
                  })}
                </ol>
                {t.status !== "completed" && t.status !== "cancelled" && (
                  <details className="mt-4 rounded-2xl border border-rule bg-muted px-4 py-3">
                    <summary className="cursor-pointer text-[0.9375rem] font-medium text-ink">Report a delay or problem</summary>
                    <form action={reportTripAction} className="mt-3 space-y-3">
                      <input type="hidden" name="trip_id" value={t.id} />
                      <Field label="What happened">
                        <select name="kind" className={inputCls}><option value="delay">Delay (traffic, late start)</option><option value="breakdown">Breakdown</option><option value="incident">Incident or accident</option></select>
                      </Field>
                      <Field label="Expected delay (minutes)"><input autoComplete="off" name="minutes" type="number" min="0" inputMode="numeric" className={inputCls} /></Field>
                      <Field label="Note"><textarea name="note" required className={`${areaCls} min-h-20`} /></Field>
                      <Field label="Photo (optional)"><input name="photo" type="file" accept="image/*" capture="environment" className={`${inputCls} py-1.5`} /></Field>
                      <Button variant="danger" className="w-full">Send report</Button>
                    </form>
                  </details>
                )}
              </Sheet>
            );
          }))}
        </div>
      )}
    </>
  );
}

// TRN-D-3: tick riders on as they board, or scan their pass
async function Boarding({ tripId, routeId }: { tripId: number; routeId: number }) {
  const riders = await transport.ridersWithIds(routeId);
  const on = await transport.boarded(tripId);
  return (
    <div className="mt-4">
      <p className="flex items-baseline justify-between text-[0.9375rem] font-medium">Boarding<span className="num text-meta">{on.size} / {riders.length}</span></p>
      <QrBoarding tripId={tripId} />
      <ul className="mt-3 space-y-1">
        {riders.map((r) => (
          <li key={r.student_id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5">
            <span className="text-[0.9375rem]">{r.name}<span className="block text-[0.75rem] text-meta">{r.stop}</span></span>
            {on.has(r.student_id) ? <Stamp tone="ok">On board</Stamp> : (
              <form action={boardAction}><input type="hidden" name="trip_id" value={tripId} /><input type="hidden" name="student_id" value={r.student_id} />
                <Button size="sm" variant="secondary">Boarded</Button></form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
