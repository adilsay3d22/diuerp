import Link from "next/link";
import Image from "next/image";
import type { ComponentProps, ReactNode } from "react";
import { Check, X, Clock, Info, Minus, ArrowUpRight, type LucideIcon } from "lucide-react";
import { btn, type BtnVariant, type BtnSize } from "./btn";

export { btn };

// ---------- Brand

// The DIU crest. `size` is the rendered square in px.
export function Crest({ size = 36, className = "" }: { size?: number; className?: string }) {
  return <Image src="/brand/diu-crest.png" alt="" width={size} height={size} className={`shrink-0 ${className}`} priority />;
}
// Full "Daffodil International University" wordmark with crest, for light backgrounds and printed documents.
export function Wordmark({ height = 40, className = "" }: { height?: number; className?: string }) {
  return <Image src="/brand/diu-wordmark.png" alt="Daffodil International University" width={Math.round(height * 3.77)} height={height} className={`h-auto ${className}`} priority />;
}
// Header band for printable documents: wordmark left, document title right.
export function DocHeader({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-brand pb-4">
      <Wordmark height={44} />
      <div className="text-right">
        <p className="eyebrow text-brand">Office document</p>
        <p className="mt-1 text-[1.125rem] font-semibold tracking-[-0.02em] text-heading">{title}</p>
        {sub && <p className="text-[0.8125rem] text-meta">{sub}</p>}
      </div>
    </header>
  );
}

// ---------- Page structure

export function PageHeader({ title, meta, actions, eyebrow }: { title: string; meta?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-3 flex items-center gap-2 text-brand"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-green" />{eyebrow}</p>}
        <h1 className="text-[1.875rem] font-semibold leading-[1.05] tracking-[-0.04em] text-heading md:text-[2.25rem]">{title}</h1>
        {meta && <p className="mt-2.5 max-w-[65ch] text-[0.9375rem] leading-relaxed text-meta">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Sheet({ title, actions, children, flush, className = "", id, sub }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string; id?: string; sub?: ReactNode;
}) {
  return (
    <section id={id} className={`overflow-hidden rounded-[1.75rem] bg-card shadow-panel ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-6 pb-3 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-heading">{title}</h2>}
            {sub && <p className="mt-0.5 text-[0.8125rem] text-meta">{sub}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "pb-1" : "px-6 pb-6 pt-1"}>{children}</div>
    </section>
  );
}

// Asymmetric KPI band. First tile is wide; collapses to one column on phones.
export function Bento({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section aria-label="At a glance" className={`mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr_1fr] ${className}`}>{children}</section>;
}

// KPI tile. `dark` is the brand hero tile; `href` makes the whole tile a link.
export function Stat({ label, value, sub, tone, href, dark, icon: Icon, className = "" }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "danger" | "success" | "warning"; href?: string; dark?: boolean; icon?: LucideIcon; className?: string;
}) {
  const color = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "warning" ? "text-warning-ink" : dark ? "text-on-dark" : "text-heading";
  const body = (
    <>
      {dark && <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.55),transparent_65%)]" />}
      <span className={`relative flex items-center justify-between gap-2 text-[0.8125rem] ${dark ? "text-on-dark-muted" : "text-meta"}`}>
        <span className="flex items-center gap-2">{Icon && <Icon aria-hidden size={15} strokeWidth={1.75} className={dark ? "text-brand-green" : "text-brand"} />}{label}</span>
        {href && <ArrowUpRight aria-hidden size={16} strokeWidth={1.75} className="transition-transform duration-300 ease-(--ease-out-expo) group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
      </span>
      <span className={`num relative mt-auto block pt-5 text-[2rem] font-medium leading-none tracking-[-0.05em] ${color}`}>{value}</span>
      {sub && <span className={`relative mt-2 block text-[0.8125rem] ${dark ? "text-on-dark-muted" : "text-meta"}`}>{sub}</span>}
    </>
  );
  const cls = `group relative flex min-h-36 flex-col overflow-hidden rounded-[1.75rem] p-6 ${dark ? "bg-brand-deep text-on-dark" : "bg-card shadow-panel"} ${href ? "transition-transform duration-300 ease-(--ease-out-expo) hover:-translate-y-0.5" : ""} ${className}`;
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto"><table className="register">{children}</table></div>
);

// Initials badge in the brand blue.
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.replace(/^(Dr\.|Prof\.)\s*/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span aria-hidden style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="inline-flex shrink-0 items-center justify-center rounded-[30%] bg-gradient-to-br from-brand to-brand-deep font-semibold text-on-dark shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]">
      {initials}
    </span>
  );
}

// ---------- Status

type Tone = "ok" | "bad" | "wait" | "info" | "neutral";
const TONES: Record<Tone, { cls: string; icon: LucideIcon }> = {
  ok: { cls: "bg-tint-green text-success ring-success/15", icon: Check },
  bad: { cls: "bg-tint-red text-danger ring-danger/15", icon: X },
  wait: { cls: "bg-tint-amber text-warning-ink ring-warning/20", icon: Clock },
  info: { cls: "bg-tint-blue text-info ring-info/15", icon: Info },
  neutral: { cls: "bg-muted text-meta ring-meta/15", icon: Minus },
};
// Status pill: colour is always paired with an icon and a word (spec §12a).
export function Stamp({ tone, children, big }: { tone: Tone; children: ReactNode; big?: boolean }) {
  const { cls, icon: Icon } = TONES[tone];
  return big ? (
    <span className={`pop-in inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[0.9375rem] font-semibold ring-1 ring-inset ${cls}`}>
      <Icon aria-hidden size={17} strokeWidth={2.25} />{children}
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[0.75rem] font-medium ring-1 ring-inset ${cls}`}>
      <Icon aria-hidden size={12} strokeWidth={2.25} />{children}
    </span>
  );
}

