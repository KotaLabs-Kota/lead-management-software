'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

type Notification = {
  id: string;
  subjectName: string | null;
  actorName: string | null;
  kind: 'SELF_CHANGE' | 'ADMIN_RESET';
  createdAt: string;
  read: boolean;
};
type Response = { enabled: boolean; notifications: Notification[]; unreadCount: number; hasMore: boolean };

export function PasswordNotifications() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['password-notifications', page],
    queryFn: () => apiGet<Response>(`/api/v1/notifications?page=${page}`),
    refetchInterval: 60_000,
    retry: false,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiPost<void>(`/api/v1/notifications/${id}/read`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['password-notifications'] }),
  });
  const count = query.data?.unreadCount ?? 0;
  return (
    <div className="relative ml-auto">
      <button type="button" aria-label={`Password notifications${count ? `, ${count} unread` : ''}`}
        aria-expanded={open} onClick={() => setOpen(!open)}
        className="relative inline-flex items-center gap-2 rounded-md p-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
        <Bell className="h-5 w-5" /> <span className="hidden sm:inline">Notifications</span>
        {count > 0 ? <span className="rounded-full bg-red-600 px-2 text-xs text-white">{count > 99 ? '99+' : count}</span> : null}
      </button>
      {open ? <section aria-label="Password change notifications" className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
        <h2 className="font-semibold text-slate-900">Password changes</h2>
        <p className="mb-3 text-xs text-slate-500">Passwords are never shown or stored here. Times are IST.</p>
        {query.isLoading ? <p className="text-sm">Loading notifications…</p> : null}
        {query.isError ? <p role="alert" className="text-sm text-red-700">Could not load notifications. Please try again later.</p> : null}
        {query.data && !query.data.enabled ? <p className="text-sm text-amber-700">Notifications are not enabled on the server yet.</p> : null}
        {query.data?.enabled && query.data.notifications.length === 0 ? <p className="text-sm text-slate-500">No notifications on this page.</p> : null}
        <ul className="max-h-80 space-y-3 overflow-y-auto">
          {query.data?.notifications.map((item) => <li key={item.id} className="border-t border-slate-100 pt-2 text-sm">
            <p className={item.read ? 'text-slate-600' : 'font-semibold text-slate-900'}>
              {item.kind === 'SELF_CHANGE' ? `${item.subjectName ?? 'Deleted user'} changed their password` : `${item.actorName ?? 'Deleted user'} reset the password for ${item.subjectName ?? 'Deleted user'}`}
            </p>
            <p className="text-xs text-slate-500">{formatDateTime(item.createdAt)} IST</p>
            {!item.read ? <button type="button" disabled={markRead.isPending} onClick={() => markRead.mutate(item.id)} className="mt-1 text-xs font-medium text-indigo-700 hover:underline disabled:opacity-50">Mark as read</button> : <span className="text-xs text-slate-500">Read</span>}
          </li>)}
        </ul>
        {markRead.isError ? <p role="alert" className="mt-2 text-xs text-red-700">Could not mark as read. Please try again.</p> : null}
        {query.data?.enabled ? <div className="mt-3 flex items-center justify-between border-t pt-2 text-sm">
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="text-indigo-700 disabled:text-slate-400">Newer</button>
          <span>Page {page}</span>
          <button type="button" disabled={!query.data.hasMore} onClick={() => setPage(page + 1)} className="text-indigo-700 disabled:text-slate-400">Older</button>
        </div> : null}
      </section> : null}
    </div>
  );
}
