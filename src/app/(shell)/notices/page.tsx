import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth.ts";
import { core, registrar } from "@/modules/index.ts";
import { postNoticeAction } from "../../actions.ts";
import { PageHeader, Sheet, Empty, Button, Field, DateBlock, inputCls, areaCls } from "@/components/ui";

export const metadata: Metadata = { title: "Notices" };
const CATEGORIES = ["Academic", "Exam", "Accounts", "Department", "Class", "General"];

export default async function Notices({ searchParams }: PageProps<"/notices">) {
  const s = await requireUser();
  const { category } = await searchParams;
  const cat = typeof category === "string" ? category : undefined;
  const list = await core.noticesFor(s.user.id, s.roles, { category: cat });
  const admin = core.ROLES[s.role].side === "admin";
  return (
    <>
      <PageHeader eyebrow="Campus" title="Notices" meta="Notices for your department, sections and role." />
      <nav aria-label="Filter by category" className="mb-6 flex flex-wrap gap-2">
        {[undefined, ...CATEGORIES].map((c) => (
          <Link key={c ?? "all"} href={c ? `/notices?category=${c}` : "/notices"} aria-current={cat === c ? "true" : undefined}
            className={`rounded-xl px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors duration-200 ${cat === c ? "bg-brand text-on-dark shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]" : "bg-card text-strong shadow-panel hover:bg-muted"}`}>
            {c ?? "All"}
          </Link>
        ))}
      </nav>
      <div className={`grid gap-6 ${admin ? "lg:grid-cols-[1fr_22rem]" : ""}`}>
        <Sheet flush>
          {list.length === 0 ? <Empty title="No notices in this category">Try another category, or check back after the next office announcement.</Empty> : (
            <ul>
              {list.map((n) => (
                <li key={n.id} className="flex gap-4 border-b border-rule px-6 py-5 last:border-0">
                  <DateBlock date={n.at} />
                  <article className="min-w-0 flex-1">
                    <h2 className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-heading">{n.title}</h2>
                    <p className="mt-1 text-[0.75rem] text-meta">
                      <span className="mr-1 rounded-md bg-brand-soft px-1.5 py-0.5 font-medium text-brand">{n.category}</span> · {n.audience === "all" ? "Everyone" : n.audience === "department" ? n.dept : n.audience === "section" ? n.course : `${n.audience_ref}s`} · {n.by_name}
                    </p>
                    <p className="mt-2 max-w-[70ch] text-[0.9375rem] text-strong">{n.body}</p>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
        {admin && (
          <Sheet title="Post a notice" className="self-start">
            <form action={postNoticeAction} className="space-y-4">
              <Field label="Title"><input autoComplete="off" name="title" required className={inputCls} /></Field>
              <Field label="Message"><textarea name="body" required className={areaCls} /></Field>
              <Field label="Category">
                <select name="category" className={inputCls}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
              <Field label="Audience" hint="For a department use its ID below; for a role use its code (e.g. student, teacher).">
                <select name="audience" className={inputCls}>
                  <option value="all">Everyone</option><option value="department">Department</option><option value="role">Role</option>
                </select>
              </Field>
              <Field label="Department or role">
                <select name="audience_ref" className={inputCls}>
                  <option value="">—</option>
                  <optgroup label="Departments">{(await registrar.departments()).map((d) => <option key={d.id} value={d.id}>{d.short}</option>)}</optgroup>
                  <optgroup label="Roles">{Object.entries(core.ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</optgroup>
                </select>
              </Field>
              <Button>Post notice</Button>
            </form>
          </Sheet>
        )}
      </div>
    </>
  );
}
