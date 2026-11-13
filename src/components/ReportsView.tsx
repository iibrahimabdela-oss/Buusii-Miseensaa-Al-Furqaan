import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Download,
  Edit2,
  FileBarChart2,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Lock,
  Plus,
  Printer,
  ScrollText,
  Search,
  ShieldAlert,
  Trash2,
  Unlock,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getMemberStatusLabel, t } from '../i18n.ts';
import {
  createMeetingMinute,
  deleteMeetingMinute,
  savePeriodClosure,
  updateMeetingMinute,
} from '../services/firebase.ts';
import type {
  CalendarMode,
  CommitmentHistoryEntry,
  Contribution,
  Language,
  MeetingMinute,
  Member,
  PeriodClosure,
  PeriodSummaryMetrics,
  StatusHistoryEntry,
  UserAccount,
} from '../types.ts';
import {
  currentPeriodKey,
  formatDateByCalendar,
  formatEthiopianShort,
  formatPeriodLabel,
} from '../utils/ethiopianCalendar.ts';
import {
  calculateMemberStandingSummary,
  type AnnualMonthRow,
} from '../utils/financials.ts';
import {
  downloadCsvReport,
  downloadHtmlReport,
  downloadJsonBackup,
  downloadPeriodSummaryAndStatusCsv,
  downloadStandingCsvReport,
  downloadWordReport,
} from '../utils/reportExporters.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface ReportsViewProps {
  language: Language;
  calendarMode: CalendarMode;
  selectedPeriod: string;
  account: UserAccount;
  members: Member[];
  contributions: Contribution[];
  commitmentByMember: Record<string, CommitmentHistoryEntry[]>;
  statusByMember: Record<string, StatusHistoryEntry[]>;
  periodSummary: PeriodSummaryMetrics;
  annualBreakdown: AnnualMonthRow[];
  closures: PeriodClosure[];
  meetingMinutes?: MeetingMinute[];
  onSelectPeriod?: (periodKey: string) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  language,
  calendarMode,
  selectedPeriod,
  account,
  members,
  contributions,
  commitmentByMember,
  statusByMember,
  periodSummary,
  annualBreakdown,
  closures,
  meetingMinutes = [],
  onSelectPeriod,
}) => {
  const isOwner = account.role === 'owner';
  const isAdminOrOwner = account.role === 'owner' || account.role === 'admin';
  const isViewer = account.role === 'viewer';
  const canViewMemberDebtRows = account.role !== 'viewer' && account.role !== 'member';

  const [subView, setSubView] = useState<'monthly' | 'standing' | 'minutes'>('monthly');
  const [standingAsOfPeriod, setStandingAsOfPeriod] = useState<string>(() =>
    currentPeriodKey()
  );
  const [standingFilter, setStandingFilter] = useState<'all' | 'in_arrears' | 'up_to_date'>('all');
  const [standingSearch, setStandingSearch] = useState('');

  // Meeting Minutes State
  const [minutesPeriodScope, setMinutesPeriodScope] = useState<'all' | 'selected'>('all');
  const [minutesSearch, setMinutesSearch] = useState('');
  const [minuteEditorOpen, setMinuteEditorOpen] = useState(false);
  const [editingMinute, setEditingMinute] = useState<MeetingMinute | null>(null);
  const [minuteForm, setMinuteForm] = useState({
    periodKey: selectedPeriod,
    meetingDate: new Date().toISOString().slice(0, 10),
    title: '',
    chairperson: '',
    attendeesCount: '',
    attendeesSummary: '',
    summaryNotes: '',
    decisions: '',
  });
  const [minuteSaving, setMinuteSaving] = useState(false);
  const [minuteError, setMinuteError] = useState<string | null>(null);
  const [minuteNotice, setMinuteNotice] = useState<string | null>(null);
  const [deleteMinuteTarget, setDeleteMinuteTarget] = useState<MeetingMinute | null>(null);

  const filteredMeetingMinutes = useMemo(() => {
    const q = minutesSearch.trim().toLowerCase();
    return [...meetingMinutes]
      .filter((m) => {
        if (minutesPeriodScope === 'selected' && m.periodKey !== selectedPeriod) {
          return false;
        }
        if (!q) return true;
        return (
          m.periodKey.toLowerCase().includes(q) ||
          m.title.toLowerCase().includes(q) ||
          m.summaryNotes.toLowerCase().includes(q) ||
          (m.decisions || '').toLowerCase().includes(q) ||
          (m.chairperson || '').toLowerCase().includes(q) ||
          (m.attendeesSummary || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const pCmp = b.periodKey.localeCompare(a.periodKey);
        if (pCmp !== 0) return pCmp;
        return b.meetingDate.localeCompare(a.meetingDate);
      });
  }, [meetingMinutes, minutesPeriodScope, minutesSearch, selectedPeriod]);

  const openCreateMinute = () => {
    setEditingMinute(null);
    setMinuteForm({
      periodKey: selectedPeriod,
      meetingDate: new Date().toISOString().slice(0, 10),
      title: '',
      chairperson: account.displayName || '',
      attendeesCount: '',
      attendeesSummary: '',
      summaryNotes: '',
      decisions: '',
    });
    setMinuteError(null);
    setMinuteEditorOpen(true);
  };

  const openEditMinute = (m: MeetingMinute) => {
    setEditingMinute(m);
    setMinuteForm({
      periodKey: m.periodKey,
      meetingDate: m.meetingDate,
      title: m.title,
      chairperson: m.chairperson || '',
      attendeesCount: m.attendeesCount !== undefined ? String(m.attendeesCount) : '',
      attendeesSummary: m.attendeesSummary || '',
      summaryNotes: m.summaryNotes,
      decisions: m.decisions || '',
    });
    setMinuteError(null);
    setMinuteEditorOpen(true);
  };

  const handleSaveMinute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminOrOwner) return;

    const cleanTitle = minuteForm.title.trim();
    const cleanSummary = minuteForm.summaryNotes.trim();
    const cleanPeriod = minuteForm.periodKey.trim();

    if (!/^\d{4}-\d{2}$/.test(cleanPeriod)) {
      setMinuteError(
        language === 'om' ? 'Ji’i walga’ii (YYYY-MM) sirrii miti.' : 'Valid period (YYYY-MM) is required.'
      );
      return;
    }
    if (cleanTitle.length < 2) {
      setMinuteError(
        language === 'om' ? 'Mata-duree walga’ii galchi.' : 'Meeting title must be at least 2 characters.'
      );
      return;
    }
    if (cleanSummary.length < 5) {
      setMinuteError(
        language === 'om'
          ? 'Qabxiin cuunfaa walga’ii qubee 5 ol ta’uu qaba.'
          : 'Summary notes must be at least 5 characters.'
      );
      return;
    }

    const parsedAttendees =
      minuteForm.attendeesCount.trim() !== '' ? Number(minuteForm.attendeesCount) : undefined;
    if (
      parsedAttendees !== undefined &&
      (!Number.isFinite(parsedAttendees) || parsedAttendees < 0)
    ) {
      setMinuteError(
        language === 'om'
          ? 'Lakkoofsi hirmaattotaa sirrii miti.'
          : 'Attendees count must be zero or greater.'
      );
      return;
    }

    setMinuteSaving(true);
    setMinuteError(null);
    setMinuteNotice(null);
    try {
      const payload = {
        periodKey: cleanPeriod,
        meetingDate: minuteForm.meetingDate || new Date().toISOString().slice(0, 10),
        title: cleanTitle,
        chairperson: minuteForm.chairperson.trim() || undefined,
        attendeesCount: parsedAttendees,
        attendeesSummary: minuteForm.attendeesSummary.trim() || undefined,
        summaryNotes: cleanSummary,
        decisions: minuteForm.decisions.trim() || undefined,
      };
      if (editingMinute) {
        await updateMeetingMinute(account, editingMinute.id, payload);
        setMinuteNotice(
          language === 'om'
            ? `Qabxiin walga’ii "${cleanTitle}" (${cleanPeriod}) haaromfameera.`
            : `Updated meeting minutes "${cleanTitle}" for period ${cleanPeriod}.`
        );
      } else {
        await createMeetingMinute(account, payload);
        setMinuteNotice(
          language === 'om'
            ? `Qabxiin walga’ii "${cleanTitle}" (${cleanPeriod}) kuusaa keessatti galmaa’eera.`
            : `Archived meeting minutes "${cleanTitle}" under period ${cleanPeriod}.`
        );
      }
      setMinuteEditorOpen(false);
    } catch (err) {
      setMinuteError(err instanceof Error ? err.message : 'Unable to save meeting minutes.');
    } finally {
      setMinuteSaving(false);
    }
  };

  const handleConfirmDeleteMinute = async () => {
    if (!deleteMinuteTarget || !isOwner) return;
    setMinuteSaving(true);
    try {
      await deleteMeetingMinute(
        account,
        deleteMinuteTarget.id,
        deleteMinuteTarget.periodKey,
        deleteMinuteTarget.title
      );
      setMinuteNotice(
        language === 'om'
          ? `Qabxiin walga’ii "${deleteMinuteTarget.title}" haqameera.`
          : `Deleted meeting minutes "${deleteMinuteTarget.title}".`
      );
      setDeleteMinuteTarget(null);
    } catch (err) {
      setMinuteError(err instanceof Error ? err.message : 'Failed to delete meeting minutes.');
      setDeleteMinuteTarget(null);
    } finally {
      setMinuteSaving(false);
    }
  };

  const standingSummary = useMemo(
    () =>
      calculateMemberStandingSummary(
        standingAsOfPeriod,
        members,
        commitmentByMember,
        statusByMember,
        contributions
      ),
    [standingAsOfPeriod, members, commitmentByMember, statusByMember, contributions]
  );

  const filteredStandingRows = useMemo(() => {
    const q = standingSearch.trim().toLowerCase();
    return standingSummary.rows.filter((row) => {
      if (standingFilter !== 'all' && row.standing !== standingFilter) return false;
      if (!q) return true;
      return (
        row.member.fullName.toLowerCase().includes(q) ||
        row.member.memberCode.toLowerCase().includes(q) ||
        (row.member.phone || '').toLowerCase().includes(q)
      );
    });
  }, [standingSummary.rows, standingFilter, standingSearch]);

  const periodStatusDistribution = useMemo(() => {
    if (!canViewMemberDebtRows) {
      return { items: [], totalEvaluated: 0, healthyPct: 0 };
    }

    const pendingByMember = new Map<string, number>();
    for (const c of contributions) {
      if (c.month === selectedPeriod && c.status === 'pending') {
        pendingByMember.set(c.memberId, (pendingByMember.get(c.memberId) || 0) + c.amount);
      }
    }

    let upToDateCount = 0;
    let upToDateEtb = 0;
    let pendingCount = 0;
    let pendingEtb = 0;
    let arrearsCount = 0;
    let arrearsEtb = 0;

    for (const row of periodSummary.rows) {
      const pendingAmt = pendingByMember.get(row.member.id) || 0;
      const isEvaluated =
        row.statusInPeriod === 'active' || row.collectedEtb > 0 || pendingAmt > 0;
      if (!isEvaluated) continue;

      if (row.outstandingEtb === 0) {
        upToDateCount += 1;
        upToDateEtb += row.collectedEtb;
      } else if (pendingAmt > 0) {
        pendingCount += 1;
        pendingEtb += pendingAmt;
      } else {
        arrearsCount += 1;
        arrearsEtb += row.outstandingEtb;
      }
    }

    const totalEvaluated = upToDateCount + pendingCount + arrearsCount;
    const healthyPct =
      totalEvaluated > 0 ? Math.round((upToDateCount / totalEvaluated) * 100) : 0;

    const items = [
      {
        key: 'up_to_date',
        name: language === 'om' ? 'Yeroo Eeggate' : 'Up-to-date',
        count: upToDateCount,
        amountEtb: upToDateEtb,
        color: '#167C80',
      },
      {
        key: 'pending',
        name: language === 'om' ? 'Eegaa (Pending)' : 'Pending',
        count: pendingCount,
        amountEtb: pendingEtb,
        color: '#C69C3D',
      },
      {
        key: 'arrears',
        name: language === 'om' ? 'Haftee (Arrears)' : 'Arrears',
        count: arrearsCount,
        amountEtb: arrearsEtb,
        color: '#DC2626',
      },
    ];

    return { items, totalEvaluated, healthyPct };
  }, [canViewMemberDebtRows, contributions, periodSummary.rows, selectedPeriod, language]);

  const currentClosure = closures.find((c) => c.periodKey === selectedPeriod);
  const isClosed = currentClosure?.status === 'closed';

  const [cashReconciled, setCashReconciled] = useState('0');
  const [bankReconciled, setBankReconciled] = useState('0');
  const [preparedBy, setPreparedBy] = useState(account.displayName);
  const [reviewedBy, setReviewedBy] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [csvExportNotice, setCsvExportNotice] = useState<string | null>(null);

  useEffect(() => {
    if (currentClosure) {
      setCashReconciled(String(currentClosure.cashReconciledEtb));
      setBankReconciled(String(currentClosure.bankReconciledEtb));
      setPreparedBy(currentClosure.preparedBy || account.displayName);
      setReviewedBy(currentClosure.reviewedBy || '');
      setApprovedBy(currentClosure.approvedBy || '');
      setNotes(currentClosure.notes || '');
    } else {
      const cashSum = contributions
        .filter(
          (c) =>
            c.month === selectedPeriod &&
            c.status === 'confirmed' &&
            c.paymentMethod === 'cash'
        )
        .reduce((s, c) => s + c.amount, 0);
      const bankSum = Math.max(0, periodSummary.collectedEtb - cashSum);
      setCashReconciled(String(cashSum));
      setBankReconciled(String(bankSum));
      setPreparedBy(account.displayName);
      setReviewedBy('');
      setApprovedBy('');
      setNotes('');
    }
    setStatusMsg(null);
    setErrorMsg(null);
  }, [selectedPeriod, currentClosure?.periodKey, currentClosure?.status]);

  const handleSaveClosure = async (targetStatus: 'open' | 'closed') => {
    if (!preparedBy.trim()) {
      setErrorMsg(
        language === 'om' ? 'Maqaan nama qopheessee dirqama.' : 'Prepared By name is required.'
      );
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await savePeriodClosure(
        account,
        {
          periodKey: selectedPeriod,
          status: targetStatus,
          expectedEtb: periodSummary.expectedEtb,
          collectedEtb: periodSummary.collectedEtb,
          outstandingEtb: periodSummary.outstandingEtb,
          cashReconciledEtb: Math.max(0, Number(cashReconciled) || 0),
          bankReconciledEtb: Math.max(0, Number(bankReconciled) || 0),
          preparedBy: preparedBy.trim(),
          reviewedBy: reviewedBy.trim() || undefined,
          approvedBy: approvedBy.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        notes.trim() ||
          (targetStatus === 'closed' ? 'Monthly reconciliation sign-off' : 'Reopened for amendment')
      );
      setStatusMsg(
        targetStatus === 'closed'
          ? language === 'om'
            ? `Ji'i ${selectedPeriod} mirkaneessaan cufameera.`
            : `Period ${selectedPeriod} closed and signed off.`
          : language === 'om'
          ? `Ji'i ${selectedPeriod} deebi'ee banameera.`
          : `Period ${selectedPeriod} reopened.`
      );
      setReopenConfirmOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update period closure.');
    } finally {
      setSaving(false);
    }
  };

  const reconciledTotal = (Number(cashReconciled) || 0) + (Number(bankReconciled) || 0);
  const variance = reconciledTotal - periodSummary.collectedEtb;

  const handleExportFormattedPeriodCsv = () => {
    downloadPeriodSummaryAndStatusCsv(
      periodSummary,
      contributions,
      currentClosure,
      calendarMode,
      language,
      account.displayName || account.email
    );
    setCsvExportNotice(
      language === 'om'
        ? `Faayiliin CSV Cuunfaa Maallaqaa fi Haala Miseensotaa (${selectedPeriod}) buufameera.`
        : `Exported formatted Financial Summary & Member Status CSV for ${selectedPeriod}.`
    );
    setTimeout(() => setCsvExportNotice(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Reports Module Sub-View Switcher */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#C8D6E5] bg-white px-4 py-3 dark:border-slate-800 dark:bg-[#121D2B]">
        <div className="inline-flex items-center gap-1 rounded-lg bg-[#F3F7FA] p-1 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setSubView('monthly')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              subView === 'monthly'
                ? 'bg-[#17365D] text-white'
                : 'text-[#17365D] hover:bg-[#EAF1F7] dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <FileBarChart2 className="h-3.5 w-3.5" />
            <span>
              {language === 'om'
                ? 'Gabaasa Ji’aa & Cufiinsa'
                : 'Monthly Closing & Reports'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubView('standing')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              subView === 'standing'
                ? 'bg-[#17365D] text-white'
                : 'text-[#17365D] hover:bg-[#EAF1F7] dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <UserCheck className="h-3.5 w-3.5" />
            <span>
              {language === 'om'
                ? 'Haala Buusii & Haftee Miseensotaa'
                : 'Member Status & Arrears'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubView('minutes')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              subView === 'minutes'
                ? 'bg-[#17365D] text-white'
                : 'text-[#17365D] hover:bg-[#EAF1F7] dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <ScrollText className="h-3.5 w-3.5" />
            <span>
              {language === 'om' ? 'Qabxii Walga’ii (Archive)' : 'Meeting Minutes'}
            </span>
            <span
              className={`font-mono-num rounded px-1.5 py-0.5 text-[10px] ${
                subView === 'minutes'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EAF1F7] text-[#17365D] dark:bg-slate-800 dark:text-sky-300'
              }`}
            >
              {meetingMinutes.length}
            </span>
          </button>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400">
          {subView === 'standing' ? (
            <span>
              {language === 'om'
                ? `Hanga ji’a ${standingAsOfPeriod}: `
                : `Standing as of ${standingAsOfPeriod}: `}
              <strong className="font-mono-num text-[#167C80]">
                {standingSummary.upToDateCount} {language === 'om' ? 'yeroo eeggate' : 'up-to-date'}
              </strong>
              <span className="mx-1.5">·</span>
              <strong className="font-mono-num text-red-600 dark:text-red-400">
                {standingSummary.inArrearsCount} {language === 'om' ? 'haftee qaba' : 'in arrears'}
              </strong>
            </span>
          ) : subView === 'minutes' ? (
            <span>
              <strong className="font-mono-num text-[#17365D] dark:text-sky-300">
                {meetingMinutes.length}
              </strong>{' '}
              {language === 'om' ? 'qabxiiwwan walga’ii kuufaman' : 'archived meeting records'}
            </span>
          ) : (
            <span>{formatPeriodLabel(selectedPeriod, calendarMode, language)}</span>
          )}
        </div>
      </div>

      {subView === 'minutes' ? (
        <div className="space-y-6">
          {/* Meeting Minutes Toolbar */}
          <div className="no-print flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
            <div>
              <h3 className="font-display text-sm font-bold text-[#17365D] dark:text-white">
                {language === 'om'
                  ? 'Kuusaa Qabxii Walga’ii Ji’aa (Meeting Minutes Archive)'
                  : 'Monthly Center Meeting Minutes & Historical Archive'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {language === 'om'
                  ? 'Yaadannoo cuunfaa fi murtoo walga’iiwwan Markazaa ji’oota waliin walqabsiisii kuusi.'
                  : 'Record monthly center meeting summary notes and key resolutions linked to accounting periods.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Printer className="h-3.5 w-3.5 text-[#167C80]" />
                <span>{t(language, 'printReport')}</span>
              </button>
              {isAdminOrOwner && (
                <button
                  type="button"
                  onClick={openCreateMinute}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1E477A]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>
                    {language === 'om' ? 'Qabxii Walga’ii Galchi' : 'Record Meeting Minutes'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {minuteNotice && (
            <div className="no-print flex items-center gap-2 rounded-xl border border-[#167C80]/40 bg-[#167C80]/10 px-4 py-2.5 text-xs font-medium text-[#17365D] dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#167C80]" />
              <span>{minuteNotice}</span>
            </div>
          )}

          {minuteError && !minuteEditorOpen && (
            <div className="no-print rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {minuteError}
            </div>
          )}

          {/* Create / Edit Meeting Minutes Card */}
          {minuteEditorOpen && isAdminOrOwner && (
            <form
              onSubmit={handleSaveMinute}
              className="no-print space-y-4 rounded-xl border-2 border-[#167C80]/40 bg-white p-5 shadow-sm dark:border-teal-800 dark:bg-[#121D2B]"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/assets/aistudio/loog_6003b99d.jpg"
                    alt="Al-Furqaan Center Logo"
                    referrerPolicy="no-referrer"
                    className="h-8 w-8 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
                  />
                  <ScrollText className="h-4 w-4 text-[#167C80]" />
                  <h4 className="font-display text-sm font-bold text-[#17365D] dark:text-white">
                    {editingMinute
                      ? language === 'om'
                        ? 'Qabxii Walga’ii Gulaali'
                        : 'Edit Archived Meeting Minutes'
                      : language === 'om'
                      ? 'Qabxii Walga’ii Haaraa Galmeessi'
                      : 'Record Monthly Meeting Minutes'}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setMinuteEditorOpen(false)}
                  className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA] dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 text-xs">
                <div className="sm:col-span-3">
                  <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om' ? 'Ji’a Walqabatu (Period) *' : 'Linked Period *'}
                  </label>
                  <input
                    type="month"
                    required
                    value={minuteForm.periodKey}
                    onChange={(e) =>
                      setMinuteForm({ ...minuteForm, periodKey: e.target.value })
                    }
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 font-semibold text-[#17365D] outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  {/^\d{4}-\d{2}$/.test(minuteForm.periodKey) && (
                    <div className="mt-1 text-[11px] text-[#167C80] dark:text-teal-400">
                      {formatPeriodLabel(minuteForm.periodKey, calendarMode, language)}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om' ? 'Guyyaa Walga’ii *' : 'Meeting Date *'}
                  </label>
                  <input
                    type="date"
                    required
                    value={minuteForm.meetingDate}
                    onChange={(e) =>
                      setMinuteForm({ ...minuteForm, meetingDate: e.target.value })
                    }
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-[#17365D] outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  {minuteForm.meetingDate && (
                    <div className="font-mono-num mt-1 text-[11px] text-[#167C80] dark:text-teal-400">
                      EC: {formatEthiopianShort(minuteForm.meetingDate)}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-6">
                  <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om' ? 'Mata-duree Walga’ii *' : 'Meeting Title / Agenda *'}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={160}
                    value={minuteForm.title}
                    onChange={(e) => setMinuteForm({ ...minuteForm, title: e.target.value })}
                    placeholder={
                      language === 'om'
                        ? 'Fkn: Walga’ii Gamaaggama Buusii Ji’a Sadaasaa'
                        : 'e.g., Monthly Center Operations & Contribution Review'
                    }
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om' ? 'Walitti Qabaa (Chairperson)' : 'Chairperson / Lead'}
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={minuteForm.chairperson}
                    onChange={(e) =>
                      setMinuteForm({ ...minuteForm, chairperson: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om' ? 'Baay’ina Hirmaattotaa' : 'Attendees Count'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={minuteForm.attendeesCount}
                    onChange={(e) =>
                      setMinuteForm({ ...minuteForm, attendeesCount: e.target.value })
                    }
                    placeholder="e.g., 15"
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>

                <div className="sm:col-span-5">
                  <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om' ? 'Ibsa Hirmaattotaa (Filannoo)' : 'Attendees Note (Optional)'}
                  </label>
                  <input
                    type="text"
                    maxLength={300}
                    value={minuteForm.attendeesSummary}
                    onChange={(e) =>
                      setMinuteForm({ ...minuteForm, attendeesSummary: e.target.value })
                    }
                    placeholder={
                      language === 'om'
                        ? 'Fkn: Koree Markazaa fi bakka bu’oota miseensotaa'
                        : 'e.g., Center Committee, Cashiers & Member Representatives'
                    }
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-12 text-xs">
                <div className="md:col-span-7">
                  <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om'
                      ? 'Cuunfaa Qabxiiwwan Walga’ii (Summary Notes) *'
                      : 'Meeting Summary Notes *'}
                  </label>
                  <textarea
                    required
                    rows={5}
                    maxLength={4000}
                    value={minuteForm.summaryNotes}
                    onChange={(e) =>
                      setMinuteForm({ ...minuteForm, summaryNotes: e.target.value })
                    }
                    placeholder={
                      language === 'om'
                        ? 'Qabxiiwwan ijoo marii, haala walitti qabama buusii, fi yaada miseensotaa galmeessi...'
                        : 'Document key discussion points, contribution collection review, and center updates...'
                    }
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 leading-relaxed outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>

                <div className="md:col-span-5">
                  <label className="mb-1 block font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om'
                      ? 'Murtoo fi Tarkaanfiiwwan (Key Decisions)'
                      : 'Key Decisions & Action Items (Optional)'}
                  </label>
                  <textarea
                    rows={5}
                    maxLength={2000}
                    value={minuteForm.decisions}
                    onChange={(e) =>
                      setMinuteForm({ ...minuteForm, decisions: e.target.value })
                    }
                    placeholder={
                      language === 'om'
                        ? 'Murtoowwan fudhatamanii fi hojiiwwan itti aanan tarreessi...'
                        : 'List approved resolutions, follow-up owners, and target timelines...'
                    }
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 leading-relaxed outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {minuteError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  {minuteError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1 text-xs">
                <button
                  type="button"
                  onClick={() => setMinuteEditorOpen(false)}
                  className="rounded-lg border border-[#C8D6E5] px-4 py-2 font-medium text-slate-700 hover:bg-[#F3F7FA] dark:border-slate-700 dark:text-slate-200"
                >
                  {t(language, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={minuteSaving}
                  className="rounded-lg bg-[#17365D] px-4 py-2 font-semibold text-white hover:bg-[#1E477A] disabled:opacity-60"
                >
                  {minuteSaving
                    ? '...'
                    : editingMinute
                    ? language === 'om'
                      ? 'Haaromsuun Olkaa’i'
                      : 'Update Minutes'
                    : language === 'om'
                    ? 'Kuusaa Keessatti Olkaa’i'
                    : 'Save to Archive'}
                </button>
              </div>
            </form>
          )}

          {/* Archive Filter Bar */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#C8D6E5] bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="inline-flex rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-0.5 dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setMinutesPeriodScope('all')}
                className={`rounded-md px-3 py-1 font-semibold transition-colors ${
                  minutesPeriodScope === 'all'
                    ? 'bg-[#17365D] text-white'
                    : 'text-slate-600 hover:text-[#17365D] dark:text-slate-300'
                }`}
              >
                {language === 'om'
                  ? `Kuusaa Hunda (${meetingMinutes.length})`
                  : `All Periods (${meetingMinutes.length})`}
              </button>
              <button
                type="button"
                onClick={() => setMinutesPeriodScope('selected')}
                className={`font-mono-num rounded-md px-3 py-1 font-semibold transition-colors ${
                  minutesPeriodScope === 'selected'
                    ? 'bg-[#17365D] text-white'
                    : 'text-slate-600 hover:text-[#17365D] dark:text-slate-300'
                }`}
              >
                {language === 'om'
                  ? `Ji’a Filatame (${selectedPeriod})`
                  : `Selected (${selectedPeriod})`}
              </button>
            </div>

            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={minutesSearch}
                onChange={(e) => setMinutesSearch(e.target.value)}
                placeholder={
                  language === 'om'
                    ? 'Mata-duree, ji’a (YYYY-MM), ykn yaadannoo barbaadi...'
                    : 'Search title, period (YYYY-MM), notes, decisions...'
                }
                className="w-full rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] py-1.5 pr-3 pl-8 text-xs text-[#202833] outline-none focus:border-[#17365D] focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Printable Historical Archive List */}
          <div id="printable-report" className="space-y-4">
            <div className="rounded-xl border border-[#C8D6E5] border-b-4 border-b-[#C69C3D] bg-[#17365D] px-5 py-3.5 text-white dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src="/assets/aistudio/loog_6003b99d.jpg"
                    alt="Al-Furqaan Center Logo"
                    referrerPolicy="no-referrer"
                    className="h-11 w-11 shrink-0 rounded-full border-2 border-[#C69C3D] bg-white object-cover"
                  />
                  <div>
                    <h2 className="font-display text-sm font-bold sm:text-base">
                      {t(language, 'centerFull')} —{' '}
                      {language === 'om'
                        ? 'Galmee Kuusaa Qabxii Walga’ii'
                        : 'Monthly Meeting Minutes Archive'}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-200">
                      {t(language, 'centerLocation')} ·{' '}
                      {minutesPeriodScope === 'selected'
                        ? formatPeriodLabel(selectedPeriod, calendarMode, language)
                        : language === 'om'
                        ? 'Kuusaa Seenaa Hunda'
                        : 'All Archived Periods'}
                    </p>
                  </div>
                </div>
                <span className="font-mono-num text-xs font-bold text-[#C69C3D]">
                  {filteredMeetingMinutes.length}{' '}
                  {language === 'om' ? 'GALMEE' : 'RECORDS'}
                </span>
              </div>
            </div>
            {filteredMeetingMinutes.length === 0 ? (
              <div className="rounded-xl border border-[#C8D6E5] bg-white px-6 py-12 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-[#121D2B] dark:text-slate-400">
                <ScrollText className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                <p className="font-semibold text-[#17365D] dark:text-slate-200">
                  {minutesPeriodScope === 'selected'
                    ? language === 'om'
                      ? `Ji’a ${selectedPeriod} kanaaf qabxiin walga’ii galmaa’e hin jiru.`
                      : `No meeting minutes archived for period ${selectedPeriod} yet.`
                    : language === 'om'
                    ? 'Qabxiin walga’ii kuufame hin argamne.'
                    : 'No archived meeting minutes found.'}
                </p>
                {isAdminOrOwner && !minuteEditorOpen && (
                  <button
                    type="button"
                    onClick={openCreateMinute}
                    className="no-print mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-3.5 py-2 font-semibold text-white hover:bg-[#1E477A]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>
                      {language === 'om'
                        ? `Qabxii Walga’ii ${selectedPeriod} Galchi`
                        : `Record Minutes for ${selectedPeriod}`}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              filteredMeetingMinutes.map((m) => {
                const linkedClosure = closures.find((c) => c.periodKey === m.periodKey);
                const isPeriodClosed = linkedClosure?.status === 'closed';
                return (
                  <article
                    key={m.id}
                    className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono-num inline-flex items-center gap-1 rounded-md bg-[#17365D] px-2.5 py-0.5 text-[11px] font-bold text-white">
                            <Calendar className="h-3 w-3 text-[#C69C3D]" />
                            <span>{m.periodKey}</span>
                          </span>
                          <span className="text-[11px] font-semibold text-[#167C80] dark:text-teal-400">
                            {formatPeriodLabel(m.periodKey, calendarMode, language)}
                          </span>
                          {linkedClosure && (
                            <span
                              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                                isPeriodClosed
                                  ? 'bg-[#167C80]/15 text-[#167C80] dark:bg-teal-950/60 dark:text-teal-300'
                                  : 'bg-amber-500/15 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {isPeriodClosed ? (
                                <Lock className="h-2.5 w-2.5" />
                              ) : (
                                <Unlock className="h-2.5 w-2.5" />
                              )}
                              <span>{isPeriodClosed ? 'Closed Period' : 'Open Period'}</span>
                            </span>
                          )}
                        </div>
                        <h4 className="font-display text-base font-bold text-[#17365D] dark:text-white">
                          {m.title}
                        </h4>
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="font-mono-num">
                            {language === 'om' ? 'Guyyaa:' : 'Date:'}{' '}
                            <strong className="text-[#202833] dark:text-slate-200">
                              {formatDateByCalendar(m.meetingDate, calendarMode)}
                            </strong>
                          </span>
                          {m.chairperson && (
                            <span>
                              · {language === 'om' ? 'Walitti Qabaa:' : 'Chair:'}{' '}
                              <strong className="text-[#202833] dark:text-slate-200">
                                {m.chairperson}
                              </strong>
                            </span>
                          )}
                          {m.attendeesCount !== undefined && (
                            <span className="inline-flex items-center gap-1">
                              · <Users className="h-3 w-3 text-[#167C80]" />
                              <strong className="font-mono-num text-[#202833] dark:text-slate-200">
                                {m.attendeesCount}
                              </strong>{' '}
                              {language === 'om' ? 'hirmaattota' : 'attendees'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="no-print flex flex-wrap items-center gap-1.5 text-xs">
                        {onSelectPeriod && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectPeriod(m.periodKey);
                              setSubView('monthly');
                            }}
                            className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-2.5 py-1.5 text-[11px] font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300"
                          >
                            {language === 'om' ? 'Gabaasa Ji’aa →' : 'Period Report →'}
                          </button>
                        )}
                        {isAdminOrOwner && (
                          <button
                            type="button"
                            onClick={() => openEditMinute(m)}
                            className="rounded-lg border border-[#C8D6E5] p-1.5 text-slate-600 hover:bg-[#EAF1F7] hover:text-[#17365D] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            title={t(language, 'edit')}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => setDeleteMinuteTarget(m)}
                            className="rounded-lg border border-[#C8D6E5] p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:hover:bg-red-950/40"
                            title="Delete (Owner)"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-12 text-xs">
                      <div className={m.decisions ? 'md:col-span-7' : 'md:col-span-12'}>
                        <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#167C80]">
                          {language === 'om' ? 'Cuunfaa Qabxiiwwanii' : 'Summary Notes'}
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed text-[#202833] dark:text-slate-200">
                          {m.summaryNotes}
                        </p>
                        {m.attendeesSummary && (
                          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <strong className="text-[#17365D] dark:text-slate-300">
                              {language === 'om' ? 'Hirmaattota:' : 'Participants:'}
                            </strong>{' '}
                            {m.attendeesSummary}
                          </p>
                        )}
                      </div>

                      {m.decisions && (
                        <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7]/60 p-3.5 md:col-span-5 dark:border-slate-700 dark:bg-slate-900/50">
                          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#17365D] dark:text-sky-300">
                            {language === 'om'
                              ? 'Murtoowwan & Tarkaanfii'
                              : 'Key Decisions & Action Items'}
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed text-[#202833] dark:text-slate-200">
                            {m.decisions}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-400 dark:border-slate-800">
                      <span>
                        {language === 'om' ? 'Kan galmeesse:' : 'Recorded by:'}{' '}
                        {m.recordedByName}
                      </span>
                      {m.updatedByName && m.updatedByName !== m.recordedByName && (
                        <span>
                          {language === 'om' ? 'Kan haaromse:' : 'Last updated by:'}{' '}
                          {m.updatedByName}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <ConfirmDialog
            open={Boolean(deleteMinuteTarget)}
            title={
              language === 'om' ? 'Qabxii Walga’ii Haquu? (Owner)' : 'Delete Meeting Minutes? (Owner)'
            }
            description={`Are you sure you want to permanently remove "${deleteMinuteTarget?.title}" (${deleteMinuteTarget?.periodKey}) from the historical archive?`}
            confirmLabel={language === 'om' ? 'Haqi' : 'Delete Minutes'}
            destructive
            busy={minuteSaving}
            onConfirm={handleConfirmDeleteMinute}
            onCancel={() => setDeleteMinuteTarget(null)}
          />
        </div>
      ) : subView === 'standing' ? (
        <div className="space-y-6">
          {/* Member Standing & Arrears Toolbar */}
          <div className="no-print flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h3 className="font-display text-sm font-bold text-[#17365D] dark:text-white">
                  {language === 'om'
                    ? 'Cuunfaa Haala Kaffaltii & Haftee Miseensotaa'
                    : 'Member Contribution Status & Arrears Summary'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {language === 'om'
                    ? 'Waadaa ji’aa seenaa miseensaa irratti hundaa’uun kanneen yeroo eeggatanii fi kanneen haftee qaban adda baasa.'
                    : 'Evaluates effective-dated monthly commitments vs. confirmed contributions through the selected month.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  {language === 'om' ? 'Hanga ji’aa:' : 'As of:'}
                </span>
                <input
                  type="month"
                  value={standingAsOfPeriod}
                  onChange={(e) => {
                    if (e.target.value) setStandingAsOfPeriod(e.target.value);
                  }}
                  className="font-mono-num bg-transparent font-semibold text-[#17365D] outline-none dark:text-slate-100"
                />
              </label>

              {standingAsOfPeriod !== currentPeriodKey() && (
                <button
                  type="button"
                  onClick={() => setStandingAsOfPeriod(currentPeriodKey())}
                  className="rounded-lg border border-[#C8D6E5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {language === 'om' ? 'Ji’a Ammaa' : 'Current Month'}
                </button>
              )}

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] whitespace-nowrap shrink-0"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>{t(language, 'printReport')}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  downloadStandingCsvReport(standingSummary, canViewMemberDebtRows)
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#167C80]" />
                <span>CSV (UTF-8)</span>
              </button>
            </div>
          </div>

          {!canViewMemberDebtRows ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-[#C8D6E5] bg-[#EAF1F7] px-4 py-4 text-xs text-[#17365D] dark:border-slate-700 dark:bg-[#121D2B] dark:text-sky-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#C69C3D]" />
              <div>{t(language, 'viewerPrivacyBanner')}</div>
            </div>
          ) : (
            <div
              id="printable-report"
              className="space-y-6 rounded-xl border border-[#C8D6E5] bg-white p-6 dark:border-slate-800 dark:bg-[#121D2B]"
            >
              {/* Printable Header Banner */}
              <div className="border-b-4 border-[#C69C3D] bg-[#17365D] px-5 py-4 text-white">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src="/assets/aistudio/loog_6003b99d.jpg"
                      alt="Al-Furqaan Center Logo"
                      referrerPolicy="no-referrer"
                      className="h-12 w-12 shrink-0 rounded-full border-2 border-[#C69C3D] bg-white object-cover"
                    />
                    <div>
                      <h2 className="font-display text-base font-bold">
                        {t(language, 'centerFull')} —{' '}
                        {language === 'om'
                          ? 'Gabaasa Haala Kaffaltii & Haftee Miseensotaa'
                          : 'Member Contribution Status & Arrears Report'}
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-200">
                        {t(language, 'centerLocation')} ·{' '}
                        {formatPeriodLabel(standingAsOfPeriod, calendarMode, language)}
                      </p>
                    </div>
                  </div>
                  <div className="font-mono-num text-xs font-bold text-[#C69C3D]">
                    AS OF {standingAsOfPeriod}
                  </div>
                </div>
              </div>

              {/* 4 KPI Strip */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-slate-500 dark:text-slate-400">
                    {language === 'om' ? 'Miseensota Waliigalaa' : 'Total Evaluated'}
                  </div>
                  <div className="font-mono-num mt-1 text-lg font-bold text-[#17365D] dark:text-white">
                    {standingSummary.totalMembers}
                  </div>
                </div>

                <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-slate-500 dark:text-slate-400">
                    {language === 'om' ? 'Yeroo Eeggatan (Up-to-Date)' : 'Up-to-Date'}
                  </div>
                  <div className="font-mono-num mt-1 text-lg font-bold text-[#167C80] dark:text-teal-400">
                    {standingSummary.upToDateCount}
                    <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                      ({standingSummary.totalMembers > 0
                        ? `${Math.round(
                            (standingSummary.upToDateCount / standingSummary.totalMembers) * 100
                          )}%`
                        : '0%'}
                      )
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-slate-500 dark:text-slate-400">
                    {language === 'om' ? 'Haftee Qaban (In Arrears)' : 'In Arrears'}
                  </div>
                  <div className="font-mono-num mt-1 text-lg font-bold text-red-600 dark:text-red-400">
                    {standingSummary.inArrearsCount}
                  </div>
                </div>

                <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-slate-500 dark:text-slate-400">
                    {language === 'om' ? 'Waliigala Haftee (ETB)' : 'Total Arrears (ETB)'}
                  </div>
                  <div className="font-mono-num mt-1 text-lg font-bold text-[#17365D] dark:text-white">
                    {standingSummary.totalArrearsEtb.toLocaleString()} ETB
                  </div>
                </div>
              </div>

              {/* Filter Bar */}
              <div className="no-print flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 rounded-lg bg-[#F3F7FA] p-1 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setStandingFilter('all')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      standingFilter === 'all'
                        ? 'bg-[#17365D] text-white'
                        : 'text-slate-600 hover:text-[#17365D] dark:text-slate-300'
                    }`}
                  >
                    {language === 'om' ? 'Hunda' : 'All'} ({standingSummary.totalMembers})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStandingFilter('in_arrears')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      standingFilter === 'in_arrears'
                        ? 'bg-[#17365D] text-white'
                        : 'text-slate-600 hover:text-[#17365D] dark:text-slate-300'
                    }`}
                  >
                    {language === 'om' ? 'Haftee Qabu' : 'In Arrears'} (
                    {standingSummary.inArrearsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStandingFilter('up_to_date')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      standingFilter === 'up_to_date'
                        ? 'bg-[#17365D] text-white'
                        : 'text-slate-600 hover:text-[#17365D] dark:text-slate-300'
                    }`}
                  >
                    {language === 'om' ? 'Yeroo Eeggate' : 'Up-to-Date'} (
                    {standingSummary.upToDateCount})
                  </button>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={standingSearch}
                    onChange={(e) => setStandingSearch(e.target.value)}
                    placeholder={
                      language === 'om'
                        ? 'Maqaa, koodii ykn bilbilaan barbaadi...'
                        : 'Search member name, code, or phone...'
                    }
                    className="w-full rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] py-2 pr-3 pl-8 text-xs text-[#202833] outline-none focus:border-[#17365D] focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Member Standing Table */}
              {members.length === 0 ? (
                <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-5 py-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
                  {language === 'om'
                    ? 'Miseensonni galmaa’an hin jiran.'
                    : 'No members registered yet.'}
                </div>
              ) : filteredStandingRows.length === 0 ? (
                <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-5 py-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
                  <div>
                    {language === 'om'
                      ? 'Miseensi ulaagaa barbaachaa kanaan wal-simu hin argamne.'
                      : 'No members match the selected standing filter or search.'}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStandingFilter('all');
                      setStandingSearch('');
                    }}
                    className="mt-3 rounded-lg border border-[#C8D6E5] bg-white px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7]"
                  >
                    {language === 'om' ? 'Calallii Haqi' : 'Clear Filters'}
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[#C8D6E5] dark:border-slate-700">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#17365D] text-[11px] font-semibold text-white uppercase">
                      <tr>
                        <th className="px-4 py-2.5">Code</th>
                        <th className="px-4 py-2.5">
                          {language === 'om' ? 'Miseensa' : 'Member'}
                        </th>
                        <th className="px-4 py-2.5">
                          {language === 'om' ? 'Haala' : 'Status'}
                        </th>
                        <th className="px-4 py-2.5 text-right">
                          {language === 'om' ? 'Waadaa/Ji’a' : 'Commitment'}
                        </th>
                        <th className="px-4 py-2.5 text-right">
                          {language === 'om' ? 'Ji’oota' : 'Months'}
                        </th>
                        <th className="px-4 py-2.5 text-right">
                          {language === 'om' ? 'Waliigala Waadaa' : 'Expected'}
                        </th>
                        <th className="px-4 py-2.5 text-right">
                          {language === 'om' ? 'Mirkanaa’e' : 'Confirmed'}
                        </th>
                        <th className="px-4 py-2.5 text-right">
                          {language === 'om' ? 'Haftee' : 'Arrears'}
                        </th>
                        <th className="px-4 py-2.5">
                          {language === 'om' ? 'Kaffaltii Dhihoo' : 'Last Payment'}
                        </th>
                        <th className="px-4 py-2.5 text-right">
                          {language === 'om' ? 'Sadarkaa' : 'Standing'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                      {filteredStandingRows.map((row, idx) => (
                        <tr
                          key={row.member.id}
                          className={
                            idx % 2 === 1
                              ? 'bg-[#F3F7FA] dark:bg-slate-900/30'
                              : ''
                          }
                        >
                          <td className="font-mono-num px-4 py-2.5 font-semibold text-[#17365D] dark:text-sky-300">
                            {row.member.memberCode}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-[#202833] dark:text-white">
                              {row.member.fullName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              <span>{row.member.category}</span>
                              {row.member.phone && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span className="font-mono-num">{row.member.phone}</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                            {getMemberStatusLabel(language, row.statusAsOfPeriod)}
                          </td>
                          <td className="font-mono-num px-4 py-2.5 text-right">
                            {row.currentCommitmentEtb.toLocaleString()} ETB
                          </td>
                          <td className="font-mono-num px-4 py-2.5 text-right text-slate-600 dark:text-slate-400">
                            {row.monthsEvaluated}
                          </td>
                          <td className="font-mono-num px-4 py-2.5 text-right">
                            {row.expectedTotalEtb.toLocaleString()}
                          </td>
                          <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-[#167C80] dark:text-teal-400">
                            {row.confirmedTotalEtb.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div
                              className={`font-mono-num font-bold ${
                                row.arrearsEtb > 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-slate-500'
                              }`}
                            >
                              {row.arrearsEtb.toLocaleString()} ETB
                            </div>
                            {row.monthsInArrears.length > 0 && (
                              <div className="font-mono-num text-[10px] text-slate-500">
                                {row.monthsInArrears.length}{' '}
                                {language === 'om' ? 'ji’a' : 'mo'}:{' '}
                                {row.monthsInArrears.slice(-3).join(', ')}
                                {row.monthsInArrears.length > 3 ? '…' : ''}
                              </div>
                            )}
                          </td>
                          <td className="font-mono-num px-4 py-2.5 text-[11px] text-slate-600 dark:text-slate-400">
                            {row.lastPaymentDate
                              ? formatDateByCalendar(row.lastPaymentDate, calendarMode)
                              : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {row.standing === 'in_arrears' ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span>
                                  {language === 'om' ? 'Haftee Qaba' : 'In Arrears'}
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-[#167C80] dark:text-teal-400">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                <span>
                                  {language === 'om' ? 'Yeroo Eeggate' : 'Up-to-Date'}
                                </span>
                              </span>
                            )}
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
      ) : (
        <>
          {/* Export Toolbar */}
          <div className="no-print flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
        <div>
          <h3 className="font-display text-sm font-bold text-[#17365D] dark:text-white">
            {language === 'om'
              ? `Gabaasa Buusii & Maxxansa (${selectedPeriod})`
              : `Financial Reports & Export (${selectedPeriod})`}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatPeriodLabel(selectedPeriod, calendarMode, language)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1E477A]"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>{t(language, 'printReport')}</span>
          </button>
          <button
            type="button"
            onClick={() =>
              downloadWordReport(
                periodSummary,
                currentClosure,
                canViewMemberDebtRows,
                annualBreakdown,
                calendarMode,
                language
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7]"
          >
            <FileText className="h-3.5 w-3.5 text-[#167C80]" />
            <span>Word (.doc)</span>
          </button>
          <button
            type="button"
            onClick={() =>
              downloadHtmlReport(
                periodSummary,
                currentClosure,
                canViewMemberDebtRows,
                annualBreakdown,
                calendarMode,
                language
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7]"
          >
            <FileCode2 className="h-3.5 w-3.5 text-[#17365D]" />
            <span>HTML</span>
          </button>
          <button
            type="button"
            onClick={() =>
              downloadCsvReport(periodSummary, canViewMemberDebtRows, annualBreakdown)
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7]"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-[#167C80]" />
            <span>CSV (UTF-8)</span>
          </button>
          {isAdminOrOwner && (
            <button
              type="button"
              onClick={handleExportFormattedPeriodCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#167C80] bg-[#EAF1F7] px-3 py-2 text-xs font-semibold text-[#17365D] hover:bg-[#DCE8F2] dark:border-teal-600 dark:bg-slate-800 dark:text-teal-300"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#167C80]" />
              <span>
                {language === 'om'
                  ? 'CSV Cuunfaa & Haala Miseensotaa'
                  : 'Period Summary & Status CSV'}
              </span>
            </button>
          )}
          {isAdminOrOwner && (
            <button
              type="button"
              onClick={() => downloadJsonBackup(members, contributions, closures)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#C69C3D] bg-[#FFFDF7] px-3 py-2 text-xs font-semibold text-[#17365D] hover:bg-[#FAF4E4]"
            >
              <Download className="h-3.5 w-3.5 text-[#C69C3D]" />
              <span>JSON Backup</span>
            </button>
          )}
        </div>
      </div>

      {csvExportNotice && (
        <div className="no-print flex items-center gap-2 rounded-xl border border-[#167C80]/40 bg-[#167C80]/10 px-4 py-2.5 text-xs font-medium text-[#17365D] dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#167C80]" />
          <span>{csvExportNotice}</span>
        </div>
      )}

      {/* Confidentiality / REP-04 Notice */}
      <div className="no-print flex items-start gap-2.5 rounded-xl border border-[#C8D6E5] bg-[#EAF1F7] px-4 py-3 text-xs text-[#17365D] dark:border-slate-700 dark:bg-[#121D2B] dark:text-sky-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#C69C3D]" />
        <div>
          {isViewer
            ? t(language, 'viewerPrivacyBanner')
            : language === 'om'
            ? 'Hubachiisa Iccitii: Faayiloota Word, PDF, HTML fi CSV bakka hayyamame qofa kaa’aa; linkii uummataaf banaa ta’een daataa haftee miseensotaa hin qoodinaa.'
            : 'Confidentiality Policy: Store exported Word, PDF, HTML, and CSV files in restricted folders only. Never share individual member debt reports via public links.'}
        </div>
      </div>

      {/* Period Health Distribution Chart (Recharts — Up-to-date, Pending, Arrears) */}
      {canViewMemberDebtRows && (
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[#167C80]" />
              <div>
                <h4 className="font-display text-sm font-bold text-[#17365D] dark:text-white">
                  {language === 'om'
                    ? `Fayyaa Dhaabbataa: Qoodinsa Haala Buusii (${selectedPeriod})`
                    : `Center Health: Member Contribution Status Distribution (${selectedPeriod})`}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {language === 'om'
                    ? 'Miseensota hojii irra jiran: Yeroo Eeggate vs. Kaffaltii Eegaa vs. Haftee'
                    : 'Active period commitments classified by Up-to-date, Pending verification, and Arrears'}
                </p>
              </div>
            </div>
            <div className="font-mono-num text-xs font-semibold text-[#17365D] dark:text-sky-300">
              {periodStatusDistribution.totalEvaluated}{' '}
              {language === 'om' ? 'miseensota madaalaman' : 'members evaluated'}
            </div>
          </div>

          {periodStatusDistribution.totalEvaluated === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              {language === 'om'
                ? 'Ji’a kanaaf daataan miseensotaa hin argamne.'
                : 'No evaluated member commitments found for the selected period.'}
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              {/* Summary Strip */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                {periodStatusDistribution.items.map((item) => {
                  const pct =
                    periodStatusDistribution.totalEvaluated > 0
                      ? Math.round((item.count / periodStatusDistribution.totalEvaluated) * 100)
                      : 0;
                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-900/50"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: item.color }}
                        />
                        <div>
                          <div className="font-semibold text-[#17365D] dark:text-white">
                            {item.name}
                          </div>
                          <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                            {item.amountEtb.toLocaleString()} ETB
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono-num text-base font-bold text-[#17365D] dark:text-white">
                          {item.count}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-500">{pct}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="relative h-60 lg:col-span-5">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={periodStatusDistribution.items.filter((i) => i.count > 0)}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={84}
                        paddingAngle={3}
                      >
                        {periodStatusDistribution.items
                          .filter((i) => i.count > 0)
                          .map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [
                          `${value} ${language === 'om' ? 'miseensa' : 'members'}`,
                          String(name),
                        ]}
                        contentStyle={{
                          borderRadius: '8px',
                          borderColor: '#C8D6E5',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono-num text-xl font-bold text-[#17365D] dark:text-white">
                      {periodStatusDistribution.healthyPct}%
                    </span>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {language === 'om' ? 'Yeroo Eeggate' : 'Up-to-date'}
                    </span>
                  </div>
                </div>

                <div className="h-60 lg:col-span-7">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={periodStatusDistribution.items}
                      margin={{ top: 10, right: 16, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#C8D6E5" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: '#526173' }}
                        axisLine={{ stroke: '#C8D6E5' }}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#526173' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value) => [
                          `${value} ${language === 'om' ? 'miseensa' : 'members'}`,
                          language === 'om' ? 'Baay’ina' : 'Members',
                        ]}
                        contentStyle={{
                          borderRadius: '8px',
                          borderColor: '#C8D6E5',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={64}>
                        {periodStatusDistribution.items.map((entry) => (
                          <Cell key={entry.key} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Monthly Closing & Cash/Bank Reconciliation Panel */}
      <div className="no-print rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <img
              src="/assets/aistudio/loog_6003b99d.jpg"
              alt="Al-Furqaan Center Logo"
              referrerPolicy="no-referrer"
              className="h-8 w-8 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
            />
            {isClosed ? (
              <Lock className="h-4 w-4 text-[#167C80]" />
            ) : (
              <Unlock className="h-4 w-4 text-[#C69C3D]" />
            )}
            <h4 className="font-display text-sm font-bold text-[#17365D] dark:text-white">
              {language === 'om'
                ? `Cufiinsa Ji’aa & Wal-Madaalchisa Maallaqaa (${selectedPeriod})`
                : `Monthly Period Closing & Reconciliation (${selectedPeriod})`}
            </h4>
          </div>
          <span
            className={`text-xs font-bold uppercase ${
              isClosed ? 'text-[#167C80]' : 'text-[#C69C3D]'
            }`}
          >
            {isClosed
              ? language === 'om'
                ? 'CUFAMEERA (CLOSED)'
                : 'CLOSED'
              : language === 'om'
              ? 'BANAA (OPEN)'
              : 'OPEN'}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4 text-xs">
          <div>
            <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
              {language === 'om' ? 'Harka / Cash on Hand (ETB)' : 'Cash on Hand (ETB)'}
            </label>
            <input
              type="number"
              min={0}
              disabled={!isAdminOrOwner || isClosed}
              value={cashReconciled}
              onChange={(e) => setCashReconciled(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none disabled:bg-[#F3F7FA] dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
              {language === 'om' ? 'Baankii & Telebirr (ETB)' : 'Bank & Mobile Money (ETB)'}
            </label>
            <input
              type="number"
              min={0}
              disabled={!isAdminOrOwner || isClosed}
              value={bankReconciled}
              onChange={(e) => setBankReconciled(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none disabled:bg-[#F3F7FA] dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-2.5 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="text-[11px] text-slate-500">
              {language === 'om' ? 'Waliigala Wal-Madaalchisame' : 'Reconciled vs. Confirmed'}
            </div>
            <div className="font-mono-num mt-1 text-sm font-bold text-[#17365D] dark:text-sky-300">
              {reconciledTotal.toLocaleString()} / {periodSummary.collectedEtb.toLocaleString()} ETB
            </div>
          </div>
          <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-2.5 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="text-[11px] text-slate-500">
              {language === 'om' ? 'Garaagarummaa (Variance)' : 'Reconciliation Variance'}
            </div>
            <div
              className={`font-mono-num mt-1 text-sm font-bold ${
                variance === 0 ? 'text-[#167C80]' : 'text-red-600'
              }`}
            >
              {variance === 0 ? '0 ETB (Balanced)' : `${variance.toLocaleString()} ETB`}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
          <div>
            <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
              Qopheesse (Prepared By) *
            </label>
            <input
              disabled={!isAdminOrOwner || isClosed}
              value={preparedBy}
              onChange={(e) => setPreparedBy(e.target.value)}
              className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none disabled:bg-[#F3F7FA] dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
              Ilaale (Reviewed By)
            </label>
            <input
              disabled={!isAdminOrOwner || isClosed}
              value={reviewedBy}
              onChange={(e) => setReviewedBy(e.target.value)}
              className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none disabled:bg-[#F3F7FA] dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
              Raggaase (Approved By)
            </label>
            <input
              disabled={!isAdminOrOwner || isClosed}
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none disabled:bg-[#F3F7FA] dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        </div>

        <div className="mt-3 text-xs">
          <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
            {language === 'om' ? 'Yaadannoo Cufiinsaa' : 'Closing / Reconciliation Notes'}
          </label>
          <input
            disabled={!isAdminOrOwner}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              language === 'om'
                ? 'Sababa ykn yaadannoo cufiinsaa/baninsaa...'
                : 'Audit note for closing or reopening...'
            }
            className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </div>

        {statusMsg && (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-[#167C80]">
            <CheckCircle2 className="h-4 w-4" />
            <span>{statusMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {errorMsg}
          </div>
        )}

        {isAdminOrOwner && (
          <div className="mt-4 flex justify-end gap-2">
            {!isClosed ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveClosure('closed')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#167C80] px-4 py-2 text-xs font-semibold text-white hover:bg-[#126569] disabled:opacity-50"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>{language === 'om' ? 'Ji’a Cufi & Mirkaneessi' : 'Close & Sign Off Period'}</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => setReopenConfirmOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                <Unlock className="h-3.5 w-3.5" />
                <span>{language === 'om' ? 'Ji’a Deebisii Bani' : 'Reopen Closed Period'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Printable A4 Report Body */}
      <div
        id="printable-report"
        className="space-y-6 rounded-xl border border-[#C8D6E5] bg-white p-6 dark:border-slate-800 dark:bg-[#121D2B]"
      >
        <div className="border-b-4 border-[#C69C3D] bg-[#17365D] px-5 py-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/assets/aistudio/loog_6003b99d.jpg"
                alt="Al-Furqaan Center Logo"
                referrerPolicy="no-referrer"
                className="h-12 w-12 shrink-0 rounded-full border-2 border-[#C69C3D] bg-white object-cover"
              />
              <div>
                <h2 className="font-display text-base font-bold">
                  {t(language, 'centerFull')} — {language === 'om' ? 'Gabaasa Buusii Ji’aa' : 'Monthly Financial Report'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-200">
                  {t(language, 'centerLocation')} · {formatPeriodLabel(selectedPeriod, calendarMode, language)}
                </p>
              </div>
            </div>
            <div className="font-mono-num text-xs text-[#C69C3D] font-bold">
              {isClosed ? 'CLOSED PERIOD' : 'OPEN PERIOD'}
            </div>
          </div>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="text-slate-500">{t(language, 'activeMembers')}</div>
            <div className="font-mono-num mt-1 text-base font-bold text-[#17365D] dark:text-white">
              {periodSummary.activeMembersCount}
            </div>
          </div>
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="text-slate-500">{t(language, 'expectedContribution')}</div>
            <div className="font-mono-num mt-1 text-base font-bold text-[#17365D] dark:text-white">
              {periodSummary.expectedEtb.toLocaleString()} ETB
            </div>
          </div>
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="text-slate-500">{t(language, 'collectedTotal')}</div>
            <div className="font-mono-num mt-1 text-base font-bold text-[#167C80]">
              {periodSummary.collectedEtb.toLocaleString()} ETB
            </div>
          </div>
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="text-slate-500">{t(language, 'outstandingTotal')}</div>
            <div className="font-mono-num mt-1 text-base font-bold text-[#202833] dark:text-white">
              {periodSummary.outstandingEtb.toLocaleString()} ETB
            </div>
          </div>
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="text-slate-500">{t(language, 'collectionRate')}</div>
            <div className="font-mono-num mt-1 text-base font-bold text-[#17365D] dark:text-sky-300">
              {periodSummary.collectionRatePercent !== null
                ? `${periodSummary.collectionRatePercent.toFixed(1)}%`
                : 'N/A'}
            </div>
          </div>
        </div>

        {/* Monthly Member Breakdown Table (Omitted for Viewer/Member per REP-04) */}
        {canViewMemberDebtRows && (
          <div>
            <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-wider text-[#167C80]">
              {language === 'om'
                ? '1. Tarree Miseensotaa fi Shallaggii Ji’aa'
                : '1. Member-by-Member Monthly Breakdown'}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-[#C8D6E5] dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#17365D] text-[11px] font-semibold text-white uppercase">
                  <tr>
                    <th className="px-4 py-2">Code</th>
                    <th className="px-4 py-2">{language === 'om' ? 'Maqaa Guutuu' : 'Member'}</th>
                    <th className="px-4 py-2">{language === 'om' ? 'Haala' : 'Status'}</th>
                    <th className="px-4 py-2 text-right">{language === 'om' ? 'Waadaa' : 'Expected'}</th>
                    <th className="px-4 py-2 text-right">{language === 'om' ? 'Mirkanaa’e' : 'Collected'}</th>
                    <th className="px-4 py-2 text-right">{language === 'om' ? 'Haftee' : 'Outstanding'}</th>
                    <th className="px-4 py-2 text-right">{language === 'om' ? 'Ol-kaffaltii' : 'Overpay'}</th>
                    <th className="px-4 py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                  {periodSummary.rows.map((r, idx) => (
                    <tr
                      key={r.member.id}
                      className={idx % 2 === 1 ? 'bg-[#F3F7FA] dark:bg-slate-900/30' : ''}
                    >
                      <td className="font-mono-num px-4 py-2 font-semibold text-[#17365D] dark:text-sky-300">
                        {r.member.memberCode}
                      </td>
                      <td className="px-4 py-2 font-medium">{r.member.fullName}</td>
                      <td className="px-4 py-2 text-[11px]">
                        {getMemberStatusLabel(language, r.statusInPeriod)}
                      </td>
                      <td className="font-mono-num px-4 py-2 text-right">
                        {r.expectedEtb.toLocaleString()}
                      </td>
                      <td className="font-mono-num px-4 py-2 text-right font-semibold text-[#167C80]">
                        {r.collectedEtb.toLocaleString()}
                      </td>
                      <td className="font-mono-num px-4 py-2 text-right">
                        {r.outstandingEtb.toLocaleString()}
                      </td>
                      <td className="font-mono-num px-4 py-2 text-right text-[#C69C3D]">
                        {r.overpaymentEtb.toLocaleString()}
                      </td>
                      <td className="font-mono-num px-4 py-2 text-right">
                        {r.ratePercent !== null ? `${r.ratePercent.toFixed(1)}%` : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Annual 12-Month Breakdown */}
        <div>
          <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-wider text-[#167C80]">
            {language === 'om'
              ? `2. Cuunfaa Waggaa (${selectedPeriod.slice(0, 4)} — Ji’a 12)`
              : `2. Annual 12-Month Breakdown (${selectedPeriod.slice(0, 4)})`}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-[#C8D6E5] dark:border-slate-700">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#17365D] text-[11px] font-semibold text-white uppercase">
                <tr>
                  <th className="px-4 py-2">{language === 'om' ? 'Ji’a' : 'Period'}</th>
                  <th className="px-4 py-2 text-right">{language === 'om' ? 'Hojii Irra' : 'Active'}</th>
                  <th className="px-4 py-2 text-right">{language === 'om' ? 'Waadaa (ETB)' : 'Expected'}</th>
                  <th className="px-4 py-2 text-right">{language === 'om' ? 'Mirkanaa’e (ETB)' : 'Collected'}</th>
                  <th className="px-4 py-2 text-right">{language === 'om' ? 'Haftee' : 'Outstanding'}</th>
                  <th className="px-4 py-2 text-right">{language === 'om' ? 'Ol-kaffaltii' : 'Overpay'}</th>
                  <th className="px-4 py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                {annualBreakdown.map((ar, idx) => (
                  <tr
                    key={ar.periodKey}
                    className={`${
                      ar.periodKey === selectedPeriod
                        ? 'bg-[#EAF1F7] font-semibold dark:bg-sky-950/30'
                        : idx % 2 === 1
                        ? 'bg-[#F3F7FA] dark:bg-slate-900/30'
                        : ''
                    }`}
                  >
                    <td className="font-mono-num px-4 py-2">
                      {formatPeriodLabel(ar.periodKey, calendarMode, language)}
                    </td>
                    <td className="font-mono-num px-4 py-2 text-right">{ar.activeMembers}</td>
                    <td className="font-mono-num px-4 py-2 text-right">
                      {ar.expectedEtb.toLocaleString()}
                    </td>
                    <td className="font-mono-num px-4 py-2 text-right font-semibold text-[#167C80]">
                      {ar.collectedEtb.toLocaleString()}
                    </td>
                    <td className="font-mono-num px-4 py-2 text-right">
                      {ar.outstandingEtb.toLocaleString()}
                    </td>
                    <td className="font-mono-num px-4 py-2 text-right text-[#C69C3D]">
                      {ar.overpaymentEtb.toLocaleString()}
                    </td>
                    <td className="font-mono-num px-4 py-2 text-right">
                      {ar.ratePercent !== null ? `${ar.ratePercent.toFixed(1)}%` : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sign-off Footer Block */}
        <div className="grid grid-cols-1 gap-3 border-t border-[#C8D6E5] pt-4 sm:grid-cols-3 text-xs">
          <div className="rounded-lg border border-[#C8D6E5] p-3">
            <div className="text-[11px] text-slate-500">Qopheesse (Prepared By)</div>
            <div className="mt-1 font-semibold text-[#17365D] dark:text-white">
              {preparedBy || '________________'}
            </div>
          </div>
          <div className="rounded-lg border border-[#C8D6E5] p-3">
            <div className="text-[11px] text-slate-500">Ilaale (Reviewed By)</div>
            <div className="mt-1 font-semibold text-[#17365D] dark:text-white">
              {reviewedBy || '________________'}
            </div>
          </div>
          <div className="rounded-lg border border-[#C8D6E5] p-3">
            <div className="text-[11px] text-slate-500">Raggaase (Approved By)</div>
            <div className="mt-1 font-semibold text-[#17365D] dark:text-white">
              {approvedBy || '________________'}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={reopenConfirmOpen}
        title={language === 'om' ? 'Ji’a Cufame Deebisanii Banuu?' : 'Reopen Closed Period?'}
        description={`Period ${selectedPeriod} is currently closed. Reopening allows authorized edits and records an audit event. Please ensure an audit note is entered above.`}
        confirmLabel={language === 'om' ? 'Deebisii Bani' : 'Reopen Period'}
        destructive
        busy={saving}
        onConfirm={() => handleSaveClosure('open')}
        onCancel={() => setReopenConfirmOpen(false)}
      />
        </>
      )}
    </div>
  );
};
