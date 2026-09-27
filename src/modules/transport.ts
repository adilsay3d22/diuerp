// M5 Transport: routes, fleet, crew, passes, trips (TRN-U-1..5, TRN-D-1,2,4,5, TRN-A-1..6, A-9; W8, W9, W11).
import { createHmac } from "node:crypto";
import { all, get, run, insert, audit, tx, today, each } from "../lib/db.ts";
import { createUser, notify, usersWithRole } from "./core.ts";
import { emit, on } from "./events.ts";
import { currentSemester } from "./registrar.ts";
import { studentChargePaid } from "./accounts.ts";

export type Route = { id: number; number: string; name: string; distance_km: number | null; fee: number; return_time: string; active: number;
  stops: number; seats: number; riders: number; buses: string | null };
export type Stop = { id: number; route_id: number; seq: number; name: string; pickup_time: string; drop_time: string | null; lat: number | null; lng: number | null };
export type Pass = { id: number; student_id: number; semester_id: number; route_id: number; stop_id: number; bus_id: number | null; status: string; note: string | null;
  at: string; route: string; route_name: string; stop: string; pickup_time: string; bus: string | null; student: string; student_code: string };

const LIVE = "('applied','awaiting_payment','active')";

// ---------- Routes (TRN-A-1, TRN-U-1)
export async function routes(semesterId?: number) {
  semesterId ??= (await currentSemester()).id;
  return await all<Route>(`SELECT r.*, (SELECT COUNT(*) FROM route_stops s WHERE s.route_id = r.id) AS stops,
    (SELECT COALESCE(SUM(capacity), 0) FROM buses b WHERE b.route_id = r.id AND b.status = 'active') AS seats,
    (SELECT COUNT(*) FROM passes p WHERE p.route_id = r.id AND p.semester_id = ? AND p.status IN ${LIVE}) AS riders,
    (SELECT GROUP_CONCAT(number, ', ') FROM buses b WHERE b.route_id = r.id AND b.status = 'active') AS buses
    FROM routes r ORDER BY r.number`, semesterId);
}
export const route = async (id: number) => (await routes()).find((r) => r.id === id);
export const stops = async (routeId: number) => await all<Stop>("SELECT * FROM route_stops WHERE route_id = ? ORDER BY seq", routeId);

export async function saveRoute(by: number, r: { id?: number; number: string; name: string; distance_km: number | null; fee: number; return_time: string; active: number }) {
  if (!r.number || !r.name || !(r.fee >= 0)) throw new Error("Route number, name and fee are required.");
  const id = r.id
    ? (await run("UPDATE routes SET number = ?, name = ?, distance_km = ?, fee = ?, return_time = ?, active = ? WHERE id = ?", r.number, r.name, r.distance_km, r.fee, r.return_time, r.active, r.id), r.id)
    : await insert("INSERT INTO routes (number, name, distance_km, fee, return_time) VALUES (?,?,?,?,?)", r.number, r.name, r.distance_km, r.fee, r.return_time);
  await audit(by, r.id ? "update" : "create", "route", id, undefined, r);
  return id;
}
export async function addStop(by: number, routeId: number, s: { name: string; pickup_time: string; drop_time: string; lat?: number | null; lng?: number | null }) {
  if (!s.name || !s.pickup_time) throw new Error("Stop name and pickup time are required.");
  const seq = ((await get<{ m: number }>("SELECT COALESCE(MAX(seq), 0) AS m FROM route_stops WHERE route_id = ?", routeId))!.m) + 1;
  const id = await insert("INSERT INTO route_stops (route_id, seq, name, pickup_time, drop_time, lat, lng) VALUES (?,?,?,?,?,?,?)", routeId, seq, s.name, s.pickup_time, s.drop_time || null, s.lat ?? null, s.lng ?? null);
  // Keep stops in time order
  await each(await all<{ id: number }>("SELECT id FROM route_stops WHERE route_id = ? ORDER BY pickup_time, id", routeId), async (x, i) => await run("UPDATE route_stops SET seq = ? WHERE id = ?", i + 1, x.id));
  await audit(by, "create", "route_stop", id, undefined, s);
}
export async function removeStop(by: number, stopId: number) {
  if ((await get("SELECT 1 FROM passes WHERE stop_id = ?", stopId))) throw new Error("Riders use this stop; move their passes first.");
  await run("DELETE FROM route_stops WHERE id = ?", stopId);
  await audit(by, "delete", "route_stop", stopId);
}

