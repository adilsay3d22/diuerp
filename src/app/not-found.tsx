import Link from "next/link";
import { Crest, btn } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-start justify-center bg-page px-6 py-16 md:px-[12vw]">
      <Crest size={56} />
      <p className="num mt-10 text-[5rem] font-medium leading-none tracking-[-0.06em] text-brand/20 md:text-[7rem]">404</p>
      <h1 className="mt-4 text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-heading">This page is not here</h1>
      <p className="mt-3 max-w-[48ch] text-[0.9375rem] leading-relaxed text-meta">The link may be old, or the record belongs to someone else. Your dashboard has everything your role can open.</p>
      <div className="mt-8 flex gap-2">
        <Link href="/" className={btn("primary")}>Go to my dashboard</Link>
        <Link href="/helpdesk" className={btn("secondary")}>Help desk</Link>
      </div>
    </main>
  );
}
