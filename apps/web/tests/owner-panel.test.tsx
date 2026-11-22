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

describe('owner password login', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('uses a short-lived token, not the password, for subsequent owner requests', async () => {
    const responses = vi.fn().mockResolvedValueOnce(ok({ token: 'session-token', expiresIn: 900 }))
      .mockResolvedValueOnce(ok({ ...status, passwordLoginEnabled: true, credentialType: 'password' }));
    vi.stubGlobal('fetch', responses);
    render(<OwnerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Owner password' }));
    fireEvent.change(screen.getByLabelText('Owner password'), { target: { value: 'my long password 123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock owner panel' }));
    expect(await screen.findByText('Client Admin')).toBeInTheDocument();
    expect(responses).toHaveBeenNthCalledWith(1, '/api/owner/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'my long password 123' }) }));
    expect(responses).toHaveBeenNthCalledWith(2, '/api/owner/status', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer session-token' }) }));
    expect(screen.queryByText('Set or reset owner password')).not.toBeInTheDocument();
  });
  it('sets a password only after unlocking with the recovery key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ ...status, passwordLoginEnabled: true, credentialType: 'key' })).mockResolvedValueOnce(ok({ updated: true })));
    render(<OwnerPage />);
    fireEvent.change(screen.getByLabelText('Owner access key'), { target: { value: 'recovery-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock owner panel' }));
    await screen.findByText('Set or reset owner password');
    fireEvent.change(screen.getByLabelText('New owner password'), { target: { value: 'unique long passphrase' } });
    fireEvent.change(screen.getByLabelText('Confirm owner password'), { target: { value: 'unique long passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save owner password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password saved');
    expect(fetch).toHaveBeenCalledWith('/api/owner/password', expect.objectContaining({ method: 'PUT', headers: expect.objectContaining({ Authorization: 'Bearer recovery-key' }) }));
    expect(screen.getByLabelText('New owner password')).toHaveValue('');
  });
});
