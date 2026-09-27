import type { Metadata } from "next";
import Link from "next/link";
import { studentCtx } from "@/lib/page.ts";
import { services } from "@/modules/index.ts";
import { PageHeader, Sheet, Table, Empty, Tabs, Note, btn, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Exams & admit cards" };

export default async function Exams({ searchParams }: PageProps<"/app/exams">) {
  const { st, sem } = await studentCtx();
  const stage = (await searchParams).stage === "midterm" ? "midterm" : "final";
  const { clear, exams } = await services.admitCard(st.id, sem.id, stage);
  const seated = exams.some((e) => e.room);
  return (
    <>
      <PageHeader eyebrow="Academics" title="Exams & admit cards" meta={`${sem.name} · exam schedule, seat and admit card`}
        actions={clear.ok && seated ? <Link href={`/documents/admit?stage=${stage}`} className={btn("primary", "sm")}>Admit card</Link> : null} />
      <Tabs tabs={[{ href: "?stage=midterm", label: "Mid-term", active: stage === "midterm" }, { href: "?stage=final", label: "Final", active: stage === "final" }]} />
      <Note tone={clear.ok ? "ok" : "bad"} className="mb-6">
        <span className="font-medium">{clear.ok ? "Cleared to sit. " : "Not cleared. "}</span>
        {clear.ok ? (seated ? "Your admit card is ready." : "The seat plan is not published yet.") : clear.reason}
        {!clear.ok && <> <Link href="/app/clearance" className="font-medium text-brand hover:underline">See clearance</Link></>}
      </Note>
      <Sheet flush>
        {exams.length === 0 ? <Empty title="No exams scheduled yet">The Exam Controller publishes the schedule before each exam window.</Empty> : (
          <Table>
            <thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Room</th><th className="r">Seat</th></tr></thead>
            <tbody>
              {exams.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap font-medium">{fmtDate(e.date)}</td><td className="num">{e.start}–{e.end}</td>
                  <td><span className="num font-medium text-brand">{e.code}</span> <span className="text-meta">{e.title}</span></td><td className="num">{e.room ?? "—"}</td><td className="r num">{e.seat ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
