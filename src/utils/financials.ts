import type {
  CommitmentHistoryEntry,
  Contribution,
  Member,
  MemberMonthlyFinancialRow,
  MemberStatus,
  PaymentMethod,
  PeriodClosure,
  PeriodSummaryMetrics,
  StatusHistoryEntry,
} from '../types.ts';

function periodFromDate(dateStr: string): string {
  if (/^\d{4}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 7);
  }
  return '1970-01';
}

/**
 * Resolves the effective membership status for a given YYYY-MM period
 * using immutable StatusHistory intervals (BR-02 / BR-03).
 */
export function getMemberStatusForPeriod(
  member: Member,
  periodKey: string,
  statusHistory: StatusHistoryEntry[]
): MemberStatus | 'not_joined' {
  const joinedPeriod = periodFromDate(member.joinedDate);
  if (periodKey < joinedPeriod) {
    return 'not_joined';
  }

  const relevant = statusHistory
    .filter((h) => h.effectiveFrom <= periodKey)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  if (relevant.length > 0) {
    return relevant[relevant.length - 1].status;
  }

  // Fallback when no history entries exist yet
  if (member.effectiveMonth && periodKey < member.effectiveMonth) {
    return 'active';
  }
  return member.status;
}

/**
 * Resolves the effective monthly commitment (ETB) active in YYYY-MM (BR-04 / FIN-01).
 */
export function getMemberCommitmentForPeriod(
  member: Member,
  periodKey: string,
  commitmentHistory: CommitmentHistoryEntry[]
): number {
  const joinedPeriod = periodFromDate(member.joinedDate);
  if (periodKey < joinedPeriod) {
    return 0;
  }

  const relevant = commitmentHistory
    .filter((h) => h.effectiveFrom <= periodKey)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  if (relevant.length > 0) {
    return relevant[relevant.length - 1].amountEtb;
  }

  return member.monthlyCommitment;
}

export function calculateMemberRowForPeriod(
  member: Member,
  periodKey: string,
  memberCommitments: CommitmentHistoryEntry[],
  memberStatuses: StatusHistoryEntry[],
  contributions: Contribution[]
): MemberMonthlyFinancialRow {
  const statusInPeriod = getMemberStatusForPeriod(member, periodKey, memberStatuses);
  const expectedEtb =
    statusInPeriod === 'active'
      ? getMemberCommitmentForPeriod(member, periodKey, memberCommitments)
      : 0;

  // BR-05 & BR-08: Only confirmed contributions count toward Collected
  const collectedEtb = contributions
    .filter(
      (c) =>
        c.memberId === member.id &&
        c.month === periodKey &&
        c.status === 'confirmed'
    )
    .reduce((sum, c) => sum + c.amount, 0);

  // BR-07 & FIN-04: Never silently roll overpayments into next month; report separately
  const outstandingEtb = Math.max(0, expectedEtb - collectedEtb);
  const overpaymentEtb = Math.max(0, collectedEtb - expectedEtb);
  const ratePercent =
    expectedEtb > 0 ? Math.min(100, Math.round((collectedEtb / expectedEtb) * 10000) / 100) : null;

  return {
    member,
    statusInPeriod,
    expectedEtb,
    collectedEtb,
    outstandingEtb,
    overpaymentEtb,
    ratePercent,
  };
}

