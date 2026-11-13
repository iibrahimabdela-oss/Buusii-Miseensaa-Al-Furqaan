import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Lock,
  Mail,
  RefreshCw,
  Search,
  Send,
  Shield,
  UserCheck,
  X,
} from 'lucide-react';
import { getRoleLabel } from '../i18n.ts';
import {
  authorizeWorkspaceToken,
  getWorkspaceAccessToken,
} from '../services/auth.ts';
import {
  BOOTSTRAPPED_OWNER_EMAIL,
  logAuditEvent,
  recordGoogleSheetsSyncFailure,
  recordGoogleSheetsSyncSuccess,
  updateUserRoleAndStatus,
} from '../services/firebase.ts';
import {
  createAlFurqaanSpreadsheet,
  sendGmailNotification,
} from '../services/workspace.ts';
import type {
  AccountStatus,
  AuditLog,
  CalendarMode,
  CommitmentHistoryEntry,
  Contribution,
  Language,
  Member,
  PeriodSummaryMetrics,
  StatusHistoryEntry,
  SyncDiagnostic,
  UserAccount,
  UserRole,
} from '../types.ts';
import { currentPeriodKey, formatPeriodLabel } from '../utils/ethiopianCalendar.ts';
import { calculateMemberStandingSummary } from '../utils/financials.ts';
import { downloadAuditLogsCsv } from '../utils/reportExporters.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface AdminAccessViewProps {
  language: Language;
  calendarMode: CalendarMode;
  selectedPeriod: string;
  account: UserAccount;
  users: UserAccount[];
  members: Member[];
  contributions: Contribution[];
  commitmentByMember: Record<string, CommitmentHistoryEntry[]>;
  statusByMember: Record<string, StatusHistoryEntry[]>;
  periodSummary: PeriodSummaryMetrics;
  auditLogs: AuditLog[];
  sheetsSyncDiag: SyncDiagnostic | null;
  hasWorkspaceToken: boolean;
  onTokenRefreshed: () => void;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';

