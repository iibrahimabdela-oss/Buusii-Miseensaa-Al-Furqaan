import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Award,
  Cake,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Database,
  Edit2,
  ExternalLink,
  Percent,
  Search,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';
import { getContributionStatusLabel, t } from '../i18n.ts';
import { saveFinancialGoal } from '../services/firebase.ts';
import type {
  AuditLog,
  CalendarMode,
  CenterStats,
  CommitmentHistoryEntry,
  Contribution,
  FinancialGoal,
  GroundedSearchResult,
  Language,
  Member,
  PeriodClosure,
  PeriodSummaryMetrics,
  StatusHistoryEntry,
  TabKey,
  UserAccount,
} from '../types.ts';
import {
  ETHIOPIAN_MONTHS_OM,
  buildEthiopianMonthGrid,
  currentPeriodKey,
  formatDateByCalendar,
  formatEthiopianShort,
  formatPeriodLabel,
  isEthiopianLeapYear,
  toEthiopianDate,
} from '../utils/ethiopianCalendar.ts';
import {
  calculateMemberRowForPeriod,
  type AnnualMonthRow,
} from '../utils/financials.ts';

const ETHIOPIAN_CALENDAR_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;

function getTrailingPeriods(endPeriod: string, count = 6): string[] {
  const fallback = currentPeriodKey();
  const base = /^\d{4}-\d{2}$/.test(endPeriod) ? endPeriod : fallback;
  const [yrStr, moStr] = base.split('-');
  let year = Number(yrStr);
  let month = Number(moStr);

  const periods: string[] = [];
  for (let i = 0; i < count; i += 1) {
    periods.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return periods;
}

const FINANCIAL_ACTIVITY_ACTIONS = new Set([
  'RECORD_CONTRIBUTION',
  'CSV_IMPORT_CONTRIBUTIONS',
  'UPDATE_CONTRIBUTION_STATUS',
  'UPLOAD_PAYMENT_EVIDENCE',
  'CHANGE_MEMBER_STATUS',
  'CHANGE_COMMITMENT',
  'CLOSE_PERIOD',
  'REOPEN_PERIOD',
  'SET_FINANCIAL_GOAL',
]);

function parseAuditDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string' || typeof ts === 'number') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === 'object') {
    const maybe = ts as { toDate?: () => Date; seconds?: number };
    if (typeof maybe.toDate === 'function') return maybe.toDate();
    if (typeof maybe.seconds === 'number') return new Date(maybe.seconds * 1000);
  }
  return null;
}

