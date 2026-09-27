import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { get, run, checkPassword, audit } from "./db.ts";
import { core } from "../modules/index.ts";

const COOKIE = "erp_session";
const HOURS = 8;

export type Session = { user: core.User; role: core.Role; roles: { role: core.Role; dept_id: number | null }[]; token: string };

export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await get<{ user_id: number; role: core.Role }>("SELECT user_id, role FROM sessions WHERE token = ? AND expires_at > datetime('now') AND mfa_pending = 0", token);
  if (!s) return null;
  const user = await get<core.User>("SELECT id, uni_id, email, name, phone, status, blood_group, emergency_contact FROM users WHERE id = ? AND status = 'active'", s.user_id);
  if (!user) return null;
  const roles = await core.userRoles(user.id);
  if (!roles.some((r) => r.role === s.role)) return null;
  return { user, role: s.role, roles, token };
});

// A session that passed the password but still owes its 2-step code (CORE-5).
export async function pendingSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return await get<{ user_id: number; token: string; email: string; phone: string | null }>(
    "SELECT s.user_id, s.token, u.email, u.phone FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.mfa_pending = 1 AND s.expires_at > datetime('now')", token) ?? null;
}

export async function requireUser() {
  const s = await getSession();
  if (!s) redirect((await pendingSession()) ? "/login/verify" : "/login");
  return s;
}

const mfaTries = new Map<string, number>();
export async function verifyMfa(code: string) {
  const p = await pendingSession();
  if (!p) return "Your sign-in expired. Start again.";
  const n = (mfaTries.get(p.token) ?? 0) + 1;
  mfaTries.set(p.token, n);
  if (n > 5) {
    await run("DELETE FROM sessions WHERE token = ?", p.token);
    return "Too many wrong codes. Sign in again.";
  }
  if (!(await core.checkCode(p.user_id, code))) return "That code is wrong or has expired.";
  mfaTries.delete(p.token);
  await run("UPDATE sessions SET mfa_pending = 0 WHERE token = ?", p.token);
  await audit(p.user_id, "mfa_ok", "user", p.user_id);
  return null;
}
export async function resendMfa() {
  const p = await pendingSession();
  if (p) await core.issueCode(p.user_id, "Your DIU ERP sign-in code");
}
export const needsMfa = async (userId: number) =>
  (await core.userRoles(userId)).some((r) => core.ROLES[r.role]?.side === "admin") || !!(await get<{ m: number }>("SELECT mfa_enabled AS m FROM users WHERE id = ?", userId))?.m;

// CORE-1: every page and action checks the active role server-side.
export async function requireRole(...allowed: core.Role[]) {
  const s = await requireUser();
  if (!allowed.includes(s.role)) redirect("/?denied=1");
  return s;
}

export const deptScope = (s: Session) => s.roles.find((r) => r.role === "dept_head")?.dept_id ?? null;

// ponytail: in-memory login throttle per identifier; move to Redis when running more than one instance.
const attempts = new Map<string, { n: number; until: number }>();

export async function login(identifier: string, password: string) {
  const key = identifier.trim().toLowerCase();
  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) return "Too many attempts. Try again in 10 minutes.";
  const u = await get<{ id: number; password_hash: string; status: string }>(
    "SELECT id, password_hash, status FROM users WHERE lower(uni_id) = ? OR email = ?", key, key);
  if (u && u.status === "unverified" && checkPassword(password, u.password_hash)) return "UNVERIFIED";
  if (!u || u.status !== "active" || !checkPassword(password, u.password_hash)) {
    attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 10 * 60_000 });
    return "ID or password is incorrect.";
  }
  attempts.delete(key);
  const token = randomBytes(32).toString("hex");
  const role = (await core.userRoles(u.id))[0].role;
  await run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  const mfa = await needsMfa(u.id);
  await run(`INSERT INTO sessions (token, user_id, role, expires_at, mfa_pending) VALUES (?,?,?, datetime('now', '+${HOURS} hours'), ?)`, token, u.id, role, mfa ? 1 : 0);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: HOURS * 3600 });
  await audit(u.id, "login", "user", u.id);
  if (mfa) {
    await core.issueCode(u.id, "Your DIU ERP sign-in code");
    return "MFA";
  }
  return null;
}

export async function logout() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await run("DELETE FROM sessions WHERE token = ?", token);
  (await cookies()).delete(COOKIE);
}

export async function switchRole(role: string) {
  const s = await requireUser();
  if (!s.roles.some((r) => r.role === role)) throw new Error("You do not hold that role.");
  await run("UPDATE sessions SET role = ? WHERE token = ?", role, s.token);
}

export const homeFor = (role: core.Role) => ({
  applicant: "/app", student: "/app", teacher: "/app", ta: "/app/sections", driver: "/app", admissions_officer: "/admin/admissions", transport_officer: "/admin/transport", registrar: "/admin/registrar", exam_controller: "/admin/exam", dept_head: "/admin/department",
  cashier: "/admin/cashier", accounts_officer: "/admin/accounts", finance_head: "/admin/accounts", super_admin: "/admin/system",
})[role];
