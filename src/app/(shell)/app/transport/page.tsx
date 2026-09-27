import type { Metadata } from "next";
import Link from "next/link";
import { Phone, LifeBuoy } from "lucide-react";
import { studentCtx } from "@/lib/page.ts";
import { all, get, today } from "@/lib/db.ts";
import { transport } from "@/modules/index.ts";
import { applyPassAction, passRequestAction } from "../../../actions.ts";
import { PageHeader, Sheet, Stamp, StatusStamp, Button, Field, Facts, Empty, Note, Crest, inputCls, taka, fmtDateTime } from "@/components/ui";
import QRCode from "qrcode";
import { LiveMap } from "@/components/live";

export const metadata: Metadata = { title: "Transport" };

const PASS: Record<string, [("ok" | "bad" | "wait" | "info" | "neutral"), string]> = {
  applied: ["wait", "Applied · awaiting approval"], awaiting_payment: ["wait", "Awaiting payment"], active: ["ok", "Active"],
  suspended: ["neutral", "Suspended"], cancelled: ["neutral", "Cancelled"], rejected: ["bad", "Not approved"], expired: ["neutral", "Expired"],
};

export default async function Transport({ searchParams }: PageProps<"/app/transport">) {
  const { s, st, sem } = await studentCtx();
  const pass = await transport.studentPass(st.id, sem.id);
  const live = pass && ["applied", "awaiting_payment", "active", "suspended"].includes(pass.status);
  const routes = (await transport.routes()).filter((r) => r.active);
  const pick = Number((await searchParams).route) || routes[0]?.id;
  const crew = pass?.bus_id ? await get<{ driver: string | null; driver_phone: string | null; assistant: string | null; assistant_phone: string | null }>(
    `SELECT du.name AS driver, du.phone AS driver_phone, au.name AS assistant, au.phone AS assistant_phone FROM buses b
     LEFT JOIN crew d ON d.id = b.driver_id LEFT JOIN users du ON du.id = d.user_id LEFT JOIN crew a ON a.id = b.assistant_id LEFT JOIN users au ON au.id = a.user_id
     WHERE b.id = ?`, pass.bus_id) : undefined;
  const todays = pass ? (await transport.trips(today())).filter((t) => t.route_id === pass.route_id) : [];
  const alerts = await all<{ id: number; title: string; body: string; at: string }>(
    "SELECT id, title, body, at FROM notifications WHERE user_id = ? AND href = '/app/transport' ORDER BY id DESC LIMIT 5", s.user.id);
  const pending = pass && await get<{ kind: string }>("SELECT kind FROM pass_requests WHERE pass_id = ? AND status = 'pending'", pass.id);

  return (
    <>
      <PageHeader eyebrow="Student services" title="Transport" meta={`${sem.name} · Semester passes, routes and bus alerts`} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          {pass && (
            <Sheet title="My pass" actions={<Stamp tone={PASS[pass.status][0]}>{PASS[pass.status][1]}</Stamp>}>
              <Facts rows={[["Route", `${pass.route} · ${pass.route_name}`], ["Stop", `${pass.stop} · pickup ${pass.pickup_time}`], ["Bus", pass.bus ?? "Assigned when active"],
                ["Driver", crew?.driver ? <a href={`tel:${crew.driver_phone}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Phone aria-hidden size={14} />{crew.driver}</a> : "—"],
                ["Assistant", crew?.assistant ? <a href={`tel:${crew.assistant_phone}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Phone aria-hidden size={14} />{crew.assistant}</a> : "—"]]} />
              {pass.status === "awaiting_payment" && <p className="mt-4 text-[0.875rem] text-strong">The transport fee is on your semester invoice. <Link href="/app/fees" className="font-medium text-brand hover:underline">Pay now</Link> to activate the pass.</p>}
              {pass.status === "rejected" && pass.note && <Note tone="bad" className="mt-4">{pass.note}</Note>}
              {live && pass.status !== "applied" && (
                pending ? <p className="mt-4 text-[0.875rem] text-meta">Your {pending.kind} request is with the Transport Office.</p> : (
                  <details className="mt-4 rounded-2xl border border-rule bg-muted px-4 py-3">
                    <summary className="cursor-pointer text-[0.9375rem] font-medium">Change stop or route, suspend, or cancel</summary>
                    <form action={passRequestAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Request">
                        <select name="kind" className={inputCls}>
                          <option value="change">Change stop or route</option>
                          {pass.status === "active" && <option value="suspend">Suspend</option>}
                          {pass.status === "suspended" && <option value="resume">Resume</option>}
                          <option value="cancel">Cancel pass</option>
                        </select>
                      </Field>
                      <Field label="New route (for a change)">
                        <select name="route_id" defaultValue={pass.route_id} className={inputCls}>{routes.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.name}</option>)}</select>
                      </Field>
                      <Field label="New stop (for a change)" className="sm:col-span-2">
                        <select name="stop_id" defaultValue={pass.stop_id} className={inputCls}>
                          {await Promise.all(routes.map(async (r) => <optgroup key={r.id} label={`Route ${r.number}`}>{(await transport.stops(r.id)).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.pickup_time}</option>)}</optgroup>))}
                        </select>
                      </Field>
                      <Field label="Reason" className="sm:col-span-2"><input autoComplete="off" name="reason" required className={inputCls} /></Field>
                      <div><Button variant="secondary">Send request</Button></div>
                    </form>
                  </details>
                )
              )}
            </Sheet>
          )}

          <Sheet title="Routes" flush actions={
            <nav aria-label="Route" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-panel">
              {routes.map((r) => (
                <Link key={r.id} href={`?route=${r.id}`} className={`rounded-xl px-3 py-1 text-[0.8125rem] font-medium ${r.id === pick ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>{r.number}</Link>
              ))}
            </nav>
          }>
            {await Promise.all(routes.filter((r) => r.id === pick).map(async (r) => {
              const stops = await transport.stops(r.id);
              const left = r.seats - r.riders;
              return (
                <div key={r.id} className="px-6 pb-6">
                  <p className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-heading">{r.name}</p>
                  <p className="mt-0.5 text-[0.8125rem] text-meta">{taka(r.fee)} per semester · returns from campus {r.return_time} · {left > 0 ? `${left} seats left` : "Full"}</p>
                  <ol className="relative mt-5 space-y-3.5 border-l-2 border-brand/15 pl-5">
                    {stops.map((x) => (
                      <li key={x.id} className="relative flex justify-between gap-3 text-[0.9375rem]">
                        <span aria-hidden className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full bg-brand ring-4 ring-card" />
                        <span>{x.name}</span><span className="num text-meta">{x.pickup_time}</span>
                      </li>
                    ))}
                  </ol>
                  {!live && (
                    left > 0 ? (
                      <form action={applyPassAction} className="mt-5 flex flex-wrap items-end gap-3">
                        <input type="hidden" name="route_id" value={r.id} />
                        <Field label="Your stop" className="min-w-52 flex-1">
                          <select name="stop_id" className={inputCls}>{stops.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.pickup_time}</option>)}</select>
                        </Field>
                        <Button>Apply for pass</Button>
                      </form>
                    ) : <p className="mt-5 text-[0.875rem] text-danger">This route is full for {sem.name}. Try another route.</p>
                  )}
                </div>
              );
            }))}
            {routes.length === 0 && <Empty title="No routes running" />}
          </Sheet>
        </div>

        <div className="space-y-6">
          {pass?.status === "active" && (
            <Sheet title="Where's my bus?">
              <LiveMap rider stops={await transport.stops(pass.route_id)} height={280} />
            </Sheet>
          )}
          {pass?.status === "active" && (
            <section aria-label="Boarding pass" className="overflow-hidden rounded-[1.75rem] bg-card shadow-lift">
              <div className="relative overflow-hidden bg-brand-deep px-6 pb-5 pt-5 text-on-dark">
                <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.65),transparent_65%)]" />
                <div className="relative flex items-center gap-3">
                  <Crest size={36} />
                  <div className="leading-tight"><p className="text-[0.8125rem] font-semibold">Daffodil International University</p><p className="eyebrow mt-0.5 text-[0.5625rem] text-brand-green">Transport pass · {sem.code}</p></div>
                </div>
                <div className="relative mt-5 flex items-end justify-between gap-3">
                  <div><p className="text-[0.75rem] text-on-dark-muted">Route</p><p className="num text-[2rem] font-medium leading-none tracking-[-0.05em]">{pass.route}</p></div>
                  <div className="text-right"><p className="text-[0.75rem] text-on-dark-muted">Bus</p><p className="num text-[1.25rem] font-medium">{pass.bus ?? "—"}</p></div>
                </div>
              </div>
              <div className="border-b-2 border-dashed border-rule px-6 py-4">
                <p className="font-semibold text-heading">{st.name}</p>
                <p className="num text-[0.8125rem] text-meta">{st.student_id} · {pass.stop} {pass.pickup_time}</p>
              </div>
              <div className="px-6 py-5">
                <div className="mx-auto w-44" aria-label="Pass QR code" dangerouslySetInnerHTML={{ __html: await QRCode.toString(transport.passToken(pass.id), { type: "svg", margin: 1, width: 176 }) }} />
                <p className="num mt-2 text-center text-[0.8125rem] text-meta">{transport.passToken(pass.id)}</p>
                <p className="mt-1 text-center text-[0.8125rem] text-meta">Show this to the bus assistant when you board.</p>
              </div>
            </section>
          )}
          {todays.length > 0 && (
            <Sheet title="Today's buses" flush>
              <ul className="px-6 pb-4">
                {todays.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-[0.875rem]">
                    <span>{t.direction === "to_campus" ? "To campus" : "From campus"} · <span className="num">{t.scheduled}</span></span>
                    {t.delay_min ? <Stamp tone="wait">~{t.delay_min} min late</Stamp> : <StatusStamp status={t.status === "running" ? "active" : t.status === "scheduled" ? "upcoming" : t.status} />}
                  </li>
                ))}
              </ul>
            </Sheet>
          )}
          <Link href="/helpdesk?category=Transport%20complaint&subject=Transport%20complaint" className="group flex items-start gap-3 rounded-[1.75rem] bg-card px-6 py-5 text-[0.9375rem] shadow-panel transition-[box-shadow,transform] duration-300 ease-(--ease-out-expo) hover:-translate-y-0.5 hover:shadow-lift">
            <LifeBuoy aria-hidden size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand" /><span>
            <span className="font-medium">Report a problem</span>
            <span className="block text-[0.8125rem] text-meta">A trip, bus or driver issue goes to the Transport Office help desk.</span></span>
          </Link>
          <Sheet title="Alerts" flush>
            {alerts.length === 0 ? <Empty title="No alerts">Delays, route changes and cancellations for your route show up here and in notifications.</Empty> : (
              <ul className="px-6 pb-4">
                {alerts.map((a) => (
                  <li key={a.id} className="border-b border-rule py-2.5 last:border-0">
                    <p className="text-[0.875rem] font-medium">{a.title}</p>
                    {a.body && <p className="text-[0.8125rem] text-meta">{a.body}</p>}
                    <p className="text-[0.75rem] text-meta">{fmtDateTime(a.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
        </div>
      </div>
    </>
  );
}
