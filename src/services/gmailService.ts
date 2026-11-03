import {
  isGoogleOAuthAccessToken,
  resolveValidOAuthToken,
  getStoredOAuthToken,
  refreshGoogleAccessToken,
  markTokenMissingGmailScope,
  auth,
  getRememberedUser,
} from './auth';
import { fetchWithRetry, parseGoogleApiError, DriveSpreadsheetFile } from './googleSheets';

export interface EmailSpreadsheetAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface EmailSharedSheetLink {
  spreadsheetId: string;
  url: string;
  label: string;
}

export interface BranchEmailSpreadsheetMessage {
  messageId: string;
  threadId: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  date: string;
  timestamp: number;
  snippet: string;
  attachments: EmailSpreadsheetAttachment[];
  sharedSheetLinks: EmailSharedSheetLink[];
}

export interface ConvertedEmailSpreadsheetRecord {
  key: string; // `${messageId}:${filename}`
  spreadsheetId: string;
  spreadsheetName: string;
  webViewLink: string;
  convertedAt: string;
}

function getEmailStorageScope(): string {
  try {
    const email = auth.currentUser?.email || getRememberedUser()?.email;
    if (email && email.trim()) {
      return email.trim().toLowerCase().replace(/[^a-z0-9@._-]/gi, '_');
    }
  } catch {}
  return 'default';
}

function getCachedEmailMessagesKey(): string {
  return `countsheet_cached_branch_emails_v2_${getEmailStorageScope()}`;
}

function getConvertedEmailSheetsKey(): string {
  return `countsheet_converted_email_sheets_v2_${getEmailStorageScope()}`;
}

