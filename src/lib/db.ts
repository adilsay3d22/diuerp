// SQLite everywhere: a local file in development and tests, Turso (hosted libSQL) in production.
// Same client and same SQL in both, so local tests exercise the production code path.
import { createClient, type Client, type InValue, type Transaction } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const SCHEMA = `

-- CORE
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, uni_id TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  phone TEXT, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', blood_group TEXT, emergency_contact TEXT, mfa_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS user_roles (user_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL, dept_id INTEGER,
  PRIMARY KEY (user_id, role));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL, expires_at TEXT NOT NULL,
  mfa_pending INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
  before TEXT, after TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL,
  audience TEXT NOT NULL, audience_ref TEXT, posted_by INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL,
  body TEXT, href TEXT, read INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'general', at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, type TEXT, size INTEGER,
  uploaded_by INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now')));

-- M1 Admission & Registrar
CREATE TABLE IF NOT EXISTS faculties (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY, faculty_id INTEGER REFERENCES faculties(id), code TEXT UNIQUE NOT NULL,
  short TEXT NOT NULL, name TEXT NOT NULL, head_user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS programs (id INTEGER PRIMARY KEY, dept_id INTEGER NOT NULL REFERENCES departments(id), name TEXT NOT NULL,
  degree TEXT NOT NULL, total_credits REAL NOT NULL);
CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY, dept_id INTEGER REFERENCES departments(id), code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL, credits REAL NOT NULL, type TEXT NOT NULL DEFAULT 'theory');
CREATE TABLE IF NOT EXISTS course_prereqs (course_id INTEGER NOT NULL REFERENCES courses(id), prereq_id INTEGER NOT NULL REFERENCES courses(id),
  PRIMARY KEY (course_id, prereq_id));
CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, capacity INTEGER NOT NULL, type TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS time_slots (id INTEGER PRIMARY KEY, day TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL, UNIQUE(day, start));
CREATE TABLE IF NOT EXISTS semesters (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, start_date TEXT NOT NULL,
  end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'upcoming', reg_open INTEGER NOT NULL DEFAULT 0, adddrop_open INTEGER NOT NULL DEFAULT 0,
  withdraw_open INTEGER NOT NULL DEFAULT 0, due_date TEXT);
CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY, semester_id INTEGER NOT NULL REFERENCES semesters(id), type TEXT NOT NULL,
  title TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id), student_id TEXT UNIQUE NOT NULL,
  reg_id TEXT UNIQUE NOT NULL, program_id INTEGER NOT NULL REFERENCES programs(id), batch TEXT NOT NULL, section TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', admitted_semester_id INTEGER REFERENCES semesters(id));
CREATE TABLE IF NOT EXISTS teachers (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id), employee_id TEXT UNIQUE NOT NULL,
  dept_id INTEGER NOT NULL REFERENCES departments(id), designation TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS offerings (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id), semester_id INTEGER NOT NULL REFERENCES semesters(id),
  section TEXT NOT NULL, teacher_id INTEGER REFERENCES teachers(id), proposed_teacher_id INTEGER REFERENCES teachers(id), capacity INTEGER NOT NULL,
  UNIQUE(course_id, semester_id, section));
CREATE TABLE IF NOT EXISTS offering_slots (offering_id INTEGER NOT NULL REFERENCES offerings(id), slot_id INTEGER NOT NULL REFERENCES time_slots(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id), PRIMARY KEY (offering_id, slot_id));

-- M2 Student
CREATE TABLE IF NOT EXISTS enrollments (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), offering_id INTEGER NOT NULL REFERENCES offerings(id),
  type TEXT NOT NULL DEFAULT 'regular', status TEXT NOT NULL, reason TEXT, by_user INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), offering_id INTEGER NOT NULL REFERENCES offerings(id),
  total_c INTEGER NOT NULL, letter TEXT NOT NULL, gp_c INTEGER NOT NULL, reason TEXT, by_user INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS evaluations (student_id INTEGER NOT NULL REFERENCES students(id), offering_id INTEGER NOT NULL REFERENCES offerings(id),
  rating INTEGER NOT NULL, comment TEXT, answers_json TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (student_id, offering_id));
CREATE TABLE IF NOT EXISTS grade_changes (id INTEGER PRIMARY KEY, offering_id INTEGER NOT NULL, student_id INTEGER NOT NULL, old_total_c INTEGER NOT NULL,
  new_total_c INTEGER NOT NULL, reason TEXT NOT NULL, requested_by INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', decided_by INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now')));

-- M3 Teacher
CREATE TABLE IF NOT EXISTS attendance_sessions (id INTEGER PRIMARY KEY, offering_id INTEGER NOT NULL REFERENCES offerings(id), date TEXT NOT NULL,
  slot_id INTEGER NOT NULL REFERENCES time_slots(id), room_id INTEGER REFERENCES rooms(id), taken_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(offering_id, date, slot_id));
CREATE TABLE IF NOT EXISTS attendance_records (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES attendance_sessions(id),
  student_id INTEGER NOT NULL REFERENCES students(id), status TEXT NOT NULL, reason TEXT, entered_by INTEGER, approved INTEGER NOT NULL DEFAULT 1,
  approved_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS assessments (id INTEGER PRIMARY KEY, offering_id INTEGER NOT NULL REFERENCES offerings(id), type TEXT NOT NULL,
  title TEXT NOT NULL, max_marks REAL NOT NULL, weight REAL NOT NULL, published INTEGER NOT NULL DEFAULT 0, instructions TEXT, due_at TEXT);
CREATE TABLE IF NOT EXISTS marks (id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id), student_id INTEGER NOT NULL REFERENCES students(id),
  score_c INTEGER, feedback TEXT, entered_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id), student_id INTEGER NOT NULL REFERENCES students(id),
  file_id INTEGER REFERENCES files(id), note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS gradesheets (offering_id INTEGER PRIMARY KEY REFERENCES offerings(id), status TEXT NOT NULL DEFAULT 'draft',
  comment TEXT, submitted_at TEXT, approved_by INTEGER, published_at TEXT);
CREATE TABLE IF NOT EXISTS materials (id INTEGER PRIMARY KEY, offering_id INTEGER NOT NULL REFERENCES offerings(id), week INTEGER NOT NULL,
  title TEXT NOT NULL, kind TEXT NOT NULL, url TEXT, file_id INTEGER REFERENCES files(id), at TEXT NOT NULL DEFAULT (datetime('now')));

-- M4 Accounts (whole taka integers)
CREATE TABLE IF NOT EXISTS fee_structures (id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL REFERENCES programs(id), head TEXT NOT NULL,
  amount INTEGER NOT NULL, created_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY, student_id INTEGER REFERENCES students(id), application_id INTEGER, semester_id INTEGER NOT NULL REFERENCES semesters(id),
  due_date TEXT NOT NULL, UNIQUE(student_id, semester_id));
CREATE TABLE IF NOT EXISTS invoice_lines (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), head TEXT NOT NULL,
  description TEXT NOT NULL, amount INTEGER NOT NULL, ref TEXT, by_user INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, receipt_no TEXT UNIQUE NOT NULL, student_id INTEGER REFERENCES students(id), application_id INTEGER,
  amount INTEGER NOT NULL, method TEXT NOT NULL, channel TEXT NOT NULL, reference TEXT, cashier_id INTEGER, reverses_id INTEGER REFERENCES payments(id),
  at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS approvals (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER, student_id INTEGER, semester_id INTEGER,
  amount INTEGER, percent REAL, detail TEXT, reason TEXT NOT NULL, requested_by INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER, decided_at TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS clearance_exceptions (student_id INTEGER NOT NULL, semester_id INTEGER NOT NULL, exam TEXT NOT NULL, granted_by INTEGER,
  reason TEXT, PRIMARY KEY (student_id, semester_id, exam));
CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY, cashier_id INTEGER NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT NOT NULL,
  system_json TEXT NOT NULL, counted_json TEXT NOT NULL, difference INTEGER NOT NULL);

-- M1 Admission (applicants are users with the applicant role; applications are separate from students)
CREATE TABLE IF NOT EXISTS otps (user_id INTEGER PRIMARY KEY REFERENCES users(id), code TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admission_cycles (id INTEGER PRIMARY KEY, name TEXT NOT NULL, intake_semester_id INTEGER NOT NULL REFERENCES semesters(id),
  deadline TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', docs_json TEXT NOT NULL, fields_json TEXT NOT NULL, test_date TEXT, created_by INTEGER);
CREATE TABLE IF NOT EXISTS cycle_programs (cycle_id INTEGER NOT NULL REFERENCES admission_cycles(id), program_id INTEGER NOT NULL REFERENCES programs(id),
  seats INTEGER NOT NULL, PRIMARY KEY (cycle_id, program_id));
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), cycle_id INTEGER NOT NULL REFERENCES admission_cycles(id),
  program_id INTEGER NOT NULL REFERENCES programs(id), status TEXT NOT NULL DEFAULT 'draft', data_json TEXT NOT NULL DEFAULT '{}', reason TEXT,
  test_slot TEXT, test_room TEXT, test_score REAL, merit_rank INTEGER, student_id INTEGER REFERENCES students(id),
  submitted_at TEXT, decided_at TEXT, accepted_at TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, cycle_id));
CREATE TABLE IF NOT EXISTS application_docs (id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id), name TEXT NOT NULL,
  file_id INTEGER REFERENCES files(id), status TEXT NOT NULL DEFAULT 'pending', note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));

-- M5 Transport
CREATE TABLE IF NOT EXISTS routes (id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, name TEXT NOT NULL, distance_km REAL, fee INTEGER NOT NULL,
  return_time TEXT NOT NULL DEFAULT '16:30', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS route_stops (id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id), seq INTEGER NOT NULL, name TEXT NOT NULL,
  pickup_time TEXT NOT NULL, drop_time TEXT, lat REAL, lng REAL);
CREATE TABLE IF NOT EXISTS crew (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id), kind TEXT NOT NULL, licence_no TEXT, licence_expiry TEXT);
CREATE TABLE IF NOT EXISTS buses (id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, registration TEXT NOT NULL, capacity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', route_id INTEGER REFERENCES routes(id), driver_id INTEGER REFERENCES crew(id), assistant_id INTEGER REFERENCES crew(id),
  fitness_expiry TEXT, insurance_expiry TEXT);
CREATE TABLE IF NOT EXISTS passes (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), semester_id INTEGER NOT NULL REFERENCES semesters(id),
  route_id INTEGER NOT NULL REFERENCES routes(id), stop_id INTEGER NOT NULL REFERENCES route_stops(id), bus_id INTEGER REFERENCES buses(id),
  status TEXT NOT NULL, note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS pass_requests (id INTEGER PRIMARY KEY, pass_id INTEGER NOT NULL REFERENCES passes(id), kind TEXT NOT NULL, route_id INTEGER, stop_id INTEGER,
  reason TEXT, status TEXT NOT NULL DEFAULT 'pending', decided_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS trips (id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id), bus_id INTEGER REFERENCES buses(id), date TEXT NOT NULL,
  direction TEXT NOT NULL, scheduled TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', started_at TEXT, ended_at TEXT, delay_min INTEGER, note TEXT,
  UNIQUE(route_id, date, direction));
CREATE TABLE IF NOT EXISTS trip_reports (id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id), kind TEXT NOT NULL, note TEXT NOT NULL,
  file_id INTEGER REFERENCES files(id), by_user INTEGER, resolved INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now')));

-- CORE (Phase 7): delivery, preferences, help desk, messaging, delegation, jobs
CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), channel TEXT NOT NULL, to_addr TEXT NOT NULL, subject TEXT NOT NULL,
  body TEXT, status TEXT NOT NULL DEFAULT 'sent', at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notification_prefs (user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, email INTEGER NOT NULL DEFAULT 1,
  sms INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, category));
CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id), office TEXT NOT NULL, category TEXT NOT NULL,
  subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', assignee_id INTEGER REFERENCES users(id), sla_due TEXT NOT NULL, ref TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
CREATE TABLE IF NOT EXISTS ticket_messages (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id), user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, file_id INTEGER REFERENCES files(id), internal INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS threads (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL, offering_id INTEGER REFERENCES offerings(id),
  created_by INTEGER NOT NULL REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS thread_members (thread_id INTEGER NOT NULL REFERENCES threads(id), user_id INTEGER NOT NULL REFERENCES users(id),
  last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (thread_id, user_id));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads(id), user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS delegations (id INTEGER PRIMARY KEY, teacher_user_id INTEGER NOT NULL REFERENCES users(id), ta_user_id INTEGER NOT NULL REFERENCES users(id),
  offering_id INTEGER NOT NULL REFERENCES offerings(id), scope TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS job_runs (job TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (job, day));

-- M2 (Phase 7): services, exams, evaluations, mentoring
CREATE TABLE IF NOT EXISTS student_requests (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), kind TEXT NOT NULL,
  offering_id INTEGER REFERENCES offerings(id), target_offering_id INTEGER REFERENCES offerings(id), detail TEXT, status TEXT NOT NULL,
  note TEXT, decided_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS exams (id INTEGER PRIMARY KEY, semester_id INTEGER NOT NULL REFERENCES semesters(id), stage TEXT NOT NULL,
  offering_id INTEGER NOT NULL REFERENCES offerings(id), date TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL, rooms TEXT,
  UNIQUE(stage, offering_id));
CREATE TABLE IF NOT EXISTS seat_plans (exam_id INTEGER NOT NULL REFERENCES exams(id), student_id INTEGER NOT NULL REFERENCES students(id),
  room TEXT NOT NULL, seat INTEGER NOT NULL, PRIMARY KEY (exam_id, student_id));
CREATE TABLE IF NOT EXISTS question_papers (id INTEGER PRIMARY KEY, exam_id INTEGER NOT NULL REFERENCES exams(id), file_id INTEGER NOT NULL REFERENCES files(id),
  uploaded_by INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS eval_forms (semester_id INTEGER PRIMARY KEY REFERENCES semesters(id), questions_json TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mentors (student_id INTEGER PRIMARY KEY REFERENCES students(id), teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  assigned_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS mentor_slots (id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL REFERENCES teachers(id), start_at TEXT NOT NULL, minutes INTEGER NOT NULL,
  place TEXT NOT NULL, student_id INTEGER REFERENCES students(id), topic TEXT);
CREATE TABLE IF NOT EXISTS mentor_meetings (id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL REFERENCES teachers(id), student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL, reason TEXT NOT NULL, action TEXT, next_meeting TEXT, file_id INTEGER REFERENCES files(id), at TEXT NOT NULL DEFAULT (datetime('now')));

-- M4 (Phase 7): waivers, scholarships, plans, gateway, reconciliation
CREATE TABLE IF NOT EXISTS waiver_rules (id INTEGER PRIMARY KEY, name TEXT NOT NULL, min_sgpa REAL NOT NULL, min_credits REAL NOT NULL, percent REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS waiver_grants (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), semester_id INTEGER NOT NULL REFERENCES semesters(id),
  source TEXT NOT NULL, percent REAL NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(student_id, semester_id, source));
CREATE TABLE IF NOT EXISTS circulars (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, semester_id INTEGER NOT NULL REFERENCES semesters(id),
  percent REAL NOT NULL, deadline TEXT NOT NULL, created_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS scholarship_apps (id INTEGER PRIMARY KEY, circular_id INTEGER NOT NULL REFERENCES circulars(id), student_id INTEGER NOT NULL REFERENCES students(id),
  statement TEXT NOT NULL, file_id INTEGER REFERENCES files(id), status TEXT NOT NULL DEFAULT 'submitted', decided_by INTEGER, note TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(circular_id, student_id));
CREATE TABLE IF NOT EXISTS installment_plans (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), semester_id INTEGER NOT NULL REFERENCES semesters(id),
  schedule_json TEXT NOT NULL, approval_id INTEGER REFERENCES approvals(id), status TEXT NOT NULL DEFAULT 'pending', at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS gateway_sessions (token TEXT PRIMARY KEY, student_id INTEGER, application_id INTEGER, amount INTEGER NOT NULL, method TEXT NOT NULL,
  return_to TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'initiated', txn_id TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY, txn_id TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL, settled_on TEXT NOT NULL, gateway TEXT NOT NULL,
  imported_by INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS bank_deposits (id INTEGER PRIMARY KEY, deposited_on TEXT NOT NULL, amount INTEGER NOT NULL, bank_ref TEXT NOT NULL, note TEXT,
  by_user INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));

-- M5 (Phase 7): live location and boarding
CREATE TABLE IF NOT EXISTS trip_positions (id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id), lat REAL NOT NULL, lng REAL NOT NULL,
  speed REAL, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS boardings (trip_id INTEGER NOT NULL REFERENCES trips(id), student_id INTEGER NOT NULL REFERENCES students(id), stop_id INTEGER,
  method TEXT NOT NULL, by_user INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (trip_id, student_id));
`;

// TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) in production; otherwise the local file at DB_PATH or data/erp.db.
export const DB_URL = process.env.TURSO_DATABASE_URL || `file:${process.env.DB_PATH ?? "data/erp.db"}`;
const local = DB_URL.startsWith("file:");

async function open() {
  if (local) mkdirSync(dirname(DB_URL.slice(5)), { recursive: true });
  const c = createClient({ url: DB_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  if (local) await c.executeMultiple("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  await c.executeMultiple(SCHEMA);
  const has = async (t: string, col: string) => (await c.execute({ sql: "SELECT 1 FROM pragma_table_info(?) WHERE name = ?", args: [t, col] })).rows.length > 0;
  if (!(await has("invoices", "application_id")) || !(await has("notifications", "category")))
    throw new Error("The database is from an older build. Run `npm run seed` to rebuild it.");
  return c;
}
type G = typeof globalThis & { __db?: Promise<Client> };
export const db = () => ((globalThis as G).__db ??= open().catch((e) => { (globalThis as G).__db = undefined; throw e; }));

// Wipe everything (seed scripts only): delete the local file, or drop every table on Turso.
export async function resetDatabase() {
  const g = globalThis as G;
  if (g.__db) (await g.__db.catch(() => null))?.close();
  g.__db = undefined;
  if (local) {
    const f = DB_URL.slice(5);
    for (const x of [f, `${f}-wal`, `${f}-shm`]) rmSync(x, { force: true });
    return;
  }
  const c = createClient({ url: DB_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%'")).rows.map((r) => String(r.name));
  if (tables.length) await c.executeMultiple(`PRAGMA foreign_keys = OFF; ${tables.map((t) => `DROP TABLE IF EXISTS "${t}";`).join(" ")}`);
  c.close();
}

// Inside tx(), every helper runs on the open transaction; outside, on the shared client.
const current = new AsyncLocalStorage<Transaction>();
const conn = async () => current.getStore() ?? (await db());

type P = InValue | undefined;
// Same binding rules as the old node:sqlite driver: NaN, Infinity and undefined are stored as NULL.
const args = (p: P[]): InValue[] => p.map((v) => (v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? null : v));
const exec = async (sql: string, p: P[]) => (await conn()).execute({ sql, args: args(p) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const all = async <T = any>(sql: string, ...p: P[]) => (await exec(sql, p)).rows.map((r) => ({ ...r })) as T[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const get = async <T = any>(sql: string, ...p: P[]) => (await all<T>(sql, ...p))[0] as T | undefined;
export const run = async (sql: string, ...p: P[]) => {
  const r = await exec(sql, p);
  return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid };
};
export const insert = async (sql: string, ...p: P[]) => Number((await run(sql, ...p)).lastInsertRowid);

// Sequential map and filter: keep writes in order (ids, receipt numbers) where Promise.all would interleave them.
export async function each<T, R>(xs: readonly T[], f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i++) out.push(await f(xs[i], i));
  return out;
}
export async function keep<T>(xs: readonly T[], f: (x: T, i: number) => Promise<boolean>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < xs.length; i++) if (await f(xs[i], i)) out.push(xs[i]);
  return out;
}

// All-or-nothing unit of work. Nested calls join the outer transaction.
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (current.getStore()) return fn();
  const t = await (await db()).transaction("write");
  try {
    const r = await current.run(t, fn);
    await t.commit();
    return r;
  } catch (e) {
    await t.rollback().catch(() => {});
    throw e;
  } finally {
    t.close();
  }
}

export async function setting(key: string, fallback: string) {
  return (await get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key))?.value ?? fallback;
}
export const num = async (key: string, fallback: number) => Number(await setting(key, String(fallback)));

export async function audit(actor: number | null, action: string, entity: string, id: unknown, before?: unknown, after?: unknown) {
  await run("INSERT INTO audit_log (actor_id, action, entity, entity_id, before, after) VALUES (?,?,?,?,?,?)",
    actor, action, entity, String(id ?? ""), before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after));
}

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
export function checkPassword(pw: string, stored: string) {
  const [salt, h] = stored.split(":");
  const a = Buffer.from(h, "hex");
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

// One-time codes appear on screen in development, or in production when DEMO_SHOW_CODES=1 (no email/SMS provider yet).
export const showCodes = () => process.env.NODE_ENV !== "production" || process.env.DEMO_SHOW_CODES === "1";

// University runs on Dhaka time.
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
export const weekday = (d = new Date()) => d.toLocaleDateString("en-US", { timeZone: "Asia/Dhaka", weekday: "short" });
// Parse a Dhaka-local "YYYY-MM-DDTHH:MM" (from <input type="datetime-local">) as an instant.
export const dhaka = (local: string) => new Date(`${local.slice(0, 16)}:00+06:00`);
export const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
