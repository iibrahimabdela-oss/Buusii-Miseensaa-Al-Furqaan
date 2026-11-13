import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Calendar,
  FileBarChart2,
  FolderKanban,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Receipt,
  Search,
  ShieldCheck,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { AdminAccessView } from './components/AdminAccessView.tsx';
import { ContributionsView } from './components/ContributionsView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { MembersView } from './components/MembersView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { SignInScreen } from './components/SignInScreen.tsx';
import { WorkspaceView } from './components/WorkspaceView.tsx';
import { INSTITUTION_CONTACTS, getRoleLabel, t } from './i18n.ts';
import {
  ensureUserProfile,
  googleSignIn,
  initAuthObserver,
  logout,
} from './services/auth.ts';
import {
  fetchAllMembersHistories,
  seedInitialSampleData,
  subscribeAllUsers,
  subscribeAuditLogs,
  subscribeCenterStats,
  subscribeContributions,
  subscribeFinancialGoal,
  subscribeGoogleSheetsSyncDiagnostic,
  subscribeMeetingMinutes,
  subscribeMembers,
  subscribePaymentEvidence,
  subscribePeriodClosures,
  subscribeUserProfile,
} from './services/firebase.ts';
import type {
  AuditLog,
  CalendarMode,
  CenterStats,
  CommitmentHistoryEntry,
  Contribution,
  FinancialGoal,
  Language,
  MeetingMinute,
  Member,
  PaymentEvidence,
  PeriodClosure,
  StatusHistoryEntry,
  SyncDiagnostic,
  TabKey,
  UserAccount,
} from './types.ts';
import { currentPeriodKey, formatEthiopianShort } from './utils/ethiopianCalendar.ts';
import {
  calculateAnnualBreakdown,
  calculatePeriodSummary,
} from './utils/financials.ts';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [hasWorkspaceToken, setHasWorkspaceToken] = useState(false);
  const [account, setAccount] = useState<UserAccount | null>(null);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [language, setLanguage] = useState<Language>('om');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('ethiopian');
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => currentPeriodKey());
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [evidenceList, setEvidenceList] = useState<PaymentEvidence[]>([]);
  const [closures, setClosures] = useState<PeriodClosure[]>([]);
  const [centerStats, setCenterStats] = useState<CenterStats | null>(null);
  const [allUsers, setAllUsers] = useState<UserAccount[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [commitmentByMember, setCommitmentByMember] = useState<
    Record<string, CommitmentHistoryEntry[]>
  >({});
  const [statusByMember, setStatusByMember] = useState<
    Record<string, StatusHistoryEntry[]>
  >({});
  const [sheetsSyncDiag, setSheetsSyncDiag] = useState<SyncDiagnostic | null>(null);
  const [financialGoal, setFinancialGoal] = useState<FinancialGoal | null>(null);
  const [meetingMinutes, setMeetingMinutes] = useState<MeetingMinute[]>([]);
  const [seeding, setSeeding] = useState(false);

  const [globalSearch, setGlobalSearch] = useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [focusedMemberId, setFocusedMemberId] = useState<string | null>(null);
  const globalSearchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (
        globalSearchRef.current &&
        !globalSearchRef.current.contains(e.target as Node)
      ) {
        setGlobalSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    const unsub = initAuthObserver((user, hasToken) => {
      setFirebaseUser(user);
      setHasWorkspaceToken(hasToken);
      setAuthReady(true);
      if (!user) {
        setAccount(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    let unsubProfile: (() => void) | undefined;

    (async () => {
      try {
        const initial = await ensureUserProfile(firebaseUser);
        if (active) setAccount(initial);
        unsubProfile = subscribeUserProfile(firebaseUser.uid, (liveAccount) => {
          if (active && liveAccount) setAccount(liveAccount);
        });
      } catch (err) {
        if (active) {
          setAuthError(
            err instanceof Error ? err.message : 'Unable to initialize user profile.'
          );
        }
      }
    })();

    return () => {
      active = false;
      if (unsubProfile) unsubProfile();
    };
  }, [firebaseUser]);

  // Attach 5-tier RBAC Firestore listeners ONLY after account profile is active
  useEffect(() => {
    if (!account || account.status !== 'active') return;

    const unsubs: Array<() => void> = [];
    const isOwnerOrAdmin = account.role === 'owner' || account.role === 'admin';
    const isViewer = account.role === 'viewer';
    const isViewerOrAbove =
      isOwnerOrAdmin || account.role === 'cashier' || isViewer;

    unsubs.push(subscribeCenterStats(setCenterStats));

    // Per REP-04 confidentiality split, Viewer does not list /members, /contributions, or /payment_evidence
    if (!isViewer) {
      unsubs.push(subscribeMembers(account.role, account.uid, setMembers));
      unsubs.push(subscribeContributions(account.role, account.uid, setContributions));
      unsubs.push(subscribePaymentEvidence(account.role, account.uid, setEvidenceList));
    } else {
      setMembers([]);
      setContributions([]);
      setEvidenceList([]);
    }

    if (isViewerOrAbove) {
      unsubs.push(subscribePeriodClosures(setClosures));
      unsubs.push(subscribeAuditLogs(setAuditLogs));
      unsubs.push(subscribeGoogleSheetsSyncDiagnostic(setSheetsSyncDiag));
      unsubs.push(subscribeMeetingMinutes(setMeetingMinutes));
    } else {
      setClosures([]);
      setAuditLogs([]);
      setSheetsSyncDiag(null);
      setMeetingMinutes([]);
    }

    if (isOwnerOrAdmin) {
      unsubs.push(subscribeAllUsers(setAllUsers));
    } else {
      setAllUsers([]);
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [account?.uid, account?.role, account?.status]);

  const refreshMemberHistories = useCallback(async () => {
    if (!account || account.status !== 'active' || account.role === 'viewer') return;
    if (members.length === 0) {
      setCommitmentByMember({});
      setStatusByMember({});
      return;
    }
    const { commitmentByMember: cMap, statusByMember: sMap } =
      await fetchAllMembersHistories(members.map((m) => m.id));
    setCommitmentByMember(cMap);
    setStatusByMember(sMap);
  }, [account, members]);

  useEffect(() => {
    void refreshMemberHistories();
  }, [refreshMemberHistories]);

  const periodSummary = useMemo(
    () =>
      calculatePeriodSummary(
        selectedPeriod,
        members,
        commitmentByMember,
        statusByMember,
        contributions,
        closures
      ),
    [selectedPeriod, members, commitmentByMember, statusByMember, contributions, closures]
  );

  const selectedYear = /^\d{4}/.test(selectedPeriod)
    ? selectedPeriod.slice(0, 4)
    : String(new Date().getFullYear());

  useEffect(() => {
    if (!account || account.status !== 'active') {
      setFinancialGoal(null);
      return;
    }
    const unsub = subscribeFinancialGoal(selectedYear, setFinancialGoal);
    return () => unsub();
  }, [account?.uid, account?.status, selectedYear]);

  const annualBreakdown = useMemo(
    () =>
      calculateAnnualBreakdown(
        selectedYear,
        members,
        commitmentByMember,
        statusByMember,
        contributions
      ),
    [selectedYear, members, commitmentByMember, statusByMember, contributions]
  );

  const globalSearchMatches = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q || members.length === 0) return [];
    const scored: Array<{ member: Member; rank: number }> = [];
    for (const m of members) {
      const code = m.memberCode.toLowerCase();
      const id = m.id.toLowerCase();
      const name = m.fullName.toLowerCase();
      const phone = (m.phone || '').toLowerCase();
      if (code === q || id === q) {
        scored.push({ member: m, rank: 0 });
      } else if (code.startsWith(q) || name.startsWith(q)) {
        scored.push({ member: m, rank: 1 });
      } else if (
        name.includes(q) ||
        code.includes(q) ||
        id.includes(q) ||
        phone.includes(q)
      ) {
        scored.push({ member: m, rank: 2 });
      }
    }
    scored.sort(
      (a, b) =>
        a.rank - b.rank || a.member.memberCode.localeCompare(b.member.memberCode)
    );
    return scored.slice(0, 8).map((s) => s.member);
  }, [globalSearch, members]);

  const handleSelectGlobalMember = (member: Member) => {
    setFocusedMemberId(member.id);
    setActiveTab('members');
    setGlobalSearchOpen(false);
    setGlobalSearch('');
  };

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await googleSignIn();
      setHasWorkspaceToken(Boolean(res.accessToken));
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setMembers([]);
    setContributions([]);
    setEvidenceList([]);
    setClosures([]);
    setAllUsers([]);
    setAuditLogs([]);
    setCommitmentByMember({});
    setStatusByMember({});
    setSheetsSyncDiag(null);
    setFinancialGoal(null);
    setMeetingMinutes([]);
    setCenterStats(null);
    setGlobalSearch('');
    setGlobalSearchOpen(false);
    setFocusedMemberId(null);
    setActiveTab('dashboard');
  };

  const handleSeedSample = async () => {
    if (!account) return;
    setSeeding(true);
    try {
      await seedInitialSampleData(account);
      await refreshMemberHistories();
    } finally {
      setSeeding(false);
    }
  };

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F3F7FA] text-xs font-medium text-slate-500 dark:bg-[#0B121B] dark:text-slate-400">
        {t(language, 'loading')}
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <SignInScreen
        language={language}
        onToggleLanguage={() => setLanguage((l) => (l === 'om' ? 'en' : 'om'))}
        onSignIn={handleSignIn}
        loading={authLoading}
        error={authError}
      />
    );
  }

  if (!account) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F3F7FA] px-4 text-center dark:bg-[#0B121B]">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {authError || t(language, 'loading')}
        </div>
        {authError && (
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-lg border border-[#C8D6E5] px-3 py-1.5 text-xs font-medium text-[#17365D] dark:border-slate-700 dark:text-slate-200"
          >
            {t(language, 'signOut')}
          </button>
        )}
      </div>
    );
  }

  if (account.status === 'suspended') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F3F7FA] p-6 dark:bg-[#0B121B]">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center dark:border-red-900/50 dark:bg-[#121D2B]">
          <h2 className="font-display text-base font-bold text-red-700 dark:text-red-400">
            {t(language, 'suspendedAccountTitle')}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {t(language, 'suspendedAccountDesc')}
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-5 rounded-lg bg-[#17365D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E477A]"
          >
            {t(language, 'signOut')}
          </button>
        </div>
      </div>
    );
  }

  const isOwnerOrAdmin = account.role === 'owner' || account.role === 'admin';
  const isViewer = account.role === 'viewer';
  const isViewerOrAbove =
    isOwnerOrAdmin || account.role === 'cashier' || isViewer;

  const navItems: Array<{
    key: TabKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }> = [
    {
      key: 'dashboard',
      label: t(language, 'navDashboard'),
      icon: LayoutDashboard,
      visible: true,
    },
    {
      key: 'members',
      label: t(language, 'navMembers'),
      icon: Users,
      visible: !isViewer,
    },
    {
      key: 'contributions',
      label: t(language, 'navContributions'),
      icon: Receipt,
      visible: !isViewer,
    },
    {
      key: 'reports',
      label: t(language, 'navReports'),
      icon: FileBarChart2,
      visible: isViewerOrAbove,
    },
    {
      key: 'workspace',
      label: t(language, 'navWorkspace'),
      icon: FolderKanban,
      visible: isOwnerOrAdmin,
    },
    {
      key: 'admin',
      label: t(language, 'navAdmin'),
      icon: ShieldCheck,
      visible: isOwnerOrAdmin || isViewer,
    },
  ];

  const visibleNavItems = navItems.filter((item) => item.visible);
  const safeActiveTab: TabKey = visibleNavItems.some((i) => i.key === activeTab)
    ? activeTab
    : 'dashboard';
  const activeNavLabel =
    visibleNavItems.find((i) => i.key === safeActiveTab)?.label || '';

  return (
    <div className="flex min-h-screen bg-[#F3F7FA] text-[#202833] dark:bg-[#0B121B] dark:text-slate-100">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Deep Navy Institutional Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[#C8D6E5] bg-white transition-transform lg:static lg:translate-x-0 dark:border-slate-800 dark:bg-[#121D2B] ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#C8D6E5] bg-[#17365D] px-5 py-4 text-white dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src="/assets/aistudio/loog_6003b99d.jpg"
              alt="Al-Furqaan Center Logo"
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover shadow-sm"
            />
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-bold tracking-tight text-white">
                {t(language, 'brandTitle')}
              </div>
              <div className="truncate text-[11px] text-sky-200">
                {t(language, 'brandSubtitle')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1 text-sky-200 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = safeActiveTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setActiveTab(item.key);
                  setSidebarOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[#17365D] font-semibold text-white'
                    : 'text-[#202833] hover:bg-[#EAF1F7] dark:text-slate-300 dark:hover:bg-slate-800/70'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-[#C69C3D]' : 'text-[#167C80] dark:text-teal-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#C8D6E5] bg-[#F3F7FA] p-4 text-xs dark:border-slate-800 dark:bg-[#0E1724]">
          <div className="flex items-center gap-2.5">
            <img
              src="/assets/aistudio/loog_6003b99d.jpg"
              alt={`${account.displayName} profile`}
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-[#17365D] dark:text-white">
                {account.displayName}
              </div>
              <div className="truncate text-[11px] text-slate-600 dark:text-slate-400">
                {account.email}
              </div>
            </div>
          </div>
          <div className="mt-2 inline-block rounded bg-[#EAF1F7] px-2 py-0.5 text-[10px] font-semibold text-[#17365D] dark:bg-slate-800 dark:text-sky-300">
            {getRoleLabel(language, account.role)}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-white px-3 py-1.5 text-xs font-medium text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>{t(language, 'signOut')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar with Period & Calendar Mode Selectors */}
        <header className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[#C8D6E5] bg-white/95 px-5 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-[#121D2B]/95">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-[#C8D6E5] p-1.5 text-[#17365D] lg:hidden dark:border-slate-700 dark:text-slate-300"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              <span className="font-medium text-[#17365D] dark:text-sky-300">
                Al-Furqaan V2.0
              </span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-[#202833] dark:text-white">
                {activeNavLabel}
              </span>
            </div>
          </div>

          {(isOwnerOrAdmin || account.role === 'cashier') && (
            <div ref={globalSearchRef} className="relative w-full sm:w-64 md:w-72 lg:w-80">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={globalSearch}
                onFocus={() => setGlobalSearchOpen(true)}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                  setGlobalSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setGlobalSearchOpen(false);
                  } else if (e.key === 'Enter' && globalSearchMatches.length > 0) {
                    e.preventDefault();
                    handleSelectGlobalMember(globalSearchMatches[0]);
                  }
                }}
                placeholder={
                  language === 'om'
                    ? 'Maqaa ykn ID miseensaan barbaadi...'
                    : 'Find member by name or ID...'
                }
                aria-label={
                  language === 'om'
                    ? 'Barbaacha waliigalaa miseensotaa'
                    : 'Global member search'
                }
                className="w-full rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] py-1.5 pr-8 pl-8 text-xs text-[#202833] outline-none transition-colors focus:border-[#17365D] focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              {globalSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setGlobalSearch('');
                    setGlobalSearchOpen(false);
                  }}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-[#17365D] dark:hover:text-white"
                  aria-label="Clear global search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {globalSearchOpen && globalSearch.trim().length > 0 && (
                <div className="absolute right-0 left-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-[#C8D6E5] bg-white shadow-xl dark:border-slate-700 dark:bg-[#121D2B]">
                  {globalSearchMatches.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {language === 'om'
                        ? `Miseensi "${globalSearch.trim()}" jedhamu hin argamne.`
                        : `No members found matching "${globalSearch.trim()}".`}
                    </div>
                  ) : (
                    <div className="max-h-72 divide-y divide-[#C8D6E5]/60 overflow-y-auto dark:divide-slate-800">
                      {globalSearchMatches.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSelectGlobalMember(m)}
                          className="flex w-full items-center justify-between gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-[#EAF1F7] dark:hover:bg-slate-800/70"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <img
                              src="/assets/aistudio/loog_6003b99d.jpg"
                              alt=""
                              referrerPolicy="no-referrer"
                              className="h-7 w-7 shrink-0 rounded-full border border-[#C8D6E5] bg-white object-cover"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-[#17365D] dark:text-white">
                                {m.fullName}
                              </div>
                              <div className="font-mono-num truncate text-[11px] text-slate-500 dark:text-slate-400">
                                {m.memberCode}
                                {m.phone ? ` · ${m.phone}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono-num font-semibold text-[#167C80] dark:text-teal-400">
                              {m.monthlyCommitment.toLocaleString()} ETB
                            </div>
                            <div className="text-[10px] font-semibold uppercase text-slate-500">
                              {m.status}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* Period Selector */}
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-[#F3F7FA] px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
              <Calendar className="h-3.5 w-3.5 text-[#167C80]" />
              <input
                type="month"
                value={selectedPeriod}
                onChange={(e) => {
                  if (e.target.value) setSelectedPeriod(e.target.value);
                }}
                aria-label={t(language, 'periodLabel')}
                className="font-mono-num bg-transparent text-xs font-semibold text-[#17365D] outline-none dark:text-slate-100"
              />
            </label>

            {/* Live Ethiopian Date Indicator */}
            <span className="font-mono-num hidden xl:inline-block rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] px-2.5 py-1.5 text-xs font-semibold text-[#17365D] dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300">
              {formatEthiopianShort(new Date().toISOString().slice(0, 10))}
            </span>

            {/* Dual Calendar Mode Selector */}
            <select
              value={calendarMode}
              onChange={(e) => setCalendarMode(e.target.value as CalendarMode)}
              aria-label={t(language, 'calendarLabel')}
              className="rounded-lg border border-[#C8D6E5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#17365D] outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="ethiopian">Ethiopian (EC)</option>
              <option value="dual">Dual (GC + EC)</option>
              <option value="gregorian">Gregorian (GC)</option>
            </select>

            <button
              type="button"
              onClick={() => setLanguage((l) => (l === 'om' ? 'en' : 'om'))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D6E5] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <Globe className="h-3.5 w-3.5 text-[#167C80]" />
              <span>{language === 'om' ? 'OM' : 'EN'}</span>
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="rounded-lg border border-[#C8D6E5] bg-white p-1.5 text-[#17365D] hover:bg-[#EAF1F7] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              aria-label="Toggle theme"
            >
              {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-5 sm:p-6">
          {safeActiveTab === 'dashboard' && (
            <DashboardView
              language={language}
              calendarMode={calendarMode}
              selectedPeriod={selectedPeriod}
              account={account}
              members={members}
              commitmentByMember={commitmentByMember}
              statusByMember={statusByMember}
              periodSummary={periodSummary}
              annualBreakdown={annualBreakdown}
              contributions={contributions}
              auditLogs={auditLogs}
              centerStats={centerStats}
              closures={closures}
              financialGoal={financialGoal}
              hasMembers={members.length > 0}
              onSeedSampleData={handleSeedSample}
              seeding={seeding}
              onNavigate={(tab) => setActiveTab(tab)}
              onSelectPeriod={setSelectedPeriod}
            />
          )}
          {safeActiveTab === 'members' && (
            <MembersView
              language={language}
              calendarMode={calendarMode}
              account={account}
              members={members}
              contributions={contributions}
              commitmentByMember={commitmentByMember}
              statusByMember={statusByMember}
              onHistoriesUpdated={refreshMemberHistories}
              focusedMemberId={focusedMemberId}
              onConsumeFocusedMember={() => setFocusedMemberId(null)}
            />
          )}
          {safeActiveTab === 'contributions' && (
            <ContributionsView
              language={language}
              calendarMode={calendarMode}
              selectedPeriod={selectedPeriod}
              account={account}
              members={members}
              contributions={contributions}
              evidenceList={evidenceList}
              closures={closures}
            />
          )}
          {safeActiveTab === 'reports' && (
            <ReportsView
              language={language}
              calendarMode={calendarMode}
              selectedPeriod={selectedPeriod}
              account={account}
              members={members}
              contributions={contributions}
              commitmentByMember={commitmentByMember}
              statusByMember={statusByMember}
              periodSummary={periodSummary}
              annualBreakdown={annualBreakdown}
              closures={closures}
              meetingMinutes={meetingMinutes}
              onSelectPeriod={setSelectedPeriod}
            />
          )}
          {safeActiveTab === 'workspace' && (
            <WorkspaceView
              language={language}
              selectedPeriod={selectedPeriod}
              account={account}
              members={members}
              contributions={contributions}
              closures={closures}
              periodSummary={periodSummary}
              hasWorkspaceToken={hasWorkspaceToken}
              onTokenRefreshed={() => setHasWorkspaceToken(true)}
            />
          )}
          {safeActiveTab === 'admin' && (
            <AdminAccessView
              language={language}
              calendarMode={calendarMode}
              selectedPeriod={selectedPeriod}
              account={account}
              users={allUsers}
              members={members}
              contributions={contributions}
              commitmentByMember={commitmentByMember}
              statusByMember={statusByMember}
              periodSummary={periodSummary}
              auditLogs={auditLogs}
              sheetsSyncDiag={sheetsSyncDiag}
              hasWorkspaceToken={hasWorkspaceToken}
              onTokenRefreshed={() => setHasWorkspaceToken(true)}
            />
          )}
        </main>

        <footer className="no-print border-t border-[#C8D6E5] bg-white px-6 py-3.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-[#121D2B] dark:text-slate-400">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-[#17365D] dark:text-slate-200">
                {t(language, 'centerFull')}
              </span>{' '}
              · {t(language, 'centerLocation')} ·{' '}
              <span className="font-mono-num">{INSTITUTION_CONTACTS.phones}</span>
            </div>
            <div dir="rtl" className="font-medium text-[#167C80] dark:text-teal-400">
              {t(language, 'mottoArabic')}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
