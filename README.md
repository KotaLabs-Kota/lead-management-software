# KotaLabs CRM — Lead Management System

Centralized CRM and lead management system for **Multani Motor Body Makers,
Kota, Rajasthan**, developed and maintained by **KotaLabs**.

The system brings every customer enquiry — Instagram, YouTube / Google Ads,
SIM phone calls, WhatsApp calls, and manual enquiries — into one database,
with lead assignment, status tracking, follow-ups, call history, reports, and
CSV export.

## Project status

| Stage | Scope | Status |
|---|---|---|
| 1 | Requirements & device audit | In progress (phone models/versions to confirm) |
| **2** | **Backend + database** | **Done — this repo** |
| 3 | Web CRM (Next.js) | Next |
| 4 | Android feasibility prototype | After Stage 3 |
| 5 | Android sync | After feasibility confirmed |
| 6 | Meta / Google Ads integrations | After eligibility verified |
| 7 | Deployment & security | — |
| 8 | Pilot & handover | — |

## Technology stack

- **Frontend (Stage 3):** Next.js, React, TypeScript, Tailwind CSS
- **Backend (this stage):** Node.js 22, Express 4, TypeScript, REST APIs
- **Database:** PostgreSQL 16
- **Android (Stages 4–5):** Kotlin, Jetpack Compose, Room, WorkManager, Retrofit
- **Hosting (Stage 7):** Ubuntu VPS, Docker Compose, Nginx, Let's Encrypt
- **Backups:** Cloudflare R2

No Firebase/Supabase, no paid services. Estimated infrastructure budget:
₹1,500/month.

## Repository layout

```
.
├── apps/
│   └── backend/                  # Node.js + Express + TypeScript API
│       ├── src/
│       │   ├── config/           # Environment validation (zod)
│       │   ├── db/               # PostgreSQL pool + transaction helpers
│       │   ├── lib/              # Logger (pino)
│       │   ├── middleware/       # Auth, device auth, validation, errors, rate limits
│       │   ├── modules/          # auth, users, devices, leads, call-events,
│       │   │                     #   followups, reports
│       │   ├── types/            # Domain constants + Express augmentation
│       │   ├── utils/            # Errors, JWT, passwords (scrypt), phones, tokens
│       │   ├── app.ts            # Express app factory
│       │   └── server.ts         # Entry point with graceful shutdown
│       ├── scripts/              # migrate.ts, seed.ts
│       ├── migrations/           # SQL migrations (0001_init.sql)
│       ├── tests/                # Vitest + embedded Postgres
│       ├── Dockerfile
│       └── .env.example
├── docs/
│   ├── api-contract.md           # Full API reference
│   └── database-schema.md        # Schema documentation
├── postman/
│   └── kotalabs-crm.postman_collection.json
├── docker-compose.yml            # Local dev stack (backend + postgres)
└── package.json                  # npm workspaces
```

## Quick start (local development)

Prerequisites: Node.js ≥ 20.11, npm. No local PostgreSQL needed for tests
(embedded Postgres is used), but for running the server you need a database —
either via Docker Compose or a local install.

### Option A — Docker Compose

```bash
docker compose up --build        # starts postgres + backend on :4000
docker compose exec backend npm run db:migrate
docker compose exec backend npm run db:seed
```

### Option B — Local Node + PostgreSQL

```bash
npm install

# 1. Configure the environment
cp apps/backend/.env.example apps/backend/.env
# Edit apps/backend/.env — set DATABASE_URL and JWT_ACCESS_SECRET
#   (generate one with: openssl rand -hex 32)

# 2. Create the database and apply migrations
createdb kotalabs_crm            # or use any existing PostgreSQL
npm run db:migrate

# 3. Seed the initial accounts
SEED_ADMIN_EMAIL=admin@kotalabs.local \
SEED_ADMIN_PASSWORD=Admin@12345 \
SEED_EMPLOYEE_PASSWORD=Employee@12345 \
npm run db:seed

# 4. Start the server
npm run dev                      # http://localhost:4000
```