// ---------- Crew & buses (TRN-A-2, A-3)
export const crew = async () => await all<{ id: number; user_id: number; kind: string; licence_no: string | null; licence_expiry: string | null; name: string; phone: string | null; uni_id: string }>(
  "SELECT c.*, u.name, u.phone, u.uni_id FROM crew c JOIN users u ON u.id = c.user_id ORDER BY c.kind, u.name");
export const crewByUser = async (userId: number) => await get<{ id: number; kind: string }>("SELECT id, kind FROM crew WHERE user_id = ?", userId);
export async function addCrew(by: number, c: { name: string; phone: string; email: string; kind: string; licence_no: string; licence_expiry: string; password: string }) {
  if (!c.name || !c.phone || !c.email) throw new Error("Name, phone and email are required.");
  return await tx(async () => {
    const n = ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM crew"))!.n) + 1;
    const uid = await createUser({ uni_id: `TRN-${String(n).padStart(4, "0")}`, email: c.email, name: c.name, phone: c.phone, password: c.password }, [{ role: "driver" }]);
    const id = await insert("INSERT INTO crew (user_id, kind, licence_no, licence_expiry) VALUES (?,?,?,?)", uid, c.kind, c.licence_no || null, c.licence_expiry || null);
    await audit(by, "create", "crew", id, undefined, { ...c, password: undefined });
    return `TRN-${String(n).padStart(4, "0")}`;
  });
}
export const buses = async () => await all<{ id: number; number: string; registration: string; capacity: number; status: string; route_id: number | null; route: string | null;
  driver_id: number | null; driver: string | null; assistant_id: number | null; assistant: string | null; fitness_expiry: string | null; insurance_expiry: string | null }>(
  `SELECT b.*, r.number AS route, du.name AS driver, au.name AS assistant FROM buses b LEFT JOIN routes r ON r.id = b.route_id
   LEFT JOIN crew d ON d.id = b.driver_id LEFT JOIN users du ON du.id = d.user_id LEFT JOIN crew a ON a.id = b.assistant_id LEFT JOIN users au ON au.id = a.user_id
   ORDER BY b.number`);
export async function saveBus(by: number, b: { id?: number; number: string; registration: string; capacity: number; status: string; route_id: number | null;
  driver_id: number | null; assistant_id: number | null; fitness_expiry: string; insurance_expiry: string }) {
  if (!b.number || !b.registration || !(b.capacity > 0)) throw new Error("Bus number, registration and capacity are required.");
  const clash = b.driver_id && await get<{ number: string }>("SELECT number FROM buses WHERE (driver_id = ? OR assistant_id = ?) AND id != ?", b.driver_id, b.driver_id, b.id ?? 0);
  if (clash) throw new Error(`That crew member is already assigned to bus ${clash.number}.`);
  const vals = [b.number, b.registration, b.capacity, b.status, b.route_id, b.driver_id, b.assistant_id, b.fitness_expiry || null, b.insurance_expiry || null] as const;
  const id = b.id
    ? (await run("UPDATE buses SET number=?, registration=?, capacity=?, status=?, route_id=?, driver_id=?, assistant_id=?, fitness_expiry=?, insurance_expiry=? WHERE id = ?", ...vals, b.id), b.id)
    : await insert("INSERT INTO buses (number, registration, capacity, status, route_id, driver_id, assistant_id, fitness_expiry, insurance_expiry) VALUES (?,?,?,?,?,?,?,?,?)", ...vals);
  await audit(by, b.id ? "update" : "create", "bus", id, undefined, b);
}

