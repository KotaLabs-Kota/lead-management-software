import type { Request, Response } from 'express';
import { many, maybeOne, one, withTransaction, type Queryable } from '../../db/pool';
import { logger } from '../../lib/logger';
import { formatLeadNumber, OPEN_LEAD_STATUSES } from '../../types/domain';
import { AppError, conflict, notFound, validationError } from '../../utils/errors';
import { buildPageMeta } from '../../utils/http';
import { normalizePhone } from '../../utils/phone';
import type {
  AddActivityInput,
  CreateLeadInput,
  ListActivitiesQuery,
  ListLeadsQuery,
  UpdateLeadInput,
} from './leads.schemas';

interface LeadRow {
  id: string;
  lead_number: number;
  customer_name: string;
  phone: string;
  alternate_phone: string | null;
  email: string | null;
  city: string | null;
  vehicle_type: string | null;
  vehicle_details: string | null;
  requirement: string | null;
  source: string;
  source_detail: string | null;
  platform_lead_id: string | null;
  assigned_user_id: string | null;
  status: string;
  notes: string | null;
  lost_reason: string | null;
  last_contacted_at: Date | null;
  next_followup_at: Date | null;
  closed_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  assigned_user_name: string | null;
  assigned_user_email: string | null;
  created_by_name: string | null;
  call_count: number;
  pending_followup_count: number;
}

const SELECT_LEAD = `
  SELECT l.id, l.lead_number, l.customer_name, l.phone, l.alternate_phone, l.email, l.city,
         l.vehicle_type, l.vehicle_details, l.requirement, l.source, l.source_detail,
         l.platform_lead_id, l.assigned_user_id, l.status, l.notes, l.lost_reason,
         l.last_contacted_at, l.next_followup_at, l.closed_at, l.created_by,
         l.created_at, l.updated_at,
         au.name AS assigned_user_name, au.email AS assigned_user_email,
         cu.name AS created_by_name,
         (SELECT COUNT(*) FROM call_events ce WHERE ce.lead_id = l.id) AS call_count,
         (SELECT COUNT(*) FROM followups f WHERE f.lead_id = l.id AND f.status = 'PENDING') AS pending_followup_count
    FROM leads l
    LEFT JOIN users au ON au.id = l.assigned_user_id
    LEFT JOIN users cu ON cu.id = l.created_by`;

function publicLead(lead: LeadRow) {
  return {
    id: lead.id,
    leadNumber: lead.lead_number,
    leadCode: formatLeadNumber(lead.lead_number),
    customerName: lead.customer_name,
    phone: lead.phone,
    alternatePhone: lead.alternate_phone,
    email: lead.email,
    city: lead.city,
    vehicleType: lead.vehicle_type,
    vehicleDetails: lead.vehicle_details,
    requirement: lead.requirement,
    source: lead.source,
    sourceDetail: lead.source_detail,
    platformLeadId: lead.platform_lead_id,
    assignedUserId: lead.assigned_user_id,
    assignedUserName: lead.assigned_user_name,
    assignedUserEmail: lead.assigned_user_email,
    status: lead.status,
    notes: lead.notes,
    lostReason: lead.lost_reason,
    lastContactedAt: lead.last_contacted_at,
    nextFollowupAt: lead.next_followup_at,
    closedAt: lead.closed_at,
    createdBy: lead.created_by,
    createdByName: lead.created_by_name,
    callCount: lead.call_count,
    pendingFollowupCount: lead.pending_followup_count,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
  };
}

/**
 * Employees see leads assigned to them plus unassigned leads (so they can pick
 * one up). Admins see everything.
 */
function scopeFor(req: Request): { clause: string; params: unknown[] } {
  if (req.auth!.role === 'ADMIN') return { clause: '', params: [] };
  return { clause: 'l.assigned_user_id = $1 OR l.assigned_user_id IS NULL', params: [req.auth!.userId] };
}

