import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";
import { requireRole } from "@/lib/auth.ts";
import { transport } from "@/modules/index.ts";
import { saveRouteAction, addStopAction, removeStopAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Button, Field, Empty, Segmented, inputCls, taka } from "@/components/ui";

export const metadata: Metadata = { title: "Routes & stops" };

export default async function Routes({ searchParams }: PageProps<"/admin/transport/routes">) {
  await requireRole("transport_officer");
  const routes = await transport.routes();
  const q = String((await searchParams).route ?? "");
  const r = q === "new" ? undefined : routes.find((x) => x.id === Number(q)) ?? routes[0];
  const stops = r ? await transport.stops(r.id) : [];
  return (
    <>
      <PageHeader eyebrow="Transport office" title="Routes & stops" meta="Stops, times and the semester fee riders are charged." actions={
        <Segmented label="Route" items={[...routes.map((x) => ({ href: `?route=${x.id}`, label: x.number, active: x.id === r?.id })), { href: "?route=new", label: "+ New", active: q === "new" }]} />
      } />
      <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <Sheet title={r ? `Route ${r.number}` : "New route"} className="self-start">
          <form action={saveRouteAction} className="space-y-3" key={r?.id ?? "new"}>
            {r && <input type="hidden" name="id" value={r.id} />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Number"><input autoComplete="off" name="number" required defaultValue={r?.number} placeholder="05…" className={inputCls} spellCheck={false} /></Field>
              <Field label="Fee per semester (৳)"><input autoComplete="off" name="fee" type="number" min="0" required defaultValue={r?.fee} className={inputCls} /></Field>
            </div>
            <Field label="Name"><input autoComplete="off" name="name" required defaultValue={r?.name} placeholder="Mirpur – Campus…" className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Distance (km)"><input autoComplete="off" name="distance_km" type="number" step="0.1" min="0" defaultValue={r?.distance_km ?? ""} className={inputCls} /></Field>
              <Field label="Leaves campus"><input autoComplete="off" name="return_time" type="time" defaultValue={r?.return_time ?? "16:30"} className={inputCls} /></Field>
            </div>
            <Field label="Status"><select name="active" defaultValue={r?.active ?? 1} className={inputCls}><option value={1}>Running</option><option value={0}>Suspended</option></select></Field>
            <Button>{r ? "Save route" : "Create route"}</Button>
            {r && <p className="text-[0.8125rem] text-meta">Fee changes apply to passes approved from now on. Current: {taka(r.fee)}.</p>}
          </form>
        </Sheet>
        {r ? (
          <Sheet title="Stops" flush>
            {stops.length === 0 ? <Empty title="No stops yet">Add stops in pickup order; they are sorted by time.</Empty> : (
              <ol className="relative mx-6 mb-4 border-l-2 border-brand/15 pl-5">
                {stops.map((s) => (
                  <li key={s.id} className="relative flex items-center justify-between gap-3 py-2">
                    <span aria-hidden className="absolute -left-[27px] h-3 w-3 rounded-full bg-brand ring-4 ring-card" />
                    <span className="text-[0.9375rem]">{s.name}</span>
                    <span className="flex items-center gap-3">
                      <span className="num text-[0.875rem] text-meta">{s.pickup_time}{s.drop_time ? ` · back ${s.drop_time}` : ""}</span>
                      <form action={removeStopAction}><input type="hidden" name="stop_id" value={s.id} />
                        <Button variant="ghost" size="sm" aria-label={`Remove ${s.name}`} confirm={`Remove the ${s.name} stop from this route?`} className="w-8 px-0 text-meta hover:bg-tint-red hover:text-danger"><X aria-hidden size={15} /></Button></form>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <form action={addStopAction} className="grid gap-3 border-t border-rule bg-muted/50 px-6 py-5 sm:grid-cols-4">
              <input type="hidden" name="route_id" value={r.id} />
              <Field label="Stop" className="sm:col-span-2"><input autoComplete="off" name="name" required className={inputCls} /></Field>
              <Field label="Pickup"><input autoComplete="off" name="pickup_time" type="time" required className={inputCls} /></Field>
              <Field label="Drop (return)"><input autoComplete="off" name="drop_time" type="time" className={inputCls} /></Field>
              <div className="flex items-end"><Button variant="secondary">Add stop</Button></div>
            </form>
          </Sheet>
        ) : <Sheet><Empty title="Create the route first">Then add its stops. <Link href="/admin/transport/fleet" className="text-brand hover:underline">Assign a bus</Link> to run it.</Empty></Sheet>}
      </div>
    </>
  );
}
