'use client';

import { usePathname } from 'next/navigation';

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

export function Header() {
  const pathname = usePathname();
  const title =
    TITLES[pathname] ??
    (pathname.startsWith('/leads/') ? 'Lead Details' : 'KotaLabs CRM');

  return (
    <header className="border-b border-slate-200 bg-white px-6 py-4">
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
    </header>
  );
}
