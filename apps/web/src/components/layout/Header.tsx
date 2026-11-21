'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Menu } from 'lucide-react';

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/leads': 'Leads',
  '/followups': 'Follow-ups',
  '/calls': 'Call History',
  '/reports': 'Reports',
  '/users': 'Employees',
  '/devices': 'Devices',
  '/settings': 'Settings',
};

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const title =
    TITLES[pathname] ??
    (pathname.startsWith('/leads/') ? 'Lead Details' : 'KotaLabs CRM');

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
      <button type="button" onClick={onMenuClick} aria-label="Open navigation" className="rounded p-2 text-slate-700 hover:bg-slate-100 lg:hidden"><Menu className="h-5 w-5" /></button>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      {pathname !== '/dashboard' ? <Link href="/dashboard" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Dashboard</Link> : null}
    </header>
  );
}
