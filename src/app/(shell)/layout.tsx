import Link from "next/link";
import { Suspense } from "react";
import { Bell, LogOut, Menu, MessageCircle, Search } from "lucide-react";
import { requireUser } from "@/lib/auth.ts";
import { get } from "@/lib/db.ts";
import { core, registrar, comms, jobs } from "@/modules/index.ts";
import { navFor } from "./navconfig";
import { logoutAction, switchRoleAction } from "../actions.ts";
import { Flash, RoleSwitcher } from "@/components/client";
import { Avatar, Crest } from "@/components/ui";
import { NavLinks } from "./nav";

export default async function ShellLayout({ children }: LayoutProps<"/">) {
  const s = await requireUser();
  await jobs.runDaily();
  const unreadMsgs = await comms.unreadMessages(s.user.id);
  const unread = (await get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0", s.user.id))!.n;
  const sem = await registrar.currentSemester();
  const roles = s.roles.map((r) => ({ value: r.role, label: core.ROLES[r.role].label }));
  const side = core.ROLES[s.role].side === "admin" ? "Office" : "Portal";

  const nav = (
    <>
      <Link href="/" className="flex items-center gap-3 px-5 pb-7 pt-6">
        <Crest size={40} />
        <span className="min-w-0 leading-tight">
          <span translate="no" className="block text-[0.9375rem] font-semibold tracking-[-0.02em] text-on-dark">Daffodil International University</span>
          <span className="eyebrow mt-1 block text-[0.625rem] text-brand-green">{core.ROLES[s.role].label} {side}</span>
        </span>
      </Link>
      <NavLinks groups={navFor(s.role, s.roles)} />
      {sem && (
        <div className="mx-3 mb-3 mt-auto rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
          <span className="eyebrow flex items-center gap-2 text-[0.625rem] text-on-dark-muted">
            <span aria-hidden className="breathe h-1.5 w-1.5 rounded-full bg-brand-green" />Current semester
          </span>
          <span className="mt-1 block text-[0.875rem] font-medium text-on-dark">{sem.name} <span className="num text-on-dark-muted">· {sem.code}</span></span>
        </div>
      )}
    </>
  );

  const icon = "relative flex h-10 w-10 items-center justify-center rounded-xl text-strong transition-[background-color,box-shadow] duration-200 hover:bg-card hover:shadow-panel";
  const badge = "absolute right-1 top-1 min-w-4 rounded-full px-1 text-center font-mono text-[0.625rem] font-semibold leading-4 text-on-dark ring-2 ring-page";
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[17rem_1fr]">
      <a href="#main" className="sr-only z-50 rounded-lg bg-brand px-3 py-2 text-on-dark focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <aside className="no-print hidden bg-brand-deep [scrollbar-color:var(--color-navy-600)_transparent] md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-y-auto">{nav}</aside>
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-rule bg-page/85 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] backdrop-blur-xl backdrop-saturate-150 md:px-10">
          <details className="group md:hidden">
            <summary aria-label="Menu" className={`${icon} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
              <Menu aria-hidden size={20} strokeWidth={1.75} />
            </summary>
            <div className="fixed inset-x-0 bottom-0 top-16 z-20 flex flex-col overflow-y-auto overscroll-contain bg-brand-deep pb-[env(safe-area-inset-bottom)]">{nav}</div>
          </details>
          <Link href="/" className="flex items-center gap-2 md:hidden" aria-label="Home"><Crest size={30} /></Link>
          <form action="/search" role="search" className="relative hidden max-w-sm flex-1 md:block">
            <Search aria-hidden size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-meta" />
            <label htmlFor="global-search" className="sr-only">Search</label>
            <input id="global-search" name="q" type="search" placeholder="Search students, courses, pages…" autoComplete="off" spellCheck={false}
              className="h-10 w-full rounded-xl border border-rule bg-card pl-10 pr-3 text-[0.8125rem] text-ink shadow-[0_1px_2px_rgb(10_22_40/0.04)] placeholder:text-meta focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
          </form>
          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <Link href="/search" className={`${icon} md:hidden`} aria-label="Search"><Search aria-hidden size={18} strokeWidth={1.75} /></Link>
            {s.role !== "driver" && s.role !== "applicant" && (
              <Link href="/messages" className={icon} aria-label={`Messages, ${unreadMsgs} unread`}>
                <MessageCircle aria-hidden size={18} strokeWidth={1.75} />
                {unreadMsgs > 0 && <span className={`${badge} bg-brand`}>{unreadMsgs}</span>}
              </Link>
            )}
            <Link href="/notifications" className={icon} aria-label={`Notifications, ${unread} unread`}>
              <Bell aria-hidden size={18} strokeWidth={1.75} />
              {unread > 0 && <span className={`${badge} bg-danger`}>{unread}</span>}
            </Link>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-rule sm:block" />
            <RoleSwitcher roles={roles} active={s.role} action={switchRoleAction} />
            <Link href="/profile" className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-1 transition-[background-color,box-shadow] duration-200 hover:bg-card hover:shadow-panel sm:pr-3" aria-label="Profile">
              <Avatar name={s.user.name} />
              <span className="hidden text-[0.8125rem] font-medium text-ink lg:block">{s.user.name}</span>
            </Link>
            <form action={logoutAction}>
              <button className={`${icon} text-meta hover:text-ink`} aria-label="Sign out"><LogOut aria-hidden size={17} strokeWidth={1.75} /></button>
            </form>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[88rem] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 md:px-10 md:py-10">
          <Suspense><Flash /></Suspense>
          <div className="stagger">{children}</div>
        </main>
      </div>
    </div>
  );
}
