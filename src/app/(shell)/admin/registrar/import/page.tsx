import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { importAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Button, Field, inputCls, areaCls } from "@/components/ui";

export const metadata: Metadata = { title: "Bulk import" };

const FORMATS = [
  ["courses", "code,title,credits,dept,type,prereqs", "CSE311,Computer Networks,3,CSE,theory,CSE221;CSE231"],
  ["teachers", "employee_id,name,email,dept,designation,phone,password", "710001400,Rashida Khatun,rashida@diu.edu.bd,CSE,Lecturer,01700000000,changeme1"],
  ["students", "student_id,name,email,program,batch,section,phone,password", "241-15-0100,Arif Hasan,arif@diu.edu.bd,B.Sc. in CSE,41,B,01700000000,changeme1"],
  ["results", "student_id,course,semester,section,total", "241-15-0100,CSE112,241,41_B,78.5"],
];

export default async function Import() {
  await requireRole("registrar");
  return (
    <>
      <PageHeader eyebrow="Registrar's office" title="Bulk import" meta="Move records from the current portal. The whole file is rejected if any row fails, so nothing half-imports." />
      <div className="grid gap-6 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <Sheet title="Upload CSV" className="self-start">
          <form action={importAction} className="space-y-3">
            <Field label="Record type"><select name="kind" className={inputCls}>{FORMATS.map(([k]) => <option key={k} value={k} className="capitalize">{k}</option>)}</select></Field>
            <Field label="CSV file" hint="First row must be the header"><input name="file" type="file" accept=".csv,text/csv" className={`${inputCls} py-1.5`} /></Field>
            <Field label="…or paste CSV"><textarea name="csv" className={`${areaCls} font-mono text-[0.8125rem]`} spellCheck={false} /></Field>
            <Button>Import</Button>
          </form>
        </Sheet>
        <Sheet flush title="Formats">
          <Table>
            <thead><tr><th>Type</th><th>Header</th><th>Example row</th></tr></thead>
            <tbody>
              {FORMATS.map(([k, h, e]) => <tr key={k}><td className="font-semibold capitalize">{k}</td><td className="font-mono text-[0.75rem]">{h}</td><td className="font-mono text-[0.75rem] text-meta">{e}</td></tr>)}
            </tbody>
          </Table>
          <p className="px-6 py-3 text-[0.8125rem] text-meta">Historical results need the student, course and semester to exist first. Use semicolons between multiple prerequisites.</p>
        </Sheet>
      </div>
    </>
  );
}
