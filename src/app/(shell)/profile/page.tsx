import type { Metadata } from "next";
import { requireUser } from "@/lib/auth.ts";
import { core, registrar } from "@/modules/index.ts";
import { updateProfileAction, changePasswordAction, savePrefsAction, toggleMfaAction } from "../../actions.ts";
import { needsMfa } from "@/lib/auth.ts";
import { get } from "@/lib/db.ts";
import { PageHeader, Sheet, Field, Facts, Button, Avatar, Crest, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Profile" };

export default async function Profile() {
  const s = await requireUser();
  const st = await registrar.studentByUser(s.user.id);
  const t = await registrar.teacherByUser(s.user.id);
  const prefs = await core.prefs(s.user.id);
  return (
    <>
      <PageHeader eyebrow="Account" title="Profile" meta="Office-verified details are read-only. Ask the Registrar to correct them." />
      <section className="relative mb-6 flex flex-wrap items-center gap-5 overflow-hidden rounded-[1.75rem] bg-brand-deep p-7 text-on-dark">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(9_80_158/0.65),transparent_65%)]" />
        <Crest size={140} className="pointer-events-none absolute -bottom-8 -right-4 opacity-[0.07]" />
        <Avatar name={s.user.name} size={72} />
        <div className="relative min-w-0">
          <p className="eyebrow text-[0.625rem] text-brand-green">{s.roles.map((r) => core.ROLES[r.role].label).join(" · ")}</p>
          <p className="mt-2 text-[1.5rem] font-semibold tracking-[-0.03em]">{s.user.name}</p>
          <p className="num mt-1 text-[0.8125rem] text-on-dark-muted">{s.user.uni_id} · {s.user.email}</p>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Sheet title="Verified record" sub="Kept by the Registrar's office">
          <Facts rows={[
            ["Name", s.user.name], ["University ID", s.user.uni_id], ["Email", s.user.email],
            ["Roles", s.roles.map((r) => core.ROLES[r.role].label).join(", ")],
            ...(st ? ([["Registration ID", st.reg_id], ["Program", st.program], ["Batch · Section", `${st.batch} · ${st.section}`], ["Status", st.status]] as [string, string][]) : []),
            ...(t ? ([["Employee ID", t.employee_id], ["Designation", t.designation]] as [string, string][]) : []),
          ]} />
        </Sheet>
        <div className="space-y-6">
          <Sheet title="Contact details">
            <form action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Mobile number"><input name="phone" type="tel" autoComplete="tel" defaultValue={s.user.phone ?? ""} className={inputCls} /></Field>
              <Field label="Blood group">
                <select name="blood_group" defaultValue={s.user.blood_group ?? ""} className={inputCls}>
                  <option value="">Not given</option>
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Emergency contact" hint="Name, relation and phone" className="sm:col-span-2">
                <input autoComplete="off" name="emergency_contact" defaultValue={s.user.emergency_contact ?? ""} className={inputCls} />
              </Field>
              <div className="sm:col-span-2"><Button>Save contact details</Button></div>
            </form>
          </Sheet>
          <Sheet title="Password">
            <form action={changePasswordAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Current password"><input name="current" type="password" required autoComplete="current-password" className={inputCls} /></Field>
              <Field label="New password" hint="At least 8 characters"><input name="next" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></Field>
              <div className="sm:col-span-2"><Button variant="secondary">Change password</Button></div>
            </form>
          </Sheet>
          <Sheet title="2-step sign-in">
            {s.roles.some((r) => core.ROLES[r.role].side === "admin") ? (
              <p className="text-[0.875rem] text-strong">Always on for office accounts. A code is sent to your email and phone each time you sign in.</p>
            ) : (
              <form action={toggleMfaAction} className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[0.875rem] text-strong">{await needsMfa(s.user.id) ? "On. A code is sent to your email and phone when you sign in." : "Off. Turn it on to protect your account with a code at sign-in."}</p>
                <input type="hidden" name="on" value={(await get<{ m: number }>("SELECT mfa_enabled AS m FROM users WHERE id = ?", s.user.id))?.m ? "0" : "1"} />
                <Button size="sm" variant="secondary">{await needsMfa(s.user.id) ? "Turn off" : "Turn on"}</Button>
              </form>
            )}
          </Sheet>
        </div>
      </div>
      <Sheet title="Notifications" className="mt-6" flush>
        <form action={savePrefsAction}>
          <table className="register">
            <thead><tr><th>Category</th><th className="text-center">Email</th><th className="text-center">SMS</th><th className="text-center">Mute</th></tr></thead>
            <tbody>
              {Object.entries(core.CATEGORIES).map(([c, meta]) => {
                const v = prefs[c as core.Category];
                return (
                  <tr key={c}>
                    <td>{meta.label}{meta.critical && <span className="ml-2 text-[0.75rem] text-meta">always delivered</span>}</td>
                    <td className="text-center"><input type="checkbox" name={`${c}:email`} defaultChecked={v.email} aria-label={`Email for ${meta.label}`} /></td>
                    <td className="text-center"><input type="checkbox" name={`${c}:sms`} defaultChecked={v.sms} aria-label={`SMS for ${meta.label}`} /></td>
                    <td className="text-center"><input type="checkbox" name={`${c}:muted`} defaultChecked={v.muted} disabled={meta.critical} aria-label={`Mute ${meta.label}`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-rule px-6 py-5"><Button variant="secondary">Save notification settings</Button></div>
        </form>
      </Sheet>
    </>
  );
}
