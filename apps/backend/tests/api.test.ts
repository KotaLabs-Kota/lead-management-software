/**
 * End-to-end API tests against a real PostgreSQL database.
 *
 * Run with: npm test
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closePool } from '../src/db/pool';
import { corsOrigins, env } from '../src/config/env';
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

  it('exposes an optional non-secret environment label on both health endpoints', async () => {
    env.HEALTH_ENVIRONMENT_LABEL = 'crm-call-test';
    try {
      for (const path of ['/healthz', '/api/health']) {
        const res = await request(app).get(path).expect(200);
        expect(res.body.environment).toBe('crm-call-test');
      }
    } finally {
      env.HEALTH_ENVIRONMENT_LABEL = undefined;
    }
    const unlabelled = await request(app).get('/api/health').expect(200);
    expect(unlabelled.body.environment).toBeUndefined();
  });

  it('rejects unapproved browser origins without reporting a server failure', async () => {
    const blocked = await request(app).get('/api/health').set('Origin', 'https://untrusted.example').expect(403);
    expect(blocked.body.error.code).toBe('FORBIDDEN');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    const allowed = await request(app).get('/api/health').set('Origin', corsOrigins[0]!).expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(corsOrigins[0]);
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
    const otherSession = await request(app).post('/api/auth/login')
      .send({ email: 'employee@test.local', password: 'EmployeePass123!' }).expect(200);

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(firstRefresh);
    const replacementRefresh = refreshed.body.refreshToken as string;

    // Reusing the rotated token is treated as theft and fails.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(401);
    // Reuse must revoke the new token, not roll the revocation back.
    await request(app).post('/api/auth/refresh').send({ refreshToken: replacementRefresh }).expect(401);
    await request(app).post('/api/auth/refresh').send({ refreshToken: otherSession.body.refreshToken }).expect(401);
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

  it('opt-in device call creates one lead, retries safely and marks returning contacts', async () => {
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const phone = '+919876000123';
      const event = { eventId: randomUUID(), phoneNumber: phone, direction: 'MISSED',
        startedAt: '2026-11-21T14:00:00+05:30', source: 'SIM', captureMethod: 'CALL_LOG' };
      const [first, retry] = await Promise.all([
        request(app).post('/api/v1/call-events').set('Authorization', `Bearer ${deviceToken}`).send(event),
        request(app).post('/api/v1/call-events').set('Authorization', `Bearer ${deviceToken}`).send(event),
      ]);
      expect([first.body.summary.created, retry.body.summary.created].sort()).toEqual([0, 1]);
      expect([first.body.summary.duplicates, retry.body.summary.duplicates].sort()).toEqual([0, 1]);
      const newLeadId = first.body.results[0].callEvent.leadId as string;
      expect(newLeadId).toBeTruthy();
      expect(retry.body.results[0].callEvent.leadId).toBe(newLeadId);

      const more = await Promise.all([1, 2].map(() => request(app).post('/api/v1/call-events')
        .set('Authorization', `Bearer ${deviceToken}`).send({ ...event, eventId: randomUUID() })));
      expect(more.every((res) => res.body.results[0].callEvent.leadId === newLeadId)).toBe(true);
      const activity = await request(app).get(`/api/v1/leads/${newLeadId}/activities`)
        .set('Authorization', `Bearer ${employeeToken}`).expect(200);
      expect(activity.body.activities.filter((a: {type: string}) => a.type === 'CALL')).toHaveLength(3);
      expect(activity.body.activities.find((a: {type: string}) => a.type === 'CALL').metadata.direction).toBe('MISSED');

      await request(app).patch(`/api/v1/leads/${newLeadId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONVERTED' }).expect(200);
      const returning = await request(app).post('/api/v1/call-events')
        .set('Authorization', `Bearer ${deviceToken}`).send({ ...event, eventId: randomUUID() }).expect(201);
      const returningId = returning.body.results[0].callEvent.leadId;
      expect(returningId).not.toBe(newLeadId);
      const detail = await request(app).get(`/api/v1/leads/${returningId}`)
        .set('Authorization', `Bearer ${employeeToken}`).expect(200);
      expect(detail.body.lead.sourceDetail).toBe('Returning contact');
      expect(detail.body.lead.assignedUserId).toBe(employeeId);
      expect(detail.body.previousLeads.map((lead: {id: string}) => lead.id)).toContain(newLeadId);
      const restricted = await request(app).get(`/api/v1/leads/${returningId}`)
        .set('Authorization', `Bearer ${employee2Token}`).expect(404);
      expect(restricted.body.error).toBeDefined();
    } finally {
      env.CALL_EVENT_AUTO_CREATE_LEAD = false;
    }
  });

  it('opt-in does not auto-create leads for manual or WhatsApp calls', async () => {
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      for (const [token, direction, source] of [
        [employeeToken, 'MISSED', 'SIM'],
        [deviceToken, 'MISSED', 'WHATSAPP'],
      ]) {
        const res = await request(app).post('/api/v1/call-events')
          .set('Authorization', `Bearer ${token}`)
          .send({ eventId: randomUUID(), phoneNumber: '+919876000124', direction, source,
            startedAt: '2026-11-21T14:00:00+05:30' }).expect(201);
        expect(res.body.results[0].callEvent.leadId).toBeNull();
      }
    } finally {
      env.CALL_EVENT_AUTO_CREATE_LEAD = false;
    }
  });

  it('creates, links and deduplicates outgoing SIM calls and scopes reassigned lead history', async () => {
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const event = { eventId: randomUUID(), phoneNumber: '+919876000127', direction: 'OUTGOING',
        startedAt: '2026-11-21T14:00:00+05:30', source: 'SIM', captureMethod: 'CALL_LOG' };
      const first = await request(app).post('/api/v1/call-sync/events')
        .set('Authorization', `Bearer ${deviceToken}`).send(event).expect(201);
      const outgoingLeadId = first.body.results[0].callEvent.leadId;
      expect(outgoingLeadId).toBeTruthy();
      expect(first.body.results[0].callEvent.direction).toBe('OUTGOING');
      const retry = await request(app).post('/api/v1/call-sync/events')
        .set('Authorization', `Bearer ${deviceToken}`).send(event).expect(201);
      expect(retry.body.summary.duplicates).toBe(1);
      const next = await request(app).post('/api/v1/call-sync/events')
        .set('Authorization', `Bearer ${deviceToken}`).send({ ...event, eventId: randomUUID() }).expect(201);
      expect(next.body.results[0].callEvent.leadId).toBe(outgoingLeadId);
      const adminHistory = await request(app).get(`/api/v1/call-events?leadId=${outgoingLeadId}`)
        .set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(adminHistory.body.callEvents).toHaveLength(2);
      expect(adminHistory.body.callEvents[0].deviceName).toBeTruthy();
      const devId = adminHistory.body.callEvents[0].deviceId;
      const filtered = await request(app).get(`/api/v1/call-events?deviceId=${devId}&direction=OUTGOING`)
        .set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(filtered.body.callEvents.some((event: {leadId: string}) => event.leadId === outgoingLeadId)).toBe(true);
      const otherDevice = await request(app).get(`/api/v1/call-events?deviceId=${randomUUID()}&leadId=${outgoingLeadId}`)
        .set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(otherDevice.body.callEvents).toHaveLength(0);
      await request(app).get(`/api/v1/call-events?leadId=${outgoingLeadId}`)
        .set('Authorization', `Bearer ${employee2Token}`).expect(404);
      await request(app).patch(`/api/v1/leads/${outgoingLeadId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ assignedUserId: employee2Id }).expect(200);
      const assignedHistory = await request(app).get(`/api/v1/call-events?leadId=${outgoingLeadId}`)
        .set('Authorization', `Bearer ${employee2Token}`).expect(200);
      expect(assignedHistory.body.callEvents).toHaveLength(2);
      await request(app).get(`/api/v1/call-events?leadId=${outgoingLeadId}`)
        .set('Authorization', `Bearer ${employeeToken}`).expect(404);
      await request(app).patch(`/api/v1/leads/${outgoingLeadId}`)
        .set('Authorization', `Bearer ${employee2Token}`).send({ status: 'CONTACTED' }).expect(200);
      await request(app).patch(`/api/v1/leads/${outgoingLeadId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONVERTED' }).expect(200);
      const returning = await request(app).post('/api/v1/call-sync/events')
        .set('Authorization', `Bearer ${deviceToken}`).send({ ...event, eventId: randomUUID() }).expect(201);
      expect(returning.body.results[0].callEvent.leadId).not.toBe(outgoingLeadId);
      // The previous lead belongs to a different employee; its history stays private.
      const detail = await request(app).get(`/api/v1/leads/${returning.body.results[0].callEvent.leadId}`)
        .set('Authorization', `Bearer ${employeeToken}`).expect(200);
      expect(detail.body.previousLeads).toHaveLength(0);
    } finally { env.CALL_EVENT_AUTO_CREATE_LEAD = false; }
  });

  it('marks an outgoing call to a visible closed lead as a returning contact', async () => {
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const event = { eventId: randomUUID(), phoneNumber: '+919876000197', direction: 'OUTGOING',
        startedAt: '2026-11-21T14:00:00+05:30', source: 'SIM' };
      const first = await request(app).post('/api/v1/call-sync/events')
        .set('Authorization', `Bearer ${deviceToken}`).send(event).expect(201);
      const oldId = first.body.results[0].callEvent.leadId;
      await request(app).patch(`/api/v1/leads/${oldId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONVERTED' }).expect(200);
      const second = await request(app).post('/api/v1/call-sync/events')
        .set('Authorization', `Bearer ${deviceToken}`).send({ ...event, eventId: randomUUID() }).expect(201);
      const detail = await request(app).get(`/api/v1/leads/${second.body.results[0].callEvent.leadId}`)
        .set('Authorization', `Bearer ${employeeToken}`).expect(200);
      expect(detail.body.lead.sourceDetail).toBe('Returning contact');
      expect(detail.body.previousLeads.map((lead: {id: string}) => lead.id)).toContain(oldId);
    } finally { env.CALL_EVENT_AUTO_CREATE_LEAD = false; }
  });

  it('serializes concurrent manual creation and phone sync for the same number', async () => {
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const phone = '+919876000126';
      const [manual, call] = await Promise.all([
        request(app).post('/api/v1/leads').set('Authorization', `Bearer ${employeeToken}`)
          .send({ customerName: 'Manual lead', phone, source: 'MANUAL' }),
        request(app).post('/api/v1/call-events').set('Authorization', `Bearer ${deviceToken}`)
          .send({ eventId: randomUUID(), phoneNumber: phone, direction: 'MISSED', source: 'SIM',
            startedAt: '2026-11-21T14:00:00+05:30' }),
      ]);
      expect([201, 409]).toContain(manual.status);
      expect(call.body.summary.created).toBe(1);
      const leads = await request(app).get(`/api/v1/leads?search=${encodeURIComponent(phone)}`)
        .set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(leads.body.leads).toHaveLength(1);
      expect(call.body.results[0].callEvent.leadId).toBe(leads.body.leads[0].id);
    } finally {
      env.CALL_EVENT_AUTO_CREATE_LEAD = false;
    }
  });

  it('prevents a reopened lead from racing with automatic call lead creation', async () => {
    const phone = '+919876000128';
    const created = await request(app).post('/api/v1/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerName: 'Closed lead', phone, source: 'MANUAL', assignedUserId: employeeId }).expect(201);
    const id = created.body.lead.id as string;
    await request(app).patch(`/api/v1/leads/${id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONVERTED' }).expect(200);
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const [reopened, call] = await Promise.all([
        request(app).patch(`/api/v1/leads/${id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'NEW' }),
        request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`)
          .send({ eventId: randomUUID(), phoneNumber: phone, direction: 'MISSED', source: 'SIM', startedAt: '2026-11-21T14:00:00+05:30' }),
      ]);
      expect([200, 409]).toContain(reopened.status);
      expect(call.body.summary.created).toBe(1);
      const leads = await request(app).get(`/api/v1/leads?search=${encodeURIComponent(phone)}`)
        .set('Authorization', `Bearer ${adminToken}`).expect(200);
      const open = leads.body.leads.filter((lead: {status: string}) => !['CONVERTED', 'LOST'].includes(lead.status));
      expect(open).toHaveLength(1);
      expect(call.body.results[0].callEvent.leadId).toBe(open[0].id);
    } finally { env.CALL_EVENT_AUTO_CREATE_LEAD = false; }
  });

  it('does not expose previous leads assigned to another employee', async () => {
    const auth = `Bearer ${adminToken}`;
    const old = await request(app).post('/api/v1/leads').set('Authorization', auth)
      .send({ customerName: 'Private old lead', phone: '+919876000125', source: 'MANUAL', assignedUserId: employee2Id }).expect(201);
    await request(app).patch(`/api/v1/leads/${old.body.lead.id}`).set('Authorization', auth)
      .send({ status: 'CONVERTED' }).expect(200);
    const current = await request(app).post('/api/v1/leads').set('Authorization', auth)
      .send({ customerName: 'Current lead', phone: '+919876000125', source: 'MANUAL', assignedUserId: employeeId }).expect(201);
    const employeeView = await request(app).get(`/api/v1/leads/${current.body.lead.id}`)
      .set('Authorization', `Bearer ${employeeToken}`).expect(200);
    expect(employeeView.body.previousLeads).toHaveLength(0);
    const adminView = await request(app).get(`/api/v1/leads/${current.body.lead.id}`)
      .set('Authorization', auth).expect(200);
    expect(adminView.body.previousLeads.map((lead: {id: string}) => lead.id)).toContain(old.body.lead.id);
  });

  it('device cannot spoof another device or choose a lead', async () => {
    const res = await request(app).post('/api/v1/call-events')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ eventId: randomUUID(), phoneNumber: '+919876543210', direction: 'MISSED', source: 'SIM',
        leadId, deviceId: randomUUID(), startedAt: '2026-11-21T14:00:00+05:30' }).expect(201);
    expect(res.body.summary.failed).toBe(1);
    expect(res.body.summary.created).toBe(0);
  });

  it('gates the new sync client when automatic creation is disabled', async () => {
    const payload = { eventId: randomUUID(), phoneNumber: '+919876000127', direction: 'MISSED', source: 'SIM', startedAt: '2026-11-21T14:00:00+05:30' };
    const capability = await request(app).get('/api/v1/call-sync/capability').set('Authorization', `Bearer ${employeeToken}`).expect(200);
    expect(capability.body.enabled).toBe(false);
    await request(app).get('/api/v1/call-sync/capability').expect(401);
    await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`).send(payload).expect(503);
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const active = await request(app).get('/api/v1/call-sync/capability').set('Authorization', `Bearer ${employeeToken}`).expect(200);
      expect(active.body.enabled).toBe(true);
      await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${employeeToken}`).send(payload).expect(401);
      const accepted = await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`).send(payload).expect(201);
      expect(accepted.body.results[0].callEvent.leadId).toBeTruthy();
    } finally { env.CALL_EVENT_AUTO_CREATE_LEAD = false; }
  });

  it('uses a phone contact name for new calls without overwriting customer names', async () => {
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const event = { eventId: randomUUID(), phoneNumber: '+919876000331', direction: 'INCOMING', source: 'SIM',
        startedAt: '2026-11-21T14:00:00+05:30', contactName: '  Radha Sharma  ' };
      const first = await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`).send(event).expect(201);
      const id = first.body.results[0].callEvent.leadId;
      expect(first.body.results[0].callEvent.contactName).toBe('Radha Sharma');
      const lead = await request(app).get(`/api/v1/leads/${id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(lead.body.lead.customerName).toBe('Radha Sharma');
      const retry = await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`).send(event).expect(201);
      expect(retry.body.summary.duplicates).toBe(1);
      expect(retry.body.results[0].callEvent.contactName).toBe('Radha Sharma');
      await request(app).patch(`/api/v1/leads/${id}`).set('Authorization', `Bearer ${adminToken}`).send({ customerName: 'CRM name' }).expect(200);
      await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`)
        .send({ ...event, eventId: randomUUID(), contactName: 'Phone name' }).expect(201);
      const after = await request(app).get(`/api/v1/leads/${id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(after.body.lead.customerName).toBe('CRM name');
      const calls = await request(app).get(`/api/v1/call-events?leadId=${id}`).set('Authorization', `Bearer ${employeeToken}`).expect(200);
      expect(calls.body.callEvents.map((call: { contactName: string }) => call.contactName).sort()).toEqual(['Phone name', 'Radha Sharma']);
      await request(app).get(`/api/v1/call-events?leadId=${id}`).set('Authorization', `Bearer ${employee2Token}`).expect(404);
    } finally { env.CALL_EVENT_AUTO_CREATE_LEAD = false; }
  });

  it('fills an accessible Unknown caller placeholder on a later named call, but not another employee’s', async () => {
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const event = { eventId: randomUUID(), phoneNumber: '+919876000332', direction: 'MISSED', source: 'SIM',
        startedAt: '2026-11-21T14:00:00+05:30' };
      const first = await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`).send(event).expect(201);
      const id = first.body.results[0].callEvent.leadId;
      expect(first.body.results[0].callEvent.contactName).toBeNull();
      await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`)
        .send({ ...event, eventId: randomUUID(), contact_name: 'Saved Name' }).expect(201);
      let detail = await request(app).get(`/api/v1/leads/${id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(detail.body.lead.customerName).toBe('Saved Name');
      await request(app).patch(`/api/v1/leads/${id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ customerName: 'Unknown caller', assignedUserId: employee2Id }).expect(200);
      await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`)
        .send({ ...event, eventId: randomUUID(), contactName: 'Other Name' }).expect(201);
      detail = await request(app).get(`/api/v1/leads/${id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(detail.body.lead.customerName).toBe('Unknown caller');
    } finally { env.CALL_EVENT_AUTO_CREATE_LEAD = false; }
  });

  it('rejects invalid contact names without creating calls', async () => {
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      const base = { phoneNumber: '+919876000333', direction: 'MISSED', source: 'SIM', startedAt: '2026-11-21T14:00:00+05:30' };
      for (const contactName of ['', 'x'.repeat(161)]) {
        const result = await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`)
          .send({ events: [{ ...base, eventId: randomUUID(), contactName }] }).expect(201);
        expect(result.body.summary.failed).toBe(1);
      }
    } finally { env.CALL_EVENT_AUTO_CREATE_LEAD = false; }
  });

  it('allows a device token to revoke only that device', async () => {
    const registration = await request(app).post('/api/v1/devices/register')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ deviceName: 'Self revoke phone', deviceCode: randomUUID() }).expect(201);
    const ownToken = registration.body.deviceToken as string;
    await request(app).post('/api/v1/devices/self/revoke').expect(401);
    await request(app).post('/api/v1/devices/self/revoke')
      .set('Authorization', `Bearer ${employeeToken}`).expect(401);
    await request(app).post('/api/v1/devices/self/revoke')
      .set('Authorization', `Bearer ${ownToken}`).expect(204);
    await request(app).post('/api/v1/call-events')
      .set('Authorization', `Bearer ${ownToken}`)
      .send({ eventId: randomUUID(), phoneNumber: '+919876543210', direction: 'MISSED', source: 'SIM',
        startedAt: '2026-11-21T14:00:00+05:30' }).expect(401);
    const stillActive = await request(app).post('/api/v1/call-events')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ eventId: randomUUID(), phoneNumber: '+919876543210', direction: 'MISSED', source: 'SIM',
        startedAt: '2026-11-21T14:00:00+05:30' }).expect(201);
    expect(stillActive.body.summary.created).toBe(1);
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

  it('evaluates call counts on the requested IST date, including the UTC day boundary', async () => {
    const event = { eventId: randomUUID(), phoneNumber: '+919876000196', direction: 'OUTGOING',
      startedAt: '2025-01-01T20:00:00Z', source: 'SIM' };
    await request(app).post('/api/v1/call-events').set('Authorization', `Bearer ${employeeToken}`).send(event).expect(201);
    const report = await request(app).get(`/api/v1/reports/summary?date=2025-01-02&userId=${employeeId}`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(report.body.totals.calls_today).toBe(1);
    expect(report.body.employees.find((u: {user_id: string}) => u.user_id === employeeId).calls_today).toBe(1);
    const previous = await request(app).get(`/api/v1/reports/summary?date=2025-01-01&userId=${employeeId}`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(previous.body.totals.calls_today).toBe(0);
  });

  it('restricts both exports to administrators and validates the PDF limit', async () => {
    for (const format of ['csv', 'pdf']) {
      await request(app).get(`/api/v1/reports/leads.${format}`).expect(401);
      await request(app).get(`/api/v1/reports/leads.${format}`)
        .set('Authorization', `Bearer ${employeeToken}`).expect(403);
    }
    await request(app).get('/api/v1/reports/leads.pdf?limit=501')
      .set('Authorization', `Bearer ${adminToken}`).expect(422);
  });

  it('exports an admin PDF with filters, page metadata and a valid PDF ending', async () => {
    const res = await request(app).get('/api/v1/reports/leads.pdf?limit=1&offset=0')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-export-row-count']).toBe('1');
    expect(res.headers['x-export-has-more']).toBe('true');
    const nextPage = await request(app).get('/api/v1/reports/leads.csv?limit=1&offset=1')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    const firstPage = await request(app).get('/api/v1/reports/leads.csv?limit=1&offset=0')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(nextPage.headers['x-export-row-count']).toBe('1');
    expect(nextPage.text).not.toBe(firstPage.text);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.body.subarray(-20).toString()).toContain('%%EOF');
    const empty = await request(app).get('/api/v1/reports/leads.pdf?search=never-match-xyz')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(empty.headers['x-export-row-count']).toBe('0');
    expect(empty.headers['x-export-has-more']).toBe('false');
  });

  it('exports only filled lead fields to PDF while preserving filtering and access control', async () => {
    await request(app).post('/api/v1/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerName: 'PDF Customer', phone: '+919876000194', source: 'MANUAL',
        email: 'test@example.com', city: 'Kota', notes: 'Follow up next week' }).expect(201);
    const res = await request(app).get('/api/v1/reports/leads.pdf?search=PDF%20Customer')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.headers['x-export-row-count']).toBe('1');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: new Uint8Array(res.body), useSystemFonts: true }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ');
    expect(text).toContain('PDF Customer');
    expect(text).toContain('test@example.com');
    expect(text).toContain('Kota');
    expect(text).toContain('Follow up next week');
    expect(text).not.toContain('Alternate phone');
    expect(text).not.toContain('Vehicle type');
    await pdf.destroy();
    await request(app).get('/api/v1/reports/leads.pdf?search=PDF%20Customer')
      .set('Authorization', `Bearer ${employeeToken}`).expect(403);
  });

  it('escapes spreadsheet formula prefixes in customer-entered CSV fields', async () => {
    await request(app).post('/api/v1/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerName: '=2+3', phone: '+919876000195', source: 'MANUAL' }).expect(201);
    const res = await request(app).get('/api/v1/reports/leads.csv?search=2%2B3')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.text).toContain("'=2+3");
    expect(res.headers['x-export-row-count']).toBe('1');
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

describe('password change notifications', () => {
  let subjectId: string;
  let subjectToken: string;
  let otherAdminToken: string;
  const auth = (token: string) => `Bearer ${token}`;
  beforeAll(async () => {
    env.PASSWORD_CHANGE_NOTIFICATIONS_ENABLED = true;
    const subject = await request(app).post('/api/v1/users').set('Authorization', auth(adminToken))
      .send({ name: 'Notification Employee', email: 'notification@test.local', password: 'OldPassword123!', role: 'EMPLOYEE' }).expect(201);
    subjectId = subject.body.user.id;
    subjectToken = await login('notification@test.local', 'OldPassword123!');
    await request(app).post('/api/v1/users').set('Authorization', auth(adminToken))
      .send({ name: 'Second Admin', email: 'secondadmin@test.local', password: 'SecondAdmin123!', role: 'ADMIN' }).expect(201);
    otherAdminToken = await login('secondadmin@test.local', 'SecondAdmin123!');
  });
  afterAll(() => { env.PASSWORD_CHANGE_NOTIFICATIONS_ENABLED = false; });

  it('denies employees and unauthenticated users and records only successful changes', async () => {
    await request(app).get('/api/v1/notifications').expect(401);
    await request(app).get('/api/v1/notifications').set('Authorization', auth(subjectToken)).expect(403);
    await request(app).post('/api/auth/change-password').set('Authorization', auth(subjectToken))
      .send({ currentPassword: 'wrong', newPassword: 'NewPassword123!' }).expect(401);
    let result = await request(app).get('/api/v1/notifications').set('Authorization', auth(adminToken)).expect(200);
    expect(result.body.unreadCount).toBe(0);
    await request(app).post('/api/auth/change-password').set('Authorization', auth(subjectToken))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' }).expect(204);
    await request(app).get('/api/auth/me').set('Authorization', auth(subjectToken)).expect(401);
    result = await request(app).get('/api/v1/notifications').set('Authorization', auth(adminToken)).expect(200);
    expect(result.body.unreadCount).toBe(1);
    expect(result.body.notifications[0]).toMatchObject({ subjectName: 'Notification Employee', actorName: 'Notification Employee', kind: 'SELF_CHANGE', read: false });
    expect(JSON.stringify(result.body)).not.toMatch(/OldPassword123|NewPassword123|password_hash/i);
  });

  it('records admin resets and maintains independent read status', async () => {
    await request(app).patch(`/api/v1/users/${subjectId}`).set('Authorization', auth(adminToken))
      .send({ password: 'ResetPassword123!' }).expect(200);
    const list = await request(app).get('/api/v1/notifications').set('Authorization', auth(adminToken)).expect(200);
    expect(list.body.unreadCount).toBe(2);
    const reset = list.body.notifications.find((n: { kind: string }) => n.kind === 'ADMIN_RESET');
    expect(reset).toMatchObject({ subjectName: 'Notification Employee', actorName: 'Test Admin', read: false });
    expect(JSON.stringify(list.body)).not.toContain('ResetPassword123');
    await request(app).post(`/api/v1/notifications/${reset.id}/read`).set('Authorization', auth(subjectToken)).expect(401);
    const refreshedSubject = await login('notification@test.local', 'ResetPassword123!');
    await request(app).post(`/api/v1/notifications/${reset.id}/read`).set('Authorization', auth(refreshedSubject)).expect(403);
    await request(app).post(`/api/v1/notifications/${reset.id}/read`).set('Authorization', auth(adminToken)).expect(204);
    await request(app).post(`/api/v1/notifications/${reset.id}/read`).set('Authorization', auth(adminToken)).expect(204);
    const first = await request(app).get('/api/v1/notifications').set('Authorization', auth(adminToken)).expect(200);
    const second = await request(app).get('/api/v1/notifications').set('Authorization', auth(otherAdminToken)).expect(200);
    expect(first.body.unreadCount).toBe(1);
    expect(second.body.unreadCount).toBe(2);
    expect(second.body.notifications.find((n: { id: string }) => n.id === reset.id).read).toBe(false);
    await request(app).post(`/api/v1/notifications/${randomUUID()}/read`).set('Authorization', auth(adminToken)).expect(404);
    await request(app).get('/api/v1/notifications?page=0').set('Authorization', auth(adminToken)).expect(422);
  });

  it('records admin self changes and provides bounded pages', async () => {
    await request(app).post('/api/auth/change-password').set('Authorization', auth(otherAdminToken))
      .send({ currentPassword: 'SecondAdmin123!', newPassword: 'UpdatedAdmin123!' }).expect(204);
    const { pool } = await import('../src/db/pool');
    await pool.query(`INSERT INTO password_change_notifications (subject_user_id, actor_user_id, kind)
      SELECT $1, $1, 'SELF_CHANGE' FROM generate_series(1, 20)`, [subjectId]);
    const first = await request(app).get('/api/v1/notifications?page=1').set('Authorization', auth(adminToken)).expect(200);
    const second = await request(app).get('/api/v1/notifications?page=2').set('Authorization', auth(adminToken)).expect(200);
    expect(first.body.notifications).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    expect(second.body.notifications).toHaveLength(3);
    const all = [...first.body.notifications, ...second.body.notifications];
    expect(all.some((n: { subjectName: string; kind: string }) => n.subjectName === 'Second Admin' && n.kind === 'SELF_CHANGE')).toBe(true);
    expect(new Set(all.map((n: { id: string }) => n.id)).size).toBe(23);
  });

  it('rolls password changes back if notification storage fails', async () => {
    const { pool } = await import('../src/db/pool');
    await pool.query(`CREATE FUNCTION reject_notification() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER reject_notification BEFORE INSERT ON password_change_notifications FOR EACH ROW EXECUTE FUNCTION reject_notification()`);
    try {
      await request(app).patch(`/api/v1/users/${subjectId}`).set('Authorization', auth(adminToken))
        .send({ password: 'ShouldNotWork123!' }).expect(500);
      const resetToken = await login('notification@test.local', 'ResetPassword123!');
      await request(app).post('/api/auth/change-password').set('Authorization', auth(resetToken))
        .send({ currentPassword: 'ResetPassword123!', newPassword: 'ShouldNotWork123!' }).expect(500);
      await login('notification@test.local', 'ResetPassword123!');
      await request(app).post('/api/auth/login').send({ email: 'notification@test.local', password: 'ShouldNotWork123!' }).expect(401);
    } finally {
      await pool.query('DROP TRIGGER reject_notification ON password_change_notifications');
      await pool.query('DROP FUNCTION reject_notification()');
    }
  });
});


describe('session security', () => {
  it('rejects legacy access tokens that have no password version', async () => {
    const legacy = jwt.sign({ role: 'ADMIN', tokenType: 'access' }, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, algorithm: 'HS256', subject: adminId, expiresIn: 3600,
    });
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${legacy}`).expect(401);
  });

  it('prevents a refresh racing a password reset from keeping a usable session', async () => {
    const account = await request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Race Test', email: 'race@test.local', password: 'RaceOldPassword123!', role: 'EMPLOYEE' }).expect(201);
    const session = await request(app).post('/api/auth/login')
      .send({ email: 'race@test.local', password: 'RaceOldPassword123!' }).expect(200);
    const [refresh, reset] = await Promise.all([
      request(app).post('/api/auth/refresh').send({ refreshToken: session.body.refreshToken }),
      request(app).patch(`/api/v1/users/${account.body.user.id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ password: 'RaceNewPassword123!' }),
    ]);
    expect(reset.status).toBe(200);
    expect([200, 401]).toContain(refresh.status);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session.body.accessToken}`).expect(401);
    if (refresh.status === 200) {
      await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refresh.body.accessToken}`).expect(401);
      await request(app).post('/api/auth/refresh').send({ refreshToken: refresh.body.refreshToken }).expect(401);
    }
    await request(app).post('/api/auth/login').send({ email: 'race@test.local', password: 'RaceOldPassword123!' }).expect(401);
    await login('race@test.local', 'RaceNewPassword123!');
  });
});

describe('KotaLabs owner controls', () => {
  const ownerKey = 'a'.repeat(64);
  const owner = `Bearer ${ownerKey}`;
  let targetId = '';
  let targetAccess = '';
  let targetRefresh = '';
  let targetDevice = '';

  it('is disabled by default, and rejects ordinary users and incorrect keys', async () => {
    await request(app).get('/api/owner/status').expect(404);
    env.OWNER_CONTROL_KEY = ownerKey;
    env.OWNER_CONTROLS_ENABLED = true;
    await request(app).get('/api/owner/status').set('Authorization', `Bearer ${adminToken}`).expect(401);
    await request(app).get('/api/owner/status').set('Authorization', `Bearer ${'b'.repeat(64)}`).expect(401);
    const status = await request(app).get('/api/owner/status').set('Authorization', owner).expect(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.body.suspended).toBe(false);
    expect(status.body.admins.some((a: { id: string }) => a.id === adminId)).toBe(true);
  });

  it('suspends all normal API access while health and authenticated owner recovery remain reachable', async () => {
    await request(app).put('/api/owner/service').set('Authorization', owner).send({ suspended: true }).expect(200);
    await request(app).get('/healthz').expect(200);
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/owner/status').set('Authorization', owner).expect(200);
    await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${adminToken}`).expect(503);
    await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'AdminPass123!' }).expect(503);
    await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${deviceToken}`).send({ events: [] }).expect(503);
    await request(app).put('/api/owner/service').set('Authorization', `Bearer ${adminToken}`).send({ suspended: false }).expect(401);
    await request(app).put('/api/owner/service').set('Authorization', owner).send({ suspended: false }).expect(200);
    await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${adminToken}`).expect(200);
  });

  it('blocks a specific admin across login, sessions and devices without disabling other users', async () => {
    const created = await request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Owner test admin', email: 'owner-target@test.local', password: 'OwnerTarget123!', role: 'ADMIN' }).expect(201);
    targetId = created.body.user.id;
    const session = await request(app).post('/api/auth/login').send({ email: 'owner-target@test.local', password: 'OwnerTarget123!' }).expect(200);
    targetAccess = session.body.accessToken; targetRefresh = session.body.refreshToken;
    const device = await request(app).post('/api/v1/devices/register').set('Authorization', `Bearer ${targetAccess}`)
      .send({ deviceName: 'Owner test phone', deviceCode: 'owner-test-device' }).expect(201);
    targetDevice = device.body.deviceToken;
    await request(app).put(`/api/owner/admins/${employeeId}`).set('Authorization', owner).send({ blocked: true }).expect(404);
    await request(app).put(`/api/owner/admins/${targetId}`).set('Authorization', owner).send({ blocked: true }).expect(200);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${targetAccess}`).expect(503);
    await request(app).post('/api/auth/login').send({ email: 'owner-target@test.local', password: 'OwnerTarget123!' }).expect(503);
    await request(app).post('/api/auth/refresh').send({ refreshToken: targetRefresh }).expect(401);
    await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${targetDevice}`).send({ events: [] }).expect(503);
    await request(app).post('/api/v1/call-events').set('Authorization', `Bearer ${targetDevice}`).send({ events: [] }).expect(503);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`).expect(200);
    // Another client admin cannot remove an owner block by changing user status.
    await request(app).patch(`/api/v1/users/${targetId}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${targetAccess}`).expect(503);
    await request(app).put(`/api/owner/admins/${targetId}`).set('Authorization', owner).send({ blocked: false }).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'owner-target@test.local', password: 'OwnerTarget123!' }).expect(200);
    // The unblocked device credential is still valid; an empty batch reaches validation.
    const oldGate = env.CALL_EVENT_AUTO_CREATE_LEAD;
    env.CALL_EVENT_AUTO_CREATE_LEAD = true;
    try {
      await request(app).post('/api/v1/call-sync/events').set('Authorization', `Bearer ${targetDevice}`).send({ events: [] }).expect(422);
    } finally { env.CALL_EVENT_AUTO_CREATE_LEAD = oldGate; }
  });

  it('records only metadata and makes repeated changes idempotent', async () => {
    const { pool } = await import('../src/db/pool');
    await request(app).put('/api/owner/service').set('Authorization', owner).send({ suspended: false }).expect(200);
    const audit = await pool.query('SELECT action, target_user_id FROM owner_control_audit ORDER BY created_at');
    expect(audit.rows.map((row) => row.action)).toEqual(['SERVICE_SUSPENDED', 'SERVICE_RESUMED', 'ADMIN_BLOCKED', 'ADMIN_UNBLOCKED']);
    expect(JSON.stringify(audit.rows)).not.toContain(ownerKey);
    env.OWNER_CONTROL_KEY = undefined;
    env.OWNER_CONTROLS_ENABLED = false;
  });
});

describe('owner password login', () => {
  const key = 'c'.repeat(64);
  const authorization = `Bearer ${key}`;
  const password = 'correct horse river sunset 927';
  const replacement = 'another long secure owner phrase 42';
  let session = '';

  it('keeps password login opt-in and requires the independent recovery key for setup', async () => {
    env.OWNER_CONTROL_KEY = key;
    env.OWNER_CONTROLS_ENABLED = true;
    await request(app).post('/api/owner/login').send({ password }).expect(404);
    await request(app).put('/api/owner/password').set('Authorization', authorization).send({ password }).expect(404);
    env.OWNER_PASSWORD_LOGIN_ENABLED = true;
    await request(app).post('/api/owner/login').send({ password }).expect(401);
    await request(app).put('/api/owner/password').set('Authorization', `Bearer ${adminToken}`).send({ password }).expect(401);
    await request(app).put('/api/owner/password').set('Authorization', authorization).send({ password: 'too short' }).expect(422);
    await request(app).put('/api/owner/password').set('Authorization', authorization).send({ password }).expect(200);
    const { pool } = await import('../src/db/pool');
    const stored = await pool.query('SELECT password_hash FROM owner_password_login WHERE singleton');
    expect(stored.rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(stored.rows[0].password_hash).not.toContain(password);
  });
  it('issues a separate short-lived owner session and rejects wrong credentials', async () => {
    await request(app).post('/api/owner/login').send({ password: 'wrong password' }).expect(401);
    const loginResponse = await request(app).post('/api/owner/login').send({ password }).expect(200);
    session = loginResponse.body.token;
    expect(loginResponse.body.expiresIn).toBe(900);
    expect(session).not.toContain(password);
    await request(app).get('/api/owner/status').set('Authorization', `Bearer ${session}`).expect(200);
    await request(app).get('/api/v1/users').set('Authorization', `Bearer ${session}`).expect(401);
    await request(app).put('/api/owner/password').set('Authorization', `Bearer ${session}`).send({ password: replacement }).expect(401);
    await request(app).put('/api/owner/service').set('Authorization', `Bearer ${session}`).send({ suspended: true }).expect(200);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`).expect(503);
    await request(app).put('/api/owner/service').set('Authorization', `Bearer ${session}`).send({ suspended: false }).expect(200);
  });
  it('invalidates old sessions after password reset or owner key rotation', async () => {
    await request(app).put('/api/owner/password').set('Authorization', authorization).send({ password: replacement }).expect(200);
    await request(app).get('/api/owner/status').set('Authorization', `Bearer ${session}`).expect(401);
    await request(app).post('/api/owner/login').send({ password }).expect(401);
    const loginResponse = await request(app).post('/api/owner/login').send({ password: replacement }).expect(200);
    const newSession = loginResponse.body.token as string;
    env.OWNER_CONTROL_KEY = 'd'.repeat(64);
    await request(app).get('/api/owner/status').set('Authorization', `Bearer ${newSession}`).expect(401);
    env.OWNER_CONTROL_KEY = key;
    await request(app).get('/api/owner/status').set('Authorization', `Bearer ${newSession}`).expect(200);
    // Repeated wrong passwords are throttled, but recovery-key access remains available.
    let limited = false;
    for (let i = 0; i < 6; i++) {
      const attempt = await request(app).post('/api/owner/login').send({ password: 'definitely incorrect' });
      if (attempt.status === 429) { limited = true; break; }
      expect(attempt.status).toBe(401);
    }
    expect(limited).toBe(true);
    await request(app).get('/api/owner/status').set('Authorization', authorization).expect(200);
    env.OWNER_PASSWORD_LOGIN_ENABLED = false;
    await request(app).get('/api/owner/status').set('Authorization', `Bearer ${newSession}`).expect(401);
    await request(app).get('/api/owner/status').set('Authorization', authorization).expect(200);
    env.OWNER_CONTROLS_ENABLED = false;
    env.OWNER_CONTROL_KEY = undefined;
  });
});
