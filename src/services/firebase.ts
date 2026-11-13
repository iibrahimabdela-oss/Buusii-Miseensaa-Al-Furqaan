import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  AccountStatus,
  AuditLog,
  CenterStats,
  CommitmentHistoryEntry,
  Contribution,
  ContributionStatus,
  FinancialGoal,
  MeetingMinute,
  Member,
  MemberStatus,
  PaymentEvidence,
  PeriodClosure,
  StatusHistoryEntry,
  SyncDiagnostic,
  UserAccount,
  UserRole,
} from '../types.ts';

export const BOOTSTRAPPED_OWNER_EMAIL = 'markazalfurqan36@gmail.com';

export const app = initializeApp(firebaseConfig);
const firestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-c73eb970-5578-48c0-881e-afd77d3223d3';
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);

// Connection probe on boot per firebase-integration-rpc guidelines
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function normalizeUserAccount(raw: Record<string, unknown>): UserAccount {
  const rawRole = String(raw.role || 'member');
  const role: UserRole =
    rawRole === 'owner' ||
    rawRole === 'admin' ||
    rawRole === 'cashier' ||
    rawRole === 'viewer' ||
    rawRole === 'member'
      ? rawRole
      : 'member';

  return {
    uid: String(raw.uid || ''),
    email: String(raw.email || ''),
    displayName: String(raw.displayName || 'Member'),
    photoURL: typeof raw.photoURL === 'string' ? raw.photoURL : undefined,
    role,
    status: raw.status === 'suspended' ? 'suspended' : 'active',
    linkedMemberId: typeof raw.linkedMemberId === 'string' ? raw.linkedMemberId : undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function cleanStr(val: string | undefined, maxLen: number): string {
  return (val || '').trim().slice(0, maxLen);
}

function sanitizeId(val: string, fallbackPrefix = 'id'): string {
  const cleaned = val.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : `${fallbackPrefix}_${Date.now()}`;
}

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

// V2.0 Sample Dataset (Strictly Contributions / Buusii in ETB — Zero Expenses)
const CURRENT_YM = new Date().toISOString().slice(0, 7);

export const INITIAL_MEMBERS: Array<
  Omit<Member, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'> & { id: string }
> = [
  {
    id: 'mem_afq_001',
    memberCode: 'AFQ-001',
    fullName: 'Ustaaz Ahmad Nuur',
    phone: '+251915221104',
    email: 'ahmad.nuur@example.org',
    location: 'Chiro, Kebele 02',
    birthDate: '1986-11-18',
    category: 'monthly',
    monthlyCommitment: 1500,
    status: 'active',
    joinedDate: '2026-01-15',
    effectiveMonth: '2026-01',
    notes: 'Regular monthly supporter for Hifz students',
  },
  {
    id: 'mem_afq_002',
    memberCode: 'AFQ-002',
    fullName: 'Haajiya Faaximaa Abdallaa',
    phone: '+251912884419',
    location: 'Chiro, Oda Bultum',
    birthDate: '1991-11-24',
    category: 'sponsor',
    monthlyCommitment: 3000,
    status: 'active',
    joinedDate: '2026-02-01',
    effectiveMonth: '2026-02',
    notes: 'Sponsors two Qur’an memorization students',
  },
  {
    id: 'mem_afq_003',
    memberCode: 'AFQ-003',
    fullName: 'Ibraahim Kadiir Muusaa',
    phone: '+251923449012',
    location: 'Hirna, West Hararghe',
    birthDate: '1994-05-12',
    category: 'monthly',
    monthlyCommitment: 1000,
    status: 'active',
    joinedDate: '2026-03-10',
    effectiveMonth: '2026-03',
  },
  {
    id: 'mem_afq_004',
    memberCode: 'AFQ-004',
    fullName: 'Dr. Suleeymaan Mahaammad',
    phone: '+251911675432',
    location: 'Addis Ababa / Chiro Diaspora',
    birthDate: '1982-09-14',
    category: 'lifetime',
    monthlyCommitment: 5000,
    status: 'active',
    joinedDate: '2026-01-05',
    effectiveMonth: '2026-01',
    notes: 'Monthly center & Hifz development donor',
  },
];

export const INITIAL_CONTRIBUTIONS: Array<
  Omit<Contribution, 'id' | 'recordedBy' | 'recordedByName' | 'createdAt' | 'updatedAt'> & { id: string }
> = [
  {
    id: 'cnt_afq_001',
    receiptNumber: 'RCP-2026-1001',
    memberId: 'mem_afq_001',
    memberName: 'Ustaaz Ahmad Nuur',
    memberCode: 'AFQ-001',
    amount: 1500,
    currency: 'ETB',
    month: CURRENT_YM,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'cbe',
    referenceCode: 'FT26306CBE901',
    status: 'confirmed',
    notes: 'Full monthly buusii',
  },
  {
    id: 'cnt_afq_002',
    receiptNumber: 'RCP-2026-1002',
    memberId: 'mem_afq_002',
    memberName: 'Haajiya Faaximaa Abdallaa',
    memberCode: 'AFQ-002',
    amount: 3000,
    currency: 'ETB',
    month: CURRENT_YM,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'telebirr',
    referenceCode: 'TB88492011',
    status: 'confirmed',
    notes: 'Student sponsorship buusii',
  },
  {
    id: 'cnt_afq_003',
    receiptNumber: 'RCP-2026-1003',
    memberId: 'mem_afq_004',
    memberName: 'Dr. Suleeymaan Mahaammad',
    memberCode: 'AFQ-004',
    amount: 5500,
    currency: 'ETB',
    month: CURRENT_YM,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'coop_bank',
    referenceCode: 'COOP-77219',
    status: 'confirmed',
    notes: 'Includes ETB 500 voluntary extra (Ol-kaffaltii)',
  },
  {
    id: 'cnt_afq_004',
    receiptNumber: 'RCP-2026-1004',
    memberId: 'mem_afq_003',
    memberName: 'Ibraahim Kadiir Muusaa',
    memberCode: 'AFQ-003',
    amount: 500,
    currency: 'ETB',
    month: CURRENT_YM,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'cash',
    status: 'pending',
    notes: 'Partial cash installment awaiting cashier confirmation',
  },
];

// --- Subscriptions ---

export function subscribeUserProfile(
  uid: string,
  onData: (account: UserAccount | null) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      onData(
        snap.exists()
          ? normalizeUserAccount(snap.data() as Record<string, unknown>)
          : null
      );
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeAllUsers(onData: (users: UserAccount[]) => void): Unsubscribe {
  const path = 'users';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => normalizeUserAccount(d.data() as Record<string, unknown>)));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeMembers(
  role: UserRole,
  uid: string,
  onData: (members: Member[]) => void
): Unsubscribe {
  const path = 'members';
  const isCashierOrAbove = role === 'owner' || role === 'admin' || role === 'cashier';
  const q = isCashierOrAbove
    ? query(collection(db, path), orderBy('memberCode', 'asc'))
    : query(collection(db, path), where('linkedUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<Member, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeContributions(
  role: UserRole,
  uid: string,
  onData: (items: Contribution[]) => void
): Unsubscribe {
  const path = 'contributions';
  const isCashierOrAbove = role === 'owner' || role === 'admin' || role === 'cashier';
  const q = isCashierOrAbove
    ? query(collection(db, path), orderBy('paymentDate', 'desc'))
    : query(collection(db, path), where('linkedUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<Contribution, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribePaymentEvidence(
  role: UserRole,
  uid: string,
  onData: (items: PaymentEvidence[]) => void
): Unsubscribe {
  const path = 'payment_evidence';
  const isCashierOrAbove = role === 'owner' || role === 'admin' || role === 'cashier';
  const q = isCashierOrAbove
    ? query(collection(db, path), orderBy('createdAt', 'desc'), limit(100))
    : query(collection(db, path), where('linkedUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<PaymentEvidence, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribePeriodClosures(onData: (items: PeriodClosure[]) => void): Unsubscribe {
  const path = 'period_closures';
  const q = query(collection(db, path), orderBy('periodKey', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as PeriodClosure));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeCenterStats(onData: (stats: CenterStats | null) => void): Unsubscribe {
  const path = 'center_stats/summary';
  return onSnapshot(
    doc(db, 'center_stats', 'summary'),
    (snap) => {
      onData(snap.exists() ? (snap.data() as CenterStats) : null);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeAuditLogs(onData: (logs: AuditLog[]) => void): Unsubscribe {
  const path = 'audit_logs';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(250));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<AuditLog, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeGoogleSheetsSyncDiagnostic(
  onData: (diag: SyncDiagnostic | null) => void
): Unsubscribe {
  const path = 'sync_diagnostics/google_sheets';
  return onSnapshot(
    doc(db, 'sync_diagnostics', 'google_sheets'),
    (snap) => {
      onData(snap.exists() ? (snap.data() as SyncDiagnostic) : null);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeFinancialGoal(
  yearKey: string,
  onData: (goal: FinancialGoal | null) => void
): Unsubscribe {
  const safeYear = sanitizeId(yearKey, String(new Date().getFullYear())).slice(0, 4);
  const path = `financial_goals/${safeYear}`;
  return onSnapshot(
    doc(db, 'financial_goals', safeYear),
    (snap) => {
      onData(snap.exists() ? (snap.data() as FinancialGoal) : null);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeMeetingMinutes(
  onData: (items: MeetingMinute[]) => void
): Unsubscribe {
  const path = 'meeting_minutes';
  const q = query(collection(db, path), orderBy('meetingDate', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<MeetingMinute, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function fetchMemberHistory(memberId: string): Promise<{
  commitments: CommitmentHistoryEntry[];
  statuses: StatusHistoryEntry[];
}> {
  const [comSnap, stSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'members', memberId, 'commitment_history'),
        orderBy('effectiveFrom', 'asc')
      )
    ),
    getDocs(
      query(
        collection(db, 'members', memberId, 'status_history'),
        orderBy('effectiveFrom', 'asc')
      )
    ),
  ]);
  return {
    commitments: comSnap.docs.map((d) => ({
      ...(d.data() as Omit<CommitmentHistoryEntry, 'id'>),
      id: d.id,
    })),
    statuses: stSnap.docs.map((d) => ({
      ...(d.data() as Omit<StatusHistoryEntry, 'id'>),
      id: d.id,
    })),
  };
}

export async function fetchAllMembersHistories(memberIds: string[]): Promise<{
  commitmentByMember: Record<string, CommitmentHistoryEntry[]>;
  statusByMember: Record<string, StatusHistoryEntry[]>;
}> {
  const commitmentByMember: Record<string, CommitmentHistoryEntry[]> = {};
  const statusByMember: Record<string, StatusHistoryEntry[]> = {};
  await Promise.all(
    memberIds.map(async (id) => {
      try {
        const res = await fetchMemberHistory(id);
        commitmentByMember[id] = res.commitments;
        statusByMember[id] = res.statuses;
      } catch {
        commitmentByMember[id] = [];
        statusByMember[id] = [];
      }
    })
  );
  return { commitmentByMember, statusByMember };
}

// --- Audit Logging & Summary Sync ---

export async function logAuditEvent(
  actor: UserAccount,
  action: string,
  targetType: AuditLog['targetType'],
  targetId: string,
  details: string
): Promise<void> {
  const id = generateId('log');
  const path = `audit_logs/${id}`;
  try {
    await setDoc(doc(db, 'audit_logs', id), {
      actorUid: actor.uid,
      actorEmail: cleanStr(actor.email, 200),
      action: cleanStr(action, 80),
      targetType,
      targetId: cleanStr(targetId, 128),
      details: cleanStr(details, 500),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function recomputeCenterStats(actorUid: string): Promise<void> {
  const path = 'center_stats/summary';
  try {
    const [membersSnap, contribSnap] = await Promise.all([
      getDocs(collection(db, 'members')),
      getDocs(collection(db, 'contributions')),
    ]);

    const totalMembersCount = membersSnap.size;
    let activeMembersCount = 0;
    let expectedMonthlyEtb = 0;

    for (const d of membersSnap.docs) {
      const m = d.data();
      if (m.status === 'active') {
        activeMembersCount += 1;
        expectedMonthlyEtb += Number(m.monthlyCommitment) || 0;
      }
    }

    // Only confirmed payments count toward Collected (BR-05 / BR-08)
    const totalCollectedEtb = contribSnap.docs.reduce((sum, d) => {
      const data = d.data();
      if (data.status !== 'confirmed') return sum;
      return sum + (Number(data.amount) || 0);
    }, 0);

    await setDoc(doc(db, 'center_stats', 'summary'), {
      totalCollectedEtb,
      expectedMonthlyEtb,
      activeMembersCount,
      totalMembersCount,
      updatedBy: actorUid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- Seed Sample Data (Owner/Admin explicit trigger) ---

export async function seedInitialSampleData(actor: UserAccount): Promise<void> {
  try {
    const membersBatch = writeBatch(db);
    for (const m of INITIAL_MEMBERS) {
      membersBatch.set(doc(db, 'members', m.id), {
        memberCode: cleanStr(m.memberCode, 32),
        fullName: cleanStr(m.fullName, 120),
        ...(m.phone ? { phone: cleanStr(m.phone, 32) } : {}),
        ...(m.email ? { email: cleanStr(m.email, 200) } : {}),
        ...(m.location ? { location: cleanStr(m.location, 160) } : {}),
        ...(m.birthDate ? { birthDate: cleanStr(m.birthDate, 32) } : {}),
        category: m.category,
        monthlyCommitment: Math.max(1, Number(m.monthlyCommitment) || 500),
        status: m.status,
        joinedDate: cleanStr(m.joinedDate, 32),
        effectiveMonth: cleanStr(m.effectiveMonth, 20),
        ...(m.notes ? { notes: cleanStr(m.notes, 500) } : {}),
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await membersBatch.commit();

    // Write initial commitment_history and status_history for each seeded member
    const historyBatch = writeBatch(db);
    for (const m of INITIAL_MEMBERS) {
      historyBatch.set(
        doc(db, 'members', m.id, 'commitment_history', `ch_init_${m.id}`),
        {
          memberId: m.id,
          amountEtb: m.monthlyCommitment,
          effectiveFrom: m.effectiveMonth,
          reason: 'Initial monthly commitment at registration',
          changedBy: actor.uid,
          changedByName: cleanStr(actor.displayName, 120),
          createdAt: serverTimestamp(),
        }
      );
      historyBatch.set(
        doc(db, 'members', m.id, 'status_history', `sh_init_${m.id}`),
        {
          memberId: m.id,
          status: m.status,
          effectiveFrom: m.effectiveMonth,
          reason: 'Initial membership activation',
          changedBy: actor.uid,
          changedByName: cleanStr(actor.displayName, 120),
          createdAt: serverTimestamp(),
        }
      );
    }
    await historyBatch.commit();

    const ledgerBatch = writeBatch(db);
    for (const c of INITIAL_CONTRIBUTIONS) {
      ledgerBatch.set(doc(db, 'contributions', c.id), {
        receiptNumber: cleanStr(c.receiptNumber, 40),
        memberId: c.memberId,
        memberName: cleanStr(c.memberName, 120),
        memberCode: cleanStr(c.memberCode, 32),
        amount: Number(c.amount),
        currency: 'ETB',
        month: cleanStr(c.month, 20),
        paymentDate: cleanStr(c.paymentDate, 32),
        paymentMethod: c.paymentMethod,
        ...(c.referenceCode ? { referenceCode: cleanStr(c.referenceCode, 80) } : {}),
        status: c.status,
        ...(c.notes ? { notes: cleanStr(c.notes, 500) } : {}),
        recordedBy: actor.uid,
        recordedByName: cleanStr(actor.displayName, 120),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await ledgerBatch.commit();

    await recomputeCenterStats(actor.uid);
    await logAuditEvent(
      actor,
      'SEED_SAMPLE_DATA',
      'system',
      'initial_seed_v2',
      'Loaded V2.0 sample members, commitment/status history, and contributions (ETB).'
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'members/seed');
  }
}

// --- Members & Effective-Dated History CRUD ---

export async function createMember(
  actor: UserAccount,
  input: Omit<Member, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = generateId('mem');
  const path = `members/${id}`;
  const effectiveMonth = cleanStr(input.effectiveMonth || input.joinedDate.slice(0, 7), 20);
  const commitment = Math.max(1, Number(input.monthlyCommitment) || 1);
  try {
    await setDoc(doc(db, 'members', id), {
      memberCode: sanitizeId(input.memberCode, 'AFQ').slice(0, 32),
      fullName: cleanStr(input.fullName, 120),
      ...(cleanStr(input.phone, 32) ? { phone: cleanStr(input.phone, 32) } : {}),
      ...(cleanStr(input.email, 200) ? { email: cleanStr(input.email, 200) } : {}),
      ...(cleanStr(input.location, 160) ? { location: cleanStr(input.location, 160) } : {}),
      ...(cleanStr(input.birthDate, 32) ? { birthDate: cleanStr(input.birthDate, 32) } : {}),
      category: input.category,
      monthlyCommitment: commitment,
      status: input.status,
      joinedDate: cleanStr(input.joinedDate, 32),
      effectiveMonth,
      ...(cleanStr(input.notes, 500) ? { notes: cleanStr(input.notes, 500) } : {}),
      ...(cleanStr(input.linkedUid, 128) ? { linkedUid: sanitizeId(input.linkedUid!, 'usr') } : {}),
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Write initial immutable history entries
    const batch = writeBatch(db);
    batch.set(doc(db, 'members', id, 'commitment_history', generateId('ch')), {
      memberId: id,
      amountEtb: commitment,
      effectiveFrom: effectiveMonth,
      reason: 'Initial commitment at registration',
      changedBy: actor.uid,
      changedByName: cleanStr(actor.displayName, 120),
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'members', id, 'status_history', generateId('sh')), {
      memberId: id,
      status: input.status,
      effectiveFrom: effectiveMonth,
      reason: 'Initial membership status',
      changedBy: actor.uid,
      changedByName: cleanStr(actor.displayName, 120),
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    await recomputeCenterStats(actor.uid);
    await logAuditEvent(
      actor,
      'CREATE_MEMBER',
      'member',
      id,
      `Registered member ${cleanStr(input.fullName, 80)} (${cleanStr(input.memberCode, 32)}) effective ${effectiveMonth}.`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMemberProfile(
  actor: UserAccount,
  memberId: string,
  input: {
    memberCode?: string;
    fullName?: string;
    phone?: string;
    email?: string;
    location?: string;
    birthDate?: string;
    category?: Member['category'];
    joinedDate?: string;
    notes?: string;
  }
): Promise<void> {
  const path = `members/${memberId}`;
  try {
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (input.memberCode !== undefined) payload.memberCode = sanitizeId(input.memberCode, 'AFQ').slice(0, 32);
    if (input.fullName !== undefined) payload.fullName = cleanStr(input.fullName, 120);
    if (input.phone !== undefined) payload.phone = cleanStr(input.phone, 32) || deleteField();
    if (input.email !== undefined) payload.email = cleanStr(input.email, 200) || deleteField();
    if (input.location !== undefined) payload.location = cleanStr(input.location, 160) || deleteField();
    if (input.birthDate !== undefined) payload.birthDate = cleanStr(input.birthDate, 32) || deleteField();
    if (input.category !== undefined) payload.category = input.category;
    if (input.joinedDate !== undefined) payload.joinedDate = cleanStr(input.joinedDate, 32);
    if (input.notes !== undefined) payload.notes = cleanStr(input.notes, 500) || deleteField();

    await updateDoc(doc(db, 'members', memberId), payload);
    await logAuditEvent(actor, 'UPDATE_MEMBER_PROFILE', 'member', memberId, `Updated profile details for member ${memberId}.`);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recordCommitmentChange(
  actor: UserAccount,
  memberId: string,
  amountEtb: number,
  effectiveFrom: string,
  reason: string
): Promise<void> {
  const path = `members/${memberId}/commitment_history`;
  const cleanAmount = Math.max(1, Number(amountEtb) || 1);
  const cleanMonth = cleanStr(effectiveFrom, 20);
  const cleanReason = cleanStr(reason, 300);
  try {
    await setDoc(doc(db, 'members', memberId, 'commitment_history', generateId('ch')), {
      memberId,
      amountEtb: cleanAmount,
      effectiveFrom: cleanMonth,
      reason: cleanReason,
      changedBy: actor.uid,
      changedByName: cleanStr(actor.displayName, 120),
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'members', memberId), {
      monthlyCommitment: cleanAmount,
      effectiveMonth: cleanMonth,
      updatedAt: serverTimestamp(),
    });
    await recomputeCenterStats(actor.uid);
    await logAuditEvent(
      actor,
      'CHANGE_COMMITMENT',
      'member',
      memberId,
      `Set monthly commitment to ${cleanAmount} ETB effective ${cleanMonth}. Reason: ${cleanReason}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function recordStatusChange(
  actor: UserAccount,
  memberId: string,
  status: MemberStatus,
  effectiveFrom: string,
  reason: string
): Promise<void> {
  const path = `members/${memberId}/status_history`;
  const cleanMonth = cleanStr(effectiveFrom, 20);
  const cleanReason = cleanStr(reason, 300);
  try {
    await setDoc(doc(db, 'members', memberId, 'status_history', generateId('sh')), {
      memberId,
      status,
      effectiveFrom: cleanMonth,
      reason: cleanReason,
      changedBy: actor.uid,
      changedByName: cleanStr(actor.displayName, 120),
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'members', memberId), {
      status,
      effectiveMonth: cleanMonth,
      updatedAt: serverTimestamp(),
    });
    await recomputeCenterStats(actor.uid);
    await logAuditEvent(
      actor,
      'CHANGE_MEMBER_STATUS',
      'member',
      memberId,
      `Set membership status to "${status}" effective ${cleanMonth}. Reason: ${cleanReason}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteMember(actor: UserAccount, memberId: string): Promise<void> {
  const path = `members/${memberId}`;
  try {
    await deleteDoc(doc(db, 'members', memberId));
    await recomputeCenterStats(actor.uid);
    await logAuditEvent(actor, 'DELETE_MEMBER', 'member', memberId, `Deleted member ${memberId} (Owner action).`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Contributions Ledger (No delete; cancel/reject with reason) ---

export async function createContribution(
  actor: UserAccount,
  input: Omit<Contribution, 'id' | 'recordedBy' | 'recordedByName' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = generateId('cnt');
  const path = `contributions/${id}`;
  try {
    await setDoc(doc(db, 'contributions', id), {
      receiptNumber: sanitizeId(input.receiptNumber, 'RCP').slice(0, 40),
      memberId: sanitizeId(input.memberId, 'mem'),
      memberName: cleanStr(input.memberName, 120),
      memberCode: cleanStr(input.memberCode, 32),
      ...(cleanStr(input.linkedUid, 128) ? { linkedUid: sanitizeId(input.linkedUid!, 'usr') } : {}),
      amount: Math.max(1, Number(input.amount) || 1),
      currency: 'ETB',
      month: cleanStr(input.month, 20),
      paymentDate: cleanStr(input.paymentDate, 32),
      paymentMethod: input.paymentMethod,
      ...(cleanStr(input.referenceCode, 80) ? { referenceCode: cleanStr(input.referenceCode, 80) } : {}),
      status: input.status,
      ...(cleanStr(input.evidenceNote, 200) ? { evidenceNote: cleanStr(input.evidenceNote, 200) } : {}),
      ...(cleanStr(input.notes, 500) ? { notes: cleanStr(input.notes, 500) } : {}),
      recordedBy: actor.uid,
      recordedByName: cleanStr(actor.displayName, 120),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await recomputeCenterStats(actor.uid);
    await logAuditEvent(
      actor,
      'RECORD_CONTRIBUTION',
      'contribution',
      id,
      `Recorded ${input.amount} ETB (${input.status}) for ${cleanStr(input.memberName, 80)} · Month ${input.month} (${input.receiptNumber}).`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createContributionsBatch(
  actor: UserAccount,
  inputs: Array<
    Omit<Contribution, 'id' | 'recordedBy' | 'recordedByName' | 'createdAt' | 'updatedAt'>
  >,
  fileName?: string
): Promise<number> {
  if (inputs.length === 0) return 0;
  const path = 'contributions/csv_batch';
  try {
    const chunkSize = 450;
    const stamp = Date.now();
    for (let start = 0; start < inputs.length; start += chunkSize) {
      const slice = inputs.slice(start, start + chunkSize);
      const batch = writeBatch(db);
      slice.forEach((input, offset) => {
        const idx = start + offset;
        const rand = Math.random().toString(36).slice(2, 6);
        const id = `cnt_${stamp}_${idx}_${rand}`;
        batch.set(doc(db, 'contributions', id), {
          receiptNumber: sanitizeId(input.receiptNumber, 'RCP').slice(0, 40),
          memberId: sanitizeId(input.memberId, 'mem'),
          memberName: cleanStr(input.memberName, 120),
          memberCode: cleanStr(input.memberCode, 32),
          ...(cleanStr(input.linkedUid, 128)
            ? { linkedUid: sanitizeId(input.linkedUid!, 'usr') }
            : {}),
          amount: Math.max(1, Number(input.amount) || 1),
          currency: 'ETB',
          month: cleanStr(input.month, 20),
          paymentDate: cleanStr(input.paymentDate, 32),
          paymentMethod: input.paymentMethod,
          ...(cleanStr(input.referenceCode, 80)
            ? { referenceCode: cleanStr(input.referenceCode, 80) }
            : {}),
          status: input.status,
          ...(cleanStr(input.evidenceNote, 200)
            ? { evidenceNote: cleanStr(input.evidenceNote, 200) }
            : {}),
          ...(cleanStr(input.notes, 500) ? { notes: cleanStr(input.notes, 500) } : {}),
          recordedBy: actor.uid,
          recordedByName: cleanStr(actor.displayName, 120),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    const totalEtb = inputs.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    await recomputeCenterStats(actor.uid);
    await logAuditEvent(
      actor,
      'CSV_IMPORT_CONTRIBUTIONS',
      'contribution',
      'csv_batch',
      `Imported ${inputs.length} pending contribution records (${totalEtb.toLocaleString()} ETB)${fileName ? ` from "${cleanStr(fileName, 80)}"` : ''} for verification.`
    );
    return inputs.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateContributionStatus(
  actor: UserAccount,
  contributionId: string,
  status: ContributionStatus,
  reason: string
): Promise<void> {
  const path = `contributions/${contributionId}`;
  const cleanReason = cleanStr(reason, 300);
  try {
    await updateDoc(doc(db, 'contributions', contributionId), {
      status,
      statusReason: cleanReason || deleteField(),
      statusChangedBy: cleanStr(actor.displayName || actor.email, 120),
      updatedAt: serverTimestamp(),
    });
    await recomputeCenterStats(actor.uid);
    await logAuditEvent(
      actor,
      'UPDATE_CONTRIBUTION_STATUS',
      'contribution',
      contributionId,
      `Changed payment status to "${status}". Reason: ${cleanReason || 'Confirmed'}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Payment Evidence Attachments ---

export async function uploadPaymentEvidence(
  actor: UserAccount,
  input: {
    contributionId: string;
    memberId: string;
    linkedUid?: string;
    fileName: string;
    mimeType: string;
    storageReference: string;
  }
): Promise<string> {
  const id = generateId('evd');
  const path = `payment_evidence/${id}`;
  try {
    await setDoc(doc(db, 'payment_evidence', id), {
      contributionId: sanitizeId(input.contributionId, 'cnt'),
      memberId: sanitizeId(input.memberId, 'mem'),
      ...(cleanStr(input.linkedUid, 128) ? { linkedUid: sanitizeId(input.linkedUid!, 'usr') } : {}),
      fileName: cleanStr(input.fileName, 160),
      mimeType: cleanStr(input.mimeType, 100),
      storageReference: input.storageReference.slice(0, 400000),
      uploadedBy: actor.uid,
      uploadedByName: cleanStr(actor.displayName, 120),
      createdAt: serverTimestamp(),
    });
    await logAuditEvent(
      actor,
      'UPLOAD_PAYMENT_EVIDENCE',
      'evidence',
      id,
      `Attached evidence "${cleanStr(input.fileName, 80)}" to contribution ${input.contributionId}.`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// --- Monthly Period Closing & Reconciliation ---

export async function savePeriodClosure(
  actor: UserAccount,
  closure: Omit<PeriodClosure, 'updatedBy' | 'updatedAt'>,
  auditReason: string
): Promise<void> {
  const path = `period_closures/${closure.periodKey}`;
  try {
    await setDoc(doc(db, 'period_closures', closure.periodKey), {
      periodKey: closure.periodKey,
      status: closure.status,
      expectedEtb: Math.max(0, Number(closure.expectedEtb) || 0),
      collectedEtb: Math.max(0, Number(closure.collectedEtb) || 0),
      outstandingEtb: Math.max(0, Number(closure.outstandingEtb) || 0),
      cashReconciledEtb: Math.max(0, Number(closure.cashReconciledEtb) || 0),
      bankReconciledEtb: Math.max(0, Number(closure.bankReconciledEtb) || 0),
      preparedBy: cleanStr(closure.preparedBy, 120),
      ...(cleanStr(closure.reviewedBy, 120) ? { reviewedBy: cleanStr(closure.reviewedBy, 120) } : {}),
      ...(cleanStr(closure.approvedBy, 120) ? { approvedBy: cleanStr(closure.approvedBy, 120) } : {}),
      ...(cleanStr(closure.notes, 500) ? { notes: cleanStr(closure.notes, 500) } : {}),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent(
      actor,
      closure.status === 'closed' ? 'CLOSE_PERIOD' : 'REOPEN_PERIOD',
      'period',
      closure.periodKey,
      `${closure.status === 'closed' ? 'Closed' : 'Reopened'} period ${closure.periodKey}. Cash: ${closure.cashReconciledEtb} ETB, Bank: ${closure.bankReconciledEtb} ETB. Note: ${cleanStr(auditReason, 240)}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- Owner User Management (5-Tier RBAC) ---

export async function updateUserRoleAndStatus(
  actor: UserAccount,
  targetUid: string,
  updates: {
    role?: UserRole;
    status?: AccountStatus;
    linkedMemberId?: string | null;
  }
): Promise<void> {
  const path = `users/${targetUid}`;
  try {
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (updates.role !== undefined) payload.role = updates.role;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.linkedMemberId !== undefined) {
      payload.linkedMemberId = updates.linkedMemberId
        ? sanitizeId(updates.linkedMemberId, 'mem')
        : deleteField();
    }

    await updateDoc(doc(db, 'users', targetUid), payload);

    if (updates.linkedMemberId) {
      const memSnap = await getDoc(doc(db, 'members', updates.linkedMemberId));
      if (memSnap.exists()) {
        await updateDoc(doc(db, 'members', updates.linkedMemberId), {
          linkedUid: targetUid,
          updatedAt: serverTimestamp(),
        });
      }
    }

    await logAuditEvent(
      actor,
      'UPDATE_USER_ACCESS',
      'user',
      targetUid,
      `Updated user ${targetUid}: ${JSON.stringify(updates)}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Google Sheets Sync Diagnostics ---

export async function recordGoogleSheetsSyncSuccess(
  actor: UserAccount,
  info: {
    spreadsheetId: string;
    spreadsheetUrl: string;
    membersCount: number;
    contributionsCount: number;
    periodKey: string;
  }
): Promise<void> {
  const path = 'sync_diagnostics/google_sheets';
  try {
    await setDoc(doc(db, 'sync_diagnostics', 'google_sheets'), {
      integrationId: 'google_sheets',
      status: 'success',
      lastSuccessAt: serverTimestamp(),
      lastAttemptAt: serverTimestamp(),
      consecutiveFailures: 0,
      lastSpreadsheetId: cleanStr(info.spreadsheetId, 128),
      lastSpreadsheetUrl: cleanStr(info.spreadsheetUrl, 400),
      lastSyncedMembersCount: Math.max(0, Number(info.membersCount) || 0),
      lastSyncedContributionsCount: Math.max(0, Number(info.contributionsCount) || 0),
      lastSyncedPeriod: cleanStr(info.periodKey, 20),
      triggeredByUid: actor.uid,
      triggeredByEmail: cleanStr(actor.email, 200),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function recordGoogleSheetsSyncFailure(
  actor: UserAccount,
  errorMessage: string
): Promise<void> {
  const path = 'sync_diagnostics/google_sheets';
  const cleanError = cleanStr(errorMessage || 'Google Sheets synchronization failed.', 500);
  try {
    const ref = doc(db, 'sync_diagnostics', 'google_sheets');
    const existingSnap = await getDoc(ref);
    const existingData = existingSnap.exists()
      ? (existingSnap.data() as Record<string, unknown>)
      : null;

    const payload: Record<string, unknown> = {
      integrationId: 'google_sheets',
      status: 'failed',
      lastAttemptAt: serverTimestamp(),
      firstFailureAt:
        existingData?.status === 'failed' && existingData?.firstFailureAt
          ? existingData.firstFailureAt
          : serverTimestamp(),
      consecutiveFailures: (Number(existingData?.consecutiveFailures) || 0) + 1,
      lastError: cleanError,
      triggeredByUid: actor.uid,
      triggeredByEmail: cleanStr(actor.email, 200),
      updatedAt: serverTimestamp(),
    };

    if (existingData?.lastSuccessAt) {
      payload.lastSuccessAt = existingData.lastSuccessAt;
    }
    if (typeof existingData?.lastSpreadsheetId === 'string') {
      payload.lastSpreadsheetId = existingData.lastSpreadsheetId;
    }
    if (typeof existingData?.lastSpreadsheetUrl === 'string') {
      payload.lastSpreadsheetUrl = existingData.lastSpreadsheetUrl;
    }
    if (typeof existingData?.lastSyncedMembersCount === 'number') {
      payload.lastSyncedMembersCount = existingData.lastSyncedMembersCount;
    }
    if (typeof existingData?.lastSyncedContributionsCount === 'number') {
      payload.lastSyncedContributionsCount = existingData.lastSyncedContributionsCount;
    }
    if (typeof existingData?.lastSyncedPeriod === 'string') {
      payload.lastSyncedPeriod = existingData.lastSyncedPeriod;
    }

    await setDoc(ref, payload);
    await logAuditEvent(
      actor,
      'SYNC_GOOGLE_SHEETS_FAILED',
      'workspace',
      'google_sheets',
      `Google Sheets sync failed: ${cleanError}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- Annual Financial Goals ---

export async function saveFinancialGoal(
  actor: UserAccount,
  yearKey: string,
  targetEtb: number,
  notes?: string
): Promise<void> {
  const cleanYear = yearKey.replace(/[^0-9]/g, '').slice(0, 4);
  const cleanTarget = Math.max(1, Math.round(Number(targetEtb) || 0));
  const cleanNotes = cleanStr(notes, 300);
  const path = `financial_goals/${cleanYear}`;
  try {
    const payload: Record<string, unknown> = {
      year: cleanYear,
      targetEtb: cleanTarget,
      updatedBy: actor.uid,
      updatedByName: cleanStr(actor.displayName || actor.email, 120),
      updatedAt: serverTimestamp(),
    };
    if (cleanNotes) {
      payload.notes = cleanNotes;
    }
    await setDoc(doc(db, 'financial_goals', cleanYear), payload);
    await logAuditEvent(
      actor,
      'SET_FINANCIAL_GOAL',
      'system',
      cleanYear,
      `Set ${cleanYear} annual contribution target to ${cleanTarget.toLocaleString()} ETB.${
        cleanNotes ? ` Note: ${cleanNotes}` : ''
      }`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- Monthly Center Meeting Minutes Archive ---

export interface MeetingMinuteInput {
  periodKey: string;
  title: string;
  meetingDate: string;
  chairperson?: string;
  attendeesCount?: number;
  attendeesSummary?: string;
  summaryNotes: string;
  decisions?: string;
}

export async function createMeetingMinute(
  actor: UserAccount,
  input: MeetingMinuteInput
): Promise<string> {
  const id = generateId('mtg');
  const path = `meeting_minutes/${id}`;
  const cleanPeriod = /^\d{4}-\d{2}$/.test(input.periodKey.trim())
    ? input.periodKey.trim()
    : new Date().toISOString().slice(0, 7);
  const cleanTitle = cleanStr(input.title, 160);
  const cleanDate = cleanStr(input.meetingDate, 32);
  const cleanChairperson = cleanStr(input.chairperson, 120);
  const cleanAttendeesSummary = cleanStr(input.attendeesSummary, 300);
  const cleanSummary = cleanStr(input.summaryNotes, 4000);
  const cleanDecisions = cleanStr(input.decisions, 2000);
  const actorName = cleanStr(actor.displayName || actor.email, 120);

  try {
    const payload: Record<string, unknown> = {
      periodKey: cleanPeriod,
      title: cleanTitle,
      meetingDate: cleanDate,
      summaryNotes: cleanSummary,
      recordedBy: actor.uid,
      recordedByName: actorName,
      updatedBy: actor.uid,
      updatedByName: actorName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (cleanChairperson) payload.chairperson = cleanChairperson;
    if (
      typeof input.attendeesCount === 'number' &&
      Number.isFinite(input.attendeesCount) &&
      input.attendeesCount >= 0
    ) {
      payload.attendeesCount = Math.min(10000, Math.round(input.attendeesCount));
    }
    if (cleanAttendeesSummary) payload.attendeesSummary = cleanAttendeesSummary;
    if (cleanDecisions) payload.decisions = cleanDecisions;

    await setDoc(doc(db, 'meeting_minutes', id), payload);
    await logAuditEvent(
      actor,
      'CREATE_MEETING_MINUTE',
      'period',
      cleanPeriod,
      `Archived meeting minutes "${cleanTitle}" for period ${cleanPeriod} (${cleanDate}).`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMeetingMinute(
  actor: UserAccount,
  minuteId: string,
  input: MeetingMinuteInput
): Promise<void> {
  const path = `meeting_minutes/${minuteId}`;
  const cleanPeriod = /^\d{4}-\d{2}$/.test(input.periodKey.trim())
    ? input.periodKey.trim()
    : new Date().toISOString().slice(0, 7);
  const cleanTitle = cleanStr(input.title, 160);
  const cleanDate = cleanStr(input.meetingDate, 32);
  const cleanChairperson = cleanStr(input.chairperson, 120);
  const cleanAttendeesSummary = cleanStr(input.attendeesSummary, 300);
  const cleanSummary = cleanStr(input.summaryNotes, 4000);
  const cleanDecisions = cleanStr(input.decisions, 2000);
  const actorName = cleanStr(actor.displayName || actor.email, 120);

  try {
    const payload: Record<string, unknown> = {
      periodKey: cleanPeriod,
      title: cleanTitle,
      meetingDate: cleanDate,
      summaryNotes: cleanSummary,
      chairperson: cleanChairperson || deleteField(),
      attendeesSummary: cleanAttendeesSummary || deleteField(),
      decisions: cleanDecisions || deleteField(),
      attendeesCount:
        typeof input.attendeesCount === 'number' &&
        Number.isFinite(input.attendeesCount) &&
        input.attendeesCount >= 0
          ? Math.min(10000, Math.round(input.attendeesCount))
          : deleteField(),
      updatedBy: actor.uid,
      updatedByName: actorName,
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, 'meeting_minutes', minuteId), payload);
    await logAuditEvent(
      actor,
      'UPDATE_MEETING_MINUTE',
      'period',
      cleanPeriod,
      `Updated meeting minutes "${cleanTitle}" for period ${cleanPeriod}.`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMeetingMinute(
  actor: UserAccount,
  minuteId: string,
  periodKey: string,
  title: string
): Promise<void> {
  const path = `meeting_minutes/${minuteId}`;
  try {
    await deleteDoc(doc(db, 'meeting_minutes', minuteId));
    await logAuditEvent(
      actor,
      'DELETE_MEETING_MINUTE',
      'period',
      periodKey,
      `Deleted meeting minutes "${cleanStr(title, 80)}" (${periodKey}) [Owner].`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

