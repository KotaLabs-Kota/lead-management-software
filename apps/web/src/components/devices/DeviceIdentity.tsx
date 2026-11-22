import type { Device } from '@/lib/types';

/** The device ID is the same one displayed in the Android sync app. */
export function DeviceIdentity({ device }: { device: Pick<Device, 'id' | 'deviceName' | 'deviceCode'> }) {
  return (
    <div>
      <p className="font-medium text-slate-900">{device.deviceName ?? 'Android device'}</p>
      <p className="text-xs text-slate-500">Device ID: {device.id}</p>
      <p className="text-xs text-slate-500">Registration code: {device.deviceCode}</p>
    </div>
  );
}
