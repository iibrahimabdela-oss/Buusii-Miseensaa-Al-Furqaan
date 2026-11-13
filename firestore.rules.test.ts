/**
 * Dirty Dozen Security & Invariant Verification Suite for Al-Furqaan V2.0 Firestore Rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedResult: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
  enforcedByRule: string;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Self-Promotion on Create',
    collection: '/users/attacker_uid',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { uid: 'attacker_uid', role: 'owner', status: 'active' },
    enforcedByRule: "users.create requires incoming().role == 'member' unless isBootstrappedOwner()",
  },
  {
    id: 2,
    name: 'Role Escalation on Update',
    collection: '/users/member_uid',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { role: 'admin', updatedAt: 'REQUEST_TIME' },
    enforcedByRule: "Self update restricts affectedKeys().hasOnly(['displayName', 'photoURL', 'updatedAt'])",
  },
  {
    id: 3,
    name: 'Shadow / Ghost Field Injection',
    collection: '/members/mem_001',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { memberCode: 'AFQ-099', fullName: 'Test Member', extraGhost: true },
    enforcedByRule: 'isValidMember enforces data.keys().hasOnly([...])',
  },
  {
    id: 4,
    name: 'Unverified Email Spoofing',
    collection: '/members/mem_001',
    operation: 'get',
    expectedResult: 'PERMISSION_DENIED',
    payload: { auth: { email: 'markazalfurqan36@gmail.com', email_verified: false } },
    enforcedByRule: 'isSignedIn() mandates request.auth.token.email_verified == true',
  },
  {
    id: 5,
    name: 'Member Reading Another Member Record (T-12)',
    collection: '/members/mem_002',
    operation: 'get',
    expectedResult: 'PERMISSION_DENIED',
    payload: { authRole: 'member', targetLinkedUid: 'other_uid' },
    enforcedByRule: 'members.get requires isCashierOrAbove() or existing().linkedUid == request.auth.uid',
  },
  {
    id: 6,
    name: 'Cashier Attempting Privileged User Role Change (T-13)',
    collection: '/users/some_uid',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { authRole: 'cashier', role: 'admin' },
    enforcedByRule: 'users.update role changes strictly require isOwner()',
  },
  {
    id: 7,
    name: 'Orphaned Contribution Creation',
    collection: '/contributions/cnt_orphan',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { memberId: 'non_existent_member', amount: 500 },
    enforcedByRule: 'contributions.create checks exists(/databases/$(database)/documents/members/$(incoming().memberId))',
  },
  {
    id: 8,
    name: 'Unrestricted Payment Deletion Attempt (PAY-05)',
    collection: '/contributions/cnt_001',
    operation: 'delete',
    expectedResult: 'PERMISSION_DENIED',
    payload: { authRole: 'owner' },
    enforcedByRule: 'contributions enforces allow delete: if false; erroneous entries must be cancelled with reason',
  },
  {
    id: 9,
    name: 'Commitment History Rewrite Attempt (MEM-05)',
    collection: '/members/mem_001/commitment_history/hist_1',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { amountEtb: 100 },
    enforcedByRule: 'commitment_history enforces allow update, delete: if false',
  },
  {
    id: 10,
    name: 'Zero or Negative Commitment / Payment',
    collection: '/contributions/cnt_zero',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { amount: 0, currency: 'ETB' },
    enforcedByRule: 'isValidContribution enforces data.amount > 0 and data.currency == ETB',
  },
  {
    id: 11,
    name: 'Audit Log Tampering',
    collection: '/audit_logs/log_001',
    operation: 'delete',
    expectedResult: 'PERMISSION_DENIED',
    payload: { authRole: 'owner' },
    enforcedByRule: 'audit_logs enforces allow update, delete: if false',
  },
  {
    id: 12,
    name: 'Suspended User Bypass',
    collection: '/center_stats/summary',
    operation: 'get',
    expectedResult: 'PERMISSION_DENIED',
    payload: { userStatus: 'suspended' },
    enforcedByRule: "isActiveAccount() requires userDoc().status == 'active'",
  },
];
