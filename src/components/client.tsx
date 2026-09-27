"use client";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentProps } from "react";
import { CircleCheck, CircleAlert, X } from "lucide-react";
import { btn } from "./ui";

export function RoleSwitcher({ roles, active, action }: { roles: { value: string; label: string }[]; active: string; action: (fd: FormData) => void }) {
  if (roles.length < 2) return <span className="hidden rounded-lg bg-brand-soft px-2.5 py-1 text-[0.75rem] font-medium text-brand sm:inline">{roles[0]?.label}</span>;
  return (
    <form action={action}>
      <label className="sr-only" htmlFor="role">Active role</label>
      <select id="role" name="role" defaultValue={active} onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-10 rounded-xl border border-rule bg-card pl-3 pr-8 text-[0.8125rem] font-medium text-ink shadow-[0_1px_2px_rgb(10_22_40/0.04)] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <noscript><button className={btn("secondary", "sm")}>Switch</button></noscript>
    </form>
  );
}

export function Flash() {
  const q = useSearchParams();
  const path = usePathname();
  const ok = q.get("ok");
  const err = q.get("err");
  const [hidden, setHidden] = useState<string | null>(null);
  const key = ok ?? err;
  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => setHidden(ok), 6000);
    return () => clearTimeout(t);
  }, [ok]);
  if (!key || hidden === key) return null;
  const close = () => {
    setHidden(key);
    const u = new URLSearchParams(q);
    u.delete("ok");
    u.delete("err");
    window.history.replaceState(null, "", `${path}${u.size ? `?${u}` : ""}`);
  };
  return (
    <div role={err ? "alert" : "status"}
      className="pop-in mb-6 flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5 text-[0.875rem] shadow-lift">
      <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${err ? "bg-tint-red text-danger" : "bg-tint-green text-success"}`}>{err ? <CircleAlert size={17} strokeWidth={1.75} /> : <CircleCheck size={17} strokeWidth={1.75} />}</span>
      <p className="flex-1 font-medium text-ink">{key}</p>
      <button type="button" onClick={close} aria-label="Dismiss" className="-m-1 rounded-lg p-1.5 text-meta hover:bg-muted hover:text-ink"><X aria-hidden size={16} /></button>
    </div>
  );
}

// For irreversible actions: publish, submit and lock, approve.
export function ConfirmButton({ message, className, ...p }: ComponentProps<"button"> & { message: string }) {
  return <button {...p} className={className} onClick={(e) => { if (!confirm(message)) e.preventDefault(); }} />;
}

// Attendance: mark everyone in one tap, then flip individual rows.
export function MarkAll({ status, label }: { status: string; label: string }) {
  return (
    <button type="button" className={btn("secondary", "sm")}
      onClick={(e) => e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=radio][value=${status}]`).forEach((r) => (r.checked = true))}>
      {label}
    </button>
  );
}

// Dropdown that navigates on change (e.g. ?sem=). Works without JavaScript through the Show button.
export function SelectNav({ name, value, options, label }: { name: string; value: string; options: { value: string; label: string }[]; label: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <form action={path} className="flex items-center gap-2">
      <label htmlFor={`nav-${name}`} className="text-[0.8125rem] font-medium text-strong">{label}</label>
      <select id={`nav-${name}`} name={name} defaultValue={value} onChange={(e) => router.push(`${path}?${name}=${e.currentTarget.value}`)}
        className="h-10 rounded-xl border border-field bg-card pl-3 pr-8 text-[0.875rem] font-medium text-ink shadow-[0_1px_2px_rgb(10_22_40/0.04)] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <noscript><button className={btn("secondary", "sm")}>Show</button></noscript>
    </form>
  );
}

export type SectionOption = {
  id: number; section: string; letter: string; left: number; capacity: number; schedule: string;
  teacher: string | null; designation: string | null; email: string | null; clash: string | null; mine: boolean;
};
// Section dropdown with seats left; the chosen section's schedule and faculty show underneath.
export function SectionPicker({ name, options, initial, label }: { name: string; options: SectionOption[]; initial: number; label: string }) {
  const [id, setId] = useState(initial);
  const o = options.find((x) => x.id === id) ?? options[0];
  const text = (x: SectionOption) =>
    `Section ${x.letter}${x.mine ? " (your section)" : ""} · ${x.clash ? "time clash" : x.left > 0 ? `${x.left} of ${x.capacity} seats left` : "full, joins waitlist"}`;
  return (
    <div>
      <label htmlFor={`${name}-${options[0]?.id}`} className="mb-2 block text-[0.8125rem] font-medium text-strong">{label}</label>
      <select id={`${name}-${options[0]?.id}`} name={name} value={id} onChange={(e) => setId(Number(e.currentTarget.value))} required
        className="h-10 w-full rounded-xl border border-field bg-card px-3.5 text-[0.875rem] text-ink shadow-[0_1px_2px_rgb(10_22_40/0.04)] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15">
        {options.map((x) => <option key={x.id} value={x.id} disabled={!!x.clash}>{text(x)}</option>)}
      </select>
      {o && (
        <div className="mt-2 rounded-2xl border border-rule bg-muted px-4 py-3 text-[0.8125rem]" aria-live="polite">
          <p className="flex flex-wrap justify-between gap-2">
            <span className="font-medium text-ink">Section {o.letter} <span className="font-normal text-meta">({o.section})</span></span>
            <span className={`num ${o.left <= 0 ? "text-danger" : o.left <= 5 ? "text-warning-ink" : "text-success"}`}>{o.left > 0 ? `${o.left} of ${o.capacity} seats left` : "Full: you would join the waitlist"}</span>
          </p>
          <p className="mt-1 text-meta">{o.schedule || "Schedule to be announced"}</p>
          <p className="mt-1">
            {o.teacher ? <>{o.teacher}{o.designation && <span className="text-meta"> · {o.designation}</span>}{o.email && <> · <a href={`mailto:${o.email}`} className="text-brand hover:underline">{o.email}</a></>}</> : <span className="text-meta">Faculty to be announced</span>}
          </p>
          {o.clash && <p className="text-danger">{o.clash}</p>}
        </div>
      )}
    </div>
  );
}
