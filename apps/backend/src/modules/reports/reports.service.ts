import type { Request, Response } from 'express';
import { many, one } from '../../db/pool';
import { formatLeadNumber } from '../../types/domain';
import { formatPhone } from '../../utils/phone';
import type { ExportLeadsQuery, SummaryQuery } from './reports.schemas';

interface StatusCountRow {
  status: string;
  count: number;
}

interface SourceCountRow {
  source: string;
  count: number;
  converted: number;
}

interface EmployeeRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
  total_leads: number;
  new_leads: number;
  contacted: number;
  interested: number;
  converted: number;
  lost: number;
  pending_followups: number;
  overdue_followups: number;
  calls_today: number;
  calls_total: number;
}

interface LeadExportRow {
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
  status: string;
  notes: string | null;
  lost_reason: string | null;
  assigned_user_name: string | null;
  next_followup_at: Date | null;
  last_contacted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join('\r\n') + '\r\n';
}

/**
 * GET /api/v1/reports/summary
 *
 * One-call dashboard payload: totals by status, by source, and per-employee
 * performance. All "today" figures are evaluated in Asia/Kolkata so the
 * numbers match what the client sees on the wall clock.
 */
export async function summary(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as SummaryQuery;
  const date = query.date ?? new Date().toISOString().slice(0, 10);

  // Employees only ever see their own numbers.
  const userFilter = req.auth!.role === 'ADMIN' ? query.userId ?? null : req.auth!.userId;

  const statusRows = await many<StatusCountRow>(
    `SELECT status, COUNT(*) AS count
       FROM leads
      WHERE ($1::uuid IS NULL OR assigned_user_id = $1)
      GROUP BY status`,
    [userFilter],
  );

  const sourceRows = await many<SourceCountRow>(
    `SELECT source,
            COUNT(*) AS count,
            COUNT(*) FILTER (WHERE status = 'CONVERTED') AS converted
       FROM leads
      WHERE ($1::uuid IS NULL OR assigned_user_id = $1)
      GROUP BY source
      ORDER BY count DESC`,
    [userFilter],
  );

  const employeeRows = await many<EmployeeRow>(
    `SELECT u.id AS user_id, u.name, u.email, u.role,
            COUNT(DISTINCT l.id) AS total_leads,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'NEW') AS new_leads,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'CONTACTED') AS contacted,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'INTERESTED') AS interested,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'CONVERTED') AS converted,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'LOST') AS lost,
            COUNT(DISTINCT f.id) FILTER (WHERE f.status = 'PENDING') AS pending_followups,
            COUNT(DISTINCT f.id) FILTER (WHERE f.status = 'PENDING' AND f.due_at < now()) AS overdue_followups,
            COUNT(DISTINCT ce.id) FILTER (WHERE ce.started_at::date = $1::date) AS calls_today,
            COUNT(DISTINCT ce.id) AS calls_total
       FROM users u
       LEFT JOIN leads l ON l.assigned_user_id = u.id
       LEFT JOIN followups f ON f.assigned_user_id = u.id
       LEFT JOIN call_events ce ON ce.user_id = u.id
      WHERE u.status = 'ACTIVE'
        AND ($2::uuid IS NULL OR u.id = $2)
      GROUP BY u.id, u.name, u.email, u.role
      ORDER BY total_leads DESC`,
    [date, userFilter],
  );

  const totals = await one<{
    total_leads: number;
    new_today: number;
    pending_followups: number;
    overdue_followups: number;
    calls_today: number;
    calls_total: number;
    unmatched_calls: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM leads WHERE ($1::uuid IS NULL OR assigned_user_id = $1)) AS total_leads,
       (SELECT COUNT(*) FROM leads
         WHERE created_at::date = $2::date
           AND ($1::uuid IS NULL OR assigned_user_id = $1)) AS new_today,
       (SELECT COUNT(*) FROM followups
         WHERE status = 'PENDING'
           AND ($1::uuid IS NULL OR assigned_user_id = $1)) AS pending_followups,
       (SELECT COUNT(*) FROM followups
         WHERE status = 'PENDING' AND due_at < now()
           AND ($1::uuid IS NULL OR assigned_user_id = $1)) AS overdue_followups,
       (SELECT COUNT(*) FROM call_events
         WHERE started_at::date = $2::date
           AND ($1::uuid IS NULL OR user_id = $1)) AS calls_today,
       (SELECT COUNT(*) FROM call_events WHERE ($1::uuid IS NULL OR user_id = $1)) AS calls_total,
       (SELECT COUNT(*) FROM call_events
         WHERE lead_id IS NULL
           AND ($1::uuid IS NULL OR user_id = $1)) AS unmatched_calls`,
    [userFilter, date],
  );

  res.status(200).json({
    date,
    totals,
    byStatus: Object.fromEntries(statusRows.map((row) => [row.status, row.count])),
    bySource: sourceRows.map((row) => ({
      source: row.source,
      count: row.count,
      converted: row.converted,
      conversionRate: row.count > 0 ? Math.round((row.converted / row.count) * 1000) / 10 : 0,
    })),
    employees: employeeRows,
  });
}

/**
 * GET /api/v1/reports/leads.csv
 *
 * CSV export (opens directly in Excel). Employees only get their own leads.
 * A UTF-8 BOM is prepended so Excel renders Indian names correctly.
 */
export async function exportLeadsCsv(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ExportLeadsQuery;
  const conditions: string[] = [];
  const params: unknown[] = [];
  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (req.auth!.role !== 'ADMIN') {
    conditions.push(`l.assigned_user_id = ${push(req.auth!.userId)}`);
  } else if (query.assignedUserId) {
    conditions.push(`l.assigned_user_id = ${push(query.assignedUserId)}`);
  }
  if (query.status) conditions.push(`l.status = ${push(query.status)}`);
  if (query.source) conditions.push(`l.source = ${push(query.source)}`);
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

  const leads = await many<LeadExportRow>(
    `SELECT l.lead_number, l.customer_name, l.phone, l.alternate_phone, l.email, l.city,
            l.vehicle_type, l.vehicle_details, l.requirement, l.source, l.status, l.notes,
            l.lost_reason, au.name AS assigned_user_name, l.next_followup_at,
            l.last_contacted_at, l.created_at, l.updated_at
       FROM leads l
       LEFT JOIN users au ON au.id = l.assigned_user_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT ${push(query.limit)}`,
    params,
  );

  const headers = [
    'Lead Code',
    'Customer Name',
    'Phone',
    'Alternate Phone',
    'Email',
    'City',
    'Vehicle Type',
    'Vehicle Details',
    'Requirement',
    'Source',
    'Status',
    'Assigned To',
    'Notes',
    'Lost Reason',
    'Next Follow-up',
    'Last Contacted',
    'Created At',
    'Updated At',
  ];

  const rows = leads.map((lead) => [
    formatLeadNumber(lead.lead_number),
    lead.customer_name,
    formatPhone(lead.phone),
    formatPhone(lead.alternate_phone),
    lead.email,
    lead.city,
    lead.vehicle_type,
    lead.vehicle_details,
    lead.requirement,
    lead.source,
    lead.status,
    lead.assigned_user_name,
    lead.notes,
    lead.lost_reason,
    lead.next_followup_at,
    lead.last_contacted_at,
    lead.created_at,
    lead.updated_at,
  ]);

  const csv = '﻿' + toCsv(headers, rows);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kotalabs-leads.csv"');
  res.setHeader('X-Export-Row-Count', String(leads.length));
  res.send(csv);
}
