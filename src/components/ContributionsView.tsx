import React, { useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Paperclip,
  Plus,
  ReceiptText,
  Search,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { getContributionStatusLabel, t } from '../i18n.ts';
import {
  createContribution,
  createContributionsBatch,
  logAuditEvent,
  updateContributionStatus,
  uploadPaymentEvidence,
} from '../services/firebase.ts';
import type {
  CalendarMode,
  Contribution,
  ContributionStatus,
  Language,
  Member,
  PaymentEvidence,
  PaymentMethod,
  PeriodClosure,
  UserAccount,
} from '../types.ts';
import {
  formatDateByCalendar,
  formatEthiopianShort,
  formatPeriodLabel,
} from '../utils/ethiopianCalendar.ts';
import { downloadContributionsBatchPdf } from '../utils/reportExporters.ts';
import { ReceiptModal } from './ReceiptModal.tsx';

interface ContributionsViewProps {
  language: Language;
  calendarMode: CalendarMode;
  selectedPeriod: string;
  account: UserAccount;
  members: Member[];
  contributions: Contribution[];
  evidenceList: PaymentEvidence[];
  closures: PeriodClosure[];
}

export const ContributionsView: React.FC<ContributionsViewProps> = ({
  language,
  calendarMode,
  selectedPeriod,
  account,
  members,
  contributions,
  evidenceList,
  closures,
}) => {
  const isAdminOrOwner = account.role === 'owner' || account.role === 'admin';
  const isCashierOrAbove = isAdminOrOwner || account.role === 'cashier';

  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ContributionStatus>('all');
  const [periodOnly, setPeriodOnly] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Contribution | null>(null);
  const [statusDialog, setStatusDialog] = useState<{
    item: Contribution;
    targetStatus: 'confirmed' | 'rejected' | 'cancelled';
  } | null>(null);
  const [statusReason, setStatusReason] = useState('');

  // Evidence Attachment Modal
  const [evidenceTarget, setEvidenceTarget] = useState<Contribution | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<{
    name: string;
    mimeType: string;
    dataUrl: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // CSV Batch Upload Modal (Owner / Admin)
  interface CsvParsedRow {
    rowNumber: number;
    rawMemberId: string;
    member: Member | null;
    amount: number;
    paymentDate: string;
    month: string;
    paymentMethod: PaymentMethod;
    referenceCode?: string;
    notes?: string;
    error?: string;
  }
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvFileName, setCsvFileName] = useState('');
  const [csvRows, setCsvRows] = useState<CsvParsedRow[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvStatusMsg, setCsvStatusMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    receiptNumber: '',
    memberId: '',
    amount: '',
    month: selectedPeriod,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'cbe' as PaymentMethod,
    referenceCode: '',
    status: 'confirmed' as 'pending' | 'confirmed',
    notes: '',
  });

  const closedPeriodSet = useMemo(
    () => new Set(closures.filter((c) => c.status === 'closed').map((c) => c.periodKey)),
    [closures]
  );

  const evidenceByContribId = useMemo(() => {
    const map = new Map<string, PaymentEvidence[]>();
    for (const ev of evidenceList) {
      const list = map.get(ev.contributionId) || [];
      list.push(ev);
      map.set(ev.contributionId, list);
    }
    return map;
  }, [evidenceList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contributions.filter((c) => {
      if (periodOnly && c.month !== selectedPeriod) return false;
      if (methodFilter !== 'all' && c.paymentMethod !== methodFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.receiptNumber.toLowerCase().includes(q) ||
        c.memberName.toLowerCase().includes(q) ||
        c.memberCode.toLowerCase().includes(q) ||
        (c.referenceCode || '').toLowerCase().includes(q)
      );
    });
  }, [contributions, periodOnly, selectedPeriod, methodFilter, statusFilter, search]);

  const confirmedFilteredTotal = useMemo(
    () => filtered.filter((c) => c.status === 'confirmed').reduce((s, c) => s + c.amount, 0),
    [filtered]
  );

  const selectedItems = useMemo(
    () => contributions.filter((c) => selectedIds.has(c.id)),
    [contributions, selectedIds]
  );

  const selectedTotalEtb = useMemo(
    () => selectedItems.reduce((s, c) => s + c.amount, 0),
    [selectedItems]
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const c of filtered) next.delete(c.id);
      } else {
        for (const c of filtered) next.add(c.id);
      }
      return next;
    });
  };

  const handleSelectConfirmedVisible = () => {
    setSelectedIds(
      new Set(filtered.filter((c) => c.status === 'confirmed').map((c) => c.id))
    );
  };

  const handleExportBatchPdf = () => {
    if (!isAdminOrOwner || selectedItems.length === 0) return;
    downloadContributionsBatchPdf(
      selectedItems,
      calendarMode,
      language,
      account.displayName || account.email
    );
    void logAuditEvent(
      account,
      'EXPORT_BATCH_PDF',
      'contribution',
      'batch_pdf',
      `Exported batch PDF summary for ${selectedItems.length} contributions (${selectedTotalEtb.toLocaleString()} ETB).`
    );
  };

  const splitCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current.trim());
    return out;
  };

  const normalizeCsvDate = (raw: string): string | null => {
    const v = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (slashMatch) {
      const m = Number(slashMatch[1]);
      const d = Number(slashMatch[2]);
      const y = Number(slashMatch[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    return null;
  };

  const normalizePaymentMethod = (raw: string | undefined): PaymentMethod => {
    const v = (raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (
      v === 'cash' ||
      v === 'cbe' ||
      v === 'telebirr' ||
      v === 'coop_bank' ||
      v === 'awash_bank' ||
      v === 'other'
    ) {
      return v;
    }
    if (v.includes('coop')) return 'coop_bank';
    if (v.includes('awash')) return 'awash_bank';
    if (v.includes('tele')) return 'telebirr';
    if (v.includes('cbe')) return 'cbe';
    if (v.includes('cash')) return 'cash';
    return 'other';
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setCsvStatusMsg(null);
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const cleaned = text.replace(/^\uFEFF/, '');
      const rawLines = cleaned
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (rawLines.length === 0) {
        setCsvRows([]);
        setErrorMsg(language === 'om' ? 'Faayiliin CSV duwwaa dha.' : 'The uploaded CSV file is empty.');
        return;
      }

      const firstCols = splitCsvLine(rawLines[0]).map((c) => c.toLowerCase());
      const looksLikeHeader = firstCols.some((c) =>
        ['memberid', 'member_id', 'member id', 'membercode', 'member_code', 'code', 'amount', 'date', 'paymentdate'].includes(c)
      );

      let memberCol = 0;
      let amountCol = 1;
      let dateCol = 2;
      let methodCol = -1;
      let refCol = -1;
      let monthCol = -1;
      let notesCol = -1;
      const startIdx = looksLikeHeader ? 1 : 0;

      if (looksLikeHeader) {
        memberCol = firstCols.findIndex((c) =>
          ['memberid', 'member_id', 'member id', 'membercode', 'member_code', 'member code', 'code', 'id'].includes(c)
        );
        amountCol = firstCols.findIndex((c) =>
          ['amount', 'amount_etb', 'amount (etb)', 'etb', 'hanga'].includes(c)
        );
        dateCol = firstCols.findIndex((c) =>
          ['date', 'paymentdate', 'payment_date', 'payment date', 'received_date', 'guyyaa'].includes(c)
        );
        monthCol = firstCols.findIndex((c) => ['month', 'period', 'ji_a'].includes(c));
        methodCol = firstCols.findIndex((c) =>
          ['paymentmethod', 'payment_method', 'method', 'mala'].includes(c)
        );
        refCol = firstCols.findIndex((c) =>
          ['referencecode', 'reference_code', 'reference', 'ref'].includes(c)
        );
        notesCol = firstCols.findIndex((c) => ['notes', 'note', 'yaadannoo'].includes(c));

        if (memberCol === -1 || amountCol === -1 || dateCol === -1) {
          setCsvRows([]);
          setErrorMsg(
            language === 'om'
              ? 'Mata-duree CSV keessa column "memberId", "amount", fi "date" jiraachuu qaba.'
              : 'CSV header must contain columns for Member ID (memberId / memberCode), Amount, and Date.'
          );
          return;
        }
      }

      const memberMap = new Map<string, Member>();
      for (const m of members) {
        memberMap.set(m.id.toLowerCase(), m);
        memberMap.set(m.memberCode.toLowerCase(), m);
      }

      const parsed: CsvParsedRow[] = [];
      for (let i = startIdx; i < rawLines.length; i += 1) {
        const cols = splitCsvLine(rawLines[i]);
        const rawMemberId = (cols[memberCol] || '').trim();
        const rawAmount = (cols[amountCol] || '').replace(/,/g, '').trim();
        const rawDate = (cols[dateCol] || '').trim();

        const member = memberMap.get(rawMemberId.toLowerCase()) || null;
        const amount = Number(rawAmount);
        const normalizedDate = normalizeCsvDate(rawDate);
        const rawMonth = monthCol >= 0 ? (cols[monthCol] || '').trim() : '';
        const month = /^\d{4}-\d{2}$/.test(rawMonth)
          ? rawMonth
          : normalizedDate
          ? normalizedDate.slice(0, 7)
          : selectedPeriod;

        const errs: string[] = [];
        if (!rawMemberId || !member) {
          errs.push(
            language === 'om'
              ? `Miseensi "${rawMemberId || '?'}" hin argamne`
              : `Unknown member "${rawMemberId || '?'}"`
          );
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          errs.push(language === 'om' ? 'Hangi sirrii miti' : 'Invalid amount');
        }
        if (!normalizedDate) {
          errs.push(language === 'om' ? 'Guyyaan YYYY-MM-DD miti' : 'Invalid date (use YYYY-MM-DD)');
        }

        parsed.push({
          rowNumber: i + 1,
          rawMemberId,
          member,
          amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
          paymentDate: normalizedDate || rawDate,
          month,
          paymentMethod: normalizePaymentMethod(methodCol >= 0 ? cols[methodCol] : undefined),
          referenceCode: refCol >= 0 ? cols[refCol] || undefined : undefined,
          notes:
            (notesCol >= 0 ? cols[notesCol] : '') ||
            (closedPeriodSet.has(month) ? `CSV import (${file.name}) closed-period amendment` : `CSV import (${file.name})`),
          error: errs.length > 0 ? errs.join('; ') : undefined,
        });
      }
      setCsvRows(parsed);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const validCsvRows = useMemo(() => csvRows.filter((r) => !r.error && r.member), [csvRows]);

  const handleDownloadCsvTemplate = () => {
    const sampleMember = members[0]?.memberCode || 'AFQ-001';
    const sampleMember2 = members[1]?.memberCode || 'AFQ-002';
    const today = new Date().toISOString().slice(0, 10);
    const lines = [
      'memberId,amount,date,paymentMethod,referenceCode,notes',
      `${sampleMember},1500,${today},cbe,FT26CSV001,Monthly contribution via CSV`,
      `${sampleMember2},3000,${today},telebirr,TBCSV002,Student sponsorship via CSV`,
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'AlFurqaan-Contributions-Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleCommitCsvImport = async () => {
    if (!isAdminOrOwner || validCsvRows.length === 0) return;
    setCsvImporting(true);
    setErrorMsg(null);
    setCsvStatusMsg(null);
    try {
      const stamp = String(Date.now()).slice(-6);
      const year = new Date().getFullYear();
      const payload = validCsvRows.map((r, idx) => ({
        receiptNumber: `RCP-${year}-CSV${stamp}-${idx + 1}`,
        memberId: r.member!.id,
        memberName: r.member!.fullName,
        memberCode: r.member!.memberCode,
        linkedUid: r.member!.linkedUid,
        amount: r.amount,
        currency: 'ETB' as const,
        month: r.month,
        paymentDate: r.paymentDate,
        paymentMethod: r.paymentMethod,
        referenceCode: r.referenceCode,
        status: 'pending' as const,
        notes: r.notes,
      }));
      const count = await createContributionsBatch(account, payload, csvFileName);
      setCsvStatusMsg(
        language === 'om'
          ? `Galmeen kaffaltii eegaa (Pending) ${count} milkaa'inaan uumameera!`
          : `Successfully created ${count} pending contribution records for verification.`
      );
      setCsvRows([]);
      setStatusFilter('pending');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import CSV contributions.');
    } finally {
      setCsvImporting(false);
    }
  };

  const openModal = () => {
    const firstMember = members[0];
    const seq = String(contributions.length + 1001);
    setForm({
      receiptNumber: `RCP-${new Date().getFullYear()}-${seq}`,
      memberId: firstMember?.id || '',
      amount: firstMember ? String(firstMember.monthlyCommitment || 1000) : '1000',
      month: selectedPeriod,
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'cbe',
      referenceCode: '',
      status: account.role === 'cashier' ? 'pending' : 'confirmed',
      notes: '',
    });
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleMemberSelect = (memberId: string) => {
    const found = members.find((m) => m.id === memberId);
    setForm((prev) => ({
      ...prev,
      memberId,
      amount: found && found.monthlyCommitment > 0 ? String(found.monthlyCommitment) : prev.amount,
    }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const member = members.find((m) => m.id === form.memberId);
    if (!member) {
      setErrorMsg('Please select a registered member first.');
      return;
    }
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErrorMsg('Amount must be greater than zero (ETB).');
      return;
    }

    // BR-09: Closed period check
    if (closedPeriodSet.has(form.month) && !isAdminOrOwner) {
      setErrorMsg(
        language === 'om'
          ? `Ji'i ${form.month} cufameera. Admin ykn Owner qofatu sababa waliin galchuu danda'a.`
          : `Period ${form.month} is closed. Only Admin or Owner can amend a closed period.`
      );
      return;
    }
    if (closedPeriodSet.has(form.month) && !form.notes.trim()) {
      setErrorMsg(
        language === 'om'
          ? `Ji'i ${form.month} cufameera — sababa sirreeffamaa "Yaadannoo" keessatti barressi.`
          : `Period ${form.month} is closed — please document the amendment reason in Notes.`
      );
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await createContribution(account, {
        receiptNumber: form.receiptNumber.trim(),
        memberId: member.id,
        memberName: member.fullName,
        memberCode: member.memberCode,
        linkedUid: member.linkedUid,
        amount: amt,
        currency: 'ETB',
        month: form.month,
        paymentDate: form.paymentDate,
        paymentMethod: form.paymentMethod,
        referenceCode: form.referenceCode.trim() || undefined,
        status: form.status,
        notes: form.notes.trim() || undefined,
      });
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to record contribution.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusDialog) return;
    const needsReason = statusDialog.targetStatus !== 'confirmed';
    if (needsReason && statusReason.trim().length < 2) {
      setErrorMsg(
        language === 'om'
          ? 'Sababa fashalsuu ykn diduu dirqama galchi.'
          : 'Reason is mandatory when cancelling or rejecting a payment.'
      );
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await updateContributionStatus(
        account,
        statusDialog.item.id,
        statusDialog.targetStatus,
        statusReason.trim() || 'Confirmed by authorized officer'
      );
      setStatusDialog(null);
      setStatusReason('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setSaving(false);
    }
  };

  const handleEvidenceFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 260 * 1024) {
      setErrorMsg(
        language === 'om'
          ? 'Faayiliin 260KB caaluu hin qabu (Firestore upload limit).'
          : 'File must be under 260KB for direct secure attachment storage.'
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result) {
        setErrorMsg(null);
        setEvidenceFile({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataUrl: result,
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUploadEvidence = async () => {
    if (!evidenceTarget || !evidenceFile) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await uploadPaymentEvidence(account, {
        contributionId: evidenceTarget.id,
        memberId: evidenceTarget.memberId,
        linkedUid: evidenceTarget.linkedUid,
        fileName: evidenceFile.name,
        mimeType: evidenceFile.mimeType,
        storageReference: evidenceFile.dataUrl,
      });
      setEvidenceFile(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to upload evidence.');
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
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(language, 'searchPlaceholder')}
              className="w-full rounded-lg border border-[#C8D6E5] bg-white py-2 pr-3 pl-8 text-xs text-[#202833] outline-none focus:border-[#17365D] dark:border-slate-800 dark:bg-[#121D2B] dark:text-white"
            />
          </div>

          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as 'all' | PaymentMethod)}
            className="rounded-lg border border-[#C8D6E5] bg-white px-2.5 py-2 text-xs text-[#202833] outline-none focus:border-[#17365D] dark:border-slate-800 dark:bg-[#121D2B] dark:text-slate-200"
          >
            <option value="all">{language === 'om' ? 'Mala Hunda' : 'All Methods'}</option>
            <option value="cbe">CBE</option>
            <option value="telebirr">Telebirr</option>
            <option value="coop_bank">Coop Bank</option>
            <option value="awash_bank">Awash Bank</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | ContributionStatus)}
            className="rounded-lg border border-[#C8D6E5] bg-white px-2.5 py-2 text-xs text-[#202833] outline-none focus:border-[#17365D] dark:border-slate-800 dark:bg-[#121D2B] dark:text-slate-200"
          >
            <option value="all">{language === 'om' ? 'Haala Hunda' : 'All Statuses'}</option>
            <option value="confirmed">{getContributionStatusLabel(language, 'confirmed')}</option>
            <option value="pending">{getContributionStatusLabel(language, 'pending')}</option>
            <option value="cancelled">{getContributionStatusLabel(language, 'cancelled')}</option>
            <option value="rejected">{getContributionStatusLabel(language, 'rejected')}</option>
          </select>

          <button
            type="button"
            onClick={() => setPeriodOnly((p) => !p)}
            className={`rounded-lg border px-2.5 py-2 text-xs font-medium whitespace-nowrap ${
              periodOnly
                ? 'border-[#17365D] bg-[#17365D] text-white'
                : 'border-[#C8D6E5] bg-white text-slate-700 dark:border-slate-700 dark:bg-[#121D2B] dark:text-slate-300'
            }`}
          >
            {periodOnly ? `${selectedPeriod} only` : language === 'om' ? 'Ji’a Hunda' : 'All Months'}
          </button>

          <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
            Confirmed:{' '}
            <strong className="text-[#167C80] dark:text-teal-400">
              {confirmedFilteredTotal.toLocaleString()} ETB
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdminOrOwner && (
            <button
              type="button"
              onClick={() => {
                setCsvModalOpen(true);
                setCsvRows([]);
                setCsvFileName('');
                setCsvStatusMsg(null);
                setErrorMsg(null);
              }}
              disabled={members.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-white px-3.5 py-2 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] disabled:opacity-50 dark:border-slate-700 dark:bg-[#121D2B] dark:text-sky-300 dark:hover:bg-slate-800"
            >
              <Upload className="h-3.5 w-3.5 text-[#167C80]" />
              <span>{language === 'om' ? 'CSV Ol-kaa’i' : 'Upload CSV'}</span>
            </button>
          )}
          {isCashierOrAbove && (
            <button
              type="button"
              onClick={openModal}
              disabled={members.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#17365D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t(language, 'recordContribution')}</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && !modalOpen && !statusDialog && !evidenceTarget && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {isAdminOrOwner && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#C8D6E5] bg-[#EAF1F7] px-4 py-2.5 text-xs dark:border-slate-700 dark:bg-[#162333]">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-semibold text-[#17365D] dark:text-white">
              {selectedItems.length > 0
                ? language === 'om'
                  ? `Filatame: ${selectedItems.length} nagahee (${selectedTotalEtb.toLocaleString()} ETB)`
                  : `Selected: ${selectedItems.length} contributions (${selectedTotalEtb.toLocaleString()} ETB)`
                : language === 'om'
                ? 'Cuunfaa PDF (Batch PDF) baasuuf kaffaltii filadhu'
                : 'Select multiple contributions below to export a batch PDF summary'}
            </span>
            <button
              type="button"
              onClick={handleSelectConfirmedVisible}
              className="rounded-md border border-[#C8D6E5] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#17365D] hover:bg-[#F3F7FA] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {language === 'om' ? 'Confirmed Filadhu' : 'Select Confirmed'}
            </button>
            {selectedItems.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-[11px] font-medium text-slate-600 hover:underline dark:text-slate-300"
              >
                {language === 'om' ? 'Haqi' : 'Clear'}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleExportBatchPdf}
            disabled={selectedItems.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#167C80] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#126569] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Download className="h-3.5 w-3.5" />
            <span>
              {language === 'om'
                ? `Batch PDF Buusi (${selectedItems.length})`
                : `Export Batch PDF (${selectedItems.length})`}
            </span>
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[#C8D6E5] bg-white dark:border-slate-800 dark:bg-[#121D2B]">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs text-slate-500">
            {members.length === 0 && isCashierOrAbove
              ? language === 'om'
                ? 'Dura miseensa galmeessi.'
                : 'Register a member first before recording buusii.'
              : language === 'om'
              ? 'Galmeen kaffaltii hin argamne.'
              : 'No contribution records found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#17365D] text-[11px] font-semibold tracking-wider text-white uppercase">
                <tr>
                  {isAdminOrOwner && (
                    <th className="w-10 px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        aria-label="Select all visible contributions"
                        className="h-3.5 w-3.5 cursor-pointer accent-[#C69C3D]"
                      />
                    </th>
                  )}
                  <th className="px-5 py-2.5">Receipt #</th>
                  <th className="px-4 py-2.5">{language === 'om' ? 'Miseensa' : 'Member'}</th>
                  <th className="px-4 py-2.5">{language === 'om' ? 'Ji’a · Guyyaa' : 'Month · Date'}</th>
                  <th className="px-4 py-2.5">{language === 'om' ? 'Mala · Wabii' : 'Method · Ref'}</th>
                  <th className="px-4 py-2.5 text-right">{language === 'om' ? 'Hanga (ETB)' : 'Amount'}</th>
                  <th className="px-4 py-2.5">{language === 'om' ? 'Haala' : 'Status'}</th>
                  <th className="px-5 py-2.5 text-right">{language === 'om' ? 'Tarkaanfii' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                {filtered.map((c, idx) => {
                  const evCount = evidenceByContribId.get(c.id)?.length || 0;
                  const canConfirm = isCashierOrAbove && c.status === 'pending';
                  const canCancel =
                    isCashierOrAbove && (c.status === 'pending' || c.status === 'confirmed');
                  const isSelected = selectedIds.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      className={
                        isSelected
                          ? 'bg-[#EAF1F7] dark:bg-slate-800/60'
                          : idx % 2 === 1
                          ? 'bg-[#F3F7FA] dark:bg-slate-900/30'
                          : ''
                      }
                    >
                      {isAdminOrOwner && (
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectOne(c.id)}
                            aria-label={`Select ${c.receiptNumber}`}
                            className="h-3.5 w-3.5 cursor-pointer accent-[#17365D]"
                          />
                        </td>
                      )}
                      <td className="font-mono-num px-5 py-2.5 font-semibold text-[#17365D] dark:text-sky-300">
                        {c.receiptNumber}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[#202833] dark:text-slate-100">
                          {c.memberName}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-500">
                          {c.memberCode}
                        </div>
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-slate-600 dark:text-slate-400">
                        <div>{c.month}</div>
                        <div className="text-[11px]">
                          {formatDateByCalendar(c.paymentDate, calendarMode)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                        <span className="uppercase">{c.paymentMethod.replace('_', ' ')}</span>
                        {c.referenceCode ? (
                          <span className="font-mono-num text-slate-400"> · {c.referenceCode}</span>
                        ) : null}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-[#202833] dark:text-white">
                        {c.amount.toLocaleString()} ETB
                      </td>
                      <td className="px-4 py-2.5">
                        <div
                          className={`text-[11px] font-semibold uppercase ${
                            c.status === 'confirmed'
                              ? 'text-[#167C80] dark:text-teal-400'
                              : c.status === 'cancelled' || c.status === 'rejected'
                              ? 'text-red-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {getContributionStatusLabel(language, c.status)}
                        </div>
                        {c.statusReason && (
                          <div className="max-w-[160px] truncate text-[11px] text-slate-500" title={c.statusReason}>
                            {c.statusReason}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedReceipt(c)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-[#17365D] hover:bg-[#EAF1F7] dark:text-sky-300 dark:hover:bg-slate-800"
                            title="Official Receipt"
                          >
                            <ReceiptText className="h-3.5 w-3.5" />
                            <span>Receipt</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEvidenceTarget(c);
                              setEvidenceFile(null);
                              setErrorMsg(null);
                            }}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-[#EAF1F7] dark:text-slate-300 dark:hover:bg-slate-800"
                            title="Payment Evidence"
                          >
                            {evCount > 0 ? (
                              <FileCheck2 className="h-3.5 w-3.5 text-[#167C80]" />
                            ) : (
                              <Paperclip className="h-3.5 w-3.5" />
                            )}
                            {evCount > 0 && <span className="font-mono-num">{evCount}</span>}
                          </button>
                          {canConfirm && (
                            <button
                              type="button"
                              onClick={() => {
                                setStatusDialog({ item: c, targetStatus: 'confirmed' });
                                setStatusReason('');
                                setErrorMsg(null);
                              }}
                              className="rounded p-1 text-[#167C80] hover:bg-[#EAF1F7]"
                              title="Confirm Payment"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canConfirm && (
                            <button
                              type="button"
                              onClick={() => {
                                setStatusDialog({ item: c, targetStatus: 'rejected' });
                                setStatusReason('');
                                setErrorMsg(null);
                              }}
                              className="rounded p-1 text-amber-600 hover:bg-amber-50"
                              title="Reject Payment"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => {
                                setStatusDialog({ item: c, targetStatus: 'cancelled' });
                                setStatusReason('');
                                setErrorMsg(null);
                              }}
                              className="rounded p-1 text-red-600 hover:bg-red-50"
                              title="Cancel with Reason (No Deletion)"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Contribution Modal */}
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
                  {t(language, 'recordContribution')} (ETB)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  {language === 'om' ? 'Miseensa *' : 'Member *'}
                </label>
                <select
                  required
                  value={form.memberId}
                  onChange={(e) => handleMemberSelect(e.target.value)}
                  className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.memberCode} — {m.fullName} ({m.monthlyCommitment.toLocaleString()} ETB)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    Receipt Number *
                  </label>
                  <input
                    required
                    maxLength={40}
                    value={form.receiptNumber}
                    onChange={(e) => setForm({ ...form, receiptNumber: e.target.value })}
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Ji’a Kaffaltii *' : 'Contribution Month *'}
                  </label>
                  <input
                    required
                    type="month"
                    value={form.month}
                    onChange={(e) => setForm({ ...form, month: e.target.value })}
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                  {form.month && (
                    <div className="font-mono-num mt-1 text-[11px] text-[#167C80] dark:text-teal-400">
                      EC: {formatPeriodLabel(form.month, 'ethiopian', language)}
                    </div>
                  )}
                </div>
              </div>

              {closedPeriodSet.has(form.month) && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                  {language === 'om'
                    ? `Akeekkachiisa: Ji'i ${form.month} cufameera. Sababa sirreeffamaa galchuu qabda.`
                    : `Notice: Period ${form.month} is CLOSED. An amendment reason is required in Notes.`}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Hanga Maallaqaa (ETB) *' : 'Amount (ETB) *'}
                  </label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Guyyaa Fudhatame *' : 'Received Date *'}
                  </label>
                  <input
                    required
                    type="date"
                    value={form.paymentDate}
                    onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
                    className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  />
                  {form.paymentDate && (
                    <div className="font-mono-num mt-1 text-[11px] text-[#167C80] dark:text-teal-400">
                      EC: {formatEthiopianShort(form.paymentDate)}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Mala Kaffaltii *' : 'Payment Method *'}
                  </label>
                  <select
                    value={form.paymentMethod}
                    onChange={(e) =>
                      setForm({ ...form, paymentMethod: e.target.value as PaymentMethod })
                    }
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="cbe">CBE (Commercial Bank)</option>
                    <option value="telebirr">Telebirr</option>
                    <option value="coop_bank">Cooperative Bank of Oromia</option>
                    <option value="awash_bank">Awash Bank</option>
                    <option value="cash">Cash (Office)</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    {language === 'om' ? 'Haala Jalqabaa' : 'Initial Status'}
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as 'pending' | 'confirmed' })
                    }
                    className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="confirmed">{getContributionStatusLabel(language, 'confirmed')}</option>
                    <option value="pending">{getContributionStatusLabel(language, 'pending')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  {language === 'om' ? 'Wabii Baankii / Reference Code' : 'Bank / Wallet Reference Code'}
                </label>
                <input
                  maxLength={80}
                  value={form.referenceCode}
                  onChange={(e) => setForm({ ...form, referenceCode: e.target.value })}
                  placeholder="FT26..."
                  className="font-mono-num w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

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
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-700">
                  {errorMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-[#C8D6E5] px-4 py-2 font-medium text-slate-700 hover:bg-[#F3F7FA]"
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

      {/* Confirm / Reject / Cancel with Reason Modal */}
      {statusDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
              <img
                src="/assets/aistudio/loog_6003b99d.jpg"
                alt="Al-Furqaan Center Logo"
                referrerPolicy="no-referrer"
                className="h-8 w-8 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
              />
              <div>
                <h3 className="font-display text-base font-bold text-[#17365D] dark:text-white">
                  {statusDialog.targetStatus === 'confirmed'
                    ? language === 'om'
                      ? 'Kaffaltii Mirkaneessi'
                      : 'Confirm Payment'
                    : statusDialog.targetStatus === 'rejected'
                    ? language === 'om'
                      ? 'Kaffaltii Diddeebisi (Reject)'
                      : 'Reject Payment'
                    : language === 'om'
                    ? 'Kaffaltii Fashalsiisi (Cancel with Reason)'
                    : 'Cancel Payment (With Reason)'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                  {statusDialog.item.receiptNumber} · {statusDialog.item.memberName} (
                  {statusDialog.item.amount.toLocaleString()} ETB)
                </p>
              </div>
            </div>
            <form onSubmit={handleStatusSubmit} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  {statusDialog.targetStatus === 'confirmed'
                    ? language === 'om'
                      ? 'Yaadannoo mirkaneessaa (filannoo)'
                      : 'Verification note (optional)'
                    : language === 'om'
                    ? 'Sababa dirqamaa * (Galmeen hin haqamu)'
                    : 'Mandatory Reason * (Original record stays in audit trail)'}
                </label>
                <textarea
                  rows={2}
                  required={statusDialog.targetStatus !== 'confirmed'}
                  minLength={statusDialog.targetStatus !== 'confirmed' ? 2 : 0}
                  maxLength={300}
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              {errorMsg && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
                  {errorMsg}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStatusDialog(null)}
                  className="rounded-lg border border-[#C8D6E5] px-3.5 py-1.5 font-medium"
                >
                  {t(language, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`rounded-lg px-3.5 py-1.5 font-semibold text-white ${
                    statusDialog.targetStatus === 'confirmed'
                      ? 'bg-[#167C80] hover:bg-[#126569]'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {saving ? '...' : t(language, 'confirm')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Evidence Modal */}
      {evidenceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/45 p-4 backdrop-blur-[2px]">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/aistudio/loog_6003b99d.jpg"
                  alt="Al-Furqaan Center Logo"
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
                />
                <div>
                  <h3 className="font-display text-sm font-bold text-[#17365D] dark:text-white">
                    {language === 'om' ? 'Ragaa Kaffaltii' : 'Payment Evidence Attachments'} ·{' '}
                    {evidenceTarget.receiptNumber}
                  </h3>
                  <p className="text-xs text-slate-500">{evidenceTarget.memberName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEvidenceTarget(null)}
                className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {(evidenceByContribId.get(evidenceTarget.id) || []).length === 0 ? (
                <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-4 text-center text-slate-500">
                  {language === 'om'
                    ? 'Ragaan kaffaltii ammaaf hin maxxanfamne.'
                    : 'No payment evidence uploaded for this receipt yet.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {(evidenceByContribId.get(evidenceTarget.id) || []).map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-lg border border-[#C8D6E5] p-3 dark:border-slate-700"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#17365D] dark:text-sky-300">
                          {ev.fileName}
                        </span>
                        <span className="text-[11px] text-slate-500">by {ev.uploadedByName}</span>
                      </div>
                      {ev.mimeType.startsWith('image/') && (
                        <img
                          src={ev.storageReference}
                          alt={ev.fileName}
                          className="mt-2 max-h-56 w-full rounded border border-slate-200 object-contain"
                        />
                      )}
                      <div className="mt-2">
                        <a
                          href={ev.storageReference}
                          download={ev.fileName}
                          className="font-semibold text-[#167C80] hover:underline"
                        >
                          Download Attachment
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2.5 rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="font-semibold text-[#17365D] dark:text-white">
                  {language === 'om'
                    ? 'Ragaa Baankii / Telebirr Haaraa Galchi (Max 260KB)'
                    : 'Upload Bank Slip / Screenshot (Max 260KB)'}
                </div>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleEvidenceFilePick}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-[#17365D] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                />
                {errorMsg && (
                  <div className="rounded border border-red-200 bg-red-50 p-2 text-red-700">
                    {errorMsg}
                  </div>
                )}
                {evidenceFile && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleUploadEvidence}
                    className="w-full rounded-lg bg-[#167C80] py-2 font-semibold text-white hover:bg-[#126569] disabled:opacity-50"
                  >
                    {saving ? 'Uploading...' : `Save Evidence (${evidenceFile.name})`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSV Batch Import Modal (Admin / Owner) */}
      {csvModalOpen && isAdminOrOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/45 p-4 backdrop-blur-[2px]">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#121D2B]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/aistudio/loog_6003b99d.jpg"
                  alt="Al-Furqaan Center Logo"
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
                />
                <div>
                  <h3 className="font-display text-base font-semibold text-[#17365D] dark:text-white">
                    {language === 'om'
                      ? 'Kaffaltii CSV Ol-kaa’uun Galmee Eegaa (Pending) Uumi'
                      : 'Upload Contributions CSV (Creates Pending Records for Verification)'}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {language === 'om'
                      ? 'Columns dirqamaa: memberId (ykn memberCode), amount, date (YYYY-MM-DD). Filannoo: paymentMethod, referenceCode, notes.'
                      : 'Required columns: memberId (or memberCode e.g. AFQ-001), amount, date (YYYY-MM-DD). Optional: paymentMethod, referenceCode, notes.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-[#F3F7FA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileUpload}
                  className="block text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#17365D] file:px-3.5 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-[#1E477A]"
                />
                <button
                  type="button"
                  onClick={handleDownloadCsvTemplate}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-white px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-[#167C80]" />
                  <span>{language === 'om' ? 'Fakkeenya CSV Buusi' : 'Download Sample CSV'}</span>
                </button>
              </div>

              {csvStatusMsg && (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs font-medium text-[#167C80]">
                  {csvStatusMsg}
                </div>
              )}

              {errorMsg && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {errorMsg}
                </div>
              )}

              {csvRows.length > 0 && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      <strong>{csvFileName}</strong> ·{' '}
                      <span className="font-mono-num text-[#167C80] font-semibold">
                        {validCsvRows.length} {language === 'om' ? 'sirrii' : 'valid'}
                      </span>{' '}
                      ·{' '}
                      <span className="font-mono-num text-red-600 font-semibold">
                        {csvRows.length - validCsvRows.length}{' '}
                        {language === 'om' ? 'dogoggora' : 'invalid'}
                      </span>
                    </div>
                    <div className="font-mono-num font-semibold text-[#17365D] dark:text-sky-300">
                      {validCsvRows.reduce((s, r) => s + r.amount, 0).toLocaleString()} ETB
                    </div>
                  </div>

                  <div className="max-h-72 overflow-auto rounded-lg border border-[#C8D6E5] dark:border-slate-700">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-[#17365D] text-[11px] font-semibold text-white uppercase">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">{language === 'om' ? 'Miseensa' : 'Member'}</th>
                          <th className="px-3 py-2">{language === 'om' ? 'Guyyaa / Ji’a' : 'Date / Month'}</th>
                          <th className="px-3 py-2">{language === 'om' ? 'Mala' : 'Method'}</th>
                          <th className="px-3 py-2 text-right">ETB</th>
                          <th className="px-3 py-2">{language === 'om' ? 'Madaallii' : 'Validation'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                        {csvRows.map((r) => (
                          <tr
                            key={r.rowNumber}
                            className={r.error ? 'bg-red-50/70 dark:bg-red-950/20' : ''}
                          >
                            <td className="font-mono-num px-3 py-2 text-slate-500">
                              {r.rowNumber}
                            </td>
                            <td className="px-3 py-2">
                              {r.member ? (
                                <div>
                                  <div className="font-medium text-[#17365D] dark:text-white">
                                    {r.member.fullName}
                                  </div>
                                  <div className="font-mono-num text-[11px] text-slate-500">
                                    {r.member.memberCode}
                                  </div>
                                </div>
                              ) : (
                                <span className="font-mono-num text-red-600">{r.rawMemberId || '—'}</span>
                              )}
                            </td>
                            <td className="font-mono-num px-3 py-2">
                              <div>{r.paymentDate}</div>
                              <div className="text-[11px] text-slate-500">
                                {r.month} · {formatEthiopianShort(r.paymentDate)}
                              </div>
                            </td>
                            <td className="px-3 py-2 uppercase text-slate-600 dark:text-slate-300">
                              {r.paymentMethod.replace('_', ' ')}
                            </td>
                            <td className="font-mono-num px-3 py-2 text-right font-semibold">
                              {r.amount.toLocaleString()}
                            </td>
                            <td className="px-3 py-2">
                              {r.error ? (
                                <span className="text-[11px] font-medium text-red-600">
                                  {r.error}
                                </span>
                              ) : (
                                <span className="text-[11px] font-semibold text-amber-600">
                                  Pending Verification
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCsvModalOpen(false)}
                  className="rounded-lg border border-[#C8D6E5] px-4 py-2 font-medium text-slate-700 hover:bg-[#F3F7FA] dark:border-slate-700 dark:text-slate-300"
                >
                  {csvStatusMsg ? (language === 'om' ? 'Cufi' : 'Close') : t(language, 'cancel')}
                </button>
                {validCsvRows.length > 0 && (
                  <button
                    type="button"
                    disabled={csvImporting}
                    onClick={handleCommitCsvImport}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#167C80] px-4 py-2 font-semibold text-white hover:bg-[#126569] disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>
                      {csvImporting
                        ? language === 'om'
                          ? 'Galchaa jira...'
                          : 'Importing...'
                        : language === 'om'
                        ? `Galmee Pending ${validCsvRows.length} Uumi`
                        : `Create ${validCsvRows.length} Pending Records`}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ReceiptModal
        contribution={selectedReceipt}
        language={language}
        calendarMode={calendarMode}
        onClose={() => setSelectedReceipt(null)}
      />
    </div>
  );
};
