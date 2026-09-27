import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth.ts";
import { loginAction } from "../actions.ts";
import { Button, Field, Note, inputCls } from "@/components/ui";
import { AuthFrame, AuthHead } from "@/components/auth-frame";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { err, ok } = await searchParams;
  return (
    <AuthFrame>
      <AuthHead eyebrow="Welcome back" title="Sign in" sub="Use your student ID, employee ID or email." />
      <form action={loginAction} className="flex flex-col gap-5">
        {ok && <Note tone="ok">{ok}</Note>}
        {err && <Note tone="bad">{err}</Note>}
        <Field label="Student ID, employee ID or email">
          <input name="id" required autoComplete="username" autoCapitalize="none" spellCheck={false} className={inputCls} placeholder="253-15-0001…" />
        </Field>
        <Field label="Password">
          <input name="password" type="password" required autoComplete="current-password" className={inputCls} />
        </Field>
        <Link href="/login/forgot" className="-mt-2 self-end text-[0.8125rem] text-meta hover:text-brand hover:underline">Forgot your password?</Link>
        <Button className="h-11 w-full">Sign in</Button>
      </form>
      <div className="mt-10 flex items-center justify-between gap-4 rounded-2xl bg-brand-soft px-5 py-4 ring-1 ring-inset ring-brand/10">
        <span className="text-[0.875rem] text-strong">New applicant?</span>
        <Link href="/apply" className="text-[0.875rem] font-medium text-brand hover:underline">Apply for admission</Link>
      </div>
    </AuthFrame>
  );
}
