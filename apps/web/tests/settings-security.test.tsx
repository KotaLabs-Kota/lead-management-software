import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/app/settings/page';

const state = vi.hoisted(() => ({ post: vi.fn(), logout: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { name: 'Admin', email: 'admin@example.com', role: 'ADMIN' }, logout: state.logout }) }));
vi.mock('@/lib/api', () => ({ apiPost: state.post }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ push: state.toast }) }));

describe('password change session handling', () => {
  afterEach(cleanup);
  beforeEach(() => { state.post.mockReset().mockResolvedValue(undefined); state.logout.mockReset().mockResolvedValue(undefined); state.toast.mockReset(); });
  it('signs the current browser out after a successful change', async () => {
    render(<SettingsPage />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPassword123!' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(state.logout).toHaveBeenCalledOnce());
    expect(state.post).toHaveBeenCalledWith('/api/auth/change-password', { currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });
    expect(state.toast).toHaveBeenCalledWith('success', expect.stringContaining('sign in again'));
  });
  it('does not log the user out after a failed change', async () => {
    state.post.mockRejectedValue(new Error('Failed'));
    render(<SettingsPage />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPassword123!' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not change password.');
    expect(state.logout).not.toHaveBeenCalled();
  });
});
