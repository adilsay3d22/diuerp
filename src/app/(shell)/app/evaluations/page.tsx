import type { Metadata } from "next";
import { teacherCtx } from "@/lib/page.ts";
import { registrar, services } from "@/modules/index.ts";
import { PageHeader, Sheet, Empty } from "@/components/ui";
import { EvalCard } from "@/components/evals";

export const metadata: Metadata = { title: "My evaluations" };

// TCH-U-16: a teacher sees their own anonymised results once the semester has closed.
export default async function MyEvaluations() {
  const { t } = await teacherCtx();
  const closed = (await registrar.semesters()).filter((s) => s.status === "closed");
  return (
    <>
      <PageHeader eyebrow="Teaching" title="My evaluations" meta={`Anonymous student feedback, shown after each semester closes and only when at least ${services.MIN_RESPONSES} students responded.`} />
      {closed.length === 0 && <Sheet><Empty title="No closed semesters yet" /></Sheet>}
      <div className="space-y-8">
        {await Promise.all(closed.map(async (sem) => {
          const rows = await services.evalResults(sem.id, t.id);
          if (!rows.length) return null;
          return (
            <section key={sem.id}>
              <h2 className="eyebrow mb-3 flex items-center gap-2 text-brand"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-green" />{sem.name}</h2>
              <div className="grid gap-4 lg:grid-cols-2">{rows.map((r) => <EvalCard key={r.offering_id} r={r} />)}</div>
            </section>
          );
        }))}
      </div>
    </>
  );
}
