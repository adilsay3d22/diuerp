import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireRole } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { PageHeader, Sheet, Table, Button, inputCls, btn, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Audit log" };

export default async function Audit({ searchParams }: PageProps<"/admin/system/audit">) {
  await requireRole("super_admin");
  const q = await searchParams;
  const entity = String(q.entity ?? "");
  const page = Math.max(0, Number(q.page) || 0);
  const rows = await all<{ id: number; at: string; actor: string | null; action: string; entity: string; entity_id: string; before: string | null; after: string | null }>(
    `SELECT a.*, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE ? = '' OR a.entity = ? ORDER BY a.id DESC LIMIT 100 OFFSET ?`, entity, entity, page * 100);
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from a route handler, not a page
  const exportLink = <a href="/admin/export/audit" className={btn("secondary", "sm")}><Download aria-hidden size={14} />Export CSV</a>;
  const entities = (await all<{ entity: string }>("SELECT DISTINCT entity FROM audit_log ORDER BY entity")).map((e) => e.entity);
  return (
    <>
      <PageHeader eyebrow="System administration" title="Audit log" meta="Who changed what, with values before and after." actions={exportLink} />
      <form className="mb-6 flex max-w-md gap-2">
        <label htmlFor="entity" className="sr-only">Entity</label>
        <select id="entity" name="entity" defaultValue={entity} className={inputCls}><option value="">All records</option>{entities.map((e) => <option key={e}>{e}</option>)}</select>
        <Button variant="secondary">Filter</Button>
      </form>
      <Sheet flush>
        <Table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Before</th><th>After</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num whitespace-nowrap text-[0.8125rem]">{fmtDateTime(r.at)}</td><td className="text-[0.8125rem]">{r.actor ?? "System"}</td>
                <td><span className="num rounded-md bg-brand-soft px-1.5 py-0.5 text-[0.75rem] font-medium text-brand">{r.action}</span></td><td className="num text-[0.8125rem]">{r.entity} #{r.entity_id}</td>
                <td className="max-w-56 truncate font-mono text-[0.75rem] text-meta" title={r.before ?? ""}>{r.before ?? ""}</td>
                <td className="max-w-72 truncate font-mono text-[0.75rem]" title={r.after ?? ""}>{r.after ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="flex justify-between border-t border-rule px-6 py-4 text-[0.8125rem]">
          {page > 0 ? <Link href={`?entity=${entity}&page=${page - 1}`} className="font-medium text-brand hover:underline">Newer</Link> : <span />}
          {rows.length === 100 && <Link href={`?entity=${entity}&page=${page + 1}`} className="font-medium text-brand hover:underline">Older</Link>}
        </div>
      </Sheet>
    </>
  );
}
