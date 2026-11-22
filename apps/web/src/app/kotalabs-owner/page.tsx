'use client';

import { useState, type FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
type Admin = { id: string; name: string; email: string; role: string; status: string; blocked: boolean };
type OwnerStatus = { suspended: boolean; updatedAt: string; admins: Admin[] };

export default function OwnerPage() {
  // The key is kept only in memory; never put it in a URL, storage, or logs.
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<OwnerStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function call<T>(path: string, method = 'GET', body?: object): Promise<T> {
    const response = await fetch(`${apiBase}/api/owner${path}`, {
      method, cache: 'no-store', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 404) throw new Error('Owner access is not available or the key is incorrect.');
      throw new Error('Request failed. Check the connection and try again.');
    }
    return response.json() as Promise<T>;
  }
  async function load(event?: FormEvent) {
    event?.preventDefault();
    setError(''); setBusy(true);
    try { setStatus(await call<OwnerStatus>('/status')); }
    catch (err) { setStatus(null); setError(err instanceof Error ? err.message : 'Unable to connect.'); }
    finally { setBusy(false); }
  }
  async function updateService(suspended: boolean) {
    if (!window.confirm(suspended
      ? 'Suspend CRM access for all users and pause device uploads? Existing data will not be deleted.'
      : 'Restore CRM access? Users may need to sign in again.')) return;
    setError(''); setBusy(true);
    try { await call('/service', 'PUT', { suspended }); setStatus(await call<OwnerStatus>('/status')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update.'); }
    finally { setBusy(false); }
  }
  async function updateAdmin(admin: Admin) {
    if (!window.confirm(`${admin.blocked ? 'Restore' : 'Block'} CRM access for ${admin.name}?`)) return;
    setError(''); setBusy(true);
    try { await call(`/admins/${admin.id}`, 'PUT', { blocked: !admin.blocked }); setStatus(await call<OwnerStatus>('/status')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update.'); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-900">
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="text-white"><p className="text-sm text-slate-400">KotaLabs · owner access</p><h1 className="mt-1 text-3xl font-semibold">Service controls</h1><p className="mt-2 text-sm text-slate-300">Separate from client admin accounts. Access is protected by your owner key, not by this page address.</p></header>
      {!status ? <form onSubmit={load} className="space-y-4 rounded-xl bg-white p-6 shadow">
        <label htmlFor="owner-key" className="block text-sm font-medium">Owner access key</label>
        <input id="owner-key" type="password" autoComplete="off" required value={key} onChange={(event) => setKey(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
        <p className="text-xs text-slate-500">Your key is kept in this page only and cleared when you lock or close it.</p>
        <button disabled={busy} className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? 'Checking…' : 'Unlock owner panel'}</button>
      </form> : <>
        <section className="rounded-xl bg-white p-6 shadow">
          <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">CRM access</h2><p className="mt-1 text-sm">Status: <strong className={status.suspended ? 'text-red-700' : 'text-green-700'}>{status.suspended ? 'Suspended' : 'Active'}</strong></p></div>
            <button disabled={busy} onClick={() => void updateService(!status.suspended)} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">{status.suspended ? 'Restore CRM' : 'Suspend CRM'}</button></div>
          <p className="mt-4 text-sm text-slate-600">Suspension blocks normal CRM API access and pauses device uploads. It does not delete records. In-progress requests and previously loaded information may remain visible. Phones may queue calls for later retry.</p>
        </section>
        <section className="rounded-xl bg-white p-6 shadow"><h2 className="text-xl font-semibold">Client administrators</h2><p className="mt-1 text-sm text-slate-600">Owner blocks are separate from the client’s own account status.</p>
          {status.admins.length === 0 ? <p className="mt-4 text-sm">No administrators found.</p> : <ul className="mt-4 divide-y divide-slate-200">{status.admins.map((admin) => <li key={admin.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{admin.name}</p><p className="text-sm text-slate-500">{admin.email} · {admin.role} · {admin.status}</p><p className="text-sm">Owner control: {admin.blocked ? 'Blocked' : 'Not blocked'}</p></div><button disabled={busy} onClick={() => void updateAdmin(admin)} className="rounded-md border border-slate-400 px-3 py-2 text-sm font-medium disabled:opacity-50">{admin.blocked ? 'Unblock' : 'Block'}</button></li>)}</ul>}
        </section>
        <div className="flex gap-3"><button disabled={busy} onClick={() => void load()} className="rounded-md bg-white px-4 py-2 disabled:opacity-50">Refresh</button><button onClick={() => { setKey(''); setStatus(null); setError(''); }} disabled={busy} className="rounded-md border border-slate-400 px-4 py-2 text-white disabled:opacity-50">Lock panel</button></div>
      </>}
      {error ? <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800">{error}</p> : null}
    </div>
  </main>;
}
