// Daily jobs, run lazily on the first page view of the day.
// ponytail: no scheduler; move to a cron/BullMQ repeatable job when running more than one instance.
import { all, get, run, today, each } from "../lib/db.ts";
import { notify, usersWithRole } from "./core.ts";
import { expiryReminders } from "./transport.ts";
import { invoices } from "./accounts.ts";
import { OFFICES, type Office } from "./comms.ts";

const shift = (days: number) => new Date(Date.now() + days * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

const JOBS: Record<string, () => Promise<unknown>> = {
  transport_expiry: expiryReminders,
  // W5: invoices becoming overdue today, and a heads-up three days before the due date
  fee_due: async () => {
    for (const [day, overdue] of [[shift(-1), true], [shift(3), false]] as const) {
      for (const { student_id } of (await all<{ student_id: number }>("SELECT student_id FROM invoices WHERE due_date = ? AND student_id IS NOT NULL", day))) {
        const inv = (await invoices(student_id)).find((i) => i.due_date === day);
        if (!inv || inv.due <= 0) continue;
        const u = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", student_id))!.user_id;
        await notify([u], overdue ? `Overdue: ৳${inv.due.toLocaleString("en-IN")} (${inv.name})` : `Fees due in 3 days: ৳${inv.due.toLocaleString("en-IN")}`,
          overdue ? "Exam clearance depends on it. Pay online or at the counter." : `Due ${inv.due_date}.`, "/app/fees");
      }
    }
  },
  // Help desk: tell each office about requests past their SLA
  sla: async () => {
    const late = await all<{ office: string; n: number }>("SELECT office, COUNT(*) AS n FROM tickets WHERE status IN ('open','in_progress') AND sla_due < datetime('now') GROUP BY office");
    for (const l of late) {
      const roles = OFFICES[l.office as Office]?.roles ?? [];
      await notify((await each(roles, (r) => usersWithRole(r))).flat(), `${l.n} help desk request${l.n === 1 ? "" : "s"} past due`, OFFICES[l.office as Office]?.label ?? l.office, "/admin/helpdesk");
    }
  },
};

export async function runDaily() {
  const d = today();
  for (const [name, job] of Object.entries(JOBS)) {
    if ((await get("SELECT 1 FROM job_runs WHERE job = ? AND day = ?", name, d))) continue;
    await run("INSERT OR IGNORE INTO job_runs (job, day) VALUES (?,?)", name, d);
    try { await job(); } catch (e) { console.error(`[job ${name}]`, e); }
  }
}
