import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { transport } from "@/modules/index.ts";
import { resolveReportAction } from "../../../actions.ts";
import { Users, Timer, IdCard, Wallet, TriangleAlert, Map as MapIcon, ArrowUpRight } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Button, Empty, Progress, Bento, Stat, fmtDate, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Transport" };

export default async function TransportDash() {
  await requireRole("transport_officer");
  const d = await transport.dashboard();
  const reports = await transport.openReports();
  const exp = await transport.expiring();
  return (
    <>
      <PageHeader eyebrow="Transport office" title="Transport" meta="Fleet, riders and today's service at a glance." />
      <Bento>
        <Stat dark icon={Users} label="Riders this semester" value={d.riders} sub={`on ${d.routes} route${d.routes === 1 ? "" : "s"} · ${d.activeBuses} active bus${d.activeBuses === 1 ? "" : "es"}`} />
        <Stat icon={Timer} label="On time (30 days)" value={d.onTime == null ? "—" : `${d.onTime}%`} tone={d.onTime != null && d.onTime < 80 ? "warning" : undefined} sub="trips without delay" />
        <Stat href="/admin/transport/passes" icon={IdCard} label="Waiting approval" value={d.pending} tone={d.pending ? "warning" : undefined} sub="pass applications" />
        <Stat href="/admin/transport/passes?status=awaiting_payment" icon={Wallet} label="Unpaid passes" value={d.unpaid} sub="fee on the invoice" />
      </Bento>
      <div className="mb-6 grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Stat icon={TriangleAlert} label="Open issues" value={d.issues} tone={d.issues ? "danger" : "success"} sub="reported by crew" />
        <Link href="/admin/transport/map" className="group relative flex items-center gap-5 overflow-hidden rounded-[1.75rem] bg-card p-6 shadow-panel transition-transform duration-300 ease-(--ease-out-expo) hover:-translate-y-0.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand"><MapIcon aria-hidden size={22} strokeWidth={1.75} /></span>
          <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-semibold text-heading">Live fleet map<span aria-hidden className="breathe h-2 w-2 rounded-full bg-brand-green" /></span><span className="block text-[0.8125rem] text-meta">Every running bus, updated from the drivers’ phones every 15 seconds</span></span>
          <ArrowUpRight aria-hidden size={18} className="text-meta transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Sheet title="Open issues" flush>
          {reports.length === 0 ? <Empty title="No open issues" /> : (
            <ul className="px-6 pb-4">
              {reports.map((r) => (
                <li key={r.id} className="flex items-start gap-3 border-b border-rule py-3 last:border-0">
                  <Stamp tone={r.kind === "delay" ? "wait" : "bad"}>{r.kind}</Stamp>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9375rem]">Route {r.route}{r.bus ? ` · Bus ${r.bus}` : ""}: {r.note}</p>
                    <p className="text-[0.75rem] text-meta">{r.by_name} · {fmtDateTime(r.at)}{r.file_id ? <> · <a href={`/files/${r.file_id}`} className="text-brand hover:underline">Photo</a></> : null}</p>
                  </div>
                  <form action={resolveReportAction}><input type="hidden" name="report_id" value={r.id} /><Button size="sm" variant="secondary">Resolve</Button></form>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
        <Sheet title="Ridership by route" flush>
          <Table>
            <thead><tr><th>Route</th><th>Buses</th><th className="r">Riders</th><th className="w-40">Seats used</th></tr></thead>
            <tbody>
              {d.byRoute.map((r) => (
                <tr key={r.id}>
                  <td><span className="num font-medium text-brand">{r.number}</span> <span className="text-meta">{r.name}</span></td><td className="text-[0.8125rem]">{r.buses ?? "—"}</td>
                  <td className="r num">{r.riders}/{r.seats}</td>
                  <td><Progress value={r.riders} max={r.seats || 1} tone={r.riders > r.seats ? "danger" : "accent"} label={`Route ${r.number} seats used`} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
        <Sheet title="Documents expiring within 30 days" flush>
          {exp.length === 0 ? <Empty title="All licences and papers are current" /> : (
            <Table>
              <tbody>{exp.map((e) => <tr key={e.what}><td>{e.what}</td><td className="r num">{e.date < new Date().toISOString().slice(0, 10) ? <Stamp tone="bad">Expired {fmtDate(e.date)}</Stamp> : <Stamp tone="wait">{fmtDate(e.date)}</Stamp>}</td></tr>)}</tbody>
            </Table>
          )}
        </Sheet>
      </div>
    </>
  );
}
