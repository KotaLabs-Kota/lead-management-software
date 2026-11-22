'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarClock,
  LayoutDashboard,
  LogOut,
  PhoneCall,
  Settings,
  Smartphone,
  Users,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: UsersRound },
  { href: '/followups', label: 'Follow-ups', icon: CalendarClock },
  { href: '/calls', label: 'Call History', icon: PhoneCall },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/users', label: 'Employees', icon: Users, adminOnly: true },
  { href: '/devices', label: 'Devices', icon: Smartphone, adminOnly: true },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'ADMIN');

  return (
    <aside className={`fixed inset-y-0 left-0 z-50 w-60 shrink-0 flex-col overflow-y-auto bg-slate-900 text-slate-200 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'flex translate-x-0' : 'hidden lg:flex'}`}>
      <div className="border-b border-slate-800 px-5 py-5">
        <p className="text-lg font-bold text-white">KotaLabs CRM</p>
        <p className="text-xs text-slate-400">Multani Motor Body Makers</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => {
          const active =
            pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 px-5 py-4">
        <p className="truncate text-sm font-medium text-white">{user?.name}</p>
        <p className="truncate text-xs text-slate-400">{user?.email}</p>
        <p className="mt-1 text-xs font-medium text-indigo-300">
          {user?.role === 'ADMIN' ? 'Administrator' : 'Employee'}
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}