async function assertUserExists(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const user = await maybeOne<{ id: string; status: string }>(
    `SELECT id, status FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) throw validationError('assignedUserId does not reference an existing user');
  if (user.status !== 'ACTIVE') throw conflict('Cannot assign leads to a disabled account');
}

/**
 * Duplicate guard: an open lead for the same phone number already exists.
 * Closed leads (CONVERTED/LOST) do not block a new enquiry from the same person.
 */
async function assertNoOpenDuplicate(phone: string, excludeLeadId?: string, db?: Queryable): Promise<void> {
  const params: unknown[] = [phone, OPEN_LEAD_STATUSES];
  let excludeClause = '';
  if (excludeLeadId) {
    params.push(excludeLeadId);
    excludeClause = `AND id <> $${params.length}`;
  }

  const duplicate = await maybeOne<{ id: string; lead_number: number; status: string }>(
    `SELECT id, lead_number, status FROM leads
      WHERE phone = $1 AND status = ANY($2) ${excludeClause}
      ORDER BY created_at DESC LIMIT 1`,
    params,
    db,
  );

  if (duplicate) {
    throw new AppError(
      409,
      'DUPLICATE_LEAD',
      `An open lead already exists for this phone number (${formatLeadNumber(duplicate.lead_number)}, status ${duplicate.status})`,
      { existingLeadId: duplicate.id, existingLeadNumber: duplicate.lead_number },
    );
  }
}

/** GET /api/v1/leads */
export async function listLeads(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListLeadsQuery;
  const scope = scopeFor(req);
  const conditions: string[] = [];
  const params: unknown[] = [...scope.params];
  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (scope.clause) conditions.push(`(${scope.clause})`);
  if (query.status) conditions.push(`l.status = ${push(query.status)}`);
  if (query.source) conditions.push(`l.source = ${push(query.source)}`);
  if (query.assignedUserId) conditions.push(`l.assigned_user_id = ${push(query.assignedUserId)}`);
  if (query.unassigned === 'true') conditions.push('l.assigned_user_id IS NULL');
  if (query.from) conditions.push(`l.created_at >= ${push(query.from)}`);
  if (query.to) conditions.push(`l.created_at <= ${push(query.to)}`);
  if (query.search) {
    const like = `%${query.search}%`;
    const placeholder = push(like);
    conditions.push(
      `(l.customer_name ILIKE ${placeholder} OR l.phone ILIKE ${placeholder} OR l.vehicle_type ILIKE ${placeholder} OR l.city ILIKE ${placeholder})`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortMap: Record<ListLeadsQuery['sort'], string> = {
    created_desc: 'l.created_at DESC',
    created_asc: 'l.created_at ASC',
    updated_desc: 'l.updated_at DESC',
    followup_asc: 'l.next_followup_at ASC NULLS LAST, l.created_at DESC',
  };

  const countRow = await one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM leads l ${where}`,
    params,
  );

  const offset = (query.page - 1) * query.pageSize;
  const leads = await many<LeadRow>(
    `${SELECT_LEAD} ${where} ORDER BY ${sortMap[query.sort]} LIMIT ${push(query.pageSize)} OFFSET ${push(offset)}`,
    params,
  );

  res.status(200).json({
    leads: leads.map(publicLead),
    page: buildPageMeta(query.page, query.pageSize, countRow.total),
  });
}

