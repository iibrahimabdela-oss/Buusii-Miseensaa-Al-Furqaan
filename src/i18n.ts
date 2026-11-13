import type {
  ContributionStatus,
  Language,
  MemberStatus,
  UserRole,
} from './types.ts';

export const INSTITUTION_CONTACTS = {
  phones: '+251991272425 / +251998889045',
  emails: [
    'markazalfurqan19@gmail.com',
    'wirtuuhifziiquraanaaalfurqaan@gmail.com',
    'furqanhifzcenter@gmail.com',
  ],
} as const;

export const TRANSLATIONS = {
  om: {
    brandTitle: 'Sirna Buusii Al-Furqaan',
    brandSubtitle: 'Giddu-gala Hifzii Qur’aanaa · Ciroo',
    centerFull: 'Giddu-gala Hifzii Qur’aanaa Al-Furqaan',
    centerLocation: 'Ciroo – Harargee Lixaa – Oromiyaa – Itoophiyaa',
    mottoArabic: 'بارك الله في جهودكم لخدمة القرآن وأهله',
    navDashboard: 'Daashboordii',
    navMembers: 'Miseensota',
    navContributions: 'Kaffaltii Buusii',
    navReports: 'Gabaasa & Cufiinsa',
    navWorkspace: 'Workspace & Yaadachiisa',
    navAdmin: 'Bulchiinsa Gahee',
    signOut: 'Ba’i',
    signInWithGoogle: 'Google dhaan Seeni',
    signInSubtitle:
      'Galmee miseensotaa, waadaa ji’aa, kaffaltii mirkanaa’e, cufiinsa ji’aa fi gabaasa argachuuf account Google keetiin seeni.',
    roleOwner: 'Abbaa Sirnaa (Owner)',
    roleAdmin: 'Bulchaa (Admin)',
    roleCashier: 'Kafaltii Fudhataa (Cashier)',
    roleViewer: 'Ilaalaa / Odiitara (Viewer)',
    roleMember: 'Miseensa (Member)',
    activeMembers: 'Miseensota Hojii Irra',
    expectedContribution: 'Waadaa Eegamu',
    collectedTotal: 'Kaffaltii Mirkanaa’e',
    outstandingTotal: 'Haftee',
    collectionRate: 'Hirmaannaa %',
    overpaymentTotal: 'Ol-kaffaltii',
    overdueAlert: 'Haftee Ji’a Cufamee',
    seedSampleData: 'Daataa Fakkeenyaa Galchi',
    addMember: 'Miseensa Dabali',
    recordContribution: 'Buusii Galmeessi',
    searchPlaceholder: 'Maqaa, koodii, bilbila ykn nagaheedhaan barbaadi...',
    printReceipt: 'Nagahee Maxxansi',
    printReport: 'Gabaasa A4 Maxxansi',
    close: 'Cufi',
    cancel: 'Dhiisi',
    confirm: 'Mirkaneessi',
    save: 'Olkaa’i',
    edit: 'Fooyyessi',
    loading: 'Galmeen fe’amaa jira...',
    restrictedMemberBanner:
      'Gaheen kee Miseensa (Member) dha. Cuunfaa waliigalaa Giddu-galaa fi galmee miseensummaa ykn ragaa kaffaltii siif qindaa’e qofa argita.',
    viewerPrivacyBanner:
      'Gahee Ilaalaa / Odiitaraa (Viewer): Gabaasa waliigalaa, cufiinsa ji’aa fi audit log qofa ilaaluu dandeessa; daataan haftee dhuunfaa iccitiidhaan dhorkameera.',
    suspendedAccountTitle: 'Account Dhorkameera',
    suspendedAccountDesc:
      'Account kee yeroof dhorkameera. Hayyama deebisuuf Abbaa Sirnaa (markazalfurqan36@gmail.com) quunnami.',
    periodLabel: 'Ji’a Gabaasaa',
    calendarLabel: 'Kaldaarii',
    statusActive: 'Hojii irra',
    statusPaused: 'Yeroo dhaabbate',
    statusEnded: 'Xumurame',
    payPending: 'Eegaa',
    payConfirmed: 'Mirkanaa’e',
    payCancelled: 'Fashale',
    payRejected: 'Diddeebifame',
    reminderTemplateTitle: 'Yaadachiisa Kaffaltii Buusii Ji’aa',
  },
  en: {
    brandTitle: 'Al-Furqaan Membership',
    brandSubtitle: 'Monthly Buusii System · Chiro',
    centerFull: 'Al-Furqaan Qur’an Memorization Center',
    centerLocation: 'Chiro – West Hararghe – Oromia – Ethiopia',
    mottoArabic: 'بارك الله في جهودكم لخدمة القرآن وأهله',
    navDashboard: 'Dashboard',
    navMembers: 'Members',
    navContributions: 'Contributions',
    navReports: 'Reports & Closing',
    navWorkspace: 'Workspace & Reminders',
    navAdmin: 'Access Control',
    signOut: 'Sign out',
    signInWithGoogle: 'Sign in with Google',
    signInSubtitle:
      'Sign in with your authorized Google account to manage monthly member commitments, confirmed buusii, closing reports, and reminders.',
    roleOwner: 'Super Admin / Owner',
    roleAdmin: 'Admin',
    roleCashier: 'Cashier',
    roleViewer: 'Viewer / Auditor',
    roleMember: 'Member',
    activeMembers: 'Active Members',
    expectedContribution: 'Expected Commitment',
    collectedTotal: 'Confirmed Collected',
    outstandingTotal: 'Outstanding',
    collectionRate: 'Collection Rate %',
    overpaymentTotal: 'Overpayment',
    overdueAlert: 'Overdue (Closed Periods)',
    seedSampleData: 'Load Sample Data',
    addMember: 'Add Member',
    recordContribution: 'Record Payment',
    searchPlaceholder: 'Search by name, code, phone, or receipt...',
    printReceipt: 'Print Receipt',
    printReport: 'Print A4 Report',
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    edit: 'Edit',
    loading: 'Loading records...',
    restrictedMemberBanner:
      'Your account has Member access. You can view center aggregate metrics and your own linked membership or payment evidence.',
    viewerPrivacyBanner:
      'Viewer / Auditor access: You can inspect aggregate reports, period closures, and audit logs without individual members’ confidential debt lines.',
    suspendedAccountTitle: 'Account Suspended',
    suspendedAccountDesc:
      'Your account status is currently suspended. Contact the Center Owner (markazalfurqan36@gmail.com) to restore access.',
    periodLabel: 'Reporting Period',
    calendarLabel: 'Calendar',
    statusActive: 'Active',
    statusPaused: 'Paused',
    statusEnded: 'Ended',
    payPending: 'Pending',
    payConfirmed: 'Confirmed',
    payCancelled: 'Cancelled',
    payRejected: 'Rejected',
    reminderTemplateTitle: 'Monthly Buusii Payment Reminder',
  },
} as const;

