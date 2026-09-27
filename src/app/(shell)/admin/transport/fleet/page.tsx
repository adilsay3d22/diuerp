import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { transport } from "@/modules/index.ts";
import { saveBusAction, addCrewAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, StatusStamp, Button, Field, Avatar, inputCls, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Buses & crew" };

export default async function Fleet() {
  await requireRole("transport_officer");
  const buses = await transport.buses();
  const crew = await transport.crew();
  const routes = await transport.routes();
  const drivers = crew.filter((c) => c.kind === "driver");
  const assistants = crew.filter((c) => c.kind === "assistant");
  const busForm = (b?: (typeof buses)[number]) => (
    <form action={saveBusAction} className="grid gap-2 sm:grid-cols-4" key={b?.id ?? "new"}>
      {b && <input type="hidden" name="id" value={b.id} />}
      <Field label="Bus no."><input autoComplete="off" name="number" required defaultValue={b?.number} className={inputCls} spellCheck={false} /></Field>
      <Field label="Registration"><input autoComplete="off" name="registration" required defaultValue={b?.registration} placeholder="Dhaka Metro-Ba 11-2345…" className={inputCls} spellCheck={false} /></Field>
      <Field label="Seats"><input autoComplete="off" name="capacity" type="number" min="1" required defaultValue={b?.capacity} className={inputCls} /></Field>
      <Field label="Status"><select name="status" defaultValue={b?.status ?? "active"} className={inputCls}><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></select></Field>
      <Field label="Route"><select name="route_id" defaultValue={b?.route_id ?? ""} className={inputCls}><option value="">None</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}</select></Field>
      <Field label="Driver"><select name="driver_id" defaultValue={b?.driver_id ?? ""} className={inputCls}><option value="">None</option>{drivers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Assistant"><select name="assistant_id" defaultValue={b?.assistant_id ?? ""} className={inputCls}><option value="">None</option>{assistants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <div />
      <Field label="Fitness expires"><input autoComplete="off" name="fitness_expiry" type="date" defaultValue={b?.fitness_expiry ?? ""} className={inputCls} /></Field>
      <Field label="Insurance expires"><input autoComplete="off" name="insurance_expiry" type="date" defaultValue={b?.insurance_expiry ?? ""} className={inputCls} /></Field>
      <div className="flex items-end"><Button size="sm" variant={b ? "secondary" : "primary"}>{b ? "Save" : "Add bus"}</Button></div>
    </form>
  );
  return (
    <>
      <PageHeader eyebrow="Transport office" title="Buses & crew" meta="Assign each bus a route, driver and assistant. Expiry dates feed the dashboard reminders." />
      <Sheet flush title="Buses" className="mb-6">
        <Table>
          <thead><tr><th>Bus</th><th>Route</th><th className="r">Seats</th><th>Driver · assistant</th><th>Papers</th><th>Status</th></tr></thead>
          <tbody>
            {buses.map((b) => (
              <tr key={b.id}>
                <td><span className="flex items-center gap-3"><span className="num flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-[0.8125rem] font-semibold text-brand">{b.number}</span><span className="text-[0.75rem] text-meta">{b.registration}</span></span></td>
                <td className="num">{b.route ?? "—"}</td><td className="r num">{b.capacity}</td>
                <td className="text-[0.8125rem]">{b.driver ?? "—"} · {b.assistant ?? "—"}</td>
                <td className="text-[0.75rem] text-meta">Fitness {fmtDate(b.fitness_expiry)}<br />Insurance {fmtDate(b.insurance_expiry)}</td>
                <td><StatusStamp status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="space-y-4 border-t border-rule bg-muted/50 px-6 py-5">
          {buses.map((b) => (
            <details key={b.id}><summary className="cursor-pointer text-[0.875rem] font-medium text-brand">Edit bus {b.number}</summary><div className="mt-3">{busForm(b)}</div></details>
          ))}
          <details><summary className="cursor-pointer text-[0.875rem] font-medium text-brand">Add a bus</summary><div className="mt-3">{busForm()}</div></details>
        </div>
      </Sheet>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Sheet flush title="Crew">
          <Table>
            <thead><tr><th>Name</th><th>Role</th><th>Sign-in ID</th><th>Phone</th><th>Licence</th></tr></thead>
            <tbody>
              {crew.map((c) => (
                <tr key={c.id}><td><span className="flex items-center gap-2.5"><Avatar name={c.name} size={28} /><span className="font-medium">{c.name}</span></span></td><td className="capitalize">{c.kind}</td><td className="num">{c.uni_id}</td>
                  <td><a href={`tel:${c.phone}`} className="text-brand hover:underline">{c.phone}</a></td>
                  <td className="text-[0.8125rem]">{c.licence_no ? `${c.licence_no} · until ${fmtDate(c.licence_expiry)}` : "—"}</td></tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
        <Sheet title="Add crew member" className="self-start">
          <form action={addCrewAction} className="space-y-3">
            <Field label="Name"><input autoComplete="off" name="name" required className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role"><select name="kind" className={inputCls}><option value="driver">Driver</option><option value="assistant">Assistant</option></select></Field>
              <Field label="Mobile"><input autoComplete="off" name="phone" type="tel" required className={inputCls} /></Field>
            </div>
            <Field label="Email"><input autoComplete="off" name="email" type="email" required className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Licence no."><input autoComplete="off" name="licence_no" className={inputCls} spellCheck={false} /></Field>
              <Field label="Licence expires"><input autoComplete="off" name="licence_expiry" type="date" className={inputCls} /></Field>
            </div>
            <Button>Add and create login</Button>
          </form>
        </Sheet>
      </div>
    </>
  );
}
