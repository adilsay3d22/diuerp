import { getSession } from "@/lib/auth.ts";
import { audit, all } from "@/lib/db.ts";
import { registrar, accounts, services } from "@/modules/index.ts";

// CORE-16 export. Exports of personal data are logged (NFR-5).
const REPORTS: Record<string, { roles: string[]; rows: (sem: number) => Promise<Record<string, unknown>[]> }> = {
  registration: { roles: ["exam_controller"], rows: async (sem) => await services.registrationStats(sem) },
  results: { roles: ["exam_controller"], rows: async (sem) => (await services.resultAnalysis(sem)).map(({ dist, ...r }) => ({ ...r, grades: Object.entries(dist).map(([l, n]) => `${l}:${n}`).join(" ") })) },
  probation: { roles: ["exam_controller"], rows: async () => (await services.standing()).filter((s) => s.cgpa != null && (s.cgpa < 2 || (s.sgpa ?? 4) < 2)).map(({ student_id, name, program, batch, sgpa, cgpa }) => ({ student_id, name, program, batch, sgpa, cgpa })) },
  graduation: { roles: ["exam_controller"], rows: async () => (await services.standing()).map(({ student_id, name, program, earned, total_credits, cgpa, conv }) => ({ student_id, name, program, earned, total_credits, cgpa, eligible: conv ? "yes" : "no" })) },
  collection: { roles: ["accounts_officer", "finance_head"], rows: async () => (await accounts.dashboard((await registrar.currentSemester()).id)).collection },
  dues: { roles: ["accounts_officer", "finance_head"], rows: async () => (await accounts.dashboard((await registrar.currentSemester()).id)).byProgram },
  defaulters: { roles: ["accounts_officer", "finance_head"], rows: async () => (await accounts.dashboard((await registrar.currentSemester()).id)).defaulters.map(({ student_id, name, program, batch, due }) => ({ student_id, name, program, batch, due })) },
  audit: { roles: ["super_admin"], rows: async () => await all("SELECT a.at, u.name AS actor, a.action, a.entity, a.entity_id, a.before, a.after FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 5000") },
};

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request, ctx: RouteContext<"/admin/export/[report]">) {
  const s = await getSession();
  const name = (await ctx.params).report;
  const r = REPORTS[name];
  if (!s || !r || !r.roles.includes(s.role)) return new Response("Forbidden", { status: 403 });
  const rows = await r.rows(Number(new URL(req.url).searchParams.get("sem")) || (await registrar.currentSemester()).id);
  const head = Object.keys(rows[0] ?? { empty: "" });
  const body = [head.join(","), ...rows.map((row) => head.map((h) => cell(row[h])).join(","))].join("\r\n");
  await audit(s.user.id, "export", "report", name, undefined, { rows: rows.length });
  return new Response("﻿" + body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
