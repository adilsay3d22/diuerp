import type { Metadata } from "next";
import { requireRole } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { core, registrar } from "@/modules/index.ts";
import * as A from "../../../actions.ts";
import { UsersRound, ShieldCheck, KeyRound } from "lucide-react";
import { PageHeader, Sheet, Table, StatusStamp, Button, Bento, Stat, Avatar, inputCls, btn } from "@/components/ui";
import { ConfirmButton } from "@/components/client";

export const metadata: Metadata = { title: "Users & roles" };

export default async function Users({ searchParams }: PageProps<"/admin/system">) {
  const s = await requireRole("super_admin");
  const q = String((await searchParams).q ?? "").trim();
  const users = await all<{ id: number; uni_id: string; name: string; email: string; status: string }>(
    "SELECT id, uni_id, name, email, status FROM users WHERE ? = '' OR uni_id LIKE ? OR name LIKE ? OR email LIKE ? ORDER BY id LIMIT 200", q, `%${q}%`, `%${q}%`, `%${q}%`);
  const depts = await registrar.departments();
  return (
    <>
      <PageHeader eyebrow="System administration" title="Users & roles" meta="One account per person; grant several roles and they switch without signing in again." />
      <Bento className="xl:grid-cols-[1.4fr_1fr_1fr]">
        <Stat dark icon={UsersRound} label="Accounts" value={(await all<{ n: number }>("SELECT COUNT(*) AS n FROM users"))[0].n} sub={`${(await all<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"))[0].n} active`} />
        <Stat icon={ShieldCheck} label="Role grants" value={(await all<{ n: number }>("SELECT COUNT(*) AS n FROM user_roles"))[0].n} sub={`${Object.keys(core.ROLES).length} roles defined`} />
        <Stat icon={KeyRound} label="Open sessions" value={(await all<{ n: number }>("SELECT COUNT(*) AS n FROM sessions"))[0].n} sub="signed-in devices" />
      </Bento>
      <form className="mb-6 flex max-w-xl gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search users</label>
        <input autoComplete="off" id="q" name="q" type="search" defaultValue={q} placeholder="ID, name or email…" spellCheck={false} className={`${inputCls} h-11 shadow-panel`} />
        <Button className="h-11">Search</Button>
      </form>
      <Sheet flush>
        <Table>
          <thead><tr><th>ID</th><th>Name</th><th>Roles</th><th>Grant role</th><th>Status</th><th>Account</th></tr></thead>
          <tbody>
            {await Promise.all(users.map(async (u) => {
              const roles = await core.userRoles(u.id);
              return (
                <tr key={u.id}>
                  <td className="num">{u.uni_id}</td>
                  <td><span className="flex items-center gap-2.5"><Avatar name={u.name} size={30} /><span>{u.name}<span className="block text-[0.75rem] text-meta">{u.email}</span></span></span></td>
                  <td>
                    <ul className="space-y-1">
                      {roles.map((r) => (
                        <li key={r.role} className="flex items-center gap-2 text-[0.8125rem]">
                          <span className="rounded-md bg-brand-soft px-1.5 py-0.5 font-medium text-brand">{core.ROLES[r.role].label}{r.dept_id ? ` (${depts.find((d) => d.id === r.dept_id)?.short})` : ""}</span>
                          {roles.length > 1 && (
                            <form action={A.revokeRoleAction}><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="role" value={r.role} />
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-danger hover:bg-tint-red" aria-label={`Revoke ${core.ROLES[r.role].label} from ${u.name}`} confirm={`Revoke ${core.ROLES[r.role].label} from ${u.name}?`}>Revoke</Button></form>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <form action={A.grantRoleAction} className="flex gap-1.5">
                      <input type="hidden" name="user_id" value={u.id} />
                      <select name="role" aria-label={`Role to grant ${u.name}`} className={`${inputCls} h-9 w-40`}>
                        {Object.entries(core.ROLES).filter(([k]) => !roles.some((r) => r.role === k)).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                      </select>
                      <select name="dept_id" aria-label="Department scope" className={`${inputCls} h-9 w-24`}><option value="">Scope</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.short}</option>)}</select>
                      <Button size="sm" variant="secondary">Grant</Button>
                    </form>
                  </td>
                  <td><StatusStamp status={u.status === "active" ? "active" : "closed"} /></td>
                  <td>
                    {u.id !== s.user.id && (
                      <div className="flex gap-1.5">
                        <form action={A.setUserStatusAction}><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="status" value={u.status === "active" ? "inactive" : "active"} />
                          <Button variant={u.status === "active" ? "danger" : "secondary"} size="sm" confirm={u.status === "active" ? `Deactivate ${u.name}? They are signed out everywhere.` : undefined}>{u.status === "active" ? "Deactivate" : "Reactivate"}</Button></form>
                        <form action={A.resetPasswordAction}><input type="hidden" name="user_id" value={u.id} />
                          <ConfirmButton message={`Reset ${u.name}'s password? Their sessions end immediately.`} className={btn("ghost", "sm")}>Reset password</ConfirmButton></form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </Table>
      </Sheet>
    </>
  );
}
