import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OwnerPage from '@/app/kotalabs-owner/page';

const admin = { id: 'admin-id', name: 'Client Admin', email: 'client@example.com', role: 'ADMIN', status: 'ACTIVE', blocked: false };
const status = { suspended: false, updatedAt: '2026-01-01', admins: [admin] };
const ok = (data: unknown) => ({ ok: true, json: async () => data });

describe('owner panel', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(status))); vi.spyOn(window, 'confirm').mockReturnValue(true); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('unlocks with a bearer key held only in page state and locks again', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<OwnerPage />);
    fireEvent.change(screen.getByLabelText('Owner access key'), { target: { value: 'owner-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock owner panel' }));
    expect(await screen.findByText('Client Admin')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/owner/status', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer owner-key' }) }));
    expect(storage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lock panel' }));
    expect(screen.getByLabelText('Owner access key')).toHaveValue('');
  });
  it('asks for confirmation before suspending or blocking', async () => {
    render(<OwnerPage />);
    fireEvent.change(screen.getByLabelText('Owner access key'), { target: { value: 'owner-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock owner panel' }));
    await screen.findByText('Client Admin');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Suspend CRM' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/owner/admins/admin-id', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ blocked: true }) })));
  });
});
