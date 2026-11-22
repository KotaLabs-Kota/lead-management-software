'use client';

import { useState, type FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
type Admin = { id: string; name: string; email: string; role: string; status: string; blocked: boolean };
type OwnerStatus = { suspended: boolean; updatedAt: string; admins: Admin[]; passwordLoginEnabled?: boolean; credentialType?: 'key' | 'password' };

export default function OwnerPage() {
  // Credentials and sessions stay in memory only, never in browser storage or URLs.
  const [loginMode, setLoginMode] = useState<'password' | 'key'>('key');
  const [input, setInput] = useState('');
  const [credential, setCredential] = useState('');
  const [status, setStatus] = useState<OwnerStatus | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function call<T>(path: string, method = 'GET', body?: object, token = credential): Promise<T> {
    const response = await fetch(`${apiBase}/api/owner${path}`, {
      method, cache: 'no-store', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 404) throw new Error('Owner access is unavailable, the credential is incorrect, or the session expired.');
      if (response.status === 403) throw new Error('Request forbidden. Check that this preview origin is allowed by the test backend.');
      if (response.status === 429) throw new Error('Too many attempts. Please wait and try again.');
      throw new Error('Request failed. Check the connection and try again.');
    }
    return response.json() as Promise<T>;
  }
  async function unlock(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      const token = loginMode === 'password'
        ? (await call<{ token: string }>('/login', 'POST', { password: input }, '')).token
        : input;
      const data = await call<OwnerStatus>('/status', 'GET', undefined, token);
      setCredential(token); setStatus(data); setInput('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to connect.'); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setError(''); setMessage(''); setBusy(true);
    try { setStatus(await call<OwnerStatus>('/status')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to connect.'); }
    finally { setBusy(false); }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('The passwords do not match.'); return; }
    if (newPassword.trim().length < 16 || newPassword.length > 128) { setError('Use a password between 16 and 128 characters.'); return; }
    setBusy(true);
    try {
      await call('/password', 'PUT', { password: newPassword });
      setNewPassword(''); setConfirmPassword('');
      setMessage('Password saved. Lock the panel and choose password login to test it. Keep your recovery key safe.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save the password.'); }
    finally { setBusy(false); }
  }
  async function updateService(suspended: boolean) {
    if (!window.confirm(suspended
      ? 'Suspend CRM access for all users and pause device uploads? Existing data will not be deleted.'
      : 'Restore CRM access? Users may need to sign in again.')) return;
    setError(''); setMessage(''); setBusy(true);
    try { await call('/service', 'PUT', { suspended }); setStatus(await call<OwnerStatus>('/status')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update.'); }
    finally { setBusy(false); }
  }
  async function updateAdmin(admin: Admin) {
    if (!window.confirm(`${admin.blocked ? 'Restore' : 'Block'} CRM access for ${admin.name}?`)) return;
    setError(''); setMessage(''); setBusy(true);
    try { await call(`/admins/${admin.id}`, 'PUT', { blocked: !admin.blocked }); setStatus(await call<OwnerStatus>('/status')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update.'); }
    finally { setBusy(false); }
  }
  function lock() { setInput(''); setCredential(''); setStatus(null); setNewPassword(''); setConfirmPassword(''); setError(''); setMessage(''); }

  return <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-900">
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="text-white"><p className="text-sm text-slate-400">KotaLabs · owner access</p><h1 className="mt-1 text-3xl font-semibold">Service controls</h1><p className="mt-2 text-sm text-slate-300">Separate from client admin accounts. The page address is not a security credential.</p></header>
      {!status ? <form onSubmit={unlock} className="space-y-4 rounded-xl bg-white p-6 shadow">
        <div className="flex gap-3 text-sm"><button type="button" aria-pressed={loginMode === 'key'} onClick={() => { setLoginMode('key'); setInput(''); setError(''); }} className="rounded border px-3 py-2">Recovery key</button><button type="button" aria-pressed={loginMode === 'password'} onClick={() => { setLoginMode('password'); setInput(''); setError(''); }} className="rounded border px-3 py-2">Owner password</button></div>
        <label htmlFor="owner-credential" className="block text-sm font-medium">{loginMode === 'key' ? 'Owner access key' : 'Owner password'}</label>
        <input id="owner-credential" type="password" autoComplete={loginMode === 'password' ? 'current-password' : 'off'} required value={input} onChange={(event) => setInput(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
        <p className="text-xs text-slate-500">{loginMode === 'key' ? 'Use the recovery key to set or reset the owner password.' : 'Password login must first be configured using the recovery key. Sessions expire after 15 minutes.'}</p>
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
        {status.passwordLoginEnabled && status.credentialType === 'key' ? <section className="rounded-xl bg-white p-6 shadow"><h2 className="text-xl font-semibold">Set or reset owner password</h2><p className="mt-1 text-sm text-slate-600">Choose a unique passphrase of at least 16 characters. Keep your recovery key safe. This login does not yet provide MFA.</p><form onSubmit={savePassword} className="mt-4 space-y-3"><label htmlFor="new-owner-password" className="block text-sm font-medium">New owner password</label><input id="new-owner-password" type="password" autoComplete="new-password" required minLength={16} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded border px-3 py-2"/><label htmlFor="confirm-owner-password" className="block text-sm font-medium">Confirm owner password</label><input id="confirm-owner-password" type="password" autoComplete="new-password" required minLength={16} maxLength={128} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full rounded border px-3 py-2"/><button disabled={busy} className="rounded-md bg-indigo-700 px-4 py-2 text-white disabled:opacity-50">Save owner password</button></form></section> : null}
        <div className="flex gap-3"><button disabled={busy} onClick={() => void refresh()} className="rounded-md bg-white px-4 py-2 disabled:opacity-50">Refresh</button><button onClick={lock} disabled={busy} className="rounded-md border border-slate-400 px-4 py-2 text-white disabled:opacity-50">Lock panel</button></div>
      </>}
      {message ? <p role="status" className="rounded-md bg-green-100 p-3 text-sm text-green-800">{message}</p> : null}
      {error ? <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800">{error}</p> : null}
    </div>
  </main>;
}
