import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { setting } from "@/lib/db.ts";
import { SCALE } from "@/lib/rules.ts";
import { core } from "@/modules/index.ts";
import { setSettingsAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Button, Field, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Academic rules" };

export default async function Settings() {
  await requireRole("super_admin");
  return (
    <>
      <PageHeader eyebrow="System administration" title="Academic rules" meta="Every module reads these values. Changes are audited." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Sheet title="Rules" sub="Credit limits, attendance, fees and deadlines">
          <form action={setSettingsAction} className="grid gap-4 sm:grid-cols-2">
            {await Promise.all(core.SETTINGS.map(async (s) => (
              <Field key={s.key} label={s.label}><input autoComplete="off" name={s.key} type="number" min="0" step="1" required defaultValue={await setting(s.key, s.def)} className={inputCls} /></Field>
            )))}
            <div className="sm:col-span-2"><Button>Save rules</Button></div>
          </form>
        </Sheet>
        <Sheet title="Grading scale" flush className="self-start">
          <Table>
            <thead><tr><th>From</th><th>Grade</th><th className="r">Point</th></tr></thead>
            <tbody>{SCALE.map(([m, l, g]) => <tr key={l}><td className="num">{m}</td><td className="num font-semibold text-heading">{l}</td><td className="r num">{g.toFixed(2)}</td></tr>)}</tbody>
          </Table>
          <p className="px-6 py-3 text-[0.75rem] text-meta">UGC uniform scale. Changing it needs an Academic Council decision; ask the development team.</p>
        </Sheet>
      </div>
    </>
  );
}
