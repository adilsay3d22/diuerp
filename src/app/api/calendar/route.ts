import { getSession } from "@/lib/auth.ts";
import { registrar, services } from "@/modules/index.ts";

// STU-U-2: academic calendar for phone calendars.
export async function GET(req: Request) {
  if (!(await getSession())) return new Response("Sign in required", { status: 401 });
  const sem = await registrar.semester(Number(new URL(req.url).searchParams.get("sem"))) ?? await registrar.currentSemester();
  return new Response((await services.ics(sem.id)), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="diu-${sem.code}.ics"` },
  });
}
