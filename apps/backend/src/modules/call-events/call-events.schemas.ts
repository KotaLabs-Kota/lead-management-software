import { z } from 'zod';
import {
  CALL_CAPTURE_METHODS,
  CALL_DIRECTIONS,
  CALL_SOURCES,
} from '../../types/domain';

/**
 * The Android app and the brief use snake_case field names
 * (event_id, phone_number, call_type, call_timestamp). The web API uses
 * camelCase. Both are accepted here and normalised to camelCase.
 */
const SNAKE_TO_CAMEL: Record<string, string> = {
  event_id: 'eventId',
  phone_number: 'phoneNumber',
  call_type: 'direction',
  call_timestamp: 'startedAt',
  duration_seconds: 'durationSeconds',
  capture_method: 'captureMethod',
  sim_slot: 'simSlot',
  lead_id: 'leadId',
  device_id: 'deviceId',
};

export function normalizeKeys(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[SNAKE_TO_CAMEL[key] ?? key] = value;
  }
  return output;
}

export const callEventSchema = z.object({
  /** Client-generated UUID — the idempotency key for retries. */
  eventId: z.string().uuid('eventId must be a UUID'),
  phoneNumber: z.string().trim().min(7, 'phoneNumber is required').max(30),
  direction: z.enum(CALL_DIRECTIONS).default('UNKNOWN'),
  source: z.enum(CALL_SOURCES).default('SIM'),
  captureMethod: z.enum(CALL_CAPTURE_METHODS).optional(),
  startedAt: z.string().datetime({ offset: true }),
  durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
  simSlot: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  /** Optional explicit link. When omitted, the server may auto-link by phone. */
  leadId: z.string().uuid().nullable().optional(),
  deviceId: z.string().uuid().nullable().optional(),
});

/**
 * Batch payloads are validated leniently at the boundary: each item is
 * validated individually in the service so one bad event does not reject the
 * whole sync batch. A single event is validated strictly.
 */
export const createCallEventSchema = z.union([
  z.object({ events: z.array(z.unknown()).min(1).max(500) }),
  z.preprocess(normalizeKeys, callEventSchema).transform((event) => ({ events: [event] })),
]);

export const listCallEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  phone: z.string().trim().max(30).optional(),
  direction: z.enum(CALL_DIRECTIONS).optional(),
  source: z.enum(CALL_SOURCES).optional(),
  userId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  unmatched: z.enum(['true', 'false']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export type CreateCallEventInput = z.infer<typeof createCallEventSchema>;
export type SingleCallEventInput = z.infer<typeof callEventSchema>;
export type ListCallEventsQuery = z.infer<typeof listCallEventsQuerySchema>;
