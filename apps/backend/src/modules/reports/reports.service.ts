import type { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { renderLeadsPdf } from './leads-pdf';
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
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Spreadsheet apps may execute cells beginning with formula characters.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
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
  const date = query.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

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

  // Aggregate independently before joining to avoid a leads × followups × calls
  // cross-product, which becomes prohibitively expensive as call history grows.
  const employeeRows = await many<EmployeeRow>(
    `SELECT u.id AS user_id, u.name, u.email, u.role,
            COALESCE(l.total_leads, 0) AS total_leads, COALESCE(l.new_leads, 0) AS new_leads,
            COALESCE(l.contacted, 0) AS contacted, COALESCE(l.interested, 0) AS interested,
            COALESCE(l.converted, 0) AS converted, COALESCE(l.lost, 0) AS lost,
            COALESCE(f.pending_followups, 0) AS pending_followups,
            COALESCE(f.overdue_followups, 0) AS overdue_followups,
            COALESCE(c.calls_today, 0) AS calls_today, COALESCE(c.calls_total, 0) AS calls_total
       FROM users u
       LEFT JOIN (
         SELECT assigned_user_id, COUNT(*) AS total_leads,
           COUNT(*) FILTER (WHERE status = 'NEW') AS new_leads,
           COUNT(*) FILTER (WHERE status = 'CONTACTED') AS contacted,
           COUNT(*) FILTER (WHERE status = 'INTERESTED') AS interested,
           COUNT(*) FILTER (WHERE status = 'CONVERTED') AS converted,
           COUNT(*) FILTER (WHERE status = 'LOST') AS lost
         FROM leads WHERE ($2::uuid IS NULL OR assigned_user_id = $2) GROUP BY assigned_user_id
       ) l ON l.assigned_user_id = u.id
       LEFT JOIN (
         SELECT assigned_user_id, COUNT(*) FILTER (WHERE status = 'PENDING') AS pending_followups,
           COUNT(*) FILTER (WHERE status = 'PENDING' AND due_at < now()) AS overdue_followups
         FROM followups WHERE ($2::uuid IS NULL OR assigned_user_id = $2) GROUP BY assigned_user_id
       ) f ON f.assigned_user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS calls_total,
           COUNT(*) FILTER (WHERE started_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
             AND started_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')) AS calls_today
         FROM call_events WHERE ($2::uuid IS NULL OR user_id = $2) GROUP BY user_id
       ) c ON c.user_id = u.id
       WHERE u.status = 'ACTIVE' AND ($2::uuid IS NULL OR u.id = $2)
       ORDER BY total_leads DESC, u.id`,
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
         WHERE created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
           AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
           AND ($1::uuid IS NULL OR assigned_user_id = $1)) AS new_today,
       (SELECT COUNT(*) FROM followups
         WHERE status = 'PENDING'
           AND ($1::uuid IS NULL OR assigned_user_id = $1)) AS pending_followups,
       (SELECT COUNT(*) FROM followups
         WHERE status = 'PENDING' AND due_at < now()
           AND ($1::uuid IS NULL OR assigned_user_id = $1)) AS overdue_followups,
       (SELECT COUNT(*) FROM call_events
         WHERE started_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
           AND started_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
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
 * Shared bounded query for admin-only CSV and PDF exports.
 */
async function loadExportLeads(query: ExportLeadsQuery): Promise<{ leads: LeadExportRow[]; hasMore: boolean }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.assignedUserId) {
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
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ${push(query.limit + 1)} OFFSET ${push(query.offset)}`,
    params,
  );
  return { leads: leads.slice(0, query.limit), hasMore: leads.length > query.limit };
}

const exportHeaders = [
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

function exportRows(leads: LeadExportRow[]): unknown[][] {
  return leads.map((lead) => [
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
}

function setExportHeaders(res: Response, count: number, hasMore: boolean): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Export-Row-Count', String(count));
  res.setHeader('X-Export-Has-More', String(hasMore));
}

/** CSV with a UTF-8 BOM and spreadsheet formula protection. */
export async function exportLeadsCsv(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ExportLeadsQuery;
  const { leads, hasMore } = await loadExportLeads(query);
  const csv = '\uFEFF' + toCsv(exportHeaders, exportRows(leads));
  setExportHeaders(res, leads.length, hasMore);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kotalabs-leads.csv"');
  res.send(csv);
}

/** Generate a paginated PDF with the same filtered fields as the CSV. */
export async function exportLeadsPdf(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ExportLeadsQuery;
  const { leads, hasMore } = await loadExportLeads(query);
  // This font covers Devanagari and Latin so customer names can appear correctly.
  const fontPath = require.resolve('@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf');
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'KotaLabs CRM lead export' } });
  doc.font(fontPath);
  setExportHeaders(res, leads.length, hasMore);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="kotalabs-leads.pdf"');
  doc.pipe(res);
  renderLeadsPdf(doc, leads.map((lead) => ({
    code: formatLeadNumber(lead.lead_number),
    groups: [
      { title: 'Customer', fields: [
        { label: 'Customer name', value: lead.customer_name },
        { label: 'Phone', value: formatPhone(lead.phone) },
        { label: 'Alternate phone', value: formatPhone(lead.alternate_phone) },
        { label: 'Email', value: lead.email },
        { label: 'City', value: lead.city },
      ] },
      { title: 'Lead details', fields: [
        { label: 'Status', value: lead.status.replaceAll('_', ' ') },
        { label: 'Source', value: lead.source.replaceAll('_', ' ') },
        { label: 'Assigned to', value: lead.assigned_user_name },
        { label: 'Vehicle type', value: lead.vehicle_type },
        { label: 'Vehicle details', value: lead.vehicle_details },
        { label: 'Requirement', value: lead.requirement },
        { label: 'Notes', value: lead.notes },
        { label: 'Lost reason', value: lead.lost_reason },
      ] },
      { title: 'Dates', fields: [
        { label: 'Next follow-up', value: lead.next_followup_at },
        { label: 'Last contacted', value: lead.last_contacted_at },
        { label: 'Created', value: lead.created_at },
        { label: 'Updated', value: lead.updated_at },
      ] },
    ],
  })), query.offset, hasMore);
  doc.end();
}
