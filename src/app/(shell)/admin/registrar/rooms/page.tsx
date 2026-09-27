import type { Metadata } from "next";
import { Check } from "lucide-react";
import { requireRole } from "@/lib/auth.ts";
import { registrar } from "@/modules/index.ts";
import { addRoomAction, addSlotAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Button, Field, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Rooms & time slots" };

export default async function Rooms() {
  await requireRole("registrar");
  const slots = await registrar.timeSlots();
  const times = [...new Set(slots.map((s) => `${s.start}–${s.end}`))].sort();
  return (
    <>
      <PageHeader eyebrow="Registrar's office" title="Rooms & time slots" meta="Used for offering schedules and clash detection." />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Sheet flush title="Rooms">
            <Table>
              <thead><tr><th>Room</th><th>Type</th><th className="r">Capacity</th></tr></thead>
              <tbody>{(await registrar.rooms()).map((r) => <tr key={r.id}><td className="num font-medium">{r.number}</td><td className="capitalize">{r.type}</td><td className="r num">{r.capacity}</td></tr>)}</tbody>
            </Table>
          </Sheet>
          <Sheet title="Add room">
            <form action={addRoomAction} className="grid gap-3 sm:grid-cols-4">
              <Field label="Room number" className="sm:col-span-2"><input autoComplete="off" name="number" required className={inputCls} placeholder="AB4-801…" spellCheck={false} /></Field>
              <Field label="Type"><select name="type" className={inputCls}><option value="theory">Theory</option><option value="lab">Lab</option></select></Field>
              <Field label="Capacity"><input autoComplete="off" name="capacity" type="number" min="1" required className={inputCls} /></Field>
              <div><Button>Add room</Button></div>
            </form>
          </Sheet>
        </div>
        <div className="space-y-6">
          <Sheet flush title="Weekly time slots">
            <Table>
              <thead><tr><th>Time</th>{registrar.DAYS.map((d) => <th key={d} className="text-center">{d}</th>)}</tr></thead>
              <tbody>
                {times.map((t) => (
                  <tr key={t}><td className="num font-semibold">{t}</td>
                    {registrar.DAYS.map((d) => <td key={d} className="text-center">{slots.some((s) => s.day === d && `${s.start}–${s.end}` === t) ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-brand-soft text-brand"><Check aria-label="available" size={14} strokeWidth={2.5} /></span> : <span className="text-meta">–</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Sheet>
          <Sheet title="Add time slot">
            <form action={addSlotAction} className="grid gap-3 sm:grid-cols-4">
              <Field label="Day"><select name="day" className={inputCls}>{registrar.DAYS.map((d) => <option key={d}>{d}</option>)}</select></Field>
              <Field label="Start"><input autoComplete="off" name="start" type="time" required className={inputCls} /></Field>
              <Field label="End"><input autoComplete="off" name="end" type="time" required className={inputCls} /></Field>
              <div className="flex items-end"><Button>Add</Button></div>
            </form>
          </Sheet>
        </div>
      </div>
    </>
  );
}
