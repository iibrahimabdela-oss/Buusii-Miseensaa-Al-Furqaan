import React from 'react';
import { Globe, Mail, Phone, ShieldCheck } from 'lucide-react';
import { INSTITUTION_CONTACTS, t } from '../i18n.ts';
import type { Language } from '../types.ts';

interface SignInScreenProps {
  language: Language;
  onToggleLanguage: () => void;
  onSignIn: () => void;
  loading: boolean;
  error: string | null;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({
  language,
  onToggleLanguage,
  onSignIn,
  loading,
  error,
}) => {
  return (
    <div className="flex min-h-screen flex-col justify-between bg-[#F3F7FA] text-[#202833] dark:bg-[#0D1520] dark:text-slate-100">
      <header className="border-b-4 border-[#C69C3D] bg-[#17365D] px-6 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img
              src="/assets/aistudio/loog_6003b99d.jpg"
              alt="Al-Furqaan Center Logo"
              referrerPolicy="no-referrer"
              className="h-10 w-10 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover shadow-sm"
            />
            <div>
              <div className="font-display text-sm font-bold tracking-tight whitespace-nowrap">
                {t(language, 'brandTitle')}
              </div>
              <div className="text-xs text-slate-200 whitespace-nowrap">
                {t(language, 'brandSubtitle')}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleLanguage}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 whitespace-nowrap"
          >
            <Globe className="h-3.5 w-3.5 text-[#C69C3D]" />
            <span>{language === 'om' ? 'Afaan Oromoo (OM)' : 'English (EN)'}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center px-6 py-10">
        <div className="grid w-full gap-10 lg:grid-cols-12 lg:items-center">
          <div className="space-y-5 lg:col-span-7">
            <div className="text-xs font-semibold tracking-wider text-[#167C80] uppercase dark:text-teal-400">
              {t(language, 'centerLocation')}
            </div>
            <h1 className="font-display text-3xl leading-tight font-bold tracking-tight text-[#17365D] sm:text-4xl dark:text-white">
              {t(language, 'centerFull')}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {t(language, 'signInSubtitle')}
            </p>

            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <div className="rounded-xl border border-[#C8D6E5] bg-white p-4 dark:border-slate-800 dark:bg-[#121D2B]">
                <div className="text-xs font-semibold text-[#17365D] dark:text-sky-300">
                  {language === 'om'
                    ? 'Waadaa Ji’aa & Kaffaltii Mirkanaa’e'
                    : 'Effective Commitments & Confirmed Buusii'}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {language === 'om'
                    ? 'Seenaa waadaa (CommitmentHistory), kaffaltii ETB qofa, ragaa nagahee, fi cufiinsa ji’aa.'
                    : 'Effective-dated commitment history, ETB contribution ledger, evidence attachments, and period closing.'}
                </p>
              </div>
              <div className="rounded-xl border border-[#C8D6E5] bg-white p-4 dark:border-slate-800 dark:bg-[#121D2B]">
                <div className="text-xs font-semibold text-[#167C80] dark:text-teal-400">
                  {language === 'om'
                    ? 'Matriiksii Gahee Sadarkaa 5'
                    : '5-Tier Role-Based Access Control'}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {language === 'om'
                    ? 'Owner, Admin, Cashier, Viewer/Auditor fi Member — iccitii daataa miseensotaa kan eegu.'
                    : 'Owner, Admin, Cashier, Viewer/Auditor, and Member roles enforced by Firestore security rules.'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#C8D6E5] bg-[#EAF1F7] p-4 text-xs text-[#202833] dark:border-slate-800 dark:bg-[#121D2B] dark:text-slate-300">
              <div className="font-semibold text-[#17365D] dark:text-sky-300">
                {language === 'om' ? 'Qunnamtii Dhaabbataa' : 'Official Institutional Contact'}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5">
                <span className="inline-flex items-center gap-1.5 font-mono-num">
                  <Phone className="h-3.5 w-3.5 text-[#167C80]" />
                  {INSTITUTION_CONTACTS.phones}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-[#167C80]" />
                  {INSTITUTION_CONTACTS.emails[0]}
                </span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-xl border border-[#C8D6E5] bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#121D2B]">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                <img
                  src="/assets/aistudio/loog_6003b99d.jpg"
                  alt="Al-Furqaan Center Logo"
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover shadow-sm"
                />
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#167C80]" />
                    <span>Firebase Auth & Google Workspace</span>
                  </div>
                  <h2 className="mt-0.5 font-display text-lg font-bold text-[#17365D] dark:text-white">
                    {language === 'om' ? 'Sirnaatti Seeni' : 'Sign in to Continue'}
                  </h2>
                </div>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {language === 'om'
                  ? 'Eenyummaa kee mirkaneessuu fi Google Sheets, Drive, Gmail walqabsiisuuf.'
                  : 'Authenticate with your verified Google account for center records and Workspace tools.'}
              </p>

              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={loading}
                  className="gsi-material-button"
                >
                  <div className="gsi-material-button-state" />
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        style={{ display: 'block' }}
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                        <path fill="none" d="M0 0h48v48H0z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">
                      {loading ? 'Connecting...' : t(language, 'signInWithGoogle')}
                    </span>
                  </div>
                </button>
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </div>
              )}

              <div className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <div dir="rtl" className="font-medium text-[#17365D] dark:text-[#C69C3D]">
                  {t(language, 'mottoArabic')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
