import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth.ts";
import { admission } from "@/modules/index.ts";
import { signupAction } from "../actions.ts";
import { Button, Field, Note, inputCls, fmtDate } from "@/components/ui";
import { AuthFrame, AuthHead } from "@/components/auth-frame";

export const metadata: Metadata = { title: "Apply for admission" };

export default async function Apply({ searchParams }: PageProps<"/apply">) {
  if (await getSession()) redirect("/");
  const { err } = await searchParams;
  const open = await admission.openCycles();
  return (
    <AuthFrame headline="Your path to DIU starts with one account." body="Create an applicant account, fill in one form, upload your certificates and follow every step from the test to your student ID in the same place.">
      <AuthHead eyebrow="Admission" title="Apply to DIU"
        sub={open.length ? <>Open now: {open.map((c) => `${c.name} (closes ${fmtDate(c.deadline)})`).join(", ")}</> : "No admission cycle is open right now. You can still create an account."} />
      <form action={signupAction} className="flex flex-col gap-5">
        {err && <Note tone="bad">{err}</Note>}
        <Field label="Full name (as on your certificates)"><input name="name" required autoComplete="name" className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" required autoComplete="email" spellCheck={false} className={inputCls} /></Field>
        <Field label="Mobile" hint="11 digits, starting with 01"><input name="phone" type="tel" required autoComplete="tel" pattern="01\d{9}" placeholder="01XXXXXXXXX" className={inputCls} /></Field>
        <Field label="Password" hint="At least 8 characters"><input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></Field>
        <Button className="h-11 w-full">Create applicant account</Button>
      </form>
      <p className="mt-8 text-[0.875rem] text-strong">Already applied? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link></p>
    </AuthFrame>
  );
}
