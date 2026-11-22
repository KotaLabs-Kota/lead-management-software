import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordNotifications } from '@/components/layout/PasswordNotifications';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiGet: mocks.get, apiPost: mocks.post }));

describe('password notifications', () => {
  afterEach(cleanup);
  beforeEach(() => { mocks.get.mockReset(); mocks.post.mockReset(); });
  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><PasswordNotifications /></QueryClientProvider>);
  }
  it('shows metadata and lets an admin mark it as read', async () => {
    mocks.get.mockResolvedValue({ enabled: true, unreadCount: 1, hasMore: false, notifications: [
      { id: 'event-id', subjectName: 'Employee', actorName: 'Admin', kind: 'ADMIN_RESET', createdAt: '2026-01-01T00:00:00Z', read: false },
    ] });
    mocks.post.mockResolvedValue(undefined);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Password notifications/ }));
    expect(await screen.findByText('Admin reset the password for Employee')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/v1/notifications/event-id/read'));
  });
  it('explains when notifications are disabled', async () => {
    mocks.get.mockResolvedValue({ enabled: false, unreadCount: 0, hasMore: false, notifications: [] });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Password notifications/ }));
    expect(await screen.findByText(/not enabled on the server/)).toBeInTheDocument();
  });
});
