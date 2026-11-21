'use client';

import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, Check, Pencil, Phone, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ApiError, type CallEvent, type Followup, type Lead, type LeadActivity, type LeadStatus, type UserWithCounts } from '@/lib/types';
import { formatDateTime, formatDuration, formatPhone, isoToLocalInput, localInputToIso, timeAgo } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, Spinner } from '@/components/ui/States';
import { SOURCE_LABELS, STATUS_LABELS, SourceBadge, StatusBadge } from '@/components/ui/Badge';
import { LeadForm } from '@/components/leads/LeadForm';
import { useToast } from '@/components/Toast';

const STATUSES = Object.keys(STATUS_LABELS) as LeadStatus[];

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [showEdit, setShowEdit] = useState(false);
  const [showFollowup, setShowFollowup] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);

  const leadQuery = useQuery({
    queryKey: ['lead', id],
    queryFn: () => apiGet<{ lead: Lead; previousLeads?: Array<{ id: string; leadCode: string; customerName: string; status: LeadStatus; createdAt: string }> }>(`/api/v1/leads/${id}`),
  });
  const activitiesQuery = useQuery({
    queryKey: ['lead-activities', id],
    queryFn: () =>
      apiGet<{ activities: LeadActivity[]; page: { total: number } }>(
        `/api/v1/leads/${id}/activities${toQuery({ page: 1, pageSize: 100 })}`,
      ),
  });
  const followupsQuery = useQuery({
    queryKey: ['lead-followups', id],
    queryFn: () =>
      apiGet<{ followups: Followup[] }>(`/api/v1/followups${toQuery({ leadId: id, pageSize: 50 })}`),
  });
  const callsQuery = useQuery({
    queryKey: ['lead-calls', id],
    queryFn: () =>
      apiGet<{ callEvents: CallEvent[] }>(`/api/v1/call-events${toQuery({ leadId: id, pageSize: 50 })}`),
  });
  const usersQuery = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => apiGet<{ users: UserWithCounts[] }>('/api/v1/users?status=ACTIVE'),
    enabled: user?.role === 'ADMIN',
  });

  const lead = leadQuery.data?.lead;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['lead', id] });
    void queryClient.invalidateQueries({ queryKey: ['lead-activities', id] });
    void queryClient.invalidateQueries({ queryKey: ['lead-followups', id] });
    void queryClient.invalidateQueries({ queryKey: ['lead-calls', id] });
    void queryClient.invalidateQueries({ queryKey: ['leads'] });
  }

  const statusMutation = useMutation({
    mutationFn: (next: LeadStatus) =>
      apiPatch(`/api/v1/leads/${id}`, {
        status: next,
        ...(next === 'LOST' ? { lostReason: lostReason.trim() } : {}),
      }),
    onSuccess: () => {
      toast.push('success', 'Lead status updated');
      setPendingStatus(null);
      setLostReason('');
      invalidate();
    },
    onError: (err) => {
      toast.push('error', err instanceof ApiError ? err.message : 'Could not update status');
    },
  });

  const assignMutation = useMutation({
    mutationFn: (assignedUserId: string | null) =>
      apiPatch(`/api/v1/leads/${id}`, { assignedUserId }),
    onSuccess: () => {
      toast.push('success', 'Lead assignment updated');
      invalidate();
    },
    onError: (err) => {
      toast.push('error', err instanceof ApiError ? err.message : 'Could not update assignment');
    },
  });

  if (leadQuery.isPending) return <Spinner />;
  if (leadQuery.isError || !lead) {
    return (
      <ErrorState
        message="Could not load this lead. It may have been deleted, or it is assigned to another employee."
        onRetry={() => void leadQuery.refetch()}
      />
    );
  }

  const leadFollowups = followupsQuery.data?.followups ?? [];
  const leadCalls = callsQuery.data?.callEvents ?? [];
  const activities = activitiesQuery.data?.activities ?? [];

  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold text-slate-900">{lead.customerName}</h2>
            <StatusBadge status={lead.status} />
            <SourceBadge source={lead.source} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {lead.leadCode} · {formatPhone(lead.phone)}
            {lead.alternatePhone ? ` · alt ${formatPhone(lead.alternatePhone)}` : ''}
            {lead.city ? ` · ${lead.city}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setShowNote(true)}>
            Add note
          </Button>
          <Button variant="secondary" onClick={() => setShowFollowup(true)}>
            <CalendarPlus className="h-4 w-4" /> Schedule follow-up
          </Button>
          <Button variant="secondary" onClick={() => setShowEdit(true)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Customer details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Detail label="Phone" value={formatPhone(lead.phone)} />
              <Detail label="Alternate phone" value={formatPhone(lead.alternatePhone)} />
              <Detail label="Email" value={lead.email} />
              <Detail label="City" value={lead.city} />
              <Detail label="Vehicle type" value={lead.vehicleType} />
              <Detail label="Vehicle details" value={lead.vehicleDetails} />
              <Detail label="Requirement" value={lead.requirement} wide />
              <Detail label="Notes" value={lead.notes} wide />
              <Detail label="Source" value={SOURCE_LABELS[lead.source]} />
              <Detail label="Source detail" value={lead.sourceDetail} />
              <Detail label="Assigned to" value={lead.assignedUserName ?? 'Unassigned'} />
              <Detail label="Created by" value={lead.createdByName} />
              <Detail label="Created" value={formatDateTime(lead.createdAt)} />
              <Detail label="Last contacted" value={formatDateTime(lead.lastContactedAt)} />
              <Detail label="Next follow-up" value={formatDateTime(lead.nextFollowupAt)} />
              <Detail label="Calls" value={String(lead.callCount)} />
              {lead.status === 'LOST' && lead.lostReason ? (
                <Detail label="Lost reason" value={lead.lostReason} wide />
              ) : null}
            </dl>
          </Card>

          {leadQuery.data?.previousLeads?.length ? (
            <Card title="Returning contact · previous leads">
              <p className="mb-3 text-sm text-slate-500">Earlier leads with this phone number that you can access.</p>
              <ul className="space-y-2 text-sm">
                {leadQuery.data.previousLeads.map((previous) => (
                  <li key={previous.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${previous.id}`} className="font-medium text-indigo-600 hover:underline">
                      {previous.leadCode} · {previous.customerName}
                    </Link>
                    <StatusBadge status={previous.status} />
                    <span className="text-slate-500">{formatDateTime(previous.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card
            title="Activity timeline"
            action={
              <Button size="sm" variant="secondary" onClick={() => setShowNote(true)}>
                Add note
              </Button>
            }
          >
            {activitiesQuery.isPending ? (
              <Spinner />
            ) : activities.length === 0 ? (
              <p className="text-sm text-slate-500">No activity yet.</p>
            ) : (
              <ol className="relative space-y-5 border-l border-slate-200 pl-5">
                {activities.map((activity) => (
                  <li key={activity.id} className="relative">
                    <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-400" />
                    <p className="text-sm font-medium text-slate-900">
                      {activity.type.replace(/_/g, ' ').toLowerCase()}
                      {activity.userName ? (
                        <span className="ml-2 font-normal text-slate-500">by {activity.userName}</span>
                      ) : null}
                    </p>
                    {activity.body ? <p className="mt-0.5 text-sm text-slate-700">{activity.body}</p> : null}
                    <p className="mt-0.5 text-xs text-slate-400" title={formatDateTime(activity.createdAt)}>
                      {timeAgo(activity.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={`Call history (${leadCalls.length})`}>
            {callsQuery.isPending ? (
              <Spinner />
            ) : leadCalls.length === 0 ? (
              <p className="text-sm text-slate-500">No calls recorded for this lead yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 font-medium">When</th>
                    <th className="pb-2 font-medium">Direction</th>
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 text-right font-medium">Duration</th>
                    <th className="pb-2 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {leadCalls.map((call) => (
                    <tr key={call.id} className="border-t border-slate-100">
                      <td className="py-2 text-slate-700">{formatDateTime(call.startedAt)}</td>
                      <td className="py-2">
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          {call.direction ?? 'Unknown'}
                        </span>
                      </td>
                      <td className="py-2 text-slate-700">{call.source}</td>
                      <td className="py-2 text-right">{formatDuration(call.durationSeconds)}</td>
                      <td className="py-2 text-slate-700">{call.userName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Update status">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={status === lead.status || statusMutation.isPending}
                    onClick={() => {
                      if (status === 'LOST') {
                        setPendingStatus(status);
                      } else {
                        statusMutation.mutate(status);
                      }
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      status === lead.status
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
              {pendingStatus === 'LOST' ? (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (lostReason.trim()) statusMutation.mutate('LOST');
                  }}
                >
                  <Field label="Reason for losing this lead" htmlFor="lostReason">
                    <Textarea
                      id="lostReason"
                      required
                      value={lostReason}
                      onChange={(event) => setLostReason(event.target.value)}
                      placeholder="e.g. Bought from a competitor, price too high…"
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" variant="danger" size="sm" disabled={statusMutation.isPending}>
                      Mark as lost
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPendingStatus(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          </Card>

          <Card title="Assignment">
            {user?.role === 'ADMIN' ? (
              <Select
                value={lead.assignedUserId ?? ''}
                onChange={(event) =>
                  assignMutation.mutate(event.target.value || null)
                }
                disabled={assignMutation.isPending}
                aria-label="Assign lead"
              >
                <option value="">Unassigned</option>
                {usersQuery.data?.users.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm text-slate-700">{lead.assignedUserName ?? 'Unassigned'}</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {lead.assignedUserName
                ? `Currently assigned to ${lead.assignedUserName}.`
                : 'This lead is unassigned and visible to all employees.'}
            </p>
          </Card>

          <Card
            title="Follow-ups"
            action={
              <Button size="sm" variant="secondary" onClick={() => setShowFollowup(true)}>
                <CalendarPlus className="h-4 w-4" /> Add
              </Button>
            }
          >
            {followupsQuery.isPending ? (
              <Spinner />
            ) : leadFollowups.length === 0 ? (
              <p className="text-sm text-slate-500">No follow-ups scheduled.</p>
            ) : (
              <ul className="space-y-3">
                {leadFollowups.map((followup) => (
                  <li key={followup.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{formatDateTime(followup.dueAt)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          followup.status === 'PENDING'
                            ? followup.isOverdue
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                            : followup.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {followup.status}
                        {followup.isOverdue ? ' · overdue' : ''}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Assigned to {followup.assignedUserName ?? '—'}
                    </p>
                    {followup.notes ? <p className="mt-1 text-slate-700">{followup.notes}</p> : null}
                    {followup.status === 'PENDING' ? (
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            apiPost(`/api/v1/followups/${followup.id}/complete`, {})
                              .then(() => {
                                toast.push('success', 'Follow-up completed');
                                invalidate();
                              })
                              .catch(() => toast.push('error', 'Could not complete follow-up'));
                          }}
                        >
                          <Check className="h-4 w-4" /> Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            apiPost(`/api/v1/followups/${followup.id}/cancel`, {})
                              .then(() => {
                                toast.push('success', 'Follow-up cancelled');
                                invalidate();
                              })
                              .catch(() => toast.push('error', 'Could not cancel follow-up'));
                          }}
                        >
                          <X className="h-4 w-4" /> Cancel
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit ${lead.leadCode}`} wide>
        <LeadForm
          lead={lead}
          onCancel={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            invalidate();
          }}
        />
      </Modal>

      <Modal open={showFollowup} onClose={() => setShowFollowup(false)} title="Schedule follow-up">
        <FollowupForm
          leadId={lead.id}
          defaultAssignee={lead.assignedUserId ?? user?.id ?? ''}
          onSaved={() => {
            setShowFollowup(false);
            invalidate();
          }}
          onCancel={() => setShowFollowup(false)}
        />
      </Modal>

      <Modal open={showNote} onClose={() => setShowNote(false)} title="Add note">
        <NoteForm
          leadId={lead.id}
          onSaved={() => {
            setShowNote(false);
            invalidate();
          }}
          onCancel={() => setShowNote(false)}
        />
      </Modal>
    </div>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value || '—'}</dd>
    </div>
  );
}

function FollowupForm({
  leadId,
  defaultAssignee,
  onSaved,
  onCancel,
}: {
  leadId: string;
  defaultAssignee: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [dueAt, setDueAt] = useState(isoToLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));
  const [assignee, setAssignee] = useState(defaultAssignee);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => apiGet<{ users: UserWithCounts[] }>('/api/v1/users?status=ACTIVE'),
    enabled: user?.role === 'ADMIN',
  });

  const mutation = useMutation({
    mutationFn: () => {
      const iso = localInputToIso(dueAt);
      if (!iso) throw new Error('Invalid date');
      return apiPost(`/api/v1/leads/${leadId}/followups`, {
        dueAt: iso,
        assignedUserId: assignee || undefined,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.push('success', 'Follow-up scheduled');
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not schedule follow-up');
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Due date & time" htmlFor="dueAt">
        <Input
          id="dueAt"
          type="datetime-local"
          required
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
        />
      </Field>
      {user?.role === 'ADMIN' ? (
        <Field label="Assign to" htmlFor="followupAssignee">
          <Select
            id="followupAssignee"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">Lead assignee / me</option>
            {users.data?.users.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Notes" htmlFor="followupNotes">
        <Textarea
          id="followupNotes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What should be discussed on the call?"
        />
      </Field>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Scheduling…' : 'Schedule follow-up'}
        </Button>
      </div>
    </form>
  );
}

function NoteForm({
  leadId,
  onSaved,
  onCancel,
}: {
  leadId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiPost(`/api/v1/leads/${leadId}/activities`, { type: 'NOTE', body: body.trim() }),
    onSuccess: () => {
      toast.push('success', 'Note added');
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not add note');
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Note" htmlFor="noteBody">
        <Textarea
          id="noteBody"
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="e.g. Customer asked for quotation on WhatsApp, will send tomorrow."
        />
      </Field>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Add note'}
        </Button>
      </div>
    </form>
  );
}
