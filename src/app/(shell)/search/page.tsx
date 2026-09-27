import type { Metadata } from "next";
import Link from "next/link";
import { Search, ArrowUpRight } from "lucide-react";
import { requireUser } from "@/lib/auth.ts";
import { comms } from "@/modules/index.ts";
import { navFor } from "../navconfig";
import { PageHeader, Sheet, Empty, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const s = await requireUser();
  const q = String((await searchParams).q ?? "").trim();
  const groups = q.length >= 2 ? await comms.search(s.user.id, s.role, s.roles, q, navFor(s.role, s.roles).flatMap((g) => g.items)) : [];
  return (
    <>
      <PageHeader eyebrow="Search" title="Search" meta="Only what your current role can see." />
      <form role="search" className="relative mb-6 max-w-xl">
        <Search aria-hidden size={17} strokeWidth={1.75} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand" />
        <label htmlFor="q" className="sr-only">Search</label>
        <input autoComplete="off" id="q" name="q" defaultValue={q} autoFocus placeholder="Students, courses, notices, requests, pages…" className={`${inputCls} h-12 pl-11 text-[0.9375rem] shadow-panel`} spellCheck={false} />
      </form>
      {q.length < 2 ? null : groups.length === 0 ? <Sheet><Empty title={`Nothing found for “${q}”`}>Try an ID, a course code or part of a name.</Empty></Sheet> : (
        <div className="grid gap-6 lg:grid-cols-2">
          {groups.map((g) => (
            <Sheet key={g.label} title={g.label} flush>
              <ul className="px-2 pb-2">
                {g.hits.map((h, i) => (
                  <li key={i}>
                    <Link href={h.href} className="group flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-muted">
                      <span className="min-w-0 flex-1"><span className="block text-[0.9375rem] text-ink">{h.title}</span>
                      <span className="text-[0.8125rem] text-meta">{h.sub}</span></span>
                      <ArrowUpRight aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-field transition-colors group-hover:text-brand" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Sheet>
          ))}
        </div>
      )}
    </>
  );
}
