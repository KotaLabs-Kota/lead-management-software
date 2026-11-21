'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { apiGet, downloadFile, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { DashboardSummary, LeadSource, LeadStatus, UserWithCounts } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card, StatCard } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { ErrorState, Spinner } from '@/components/ui/States';
import { SOURCE_LABELS, STATUS_LABELS } from '@/components/ui/Badge';
import { useToast } from '@/components/Toast';

const STATUSES = Object.keys(STATUS_LABELS) as LeadStatus[];
const SOURCES = Object.keys(SOURCE_LABELS) as LeadSource[];

export default function ReportsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [exportSource, setExportSource] = useState('');
  const [exportAssignee, setExportAssignee] = useState('');
  const [exporting, setExporting] = useState(false);

  const users = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => apiGet<{ users: UserWithCounts[] }>('/api/v1/users?status=ACTIVE'),
    enabled: user?.role === 'ADMIN',
  });

  const summary = useQuery({
    queryKey: ['summary', date],
    queryFn: () =>
      apiGet<DashboardSummary>(
        `/api/v1/reports/summary${toQuery({ date: date || undefined })}`,
      ),
  });

  async function onExport() {
    setExporting(true);
    try {
      await downloadFile(
        `/api/v1/reports/leads.csv${toQuery({
          status: exportStatus || undefined,
          source: exportSource || undefined,
          assignedUserId: exportAssignee || undefined,
        })}`,
        'kotalabs-leads.csv',
      );
      toast.push('success', 'CSV export downloaded');
    } catch {
      toast.push('error', 'Could not export leads. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title="Export leads to CSV"
        action={
          <Button onClick={onExport} disabled={exporting}>
            <Download className="h-4 w-4" />
            {exporting ? 'Exporting…' : 'Download CSV'}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="exportStatus" className="mb-1 block text-sm font-medium text-slate-700">
              Status
            </label>
            <Select
              id="exportStatus"
              className="w-44"
              value={exportStatus}
              onChange={(event) => setExportStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="exportSource" className="mb-1 block text-sm font-medium text-slate-700">
              Source
            </label>
            <Select
              id="exportSource"
              className="w-44"
              value={exportSource}
              onChange={(event) => setExportSource(event.target.value)}
            >
              <option value="">All sources</option>
              {SOURCES.map((value) => (
                <option key={value} value={value}>
                  {SOURCE_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          {user?.role === 'ADMIN' ? (
            <div>
              <label htmlFor="exportAssignee" className="mb-1 block text-sm font-medium text-slate-700">
                Assigned to
              </label>
              <Select
                id="exportAssignee"
                className="w-44"
                value={exportAssignee}
                onChange={(event) => setExportAssignee(event.target.value)}
              >
                <option value="">Everyone</option>
                {users.data?.users.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          The CSV opens directly in Excel (UTF-8 with BOM) and includes lead code, customer, phone,
          vehicle, source, status, assignee, notes, and dates. Employees only export their own leads.
        </p>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="reportDate" className="mb-1 block text-sm font-medium text-slate-700">
            Report date
          </label>
          <Input
            id="reportDate"
            type="date"
            className="w-44"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <p className="pb-2 text-xs text-slate-500">Leave empty for today. Dates are evaluated in IST.</p>
      </div>

      {summary.isPending ? (
        <Spinner />
      ) : summary.isError || !summary.data ? (
        <ErrorState
          message="Could not load the report. Please try again."
          onRetry={() => void summary.refetch()}
        />
      ) : (
        <ReportBody data={summary.data} isAdmin={user?.role === 'ADMIN'} />
      )}
    </div>
  );
}

function ReportBody({ data, isAdmin }: { data: DashboardSummary; isAdmin: boolean }) {
  const { totals, byStatus, bySource, employees } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total leads" value={totals.total_leads} tone="indigo" />
        <StatCard label="New on this date" value={totals.new_today} tone="blue" />
        <StatCard label="Calls on this date" value={totals.calls_today} tone="slate" />
        <StatCard label="Unmatched calls" value={totals.unmatched_calls} tone="amber" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Leads by status">
          <table className="w-full text-sm">
            <tbody>
              {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((status) => (
                <tr key={status} className="border-t border-slate-100 first:border-0">
                  <td className="py-2 text-slate-700">{STATUS_LABELS[status]}</td>
                  <td className="py-2 text-right font-medium">{byStatus[status] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Leads by source">
          {bySource.length === 0 ? (
            <p className="text-sm text-slate-500">No leads yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">Converted</th>
                  <th className="pb-2 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((row) => (
                  <tr key={row.source} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">{SOURCE_LABELS[row.source]}</td>
                    <td className="py-2 text-right font-medium">{row.count}</td>
                    <td className="py-2 text-right">{row.converted}</td>
                    <td className="py-2 text-right">{row.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {isAdmin && employees.length > 0 ? (
        <Card title="Employee performance">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 font-medium">Employee</th>
                  <th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">New</th>
                  <th className="pb-2 text-right font-medium">Contacted</th>
                  <th className="pb-2 text-right font-medium">Interested</th>
                  <th className="pb-2 text-right font-medium">Converted</th>
                  <th className="pb-2 text-right font-medium">Lost</th>
                  <th className="pb-2 text-right font-medium">Pending FU</th>
                  <th className="pb-2 text-right font-medium">Overdue FU</th>
                  <th className="pb-2 text-right font-medium">Calls (date)</th>
                  <th className="pb-2 text-right font-medium">Calls (total)</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.user_id} className="border-t border-slate-100">
                    <td className="py-2">
                      <span className="font-medium text-slate-900">{employee.name}</span>
                      <span className="ml-2 text-xs text-slate-500">{employee.email}</span>
                    </td>
                    <td className="py-2 text-right">{employee.total_leads}</td>
                    <td className="py-2 text-right">{employee.new_leads}</td>
                    <td className="py-2 text-right">{employee.contacted}</td>
                    <td className="py-2 text-right">{employee.interested}</td>
                    <td className="py-2 text-right font-medium text-emerald-700">{employee.converted}</td>
                    <td className="py-2 text-right">{employee.lost}</td>
                    <td className="py-2 text-right">{employee.pending_followups}</td>
                    <td className="py-2 text-right">{employee.overdue_followups}</td>
                    <td className="py-2 text-right">{employee.calls_today}</td>
                    <td className="py-2 text-right">{employee.calls_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
