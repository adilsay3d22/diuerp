import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { requireRole, deptScope } from "@/lib/auth.ts";
import { STAFF } from "@/lib/page.ts";
import { registrar } from "@/modules/index.ts";
import { PageHeader, Sheet, Table, StatusStamp, Button, Empty, Avatar, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Student records" };

export default async function Students({ searchParams }: PageProps<"/admin/students">) {
  const s = await requireRole(...STAFF);
  const q = String((await searchParams).q ?? "").trim();
  const dept = s.role === "dept_head" ? deptScope(s) : null;
  const rows = (await registrar.searchStudents(q)).filter((r) => !dept || r.dept_id === dept);
  return (
    <>
      <PageHeader eyebrow="Student records" title="Student records" meta={dept ? "Students in your department" : "Search any student for a full record: academics, attendance, results and dues."} />
      <form className="relative mb-6 flex max-w-xl gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search students</label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Student ID, name or registration ID…" className={`${inputCls} h-11 shadow-panel`} autoComplete="off" spellCheck={false} />
        <Button className="h-11"><Search aria-hidden size={16} />Search</Button>
      </form>
      <Sheet flush>
        {rows.length === 0 ? <Empty icon={Search} title="No students match">Try part of the ID, e.g. 253-15, or a first name.</Empty> : (
          <Table>
            <thead><tr><th>Student ID</th><th>Name</th><th>Program</th><th>Batch · Section</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/admin/students/${r.id}`} className="num font-medium text-brand hover:underline">{r.student_id}</Link></td>
                  <td><span className="flex items-center gap-2.5"><Avatar name={r.name} size={28} />{r.name}</span></td><td>{r.program}</td><td className="num">{r.batch}_{r.section}</td><td><StatusStamp status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
