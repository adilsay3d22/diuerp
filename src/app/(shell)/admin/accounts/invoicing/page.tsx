import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth.ts";
import { all, num } from "@/lib/db.ts";
import { registrar } from "@/modules/index.ts";
import { bulkGenerateAction, applyLateFeesAction, sendRemindersAction } from "../../../../actions.ts";
import { PageHeader, Sheet, Button, Field, inputCls, taka, btn } from "@/components/ui";
import { ConfirmButton } from "@/components/client";

export const metadata: Metadata = { title: "Invoicing & waivers" };

export default async function Invoicing() {
  await requireRole("accounts_officer", "finance_head");
  const sem = await registrar.currentSemester();
  const batches = (await all<{ batch: string }>("SELECT DISTINCT batch FROM students ORDER BY batch")).map((b) => b.batch);
  return (
    <>
      <PageHeader eyebrow="Accounts office" title="Invoicing & waivers" meta={`${sem.name} · Course charges are raised automatically when a student registers.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Sheet title="Bulk-generate semester invoices" sub="Adds the semester fee to a whole batch">
          <form action={bulkGenerateAction} className="space-y-3">
            <input type="hidden" name="semester_id" value={sem.id} />
            <Field label="Program"><select name="program_id" className={inputCls}>{(await registrar.programs()).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Batch"><select name="batch" className={inputCls}>{batches.map((b) => <option key={b}>{b}</option>)}</select></Field>
            <Button>Add semester fee for the batch</Button>
            <p className="text-[0.8125rem] text-meta">Safe to run twice: students who already have the {sem.code} semester fee are skipped.</p>
          </form>
        </Sheet>
        <Sheet title="Due-date reminders" sub="In-app, email and SMS">
          <form action={sendRemindersAction} className="space-y-3">
            <input type="hidden" name="semester_id" value={sem.id} />
            <p className="text-[0.875rem] text-strong">Sends every student with an unpaid {sem.code} balance a reminder in the app, by email and by SMS (following each student’s preferences). Overdue invoices get an overdue notice.</p>
            <ConfirmButton message="Send fee reminders to every student with a balance?" className={btn("secondary")}>Send reminders</ConfirmButton>
            <p className="text-[0.75rem] text-meta">Automatic reminders also go out three days before the due date and the day after it passes.</p>
          </form>
        </Sheet>
        <Sheet title="Late fees" sub={`${taka(await num("late_fee", 500))} per overdue invoice`}>
          <form action={applyLateFeesAction} className="space-y-3">
            <input type="hidden" name="semester_id" value={sem.id} />
            <p className="text-[0.875rem] text-strong">Adds a {taka(await num("late_fee", 500))} late fee to every {sem.code} invoice that is past its due date and not fully paid. Each invoice is charged once.</p>
            <ConfirmButton message="Apply late fees to all overdue invoices?" className={btn("secondary")}>Apply late fees</ConfirmButton>
          </form>
        </Sheet>
        <Sheet title="Waivers, adjustments and exceptions" className="lg:col-span-2">
          <p className="max-w-[70ch] text-[0.875rem] text-strong">
            Open the student’s record to request a waiver or adjustment, or to grant a clearance exception. Requests wait in{" "}
            <Link href="/admin/accounts/approvals" className="font-medium text-brand hover:underline">Approvals</Link> for a second officer.
          </p>
          <Link href="/admin/students" className={`${btn("secondary")} mt-3`}>Find a student</Link>
        </Sheet>
      </div>
    </>
  );
}
