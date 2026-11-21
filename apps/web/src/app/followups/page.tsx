'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { apiGet, apiPost, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Followup, FollowupStatus, PageMeta, UserWithCounts } from '@/lib/types';
import { formatDateTime, formatPhone } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/Toast';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'MISSED', label: 'Missed' },
];

export default function FollowupsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [assignee, setAssignee] = useState('');

  const users = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => apiGet<{ users: UserWithCounts[] }>('/api/v1/users?status=ACTIVE'),
    enabled: user?.role === 'ADMIN',
  });

  const followups = useQuery({
    queryKey: ['followups', page, status, overdueOnly, assignee],
    queryFn: () =>
      apiGet<{ followups: Followup[]; page: PageMeta }>(
        `/api/v1/followups${toQuery({
          page,
          pageSize: 25,
          status: (status || undefined) as FollowupStatus | undefined,
          overdue: overdueOnly ? 'true' : undefined,
          assignedUserId: assignee || undefined,
        })}`,
      ),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/followups/${id}/complete`, {}),
    onSuccess: () => {
      toast.push('success', 'Follow-up completed');
      void queryClient.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: () => toast.push('error', 'Could not complete follow-up'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/followups/${id}/cancel`, {}),
    onSuccess: () => {
      toast.push('success', 'Follow-up cancelled');
      void queryClient.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: () => toast.push('error', 'Could not cancel follow-up'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          className="w-44"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => {
              setOverdueOnly(event.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Overdue only
        </label>
        {user?.role === 'ADMIN' ? (
          <Select
            className="w-44"
            value={assignee}
            onChange={(event) => {
              setAssignee(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by assignee"
          >
            <option value="">All assignees</option>
            {users.data?.users.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      <Card className="p-0">
        {followups.isPending ? (
          <Spinner />
        ) : followups.isError ? (
          <ErrorState
            message="Could not load follow-ups. Please try again."
            onRetry={() => void followups.refetch()}
          />
        ) : followups.data.followups.length === 0 ? (
          <EmptyState
            title="No follow-ups found"
            description="Schedule a follow-up from a lead page to see it here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Due</th>
                  <th className="px-3 py-3 font-medium">Lead</th>
                  <th className="px-3 py-3 font-medium">Customer</th>
                  <th className="px-3 py-3 font-medium">Assigned to</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Notes</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {followups.data.followups.map((followup) => (
                  <tr key={followup.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <span className={followup.isOverdue ? 'font-medium text-red-700' : 'text-slate-700'}>
                        {formatDateTime(followup.dueAt)}
                      </span>
                      {followup.isOverdue ? (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          overdue
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/leads/${followup.leadId}`}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {followup.leadCode ?? 'Lead'}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-900">{followup.customerName ?? '—'}</p>
                      <p className="text-xs text-slate-500">{formatPhone(followup.leadPhone)}</p>
                      {followup.leadStatus ? (
                        <span className="mt-1 inline-block">
                          <StatusBadge status={followup.leadStatus} />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{followup.assignedUserName ?? '—'}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          followup.status === 'PENDING'
                            ? 'bg-amber-100 text-amber-800'
                            : followup.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {followup.status}
                      </span>
                    </td>
                    <td className="max-w-56 px-3 py-3 text-slate-600">{followup.notes ?? '—'}</td>
                    <td className="px-5 py-3">
                      {followup.status === 'PENDING' ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={completeMutation.isPending}
                            onClick={() => completeMutation.mutate(followup.id)}
                          >
                            <Check className="h-4 w-4" /> Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={cancelMutation.isPending}
                            onClick={() => cancelMutation.mutate(followup.id)}
                          >
                            <X className="h-4 w-4" /> Cancel
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {followup.completedAt ? formatDateTime(followup.completedAt) : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {followups.data ? <Pagination page={followups.data.page} onChange={setPage} /> : null}
    </div>
  );
}