function resolveAuditDate(createdAt: unknown): Date | null {
  if (!createdAt) return null;
  if (createdAt instanceof Date) {
    return Number.isNaN(createdAt.getTime()) ? null : createdAt;
  }
  if (typeof createdAt === 'object') {
    const obj = createdAt as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') {
      const d = obj.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof obj.seconds === 'number') {
      const d = new Date(obj.seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    const d = new Date(createdAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatAuditTimestamp(d: Date | null): string {
  if (!d) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${toLocalDateStr(d)} ${hh}:${mm}`;
}

function formatDurationShort(ms: number, language: Language): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) {
    return language === 'om' ? `guyyaa ${days} fi sa’aa ${hours}` : `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return language === 'om' ? `sa’aa ${hours} fi daq ${mins}` : `${hours}h ${mins}m`;
  }
  return language === 'om' ? `daqiiqaa ${mins}` : `${mins}m`;
}

export const AdminAccessView: React.FC<AdminAccessViewProps> = ({
  language,
  calendarMode,
  selectedPeriod,
  account,
  users,
  members,
  contributions,
  commitmentByMember,
  statusByMember,
  periodSummary,
  auditLogs,
  sheetsSyncDiag,
  hasWorkspaceToken,
  onTokenRefreshed,
}) => {
  const isOwner = account.role === 'owner';
  const isAdminOrOwner = account.role === 'owner' || account.role === 'admin';
  const isViewer = account.role === 'viewer';

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [syncNoticeMsg, setSyncNoticeMsg] = useState<string | null>(null);
  const [confirmSheetsSyncOpen, setConfirmSheetsSyncOpen] = useState(false);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    target: UserAccount;
    role: UserRole;
    status: AccountStatus;
    linkedMemberId: string;
  } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Google Sheets Member Sync Diagnostics
  const sheetsAuditEvents = useMemo(
    () =>
      auditLogs.filter(
        (l) =>
          l.action === 'EXPORT_GOOGLE_SHEETS' ||
          l.action === 'SYNC_GOOGLE_SHEETS_FAILED'
      ),
    [auditLogs]
  );

  const sheetsSyncHealth = useMemo(() => {
    const latestAudit = sheetsAuditEvents[0] || null;
    const latestSuccessAudit =
      sheetsAuditEvents.find((l) => l.action === 'EXPORT_GOOGLE_SHEETS') || null;

    const status =
      sheetsSyncDiag?.status ??
      (latestAudit
        ? latestAudit.action === 'SYNC_GOOGLE_SHEETS_FAILED'
          ? 'failed'
          : 'success'
        : 'never');

    const lastSuccessDate = resolveAuditDate(
      sheetsSyncDiag?.lastSuccessAt ?? latestSuccessAudit?.createdAt
    );
    const lastAttemptDate = resolveAuditDate(
      sheetsSyncDiag?.lastAttemptAt ?? latestAudit?.createdAt
    );

    // If diagnostic doc isn't present yet, infer firstFailureDate from oldest consecutive failure audit event
    let inferredFirstFailureDate: Date | null = null;
    if (!sheetsSyncDiag && status === 'failed') {
      for (const ev of sheetsAuditEvents) {
        if (ev.action === 'SYNC_GOOGLE_SHEETS_FAILED') {
          const d = resolveAuditDate(ev.createdAt);
          if (d) inferredFirstFailureDate = d;
        } else {
          break;
        }
      }
    }

    const firstFailureDate =
      resolveAuditDate(sheetsSyncDiag?.firstFailureAt) ?? inferredFirstFailureDate;

    const failureStart = firstFailureDate ?? lastAttemptDate;
    const failureDurationMs =
      status === 'failed' && failureStart
        ? Math.max(0, nowMs - failureStart.getTime())
        : 0;

    const sinceLastSuccessMs = lastSuccessDate
      ? Math.max(0, nowMs - lastSuccessDate.getTime())
      : null;

    const isFailureOver24h =
      status === 'failed' && failureDurationMs >= TWENTY_FOUR_HOURS_MS;
    const isRecentFailure = status === 'failed' && !isFailureOver24h;
    const isStaleOver24h =
      status === 'success' &&
      sinceLastSuccessMs !== null &&
      sinceLastSuccessMs >= TWENTY_FOUR_HOURS_MS;

    return {
      status,
      lastSuccessDate,
      lastAttemptDate,
      firstFailureDate,
      failureDurationMs,
      sinceLastSuccessMs,
      isFailureOver24h,
      isRecentFailure,
      isStaleOver24h,
      consecutiveFailures:
        sheetsSyncDiag?.consecutiveFailures ??
        (status === 'failed' ? 1 : 0),
      lastError:
        sheetsSyncDiag?.lastError ??
        (status === 'failed' ? latestAudit?.details : undefined),
      lastSpreadsheetUrl: sheetsSyncDiag?.lastSpreadsheetUrl,
      lastSyncedMembersCount: sheetsSyncDiag?.lastSyncedMembersCount,
      lastSyncedPeriod: sheetsSyncDiag?.lastSyncedPeriod,
      triggeredByEmail:
        sheetsSyncDiag?.triggeredByEmail ?? latestAudit?.actorEmail,
    };
  }, [sheetsSyncDiag, sheetsAuditEvents, nowMs]);

  const handleRunSheetsSync = async () => {
    if (!isAdminOrOwner) return;
    setSyncingSheets(true);
    setErrorMsg(null);
    setSyncNoticeMsg(null);
    try {
      let token = getWorkspaceAccessToken();
      if (!token) {
        token = await authorizeWorkspaceToken();
        onTokenRefreshed();
      }
      const res = await createAlFurqaanSpreadsheet(
        token,
        members,
        contributions,
        periodSummary
      );
      await recordGoogleSheetsSyncSuccess(account, {
        spreadsheetId: res.spreadsheetId,
        spreadsheetUrl: res.spreadsheetUrl,
        membersCount: members.length,
        contributionsCount: contributions.length,
        periodKey: periodSummary.periodKey,
      });
      await logAuditEvent(
        account,
        'EXPORT_GOOGLE_SHEETS',
        'workspace',
        res.spreadsheetId,
        `Synchronized ${members.length} members & ${contributions.length} contributions (${periodSummary.periodKey}) to Google Sheets.`
      );
      setSyncNoticeMsg(
        language === 'om'
          ? `Wal-simsiisiinsi miseensota ${members.length} gara Google Sheets milkaa’inaan raawwatameera.`
          : `Successfully synchronized ${members.length} members and ${contributions.length} contributions to Google Sheets.`
      );
      setConfirmSheetsSyncOpen(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google Sheets synchronization failed.';
      try {
        await recordGoogleSheetsSyncFailure(account, msg);
      } catch {
        // Non-fatal if recording failure itself fails
      }
      setErrorMsg(msg);
      setConfirmSheetsSyncOpen(false);
    } finally {
      setSyncingSheets(false);
    }
  };

  // Owner-Only Automated Gmail Arrears Notifications (> 3 Months)
  const asOfPeriod = useMemo(() => currentPeriodKey(), []);
  const arrearsOver3Months = useMemo(() => {
    if (!isOwner) return { emailable: [], missingEmail: [], totalQualifying: 0 };
    const summary = calculateMemberStandingSummary(
      asOfPeriod,
      members,
      commitmentByMember,
      statusByMember,
      contributions
    );
    const qualifying = summary.rows.filter((r) => r.monthsInArrears.length > 3);
    const emailable = qualifying.filter((r) => Boolean(r.member.email && r.member.email.includes('@')));
    const missingEmail = qualifying.filter((r) => !r.member.email || !r.member.email.includes('@'));
    return { emailable, missingEmail, totalQualifying: qualifying.length };
  }, [isOwner, asOfPeriod, members, commitmentByMember, statusByMember, contributions]);

  const [deselectedArrearsIds, setDeselectedArrearsIds] = useState<Set<string>>(() => new Set());
  const [emailSubject, setEmailSubject] = useState(
    "Markaz Al-Furqaan: Yaadachiisa Buusii Miseensaa ({monthsCount} Ji'a Haftee)"
  );
  const [emailBodyTemplate, setEmailBodyTemplate] = useState(
    `Assalaamu Alaikum {fullName} ({memberCode}),\n\n` +
      `Markaz Al-Furqaan Qur'an Memorization Center irraa nagaa fi kabaja isiniif dhiyeessina.\n` +
      `Akka galmee buusii keenyaatti hanga ji'a {asOfPeriod}tti buusiin keessan ji'oota {monthsCount} ({arrearsMonths}) walitti qabamee {arrearsAmount} ETB ta'ee jira.\n\n` +
      `Maaloo kaffaltii keessan CBE, Telebirr, Coop Bank ykn waajjira Markazaatti dhiyeessuun ragaa ergaa.\n` +
      `Tajaajila keessaniif Baarakallaahu fiikum!\n\n` +
      `Markaz Al-Furqaan · Chiro, West Hararghe\n` +
      `Tel: +251991272425 / +251998889045`
  );
  const [confirmSendEmailsOpen, setConfirmSendEmailsOpen] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [gmailAuthBusy, setGmailAuthBusy] = useState(false);
  const [emailSendResults, setEmailSendResults] = useState<
    Array<{ memberId: string; name: string; email: string; ok: boolean; error?: string }>
  >([]);

  const selectedArrearsRecipients = useMemo(
    () => arrearsOver3Months.emailable.filter((r) => !deselectedArrearsIds.has(r.member.id)),
    [arrearsOver3Months.emailable, deselectedArrearsIds]
  );

  const formatArrearsTemplate = (
    template: string,
    row: (typeof arrearsOver3Months.emailable)[number]
  ): string => {
    return template
      .replace(/\{fullName\}/g, row.member.fullName)
      .replace(/\{memberCode\}/g, row.member.memberCode)
      .replace(/\{monthsCount\}/g, String(row.monthsInArrears.length))
      .replace(/\{arrearsMonths\}/g, row.monthsInArrears.join(', '))
      .replace(/\{arrearsAmount\}/g, row.arrearsEtb.toLocaleString())
      .replace(/\{asOfPeriod\}/g, formatPeriodLabel(asOfPeriod, calendarMode, language));
  };

  const toggleArrearsRecipient = (memberId: string) => {
    setDeselectedArrearsIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const handleAuthorizeGmail = async () => {
    setGmailAuthBusy(true);
    setErrorMsg(null);
    try {
      await authorizeWorkspaceToken();
      onTokenRefreshed();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to authorize Gmail access.');
    } finally {
      setGmailAuthBusy(false);
    }
  };

  const handleSendArrearsEmails = async () => {
    if (!isOwner || selectedArrearsRecipients.length === 0) return;
    setSendingEmails(true);
    setErrorMsg(null);
    setEmailSendResults([]);
    try {
      let token = getWorkspaceAccessToken();
      if (!token) {
        token = await authorizeWorkspaceToken();
        onTokenRefreshed();
      }

      const results: Array<{
        memberId: string;
        name: string;
        email: string;
        ok: boolean;
        error?: string;
      }> = [];

      for (const row of selectedArrearsRecipients) {
        const toEmail = row.member.email!;
        const subject = formatArrearsTemplate(emailSubject, row);
        const body = formatArrearsTemplate(emailBodyTemplate, row);
        try {
          await sendGmailNotification(token, toEmail, subject, body);
          results.push({
            memberId: row.member.id,
            name: row.member.fullName,
            email: toEmail,
            ok: true,
          });
        } catch (err) {
          results.push({
            memberId: row.member.id,
            name: row.member.fullName,
            email: toEmail,
            ok: false,
            error: err instanceof Error ? err.message : 'Send failed',
          });
        }
      }

      setEmailSendResults(results);
      setConfirmSendEmailsOpen(false);
      const sentCount = results.filter((r) => r.ok).length;
      if (sentCount > 0) {
        await logAuditEvent(
          account,
          'SEND_ARREARS_EMAILS',
          'system',
          'gmail_arrears_notice',
          `Owner sent automated Gmail arrears reminders to ${sentCount}/${results.length} members in arrears > 3 months.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send arrears emails via Gmail.');
      setConfirmSendEmailsOpen(false);
    } finally {
      setSendingEmails(false);
    }
  };

  // Audit Log Date-Range & Search Filters
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [auditExportNotice, setAuditExportNotice] = useState<string | null>(null);

  const applyDatePreset = (preset: Exclude<DatePreset, 'custom'>) => {
    setDatePreset(preset);
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    const now = new Date();
    const endStr = toLocalDateStr(now);
    const start = new Date(now);
    if (preset === '7d') {
      start.setDate(now.getDate() - 6);
    } else if (preset === '30d') {
      start.setDate(now.getDate() - 29);
    }
    setFromDate(toLocalDateStr(start));
    setToDate(endStr);
  };

  const clearAuditFilters = () => {
    setDatePreset('all');
    setFromDate('');
    setToDate('');
    setLogSearch('');
  };

  const filteredAuditLogs = useMemo(() => {
    const startMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const endMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    const q = logSearch.trim().toLowerCase();

    return auditLogs.filter((log) => {
      const resolved = resolveAuditDate(log.createdAt);
      if (startMs !== null || endMs !== null) {
        if (!resolved) return false;
        const ms = resolved.getTime();
        if (startMs !== null && ms < startMs) return false;
        if (endMs !== null && ms > endMs) return false;
      }
      if (q) {
        const hay = `${log.action} ${log.details} ${log.actorEmail} ${log.targetId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [auditLogs, fromDate, toDate, logSearch]);

  const hasActiveAuditFilter = Boolean(fromDate || toDate || logSearch.trim());

  const applyChange = async () => {
    if (!pendingRoleChange) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await updateUserRoleAndStatus(account, pendingRoleChange.target.uid, {
        role: pendingRoleChange.role,
        status: pendingRoleChange.status,
        linkedMemberId: pendingRoleChange.linkedMemberId || null,
      });
      setPendingRoleChange(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update user role.');
      setPendingRoleChange(null);
    } finally {
      setBusy(false);
    }
  };

  if (!isAdminOrOwner && !isViewer) {
    return (
      <div className="rounded-xl border border-[#C8D6E5] bg-white p-8 text-center text-xs text-slate-600 dark:border-slate-800 dark:bg-[#121D2B]">
        Access Control & Audit Logs are restricted to Owner, Admin, and Auditor (Viewer) roles.
      </div>
    );
  }

  const rolesInfo: Array<{ role: UserRole; descOm: string; descEn: string }> = [
    {
      role: 'owner',
      descOm: 'Fayyadamaa, setting, integration, backup, hayyama fi audit log guutuu bulcha.',
      descEn: 'Full governance: manage users, 5-tier roles, settings, backups, and period closures.',
    },
    {
      role: 'admin',
      descOm: 'Miseensa uumuu/gulaaluu, waadaa jijjiiruu, kaffaltii mirkaneessuu, fi ji’a cufuu.',
      descEn: 'Register/edit members, record commitment/status changes, approve payments, close periods.',
    },
    {
      role: 'cashier',
      descOm: 'Kaffaltii galmeessuu, ragaa maxxansuu fi nagahee kennuu; kaffaltii hin haqu.',
      descEn: 'Record payments, attach evidence, issue receipts. Cannot delete records or manage security.',
    },
    {
      role: 'viewer',
      descOm: 'Gabaasa waliigalaa, cufiinsa ji’aa fi audit log ilaala; daataa dhuunfaa hin gulaalu.',
      descEn: 'Read-only Auditor: inspects aggregate reports, closures, and audit trail without editing.',
    },
    {
      role: 'member',
      descOm: 'Odeeffannoo fi kaffaltii ofii qofa ilaala; ragaa kaffaltii dhiyeessa.',
      descEn: 'Views own linked profile/receipts and uploads payment evidence. Isolated from other members.',
    },
  ];

  return (
    <div className="space-y-6">
      {/* 5-Tier RBAC Matrix Summary */}
      <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[#17365D] dark:text-sky-300" />
            <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
              {language === 'om'
                ? 'Matriiksii Gahee Sadarkaa 5 (Qoodinsa Hojii)'
                : '5-Tier Role Permission Matrix & Segregation of Duties'}
            </h3>
          </div>
          <span className="font-mono-num text-[11px] text-slate-500">
            Bootstrap Owner: {BOOTSTRAPPED_OWNER_EMAIL}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 text-xs">
          {rolesInfo.map((ri) => (
            <div
              key={ri.role}
              className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3 dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div className="font-display font-bold text-[#17365D] dark:text-sky-300">
                {getRoleLabel(language, ri.role)}
              </div>
              <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-400">
                {language === 'om' ? ri.descOm : ri.descEn}
              </p>
            </div>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {/* User Directory (Owner & Admin) */}
      {isAdminOrOwner && (
        <div className="overflow-hidden rounded-xl border border-[#C8D6E5] bg-white dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-center justify-between border-b border-[#C8D6E5] px-5 py-3.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-[#167C80]" />
              <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                {language === 'om'
                  ? `Fayyadamtota Galmaa’an (${users.length})`
                  : `Registered Platform Users (${users.length})`}
              </h3>
            </div>
            {!isOwner && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                <Lock className="h-3 w-3" />
                Only Owner can modify roles
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#17365D] text-[11px] font-semibold tracking-wider text-white uppercase">
                <tr>
                  <th className="px-5 py-2.5">User</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Linked Member Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                {users.map((u, idx) => {
                  const isProtectedOwner =
                    u.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
                  return (
                    <tr
                      key={u.uid}
                      className={idx % 2 === 1 ? 'bg-[#F3F7FA] dark:bg-slate-900/30' : ''}
                    >
                      <td className="px-5 py-2.5 font-medium text-[#202833] dark:text-white">
                        {u.displayName}
                        {u.uid === account.uid && (
                          <span className="ml-1.5 text-[11px] text-slate-400">(You)</span>
                        )}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {u.email}
                      </td>
                      <td className="px-4 py-2.5">
                        {isOwner && !isProtectedOwner ? (
                          <select
                            value={u.role}
                            onChange={(e) =>
                              setPendingRoleChange({
                                target: u,
                                role: e.target.value as UserRole,
                                status: u.status,
                                linkedMemberId: u.linkedMemberId || '',
                              })
                            }
                            className="rounded border border-[#C8D6E5] bg-white px-2 py-1 text-xs font-medium outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                          >
                            <option value="owner">owner</option>
                            <option value="admin">admin</option>
                            <option value="cashier">cashier</option>
                            <option value="viewer">viewer</option>
                            <option value="member">member</option>
                          </select>
                        ) : (
                          <span className="font-semibold uppercase text-[#17365D] dark:text-sky-300">
                            {u.role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {isOwner && !isProtectedOwner ? (
                          <select
                            value={u.status}
                            onChange={(e) =>
                              setPendingRoleChange({
                                target: u,
                                role: u.role,
                                status: e.target.value as AccountStatus,
                                linkedMemberId: u.linkedMemberId || '',
                              })
                            }
                            className="rounded border border-[#C8D6E5] bg-white px-2 py-1 text-xs font-medium outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                          >
                            <option value="active">active</option>
                            <option value="suspended">suspended</option>
                          </select>
                        ) : (
                          <span
                            className={`text-[11px] font-semibold uppercase ${
                              u.status === 'active' ? 'text-[#167C80]' : 'text-red-600'
                            }`}
                          >
                            {u.status}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        {isOwner ? (
                          <select
                            value={u.linkedMemberId || ''}
                            onChange={(e) =>
                              setPendingRoleChange({
                                target: u,
                                role: u.role,
                                status: u.status,
                                linkedMemberId: e.target.value,
                              })
                            }
                            className="w-full max-w-[220px] rounded border border-[#C8D6E5] bg-white px-2 py-1 text-xs outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                          >
                            <option value="">Not linked</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.memberCode} — {m.fullName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-mono-num text-slate-500">
                            {u.linkedMemberId || '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Google Sheets Member Synchronization Diagnostic Panel (Visible to Owner, Admin, Viewer) */}
      <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-[#167C80]" />
            <div>
              <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                {language === 'om'
                  ? 'Diagnoostikii Wal-simsiisa Google Sheets (Daataa Miseensotaa)'
                  : 'Google Sheets Member Sync Diagnostics'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {language === 'om'
                  ? 'Haala wal-simsiisa dhiyoo fi akeekkachiisa kufaatii sa’aatii 24 olii hordofa.'
                  : 'Monitors last successful member data sync with Google Sheets and alerts on failures lasting > 24 hours.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {sheetsSyncHealth.lastSpreadsheetUrl && (
              <a
                href={sheetsSyncHealth.lastSpreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300"
              >
                <ExternalLink className="h-3.5 w-3.5 text-[#167C80]" />
                <span>{language === 'om' ? 'Sheet Bani' : 'Open Last Sheet'}</span>
              </a>
            )}
            {isAdminOrOwner && (
              <button
                type="button"
                disabled={syncingSheets}
                onClick={() => setConfirmSheetsSyncOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingSheets ? 'animate-spin' : ''}`} />
                <span>
                  {syncingSheets
                    ? '...'
                    : sheetsSyncHealth.status === 'failed'
                    ? language === 'om'
                      ? 'Irra Deebi’ii Simsiisi'
                      : 'Retry Google Sheets Sync'
                    : language === 'om'
                    ? 'Daataa Amma Simsiisi'
                    : 'Sync Member Data Now'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* > 24 Hour Failure Alert & Status Banner */}
        <div className="mt-4 space-y-3 text-xs">
          {sheetsSyncHealth.isFailureOver24h && (
            <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-200">
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-display font-bold">
                  {language === 'om'
                    ? `AKEEKKACHIISA HAMAAN: Wal-simsiisiinsi Google Sheets ${formatDurationShort(sheetsSyncHealth.failureDurationMs, language)}f (> sa’aatii 24) gufatee jira`
                    : `CRITICAL SYNC ALERT: Google Sheets synchronization has failed for ${formatDurationShort(sheetsSyncHealth.failureDurationMs, language)} (> 24 hours)`}
                </div>
                <p className="leading-relaxed text-red-800 dark:text-red-300">
                  {language === 'om'
                    ? `Yaalii walitti aanu ${sheetsSyncHealth.consecutiveFailures} gufateera. Wal-simsiisiinsi milkaa’aan dhumaa: ${
                        sheetsSyncHealth.lastSuccessDate
                          ? formatAuditTimestamp(sheetsSyncHealth.lastSuccessDate)
                          : 'Hin galmoofne'
                      }. Hayyama Google Workspace haaromsaatii amma irra deebi’aa yaalaa.`
                    : `${sheetsSyncHealth.consecutiveFailures} consecutive failure(s) recorded since ${formatAuditTimestamp(
                        sheetsSyncHealth.firstFailureDate ?? sheetsSyncHealth.lastAttemptDate
                      )}. Last successful sync: ${
                        sheetsSyncHealth.lastSuccessDate
                          ? formatAuditTimestamp(sheetsSyncHealth.lastSuccessDate)
                          : 'None recorded'
                      }. Reconnect Google Workspace and retry sync.`}
                </p>
              </div>
            </div>
          )}

          {sheetsSyncHealth.isRecentFailure && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-display font-bold">
                  {language === 'om'
                    ? `Wal-simsiisiinsi Google Sheets Gufate (${formatDurationShort(sheetsSyncHealth.failureDurationMs, language)})`
                    : `Google Sheets Sync Failed (${formatDurationShort(sheetsSyncHealth.failureDurationMs, language)} elapsed)`}
                </div>
                <p className="leading-relaxed text-amber-900 dark:text-amber-300">
                  {language === 'om'
                    ? `Yaalii ${sheetsSyncHealth.consecutiveFailures} gufate. Yoo sa’aatii 24 keessatti hin furamne akeekkachiisa hamaatti ol-guddifama.`
                    : `${sheetsSyncHealth.consecutiveFailures} consecutive failed attempt(s). Escalates to critical alert if unresolved beyond 24 hours.`}
                </p>
              </div>
            </div>
          )}

          {sheetsSyncHealth.isStaleOver24h && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                {language === 'om'
                  ? `Wal-simsiisiinsi milkaa’aan dhumaa sa’aatii 24 ol (${formatDurationShort(sheetsSyncHealth.sinceLastSuccessMs ?? 0, language)} dura) ta’eera. Daataa miseensotaa haaromsuuf amma simsiisaa.`
                  : `Last successful Google Sheets sync was ${formatDurationShort(sheetsSyncHealth.sinceLastSuccessMs ?? 0, language)} ago (> 24 hours). Run a sync to keep the ledger spreadsheet current.`}
              </div>
            </div>
          )}

          {syncNoticeMsg && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-medium text-[#167C80] dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-300">
              {syncNoticeMsg}
            </div>
          )}

          {/* 4 Diagnostic KPI Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Haala Wal-simsiisaa' : 'Sync Health Status'}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 font-display text-sm font-bold">
                {sheetsSyncHealth.isFailureOver24h ? (
                  <span className="text-red-600 dark:text-red-400">
                    {language === 'om' ? 'Cimaa (> 24h Gufate)' : 'CRITICAL (> 24h Failed)'}
                  </span>
                ) : sheetsSyncHealth.isRecentFailure ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    {language === 'om' ? 'Gufateera (< 24h)' : 'Failed (< 24h)'}
                  </span>
                ) : sheetsSyncHealth.status === 'success' ? (
                  <span className="inline-flex items-center gap-1 text-[#167C80] dark:text-teal-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {language === 'om' ? 'Fayyaa (Synced)' : 'Healthy'}
                  </span>
                ) : (
                  <span className="text-slate-600 dark:text-slate-300">
                    {language === 'om' ? 'Hin Simsiifamne' : 'Not Yet Synced'}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {hasWorkspaceToken || getWorkspaceAccessToken()
                  ? language === 'om'
                    ? 'Hayyamni Google Sheets qophaa’aadha'
                    : 'Workspace OAuth token active'
                  : language === 'om'
                  ? 'Hayyamni Sheets ni barbaachisa'
                  : 'Workspace token required to run'}
              </div>
            </div>

            <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Milkaa’ina Dhumaa' : 'Last Successful Sync'}
              </div>
              <div className="font-mono-num mt-1.5 text-sm font-bold text-[#17365D] dark:text-white">
                {formatAuditTimestamp(sheetsSyncHealth.lastSuccessDate)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {sheetsSyncHealth.sinceLastSuccessMs !== null
                  ? `${formatDurationShort(sheetsSyncHealth.sinceLastSuccessMs, language)} ${
                      language === 'om' ? 'dura' : 'ago'
                    }${
                      typeof sheetsSyncHealth.lastSyncedMembersCount === 'number'
                        ? ` · ${sheetsSyncHealth.lastSyncedMembersCount} members`
                        : ''
                    }`
                  : language === 'om'
                  ? 'Galmeen milkaa’inaa hin jiru'
                  : 'No successful export recorded'}
              </div>
            </div>

            <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Yaalii Dhumaa & Kufaatii' : 'Last Attempt & Streak'}
              </div>
              <div className="font-mono-num mt-1.5 text-sm font-bold text-[#17365D] dark:text-white">
                {formatAuditTimestamp(sheetsSyncHealth.lastAttemptDate)}
              </div>
              <div className="mt-1 truncate text-[11px] text-slate-500">
                {sheetsSyncHealth.consecutiveFailures > 0
                  ? language === 'om'
                    ? `Kufaatii walitti aanu: ${sheetsSyncHealth.consecutiveFailures}`
                    : `${sheetsSyncHealth.consecutiveFailures} consecutive failure(s)`
                  : sheetsSyncHealth.triggeredByEmail
                  ? sheetsSyncHealth.triggeredByEmail
                  : '—'}
              </div>
            </div>

            <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Daangaa Sa’aatii 24 (SLA)' : '24-Hour Failure Monitor'}
              </div>
              <div className="font-mono-num mt-1.5 text-sm font-bold text-[#17365D] dark:text-white">
                {sheetsSyncHealth.status === 'failed'
                  ? formatDurationShort(sheetsSyncHealth.failureDurationMs, language)
                  : sheetsSyncHealth.sinceLastSuccessMs !== null
                  ? formatDurationShort(sheetsSyncHealth.sinceLastSuccessMs, language)
                  : '0m'}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {sheetsSyncHealth.isFailureOver24h
                  ? language === 'om'
                    ? 'Akeekkachiisni >24h hojii irra jira'
                    : '>24h failure threshold breached'
                  : sheetsSyncHealth.isStaleOver24h
                  ? language === 'om'
                    ? 'Milkaa’inni >24h darbeera'
                    : 'Last success >24h ago'
                  : language === 'om'
                  ? 'Daangaa sa’aatii 24 keessa'
                  : 'Within 24h SLA window'}
              </div>
            </div>
          </div>

          {sheetsSyncHealth.status === 'failed' && sheetsSyncHealth.lastError && (
            <div className="rounded-lg border border-red-200 bg-white px-3.5 py-2.5 dark:border-red-900/50 dark:bg-slate-900/60">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
                {language === 'om' ? 'Ibsa Dogoggora Dhumaa' : 'Last Synchronization Error'}
              </div>
              <div className="font-mono-num mt-1 break-all text-xs text-slate-700 dark:text-slate-200">
                {sheetsSyncHealth.lastError}
              </div>
            </div>
          )}

          {sheetsAuditEvents.length > 0 && (
            <div className="rounded-lg border border-[#C8D6E5] dark:border-slate-700">
              <div className="border-b border-[#C8D6E5] bg-[#F3F7FA] px-3.5 py-2 text-[11px] font-semibold text-[#17365D] dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                {language === 'om'
                  ? 'Sochii Wal-simsiisa Google Sheets Dhiyoo'
                  : 'Recent Google Sheets Synchronization Events'}
              </div>
              <div className="divide-y divide-[#C8D6E5]/60 dark:divide-slate-800">
                {sheetsAuditEvents.slice(0, 5).map((ev) => (
                  <div
                    key={ev.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-[11px]"
                  >
                    <div className="min-w-0 flex-1">
                      <span
                        className={`font-mono-num font-semibold ${
                          ev.action === 'SYNC_GOOGLE_SHEETS_FAILED'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-[#167C80] dark:text-teal-400'
                        }`}
                      >
                        {ev.action}
                      </span>
                      <span className="mx-1.5 text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-slate-700 dark:text-slate-300">{ev.details}</span>
                    </div>
                    <div className="font-mono-num shrink-0 text-slate-500 dark:text-slate-400">
                      {ev.actorEmail} · {formatAuditTimestamp(resolveAuditDate(ev.createdAt))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Owner-Only Automated Gmail Arrears Notifications (> 3 Months) */}
      {isOwner && (
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-[#C69C3D]" />
              <div>
                <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                  {language === 'om'
                    ? 'Yaadachiisa Email Haftee Ji’a 3 Ol (> 3 Months Arrears · Owner)'
                    : 'Automated Gmail Arrears Notifications (> 3 Months · Owner Only)'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {language === 'om'
                    ? `Miseensota hanga ${asOfPeriod}tti ji’a 3 ol haftee qabaniif karaa Gmail ergaa yaadachiisaa erga.`
                    : `Identifies members with > 3 unpaid months as of ${asOfPeriod} and dispatches reminders via Gmail.`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!hasWorkspaceToken && !getWorkspaceAccessToken() ? (
                <button
                  type="button"
                  disabled={gmailAuthBusy}
                  onClick={handleAuthorizeGmail}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#C69C3D] bg-[#FFFDF7] px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#FAF4E4] disabled:opacity-50 dark:bg-slate-800 dark:text-amber-300"
                >
                  <Mail className="h-3.5 w-3.5 text-[#C69C3D]" />
                  <span>
                    {gmailAuthBusy
                      ? '...'
                      : language === 'om'
                      ? 'Gmail Hayyamsiisi'
                      : 'Authorize Gmail'}
                  </span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#167C80] dark:text-teal-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Gmail Connected</span>
                </span>
              )}
            </div>
          </div>

          {arrearsOver3Months.totalQualifying === 0 ? (
            <div className="mt-4 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-4 text-center text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              {language === 'om'
                ? 'Miseensi ji’a 3 ol haftee qabu hin jiru — miseensonni hundi haala gaarii irra jiru.'
                : 'No members are currently in arrears for more than 3 months.'}
            </div>
          ) : (
            <div className="mt-4 space-y-4 text-xs">
              {arrearsOver3Months.missingEmail.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    {language === 'om'
                      ? `Miseensonni ${arrearsOver3Months.missingEmail.length} ji'a 3 ol haftee qaban email hin galmoofne: `
                      : `${arrearsOver3Months.missingEmail.length} member(s) in arrears > 3 months have no email on file: `}
                    <span className="font-semibold">
                      {arrearsOver3Months.missingEmail
                        .map((r) => `${r.member.memberCode} (${r.member.fullName})`)
                        .join(', ')}
                    </span>
                  </div>
                </div>
              )}

              {arrearsOver3Months.emailable.length > 0 && (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                  {/* Recipient Checklist */}
                  <div className="space-y-2 lg:col-span-6">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#17365D] dark:text-white">
                        {language === 'om'
                          ? `Miseensota Email Qaban (${selectedArrearsRecipients.length}/${arrearsOver3Months.emailable.length})`
                          : `Qualifying Recipients (${selectedArrearsRecipients.length}/${arrearsOver3Months.emailable.length})`}
                      </span>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setDeselectedArrearsIds(new Set())}
                          className="font-semibold text-[#167C80] hover:underline"
                        >
                          {language === 'om' ? 'Hunda Filadhu' : 'Select All'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeselectedArrearsIds(
                              new Set(arrearsOver3Months.emailable.map((r) => r.member.id))
                            )
                          }
                          className="text-slate-500 hover:underline"
                        >
                          {language === 'om' ? 'Haqi' : 'Clear'}
                        </button>
                      </div>
                    </div>

                    <div className="max-h-64 divide-y divide-[#C8D6E5]/60 overflow-y-auto rounded-lg border border-[#C8D6E5] dark:divide-slate-800 dark:border-slate-700">
                      {arrearsOver3Months.emailable.map((row) => {
                        const checked = !deselectedArrearsIds.has(row.member.id);
                        return (
                          <label
                            key={row.member.id}
                            className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[#F3F7FA] dark:hover:bg-slate-900/40"
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleArrearsRecipient(row.member.id)}
                                className="h-3.5 w-3.5 accent-[#17365D]"
                              />
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-[#17365D] dark:text-white">
                                  {row.member.memberCode} · {row.member.fullName}
                                </div>
                                <div className="font-mono-num truncate text-[11px] text-slate-500">
                                  {row.member.email}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="font-mono-num font-bold text-red-600 dark:text-red-400">
                                {row.arrearsEtb.toLocaleString()} ETB
                              </div>
                              <div className="font-mono-num text-[11px] text-slate-500">
                                {row.monthsInArrears.length}{' '}
                                {language === 'om' ? 'ji’a haftee' : 'months'}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Email Template & Trigger */}
                  <div className="space-y-3 lg:col-span-6">
                    <div>
                      <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                        {language === 'om' ? 'Mata-duree Email (Subject)' : 'Email Subject'}
                      </label>
                      <input
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-1.5 text-xs outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                        {language === 'om' ? 'Ergaa Yaadachiisaa' : 'Notification Message'}
                      </label>
                      <textarea
                        rows={5}
                        value={emailBodyTemplate}
                        onChange={(e) => setEmailBodyTemplate(e.target.value)}
                        className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 text-xs leading-relaxed outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                      />
                      <div className="mt-1 text-[10px] text-slate-400">
                        Placeholders: {'{fullName}'}, {'{memberCode}'}, {'{monthsCount}'},{' '}
                        {'{arrearsMonths}'}, {'{arrearsAmount}'}, {'{asOfPeriod}'}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={selectedArrearsRecipients.length === 0 || sendingEmails}
                        onClick={() => setConfirmSendEmailsOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>
                          {language === 'om'
                            ? `Email Yaadachiisaa Ergi (${selectedArrearsRecipients.length})`
                            : `Send Arrears Emails (${selectedArrearsRecipients.length})`}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {emailSendResults.length > 0 && (
                <div className="rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="font-semibold text-[#17365D] dark:text-white">
                    {language === 'om' ? 'Bu’aa Ergamsa Gmail' : 'Gmail Dispatch Summary'}
                  </div>
                  <div className="mt-2 space-y-1">
                    {emailSendResults.map((res) => (
                      <div
                        key={res.memberId}
                        className="flex items-center justify-between text-[11px]"
                      >
                        <span>
                          {res.name} (<span className="font-mono-num">{res.email}</span>)
                        </span>
                        <span className={res.ok ? 'font-semibold text-[#167C80]' : 'font-semibold text-red-600'}>
                          {res.ok ? 'Sent' : `Failed: ${res.error}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Immutable Audit Log Stream (Visible to Owner, Admin, and Viewer/Auditor) */}
      <div className="overflow-hidden rounded-xl border border-[#C8D6E5] bg-white dark:border-slate-800 dark:bg-[#121D2B]">
        <div className="space-y-3 border-b border-[#C8D6E5] px-5 py-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
              {language === 'om'
                ? 'Galmee Seenaa & Audit Trail (Kan Hin Haqamne)'
                : 'Immutable Governance & Activity Audit Trail'}
            </h3>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                {language === 'om'
                  ? `Agarsiifamaa: ${filteredAuditLogs.length} / ${auditLogs.length}`
                  : `Showing ${filteredAuditLogs.length} of ${auditLogs.length} events`}
              </span>
              <button
                type="button"
                disabled={filteredAuditLogs.length === 0}
                onClick={() => {
                  downloadAuditLogsCsv(
                    filteredAuditLogs,
                    account.displayName || account.email,
                    {
                      fromDate: fromDate || undefined,
                      toDate: toDate || undefined,
                      search: logSearch || undefined,
                    }
                  );
                  setAuditExportNotice(
                    language === 'om'
                      ? `Galmeen audit ${filteredAuditLogs.length} gara CSV buufameera.`
                      : `Exported ${filteredAuditLogs.length} audit log event(s) to CSV.`
                  );
                  setTimeout(() => setAuditExportNotice(null), 5000);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#167C80] bg-[#EAF1F7] px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#DCE8F2] disabled:opacity-40 dark:border-teal-600 dark:bg-slate-800 dark:text-teal-300"
              >
                <Download className="h-3.5 w-3.5 text-[#167C80]" />
                <span>{language === 'om' ? 'Gara CSV Baasi' : 'Export to CSV'}</span>
              </button>
            </div>
          </div>

          {auditExportNotice && (
            <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-[#167C80] dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{auditExportNotice}</span>
            </div>
          )}

          {/* Date-Range Filter & Search Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-lg bg-[#F3F7FA] p-1 dark:bg-slate-900">
                {(
                  [
                    { key: 'all', om: 'Hunda', en: 'All' },
                    { key: 'today', om: 'Har’a', en: 'Today' },
                    { key: '7d', om: 'Guyyaa 7', en: '7 Days' },
                    { key: '30d', om: 'Guyyaa 30', en: '30 Days' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => applyDatePreset(preset.key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      datePreset === preset.key
                        ? 'bg-[#17365D] text-white'
                        : 'text-slate-600 hover:text-[#17365D] dark:text-slate-300'
                    }`}
                  >
                    {language === 'om' ? preset.om : preset.en}
                  </button>
                ))}
              </div>

              <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
                <Calendar className="h-3.5 w-3.5 text-[#167C80]" />
                <span className="text-slate-500 dark:text-slate-400">
                  {language === 'om' ? 'Irraa:' : 'From:'}
                </span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setDatePreset(e.target.value || toDate ? 'custom' : 'all');
                  }}
                  aria-label="Audit logs from date"
                  className="font-mono-num bg-transparent font-medium text-[#17365D] outline-none dark:text-slate-100"
                />
              </label>

              <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
                <span className="text-slate-500 dark:text-slate-400">
                  {language === 'om' ? 'Hanga:' : 'To:'}
                </span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setDatePreset(fromDate || e.target.value ? 'custom' : 'all');
                  }}
                  aria-label="Audit logs to date"
                  className="font-mono-num bg-transparent font-medium text-[#17365D] outline-none dark:text-slate-100"
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-56">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder={
                    language === 'om' ? 'Gocha ykn email...' : 'Action, actor, details...'
                  }
                  className="w-full rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] py-1.5 pr-3 pl-8 text-xs text-[#202833] outline-none focus:border-[#17365D] focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              {hasActiveAuditFilter && (
                <button
                  type="button"
                  onClick={clearAuditFilters}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#C8D6E5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#17365D] hover:bg-[#EAF1F7] whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>{language === 'om' ? 'Haqi' : 'Clear'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {auditLogs.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500">
            {language === 'om'
              ? 'Galmeen seenaa hin argamne.'
              : 'No audit events recorded yet.'}
          </div>
        ) : filteredAuditLogs.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500">
            <div>
              {language === 'om'
                ? 'Seenaan yeroo ykn barbaacha filatame kanaan wal-simu hin argamne.'
                : 'No audit events match the selected date range or search filter.'}
            </div>
            <button
              type="button"
              onClick={clearAuditFilters}
              className="mt-3 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7]"
            >
              {language === 'om' ? 'Calallii Haqi' : 'Clear Filters'}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[#C8D6E5]/60 text-xs dark:divide-slate-800">
            {filteredAuditLogs.slice(0, 100).map((log, idx) => {
              const resolvedDate = resolveAuditDate(log.createdAt);
              return (
                <div
                  key={log.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 ${
                    idx % 2 === 1 ? 'bg-[#F3F7FA] dark:bg-slate-900/30' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-mono-num font-semibold text-[#167C80]">
                      {log.action}
                    </span>
                    <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
                    <span className="text-[#202833] dark:text-slate-200">{log.details}</span>
                  </div>
                  <div className="font-mono-num shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{log.actorEmail}</span>
                    <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
                    <span>{formatAuditTimestamp(resolvedDate)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingRoleChange)}
        title="Confirm Access Control Update"
        description={`Update ${pendingRoleChange?.target.displayName} (${pendingRoleChange?.target.email}) to role "${pendingRoleChange?.role}", status "${pendingRoleChange?.status}"${
          pendingRoleChange?.linkedMemberId
            ? `, linked to member ID ${pendingRoleChange.linkedMemberId}`
            : ''
        }?`}
        confirmLabel="Apply Access Update"
        busy={busy}
        onConfirm={applyChange}
        onCancel={() => setPendingRoleChange(null)}
      />

      <ConfirmDialog
        open={confirmSendEmailsOpen}
        title={
          language === 'om'
            ? `Email Yaadachiisaa Miseensota ${selectedArrearsRecipients.length}tti Erguu?`
            : `Send Gmail Arrears Notifications to ${selectedArrearsRecipients.length} Member(s)?`
        }
        description={
          language === 'om'
            ? `Account Gmail keessaniin miseensota ji’a 3 ol haftee qaban ${selectedArrearsRecipients.length} (waliigala ${selectedArrearsRecipients
                .reduce((s, r) => s + r.arrearsEtb, 0)
                .toLocaleString()} ETB) email yaadachiisaa ni erga.`
            : `This will send personalized reminder emails via your connected Gmail account to ${selectedArrearsRecipients.length} member(s) who are more than 3 months in arrears (total ${selectedArrearsRecipients
                .reduce((s, r) => s + r.arrearsEtb, 0)
                .toLocaleString()} ETB).`
        }
        confirmLabel={language === 'om' ? 'Eeyyee, Ergi' : 'Send via Gmail'}
        busy={sendingEmails}
        onConfirm={handleSendArrearsEmails}
        onCancel={() => setConfirmSendEmailsOpen(false)}
      />

      <ConfirmDialog
        open={confirmSheetsSyncOpen}
        title={
          language === 'om'
            ? 'Daataa Miseensotaa gara Google Sheets Simsiisuu?'
            : 'Synchronize Member Data with Google Sheets?'
        }
        description={
          language === 'om'
            ? `Miseensota ${members.length}, kaffaltii ${contributions.length}, fi cuunfaa ji’aa (${selectedPeriod}) gara Google Sheets haaraatti ni erga.`
            : `This will create and populate a Google Sheets ledger with ${members.length} member(s), ${contributions.length} contribution(s), and Monthly Summary (${selectedPeriod}).`
        }
        confirmLabel={language === 'om' ? 'Eeyyee, Simsiisi' : 'Confirm & Sync'}
        busy={syncingSheets}
        onConfirm={handleRunSheetsSync}
        onCancel={() => setConfirmSheetsSyncOpen(false)}
      />
    </div>
  );
};
