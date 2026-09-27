import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { registrar, transport } from "@/modules/index.ts";
import { decidePassAction, decidePassRequestAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Stamp, Button, Empty, Tabs, Progress, inputCls, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Passes" };
const LABEL: Record<string, [("ok" | "bad" | "wait" | "info" | "neutral"), string]> = {
  applied: ["wait", "Applied"], awaiting_payment: ["wait", "Awaiting payment"], active: ["ok", "Active"], suspended: ["neutral", "Suspended"],
  cancelled: ["neutral", "Cancelled"], rejected: ["bad", "Rejected"],
};

export default async function Passes({ searchParams }: PageProps<"/admin/transport/passes">) {
  await requireRole("transport_officer");
  const sem = await registrar.currentSemester();
  const status = String((await searchParams).status ?? "applied");
  const list = await transport.passes(sem.id, status || undefined);
  const reqs = await transport.pendingRequests();
  const routes = await transport.routes();
  return (
    <>
      <PageHeader eyebrow="Transport office" title="Passes" meta={sem.name} />
      <div className="mb-6 flex flex-wrap gap-3">
        {routes.map((r) => (
          <div key={r.id} className="min-w-52 flex-1 rounded-[1.75rem] bg-card px-5 py-4 shadow-panel">
            <p className="flex items-baseline justify-between text-[0.8125rem] text-meta"><span>Route <span className="num font-medium text-brand">{r.number}</span></span><span className="num text-ink">{r.riders}/{r.seats}</span></p>
            <div className="mt-2"><Progress value={r.riders} max={r.seats || 1} tone={r.riders > r.seats ? "danger" : "accent"} label={`Route ${r.number} seats`} /></div>
          </div>
        ))}
      </div>
      {reqs.length > 0 && (
        <Sheet title="Change requests" flush className="mb-6">
          <Table>
            <thead><tr><th>Student</th><th>Request</th><th>From</th><th>To</th><th>Reason</th><th /></tr></thead>
            <tbody>
              {reqs.map((q) => (
                <tr key={q.id}>
                  <td>{q.student} <span className="num text-[0.75rem] text-meta">{q.student_code}</span></td>
                  <td className="capitalize">{q.kind}</td><td className="text-[0.8125rem]">{q.from_route} · {q.from_stop}</td>
                  <td className="text-[0.8125rem]">{q.kind === "change" ? `${q.to_route} · ${q.to_stop}` : "—"}</td>
                  <td className="text-[0.8125rem]">{q.reason}</td>
                  <td className="r">
                    <form action={decidePassRequestAction} className="flex justify-end gap-1.5">
                      <input type="hidden" name="request_id" value={q.id} />
                      <Button size="sm" name="decision" value="approve">Approve</Button>
                      <Button size="sm" variant="danger" name="decision" value="reject" confirm="Reject this request? The person is notified.">Reject</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
      )}
      <Tabs tabs={[["applied", "To approve"], ["awaiting_payment", "Awaiting payment"], ["active", "Active"], ["suspended", "Suspended"], ["", "All"]]
        .map(([k, l]) => ({ href: `?status=${k}`, label: l, active: status === k }))} />
      <Sheet flush>
        {list.length === 0 ? <Empty title="Nothing here" /> : (
          <Table>
            <thead><tr><th>Student</th><th>Route · stop</th><th>Bus</th><th>Applied</th><th>Status</th>{status === "applied" && <th>Decision</th>}</tr></thead>
            <tbody>
              {list.map((p) => {
                const r = routes.find((x) => x.id === p.route_id)!;
                return (
                  <tr key={p.id}>
                    <td>{p.student} <span className="num text-[0.75rem] text-meta">{p.student_code}</span></td>
                    <td><span className="num font-medium text-brand">{p.route}</span> · {p.stop} <span className="num text-[0.75rem] text-meta">{p.pickup_time}</span></td>
                    <td>{p.bus ?? "—"}</td><td className="text-[0.8125rem]">{fmtDateTime(p.at)}</td>
                    <td><Stamp tone={LABEL[p.status]?.[0] ?? "neutral"}>{LABEL[p.status]?.[1] ?? p.status}</Stamp></td>
                    {status === "applied" && (
                      <td>
                        {r.riders > r.seats && <p className="mb-1 text-[0.75rem] text-danger">Route over capacity ({r.riders}/{r.seats})</p>}
                        <form action={decidePassAction} className="flex flex-wrap gap-1.5">
                          <input type="hidden" name="pass_id" value={p.id} />
                          <Button size="sm" name="decision" value="approve">Approve</Button>
                          <input autoComplete="off" name="note" placeholder="Reason (to reject)…" aria-label="Reason to reject" className={`${inputCls} h-8 w-40`} />
                          <Button size="sm" variant="danger" name="decision" value="reject" confirm="Reject this request? The person is notified.">Reject</Button>
                        </form>
                      </td>
                    )}
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
