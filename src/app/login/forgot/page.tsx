import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { get, run, audit, hashPassword, showCodes } from "@/lib/db.ts";
import { core } from "@/modules/index.ts";
import { Button, Field, Note, inputCls } from "@/components/ui";
import { AuthFrame, AuthHead } from "@/components/auth-frame";

export const metadata: Metadata = { title: "Reset password" };

const find = async (id: string) => await get<{ id: number }>("SELECT id FROM users WHERE (lower(uni_id) = lower(?) OR email = lower(?)) AND status = 'active'", id.trim(), id.trim());

// CORE-4: self-service reset with a code sent by email and SMS. The same message shows whether or not the account exists.
async function sendCode(fd: FormData) {
  "use server";
  const id = String(fd.get("id") ?? "").trim();
  const u = await find(id);
  if (u) await core.issueCode(u.id, "Reset your DIU ERP password");
  redirect(`/login/forgot?id=${encodeURIComponent(id)}&sent=1`);
}
async function reset(fd: FormData) {
  "use server";
  const id = String(fd.get("id") ?? "");
  const pw = String(fd.get("password") ?? "");
  const u = await find(id);
  const back = (err: string) => redirect(`/login/forgot?id=${encodeURIComponent(id)}&sent=1&err=${encodeURIComponent(err)}`);
  if (pw.length < 8) back("Use at least 8 characters.");
  if (!u || !(await core.checkCode(u.id, String(fd.get("code") ?? "")))) back("That code is wrong or has expired.");
  await run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(pw), u!.id);
  await run("DELETE FROM sessions WHERE user_id = ?", u!.id);
  await audit(u!.id, "reset_password_self", "user", u!.id);
  redirect(`/login?ok=${encodeURIComponent("Password changed. Sign in with your new password.")}`);
}

export default async function Forgot({ searchParams }: PageProps<"/login/forgot">) {
  const q = await searchParams;
  const id = String(q.id ?? "");
  const u = q.sent && id ? await find(id) : undefined;
  const dev = showCodes() && u ? (await get<{ code: string }>("SELECT code FROM otps WHERE user_id = ?", u.id))?.code : undefined;
  return (
    <AuthFrame>
      <AuthHead eyebrow="Account recovery" title="Reset password" sub={q.sent ? "If that account exists, a code is on its way to its email and phone." : "We will send a one-time code to the email and phone on your account."} />
      {!q.sent ? (
        <form action={sendCode} className="flex flex-col gap-5">
          <Field label="Student ID, employee ID or email"><input name="id" required autoComplete="username" spellCheck={false} className={inputCls} /></Field>
          <Button className="h-11 w-full">Send me a code</Button>
        </form>
      ) : (
        <form action={reset} className="flex flex-col gap-5">
          {q.err && <Note tone="bad">{q.err}</Note>}
          {dev && <Note tone="wait">Demo mode (no email or SMS provider yet): your code is <b className="num">{dev}</b>.</Note>}
          <input type="hidden" name="id" value={id} />
          <Field label="Code"><input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className={`${inputCls} num tracking-[0.3em]`} spellCheck={false} /></Field>
          <Field label="New password" hint="At least 8 characters"><input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></Field>
          <Button className="h-11 w-full">Change password</Button>
        </form>
      )}
      <p className="mt-8 text-[0.875rem]"><Link href="/login" className="font-medium text-brand hover:underline">Back to sign in</Link></p>
    </AuthFrame>
  );
}