export function getConvertedEmailSheetsMap(): Record<string, ConvertedEmailSpreadsheetRecord> {
  try {
    const raw = localStorage.getItem(getConvertedEmailSheetsKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConvertedEmailSheetRecord(record: ConvertedEmailSpreadsheetRecord) {
  try {
    const map = getConvertedEmailSheetsMap();
    map[record.key] = record;
    localStorage.setItem(getConvertedEmailSheetsKey(), JSON.stringify(map));
  } catch {}
}

export function getCachedBranchEmails(searchQuery = ''): BranchEmailSpreadsheetMessage[] {
  try {
    const raw = localStorage.getItem(getCachedEmailMessagesKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parsed;
    return parsed.filter((m: BranchEmailSpreadsheetMessage) => {
      const hay = `${m.subject} ${m.fromName} ${m.fromEmail} ${m.snippet} ${m.attachments
        .map((a) => a.filename)
        .join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  } catch {
    return [];
  }
}

export function saveCachedBranchEmails(messages: BranchEmailSpreadsheetMessage[]) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  try {
    localStorage.setItem(getCachedEmailMessagesKey(), JSON.stringify(messages.slice(0, 50)));
  } catch {}
}

function isSpreadsheetFilenameOrMime(filename: string, mimeType: string): boolean {
  const lowerName = (filename || '').trim().toLowerCase();
  const lowerMime = (mimeType || '').trim().toLowerCase();

  if (/\.(xlsx|xls|csv|ods|xlsm|xlsb)$/i.test(lowerName)) {
    return true;
  }

  if (
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('ms-excel') ||
    lowerMime === 'text/csv' ||
    lowerMime === 'application/csv' ||
    lowerMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return Boolean(lowerName);
  }

  return false;
}

function parseFromHeader(rawFrom: string): { fromName: string; fromEmail: string } {
  const trimmed = (rawFrom || '').trim();
  if (!trimmed) return { fromName: 'Branch Sender', fromEmail: '' };
  const match = trimmed.match(/^(?:"?([^"<]+)"?\s*)?<([^>]+)>$/);
  if (match) {
    const email = match[2].trim();
    const name = (match[1] || '').trim() || email.split('@')[0];
    return { fromName: name, fromEmail: email };
  }
  return { fromName: trimmed.replace(/^"|"$/g, ''), fromEmail: trimmed };
}

function decodeBase64UrlToUtf8(base64Url: string): string {
  try {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

export function decodeBase64UrlToUint8Array(base64Url: string): Uint8Array {
  const clean = (base64Url || '').replace(/[\r\n\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = clean.length % 4;
  const padded = pad ? clean + '='.repeat(4 - pad) : clean;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extractAttachmentsAndLinksFromPayload(
  payload: any,
  attachments: EmailSpreadsheetAttachment[],
  sharedSheetLinks: EmailSharedSheetLink[],
  seenAttachmentKeys: Set<string>,
  seenSheetIds: Set<string>
) {
  if (!payload) return;

  const filename = String(payload.filename || '').trim();
  const mimeType = String(payload.mimeType || '').trim();
  const attachmentId = String(payload.body?.attachmentId || '').trim();
  const size = Number(payload.body?.size || 0);

  if (filename && attachmentId && isSpreadsheetFilenameOrMime(filename, mimeType)) {
    const key = `${filename}::${attachmentId}`;
    if (!seenAttachmentKeys.has(key)) {
      seenAttachmentKeys.add(key);
      attachments.push({
        attachmentId,
        filename,
        mimeType:
          mimeType ||
          (filename.toLowerCase().endsWith('.csv')
            ? 'text/csv'
            : filename.toLowerCase().endsWith('.xls')
            ? 'application/vnd.ms-excel'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        size,
      });
    }
  }

  // Also check text/plain or text/html body parts for shared Google Sheets links from branches
  if (
    payload.body?.data &&
    (mimeType === 'text/plain' || mimeType === 'text/html' || !payload.parts)
  ) {
    const text = decodeBase64UrlToUtf8(payload.body.data);
    if (text && text.includes('docs.google.com/spreadsheets/d/')) {
      const regex = /https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})(?:\/[^\s"'<>)]*)?/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const sheetId = match[1];
        if (sheetId && !seenSheetIds.has(sheetId)) {
          seenSheetIds.add(sheetId);
          sharedSheetLinks.push({
            spreadsheetId: sheetId,
            url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
            label: `Shared Google Sheet (${sheetId.slice(0, 8)}...)`,
          });
        }
      }
    }
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      extractAttachmentsAndLinksFromPayload(
        part,
        attachments,
        sharedSheetLinks,
        seenAttachmentKeys,
        seenSheetIds
      );
    }
  }
}

/**
 * Discovers emailed/shared branch spreadsheets (.xlsx, .xls, .csv, .ods, and shared Google Sheets)
 * directly from the signed-in user's Google Drive using their existing Drive permission.
 * This ensures the Email (Branch Spreadsheets) tab always displays branch files even when
 * the token was issued without the separate gmail.readonly scope.
 */
async function discoverBranchSpreadsheetsFromDrive(
  tokenToUse: string,
  userSearchQuery = ''
): Promise<BranchEmailSpreadsheetMessage[]> {
  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) return [];
  try {
    const mimeClause =
      "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel' or mimeType = 'text/csv' or mimeType = 'application/csv' or mimeType = 'application/vnd.oasis.opendocument.spreadsheet' or name contains '.xlsx' or name contains '.xls' or name contains '.csv')";
    const cleanQ = userSearchQuery.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = cleanQ
      ? `${mimeClause} and name contains '${cleanQ}' and trashed = false`
      : `${mimeClause} and trashed = false`;

    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&orderBy=modifiedTime desc&pageSize=35&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,shared,owners(displayName,emailAddress),sharingUser(displayName,emailAddress))`;

    const res = await fetchWithRetry(driveUrl, {
      headers: { Authorization: `Bearer ${tokenToUse}` },
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const files: any[] = Array.isArray(data.files) ? data.files : [];
    const results: BranchEmailSpreadsheetMessage[] = [];

    for (const f of files) {
      if (!f?.id || !f?.name) continue;
      const lowerName = String(f.name).toLowerCase();
      // Skip system templates & generated output folders
      if (
        lowerName.includes('random inventory countsheet template') ||
        lowerName === 'overall count template' ||
        lowerName === 'cessation overall count template'
      ) {
        continue;
      }

      const isExcelAttachment =
        (f.mimeType && f.mimeType !== 'application/vnd.google-apps.spreadsheet') ||
        /\.(xlsx|xls|csv|ods|xlsm|xlsb)$/i.test(f.name);

      const senderObj = f.sharingUser || f.owners?.[0] || {};
      const fromEmail = String(senderObj.emailAddress || '').trim();
      const fromName =
        String(senderObj.displayName || '').trim() ||
        (fromEmail ? fromEmail.split('@')[0] : 'Branch Spreadsheet');
      const dateStr = f.modifiedTime || f.createdTime || new Date().toISOString();
      const ts = Date.parse(dateStr) || Date.now();

      const attachments: EmailSpreadsheetAttachment[] = [];
      const sharedSheetLinks: EmailSharedSheetLink[] = [];

      if (isExcelAttachment) {
        const ensuredFilename = /\.(xlsx|xls|csv|ods|xlsm|xlsb)$/i.test(f.name)
          ? f.name
          : `${f.name}.xlsx`;
        attachments.push({
          attachmentId: `drive_file:${f.id}`,
          filename: ensuredFilename,
          mimeType:
            f.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: Number(f.size || 0),
        });
      } else {
        sharedSheetLinks.push({
          spreadsheetId: f.id,
          url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
          label: f.name,
        });
      }

      results.push({
        messageId: `drive_msg_${f.id}`,
        threadId: `drive_thread_${f.id}`,
        subject: f.name,
        fromName,
        fromEmail,
        date: new Date(ts).toISOString(),
        timestamp: ts,
        snippet: isExcelAttachment
          ? `Spreadsheet attachment (${f.name})`
          : `Google Sheet (${f.name})`,
        attachments,
        sharedSheetLinks,
      });
    }

    return results;
  } catch (err) {
    console.warn('Fallback Drive spreadsheet discovery notice:', err);
    return [];
  }
}

/**
 * Searches Gmail for branch emails containing spreadsheet attachments (.xlsx, .xls, .csv, .ods)
 * or shared Google Sheets links, with automatic scope recovery and Drive-backed fallback.
 */
export async function searchBranchEmailSpreadsheets(
  accessToken: string,
  userSearchQuery = '',
  options?: { allowInteractiveConsent?: boolean }
): Promise<BranchEmailSpreadsheetMessage[]> {
  let tokenToUse =
    (await resolveValidOAuthToken(accessToken, { allowPopup: false })) ||
    getStoredOAuthToken() ||
    accessToken;

  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) {
    const cached = getCachedBranchEmails(userSearchQuery);
    if (cached.length > 0) return cached;
    throw new Error(
      'Please connect your Google account to view emailed branch spreadsheets from Gmail.'
    );
  }

  const baseFilter =
    '(has:attachment (filename:xlsx OR filename:xls OR filename:csv OR filename:ods OR filename:xlsm)) OR "docs.google.com/spreadsheets/d/"';
  const trimmedSearch = userSearchQuery.trim();
  const gmailQuery = trimmedSearch ? `(${baseFilter}) (${trimmedSearch})` : baseFilter;

  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
    gmailQuery
  )}&maxResults=25`;

  let listRes = await fetchWithRetry(listUrl, {
    headers: { Authorization: `Bearer ${tokenToUse}` },
  });

  if (!listRes.ok && listRes.status === 403) {
    const errText = await listRes.text();
    const lowerErr = errText.toLowerCase();
    const isInsufficientScope =
      lowerErr.includes('insufficient authentication scopes') ||
      lowerErr.includes('insufficient permissions') ||
      lowerErr.includes('access_token_scope_insufficient');

    if (isInsufficientScope) {
      // Retire the stale token that was minted without gmail.readonly
      markTokenMissingGmailScope(tokenToUse);

      // If triggered by an explicit user click (e.g. Refresh / Authorize), request Gmail consent and retry immediately
      if (options?.allowInteractiveConsent) {
        try {
          const freshToken = await refreshGoogleAccessToken(undefined, true);
          if (freshToken && isGoogleOAuthAccessToken(freshToken)) {
            tokenToUse = freshToken;
            listRes = await fetchWithRetry(listUrl, {
              headers: { Authorization: `Bearer ${tokenToUse}` },
            });
          }
        } catch (consentErr) {
          console.warn('Interactive Gmail consent notice:', consentErr);
        }
      }
    }

    // If Gmail API is still not accessible (e.g. background tab load without popup, or Gmail API not yet enabled),
    // seamlessly return branch spreadsheets & Excel/CSV attachments from the user's Google Drive + cached emails!
    if (!listRes.ok) {
      const driveFallbackMessages = await discoverBranchSpreadsheetsFromDrive(
        tokenToUse,
        userSearchQuery
      );
      const cachedMessages = getCachedBranchEmails(userSearchQuery);
      const mergedFallback = [...cachedMessages];
      const seenIds = new Set(mergedFallback.map((m) => m.messageId));
      for (const dm of driveFallbackMessages) {
        if (!seenIds.has(dm.messageId)) {
          seenIds.add(dm.messageId);
          mergedFallback.push(dm);
        }
      }
      if (mergedFallback.length > 0) {
        return mergedFallback;
      }

      if (isInsufficientScope) {
        const scopeErr: any = new Error(
          'Gmail read permission is required to view emailed branch spreadsheets. Click "Authorize Gmail" to grant access.'
        );
        scopeErr.isInsufficientScope = true;
        throw scopeErr;
      }

      if (
        lowerErr.includes('accessnotconfigured') ||
        lowerErr.includes('has not been used in project') ||
        lowerErr.includes('gmail api has not been used')
      ) {
        const urlMatch = errText.match(/https:\/\/[^\s"'<>]+/);
        const apiErr: any = new Error(
          'The Gmail API needs to be enabled in your Google Cloud project to read branch emails.'
        );
        apiErr.enableUrl =
          urlMatch?.[0] ||
          'https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=412785347562';
        throw apiErr;
      }

      throw parseGoogleApiError(listRes.status, errText, 'Drive', tokenToUse);
    }
  } else if (!listRes.ok) {
    const errText = await listRes.text();
    const driveFallbackMessages = await discoverBranchSpreadsheetsFromDrive(
      tokenToUse,
      userSearchQuery
    );
    if (driveFallbackMessages.length > 0) {
      return driveFallbackMessages;
    }
    throw parseGoogleApiError(listRes.status, errText, 'Drive', tokenToUse);
  }

  const listData: any = await listRes.json();
  const messageRefs: Array<{ id: string; threadId: string }> = listData.messages || [];
  if (messageRefs.length === 0) {
    const driveFallbackMessages = await discoverBranchSpreadsheetsFromDrive(
      tokenToUse,
      userSearchQuery
    );
    return driveFallbackMessages;
  }

  const detailResults = await Promise.allSettled(
    messageRefs.slice(0, 20).map(async (ref) => {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=full`;
      const msgRes = await fetchWithRetry(msgUrl, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      });
      if (!msgRes.ok) return null;
      const msgData: any = await msgRes.json();

      const headers: Array<{ name: string; value: string }> = msgData.payload?.headers || [];
      const getHeader = (name: string): string => {
        const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
        return found?.value || '';
      };

      const subject = getHeader('Subject') || '(No Subject)';
      const rawFrom = getHeader('From');
      const rawDate = getHeader('Date');
      const { fromName, fromEmail } = parseFromHeader(rawFrom);
      const internalDateMs = Number(msgData.internalDate) || Date.parse(rawDate) || Date.now();

      const attachments: EmailSpreadsheetAttachment[] = [];
      const sharedSheetLinks: EmailSharedSheetLink[] = [];
      extractAttachmentsAndLinksFromPayload(
        msgData.payload,
        attachments,
        sharedSheetLinks,
        new Set<string>(),
        new Set<string>()
      );

      if (attachments.length === 0 && sharedSheetLinks.length === 0) {
        return null;
      }

      const item: BranchEmailSpreadsheetMessage = {
        messageId: msgData.id || ref.id,
        threadId: msgData.threadId || ref.threadId,
        subject,
        fromName,
        fromEmail,
        date: new Date(internalDateMs).toISOString(),
        timestamp: internalDateMs,
        snippet: String(msgData.snippet || '').trim(),
        attachments,
        sharedSheetLinks,
      };
      return item;
    })
  );

  const messages: BranchEmailSpreadsheetMessage[] = [];
  for (const r of detailResults) {
    if (r.status === 'fulfilled' && r.value) {
      messages.push(r.value);
    }
  }

  messages.sort((a, b) => b.timestamp - a.timestamp);

  if (!trimmedSearch && messages.length > 0) {
    saveCachedBranchEmails(messages);
  }

  return messages;
}

/**
 * Downloads an emailed spreadsheet attachment (.xlsx, .xls, .csv, .ods) from Gmail (or Drive fallback)
 * and uploads + converts it into a Google Sheets compatible spreadsheet in Google Drive.
 */
export async function convertEmailAttachmentToGoogleSheet(params: {
  accessToken: string;
  messageId: string;
  attachment: EmailSpreadsheetAttachment;
  customTitle?: string;
}): Promise<DriveSpreadsheetFile & { webViewLink?: string }> {
  const { accessToken, messageId, attachment, customTitle } = params;
  let tokenToUse =
    (await resolveValidOAuthToken(accessToken, { allowPopup: false })) ||
    getStoredOAuthToken() ||
    accessToken;

  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) {
    throw new Error('Google OAuth access token is required to convert email attachments.');
  }

  // If this attachment came from Drive-backed branch spreadsheet discovery ("drive_file:<id>"),
  // convert it directly in Drive without needing Gmail API!
  if (attachment.attachmentId.startsWith('drive_file:')) {
    const driveFileId = attachment.attachmentId.slice('drive_file:'.length).trim();
    const converted = await convertDriveExcelFileToGoogleSheet(tokenToUse, {
      id: driveFileId,
      name: customTitle || attachment.filename,
      mimeType: attachment.mimeType,
    });
    saveConvertedEmailSheetRecord({
      key: `${messageId}:${attachment.filename}`,
      spreadsheetId: converted.id,
      spreadsheetName: converted.name,
      webViewLink:
        converted.webViewLink || `https://docs.google.com/spreadsheets/d/${converted.id}/edit`,
      convertedAt: new Date().toISOString(),
    });
    return converted;
  }

  // 1. Fetch attachment binary data from Gmail API
  const attUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
    messageId
  )}/attachments/${encodeURIComponent(attachment.attachmentId)}`;

  let attRes = await fetchWithRetry(attUrl, {
    headers: { Authorization: `Bearer ${tokenToUse}` },
  });

  if (!attRes.ok && attRes.status === 403) {
    markTokenMissingGmailScope(tokenToUse);
    try {
      const freshToken = await refreshGoogleAccessToken(undefined, true);
      if (freshToken && isGoogleOAuthAccessToken(freshToken)) {
        tokenToUse = freshToken;
        attRes = await fetchWithRetry(attUrl, {
          headers: { Authorization: `Bearer ${tokenToUse}` },
        });
      }
    } catch {}
  }

  if (!attRes.ok) {
    const errText = await attRes.text();
    throw new Error(`Failed to download email attachment "${attachment.filename}": ${errText}`);
  }

  const attData: any = await attRes.json();
  if (!attData?.data) {
    throw new Error(`Attachment "${attachment.filename}" returned empty content from Gmail.`);
  }

  const binaryBytes = decodeBase64UrlToUint8Array(attData.data);

  // 2. Clean target Google Sheet title (strip .xlsx/.xls/.csv extension)
  const cleanTitle = (
    customTitle ||
    attachment.filename.replace(/\.(xlsx|xls|csv|ods|xlsm|xlsb)$/i, '') ||
    'Branch Spreadsheet'
  ).trim();

  // Determine source MIME type for Drive conversion
  const lowerFilename = attachment.filename.toLowerCase();
  let sourceMime = attachment.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lowerFilename.endsWith('.csv')) {
    sourceMime = 'text/csv';
  } else if (lowerFilename.endsWith('.xls')) {
    sourceMime = 'application/vnd.ms-excel';
  } else if (lowerFilename.endsWith('.ods')) {
    sourceMime = 'application/vnd.oasis.opendocument.spreadsheet';
  } else if (lowerFilename.endsWith('.xlsx') || lowerFilename.endsWith('.xlsm')) {
    sourceMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  // 3. Build Multipart Related body for Google Drive v3 Upload + Conversion to Google Sheets
  const boundary = `-------icd_sheet_convert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = {
    name: cleanTitle,
    mimeType: 'application/vnd.google-apps.spreadsheet',
  };

  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata
    )}\r\n--${boundary}\r\nContent-Type: ${sourceMime}\r\n\r\n`
  );
  const epilogue = encoder.encode(`\r\n--${boundary}--`);

  const multipartBody = new Uint8Array(preamble.length + binaryBytes.length + epilogue.length);
  multipartBody.set(preamble, 0);
  multipartBody.set(binaryBytes, preamble.length);
  multipartBody.set(epilogue, preamble.length + binaryBytes.length);

  const uploadUrl =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,webViewLink';

  const uploadRes = await fetchWithRetry(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenToUse}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw parseGoogleApiError(uploadRes.status, errText, 'Drive', tokenToUse);
  }

  const createdFile: any = await uploadRes.json();
  const webViewLink =
    createdFile.webViewLink || `https://docs.google.com/spreadsheets/d/${createdFile.id}/edit`;

  // Save conversion record so the UI remembers this attachment is already converted
  saveConvertedEmailSheetRecord({
    key: `${messageId}:${attachment.filename}`,
    spreadsheetId: createdFile.id,
    spreadsheetName: createdFile.name || cleanTitle,
    webViewLink,
    convertedAt: new Date().toISOString(),
  });

  return {
    id: createdFile.id,
    name: createdFile.name || cleanTitle,
    mimeType: createdFile.mimeType || 'application/vnd.google-apps.spreadsheet',
    modifiedTime: createdFile.modifiedTime || new Date().toISOString(),
    owner: 'Converted from Email',
    webViewLink,
  };
}

