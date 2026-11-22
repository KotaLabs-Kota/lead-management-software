'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Unlink } from 'lucide-react';
import { apiGet, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CallDirection, CallEvent, CallSource, Device, PageMeta, UserWithCounts } from '@/lib/types';
import { formatDateTime, formatDuration, formatPhone } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { CallDevice } from '@/components/devices/CallDevice';
import { Input, Select } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/States';

const DIRECTIONS: CallDirection[] = ['INCOMING', 'OUTGOING', 'MISSED', 'REJECTED', 'UNKNOWN'];
const SOURCES: CallSource[] = ['SIM', 'WHATSAPP', 'MANUAL'];

function DirectionIcon({ direction }: { direction: CallDirection | null }) {
  switch (direction) {
    case 'INCOMING':
      return <PhoneIncoming className="h-4 w-4 text-emerald-600" />;
    case 'OUTGOING':
      return <PhoneOutgoing className="h-4 w-4 text-blue-600" />;
    case 'MISSED':
      return <PhoneMissed className="h-4 w-4 text-red-600" />;
    default:
      return <Phone className="h-4 w-4 text-slate-400" />;
  }
}

export default function CallsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [phone, setPhone] = useState('');
  const [direction, setDirection] = useState('');
  const [source, setSource] = useState('');
  const [unmatched, setUnmatched] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [deviceId, setDeviceId] = useState('');

  const users = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => apiGet<{ users: UserWithCounts[] }>('/api/v1/users?status=ACTIVE'),
    enabled: user?.role === 'ADMIN',
  });

  const devices = useQuery({
    queryKey: ['devices', 'call-filter'],
    queryFn: () => apiGet<{ devices: Device[] }>('/api/v1/devices'),
    enabled: user?.role === 'ADMIN',
  });

  const calls = useQuery({
    queryKey: ['calls', page, phone, direction, source, unmatched, assignee, deviceId],
    queryFn: () =>
      apiGet<{ callEvents: CallEvent[]; page: PageMeta }>(
        `/api/v1/call-events${toQuery({
          page,
          pageSize: 25,
          phone: phone || undefined,
          direction: (direction || undefined) as CallDirection | undefined,
          source: (source || undefined) as CallSource | undefined,
          unmatched: unmatched ? 'true' : undefined,
          userId: assignee || undefined,
          deviceId: deviceId || undefined,
        })}`,
      ),
  });

  function reset() {
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-56"
          placeholder="Phone number…"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            reset();
          }}
        />
        <Select
          className="w-40"
          value={direction}
          onChange={(event) => {
            setDirection(event.target.value);
            reset();
          }}
          aria-label="Filter by direction"
        >
          <option value="">All directions</option>
          {DIRECTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          className="w-40"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            reset();
          }}
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {SOURCES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={unmatched}
            onChange={(event) => {
              setUnmatched(event.target.checked);
              reset();
            }}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Unmatched only
        </label>
        {user?.role === 'ADMIN' ? (
          <Select
            className="w-44"
            value={assignee}
            onChange={(event) => {
              setAssignee(event.target.value);
              reset();
            }}
            aria-label="Filter by employee"
          >
            <option value="">All employees</option>
            {users.data?.users.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        ) : null}
        {user?.role === 'ADMIN' ? (
          <Select className="w-64" value={deviceId} aria-label="Filter by phone"
            onChange={(event) => { setDeviceId(event.target.value); reset(); }}>
            <option value="">All phones</option>
            {devices.data?.devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.deviceName ?? 'Unknown device'} · {device.userName} · {device.id.slice(0, 8)}{device.status === 'REVOKED' ? ' (revoked)' : ''}
              </option>
            ))}
          </Select>
        ) : null}
        {devices.isError && user?.role === 'ADMIN' ? <span className="text-sm text-red-700">Could not load phone filter.</span> : null}
      </div>

      <Card className="p-0">
        {calls.isPending ? (
          <Spinner />
        ) : calls.isError ? (
          <ErrorState
            message="Could not load call history. Please try again."
            onRetry={() => void calls.refetch()}
          />
        ) : calls.data.callEvents.length === 0 ? (
          <EmptyState
            title="No calls found"
            description="Calls synced from employee phones and manually logged WhatsApp calls appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-3 py-3 font-medium">Direction</th>
                  <th className="px-3 py-3 font-medium">Number</th>
                  <th className="px-3 py-3 font-medium">Source</th>
                  <th className="px-3 py-3 text-right font-medium">Duration</th>
                  <th className="px-3 py-3 font-medium">Employee</th>
                  <th className="px-3 py-3 font-medium">Device</th>
                  <th className="px-5 py-3 font-medium">Lead</th>
                </tr>
              </thead>
              <tbody>
                {calls.data.callEvents.map((call) => (
                  <tr key={call.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-700">{formatDateTime(call.startedAt)}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-2 text-slate-700">
                        <DirectionIcon direction={call.direction} />
                        {call.direction ?? 'Unknown'}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">{call.contactName ? <div>{call.contactName} <span className="text-xs font-normal text-slate-500">(phone contact)</span></div> : null}{formatPhone(call.phoneNumber)}</td>
                    <td className="px-3 py-3 text-slate-700">{call.source}</td>
                    <td className="px-3 py-3 text-right">{formatDuration(call.durationSeconds)}</td>
                    <td className="px-3 py-3 text-slate-700">{call.userName ?? '—'}</td>
                    <td className="px-3 py-3 text-slate-700"><CallDevice call={call} /></td>
                    <td className="px-5 py-3">
                      {call.leadId && call.leadCode ? (
                        <Link
                          href={`/leads/${call.leadId}`}
                          className="font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          {call.leadCode}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                          <Unlink className="h-3.5 w-3.5" /> unmatched
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

      {calls.data ? <Pagination page={calls.data.page} onChange={setPage} /> : null}
    </div>
  );
}
