/**
 * API types for the KotaLabs CRM backend.
 * Keep in sync with apps/backend/src/types/domain.ts and docs/api-contract.md.
 */

export type UserRole = 'ADMIN' | 'EMPLOYEE';
export type UserStatus = 'ACTIVE' | 'DISABLED';

export type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'INTERESTED'
  | 'FOLLOW_UP'
  | 'CONVERTED'
  | 'LOST';

export type LeadSource =
  | 'INSTAGRAM'
  | 'YOUTUBE'
  | 'GOOGLE_ADS'
  | 'WHATSAPP'
  | 'PHONE_CALL'
  | 'WALK_IN'
  | 'REFERRAL'
  | 'MANUAL'
  | 'OTHER';

export type CallDirection = 'INCOMING' | 'OUTGOING' | 'MISSED' | 'REJECTED' | 'UNKNOWN';
export type CallSource = 'SIM' | 'WHATSAPP' | 'MANUAL';
export type CallCaptureMethod = 'CALL_LOG' | 'CALL_SCREENING' | 'MANUAL';
export type FollowupStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'MISSED';
export type ActivityType =
  | 'CREATED'
  | 'NOTE'
  | 'STATUS_CHANGE'
  | 'ASSIGNMENT'
  | 'CALL'
  | 'FOLLOWUP_SCHEDULED'
  | 'FOLLOWUP_COMPLETED'
  | 'FOLLOWUP_CANCELLED'
  | 'UPDATED'
  | 'SOURCE_SYNC';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
}

export interface UserWithCounts extends User {
  leadCount: number;
  deviceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export interface Lead {
  id: string;
  leadNumber: number;
  leadCode: string;
  customerName: string;
  phone: string;
  alternatePhone: string | null;
  email: string | null;
  city: string | null;
  vehicleType: string | null;
  vehicleDetails: string | null;
  requirement: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  platformLeadId: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedUserEmail: string | null;
  status: LeadStatus;
  notes: string | null;
  lostReason: string | null;
  lastContactedAt: string | null;
  nextFollowupAt: string | null;
  closedAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  callCount: number;
  pendingFollowupCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivity {
  id: string;
  leadId: string;
  userId: string | null;
  userName: string | null;
  type: ActivityType;
  body: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CallEvent {
  id: string;
  eventId: string;
  leadId: string | null;
  leadCode: string | null;
  deviceId: string | null;
  deviceName: string | null;
  userId: string;
  userName: string | null;
  phoneNumber: string;
  direction: CallDirection | null;
  source: CallSource;
  captureMethod: CallCaptureMethod | null;
  startedAt: string;
  durationSeconds: number | null;
  simSlot: number | null;
  notes: string | null;
  createdAt: string;
}

export interface Followup {
  id: string;
  leadId: string;
  leadCode: string | null;
  customerName: string | null;
  leadPhone: string | null;
  leadStatus: LeadStatus | null;
  assignedUserId: string;
  assignedUserName: string | null;
  dueAt: string;
  status: FollowupStatus;
  notes: string | null;
  completedAt: string | null;
  completedBy: string | null;
  completionNotes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  isOverdue: boolean;
}

export interface Device {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  deviceCode: string;
  deviceName: string | null;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  status: 'ACTIVE' | 'REVOKED';
  lastSeenAt: string | null;
  registeredAt: string;
  revokedAt: string | null;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  page: PageMeta;
}

export interface DashboardSummary {
  date: string;
  totals: {
    total_leads: number;
    new_today: number;
    pending_followups: number;
    overdue_followups: number;
    calls_today: number;
    calls_total: number;
    unmatched_calls: number;
  };
  byStatus: Partial<Record<LeadStatus, number>>;
  bySource: Array<{ source: LeadSource; count: number; converted: number; conversionRate: number }>;
  employees: Array<{
    user_id: string;
    name: string;
    email: string;
    role: UserRole;
    total_leads: number;
    new_leads: number;
    contacted: number;
    interested: number;
    converted: number;
    lost: number;
    pending_followups: number;
    overdue_followups: number;
    calls_today: number;
    calls_total: number;
  }>;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
