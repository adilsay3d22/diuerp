import { getSession } from "@/lib/auth.ts";
import { registrar, transport } from "@/modules/index.ts";

// Live bus positions: the transport office sees the fleet (TRN-A-7); a rider sees their own bus with an ETA (TRN-U-6).
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in" }, { status: 401 });
  if (s.role === "transport_officer") return Response.json({ buses: await transport.livePositions() });
  if (s.role === "student") {
    const st = (await registrar.studentByUser(s.user.id))!;
    const pass = await transport.studentPass(st.id, (await registrar.currentSemester()).id);
    if (!pass || pass.status !== "active") return Response.json({ buses: [] });
    const bus = await transport.busFor(pass.route_id, pass.stop_id);
    return Response.json({ buses: bus ? [bus] : [], stop: (await transport.stops(pass.route_id)).find((x) => x.id === pass.stop_id) });
  }
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
