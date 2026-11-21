'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { DashboardSummary, LeadStatus } from '@/lib/types';
import { Card, StatCard } from '@/components/ui/Card';
import { ErrorState, Spinner } from '@/components/ui/States';
import { STATUS_LABELS } from '@/components/ui/Badge';

const STATUS_ORDER: LeadStatus[] = ['NEW', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'CONVERTED', 'LOST'];

export default function DashboardPage() {
  const { user } = useAuth();
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => apiGet<DashboardSummary>('/api/v1/reports/summary'),
  });

  if (summary.isPending) return <Spinner />;
  if (summary.isError || !summary.data) {
    return (
      <ErrorState
        message="Could not load the dashboard summary. Please try again."
        onRetry={() => void summary.refetch()}
      />
    );
  }

  const { totals, byStatus, bySource, employees } = summary.data;
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <p className="text-slate-600">
        Welcome back, <span className="font-medium text-slate-900">{user?.name}</span>. Here is
        today&apos;s overview for {summary.data.date}.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total leads" value={totals.total_leads} tone="indigo" />
        <StatCard label="New today" value={totals.new_today} tone="blue" />
        <StatCard label="Pending follow-ups" value={totals.pending_followups} tone="amber" />
        <StatCard label="Overdue follow-ups" value={totals.overdue_followups} tone="red" />
        <StatCard label="Calls today" value={totals.calls_today} tone="slate" />
        <StatCard label="Total calls" value={totals.calls_total} tone="slate" />
        <StatCard label="Unmatched calls" value={totals.unmatched_calls} tone="amber" sublabel="Calls with no linked lead" />
        <StatCard
          label="Converted"
          value={byStatus.CONVERTED ?? 0}
          tone="green"
          sublabel={`${byStatus.LOST ?? 0} lost`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Leads by status">
          <ul className="space-y-3">
            {STATUS_ORDER.map((status) => {
              const count = byStatus[status] ?? 0;
              const max = Math.max(1, ...STATUS_ORDER.map((s) => byStatus[s] ?? 0));
              return (
                <li key={status} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-slate-600">{STATUS_LABELS[status]}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${Math.round((count / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-sm font-medium text-slate-900">{count}</span>
                </li>
              );
            })}
          </ul>
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
                    <td className="py-2 text-slate-700">{row.source.replace(/_/g, ' ')}</td>
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
        <Card
          title="Employee performance"
          action={
            <Link href="/reports" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
              View reports →
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 font-medium">Employee</th>
                  <th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">New</th>
                  <th className="pb-2 text-right font-medium">Interested</th>
                  <th className="pb-2 text-right font-medium">Converted</th>
                  <th className="pb-2 text-right font-medium">Follow-ups</th>
                  <th className="pb-2 text-right font-medium">Calls today</th>
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
                    <td className="py-2 text-right">{employee.interested}</td>
                    <td className="py-2 text-right font-medium text-emerald-700">{employee.converted}</td>
                    <td className="py-2 text-right">
                      {employee.pending_followups}
                      {employee.overdue_followups > 0 ? (
                        <span className="ml-1 text-xs text-red-600">
                          ({employee.overdue_followups} overdue)
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">{employee.calls_today}</td>
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
