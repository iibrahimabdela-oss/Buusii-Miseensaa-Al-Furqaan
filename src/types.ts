export type UserRole = 'owner' | 'admin' | 'cashier' | 'viewer' | 'member';
export type AccountStatus = 'active' | 'suspended';
export type Language = 'om' | 'en';
export type CalendarMode = 'dual' | 'gregorian' | 'ethiopian';

export type TabKey =
  | 'dashboard'
  | 'members'
  | 'contributions'
  | 'reports'
  | 'workspace'
  | 'admin';

export interface UserAccount {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  status: AccountStatus;
  linkedMemberId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type MemberCategory = 'monthly' | 'sponsor' | 'lifetime' | 'donor';
export type MemberStatus = 'active' | 'paused' | 'ended';

export interface Member {
  id: string;
  memberCode: string;
  fullName: string;
  phone?: string;
  email?: string;
  location?: string;
  birthDate?: string; // YYYY-MM-DD
  category: MemberCategory;
  monthlyCommitment: number;
  status: MemberStatus;
  joinedDate: string;
  effectiveMonth: string; // YYYY-MM when current status/commitment took effect
  notes?: string;
  linkedUid?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CommitmentHistoryEntry {
  id: string;
  memberId: string;
  amountEtb: number;
  effectiveFrom: string; // YYYY-MM
  reason: string;
  changedBy: string;
  changedByName: string;
  createdAt?: unknown;
}

export interface StatusHistoryEntry {
  id: string;
  memberId: string;
  status: MemberStatus;
  effectiveFrom: string; // YYYY-MM
  reason: string;
  changedBy: string;
  changedByName: string;
  createdAt?: unknown;
}

export type PaymentMethod =
  | 'cash'
  | 'cbe'
  | 'telebirr'
  | 'coop_bank'
  | 'awash_bank'
  | 'other';

export type ContributionStatus = 'pending' | 'confirmed' | 'cancelled' | 'rejected';

export interface Contribution {
  id: string;
  receiptNumber: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  linkedUid?: string;
  amount: number;
  currency: 'ETB';
  month: string; // Contribution Month (YYYY-MM)
  paymentDate: string; // Actual Received Date (YYYY-MM-DD)
  paymentMethod: PaymentMethod;
  referenceCode?: string;
  status: ContributionStatus;
  statusReason?: string;
  statusChangedBy?: string;
  evidenceNote?: string;
  notes?: string;
  recordedBy: string;
  recordedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PaymentEvidence {
  id: string;
  contributionId: string;
  memberId: string;
  linkedUid?: string;
  fileName: string;
  mimeType: string;
  storageReference: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt?: unknown;
}

export interface PeriodClosure {
  periodKey: string; // YYYY-MM
  status: 'open' | 'closed';
  expectedEtb: number;
  collectedEtb: number;
  outstandingEtb: number;
  cashReconciledEtb: number;
  bankReconciledEtb: number;
  preparedBy: string;
  reviewedBy?: string;
  approvedBy?: string;
  notes?: string;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface CenterStats {
  totalCollectedEtb: number;
  expectedMonthlyEtb: number;
  activeMembersCount: number;
  totalMembersCount: number;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetType: 'user' | 'member' | 'contribution' | 'period' | 'evidence' | 'workspace' | 'system';
  targetId: string;
  details: string;
  createdAt?: unknown;
}

export interface GroundedSource {
  title: string;
  uri: string;
}

export interface GroundedSearchResult {
  text: string;
  sources: GroundedSource[];
  queries: string[];
}

export interface MemberMonthlyFinancialRow {
  member: Member;
  statusInPeriod: MemberStatus | 'not_joined';
  expectedEtb: number;
  collectedEtb: number;
  outstandingEtb: number;
  overpaymentEtb: number;
  ratePercent: number | null;
}

export interface PeriodSummaryMetrics {
  periodKey: string;
  activeMembersCount: number;
  expectedEtb: number;
  collectedEtb: number;
  outstandingEtb: number;
  overpaymentEtb: number;
  collectionRatePercent: number | null;
  overdueMembersCount: number;
  overdueAmountEtb: number;
  rows: MemberMonthlyFinancialRow[];
  methodMix: Array<{ method: PaymentMethod; totalEtb: number; count: number }>;
}

export type MemberStandingStatus = 'up_to_date' | 'in_arrears';

export interface MemberStandingRow {
  member: Member;
  statusAsOfPeriod: MemberStatus | 'not_joined';
  currentCommitmentEtb: number;
  monthsEvaluated: number;
  expectedTotalEtb: number;
  confirmedTotalEtb: number;
  arrearsEtb: number;
  overpaymentEtb: number;
  monthsInArrears: string[];
  lastPaymentDate?: string;
  standing: MemberStandingStatus;
  ratePercent: number | null;
}

export interface MemberStandingSummary {
  asOfPeriod: string;
  totalMembers: number;
  upToDateCount: number;
  inArrearsCount: number;
  totalExpectedEtb: number;
  totalConfirmedEtb: number;
  totalArrearsEtb: number;
  totalOverpaymentEtb: number;
  rows: MemberStandingRow[];
}

export type SyncStatus = 'never' | 'success' | 'failed';

export interface SyncDiagnostic {
  integrationId: string;
  status: SyncStatus;
  lastSuccessAt?: unknown;
  lastAttemptAt?: unknown;
  firstFailureAt?: unknown;
  consecutiveFailures: number;
  lastError?: string;
  lastSpreadsheetId?: string;
  lastSpreadsheetUrl?: string;
  lastSyncedMembersCount?: number;
  lastSyncedContributionsCount?: number;
  lastSyncedPeriod?: string;
  triggeredByUid: string;
  triggeredByEmail: string;
  updatedAt?: unknown;
}

export interface FinancialGoal {
  year: string; // YYYY
  targetEtb: number;
  notes?: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt?: unknown;
}

export interface MeetingMinute {
  id: string;
  periodKey: string; // YYYY-MM
  title: string;
  meetingDate: string; // YYYY-MM-DD
  chairperson?: string;
  attendeesCount?: number;
  attendeesSummary?: string;
  summaryNotes: string;
  decisions?: string;
  recordedBy: string;
  recordedByName: string;
  updatedBy: string;
  updatedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
