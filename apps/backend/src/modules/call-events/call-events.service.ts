import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { many, maybeOne, one, withTransaction } from '../../db/pool';
import { logger } from '../../lib/logger';
import { formatLeadNumber } from '../../types/domain';
import { validationError } from '../../utils/errors';
import { buildPageMeta } from '../../utils/http';
import { normalizePhone } from '../../utils/phone';
import { callEventSchema, normalizeKeys } from './call-events.schemas';
import type {
  CreateCallEventInput,
  ListCallEventsQuery,
  SingleCallEventInput,
} from './call-events.schemas';

interface CallEventRow {
  id: string;
  event_id: string;
  lead_id: string | null;
  device_id: string | null;
  user_id: string;
  phone_number: string;
  direction: string | null;
  source: string;
  capture_method: string | null;
  started_at: Date;
  duration_seconds: number | null;
  sim_slot: number | null;
  notes: string | null;
  created_at: Date;
  lead_number: number | null;
  user_name: string | null;
  device_name: string | null;
}

const SELECT_CALL_EVENT = `
  SELECT ce.id, ce.event_id, ce.lead_id, ce.device_id, ce.user_id, ce.phone_number,
         ce.direction, ce.source, ce.capture_method, ce.started_at, ce.duration_seconds,
         ce.sim_slot, ce.notes, ce.created_at,
         l.lead_number, u.name AS user_name, d.device_name
    FROM call_events ce
    LEFT JOIN leads l ON l.id = ce.lead_id
    JOIN users u ON u.id = ce.user_id
    LEFT JOIN devices d ON d.id = ce.device_id`;

function publicCallEvent(event: CallEventRow) {
  return {
    id: event.id,
    eventId: event.event_id,
    leadId: event.lead_id,
    leadCode: event.lead_number ? formatLeadNumber(event.lead_number) : null,
    deviceId: event.device_id,
    deviceName: event.device_name,
    userId: event.user_id,
    userName: event.user_name,
    phoneNumber: event.phone_number,
    direction: event.direction,
    source: event.source,
    captureMethod: event.capture_method,
    startedAt: event.started_at,
    durationSeconds: event.duration_seconds,
    simSlot: event.sim_slot,
    notes: event.notes,
    createdAt: event.created_at,
  };
}

interface IngestResult {
  eventId: string;
  status: 'created' | 'duplicate';
  callEvent: ReturnType<typeof publicCallEvent>;
}

/**
 * Ingest one call event.
 *
 * Idempotency: `event_id` is unique in the database, so a retried sync from
 * the phone returns the existing row instead of creating a duplicate.
 *
 * Lead linking: an explicit `leadId` always wins. Otherwise, when
 * CALL_EVENT_AUTO_LINK_LEAD is enabled, the most recent open lead for the same
 * phone number is linked. A call NEVER creates a lead by itself.
 */
async function ingestEvent(
  input: SingleCallEventInput,
  actor: { userId: string; deviceId: string | null },
): Promise<IngestResult> {
  const phoneNumber = normalizePhone(input.phoneNumber);
  if (!phoneNumber) {
    throw validationError(`phoneNumber "${input.phoneNumber}" is not a valid phone number`);
  }

  const existing = await maybeOne<CallEventRow>(
    `${SELECT_CALL_EVENT} WHERE ce.event_id = $1`,
    [input.eventId],
  );
  if (existing) {
    return { eventId: input.eventId, status: 'duplicate', callEvent: publicCallEvent(existing) };
  }

  let leadId: string | null = input.leadId ?? null;

  if (!leadId && env.CALL_EVENT_AUTO_LINK_LEAD) {
    const openLead = await maybeOne<{ id: string }>(
      `SELECT id FROM leads
        WHERE phone = $1 AND status NOT IN ('CONVERTED', 'LOST')
        ORDER BY created_at DESC
        LIMIT 1`,
      [phoneNumber],
    );
    leadId = openLead?.id ?? null;
  }

  if (leadId) {
    const lead = await maybeOne<{ id: string }>(`SELECT id FROM leads WHERE id = $1`, [leadId]);
    if (!lead) throw validationError(`leadId ${leadId} does not reference an existing lead`);
  }

  const deviceId = input.deviceId ?? actor.deviceId;

  const created = await withTransaction(async (client) => {
    const row = await one<CallEventRow>(
      `INSERT INTO call_events (
         event_id, lead_id, device_id, user_id, phone_number, direction, source,
         capture_method, started_at, duration_seconds, sim_slot, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, event_id, lead_id, device_id, user_id, phone_number, direction,
                 source, capture_method, started_at, duration_seconds, sim_slot, notes,
                 created_at, NULL::bigint AS lead_number, NULL::text AS user_name,
                 NULL::text AS device_name`,
      [
        input.eventId,
        leadId,
        deviceId,
        actor.userId,
        phoneNumber,
        input.direction,
        input.source,
        input.captureMethod ?? null,
        input.startedAt,
        input.durationSeconds ?? null,
        input.simSlot ?? null,
        input.notes ?? null,
      ],
      client,
    );

    if (leadId) {
      await client.query(
        `INSERT INTO lead_activities (lead_id, user_id, type, body, metadata)
         VALUES ($1, $2, 'CALL', $3, $4)`,
        [
          leadId,
          actor.userId,
          `Call ${input.direction.toLowerCase()} (${input.source}) — ${phoneNumber}`,
          JSON.stringify({
            eventId: input.eventId,
            direction: input.direction,
            source: input.source,
            durationSeconds: input.durationSeconds ?? null,
            startedAt: input.startedAt,
          }),
        ],
      );

      await client.query(
        `UPDATE leads SET last_contacted_at = GREATEST(COALESCE(last_contacted_at, $2), $2) WHERE id = $1`,
        [leadId, input.startedAt],
      );
    }

    return row;
  });

  return { eventId: input.eventId, status: 'created', callEvent: publicCallEvent(created) };
}

