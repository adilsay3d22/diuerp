# DIU ERP (Phases 0–7)

Next.js full-stack app on SQLite through `@libsql/client`: a local file (`data/erp.db`) in development and tests, **Turso** in production, uploads in **Vercel Blob**. Free deployment: see [DEPLOY.md](DEPLOY.md). Spec: `../University Erp System  – Functional Requirements.md`.

```bash
npm install
npm run dev        # seeds data/erp.db on first run, then http://localhost:3000
npm run seed       # wipe and reseed
npm test           # business rules + workflow integration tests (W1–W4, W7, W8, W10, gateway, help desk, TA scope)
npm run typecheck
node smoke.ts      # with dev server running: renders every page for every role
npm run turso:demo # load the classroom demo into Turso (needs .env.turso, see DEPLOY.md)
```

## Classroom demo

`npm run seed:demo` resets to a small, easy-to-follow dataset (one or two accounts per sector, two courses in sections A and B, one bus route, one open admission cycle). Follow `../DIU-ERP-Demo-Script.pdf`; upload files for the admission part are in `../demo-files`. `rehearse.ts` replays the whole script against a copy of the demo database to prove every step works:

```bash
DB_PATH=/tmp/rehearsal.db node src/lib/seed-demo.ts && DB_PATH=/tmp/rehearsal.db node rehearse.ts
```

`npm run seed` goes back to the full dataset below.

## Seed accounts (synthetic, local only)

Every account's password is `diu12345`. Office accounts use 2-step sign-in: in development the code is shown on the verify page (it is also logged under Super Admin → Email & SMS log).

| Sign in with | Role(s) |
| --- | --- |
| `253-15-0001` | Student (CGPA 4.00, waiver, partly paid) |
| `253-15-0007` | Student with low attendance |
| `253-15-0008` | Student not yet registered for Fall 2026 |
| `710001234` | Teacher + CSE Department Head (use the role switcher) |
| `710001301` | Teacher |
| `REG-0001` | Registrar |
| `EXC-0001` | Exam Controller |
| `CSH-0001` | Cashier |
| `ACC-0001` | Accounts Officer |
| `FIN-0001` | Finance Head |
| `ADM-0001` | Super Admin |
| `ADS-0001` | Admissions Officer |
| `TRO-0001` | Transport Officer |
| `TRN-0001` | Bus driver (Route 05, Bus 12; today's morning trip is live with GPS) |
| `253-15-0002` | Student who is also a Teaching Assistant for CSE221 (switch role) |
| `rahim.uddin@example.com` | Applicant, admission fee paid (ready for the Registrar to enroll) |
| `tasnim.haque@example.com` | Applicant, selected with an open offer |
| `sabbir.rahman@example.com` | Applicant asked to re-upload a document |
| `fahim.kabir@example.com` | Applicant with a draft |

New applicants can self-register at `/apply`. With no email gateway yet, the verification code is shown on the page in development.

## Layout

- `src/modules/*` — one file per module (core, registrar + admission = M1, student = M2, teacher = M3, accounts = M4, transport = M5). A module writes only its own tables; cross-module side effects go through `events.ts` (W1–W5, W7–W9, W11).
- `src/app/actions.ts` — every server action; each re-checks role and scope.
- `src/lib/rules.ts` — pure business rules, tested by `rules.test.ts`.

## Configuration before going live

- **Email and SMS:** `deliver()` in `src/modules/core.ts` logs to the console and the outbox table. Plug in SMTP and an SMS gateway there.
- **Payment gateway:** `/gateway/[token]` is a sandbox stand-in for the provider page. Set `GATEWAY_SECRET` and point `/api/gateway/callback` at SSLCommerz or bKash; the callback is signed and idempotent.
- **Maps:** OpenStreetMap tiles via Leaflet; ETA is straight-line at the bus's speed (15 km/h floor).

## Not built yet

Phase 8 (guardian access, SSO, Bengali, dark mode, digital ID card, SOS, syllabus tracker, teacher leave). Real email/SMS/payment providers (see above) and virus scanning on uploads.