function getAuditActionMeta(action: string, language: Language): {
  label: string;
  badgeClass: string;
} {
  switch (action) {
    case 'RECORD_CONTRIBUTION':
      return {
        label: language === 'om' ? 'Kaffaltii Galmaa’e' : 'Payment Recorded',
        badgeClass: 'bg-[#167C80]/15 text-[#167C80] dark:bg-teal-950/60 dark:text-teal-300',
      };
    case 'CSV_IMPORT_CONTRIBUTIONS':
      return {
        label: language === 'om' ? 'Buusii CSV Fe’ame' : 'CSV Batch Import',
        badgeClass: 'bg-[#167C80]/15 text-[#167C80] dark:bg-teal-950/60 dark:text-teal-300',
      };
    case 'UPDATE_CONTRIBUTION_STATUS':
      return {
        label: language === 'om' ? 'Haala Kaffaltii' : 'Payment Status Update',
        badgeClass: 'bg-[#17365D]/10 text-[#17365D] dark:bg-sky-950/60 dark:text-sky-300',
      };
    case 'UPLOAD_PAYMENT_EVIDENCE':
      return {
        label: language === 'om' ? 'Ragaa Kaffaltii' : 'Evidence Attached',
        badgeClass: 'bg-[#17365D]/10 text-[#17365D] dark:bg-sky-950/60 dark:text-sky-300',
      };
    case 'CHANGE_MEMBER_STATUS':
      return {
        label: language === 'om' ? 'Haala Miseensaa' : 'Member Status Update',
        badgeClass: 'bg-amber-500/15 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
      };
    case 'CHANGE_COMMITMENT':
      return {
        label: language === 'om' ? 'Jijjiirama Waadaa' : 'Commitment Update',
        badgeClass: 'bg-[#C69C3D]/20 text-[#8F6B1A] dark:bg-amber-950/60 dark:text-[#C69C3D]',
      };
    case 'CLOSE_PERIOD':
    case 'REOPEN_PERIOD':
      return {
        label:
          action === 'CLOSE_PERIOD'
            ? language === 'om'
              ? 'Ji’a Cufame'
              : 'Period Closed'
            : language === 'om'
            ? 'Ji’a Baname'
            : 'Period Reopened',
        badgeClass: 'bg-[#17365D] text-white',
      };
    case 'SET_FINANCIAL_GOAL':
      return {
        label: language === 'om' ? 'Galma Waggaa' : 'Annual Goal Set',
        badgeClass: 'bg-[#C69C3D]/20 text-[#8F6B1A] dark:bg-amber-950/60 dark:text-[#C69C3D]',
      };
    default:
      return {
        label: action.replace(/_/g, ' '),
        badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
  }
}

interface DashboardViewProps {
  language: Language;
  calendarMode: CalendarMode;
  selectedPeriod: string;
  account: UserAccount;
  members: Member[];
  commitmentByMember?: Record<string, CommitmentHistoryEntry[]>;
  statusByMember?: Record<string, StatusHistoryEntry[]>;
  periodSummary: PeriodSummaryMetrics;
  annualBreakdown: AnnualMonthRow[];
  contributions: Contribution[];
  auditLogs?: AuditLog[];
  centerStats: CenterStats | null;
  closures?: PeriodClosure[];
  financialGoal?: FinancialGoal | null;
  hasMembers: boolean;
  onSeedSampleData: () => Promise<void>;
  seeding: boolean;
  onNavigate: (tab: TabKey) => void;
  onSelectPeriod?: (periodKey: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  language,
  calendarMode,
  selectedPeriod,
  account,
  members,
  commitmentByMember = {},
  statusByMember = {},
  periodSummary,
  annualBreakdown,
  contributions,
  auditLogs = [],
  centerStats,
  closures = [],
  financialGoal = null,
  hasMembers,
  onSeedSampleData,
  seeding,
  onNavigate,
  onSelectPeriod,
}) => {
  const isOwnerOrAdmin = account.role === 'owner' || account.role === 'admin';
  const isCashierOrAbove = isOwnerOrAdmin || account.role === 'cashier';
  const isViewer = account.role === 'viewer';
  const isMemberOnly = account.role === 'member';

  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<GroundedSearchResult | null>(null);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todayEc = useMemo(() => toEthiopianDate(todayIso), [todayIso]);

  const [calYear, setCalYear] = useState<number>(() => {
    const y = todayEc?.year ?? 2019;
    return y >= 2019 && y <= 2025 ? y : 2019;
  });
  const [calMonth, setCalMonth] = useState<number>(() => todayEc?.month ?? 3);
  const [selectedCellIso, setSelectedCellIso] = useState<string>(() => todayIso);
  const [copiedMemberId, setCopiedMemberId] = useState<string | null>(null);

  // Financial Goals Editor State
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalAmountInput, setGoalAmountInput] = useState('');
  const [goalNoteInput, setGoalNoteInput] = useState('');
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);

  const calendarYears = useMemo(() => {
    const set = new Set<number>(ETHIOPIAN_CALENDAR_YEARS);
    if (todayEc?.year) set.add(todayEc.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [todayEc]);

  const calendarCells = useMemo(
    () => buildEthiopianMonthGrid(calYear, calMonth),
    [calYear, calMonth]
  );

  const selectedCellEc = useMemo(
    () => toEthiopianDate(selectedCellIso),
    [selectedCellIso]
  );

  const birthdayDaysInViewedEcMonth = useMemo(() => {
    if (isViewer) return new Set<number>();
    const days = new Set<number>();
    for (const m of members) {
      if (!m.birthDate) continue;
      const ec = toEthiopianDate(m.birthDate);
      if (ec && ec.month === calMonth) {
        days.add(ec.day);
      }
    }
    return days;
  }, [isViewer, members, calMonth]);

  const birthdayMatches = useMemo(() => {
    if (isViewer) return [];
    const currentGcMonth = Number(todayIso.slice(5, 7));
    const currentEcMonth = todayEc?.month ?? 3;

    return members
      .filter((m) => Boolean(m.birthDate))
      .map((m) => {
        const birthDate = m.birthDate as string;
        const birthEc = toEthiopianDate(birthDate);
        const birthGcMonth = Number(birthDate.slice(5, 7));
        const birthGcDay = Number(birthDate.slice(8, 10));
        const sortDay =
          calendarMode === 'gregorian' ? birthGcDay : (birthEc?.day ?? birthGcDay);

        return {
          member: m,
          birthDate,
          birthEc,
          birthGcMonth,
          sortDay,
        };
      })
      .filter((entry) => {
        const matchesEc = Boolean(entry.birthEc && entry.birthEc.month === currentEcMonth);
        const matchesGc = entry.birthGcMonth === currentGcMonth;
        if (calendarMode === 'ethiopian') return matchesEc;
        if (calendarMode === 'gregorian') return matchesGc;
        return matchesEc || matchesGc;
      })
      .sort((a, b) => a.sortDay - b.sortDay);
  }, [isViewer, members, todayIso, todayEc, calendarMode]);

  const handleStepCalendarMonth = (delta: -1 | 1) => {
    const minYear = calendarYears[0];
    const maxYear = calendarYears[calendarYears.length - 1];
    if (delta === -1) {
      if (calMonth > 1) {
        setCalMonth((m) => m - 1);
      } else if (calYear > minYear) {
        setCalYear((y) => y - 1);
        setCalMonth(13);
      }
    } else {
      if (calMonth < 13) {
        setCalMonth((m) => m + 1);
      } else if (calYear < maxYear) {
        setCalYear((y) => y + 1);
        setCalMonth(1);
      }
    }
  };

  const handleResetCalendarToday = () => {
    if (todayEc) {
      setCalYear(todayEc.year);
      setCalMonth(todayEc.month);
    }
    setSelectedCellIso(todayIso);
  };

  const handleCopyBirthdayGreeting = async (member: Member) => {
    const msg =
      language === 'om'
        ? `Assalaamu Alaikum ${member.fullName}, Markaz Al-Furqaan guyyaa dhaloota keessan baga geessan jedha! Tajaajila fi deeggarsa keessaniif galatoomaa — Baarakallaahu fiikum.`
        : `Assalamu Alaikum ${member.fullName}, warm birthday appreciation from Al-Furqaan Qur'an Memorization Center! Thank you for your continued commitment and support — Barakallahu feekum.`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedMemberId(member.id);
      setTimeout(() => {
        setCopiedMemberId((prev) => (prev === member.id ? null : prev));
      }, 2000);
    } catch {
      setCopiedMemberId(null);
    }
  };

  const displayMetrics = useMemo(() => {
    if (isViewer) {
      const closure = closures.find((c) => c.periodKey === selectedPeriod);
      if (closure) {
        const rate =
          closure.expectedEtb > 0
            ? Math.round((closure.collectedEtb / closure.expectedEtb) * 1000) / 10
            : null;
        return {
          activeMembersCount: centerStats?.activeMembersCount ?? 0,
          totalMembersCount: centerStats?.totalMembersCount ?? 0,
          expectedEtb: closure.expectedEtb,
          collectedEtb: closure.collectedEtb,
          outstandingEtb: closure.outstandingEtb,
          overpaymentEtb: Math.max(0, closure.collectedEtb - closure.expectedEtb),
          ratePercent: rate,
          overdueMembersCount: 0,
          overdueAmountEtb: 0,
        };
      }
    }

    if ((isMemberOnly || isViewer) && centerStats) {
      const rate =
        centerStats.expectedMonthlyEtb > 0
          ? Math.round(
              (centerStats.totalCollectedEtb / centerStats.expectedMonthlyEtb) * 1000
            ) / 10
          : null;
      return {
        activeMembersCount: centerStats.activeMembersCount,
        totalMembersCount: centerStats.totalMembersCount,
        expectedEtb: centerStats.expectedMonthlyEtb,
        collectedEtb: centerStats.totalCollectedEtb,
        outstandingEtb: Math.max(
          0,
          centerStats.expectedMonthlyEtb - centerStats.totalCollectedEtb
        ),
        overpaymentEtb: 0,
        ratePercent: rate,
        overdueMembersCount: 0,
        overdueAmountEtb: 0,
      };
    }

    return {
      activeMembersCount: periodSummary.activeMembersCount,
      totalMembersCount: periodSummary.rows.length,
      expectedEtb: periodSummary.expectedEtb,
      collectedEtb: periodSummary.collectedEtb,
      outstandingEtb: periodSummary.outstandingEtb,
      overpaymentEtb: periodSummary.overpaymentEtb,
      ratePercent: periodSummary.collectionRatePercent,
      overdueMembersCount: periodSummary.overdueMembersCount,
      overdueAmountEtb: periodSummary.overdueAmountEtb,
    };
  }, [isMemberOnly, isViewer, closures, selectedPeriod, centerStats, periodSummary]);

  const maxChartVal = useMemo(() => {
    return Math.max(
      1,
      ...annualBreakdown.map((d) => Math.max(d.expectedEtb, d.collectedEtb))
    );
  }, [annualBreakdown]);

  const activeYear = /^\d{4}/.test(selectedPeriod)
    ? selectedPeriod.slice(0, 4)
    : String(new Date().getFullYear());

  const financialGoalMetrics = useMemo(() => {
    const suggestedExpectedEtb = annualBreakdown.reduce((s, r) => s + r.expectedEtb, 0);
    let collectedToDateEtb = 0;

    if (isViewer) {
      const yearClosures = closures.filter((c) => c.periodKey.startsWith(`${activeYear}-`));
      collectedToDateEtb =
        yearClosures.length > 0
          ? yearClosures.reduce((s, c) => s + c.collectedEtb, 0)
          : centerStats?.totalCollectedEtb ?? 0;
    } else if (isMemberOnly) {
      collectedToDateEtb = centerStats?.totalCollectedEtb ?? 0;
    } else {
      collectedToDateEtb = annualBreakdown.reduce((s, r) => s + r.collectedEtb, 0);
    }

    const targetEtb = financialGoal?.targetEtb ?? 0;
    const rawPercent =
      targetEtb > 0 ? Math.round((collectedToDateEtb / targetEtb) * 1000) / 10 : 0;
    const barPercent = Math.min(100, Math.max(0, rawPercent));
    const remainingEtb = targetEtb > 0 ? Math.max(0, targetEtb - collectedToDateEtb) : 0;
    const surplusEtb = targetEtb > 0 ? Math.max(0, collectedToDateEtb - targetEtb) : 0;

    return {
      suggestedExpectedEtb,
      collectedToDateEtb,
      targetEtb,
      rawPercent,
      barPercent,
      remainingEtb,
      surplusEtb,
      hasTarget: targetEtb > 0,
    };
  }, [
    annualBreakdown,
    isViewer,
    isMemberOnly,
    closures,
    activeYear,
    centerStats,
    financialGoal,
  ]);

  const trailingSixPeriods = useMemo(
    () => getTrailingPeriods(selectedPeriod, 6),
    [selectedPeriod]
  );

  const topContributorsLeaderboard = useMemo(() => {
    if (!isCashierOrAbove) {
      return {
        entries: [],
        fullSixMonthCount: 0,
        windowStart: trailingSixPeriods[0],
        windowEnd: trailingSixPeriods[trailingSixPeriods.length - 1],
      };
    }

    const candidates = members
      .map((member) => {
        const commitments = commitmentByMember[member.id] || [];
        const statuses = statusByMember[member.id] || [];

        let activeMonthsCount = 0;
        let monthsMet = 0;
        let expected6m = 0;
        let totalConfirmed6m = 0;

        const monthTimeline = trailingSixPeriods.map((periodKey) => {
          const row = calculateMemberRowForPeriod(
            member,
            periodKey,
            commitments,
            statuses,
            contributions
          );
          totalConfirmed6m += row.collectedEtb;

          if (row.statusInPeriod === 'active' && row.expectedEtb > 0) {
            activeMonthsCount += 1;
            expected6m += row.expectedEtb;
            const met = row.outstandingEtb === 0;
            if (met) monthsMet += 1;
            return {
              periodKey,
              state: met ? ('met' as const) : ('missed' as const),
              expectedEtb: row.expectedEtb,
              collectedEtb: row.collectedEtb,
            };
          }

          return {
            periodKey,
            state: row.collectedEtb > 0 ? ('met' as const) : ('inactive' as const),
            expectedEtb: row.expectedEtb,
            collectedEtb: row.collectedEtb,
          };
        });

        const isConsistentAllActive =
          activeMonthsCount > 0 && monthsMet === activeMonthsCount;
        const isFullSixMonthStreak = activeMonthsCount === 6 && monthsMet === 6;
        const consistencyPct =
          activeMonthsCount > 0
            ? Math.round((monthsMet / activeMonthsCount) * 1000) / 10
            : 0;

        return {
          member,
          activeMonthsCount,
          monthsMet,
          expected6m,
          totalConfirmed6m,
          isConsistentAllActive,
          isFullSixMonthStreak,
          consistencyPct,
          monthTimeline,
        };
      })
      .filter((item) => item.isConsistentAllActive);

    candidates.sort((a, b) => {
      if (a.isFullSixMonthStreak !== b.isFullSixMonthStreak) {
        return a.isFullSixMonthStreak ? -1 : 1;
      }
      if (b.monthsMet !== a.monthsMet) {
        return b.monthsMet - a.monthsMet;
      }
      if (b.totalConfirmed6m !== a.totalConfirmed6m) {
        return b.totalConfirmed6m - a.totalConfirmed6m;
      }
      return a.member.memberCode.localeCompare(b.member.memberCode);
    });

    return {
      entries: candidates.slice(0, 8),
      totalConsistent: candidates.length,
      fullSixMonthCount: candidates.filter((c) => c.isFullSixMonthStreak).length,
      windowStart: trailingSixPeriods[0],
      windowEnd: trailingSixPeriods[trailingSixPeriods.length - 1],
    };
  }, [
    isCashierOrAbove,
    members,
    commitmentByMember,
    statusByMember,
    contributions,
    trailingSixPeriods,
  ]);

  const recentFinancialActivity = useMemo(() => {
    if (!isCashierOrAbove) return [];
    return auditLogs
      .filter((log) => FINANCIAL_ACTIVITY_ACTIONS.has(log.action))
      .slice(0, 5)
      .map((log) => {
        const dt = parseAuditDate(log.createdAt);
        const meta = getAuditActionMeta(log.action, language);
        return {
          log,
          meta,
          dateObj: dt,
        };
      });
  }, [isCashierOrAbove, auditLogs, language]);

  const openGoalEditor = () => {
    const initialVal =
      financialGoal?.targetEtb ||
      financialGoalMetrics.suggestedExpectedEtb ||
      120000;
    setGoalAmountInput(String(initialVal));
    setGoalNoteInput(financialGoal?.notes || '');
    setGoalError(null);
    setEditingGoal(true);
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwnerOrAdmin) return;
    const numericTarget = Number(goalAmountInput);
    if (!Number.isFinite(numericTarget) || numericTarget <= 0) {
      setGoalError(
        language === 'om'
          ? 'Galmi waggaa (ETB) zeeroo ol ta’uu qaba.'
          : 'Annual target (ETB) must be greater than zero.'
      );
      return;
    }
    setGoalSaving(true);
    setGoalError(null);
    try {
      await saveFinancialGoal(
        account,
        activeYear,
        numericTarget,
        goalNoteInput.trim() || undefined
      );
      setEditingGoal(false);
    } catch (err) {
      setGoalError(
        err instanceof Error ? err.message : 'Unable to save annual financial goal.'
      );
    } finally {
      setGoalSaving(false);
    }
  };

  const handleGroundedSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch('/api/gemini/grounded-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setSearchResult(data as GroundedSearchResult);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Unable to complete grounded search.'
      );
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {isMemberOnly && (
        <div className="rounded-xl border border-[#C8D6E5] bg-[#EAF1F7] px-4 py-3 text-xs text-[#17365D] dark:border-slate-700 dark:bg-[#121D2B] dark:text-sky-200">
          {t(language, 'restrictedMemberBanner')}
        </div>
      )}

      {isViewer && (
        <div className="rounded-xl border border-[#C8D6E5] bg-[#EAF1F7] px-4 py-3 text-xs text-[#17365D] dark:border-slate-700 dark:bg-[#121D2B] dark:text-sky-200">
          {t(language, 'viewerPrivacyBanner')}
        </div>
      )}

      {isOwnerOrAdmin && !hasMembers && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
              {language === 'om'
                ? 'Galmeen miseensotaa duwwaa dha'
                : 'No member or contribution records yet'}
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {language === 'om'
                ? 'Sirna buusii V2.0 qorachuuf daataa fakkeenyaa (miseensota 4, seenaa waadaa, fi kaffaltii ETB 4) fe’uu dandeessa.'
                : 'Load the V2.0 sample dataset (4 members, commitment history, 4 ETB payments) to verify calculations, or add your first member.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onSeedSampleData}
            disabled={seeding}
            className="inline-flex items-center gap-2 rounded-lg bg-[#17365D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-60"
          >
            <Database className="h-3.5 w-3.5" />
            <span>{seeding ? 'Fe’amaa jira...' : t(language, 'seedSampleData')}</span>
          </button>
        </div>
      )}

      {/* Selected Period Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#C8D6E5] bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-[#121D2B]">
        <div className="text-xs">
          <span className="font-medium text-slate-500 dark:text-slate-400">
            {t(language, 'periodLabel')}:
          </span>{' '}
          <strong className="font-mono-num text-[#17365D] dark:text-sky-300">
            {formatPeriodLabel(selectedPeriod, calendarMode, language)}
          </strong>
        </div>
        {isCashierOrAbove && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('contributions')}
              className="rounded-lg bg-[#17365D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E477A]"
            >
              {t(language, 'recordContribution')}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {t(language, 'navReports')}
            </button>
          </div>
        )}
      </div>

      {/* 6 KPI Summary Cards (Strictly Contributions — No Expenses) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-4 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{t(language, 'activeMembers')}</span>
            <Users className="h-4 w-4 text-[#17365D] dark:text-sky-400" />
          </div>
          <div className="font-mono-num mt-2 text-2xl font-bold text-[#17365D] dark:text-white">
            {displayMetrics.activeMembersCount}
            <span className="ml-1 text-xs font-normal text-slate-500">
              / {displayMetrics.totalMembersCount}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {language === 'om' ? 'Hojii irra jiran' : 'Active in period'}
          </div>
        </div>

        <div className="rounded-xl border border-[#C8D6E5] bg-white p-4 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{t(language, 'expectedContribution')}</span>
            <TrendingUp className="h-4 w-4 text-[#17365D] dark:text-sky-400" />
          </div>
          <div className="font-mono-num mt-2 text-xl font-bold text-[#202833] dark:text-white">
            {displayMetrics.expectedEtb.toLocaleString()}{' '}
            <span className="text-xs font-medium text-slate-500">ETB</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {language === 'om' ? 'Waadaa ji’aa' : 'Period commitment'}
          </div>
        </div>

        <div className="rounded-xl border border-[#C8D6E5] bg-white p-4 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{t(language, 'collectedTotal')}</span>
            <CheckCircle2 className="h-4 w-4 text-[#167C80] dark:text-teal-400" />
          </div>
          <div className="font-mono-num mt-2 text-xl font-bold text-[#167C80] dark:text-teal-400">
            {displayMetrics.collectedEtb.toLocaleString()}{' '}
            <span className="text-xs font-medium text-slate-500">ETB</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {language === 'om' ? 'Confirmed qofa' : 'Confirmed payments only'}
          </div>
        </div>

        <div className="rounded-xl border border-[#C8D6E5] bg-white p-4 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{t(language, 'outstandingTotal')}</span>
            <Clock className="h-4 w-4 text-[#C69C3D]" />
          </div>
          <div className="font-mono-num mt-2 text-xl font-bold text-[#202833] dark:text-white">
            {displayMetrics.outstandingEtb.toLocaleString()}{' '}
            <span className="text-xs font-medium text-slate-500">ETB</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {language === 'om' ? 'Waadaa − Mirkanaa’e' : 'Remaining balance'}
          </div>
        </div>

        <div className="rounded-xl border border-[#C8D6E5] bg-white p-4 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{t(language, 'collectionRate')}</span>
            <Percent className="h-4 w-4 text-[#167C80]" />
          </div>
          <div className="font-mono-num mt-2 text-2xl font-bold text-[#17365D] dark:text-sky-300">
            {displayMetrics.ratePercent !== null
              ? `${displayMetrics.ratePercent.toFixed(1)}%`
              : 'N/A'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {language === 'om' ? 'Kaffaltii ÷ Waadaa' : 'Collected / Expected'}
          </div>
        </div>

        <div className="rounded-xl border border-[#C8D6E5] bg-[#EAF1F7] p-4 dark:border-slate-800 dark:bg-[#162333]">
          <div className="flex items-center justify-between text-xs font-medium text-[#17365D] dark:text-slate-300">
            <span>{t(language, 'overpaymentTotal')}</span>
            <AlertCircle className="h-4 w-4 text-[#C69C3D]" />
          </div>
          <div className="font-mono-num mt-2 text-xl font-bold text-[#17365D] dark:text-[#C69C3D]">
            {displayMetrics.overpaymentEtb.toLocaleString()}{' '}
            <span className="text-xs font-medium">ETB</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
            {displayMetrics.overdueMembersCount > 0
              ? `${t(language, 'overdueAlert')}: ${displayMetrics.overdueMembersCount} (${displayMetrics.overdueAmountEtb.toLocaleString()} ETB)`
              : language === 'om'
              ? 'Gara ji’a biraatti hin darbu'
              : 'Kept separate (BR-07)'}
          </div>
        </div>
      </div>

      {/* Financial Goals — Annual Contribution Target & Progress Tracker */}
      <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[#C69C3D]" />
            <div>
              <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                {language === 'om'
                  ? `Galma Maallaqaa Waggaa (${activeYear})`
                  : `Financial Goals — ${activeYear} Annual Contribution Target`}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {financialGoal?.notes
                  ? financialGoal.notes
                  : language === 'om'
                  ? 'Hordoffii galma walitti qabama buusii waggaa mirkanaa’ee (ETB)'
                  : 'Tracks confirmed member contributions collected toward the annual target (ETB)'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {financialGoal?.updatedByName && (
              <span className="text-[11px] text-slate-400">
                {language === 'om' ? 'Kan qopheesse:' : 'Set by:'}{' '}
                {financialGoal.updatedByName}
              </span>
            )}
            {isOwnerOrAdmin && !editingGoal && (
              <button
                type="button"
                onClick={openGoalEditor}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300"
              >
                <Edit2 className="h-3.5 w-3.5 text-[#167C80]" />
                <span>
                  {financialGoalMetrics.hasTarget
                    ? language === 'om'
                      ? 'Galma Jijjiiri'
                      : 'Edit Annual Target'
                    : language === 'om'
                    ? 'Galma Waggaa Kaa’i'
                    : 'Set Annual Target'}
                </span>
              </button>
            )}
          </div>
        </div>

        {editingGoal && isOwnerOrAdmin && (
          <form
            onSubmit={handleSaveGoal}
            className="mt-4 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-4 text-xs dark:border-slate-700 dark:bg-slate-900/50"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                  {language === 'om'
                    ? `Galma Waggaa ${activeYear} (ETB) *`
                    : `${activeYear} Annual Target (ETB) *`}
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  step="1"
                  value={goalAmountInput}
                  onChange={(e) => setGoalAmountInput(e.target.value)}
                  className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 font-semibold text-[#17365D] outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                {financialGoalMetrics.suggestedExpectedEtb > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setGoalAmountInput(String(financialGoalMetrics.suggestedExpectedEtb))
                    }
                    className="mt-1 text-[11px] font-medium text-[#167C80] hover:underline"
                  >
                    {language === 'om'
                      ? `Waadaa waggaa fayyadami: ${financialGoalMetrics.suggestedExpectedEtb.toLocaleString()} ETB`
                      : `Use annual commitments: ${financialGoalMetrics.suggestedExpectedEtb.toLocaleString()} ETB`}
                  </button>
                )}
              </div>

              <div className="sm:col-span-5">
                <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                  {language === 'om' ? 'Ibsa Galmaa (Filannoo)' : 'Goal Note / Purpose (Optional)'}
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={goalNoteInput}
                  onChange={(e) => setGoalNoteInput(e.target.value)}
                  placeholder={
                    language === 'om'
                      ? 'Fkn: Deeggarsa barattoota Hifzii fi ijaarsa Markazaa...'
                      : 'e.g., Hifz student sponsorships & center operations...'
                  }
                  className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-end gap-2 sm:col-span-3">
                <button
                  type="submit"
                  disabled={goalSaving}
                  className="flex-1 rounded-lg bg-[#17365D] px-3 py-2 font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
                >
                  {goalSaving ? '...' : t(language, 'save')}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingGoal(false)}
                  className="rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 font-medium text-slate-600 hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  {t(language, 'cancel')}
                </button>
              </div>
            </div>
            {goalError && (
              <div className="mt-2 text-red-600 dark:text-red-400">{goalError}</div>
            )}
          </form>
        )}

        {!financialGoalMetrics.hasTarget ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[#C8D6E5] bg-[#F3F7FA]/70 px-4 py-4 text-xs dark:border-slate-700 dark:bg-slate-900/30">
            <div>
              <div className="font-semibold text-[#17365D] dark:text-white">
                {language === 'om'
                  ? `Galmi maallaqaa waggaa ${activeYear} ammallee hin kaa’amne.`
                  : `No annual contribution target has been set for ${activeYear} yet.`}
              </div>
              <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                {language === 'om'
                  ? `Hanga har’aatti walitti qabame: ${financialGoalMetrics.collectedToDateEtb.toLocaleString()} ETB`
                  : `Confirmed collected to date in ${activeYear}: ${financialGoalMetrics.collectedToDateEtb.toLocaleString()} ETB`}
              </div>
            </div>
            {isOwnerOrAdmin && !editingGoal && (
              <button
                type="button"
                onClick={openGoalEditor}
                className="rounded-lg bg-[#17365D] px-3.5 py-2 font-semibold text-white hover:bg-[#1E477A]"
              >
                {language === 'om' ? 'Galma Kaa’i' : 'Set Annual Target'}
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {/* Progress Header & Percentage */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono-num text-xl font-bold text-[#167C80] dark:text-teal-400">
                  {financialGoalMetrics.collectedToDateEtb.toLocaleString()} ETB
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {language === 'om' ? 'galma keessaa:' : 'met of'}{' '}
                  <strong className="font-mono-num text-[#17365D] dark:text-white">
                    {financialGoalMetrics.targetEtb.toLocaleString()} ETB
                  </strong>
                </span>
              </div>
              <div className="font-mono-num text-sm font-bold text-[#17365D] dark:text-sky-300">
                {financialGoalMetrics.rawPercent.toFixed(1)}%
              </div>
            </div>

            {/* Progress Bar with 25% / 50% / 75% Milestone Guides */}
            <div className="relative h-4 w-full overflow-hidden rounded-full bg-[#EAF1F7] dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  financialGoalMetrics.rawPercent >= 100
                    ? 'bg-[#C69C3D]'
                    : 'bg-gradient-to-r from-[#17365D] to-[#167C80]'
                }`}
                style={{ width: `${financialGoalMetrics.barPercent}%` }}
                role="progressbar"
                aria-valuenow={Math.round(financialGoalMetrics.rawPercent)}
                aria-valuemin={0}
                aria-valuemax={100}
              />
              <div className="pointer-events-none absolute inset-y-0 left-1/4 w-px bg-white/50 dark:bg-slate-900/40" />
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/50 dark:bg-slate-900/40" />
              <div className="pointer-events-none absolute inset-y-0 left-3/4 w-px bg-white/50 dark:bg-slate-900/40" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-4">
                <span>
                  {language === 'om' ? 'Hanga ammaatti:' : 'Met to date:'}{' '}
                  <strong className="font-mono-num text-[#167C80] dark:text-teal-400">
                    {financialGoalMetrics.rawPercent.toFixed(1)}%
                  </strong>
                </span>
                {financialGoalMetrics.surplusEtb > 0 ? (
                  <span className="font-semibold text-[#C69C3D]">
                    {language === 'om'
                      ? `Galma ol (${financialGoalMetrics.surplusEtb.toLocaleString()} ETB dabalataa)!`
                      : `Target exceeded by ${financialGoalMetrics.surplusEtb.toLocaleString()} ETB!`}
                  </span>
                ) : (
                  <span>
                    {language === 'om' ? 'Haftee galmaa:' : 'Remaining to target:'}{' '}
                    <strong className="font-mono-num text-[#17365D] dark:text-slate-200">
                      {financialGoalMetrics.remainingEtb.toLocaleString()} ETB
                    </strong>
                  </span>
                )}
              </div>
              <div className="font-mono-num text-slate-400">
                0% · 25% · 50% · 75% · 100%
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top Contributors Leaderboard — 6-Month Commitment Consistency (Cashier/Admin/Owner only per REP-04) */}
      {isCashierOrAbove && (
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-[#C69C3D]" />
              <div>
                <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                  {language === 'om'
                    ? 'Buustota Ciccimoo — Dorgommii fi Beekamtii (Ji’oota 6)'
                    : 'Top Contributors Leaderboard (Last 6 Months)'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {language === 'om'
                    ? `Miseensota waadaa ji’aa walitti fufiinsaan guutan (${topContributorsLeaderboard.windowStart} → ${topContributorsLeaderboard.windowEnd})`
                    : `Members who consistently met 100% of their active commitments (${topContributorsLeaderboard.windowStart} → ${topContributorsLeaderboard.windowEnd})`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-num rounded-md bg-[#EAF1F7] px-2.5 py-1 text-[11px] font-semibold text-[#17365D] dark:bg-slate-800 dark:text-sky-300">
                {topContributorsLeaderboard.fullSixMonthCount}{' '}
                {language === 'om' ? '6/6 Guutuu' : 'with 6/6 streak'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('members')}
                className="text-xs font-semibold text-[#167C80] hover:underline dark:text-teal-400"
              >
                {language === 'om' ? 'Miseensota ilaali →' : 'View Members →'}
              </button>
            </div>
          </div>

          {topContributorsLeaderboard.entries.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-[#C8D6E5] bg-[#F3F7FA]/70 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
              {language === 'om'
                ? `Ji’oota 6 darban (${topContributorsLeaderboard.windowStart} → ${topContributorsLeaderboard.windowEnd}) keessatti miseensi waadaa isaa guutummaatti guute ammallee hin argamne.`
                : `No members have completed a 100% commitment streak across ${topContributorsLeaderboard.windowStart} → ${topContributorsLeaderboard.windowEnd} yet.`}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {topContributorsLeaderboard.entries.map((entry, idx) => {
                const rank = idx + 1;
                const rankBadgeClass =
                  rank === 1
                    ? 'bg-[#C69C3D] text-white'
                    : rank === 2
                    ? 'bg-[#167C80] text-white'
                    : rank === 3
                    ? 'bg-[#17365D] text-white'
                    : 'bg-[#EAF1F7] text-[#17365D] dark:bg-slate-800 dark:text-slate-300';

                return (
                  <div
                    key={entry.member.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#C8D6E5]/80 bg-[#F3F7FA]/70 p-3.5 transition-colors hover:bg-[#EAF1F7]/70 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:bg-slate-800/60"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`font-mono-num flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${rankBadgeClass}`}
                      >
                        #{rank}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-bold text-[#17365D] dark:text-white">
                            {entry.member.fullName}
                          </span>
                          {entry.isFullSixMonthStreak && (
                            <Award
                              className="h-3.5 w-3.5 shrink-0 text-[#C69C3D]"
                              aria-label="Full 6-month streak"
                            />
                          )}
                        </div>
                        <div className="font-mono-num mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {entry.member.memberCode} · {entry.member.category.toUpperCase()}
                        </div>

                        {/* 6-Month Visual Streak Dots */}
                        <div className="mt-2 flex items-center gap-1">
                          {entry.monthTimeline.map((pt) => (
                            <div
                              key={pt.periodKey}
                              title={`${pt.periodKey}: ${
                                pt.state === 'met'
                                  ? `${language === 'om' ? 'Guutame' : 'Met'} (${pt.collectedEtb.toLocaleString()} ETB)`
                                  : pt.state === 'missed'
                                  ? `${language === 'om' ? 'Haftee' : 'Short'} (${pt.collectedEtb.toLocaleString()}/${pt.expectedEtb.toLocaleString()} ETB)`
                                  : language === 'om'
                                  ? 'Hojii irra hin turre'
                                  : 'Inactive / Not joined'
                              }`}
                              className={`h-2 w-5 rounded-sm ${
                                pt.state === 'met'
                                  ? 'bg-[#167C80] dark:bg-teal-400'
                                  : pt.state === 'missed'
                                  ? 'bg-red-500'
                                  : 'bg-slate-300 dark:bg-slate-700'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="font-mono-num text-xs font-bold text-[#167C80] dark:text-teal-400">
                        {entry.totalConfirmed6m.toLocaleString()} ETB
                      </div>
                      <div className="font-mono-num mt-0.5 text-[11px] font-semibold text-[#17365D] dark:text-sky-300">
                        {entry.monthsMet}/{entry.activeMonthsCount}{' '}
                        {language === 'om' ? 'Ji’a (100%)' : 'Mo (100%)'}
                      </div>
                      <div className="mt-0.5 text-[10px] font-medium text-[#C69C3D]">
                        {entry.isFullSixMonthStreak
                          ? language === 'om'
                            ? 'Walitti fufiinsa 6/6'
                            : '6/6 Full Streak'
                          : language === 'om'
                          ? 'Yeroo hunda eeggate'
                          : 'Consistent Active'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Split: Expected vs. Collected Trend Chart + Payment Method Mix & Search */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Monthly Expected vs Collected Trend Chart */}
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                {language === 'om'
                  ? `Tarsiimoo Waggaa (${selectedPeriod.slice(0, 4)}): Waadaa fi Mirkanaa’e`
                  : `${selectedPeriod.slice(0, 4)} Monthly Trend: Expected vs. Confirmed`}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {language === 'om'
                  ? 'Seenaa waadaa yeroo sanaa irratti hundaa’e (ETB)'
                  : 'Effective-dated obligation vs. confirmed contributions (ETB)'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-semibold text-[#167C80] hover:underline dark:text-teal-400"
            >
              {language === 'om' ? 'Gabaasa guutuu →' : 'Full Report →'}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {annualBreakdown
              .filter((r) => r.expectedEtb > 0 || r.collectedEtb > 0 || r.periodKey === selectedPeriod)
              .slice(-6)
              .map((row) => {
                const expPct = Math.round((row.expectedEtb / maxChartVal) * 100);
                const colPct = Math.round((row.collectedEtb / maxChartVal) * 100);
                return (
                  <div key={row.periodKey} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono-num font-semibold text-[#17365D] dark:text-slate-200">
                        {row.periodKey}
                      </span>
                      <span className="font-mono-num text-slate-600 dark:text-slate-400">
                        {language === 'om' ? 'Waadaa' : 'Exp'}: {row.expectedEtb.toLocaleString()} ·{' '}
                        {language === 'om' ? 'Mirkanaa’e' : 'Col'}:{' '}
                        <strong className="text-[#167C80] dark:text-teal-400">
                          {row.collectedEtb.toLocaleString()} ETB
                        </strong>
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#EAF1F7] dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-[#17365D] dark:bg-sky-500"
                          style={{ width: `${Math.max(expPct, row.expectedEtb > 0 ? 3 : 0)}%` }}
                        />
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#EAF1F7] dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-[#167C80] dark:bg-teal-400"
                          style={{ width: `${Math.max(colPct, row.collectedEtb > 0 ? 3 : 0)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

            {annualBreakdown.every((r) => r.expectedEtb === 0 && r.collectedEtb === 0) && (
              <div className="flex h-36 items-center justify-center text-xs text-slate-500">
                {language === 'om'
                  ? 'Daataan ji’aa hin argamne.'
                  : 'No monthly commitments or contributions recorded for this year.'}
              </div>
            )}

            <div className="flex items-center gap-6 pt-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#17365D] dark:bg-sky-500" />
                {t(language, 'expectedContribution')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#167C80] dark:bg-teal-400" />
                {t(language, 'collectedTotal')}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Payment Method Mix + Grounded Search */}
        <div className="space-y-6 lg:col-span-5">
          {/* Payment Method Mix */}
          <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-[#167C80]" />
                <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                  {language === 'om'
                    ? 'Qoodinsa Mala Kaffaltii (Confirmed)'
                    : 'Payment Method Mix (Confirmed)'}
                </h3>
              </div>
              <span className="font-mono-num text-xs text-slate-500">{selectedPeriod}</span>
            </div>

            {periodSummary.methodMix.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                {language === 'om'
                  ? 'Ji’a kana keessa kaffaltiin mirkanaa’e hin jiru.'
                  : 'No confirmed payments in the selected period.'}
              </div>
            ) : (
              <div className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {periodSummary.methodMix.map((item) => {
                  const pct =
                    periodSummary.collectedEtb > 0
                      ? Math.round((item.totalEtb / periodSummary.collectedEtb) * 100)
                      : 0;
                  return (
                    <div key={item.method} className="flex items-center justify-between py-2">
                      <div>
                        <span className="font-semibold uppercase text-[#17365D] dark:text-slate-200">
                          {item.method.replace('_', ' ')}
                        </span>
                        <span className="ml-2 text-[11px] text-slate-500">
                          ({item.count} {language === 'om' ? 'nagahee' : 'txns'})
                        </span>
                      </div>
                      <div className="font-mono-num font-semibold text-[#202833] dark:text-white">
                        {item.totalEtb.toLocaleString()} ETB{' '}
                        <span className="text-[11px] font-normal text-[#167C80]">({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Grounded Google Search Assistant */}
          <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
            <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
              {language === 'om'
                ? 'Barbaacha Qabatamaa (Google Search)'
                : 'Ethiopian Banking & Center Info Search'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {language === 'om'
                ? 'Daangaa baankii (CBE/Telebirr/Coop) ykn seera dhaabbataa barbaadi.'
                : 'Verify CBE, Telebirr, or Coop Bank limits via live Google Search.'}
            </p>

            <form onSubmit={handleGroundedSearch} className="mt-3 flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  language === 'om'
                    ? 'Fkn: Telebirr daily transfer limit Ethiopia...'
                    : 'e.g., CBE / Telebirr transfer limits...'
                }
                className="w-full rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-xs text-[#202833] outline-none focus:border-[#17365D] focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              <button
                type="submit"
                disabled={searchLoading || !searchQuery.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#17365D] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
              >
                <Search className="h-3.5 w-3.5" />
                <span>{searchLoading ? '...' : 'Search'}</span>
              </button>
            </form>

            {searchError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                {searchError}
              </div>
            )}

            {searchResult && (
              <div className="mt-3 space-y-2 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                <div className="whitespace-pre-wrap leading-relaxed text-[#202833] dark:text-slate-200">
                  {searchResult.text}
                </div>
                {searchResult.sources.length > 0 && (
                  <div className="border-t border-[#C8D6E5] pt-2 dark:border-slate-700">
                    {searchResult.sources.slice(0, 3).map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 truncate text-[11px] font-medium text-[#167C80] hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{src.title}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ethiopian Calendar (2019 EC – 2025 EC) & Member Birthdays Appreciation */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Interactive 13-Month Ethiopian Calendar Explorer */}
        <div
          className={`rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B] ${
            isViewer ? 'lg:col-span-12' : 'lg:col-span-7'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[#167C80]" />
              <div>
                <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                  {language === 'om'
                    ? 'Kaaleendara Itoophiyaa (2019–2025 EC)'
                    : 'Ethiopian Calendar (2019–2025 EC)'}
                </h3>
                <p className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                  {language === 'om' ? 'Har’a' : 'Today'}: {formatEthiopianShort(todayIso)} · GC{' '}
                  {todayIso}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleStepCalendarMonth(-1)}
                disabled={calYear === calendarYears[0] && calMonth === 1}
                className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-1.5 text-[#17365D] hover:bg-[#EAF1F7] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                aria-label="Previous Ethiopian month"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <select
                value={calMonth}
                onChange={(e) => setCalMonth(Number(e.target.value))}
                aria-label="Ethiopian month"
                className="rounded-lg border border-[#C8D6E5] bg-white px-2 py-1 text-xs font-semibold text-[#17365D] outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {ETHIOPIAN_MONTHS_OM.map((mName, idx) => (
                  <option key={mName} value={idx + 1}>
                    {idx + 1}. {mName}
                  </option>
                ))}
              </select>

              <select
                value={calYear}
                onChange={(e) => setCalYear(Number(e.target.value))}
                aria-label="Ethiopian year"
                className="font-mono-num rounded-lg border border-[#C8D6E5] bg-white px-2 py-1 text-xs font-semibold text-[#17365D] outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {calendarYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr} EC
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => handleStepCalendarMonth(1)}
                disabled={calYear === calendarYears[calendarYears.length - 1] && calMonth === 13}
                className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-1.5 text-[#17365D] hover:bg-[#EAF1F7] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                aria-label="Next Ethiopian month"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={handleResetCalendarToday}
                className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] px-2.5 py-1 text-[11px] font-semibold text-[#17365D] hover:bg-[#DCE7F2] dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300"
              >
                {language === 'om' ? 'Har’a' : 'Today'}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
            <div>
              <strong className="text-[#17365D] dark:text-sky-300">
                {ETHIOPIAN_MONTHS_OM[calMonth - 1]} {calYear} EC
              </strong>{' '}
              · {calendarCells.length} {language === 'om' ? 'guyyoota' : 'days'}
              {calMonth === 13 && (
                <span className="ml-1.5 text-[#C69C3D]">
                  ({isEthiopianLeapYear(calYear) ? 'Bara Qabxii · 6 days' : '5 days'})
                </span>
              )}
            </div>
            {selectedCellEc && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono-num">
                  {selectedCellEc.monthName} {selectedCellEc.day}, {selectedCellEc.year} EC ↔{' '}
                  {selectedCellIso}
                </span>
                {onSelectPeriod && (
                  <button
                    type="button"
                    onClick={() => onSelectPeriod(selectedCellIso.slice(0, 7))}
                    className="font-semibold text-[#167C80] hover:underline dark:text-teal-400"
                  >
                    {language === 'om' ? 'Ji’a kanaan ilaali →' : 'Set active period →'}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {(language === 'om'
              ? ['Dil', 'Wix', 'Qib', 'Rob', 'Kam', 'Jim', 'San']
              : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            ).map((dow) => (
              <div key={dow} className="py-1">
                {dow}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: calendarCells[0]?.weekday ?? 0 }).map((_, idx) => (
              <div
                key={`empty-${idx}`}
                className="h-12 rounded-lg bg-[#F3F7FA]/50 dark:bg-slate-900/20"
              />
            ))}
            {calendarCells.map((cell) => {
              const isSelected = cell.gregorianIso === selectedCellIso;
              const hasBirthday = birthdayDaysInViewedEcMonth.has(cell.ecDay);
              return (
                <button
                  key={cell.gregorianIso}
                  type="button"
                  onClick={() => setSelectedCellIso(cell.gregorianIso)}
                  className={`flex h-12 flex-col items-center justify-between rounded-lg border p-1 transition-colors ${
                    cell.isToday
                      ? 'border-[#C69C3D] bg-[#17365D] text-white'
                      : isSelected
                      ? 'border-[#167C80] bg-[#EAF1F7] text-[#17365D] dark:border-teal-400 dark:bg-slate-800 dark:text-white'
                      : 'border-[#C8D6E5]/60 bg-[#F3F7FA]/60 text-[#202833] hover:bg-[#EAF1F7] dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex w-full items-center justify-between px-0.5">
                    <span className="font-mono-num text-xs font-bold">{cell.ecDay}</span>
                    {hasBirthday && <Cake className="h-2.5 w-2.5 text-[#C69C3D]" />}
                  </div>
                  <span
                    className={`font-mono-num text-[9px] ${
                      cell.isToday ? 'text-sky-200' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {cell.gregorianIso.slice(5)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Member Birthdays This Month — Center Appreciation (Hidden for Viewer per REP-04) */}
        {!isViewer && (
          <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Cake className="h-4 w-4 shrink-0 text-[#C69C3D]" />
                <div>
                  <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                    {language === 'om'
                      ? 'Dhaloota Miseensotaa Ji’a Kanaa'
                      : 'Member Birthdays This Month'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {language === 'om'
                      ? `Galataa fi du’aa’ii · ${todayEc ? `${todayEc.monthName} ${todayEc.year} EC` : todayIso.slice(0, 7)}`
                      : `Center appreciation · ${todayEc ? `${todayEc.monthName} ${todayEc.year} EC` : todayIso.slice(0, 7)}`}
                  </p>
                </div>
              </div>
              <span className="font-mono-num text-xs font-semibold text-[#167C80] dark:text-teal-400">
                {birthdayMatches.length}{' '}
                {language === 'om'
                  ? 'miseensa'
                  : birthdayMatches.length === 1
                  ? 'member'
                  : 'members'}
              </span>
            </div>

            {birthdayMatches.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                <p>
                  {language === 'om'
                    ? 'Ji’a kana keessa miseensi guyyaan dhalootaa isaa galmaa’e hin jiru.'
                    : 'No members with a recorded birthday in the current month.'}
                </p>
                {isOwnerOrAdmin && (
                  <button
                    type="button"
                    onClick={() => onNavigate('members')}
                    className="mt-3 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300"
                  >
                    {language === 'om' ? 'Miseensota ilaali →' : 'Open Members →'}
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {birthdayMatches.map(({ member, birthDate }) => {
                  const isCopied = copiedMemberId === member.id;
                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-[#17365D] dark:text-white">
                          {member.fullName}
                        </div>
                        <div className="font-mono-num mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {member.memberCode}
                          {member.phone ? ` · ${member.phone}` : ''}
                        </div>
                        <div className="font-mono-num mt-0.5 text-[11px] font-medium text-[#167C80] dark:text-teal-400">
                          {formatDateByCalendar(birthDate, calendarMode)}
                          {calendarMode === 'gregorian'
                            ? ` · ${formatEthiopianShort(birthDate)}`
                            : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyBirthdayGreeting(member)}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                          isCopied
                            ? 'border-[#167C80] bg-[#167C80] text-white'
                            : 'border-[#C8D6E5] bg-[#F3F7FA] text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3 w-3" />
                            <span>{language === 'om' ? 'Waraabame!' : 'Copied!'}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>{language === 'om' ? 'Ergaa Galataa' : 'Copy Greeting'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent Activity Feed — Last 5 Financial Actions (Cashier/Admin/Owner only per REP-04) */}
      {isCashierOrAbove && (
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#167C80]" />
              <div>
                <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                  {language === 'om'
                    ? 'Sochii Dhihoo — Tarkaanfiiwwan Maallaqaa 5 Darban'
                    : 'Recent Activity — Last 5 Financial Actions'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {language === 'om'
                    ? 'Kaffaltiiwwan, jijjiirama haalaa fi murtoo maallaqaa yeroo dhugaa'
                    : 'Real-time pulse of payments, status updates, and period actions'}
                </p>
              </div>
            </div>
            {isOwnerOrAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className="text-xs font-semibold text-[#167C80] hover:underline dark:text-teal-400"
              >
                {language === 'om' ? 'Galmee Audit guutuu →' : 'Full Audit Logs →'}
              </button>
            )}
          </div>

          {recentFinancialActivity.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-[#C8D6E5] bg-[#F3F7FA]/70 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
              {language === 'om'
                ? 'Tarkaanfiin maallaqaa ykn jijjiiramni haalaa ammallee hin galmoofne.'
                : 'No financial actions or status updates recorded in the audit feed yet.'}
            </div>
          ) : (
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {recentFinancialActivity.map(({ log, meta, dateObj }) => {
                const isoDate = dateObj ? dateObj.toISOString().slice(0, 10) : null;
                const timeStr = dateObj
                  ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : 'Just now';
                return (
                  <div
                    key={log.id}
                    className="flex flex-col justify-between gap-2 py-3 first:pt-1 last:pb-1 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.badgeClass}`}
                        >
                          {meta.label}
                        </span>
                        <span className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {log.actorEmail}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-[#202833] dark:text-slate-200">
                        {log.details}
                      </p>
                    </div>
                    <div className="font-mono-num shrink-0 text-left text-[11px] text-slate-500 sm:text-right dark:text-slate-400">
                      <div>{isoDate ? formatDateByCalendar(isoDate, calendarMode) : '—'}</div>
                      <div className="text-[10px] text-slate-400">{timeStr}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recent Transactions (Hidden for Viewer per REP-04 confidentiality split) */}
      {!isViewer && (
        <div className="overflow-hidden rounded-xl border border-[#C8D6E5] bg-white dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-center justify-between border-b border-[#C8D6E5] px-5 py-3.5 dark:border-slate-800">
            <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
              {isCashierOrAbove
                ? language === 'om'
                  ? 'Galmee Kaffaltii Dhihoo'
                  : 'Recent Contributions'
                : language === 'om'
                ? 'Kaffaltii Koo'
                : 'My Linked Contributions'}
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('contributions')}
              className="text-xs font-semibold text-[#167C80] hover:underline dark:text-teal-400"
            >
              {language === 'om' ? 'Hunda ilaali →' : 'View all →'}
            </button>
          </div>

          {contributions.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-500">
              {isCashierOrAbove
                ? language === 'om'
                  ? 'Galmeen kaffaltii hin jiru.'
                  : 'No contributions recorded yet.'
                : language === 'om'
                ? 'Kaffaltiin account keetiin walqabate hin jiru.'
                : 'No personal contributions linked to your account yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#17365D] text-[11px] font-semibold tracking-wider text-white uppercase">
                  <tr>
                    <th className="px-5 py-2.5">Receipt #</th>
                    <th className="px-4 py-2.5">{language === 'om' ? 'Miseensa' : 'Member'}</th>
                    <th className="px-4 py-2.5">{language === 'om' ? 'Ji’a' : 'Month'}</th>
                    <th className="px-4 py-2.5">{language === 'om' ? 'Guyyaa' : 'Date'}</th>
                    <th className="px-4 py-2.5">{language === 'om' ? 'Mala' : 'Method'}</th>
                    <th className="px-4 py-2.5 text-right">{language === 'om' ? 'Hanga (ETB)' : 'Amount'}</th>
                    <th className="px-5 py-2.5 text-right">{language === 'om' ? 'Haala' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                  {contributions.slice(0, 6).map((c, idx) => (
                    <tr
                      key={c.id}
                      className={idx % 2 === 1 ? 'bg-[#F3F7FA] dark:bg-slate-900/30' : ''}
                    >
                      <td className="font-mono-num px-5 py-2.5 font-semibold text-[#17365D] dark:text-sky-300">
                        {c.receiptNumber}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-[#202833] dark:text-slate-100">
                        {c.memberName}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-slate-600 dark:text-slate-400">
                        {c.month}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-slate-600 dark:text-slate-400">
                        {c.paymentDate}
                      </td>
                      <td className="px-4 py-2.5 uppercase text-slate-600 dark:text-slate-400">
                        {c.paymentMethod.replace('_', ' ')}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-[#202833] dark:text-white">
                        {c.amount.toLocaleString()} ETB
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <span
                          className={`text-[11px] font-semibold uppercase ${
                            c.status === 'confirmed'
                              ? 'text-[#167C80] dark:text-teal-400'
                              : c.status === 'cancelled' || c.status === 'rejected'
                              ? 'text-red-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {getContributionStatusLabel(language, c.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
