import type { Contribution, Member, PeriodClosure, PeriodSummaryMetrics } from '../types.ts';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export async function createAlFurqaanSpreadsheet(
  accessToken: string,
  members: Member[],
  contributions: Contribution[],
  periodSummary: PeriodSummaryMetrics
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const title = `Al-Furqaan Buusii Ledger (${periodSummary.periodKey})`;

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Members' } },
        { properties: { title: 'Contributions' } },
        { properties: { title: 'Monthly Summary' } },
      ],
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Google Sheets creation failed (${createRes.status}): ${errText}`);
  }

  const created = await createRes.json();
  const spreadsheetId = created.spreadsheetId as string;
  const spreadsheetUrl = created.spreadsheetUrl as string;

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const metaJson = metaRes.ok ? await metaRes.json() : created;
  const sheetTitles: string[] = (metaJson.sheets || []).map(
    (s: { properties?: { title?: string } }) => s.properties?.title || ''
  );

  const membersSheet = sheetTitles[0] || 'Members';
  const contribSheet = sheetTitles[1] || 'Contributions';
  const summarySheet = sheetTitles[2] || 'Monthly Summary';

  const memberRows = [
    ['Code', 'Full Name', 'Phone', 'Email', 'Location', 'Category', 'Monthly Commitment (ETB)', 'Status', 'Joined Date', 'Effective Month'],
    ...members.map((m) => [
      m.memberCode,
      m.fullName,
      m.phone || '',
      m.email || '',
      m.location || '',
      m.category,
      m.monthlyCommitment,
      m.status,
      m.joinedDate,
      m.effectiveMonth || m.joinedDate.slice(0, 7),
    ]),
  ];

  const contribRows = [
    ['Receipt #', 'Member Code', 'Member Name', 'Amount (ETB)', 'Contribution Month', 'Received Date', 'Method', 'Reference', 'Status', 'Status Reason', 'Recorded By'],
    ...contributions.map((c) => [
      c.receiptNumber,
      c.memberCode,
      c.memberName,
      c.amount,
      c.month,
      c.paymentDate,
      c.paymentMethod,
      c.referenceCode || '',
      c.status,
      c.statusReason || '',
      c.recordedByName,
    ]),
  ];

  const summaryRows = [
    ['Period', 'Member Code', 'Member Name', 'Period Status', 'Expected (ETB)', 'Confirmed Collected (ETB)', 'Outstanding (ETB)', 'Overpayment (ETB)', 'Rate %'],
    ...periodSummary.rows.map((r) => [
      periodSummary.periodKey,
      r.member.memberCode,
      r.member.fullName,
      r.statusInPeriod,
      r.expectedEtb,
      r.collectedEtb,
      r.outstandingEtb,
      r.overpaymentEtb,
      r.ratePercent !== null ? `${r.ratePercent.toFixed(1)}%` : 'N/A',
    ]),
  ];

  const batchRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `'${membersSheet}'!A1`, values: memberRows },
          { range: `'${contribSheet}'!A1`, values: contribRows },
          { range: `'${summarySheet}'!A1`, values: summaryRows },
        ],
      }),
    }
  );

  if (!batchRes.ok) {
    const errText = await batchRes.text();
    throw new Error(`Google Sheets population failed (${batchRes.status}): ${errText}`);
  }

  return { spreadsheetId, spreadsheetUrl };
}

export async function listDriveBackupFiles(accessToken: string): Promise<DriveFileItem[]> {
  const params = new URLSearchParams({
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
    q: 'trashed = false',
    orderBy: 'modifiedTime desc',
    pageSize: '20',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to list Drive files (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.files || []) as DriveFileItem[];
}

export async function uploadDriveJsonBackup(
  accessToken: string,
  members: Member[],
  contributions: Contribution[],
  closures: PeriodClosure[]
): Promise<DriveFileItem> {
  const fileName = `al-furqaan-buusii-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const backupContent = JSON.stringify(
    {
      schemaVersion: '2.0',
      exportedAt: new Date().toISOString(),
      center: "Al-Furqaan Qur'an Memorization Center (Chiro)",
      currency: 'ETB',
      members,
      contributions,
      periodClosures: closures,
    },
    null,
    2
  );

  const boundary = '-------alfurqaan_drive_boundary_314159';
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: 'application/json',
  });

  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${backupContent}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive backup upload failed (${res.status}): ${errText}`);
  }

  return (await res.json()) as DriveFileItem;
}

export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok && res.status !== 204) {
    const errText = await res.text();
    throw new Error(`Google Drive file deletion failed (${res.status}): ${errText}`);
  }
}

function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendGmailNotification(
  accessToken: string,
  to: string,
  subject: string,
  bodyText: string
): Promise<{ id: string }> {
  const rfc2822 = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyText,
  ].join('\r\n');

  const raw = encodeBase64Url(rfc2822);

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${errText}`);
  }

  return (await res.json()) as { id: string };
}
