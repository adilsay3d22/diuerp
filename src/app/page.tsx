import { redirect } from "next/navigation";
import { requireUser, homeFor } from "@/lib/auth.ts";

export default async function Home({ searchParams }: PageProps<"/">) {
  const s = await requireUser();
  const denied = (await searchParams).denied;
  redirect(homeFor(s.role) + (denied ? `?err=${encodeURIComponent("That page is not available to your active role.")}` : ""));
}