/**
 * POST /api/v1/call-events
 *
 * Accepts a single event or a batch (`{ events: [...] }`). Authenticated either
 * by a user JWT (manual logging from the web CRM) or by a device token
 * (Android sync). Partial success is supported: valid events are stored and
 * invalid ones are reported per-item.
 */
export async function createCallEvents(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateCallEventInput;

  const actor = req.device
    ? { userId: req.device.userId, deviceId: req.device.deviceId }
    : { userId: req.auth!.userId, deviceId: null };

  const results: IngestResult[] = [];
  const errors: Array<{ eventId: string | null; message: string }> = [];

  for (const rawEvent of input.events) {
    // Each item is validated individually so one malformed event cannot
    // reject the whole sync batch.
    const parsed = callEventSchema.safeParse(normalizeKeys(rawEvent));
    if (!parsed.success) {
      const rawId =
        rawEvent && typeof rawEvent === 'object' && 'eventId' in rawEvent
          ? String((rawEvent as Record<string, unknown>).eventId)
          : null;
      errors.push({
        eventId: rawId,
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
      continue;
    }

    try {
      results.push(await ingestEvent(parsed.data, actor));
    } catch (error) {
      errors.push({
        eventId: parsed.data.eventId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info(
    { userId: actor.userId, deviceId: actor.deviceId, created: results.filter((r) => r.status === 'created').length, duplicates: results.filter((r) => r.status === 'duplicate').length, errors: errors.length },
    'Call events ingested',
  );

  res.status(201).json({
    results,
    errors,
    summary: {
      received: input.events.length,
      created: results.filter((r) => r.status === 'created').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      failed: errors.length,
    },
  });
}

/** GET /api/v1/call-events — employees see their own calls, admins see all. */
export async function listCallEvents(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListCallEventsQuery;
  const conditions: string[] = [];
  const params: unknown[] = [];
  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (req.auth!.role !== 'ADMIN') {
    conditions.push(`ce.user_id = ${push(req.auth!.userId)}`);
  }
  if (query.userId) conditions.push(`ce.user_id = ${push(query.userId)}`);
  if (query.leadId) conditions.push(`ce.lead_id = ${push(query.leadId)}`);
  if (query.direction) conditions.push(`ce.direction = ${push(query.direction)}`);
  if (query.source) conditions.push(`ce.source = ${push(query.source)}`);
  if (query.unmatched === 'true') conditions.push('ce.lead_id IS NULL');
  if (query.from) conditions.push(`ce.started_at >= ${push(query.from)}`);
  if (query.to) conditions.push(`ce.started_at <= ${push(query.to)}`);
  if (query.phone) {
    const normalized = normalizePhone(query.phone) ?? query.phone;
    conditions.push(`ce.phone_number = ${push(normalized)}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM call_events ce ${where}`,
    params,
  );

  const offset = (query.page - 1) * query.pageSize;
  const events = await many<CallEventRow>(
    `${SELECT_CALL_EVENT} ${where} ORDER BY ce.started_at DESC LIMIT ${push(query.pageSize)} OFFSET ${push(offset)}`,
    params,
  );

  res.status(200).json({
    callEvents: events.map(publicCallEvent),
    page: buildPageMeta(query.page, query.pageSize, countRow.total),
  });
}