export function calculatePeriodSummary(
  periodKey: string,
  members: Member[],
  commitmentByMember: Record<string, CommitmentHistoryEntry[]>,
  statusByMember: Record<string, StatusHistoryEntry[]>,
  contributions: Contribution[],
  closures: PeriodClosure[]
): PeriodSummaryMetrics {
  const rows = members.map((member) =>
    calculateMemberRowForPeriod(
      member,
      periodKey,
      commitmentByMember[member.id] || [],
      statusByMember[member.id] || [],
      contributions
    )
  );

  const activeMembersCount = rows.filter((r) => r.statusInPeriod === 'active').length;
  const expectedEtb = rows.reduce((s, r) => s + r.expectedEtb, 0);
  const collectedEtb = rows.reduce((s, r) => s + r.collectedEtb, 0);
  const outstandingEtb = rows.reduce((s, r) => s + r.outstandingEtb, 0);
  const overpaymentEtb = rows.reduce((s, r) => s + r.overpaymentEtb, 0);

  const collectionRatePercent =
    expectedEtb > 0 ? Math.round((collectedEtb / expectedEtb) * 10000) / 100 : null;

  // Overdue / delayed: members with outstanding amounts across CLOSED periods (or past months <= selected)
  const closedKeys = new Set(
    closures.filter((cl) => cl.status === 'closed').map((cl) => cl.periodKey)
  );

  const overdueByMember = new Map<string, number>();
  for (const closedKey of closedKeys) {
    for (const member of members) {
      const r = calculateMemberRowForPeriod(
        member,
        closedKey,
        commitmentByMember[member.id] || [],
        statusByMember[member.id] || [],
        contributions
      );
      if (r.outstandingEtb > 0) {
        overdueByMember.set(
          member.id,
          (overdueByMember.get(member.id) || 0) + r.outstandingEtb
        );
      }
    }
  }

  // Fallback check: if no periods have been formally closed yet, evaluate outstanding for selected period if it is strictly in the past
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (closedKeys.size === 0 && periodKey < currentMonth) {
    for (const r of rows) {
      if (r.outstandingEtb > 0) {
        overdueByMember.set(
          r.member.id,
          (overdueByMember.get(r.member.id) || 0) + r.outstandingEtb
        );
      }
    }
  }

  let overdueAmountEtb = 0;
  overdueByMember.forEach((v) => {
    overdueAmountEtb += v;
  });

  // Payment method mix for confirmed contributions in selected period
  const methodTotals = new Map<PaymentMethod, { totalEtb: number; count: number }>();
  for (const c of contributions) {
    if (c.month !== periodKey || c.status !== 'confirmed') continue;
    const prev = methodTotals.get(c.paymentMethod) || { totalEtb: 0, count: 0 };
    prev.totalEtb += c.amount;
    prev.count += 1;
    methodTotals.set(c.paymentMethod, prev);
  }
  const methodMix = Array.from(methodTotals.entries())
    .map(([method, val]) => ({ method, totalEtb: val.totalEtb, count: val.count }))
    .sort((a, b) => b.totalEtb - a.totalEtb);

  return {
    periodKey,
    activeMembersCount,
    expectedEtb,
    collectedEtb,
    outstandingEtb,
    overpaymentEtb,
    collectionRatePercent,
    overdueMembersCount: overdueByMember.size,
    overdueAmountEtb,
    rows,
    methodMix,
  };
}

export interface AnnualMonthRow {
  periodKey: string;
  monthIndex: number;
  activeMembers: number;
  expectedEtb: number;
  collectedEtb: number;
  outstandingEtb: number;
  overpaymentEtb: number;
  ratePercent: number | null;
}

export function calculateAnnualBreakdown(
  year: string,
  members: Member[],
  commitmentByMember: Record<string, CommitmentHistoryEntry[]>,
  statusByMember: Record<string, StatusHistoryEntry[]>,
  contributions: Contribution[]
): AnnualMonthRow[] {
  const result: AnnualMonthRow[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const periodKey = `${year}-${String(m).padStart(2, '0')}`;
    const summary = calculatePeriodSummary(
      periodKey,
      members,
      commitmentByMember,
      statusByMember,
      contributions,
      []
    );
    result.push({
      periodKey,
      monthIndex: m,
      activeMembers: summary.activeMembersCount,
      expectedEtb: summary.expectedEtb,
      collectedEtb: summary.collectedEtb,
      outstandingEtb: summary.outstandingEtb,
      overpaymentEtb: summary.overpaymentEtb,
      ratePercent: summary.collectionRatePercent,
    });
  }
  return result;
}

function listMonthsInclusive(startPeriod: string, endPeriod: string): string[] {
  const sMatch = /^(\d{4})-(\d{2})$/.exec(startPeriod);
  const eMatch = /^(\d{4})-(\d{2})$/.exec(endPeriod);
  if (!sMatch || !eMatch) return [];

  let year = Number(sMatch[1]);
  let month = Number(sMatch[2]);
  const endYear = Number(eMatch[1]);
  const endMonth = Number(eMatch[2]);

  if (year > endYear || (year === endYear && month > endMonth)) {
    return [];
  }

  const out: string[] = [];
  let guard = 0;
  while ((year < endYear || (year === endYear && month <= endMonth)) && guard < 120) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    guard += 1;
  }
  return out;
}

