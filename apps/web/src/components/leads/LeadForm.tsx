'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ApiError, type Lead, type LeadSource, type UserWithCounts } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { SOURCE_LABELS } from '@/components/ui/Badge';

const SOURCES = Object.keys(SOURCE_LABELS) as LeadSource[];

const SUGGESTED_VEHICLE_TYPES = [
  'Truck Body',
  'Bus Body',
  'Container Body',
  'Trailer',
  'Pickup Body',
  'Tanker',
  'Tipper',
  'Other',
];

export interface LeadFormValues {
  customerName: string;
  phone: string;
  alternatePhone: string;
  email: string;
  city: string;
  vehicleType: string;
  vehicleDetails: string;
  requirement: string;
  source: LeadSource;
  assignedUserId: string;
  notes: string;
}

function emptyValues(lead?: Lead): LeadFormValues {
  return {
    customerName: lead?.customerName ?? '',
    phone: lead?.phone ?? '',
    alternatePhone: lead?.alternatePhone ?? '',
    email: lead?.email ?? '',
    city: lead?.city ?? '',
    vehicleType: lead?.vehicleType ?? '',
    vehicleDetails: lead?.vehicleDetails ?? '',
    requirement: lead?.requirement ?? '',
    source: lead?.source ?? 'MANUAL',
    assignedUserId: lead?.assignedUserId ?? '',
    notes: lead?.notes ?? '',
  };
}

export function LeadForm({
  lead,
  onSaved,
  onCancel,
}: {
  lead?: Lead;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const [values, setValues] = useState<LeadFormValues>(() => emptyValues(lead));
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => apiGet<{ users: UserWithCounts[] }>('/api/v1/users?status=ACTIVE'),
    enabled: user?.role === 'ADMIN',
  });

  const mutation = useMutation({
    mutationFn: async (form: LeadFormValues) => {
      const payload = {
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        alternatePhone: form.alternatePhone.trim() || undefined,
        email: form.email.trim() || undefined,
        city: form.city.trim() || undefined,
        vehicleType: form.vehicleType.trim() || undefined,
        vehicleDetails: form.vehicleDetails.trim() || undefined,
        requirement: form.requirement.trim() || undefined,
        source: form.source,
        assignedUserId: form.assignedUserId || null,
        notes: form.notes.trim() || undefined,
      };
      if (lead) {
        return apiPatch(`/api/v1/leads/${lead.id}`, payload);
      }
      return apiPost('/api/v1/leads', payload);
    },
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(
          err.code === 'DUPLICATE_LEAD'
            ? `${err.message} Open the existing lead instead of creating a duplicate.`
            : err.message,
        );
      } else {
        setError('Could not save the lead. Please try again.');
      }
    },
  });

  function set<K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate(values);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Customer name" htmlFor="customerName">
          <Input
            id="customerName"
            required
            value={values.customerName}
            onChange={(event) => set('customerName', event.target.value)}
            placeholder="e.g. Ramesh Kumar"
          />
        </Field>
        <Field label="Phone number" htmlFor="phone" hint="Indian numbers are accepted with or without +91.">
          <Input
            id="phone"
            required
            inputMode="tel"
            value={values.phone}
            onChange={(event) => set('phone', event.target.value)}
            placeholder="98765 43210"
          />
        </Field>
        <Field label="Alternate phone" htmlFor="alternatePhone">
          <Input
            id="alternatePhone"
            inputMode="tel"
            value={values.alternatePhone}
            onChange={(event) => set('alternatePhone', event.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            value={values.email}
            onChange={(event) => set('email', event.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="City" htmlFor="city">
          <Input
            id="city"
            value={values.city}
            onChange={(event) => set('city', event.target.value)}
            placeholder="e.g. Kota"
          />
        </Field>
        <Field label="Vehicle type" htmlFor="vehicleType">
          <Input
            id="vehicleType"
            list="vehicle-types"
            value={values.vehicleType}
            onChange={(event) => set('vehicleType', event.target.value)}
            placeholder="e.g. Truck Body"
          />
          <datalist id="vehicle-types">
            {SUGGESTED_VEHICLE_TYPES.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Vehicle details" htmlFor="vehicleDetails">
        <Textarea
          id="vehicleDetails"
          value={values.vehicleDetails}
          onChange={(event) => set('vehicleDetails', event.target.value)}
          placeholder="Chassis, size, existing body, etc."
        />
      </Field>

      <Field label="Customer requirement" htmlFor="requirement">
        <Textarea
          id="requirement"
          value={values.requirement}
          onChange={(event) => set('requirement', event.target.value)}
          placeholder="What does the customer want built?"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Lead source" htmlFor="source">
          <Select
            id="source"
            value={values.source}
            onChange={(event) => set('source', event.target.value as LeadSource)}
          >
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assign to" htmlFor="assignedUserId">
          <Select
            id="assignedUserId"
            value={values.assignedUserId}
            onChange={(event) => set('assignedUserId', event.target.value)}
          >
            <option value="">Unassigned</option>
            {user?.role !== 'ADMIN' ? (
              <option value={user?.id}>Myself ({user?.name})</option>
            ) : null}
            {users.data?.users.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({candidate.email})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <Textarea
          id="notes"
          value={values.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder="Anything important about this enquiry"
        />
      </Field>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : lead ? 'Save changes' : 'Create lead'}
        </Button>
      </div>
    </form>
  );
}
