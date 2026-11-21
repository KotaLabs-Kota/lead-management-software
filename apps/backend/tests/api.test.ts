/**
 * End-to-end API tests against a real PostgreSQL database.
 *
 * Run with: npm test
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closePool } from '../src/db/pool';
import { seedUsers, startTestDatabase, stopTestDatabase } from './setup';

const app = createApp();

let adminToken = '';
let employeeToken = '';
let employee2Token = '';
let adminId = '';
let employeeId = '';
let employee2Id = '';
let leadId = '';
let followupId = '';
let deviceId = '';
let deviceToken = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  await startTestDatabase();
  const users = await seedUsers();
  adminId = users.admin.id;
  employeeId = users.employee.id;
  employee2Id = users.employee2.id;
  adminToken = await login(users.admin.email, users.admin.password);
  employeeToken = await login(users.employee.email, users.employee.password);
  employee2Token = await login(users.employee2.email, users.employee2.password);
}, 120_000);

afterAll(async () => {
  await closePool();
  await stopTestDatabase();
});

describe('health', () => {
  it('GET /healthz returns ok', async () => {
    const res = await request(app).get('/healthz').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('unknown route returns 404 JSON', async () => {
    const res = await request(app).get('/api/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('auth', () => {
  it('rejects login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'wrong-password' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login with invalid body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/auth/me requires a token', async () => {
    await request(app).get('/api/auth/me').expect(401);
  });

  it('GET /api/auth/me returns the current user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.user.email).toBe('admin@test.local');
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('refresh rotates the refresh token and rejects reuse', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employee@test.local', password: 'EmployeePass123!' })
      .expect(200);
    const firstRefresh = loginRes.body.refreshToken as string;

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(firstRefresh);

    // Reusing the rotated token is treated as theft and fails.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employee2@test.local', password: 'EmployeePass123!' })
      .expect(200);
    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(204);
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);
  });
});

describe('users (admin only)', () => {
  it('employees cannot list users', async () => {
    await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);
  });

  it('admin can list users', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.users).toHaveLength(3);
  });

  it('admin can create an employee', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newhire@test.local', password: 'NewHirePass123!', name: 'New Hire' })
      .expect(201);
    expect(res.body.user.role).toBe('EMPLOYEE');
  });

  it('duplicate email returns 409', async () => {
    await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newhire@test.local', password: 'NewHirePass123!', name: 'New Hire' })
      .expect(409);
  });

  it('admin cannot disable the last active admin', async () => {
    await request(app)
      .patch(`/api/v1/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DISABLED' })
      .expect(409);
  });
});

describe('devices', () => {
  it('employee can register a device and receives the token once', async () => {
    const res = await request(app)
      .post('/api/v1/devices/register')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        deviceName: "Employee's Phone",
        deviceCode: 'PHONE_001',
        manufacturer: 'Samsung',
        model: 'Galaxy M34',
        androidVersion: '14',
        appVersion: '1.0.0',
      })
      .expect(201);
    deviceId = res.body.device.id;
    deviceToken = res.body.deviceToken;
    expect(deviceToken.startsWith('dvc_')).toBe(true);
  });

  it('duplicate device code returns 409', async () => {
    await request(app)
      .post('/api/v1/devices/register')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ deviceName: 'Duplicate', deviceCode: 'PHONE_001' })
      .expect(409);
  });

  it('employee cannot register a device for someone else', async () => {
    await request(app)
      .post('/api/v1/devices/register')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ userId: adminId, deviceName: 'Not Mine', deviceCode: 'PHONE_999' })
      .expect(403);
  });

  it('admin can list all devices', async () => {
    const res = await request(app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.devices.length).toBeGreaterThanOrEqual(1);
  });
});

describe('leads', () => {
  it('creates a lead and normalises the phone number', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        customerName: 'Ramesh Kumar',
        phone: '98765 43210',
        vehicleType: 'Truck Body',
        requirement: '12 ft container body for Ashok Leyland 1615',
        source: 'INSTAGRAM',
        assignedUserId: employeeId,
      })
      .expect(201);
    leadId = res.body.lead.id;
    expect(res.body.lead.phone).toBe('+919876543210');
    expect(res.body.lead.status).toBe('NEW');
    expect(res.body.lead.leadCode).toMatch(/^MMB-\d{6}$/);
  });

  it('rejects an invalid phone number', async () => {
    await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ customerName: 'Bad Phone', phone: '123' })
      .expect(422);
  });

  it('rejects a duplicate open lead for the same phone', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ customerName: 'Duplicate', phone: '+91 98765 43210' })
      .expect(409);
    expect(res.body.error.code).toBe('DUPLICATE_LEAD');
  });

  it('employee cannot see a lead assigned to another employee', async () => {
    const res = await request(app)
      .get(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${employee2Token}`)
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('updates status and records an activity', async () => {
    const res = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ status: 'CONTACTED' })
      .expect(200);
    expect(res.body.lead.status).toBe('CONTACTED');

    const activities = await request(app)
      .get(`/api/v1/leads/${leadId}/activities`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    const types = activities.body.activities.map((a: { type: string }) => a.type);
    expect(types).toContain('CREATED');
    expect(types).toContain('STATUS_CHANGE');
  });

  it('LOST requires a lost reason', async () => {
    await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ status: 'LOST' })
      .expect(422);
  });

  it('adds a note activity', async () => {
    const res = await request(app)
      .post(`/api/v1/leads/${leadId}/activities`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ type: 'NOTE', body: 'Customer asked for quotation by WhatsApp' })
      .expect(201);
    expect(res.body.activity.type).toBe('NOTE');
  });

  it('lists leads with pagination metadata', async () => {
    const res = await request(app)
      .get('/api/v1/leads?page=1&pageSize=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.page.total).toBeGreaterThanOrEqual(1);
    expect(res.body.page.pageSize).toBe(10);
  });
});

describe('call events', () => {
  it('ingests a single event via device token and auto-links the lead', async () => {
    const eventId = randomUUID();
    const res = await request(app)
      .post('/api/v1/call-events')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        event_id: eventId,
        phone_number: '+919876543210',
        call_type: 'INCOMING',
        call_timestamp: '2026-11-21T11:32:00+05:30',
        duration_seconds: 120,
        source: 'SIM',
        capture_method: 'CALL_LOG',
      })
      .expect(201);
    expect(res.body.summary.created).toBe(1);
    expect(res.body.results[0].callEvent.leadId).toBe(leadId);
    expect(res.body.results[0].callEvent.direction).toBe('INCOMING');
  });

  it('duplicate event_id is idempotent (no second row)', async () => {
    const eventId = randomUUID();
    const payload = {
      eventId,
      phoneNumber: '+919876543210',
      direction: 'OUTGOING',
      startedAt: '2026-11-21T12:00:00+05:30',
      durationSeconds: 45,
      source: 'SIM',
    };
    const first = await request(app)
      .post('/api/v1/call-events')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(payload)
      .expect(201);
    expect(first.body.summary.created).toBe(1);

    const second = await request(app)
      .post('/api/v1/call-events')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(payload)
      .expect(201);
    expect(second.body.summary.duplicates).toBe(1);
    expect(second.body.results[0].status).toBe('duplicate');
  });

  it('batch ingest reports per-item errors without failing the batch', async () => {
    const res = await request(app)
      .post('/api/v1/call-events')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        events: [
          {
            eventId: randomUUID(),
            phoneNumber: '+919999999999',
            direction: 'MISSED',
            startedAt: '2026-11-21T13:00:00+05:30',
            source: 'WHATSAPP',
            captureMethod: 'MANUAL',
          },
          {
            eventId: 'not-a-uuid',
            phoneNumber: '+919999999998',
            startedAt: '2026-11-21T13:05:00+05:30',
          },
        ],
      })
      .expect(201);
    expect(res.body.summary.created).toBe(1);
    expect(res.body.summary.failed).toBe(1);
  });

  it('does not auto-create a lead for an unknown number', async () => {
    const res = await request(app)
      .post('/api/v1/call-events')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        eventId: randomUUID(),
        phoneNumber: '+919888888888',
        direction: 'INCOMING',
        startedAt: '2026-11-21T14:00:00+05:30',
        source: 'SIM',
      })
      .expect(201);
    expect(res.body.results[0].callEvent.leadId).toBeNull();

    const unmatched = await request(app)
      .get('/api/v1/call-events?unmatched=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(unmatched.body.callEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('revoked device token is rejected', async () => {
    await request(app)
      .post(`/api/v1/devices/${deviceId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .post('/api/v1/call-events')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        eventId: randomUUID(),
        phoneNumber: '+919876543210',
        startedAt: '2026-11-21T15:00:00+05:30',
      })
      .expect(401);
  });
});

describe('followups', () => {
  it('schedules a follow-up and mirrors it on the lead', async () => {
    const res = await request(app)
      .post(`/api/v1/leads/${leadId}/followups`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ dueAt: '2026-11-22T10:00:00+05:30', notes: 'Call to confirm requirement' })
      .expect(201);
    followupId = res.body.followup.id;
    expect(res.body.followup.status).toBe('PENDING');

    const lead = await request(app)
      .get(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    expect(lead.body.lead.nextFollowupAt).not.toBeNull();
  });

  it('completes a follow-up', async () => {
    const res = await request(app)
      .post(`/api/v1/followups/${followupId}/complete`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ completionNotes: 'Customer confirmed, sending quotation' })
      .expect(200);
    expect(res.body.followup.status).toBe('COMPLETED');
  });

  it('cannot complete the same follow-up twice', async () => {
    await request(app)
      .post(`/api/v1/followups/${followupId}/complete`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({})
      .expect(409);
  });

  it('lists pending follow-ups', async () => {
    const res = await request(app)
      .get('/api/v1/followups?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body.followups)).toBe(true);
  });
});

describe('reports', () => {
  it('returns a dashboard summary', async () => {
    const res = await request(app)
      .get('/api/v1/reports/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.totals.total_leads).toBeGreaterThanOrEqual(1);
    expect(res.body.byStatus).toBeDefined();
    expect(res.body.employees.length).toBeGreaterThanOrEqual(1);
  });

  it('exports leads as CSV', async () => {
    const res = await request(app)
      .get('/api/v1/reports/leads.csv')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Lead Code');
    expect(res.text).toContain('Ramesh Kumar');
  });
});