export function calculateMemberStandingSummary(
  asOfPeriod: string,
  members: Member[],
  commitmentByMember: Record<string, CommitmentHistoryEntry[]>,
  statusByMember: Record<string, StatusHistoryEntry[]>,
  contributions: Contribution[]
): import('../types.ts').MemberStandingSummary {
  const rows: import('../types.ts').MemberStandingRow[] = members.map((member) => {
    const commitments = commitmentByMember[member.id] || [];
    const statuses = statusByMember[member.id] || [];
    const joinedPeriod = periodFromDate(member.joinedDate);
    const months =
      joinedPeriod <= asOfPeriod ? listMonthsInclusive(joinedPeriod, asOfPeriod) : [];

    let expectedTotalEtb = 0;
    let confirmedInScheduleEtb = 0;
    let arrearsEtb = 0;
    let overpaymentEtb = 0;
    let monthsEvaluated = 0;
    const monthsInArrears: string[] = [];

    for (const p of months) {
      const row = calculateMemberRowForPeriod(
        member,
        p,
        commitments,
        statuses,
        contributions
      );
      if (row.statusInPeriod === 'active') {
        monthsEvaluated += 1;
      }
      expectedTotalEtb += row.expectedEtb;
      confirmedInScheduleEtb += row.collectedEtb;
      arrearsEtb += row.outstandingEtb;
      overpaymentEtb += row.overpaymentEtb;
      if (row.outstandingEtb > 0) {
        monthsInArrears.push(p);
      }
    }

    const memberConfirmedContribs = contributions
      .filter(
        (c) =>
          c.memberId === member.id &&
          c.status === 'confirmed' &&
          c.month <= asOfPeriod
      )
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));

    const confirmedTotalEtb = Math.max(
      confirmedInScheduleEtb,
      memberConfirmedContribs.reduce((sum, c) => sum + c.amount, 0)
    );
    const lastPaymentDate = memberConfirmedContribs[0]?.paymentDate;

    const statusAsOfPeriod = getMemberStatusForPeriod(member, asOfPeriod, statuses);
    const currentCommitmentEtb =
      statusAsOfPeriod === 'active'
        ? getMemberCommitmentForPeriod(member, asOfPeriod, commitments)
        : member.monthlyCommitment;

    const standing = arrearsEtb > 0 ? 'in_arrears' : 'up_to_date';
    const ratePercent =
      expectedTotalEtb > 0
        ? Math.min(100, Math.round((confirmedTotalEtb / expectedTotalEtb) * 10000) / 100)
        : null;

    return {
      member,
      statusAsOfPeriod,
      currentCommitmentEtb,
      monthsEvaluated,
      expectedTotalEtb,
      confirmedTotalEtb,
      arrearsEtb,
      overpaymentEtb,
      monthsInArrears,
      lastPaymentDate,
      standing,
      ratePercent,
    };
  });

  // Sort: in_arrears descending by arrearsEtb, then up_to_date by memberCode
  rows.sort((a, b) => {
    if (a.standing !== b.standing) {
      return a.standing === 'in_arrears' ? -1 : 1;
    }
    if (b.arrearsEtb !== a.arrearsEtb) {
      return b.arrearsEtb - a.arrearsEtb;
    }
    return a.member.memberCode.localeCompare(b.member.memberCode);
  });

  const upToDateCount = rows.filter((r) => r.standing === 'up_to_date').length;
  const inArrearsCount = rows.filter((r) => r.standing === 'in_arrears').length;
  const totalExpectedEtb = rows.reduce((s, r) => s + r.expectedTotalEtb, 0);
  const totalConfirmedEtb = rows.reduce((s, r) => s + r.confirmedTotalEtb, 0);
  const totalArrearsEtb = rows.reduce((s, r) => s + r.arrearsEtb, 0);
  const totalOverpaymentEtb = rows.reduce((s, r) => s + r.overpaymentEtb, 0);

  return {
    asOfPeriod,
    totalMembers: rows.length,
    upToDateCount,
    inArrearsCount,
    totalExpectedEtb,
    totalConfirmedEtb,
    totalArrearsEtb,
    totalOverpaymentEtb,
    rows,
  };
}