/** GET /api/v1/leads/:id */
export async function getLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const scope = scopeFor(req);
  const params: unknown[] = [id, ...scope.params];
  const scopeClause = scope.clause ? `AND (${scope.clause.replace(/\$1/g, `$${params.length - scope.params.length + 1}`)})` : '';

  const lead = await maybeOne<LeadRow>(`${SELECT_LEAD} WHERE l.id = $1 ${scopeClause}`, params);
  if (!lead) throw notFound('Lead');
  // Respect the same employee access rules for every historical record. Never
  // reveal another employee's assigned leads through the returning-contact view.
  const historyParams: unknown[] = [lead.phone, id];
  const historyScope = req.auth!.role === 'ADMIN'
    ? ''
    : `AND (l.assigned_user_id = $3 OR l.assigned_user_id IS NULL)`;
  if (req.auth!.role !== 'ADMIN') historyParams.push(req.auth!.userId);
  const previousLeads = await many<{ id: string; lead_number: number; status: string; customer_name: string; created_at: Date }>(
    `SELECT l.id, l.lead_number, l.status, l.customer_name, l.created_at
       FROM leads l WHERE l.phone = $1 AND l.id <> $2
         AND (l.created_at, l.lead_number) < (SELECT created_at, lead_number FROM leads WHERE id = $2)
         ${historyScope}
       ORDER BY l.created_at DESC, l.lead_number DESC LIMIT 25`, historyParams,
  );
  res.status(200).json({
    lead: publicLead(lead),
    previousLeads: previousLeads.map((prior) => ({
      id: prior.id, leadCode: formatLeadNumber(prior.lead_number), status: prior.status,
      customerName: prior.customer_name, createdAt: prior.created_at,
    })),
  });
}

/** POST /api/v1/leads */
export async function createLead(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateLeadInput;

  const phone = normalizePhone(input.phone);
  if (!phone) throw validationError('phone is not a valid phone number');

  let alternatePhone: string | null = null;
  if (input.alternatePhone) {
    alternatePhone = normalizePhone(input.alternatePhone);
    if (!alternatePhone) throw validationError('alternatePhone is not a valid phone number');
  }

  const assignedUserId = input.assignedUserId ?? null;
  await assertUserExists(assignedUserId);

  const lead = await withTransaction(async (client) => {
    // Coordinate manual creation with concurrent device-call lead creation.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`phone:${phone}`]);
    await assertNoOpenDuplicate(phone, undefined, client);
    const inserted = await one<LeadRow>(
      `INSERT INTO leads (
         customer_name, phone, alternate_phone, email, city, vehicle_type, vehicle_details,
         requirement, source, source_detail, assigned_user_id, notes, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, lead_number, customer_name, phone, alternate_phone, email, city,
                 vehicle_type, vehicle_details, requirement, source, source_detail,
                 platform_lead_id, assigned_user_id, status, notes, lost_reason,
                 last_contacted_at, next_followup_at, closed_at, created_by, created_at, updated_at,
                 NULL::text AS assigned_user_name, NULL::text AS assigned_user_email,
                 NULL::text AS created_by_name, 0 AS call_count, 0 AS pending_followup_count`,
      [
        input.customerName,
        phone,
        alternatePhone,
        input.email ?? null,
        input.city ?? null,
        input.vehicleType ?? null,
        input.vehicleDetails ?? null,
        input.requirement ?? null,
        input.source,
        input.sourceDetail ?? null,
        assignedUserId,
        input.notes ?? null,
        req.auth!.userId,
      ],
      client,
    );

    await client.query(
      `INSERT INTO lead_activities (lead_id, user_id, type, body, metadata)
       VALUES ($1, $2, 'CREATED', $3, $4)`,
      [
        inserted.id,
        req.auth!.userId,
        `Lead created from ${input.source}`,
        JSON.stringify({ source: input.source, assignedUserId }),
      ],
    );

    return inserted;
  });

  logger.info({ leadId: lead.id, leadNumber: lead.lead_number }, 'Lead created');
  res.status(201).json({ lead: publicLead(lead) });
}

