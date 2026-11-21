'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ApiError, type UserRole, type UserWithCounts } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/States';
import { useToast } from '@/components/Toast';

export default function UsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserWithCounts | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserWithCounts | null>(null);

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<{ users: UserWithCounts[] }>('/api/v1/users'),
    enabled: user?.role === 'ADMIN',
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  const toggleStatus = useMutation({
    mutationFn: (target: UserWithCounts) =>
      apiPatch(`/api/v1/users/${target.id}`, {
        status: target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
      }),
    onSuccess: () => {
      toast.push('success', 'Employee updated');
      invalidate();
    },
    onError: (err) => {
      toast.push('error', err instanceof ApiError ? err.message : 'Could not update employee');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/users/${id}`),
    onSuccess: () => {
      toast.push('success', 'Employee disabled');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => {
      toast.push('error', err instanceof ApiError ? err.message : 'Could not delete employee');
    },
  });

  if (user?.role !== 'ADMIN') {
    return (
      <ErrorState message="Only administrators can manage employees. Please contact the administrator if you need access." />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Manage admin and employee accounts. Disabling an account revokes its sessions and devices.
        </p>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Add employee
        </Button>
      </div>

      <Card className="p-0">
        {users.isPending ? (
          <Spinner />
        ) : users.isError ? (
          <ErrorState
            message="Could not load employees. Please try again."
            onRetry={() => void users.refetch()}
          />
        ) : users.data.users.length === 0 ? (
          <EmptyState title="No accounts yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Email</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 text-right font-medium">Leads</th>
                  <th className="px-3 py-3 text-right font-medium">Devices</th>
                  <th className="px-3 py-3 font-medium">Last login</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.users.map((account) => (
                  <tr key={account.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {account.name}
                      {account.id === user.id ? (
                        <span className="ml-2 text-xs text-slate-400">(you)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{account.email}</td>
                    <td className="px-3 py-3">
                      <Badge tone={account.role === 'ADMIN' ? 'blue' : 'slate'}>
                        {account.role === 'ADMIN' ? 'Admin' : 'Employee'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={account.status === 'ACTIVE' ? 'green' : 'red'}>
                        {account.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">{account.leadCount}</td>
                    <td className="px-3 py-3 text-right">{account.deviceCount}</td>
                    <td className="px-3 py-3 text-slate-500">{formatDateTime(account.lastLoginAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(account)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={toggleStatus.isPending}
                          onClick={() => toggleStatus.mutate(account)}
                        >
                          {account.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </Button>
                        {account.id !== user.id ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDelete(account)}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add employee">
        <UserForm
          onCancel={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            invalidate();
          }}
        />
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit account">
        {editing ? (
          <UserForm
            account={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              invalidate();
            }}
          />
        ) : null}
      </Modal>

      <Modal open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="Delete account">
        <p className="text-sm text-slate-700">
          Disable <span className="font-medium">{confirmDelete?.name}</span> ({confirmDelete?.email})?
          Their sessions and devices will be revoked. Lead history is preserved.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={deleteMutation.isPending}
            onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function UserForm({
  account,
  onSaved,
  onCancel,
}: {
  account?: UserWithCounts;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(account?.role ?? 'EMPLOYEE');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (account) {
        const payload: Record<string, unknown> = { name: name.trim(), role };
        if (password.trim()) payload.password = password.trim();
        return apiPatch(`/api/v1/users/${account.id}`, payload);
      }
      return apiPost('/api/v1/users', {
        email: email.trim(),
        password: password.trim(),
        name: name.trim(),
        role,
      });
    },
    onSuccess: () => {
      toast.push('success', account ? 'Account updated' : 'Account created');
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save account');
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Full name" htmlFor="userName">
        <Input
          id="userName"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Ramesh Kumar"
        />
      </Field>
      {!account ? (
        <Field label="Email address" htmlFor="userEmail">
          <Input
            id="userEmail"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="employee@multanimotors.example"
          />
        </Field>
      ) : null}
      <Field
        label={account ? 'New password (leave blank to keep current)' : 'Password'}
        htmlFor="userPassword"
        hint="At least 10 characters."
      >
        <Input
          id="userPassword"
          type="password"
          required={!account}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={account ? 'Leave blank to keep current password' : 'Set a strong password'}
        />
      </Field>
      <Field label="Role" htmlFor="userRole">
        <Select
          id="userRole"
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole)}
        >
          <option value="EMPLOYEE">Employee</option>
          <option value="ADMIN">Admin</option>
        </Select>
      </Field>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : account ? 'Save changes' : 'Create account'}
        </Button>
      </div>
    </form>
  );
}
