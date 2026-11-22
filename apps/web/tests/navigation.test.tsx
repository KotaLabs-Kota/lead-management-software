import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/layout/AppShell';

const state = vi.hoisted(() => ({ path: '/leads', user: { name: 'Admin', email: 'admin@example.com', role: 'ADMIN' } as { name: string; email: string; role: string } | null, loading: false, replace: vi.fn(), logout: vi.fn() }));
vi.mock('@/components/layout/PasswordNotifications', () => ({ PasswordNotifications: () => <div>Notifications</div> }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: state.user, loading: state.loading, logout: state.logout }) }));

describe('shared CRM navigation', () => {
  afterEach(cleanup);
  beforeEach(() => { state.path = '/leads'; state.user = { name: 'Admin', email: 'admin@example.com', role: 'ADMIN' }; state.loading = false; state.replace.mockClear(); });
  it('shows navigation and a dashboard link outside the dashboard', () => {
    render(<AppShell>Leads content</AppShell>);
    expect(screen.getByText('Leads content')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Dashboard/ }).every((link) => link.getAttribute('href') === '/dashboard')).toBe(true);
    expect(screen.getByRole('link', { name: /Reports/ })).toHaveAttribute('href', '/reports');
  });
  it('shows notifications only for admins', () => {
    const view = render(<AppShell>Content</AppShell>);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    state.user = { name: 'Employee', email: 'employee@example.com', role: 'EMPLOYEE' };
    view.rerender(<AppShell>Content</AppShell>);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });
  it('opens and closes the mobile menu', () => {
    render(<AppShell>Content</AppShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.queryByRole('button', { name: 'Close navigation' })).not.toBeInTheDocument();
  });
  it('redirects an unauthenticated visitor away from protected pages', () => {
    state.user = null;
    render(<AppShell>Private content</AppShell>);
    expect(screen.queryByText('Private content')).not.toBeInTheDocument();
    expect(state.replace).toHaveBeenCalledWith('/login');
  });
  it('does not put login inside the protected shell', () => {
    state.path = '/login';
    render(<AppShell>Login form</AppShell>);
    expect(screen.getByText('Login form')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();
  });
});
