import { getSession } from "@/lib/auth.ts";
import { transport } from "@/modules/index.ts";

// TRN-D-2: the driver's phone posts its GPS fix while a trip is running.
export async function POST(req: Request, ctx: RouteContext<"/api/trips/[id]/position">) {
  const s = await getSession();
  if (!s || s.role !== "driver") return Response.json({ error: "Forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { lat?: number; lng?: number; speed?: number | null };
  try {
    await transport.postPosition(s.user.id, Number((await ctx.params).id), Number(b.lat), Number(b.lng), b.speed == null ? null : Math.max(0, Number(b.speed) * 3.6));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
