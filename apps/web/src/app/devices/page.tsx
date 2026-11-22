'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ApiError, type Device } from '@/lib/types';
import { formatDateTime, timeAgo } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { DeviceIdentity } from '@/components/devices/DeviceIdentity';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/States';
import { useToast } from '@/components/Toast';

export default function DevicesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [revoking, setRevoking] = useState<Device | null>(null);

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => apiGet<{ devices: Device[] }>('/api/v1/devices'),
    enabled: user?.role === 'ADMIN',
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/devices/${id}/revoke`, {}),
    onSuccess: () => {
      toast.push('success', 'Device revoked');
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => {
      toast.push('error', err instanceof ApiError ? err.message : 'Could not revoke device');
    },
  });

  if (user?.role !== 'ADMIN') {
    return (
      <ErrorState message="Only administrators can view registered devices." />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Registered Android phones that sync call events. Revoke a device immediately if a phone is
        lost or replaced — its sync token stops working instantly.
      </p>

      <Card className="p-0">
        {devices.isPending ? (
          <Spinner />
        ) : devices.isError ? (
          <ErrorState
            message="Could not load devices. Please try again."
            onRetry={() => void devices.refetch()}
          />
        ) : devices.data.devices.length === 0 ? (
          <EmptyState
            title="No devices registered"
            description="Devices are registered from the Android app when an employee signs in."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Device</th>
                  <th className="px-3 py-3 font-medium">Employee</th>
                  <th className="px-3 py-3 font-medium">Model</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Last seen</th>
                  <th className="px-3 py-3 font-medium">Registered</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.data.devices.map((device) => (
                  <tr key={device.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <DeviceIdentity device={device} />
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-slate-900">{device.userName}</p>
                      <p className="text-xs text-slate-500">{device.userEmail}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {[device.manufacturer, device.model].filter(Boolean).join(' ') || '—'}
                      {device.androidVersion ? (
                        <span className="text-slate-400"> · Android {device.androidVersion}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={device.status === 'ACTIVE' ? 'green' : 'red'}>
                        {device.status === 'ACTIVE' ? 'Active' : 'Revoked'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-500" title={formatDateTime(device.lastSeenAt)}>
                      {device.lastSeenAt ? timeAgo(device.lastSeenAt) : 'Never'}
                    </td>
                    <td className="px-3 py-3 text-slate-500">{formatDateTime(device.registeredAt)}</td>
                    <td className="px-5 py-3">
                      {device.status === 'ACTIVE' ? (
                        <Button size="sm" variant="danger" onClick={() => setRevoking(device)}>
                          Revoke
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Revoked {device.revokedAt ? formatDateTime(device.revokedAt) : ''}
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

      <Modal open={Boolean(revoking)} onClose={() => setRevoking(null)} title="Revoke device">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-500" />
          <p className="text-sm text-slate-700">
            Revoke <span className="font-medium">{revoking?.deviceName ?? revoking?.deviceCode}</span>?
            Device ID: <span className="font-mono">{revoking?.id}</span>. Compare this with the ID shown
            on the phone before confirming. The phone will no longer be able to upload with this token.
            The employee will need to register the device again from the Android app.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRevoking(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={revokeMutation.isPending}
            onClick={() => revoking && revokeMutation.mutate(revoking.id)}
          >
            {revokeMutation.isPending ? 'Revoking…' : 'Revoke device'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