// Documents expiring within 30 days (TRN-A-3)
export async function expiring() {
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  return [
    ...(await crew()).filter((c) => c.licence_expiry && c.licence_expiry <= soon).map((c) => ({ what: `Licence · ${c.name}`, date: c.licence_expiry! })),
    ...(await buses()).flatMap((b) => [
      ...(b.fitness_expiry && b.fitness_expiry <= soon ? [{ what: `Fitness · Bus ${b.number}`, date: b.fitness_expiry }] : []),
      ...(b.insurance_expiry && b.insurance_expiry <= soon ? [{ what: `Insurance · Bus ${b.number}`, date: b.insurance_expiry }] : []),
    ]),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Passes (TRN-U-2..4, TRN-A-5; W8)
const PASS_SQL = `SELECT p.*, r.number AS route, r.name AS route_name, s.name AS stop, s.pickup_time, b.number AS bus, u.name AS student, st.student_id AS student_code
  FROM passes p JOIN routes r ON r.id = p.route_id JOIN route_stops s ON s.id = p.stop_id LEFT JOIN buses b ON b.id = p.bus_id
  JOIN students st ON st.id = p.student_id JOIN users u ON u.id = st.user_id`;
export const studentPass = async (studentId: number, semesterId: number) =>
  await get<Pass>(`${PASS_SQL} WHERE p.student_id = ? AND p.semester_id = ? ORDER BY p.id DESC LIMIT 1`, studentId, semesterId);
export const passes = async (semesterId: number, status?: string) =>
  await all<Pass>(`${PASS_SQL} WHERE p.semester_id = ? AND (? IS NULL OR p.status = ?) ORDER BY p.status, r.number, p.id`, semesterId, status ?? null, status ?? null);
export const seatsLeft = async (routeId: number) => { const r = await route(routeId); return r ? r.seats - r.riders : 0; };

export async function applyPass(userId: number, studentId: number, routeId: number, stopId: number) {
  const sem = await currentSemester();
  return await tx(async () => {
    const cur = await studentPass(studentId, sem.id);
    if (cur && ["applied", "awaiting_payment", "active", "suspended"].includes(cur.status)) throw new Error("You already have a pass this semester. Request a change instead.");
    const r = await route(routeId);
    if (!r || !r.active) throw new Error("This route is not running.");
    if (!(await stops(routeId)).some((s) => s.id === stopId)) throw new Error("Pick a stop on this route.");
    if (await seatsLeft(routeId) <= 0) throw new Error(`Route ${r.number} is full this semester. Try another route or ask the Transport Office.`);
    const id = await insert("INSERT INTO passes (student_id, semester_id, route_id, stop_id, status) VALUES (?,?,?,?, 'applied')", studentId, sem.id, routeId, stopId);
    await audit(userId, "apply", "pass", id);
    await notify(await usersWithRole("transport_officer"), `Pass application: Route ${r.number}`, "Waiting for approval.", "/admin/transport/passes");
    return id;
  });
}

export async function decidePass(by: number, passId: number, approve: boolean, note: string) {
  await tx(async () => {
    const p = await get<Pass>(`${PASS_SQL} WHERE p.id = ?`, passId);
    if (!p || p.status !== "applied") throw new Error("Only new applications can be decided.");
    const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", p.student_id))!.user_id;
    if (!approve) {
      if (!note) throw new Error("Give the student a reason.");
      await run("UPDATE passes SET status = 'rejected', note = ? WHERE id = ?", note, passId);
      await notify([uid], "Transport pass not approved", note, "/app/transport");
    } else {
      if (await seatsLeft(p.route_id) < 0) throw new Error("Route is over capacity. Add a bus or move riders first.");
      await run("UPDATE passes SET status = 'awaiting_payment', note = NULL WHERE id = ?", passId);
      await emit("pass.requested", { passId, studentId: p.student_id, semesterId: p.semester_id, routeId: p.route_id, amount: (await route(p.route_id))!.fee, by });
      await notify([uid], `Pass approved: pay ৳${(await route(p.route_id))!.fee.toLocaleString("en-IN")} to activate`, "The transport fee is on your semester invoice.", "/app/fees");
      await activateIfPaid(p.student_id);
    }
    await audit(by, approve ? "approve" : "reject", "pass", passId, undefined, note);
  });
}

async function activateIfPaid(studentId: number) {
  for (const p of (await all<{ id: number; route_id: number }>("SELECT id, route_id FROM passes WHERE student_id = ? AND status = 'awaiting_payment'", studentId))) {
    if (!(await studentChargePaid(studentId, `pass:${p.id}`))) continue;
    // Assign the bus on the route with the most free seats
    const bus = await get<{ id: number; number: string }>(
      `SELECT b.id, b.number FROM buses b WHERE b.route_id = ? AND b.status = 'active'
       ORDER BY b.capacity - (SELECT COUNT(*) FROM passes x WHERE x.bus_id = b.id AND x.status = 'active') DESC LIMIT 1`, p.route_id);
    await run("UPDATE passes SET status = 'active', bus_id = ? WHERE id = ?", bus?.id ?? null, p.id);
    const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", studentId))!.user_id;
    await notify([uid], "Transport pass active", bus ? `You ride Bus ${bus.number}.` : "Your bus will be assigned shortly.", "/app/transport");
  }
}
on("invoice.paid", async ({ studentId }) => { if (studentId) await activateIfPaid(studentId); });

export async function requestChange(studentId: number, kind: string, routeId: number | null, stopId: number | null, reason: string) {
  const p = await studentPass(studentId, (await currentSemester()).id);
  if (!p || !["active", "suspended", "awaiting_payment"].includes(p.status)) throw new Error("You have no pass to change.");
  if ((await get("SELECT 1 FROM pass_requests WHERE pass_id = ? AND status = 'pending'", p.id))) throw new Error("You already have a pending request.");
  if (kind === "change" && (!routeId || !stopId || !(await stops(routeId)).some((s) => s.id === stopId))) throw new Error("Pick the new route and stop.");
  await insert("INSERT INTO pass_requests (pass_id, kind, route_id, stop_id, reason) VALUES (?,?,?,?,?)", p.id, kind, routeId, stopId, reason || null);
  await notify(await usersWithRole("transport_officer"), `Pass ${kind} request: ${p.student_code}`, reason, "/admin/transport/passes");
}
export const pendingRequests = async () => await all<{ id: number; pass_id: number; kind: string; reason: string | null; at: string; student: string; student_code: string;
  from_route: string; from_stop: string; to_route: string | null; to_stop: string | null; route_id: number | null; stop_id: number | null }>(
  `SELECT q.*, u.name AS student, st.student_id AS student_code, r.number AS from_route, s.name AS from_stop, nr.number AS to_route, ns.name AS to_stop
   FROM pass_requests q JOIN passes p ON p.id = q.pass_id JOIN students st ON st.id = p.student_id JOIN users u ON u.id = st.user_id
   JOIN routes r ON r.id = p.route_id JOIN route_stops s ON s.id = p.stop_id LEFT JOIN routes nr ON nr.id = q.route_id LEFT JOIN route_stops ns ON ns.id = q.stop_id
   WHERE q.status = 'pending' ORDER BY q.at`);

export async function decideRequest(by: number, reqId: number, approve: boolean) {
  await tx(async () => {
    const q = await get<{ pass_id: number; kind: string; route_id: number | null; stop_id: number | null; status: string }>("SELECT * FROM pass_requests WHERE id = ?", reqId);
    if (!q || q.status !== "pending") throw new Error("Request is not pending.");
    const p = (await get<Pass>(`${PASS_SQL} WHERE p.id = ?`, q.pass_id))!;
    await run("UPDATE pass_requests SET status = ?, decided_by = ? WHERE id = ?", approve ? "approved" : "rejected", by, reqId);
    if (approve) {
      if (q.kind === "change") {
        if (q.route_id !== p.route_id && await seatsLeft(q.route_id!) <= 0) throw new Error("The new route is full.");
        // ponytail: no fee difference between routes; add a charge line if route fees start to differ.
        const bus = q.route_id === p.route_id ? p.bus_id : (await get<{ id: number }>("SELECT id FROM buses WHERE route_id = ? AND status = 'active' LIMIT 1", q.route_id!))?.id ?? null;
        await run("UPDATE passes SET route_id = ?, stop_id = ?, bus_id = ? WHERE id = ?", q.route_id, q.stop_id, bus, p.id);
      } else if (q.kind === "suspend") await run("UPDATE passes SET status = 'suspended' WHERE id = ?", p.id);
      else if (q.kind === "resume") await run("UPDATE passes SET status = 'active' WHERE id = ?", p.id);
      else if (q.kind === "cancel") await cancelPass(by, p.id);
    }
    await audit(by, approve ? "approve" : "reject", "pass_request", reqId);
    const uid = (await get<{ user_id: number }>("SELECT user_id FROM students WHERE id = ?", p.student_id))!.user_id;
    await notify([uid], `Pass ${q.kind} request ${approve ? "approved" : "rejected"}`, "", "/app/transport");
  });
}
async function cancelPass(by: number, passId: number) {
  const p = (await get<{ student_id: number; semester_id: number; status: string }>("SELECT * FROM passes WHERE id = ?", passId))!;
  await run("UPDATE passes SET status = 'cancelled' WHERE id = ?", passId);
  await emit("pass.cancelled", { passId, studentId: p.student_id, semesterId: p.semester_id, by });
}
// W11
on("student.graduated", async ({ studentId, by }) => {
  for (const p of (await all<{ id: number }>(`SELECT id FROM passes WHERE student_id = ? AND status IN ${LIVE.replace(")", ",'suspended')")}`, studentId))) await cancelPass(by, p.id);
});

// ---------- Trips (TRN-A-4, A-6, TRN-D-1, D-2, D-4)
export type Trip = { id: number; route_id: number; bus_id: number | null; date: string; direction: string; scheduled: string; status: string;
  started_at: string | null; ended_at: string | null; delay_min: number | null; note: string | null; route: string; route_name: string; bus: string | null;
  driver: string | null; driver_phone: string | null; assistant: string | null; driver_user: number | null; assistant_user: number | null };
const TRIP_SQL = `SELECT t.*, r.number AS route, r.name AS route_name, b.number AS bus, du.name AS driver, du.phone AS driver_phone, au.name AS assistant,
  du.id AS driver_user, au.id AS assistant_user FROM trips t JOIN routes r ON r.id = t.route_id LEFT JOIN buses b ON b.id = t.bus_id
  LEFT JOIN crew d ON d.id = b.driver_id LEFT JOIN users du ON du.id = d.user_id LEFT JOIN crew a ON a.id = b.assistant_id LEFT JOIN users au ON au.id = a.user_id`;
export const trips = async (date: string) => await all<Trip>(`${TRIP_SQL} WHERE t.date = ? ORDER BY t.scheduled, r.number`, date);
export const trip = async (id: number) => await get<Trip>(`${TRIP_SQL} WHERE t.id = ?`, id);
export const crewTrips = async (userId: number, date: string) => (await trips(date)).filter((t) => t.driver_user === userId || t.assistant_user === userId);

export async function generateTrips(by: number, date: string) {
  const holiday = await get<{ title: string }>("SELECT title FROM calendar_events WHERE type = 'holiday' AND ? BETWEEN start_date AND end_date", date);
  if (holiday) throw new Error(`No trips on ${date}: ${holiday.title}.`);
  if (new Date(date + "T00:00:00Z").getUTCDay() === 5) throw new Error("Friday is the weekly holiday.");
  return await tx(async () => {
    let n = 0;
    for (const r of (await routes()).filter((r) => r.active)) {
      const first = (await stops(r.id))[0];
      if (!first) continue;
      for (const b of (await all<{ id: number }>("SELECT id FROM buses WHERE route_id = ? AND status = 'active' ORDER BY id LIMIT 1", r.id))) {
        n += Number((await run("INSERT OR IGNORE INTO trips (route_id, bus_id, date, direction, scheduled) VALUES (?,?,?, 'to_campus', ?)", r.id, b.id, date, first.pickup_time)).changes);
        n += Number((await run("INSERT OR IGNORE INTO trips (route_id, bus_id, date, direction, scheduled) VALUES (?,?,?, 'from_campus', ?)", r.id, b.id, date, r.return_time)).changes);
      }
    }
    await audit(by, "generate", "trips", date, undefined, { n });
    return n;
  });
  // ponytail: one bus per route per direction; add per-bus trips when routes run more than one bus at the same time.
}

function assertCrew(userId: number, t: Trip | undefined) {
  if (!t || (t.driver_user !== userId && t.assistant_user !== userId)) throw new Error("This trip is not assigned to you.");
  return t;
}
export async function startTrip(userId: number, id: number) {
  const t = assertCrew(userId, await trip(id));
  if (t.status !== "scheduled" && t.status !== "delayed") throw new Error("This trip has already started or ended.");
  const late = minutesLate(t.scheduled);
  await run("UPDATE trips SET status = 'running', started_at = datetime('now'), delay_min = COALESCE(delay_min, ?) WHERE id = ?", late > 0 ? late : null, id);
  await audit(userId, "start", "trip", id);
}
export async function endTrip(userId: number, id: number) {
  const t = assertCrew(userId, await trip(id));
  if (t.status !== "running") throw new Error("Start the trip first.");
  await run("UPDATE trips SET status = 'completed', ended_at = datetime('now') WHERE id = ?", id);
  await audit(userId, "end", "trip", id);
}
const minutesLate = (hhmm: string) => {
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dhaka" });
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return m(now) - m(hhmm);
};

export async function report(userId: number, tripId: number, kind: string, note: string, minutes: number, fileId: number | null) {
  const t = assertCrew(userId, await trip(tripId));
  if (!note) throw new Error("Describe what happened.");
  const id = await insert("INSERT INTO trip_reports (trip_id, kind, note, file_id, by_user) VALUES (?,?,?,?,?)", tripId, kind, note, fileId, userId);
  await audit(userId, "report", "trip", tripId, undefined, { kind, note });
  await notify(await usersWithRole("transport_officer"), `Bus ${t.bus} (${t.route}): ${kind}`, note, "/admin/transport");
  if (kind === "delay" || kind === "breakdown") {
    await run("UPDATE trips SET status = CASE WHEN status = 'scheduled' THEN 'delayed' ELSE status END, delay_min = ?, note = ? WHERE id = ?", minutes || null, note, tripId);
    await emit("trip.delayed", { tripId, minutes, note });
  }
  return id;
}
export async function publishDisruption(by: number, tripId: number, kind: "delay" | "cancel", minutes: number, note: string) {
  if (!note) throw new Error("Tell riders what is happening.");
  const t = await trip(tripId);
  if (!t || t.status === "completed") throw new Error("Trip not found or already completed.");
  if (kind === "cancel") {
    await run("UPDATE trips SET status = 'cancelled', note = ? WHERE id = ?", note, tripId);
    await emit("trip.cancelled", { tripId, note });
  } else {
    if (!(minutes > 0)) throw new Error("Enter the delay in minutes.");
    await run("UPDATE trips SET status = CASE WHEN status = 'scheduled' THEN 'delayed' ELSE status END, delay_min = ?, note = ? WHERE id = ?", minutes, note, tripId);
    await emit("trip.delayed", { tripId, minutes, note });
  }
  await audit(by, kind, "trip", tripId, undefined, { minutes, note });
}
export const openReports = async () => await all<{ id: number; kind: string; note: string; at: string; route: string; bus: string | null; by_name: string; file_id: number | null; trip_id: number }>(
  `SELECT rp.*, r.number AS route, b.number AS bus, u.name AS by_name FROM trip_reports rp JOIN trips t ON t.id = rp.trip_id JOIN routes r ON r.id = t.route_id
   LEFT JOIN buses b ON b.id = t.bus_id LEFT JOIN users u ON u.id = rp.by_user WHERE rp.resolved = 0 ORDER BY rp.at DESC`);
export async function resolveReport(by: number, id: number) {
  await run("UPDATE trip_reports SET resolved = 1 WHERE id = ?", id);
  await audit(by, "resolve", "trip_report", id);
}

// Riders on a trip's route, by stop (driver view)
export const riders = async (routeId: number) => await all<{ stop: string; seq: number; name: string; student_code: string; phone: string | null }>(
  `SELECT s.name AS stop, s.seq, u.name, st.student_id AS student_code, u.phone FROM passes p JOIN route_stops s ON s.id = p.stop_id
   JOIN students st ON st.id = p.student_id JOIN users u ON u.id = st.user_id WHERE p.route_id = ? AND p.semester_id = ? AND p.status = 'active' ORDER BY s.seq, u.name`,
  routeId, (await currentSemester()).id);

// W9: tell every rider of the route
async function notifyRiders(tripId: number, title: string, body: string) {
  const t = (await trip(tripId))!;
  const ids = (await all<{ user_id: number }>(`SELECT st.user_id FROM passes p JOIN students st ON st.id = p.student_id WHERE p.route_id = ? AND p.semester_id = ? AND p.status = 'active'`,
    t.route_id, (await currentSemester()).id)).map((r) => r.user_id);
  await notify(ids, title, body, "/app/transport");
}
on("trip.delayed", async ({ tripId, minutes, note }) => {
  const t = (await trip(tripId))!;
  await notifyRiders(tripId, `Route ${t.route} ${t.direction === "to_campus" ? "morning" : "return"} bus delayed${minutes ? ` ~${minutes} min` : ""}`, note);
});
on("trip.cancelled", async ({ tripId, note }) => {
  const t = (await trip(tripId))!;
  await notifyRiders(tripId, `Route ${t.route} ${t.direction === "to_campus" ? "morning" : "return"} trip cancelled`, note);
});

// ---------- Dashboard (TRN-A-9)
export async function dashboard() {
  const sem = await currentSemester();
  const rs = await routes(sem.id);
  const done = await all<{ scheduled: string; started_at: string }>("SELECT scheduled, started_at FROM trips WHERE status = 'completed' AND started_at IS NOT NULL AND date >= date('now', '-30 days')");
  const onTime = done.filter((t) => {
    const s = new Date(t.started_at.replace(" ", "T") + "Z").toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dhaka" });
    return s <= addMin(t.scheduled, 5);
  }).length;
  return {
    activeBuses: (await get<{ n: number }>("SELECT COUNT(*) AS n FROM buses WHERE status = 'active'"))!.n,
    riders: (await get<{ n: number }>("SELECT COUNT(*) AS n FROM passes WHERE semester_id = ? AND status = 'active'", sem.id))!.n,
    routes: rs.filter((r) => r.active).length,
    unpaid: (await get<{ n: number }>("SELECT COUNT(*) AS n FROM passes WHERE semester_id = ? AND status = 'awaiting_payment'", sem.id))!.n,
    pending: (await get<{ n: number }>("SELECT COUNT(*) AS n FROM passes WHERE semester_id = ? AND status = 'applied'", sem.id))!.n + (await pendingRequests()).length,
    issues: (await openReports()).length,
    onTime: done.length ? Math.round((onTime / done.length) * 100) : null,
    byRoute: rs,
  };
}
const addMin = (hhmm: string, m: number) => {
  const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + m;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export const todayTrips = async () => await trips(today());

// ---------- Live location (TRN-D-2 GPS, TRN-U-6, TRN-A-7)
export async function postPosition(userId: number, tripId: number, lat: number, lng: number, speed: number | null) {
  const t = assertCrew(userId, await trip(tripId));
  if (t.status !== "running") throw new Error("Start the trip first.");
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new Error("Bad coordinates.");
  await insert("INSERT INTO trip_positions (trip_id, lat, lng, speed) VALUES (?,?,?,?)", tripId, lat, lng, speed);
}
export type Live = { trip_id: number; route_id: number; route: string; bus: string | null; direction: string; lat: number; lng: number; speed: number | null; at: string; delay_min: number | null };
export const livePositions = async () => await all<Live>(
  `SELECT t.id AS trip_id, t.route_id, r.number AS route, b.number AS bus, t.direction, p.lat, p.lng, p.speed, p.at, t.delay_min FROM trips t
   JOIN routes r ON r.id = t.route_id LEFT JOIN buses b ON b.id = t.bus_id
   JOIN trip_positions p ON p.id = (SELECT MAX(id) FROM trip_positions WHERE trip_id = t.id)
   WHERE t.status = 'running' AND p.at > datetime('now', '-30 minutes')`);
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2));
};
// ETA to a rider's stop: straight-line distance at the bus's reported speed (Dhaka traffic floor of 15 km/h).
// ponytail: straight-line estimate; use a routing API (road distance, live traffic) when accuracy matters.
export async function busFor(routeId: number, stopId: number) {
  const live = (await livePositions()).filter((l) => l.route_id === routeId);
  if (!live.length) return null;
  const l = live.find((x) => x.direction === "to_campus") ?? live[0];
  const stopsList = (await stops(routeId)).filter((s) => s.lat != null);
  const target = stopsList.find((s) => s.id === stopId);
  const near = stopsList.map((s) => ({ s, d: km(l, { lat: s.lat!, lng: s.lng! }) })).sort((a, b) => a.d - b.d)[0];
  const speed = Math.max(15, l.speed ?? 0);
  const dist = target ? km(l, { lat: target.lat!, lng: target.lng! }) : null;
  return { ...l, near: near && near.d < 0.4 ? near.s.name : near ? `near ${near.s.name}` : null, eta: dist == null ? null : Math.max(1, Math.round((dist / speed) * 60)), km: dist };
}

