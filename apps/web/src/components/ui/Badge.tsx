import type { LeadSource, LeadStatus } from '@/lib/types';

const statusStyles: Record<LeadStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-amber-100 text-amber-800',
  INTERESTED: 'bg-purple-100 text-purple-800',
  FOLLOW_UP: 'bg-orange-100 text-orange-800',
  CONVERTED: 'bg-emerald-100 text-emerald-800',
  LOST: 'bg-slate-200 text-slate-700',
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  INTERESTED: 'Interested',
  FOLLOW_UP: 'Follow-up',
  CONVERTED: 'Converted',
  LOST: 'Lost',
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const sourceStyles: Record<LeadSource, string> = {
  INSTAGRAM: 'bg-pink-100 text-pink-800',
  YOUTUBE: 'bg-red-100 text-red-800',
  GOOGLE_ADS: 'bg-sky-100 text-sky-800',
  WHATSAPP: 'bg-green-100 text-green-800',
  PHONE_CALL: 'bg-indigo-100 text-indigo-800',
  WALK_IN: 'bg-teal-100 text-teal-800',
  REFERRAL: 'bg-violet-100 text-violet-800',
  MANUAL: 'bg-slate-100 text-slate-700',
  OTHER: 'bg-slate-100 text-slate-700',
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  INSTAGRAM: 'Instagram',
  YOUTUBE: 'YouTube',
  GOOGLE_ADS: 'Google Ads',
  WHATSAPP: 'WhatsApp',
  PHONE_CALL: 'Phone Call',
  WALK_IN: 'Walk-in',
  REFERRAL: 'Referral',
  MANUAL: 'Manual',
  OTHER: 'Other',
};

export function SourceBadge({ source }: { source: LeadSource }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${sourceStyles[source]}`}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'red' | 'green' | 'amber' | 'blue';
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    red: 'bg-red-100 text-red-800',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-800',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