const STATUS: Record<string, [Tone, string]> = {
  paid: ["ok", "Paid"], partial: ["wait", "Partial"], unpaid: ["neutral", "Unpaid"], overdue: ["bad", "Overdue"],
  confirmed: ["ok", "Registered"], waitlisted: ["wait", "Waitlisted"], dropped: ["neutral", "Dropped"], completed: ["ok", "Completed"],
  draft: ["neutral", "Draft"], returned: ["bad", "Returned"], submitted: ["wait", "Submitted"], "dept-approved": ["info", "Dept. approved"],
  published: ["ok", "Published"], pending: ["wait", "Pending"], approved: ["ok", "Approved"], rejected: ["bad", "Rejected"],
  active: ["ok", "Active"], closed: ["neutral", "Closed"], upcoming: ["info", "Upcoming"], present: ["ok", "Present"], absent: ["bad", "Absent"],
  late: ["wait", "Late"], cleared: ["ok", "Cleared"], delayed: ["wait", "Delayed"], cancelled: ["bad", "Cancelled"], maintenance: ["wait", "Maintenance"], retired: ["neutral", "Retired"], blocked: ["bad", "Blocked"], "on-leave": ["wait", "On leave"], graduated: ["info", "Graduated"],
};
export function StatusStamp({ status, big }: { status: string; big?: boolean }) {
  const [tone, label] = STATUS[status] ?? ["neutral", status.replaceAll("_", " ")];
  return <Stamp tone={tone} big={big}>{label}</Stamp>;
}

// Inline notice box for forms and pages (error, success, info, warning).
export function Note({ tone = "info", children, className = "" }: { tone?: "info" | "ok" | "bad" | "wait"; children: ReactNode; className?: string }) {
  const { cls, icon: Icon } = TONES[tone];
  return (
    <div role={tone === "bad" ? "alert" : undefined} className={`flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[0.875rem] ring-1 ring-inset ${cls} ${className}`}>
      <Icon aria-hidden size={16} strokeWidth={2} className="mt-0.5 shrink-0" /><div className="min-w-0 flex-1 text-ink">{children}</div>
    </div>
  );
}

// ---------- Controls

export { Button } from "./button";

export function LinkButton({ variant = "secondary", size = "md", className = "", ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: BtnSize }) {
  return <Link {...p} className={`${btn(variant, size)} ${className}`} />;
}