// ---------- Boarding (TRN-D-3): by list or by scanning the rider's pass QR
const SECRET = () => process.env.GATEWAY_SECRET ?? "dev-sandbox-secret";
export const passToken = (passId: number) => `DIU-PASS-${passId}-${createHmac("sha256", SECRET()).update(`pass:${passId}`).digest("hex").slice(0, 10).toUpperCase()}`;
export async function markBoarded(userId: number, tripId: number, key: { studentId?: number; token?: string }, method: "list" | "qr") {
  const t = assertCrew(userId, await trip(tripId));
  let studentId = key.studentId;
  if (key.token) {
    const m = /^DIU-PASS-(\d+)-[0-9A-F]{10}$/.exec(key.token.trim().toUpperCase());
    if (!m || passToken(Number(m[1])) !== key.token.trim().toUpperCase()) throw new Error("That QR code is not a valid DIU pass.");
    studentId = (await get<{ student_id: number }>("SELECT student_id FROM passes WHERE id = ?", Number(m[1])))?.student_id;
  }
  const p = await get<{ stop_id: number; route_id: number; name: string }>(
    "SELECT p.stop_id, p.route_id, u.name FROM passes p JOIN students s ON s.id = p.student_id JOIN users u ON u.id = s.user_id WHERE p.student_id = ? AND p.semester_id = ? AND p.status = 'active'",
    studentId ?? 0, (await currentSemester()).id);
  if (!p) throw new Error("No active pass for this rider.");
  if (p.route_id !== t.route_id) throw new Error(`${p.name} rides a different route.`);
  await run("INSERT OR IGNORE INTO boardings (trip_id, student_id, stop_id, method, by_user) VALUES (?,?,?,?,?)", tripId, studentId!, p.stop_id, method, userId);
  return p.name;
}
export const boarded = async (tripId: number) => new Set((await all<{ student_id: number }>("SELECT student_id FROM boardings WHERE trip_id = ?", tripId)).map((b) => b.student_id));
export const ridersWithIds = async (routeId: number) => await all<{ student_id: number; stop: string; seq: number; name: string; student_code: string }>(
  `SELECT st.id AS student_id, s.name AS stop, s.seq, u.name, st.student_id AS student_code FROM passes p JOIN route_stops s ON s.id = p.stop_id
   JOIN students st ON st.id = p.student_id JOIN users u ON u.id = st.user_id WHERE p.route_id = ? AND p.semester_id = ? AND p.status = 'active' ORDER BY s.seq, u.name`,
  routeId, (await currentSemester()).id);

// ---------- Daily reminders for expiring licences and papers (TRN-A-3)
export async function expiryReminders() {
  const soon = await expiring();
  if (soon.length) await notify(await usersWithRole("transport_officer"), `${soon.length} transport document${soon.length === 1 ? "" : "s"} expiring soon`,
    soon.slice(0, 4).map((e) => `${e.what} ${e.date}`).join("; "), "/admin/transport");
}
