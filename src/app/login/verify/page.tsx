import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, pendingSession } from "@/lib/auth.ts";
import { get, showCodes } from "@/lib/db.ts";
import { verifyMfaAction, resendMfaAction, logoutAction } from "../../actions.ts";
import { Button, Field, Note, inputCls } from "@/components/ui";
import { AuthFrame, AuthHead } from "@/components/auth-frame";

export const metadata: Metadata = { title: "2-step sign-in" };

const mask = (s: string | null, keep = 3) => (s ? s.slice(0, keep) + "•".repeat(Math.max(0, s.length - keep - 2)) + s.slice(-2) : "");

export default async function VerifyLogin({ searchParams }: PageProps<"/login/verify">) {
  if (await getSession()) redirect("/");
  const p = await pendingSession();
  if (!p) redirect("/login");
  const q = await searchParams;
  // ponytail: no live email/SMS gateway yet; development shows the code that was "sent".
  const dev = showCodes() ? (await get<{ code: string }>("SELECT code FROM otps WHERE user_id = ?", p.user_id))?.code : undefined;
  return (
    <AuthFrame>
      <AuthHead eyebrow="2-step sign-in" title="Enter your code" sub={<>We sent a 6-digit code to {mask(p.email.split("@")[0])}@{p.email.split("@")[1]}{p.phone ? ` and ${mask(p.phone, 3)}` : ""}.</>} />
      <form action={verifyMfaAction} className="flex flex-col gap-5">
        {q.err && <Note tone="bad">{q.err}</Note>}
        {q.ok && <Note tone="ok">{q.ok}</Note>}
        {dev && <Note tone="wait">Demo mode (no email or SMS provider yet): your code is <b className="num">{dev}</b>.</Note>}
        <Field label="Verification code">
          <input name="code" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className={`${inputCls} num h-14 text-center text-[1.5rem] tracking-[0.5em]`} spellCheck={false} />
        </Field>
        <Button className="h-11 w-full">Verify and sign in</Button>
      </form>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[0.875rem]">
        <form action={resendMfaAction}><button className="font-medium text-brand hover:underline">Send a new code</button></form>
        <form action={logoutAction}><button className="text-meta hover:text-ink hover:underline">Use another account</button></form>
      </div>
      <p className="mt-8 border-t border-rule pt-5 text-[0.8125rem] text-meta">2-step sign-in is required for every office account.</p>
    </AuthFrame>
  );
}