/** PATCH /api/v1/leads/:id */
export async function updateLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as UpdateLeadInput;

  const scope = scopeFor(req);
  const scopeParams = [id, ...scope.params];
  const scopeClause = scope.clause
    ? `AND (${scope.clause.replace(/\$1/g, `$${scopeParams.length - scope.params.length + 1}`)})`
    : '';

  const existing = await maybeOne<LeadRow>(`${SELECT_LEAD} WHERE l.id = $1 ${scopeClause}`, scopeParams);
  if (!existing) throw notFound('Lead');

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  let updatedPhone = existing.phone;
  if (input.customerName !== undefined) push('customer_name', input.customerName);
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw validationError('phone is not a valid phone number');
    updatedPhone = phone;
    push('phone', phone);
  }
  if (input.alternatePhone !== undefined) {
    if (input.alternatePhone === null) {
      push('alternate_phone', null);
    } else {
      const alternatePhone = normalizePhone(input.alternatePhone);
      if (!alternatePhone) throw validationError('alternatePhone is not a valid phone number');
      push('alternate_phone', alternatePhone);
    }
  }
  if (input.email !== undefined) push('email', input.email);
  if (input.city !== undefined) push('city', input.city);
  if (input.vehicleType !== undefined) push('vehicle_type', input.vehicleType);
  if (input.vehicleDetails !== undefined) push('vehicle_details', input.vehicleDetails);
  if (input.requirement !== undefined) push('requirement', input.requirement);
  if (input.source !== undefined) push('source', input.source);
  if (input.assignedUserId !== undefined) {
    await assertUserExists(input.assignedUserId);
    push('assigned_user_id', input.assignedUserId);
  }
  if (input.notes !== undefined) push('notes', input.notes);

  const statusChanged = input.status !== undefined && input.status !== existing.status;
  if (input.status !== undefined) {
    push('status', input.status);
    if (input.status === 'CONVERTED' || input.status === 'LOST') {
      sets.push('closed_at = now()');
    } else if (statusChanged) {
      sets.push('closed_at = NULL');
    }
  }
  if (input.lostReason !== undefined) push('lost_reason', input.lostReason);

  const assignmentChanged =
    input.assignedUserId !== undefined && input.assignedUserId !== existing.assigned_user_id;

  params.push(id);
  const updated = await withTransaction(async (client) => {
    // Acquire the same per-phone locks as ingestion in a consistent order. This
    // also protects phone edits/reopening from racing automatic lead creation.
    for (const phone of [...new Set([existing.phone, updatedPhone])].sort()) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`phone:${phone}`]);
    }
    const current = await maybeOne<{ phone: string; status: string; assigned_user_id: string | null }>(
      `SELECT l.phone, l.status, l.assigned_user_id FROM leads l WHERE l.id = $1 ${scopeClause} FOR UPDATE`, scopeParams, client,
    );
    if (!current) throw notFound('Lead');
    if (current.phone !== existing.phone || current.status !== existing.status || current.assigned_user_id !== existing.assigned_user_id) {
      throw conflict('Lead changed while you were editing; please reload and retry');
    }
    const reopening = input.status !== undefined && OPEN_LEAD_STATUSES.includes(input.status) && !OPEN_LEAD_STATUSES.some((status) => status === existing.status);
    if (input.phone !== undefined || reopening) await assertNoOpenDuplicate(updatedPhone, id, client);
    const row = await one<LeadRow>(
      `UPDATE leads SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, lead_number, customer_name, phone, alternate_phone, email, city,
                 vehicle_type, vehicle_details, requirement, source, source_detail,
                 platform_lead_id, assigned_user_id, status, notes, lost_reason,
                 last_contacted_at, next_followup_at, closed_at, created_by, created_at, updated_at,
                 (SELECT name FROM users WHERE id = leads.assigned_user_id) AS assigned_user_name,
                 (SELECT email FROM users WHERE id = leads.assigned_user_id) AS assigned_user_email,
                 (SELECT name FROM users WHERE id = leads.created_by) AS created_by_name,
                 (SELECT COUNT(*) FROM call_events WHERE lead_id = leads.id) AS call_count,
                 (SELECT COUNT(*) FROM followups WHERE lead_id = leads.id AND status = 'PENDING') AS pending_followup_count`,
      params,
      client,
    );

    if (statusChanged) {
      await client.query(
        `INSERT INTO lead_activities (lead_id, user_id, type, body, metadata)
         VALUES ($1, $2, 'STATUS_CHANGE', $3, $4)`,
        [
          id,
          req.auth!.userId,
          `Status changed from ${existing.status} to ${input.status}`,
          JSON.stringify({ from: existing.status, to: input.status }),
        ],
      );
    }

    if (assignmentChanged) {
      await client.query(
        `INSERT INTO lead_activities (lead_id, user_id, type, body, metadata)
         VALUES ($1, $2, 'ASSIGNMENT', $3, $4)`,
        [
          id,
          req.auth!.userId,
          input.assignedUserId ? 'Lead assigned' : 'Lead unassigned',
          JSON.stringify({ from: existing.assigned_user_id, to: input.assignedUserId }),
        ],
      );
    }

    return row;
  });

  logger.info({ leadId: id, statusChanged, assignmentChanged }, 'Lead updated');
  res.status(200).json({ lead: publicLead(updated) });
}