export const inputCls = "h-10 w-full rounded-xl border border-field bg-card px-3.5 text-[0.875rem] text-ink shadow-[0_1px_2px_rgb(10_22_40/0.04)] placeholder:text-meta/70 transition-[border-color,box-shadow] duration-200 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:bg-muted disabled:text-meta aria-[invalid=true]:border-danger";
export const areaCls = inputCls.replace("h-10", "min-h-24 py-2.5");

// Label above input, optional helper and error text below (gap-2 rhythm).
export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-2 ${className}`}>
      <span className="text-[0.8125rem] font-medium text-strong">{label}</span>
      {children}
      {hint && !error && <span className="text-[0.75rem] text-meta">{hint}</span>}
      {error && <span className="text-[0.75rem] font-medium text-danger">{error}</span>}
    </label>
  );
}

export const taka = (v: number) => `৳${Math.abs(v).toLocaleString("en-IN")}`;
export function Money({ v, signed }: { v: number; signed?: boolean }) {
  return <span className="num whitespace-nowrap">{v < 0 ? "−" : signed && v > 0 ? "+" : ""}{taka(v)}</span>;
}

export function Empty({ title, children, icon: Icon }: { title: string; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span aria-hidden className="relative mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-inset ring-brand/10">
        {Icon ? <Icon size={20} strokeWidth={1.75} /> : <span className="h-2 w-2 rounded-full bg-brand" />}
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand-green ring-2 ring-card" />
      </span>
      <p className="font-medium tracking-[-0.01em] text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-[0.875rem] leading-relaxed text-meta">{children}</div>}
    </div>
  );
}

// Section tabs: white rail, active tab is a brand pill.
export function Tabs({ tabs }: { tabs: { href: string; label: string; active: boolean; count?: number }[] }) {
  return (
    <nav aria-label="Sections" className="mb-6 max-w-full overflow-x-auto pb-1">
      <div className="inline-flex gap-1 rounded-2xl bg-card p-1 shadow-panel">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}
            className={`whitespace-nowrap rounded-xl px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors duration-200 ${t.active ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>
            {t.label}{t.count ? <span className={`num ml-1.5 rounded-md px-1.5 text-[0.6875rem] ${t.active ? "bg-white/20 text-on-dark" : "bg-brand-soft text-brand"}`}>{t.count}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}

// Compact segmented picker for semesters and other small option sets.
export function Segmented({ items, label }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-panel">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? "true" : undefined}
          className={`whitespace-nowrap rounded-xl px-3 py-1 text-[0.8125rem] font-medium transition-colors duration-200 ${i.active ? "bg-brand text-on-dark" : "text-meta hover:bg-muted hover:text-ink"}`}>{i.label}</Link>
      ))}
    </nav>
  );
}

// Calendar-icon date: navy month band, day large in mono.
export function DateBlock({ date }: { date: string }) {
  const d = new Date(date.replace(" ", "T") + (date.length > 10 ? "Z" : ""));
  return (
    <span className="flex w-11 shrink-0 flex-col items-center overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_var(--color-field)]">
      <span className="w-full bg-brand py-px text-center font-mono text-[0.5625rem] font-medium uppercase tracking-wider text-on-dark">{d.toLocaleDateString("en-GB", { month: "short", timeZone: "Asia/Dhaka" })}</span>
      <span className="num py-0.5 text-[1.125rem] font-semibold leading-tight text-ink">{d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "Asia/Dhaka" })}</span>
    </span>
  );
}

export function Progress({ value, max, tone = "accent", label }: { value: number; max: number; tone?: "accent" | "danger" | "success"; label: string }) {
  const p = max ? Math.min(100, (value / max) * 100) : 0;
  const bg = { accent: "bg-brand", danger: "bg-danger", success: "bg-brand-green" }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="h-1.5 w-full overflow-hidden rounded-full bg-track">
      <div className={`h-full rounded-full ${bg}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length > 10 ? d.replace(" ", "T") + "Z" : d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" }) : "—";
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d.replace(" ", "T") + "Z").toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }) : "—";

// Two-column definition rows used in profile and 360 views
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 text-[0.875rem]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-rule py-2.5 text-meta">{k}</dt>
          <dd className="min-w-0 border-b border-rule py-2.5 text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
