import type { services } from "@/modules/index.ts";
import { Sheet } from "./ui";

type Row = Awaited<ReturnType<typeof services.evalResults>>[number];

// Anonymised evaluation result for one section: average per question on a 1–5 scale.
export function EvalCard({ r, showTeacher = false }: { r: Row; showTeacher?: boolean }) {
  return (
    <Sheet title={<>{r.code} {r.section}{showTeacher && r.teacher && <span className="font-normal text-meta"> · {r.teacher}</span>}</>}
      actions={<span className="text-[0.8125rem] text-meta">{r.n} of {r.enrolled} responded</span>}>
      {r.hidden ? <p className="text-[0.875rem] text-meta">Too few responses to show results without identifying students.</p> : (
        <>
          <p className="num text-[2.5rem] font-medium leading-none tracking-[-0.05em] text-heading">{r.overall?.toFixed(2)}<span className="text-[0.875rem] tracking-normal text-meta"> / 5 overall</span></p>
          <ul className="mt-5 space-y-3">
            {r.perQuestion.map((q) => (
              <li key={q.text} className="text-[0.8125rem]">
                <span className="flex justify-between gap-2"><span>{q.text}</span><span className="num font-medium">{q.avg?.toFixed(2) ?? "—"}</span></span>
                <span className="mt-1.5 block h-1.5 rounded-full bg-track"><span className="block h-1.5 rounded-full bg-brand" style={{ width: `${((q.avg ?? 0) / 5) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
          {r.comments.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[0.8125rem] font-medium text-brand">{r.comments.length} comment{r.comments.length === 1 ? "" : "s"}</summary>
              <ul className="mt-2 space-y-2">{r.comments.map((c, i) => <li key={i} className="rounded-xl bg-muted px-3 py-2 text-[0.8125rem]">{c}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </Sheet>
  );
}
