import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { registrar } from "@/modules/index.ts";
import { addCourseAction, addProgramAction, addDepartmentAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Table, Button, Field, Tabs, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Programs & courses" };

export default async function Catalogue({ searchParams }: PageProps<"/admin/registrar/catalogue">) {
  await requireRole("registrar");
  const tab = (await searchParams).tab === "programs" ? "programs" : "courses";
  const depts = await registrar.departments();
  return (
    <>
      <PageHeader eyebrow="Registrar's office" title="Programs & courses" meta="Master data every module reads. Changes are audited." />
      <Tabs tabs={[{ href: "?tab=courses", label: "Courses", active: tab === "courses" }, { href: "?tab=programs", label: "Departments & programs", active: tab === "programs" }]} />
      {tab === "courses" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Sheet flush>
            <Table>
              <thead><tr><th>Code</th><th>Title</th><th className="r">Credits</th><th>Type</th><th>Dept.</th><th>Prerequisites</th></tr></thead>
              <tbody>
                {(await registrar.courses()).map((c) => (
                  <tr key={c.id}><td className="num font-medium text-brand">{c.code}</td><td>{c.title}</td><td className="r num">{c.credits}</td><td className="capitalize">{c.type}</td><td>{c.dept}</td><td className="text-meta">{c.prereqs ?? "—"}</td></tr>
                ))}
              </tbody>
            </Table>
          </Sheet>
          <Sheet title="Add course" className="self-start">
            <form action={addCourseAction} className="space-y-3">
              <Field label="Department"><select name="dept_id" className={inputCls}>{depts.map((d) => <option key={d.id} value={d.id}>{d.short}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code"><input autoComplete="off" name="code" required className={inputCls} placeholder="CSE311…" spellCheck={false} /></Field>
                <Field label="Credits"><input autoComplete="off" name="credits" type="number" step="0.5" min="0.5" required className={inputCls} /></Field>
              </div>
              <Field label="Title"><input autoComplete="off" name="title" required className={inputCls} /></Field>
              <Field label="Type"><select name="type" className={inputCls}><option value="theory">Theory</option><option value="lab">Lab</option></select></Field>
              <Field label="Prerequisites" hint="Course codes separated by commas"><input autoComplete="off" name="prereqs" className={inputCls} placeholder="CSE221, CSE231…" /></Field>
              <Button>Add course</Button>
            </form>
          </Sheet>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <Sheet flush title="Departments">
              <Table>
                <thead><tr><th>Code</th><th>Short</th><th>Name</th><th>Faculty</th><th>Head</th></tr></thead>
                <tbody>{depts.map((d) => <tr key={d.id}><td className="num">{d.code}</td><td className="font-semibold">{d.short}</td><td>{d.name}</td><td>{d.faculty}</td><td>{d.head ?? "—"}</td></tr>)}</tbody>
              </Table>
            </Sheet>
            <Sheet flush title="Programs">
              <Table>
                <thead><tr><th>Program</th><th>Degree</th><th>Dept.</th><th className="r">Credits to graduate</th></tr></thead>
                <tbody>{(await registrar.programs()).map((p) => <tr key={p.id}><td className="font-semibold">{p.name}</td><td>{p.degree}</td><td>{p.dept}</td><td className="r num">{p.total_credits}</td></tr>)}</tbody>
              </Table>
            </Sheet>
          </div>
          <div className="space-y-6">
            <Sheet title="Add program">
              <form action={addProgramAction} className="space-y-3">
                <Field label="Department"><select name="dept_id" className={inputCls}>{depts.map((d) => <option key={d.id} value={d.id}>{d.short}</option>)}</select></Field>
                <Field label="Name"><input autoComplete="off" name="name" required className={inputCls} placeholder="B.Sc. in EEE…" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Degree"><input autoComplete="off" name="degree" defaultValue="B.Sc." className={inputCls} /></Field>
                  <Field label="Total credits"><input autoComplete="off" name="total_credits" type="number" min="1" required className={inputCls} /></Field>
                </div>
                <Button>Add program</Button>
              </form>
            </Sheet>
            <Sheet title="Add department">
              <form action={addDepartmentAction} className="space-y-3">
                <Field label="Faculty"><select name="faculty_id" className={inputCls}>{(await all<{ id: number; code: string }>("SELECT id, code FROM faculties")).map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}</select></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="ID code" hint="Used in student IDs"><input autoComplete="off" name="code" required className={inputCls} placeholder="33…" spellCheck={false} /></Field>
                  <Field label="Short name"><input autoComplete="off" name="short" required className={inputCls} placeholder="EEE…" /></Field>
                </div>
                <Field label="Full name"><input autoComplete="off" name="name" required className={inputCls} /></Field>
                <Button variant="secondary">Add department</Button>
              </form>
            </Sheet>
          </div>
        </div>
      )}
    </>
  );
}
