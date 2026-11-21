# API Contract — KotaLabs CRM Backend

Base URL (local): `http://localhost:4000`
All JSON responses use one error shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

## Authentication

Two credential types:

| Type | Header | Used by |
|---|---|---|
| User JWT (access token, 60 min) | `Authorization: Bearer <token>` | Web CRM |
| Device token (`dvc_...`) | `Authorization: Bearer <token>` | Android app |

Login returns an access token + a rotating refresh token. Refresh tokens are
single-use: presenting a revoked one revokes **all** sessions of that user.

## Endpoints

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/healthz` | none | Liveness probe |

### Auth — `/api/auth`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/login` | none | `{email, password}` → `{accessToken, refreshToken, expiresIn, user}` |
| POST | `/refresh` | none | `{refreshToken}` → new token pair (rotates) |
| POST | `/logout` | none | `{refreshToken}` → 204 |
| GET | `/me` | user | Current profile |
| POST | `/change-password` | user | `{currentPassword, newPassword}` → 204, revokes all sessions |

### Users (admin only) — `/api/v1/users`
| Method | Path | Description |
|---|---|---|
| GET | `/` | List users (`?role=&status=&search=`) |
| GET | `/:id` | One user |
| POST | `/` | Create user `{email, password, name, role}` |
| PATCH | `/:id` | Update `{name?, role?, status?, password?}` |
| DELETE | `/:id` | Soft delete (disable + revoke sessions/devices). Cannot delete self or the last active admin. |

### Devices — `/api/v1/devices`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | user | Register a phone → `{device, deviceToken}` (token shown **once**) |
| GET | `/` | user | List (employees: own only; admin: all) |
| POST | `/:id/revoke` | admin | Revoke a device (lost phone) |

### Leads — `/api/v1/leads`
Employees see leads assigned to them + unassigned leads. Admins see all.

| Method | Path | Description |
|---|---|---|
| GET | `/` | List. Query: `page, pageSize, status, source, assignedUserId, unassigned, search, from, to, sort` |
| GET | `/:id` | One lead |
| POST | `/` | Create lead. Phone is normalized to E.164. Duplicate open lead → `409 DUPLICATE_LEAD` |
| PATCH | `/:id` | Update fields. `status: LOST` requires `lostReason`. Status/assignment changes write activities |
| DELETE | `/:id` | Admin only. Hard delete (activities cascade) |
| GET | `/:id/activities` | Timeline (paginated) |
| POST | `/:id/activities` | Add note/activity `{type, body}` |
| POST | `/:id/followups` | Schedule follow-up `{dueAt, assignedUserId?, notes?}` |

Lead statuses: `NEW, CONTACTED, INTERESTED, FOLLOW_UP, CONVERTED, LOST`
Lead sources: `INSTAGRAM, YOUTUBE, GOOGLE_ADS, WHATSAPP, PHONE_CALL, WALK_IN,
REFERRAL, MANUAL, OTHER`

### Call events — `/api/v1/call-events`
Accepts a user JWT **or** a device token.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | user or device | Single event or `{events: [...]}` batch (max 500). Per-item results: `created` / `duplicate` / error |
| GET | `/` | user | List (employees: own calls, or all calls on a lead they can access when `leadId` is supplied). Query: `page, pageSize, phone, direction, source, userId, deviceId, leadId, unmatched, from, to` |

Event fields (camelCase; snake_case aliases also accepted):
`eventId` (UUID, idempotency key), `phoneNumber`, `direction`
(INCOMING/OUTGOING/MISSED/REJECTED/UNKNOWN), `source` (SIM/WHATSAPP/MANUAL),
`captureMethod` (CALL_LOG/CALL_SCREENING/MANUAL), `startedAt` (ISO datetime
with offset), `durationSeconds`, `simSlot` (1|2), `notes`, `leadId?`,
`deviceId?`.

Rules:
- Duplicate `eventId` → returns the existing row, never a second row.
- With `CALL_EVENT_AUTO_LINK_LEAD=true`, calls link to the most recent open lead with the same phone number.
- `CALL_EVENT_AUTO_CREATE_LEAD` defaults to `false`. When explicitly enabled, authenticated device-originated incoming, outgoing and missed SIM calls create an assigned lead if no open lead matches. Previous visible closed leads produce a “Returning contact” source detail. Manual and WhatsApp calls never auto-create leads. Outgoing calls can include personal numbers, so enrollment requires explicit informed consent. Do not enable until Android sync and real-device testing are complete.
- Lead details include up to 25 earlier matching leads visible to the requesting user (`previousLeads`).
- Unavailable fields stay `null` — the server never invents call data.

### Follow-ups — `/api/v1/followups`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | user | List (employees: own). Query: `page, pageSize, status, assignedUserId, leadId, overdue, from, to` |
| POST | `/:id/complete` | user | `{completionNotes?}` → COMPLETED |
| POST | `/:id/cancel` | user | `{reason?}` → CANCELLED |

### Reports — `/api/v1/reports`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/summary` | user | Dashboard payload: totals, by-status, by-source (with conversion rate), per-employee performance. Query: `date (YYYY-MM-DD), userId (admin)` |
| GET | `/leads.csv` | user | CSV export (Excel-ready, UTF-8 BOM). Query: `status, source, assignedUserId, search, from, to, limit` |

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Body/query/params failed validation (`details` lists fields) |
| `BAD_REQUEST` | 400 | Malformed request |
| `UNAUTHORIZED` / `INVALID_CREDENTIALS` / `TOKEN_EXPIRED` / `INVALID_TOKEN` / `ACCOUNT_DISABLED` / `DEVICE_REVOKED` | 401 | Authentication failures |
| `FORBIDDEN` | 403 | Authenticated but not allowed (e.g. employee hitting admin route) |
| `NOT_FOUND` | 404 | Resource doesn't exist (or isn't visible to this user) |
| `CONFLICT` / `DUPLICATE_LEAD` / `DUPLICATE_DEVICE` | 409 | State conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

## Rate limits

- Global: 600 requests / 15 min per IP (configurable).
- Auth endpoints: 20 attempts / 15 min per IP (successful requests excluded).

### Android test sync gate and self-revocation

- `GET /api/v1/call-sync/capability` requires a user JWT and reports `{ enabled: boolean }`. The test app refuses enrollment when this is false or the endpoint is missing.
- `POST /api/v1/call-sync/events` accepts only a device token and the existing event/batch format; it returns 503 when `CALL_EVENT_AUTO_CREATE_LEAD` is false. This does not disable the older call-events API.
- `POST /api/v1/devices/self/revoke` requires a device token and revokes that token. If offline, an administrator must revoke the device instead.
