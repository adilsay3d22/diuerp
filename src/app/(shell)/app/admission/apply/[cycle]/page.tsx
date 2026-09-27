import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth.ts";
import { get } from "@/lib/db.ts";
import { admission } from "@/modules/index.ts";
import { saveApplicationAction } from "../../../../../actions.ts";
import { PageHeader, Sheet, Button, Field, Crest, inputCls, fmtDate, taka } from "@/components/ui";

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <span className="flex items-center gap-2.5"><span className="num flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[0.75rem] font-semibold text-on-dark">{n}</span>{children}</span>
);
import { num } from "@/lib/db.ts";

export const metadata: Metadata = { title: "Application form" };

const BASE: [string, string, string][] = [
  ["nid", "NID or birth registration number", "text"], ["dob", "Date of birth", "date"], ["ssc_gpa", "SSC GPA", "number"],
  ["hsc_gpa", "HSC GPA", "number"], ["guardian", "Guardian's name and phone", "text"], ["address", "Present address", "text"],
];

export default async function ApplyForm({ params }: PageProps<"/app/admission/apply/[cycle]">) {
  const s = await requireRole("applicant");
  const c = await admission.cycle(Number((await params).cycle));
  if (!c) notFound();
  const ex = await get<{ id: number; status: string; program_id: number; data_json: string }>("SELECT id, status, program_id, data_json FROM applications WHERE user_id = ? AND cycle_id = ?", s.user.id, c.id);
  if (ex && ex.status !== "draft") redirect(`/app/admission/${ex.id}`);
  const data = JSON.parse(ex?.data_json ?? "{}") as Record<string, string>;
  const docNames = JSON.parse(c.docs_json) as string[];
  const custom = JSON.parse(c.fields_json) as string[];
  const uploaded = ex ? await admission.docs(ex.id) : [];
  const programs = await admission.cyclePrograms(c.id);

  return (
    <>
      <PageHeader eyebrow="Admission" title={c.name} meta={`Intake ${c.intake} · closes ${fmtDate(c.deadline)} · application fee ${taka(await num("application_fee", 1200))}`} />
      <form action={saveApplicationAction} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
        <input type="hidden" name="cycle_id" value={c.id} />
        <Sheet title={<Step n={1}>Program</Step>}>
          <Field label="Program you are applying for">
            <select name="program_id" defaultValue={ex?.program_id} className={inputCls}>
              {programs.map((p) => <option key={p.program_id} value={p.program_id}>{p.name} · {p.seats} seats</option>)}
            </select>
          </Field>
        </Sheet>
        <Sheet title={<Step n={2}>Your details</Step>}>
          <div className="grid gap-4 sm:grid-cols-2">
            {BASE.map(([k, label, type]) => (
              <Field key={k} label={label} className={k === "address" || k === "guardian" ? "sm:col-span-2" : ""}>
                <input autoComplete="off" name={`d_${k}`} type={type} step={type === "number" ? "0.01" : undefined} min={type === "number" ? "1" : undefined} max={type === "number" ? "5" : undefined}
                  defaultValue={data[k] ?? ""} className={inputCls} />
              </Field>
            ))}
            {custom.map((k) => (
              <Field key={k} label={k} className="sm:col-span-2"><input autoComplete="off" name={`d_${k}`} defaultValue={data[k] ?? ""} className={inputCls} /></Field>
            ))}
          </div>
        </Sheet>
        <Sheet title={<Step n={3}>Documents</Step>} sub="PDF or photo, up to 4 MB each">
          <div className="space-y-4">
            {docNames.map((d, i) => {
              const u = uploaded.find((x) => x.name === d);
              return (
                <Field key={d} label={d} hint={u ? `Uploaded: ${u.file_name}. Choose a file to replace it.` : undefined}>
                  <input name={`doc_${i}`} type="file" accept=".pdf,.png,.jpg,.jpeg" className={`${inputCls} py-1.5`} />
                </Field>
              );
            })}
          </div>
        </Sheet>
        </div>
        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <div className="relative overflow-hidden rounded-[1.75rem] bg-brand-deep p-6 text-on-dark">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.65),transparent_65%)]" />
            <Crest size={44} className="relative" />
            <p className="relative mt-4 text-[1.0625rem] font-semibold tracking-[-0.02em]">Ready to submit?</p>
            <ul className="relative mt-3 space-y-1.5 text-[0.8125rem] text-on-dark-muted">
              <li>Program chosen</li><li>{BASE.length + custom.length} details filled in</li><li>{docNames.length} documents attached</li>
            </ul>
            <div className="relative mt-5 flex flex-col gap-2">
              <Button name="intent" value="submit" className="w-full">Submit application</Button>
              <Button name="intent" value="draft" variant="ghost" formNoValidate className="w-full text-on-dark hover:bg-white/10">Save draft</Button>
            </div>
          </div>
          <p className="px-1 text-[0.8125rem] text-meta">After submitting, pay the application fee online or at the Accounts counter. Review starts once it is paid.</p>
        </aside>
      </form>
    </>
  );
}