Seeded accounts (change these passwords immediately):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@kotalabs.local` | `Admin@12345` |
| Employee 1 | `employee1@multanimotors.example` | from `SEED_EMPLOYEE_PASSWORD` |
| Employee 2 | `employee2@multanimotors.example` | from `SEED_EMPLOYEE_PASSWORD` |

## Testing

```bash
npm test          # 36 end-to-end tests against a real embedded PostgreSQL
npm run typecheck # strict TypeScript check
npm run build     # production build
```

## API overview

Full reference: [docs/api-contract.md](docs/api-contract.md).
Schema reference: [docs/database-schema.md](docs/database-schema.md).
Postman collection: [postman/kotalabs-crm.postman_collection.json](postman/kotalabs-crm.postman_collection.json)
(import it, run **Login (admin)** first — tokens are saved automatically).

Key endpoints:

```
POST /api/auth/login                     → access + refresh tokens
POST /api/auth/refresh                   → rotating refresh tokens
GET  /api/v1/leads                       → list (filters, search, pagination)
POST /api/v1/leads                       → create (phone normalized to E.164)
PATCH /api/v1/leads/:id                  → update status / assignment / details
POST /api/v1/leads/:id/activities        → notes & timeline
POST /api/v1/leads/:id/followups         → schedule follow-up
POST /api/v1/call-events                 → single or batch ingest (user JWT or device token)
GET  /api/v1/call-events                 → call history
GET  /api/v1/followups                   → pending / overdue follow-ups
GET  /api/v1/reports/summary             → dashboard numbers
GET  /api/v1/reports/leads.csv           → Excel-ready CSV export
POST /api/v1/devices/register            → register an Android phone (token shown once)
```

## Design decisions

- **Raw `pg` + hand-written SQL migrations** instead of an ORM — full control,
  no build tooling, easy to audit. Migrations run transactionally and are
  tracked in `schema_migrations`.
- **Status columns are `text` + CHECK constraints**, not native enums, so new
  statuses are cheap migrations.
- **Phone numbers are normalized to E.164** (`libphonenumber-js`, default
  region IN) so `98765 43210`, `+91 98765 43210`, and `09876543210` all match
  the same lead.
- **Duplicate-lead guard:** an open lead for the same phone blocks a new one
  (`409 DUPLICATE_LEAD`). Closed leads (CONVERTED/LOST) don't block a fresh
  enquiry.
- **Call events:** With `CALL_EVENT_AUTO_LINK_LEAD=true`, they link to an open lead with the same number. Optional device call lead creation is controlled by `CALL_EVENT_AUTO_CREATE_LEAD` (default `false`); enable only after Android sync and real-device testing. Unavailable fields stay `null` — the server never invents call data.
- **Idempotency:** `call_events.event_id` (client UUID) is unique, so Android
  sync retries never duplicate a call. Social leads are deduplicated by
  `(source, platform_lead_id)`.
- **Auth:** short-lived JWT access tokens (60 min) + rotating refresh tokens
  stored hashed. Refresh-token reuse revokes all sessions (theft detection).
- **Devices:** each Android phone gets its own `dvc_...` token, stored only as
  a SHA-256 hash. A lost phone is revoked without touching the employee's web
  session.
- **Passwords:** scrypt from the Node standard library (no native build step
  on the VPS).
- **Roles:** `ADMIN` and `EMPLOYEE`. Employees only see leads assigned to them
  (plus unassigned ones) and their own calls/follow-ups.

## Security

HTTPS (Stage 7), hashed passwords, role-based access, device tokens, input
validation on every endpoint, rate limiting (global + stricter on auth),
webhook verification (Stage 6), encrypted backups (Stage 7), audit logs,
lost-device revocation, and a data-retention policy. **No call recordings —
only permitted call metadata is stored.**

## Important constraints (from the master brief)

- Android automatic call tracking must be verified on both real client phones
  before building the full sync (Stage 4). No Accessibility hacks or
  permission bypasses.
- WhatsApp consumer calls are logged **manually** — automatic tracking is not
  possible.
- Meta/Google integrations are only promised after platform eligibility and
  access are verified (Stage 6).
- One stage at a time: Stage 3 (web CRM) starts after Stage 2 is tested.

### Password-change notifications: deployment

Password-change notifications are **disabled by default** to keep password changes
working during a rolling deployment. Enable them separately for each environment
only after its database migration and backend deployment are complete. There is no
backfill: changes made before enabling notifications are not recorded. Once enabled,
if notification storage fails, the password change is rolled back rather than
silently losing the event. The notification contains user/actor identities and time,
never passwords, password hashes, or tokens. Read status is per administrator.

1. Back up the target database and confirm the target is the correct test or
   production Neon database. Using a trusted local checkout with Node and dev
   dependencies installed, securely set `DATABASE_URL` to that database's connection
   string (do not paste credentials into chat or commit them). Run
   `npm run db:migrate` from the repository root. Confirm `0002_password_notifications.sql`
   applied successfully. The runner tracks migrations in `schema_migrations`; if the
   original schema was applied manually rather than by the runner, reconcile its
   migration history first instead of blindly running it. The production Docker image
   does not include `tsx`, so its `npm run db:migrate` is not a migration runner.
2. Deploy the backend containing this change to the target Render service. Set its
   environment variable `PASSWORD_CHANGE_NOTIFICATIONS_ENABLED=true` and redeploy.
   Keep it unset/false until the migration is confirmed. Repeat separately for live;
   do not point test and production at the same database.
3. Deploy the matching web frontend (Vercel preview for testing). Log in as an admin,
   make a test password change, and check the bell in the header. A frontend from an
   older branch will not show the bell. Employees cannot access notification APIs.

Only enable the production setting as part of an approved production rollout.
