import { jsPDF } from 'jspdf';
import type {
  AuditLog,
  CalendarMode,
  Contribution,
  Language,
  Member,
  MemberStandingSummary,
  PeriodClosure,
  PeriodSummaryMetrics,
} from '../types.ts';
import type { AnnualMonthRow } from './financials.ts';
import { formatDateByCalendar, formatPeriodLabel } from './ethiopianCalendar.ts';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CENTER_LOGO_PATH = '/assets/aistudio/loog_6003b99d.jpg';
let cachedLogoDataUrl: string | null | undefined;

async function loadCenterLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl !== undefined) {
    return cachedLogoDataUrl;
  }
  try {
    const response = await fetch(CENTER_LOGO_PATH);
    if (!response.ok) {
      cachedLogoDataUrl = null;
      return null;
    }
    const blob = await response.blob();
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    cachedLogoDataUrl = dataUrl;
    return dataUrl;
  } catch {
    cachedLogoDataUrl = null;
    return null;
  }
}

function buildStyledReportHtml(
  title: string,
  periodLabel: string,
  summary: PeriodSummaryMetrics,
  closure: PeriodClosure | undefined,
  includeMemberRows: boolean,
  annualRows: AnnualMonthRow[],
  language: Language,
  logoDataUrl: string | null
): string {
  const rateText =
    summary.collectionRatePercent !== null
      ? `${summary.collectionRatePercent.toFixed(1)}%`
      : 'N/A';

  const memberTable = includeMemberRows
    ? `
      <h2>${language === 'om' ? 'Tarree Miseensotaa fi Shallaggii Ji’aa' : 'Member Monthly Ledger Breakdown'}</h2>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>${language === 'om' ? 'Maqaa Guutuu' : 'Member Name'}</th>
            <th>${language === 'om' ? 'Haala' : 'Status'}</th>
            <th class="num">${language === 'om' ? 'Waadaa (ETB)' : 'Expected'}</th>
            <th class="num">${language === 'om' ? 'Kaffaltii Mirkanaa’e' : 'Collected'}</th>
            <th class="num">${language === 'om' ? 'Haftee' : 'Outstanding'}</th>
            <th class="num">${language === 'om' ? 'Ol-kaffaltii' : 'Overpayment'}</th>
            <th class="num">%</th>
          </tr>
        </thead>
        <tbody>
          ${summary.rows
            .map(
              (r, idx) => `
            <tr class="${idx % 2 === 1 ? 'alt' : ''}">
              <td class="mono">${escapeHtml(r.member.memberCode)}</td>
              <td>${escapeHtml(r.member.fullName)}</td>
              <td>${escapeHtml(r.statusInPeriod)}</td>
              <td class="num mono">${r.expectedEtb.toLocaleString()}</td>
              <td class="num mono">${r.collectedEtb.toLocaleString()}</td>
              <td class="num mono">${r.outstandingEtb.toLocaleString()}</td>
              <td class="num mono">${r.overpaymentEtb.toLocaleString()}</td>
              <td class="num mono">${r.ratePercent !== null ? `${r.ratePercent.toFixed(1)}%` : 'N/A'}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `
    : `<p class="notice">${
        language === 'om'
          ? 'Hubachiisa Iccitii (REP-04): Gabaasni kun cuunfaa waliigalaa qofa agarsiisa; maqaa fi hafteen miseensota dhuunfaa hin dabalamne.'
          : 'Privacy Notice (REP-04): Aggregate summary only. Individual member debt lines are omitted for this role.'
      }</p>`;

  const annualTable =
    annualRows.length > 0
      ? `
      <h2>${language === 'om' ? 'Cuunfaa Waggaa Ji’a 12' : 'Annual 12-Month Breakdown'}</h2>
      <table>
        <thead>
          <tr>
            <th>${language === 'om' ? 'Ji’a' : 'Period'}</th>
            <th class="num">${language === 'om' ? 'Hojii Irra' : 'Active'}</th>
            <th class="num">${language === 'om' ? 'Waadaa Eegamu' : 'Expected (ETB)'}</th>
            <th class="num">${language === 'om' ? 'Mirkanaa’e' : 'Collected (ETB)'}</th>
            <th class="num">${language === 'om' ? 'Haftee' : 'Outstanding'}</th>
            <th class="num">${language === 'om' ? 'Ol-kaffaltii' : 'Overpayment'}</th>
            <th class="num">%</th>
          </tr>
        </thead>
        <tbody>
          ${annualRows
            .map(
              (ar, idx) => `
            <tr class="${idx % 2 === 1 ? 'alt' : ''}">
              <td class="mono">${escapeHtml(ar.periodKey)}</td>
              <td class="num mono">${ar.activeMembers}</td>
              <td class="num mono">${ar.expectedEtb.toLocaleString()}</td>
              <td class="num mono">${ar.collectedEtb.toLocaleString()}</td>
              <td class="num mono">${ar.outstandingEtb.toLocaleString()}</td>
              <td class="num mono">${ar.overpaymentEtb.toLocaleString()}</td>
              <td class="num mono">${ar.ratePercent !== null ? `${ar.ratePercent.toFixed(1)}%` : 'N/A'}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `
      : '';

  const signOffBlock = `
    <h2>${language === 'om' ? 'Mirkaneessa fi Raggaasisa Ji’aa' : 'Reconciliation & Approval Sign-Off'}</h2>
    <table>
      <thead>
        <tr>
          <th>${language === 'om' ? 'Gahee' : 'Role'}</th>
          <th>${language === 'om' ? 'Maqaa' : 'Name'}</th>
          <th>${language === 'om' ? 'Haala Cufiinsaa' : 'Period Status'}</th>
          <th>${language === 'om' ? 'Cash / Bank Reconciled' : 'Reconciled (ETB)'}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Qopheesse (Prepared)</td>
          <td>${escapeHtml(closure?.preparedBy || '________________')}</td>
          <td>${escapeHtml(closure?.status || 'open')}</td>
          <td class="mono">Cash: ${(closure?.cashReconciledEtb ?? 0).toLocaleString()} ETB</td>
        </tr>
        <tr class="alt">
          <td>Ilaale (Reviewed)</td>
          <td>${escapeHtml(closure?.reviewedBy || '________________')}</td>
          <td>${escapeHtml(summary.periodKey)}</td>
          <td class="mono">Bank/Mobile: ${(closure?.bankReconciledEtb ?? 0).toLocaleString()} ETB</td>
        </tr>
        <tr>
          <td>Raggaase (Approved)</td>
          <td>${escapeHtml(closure?.approvedBy || '________________')}</td>
          <td>${new Date().toISOString().slice(0, 10)}</td>
          <td class="mono">Total Collected: ${summary.collectedEtb.toLocaleString()} ETB</td>
        </tr>
      </tbody>
    </table>
  `;

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; color: #202833; margin: 28px; background: #ffffff; }
  .banner { background: #17365D; color: #ffffff; padding: 16px 22px; border-bottom: 4px solid #C69C3D; }
  .banner-row { display: table; width: 100%; }
  .banner-logo-cell { display: table-cell; width: 62px; vertical-align: middle; }
  .banner-logo { width: 50px; height: 50px; border-radius: 50%; border: 2px solid #C69C3D; background: #ffffff; object-fit: cover; display: block; }
  .banner-text-cell { display: table-cell; vertical-align: middle; }
  .banner h1 { margin: 0; font-size: 19px; letter-spacing: 0.3px; }
  .banner p { margin: 4px 0 0; font-size: 12px; color: #D8E4F2; }
  h2 { color: #167C80; font-size: 14px; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid #C8D6E5; padding-bottom: 4px; }
  .kpis { display: table; width: 100%; border-collapse: separate; border-spacing: 8px; margin: 14px -8px; }
  .kpi { display: table-cell; background: #EAF1F7; border: 1px solid #C8D6E5; padding: 10px 12px; width: 20%; }
  .kpi .lbl { font-size: 11px; color: #526173; }
  .kpi .val { font-size: 15px; font-weight: 700; color: #17365D; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 8px; }
  th { background: #17365D; color: #ffffff; text-align: left; padding: 7px 8px; border: 1px solid #17365D; }
  td { padding: 6px 8px; border: 1px solid #C8D6E5; }
  tr.alt td { background: #F3F7FA; }
  .num { text-align: right; }
  .mono { font-family: Consolas, monospace; }
  .notice { background: #F3F7FA; border: 1px solid #C8D6E5; padding: 10px 12px; font-size: 12px; color: #17365D; }
  .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #C8D6E5; font-size: 11px; color: #526173; }
</style>
</head>
<body>
  <div class="banner">
    <div class="banner-row">
      ${
        logoDataUrl
          ? `<div class="banner-logo-cell"><img class="banner-logo" width="50" height="50" src="${logoDataUrl}" alt="Al-Furqaan Logo" /></div>`
          : ''
      }
      <div class="banner-text-cell">
        <h1>AL-FURQAAN QUR'AN MEMORIZATION CENTER · ${escapeHtml(title)}</h1>
        <p>Chiro, West Hararghe, Oromia · ${escapeHtml(periodLabel)} · Tel: +251991272425 / +251998889045 · markazalfurqan19@gmail.com</p>
      </div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="lbl">${language === 'om' ? 'Miseensota Hojii Irra' : 'Active Members'}</div><div class="val">${summary.activeMembersCount}</div></div>
    <div class="kpi"><div class="lbl">${language === 'om' ? 'Waadaa Eegamu' : 'Expected'}</div><div class="val">${summary.expectedEtb.toLocaleString()} ETB</div></div>
    <div class="kpi"><div class="lbl">${language === 'om' ? 'Kaffaltii Mirkanaa’e' : 'Collected'}</div><div class="val">${summary.collectedEtb.toLocaleString()} ETB</div></div>
    <div class="kpi"><div class="lbl">${language === 'om' ? 'Haftee' : 'Outstanding'}</div><div class="val">${summary.outstandingEtb.toLocaleString()} ETB</div></div>
    <div class="kpi"><div class="lbl">${language === 'om' ? 'Hirmaannaa %' : 'Rate'}</div><div class="val">${rateText}</div></div>
  </div>

  ${memberTable}
  ${annualTable}
  ${signOffBlock}

  <div class="footer">
    ${language === 'om' ? 'Sanada Iccitii Qabeenya Dhaabbataa — Linkii uummataaf banaa ta’een hin qoodinaa.' : 'Confidential Institutional Financial Report — Do not distribute via public links.'}
  </div>
</body>
</html>`;
}

export async function downloadWordReport(
  summary: PeriodSummaryMetrics,
  closure: PeriodClosure | undefined,
  includeMemberRows: boolean,
  annualRows: AnnualMonthRow[],
  calendarMode: CalendarMode,
  language: Language
): Promise<void> {
  const logoDataUrl = await loadCenterLogoDataUrl();
  const periodLabel = formatPeriodLabel(summary.periodKey, calendarMode, language);
  const html = buildStyledReportHtml(
    `Gabaasa Buusii Ji'aa (${summary.periodKey})`,
    periodLabel,
    summary,
    closure,
    includeMemberRows,
    annualRows,
    language,
    logoDataUrl
  );
  const wordDoc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">${html.replace(/^<!DOCTYPE html>\s*<html[^>]*>/i, '')}`;
  const blob = new Blob(['\ufeff', wordDoc], { type: 'application/msword;charset=utf-8' });
  triggerDownload(blob, `AlFurqaan-Report-${summary.periodKey}.doc`);
}

export async function downloadHtmlReport(
  summary: PeriodSummaryMetrics,
  closure: PeriodClosure | undefined,
  includeMemberRows: boolean,
  annualRows: AnnualMonthRow[],
  calendarMode: CalendarMode,
  language: Language
): Promise<void> {
  const logoDataUrl = await loadCenterLogoDataUrl();
  const periodLabel = formatPeriodLabel(summary.periodKey, calendarMode, language);
  const html = buildStyledReportHtml(
    `Gabaasa Buusii Ji'aa (${summary.periodKey})`,
    periodLabel,
    summary,
    closure,
    includeMemberRows,
    annualRows,
    language,
    logoDataUrl
  );
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, `AlFurqaan-Report-${summary.periodKey}.html`);
}

function csvCell(val: string | number): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsvReport(
  summary: PeriodSummaryMetrics,
  includeMemberRows: boolean,
  annualRows: AnnualMonthRow[]
): void {
  const lines: string[] = [];
  if (includeMemberRows) {
    lines.push('Period,Member Code,Full Name,Status,Expected ETB,Collected ETB,Outstanding ETB,Overpayment ETB,Rate %');
    for (const r of summary.rows) {
      lines.push(
        [
          summary.periodKey,
          r.member.memberCode,
          r.member.fullName,
          r.statusInPeriod,
          r.expectedEtb,
          r.collectedEtb,
          r.outstandingEtb,
          r.overpaymentEtb,
          r.ratePercent !== null ? `${r.ratePercent.toFixed(1)}%` : 'N/A',
        ]
          .map(csvCell)
          .join(',')
      );
    }
  } else {
    lines.push('Period,Active Members,Expected ETB,Collected ETB,Outstanding ETB,Overpayment ETB,Collection Rate %');
    lines.push(
      [
        summary.periodKey,
        summary.activeMembersCount,
        summary.expectedEtb,
        summary.collectedEtb,
        summary.outstandingEtb,
        summary.overpaymentEtb,
        summary.collectionRatePercent !== null ? `${summary.collectionRatePercent.toFixed(1)}%` : 'N/A',
      ]
        .map(csvCell)
        .join(',')
    );
  }

  if (annualRows.length > 0) {
    lines.push('');
    lines.push('Annual Month,Active Members,Expected ETB,Collected ETB,Outstanding ETB,Overpayment ETB,Rate %');
    for (const ar of annualRows) {
      lines.push(
        [
          ar.periodKey,
          ar.activeMembers,
          ar.expectedEtb,
          ar.collectedEtb,
          ar.outstandingEtb,
          ar.overpaymentEtb,
          ar.ratePercent !== null ? `${ar.ratePercent.toFixed(1)}%` : 'N/A',
        ]
          .map(csvCell)
          .join(',')
      );
    }
  }

  const blob = new Blob(['\ufeff', lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  triggerDownload(blob, `AlFurqaan-Buusii-${summary.periodKey}.csv`);
}

export function downloadPeriodSummaryAndStatusCsv(
  summary: PeriodSummaryMetrics,
  contributions: Contribution[],
  closure: PeriodClosure | undefined,
  calendarMode: CalendarMode,
  language: Language,
  exportedBy: string
): void {
  const periodLabel = formatPeriodLabel(summary.periodKey, calendarMode, language);
  const generatedAt = new Date().toISOString();

  const pendingByMember = new Map<string, number>();
  let totalPendingEtb = 0;
  for (const c of contributions) {
    if (c.month === summary.periodKey && c.status === 'pending') {
      pendingByMember.set(c.memberId, (pendingByMember.get(c.memberId) || 0) + c.amount);
      totalPendingEtb += c.amount;
    }
  }

  type PeriodStandingCategory = 'Up-to-date' | 'Pending Verification' | 'Arrears' | 'Inactive / Paused';
  interface ClassifiedRow {
    memberCode: string;
    fullName: string;
    category: string;
    phone: string;
    membershipStatus: string;
    contributionStatus: PeriodStandingCategory;
    expectedEtb: number;
    collectedEtb: number;
    pendingEtb: number;
    outstandingEtb: number;
    overpaymentEtb: number;
    rateLabel: string;
  }

  let upToDateCount = 0;
  let upToDateAmountEtb = 0;
  let pendingCount = 0;
  let pendingAmountEtb = 0;
  let arrearsCount = 0;
  let arrearsAmountEtb = 0;
  let inactiveCount = 0;

  const classifiedRows: ClassifiedRow[] = summary.rows.map((r) => {
    const pendingEtb = pendingByMember.get(r.member.id) || 0;
    const isEvaluated =
      r.statusInPeriod === 'active' || r.collectedEtb > 0 || pendingEtb > 0;

    let contributionStatus: PeriodStandingCategory;
    if (!isEvaluated) {
      contributionStatus = 'Inactive / Paused';
      inactiveCount += 1;
    } else if (r.outstandingEtb === 0) {
      contributionStatus = 'Up-to-date';
      upToDateCount += 1;
      upToDateAmountEtb += r.collectedEtb;
    } else if (pendingEtb > 0) {
      contributionStatus = 'Pending Verification';
      pendingCount += 1;
      pendingAmountEtb += pendingEtb;
    } else {
      contributionStatus = 'Arrears';
      arrearsCount += 1;
      arrearsAmountEtb += r.outstandingEtb;
    }

    return {
      memberCode: r.member.memberCode,
      fullName: r.member.fullName,
      category: r.member.category.toUpperCase(),
      phone: r.member.phone || '',
      membershipStatus: r.statusInPeriod.replace('_', ' ').toUpperCase(),
      contributionStatus,
      expectedEtb: r.expectedEtb,
      collectedEtb: r.collectedEtb,
      pendingEtb,
      outstandingEtb: r.outstandingEtb,
      overpaymentEtb: r.overpaymentEtb,
      rateLabel: r.ratePercent !== null ? `${r.ratePercent.toFixed(1)}%` : 'N/A',
    };
  });

  const statusOrder: Record<PeriodStandingCategory, number> = {
    Arrears: 0,
    'Pending Verification': 1,
    'Up-to-date': 2,
    'Inactive / Paused': 3,
  };
  classifiedRows.sort((a, b) => {
    const diff = statusOrder[a.contributionStatus] - statusOrder[b.contributionStatus];
    if (diff !== 0) return diff;
    return a.memberCode.localeCompare(b.memberCode);
  });

  const evaluatedCount = upToDateCount + pendingCount + arrearsCount;
  const sharePct = (count: number) =>
    evaluatedCount > 0 ? `${((count / evaluatedCount) * 100).toFixed(1)}%` : '0.0%';

  const pushRow = (lines: string[], cells: Array<string | number>) => {
    lines.push(cells.map(csvCell).join(','));
  };

  const lines: string[] = [];

  // 1. Report Metadata
  pushRow(lines, ["AL-FURQAAN QUR'AN MEMORIZATION CENTER - PERIOD FINANCIAL SUMMARY & MEMBER STATUS REPORT"]);
  pushRow(lines, ['Location', 'Chiro, West Hararghe, Oromia, Ethiopia']);
  pushRow(lines, ['Selected Period (GC)', summary.periodKey]);
  pushRow(lines, ['Calendar Period Label', periodLabel]);
  pushRow(lines, ['Exported At (UTC)', generatedAt]);
  pushRow(lines, ['Exported By', exportedBy]);
  pushRow(lines, ['Currency', 'ETB']);
  lines.push('');

  // 2. Period Financial Summary
  pushRow(lines, ['SECTION 1: PERIOD FINANCIAL SUMMARY']);
  pushRow(lines, ['Metric', 'Value', 'Notes']);
  pushRow(lines, ['Active Members Count', summary.activeMembersCount, 'Members with active commitment in period']);
  pushRow(lines, ['Expected Contribution (ETB)', summary.expectedEtb, 'Effective-dated obligation']);
  pushRow(lines, ['Confirmed Collected (ETB)', summary.collectedEtb, 'Confirmed receipts only']);
  pushRow(lines, ['Pending Verification (ETB)', totalPendingEtb, 'Submitted receipts awaiting confirmation']);
  pushRow(lines, ['Outstanding Balance (ETB)', summary.outstandingEtb, 'Expected minus confirmed collected']);
  pushRow(lines, ['Overpayment / Excess (ETB)', summary.overpaymentEtb, 'Tracked separately per BR-07']);
  pushRow(lines, [
    'Collection Rate (%)',
    summary.collectionRatePercent !== null ? `${summary.collectionRatePercent.toFixed(1)}%` : 'N/A',
    'Confirmed Collected / Expected',
  ]);
  pushRow(lines, [
    'Period Closure Status',
    closure?.status === 'closed' ? 'CLOSED' : 'OPEN',
    closure?.preparedBy ? `Prepared by: ${closure.preparedBy}` : 'Not closed yet',
  ]);
  pushRow(lines, ['Cash Reconciled (ETB)', closure?.cashReconciledEtb ?? 0, 'Period reconciliation record']);
  pushRow(lines, ['Bank / Mobile Reconciled (ETB)', closure?.bankReconciledEtb ?? 0, 'Period reconciliation record']);
  lines.push('');

  // 3. Payment Method Breakdown
  pushRow(lines, ['SECTION 2: CONFIRMED PAYMENT METHOD BREAKDOWN']);
  pushRow(lines, ['Payment Method', 'Receipt Count', 'Confirmed Amount (ETB)', 'Share of Collected (%)']);
  if (summary.methodMix.length === 0) {
    pushRow(lines, ['No confirmed payments recorded in this period', 0, 0, '0.0%']);
  } else {
    for (const m of summary.methodMix) {
      const pct =
        summary.collectedEtb > 0
          ? `${((m.totalEtb / summary.collectedEtb) * 100).toFixed(1)}%`
          : '0.0%';
      pushRow(lines, [m.method.replace('_', ' ').toUpperCase(), m.count, m.totalEtb, pct]);
    }
  }
  lines.push('');

  // 4. Member Status Breakdown Summary
  pushRow(lines, ['SECTION 3: MEMBER CONTRIBUTION STATUS BREAKDOWN']);
  pushRow(lines, ['Contribution Status', 'Member Count', 'Share of Evaluated (%)', 'Amount (ETB)']);
  pushRow(lines, ['Up-to-date', upToDateCount, sharePct(upToDateCount), upToDateAmountEtb]);
  pushRow(lines, ['Pending Verification', pendingCount, sharePct(pendingCount), pendingAmountEtb]);
  pushRow(lines, ['Arrears', arrearsCount, sharePct(arrearsCount), arrearsAmountEtb]);
  pushRow(lines, ['Inactive / Paused / Not Joined', inactiveCount, '—', 0]);
  pushRow(lines, ['Total Members in Roster', summary.rows.length, '100.0%', summary.collectedEtb]);
  lines.push('');

  // 5. Detailed Member Status Table
  pushRow(lines, ['SECTION 4: DETAILED MEMBER STATUS & FINANCIAL BREAKDOWN']);
  pushRow(lines, [
    'Member Code',
    'Full Name',
    'Category',
    'Phone',
    'Membership Status',
    'Contribution Status',
    'Expected (ETB)',
    'Confirmed Collected (ETB)',
    'Pending (ETB)',
    'Outstanding (ETB)',
    'Overpayment (ETB)',
    'Fulfillment Rate (%)',
  ]);
  for (const row of classifiedRows) {
    pushRow(lines, [
      row.memberCode,
      row.fullName,
      row.category,
      row.phone,
      row.membershipStatus,
      row.contributionStatus,
      row.expectedEtb,
      row.collectedEtb,
      row.pendingEtb,
      row.outstandingEtb,
      row.overpaymentEtb,
      row.rateLabel,
    ]);
  }

  const blob = new Blob(['\ufeff', lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  triggerDownload(blob, `AlFurqaan-Summary-Status-${summary.periodKey}.csv`);
}

export function downloadJsonBackup(
  members: Member[],
  contributions: Contribution[],
  closures: PeriodClosure[]
): void {
  const payload = {
    schemaVersion: '2.0',
    exportedAt: new Date().toISOString(),
    center: "Al-Furqaan Qur'an Memorization Center (Chiro)",
    currency: 'ETB',
    members,
    contributions,
    periodClosures: closures,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerDownload(
    blob,
    `AlFurqaan-Backup-${new Date().toISOString().slice(0, 10)}.json`
  );
}

export function downloadStandingCsvReport(
  standing: MemberStandingSummary,
  includeMemberRows: boolean
): void {
  const lines: string[] = [];
  if (includeMemberRows) {
    lines.push(
      'As Of Period,Member Code,Full Name,Phone,Status As Of Period,Standing,Current Commitment ETB,Active Months,Cumulative Expected ETB,Confirmed Paid ETB,Arrears ETB,Overpayment ETB,Months In Arrears,Last Payment Date,Fulfillment %'
    );
    for (const r of standing.rows) {
      lines.push(
        [
          standing.asOfPeriod,
          r.member.memberCode,
          r.member.fullName,
          r.member.phone || '',
          r.statusAsOfPeriod,
          r.standing === 'in_arrears' ? 'In Arrears' : 'Up-to-Date',
          r.currentCommitmentEtb,
          r.monthsEvaluated,
          r.expectedTotalEtb,
          r.confirmedTotalEtb,
          r.arrearsEtb,
          r.overpaymentEtb,
          r.monthsInArrears.join('; '),
          r.lastPaymentDate || '',
          r.ratePercent !== null ? `${r.ratePercent.toFixed(1)}%` : 'N/A',
        ]
          .map(csvCell)
          .join(',')
      );
    }
  } else {
    lines.push(
      'As Of Period,Total Members,Up-to-Date Count,In Arrears Count,Total Expected ETB,Total Confirmed ETB,Total Arrears ETB'
    );
    lines.push(
      [
        standing.asOfPeriod,
        standing.totalMembers,
        standing.upToDateCount,
        standing.inArrearsCount,
        standing.totalExpectedEtb,
        standing.totalConfirmedEtb,
        standing.totalArrearsEtb,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  const blob = new Blob(['\ufeff', lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  triggerDownload(blob, `AlFurqaan-Member-Standing-${standing.asOfPeriod}.csv`);
}

export async function downloadContributionsBatchPdf(
  items: Contribution[],
  calendarMode: CalendarMode,
  language: Language,
  exportedBy: string
): Promise<void> {
  if (items.length === 0) return;

  const logoDataUrl = await loadCenterLogoDataUrl();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageW - margin * 2;

  const confirmedTotal = items
    .filter((c) => c.status === 'confirmed')
    .reduce((s, c) => s + c.amount, 0);
  const pendingTotal = items
    .filter((c) => c.status === 'pending')
    .reduce((s, c) => s + c.amount, 0);
  const voidedTotal = items
    .filter((c) => c.status === 'cancelled' || c.status === 'rejected')
    .reduce((s, c) => s + c.amount, 0);
  const allTotal = items.reduce((s, c) => s + c.amount, 0);

  // Header Banner
  doc.setFillColor(23, 54, 93);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setFillColor(198, 156, 61);
  doc.rect(0, 28, pageW, 1.5, 'F');

  let bannerTextX = margin;
  if (logoDataUrl) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin - 0.8, 3.7, 20.6, 20.6, 2, 2, 'F');
    doc.addImage(logoDataUrl, 'JPEG', margin, 4.5, 19, 19);
    bannerTextX = margin + 23;
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text("AL-FURQAAN QUR'AN MEMORIZATION CENTER", bannerTextX, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(216, 228, 242);
  const subtitle =
    language === 'om'
      ? 'Cuunfaa Kaffaltii Buusii Filatamanii (Batch PDF) · Ciroo, Harargee Lixaa'
      : 'Batch Contribution Summary Report · Chiro, West Hararghe, Ethiopia';
  doc.text(subtitle, bannerTextX, 17.5);

  const todayIso = new Date().toISOString().slice(0, 10);
  doc.setFontSize(8);
  doc.text(
    `Exported: ${formatDateByCalendar(todayIso, calendarMode)} | By: ${exportedBy}`,
    bannerTextX,
    23.5
  );

  // KPI Strip
  let y = 36;
  const boxW = (contentW - 9) / 4;
  const kpis = [
    {
      label: language === 'om' ? 'Nagahee Filataman' : 'Selected Items',
      value: String(items.length),
    },
    {
      label: language === 'om' ? 'Mirkanaa’e (ETB)' : 'Confirmed (ETB)',
      value: `${confirmedTotal.toLocaleString()} ETB`,
    },
    {
      label: language === 'om' ? 'Eegaa (Pending)' : 'Pending (ETB)',
      value: `${pendingTotal.toLocaleString()} ETB`,
    },
    {
      label: language === 'om' ? 'Haqame / Diddame' : 'Voided / Rejected',
      value: `${voidedTotal.toLocaleString()} ETB`,
    },
  ];

  kpis.forEach((k, idx) => {
    const x = margin + idx * (boxW + 3);
    doc.setFillColor(234, 241, 247);
    doc.setDrawColor(200, 214, 229);
    doc.rect(x, y, boxW, 14, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(82, 97, 115);
    doc.text(k.label, x + 2.5, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(23, 54, 93);
    doc.text(k.value, x + 2.5, y + 11);
  });

  y += 20;

  const cols = [
    { label: 'Receipt #', w: 28, align: 'left' as const },
    { label: language === 'om' ? 'Miseensa' : 'Member', w: 46, align: 'left' as const },
    { label: language === 'om' ? 'Ji’a' : 'Period', w: 18, align: 'left' as const },
    { label: language === 'om' ? 'Guyyaa' : 'Date', w: 34, align: 'left' as const },
    { label: language === 'om' ? 'Mala' : 'Method', w: 20, align: 'left' as const },
    { label: language === 'om' ? 'Haala' : 'Status', w: 18, align: 'left' as const },
    { label: 'ETB', w: 18, align: 'right' as const },
  ];

  const drawTableHeader = (topY: number) => {
    doc.setFillColor(23, 54, 93);
    doc.rect(margin, topY, contentW, 7.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    let x = margin;
    for (const col of cols) {
      if (col.align === 'right') {
        doc.text(col.label, x + col.w - 2, topY + 5, { align: 'right' });
      } else {
        doc.text(col.label, x + 2, topY + 5);
      }
      x += col.w;
    }
    return topY + 7.5;
  };

  y = drawTableHeader(y);

  items.forEach((c, idx) => {
    if (y > 268) {
      doc.addPage();
      y = 16;
      y = drawTableHeader(y);
    }

    if (idx % 2 === 1) {
      doc.setFillColor(243, 247, 250);
      doc.rect(margin, y, contentW, 7, 'F');
    }
    doc.setDrawColor(200, 214, 229);
    doc.line(margin, y + 7, margin + contentW, y + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(32, 40, 51);

    const dateText = formatDateByCalendar(c.paymentDate, calendarMode).slice(0, 22);
    const memberLabel = `${c.memberCode} ${c.memberName}`.slice(0, 27);
    const rowVals = [
      c.receiptNumber.slice(0, 16),
      memberLabel,
      c.month,
      dateText,
      c.paymentMethod.replace('_', ' ').toUpperCase().slice(0, 11),
      c.status.toUpperCase().slice(0, 10),
      c.amount.toLocaleString(),
    ];

    let x = margin;
    rowVals.forEach((val, ci) => {
      const col = cols[ci];
      if (col.align === 'right') {
        doc.setFont('helvetica', 'bold');
        doc.text(val, x + col.w - 2, y + 4.8, { align: 'right' });
        doc.setFont('helvetica', 'normal');
      } else {
        doc.text(val, x + 2, y + 4.8);
      }
      x += col.w;
    });

    y += 7;
  });

  if (y > 262) {
    doc.addPage();
    y = 16;
  }

  // Totals Footer Bar
  doc.setFillColor(234, 241, 247);
  doc.setDrawColor(23, 54, 93);
  doc.rect(margin, y + 2, contentW, 9, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(23, 54, 93);
  doc.text(
    language === 'om'
      ? `Waliigala Filatame (${items.length}) · Mirkanaa’e: ${confirmedTotal.toLocaleString()} ETB`
      : `Batch Total (${items.length} receipts) · Confirmed: ${confirmedTotal.toLocaleString()} ETB`,
    margin + 3,
    y + 7.8
  );
  doc.text(`${allTotal.toLocaleString()} ETB`, margin + contentW - 2, y + 7.8, {
    align: 'right',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Al-Furqaan Membership Contribution System · Tel: +251991272425 / +251998889045 · markazalfurqan19@gmail.com',
    margin,
    y + 18
  );

  doc.save(`AlFurqaan-Contributions-Batch-${todayIso}.pdf`);
}

export async function downloadMemberCardPdf(
  member: Member,
  qrDataUrl: string,
  calendarMode: CalendarMode,
  language: Language,
  showCommitment: boolean
): Promise<void> {
  const logoDataUrl = await loadCenterLogoDataUrl();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Printable CR80+ scaled card centered cleanly on A4 (105mm x 64mm)
  const cardW = 105;
  const cardH = 66;
  const x = (doc.internal.pageSize.getWidth() - cardW) / 2;
  const y = 32;

  // Card outer shell
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(200, 214, 229);
  doc.roundedRect(x, y, cardW, cardH, 3, 3, 'FD');

  // Deep Navy Header Banner
  doc.setFillColor(23, 54, 93);
  doc.roundedRect(x, y, cardW, 15, 3, 3, 'F');
  doc.rect(x, y + 10, cardW, 5, 'F');

  // Gold Accent Strip
  doc.setFillColor(198, 156, 61);
  doc.rect(x, y + 15, cardW, 1.3, 'F');

  let cardTitleX = x + 4.5;
  if (logoDataUrl) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x + 3.1, y + 2.1, 10.8, 10.8, 1.5, 1.5, 'F');
    doc.addImage(logoDataUrl, 'JPEG', x + 3.5, y + 2.5, 10, 10);
    cardTitleX = x + 16;
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text("AL-FURQAAN QUR'AN MEMORIZATION CENTER", cardTitleX, y + 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(216, 228, 242);
  doc.text(
    language === 'om'
      ? 'Kaardii Miseensummaa · Ciroo, Harargee Lixaa'
      : 'Official Membership Card · Chiro, West Hararghe',
    cardTitleX,
    y + 11.5
  );

  // QR Code Frame on right side
  const qrSize = 27;
  const qrX = x + cardW - qrSize - 5;
  const qrY = y + 20;
  doc.setFillColor(243, 247, 250);
  doc.setDrawColor(200, 214, 229);
  doc.roundedRect(qrX - 1.5, qrY - 1.5, qrSize + 3, qrSize + 7.5, 2, 2, 'FD');
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(23, 54, 93);
  doc.text('SCAN AT COLLECTION', qrX + qrSize / 2, qrY + qrSize + 4, { align: 'center' });

  // Member Details on left side
  const textX = x + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(22, 124, 128);
  doc.text(language === 'om' ? 'KOODII MISEENSAA' : 'MEMBER ID', textX, y + 22);

  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(23, 54, 93);
  doc.text(member.memberCode, textX, y + 27);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(82, 97, 115);
  doc.text(language === 'om' ? 'MAQAA GUUTUU' : 'MEMBER NAME', textX, y + 33);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(32, 40, 51);
  doc.text(member.fullName.slice(0, 30), textX, y + 38);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(82, 97, 115);
  doc.text(
    `${language === 'om' ? 'Gosa:' : 'Category:'} ${member.category.toUpperCase()}  |  ${
      language === 'om' ? 'Haala:' : 'Status:'
    } ${member.status.toUpperCase()}`,
    textX,
    y + 44
  );

  doc.text(
    `${language === 'om' ? 'Seensa:' : 'Joined:'} ${formatDateByCalendar(
      member.joinedDate,
      calendarMode
    ).slice(0, 24)}`,
    textX,
    y + 49
  );

  if (showCommitment) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 124, 128);
    doc.text(
      `${language === 'om' ? 'Waadaa Ji’aa:' : 'Commitment:'} ${member.monthlyCommitment.toLocaleString()} ETB`,
      textX,
      y + 54
    );
  } else if (member.phone) {
    doc.text(`${language === 'om' ? 'Bilbila:' : 'Phone:'} ${member.phone}`, textX, y + 54);
  }

  // Bottom Contact Strip
  doc.setFillColor(234, 241, 247);
  doc.rect(x + 0.5, y + cardH - 7.5, cardW - 1, 7, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(23, 54, 93);
  doc.text(
    'Tel: +251991272425 / +251998889045 · markazalfurqan19@gmail.com',
    x + cardW / 2,
    y + cardH - 3,
    { align: 'center' }
  );

  // Helper cut guide note below card
  doc.setFontSize(8);
  doc.setTextColor(120, 132, 150);
  doc.text(
    language === 'om'
      ? `Kaardii Miseensummaa Qopheeffame: ${member.memberCode} — ${member.fullName}`
      : `Printable Branded Member Card: ${member.memberCode} — ${member.fullName}`,
    doc.internal.pageSize.getWidth() / 2,
    y + cardH + 10,
    { align: 'center' }
  );

  doc.save(`AlFurqaan-Member-Card-${member.memberCode}.pdf`);
}

function parseAuditTimestamp(createdAt: unknown): Date | null {
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

export function downloadAuditLogsCsv(
  logs: AuditLog[],
  exportedBy: string,
  filters?: {
    fromDate?: string;
    toDate?: string;
    search?: string;
  }
): void {
  const pushRow = (lines: string[], cells: Array<string | number>) => {
    lines.push(cells.map(csvCell).join(','));
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  pushRow(lines, ["AL-FURQAAN QUR'AN MEMORIZATION CENTER - SYSTEM AUDIT LOGS REPORT"]);
  pushRow(lines, ['Exported At (UTC)', new Date().toISOString()]);
  pushRow(lines, ['Exported By', exportedBy]);
  pushRow(lines, [
    'Date Range Filter',
    filters?.fromDate || filters?.toDate
      ? `${filters?.fromDate || 'Start'} to ${filters?.toDate || 'Present'}`
      : 'All Dates',
  ]);
  if (filters?.search?.trim()) {
    pushRow(lines, ['Search Filter', filters.search.trim()]);
  }
  pushRow(lines, ['Exported Events Count', logs.length]);
  lines.push('');

  pushRow(lines, [
    'Timestamp (Local)',
    'Timestamp (UTC ISO)',
    'Action',
    'Target Type',
    'Target ID',
    'Actor Email',
    'Actor UID',
    'Details',
    'Event ID',
  ]);

  for (const log of logs) {
    const dt = parseAuditTimestamp(log.createdAt);
    const localTs = dt
      ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
          dt.getDate()
        ).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(
          dt.getMinutes()
        ).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`
      : '—';
    const utcTs = dt ? dt.toISOString() : '';

    pushRow(lines, [
      localTs,
      utcTs,
      log.action,
      log.targetType,
      log.targetId,
      log.actorEmail,
      log.actorUid,
      log.details,
      log.id,
    ]);
  }

  const blob = new Blob(['\ufeff', lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  triggerDownload(blob, `AlFurqaan-Audit-Logs-${todayStr}.csv`);
}
