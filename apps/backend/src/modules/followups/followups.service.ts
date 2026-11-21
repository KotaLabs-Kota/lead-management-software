import type { Request, Response } from 'express';
import { many, maybeOne, one, withTransaction } from '../../db/pool';
import { logger } from '../../lib/logger';
import { formatLeadNumber } from '../../types/domain';
import { conflict, notFound, validationError } from '../../utils/errors';
import { buildPageMeta } from '../../utils/http';
import type {
  CancelFollowupInput,
  CompleteFollowupInput,
  CreateFollowupInput,
  ListFollowupsQuery,
} from './followups.schemas';

interface FollowupRow {
  id: string;
  lead_id: string;
  assigned_user_id: string;
  due_at: Date;
  status: string;
  notes: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  completion_notes: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  lead_number: number | null;
  customer_name: string | null;
  lead_phone: string | null;
  lead_status: string | null;
  assigned_user_name: string | null;
  is_overdue: boolean;
}

const SELECT_FOLLOWUP = `
  SELECT f.id, f.lead_id, f.assigned_user_id, f.due_at, f.status, f.notes,
         f.completed_at, f.completed_by, f.completion_notes, f.created_by,
         f.created_at, f.updated_at,
         l.lead_number, l.customer_name, l.phone AS lead_phone, l.status AS lead_status,
         u.name AS assigned_user_name,
         (f.status = 'PENDING' AND f.due_at < now()) AS is_overdue
    FROM followups f
    JOIN leads l ON l.id = f.lead_id
    JOIN users u ON u.id = f.assigned_user_id`;

function publicFollowup(followup: FollowupRow) {
  return {
    id: followup.id,
    leadId: followup.lead_id,
    leadCode: followup.lead_number ? formatLeadNumber(followup.lead_number) : null,
    customerName: followup.customer_name,
    leadPhone: followup.lead_phone,
    leadStatus: followup.lead_status,
    assignedUserId: followup.assigned_user_id,
    assignedUserName: followup.assigned_user_name,
    dueAt: followup.due_at,
    status: followup.status,
    notes: followup.notes,
    completedAt: followup.completed_at,
    completedBy: followup.completed_by,
    completionNotes: followup.completion_notes,
    createdBy: followup.created_by,
    createdAt: followup.created_at,
    updatedAt: followup.updated_at,
    isOverdue: followup.is_overdue,
  };
}

/**
 * Keep `leads.next_followup_at` in sync with the earliest pending follow-up so
 * dashboard queries stay cheap. Must be called inside a transaction.
 */
async function refreshLeadNextFollowup(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  leadId: string,
): Promise<void> {
  await client.query(
    `UPDATE leads
        SET next_followup_at = (
              SELECT MIN(due_at) FROM followups
               WHERE lead_id = $1 AND status = 'PENDING'
            )
      WHERE id = $1`,
    [leadId],
  );
}

/** POST /api/v1/leads/:id/followups */
export async function createFollowup(req: Request, res: Response): Promise<void> {
  const { id: leadId } = req.params as { id: string };
  const input = req.body as CreateFollowupInput;

  const lead = await maybeOne<{ id: string; assigned_user_id: string | null; status: string }>(
    `SELECT id, assigned_user_id, status FROM leads WHERE id = $1`,
    [leadId],
  );
  if (!lead) throw notFound('Lead');

  // Default assignee: the lead's current assignee, falling back to the creator.
  const assignedUserId = input.assignedUserId ?? lead.assigned_user_id ?? req.auth!.userId;

  const assignee = await maybeOne<{ id: string; status: string }>(
    `SELECT id, status FROM users WHERE id = $1`,
    [assignedUserId],
  );
  if (!assignee) throw validationError('assignedUserId does not reference an existing user');
  if (assignee.status !== 'ACTIVE') throw conflict('Cannot assign a follow-up to a disabled account');

  const followup = await withTransaction(async (client) => {
    const row = await one<FollowupRow>(
      `INSERT INTO followups (lead_id, assigned_user_id, due_at, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, lead_id, assigned_user_id, due_at, status, notes, completed_at,
                 completed_by, completion_notes, created_by, created_at, updated_at,
                 (SELECT lead_number FROM leads WHERE id = $1) AS lead_number,
                 (SELECT customer_name FROM leads WHERE id = $1) AS customer_name,
                 (SELECT phone FROM leads WHERE id = $1) AS lead_phone,
                 (SELECT status FROM leads WHERE id = $1) AS lead_status,
                 (SELECT name FROM users WHERE id = $2) AS assigned_user_name,
                 false AS is_overdue`,
      [leadId, assignedUserId, input.dueAt, input.notes ?? null, req.auth!.userId],
      client,
    );

    await client.query(
      `INSERT INTO lead_activities (lead_id, user_id, type, body, metadata)
       VALUES ($1, $2, 'FOLLOWUP_SCHEDULED', $3, $4)`,
      [
        leadId,
        req.auth!.userId,
        `Follow-up scheduled for ${input.dueAt}`,
        JSON.stringify({ followupId: row.id, dueAt: input.dueAt, assignedUserId }),
      ],
    );

    await refreshLeadNextFollowup(client, leadId);
    return row;
  });

  logger.info({ followupId: followup.id, leadId }, 'Follow-up scheduled');
  res.status(201).json({ followup: publicFollowup(followup) });
}

