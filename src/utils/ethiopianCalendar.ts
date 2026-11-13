import type { CalendarMode, Language } from '../types.ts';

export const ETHIOPIAN_MONTHS_OM = [
  'Fulbaana',
  'Onkololeessa',
  'Sadaasa',
  'Muddee',
  'Amajjii',
  'Guraandhala',
  'Bitootessa',
  'Ebla',
  'Caamsaa',
  'Waxabajjii',
  'Adoolessa',
  'Hagayya',
  'Qaammee',
] as const;

export const GREGORIAN_MONTHS_OM = [
  'Amajjii (Jan)',
  'Guraandhala (Feb)',
  'Bitootessa (Mar)',
  'Ebla (Apr)',
  'Caamsaa (May)',
  'Waxabajjii (Jun)',
  'Adoolessa (Jul)',
  'Hagayya (Aug)',
  'Fulbaana (Sep)',
  'Onkololeessa (Oct)',
  'Sadaasa (Nov)',
  'Muddee (Dec)',
] as const;

export const GREGORIAN_MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface EthiopianDateParts {
  year: number;
  month: number; // 1..13
  day: number; // 1..30 (or 1..6)
  monthName: string;
}

const JD_EPOCH_OFFSET_ETHIOPIAN = 1723856;

function gregorianToJdn(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/**
 * Converts a Gregorian YYYY-MM-DD date string to Ethiopian Calendar parts.
 */
export function toEthiopianDate(isoDate: string): EthiopianDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!match) return null;
  const gYear = Number(match[1]);
  const gMonth = Number(match[2]);
  const gDay = Number(match[3]);
  if (!gYear || gMonth < 1 || gMonth > 12 || gDay < 1 || gDay > 31) return null;

  const jdn = gregorianToJdn(gYear, gMonth, gDay);
  const r = (jdn - JD_EPOCH_OFFSET_ETHIOPIAN) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const ecYear =
    4 * Math.floor((jdn - JD_EPOCH_OFFSET_ETHIOPIAN) / 1461) +
    Math.floor(r / 365) -
    Math.floor(r / 1460);
  const ecMonth = Math.floor(n / 30) + 1;
  const ecDay = (n % 30) + 1;
  const monthName = ETHIOPIAN_MONTHS_OM[Math.min(12, Math.max(0, ecMonth - 1))];

  return {
    year: ecYear,
    month: ecMonth,
    day: ecDay,
    monthName,
  };
}

export function formatEthiopianShort(isoDate: string): string {
  const ec = toEthiopianDate(isoDate);
  if (!ec) return isoDate;
  return `${ec.monthName} ${ec.day}, ${ec.year} EC`;
}

export function formatPeriodLabel(
  periodKey: string,
  mode: CalendarMode,
  lang: Language
): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey.trim());
  if (!match) return periodKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return periodKey;

  const gcLabel =
    lang === 'om'
      ? `${GREGORIAN_MONTHS_OM[month - 1]} ${year}`
      : `${GREGORIAN_MONTHS_EN[month - 1]} ${year}`;

  // Use mid-month (15th) for representative Ethiopian Calendar month
  const ecMid = toEthiopianDate(`${match[1]}-${match[2]}-15`);
  const ecEnd = toEthiopianDate(`${match[1]}-${match[2]}-28`);
  let ecLabel = '';
  if (ecMid && ecEnd) {
    if (ecMid.month === ecEnd.month) {
      ecLabel = `${ecMid.monthName} ${ecMid.year} EC`;
    } else {
      ecLabel = `${ecMid.monthName} / ${ecEnd.monthName} ${ecEnd.year} EC`;
    }
  }

  if (mode === 'gregorian') return `${gcLabel} (${periodKey})`;
  if (mode === 'ethiopian') return ecLabel || gcLabel;
  return ecLabel ? `${periodKey} · ${ecLabel}` : gcLabel;
}

export function formatDateByCalendar(
  isoDate: string,
  mode: CalendarMode
): string {
  if (!isoDate) return '—';
  const ec = formatEthiopianShort(isoDate);
  if (mode === 'gregorian') return isoDate;
  if (mode === 'ethiopian') return ec;
  return `${isoDate} (${ec})`;
}

export function currentPeriodKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function isEthiopianLeapYear(ecYear: number): boolean {
  return (ecYear + 1) % 4 === 0;
}

export function getEthiopianMonthDays(ecYear: number, ecMonth: number): number {
  if (ecMonth === 13) {
    return isEthiopianLeapYear(ecYear) ? 6 : 5;
  }
  return 30;
}

function jdnToGregorian(jdn: number): string {
  const l = jdn + 68569;
  const n = Math.floor((4 * l) / 146097);
  const l2 = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l2 + 1)) / 1461001);
  const l3 = l2 - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l3) / 2447);
  const day = l3 - Math.floor((2447 * j) / 80);
  const l4 = Math.floor(j / 11);
  const month = j + 2 - 12 * l4;
  const year = 100 * (n - 49) + i + l4;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converts an Ethiopian Calendar date (year, month 1..13, day 1..30) to Gregorian YYYY-MM-DD.
 */
export function ethiopianToGregorian(
  ecYear: number,
  ecMonth: number,
  ecDay: number
): string {
  const safeMonth = Math.min(13, Math.max(1, ecMonth));
  const maxDay = getEthiopianMonthDays(ecYear, safeMonth);
  const safeDay = Math.min(maxDay, Math.max(1, ecDay));
  const jdn =
    JD_EPOCH_OFFSET_ETHIOPIAN +
    365 * ecYear +
    Math.floor(ecYear / 4) +
    30 * (safeMonth - 1) +
    (safeDay - 1);
  return jdnToGregorian(jdn);
}

export interface EthiopianCalendarCell {
  ecDay: number;
  gregorianIso: string;
  weekday: number; // 0 = Sun .. 6 = Sat
  isToday: boolean;
}

export function buildEthiopianMonthGrid(
  ecYear: number,
  ecMonth: number
): EthiopianCalendarCell[] {
  const daysInMonth = getEthiopianMonthDays(ecYear, ecMonth);
  const todayIso = new Date().toISOString().slice(0, 10);
  const cells: EthiopianCalendarCell[] = [];

  for (let d = 1; d <= daysInMonth; d += 1) {
    const gregorianIso = ethiopianToGregorian(ecYear, ecMonth, d);
    const [y, m, day] = gregorianIso.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    cells.push({
      ecDay: d,
      gregorianIso,
      weekday,
      isToday: gregorianIso === todayIso,
    });
  }
  return cells;
}
