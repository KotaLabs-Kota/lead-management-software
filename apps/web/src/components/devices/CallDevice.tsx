import type { CallEvent } from '@/lib/types';

/** Device ID distinguishes separate registrations even for identical models. */
export function CallDevice({ call }: { call: Pick<CallEvent, 'deviceId' | 'deviceName'> }) {
  if (!call.deviceId) return <span>—</span>;
  return (
    <span className="inline-block" title={`Device ID: ${call.deviceId}`}>
      <span className="block">{call.deviceName ?? 'Unknown device'}</span>
      <span className="block text-xs text-slate-500">ID: {call.deviceId}</span>
    </span>
  );
}
