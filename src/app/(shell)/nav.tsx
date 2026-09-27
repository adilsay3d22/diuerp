"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "./navconfig";
import {
  LayoutGrid, BookPlus, CalendarClock, BookOpen, UserCheck, ShieldCheck, GraduationCap, Wallet, CalendarDays, Megaphone,
  Users, Library, DoorOpen, CalendarRange, UserPlus, Upload, FileCheck2, FilePen, Building2, Banknote, LockKeyhole,
  LineChart, Stamp, Receipt, Tags, UserCog, SlidersHorizontal, ScrollText, Bus, Route, MapPinned, IdCard, ClipboardList, MessageCircle, LifeBuoy, Inbox, FileBadge, PenLine, HandCoins, Scale, Map as MapIcon, Mail, UserRoundCheck, Star, BarChart3, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "/app": LayoutGrid, "/app/register": BookPlus, "/app/routine": CalendarClock, "/app/courses": BookOpen, "/app/attendance": UserCheck,
  "/app/clearance": ShieldCheck, "/app/results": GraduationCap, "/app/fees": Wallet, "/app/calendar": CalendarDays, "/notices": Megaphone,
  "/app/sections": Users, "/admin/registrar": Library, "/admin/registrar/catalogue": BookOpen, "/admin/registrar/rooms": DoorOpen,
  "/admin/registrar/semesters": CalendarRange, "/admin/registrar/enroll": UserPlus, "/admin/registrar/import": Upload,
  "/admin/students": Users, "/admin/exam": FileCheck2, "/admin/exam/changes": FilePen, "/admin/department": Building2,
  "/admin/cashier": Banknote, "/admin/cashier/shift": LockKeyhole, "/admin/accounts": LineChart, "/admin/accounts/approvals": Stamp,
  "/admin/accounts/invoicing": Receipt, "/admin/accounts/fees": Tags, "/admin/system": UserCog, "/admin/system/settings": SlidersHorizontal,
  "/admin/system/audit": ScrollText, "/app/transport": Bus, "/admin/admissions": ClipboardList, "/admin/transport": Bus,
  "/admin/transport/trips": MapPinned, "/admin/transport/passes": IdCard, "/admin/transport/routes": Route, "/admin/transport/fleet": Bus,
  "/messages": MessageCircle, "/helpdesk": LifeBuoy, "/admin/helpdesk": Inbox, "/app/exams": PenLine, "/app/services": FileBadge, "/app/mentor": UserRoundCheck,
  "/app/mentees": UserRoundCheck, "/app/evaluations": Star, "/admin/exam/schedule": PenLine, "/admin/exam/requests": FileBadge, "/admin/exam/evaluations": Star,
  "/admin/exam/mentors": UserRoundCheck, "/admin/exam/reports": BarChart3, "/admin/accounts/waivers": HandCoins, "/admin/accounts/reconcile": Scale,
  "/admin/transport/map": MapIcon, "/admin/system/outbox": Mail,
};

export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const all = groups.flatMap((g) => g.items);
  const active = all.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 pb-6">
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.label}>
          <p className="eyebrow mb-1.5 px-3 text-[0.625rem] text-on-dark-muted/70">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => {
              const Icon = ICONS[i.href] ?? LayoutGrid;
              const on = i.href === active;
              return (
                <li key={i.href}>
                  <Link href={i.href} aria-current={on ? "page" : undefined}
                    onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
                    className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[0.8125rem] transition-[background-color,color] duration-200 ${on ? "bg-white/[0.09] font-medium text-on-dark shadow-[inset_0_1px_0_rgb(255_255_255/0.07)]" : "text-on-dark-muted hover:bg-white/[0.05] hover:text-on-dark"}`}>
                    {on && <span aria-hidden className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-green" />}
                    <Icon aria-hidden size={16} strokeWidth={1.75} className={on ? "text-brand-green" : "text-on-dark-muted transition-colors group-hover:text-on-dark"} />
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
