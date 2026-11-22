import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportsPage from '@/app/reports/page';

const state = vi.hoisted(() => ({ role: 'ADMIN', download: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ push: state.toast }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) =>
  queryKey[0] === 'users' ? { data: { users: [] } } : { isPending: true },
}));
vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(), downloadFile: state.download,
  toQuery: (p: Record<string, unknown>) => '?' + new URLSearchParams(Object.entries(p)
    .filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString(),
}));

describe('report exports', () => {
  beforeEach(() => { state.role = 'ADMIN'; state.download.mockReset().mockResolvedValue({ hasMore: true }); state.toast.mockReset(); });
  afterEach(cleanup);
  it('allows an admin to download filtered PDF and warns when more pages exist', async () => {
    render(<ReportsPage />);
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }));
    await waitFor(() => expect(state.download).toHaveBeenCalledOnce());
    const path = state.download.mock.calls[0]![0] as string;
    expect(path).toContain('/api/v1/reports/leads.pdf?');
    expect(path).toContain('limit=500');
    expect(path).toContain('offset=0');
    expect(path).toContain('2026-11-01T00%3A00%3A00%2B05%3A30');
    expect(await screen.findByText(/More leads exist/)).toBeInTheDocument();
  });
  it('does not show export buttons to employees', () => {
    state.role = 'EMPLOYEE';
    render(<ReportsPage />);
    expect(screen.queryByRole('button', { name: /Download CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download PDF/ })).not.toBeInTheDocument();
  });
});
