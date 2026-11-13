import React, { useEffect, useState } from 'react';
import {
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FolderSync,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { INSTITUTION_CONTACTS, t } from '../i18n.ts';
import { authorizeWorkspaceToken, getWorkspaceAccessToken } from '../services/auth.ts';
import {
  logAuditEvent,
  recordGoogleSheetsSyncFailure,
  recordGoogleSheetsSyncSuccess,
} from '../services/firebase.ts';
import {
  createAlFurqaanSpreadsheet,
  deleteDriveFile,
  listDriveBackupFiles,
  sendGmailNotification,
  uploadDriveJsonBackup,
  type DriveFileItem,
} from '../services/workspace.ts';
import type {
  Contribution,
  GroundedSearchResult,
  Language,
  Member,
  PeriodClosure,
  PeriodSummaryMetrics,
  UserAccount,
} from '../types.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface WorkspaceViewProps {
  language: Language;
  selectedPeriod: string;
  account: UserAccount;
  members: Member[];
  contributions: Contribution[];
  closures: PeriodClosure[];
  periodSummary: PeriodSummaryMetrics;
  hasWorkspaceToken: boolean;
  onTokenRefreshed: () => void;
}

type PendingAction =
  | { kind: 'sheets' }
  | { kind: 'drive_upload' }
  | { kind: 'drive_delete'; file: DriveFileItem }
  | { kind: 'gmail_send' }
  | null;

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  language,
  selectedPeriod,
  account,
  members,
  contributions,
  closures,
  periodSummary,
  hasWorkspaceToken,
  onTokenRefreshed,
}) => {
  const isAdminOrOwner = account.role === 'owner' || account.role === 'admin';

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);

  // Email & Reminder Composer + Gemini 3.8 Flash Drafting
  const [recipientEmail, setRecipientEmail] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [messageType, setMessageType] = useState<'receipt' | 'reminder' | 'announcement'>('reminder');
  const [emailSubject, setEmailSubject] = useState(t(language, 'reminderTemplateTitle'));
  const [emailBody, setEmailBody] = useState(
    `Kabajamaa miseensa, kaffaltiin buusii ji’aa keessanii ji’a ${selectedPeriod} irratti eegama. Mee kaffaltii keessan yeroo isaa keessatti raawwadhaa. Yoo kaffaltanii jirtan, ragaa kaffaltii galchaa ykn waajjira Giddu-gala Hifzii Qur’aanaa Al-Furqaan (${INSTITUTION_CONTACTS.phones}) qunnamaa. Galatoomaa.`
  );
  const [draftLoading, setDraftLoading] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);

  // Grounded Search Panel
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<GroundedSearchResult | null>(null);

  const loadDriveFiles = async () => {
    const token = getWorkspaceAccessToken();
    if (!token) return;
    try {
      const files = await listDriveBackupFiles(token);
      setDriveFiles(files);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to list Google Drive files.');
    }
  };

  useEffect(() => {
    if (hasWorkspaceToken && isAdminOrOwner) {
      void loadDriveFiles();
    }
  }, [hasWorkspaceToken, isAdminOrOwner]);

  const handleConnectWorkspace = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await authorizeWorkspaceToken();
      onTokenRefreshed();
      setStatusMsg('Google Workspace connected for this session.');
      await loadDriveFiles();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect Google Workspace.');
    } finally {
      setBusy(false);
    }
  };

  const applyOfficialOromooTemplate = () => {
    const member = members.find((m) => m.id === selectedMemberId);
    const name = member?.fullName || 'miseensa';
    setEmailSubject(`Yaadachiisa kaffaltii buusii ji’aa (${selectedPeriod})`);
    setEmailBody(
      `Kabajamaa ${name}, kaffaltiin buusii ji’aa keessanii ji’a ${selectedPeriod} irratti eegama. Mee kaffaltii keessan yeroo isaa keessatti raawwadhaa. Yoo kaffaltanii jirtan, ragaa kaffaltii galchaa ykn waajjira Giddu-gala Hifzii Qur’aanaa Al-Furqaan (${INSTITUTION_CONTACTS.phones}) qunnamaa. Galatoomaa.`
    );
  };

  const handleCopyReminder = async () => {
    const text = `${emailSubject}\n\n${emailBody}`;
    await navigator.clipboard.writeText(text);
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 2000);
  };

  const handleDraftWithGemini = async () => {
    const member = members.find((m) => m.id === selectedMemberId);
    const latestContrib = member
      ? contributions.find((c) => c.memberId === member.id && c.status === 'confirmed')
      : undefined;

    setDraftLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/gemini/generate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: messageType,
          memberName: member?.fullName || 'Respected Member',
          amount: latestContrib?.amount || member?.monthlyCommitment || 0,
          currency: 'ETB',
          month: latestContrib?.month || selectedPeriod,
          receiptNumber: latestContrib?.receiptNumber || '',
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Message drafting failed.');
      setEmailSubject(data.subject || '');
      setEmailBody(data.body || '');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to draft message.');
    } finally {
      setDraftLoading(false);
    }
  };

  const handleGroundedSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/gemini/grounded-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim(), language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Grounded search failed.');
      setSearchResult(data as GroundedSearchResult);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Grounded search failed.');
    } finally {
      setSearchLoading(false);
    }
  };

  const executePendingAction = async () => {
    if (!pendingAction) return;
    const token = getWorkspaceAccessToken();
    if (!token) {
      const msg =
        'Workspace token expired or not connected. Click "Connect Google Workspace" first.';
      if (pendingAction.kind === 'sheets') {
        try {
          await recordGoogleSheetsSyncFailure(account, msg);
        } catch {
          // Non-fatal if failure telemetry cannot be saved
        }
      }
      setPendingAction(null);
      setErrorMsg(msg);
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (pendingAction.kind === 'sheets') {
        const res = await createAlFurqaanSpreadsheet(token, members, contributions, periodSummary);
        setSheetUrl(res.spreadsheetUrl);
        setStatusMsg('Exported Members, Contributions, and Monthly Summary to Google Sheets.');
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
      } else if (pendingAction.kind === 'drive_upload') {
        const uploaded = await uploadDriveJsonBackup(token, members, contributions, closures);
        setStatusMsg(`Uploaded backup file "${uploaded.name}" to Google Drive.`);
        await logAuditEvent(account, 'BACKUP_GOOGLE_DRIVE', 'workspace', uploaded.id, `Uploaded Drive backup ${uploaded.name}.`);
        await loadDriveFiles();
      } else if (pendingAction.kind === 'drive_delete') {
        await deleteDriveFile(token, pendingAction.file.id);
        setStatusMsg(`Deleted "${pendingAction.file.name}" from Google Drive.`);
        await logAuditEvent(account, 'DELETE_DRIVE_FILE', 'workspace', pendingAction.file.id, `Deleted Drive file ${pendingAction.file.name}.`);
        await loadDriveFiles();
      } else if (pendingAction.kind === 'gmail_send') {
        const sent = await sendGmailNotification(token, recipientEmail.trim(), emailSubject.trim(), emailBody);
        setStatusMsg(`Email sent to ${recipientEmail.trim()} via Gmail.`);
        await logAuditEvent(account, 'SEND_GMAIL_MESSAGE', 'workspace', sent.id, `Sent Gmail message to ${recipientEmail.trim()}.`);
      }
      setPendingAction(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Workspace operation failed.';
      if (pendingAction.kind === 'sheets') {
        try {
          await recordGoogleSheetsSyncFailure(account, msg);
        } catch {
          // Non-fatal if failure telemetry cannot be saved
        }
      }
      setErrorMsg(msg);
      setPendingAction(null);
    } finally {
      setBusy(false);
    }
  };

  if (!isAdminOrOwner) {
    return (
      <div className="rounded-xl border border-[#C8D6E5] bg-white p-8 text-center text-xs text-slate-600 dark:border-slate-800 dark:bg-[#121D2B] dark:text-slate-300">
        Google Workspace synchronization (Sheets, Drive backups, and Gmail dispatch) is restricted to Owner and Admin accounts.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
        <div>
          <h3 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
            Google Workspace Connection (Drive · Sheets · Gmail)
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {hasWorkspaceToken
              ? 'Authorized in memory for this session. Database remains the source of truth; mutating actions require confirmation.'
              : 'Reconnect your Google account to refresh the in-memory Workspace session token.'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleConnectWorkspace}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#17365D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-60"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{hasWorkspaceToken ? 'Refresh Workspace Token' : 'Connect Google Workspace'}</span>
        </button>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-xs text-[#167C80]">
          {statusMsg}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Sheets & Drive Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                Google Sheets Buusii Ledger Export
              </h4>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Creates a 3-tab spreadsheet: Members ({members.length}), Contributions ({contributions.length}), and Monthly Summary ({selectedPeriod}).
              </p>
            </div>
            <FileSpreadsheet className="h-5 w-5 text-[#167C80]" />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!hasWorkspaceToken || busy}
              onClick={() => setPendingAction({ kind: 'sheets' })}
              className="rounded-lg bg-[#17365D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
            >
              Export to Google Sheets
            </button>
            {sheetUrl && (
              <a
                href={sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#167C80] hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open Created Sheet</span>
              </a>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                Google Drive Archive Backup
              </h4>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Uploads an archive JSON snapshot (Members, Contributions, Closures) to your restricted Google Drive app folder.
              </p>
            </div>
            <FolderSync className="h-5 w-5 text-[#C69C3D]" />
          </div>

          <div className="mt-5 flex items-center gap-2.5">
            <button
              type="button"
              disabled={!hasWorkspaceToken || busy}
              onClick={() => setPendingAction({ kind: 'drive_upload' })}
              className="rounded-lg bg-[#17365D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
            >
              Upload JSON Backup
            </button>
            <button
              type="button"
              disabled={!hasWorkspaceToken || busy}
              onClick={loadDriveFiles}
              className="rounded-lg border border-[#C8D6E5] px-3 py-2 text-xs font-medium text-[#17365D] hover:bg-[#F3F7FA] disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              Refresh List
            </button>
          </div>

          {driveFiles.length > 0 && (
            <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-xs dark:divide-slate-800 dark:border-slate-800">
              {driveFiles.slice(0, 5).map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[#202833] dark:text-slate-200">
                      {f.name}
                    </div>
                    {f.modifiedTime && (
                      <div className="font-mono-num text-[11px] text-slate-400">
                        {f.modifiedTime.slice(0, 10)}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {f.webViewLink && (
                      <a
                        href={f.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1 text-slate-500 hover:bg-[#F3F7FA] hover:text-[#17365D]"
                        title="Open in Drive"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingAction({ kind: 'drive_delete', file: f })}
                      className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                      title="Delete Backup"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Gmail / WhatsApp / Telegram Reminder Composer + Gemini Search */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-[#17365D] dark:text-sky-300" />
              <h4 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
                {language === 'om'
                  ? 'Yaadachiisa & Ergaa (Gmail / WhatsApp / Telegram)'
                  : 'Member Reminder & Gmail Dispatch'}
              </h4>
            </div>
            <button
              type="button"
              onClick={applyOfficialOromooTemplate}
              className="rounded border border-[#C8D6E5] bg-[#EAF1F7] px-2.5 py-1 text-[11px] font-semibold text-[#17365D] hover:bg-[#DCE7F2]"
            >
              {language === 'om' ? 'Template Afaan Oromoo Fe’i' : 'Load Official Oromoo Template'}
            </button>
          </div>

          <div className="mt-3 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            {language === 'om'
              ? 'Qajeelfama Iccitii: Hayyama miseensaa mirkaneessi; garee uummataa (public groups) irratti maqaa fi haftee dhuunfaa hin maxxansin.'
              : 'Messaging Policy: Confirm member opt-in/consent and never expose individual unpaid debt details in public WhatsApp/Telegram groups.'}
          </div>

          <div className="mt-4 space-y-3 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  Member Context
                </label>
                <select
                  value={selectedMemberId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedMemberId(id);
                    const found = members.find((m) => m.id === id);
                    if (found?.email) setRecipientEmail(found.email);
                  }}
                  className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="">Select member...</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.memberCode} — {m.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  Template Type
                </label>
                <select
                  value={messageType}
                  onChange={(e) =>
                    setMessageType(e.target.value as 'receipt' | 'reminder' | 'announcement')
                  }
                  className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="reminder">Monthly Buusii Reminder</option>
                  <option value="receipt">Buusii Receipt Thank-You</option>
                  <option value="announcement">Center Announcement</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleDraftWithGemini}
                  disabled={draftLoading}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#167C80]/30 bg-[#EAF1F7] px-3 py-2 font-semibold text-[#17365D] hover:bg-[#DCE7F2] disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#167C80]" />
                  <span>{draftLoading ? 'Drafting...' : 'Draft Bilingual'}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Recipient Email (for Gmail)
              </label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="member@example.com"
                className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Subject *
              </label>
              <input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Message Body *
              </label>
              <textarea
                rows={4}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="w-full rounded-lg border border-[#C8D6E5] bg-white px-3 py-2 outline-none focus:border-[#17365D] dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopyReminder}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 font-semibold text-[#17365D] hover:bg-[#EAF1F7]"
              >
                <Copy className="h-3.5 w-3.5 text-[#167C80]" />
                <MessageSquare className="h-3.5 w-3.5 text-[#167C80]" />
                <span>
                  {copiedMsg
                    ? 'Copied for WhatsApp / Telegram!'
                    : 'Copy for WhatsApp / Telegram'}
                </span>
              </button>

              <button
                type="button"
                disabled={
                  !hasWorkspaceToken ||
                  busy ||
                  !recipientEmail.trim() ||
                  !emailSubject.trim() ||
                  !emailBody.trim()
                }
                onClick={() => setPendingAction({ kind: 'gmail_send' })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-4 py-2 font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
              >
                <Mail className="h-3.5 w-3.5" />
                <span>Send via Gmail</span>
              </button>
            </div>
          </div>
        </div>

        {/* Dedicated Grounded Search */}
        <div className="rounded-xl border border-[#C8D6E5] bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-[#121D2B]">
          <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
            <h4 className="font-display text-sm font-semibold text-[#17365D] dark:text-white">
              Google Search Grounding (Gemini 3.8 Flash)
            </h4>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Query live banking rules, Telebirr/CBE limits, or Ethiopian charity reporting standards.
            </p>
          </div>

          <form onSubmit={handleGroundedSearch} className="mt-4 flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ask about Ethiopian bank rules..."
              className="w-full rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-3 py-2 text-xs text-[#202833] outline-none focus:border-[#17365D] focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <button
              type="submit"
              disabled={searchLoading || !searchQuery.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#17365D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1E477A] disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" />
              <span>{searchLoading ? '...' : 'Search'}</span>
            </button>
          </form>

          {searchResult && (
            <div className="mt-4 space-y-3 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] p-3.5 text-xs dark:border-slate-700 dark:bg-slate-900/50">
              <div className="whitespace-pre-wrap leading-relaxed text-[#202833] dark:text-slate-200">
                {searchResult.text}
              </div>
              {searchResult.sources.length > 0 && (
                <div className="border-t border-[#C8D6E5] pt-2.5 dark:border-slate-700">
                  <div className="mb-1.5 text-[11px] font-semibold text-slate-500 uppercase">
                    Verified Web Sources
                  </div>
                  <div className="flex flex-col gap-1">
                    {searchResult.sources.map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 truncate text-[11px] font-medium text-[#167C80] hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{src.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={
          pendingAction?.kind === 'sheets'
            ? 'Create & Export Google Spreadsheet?'
            : pendingAction?.kind === 'drive_upload'
            ? 'Upload JSON Backup to Google Drive?'
            : pendingAction?.kind === 'drive_delete'
            ? 'Delete Google Drive Backup File?'
            : 'Send Email via Gmail?'
        }
        description={
          pendingAction?.kind === 'sheets'
            ? `This will create a new Google Sheet containing ${members.length} members, ${contributions.length} contributions, and Monthly Summary (${selectedPeriod}).`
            : pendingAction?.kind === 'drive_upload'
            ? `This will upload a JSON archive snapshot (Members, Contributions, Closures) to Google Drive.`
            : pendingAction?.kind === 'drive_delete'
            ? `Are you sure you want to delete "${pendingAction.file.name}" from Google Drive?`
            : `Send Gmail message to "${recipientEmail}" with subject "${emailSubject}"?`
        }
        confirmLabel={pendingAction?.kind === 'drive_delete' ? 'Delete File' : 'Confirm & Proceed'}
        destructive={pendingAction?.kind === 'drive_delete'}
        busy={busy}
        onConfirm={executePendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
};