/**
 * Converts an existing Excel/CSV file stored in Google Drive into a native Google Sheets spreadsheet
 * so the Google Sheets v4 API can read and generate countsheets from it directly.
 */
export async function convertDriveExcelFileToGoogleSheet(
  accessToken: string,
  file: DriveSpreadsheetFile
): Promise<DriveSpreadsheetFile & { webViewLink?: string }> {
  const tokenToUse =
    (await resolveValidOAuthToken(accessToken, { allowPopup: false })) ||
    getStoredOAuthToken() ||
    accessToken;

  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) {
    throw new Error('Google OAuth access token is required to convert Excel file to Google Sheets.');
  }

  const cleanTitle = (file.name || 'Branch Spreadsheet')
    .replace(/\.(xlsx|xls|csv|ods|xlsm|xlsb)$/i, '')
    .trim();

  const copyUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    file.id
  )}/copy?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,webViewLink`;

  const copyRes = await fetchWithRetry(copyUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenToUse}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: cleanTitle,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    }),
  });

  if (!copyRes.ok) {
    const errText = await copyRes.text();
    throw parseGoogleApiError(copyRes.status, errText, 'Drive', tokenToUse);
  }

  const copied: any = await copyRes.json();
  return {
    id: copied.id,
    name: copied.name || cleanTitle,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedTime: copied.modifiedTime || new Date().toISOString(),
    owner: 'Converted to Google Sheets',
    webViewLink: copied.webViewLink || `https://docs.google.com/spreadsheets/d/${copied.id}/edit`,
  };
}
