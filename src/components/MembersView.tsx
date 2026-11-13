import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  BarChart2,
  Check,
  Copy,
  Download,
  Edit2,
  History,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  QrCode,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getContributionStatusLabel, getMemberStatusLabel, t } from '../i18n.ts';
import {
  createMember,
  deleteMember,
  fetchMemberHistory,
  logAuditEvent,
  recordCommitmentChange,
  recordStatusChange,
  updateMemberProfile,
} from '../services/firebase.ts';
import type {
  CalendarMode,
  CommitmentHistoryEntry,
  Contribution,
  Language,
  Member,
  MemberCategory,
  MemberStatus,
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
  getMemberCommitmentForPeriod,
  getMemberStatusForPeriod,
} from '../utils/financials.ts';
import { downloadMemberCardPdf } from '../utils/reportExporters.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface MembersViewProps {
  language: Language;
  calendarMode: CalendarMode;
  account: UserAccount;
  members: Member[];
  contributions: Contribution[];
  commitmentByMember: Record<string, CommitmentHistoryEntry[]>;
  statusByMember: Record<string, StatusHistoryEntry[]>;
  onHistoriesUpdated: () => Promise<void>;
  focusedMemberId?: string | null;
  onConsumeFocusedMember?: () => void;
}

export const MembersView: React.FC<MembersViewProps> = ({
  language,
  calendarMode,
  account,
  members,
  contributions,
  commitmentByMember,
  statusByMember,
  onHistoriesUpdated,
  focusedMemberId = null,
  onConsumeFocusedMember,
}) => {
  const isOwner = account.role === 'owner';
  const isAdminOrOwner = account.role === 'owner' || account.role === 'admin';
  const isCashierOrAbove = isAdminOrOwner || account.role === 'cashier';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MemberStatus>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);

  // History & Effective-Dated Changes Drawer/Modal
  const [historyMember, setHistoryMember] = useState<Member | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [commitmentList, setCommitmentList] = useState<CommitmentHistoryEntry[]>([]);
  const [statusList, setStatusList] = useState<StatusHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Graphical Contribution History Modal (Last 12 Months)
  const [contribHistoryMember, setContribHistoryMember] = useState<Member | null>(null);

  // Member Profile & Manual WhatsApp / SMS Payment Reminder Modal
  const [profileMember, setProfileMember] = useState<Member | null>(null);
  const [reminderMessage, setReminderMessage] = useState('');
  const [reminderCopied, setReminderCopied] = useState(false);
  const [reminderChannelNotice, setReminderChannelNotice] = useState<string | null>(null);

  // Printable Branded Membership Card with QR Code
  const [cardMember, setCardMember] = useState<Member | null>(null);
  const [cardQrDataUrl, setCardQrDataUrl] = useState<string>('');
  const [showCommitmentOnCard, setShowCommitmentOnCard] = useState(false);
  const [qrPayloadCopied, setQrPayloadCopied] = useState(false);

  const cardQrPayload = useMemo(() => {
    if (!cardMember) return '';
    return JSON.stringify({
      org: 'AL-FURQAAN',
      code: cardMember.memberCode,
      name: cardMember.fullName,
      id: cardMember.id,
    });
  }, [cardMember]);

  useEffect(() => {
    let cancelled = false;
    if (!cardQrPayload) {
      setCardQrDataUrl('');
      return;
    }
    QRCode.toDataURL(cardQrPayload, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#17365D',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (!cancelled) setCardQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setCardQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [cardQrPayload]);

  const normalizePhoneForWhatsApp = (rawPhone: string): string => {
    const cleaned = rawPhone.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned.slice(1);
    if (cleaned.startsWith('00')) return cleaned.slice(2);
    if (cleaned.startsWith('0') && cleaned.length >= 9) {
      return `251${cleaned.slice(1)}`;
    }
    return cleaned.replace(/\D/g, '');
  };

  const normalizePhoneForSms = (rawPhone: string): string => {
    const cleaned = rawPhone.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.startsWith('0') && cleaned.length >= 9) {
      return `+251${cleaned.slice(1)}`;
    }
    return cleaned;
  };

  const buildReminderDraft = (
    m: Member,
    lang: Language,
    standingRow?: ReturnType<typeof calculateMemberStandingSummary>['rows'][number]
  ): string => {
    const periodLabel = formatPeriodLabel(currentPeriodKey(), calendarMode, lang);
    const arrearsEtb = standingRow?.arrearsEtb ?? 0;
    const arrearsMonths = standingRow?.monthsInArrears ?? [];
    if (lang === 'om') {
      return arrearsEtb > 0
        ? `Assalaamu Alaikum ${m.fullName} (${m.memberCode}), Markaz Al-Furqaan irraa yaadachiisa buusii: hanga ${periodLabel}tti haftee ji'a ${arrearsMonths.length} (${arrearsEtb.toLocaleString()} ETB) qabdu. Maaloo karaa CBE, Telebirr ykn Coop Bank kaffalaa ragaa ergaa. Galatoomaa! (+251991272425)`
        : `Assalaamu Alaikum ${m.fullName} (${m.memberCode}), Markaz Al-Furqaan irraa yaadachiisa buusii ji'aa (${periodLabel}): waadaan keessan ${m.monthlyCommitment.toLocaleString()} ETB dha. Tajaajila fi deeggarsa keessaniif Baarakallaahu fiikum! (+251991272425)`;
    }
    return arrearsEtb > 0
      ? `Assalamu Alaikum ${m.fullName} (${m.memberCode}), friendly payment reminder from Al-Furqaan Center: as of ${periodLabel}, your outstanding contribution balance is ${arrearsEtb.toLocaleString()} ETB (${arrearsMonths.length} month(s)). Please settle via CBE, Telebirr, or Coop Bank and share your receipt. Barakallahu feekum! (+251991272425)`
      : `Assalamu Alaikum ${m.fullName} (${m.memberCode}), monthly buusii reminder from Al-Furqaan Center (${periodLabel}): monthly commitment ${m.monthlyCommitment.toLocaleString()} ETB. Thank you for your continued support! (+251991272425)`;
  };

  const profileStanding = useMemo(() => {
    if (!profileMember) return null;
    const summary = calculateMemberStandingSummary(
      currentPeriodKey(),
      [profileMember],
      commitmentByMember,
      statusByMember,
      contributions
    );
    return summary.rows[0] || null;
  }, [profileMember, commitmentByMember, statusByMember, contributions]);

  const openProfileModal = (m: Member) => {
    const summary = calculateMemberStandingSummary(
      currentPeriodKey(),
      [m],
      commitmentByMember,
      statusByMember,
      contributions
    );
    setProfileMember(m);
    setReminderMessage(buildReminderDraft(m, language, summary.rows[0]));
    setReminderCopied(false);
    setReminderChannelNotice(null);
  };

  useEffect(() => {
    if (!focusedMemberId) return;
    const match = members.find((m) => m.id === focusedMemberId);
    if (match) {
      openProfileModal(match);
      onConsumeFocusedMember?.();
    }
  }, [focusedMemberId, members]);

  const handleLogReminderTrigger = async (channel: 'whatsapp' | 'sms') => {
    if (!profileMember || !isAdminOrOwner) return;
    setReminderChannelNotice(
      language === 'om'
        ? `Yaadachiisni kaffaltii karaa ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} gara ${profileMember.phone} banameera.`
        : `Payment reminder via ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} opened for ${profileMember.phone}.`
    );
    try {
      await logAuditEvent(
        account,
        'TRIGGER_PAYMENT_REMINDER',
        'member',
        profileMember.id,
        `Admin triggered ${channel.toUpperCase()} payment reminder to ${profileMember.fullName} (${profileMember.phone || 'no-phone'}).`
      );
    } catch {
      // Non-blocking audit log
    }
  };

  const contribHistoryData = useMemo(() => {
    if (!contribHistoryMember) return null;
    const endPeriod = currentPeriodKey();
    const [endY, endM] = endPeriod.split('-').map(Number);
    const months: string[] = [];
    for (let offset = 11; offset >= 0; offset -= 1) {
      const d = new Date(Date.UTC(endY, endM - 1 - offset, 1));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      months.push(`${y}-${m}`);
    }

    const memberCommitments = commitmentByMember[contribHistoryMember.id] || [];
    const memberStatuses = statusByMember[contribHistoryMember.id] || [];
    const memberContribs = contributions.filter(
      (c) => c.memberId === contribHistoryMember.id
    );

    const timeline = months.map((periodKey) => {
      const statusInPeriod = getMemberStatusForPeriod(
        contribHistoryMember,
        periodKey,
        memberStatuses
      );
      const expectedEtb =
        statusInPeriod === 'active'
          ? getMemberCommitmentForPeriod(contribHistoryMember, periodKey, memberCommitments)
          : 0;
      const confirmedEtb = memberContribs
        .filter((c) => c.month === periodKey && c.status === 'confirmed')
        .reduce((s, c) => s + c.amount, 0);
      const pendingEtb = memberContribs
        .filter((c) => c.month === periodKey && c.status === 'pending')
        .reduce((s, c) => s + c.amount, 0);

      let consistency: 'met' | 'partial' | 'pending' | 'missed' | 'inactive' = 'inactive';
      if (statusInPeriod === 'active' && expectedEtb > 0) {
        if (confirmedEtb >= expectedEtb) consistency = 'met';
        else if (confirmedEtb > 0) consistency = 'partial';
        else if (pendingEtb > 0) consistency = 'pending';
        else consistency = 'missed';
      } else if (confirmedEtb > 0) {
        consistency = 'met';
      } else if (pendingEtb > 0) {
        consistency = 'pending';
      }

      const shortLabel =
        calendarMode === 'gregorian'
          ? periodKey.slice(2)
          : formatPeriodLabel(periodKey, 'ethiopian', language).split(' ')[0].slice(0, 4) +
            ' ' +
            periodKey.slice(2);

      return {
        periodKey,
        shortLabel,
        statusInPeriod,
        expectedEtb,
        confirmedEtb,
        pendingEtb,
        outstandingEtb: Math.max(0, expectedEtb - confirmedEtb),
        consistency,
      };
    });

    const activeMonths = timeline.filter((tRow) => tRow.expectedEtb > 0);
    const metMonths = activeMonths.filter((tRow) => tRow.confirmedEtb >= tRow.expectedEtb);
    const totalExpected = timeline.reduce((s, tRow) => s + tRow.expectedEtb, 0);
    const totalConfirmed = timeline.reduce((s, tRow) => s + tRow.confirmedEtb, 0);
    const totalArrears = timeline.reduce((s, tRow) => s + tRow.outstandingEtb, 0);
    const consistencyPct =
      activeMonths.length > 0
        ? Math.round((metMonths.length / activeMonths.length) * 100)
        : 100;

    const minPeriod = months[0];
    const recentPayments = memberContribs
      .filter((c) => c.month >= minPeriod)
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));

    return {
      timeline,
      activeMonthsCount: activeMonths.length,
      metMonthsCount: metMonths.length,
      totalExpected,
      totalConfirmed,
      totalArrears,
      consistencyPct,
      recentPayments,
      commitmentEvents: [...memberCommitments].sort((a, b) =>
        b.effectiveFrom.localeCompare(a.effectiveFrom)
      ),
    };
  }, [
    contribHistoryMember,
    commitmentByMember,
    statusByMember,
    contributions,
    calendarMode,
    language,
  ]);

  const [commitForm, setCommitForm] = useState({
    amountEtb: '',
    effectiveFrom: new Date().toISOString().slice(0, 7),
    reason: '',
  });
  const [statusForm, setStatusForm] = useState({
    status: 'active' as MemberStatus,
    effectiveFrom: new Date().toISOString().slice(0, 7),
    reason: '',
  });

  const [form, setForm] = useState({
    memberCode: '',
    fullName: '',
    phone: '',
    email: '',
    location: 'Chiro, West Hararghe',
    birthDate: '',
    category: 'monthly' as MemberCategory,
    monthlyCommitment: '1000',
    status: 'active' as MemberStatus,
    joinedDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (!q) return true;
      return (
        m.fullName.toLowerCase().includes(q) ||
        m.memberCode.toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q) ||
        (m.location || '').toLowerCase().includes(q)
      );
    });
  }, [members, search, statusFilter]);

  const generateNextCode = () => {
    let maxNum = members.length;
    for (const m of members) {
      const match = /(\d+)$/.exec(m.memberCode);
      if (match) {
        maxNum = Math.max(maxNum, Number(match[1]));
      }
    }
    return `AFQ-${String(maxNum + 1).padStart(3, '0')}`;
  };

  const openCreateModal = () => {
    setEditingMember(null);
    setForm({
      memberCode: generateNextCode(),
      fullName: '',
      phone: '',
      email: '',
      location: 'Chiro, West Hararghe',
      birthDate: '',
      category: 'monthly',
      monthlyCommitment: '1000',
      status: 'active',
      joinedDate: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (m: Member) => {
    setEditingMember(m);
    setForm({
      memberCode: m.memberCode,
      fullName: m.fullName,
      phone: m.phone || '',
      email: m.email || '',
      location: m.location || '',
      birthDate: m.birthDate || '',
      category: m.category,
      monthlyCommitment: String(m.monthlyCommitment),
      status: m.status,
      joinedDate: m.joinedDate,
      notes: m.notes || '',
    });
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openHistoryModal = async (m: Member) => {
    setHistoryMember(m);
    setHistoryLoading(true);
    setHistoryError(null);
    setCommitForm({
      amountEtb: String(m.monthlyCommitment),
      effectiveFrom: new Date().toISOString().slice(0, 7),
      reason: '',
    });
    setStatusForm({
      status: m.status,
      effectiveFrom: new Date().toISOString().slice(0, 7),
      reason: '',
    });
    try {
      const res = await fetchMemberHistory(m.id);
      setCommitmentList(res.commitments);
      setStatusList(res.statuses);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Unable to load history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = form.memberCode.trim();
    const fullName = form.fullName.trim();
    const commitment = Number(form.monthlyCommitment);

    if (!code || !fullName || !form.joinedDate) {
      setErrorMsg(
        language === 'om'
          ? 'Koodii miseensaa, maqaa guutuu fi guyyaan seensaa dirqama.'
          : 'Member code, full name, and start date are required.'
      );
      return;
    }

    if (!Number.isFinite(commitment) || commitment <= 0) {
      setErrorMsg(
        language === 'om'
          ? 'Waadaan ji’aa (ETB) zeeroo ol ta’uu qaba.'
          : 'Monthly commitment (ETB) must be greater than zero.'
      );
      return;
    }

    // MEM-06: Prevent accidental future start month
    const currentMonth = new Date().toISOString().slice(0, 7);
    const startMonth = form.joinedDate.slice(0, 7);
    if (startMonth > currentMonth) {
      setErrorMsg(
        language === 'om'
          ? `Ji'i jalqabaa (${startMonth}) ji'a ammaa (${currentMonth}) caaluu hin danda'u.`
          : `Start month (${startMonth}) cannot be in the future beyond ${currentMonth}.`
      );
      return;
    }

    // MEM-02 / T-02: Prevent duplicate memberCode
    const duplicate = members.find(
      (m) =>
        m.memberCode.toLowerCase() === code.toLowerCase() &&
        m.id !== editingMember?.id
    );
    if (duplicate) {
      setErrorMsg(
        language === 'om'
          ? `Koodiin miseensaa "${code}" duraan galmaa'eera. Koodii adda ta'e fayyadami.`
          : `Duplicate Member ID "${code}" already exists. Member IDs must be unique.`
      );
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      if (editingMember) {
        await updateMemberProfile(account, editingMember.id, {
          memberCode: code,
          fullName,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          location: form.location.trim() || undefined,
          birthDate: form.birthDate.trim() || undefined,
          category: form.category,
          joinedDate: form.joinedDate,
          notes: form.notes.trim() || undefined,
        });
      } else {
        await createMember(account, {
          memberCode: code,
          fullName,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          location: form.location.trim() || undefined,
          birthDate: form.birthDate.trim() || undefined,
          category: form.category,
          monthlyCommitment: commitment,
          status: form.status,
          joinedDate: form.joinedDate,
          effectiveMonth: startMonth,
          notes: form.notes.trim() || undefined,
        });
      }
      await onHistoriesUpdated();
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save member.');
    } finally {
      setSaving(false);
    }
  };

  const handleCommitmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!historyMember) return;
    const amt = Number(commitForm.amountEtb);
    if (!amt || amt <= 0) {
      setHistoryError('Amount must be greater than zero.');
      return;
    }
    if (commitForm.reason.trim().length < 2) {
      setHistoryError(
        language === 'om'
          ? 'Sababa jijjiirama waadaa galchi.'
          : 'Reason for commitment change is required.'
      );
      return;
    }
    setSaving(true);
    setHistoryError(null);
    try {
      await recordCommitmentChange(
        account,
        historyMember.id,
        amt,
        commitForm.effectiveFrom,
        commitForm.reason.trim()
      );
      const res = await fetchMemberHistory(historyMember.id);
      setCommitmentList(res.commitments);
      setCommitForm((prev) => ({ ...prev, reason: '' }));
      await onHistoriesUpdated();
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to update commitment.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!historyMember) return;
    if (statusForm.reason.trim().length < 2) {
      setHistoryError(
        language === 'om'
          ? 'Sababa jijjiirama haalaa galchi.'
          : 'Reason for status change is required.'
      );
      return;
    }
    setSaving(true);
    setHistoryError(null);
    try {
      await recordStatusChange(
        account,
        historyMember.id,
        statusForm.status,
        statusForm.effectiveFrom,
        statusForm.reason.trim()
      );
      const res = await fetchMemberHistory(historyMember.id);
      setStatusList(res.statuses);
      setStatusForm((prev) => ({ ...prev, reason: '' }));
      await onHistoriesUpdated();
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteMember(account, deleteTarget.id);
      setDeleteTarget(null);
      await onHistoriesUpdated();
    } finally {
      setSaving(false);
    }
  };

  if (account.role === 'viewer') {
    return (
      <div className="rounded-xl border border-[#C8D6E5] bg-white p-8 text-center text-xs text-slate-600 dark:border-slate-800 dark:bg-[#121D2B] dark:text-slate-300">
        {t(language, 'viewerPrivacyBanner')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(language, 'searchPlaceholder')}
              className="w-full rounded-lg border border-[#C8D6E5] bg-white py-2 pr-3 pl-8 text-xs text-[#202833] outline-none focus:border-[#17365D] dark:border-slate-800 dark:bg-[#121D2B] dark:text-white"
            />
          </div>

          <div className="inline-flex rounded-lg border border-[#C8D6E5] bg-white p-0.5 text-xs dark:border-slate-800 dark:bg-[#121D2B]">
            {(['all', 'active', 'paused', 'ended'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-2.5 py-1 transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-[#17365D] font-semibold text-white'
                    : 'text-slate-600 hover:text-[#17365D] dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {st === 'all'
                  ? language === 'om'
                    ? 'Hunda'
                    : 'All'
                  : getMemberStatusLabel(language, st)}
              </button>
            ))}
          </div>
        </div>

        {isAdminOrOwner && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#17365D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1E477A]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t(language, 'addMember')}</span>
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#C8D6E5] bg-white dark:border-slate-800 dark:bg-[#121D2B]">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {isCashierOrAbove
                ? language === 'om'
                  ? 'Miseensi ulaagaa kana guutu hin argamne.'
                  : 'No members match your filter.'
                : language === 'om'
                ? 'Galmeen miseensummaa account keetiin walqabate hin jiru.'
                : 'No membership record is currently linked to your account.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#17365D] text-[11px] font-semibold tracking-wider text-white uppercase">
                <tr>
                  <th className="px-5 py-2.5">Code</th>
                  <th className="px-4 py-2.5">{language === 'om' ? 'Maqaa Guutuu' : 'Full Name'}</th>
                  <th className="px-4 py-2.5">{language === 'om' ? 'Bilbila · Email' : 'Contact'}</th>
                  <th className="px-4 py-2.5">{language === 'om' ? 'Guyyaa Seensaa' : 'Joined'}</th>
                  <th className="px-4 py-2.5 text-right">{language === 'om' ? 'Waadaa (ETB)' : 'Commitment'}</th>
                  <th className="px-4 py-2.5">{language === 'om' ? 'Haala' : 'Status'}</th>
                  <th className="px-5 py-2.5 text-right">{language === 'om' ? 'Tarkaanfii' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                {filtered.map((m, idx) => (
                  <tr
                    key={m.id}
                    onClick={() => openProfileModal(m)}
                    className={`cursor-pointer transition-colors hover:bg-[#EAF1F7]/70 dark:hover:bg-slate-800/60 ${
                      idx % 2 === 1 ? 'bg-[#F3F7FA] dark:bg-slate-900/30' : ''
                    }`}
                  >
                    <td className="font-mono-num px-5 py-2.5 font-semibold text-[#17365D] dark:text-sky-300">
                      {m.memberCode}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-[#202833] dark:text-white">
                      <div className="font-semibold text-[#17365D] underline-offset-2 hover:underline dark:text-sky-200">
                        {m.fullName}
                      </div>
                      {(m.location || m.birthDate) && (
                        <div className="text-[11px] font-normal text-slate-500">
                          {m.location && <span>{m.location}</span>}
                          {m.location && m.birthDate && <span aria-hidden="true"> · </span>}
                          {m.birthDate && (
                            <span className="font-mono-num">
                              {language === 'om' ? 'Dhaloota:' : 'DOB:'}{' '}
                              {formatDateByCalendar(m.birthDate, calendarMode)}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                      <span className="font-mono-num">{m.phone || '—'}</span>
                      {m.email ? <span className="text-slate-400"> · {m.email}</span> : null}
                    </td>
                    <td className="font-mono-num px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {formatDateByCalendar(m.joinedDate, calendarMode)}
                    </td>
                    <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-[#202833] dark:text-white">
                      {m.monthlyCommitment.toLocaleString()} ETB
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-[11px] font-semibold uppercase ${
                          m.status === 'active'
                            ? 'text-[#167C80] dark:text-teal-400'
                            : m.status === 'paused'
                            ? 'text-[#C69C3D]'
                            : 'text-slate-500'
                        }`}
                      >
                        {getMemberStatusLabel(language, m.status)}
                      </span>
                    </td>
                    <td
                      className="px-5 py-2.5 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openProfileModal(m)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-[#17365D] hover:bg-[#EAF1F7] dark:text-sky-300 dark:hover:bg-slate-800"
                          title={
                            language === 'om'
                              ? 'Profaayilii Miseensaa & Yaadachiisa'
                              : 'View Member Profile & Reminder'
                          }
                        >
                          <User className="h-3.5 w-3.5 text-[#C69C3D]" />
                          <span>{language === 'om' ? 'Profaayilii' : 'Profile'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setQrPayloadCopied(false);
                            setCardMember(m);
                          }}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-[#17365D] hover:bg-[#EAF1F7] dark:text-sky-300 dark:hover:bg-slate-800"
                          title={
                            language === 'om'
                              ? 'Kaardii Miseensummaa & QR Code'
                              : 'Branded Membership Card & QR Code'
                          }
                        >
                          <QrCode className="h-3.5 w-3.5 text-[#17365D] dark:text-sky-300" />
                          <span>{language === 'om' ? 'Kaardii' : 'ID Card'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setContribHistoryMember(m)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-[#17365D] hover:bg-[#EAF1F7] dark:text-sky-300 dark:hover:bg-slate-800"
                          title={
                            language === 'om'
                              ? 'Seenaa Kaffaltii Ji’a 12'
                              : 'Contribution History (Last 12 Months)'
                          }
                        >
                          <BarChart2 className="h-3.5 w-3.5 text-[#167C80]" />
                          <span>{language === 'om' ? 'Buusii' : 'Contrib. History'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistoryModal(m)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-[#167C80] hover:bg-[#EAF1F7] dark:text-teal-400 dark:hover:bg-slate-800"
                          title="Commitment & Status History"
                        >
                          <History className="h-3.5 w-3.5" />
                          <span>{language === 'om' ? 'Seenaa' : 'History'}</span>
                        </button>
                        {isAdminOrOwner && (
                          <button
                            type="button"
                            onClick={() => openEditModal(m)}
                            className="rounded p-1 text-slate-500 hover:bg-[#EAF1F7] hover:text-[#17365D] dark:hover:bg-slate-800 dark:hover:text-white"
                            title={t(language, 'edit')}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(m)}
                            className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                            title="Delete (Owner)"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Member Profile Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/aistudio/loog_6003b99d.jpg"
                  alt="Al-Furqaan Center Logo"
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
                />
                <h3 className="font-display text-base font-semibold text-[#17365D] dark:text-white">
                  {editingMember
                    ? language === 'om'
                      ? 'Odeeffannoo Miseensaa Gulaali'
                      : 'Edit Member Profile'
                    : t(language, 'addMember')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA] dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Koodii Miseensaa *' : 'Member Code *'}
                  </label>
                  <input
                    required
                    maxLength={32}
                    value={form.memberCode}
                    onChange={(e) => setForm({ ...form, memberCode: e.target.value })}
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Guyyaa Seensaa *' : 'Start / Joined Date *'}
                  </label>
                  <input
                    required
                    type="date"
                    value={form.joinedDate}
                    onChange={(e) => setForm({ ...form, joinedDate: e.target.value })}
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                  {form.joinedDate && (
                    <div className="font-mono-num mt-1 text-[11px] text-[#167C80] dark:text-teal-400">
                      EC: {formatEthiopianShort(form.joinedDate)}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  {language === 'om' ? 'Maqaa Guutuu *' : 'Full Name *'}
                </label>
                <input
                  required
                  maxLength={120}
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Bilbila (Filannoo)' : 'Phone (Optional)'}
                  </label>
                  <input
                    maxLength={32}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+2519..."
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Email (Filannoo)' : 'Email (Optional)'}
                  </label>
                  <input
                    type="email"
                    maxLength={200}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Teessoo (Filannoo)' : 'Location (Optional)'}
                  </label>
                  <input
                    maxLength={160}
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Guyyaa Dhalootaa (Filannoo)' : 'Birth Date (Optional)'}
                  </label>
                  <input
                    type="date"
                    value={form.birthDate}
                    onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                  {form.birthDate && (
                    <div className="font-mono-num mt-1 text-[11px] text-[#167C80] dark:text-teal-400">
                      EC: {formatEthiopianShort(form.birthDate)}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {!editingMember ? (
                  <div>
                    <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                      {language === 'om' ? 'Waadaa Ji’aa (ETB) *' : 'Monthly Commitment (ETB) *'}
                    </label>
                    <input
                      required
                      type="number"
                      min={1}
                      value={form.monthlyCommitment}
                      onChange={(e) => setForm({ ...form, monthlyCommitment: e.target.value })}
                      className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                ) : (
                  <div className="flex items-end">
                    <div className="w-full rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] px-3 py-2 text-[11px] text-[#17365D] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {language === 'om'
                        ? 'Waadaa/Haala jijjiiruuf "Seenaa" fayyadami.'
                        : 'Use "History" to change commitment or status.'}
                    </div>
                  </div>
                )}
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Gosa Miseensaa' : 'Category'}
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as MemberCategory })}
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="monthly">Monthly Supporter</option>
                    <option value="sponsor">Student Sponsor</option>
                    <option value="lifetime">Lifetime Supporter</option>
                    <option value="donor">General Donor</option>
                  </select>
                </div>
              </div>

              {!editingMember && (
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Haala Jalqabaa' : 'Initial Status'}
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as MemberStatus })}
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="active">{getMemberStatusLabel(language, 'active')}</option>
                    <option value="paused">{getMemberStatusLabel(language, 'paused')}</option>
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  {language === 'om' ? 'Yaadannoo' : 'Notes'}
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              {errorMsg && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  {errorMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-[#C8D6E5] px-4 py-2 font-medium text-slate-700 hover:bg-[#F3F7FA] dark:border-slate-700 dark:text-slate-200"
                >
                  {t(language, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#17365D] px-4 py-2 font-semibold text-white hover:bg-[#1E477A] disabled:opacity-60"
                >
                  {saving ? 'Olkaa’amaa jira...' : t(language, 'save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Effective-Dated Commitment & Status History Modal */}
      {historyMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/45 p-4 backdrop-blur-[2px]">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-center justify-between border-b border-[#C8D6E5] pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/aistudio/loog_6003b99d.jpg"
                  alt="Al-Furqaan Center Logo"
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
                />
                <div>
                  <h3 className="font-display text-base font-bold text-[#17365D] dark:text-white">
                    {historyMember.memberCode} — {historyMember.fullName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {language === 'om'
                      ? 'Seenaa Waadaa Ji’aa fi Haala Miseensummaa (Effective-Dated History)'
                      : 'Effective-Dated Commitment & Membership Status History (BR-03 / BR-04)'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryMember(null)}
                className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {historyError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                {historyError}
              </div>
            )}

            {historyLoading ? (
              <div className="py-10 text-center text-xs text-slate-500">
                {t(language, 'loading')}
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Commitment History Column */}
                <div className="space-y-4">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#17365D] dark:text-sky-300">
                    {language === 'om' ? 'Seenaa Waadaa (ETB)' : 'Commitment History'}
                  </h4>

                  <div className="divide-y divide-[#C8D6E5]/60 rounded-lg border border-[#C8D6E5] text-xs dark:divide-slate-800 dark:border-slate-700">
                    {commitmentList.length === 0 ? (
                      <div className="p-3 text-slate-500">
                        Base commitment: {historyMember.monthlyCommitment.toLocaleString()} ETB
                      </div>
                    ) : (
                      commitmentList.map((entry) => (
                        <div key={entry.id} className="p-3">
                          <div className="flex items-center justify-between font-semibold">
                            <span className="font-mono-num text-[#17365D] dark:text-sky-300">
                              {formatPeriodLabel(entry.effectiveFrom, calendarMode, language)}
                            </span>
                            <span className="font-mono-num text-[#167C80] dark:text-teal-400">
                              {entry.amountEtb.toLocaleString()} ETB
                            </span>
                          </div>
                          <div className="mt-1 text-slate-600 dark:text-slate-300">
                            {entry.reason}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {entry.changedByName}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {isAdminOrOwner && (
                    <form
                      onSubmit={handleCommitmentSubmit}
                      className="space-y-2.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3.5 text-xs dark:border-slate-700 dark:bg-slate-900/50"
                    >
                      <div className="font-semibold text-[#17365D] dark:text-white">
                        {language === 'om'
                          ? 'Waadaa Haaraa Jijjiiri (Ji’a Irratti Hundaa’e)'
                          : 'Record Effective-Dated Commitment Change'}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          required
                          type="number"
                          min={1}
                          value={commitForm.amountEtb}
                          onChange={(e) =>
                            setCommitForm({ ...commitForm, amountEtb: e.target.value })
                          }
                          placeholder="ETB"
                          className="font-mono-num rounded border border-[#C8D6E5] bg-white px-2.5 py-1.5 outline-none dark:border-slate-700 dark:bg-slate-900"
                        />
                        <input
                          required
                          type="month"
                          value={commitForm.effectiveFrom}
                          onChange={(e) =>
                            setCommitForm({ ...commitForm, effectiveFrom: e.target.value })
                          }
                          className="font-mono-num rounded border border-[#C8D6E5] bg-white px-2.5 py-1.5 outline-none dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                      <input
                        required
                        minLength={2}
                        maxLength={300}
                        value={commitForm.reason}
                        onChange={(e) =>
                          setCommitForm({ ...commitForm, reason: e.target.value })
                        }
                        placeholder={
                          language === 'om'
                            ? 'Sababa jijjiiramaa (dirqama)...'
                            : 'Reason for change (required)...'
                        }
                        className="w-full rounded border border-[#C8D6E5] bg-white px-2.5 py-1.5 outline-none dark:border-slate-700 dark:bg-slate-900"
                      />
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full rounded-lg bg-[#17365D] py-1.5 font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
                      >
                        {language === 'om' ? 'Waadaa Jijjiiri' : 'Apply Commitment Change'}
                      </button>
                    </form>
                  )}
                </div>

                {/* Status History Column */}
                <div className="space-y-4">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#167C80] dark:text-teal-400">
                    {language === 'om' ? 'Seenaa Haala Miseensummaa' : 'Status History'}
                  </h4>

                  <div className="divide-y divide-[#C8D6E5]/60 rounded-lg border border-[#C8D6E5] text-xs dark:divide-slate-800 dark:border-slate-700">
                    {statusList.length === 0 ? (
                      <div className="p-3 text-slate-500">
                        Current status: {getMemberStatusLabel(language, historyMember.status)}
                      </div>
                    ) : (
                      statusList.map((entry) => (
                        <div key={entry.id} className="p-3">
                          <div className="flex items-center justify-between font-semibold">
                            <span className="font-mono-num text-[#17365D] dark:text-sky-300">
                              {formatPeriodLabel(entry.effectiveFrom, calendarMode, language)}
                            </span>
                            <span className="uppercase text-[#167C80] dark:text-teal-400">
                              {getMemberStatusLabel(language, entry.status)}
                            </span>
                          </div>
                          <div className="mt-1 text-slate-600 dark:text-slate-300">
                            {entry.reason}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {entry.changedByName}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {isAdminOrOwner && (
                    <form
                      onSubmit={handleStatusSubmit}
                      className="space-y-2.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3.5 text-xs dark:border-slate-700 dark:bg-slate-900/50"
                    >
                      <div className="font-semibold text-[#17365D] dark:text-white">
                        {language === 'om'
                          ? 'Haala Miseensaa Jijjiiri (Active / Paused / Ended)'
                          : 'Record Effective-Dated Status Change'}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={statusForm.status}
                          onChange={(e) =>
                            setStatusForm({
                              ...statusForm,
                              status: e.target.value as MemberStatus,
                            })
                          }
                          className="rounded border border-[#C8D6E5] bg-white px-2.5 py-1.5 outline-none dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="active">{getMemberStatusLabel(language, 'active')}</option>
                          <option value="paused">{getMemberStatusLabel(language, 'paused')}</option>
                          <option value="ended">{getMemberStatusLabel(language, 'ended')}</option>
                        </select>
                        <input
                          required
                          type="month"
                          value={statusForm.effectiveFrom}
                          onChange={(e) =>
                            setStatusForm({ ...statusForm, effectiveFrom: e.target.value })
                          }
                          className="font-mono-num rounded border border-[#C8D6E5] bg-white px-2.5 py-1.5 outline-none dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                      <input
                        required
                        minLength={2}
                        maxLength={300}
                        value={statusForm.reason}
                        onChange={(e) =>
                          setStatusForm({ ...statusForm, reason: e.target.value })
                        }
                        placeholder={
                          language === 'om'
                            ? 'Sababa (fkn: hayyama dhaabbii)...'
                            : 'Reason for pause/resume/end (required)...'
                        }
                        className="w-full rounded border border-[#C8D6E5] bg-white px-2.5 py-1.5 outline-none dark:border-slate-700 dark:bg-slate-900"
                      />
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full rounded-lg bg-[#167C80] py-1.5 font-semibold text-white hover:bg-[#126569] disabled:opacity-50"
                      >
                        {language === 'om' ? 'Haala Jijjiiri' : 'Apply Status Change'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Graphical 12-Month Contribution History Modal */}
      {contribHistoryMember && contribHistoryData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/45 p-4 backdrop-blur-[2px]">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-center justify-between border-b border-[#C8D6E5] pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/aistudio/loog_6003b99d.jpg"
                  alt="Al-Furqaan Center Logo"
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
                />
                <div>
                  <h3 className="font-display text-base font-bold text-[#17365D] dark:text-white">
                    {language === 'om'
                      ? 'Seenaa Kaffaltii & Waadaa (Ji’oota 12 Darban)'
                      : 'Contribution History & Consistency Timeline (Last 12 Months)'}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono-num font-semibold text-[#17365D] dark:text-sky-300">
                      {contribHistoryMember.memberCode}
                    </span>{' '}
                    · {contribHistoryMember.fullName} ·{' '}
                    {getMemberStatusLabel(language, contribHistoryMember.status)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setContribHistoryMember(null)}
                className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA] dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-5">
              {/* 4 Summary Metrics */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-slate-500 dark:text-slate-400">
                    {language === 'om' ? 'Waadaa Ji’a 12' : '12M Commitment'}
                  </div>
                  <div className="font-mono-num mt-1 text-base font-bold text-[#17365D] dark:text-white">
                    {contribHistoryData.totalExpected.toLocaleString()} ETB
                  </div>
                </div>
                <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-slate-500 dark:text-slate-400">
                    {language === 'om' ? 'Mirkanaa’e' : 'Confirmed Paid'}
                  </div>
                  <div className="font-mono-num mt-1 text-base font-bold text-[#167C80] dark:text-teal-400">
                    {contribHistoryData.totalConfirmed.toLocaleString()} ETB
                  </div>
                </div>
                <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-slate-500 dark:text-slate-400">
                    {language === 'om' ? 'Cimina Yeroo (Consistency)' : 'Consistency'}
                  </div>
                  <div className="font-mono-num mt-1 text-base font-bold text-[#17365D] dark:text-sky-300">
                    {contribHistoryData.consistencyPct}%
                    <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                      ({contribHistoryData.metMonthsCount}/{contribHistoryData.activeMonthsCount})
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-slate-500 dark:text-slate-400">
                    {language === 'om' ? 'Haftee Ji’a 12' : '12M Arrears'}
                  </div>
                  <div
                    className={`font-mono-num mt-1 text-base font-bold ${
                      contribHistoryData.totalArrears > 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-[#167C80] dark:text-teal-400'
                    }`}
                  >
                    {contribHistoryData.totalArrears.toLocaleString()} ETB
                  </div>
                </div>
              </div>

              {/* 12-Month Visual Consistency Strip */}
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-semibold uppercase tracking-wider text-[#17365D] dark:text-slate-300">
                    {language === 'om'
                      ? 'Cimina Kaffaltii Ji’a 12'
                      : '12-Month Consistency Strip'}
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-[#167C80]" />
                      {language === 'om' ? 'Guutuu' : 'Met'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-[#C69C3D]" />
                      {language === 'om' ? 'Gartokkee / Pending' : 'Partial / Pending'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-red-600" />
                      {language === 'om' ? 'Hin Kaffalamne' : 'Missed'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-slate-300 dark:bg-slate-700" />
                      {language === 'om' ? 'Dhaabbate / Hin Seenne' : 'Inactive'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
                  {contribHistoryData.timeline.map((mRow) => {
                    const bgClass =
                      mRow.consistency === 'met'
                        ? 'border-[#167C80] bg-[#167C80]/10 text-[#167C80] dark:bg-teal-950/40 dark:text-teal-300'
                        : mRow.consistency === 'partial' || mRow.consistency === 'pending'
                        ? 'border-[#C69C3D] bg-[#C69C3D]/15 text-[#9A7420] dark:bg-amber-950/40 dark:text-amber-300'
                        : mRow.consistency === 'missed'
                        ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                        : 'border-[#C8D6E5] bg-[#F3F7FA] text-slate-400 dark:border-slate-800 dark:bg-slate-900/40';
                    return (
                      <div
                        key={mRow.periodKey}
                        title={`${formatPeriodLabel(mRow.periodKey, calendarMode, language)} — Exp: ${mRow.expectedEtb} ETB, Paid: ${mRow.confirmedEtb} ETB`}
                        className={`rounded-lg border p-2 text-center ${bgClass}`}
                      >
                        <div className="font-mono-num text-[10px] font-bold">
                          {mRow.periodKey.slice(2)}
                        </div>
                        <div className="font-mono-num mt-1 text-[11px] font-semibold">
                          {mRow.confirmedEtb > 0
                            ? `${mRow.confirmedEtb.toLocaleString()}`
                            : mRow.pendingEtb > 0
                            ? `~${mRow.pendingEtb.toLocaleString()}`
                            : mRow.consistency === 'missed'
                            ? '0'
                            : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Graphical Timeline Chart (Payments vs Commitment Line) */}
              <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA]/60 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-display font-semibold text-[#17365D] dark:text-white">
                    {language === 'om'
                      ? 'Giraafii Kaffaltii fi Waadaa (ETB)'
                      : 'Payments vs. Commitment Timeline (ETB)'}
                  </span>
                  <div className="flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-[#167C80]" />
                      {language === 'om' ? 'Mirkanaa’e' : 'Confirmed'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-[#C69C3D]" />
                      {language === 'om' ? 'Eegaa (Pending)' : 'Pending'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-3.5 bg-[#17365D]" />
                      {language === 'om' ? 'Waadaa' : 'Commitment'}
                    </span>
                  </div>
                </div>
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={contribHistoryData.timeline}
                      margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#C8D6E5" vertical={false} />
                      <XAxis
                        dataKey="shortLabel"
                        tick={{ fontSize: 10, fill: '#526173' }}
                        axisLine={{ stroke: '#C8D6E5' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#526173' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value, name) => [
                          `${Number(value).toLocaleString()} ETB`,
                          String(name),
                        ]}
                        contentStyle={{
                          borderRadius: '8px',
                          borderColor: '#C8D6E5',
                          fontSize: '12px',
                        }}
                      />
                      <Bar
                        dataKey="confirmedEtb"
                        name={language === 'om' ? 'Mirkanaa’e' : 'Confirmed'}
                        stackId="paid"
                        fill="#167C80"
                        radius={[0, 0, 0, 0]}
                        maxBarSize={28}
                      />
                      <Bar
                        dataKey="pendingEtb"
                        name={language === 'om' ? 'Eegaa (Pending)' : 'Pending'}
                        stackId="paid"
                        fill="#C69C3D"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                      />
                      <Line
                        type="monotone"
                        dataKey="expectedEtb"
                        name={language === 'om' ? 'Waadaa' : 'Commitment'}
                        stroke="#17365D"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#17365D' }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chronological Payment & Commitment Timeline Ledger */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12 text-xs">
                <div className="md:col-span-8">
                  <h4 className="mb-2 font-display text-xs font-bold uppercase tracking-wider text-[#17365D] dark:text-sky-300">
                    {language === 'om'
                      ? `Galmee Kaffaltii Ji’a 12 (${contribHistoryData.recentPayments.length})`
                      : `Payments Recorded in Last 12 Months (${contribHistoryData.recentPayments.length})`}
                  </h4>
                  {contribHistoryData.recentPayments.length === 0 ? (
                    <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-4 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
                      {language === 'om'
                        ? 'Ji’oota 12 darban keessa kaffaltiin hin galmoofne.'
                        : 'No payments recorded for this member in the last 12 months.'}
                    </div>
                  ) : (
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-[#C8D6E5] divide-y divide-[#C8D6E5]/60 dark:border-slate-700 dark:divide-slate-800">
                      {contribHistoryData.recentPayments.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="font-mono-num font-semibold text-[#17365D] dark:text-sky-300">
                              {c.receiptNumber} · {c.month}
                            </div>
                            <div className="font-mono-num text-[11px] text-slate-500">
                              {formatDateByCalendar(c.paymentDate, calendarMode)} ·{' '}
                              <span className="uppercase">{c.paymentMethod.replace('_', ' ')}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono-num font-semibold text-[#202833] dark:text-white">
                              {c.amount.toLocaleString()} ETB
                            </div>
                            <div
                              className={`text-[10px] font-semibold uppercase ${
                                c.status === 'confirmed'
                                  ? 'text-[#167C80]'
                                  : c.status === 'pending'
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                              }`}
                            >
                              {getContributionStatusLabel(language, c.status)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="md:col-span-4">
                  <h4 className="mb-2 font-display text-xs font-bold uppercase tracking-wider text-[#167C80] dark:text-teal-400">
                    {language === 'om' ? 'Seenaa Waadaa' : 'Commitment Milestones'}
                  </h4>
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-[#C8D6E5] divide-y divide-[#C8D6E5]/60 dark:border-slate-700 dark:divide-slate-800">
                    {contribHistoryData.commitmentEvents.length === 0 ? (
                      <div className="p-3 text-slate-500">
                        {contribHistoryMember.monthlyCommitment.toLocaleString()} ETB / mo
                      </div>
                    ) : (
                      contribHistoryData.commitmentEvents.map((ev) => (
                        <div key={ev.id} className="p-3">
                          <div className="flex items-center justify-between font-mono-num font-semibold">
                            <span className="text-[#17365D] dark:text-sky-300">
                              {ev.effectiveFrom}
                            </span>
                            <span className="text-[#167C80] dark:text-teal-400">
                              {ev.amountEtb.toLocaleString()} ETB
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {ev.reason}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Member Profile & WhatsApp / SMS Payment Reminder Modal */}
      {profileMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/45 p-4 backdrop-blur-[2px]">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-start justify-between gap-3 border-b border-[#C8D6E5] pb-4 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/aistudio/loog_6003b99d.jpg"
                  alt="Al-Furqaan Center Logo"
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 shrink-0 rounded-full border-2 border-[#C69C3D] bg-white object-cover shadow-sm"
                />
                <div>
                  <h3 className="font-display text-base font-bold text-[#17365D] dark:text-white">
                    {profileMember.fullName}
                  </h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono-num font-semibold text-[#17365D] dark:text-sky-300">
                      {profileMember.memberCode}
                    </span>
                    <span>·</span>
                    <span className="uppercase font-semibold text-[#167C80] dark:text-teal-400">
                      {getMemberStatusLabel(language, profileMember.status)}
                    </span>
                    <span>·</span>
                    <span className="capitalize">{profileMember.category}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileMember(null)}
                className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA] dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-5 text-xs">
              {/* Contact & Registry Info */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {language === 'om' ? 'Odeeffannoo Quunnamtii' : 'Contact Details'}
                  </div>
                  <div className="mt-2 space-y-1.5 text-slate-700 dark:text-slate-200">
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-[#167C80]" />
                      <span className="font-mono-num font-semibold">
                        {profileMember.phone || (language === 'om' ? 'Hin galmoofne' : 'Not provided')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-[#167C80]" />
                      <span className="font-mono-num truncate">
                        {profileMember.email || '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-[#167C80]" />
                      <span>{profileMember.location || '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {language === 'om' ? 'Haala Buusii Ammaa' : 'Current Contribution Standing'}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">
                        {language === 'om' ? 'Waadaa Ji’aa' : 'Monthly Commitment'}
                      </span>
                      <span className="font-mono-num font-bold text-[#17365D] dark:text-white">
                        {profileMember.monthlyCommitment.toLocaleString()} ETB
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">
                        {language === 'om' ? 'Waliigala Mirkanaa’e' : 'Total Confirmed'}
                      </span>
                      <span className="font-mono-num font-bold text-[#167C80] dark:text-teal-400">
                        {(profileStanding?.confirmedTotalEtb ?? 0).toLocaleString()} ETB
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">
                        {language === 'om' ? 'Haftee (Arrears)' : 'Arrears Balance'}
                      </span>
                      <span
                        className={`font-mono-num font-bold ${
                          (profileStanding?.arrearsEtb ?? 0) > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-[#167C80] dark:text-teal-400'
                        }`}
                      >
                        {(profileStanding?.arrearsEtb ?? 0).toLocaleString()} ETB
                        {profileStanding && profileStanding.monthsInArrears.length > 0
                          ? ` (${profileStanding.monthsInArrears.length} mo)`
                          : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#C8D6E5]/80 bg-white px-3.5 py-2.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300">
                <div>
                  <span className="font-semibold">{language === 'om' ? 'Guyyaa Seensaa:' : 'Joined:'}</span>{' '}
                  <span className="font-mono-num">
                    {formatDateByCalendar(profileMember.joinedDate, calendarMode)}
                  </span>
                  {profileMember.birthDate && (
                    <>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="font-semibold">{language === 'om' ? 'Dhaloota:' : 'DOB:'}</span>{' '}
                      <span className="font-mono-num">
                        {formatDateByCalendar(profileMember.birthDate, calendarMode)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const target = profileMember;
                      setProfileMember(null);
                      setQrPayloadCopied(false);
                      setCardMember(target);
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-[#17365D] hover:underline dark:text-sky-300"
                  >
                    <QrCode className="h-3.5 w-3.5 text-[#C69C3D]" />
                    <span>{language === 'om' ? 'Kaardii & QR' : 'ID Card & QR'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = profileMember;
                      setProfileMember(null);
                      setContribHistoryMember(target);
                    }}
                    className="font-semibold text-[#167C80] hover:underline"
                  >
                    {language === 'om' ? 'Giraafii Buusii →' : 'Contribution History →'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = profileMember;
                      setProfileMember(null);
                      void openHistoryModal(target);
                    }}
                    className="font-semibold text-[#17365D] hover:underline dark:text-sky-300"
                  >
                    {language === 'om' ? 'Seenaa Waadaa →' : 'Commitment History →'}
                  </button>
                </div>
              </div>

              {profileMember.notes && (
                <div className="rounded-lg border border-[#C8D6E5]/70 bg-[#F3F7FA]/60 px-3.5 py-2.5 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                  <span className="font-semibold text-[#17365D] dark:text-slate-200">
                    {language === 'om' ? 'Yaadannoo:' : 'Notes:'}{' '}
                  </span>
                  {profileMember.notes}
                </div>
              )}

              {/* Admin Manual Payment Reminder (WhatsApp / SMS) */}
              {isAdminOrOwner && (
                <div className="rounded-xl border border-[#C8D6E5] bg-[#EAF1F7]/60 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#C8D6E5] pb-2.5 dark:border-slate-700">
                    <div>
                      <h4 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                        {language === 'om'
                          ? 'Yaadachiisa Kaffaltii (WhatsApp / SMS)'
                          : 'Payment Reminder (WhatsApp / SMS)'}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {language === 'om'
                          ? 'Lakkoofsa bilbilaa galmaa’een yaadachiisa kaffaltii kallattiin ergi.'
                          : 'Manually trigger a WhatsApp or SMS payment reminder using the phone number on file.'}
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border border-[#C8D6E5] bg-white p-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                      <button
                        type="button"
                        onClick={() =>
                          setReminderMessage(
                            buildReminderDraft(profileMember, 'om', profileStanding || undefined)
                          )
                        }
                        className="rounded px-2 py-1 font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:text-sky-300 dark:hover:bg-slate-800"
                      >
                        Afaan Oromoo
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setReminderMessage(
                            buildReminderDraft(profileMember, 'en', profileStanding || undefined)
                          )
                        }
                        className="rounded px-2 py-1 font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:text-sky-300 dark:hover:bg-slate-800"
                      >
                        English
                      </button>
                    </div>
                  </div>

                  {!profileMember.phone ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                      <span>
                        {language === 'om'
                          ? 'Miseensa kanaaf lakkoofsi bilbilaa hin galmoofne.'
                          : 'No phone number is registered for this member.'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const target = profileMember;
                          setProfileMember(null);
                          openEditModal(target);
                        }}
                        className="rounded-lg bg-[#17365D] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1E477A]"
                      >
                        {language === 'om' ? 'Bilbila Dabali' : 'Add Phone Number'}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                          {language === 'om'
                            ? `Ergaa Yaadachiisaa gara ${profileMember.phone}`
                            : `Reminder Message to ${profileMember.phone}`}
                        </label>
                        <textarea
                          rows={3}
                          value={reminderMessage}
                          onChange={(e) => setReminderMessage(e.target.value)}
                          className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 text-xs leading-relaxed text-[#202833] outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      </div>

                      {reminderChannelNotice && (
                        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-[11px] font-medium text-[#167C80] dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-300">
                          {reminderChannelNotice}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(reminderMessage);
                            setReminderCopied(true);
                            setTimeout(() => setReminderCopied(false), 2000);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 font-semibold text-[#17365D] hover:bg-[#F3F7FA] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          {reminderCopied ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#167C80]" />
                              <span>{language === 'om' ? 'Waraabame!' : 'Copied!'}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 text-[#167C80]" />
                              <span>{language === 'om' ? 'Ergaa Waraabi' : 'Copy Text'}</span>
                            </>
                          )}
                        </button>

                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`sms:${normalizePhoneForSms(profileMember.phone)}?body=${encodeURIComponent(reminderMessage)}`}
                            onClick={() => void handleLogReminderTrigger('sms')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#17365D] bg-white px-3.5 py-2 font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-sky-400 dark:bg-slate-800 dark:text-sky-300"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            <span>{language === 'om' ? 'SMS Ergi' : 'Send via SMS'}</span>
                          </a>

                          <a
                            href={`https://wa.me/${normalizePhoneForWhatsApp(profileMember.phone)}?text=${encodeURIComponent(reminderMessage)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => void handleLogReminderTrigger('whatsapp')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#167C80] px-3.5 py-2 font-semibold text-white hover:bg-[#126569]"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            <span>{language === 'om' ? 'WhatsApp Ergi' : 'Send via WhatsApp'}</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Printable Branded Membership Card Modal (Name, Member ID & QR Code) */}
      {cardMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-xl rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="no-print flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/aistudio/loog_6003b99d.jpg"
                  alt="Al-Furqaan Center Logo"
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
                />
                <div>
                  <h3 className="font-display text-base font-bold text-[#17365D] dark:text-white">
                    {language === 'om'
                      ? 'Kaardii Miseensummaa & QR Code'
                      : 'Branded Membership Card & QR Code'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {language === 'om'
                      ? 'Yeroo sagantaa walitti qabama buusii saffisaan scan gochuuf qopheeffame.'
                      : 'Printable institutional ID card for quick scanning during collection events.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCardMember(null)}
                className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA] dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Printable Card Surface */}
            <div className="mt-5 flex justify-center">
              <div
                id="printable-member-card"
                className="w-full max-w-[440px] overflow-hidden rounded-2xl border-2 border-[#C8D6E5] bg-white shadow-lg"
              >
                {/* Branded Navy Header with Gold Divider */}
                <div className="bg-[#17365D] px-5 py-3.5 text-white">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <img
                        src="/assets/aistudio/loog_6003b99d.jpg"
                        alt="Al-Furqaan Center Logo"
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-display text-xs font-bold tracking-wide text-white uppercase">
                          Al-Furqaan Qur&apos;an Center
                        </div>
                        <div className="truncate text-[10px] text-sky-200">
                          {language === 'om'
                            ? 'Kaardii Miseensummaa · Ciroo, Harargee Lixaa'
                            : 'Official Membership Card · Chiro, Oromia'}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 rounded bg-[#167C80] px-2 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase">
                      {getMemberStatusLabel(language, cardMember.status)}
                    </span>
                  </div>
                </div>
                <div className="h-1 w-full bg-[#C69C3D]" />

                {/* Card Body: Member Details + Scannable QR Code */}
                <div className="flex items-center justify-between gap-4 bg-white px-5 py-4 text-[#202833]">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <div className="text-[9px] font-bold tracking-wider text-[#167C80] uppercase">
                        {language === 'om' ? 'Koodii Miseensaa' : 'Member ID'}
                      </div>
                      <div className="font-mono-num text-lg font-extrabold tracking-tight text-[#17365D]">
                        {cardMember.memberCode}
                      </div>
                    </div>

                    <div>
                      <div className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                        {language === 'om' ? 'Maqaa Guutuu' : 'Member Name'}
                      </div>
                      <div className="truncate font-display text-base font-bold text-[#202833]">
                        {cardMember.fullName}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-0.5 text-[10px]">
                      <div>
                        <span className="text-slate-400">
                          {language === 'om' ? 'Gosa:' : 'Category:'}
                        </span>{' '}
                        <strong className="uppercase text-[#17365D]">
                          {cardMember.category}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">
                          {language === 'om' ? 'Seensa:' : 'Joined:'}
                        </span>{' '}
                        <strong className="font-mono-num text-[#202833]">
                          {cardMember.joinedDate}
                        </strong>
                      </div>
                    </div>

                    {showCommitmentOnCard ? (
                      <div className="font-mono-num text-[11px] font-bold text-[#167C80]">
                        {language === 'om' ? 'Waadaa Ji’aa:' : 'Monthly Commitment:'}{' '}
                        {cardMember.monthlyCommitment.toLocaleString()} ETB
                      </div>
                    ) : cardMember.phone ? (
                      <div className="font-mono-num text-[10px] text-slate-600">
                        Tel: {cardMember.phone}
                      </div>
                    ) : null}
                  </div>

                  {/* Generated QR Code Box */}
                  <div className="flex shrink-0 flex-col items-center rounded-xl border border-[#C8D6E5] bg-[#F3F7FA] p-2">
                    {cardQrDataUrl ? (
                      <img
                        src={cardQrDataUrl}
                        alt={`QR code for ${cardMember.memberCode}`}
                        className="h-28 w-28 rounded bg-white p-1"
                      />
                    ) : (
                      <div className="flex h-28 w-28 items-center justify-center rounded bg-white text-[10px] text-slate-400">
                        Generating QR...
                      </div>
                    )}
                    <span className="font-mono-num mt-1 text-[9px] font-bold tracking-wider text-[#17365D] uppercase">
                      Scan · {cardMember.memberCode}
                    </span>
                  </div>
                </div>

                {/* Card Footer Contact Band */}
                <div className="flex items-center justify-between border-t border-[#C8D6E5] bg-[#EAF1F7] px-5 py-2 text-[9px] text-[#17365D]">
                  <span className="font-mono-num">+251991272425 / +251998889045</span>
                  <span dir="rtl" className="font-semibold text-[#167C80]">
                    خيركم من تعلم القرآن وعلمه
                  </span>
                </div>
              </div>
            </div>

            {/* Card Options & Print/Download Controls */}
            <div className="no-print mt-5 space-y-3 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={showCommitmentOnCard}
                    onChange={(e) => setShowCommitmentOnCard(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[#C8D6E5] text-[#17365D]"
                  />
                  <span>
                    {language === 'om'
                      ? 'Waadaa ji’aa (ETB) kaardii irratti agarsiisi'
                      : 'Show monthly commitment (ETB) on card'}
                  </span>
                </label>

                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(cardQrPayload);
                    setQrPayloadCopied(true);
                    setTimeout(() => setQrPayloadCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-[#C8D6E5] bg-[#F3F7FA] px-2.5 py-1 text-[11px] font-medium text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {qrPayloadCopied ? (
                    <>
                      <Check className="h-3 w-3 text-[#167C80]" />
                      <span>{language === 'om' ? 'QR Waraabame!' : 'QR Data Copied!'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 text-[#167C80]" />
                      <span>{language === 'om' ? 'Daataa QR Waraabi' : 'Copy QR Payload'}</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCardMember(null)}
                  className="rounded-lg border border-[#C8D6E5] px-4 py-2 font-medium text-slate-700 hover:bg-[#F3F7FA] dark:border-slate-700 dark:text-slate-200"
                >
                  {t(language, 'cancel')}
                </button>
                <button
                  type="button"
                  disabled={!cardQrDataUrl}
                  onClick={() =>
                    downloadMemberCardPdf(
                      cardMember,
                      cardQrDataUrl,
                      calendarMode,
                      language,
                      showCommitmentOnCard
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#167C80] bg-[#EAF1F7] px-4 py-2 font-semibold text-[#17365D] hover:bg-[#DCE8F2] disabled:opacity-50 dark:border-teal-600 dark:bg-slate-800 dark:text-teal-300"
                >
                  <Download className="h-3.5 w-3.5 text-[#167C80]" />
                  <span>{language === 'om' ? 'Kaardii PDF Buusi' : 'Download Card PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-4 py-2 font-semibold text-white hover:bg-[#1E477A]"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>{language === 'om' ? 'Kaardii Maxxansi' : 'Print Card'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={language === 'om' ? 'Miseensa Haquu? (Owner)' : 'Delete Member Record? (Owner)'}
        description={`Are you sure you want to remove ${deleteTarget?.fullName} (${deleteTarget?.memberCode}) from the registry?`}
        confirmLabel={language === 'om' ? 'Haqi' : 'Delete Member'}
        destructive
        busy={saving}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
