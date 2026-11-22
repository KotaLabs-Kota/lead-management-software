import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceBadge, StatusBadge } from '@/components/ui/Badge';
import { DeviceIdentity } from '@/components/devices/DeviceIdentity';
import { CallDevice } from '@/components/devices/CallDevice';
import { StatCard } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { formatDuration, formatPhone, timeAgo } from '@/lib/format';

describe('StatusBadge', () => {
  it('renders the human readable label for each status', () => {
    const { rerender } = render(<StatusBadge status="NEW" />);
    expect(screen.getByText('New')).toBeInTheDocument();
    rerender(<StatusBadge status="FOLLOW_UP" />);
    expect(screen.getByText('Follow-up')).toBeInTheDocument();
    rerender(<StatusBadge status="CONVERTED" />);
    expect(screen.getByText('Converted')).toBeInTheDocument();
  });
});

describe('SourceBadge', () => {
  it('renders source labels', () => {
    render(<SourceBadge source="INSTAGRAM" />);
    expect(screen.getByText('Instagram')).toBeInTheDocument();
  });
});

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total leads" value={42} sublabel="All time" />);
    expect(screen.getByText('Total leads')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('All time')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('shows a summary when there is only one page', () => {
    render(<Pagination page={{ page: 1, pageSize: 25, total: 10, totalPages: 1 }} onChange={() => undefined} />);
    expect(screen.getByText(/Showing 1–10 of 10/)).toBeInTheDocument();
  });

  it('shows navigation controls when there are multiple pages', () => {
    render(<Pagination page={{ page: 2, pageSize: 25, total: 100, totalPages: 4 }} onChange={() => undefined} />);
    expect(screen.getByText(/Page 2 of 4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Next/i })).toBeEnabled();
  });
});

describe('format helpers', () => {
  it('formats Indian phone numbers', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone(null)).toBe('—');
  });

  it('formats call durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(150)).toBe('2m 30s');
    expect(formatDuration(null)).toBe('—');
  });

  it('formats relative times', () => {
    expect(timeAgo(new Date(Date.now() - 30_000).toISOString())).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(timeAgo(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
  });
});


describe('DeviceIdentity', () => {
  it('distinguishes the phone-visible device ID from its registration code', () => {
    render(<DeviceIdentity device={{ id: 'device-id-123', deviceCode: 'registration-code-456', deviceName: 'Test phone' }} />);
    expect(screen.getByText('Device ID: device-id-123')).toBeInTheDocument();
    expect(screen.getByText('Registration code: registration-code-456')).toBeInTheDocument();
  });
});


describe('CallDevice', () => {
  it('shows model and distinct registration ID, without guessing missing device details', () => {
    const { rerender } = render(<CallDevice call={{ deviceId: 'device-123', deviceName: 'Android V2437' }} />);
    expect(screen.getByText('Android V2437')).toBeInTheDocument();
    expect(screen.getByText('ID: device-123')).toBeInTheDocument();
    rerender(<CallDevice call={{ deviceId: null, deviceName: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
