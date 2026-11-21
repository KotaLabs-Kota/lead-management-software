/**
 * Domain constants shared by the API, the (future) Next.js CRM and the docs.
 * These values are enforced by CHECK constraints in migrations/0001_init.sql —
 * keep the two in sync (the API tests assert on this).
 */

export const USER_ROLES = ['ADMIN', 'EMPLOYEE'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'INTERESTED',
  'FOLLOW_UP',
  'CONVERTED',
  'LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Statuses that still need work — used for duplicate-lead checks. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'INTERESTED',
  'FOLLOW_UP',
];

export const CLOSED_LEAD_STATUSES: readonly LeadStatus[] = ['CONVERTED', 'LOST'];

export const LEAD_SOURCES = [
  'INSTAGRAM',
  'YOUTUBE',
  'GOOGLE_ADS',
  'WHATSAPP',
  'PHONE_CALL',
  'WALK_IN',
  'REFERRAL',
  'MANUAL',
  'OTHER',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const CALL_DIRECTIONS = ['INCOMING', 'OUTGOING', 'MISSED', 'REJECTED', 'UNKNOWN'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_SOURCES = ['SIM', 'WHATSAPP', 'MANUAL'] as const;
export type CallSource = (typeof CALL_SOURCES)[number];

export const CALL_CAPTURE_METHODS = ['CALL_LOG', 'CALL_SCREENING', 'MANUAL'] as const;
export type CallCaptureMethod = (typeof CALL_CAPTURE_METHODS)[number];

export const FOLLOWUP_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED', 'MISSED'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const ACTIVITY_TYPES = [
  'CREATED',
  'NOTE',
  'STATUS_CHANGE',
  'ASSIGNMENT',
  'CALL',
  'FOLLOWUP_SCHEDULED',
  'FOLLOWUP_COMPLETED',
  'FOLLOWUP_CANCELLED',
  'UPDATED',
  'SOURCE_SYNC',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const DEVICE_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/**
 * Suggestions only — `leads.vehicle_type` is free text because body builders
 * describe vehicles in their own words. The web UI shows these as a datalist.
 */
export const SUGGESTED_VEHICLE_TYPES = [
  'Truck Body',
  'Bus Body',
  'Container Body',
  'Trailer',
  'Pickup Body',
  'Tanker',
  'Tipper',
  'Other',
] as const;

/** Human readable lead code used in the UI, exports and phone conversations. */
export function formatLeadNumber(leadNumber: number): string {
  return `MMB-${String(leadNumber).padStart(6, '0')}`;
}