export function t(lang: Language, key: keyof typeof TRANSLATIONS.om): string {
  return TRANSLATIONS[lang][key] || TRANSLATIONS.om[key];
}

export function getRoleLabel(lang: Language, role: UserRole | 'user'): string {
  const normalized: UserRole = role === 'user' ? 'member' : role;
  switch (normalized) {
    case 'owner':
      return t(lang, 'roleOwner');
    case 'admin':
      return t(lang, 'roleAdmin');
    case 'cashier':
      return t(lang, 'roleCashier');
    case 'viewer':
      return t(lang, 'roleViewer');
    default:
      return t(lang, 'roleMember');
  }
}

export function getMemberStatusLabel(lang: Language, status: MemberStatus | 'not_joined'): string {
  if (status === 'active') return t(lang, 'statusActive');
  if (status === 'paused') return t(lang, 'statusPaused');
  if (status === 'ended') return t(lang, 'statusEnded');
  return lang === 'om' ? 'Hin seenne' : 'Not Joined';
}

export function getContributionStatusLabel(lang: Language, status: ContributionStatus): string {
  switch (status) {
    case 'pending':
      return t(lang, 'payPending');
    case 'confirmed':
      return t(lang, 'payConfirmed');
    case 'cancelled':
      return t(lang, 'payCancelled');
    case 'rejected':
      return t(lang, 'payRejected');
  }
}
