"use client"; // Error boundaries must be Client Components
import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { btn } from "@/components/ui";

export default function ShellError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <section role="alert" className="mx-auto mt-10 max-w-lg rounded-[1.75rem] bg-card p-8 text-center shadow-panel">
      <span aria-hidden className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-tint-red text-danger"><TriangleAlert size={22} strokeWidth={1.75} /></span>
      <h1 className="text-[1.5rem] font-semibold tracking-[-0.03em] text-heading">This page could not load</h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-meta">Nothing you entered was lost. Try again; if it keeps happening, report it through the help desk{error.digest ? <> with code <span className="num text-ink">{error.digest}</span></> : null}.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={() => retry()} className={btn("primary")}>Try again</button>
        <Link href="/helpdesk" className={btn("secondary")}>Help desk</Link>
      </div>
    </section>
  );
}
