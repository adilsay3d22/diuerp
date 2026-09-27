import type { Metadata } from "next";
import { studentCtx } from "@/lib/page.ts";
import { num } from "@/lib/db.ts";
import { student, teacher } from "@/modules/index.ts";
import { UserCheck, TriangleAlert, Gauge } from "lucide-react";
import { PageHeader, Sheet, Table, Stamp, Progress, Empty, Bento, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Attendance" };

export default async function Attendance() {
  const { st, sem } = await studentCtx();
  const ens = await student.enrollments(st.id, sem.id, ["confirmed"]);
  const att = await teacher.studentAttendance(st.id, ens.map((e) => e.offering_id));
  const t = await num("attendance_threshold", 70);
  return (
    <>
      <PageHeader eyebrow="Academics" title="Attendance" meta={`${sem.name} · Late counts as present · Below ${t}% you are not eligible for the final exam`} />
      {ens.length > 0 && (() => {
        const taken = att.filter((a) => a.total > 0);
        const overall = taken.length ? Math.round(taken.reduce((s, a) => s + a.percent, 0) / taken.length) : null;
        const risk = taken.filter((a) => a.percent < t).length;
        return (
          <Bento className="xl:grid-cols-[1.4fr_1fr_1fr]">
            <Stat dark icon={UserCheck} label="Average attendance" value={overall != null ? `${overall}%` : "—"} sub={`Across ${taken.length} course${taken.length === 1 ? "" : "s"} with classes held`} />
            <Stat icon={TriangleAlert} label="At risk" value={risk} tone={risk ? "danger" : "success"} sub={risk ? "below the threshold" : "every course is fine"} />
            <Stat icon={Gauge} label="Threshold" value={`${t}%`} sub="needed to sit the final" />
          </Bento>
        );
      })()}
      <Sheet flush>
        {ens.length === 0 ? <Empty title="No registered courses">Attendance appears once you are registered and classes begin.</Empty> : (
          <Table>
            <thead><tr><th>Course</th><th className="r">Classes</th><th className="r">Present</th><th className="r">Late</th><th className="r">Absent</th><th className="w-48">Attendance</th><th>Eligibility</th></tr></thead>
            <tbody>
              {ens.map((e, i) => {
                const a = att[i];
                const low = a.total > 0 && a.percent < t;
                return (
                  <tr key={e.id}>
                    <td><span className="num font-medium text-brand">{e.code}</span> <span className="text-meta">{e.title}</span></td>
                    <td className="r num">{a.total}</td><td className="r num">{a.present}</td><td className="r num">{a.late}</td><td className="r num">{a.absent}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={`num w-12 text-right font-semibold ${low ? "text-danger" : ""}`}>{a.total ? `${a.percent}%` : "—"}</span>
                        <Progress value={a.percent} max={100} tone={low ? "danger" : "accent"} label={`${e.code} attendance`} />
                      </div>
                    </td>
                    <td>{a.total === 0 ? <Stamp tone="neutral">No classes yet</Stamp> : low ? <Stamp tone="bad">At risk</Stamp> : <Stamp tone="ok">Eligible</Stamp>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Sheet>
    </>
  );
}
