'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Spinner } from '@/components/ui/States';
import { useAuth } from '@/lib/auth';

/** Shared authenticated navigation for every CRM page, not just /dashboard. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const isPublic = pathname === '/login' || pathname === '/';

  useEffect(() => {
    if (!isPublic && !loading && !user) router.replace('/login');
  }, [isPublic, loading, user, router]);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  if (isPublic) return <>{children}</>;
  if (loading) return <main className="flex min-h-screen items-center justify-center"><Spinner label="Checking your session…" /></main>;
  if (!user) return null;

  return (
    <div className="flex min-h-screen">
      {menuOpen ? <button type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 bg-black/50 lg:hidden" /> : null}
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setMenuOpen(true)} />
        <main className="min-w-0 flex-1 space-y-6 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