/** DELETE /api/v1/leads/:id — admin only. Hard delete; activities cascade. */
export async function deleteLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const lead = await maybeOne<{ id: string }>(`SELECT id FROM leads WHERE id = $1`, [id]);
  if (!lead) throw notFound('Lead');

  await maybeOne(`DELETE FROM leads WHERE id = $1`, [id]);
  logger.warn({ leadId: id }, 'Lead deleted by admin');
  res.status(204).send();
}

interface ActivityRow {
  id: string;
  lead_id: string;
  user_id: string | null;
  type: string;
  body: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  user_name: string | null;
}

function publicActivity(activity: ActivityRow) {
  return {
    id: activity.id,
    leadId: activity.lead_id,
    userId: activity.user_id,
    userName: activity.user_name,
    type: activity.type,
    body: activity.body,
    metadata: activity.metadata,
    createdAt: activity.created_at,
  };
}

/** GET /api/v1/leads/:id/activities */
export async function listActivities(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const query = req.query as unknown as ListActivitiesQuery;

  const scope = scopeFor(req);
  const scopeParams = [id, ...scope.params];
  const scopeClause = scope.clause
    ? `AND (${scope.clause.replace(/\$1/g, `$${scopeParams.length - scope.params.length + 1}`)})`
    : '';

  const lead = await maybeOne<{ id: string }>(`${SELECT_LEAD} WHERE l.id = $1 ${scopeClause}`, scopeParams);
  if (!lead) throw notFound('Lead');

  const countRow = await one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM lead_activities WHERE lead_id = $1`,
    [id],
  );

  const offset = (query.page - 1) * query.pageSize;
  const activities = await many<ActivityRow>(
    `SELECT a.id, a.lead_id, a.user_id, a.type, a.body, a.metadata, a.created_at, u.name AS user_name
       FROM lead_activities a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.lead_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2 OFFSET $3`,
    [id, query.pageSize, offset],
  );

  res.status(200).json({
    activities: activities.map(publicActivity),
    page: buildPageMeta(query.page, query.pageSize, countRow.total),
  });
}

/** POST /api/v1/leads/:id/activities */
export async function addActivity(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as AddActivityInput;

  const scope = scopeFor(req);
  const scopeParams = [id, ...scope.params];
  const scopeClause = scope.clause
    ? `AND (${scope.clause.replace(/\$1/g, `$${scopeParams.length - scope.params.length + 1}`)})`
    : '';

  const lead = await maybeOne<{ id: string }>(`${SELECT_LEAD} WHERE l.id = $1 ${scopeClause}`, scopeParams);
  if (!lead) throw notFound('Lead');

  const activity = await one<ActivityRow>(
    `INSERT INTO lead_activities (lead_id, user_id, type, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, lead_id, user_id, type, body, metadata, created_at,
               (SELECT name FROM users WHERE id = $2) AS user_name`,
    [id, req.auth!.userId, input.type, input.body],
  );

  res.status(201).json({ activity: publicActivity(activity) });
}
