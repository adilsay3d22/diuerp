import type { ReactNode } from "react";
import Link from "next/link";
import { Crest, Wordmark } from "./ui";

// Split-screen frame for sign-in, sign-up and verification: brand panel left (desktop), form right.
export function AuthFrame({ children, headline = "Admission to convocation, on one record.", body }: { children: ReactNode; headline?: string; body?: string }) {
  return (
    <main className="grid min-h-dvh bg-card lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-deep p-12 text-on-dark lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute -right-48 -top-48 h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.6),transparent_65%)]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,rgb(57_178_74/0.18),transparent_65%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        <Link href="/login" className="relative flex items-center gap-3">
          <Crest size={52} />
          <span className="leading-tight">
            <span translate="no" className="block text-[1rem] font-semibold tracking-[-0.02em]">Daffodil International University</span>
            <span className="eyebrow mt-1 block text-[0.625rem] text-brand-green">University ERP</span>
          </span>
        </Link>
        <div className="relative mt-auto max-w-lg">
          <p className="text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.045em]">{headline}</p>
          <p className="mt-5 max-w-[46ch] text-[0.9375rem] leading-relaxed text-on-dark-muted">
            {body ?? "Registration, classes, results, fees and the campus bus share the same data, so a grade published by the exam office reaches the student the same minute."}
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
            {[["Live", "results and fees"], ["QR", "receipts and bus passes"], ["2-step", "office sign-in"]].map(([v, k]) => (
              <div key={k} className="flex flex-col-reverse">
                <dt className="mt-1 text-[0.75rem] text-on-dark-muted">{k}</dt>
                <dd className="num text-[1.125rem] font-medium text-on-dark">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
      <div className="flex flex-col px-4 py-10 sm:px-10 lg:px-16">
        <div className="lg:hidden"><Wordmark height={36} /></div>
        <div className="stagger mx-auto my-auto w-full max-w-[25rem] py-10">{children}</div>
        <p className="text-[0.75rem] text-meta">Daffodil Smart City, Birulia, Savar, Dhaka 1216</p>
      </div>
    </main>
  );
}

export function AuthHead({ title, sub, eyebrow }: { title: string; sub?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8">
      {eyebrow && <p className="eyebrow mb-3 text-brand">{eyebrow}</p>}
      <h1 className="text-[2rem] font-semibold leading-none tracking-[-0.04em] text-heading">{title}</h1>
      {sub && <p className="mt-3 text-[0.9375rem] leading-relaxed text-meta">{sub}</p>}
    </div>
  );
}
