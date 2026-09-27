import type { Metadata } from "next";
import { verifyAction, resendCodeAction } from "../../actions.ts";
import { Button, Field, Note, inputCls } from "@/components/ui";
import { AuthFrame, AuthHead } from "@/components/auth-frame";

export const metadata: Metadata = { title: "Verify your email" };

export default async function Verify({ searchParams }: PageProps<"/apply/verify">) {
  const q = await searchParams;
  const email = String(q.email ?? "");
  return (
    <AuthFrame headline="Your path to DIU starts with one account." body="Create an applicant account, fill in one form, upload your certificates and follow every step from the test to your student ID in the same place.">
      <AuthHead eyebrow="Admission" title="Check your email" sub={<>We sent a 6-digit code to <span className="font-medium text-ink">{email}</span>. It expires in 15 minutes.</>} />
      <form action={verifyAction} className="flex flex-col gap-5">
        {q.err && <Note tone="bad">{q.err}</Note>}
        {q.ok && <Note tone="ok">{q.ok}</Note>}
        {q.dev && <Note tone="wait">Demo mode (no email provider yet): your code is <b className="num">{q.dev}</b>.</Note>}
        <input type="hidden" name="email" value={email} />
        <Field label="Verification code">
          <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className={`${inputCls} num h-14 text-center text-[1.5rem] tracking-[0.5em]`} spellCheck={false} />
        </Field>
        <Button className="h-11 w-full">Verify</Button>
      </form>
      <form action={resendCodeAction} className="mt-5">
        <input type="hidden" name="email" value={email} />
        <button className="text-[0.875rem] font-medium text-brand hover:underline">Send a new code</button>
      </form>
    </AuthFrame>
  );
}
