'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { apiGet, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Lead, LeadSource, LeadStatus, PageMeta, UserWithCounts } from '@/lib/types';
import { formatDateTime, formatPhone, timeAgo } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/States';
import { SOURCE_LABELS, STATUS_LABELS, SourceBadge, StatusBadge } from '@/components/ui/Badge';
import { LeadForm } from '@/components/leads/LeadForm';

const STATUSES = Object.keys(STATUS_LABELS) as LeadStatus[];
const SOURCES = Object.keys(SOURCE_LABELS) as LeadSource[];

interface LeadsResponse {
  leads: Lead[];
  page: PageMeta;
}

export default function LeadsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [assignee, setAssignee] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const users = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => apiGet<{ users: UserWithCounts[] }>('/api/v1/users?status=ACTIVE'),
    enabled: user?.role === 'ADMIN',
  });

  const leads = useQuery({
    queryKey: ['leads', page, search, status, source, assignee],
    queryFn: () =>
      apiGet<LeadsResponse>(
        `/api/v1/leads${toQuery({
          page,
          pageSize: 25,
          search: search || undefined,
          status: status || undefined,
          source: source || undefined,
          assignedUserId: assignee || undefined,
        })}`,
      ),
  });

  function resetPage() {
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search name, phone, vehicle, city…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
          />
        </div>
        <Select
          className="w-40"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            resetPage();
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          className="w-40"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            resetPage();
          }}
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {SOURCES.map((value) => (
            <option key={value} value={value}>
              {SOURCE_LABELS[value]}
            </option>
          ))}
        </Select>
        {user?.role === 'ADMIN' ? (
          <Select
            className="w-44"
            value={assignee}
            onChange={(event) => {
              setAssignee(event.target.value);
              resetPage();
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
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New lead
        </Button>
      </div>

      <Card className="p-0">
        {leads.isPending ? (
          <Spinner />
        ) : leads.isError ? (
          <ErrorState
            message="Could not load leads. Please try again."
            onRetry={() => void leads.refetch()}
          />
        ) : leads.data.leads.length === 0 ? (
          <EmptyState
            title="No leads found"
            description="Try changing the filters, or add a new lead."
            action={
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" /> New lead
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Lead</th>
                  <th className="px-3 py-3 font-medium">Customer</th>
                  <th className="px-3 py-3 font-medium">Vehicle</th>
                  <th className="px-3 py-3 font-medium">Source</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Assigned to</th>
                  <th className="px-3 py-3 font-medium">Follow-up</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.data.leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {lead.leadCode}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-900">{lead.customerName}</p>
                      <p className="text-xs text-slate-500">{formatPhone(lead.phone)}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {lead.vehicleType ?? '—'}
                      {lead.city ? <span className="text-slate-400"> · {lead.city}</span> : null}
                    </td>
                    <td className="px-3 py-3">
                      <SourceBadge source={lead.source} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-3 py-3 text-slate-700">{lead.assignedUserName ?? 'Unassigned'}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {lead.nextFollowupAt ? formatDateTime(lead.nextFollowupAt) : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500" title={formatDateTime(lead.createdAt)}>
                      {timeAgo(lead.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {leads.data ? <Pagination page={leads.data.page} onChange={setPage} /> : null}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New lead" wide>
        <LeadForm
          onCancel={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            void leads.refetch();
          }}
        />
      </Modal>
    </div>
  );
}
