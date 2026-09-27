import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { registrar, finance } from "@/modules/index.ts";
import * as A from "../../../../actions.ts";
import { BadgePercent } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Button, Field, Empty, Tabs, Note, inputCls, areaCls, fmtDate, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Waivers & scholarships" };

// FIN-A-7 (automatic result-based waivers) and FIN-U-7 (scholarship circulars and applications).
export default async function Waivers({ searchParams }: PageProps<"/admin/accounts/waivers">) {
  const s = await requireRole("accounts_officer", "finance_head");
  const tab = String((await searchParams).tab ?? "rules");
  const tabs = [["rules", "Automatic waivers"], ["scholarships", "Scholarships"], ["granted", "Granted this year"]].map(([k, l]) => ({ href: `?tab=${k}`, label: l, active: tab === k }));
  return (
    <>
      <PageHeader eyebrow="Accounts office" title="Waivers & scholarships" meta="Automatic waivers apply to the next semester's tuition when results publish. Manual waivers go through Approvals." />
      <Tabs tabs={tabs} />
      {tab === "rules" && <Rules canEdit={s.role === "finance_head"} />}
      {tab === "scholarships" && <Scholarships />}
      {tab === "granted" && <Granted />}
    </>
  );
}

async function Rules({ canEdit }: { canEdit: boolean }) {
  const rules = await finance.rules();
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Sheet flush>
        {rules.length === 0 ? <Empty title="No rules yet" /> : (
          <Table>
            <thead><tr><th>Rule</th><th className="r">Min SGPA</th><th className="r">Min credits</th><th className="r">Waiver</th><th>Status</th></tr></thead>
            <tbody>{rules.map((r) => <tr key={r.id}><td className="font-medium"><span className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand"><BadgePercent aria-hidden size={14} strokeWidth={1.75} /></span>{r.name}</span></td><td className="r num">{r.min_sgpa.toFixed(2)}</td><td className="r num">{r.min_credits}</td><td className="r num">{r.percent}%</td><td>{r.active ? <Stamp tone="ok">Active</Stamp> : <Stamp tone="neutral">Off</Stamp>}</td></tr>)}</tbody>
          </Table>
        )}
        <p className="px-6 py-4 text-[0.8125rem] text-meta">The highest rule a student qualifies for applies; each student gets at most one result-based waiver per semester.</p>
      </Sheet>
      {canEdit ? (
        <Sheet title="Add a rule" className="self-start">
          <form action={A.saveRuleAction} className="space-y-3">
            <Field label="Name"><input autoComplete="off" name="name" required className={inputCls} placeholder="Dean’s list…" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Min SGPA"><input autoComplete="off" name="min_sgpa" type="number" step="0.01" min="0" max="4" required className={inputCls} /></Field>
              <Field label="Min credits"><input autoComplete="off" name="min_credits" type="number" step="0.5" min="0" defaultValue={12} className={inputCls} /></Field>
              <Field label="Waiver %"><input autoComplete="off" name="percent" type="number" min="1" max="100" required className={inputCls} /></Field>
            </div>
            <Button>Save rule</Button>
          </form>
        </Sheet>
      ) : <Note tone="info" className="self-start">Only the Finance Head edits waiver rules.</Note>}
    </div>
  );
}

async function Scholarships() {
  const list = await finance.circulars();
  const apps = await finance.scholarshipApps();
  const pending = apps.filter((a) => a.status === "submitted");
  return (
    <div className="space-y-6">
      <Sheet title={`Applications to review · ${pending.length}`} flush>
        {pending.length === 0 ? <Empty title="No applications waiting" /> : (
          <Table>
            <thead><tr><th>Student</th><th>Scholarship</th><th>Statement</th><th>Decision</th></tr></thead>
            <tbody>
              {pending.map((a) => (
                <tr key={a.id}>
                  <td>{a.student} <span className="num text-[0.75rem] text-meta">{a.student_code}</span></td><td>{a.title} <span className="text-meta">· {a.percent}%</span></td>
                  <td className="max-w-md text-[0.8125rem]">{a.statement}{a.file_id && <a href={`/files/${a.file_id}`} className="block text-brand hover:underline">Document</a>}</td>
                  <td>
                    <form action={A.decideScholarshipAction} className="flex flex-wrap gap-1.5">
                      <input type="hidden" name="id" value={a.id} />
                      <Button size="sm" name="decision" value="award">Award</Button>
                      <input autoComplete="off" name="note" placeholder="Reason (to reject)…" aria-label="Reason" className={`${inputCls} h-8 w-36`} />
                      <Button size="sm" variant="danger" name="decision" value="reject" confirm="Reject this request? The person is notified.">Reject</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Sheet title="Circulars" flush>
          {list.length === 0 ? <Empty title="No circulars published" /> : (
            <Table>
              <thead><tr><th>Circular</th><th>For</th><th className="r">Waiver</th><th>Deadline</th><th className="r">Applied</th></tr></thead>
              <tbody>{list.map((c) => <tr key={c.id}><td className="font-medium">{c.title}</td><td>{c.semester}</td><td className="r num">{c.percent}%</td><td>{fmtDate(c.deadline)}</td><td className="r num">{c.applied}</td></tr>)}</tbody>
            </Table>
          )}
        </Sheet>
        <Sheet title="Publish a circular" className="self-start">
          <form action={A.createCircularAction} className="space-y-3">
            <Field label="Title"><input autoComplete="off" name="title" required className={inputCls} placeholder="Need-based scholarship, Spring 2027…" /></Field>
            <Field label="Eligibility and details"><textarea name="body" required className={areaCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Applies to"><select name="semester_id" className={inputCls}>{(await registrar.semesters()).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
              <Field label="Waiver %"><input autoComplete="off" name="percent" type="number" min="1" max="100" required className={inputCls} /></Field>
            </div>
            <Field label="Deadline"><input autoComplete="off" name="deadline" type="date" required className={inputCls} /></Field>
            <Button>Publish and notify students</Button>
          </form>
        </Sheet>
      </div>
    </div>
  );
}

async function Granted() {
  const rows = await all<{ student_id: number; student_code: string; name: string; semester: string; source: string; percent: number; detail: string; at: string }>(
    `SELECT g.student_id, s.student_id AS student_code, u.name, sm.name AS semester, g.source, g.percent, g.detail, g.at FROM waiver_grants g
     JOIN students s ON s.id = g.student_id JOIN users u ON u.id = s.user_id JOIN semesters sm ON sm.id = g.semester_id ORDER BY g.id DESC LIMIT 200`);
  return (
    <Sheet flush>
      {rows.length === 0 ? <Empty title="No automatic or scholarship waivers yet" /> : (
        <Table>
          <thead><tr><th>Student</th><th>Semester</th><th>Waiver</th><th className="r">Rate</th><th>Granted</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td><Link href={`/admin/students/${r.student_id}`} className="text-brand hover:underline">{r.name}</Link> <span className="num text-[0.75rem] text-meta">{r.student_code}</span></td><td>{r.semester}</td><td>{r.detail}</td><td className="r num">{r.percent}%</td><td className="text-[0.8125rem]">{fmtDateTime(r.at)}</td></tr>)}</tbody>
        </Table>
      )}
    </Sheet>
  );
}
