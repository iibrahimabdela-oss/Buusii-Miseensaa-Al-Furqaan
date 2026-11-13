import React from 'react';
import { Printer, X } from 'lucide-react';
import {
  getContributionStatusLabel,
  INSTITUTION_CONTACTS,
  t,
} from '../i18n.ts';
import type { CalendarMode, Contribution, Language } from '../types.ts';
import { formatDateByCalendar, formatPeriodLabel } from '../utils/ethiopianCalendar.ts';

interface ReceiptModalProps {
  contribution: Contribution | null;
  language: Language;
  calendarMode: CalendarMode;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  contribution,
  language,
  calendarMode,
  onClose,
}) => {
  if (!contribution) return null;

  const isVoidedState =
    contribution.status === 'cancelled' || contribution.status === 'rejected';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#17365D]/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-[#C8D6E5] bg-white shadow-2xl dark:border-slate-700 dark:bg-[#121D2B]">
        <div className="no-print flex items-center justify-between border-b border-[#C8D6E5] px-5 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <img
              src="/assets/aistudio/loog_6003b99d.jpg"
              alt="Al-Furqaan Logo"
              referrerPolicy="no-referrer"
              className="h-7 w-7 shrink-0 rounded-full border border-[#C69C3D] bg-white object-cover"
            />
            <span className="font-display text-sm font-semibold text-[#17365D] dark:text-slate-100">
              {language === 'om' ? 'Nagahee Kaffaltii Buusii (Official Receipt)' : 'Official Contribution Receipt'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#17365D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E477A]"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>{t(language, 'printReceipt')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-[#F3F7FA] hover:text-[#17365D] dark:hover:bg-slate-800"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div id="printable-receipt" className="p-6 sm:p-8">
          <div className="border-b-2 border-[#17365D] pb-4 text-center">
            <img
              src="/assets/aistudio/loog_6003b99d.jpg"
              alt="Al-Furqaan Qur'an Memorization Center Logo"
              referrerPolicy="no-referrer"
              className="mx-auto mb-2 h-14 w-14 rounded-full border-2 border-[#C69C3D] bg-white object-cover shadow-sm"
            />
            <div dir="rtl" className="text-sm font-semibold text-[#167C80] dark:text-teal-400">
              {t(language, 'mottoArabic')}
            </div>
            <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-[#17365D] dark:text-white">
              AL-FURQAAN QUR’AN MEMORIZATION CENTER
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t(language, 'centerLocation')}
            </p>
            <div className="mt-2 text-xs font-semibold tracking-wider text-[#C69C3D] uppercase">
              Sirna Buusii Miseensaa · Official Payment Receipt
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Lakkoofsa Nagahee' : 'Receipt No.'}
              </div>
              <div className="font-mono-num mt-0.5 text-sm font-semibold text-[#17365D] dark:text-white">
                {contribution.receiptNumber}
              </div>
            </div>
            <div className="text-right">
              <div className="text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Guyyaa Fudhatame' : 'Received Date'}
              </div>
              <div className="font-mono-num mt-0.5 text-xs font-semibold text-[#202833] dark:text-white">
                {formatDateByCalendar(contribution.paymentDate, calendarMode)}
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-[#C8D6E5] bg-[#EAF1F7] p-4 dark:border-slate-700 dark:bg-slate-900/60">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {language === 'om' ? 'Hanga Kaffaltii (ETB)' : 'Amount (ETB)'}
              </span>
              <span
                className={`font-mono-num text-2xl font-bold ${
                  isVoidedState
                    ? 'line-through text-red-600'
                    : 'text-[#17365D] dark:text-sky-300'
                }`}
              >
                {contribution.amount.toLocaleString()} ETB
              </span>
            </div>
          </div>

          <dl className="mt-5 divide-y divide-slate-100 text-xs dark:divide-slate-800">
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Maqaa Miseensaa' : 'Member Name'}
              </dt>
              <dd className="font-semibold text-[#202833] dark:text-slate-100">
                {contribution.memberName}
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Koodii Miseensaa' : 'Member Code'}
              </dt>
              <dd className="font-mono-num font-medium text-[#202833] dark:text-slate-100">
                {contribution.memberCode}
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Ji’a Kaffaltii' : 'Contribution Month'}
              </dt>
              <dd className="font-mono-num font-medium text-[#202833] dark:text-slate-100">
                {formatPeriodLabel(contribution.month, calendarMode, language)}
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Mala Kaffaltii' : 'Payment Method'}
              </dt>
              <dd className="font-medium uppercase text-[#202833] dark:text-slate-100">
                {contribution.paymentMethod.replace('_', ' ')}
              </dd>
            </div>
            {contribution.referenceCode && (
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">
                  {language === 'om' ? 'Wabii / Reference' : 'Reference Code'}
                </dt>
                <dd className="font-mono-num font-medium text-[#202833] dark:text-slate-100">
                  {contribution.referenceCode}
                </dd>
              </div>
            )}
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Haala Kaffaltii' : 'Status'}
              </dt>
              <dd
                className={`font-semibold uppercase ${
                  contribution.status === 'confirmed'
                    ? 'text-[#167C80] dark:text-teal-400'
                    : contribution.status === 'cancelled' || contribution.status === 'rejected'
                    ? 'text-red-600'
                    : 'text-amber-600'
                }`}
              >
                {getContributionStatusLabel(language, contribution.status)}
              </dd>
            </div>
            {contribution.statusReason && (
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">
                  {language === 'om' ? 'Sababa Haalaa' : 'Status Reason'}
                </dt>
                <dd className="text-right font-medium text-slate-700 dark:text-slate-200">
                  {contribution.statusReason}
                </dd>
              </div>
            )}
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 dark:text-slate-400">
                {language === 'om' ? 'Kan Galmeesse' : 'Recorded By'}
              </dt>
              <dd className="font-medium text-[#202833] dark:text-slate-100">
                {contribution.recordedByName}
              </dd>
            </div>
            {contribution.statusChangedBy && (
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">
                  {language === 'om' ? 'Kan Mirkaneesse / Sirreesse' : 'Verified / Updated By'}
                </dt>
                <dd className="font-medium text-[#202833] dark:text-slate-100">
                  {contribution.statusChangedBy}
                </dd>
              </div>
            )}
          </dl>

          {contribution.notes && (
            <div className="mt-4 rounded-lg border border-[#C8D6E5] p-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <span className="font-semibold">Hubachiisa:</span> {contribution.notes}
            </div>
          )}

          <div className="mt-6 border-t border-dashed border-[#C8D6E5] pt-4 text-center text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <div>Jazakumullahu Khayran · {INSTITUTION_CONTACTS.phones}</div>
            <div className="mt-0.5">{INSTITUTION_CONTACTS.emails[0]}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