/** GET /api/v1/followups — employees see their own, admins see all. */
export async function listFollowups(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListFollowupsQuery;
  const conditions: string[] = [];
  const params: unknown[] = [];
  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (req.auth!.role !== 'ADMIN') {
    conditions.push(`f.assigned_user_id = ${push(req.auth!.userId)}`);
  }
  if (query.status) conditions.push(`f.status = ${push(query.status)}`);
  if (query.assignedUserId) conditions.push(`f.assigned_user_id = ${push(query.assignedUserId)}`);
  if (query.leadId) conditions.push(`f.lead_id = ${push(query.leadId)}`);
  if (query.overdue === 'true') conditions.push(`f.status = 'PENDING' AND f.due_at < now()`);
  if (query.from) conditions.push(`f.due_at >= ${push(query.from)}`);
  if (query.to) conditions.push(`f.due_at <= ${push(query.to)}`);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM followups f ${where}`,
    params,
  );

  const offset = (query.page - 1) * query.pageSize;
  const followups = await many<FollowupRow>(
    `${SELECT_FOLLOWUP} ${where} ORDER BY f.due_at ASC LIMIT ${push(query.pageSize)} OFFSET ${push(offset)}`,
    params,
  );

  res.status(200).json({
    followups: followups.map(publicFollowup),
    page: buildPageMeta(query.page, query.pageSize, countRow.total),
  });
}

/** POST /api/v1/followups/:id/complete */
export async function completeFollowup(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as CompleteFollowupInput;

  const existing = await maybeOne<{ id: string; lead_id: string; status: string; assigned_user_id: string }>(
    `SELECT id, lead_id, status, assigned_user_id FROM followups WHERE id = $1`,
    [id],
  );
  if (!existing) throw notFound('Follow-up');
  if (existing.status !== 'PENDING') {
    throw conflict(`Follow-up is already ${existing.status.toLowerCase()}`);
  }
  if (req.auth!.role !== 'ADMIN' && existing.assigned_user_id !== req.auth!.userId) {
    throw conflict('You can only complete follow-ups assigned to you');
  }

  const followup = await withTransaction(async (client) => {
    const row = await one<FollowupRow>(
      `UPDATE followups
          SET status = 'COMPLETED', completed_at = now(), completed_by = $1, completion_notes = $2
        WHERE id = $3
        RETURNING id, lead_id, assigned_user_id, due_at, status, notes, completed_at,
                  completed_by, completion_notes, created_by, created_at, updated_at,
                  (SELECT lead_number FROM leads WHERE id = followups.lead_id) AS lead_number,
                  (SELECT customer_name FROM leads WHERE id = followups.lead_id) AS customer_name,
                  (SELECT phone FROM leads WHERE id = followups.lead_id) AS lead_phone,
                  (SELECT status FROM leads WHERE id = followups.lead_id) AS lead_status,
                  (SELECT name FROM users WHERE id = followups.assigned_user_id) AS assigned_user_name,
                  false AS is_overdue`,
      [req.auth!.userId, input.completionNotes ?? null, id],
      client,
    );

    await client.query(
      `INSERT INTO lead_activities (lead_id, user_id, type, body, metadata)
       VALUES ($1, $2, 'FOLLOWUP_COMPLETED', $3, $4)`,
      [
        row.lead_id,
        req.auth!.userId,
        'Follow-up completed',
        JSON.stringify({ followupId: id, completionNotes: input.completionNotes ?? null }),
      ],
    );

    await refreshLeadNextFollowup(client, row.lead_id);
    return row;
  });

  logger.info({ followupId: id }, 'Follow-up completed');
  res.status(200).json({ followup: publicFollowup(followup) });
}

/** POST /api/v1/followups/:id/cancel */
export async function cancelFollowup(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as CancelFollowupInput;

  const existing = await maybeOne<{ id: string; lead_id: string; status: string; assigned_user_id: string }>(
    `SELECT id, lead_id, status, assigned_user_id FROM followups WHERE id = $1`,
    [id],
  );
  if (!existing) throw notFound('Follow-up');
  if (existing.status !== 'PENDING') {
    throw conflict(`Follow-up is already ${existing.status.toLowerCase()}`);
  }
  if (req.auth!.role !== 'ADMIN' && existing.assigned_user_id !== req.auth!.userId) {
    throw conflict('You can only cancel follow-ups assigned to you');
  }

  const followup = await withTransaction(async (client) => {
    const row = await one<FollowupRow>(
      `UPDATE followups SET status = 'CANCELLED', notes = COALESCE($1, notes) WHERE id = $2
       RETURNING id, lead_id, assigned_user_id, due_at, status, notes, completed_at,
                 completed_by, completion_notes, created_by, created_at, updated_at,
                 (SELECT lead_number FROM leads WHERE id = followups.lead_id) AS lead_number,
                 (SELECT customer_name FROM leads WHERE id = followups.lead_id) AS customer_name,
                 (SELECT phone FROM leads WHERE id = followups.lead_id) AS lead_phone,
                 (SELECT status FROM leads WHERE id = followups.lead_id) AS lead_status,
                 (SELECT name FROM users WHERE id = followups.assigned_user_id) AS assigned_user_name,
                 false AS is_overdue`,
      [input.reason ?? null, id],
      client,
    );

    await client.query(
      `INSERT INTO lead_activities (lead_id, user_id, type, body, metadata)
       VALUES ($1, $2, 'FOLLOWUP_CANCELLED', $3, $4)`,
      [
        row.lead_id,
        req.auth!.userId,
        input.reason ? `Follow-up cancelled: ${input.reason}` : 'Follow-up cancelled',
        JSON.stringify({ followupId: id, reason: input.reason ?? null }),
      ],
    );

    await refreshLeadNextFollowup(client, row.lead_id);
    return row;
  });

  logger.info({ followupId: id }, 'Follow-up cancelled');
  res.status(200).json({ followup: publicFollowup(followup) });
}
