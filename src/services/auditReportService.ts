import { DriveSpreadsheetFile, parseGoogleApiError, fetchWithRetry, GoogleApiError, getDemoInventoryItems } from './googleSheets';
import { auth, isGoogleOAuthAccessToken, getStoredOAuthToken, getRememberedUser, subscribeToTokenChanges, resolveValidOAuthToken } from './auth';
import { onAuthStateChanged } from 'firebase/auth';

let activeAuditUserEmailOverride: string | null = null;

export function getActiveUserEmail(): string {
  try {
    if (activeAuditUserEmailOverride && activeAuditUserEmailOverride.trim()) {
      return activeAuditUserEmailOverride.trim().toLowerCase();
    }
    const email = auth.currentUser?.email || getRememberedUser()?.email;
    if (email && email.trim()) {
      return email.trim().toLowerCase();
    }
  } catch {}
  return '';
}

export function getUserStorageScopeKey(): string {
  const email = getActiveUserEmail();
  if (email) {
    return email.replace(/[^a-z0-9@._-]/gi, '_');
  }
  try {
    if (auth.currentUser?.uid) {
      return auth.currentUser.uid;
    }
  } catch {}
  return 'guest_auditor';
}

function getUserFirestoreKey(): string | null {
  try {
    const email = getActiveUserEmail();
    if (email) {
      return email.replace(/[^a-zA-Z0-9-_]/g, '_');
    }
    if (auth.currentUser?.uid) {
      return auth.currentUser.uid;
    }
  } catch {}
  return 'default_auditor';
}

const DRIVE_SYNC_FILENAME = 'inventory-hub-cloud-recents.json';
const driveSyncFileIdByScope = new Map<string, string>();
const driveFileOwnershipCache = new Map<string, boolean>();
let lastCountsheetMutationAt = 0;
let lastAuditReportMutationAt = 0;

function getDeletedCountsheetsStorageKey(): string {
  return `audit_deleted_countsheet_ids_v2_${getUserStorageScopeKey()}`;
}
function getDeletedReportsStorageKey(): string {
  return `audit_deleted_audit_report_ids_v2_${getUserStorageScopeKey()}`;
}
function getRestoredCountsheetsStorageKey(): string {
  return `audit_restored_countsheet_ids_v2_${getUserStorageScopeKey()}`;
}
function getRestoredReportsStorageKey(): string {
  return `audit_restored_audit_report_ids_v2_${getUserStorageScopeKey()}`;
}

function getRestoredStorageKey(deletedKey: string): string {
  return deletedKey.startsWith('audit_deleted_countsheet_ids')
    ? getRestoredCountsheetsStorageKey()
    : getRestoredReportsStorageKey();
}

function getDeletedIds(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.length > 0));
    }
  } catch {}
  return new Set();
}

function addDeletedIds(
  storageKey: string,
  ids: (string | undefined | null)[],
  fromCloudSync = false
): Set<string> {
  const current = getDeletedIds(storageKey);
  const restoredKey = getRestoredStorageKey(storageKey);
  const restoredSet = getDeletedIds(restoredKey);
  let restoredChanged = false;

  ids.forEach((id) => {
    if (id && typeof id === 'string') {
      // If coming from cloud sync, never re-delete an ID the user explicitly restored!
      if (fromCloudSync && restoredSet.has(id)) {
        return;
      }
      current.add(id);
      if (!fromCloudSync && restoredSet.has(id)) {
        restoredSet.delete(id);
        restoredChanged = true;
      }
    }
  });
  try {
    const arr = Array.from(current).slice(-500);
    localStorage.setItem(storageKey, JSON.stringify(arr));
    if (restoredChanged) {
      localStorage.setItem(restoredKey, JSON.stringify(Array.from(restoredSet).slice(-500)));
    }
  } catch {}
  return current;
}

function removeDeletedIds(storageKey: string, ids: (string | undefined | null)[]): void {
  const current = getDeletedIds(storageKey);
  const restoredKey = getRestoredStorageKey(storageKey);
  const restoredSet = getDeletedIds(restoredKey);
  let changed = false;
  let restoredChanged = false;
  ids.forEach((id) => {
    if (id && typeof id === 'string') {
      if (current.has(id)) {
        current.delete(id);
        changed = true;
      }
      if (!restoredSet.has(id)) {
        restoredSet.add(id);
        restoredChanged = true;
      }
    }
  });
  try {
    if (changed) {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(current)));
    }
    if (restoredChanged) {
      localStorage.setItem(restoredKey, JSON.stringify(Array.from(restoredSet).slice(-500)));
    }
  } catch {}
}

interface DriveCloudRecentsPayload {
  updatedAt: string;
  ownerEmail?: string;
  recentAuditReports: RecentAuditReport[];
  recentCountsheets: RecentCountsheetSession[];
  deletedAuditReportIds?: string[];
  deletedCountsheetIds?: string[];
}

async function verifySpreadsheetOwnedByActiveUser(
  token: string,
  spreadsheetId: string | undefined,
  activeEmail: string
): Promise<boolean> {
  if (!spreadsheetId || !activeEmail) return false;
  const cacheKey = `${activeEmail}:${spreadsheetId}`;
  if (driveFileOwnershipCache.has(cacheKey)) {
    return driveFileOwnershipCache.get(cacheKey)!;
  }
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        spreadsheetId
      )}?fields=ownedByMe,owners(emailAddress),trashed&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      driveFileOwnershipCache.set(cacheKey, false);
      return false;
    }
    const data = await res.json();
    if (data?.trashed) {
      driveFileOwnershipCache.set(cacheKey, false);
      return false;
    }
    const owners: Array<{ emailAddress?: string }> = Array.isArray(data?.owners) ? data.owners : [];
    const matchesOwnerEmail = owners.some(
      (o) => o?.emailAddress && o.emailAddress.trim().toLowerCase() === activeEmail
    );
    const isOwned = Boolean(data?.ownedByMe || matchesOwnerEmail);
    driveFileOwnershipCache.set(cacheKey, isOwned);
    return isOwned;
  } catch {
    return false;
  }
}

async function findDriveSyncFileId(token: string): Promise<string | null> {
  const scopeKey = getUserStorageScopeKey();
  const cachedId = driveSyncFileIdByScope.get(scopeKey);
  if (cachedId) return cachedId;
  try {
    const q = encodeURIComponent(`name = '${DRIVE_SYNC_FILENAME}' and 'me' in owners and trashed = false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=10&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const files: Array<{ id: string }> = Array.isArray(data?.files) ? data.files : [];
    const fileId = files[0]?.id || null;
    if (fileId) driveSyncFileIdByScope.set(scopeKey, fileId);

    // Clean up any duplicate sync files in the background so old copies never resurrect deleted items
    if (files.length > 1) {
      for (let i = 1; i < files.length; i++) {
        const dupId = files[i]?.id;
        if (dupId) {
          fetch(`https://www.googleapis.com/drive/v3/files/${dupId}?supportsAllDrives=true`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      }
    }
    return fileId;
  } catch {
    return null;
  }
}

async function readRecentsFromGoogleDrive(): Promise<DriveCloudRecentsPayload | null> {
  const token = getStoredOAuthToken();
  const activeEmail = getActiveUserEmail();
  if (!token || !isGoogleOAuthAccessToken(token) || !activeEmail) return null;
  const scopeKey = getUserStorageScopeKey();
  try {
    const fileId = await findDriveSyncFileId(token);
    if (!fileId) return null;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      if (res.status === 404) driveSyncFileIdByScope.delete(scopeKey);
      return null;
    }
    const parsed = await res.json();
    if (parsed && typeof parsed === 'object') {
      const rawReports: RecentAuditReport[] = Array.isArray(parsed.recentAuditReports)
        ? parsed.recentAuditReports
        : [];
      const rawCountsheets: RecentCountsheetSession[] = Array.isArray(parsed.recentCountsheets)
        ? parsed.recentCountsheets
        : [];

      const verifiedReports: RecentAuditReport[] = [];
      for (const r of rawReports) {
        if (!r) continue;
        const itemOwner = r.ownerEmail?.trim().toLowerCase();
        if (itemOwner) {
          if (itemOwner === activeEmail) verifiedReports.push(r);
        } else {
          const isMine = await verifySpreadsheetOwnedByActiveUser(token, r.spreadsheetId, activeEmail);
          if (isMine) {
            verifiedReports.push({ ...r, ownerEmail: activeEmail });
          }
        }
      }

      const verifiedCountsheets: RecentCountsheetSession[] = [];
      for (const s of rawCountsheets) {
        if (!s) continue;
        const itemOwner = s.ownerEmail?.trim().toLowerCase();
        if (itemOwner) {
          if (itemOwner === activeEmail) verifiedCountsheets.push(s);
        } else {
          const isMine = await verifySpreadsheetOwnedByActiveUser(token, s.spreadsheetId, activeEmail);
          if (isMine) {
            verifiedCountsheets.push({ ...s, ownerEmail: activeEmail });
          }
        }
      }

      return {
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        ownerEmail: activeEmail,
        recentAuditReports: verifiedReports,
        recentCountsheets: verifiedCountsheets,
        deletedAuditReportIds: Array.isArray(parsed.deletedAuditReportIds) ? parsed.deletedAuditReportIds : [],
        deletedCountsheetIds: Array.isArray(parsed.deletedCountsheetIds) ? parsed.deletedCountsheetIds : [],
      };
    }
  } catch {}
  return null;
}

async function writeRecentsToGoogleDrive(
  reports?: RecentAuditReport[],
  countsheets?: RecentCountsheetSession[]
): Promise<void> {
  const token = getStoredOAuthToken();
  const activeEmail = getActiveUserEmail();
  if (!token || !isGoogleOAuthAccessToken(token) || !activeEmail) return;
  const scopeKey = getUserStorageScopeKey();
  try {
    const payload: DriveCloudRecentsPayload = {
      updatedAt: new Date().toISOString(),
      ownerEmail: activeEmail,
      recentAuditReports: (reports ?? getRecentAuditReportsLocal()).map((r) => ({
        ...r,
        ownerEmail: r.ownerEmail || activeEmail,
      })),
      recentCountsheets: (countsheets ?? getRecentCountsheetsLocal()).map((s) => ({
        ...s,
        ownerEmail: s.ownerEmail || activeEmail,
      })),
      deletedAuditReportIds: Array.from(getDeletedIds(getDeletedReportsStorageKey())),
      deletedCountsheetIds: Array.from(getDeletedIds(getDeletedCountsheetsStorageKey())),
    };

    const existingFileId = await findDriveSyncFileId(token);
    if (existingFileId) {
      const updateRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media&supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );
      if (updateRes.ok) return;
      if (updateRes.status === 404) driveSyncFileIdByScope.delete(scopeKey);
    }

    // Create new sync file in user's Google Drive using multipart upload
    const boundary = 'inv_hub_sync_boundary';
    const metadata = {
      name: DRIVE_SYNC_FILENAME,
      mimeType: 'application/json',
      description: 'Inventory Hub Cross-Device Recent Audit Reports & Countsheets Sync',
    };
    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify(payload)}\r\n` +
      `--${boundary}--`;

    const createRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );
    if (createRes.ok) {
      const created = await createRes.json();
      if (created?.id) driveSyncFileIdByScope.set(scopeKey, created.id);
    }
  } catch {}
}

type AuditReportsListener = (reports: RecentAuditReport[]) => void;
const auditReportsListeners = new Set<AuditReportsListener>();

export function subscribeToRecentAuditReports(listener: AuditReportsListener): () => void {
  auditReportsListeners.add(listener);
  return () => {
    auditReportsListeners.delete(listener);
  };
}

function notifyAuditReportsListeners(reports: RecentAuditReport[]) {
  auditReportsListeners.forEach((l) => {
    try {
      l(reports);
    } catch {}
  });
}

export function setActiveAuditUserEmail(email: string | null | undefined): void {
  const cleaned = email ? email.trim().toLowerCase() : null;
  if (activeAuditUserEmailOverride === cleaned) return;
  activeAuditUserEmailOverride = cleaned;

  notifyAuditReportsListeners(getRecentAuditReportsLocal());
  notifyCountsheetsListeners(getRecentCountsheetsLocal());
  trashListeners.forEach((listener) => {
    try {
      listener(getTrashItems());
    } catch {}
  });

  if (cleaned) {
    syncRecentAuditReportsFromCloud().catch(() => {});
    syncRecentCountsheetsFromCloud().catch(() => {});
  }
}

// Automatically sync when user signs in, auth state changes, or OAuth token refreshes
try {
  onAuthStateChanged(auth, (user) => {
    if (user?.email) {
      activeAuditUserEmailOverride = user.email.trim().toLowerCase();
    }
    notifyAuditReportsListeners(getRecentAuditReportsLocal());
    notifyCountsheetsListeners(getRecentCountsheetsLocal());
    if (user) {
      syncRecentAuditReportsFromCloud().catch(() => {});
      syncRecentCountsheetsFromCloud().catch(() => {});
    }
  });
  subscribeToTokenChanges((newToken) => {
    if (newToken && isGoogleOAuthAccessToken(newToken)) {
      syncRecentAuditReportsFromCloud().catch(() => {});
      syncRecentCountsheetsFromCloud().catch(() => {});
    }
  });
} catch {}

export interface RecentAuditReport {
  id: string;
  spreadsheetId: string;
  spreadsheetName: string;
  totalRows: number;
  webViewLink: string;
  createdAt: string;
  ownerEmail?: string;
  iatdTitle?: string;
  templateTitle?: string;
  countsheetCount?: number;
  iatdSpreadsheetId?: string;
  iatdTabName?: string;
  iatdHeaderRow?: number;
  templateSpreadsheetId?: string;
  templateHeaderRow?: number;
  folderName?: string;
  folderWebViewLink?: string;
}

function getRecentsStorageKey(): string {
  return `countsheet_recent_audit_reports_v2_${getUserStorageScopeKey()}`;
}

export async function syncRecentAuditReportsFromCloud(): Promise<RecentAuditReport[]> {
  const activeEmail = getActiveUserEmail();
  if (!activeEmail) {
    notifyAuditReportsListeners([]);
    return [];
  }
  const local = getRecentAuditReportsLocal();
  let serverReports: RecentAuditReport[] = [];

  // 1. Fetch from Server API scoped to active user email
  try {
    const res = await fetch(`/api/recent-audit-reports?email=${encodeURIComponent(activeEmail)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        serverReports = data.filter(
          (r) => r && r.ownerEmail && r.ownerEmail.trim().toLowerCase() === activeEmail
        );
      }
    }
  } catch {}

  // 2. Fetch from Google Drive Cloud Sync file
  let driveReports: RecentAuditReport[] = [];
  let driveHadUnverifiedItems = false;
  try {
    const drivePayload = await readRecentsFromGoogleDrive();
    if (drivePayload?.deletedAuditReportIds?.length) {
      const localActiveIds = new Set<string>();
      local.forEach((r) => {
        if (r?.id) localActiveIds.add(r.id);
        if (r?.spreadsheetId) localActiveIds.add(r.spreadsheetId);
      });
      const safeToTombstone = drivePayload.deletedAuditReportIds.filter(
        (id) => !localActiveIds.has(id)
      );
      addDeletedIds(getDeletedReportsStorageKey(), safeToTombstone, true);
    }
    if (drivePayload?.recentAuditReports) {
      driveReports = drivePayload.recentAuditReports;
    }
  } catch {}

  const deletedIds = getDeletedIds(getDeletedReportsStorageKey());
  let remoteHadDeleted = false;

  // Purge any deleted items still lingering in Server
  serverReports.forEach((r) => {
    if (r && (deletedIds.has(r.id) || deletedIds.has(r.spreadsheetId))) {
      remoteHadDeleted = true;
      fetch(`/api/recent-audit-reports/${encodeURIComponent(r.id)}`, { method: 'DELETE' }).catch(() => {});
    }
  });
  driveReports.forEach((r) => {
    if (r && (deletedIds.has(r.id) || deletedIds.has(r.spreadsheetId))) {
      remoteHadDeleted = true;
    }
  });

  // Merge all sources (deduplicated by both spreadsheetId and id, excluding deleted IDs and other emails)
  const seenIds = new Set<string>();
  const seenSpreadsheetIds = new Set<string>();
  const map = new Map<string, RecentAuditReport>();
  [...serverReports, ...driveReports, ...local].forEach((r) => {
    if (!r || (!r.spreadsheetId && !r.id)) return;
    if (r.ownerEmail && r.ownerEmail.trim().toLowerCase() !== activeEmail) {
      driveHadUnverifiedItems = true;
      return;
    }
    if (deletedIds.has(r.id) || (r.spreadsheetId && deletedIds.has(r.spreadsheetId))) return;
    if (r.id && seenIds.has(r.id)) return;
    if (r.spreadsheetId && seenSpreadsheetIds.has(r.spreadsheetId)) return;
    if (r.id) seenIds.add(r.id);
    if (r.spreadsheetId) seenSpreadsheetIds.add(r.spreadsheetId);

    const key = r.id || r.spreadsheetId;
    map.set(key, { ...r, ownerEmail: activeEmail });
  });

  const merged = Array.from(map.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);

  try {
    localStorage.setItem(getRecentsStorageKey(), JSON.stringify(merged));
  } catch {}

  notifyAuditReportsListeners(merged);

  // Backfill any local-only items up to Server and Google Drive so other devices see them
  const serverIds = new Set(serverReports.map((r) => r.spreadsheetId || r.id));
  for (const item of merged) {
    const key = item.spreadsheetId || item.id;
    if (!serverIds.has(key)) {
      fetch('/api/recent-audit-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, ownerEmail: activeEmail }),
      }).catch(() => {});
    }
  }

  if (merged.length !== driveReports.length || remoteHadDeleted || driveHadUnverifiedItems) {
    writeRecentsToGoogleDrive(merged, undefined).catch(() => {});
  }

  return merged;
}

export function getRecentAuditReportsLocal(): RecentAuditReport[] {
  try {
    const activeEmail = getActiveUserEmail();
    if (!activeEmail) return [];
    const raw = localStorage.getItem(getRecentsStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const deletedIds = getDeletedIds(getDeletedReportsStorageKey());
      const seenIds = new Set<string>();
      const seenSpreadsheetIds = new Set<string>();
      return parsed.filter((r) => {
        if (!r || deletedIds.has(r.id) || (r.spreadsheetId && deletedIds.has(r.spreadsheetId))) return false;
        if (r.ownerEmail && r.ownerEmail.trim().toLowerCase() !== activeEmail) return false;
        if (r.id && seenIds.has(r.id)) return false;
        if (r.spreadsheetId && seenSpreadsheetIds.has(r.spreadsheetId)) return false;
        if (r.id) seenIds.add(r.id);
        if (r.spreadsheetId) seenSpreadsheetIds.add(r.spreadsheetId);
        return true;
      });
    }
    return [];
  } catch (e) {
    console.warn('Failed to load recent audit reports from localStorage:', e);
    return [];
  }
}

export function getRecentAuditReports(): RecentAuditReport[] {
  setTimeout(() => {
    syncRecentAuditReportsFromCloud().catch(() => {});
  }, 50);
  return getRecentAuditReportsLocal();
}

export async function saveRecentAuditReport(
  report: Omit<RecentAuditReport, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
): Promise<RecentAuditReport> {
  lastAuditReportMutationAt = Date.now();
  const activeEmail = getActiveUserEmail();
  const current = getRecentAuditReportsLocal();
  const newReport: RecentAuditReport = {
    id: report.id || `report_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    spreadsheetId: report.spreadsheetId,
    spreadsheetName: report.spreadsheetName,
    totalRows: report.totalRows,
    webViewLink: report.webViewLink,
    createdAt: report.createdAt || new Date().toISOString(),
    ownerEmail: activeEmail || report.ownerEmail,
    iatdTitle: report.iatdTitle || '',
    templateTitle: report.templateTitle || '',
    countsheetCount: report.countsheetCount,
    iatdSpreadsheetId: report.iatdSpreadsheetId,
    iatdTabName: report.iatdTabName,
    iatdHeaderRow: report.iatdHeaderRow,
    templateSpreadsheetId: report.templateSpreadsheetId,
    templateHeaderRow: report.templateHeaderRow,
    folderName: report.folderName,
    folderWebViewLink: report.folderWebViewLink,
  };

  removeDeletedIds(getDeletedReportsStorageKey(), [newReport.id, newReport.spreadsheetId]);

  const filtered = current.filter((r) => {
    if (!r) return false;
    if (r.id === newReport.id) return false;
    if (newReport.spreadsheetId && r.spreadsheetId === newReport.spreadsheetId) return false;
    return true;
  });
  const updated = [newReport, ...filtered].slice(0, 30);

  try {
    localStorage.setItem(getRecentsStorageKey(), JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to save recent audit report to localStorage:', e);
  }

  notifyAuditReportsListeners(updated);

  // 1. Save to Server SQLite API (non-blocking)
  fetch('/api/recent-audit-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newReport),
  }).catch(() => {});

  // 2. Save to Google Drive Cloud Sync file
  writeRecentsToGoogleDrive(updated, undefined).catch(() => {});

  return newReport;
}

export function deleteRecentAuditReport(id: string): RecentAuditReport[] {
  lastAuditReportMutationAt = Date.now();
  const current = getRecentAuditReportsLocal();
  const target = current.find((r) => r.id === id || r.spreadsheetId === id);
  addDeletedIds(getDeletedReportsStorageKey(), [id, target?.id, target?.spreadsheetId]);

  const updated = current.filter((r) => r.id !== id && r.spreadsheetId !== id);
  if (target) {
    moveToTrash([{ item: target, type: 'audit_report' }]);
  }
  try {
    localStorage.setItem(getRecentsStorageKey(), JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to delete recent audit report from localStorage:', e);
  }

  notifyAuditReportsListeners(updated);

  // 1. Delete from Server API
  try {
    fetch(`/api/recent-audit-reports/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    if (target && target.id !== id) {
      fetch(`/api/recent-audit-reports/${encodeURIComponent(target.id)}`, { method: 'DELETE' }).catch(() => {});
    }
    if (target && target.spreadsheetId && target.spreadsheetId !== id) {
      fetch(`/api/recent-audit-reports/${encodeURIComponent(target.spreadsheetId)}`, { method: 'DELETE' }).catch(() => {});
    }
  } catch {}

  // 2. Update Google Drive Cloud Sync file
  writeRecentsToGoogleDrive(updated, undefined).catch(() => {});

  return updated;
}

export function clearRecentAuditReports(): void {
  lastAuditReportMutationAt = Date.now();
  const current = getRecentAuditReportsLocal();
  const idsToMark: string[] = [];
  current.forEach((item) => {
    if (item.id) idsToMark.push(item.id);
    if (item.spreadsheetId) idsToMark.push(item.spreadsheetId);
  });
  addDeletedIds(getDeletedReportsStorageKey(), idsToMark);

  if (current.length > 0) {
    moveToTrash(current.map((item) => ({ item, type: 'audit_report' })));
  }

  try {
    localStorage.removeItem(getRecentsStorageKey());
  } catch (e) {
    console.warn('Failed to clear recent audit reports from localStorage:', e);
  }
  notifyAuditReportsListeners([]);

  for (const item of current) {
    fetch(`/api/recent-audit-reports/${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => {});
  }
  writeRecentsToGoogleDrive([], undefined).catch(() => {});
}

export interface SheetTabInfo {
  sheetId: number;
  title: string;
  rowCount?: number;
  columnCount?: number;
}

export interface SheetHeaderInspection {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetTitle: string;
  detectedHeaderRow: number; // 1-indexed (e.g. 1)
  headers: string[];
  totalRows: number;
  sampleRows: any[][];
}

export interface ColumnMappingEntry {
  encodingHeader: string;
  encodingColIndex: number;
  mappedIatdHeader: string | null; // null if unmapped
  isAutoMatched: boolean;
  samplePreview: string | null;
}

// Convert 0-indexed column number to Excel column letters (0 -> A, 14 -> O, 26 -> AA)
export function numberToColumnLetter(colIndex: number): string {
  let letter = '';
  let temp = colIndex + 1;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

// Extract Google Spreadsheet ID from URL or raw ID string (handles /u/0/d/, /d/e/, ?usp=sharing, #gid, etc.)
export function extractSpreadsheetId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  // 1. Match /spreadsheets/.../d/ID or /drive/.../d/ID or /d/ID or /d/e/ID
  const dMatch = trimmed.match(/\/d\/(?:e\/)?([a-zA-Z0-9-_]{15,})/);
  if (dMatch && dMatch[1]) {
    return dMatch[1];
  }
  // 2. If user pasted partial URL or ID with path segments or query parameters
  const parts = trimmed.split(/[/\\?#]/);
  for (const part of parts) {
    if (/^[a-zA-Z0-9-_]{20,}$/.test(part)) {
      return part;
    }
  }
  return parts[0] || trimmed;
}

const CONVERTED_SHEETS_MAP_KEY = 'countsheet_converted_sheets_map';
const memoryConvertedSheetsMap = new Map<string, string>();

function getMappedSpreadsheetId(cleanId: string): string {
  if (!cleanId) return cleanId;
  if (memoryConvertedSheetsMap.has(cleanId)) {
    return memoryConvertedSheetsMap.get(cleanId)!;
  }
  try {
    const raw = localStorage.getItem(CONVERTED_SHEETS_MAP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed[cleanId] === 'string' && parsed[cleanId]) {
        memoryConvertedSheetsMap.set(cleanId, parsed[cleanId]);
        return parsed[cleanId];
      }
    }
  } catch {}
  return cleanId;
}

function saveMappedSpreadsheetId(sourceId: string, convertedSheetId: string) {
  if (!sourceId || !convertedSheetId) return;
  memoryConvertedSheetsMap.set(sourceId, convertedSheetId);
  try {
    const raw = localStorage.getItem(CONVERTED_SHEETS_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[sourceId] = convertedSheetId;
    localStorage.setItem(CONVERTED_SHEETS_MAP_KEY, JSON.stringify(parsed));
  } catch {}
}

function removeStaleCachedDriveFile(staleFileId: string) {
  if (!staleFileId) return;
  try {
    const raw = localStorage.getItem('countsheet_cached_drive_files');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((f: any) => f && f.id !== staleFileId);
      if (filtered.length !== parsed.length) {
        localStorage.setItem('countsheet_cached_drive_files', JSON.stringify(filtered));
      }
    }
  } catch {}
}

export const HUB_OWNER_EMAIL = 'icdhubsystems@gmail.com';
const HUB_TEMPLATES_STORAGE_KEY = 'countsheet_hub_templates_cache_v1';

export interface HubEncodingTemplateInfo {
  id: string;
  name: string;
  templateType: 'OVERALL COUNT TEMPLATE' | 'CESSATION OVERALL COUNT TEMPLATE' | string;
  folderPath: string;
  ownerEmail: string;
  webViewLink: string;
  modifiedTime?: string;
  tabs: SheetTabInfo[];
  detectedHeaderRow: number;
  sheetTitle: string;
  headers: string[];
  row1Values?: string[];
  row3Formulas?: string[];
  sampleRows: any[][];
  hasCachedXlsx?: boolean;
}

export interface HubCountsheetTemplateInfo {
  id: string;
  name: string;
  gid: string;
  folderPath: string;
  ownerEmail: string;
  webViewLink: string;
  modifiedTime?: string;
  spec?: CountsheetTemplateSpec;
  hasCachedXlsx?: boolean;
}

export const DEFAULT_HUB_ENCODING_HEADERS: string[] = [
  'Item Code',
  'Barcode',
  'Item Description',
  'Category',
  'SubCategory',
  'SubsubCategory',
  'Unit',
  'Cost',
  'Selling Price',
  'Beg. Qty',
  'In',
  'Out',
  'Balance',
  'Remarks',
  'CS01',
  'CS02',
  'CS03',
  'CS04',
  'CS05',
  'CS06',
  'CS07',
  'CS08',
  'CS09',
  'CS10',
  '',
  'Total Actual',
  'Variance Qty',
  'Unrecorded Sales / Shortages (Cost)',
  'Unrecorded Sales / Shortages (Selling)',
  'Overages (Cost)',
  'Overages (Selling)',
  'Net Variance (Cost)',
  'Net Variance (Selling)',
];

export const DEFAULT_HUB_ENCODING_ROW3_FORMULAS: string[] = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '=SUM(O3:X3)',
  '=Z3-M3',
  '=IF(AA3<0,ABS(AA3)*H3,0)',
  '=IF(AA3<0,ABS(AA3)*I3,0)',
  '=IF(AA3>0,AA3*H3,0)',
  '=IF(AA3>0,AA3*I3,0)',
  '=AA3*H3',
  '=AA3*I3',
];

const DEFAULT_HUB_ENCODING_TEMPLATES: HubEncodingTemplateInfo[] = [
  {
    id: 'hub-encoding-overall-count-template',
    name: 'OVERALL COUNT TEMPLATE',
    templateType: 'OVERALL COUNT TEMPLATE',
    folderPath: 'TEMPLATE/ENCODING',
    ownerEmail: HUB_OWNER_EMAIL,
    webViewLink: 'https://docs.google.com/spreadsheets/d/hub-encoding-overall-count-template/edit',
    tabs: [
      { sheetId: 0, title: 'ENCODING', rowCount: 1500, columnCount: 45 },
      { sheetId: 1, title: 'ANALYSIS', rowCount: 100, columnCount: 15 },
      { sheetId: 2, title: 'UNIDENTIFIED', rowCount: 200, columnCount: 15 },
      { sheetId: 3, title: 'MONITORING', rowCount: 50, columnCount: 20 },
    ],
    detectedHeaderRow: 2,
    sheetTitle: 'ENCODING',
    headers: DEFAULT_HUB_ENCODING_HEADERS,
    row3Formulas: DEFAULT_HUB_ENCODING_ROW3_FORMULAS,
    sampleRows: [],
  },
  {
    id: 'hub-encoding-cessation-overall-count-template',
    name: 'CESSATION OVERALL COUNT TEMPLATE',
    templateType: 'CESSATION OVERALL COUNT TEMPLATE',
    folderPath: 'TEMPLATE/ENCODING',
    ownerEmail: HUB_OWNER_EMAIL,
    webViewLink:
      'https://docs.google.com/spreadsheets/d/hub-encoding-cessation-overall-count-template/edit',
    tabs: [
      { sheetId: 0, title: 'ENCODING', rowCount: 1500, columnCount: 45 },
      { sheetId: 1, title: 'ANALYSIS', rowCount: 100, columnCount: 15 },
      { sheetId: 2, title: 'UNIDENTIFIED', rowCount: 200, columnCount: 15 },
      { sheetId: 3, title: 'MONITORING', rowCount: 50, columnCount: 20 },
    ],
    detectedHeaderRow: 2,
    sheetTitle: 'ENCODING',
    headers: DEFAULT_HUB_ENCODING_HEADERS,
    row3Formulas: DEFAULT_HUB_ENCODING_ROW3_FORMULAS,
    sampleRows: [],
  },
];

export const DEFAULT_HUB_COUNTSHEET_TEMPLATES: HubCountsheetTemplateInfo[] = [
  {
    id: '19eb2315c82841b7f2920f8e1a272f52095f1e72c',
    name: 'RANDOM INVENTORY COUNTSHEET TEMPLATE',
    gid: '1328306184',
    folderPath: 'TEMPLATE/COUNTSHEET',
    ownerEmail: HUB_OWNER_EMAIL,
    webViewLink:
      'https://docs.google.com/spreadsheets/d/19eb2315c82841b7f2920f8e1a272f52095f1e72c/edit?gid=1328306184#gid=1328306184',
  },
  {
    id: 'hub-countsheet-periodic-template',
    name: 'PERIODIC COUNTSHEET TEMPLATE',
    gid: '1328306184',
    folderPath: 'TEMPLATE/COUNTSHEET',
    ownerEmail: HUB_OWNER_EMAIL,
    webViewLink:
      'https://docs.google.com/spreadsheets/d/hub-countsheet-periodic-template/edit#gid=1328306184',
  },
];

let memoryHubEncodingTemplates: HubEncodingTemplateInfo[] = [...DEFAULT_HUB_ENCODING_TEMPLATES];
let memoryHubCountsheetTemplates: HubCountsheetTemplateInfo[] = [...DEFAULT_HUB_COUNTSHEET_TEMPLATES];

function ensureAllDefaultEncodingTemplates(
  list: HubEncodingTemplateInfo[]
): HubEncodingTemplateInfo[] {
  const result = [...list];
  const hasOverall = result.some(
    (t) =>
      t.templateType === 'OVERALL COUNT TEMPLATE' ||
      (!/cessation/i.test(t.name) && /overall\s*count/i.test(t.name))
  );
  const hasCessation = result.some(
    (t) => t.templateType === 'CESSATION OVERALL COUNT TEMPLATE' || /cessation/i.test(t.name)
  );
  for (const def of DEFAULT_HUB_ENCODING_TEMPLATES) {
    if (def.templateType === 'OVERALL COUNT TEMPLATE' && !hasOverall) {
      result.push(def);
    } else if (def.templateType === 'CESSATION OVERALL COUNT TEMPLATE' && !hasCessation) {
      result.push(def);
    }
  }
  return result;
}

function ensureAllDefaultCountsheetTemplates(
  list: HubCountsheetTemplateInfo[]
): HubCountsheetTemplateInfo[] {
  const result = [...list];
  const hasRandom = result.some((t) => /random/i.test(t.name));
  const hasPeriodic = result.some((t) => /periodic/i.test(t.name));
  for (const def of DEFAULT_HUB_COUNTSHEET_TEMPLATES) {
    if (/random/i.test(def.name) && !hasRandom) {
      result.push(def);
    } else if (/periodic/i.test(def.name) && !hasPeriodic) {
      result.push(def);
    }
  }
  return result;
}

export interface AdminDriveLinksConfig {
  formsLocationLink: string;
  inventoryTemplateLink: string;
  overallCountTemplateLink: string;
  updatedAt?: string;
}

export const ADMIN_DRIVE_LINKS_STORAGE_KEY = 'countsheet_admin_drive_links_v1';
export const ADMIN_DRIVE_LINKS_UPDATED_EVENT = 'countsheet_admin_drive_links_updated';

export function getAdminDriveLinksConfig(): AdminDriveLinksConfig {
  try {
    const raw = localStorage.getItem(ADMIN_DRIVE_LINKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          formsLocationLink: String(parsed.formsLocationLink || '').trim(),
          inventoryTemplateLink: String(parsed.inventoryTemplateLink || '').trim(),
          overallCountTemplateLink: String(parsed.overallCountTemplateLink || '').trim(),
          updatedAt: parsed.updatedAt,
        };
      }
    }
  } catch {}
  return {
    formsLocationLink: '',
    inventoryTemplateLink: '',
    overallCountTemplateLink: '',
  };
}

export function broadcastAdminDriveLinksUpdate(config?: AdminDriveLinksConfig): void {
  const detail = config || getAdminDriveLinksConfig();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ADMIN_DRIVE_LINKS_UPDATED_EVENT, { detail }));
  }
}

export function subscribeToAdminDriveLinks(
  callback: (config: AdminDriveLinksConfig) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const custom = e as CustomEvent<AdminDriveLinksConfig>;
    callback(custom.detail || getAdminDriveLinksConfig());
  };

  const storageHandler = (e: StorageEvent) => {
    if (e.key === ADMIN_DRIVE_LINKS_STORAGE_KEY) {
      callback(getAdminDriveLinksConfig());
    }
  };

  window.addEventListener(ADMIN_DRIVE_LINKS_UPDATED_EVENT, handler);
  window.addEventListener('storage', storageHandler);

  return () => {
    window.removeEventListener(ADMIN_DRIVE_LINKS_UPDATED_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function extractDriveResourceFromLink(rawLink?: string): {
  id: string;
  isFolder: boolean;
  gid?: string;
  webViewLink: string;
} | null {
  const raw = String(rawLink || '').trim();
  if (!raw) return null;

  const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  const sheetMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const fileMatch = raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const idParamMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const gidMatch = raw.match(/[#&?]gid=([0-9]+)/);

  let id = '';
  let isFolder = false;
  if (folderMatch) {
    id = folderMatch[1];
    isFolder = true;
  } else if (sheetMatch) {
    id = sheetMatch[1];
  } else if (fileMatch) {
    id = fileMatch[1];
  } else if (idParamMatch) {
    id = idParamMatch[1];
    isFolder = raw.includes('/folders');
  } else if (/^[a-zA-Z0-9_-]{15,}$/.test(raw)) {
    id = raw;
  }

  if (!id) return null;
  const gid = gidMatch ? gidMatch[1] : undefined;
  const webViewLink = raw.startsWith('http')
    ? raw
    : isFolder
    ? `https://drive.google.com/drive/folders/${id}`
    : `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? `#gid=${gid}` : ''}`;

  return { id, isFolder, gid, webViewLink };
}

function applyAdminCustomLinksToEncodingTemplates(
  list: HubEncodingTemplateInfo[]
): HubEncodingTemplateInfo[] {
  const result = ensureAllDefaultEncodingTemplates(list);
  const adminLinks = getAdminDriveLinksConfig();
  const parsedOverall = extractDriveResourceFromLink(adminLinks.overallCountTemplateLink);
  if (parsedOverall && !parsedOverall.isFolder) {
    const idx = result.findIndex(
      (t) =>
        t.templateType === 'OVERALL COUNT TEMPLATE' ||
        (!/cessation/i.test(t.name) && /overall\s*count/i.test(t.name))
    );
    const targetIdx = idx >= 0 ? idx : 0;
    if (result[targetIdx]) {
      result[targetIdx] = {
        ...result[targetIdx],
        id: parsedOverall.id,
        webViewLink: parsedOverall.webViewLink,
      };
    }
  }
  return result;
}

export async function listSpreadsheetsInDriveFolder(
  accessToken: string,
  folderId: string
): Promise<Array<{ id: string; name: string; webViewLink?: string; modifiedTime?: string }>> {
  if (!accessToken || !folderId) return [];
  try {
    const query = `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      query
    )}&fields=files(id,name,webViewLink,modifiedTime)&orderBy=modifiedTime desc&pageSize=30&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return Array.isArray(data.files) ? data.files : [];
  } catch {
    return [];
  }
}

function applyAdminCustomLinksToCountsheetTemplates(
  list: HubCountsheetTemplateInfo[]
): HubCountsheetTemplateInfo[] {
  const result = ensureAllDefaultCountsheetTemplates(list);
  const adminLinks = getAdminDriveLinksConfig();
  const parsedInv = extractDriveResourceFromLink(adminLinks.inventoryTemplateLink);
  if (parsedInv && !parsedInv.isFolder) {
    const idx = result.findIndex((t) => /random/i.test(t.name));
    const targetIdx = idx >= 0 ? idx : 0;
    const gid = parsedInv.gid || (result[targetIdx]?.gid ?? DEFAULT_COUNTSHEET_TEMPLATE_GID);
    if (result[targetIdx]) {
      result[targetIdx] = {
        ...result[targetIdx],
        id: parsedInv.id,
        gid,
        webViewLink: parsedInv.webViewLink,
      };
    }
  }
  return result;
}

export function getCachedHubEncodingTemplates(): HubEncodingTemplateInfo[] {
  try {
    const raw = localStorage.getItem(HUB_TEMPLATES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.encodingTemplates) && parsed.encodingTemplates.length > 0) {
        memoryHubEncodingTemplates = ensureAllDefaultEncodingTemplates(parsed.encodingTemplates);
      }
    }
  } catch {}
  const base =
    memoryHubEncodingTemplates.length > 0
      ? ensureAllDefaultEncodingTemplates(memoryHubEncodingTemplates)
      : DEFAULT_HUB_ENCODING_TEMPLATES;
  return applyAdminCustomLinksToEncodingTemplates(base);
}

export function getCachedHubCountsheetTemplates(): HubCountsheetTemplateInfo[] {
  try {
    const raw = localStorage.getItem(HUB_TEMPLATES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.countsheetTemplates) && parsed.countsheetTemplates.length > 0) {
        memoryHubCountsheetTemplates = ensureAllDefaultCountsheetTemplates(parsed.countsheetTemplates);
      }
    }
  } catch {}
  const base =
    memoryHubCountsheetTemplates.length > 0
      ? ensureAllDefaultCountsheetTemplates(memoryHubCountsheetTemplates)
      : DEFAULT_HUB_COUNTSHEET_TEMPLATES;
  return applyAdminCustomLinksToCountsheetTemplates(base);
}

export async function fetchHubTemplatesFromServer(): Promise<{
  ownerEmail: string;
  countsheetTemplates: HubCountsheetTemplateInfo[];
  encodingTemplates: HubEncodingTemplateInfo[];
  customLinks?: AdminDriveLinksConfig;
}> {
  try {
    const res = await fetch('/api/hub/templates');
    if (res.ok) {
      const data = await res.json();
      if (data?.customLinks && typeof data.customLinks === 'object') {
        const currentLocal = getAdminDriveLinksConfig();
        const serverHasTimestamp = Boolean(data.customLinks.updatedAt);
        const serverIsNewer =
          serverHasTimestamp &&
          (!currentLocal.updatedAt || data.customLinks.updatedAt >= currentLocal.updatedAt);

        const mergedLinks: AdminDriveLinksConfig = serverIsNewer
          ? {
              formsLocationLink: String(data.customLinks.formsLocationLink ?? currentLocal.formsLocationLink ?? '').trim(),
              inventoryTemplateLink: String(data.customLinks.inventoryTemplateLink ?? currentLocal.inventoryTemplateLink ?? '').trim(),
              overallCountTemplateLink: String(data.customLinks.overallCountTemplateLink ?? currentLocal.overallCountTemplateLink ?? '').trim(),
              updatedAt: data.customLinks.updatedAt || currentLocal.updatedAt,
            }
          : {
              formsLocationLink: String(currentLocal.formsLocationLink || data.customLinks.formsLocationLink || '').trim(),
              inventoryTemplateLink: String(currentLocal.inventoryTemplateLink || data.customLinks.inventoryTemplateLink || '').trim(),
              overallCountTemplateLink: String(currentLocal.overallCountTemplateLink || data.customLinks.overallCountTemplateLink || '').trim(),
              updatedAt: currentLocal.updatedAt || data.customLinks.updatedAt,
            };

        const changed =
          mergedLinks.formsLocationLink !== currentLocal.formsLocationLink ||
          mergedLinks.inventoryTemplateLink !== currentLocal.inventoryTemplateLink ||
          mergedLinks.overallCountTemplateLink !== currentLocal.overallCountTemplateLink;

        if (
          changed ||
          mergedLinks.formsLocationLink ||
          mergedLinks.inventoryTemplateLink ||
          mergedLinks.overallCountTemplateLink
        ) {
          try {
            localStorage.setItem(ADMIN_DRIVE_LINKS_STORAGE_KEY, JSON.stringify(mergedLinks));
          } catch {}
          const parsedInv = extractDriveResourceFromLink(mergedLinks.inventoryTemplateLink);
          if (parsedInv && !parsedInv.isFolder) {
            saveCountsheetTemplateUrl(parsedInv.webViewLink);
          }
          if (changed) {
            broadcastAdminDriveLinksUpdate(mergedLinks);
          }
        }
      }
      if (Array.isArray(data?.encodingTemplates) && data.encodingTemplates.length > 0) {
        memoryHubEncodingTemplates = ensureAllDefaultEncodingTemplates(data.encodingTemplates);
      }
      if (Array.isArray(data?.countsheetTemplates) && data.countsheetTemplates.length > 0) {
        memoryHubCountsheetTemplates = ensureAllDefaultCountsheetTemplates(data.countsheetTemplates);
      }
      try {
        localStorage.setItem(
          HUB_TEMPLATES_STORAGE_KEY,
          JSON.stringify({
            updatedAt: data?.updatedAt || new Date().toISOString(),
            countsheetTemplates: memoryHubCountsheetTemplates,
            encodingTemplates: memoryHubEncodingTemplates,
          })
        );
      } catch {}
    }
  } catch {}
  return {
    ownerEmail: HUB_OWNER_EMAIL,
    countsheetTemplates: getCachedHubCountsheetTemplates(),
    encodingTemplates: getCachedHubEncodingTemplates(),
    customLinks: getAdminDriveLinksConfig(),
  };
}

export async function syncHubAssetsToServer(options?: {
  accessToken?: string;
  countsheetSpec?: CountsheetTemplateSpec;
  customLinks?: Partial<AdminDriveLinksConfig>;
}): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options?.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    }
    const res = await fetch('/api/hub/sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accessToken: options?.accessToken,
        countsheetSpec: options?.countsheetSpec,
        customLinks: options?.customLinks,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.encodingTemplates) && data.encodingTemplates.length > 0) {
        memoryHubEncodingTemplates = data.encodingTemplates;
      }
      if (Array.isArray(data?.countsheetTemplates) && data.countsheetTemplates.length > 0) {
        memoryHubCountsheetTemplates = data.countsheetTemplates;
      }
      try {
        localStorage.setItem(
          HUB_TEMPLATES_STORAGE_KEY,
          JSON.stringify({
            updatedAt: data?.updatedAt || new Date().toISOString(),
            countsheetTemplates: memoryHubCountsheetTemplates,
            encodingTemplates: memoryHubEncodingTemplates,
          })
        );
      } catch {}
      return true;
    }
  } catch {}
  return false;
}

export async function saveAdminDriveLinksConfig(
  config: AdminDriveLinksConfig,
  accessToken?: string | null
): Promise<boolean> {
  const cleanConfig: AdminDriveLinksConfig = {
    formsLocationLink: String(config.formsLocationLink || '').trim(),
    inventoryTemplateLink: String(config.inventoryTemplateLink || '').trim(),
    overallCountTemplateLink: String(config.overallCountTemplateLink || '').trim(),
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(ADMIN_DRIVE_LINKS_STORAGE_KEY, JSON.stringify(cleanConfig));
  } catch {}

  // Also sync Inventory Template URL with Countsheet Template URL storage key
  const parsedInv = extractDriveResourceFromLink(cleanConfig.inventoryTemplateLink);
  if (parsedInv) {
    saveCountsheetTemplateUrl(parsedInv.webViewLink);
  } else if (!cleanConfig.inventoryTemplateLink) {
    saveCountsheetTemplateUrl('');
  }

  // Also sync Forms Location Link with FormsModal local storage key
  const parsedForms = extractDriveResourceFromLink(cleanConfig.formsLocationLink);
  try {
    if (parsedForms) {
      localStorage.setItem(
        'countsheet_icd_forms_drive_folder_v2',
        JSON.stringify({
          id: parsedForms.id,
          name: 'ICD FORMS',
          webViewLink: parsedForms.webViewLink,
          ownerEmail: HUB_OWNER_EMAIL,
          isAdminConfigured: true,
          isFolder: parsedForms.isFolder,
        })
      );
    } else if (!cleanConfig.formsLocationLink) {
      localStorage.removeItem('countsheet_icd_forms_drive_folder_v2');
    }
  } catch {}

  // Broadcast immediately to all mounted modals (FormsModal, CreateAuditReportModal, CreateRandomCountsheetModal)
  broadcastAdminDriveLinksUpdate(cleanConfig);

  const ok = await syncHubAssetsToServer({
    accessToken: accessToken || undefined,
    customLinks: cleanConfig,
  });

  // Broadcast again after server sync populates any folder templates
  broadcastAdminDriveLinksUpdate(cleanConfig);
  return ok;
}

function findMatchingHubEncodingTemplate(idOrName: string): HubEncodingTemplateInfo | null {
  if (!idOrName) return null;
  const clean = extractSpreadsheetId(idOrName).trim().toLowerCase();
  const rawUpper = idOrName.trim().toUpperCase();
  const list = getCachedHubEncodingTemplates();
  return (
    list.find(
      (t) =>
        t.id.toLowerCase() === clean ||
        t.name.toUpperCase() === rawUpper ||
        t.templateType.toUpperCase() === rawUpper
    ) || null
  );
}

// Fetch all sheets/tabs for a spreadsheet (auto-resolves shortcuts & auto-converts uploaded .xlsx/.xls files)
export async function getSpreadsheetTabs(
  accessToken: string,
  spreadsheetId: string
): Promise<{ title: string; tabs: SheetTabInfo[]; resolvedSpreadsheetId?: string }> {
  const rawCleanId = extractSpreadsheetId(spreadsheetId);
  let cleanId = getMappedSpreadsheetId(rawCleanId);
  if (cleanId.startsWith('demo-')) {
    return {
      title: 'IATD - Physical Inventory Audit Master List',
      tabs: [
        { sheetId: 0, title: 'IATD', rowCount: 150, columnCount: 12 },
        { sheetId: 1, title: 'ENCODING', rowCount: 150, columnCount: 15 },
        { sheetId: 2, title: 'MONITORING', rowCount: 50, columnCount: 5 },
      ],
      resolvedSpreadsheetId: cleanId,
    };
  }

  // Zero-popup Hub Template fast path (for TEMPLATE/ENCODING in icdhubsystems@gmail.com)
  const hubTemplate = findMatchingHubEncodingTemplate(cleanId) || findMatchingHubEncodingTemplate(spreadsheetId);
  if (hubTemplate && cleanId.startsWith('hub-encoding-')) {
    return {
      title: hubTemplate.name,
      tabs: hubTemplate.tabs,
      resolvedSpreadsheetId: hubTemplate.id,
    };
  }

  const tokenToUse = (await resolveValidOAuthToken(accessToken, { allowPopup: false })) || accessToken || '';
  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) {
    if (hubTemplate) {
      return {
        title: hubTemplate.name,
        tabs: hubTemplate.tabs,
        resolvedSpreadsheetId: hubTemplate.id,
      };
    }
    throw new GoogleApiError(
      401,
      'Your Google Workspace session has expired. Please reconnect your Google account to read spreadsheet tabs.',
      { isAuthError: true, apiName: 'Sheets' }
    );
  }

  const fetchSheetsMeta = (targetId: string) =>
    fetchWithRetry(
      `https://sheets.googleapis.com/v4/spreadsheets/${targetId}?fields=properties.title,sheets.properties(sheetId,title,gridProperties)`,
      { headers: { Authorization: `Bearer ${tokenToUse}` } }
    );

  let res = await fetchSheetsMeta(cleanId);

  // If mapped alias was deleted in Drive, fall back to rawCleanId
  if (!res.ok && cleanId !== rawCleanId) {
    memoryConvertedSheetsMap.delete(rawCleanId);
    cleanId = rawCleanId;
    res = await fetchSheetsMeta(cleanId);
  }

  if (!res.ok) {
    const errText = await res.text();
    // If Google Sheets returns 404 or 400 (e.g., uploaded .xlsx/.xls or Drive shortcut), inspect & auto-convert via Drive API
    if (res.status === 404 || res.status === 400) {
      try {
        const driveCheck = await fetchWithRetry(
          `https://www.googleapis.com/drive/v3/files/${cleanId}?fields=id,name,mimeType,shortcutDetails&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${tokenToUse}` } }
        );
        if (driveCheck.ok) {
          const fileMeta: any = await driveCheck.json();
          const mime = fileMeta.mimeType || '';
          const name = fileMeta.name || 'Spreadsheet';

          // 1. Resolve Google Drive shortcut to its target spreadsheet ID
          if (mime === 'application/vnd.google-apps.shortcut' && fileMeta.shortcutDetails?.targetId) {
            const targetId = fileMeta.shortcutDetails.targetId;
            saveMappedSpreadsheetId(rawCleanId, targetId);
            cleanId = targetId;
            res = await fetchSheetsMeta(cleanId);
          } else if (mime === 'application/vnd.google-apps.folder') {
            // 1b. If user or Admin Console supplied a Google Drive Folder link, resolve the template spreadsheet inside it
            const folderFiles = await listSpreadsheetsInDriveFolder(tokenToUse, cleanId);
            const firstSheet =
              folderFiles.find((f) => /overall|encoding|template|count/i.test(f.name || '')) ||
              folderFiles[0];
            if (firstSheet?.id) {
              saveMappedSpreadsheetId(rawCleanId, firstSheet.id);
              cleanId = firstSheet.id;
              res = await fetchSheetsMeta(cleanId);
            }
          } else if (
            mime.includes('spreadsheetml') ||
            mime.includes('ms-excel') ||
            mime.includes('csv') ||
            name.toLowerCase().endsWith('.xlsx') ||
            name.toLowerCase().endsWith('.xls') ||
            name.toLowerCase().endsWith('.csv')
          ) {
            // 2. Automatically convert Excel (.xlsx/.xls) or CSV file to a native Google Sheet in Drive
            const cleanTitle = name.replace(/\.(xlsx|xls|csv)$/i, '').trim() || 'Converted IATD Sheet';
            const copyRes = await fetchWithRetry(
              'https://www.googleapis.com/drive/v3/files/' +
                encodeURIComponent(cleanId) +
                '/copy?supportsAllDrives=true&fields=id,name',
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${tokenToUse}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  name: cleanTitle,
                  mimeType: 'application/vnd.google-apps.spreadsheet',
                }),
              }
            );
            if (copyRes.ok) {
              const copyData: any = await copyRes.json();
              if (copyData?.id) {
                saveMappedSpreadsheetId(rawCleanId, copyData.id);
                cleanId = copyData.id;
                res = await fetchSheetsMeta(cleanId);
              }
            }
          }
        } else if (driveCheck.status === 404) {
          // Prune stale deleted file ID from cached Drive files list
          removeStaleCachedDriveFile(rawCleanId);
        }
      } catch (checkErr: any) {
        if (checkErr instanceof GoogleApiError) throw checkErr;
      }
    }
    if (!res.ok) {
      if (hubTemplate) {
        return {
          title: hubTemplate.name,
          tabs: hubTemplate.tabs,
          resolvedSpreadsheetId: hubTemplate.id,
        };
      }
      throw parseGoogleApiError(res.status, errText, 'Sheets', tokenToUse);
    }
  }

  const data: any = await res.json();
  const title = data.properties?.title || 'Spreadsheet';
  const tabs: SheetTabInfo[] = (data.sheets || []).map((s: any) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title || 'Sheet1',
    rowCount: s.properties?.gridProperties?.rowCount,
    columnCount: s.properties?.gridProperties?.columnCount,
  }));

  return { title, tabs, resolvedSpreadsheetId: cleanId };
}

// Fetch headers and sample preview rows from a specific sheet/tab
export async function inspectSheetHeaders(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle?: string,
  forceHeaderRow?: number
): Promise<SheetHeaderInspection> {
  const rawCleanId = extractSpreadsheetId(spreadsheetId);
  const hubTemplate =
    findMatchingHubEncodingTemplate(rawCleanId) || findMatchingHubEncodingTemplate(spreadsheetId);
  if (hubTemplate && rawCleanId.startsWith('hub-encoding-')) {
    return {
      spreadsheetId: hubTemplate.id,
      spreadsheetTitle: hubTemplate.name,
      sheetTitle: sheetTitle || hubTemplate.sheetTitle || 'ENCODING',
      detectedHeaderRow: forceHeaderRow || hubTemplate.detectedHeaderRow || 2,
      headers: hubTemplate.headers,
      totalRows: 0,
      sampleRows: hubTemplate.sampleRows || [],
    };
  }

  const tokenToUse = (await resolveValidOAuthToken(accessToken, { allowPopup: false })) || accessToken || '';
  const { title: spreadsheetTitle, tabs, resolvedSpreadsheetId } = await getSpreadsheetTabs(tokenToUse, rawCleanId);
  const cleanId = resolvedSpreadsheetId || getMappedSpreadsheetId(rawCleanId);

  let targetTab = sheetTitle;
  if (!targetTab && tabs.length > 0) {
    // Prefer tab named ENCODING or IATD if found, otherwise first tab
    const encodingTab = tabs.find((t) =>
      t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('ENCOD')
    );
    const iatdTab = tabs.find((t) =>
      t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('IATD')
    );
    targetTab = (encodingTab || iatdTab || tabs[0]).title;
  }

  // Only use demo data for explicit demo-* IDs
  if (cleanId.startsWith('demo-')) {
    const demoItems = getDemoInventoryItems();
    const headers = [
      'Item Code',
      'Barcode',
      'Item Description',
      'Cat',
      'SubCat',
      'SubSubCat',
      'Cost',
      'Selling',
      'Unit',
      'Balance',
    ];
    return {
      spreadsheetId: cleanId,
      spreadsheetTitle: spreadsheetTitle || 'IATD - Physical Inventory Audit Master List',
      sheetTitle: targetTab || 'IATD',
      detectedHeaderRow: forceHeaderRow || 2,
      headers,
      totalRows: demoItems.length,
      sampleRows: demoItems.slice(0, 5).map((item) => [
        item.itemCode,
        item.barcode,
        item.itemDescription,
        item.category,
        item.subCategory,
        item.subsubCategory,
        item.cost,
        item.selling,
        item.unit,
        item.balance,
      ]),
    };
  }

  const safeTabName = `'${(targetTab || 'Sheet1').replace(/'/g, "''")}'`;
  // Fetch first 30 rows to detect header row and samples (supporting wide sheets up to ZZ columns)
  const sampleRange = encodeURIComponent(`${safeTabName}!A1:ZZ30`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${sampleRange}?majorDimension=ROWS`;

  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${tokenToUse}` },
  });

  if (!res.ok) {
    if (hubTemplate) {
      return {
        spreadsheetId: hubTemplate.id,
        spreadsheetTitle: hubTemplate.name,
        sheetTitle: targetTab || hubTemplate.sheetTitle || 'ENCODING',
        detectedHeaderRow: forceHeaderRow || hubTemplate.detectedHeaderRow || 2,
        headers: hubTemplate.headers,
        totalRows: 0,
        sampleRows: hubTemplate.sampleRows || [],
      };
    }
    const errText = await res.text();
    throw parseGoogleApiError(res.status, errText, 'Sheets', tokenToUse);
  }

  const data: any = await res.json();
  const rows: any[][] = data.values || [];

  if (rows.length === 0) {
    return {
      spreadsheetId: cleanId,
      spreadsheetTitle,
      sheetTitle: targetTab || 'Sheet1',
      detectedHeaderRow: 1,
      headers: [],
      totalRows: 0,
      sampleRows: [],
    };
  }

  let headerRowIndex = forceHeaderRow ? forceHeaderRow - 1 : 0;

  // Auto-detect header row if not forced
  if (!forceHeaderRow) {
    // Check if row 0 has meaningful column names
    const row0 = rows[0] || [];
    const row1 = rows[1] || [];

    const isRow0Header =
      row0.length >= 2 &&
      row0.filter((c) => typeof c === 'string' && c.trim().length > 0).length >= 2;

    const isRow1Header =
      row1.length >= 2 &&
      row1.some((c) =>
        /code|desc|bar|item|cost|price|qty|balance|unit|cat/i.test(String(c))
      );

    if (!isRow0Header && isRow1Header) {
      headerRowIndex = 1;
    } else {
      headerRowIndex = 0;
    }
  }

  const rawHeaders = (rows[headerRowIndex] || []).map((h) => String(h || '').trim());
  const sampleDataRows = rows.slice(headerRowIndex + 1, headerRowIndex + 6);

  // Fetch full row count of the tab
  const totalRange = encodeURIComponent(`${safeTabName}!A:A`);
  const countRes = await fetchWithRetry(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${totalRange}?majorDimension=COLUMNS`,
    {
      headers: { Authorization: `Bearer ${tokenToUse}` },
    }
  );
  let totalDataRows = 0;
  if (countRes.ok) {
    const countData: any = await countRes.json();
    const colA = countData.values?.[0] || [];
    totalDataRows = Math.max(0, colA.length - (headerRowIndex + 1));
  } else {
    totalDataRows = Math.max(0, rows.length - (headerRowIndex + 1));
  }

  return {
    spreadsheetId: cleanId,
    spreadsheetTitle,
    sheetTitle: targetTab || 'Sheet1',
    detectedHeaderRow: headerRowIndex + 1,
    headers: rawHeaders,
    totalRows: totalDataRows,
    sampleRows: sampleDataRows,
  };
}

// Fetch all rows from an IATD sheet starting from row 2 (or headerRowIndex + 1)
export async function fetchAllSheetRows(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  headerRowIndex: number = 1
): Promise<{ headers: string[]; rows: any[][] }> {
  const cleanId = getMappedSpreadsheetId(extractSpreadsheetId(spreadsheetId));
  if (cleanId.startsWith('demo-')) {
    const demoItems = getDemoInventoryItems();
    const headers = [
      'Item Code',
      'Barcode',
      'Item Description',
      'Cat',
      'SubCat',
      'SubSubCat',
      'Cost',
      'Selling',
      'Unit',
      'Balance',
    ];
    const rows = demoItems.map((item) => [
      item.itemCode,
      item.barcode,
      item.itemDescription,
      item.category,
      item.subCategory,
      item.subsubCategory,
      item.cost,
      item.selling,
      item.unit,
      item.balance,
    ]);
    return { headers, rows };
  }

  const tokenToUse = (await resolveValidOAuthToken(accessToken, { allowPopup: false })) || accessToken || '';
  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) {
    throw new GoogleApiError(
      401,
      'Your Google Workspace session has expired. Please reconnect your Google account to read spreadsheet rows.',
      { isAuthError: true, apiName: 'Sheets' }
    );
  }

  const safeTabName = `'${sheetTitle.replace(/'/g, "''")}'`;

  // Range fallback strategy:
  // 1. First try A:AZ (covers wide sheets up to column 52)
  // 2. If 503/service unavailable, fallback to A:Z (covers standard inventory columns 1-26)
  // 3. Fallback to bounded ranges A1:Z5000 and A1:T2000
  const candidateRanges = [
    `${safeTabName}!A:AZ`,
    `${safeTabName}!A:Z`,
    `${safeTabName}!A1:Z5000`,
    `${safeTabName}!A1:T2000`,
  ];

  let lastStatus = 503;
  let lastErrText = 'The service is currently unavailable.';

  for (let idx = 0; idx < candidateRanges.length; idx++) {
    const range = candidateRanges[idx];
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
      range
    )}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;

    try {
      if (idx > 0) {
        // Short pause between retries to alleviate transient Google API 503/500 rate limits
        await new Promise((r) => setTimeout(r, 500));
      }

      const res = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      });

      if (res.ok) {
        const data: any = await res.json();
        const allRows: any[][] = data.values || [];

        const zeroIndexedHeader = Math.max(0, headerRowIndex - 1);
        const headers = (allRows[zeroIndexedHeader] || []).map((h) => String(h || '').trim());
        const rawDataRows = allRows.slice(zeroIndexedHeader + 1);
        const { rows: dataRows } = trimIatdRowsAfterVersionFooter(rawDataRows);

        return { headers, rows: dataRows };
      }

      lastStatus = res.status;
      lastErrText = await res.text();

      // If error is not a transient 503/500/502/504 error, fail fast (e.g. 401, 403, 404)
      if (![503, 500, 502, 504].includes(res.status)) {
        throw parseGoogleApiError(res.status, lastErrText, 'Sheets', tokenToUse);
      }
      console.warn(`[fetchAllSheetRows] Range ${range} failed with ${res.status}. Trying fallback range...`);
    } catch (err: any) {
      if (err instanceof GoogleApiError && ![503, 500, 502, 504].includes(err.status)) {
        throw err;
      }
      lastErrText = err?.message || lastErrText;
      console.warn(`[fetchAllSheetRows] Range ${range} threw error:`, err);
    }
  }

  throw parseGoogleApiError(lastStatus, lastErrText, 'Sheets', tokenToUse);
}

/**
 * Detects whether a cell value represents the IATD system version footer (e.g. "v.1.26.26", "(v.1.26.26)", "v1.25.0"),
 * where the version numbers after "v." vary depending on the system version that generated the IATD.
 */
export function isIatdVersionFooterCell(val: any): boolean {
  if (val === null || val === undefined) return false;
  const str = String(val).trim();
  if (!str) return false;
  return /^\(?\s*v(?:er(?:sion)?)?\.?\s*\d+(?:\.\d+)+(?:[-a-z0-9._]*)\s*\)?$/i.test(str);
}

export function isIatdTotalQuantityFooterRow(row: any[]): boolean {
  if (!Array.isArray(row)) return false;
  return row.some((cell) => {
    if (cell === null || cell === undefined) return false;
    return /\(?\s*total\s+quantity\s*:?\s*\)?/i.test(String(cell).trim());
  });
}

export function isIatdVersionFooterRow(row: any[], prevRow?: any[]): boolean {
  if (!Array.isArray(row)) return false;
  if (row.some((cell) => isIatdVersionFooterCell(cell))) {
    return true;
  }
  const hasEmbeddedVersion = row.some((cell) => {
    if (cell === null || cell === undefined) return false;
    return /\(?\bv\.?\s*\d+(?:\.\d+){1,4}\b\)?/i.test(String(cell).trim());
  });
  if (hasEmbeddedVersion && prevRow && isIatdTotalQuantityFooterRow(prevRow)) {
    return true;
  }
  return false;
}

/**
 * Trims an array of IATD rows so that no rows exist after the final system version row (e.g. "v.1.26.26" / "(v.1.26.26)"),
 * which sits right after the "(Total Quantity:)" 2nd-to-last row.
 */
export function trimIatdRowsAfterVersionFooter(rows: any[][]): {
  rows: any[][];
  footerRowCount: number;
} {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { rows: [], footerRowCount: 0 };
  }

  const nonEmptyRows: any[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const hasContent = r.some(
      (val) => val !== null && val !== undefined && String(val).trim() !== ''
    );
    if (hasContent) {
      nonEmptyRows.push(r);
    }
  }

  if (nonEmptyRows.length === 0) {
    return { rows: [], footerRowCount: 0 };
  }

  // Locate the version footer row (e.g. v.1.26.26 / v.X.X.X) scanning from the bottom
  let versionRowIdx = -1;
  for (let i = nonEmptyRows.length - 1; i >= 0; i--) {
    const prev = i > 0 ? nonEmptyRows[i - 1] : undefined;
    if (isIatdVersionFooterRow(nonEmptyRows[i], prev)) {
      versionRowIdx = i;
      break;
    }
  }

  const trimmed = versionRowIdx >= 0 ? nonEmptyRows.slice(0, versionRowIdx + 1) : nonEmptyRows;

  let footerRowCount = 0;
  if (trimmed.length >= 1) {
    const lastIdx = trimmed.length - 1;
    const secondLastIdx = trimmed.length - 2;
    const lastIsVersion = isIatdVersionFooterRow(
      trimmed[lastIdx],
      secondLastIdx >= 0 ? trimmed[secondLastIdx] : undefined
    );
    if (lastIsVersion) {
      footerRowCount = 1;
      if (secondLastIdx >= 0 && isIatdTotalQuantityFooterRow(trimmed[secondLastIdx])) {
        footerRowCount = 2;
      }
    } else if (isIatdTotalQuantityFooterRow(trimmed[lastIdx])) {
      footerRowCount = 1;
    }
  }

  return { rows: trimmed, footerRowCount };
}

// Smart normalization helper
function normalizeKey(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Synonyms map for standard inventory & ENCODING columns
const SYNONYMS_MAP: Record<string, string[]> = {
  itemcode: ['itemcode', 'code', 'itemno', 'itemnumber', 'productcode', 'sku', 'item_code', 'matcode', 'materialcode', 'prodcode', 'item'],
  barcode: ['barcode', 'upc', 'ean', 'bar_code', 'bar_no', 'barcodeno', 'upccode', 'plu', 'scancode'],
  itemdescription: ['itemdescription', 'description', 'itemdesc', 'itemname', 'productname', 'item_desc', 'item_description', 'desc', 'particulars', 'item_name', 'product', 'items', 'itemdetails'],
  category: ['category', 'cat', 'itemcategory', 'categoryname', 'grp', 'group', 'class', 'classification', 'dept', 'department', 'section'],
  subcategory: ['subcategory', 'subcat', 'sub_category', 'sub_cat', 'subgroup', 'subclass', 'subgrp'],
  subsubcategory: ['subsubcategory', 'subsubcat', 'sub_sub_category', 'sub_sub_cat', 'subsubgroup', 'subsubclass', 'subsubgrp'],
  cost: ['cost', 'unitcost', 'costprice', 'unit_cost', 'cost_price', 'purchaseprice', 'buyingprice', 'costperunit', 'landedcost'],
  selling: ['selling', 'sellingprice', 'price', 'srp', 'retailprice', 'retail_price', 'unit_price', 'unitprice', 'selling_price', 'regularprice'],
  unit: ['unit', 'uom', 'unitofmeasure', 'unit_of_measure', 'u_o_m', 'package', 'pack', 'unitmeasure'],
  begqty: ['begqty', 'beg_qty', 'beginningqty', 'beginningbalance', 'begbalance', 'beg_balance', 'beginning', 'beg'],
  in: ['in', 'received', 'qtyin', 'incoming', 'purchase', 'purchases', 'transfersin', 'receipts'],
  out: ['out', 'sold', 'qtyout', 'sales', 'outgoing', 'transfersout', 'issuances', 'dispatches'],
  balance: ['balance', 'currentbalance', 'qty', 'qtyonhand', 'onhand', 'endingbalance', 'endingqty', 'stockonhand', 'soh', 'bookbalance', 'quantity', 'inventory', 'physicalqty'],
  amount: ['amount', 'totalamount', 'costamount', 'totalvalue', 'value', 'total', 'extendedcost', 'totalcost'],
  gp: ['gp', 'gppercent', 'grossprofit', 'margin', 'gp%', 'gpmargin'],
};

// Auto-map IATD headers to ENCODING headers
export function generateAutoMapping(
  iatdHeaders: string[],
  encodingHeaders: string[]
): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const usedIatdHeaders = new Set<string>();

  // 1. Exact match (case insensitive)
  for (const encHeader of encodingHeaders) {
    if (!encHeader) continue;
    const cleanEnc = encHeader.trim().toLowerCase();
    const exactMatch = iatdHeaders.find(
      (h) => h.trim().toLowerCase() === cleanEnc && !usedIatdHeaders.has(h)
    );
    if (exactMatch) {
      mapping[encHeader] = exactMatch;
      usedIatdHeaders.add(exactMatch);
    }
  }

  // 2. Normalized match (stripping punctuation/spaces)
  for (const encHeader of encodingHeaders) {
    if (mapping[encHeader]) continue;
    const normEnc = normalizeKey(encHeader);
    if (!normEnc) continue;

    const normMatch = iatdHeaders.find(
      (h) => normalizeKey(h) === normEnc && !usedIatdHeaders.has(h)
    );
    if (normMatch) {
      mapping[encHeader] = normMatch;
      usedIatdHeaders.add(normMatch);
    }
  }

  // 3. Synonym dictionary match
  for (const encHeader of encodingHeaders) {
    if (mapping[encHeader]) continue;
    const normEnc = normalizeKey(encHeader);

    // Find if normEnc belongs to any synonyms list
    for (const [canonical, synonyms] of Object.entries(SYNONYMS_MAP)) {
      if (canonical === normEnc || synonyms.includes(normEnc)) {
        // Look for any IATD header matching these synonyms
        const synonymMatch = iatdHeaders.find((h) => {
          if (usedIatdHeaders.has(h)) return false;
          const normH = normalizeKey(h);
          return normH === canonical || synonyms.includes(normH);
        });

        if (synonymMatch) {
          mapping[encHeader] = synonymMatch;
          usedIatdHeaders.add(synonymMatch);
          break;
        }
      }
    }
  }

  // 4. Substring / contains match
  for (const encHeader of encodingHeaders) {
    if (mapping[encHeader]) continue;
    const normEnc = normalizeKey(encHeader);
    if (normEnc.length < 3) continue;

    const subMatch = iatdHeaders.find((h) => {
      if (usedIatdHeaders.has(h)) return false;
      const normH = normalizeKey(h);
      return normH.includes(normEnc) || normEnc.includes(normH);
    });

    if (subMatch) {
      mapping[encHeader] = subMatch;
      usedIatdHeaders.add(subMatch);
    }
  }

  // Fill remainder with null
  for (const encHeader of encodingHeaders) {
    if (!(encHeader in mapping)) {
      mapping[encHeader] = null;
    }
  }

  return mapping;
}

export const GENERATED_COUNTSHEET_FOLDER_NAME = 'Generated Countsheet';
export const GENERATED_ENCODING_FOLDER_NAME = 'Generated Encoding';

export interface UserDriveFolderInfo {
  folderId: string;
  folderName: string;
  webViewLink: string;
}

/**
 * Finds or creates a folder with `folderName` in the signed-in user's own Google Drive.
 * Guarantees that generated Countsheets ("Generated Countsheet") and Encodings ("Generated Encoding")
 * are stored in the user's Google Drive folder.
 */
export async function ensureUserDriveFolder(
  rawAccessToken: string,
  folderName: string
): Promise<UserDriveFolderInfo | null> {
  const resolvedToken =
    (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  if (!resolvedToken || !isGoogleOAuthAccessToken(resolvedToken)) {
    return null;
  }

  const cleanName = folderName.trim();
  const escapedName = cleanName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // 1. Check if folder already exists in the user's Google Drive
  try {
    const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and 'me' in owners and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,webViewLink)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const searchRes = await fetchWithRetry(searchUrl, {
      headers: { Authorization: `Bearer ${resolvedToken}` },
    });

    if (searchRes.ok) {
      const searchData: any = await searchRes.json();
      const existing = searchData.files?.[0];
      if (existing?.id) {
        return {
          folderId: existing.id,
          folderName: existing.name || cleanName,
          webViewLink:
            existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`,
        };
      }
    }
  } catch (searchErr) {
    console.warn(`Could not search for Drive folder "${cleanName}":`, searchErr);
  }

  // 2. Create the folder in the user's Google Drive root if it does not exist
  try {
    const createUrl =
      'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true';
    const createRes = await fetchWithRetry(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: cleanName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['root'],
      }),
    });

    if (createRes.ok) {
      const created: any = await createRes.json();
      if (created?.id) {
        return {
          folderId: created.id,
          folderName: created.name || cleanName,
          webViewLink:
            created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
        };
      }
    }
  } catch (createErr) {
    console.warn(`Could not create Drive folder "${cleanName}":`, createErr);
  }

  return null;
}

/**
 * Moves a file in the user's Google Drive into the specified `folderId`.
 */
export async function moveFileToDriveFolder(
  rawAccessToken: string,
  fileId: string,
  folderId: string
): Promise<boolean> {
  const cleanFileId = extractSpreadsheetId(fileId);
  if (!cleanFileId || !folderId) return false;

  const resolvedToken =
    (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  if (!resolvedToken || !isGoogleOAuthAccessToken(resolvedToken)) return false;

  try {
    const getRes = await fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${cleanFileId}?fields=parents&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${resolvedToken}` },
      }
    );

    let previousParents = '';
    if (getRes.ok) {
      const fileMeta: any = await getRes.json();
      const parentsList: string[] = Array.isArray(fileMeta.parents) ? fileMeta.parents : [];
      if (parentsList.length === 1 && parentsList[0] === folderId) {
        return true; // Already inside the target folder
      }
      previousParents = parentsList.filter((p) => p !== folderId).join(',');
    }

    const patchUrl = `https://www.googleapis.com/drive/v3/files/${cleanFileId}?addParents=${encodeURIComponent(
      folderId
    )}${
      previousParents ? `&removeParents=${encodeURIComponent(previousParents)}` : ''
    }&supportsAllDrives=true&fields=id,parents`;

    const patchRes = await fetchWithRetry(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${resolvedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    return patchRes.ok;
  } catch (moveErr) {
    console.warn(`Could not move file ${cleanFileId} to folder ${folderId}:`, moveErr);
    return false;
  }
}

/**
 * Instantiates a cached .xlsx template from icdhubsystems@gmail.com (served by /api/hub/templates/:id/xlsx)
 * directly inside the signed-in user's Google Drive folder as a native Google Spreadsheet.
 */
async function instantiateCachedHubTemplateInUserDrive(
  userAccessToken: string,
  templateId: string,
  newTitle: string,
  targetFolderId?: string
): Promise<{ id: string; name: string; webViewLink: string } | null> {
  if (!userAccessToken || !templateId || templateId.startsWith('hub-')) return null;
  try {
    const xlsxRes = await fetch(`/api/hub/templates/${encodeURIComponent(templateId)}/xlsx`);
    if (!xlsxRes.ok) return null;
    const binaryBytes = new Uint8Array(await xlsxRes.arrayBuffer());
    if (binaryBytes.length < 100) return null;

    const boundary = `-------icd_hub_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const metadata: Record<string, any> = {
      name: newTitle,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    };
    if (targetFolderId) {
      metadata.parents = [targetFolderId];
    }

    const sourceMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,parents';
    const uploadRes = await fetchWithRetry(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    if (uploadRes.ok) {
      const created: any = await uploadRes.json();
      if (created?.id) {
        return {
          id: created.id,
          name: created.name || newTitle,
          webViewLink:
            created.webViewLink || `https://docs.google.com/spreadsheets/d/${created.id}/edit`,
        };
      }
    }
  } catch (err) {
    console.warn('Could not instantiate cached Hub xlsx template in user Drive:', err);
  }
  return null;
}

// Duplicate an existing Spreadsheet (First tries Drive API file clone, then cached Hub .xlsx clone, then Sheets API copyTo / spec builder)
// Automatically stores the generated spreadsheet inside the signed-in user's "Generated Encoding" Drive folder.
export async function duplicateSpreadsheet(
  accessToken: string,
  sourceSpreadsheetId: string,
  newTitle: string,
  targetFolderName: string = GENERATED_ENCODING_FOLDER_NAME
): Promise<{
  id: string;
  name: string;
  webViewLink?: string;
  folderId?: string;
  folderName?: string;
  folderWebViewLink?: string;
}> {
  const cleanId = getMappedSpreadsheetId(extractSpreadsheetId(sourceSpreadsheetId));
  const resolvedToken = (await resolveValidOAuthToken(accessToken, { allowPopup: false })) || accessToken;
  const hubEncodingTemplate =
    findMatchingHubEncodingTemplate(cleanId) || findMatchingHubEncodingTemplate(sourceSpreadsheetId);
  const isSyntheticHubId = cleanId.startsWith('hub-encoding-');

  // Ensure the target folder (e.g. "Generated Encoding") exists in the signed-in auditor's own Google Drive
  const folderInfo = await ensureUserDriveFolder(resolvedToken, targetFolderName);

  // Strategy 1: Fast Drive API File Copy directly into the auditor's target folder (when source is a real accessible Drive file)
  if (!isSyntheticHubId) {
    try {
      const url = `https://www.googleapis.com/drive/v3/files/${cleanId}/copy?supportsAllDrives=true&fields=id,name,webViewLink,parents`;
      const copyPayload: Record<string, any> = {
        name: newTitle,
        mimeType: 'application/vnd.google-apps.spreadsheet',
      };
      if (folderInfo?.folderId) {
        copyPayload.parents = [folderInfo.folderId];
      }

      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resolvedToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(copyPayload),
      });

      if (res.ok) {
        const data: any = await res.json();
        if (folderInfo?.folderId && (!Array.isArray(data.parents) || !data.parents.includes(folderInfo.folderId))) {
          await moveFileToDriveFolder(resolvedToken, data.id, folderInfo.folderId);
        }
        return {
          id: data.id,
          name: data.name,
          webViewLink: data.webViewLink || `https://docs.google.com/spreadsheets/d/${data.id}/edit`,
          folderId: folderInfo?.folderId,
          folderName: folderInfo?.folderName || targetFolderName,
          folderWebViewLink: folderInfo?.webViewLink,
        };
      }
    } catch (driveErr) {
      console.warn('Drive file copy attempt notice:', driveErr);
    }

    // Strategy 1B: If template is from icdhubsystems@gmail.com and cached on the server as .xlsx,
    // upload it directly into the signed-in user's Google Drive ("Generated Encoding") as a native Google Sheet!
    const clonedFromHubXlsx = await instantiateCachedHubTemplateInUserDrive(
      resolvedToken,
      cleanId,
      newTitle,
      folderInfo?.folderId
    );
    if (clonedFromHubXlsx) {
      return {
        id: clonedFromHubXlsx.id,
        name: clonedFromHubXlsx.name,
        webViewLink: clonedFromHubXlsx.webViewLink,
        folderId: folderInfo?.folderId,
        folderName: folderInfo?.folderName || targetFolderName,
        folderWebViewLink: folderInfo?.webViewLink,
      };
    }
  }

  // Strategy 2 & 3: Create spreadsheet directly in the signed-in auditor's Google Drive ("Generated Encoding")
  // and either copy tabs from source or initialize from the cached Hub Encoding Template (TEMPLATE/ENCODING in icdhubsystems@gmail.com)
  try {
    const createRes = await fetchWithRetry('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title: newTitle,
        },
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw parseGoogleApiError(createRes.status, errText, 'Sheets', resolvedToken);
    }

    const createdData: any = await createRes.json();
    const newSpreadsheetId = createdData.spreadsheetId;
    const defaultFirstSheetId = createdData.sheets?.[0]?.properties?.sheetId;

    // Move newly created spreadsheet into the user's target folder ("Generated Encoding")
    if (folderInfo?.folderId) {
      await moveFileToDriveFolder(resolvedToken, newSpreadsheetId, folderInfo.folderId);
    }

    let copiedAnyTabFromSource = false;

    if (!isSyntheticHubId) {
      try {
        const { tabs, resolvedSpreadsheetId } = await getSpreadsheetTabs(resolvedToken, cleanId);
        const effectiveSourceId = resolvedSpreadsheetId || cleanId;

        if (!effectiveSourceId.startsWith('hub-encoding-')) {
          for (const tab of tabs) {
            const copyToUrl = `https://sheets.googleapis.com/v4/spreadsheets/${effectiveSourceId}/sheets/${tab.sheetId}:copyTo`;
            const copyRes = await fetchWithRetry(copyToUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resolvedToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                destinationSpreadsheetId: newSpreadsheetId,
              }),
            });

            if (copyRes.ok) {
              copiedAnyTabFromSource = true;
              const copyData: any = await copyRes.json();
              const copiedSheetId = copyData.sheetId;
              try {
                await fetchWithRetry(
                  `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`,
                  {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${resolvedToken}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      requests: [
                        {
                          updateSheetProperties: {
                            properties: {
                              sheetId: copiedSheetId,
                              title: tab.title,
                            },
                            fields: 'title',
                          },
                        },
                      ],
                    }),
                  }
                );
              } catch {}
            }
          }
        }
      } catch {}
    }

    if (copiedAnyTabFromSource) {
      if (defaultFirstSheetId !== undefined) {
        try {
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resolvedToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [{ deleteSheet: { sheetId: defaultFirstSheetId } }],
            }),
          });
        } catch {}
      }
    } else {
      // Strategy 3: Self-contained construction from cached TEMPLATE/ENCODING spec (icdhubsystems@gmail.com)
      // Guarantees zero popups and 100% reliability even when the template is in icdhubsystems@gmail.com
      const templateToBuild = hubEncodingTemplate || DEFAULT_HUB_ENCODING_TEMPLATES[0];
      const encHeaders =
        templateToBuild.headers && templateToBuild.headers.length > 0
          ? templateToBuild.headers
          : DEFAULT_HUB_ENCODING_HEADERS;
      const encTabTitle = templateToBuild.sheetTitle || 'ENCODING';
      const setupRequests: any[] = [];

      if (defaultFirstSheetId !== undefined) {
        setupRequests.push({
          updateSheetProperties: {
            properties: {
              sheetId: Number(defaultFirstSheetId),
              title: encTabTitle,
              gridProperties: {
                rowCount: 1500,
                columnCount: Math.max(40, encHeaders.length + 10),
                frozenRowCount: 2,
              },
            },
            fields: 'title,gridProperties(rowCount,columnCount,frozenRowCount)',
          },
        });
        setupRequests.push({
          repeatCell: {
            range: {
              sheetId: Number(defaultFirstSheetId),
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 0,
              endColumnIndex: encHeaders.length,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.91, green: 0.94, blue: 0.98 },
                textFormat: { bold: true, fontFamily: 'Calibri', fontSize: 10 },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
          },
        });
      }

      // Add any additional tabs from the cached template (e.g., SUMMARY)
      const extraTabs = (templateToBuild.tabs || []).filter(
        (t) => t.title.trim().toUpperCase() !== encTabTitle.trim().toUpperCase()
      );
      extraTabs.forEach((t, idx) => {
        setupRequests.push({
          addSheet: {
            properties: {
              title: t.title,
              index: idx + 1,
              gridProperties: {
                rowCount: t.rowCount || 200,
                columnCount: t.columnCount || 15,
              },
            },
          },
        });
      });

      if (setupRequests.length > 0) {
        await fetchWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resolvedToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ requests: setupRequests }),
          }
        );
      }

      // Write Row 1 Title, Row 2 Headers, and Row 3 Template Formulas into ENCODING tab
      const safeEncTab = `'${encTabTitle.replace(/'/g, "''")}'`;
      const row1Vals =
        templateToBuild.row1Values && templateToBuild.row1Values.length > 0
          ? templateToBuild.row1Values
          : [templateToBuild.name || newTitle];
      const row3Formulas =
        templateToBuild.row3Formulas && templateToBuild.row3Formulas.length > 0
          ? templateToBuild.row3Formulas
          : DEFAULT_HUB_ENCODING_ROW3_FORMULAS;
      await fetchWithRetry(
        `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}/values/${encodeURIComponent(
          `${safeEncTab}!A1`
        )}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${resolvedToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            majorDimension: 'ROWS',
            values: [row1Vals, encHeaders, row3Formulas],
          }),
        }
      );

      // Also initialize MONITORING tab Row 6 header if MONITORING tab was created in Strategy 3
      const monTab = extraTabs.find((t) =>
        t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('MONITOR')
      );
      if (monTab) {
        const safeMonTab = `'${monTab.title.replace(/'/g, "''")}'`;
        try {
          await fetchWithRetry(
            `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}/values/${encodeURIComponent(
              `${safeMonTab}!A6`
            )}?valueInputOption=RAW`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${resolvedToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                majorDimension: 'ROWS',
                values: [['Countsheet No.', 'Date', 'Encoded By', 'Checked By', 'Status', 'Remarks']],
              }),
            }
          );
        } catch {}
      }
    }

    return {
      id: newSpreadsheetId,
      name: newTitle,
      webViewLink: `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit`,
      folderId: folderInfo?.folderId,
      folderName: folderInfo?.folderName || targetFolderName,
      folderWebViewLink: folderInfo?.webViewLink,
    };
  } catch (sheetsErr: any) {
    throw parseGoogleApiError(
      sheetsErr.status || 500,
      sheetsErr.message || 'Failed to create spreadsheet',
      'Sheets'
    );
  }
}

// Populate target ENCODING sheet strictly for mapped columns (Formula & Template Safe)
// and automatically adjusts (adds/deletes) sheet rows and columns to match data
export async function executeAuditReportMapping(
  rawAccessToken: string,
  targetSpreadsheetId: string,
  targetSheetTitle: string,
  encodingHeaders: string[],
  encodingHeaderRow: number, // 1-indexed (e.g. 2)
  iatdHeaders: string[],
  iatdRows: any[][],
  mapping: Record<string, string | null>,
  clearOldData: boolean = true,
  autoAdjustDimensions: boolean = true
): Promise<{
  totalRowsWritten: number;
  spreadsheetId: string;
  webViewLink: string;
  mappedColumnsCount: number;
  adjustedRowsCount: number;
  folderId?: string;
  folderName?: string;
  folderWebViewLink?: string;
}> {
  const accessToken = (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  const cleanTargetId = extractSpreadsheetId(targetSpreadsheetId);
  const safeTabName = `'${targetSheetTitle.replace(/'/g, "''")}'`;

  // Build index lookup for IATD headers
  const iatdIndexMap = new Map<string, number>();
  iatdHeaders.forEach((h, idx) => {
    iatdIndexMap.set(h, idx);
  });

  // Determine non-empty source rows and cut off any rows after the IATD version footer row (e.g. v.1.26.26)
  const { rows: validIatdRows, footerRowCount } = trimIatdRowsAfterVersionFooter(iatdRows);

  const totalRowCount = validIatdRows.length;
  if (totalRowCount === 0) {
    throw new Error('No data rows found in IATD spreadsheet to transfer.');
  }

  const startRow = encodingHeaderRow + 1; // e.g. Row 3 if header is Row 2
  const endRow = startRow + totalRowCount - 1; // Strictly ends on the v.X.X.X row (no rows after it)
  const itemRowCount = Math.max(1, totalRowCount - footerRowCount);

  // Find all active mapped columns: (encodingColIndex, encHeader, iatdColIndex, colLetter)
  interface ActiveMappedCol {
    encIndex: number;
    encHeader: string;
    iatdIndex: number;
    iatdHeader: string;
    colLetter: string;
  }

  const activeColumns: ActiveMappedCol[] = [];

  encodingHeaders.forEach((encHeader, encIdx) => {
    if (!encHeader) return;
    const mappedIatdHeader = mapping[encHeader];
    if (mappedIatdHeader && iatdIndexMap.has(mappedIatdHeader)) {
      const iatdIdx = iatdIndexMap.get(mappedIatdHeader)!;
      const colLetter = numberToColumnLetter(encIdx);
      activeColumns.push({
        encIndex: encIdx,
        encHeader,
        iatdIndex: iatdIdx,
        iatdHeader: mappedIatdHeader,
        colLetter,
      });
    }
  });

  if (activeColumns.length === 0) {
    throw new Error('Please map at least one column from IATD to ENCODING.');
  }

  // Ensure that if the last 1-2 rows are IATD footer rows ("Total Quantity:" and "v.X.X.X")
  // and their text sits in an unmapped IATD column, we preserve their text in the first mapped column
  const mappedIatdIndices = new Set(activeColumns.map((c) => c.iatdIndex));
  if (footerRowCount > 0 && activeColumns.length > 0) {
    const primaryTargetIatdIdx = activeColumns[0].iatdIndex;
    for (let f = totalRowCount - footerRowCount; f < totalRowCount; f++) {
      const fRow = validIatdRows[f];
      if (!fRow) continue;
      const hasAnyMappedVal = activeColumns.some((col) => {
        const v = fRow[col.iatdIndex];
        return v !== null && v !== undefined && String(v).trim() !== '';
      });
      if (!hasAnyMappedVal) {
        const unmappedTexts = fRow
          .filter((v, idx) => !mappedIatdIndices.has(idx) && v !== null && v !== undefined && String(v).trim() !== '')
          .map((v) => String(v).trim());
        if (unmappedTexts.length > 0) {
          const clonedRow = [...fRow];
          clonedRow[primaryTargetIatdIdx] = unmappedTexts.join(' ');
          validIatdRows[f] = clonedRow;
        }
      }
    }
  }

  // 0. Fetch sheet properties to inspect and adjust grid dimensions so sheet ends strictly at `endRow` (v.X.X.X)
  let sheetId = 0;
  let curRowCount = 1000;
  let curColCount = 50;

  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanTargetId}?fields=sheets.properties(sheetId,title,gridProperties)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (metaRes.ok) {
      const metaData: any = await metaRes.json();
      const currentSheet = (metaData.sheets || []).find(
        (s: any) => s.properties?.title === targetSheetTitle
      );
      if (currentSheet?.properties) {
        sheetId = currentSheet.properties.sheetId ?? 0;
        curRowCount = currentSheet.properties.gridProperties?.rowCount || 1000;
        curColCount = currentSheet.properties.gridProperties?.columnCount || 50;

        const maxEncColIdx = Math.max(...activeColumns.map((c) => c.encIndex), 0);
        const requiredColCount = Math.max(maxEncColIdx + 5, 26);
        const targetRowCount = endRow; // Exact last row (v.X.X.X), zero rows after it

        const requests: any[] = [];

        // Always enforce exact targetRowCount so no rows remain after the v.X.X.X last row
        if (curRowCount !== targetRowCount && (autoAdjustDimensions || footerRowCount > 0 || targetRowCount > curRowCount)) {
          requests.push({
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: {
                  rowCount: targetRowCount,
                },
              },
              fields: 'gridProperties.rowCount',
            },
          });
        }

        // Auto-adjust columns if needed
        if (requiredColCount > curColCount) {
          requests.push({
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: {
                  columnCount: requiredColCount,
                },
              },
              fields: 'gridProperties.columnCount',
            },
          });
        }

        if (requests.length > 0) {
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanTargetId}:batchUpdate`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ requests }),
          });
        }
      }
    }
  } catch (gridExpandErr) {
    console.warn('Grid dimension auto-adjustment notice:', gridExpandErr);
  }

  // 1. Fetch template formulas from Row `startRow` (Row 3) for unmapped formula columns
  let templateFormulasByCol: Map<number, string> = new Map();
  try {
    const formulaFetchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanTargetId}/values/${encodeURIComponent(
      `${safeTabName}!A${startRow}:ZZ${startRow}`
    )}?valueRenderOption=FORMULA`;
    const formRes = await fetch(formulaFetchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (formRes.ok) {
      const formJson: any = await formRes.json();
      const firstRowFormulas: any[] = formJson.values?.[0] || [];
      firstRowFormulas.forEach((cellVal, colIdx) => {
        const valStr = String(cellVal || '').trim();
        // If it is a formula and not mapped from IATD
        const isMapped = activeColumns.some((c) => c.encIndex === colIdx);
        if (valStr.startsWith('=') && !isMapped) {
          templateFormulasByCol.set(colIdx, valStr);
        }
      });
    }
  } catch (formulaInspectErr) {
    console.warn('Could not inspect template row formulas:', formulaInspectErr);
  }

  // 2. Clear old data in mapped columns
  if (clearOldData) {
    const clearRanges = activeColumns.map(
      (col) => `${safeTabName}!${col.colLetter}${startRow}:${col.colLetter}`
    );

    try {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanTargetId}/values:batchClear`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ranges: clearRanges,
          }),
        }
      );
    } catch (e) {
      console.warn('Could not batch clear mapped columns before writing:', e);
    }
  }

  // 3. Prepare column-by-column payload for values:batchUpdate
  // Use chunk size of 2500 rows to execute in 1 single request for almost all datasets
  const CHUNK_SIZE = 2500;

  for (let offset = 0; offset < totalRowCount; offset += CHUNK_SIZE) {
    const chunkRows = validIatdRows.slice(offset, offset + CHUNK_SIZE);
    const chunkStartRow = startRow + offset;
    const chunkEndRow = chunkStartRow + chunkRows.length - 1;

    const batchData = activeColumns.map((col) => {
      const columnValues = chunkRows.map((r) => {
        const val = r[col.iatdIndex];
        return val !== undefined && val !== null ? val : '';
      });

      return {
        range: `${safeTabName}!${col.colLetter}${chunkStartRow}:${col.colLetter}${chunkEndRow}`,
        majorDimension: 'COLUMNS',
        values: [columnValues],
      };
    });

    // Replicate unmapped template formulas down to item rows (leaving trailing Total Quantity: and v.X.X.X footer rows clean)
    const formulaMaxRow = startRow + itemRowCount - 1;
    if (templateFormulasByCol.size > 0 && chunkStartRow <= formulaMaxRow) {
      const effectiveFormulaEndRow = Math.min(chunkEndRow, formulaMaxRow);
      templateFormulasByCol.forEach((baseFormula, colIdx) => {
        const colLetter = numberToColumnLetter(colIdx);
        const colFormulas: string[] = [];
        for (let r = chunkStartRow; r <= effectiveFormulaEndRow; r++) {
          colFormulas.push(adjustFormulaRowReferences(baseFormula, startRow, r));
        }

        batchData.push({
          range: `${safeTabName}!${colLetter}${chunkStartRow}:${colLetter}${effectiveFormulaEndRow}`,
          majorDimension: 'COLUMNS',
          values: [colFormulas],
        });
      });
    }

    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanTargetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: batchData,
        }),
      }
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      throw parseGoogleApiError(updateRes.status, errText, 'Sheets');
    }
  }

  const webViewLink = `https://docs.google.com/spreadsheets/d/${cleanTargetId}/edit`;
  // Ensure the generated encoding spreadsheet is stored inside the user's "Generated Encoding" folder in Google Drive
  const encodingFolder = await ensureUserDriveFolder(accessToken, GENERATED_ENCODING_FOLDER_NAME);
  if (encodingFolder?.folderId) {
    await moveFileToDriveFolder(accessToken, cleanTargetId, encodingFolder.folderId);
  }

  return {
    totalRowsWritten: totalRowCount,
    spreadsheetId: cleanTargetId,
    webViewLink,
    mappedColumnsCount: activeColumns.length,
    adjustedRowsCount: endRow,
    folderId: encodingFolder?.folderId,
    folderName: encodingFolder?.folderName || GENERATED_ENCODING_FOLDER_NAME,
    folderWebViewLink: encodingFolder?.webViewLink,
  };
}

/**
 * Adjusts relative row references in a spreadsheet formula from `startRow` to `targetRow`.
 * Correctly handles single-letter and multi-letter columns with or without `$` column locks
 * (e.g. `$L3` -> `$L4`, `$CW3` -> `$CW4`, `L3` -> `L4`) while preserving locked rows
 * (`$L$3`, `L$3`) and text inside double-quoted string literals.
 */
export function adjustFormulaRowReferences(
  baseFormula: string,
  startRow: number,
  targetRow: number
): string {
  if (targetRow === startRow || !baseFormula.startsWith('=')) {
    return baseFormula;
  }
  const parts = baseFormula.split(/("[^"]*")/g);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return part.replace(
        /(?<![A-Za-z0-9_$])(\$?[A-Za-z]{1,3})(\$?)([0-9]+)(?![A-Za-z0-9_(!])/g,
        (fullMatch, colPart: string, rowDollar: string, rowNumStr: string) => {
          if (rowDollar === '$') return fullMatch;
          const rowNum = parseInt(rowNumStr, 10);
          if (rowNum === startRow) {
            return `${colPart}${targetRow}`;
          }
          return fullMatch;
        }
      );
    })
    .join('');
}

// Generate CS01 to CS{N} countsheet columns placed after Remarks, followed by 1 space column, followed by Total Actual,
// automatically ADDS (inserts) or DELETES excess columns to match target count,
// and updates the Total Actual formula (=SUM(CS01:CS{N})) as well as subsequent formula columns for all item data rows.
export async function setupCountsheetHeadersInTemplate(
  rawAccessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  headerRow: number = 2,
  numCountsheets: number = 70,
  totalDataRows: number = 500,
  autoAdjustColumns: boolean = true
): Promise<{
  startColLetter: string;
  endColLetter: string;
  totalColumns: number;
  remarksColLetter: string;
  totalActualColLetter: string;
}> {
  const accessToken = (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const safeTabName = `'${sheetTitle.replace(/'/g, "''")}'`;

  // 1. Fetch sheet metadata (sheetId, rowCount, columnCount)
  let sheetId = 0;
  let gridRowCount = 1000;
  let gridColCount = 50;

  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=sheets.properties(sheetId,title,gridProperties)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (metaRes.ok) {
      const metaData: any = await metaRes.json();
      const currentSheet = (metaData.sheets || []).find(
        (s: any) => s.properties?.title === sheetTitle
      );
      if (currentSheet?.properties) {
        sheetId = currentSheet.properties.sheetId ?? 0;
        gridRowCount = currentSheet.properties.gridProperties?.rowCount || 1000;
        gridColCount = currentSheet.properties.gridProperties?.columnCount || 50;
      }
    }
  } catch (err) {
    console.warn('Could not fetch sheet properties:', err);
  }

  // 2. Fetch rows 1..(headerRow + 1) with FORMULA render option so we can inspect
  //    headerRow, any merged top headers in Row 1, and Row 3 formulas (e.g. =SUM for Total Actual)
  const dataStartRow = headerRow + 1;
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
    `${safeTabName}!A1:ZZ${dataStartRow}`
  )}?majorDimension=ROWS&valueRenderOption=FORMULA`;

  const res = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw parseGoogleApiError(res.status, err, 'Sheets');
  }

  const data: any = await res.json();
  const fetchedRows: any[][] = data.values || [];
  const topRow: string[] = (fetchedRows[0] || []).map((c: any) => String(c || '').trim());
  const currentRow: string[] = (fetchedRows[headerRow - 1] || []).map((c: any) => String(c || '').trim());
  const firstDataRowFormulas: string[] = (fetchedRows[headerRow] || []).map((c: any) => String(c || '').trim());

  // 3. Find index of 'Remarks' column & 'CS01' column
  let remarksIdx = currentRow.findIndex((h) => /^remarks?$|^notes?$/i.test(h.trim()));
  let cs01Idx = currentRow.findIndex((h) => /^cs0*1$/i.test(h.trim()));

  if (cs01Idx === -1 && remarksIdx !== -1) {
    cs01Idx = remarksIdx + 1;
  } else if (remarksIdx === -1 && cs01Idx !== -1) {
    remarksIdx = Math.max(0, cs01Idx - 1);
  } else if (remarksIdx === -1 && cs01Idx === -1) {
    let lastNonEmpty = -1;
    currentRow.forEach((val, idx) => {
      if (val.trim()) lastNonEmpty = idx;
    });
    remarksIdx = Math.max(0, lastNonEmpty);
    cs01Idx = remarksIdx + 1;
  }

  // Count existing CS columns in template (e.g. CS01 to CS70)
  let existingCsCount = 0;
  for (let i = cs01Idx; i < currentRow.length; i++) {
    const val = currentRow[i] || '';
    if (/^cs0*[0-9]+$/i.test(val)) {
      existingCsCount++;
    } else {
      break;
    }
  }

  // Locate existing 'Total Actual' column index in the template so we preserve
  // Total Actual and all formula columns after it, with exactly 1 space column before Total Actual.
  const maxInspectCols = Math.max(currentRow.length, topRow.length, firstDataRowFormulas.length);
  let templateTotalActualIdx = -1;

  for (let i = cs01Idx + Math.max(1, existingCsCount); i < maxInspectCols; i++) {
    const hVal = currentRow[i] || '';
    const topVal = headerRow > 1 ? topRow[i] || '' : '';
    if (/total\s*actual|actual\s*total|total\s*count/i.test(hVal) || /total\s*actual|actual\s*total|total\s*count/i.test(topVal)) {
      templateTotalActualIdx = i;
      break;
    }
  }

  if (templateTotalActualIdx === -1) {
    for (let i = cs01Idx + Math.max(1, existingCsCount); i < maxInspectCols; i++) {
      const fVal = firstDataRowFormulas[i] || '';
      if (/^=SUM\(/i.test(fVal)) {
        templateTotalActualIdx = i;
        break;
      }
    }
  }

  // Desired span strictly before Total Actual is: numCountsheets CS columns + 1 space column
  const desiredColsBeforeTotalActual = numCountsheets + 1;
  const existingColsBeforeTotalActual =
    templateTotalActualIdx > cs01Idx
      ? templateTotalActualIdx - cs01Idx
      : existingCsCount > 0
      ? existingCsCount + 1
      : 0;

  // 4. Adjust Columns so that [CS01..CS{N}] + [1 space column] sit strictly before [Total Actual]
  if (autoAdjustColumns || templateTotalActualIdx !== -1 || existingCsCount > 0) {
    const colDiff = desiredColsBeforeTotalActual - existingColsBeforeTotalActual;

    if (colDiff > 0) {
      // ADD / INSERT columns before Total Actual
      const colsToInsert = colDiff;
      const insertStartIndex = cs01Idx + existingCsCount;

      try {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                insertDimension: {
                  range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: insertStartIndex,
                    endIndex: insertStartIndex + colsToInsert,
                  },
                  inheritFromBefore: existingCsCount > 0,
                },
              },
            ],
          }),
        });
      } catch (insertErr) {
        console.warn('Could not insertDimension, fallback to expanding column count:', insertErr);
        const requiredTotalCols = insertStartIndex + colsToInsert + 10;
        if (requiredTotalCols > gridColCount) {
          try {
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}:batchUpdate`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                requests: [
                  {
                    updateSheetProperties: {
                      properties: {
                        sheetId,
                        gridProperties: {
                          columnCount: requiredTotalCols,
                        },
                      },
                      fields: 'gridProperties.columnCount',
                    },
                  },
                ],
              }),
            });
          } catch (e) {
            console.warn('Could not expand grid column count:', e);
          }
        }
      }
    } else if (colDiff < 0) {
      // DELETE excess columns before Total Actual, leaving numCountsheets CS columns + 1 space column
      const colsToDelete = Math.abs(colDiff);
      const deleteStartIndex = cs01Idx + numCountsheets;
      const deleteEndIndex = deleteStartIndex + colsToDelete;

      try {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: deleteStartIndex,
                    endIndex: deleteEndIndex,
                  },
                },
              },
            ],
          }),
        });
      } catch (deleteErr) {
        console.warn('Could not deleteDimension for excess CS columns:', deleteErr);
      }
    }
  }

  // 5. Build full CS01 .. CS{N} headers, 1 space column, and Total Actual
  const csHeaders: string[] = [];
  for (let i = 1; i <= numCountsheets; i++) {
    csHeaders.push(`CS${String(i).padStart(2, '0')}`);
  }

  const csStartColIdx = cs01Idx;
  const csEndColIdx = csStartColIdx + numCountsheets - 1;
  const spacerColIdx = csEndColIdx + 1;
  const totalActualColIdx = spacerColIdx + 1;

  const startLetter = numberToColumnLetter(csStartColIdx);
  const endLetter = numberToColumnLetter(csEndColIdx);
  const spacerLetter = numberToColumnLetter(spacerColIdx);
  const totalActualLetter = numberToColumnLetter(totalActualColIdx);

  // Clear the spacer column completely so it acts as a clean space column before Total Actual
  try {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values:batchClear`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ranges: [`${safeTabName}!${spacerLetter}${headerRow}:${spacerLetter}`],
        }),
      }
    );
  } catch (clearSpacerErr) {
    console.warn('Could not clear spacer column:', clearSpacerErr);
  }

  // 6. Ensure exact row count matching the last row (e.g. v.1.26.26) with zero extra rows after it
  const rowsToPopulate = Math.max(1, totalDataRows);
  const exactEndRow = dataStartRow + rowsToPopulate - 1;

  if (exactEndRow !== gridRowCount && sheetId !== undefined) {
    try {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: {
                    rowCount: exactEndRow,
                  },
                },
                fields: 'gridProperties.rowCount',
              },
            },
          ],
        }),
      });
      gridRowCount = exactEndRow;
    } catch (e) {
      console.warn('Could not adjust row count for formulas:', e);
    }
  }

  // Inspect the last 2 rows of the sheet to check if they are IATD footer rows ("Total Quantity:" and "v.X.X.X")
  // so item-level =SUM(CS01:CSn) and variance formulas do not overwrite the footer rows
  let detectedFooterRows = 0;
  if (rowsToPopulate >= 2) {
    try {
      const tailStartRow = Math.max(dataStartRow, exactEndRow - 1);
      const tailRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
          `${safeTabName}!A${tailStartRow}:N${exactEndRow}`
        )}?majorDimension=ROWS`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (tailRes.ok) {
        const tailJson: any = await tailRes.json();
        const tailRows: any[][] = tailJson.values || [];
        if (tailRows.length >= 1) {
          const lastR = tailRows[tailRows.length - 1] || [];
          const prevR = tailRows.length >= 2 ? tailRows[tailRows.length - 2] : undefined;
          if (isIatdVersionFooterRow(lastR, prevR)) {
            detectedFooterRows = 1;
            if (prevR && isIatdTotalQuantityFooterRow(prevR)) {
              detectedFooterRows = 2;
            }
          } else if (isIatdTotalQuantityFooterRow(lastR)) {
            detectedFooterRows = 1;
          }
        }
      }
    } catch {}
  }

  const formulaRowsToPopulate = Math.max(1, rowsToPopulate - detectedFooterRows);

  // Re-fetch Row `dataStartRow` formulas after column insertion/deletion so we have the
  // exact post-shift column positions and formulas for all columns after Total Actual
  const postCsFormulasByCol: Map<number, string> = new Map();
  try {
    const postShiftFormulaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
        `${safeTabName}!A${dataStartRow}:ZZ${dataStartRow}`
      )}?majorDimension=ROWS&valueRenderOption=FORMULA`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (postShiftFormulaRes.ok) {
      const postShiftJson: any = await postShiftFormulaRes.json();
      const rowFormulas: any[] = postShiftJson.values?.[0] || [];
      for (let colIdx = totalActualColIdx + 1; colIdx < rowFormulas.length; colIdx++) {
        let fStr = String(rowFormulas[colIdx] || '').trim();
        if (fStr.startsWith('=')) {
          // If a post-CS formula accidentally pointed to the spacer column instead of Total Actual, point it to Total Actual
          const spacerRefRegex = new RegExp(
            `(?<![A-Za-z0-9_$])(\\$?)${spacerLetter}(\\$?${dataStartRow})(?![A-Za-z0-9_(!])`,
            'g'
          );
          fStr = fStr.replace(spacerRefRegex, `$1${totalActualLetter}$2`);
          postCsFormulasByCol.set(colIdx, fStr);
        }
      }
    }
  } catch (postFormulaErr) {
    console.warn('Could not inspect post-CS formulas after column shift:', postFormulaErr);
  }

  // 7. Write Row 2 Headers, Total Actual Formulas, and Post-CS Formula Columns in chunked batchUpdate calls
  const headersToWrite = [...csHeaders, '', 'Total Actual'];
  const targetHeaderRange = `${safeTabName}!${startLetter}${headerRow}:${totalActualLetter}${headerRow}`;

  const formulaChunkSize = 2500;
  for (let offset = 0; offset < formulaRowsToPopulate; offset += formulaChunkSize) {
    const chunkRowCount = Math.min(formulaChunkSize, formulaRowsToPopulate - offset);
    const chunkStartRow = dataStartRow + offset;
    const chunkEndRow = chunkStartRow + chunkRowCount - 1;

    const totalActualFormulas: string[] = [];
    for (let r = chunkStartRow; r <= chunkEndRow; r++) {
      totalActualFormulas.push(`=SUM(${startLetter}${r}:${endLetter}${r})`);
    }

    const formulaRange = `${safeTabName}!${totalActualLetter}${chunkStartRow}:${totalActualLetter}${chunkEndRow}`;

    const batchData: any[] = [];
    if (offset === 0) {
      batchData.push({
        range: targetHeaderRange,
        majorDimension: 'ROWS',
        values: [headersToWrite],
      });
    }
    batchData.push({
      range: formulaRange,
      majorDimension: 'COLUMNS',
      values: [totalActualFormulas],
    });

    // Populate all formula columns after Total Actual with properly adjusted row references ($L3 -> $L4, etc.)
    if (postCsFormulasByCol.size > 0) {
      postCsFormulasByCol.forEach((baseFormula, colIdx) => {
        const colLetter = numberToColumnLetter(colIdx);
        const colFormulas: string[] = [];
        for (let r = chunkStartRow; r <= chunkEndRow; r++) {
          colFormulas.push(adjustFormulaRowReferences(baseFormula, dataStartRow, r));
        }
        batchData.push({
          range: `${safeTabName}!${colLetter}${chunkStartRow}:${colLetter}${chunkEndRow}`,
          majorDimension: 'COLUMNS',
          values: [colFormulas],
        });
      });
    }

    try {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: batchData,
          }),
        }
      );
    } catch (writeErr) {
      console.warn(`Could not update countsheet headers / formulas for rows ${chunkStartRow}-${chunkEndRow}:`, writeErr);
    }
  }

  // Clear any formula cells on the trailing IATD footer rows ("Total Quantity:" and "v.X.X.X") in Total Actual & post-CS columns
  if (detectedFooterRows > 0) {
    const footerStartRow = dataStartRow + formulaRowsToPopulate;
    const maxFormulaColIdx = Math.max(
      totalActualColIdx,
      ...Array.from(postCsFormulasByCol.keys())
    );
    const maxFormulaColLetter = numberToColumnLetter(maxFormulaColIdx);
    try {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values:batchClear`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ranges: [
              `${safeTabName}!${totalActualLetter}${footerStartRow}:${maxFormulaColLetter}${exactEndRow}`,
            ],
          }),
        }
      );
    } catch {}
  }

  // 8. Auto-adjust grid column count and strictly lock rowCount to exactEndRow (zero rows after v.X.X.X)
  if (sheetId !== undefined) {
    try {
      const postHeadersRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
          `${safeTabName}!A${headerRow}:ZZ${headerRow}`
        )}?majorDimension=ROWS`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (postHeadersRes.ok) {
        const postData: any = await postHeadersRes.json();
        const fullHeaderRow: string[] = postData.values?.[0] || [];
        let maxColWithHeader = 0;
        fullHeaderRow.forEach((val, idx) => {
          if (String(val || '').trim().length > 0) {
            maxColWithHeader = Math.max(maxColWithHeader, idx);
          }
        });
        postCsFormulasByCol.forEach((_, colIdx) => {
          maxColWithHeader = Math.max(maxColWithHeader, colIdx);
        });
        const targetColCount = Math.max(maxColWithHeader + 3, totalActualColIdx + 5, 26);
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId,
                    gridProperties: {
                      rowCount: exactEndRow,
                      ...(autoAdjustColumns ? { columnCount: targetColCount } : {}),
                    },
                  },
                  fields: autoAdjustColumns
                    ? 'gridProperties(rowCount,columnCount)'
                    : 'gridProperties.rowCount',
                },
              },
            ],
          }),
        });
      }
    } catch (trimErr) {
      console.warn('Could not trim grid dimensions:', trimErr);
    }
  }

  // 9. Also synchronize the MONITORING tab so its Countsheet No. rows under Row 6 match numCountsheets (e.g. 1-5 .. 21-25) + 3 blank buffer rows
  try {
    await setupMonitoringTabInTemplate(accessToken, cleanId, numCountsheets);
  } catch (monErr) {
    console.warn('Could not configure MONITORING tab countsheet ranges:', monErr);
  }

  return {
    startColLetter: startLetter,
    endColLetter: endLetter,
    totalColumns: numCountsheets,
    remarksColLetter: numberToColumnLetter(remarksIdx),
    totalActualColLetter: totalActualLetter,
  };
}

/**
 * Rename an existing Google Spreadsheet in Google Drive and update its title property.
 */
export async function renameSpreadsheetInDrive(
  rawAccessToken: string,
  spreadsheetId: string,
  newTitle: string
): Promise<boolean> {
  const trimmedTitle = newTitle.trim();
  const cleanId = extractSpreadsheetId(spreadsheetId);
  if (!cleanId || !trimmedTitle) return false;
  const accessToken =
    (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            updateSpreadsheetProperties: {
              properties: { title: trimmedTitle },
              fields: 'title',
            },
          },
        ],
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn('Could not rename spreadsheet in Drive:', err);
    return false;
  }
}

/**
 * Configures the MONITORING tab in the generated Encoding spreadsheet:
 * - Row 6 has the header "Countsheet No."
 * - Rows 7 onwards contain 5-countsheet ranges per row: 1-5, 6-10, 11-15, ..., up to `numCountsheets`
 *   (e.g., if `numCountsheets` = 25, rows 7..11 are 1-5, 6-10, 11-15, 16-20, 21-25).
 * - Followed by 3 blank rows as a buffer / space (and removes any excess rows like 26-30 .. 145-150).
 */
export async function setupMonitoringTabInTemplate(
  rawAccessToken: string,
  spreadsheetId: string,
  numCountsheets: number = 100
): Promise<{
  monitoringSheetTitle?: string;
  rangeRowsWritten: number;
  bufferBlankRows: number;
}> {
  const accessToken =
    (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const BUFFER_BLANK_ROWS = 3;
  const effectiveCs = Math.max(1, Math.round(numCountsheets || 1));
  const neededRangeRows = Math.max(1, Math.ceil(effectiveCs / 5));
  const totalTableRows = neededRangeRows + BUFFER_BLANK_ROWS;

  // 1. Find the MONITORING sheet tab metadata
  let monitoringSheetId: number | undefined;
  let monitoringSheetTitle = 'MONITORING';
  let monitoringRowCount = 100;
  let monitoringColCount = 20;

  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=sheets.properties(sheetId,title,gridProperties)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      return { rangeRowsWritten: 0, bufferBlankRows: BUFFER_BLANK_ROWS };
    }
    const metaData: any = await metaRes.json();
    const sheets: any[] = metaData.sheets || [];
    const monSheet = sheets.find((s: any) => {
      const t = String(s.properties?.title || '')
        .trim()
        .toUpperCase()
        .replace(/[\s_-]/g, '');
      return t === 'MONITORING' || t.includes('MONITOR');
    });
    if (!monSheet?.properties) {
      return { rangeRowsWritten: 0, bufferBlankRows: BUFFER_BLANK_ROWS };
    }
    monitoringSheetId = monSheet.properties.sheetId ?? 0;
    monitoringSheetTitle = monSheet.properties.title || 'MONITORING';
    monitoringRowCount = monSheet.properties.gridProperties?.rowCount || 100;
    monitoringColCount = monSheet.properties.gridProperties?.columnCount || 20;
  } catch (err) {
    console.warn('Could not read MONITORING sheet metadata:', err);
    return { rangeRowsWritten: 0, bufferBlankRows: BUFFER_BLANK_ROWS };
  }

  const safeMonTab = `'${monitoringSheetTitle.replace(/'/g, "''")}'`;

  // 2. Read A1:Z60 of MONITORING to locate Row 6 "Countsheet No." column(s) and existing range rows (1-5 .. 145-150)
  let rows: any[][] = [];
  try {
    const valRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
        `${safeMonTab}!A1:Z60`
      )}?majorDimension=ROWS`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (valRes.ok) {
      const valData: any = await valRes.json();
      rows = valData.values || [];
    }
  } catch (err) {
    console.warn('Could not read MONITORING tab values:', err);
  }

  // Locate header row (Row 6 = 1-indexed 6, 0-indexed 5 by default) and all "Countsheet No." columns
  let headerRow1Indexed = 6;
  let csRangeColIndices: number[] = [];

  // First check Row 6 (index 5) specifically, then scan rows 1..10 if needed
  const candidateRowIndices = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9];
  for (const rIdx of candidateRowIndices) {
    const r = rows[rIdx] || [];
    const matchedCols: number[] = [];
    r.forEach((cell: any, cIdx: number) => {
      const text = String(cell || '').trim().toLowerCase();
      if (
        text.includes('countsheet no') ||
        text.includes('countsheet #') ||
        text === 'countsheet' ||
        text === 'cs no.' ||
        text === 'cs no'
      ) {
        matchedCols.push(cIdx);
      }
    });
    if (matchedCols.length > 0) {
      headerRow1Indexed = rIdx + 1;
      csRangeColIndices = matchedCols;
      break;
    }
  }

  // Fallback: detect column(s) where Row 7 (index 6) has "1-5"
  if (csRangeColIndices.length === 0) {
    const row7 = rows[6] || [];
    row7.forEach((cell: any, cIdx: number) => {
      const text = String(cell || '').trim();
      if (/^1\s*[-–to]+\s*5$/i.test(text)) {
        csRangeColIndices.push(cIdx);
      }
    });
    if (csRangeColIndices.length === 0) {
      csRangeColIndices = [0]; // Default Column A
    }
  }

  const dataStartRow1Indexed = headerRow1Indexed + 1; // Row 7 when header is Row 6
  const dataStartRow0Indexed = dataStartRow1Indexed - 1; // 0-indexed 6
  const primaryCsColIdx = csRangeColIndices[0] ?? 0;

  // 3. Detect how many existing countsheet range rows currently exist in the template (e.g. 1-5 .. 145-150 = 30 rows)
  const isRangeCellValue = (val: any): boolean => {
    const s = String(val || '').trim();
    if (!s) return false;
    // Matches "1-5", "6-10", "145-150", "146-150", or date-coerced "1/5", "Jan 5", "5-Jan"
    if (/^\d+\s*[-–to]+\s*\d+$/i.test(s)) return true;
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+\d{1,2}$/i.test(s)) return true;
    if (/^\d{1,2}[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i.test(s)) return true;
    return false;
  };

  let lastExistingRangeRow0Indexed = -1;
  let firstFooterRow0Indexed = -1;

  for (let rIdx = dataStartRow0Indexed; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx] || [];
    const cellVal = r[primaryCsColIdx];
    if (isRangeCellValue(cellVal)) {
      lastExistingRangeRow0Indexed = rIdx;
    } else if (lastExistingRangeRow0Indexed !== -1) {
      const rowJoined = r.map((c: any) => String(c || '').trim()).join(' ').trim();
      if (rowJoined.length > 0) {
        firstFooterRow0Indexed = rIdx;
        break;
      }
    }
  }

  const existingTableSpanRows =
    firstFooterRow0Indexed > dataStartRow0Indexed
      ? firstFooterRow0Indexed - dataStartRow0Indexed
      : lastExistingRangeRow0Indexed >= dataStartRow0Indexed
      ? lastExistingRangeRow0Indexed - dataStartRow0Indexed + 1
      : Math.max(0, monitoringRowCount - dataStartRow0Indexed);

  // 4. Adjust rows in MONITORING tab so the Countsheet No. table has `neededRangeRows + 3` rows
  if (monitoringSheetId !== undefined) {
    const dimensionRequests: any[] = [];
    const rowDiff = totalTableRows - existingTableSpanRows;

    if (existingTableSpanRows > 0 && rowDiff < 0) {
      // Delete excess countsheet range rows (e.g., rows after 21-25 + 3 blanks up to 145-150)
      const deleteStart0 = dataStartRow0Indexed + totalTableRows;
      const deleteEnd0 = Math.min(monitoringRowCount, dataStartRow0Indexed + existingTableSpanRows);
      if (deleteEnd0 > deleteStart0) {
        dimensionRequests.push({
          deleteDimension: {
            range: {
              sheetId: monitoringSheetId,
              dimension: 'ROWS',
              startIndex: deleteStart0,
              endIndex: deleteEnd0,
            },
          },
        });
        monitoringRowCount -= deleteEnd0 - deleteStart0;
      }
    } else if (rowDiff > 0) {
      // Insert additional rows inheriting borders/formatting from the last existing range row
      const insertAt0 =
        lastExistingRangeRow0Indexed >= dataStartRow0Indexed
          ? lastExistingRangeRow0Indexed + 1
          : Math.min(monitoringRowCount, dataStartRow0Indexed + Math.max(1, existingTableSpanRows));
      dimensionRequests.push({
        insertDimension: {
          range: {
            sheetId: monitoringSheetId,
            dimension: 'ROWS',
            startIndex: insertAt0,
            endIndex: insertAt0 + rowDiff,
          },
          inheritFromBefore: insertAt0 > dataStartRow0Indexed,
        },
      });
      monitoringRowCount += rowDiff;
    }

    // If there is no footer section below the countsheet table, set the sheet rowCount to end right after the 3 blank buffer rows
    const desiredFinalRowCount = dataStartRow0Indexed + totalTableRows;
    if (firstFooterRow0Indexed === -1 && monitoringRowCount !== desiredFinalRowCount) {
      dimensionRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: monitoringSheetId,
            gridProperties: {
              rowCount: Math.max(desiredFinalRowCount, headerRow1Indexed + 4),
            },
          },
          fields: 'gridProperties.rowCount',
        },
      });
    }

    // Format the Countsheet No. column(s) as plain TEXT so Google Sheets never converts "1-5" or "6-10" into dates
    for (const colIdx of csRangeColIndices) {
      dimensionRequests.push({
        repeatCell: {
          range: {
            sheetId: monitoringSheetId,
            startRowIndex: dataStartRow0Indexed,
            endRowIndex: dataStartRow0Indexed + totalTableRows,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: 'TEXT',
              },
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
        },
      });
    }

    if (dimensionRequests.length > 0) {
      try {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests: dimensionRequests }),
        });
      } catch (dimErr) {
        console.warn('Could not adjust MONITORING sheet row dimensions:', dimErr);
      }
    }
  }

  // 5. Build the Countsheet No. range labels: 1-5, 6-10, 11-15, ..., followed by 3 blank buffer rows
  const rangeValuesCol: string[] = [];
  for (let i = 0; i < neededRangeRows; i++) {
    const rangeStart = i * 5 + 1;
    const rangeEnd = Math.min((i + 1) * 5, Math.max((i + 1) * 5, effectiveCs));
    rangeValuesCol.push(`${rangeStart}-${rangeEnd}`);
  }
  for (let b = 0; b < BUFFER_BLANK_ROWS; b++) {
    rangeValuesCol.push('');
  }

  const endTableRow1Indexed = dataStartRow1Indexed + totalTableRows - 1;
  const bufferStartRow1Indexed = dataStartRow1Indexed + neededRangeRows;

  // Clear the 3 buffer rows across the table width so they are clean blank buffer rows
  if (bufferStartRow1Indexed <= endTableRow1Indexed) {
    const maxColLetter = numberToColumnLetter(Math.max(10, monitoringColCount - 1));
    try {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values:batchClear`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ranges: [`${safeMonTab}!A${bufferStartRow1Indexed}:${maxColLetter}${endTableRow1Indexed}`],
        }),
      });
    } catch {}
  }

  // Write the Countsheet No. range strings (1-5, 6-10, ..., 21-25, plus 3 blanks) using RAW input so "1-5" stays literal "1-5"
  const batchData = csRangeColIndices.map((colIdx) => {
    const colLetter = numberToColumnLetter(colIdx);
    return {
      range: `${safeMonTab}!${colLetter}${dataStartRow1Indexed}:${colLetter}${endTableRow1Indexed}`,
      majorDimension: 'COLUMNS',
      values: [rangeValuesCol],
    };
  });

  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: batchData,
      }),
    });
  } catch (writeErr) {
    console.warn('Could not write MONITORING Countsheet No. ranges:', writeErr);
  }

  return {
    monitoringSheetTitle,
    rangeRowsWritten: neededRangeRows,
    bufferBlankRows: BUFFER_BLANK_ROWS,
  };
}

// Create a new Google Spreadsheet in Drive formatted specifically as a Countsheet
export async function createCountsheetGoogleSpreadsheet(
  accessToken: string,
  title: string,
  csNumber: number,
  items: Array<{
    itemCode?: string;
    barcode?: string;
    itemDescription: string;
    category?: string;
    subCategory?: string;
    subsubCategory?: string;
    unit?: string;
    balance?: number;
    actualCount?: number;
  }>,
  auditorName: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const csLabel = `CS${String(csNumber).padStart(2, '0')}`;
  const nowStr = new Date().toISOString().split('T')[0];

  // 1. Create new spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: title || `${csLabel} - Random Inventory Countsheet (${nowStr})`,
      },
      sheets: [
        {
          properties: {
            title: 'COUNTSHEET',
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw parseGoogleApiError(createRes.status, errText, 'Sheets');
  }

  const createdData: any = await createRes.json();
  const spreadsheetId = createdData.spreadsheetId;
  const webViewLink = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // 2. Prepare headers and rows
  const headers = [
    'Item Code',
    'Barcode',
    'Item Description',
    'Category',
    'SubCategory',
    'SubSubCategory',
    'Unit',
    'Balance',
    'Actual Count',
    'Countsheet',
    'Auditor',
    'Date',
  ];

  const dataRows = items.map((item) => [
    item.itemCode || '',
    item.barcode || '',
    item.itemDescription || '',
    item.category || '',
    item.subCategory || '',
    item.subsubCategory || '',
    item.unit || '',
    item.balance !== undefined ? String(item.balance) : '',
    item.actualCount !== undefined && item.actualCount !== 0 ? String(item.actualCount) : '',
    csLabel,
    auditorName || '',
    nowStr,
  ]);

  const allValues = [headers, ...dataRows];

  // 3. Write rows into COUNTSHEET tab
  const range = encodeURIComponent("'COUNTSHEET'!A1");
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: "'COUNTSHEET'!A1",
        majorDimension: 'ROWS',
        values: allValues,
      }),
    }
  );

  if (!writeRes.ok) {
    const errText = await writeRes.text();
    console.warn('Notice writing values to countsheet:', errText);
  }

  return {
    id: spreadsheetId,
    name: title || `${csLabel} - Random Inventory Countsheet`,
    webViewLink,
  };
}

// ---------------------------------------------------------------------------
// Template-Driven Countsheet Generator (Rows 8 header, Rows 9-42 items, 34 items/sheet)
// ---------------------------------------------------------------------------

export const DEFAULT_COUNTSHEET_TEMPLATE_URL =
  'https://docs.google.com/spreadsheets/d/1vaA4Tv8Be_R7LLsYMGiUrHQg1M3qtftejYCGIudSA5w/edit?gid=1328306184#gid=1328306184';
export const DEFAULT_COUNTSHEET_TEMPLATE_ID = '1vaA4Tv8Be_R7LLsYMGiUrHQg1M3qtftejYCGIudSA5w';
export const DEFAULT_COUNTSHEET_TEMPLATE_GID = '1328306184';

export interface GroupCountsheetPlanItem {
  id?: string;
  itemCode?: string;
  itemDescription?: string;
  cost?: number;
  selling?: number;
  balance?: number;
  unit?: string;
  barcode?: string;
  category?: string;
  subCategory?: string;
  subsubCategory?: string;
}

export interface GroupCountsheetPlan {
  groupId: string;
  groupName: string;
  baseSheetName: string; // Last selected category, subcategory, or subsubcategory
  items: GroupCountsheetPlanItem[];
}

export interface CreateCountsheetFromTemplateOptions {
  accessToken: string;
  templateSpreadsheetId?: string;
  templateGid?: string | number;
  targetSpreadsheetTitle?: string;
  existingSpreadsheetId?: string;
  insertCategorySpacers?: boolean;
  groups: GroupCountsheetPlan[];
  onProgress?: (status: string) => void;
}

export interface CreatedCountsheetTabSummary {
  sheetId: number;
  title: string;
  itemCount: number;
  groupName: string;
  partNumber: number;
  totalParts: number;
}

export interface CreateCountsheetFromTemplateResult {
  spreadsheetId: string;
  spreadsheetName: string;
  webViewLink: string;
  sheetsCreated: CreatedCountsheetTabSummary[];
  totalSheets: number;
  totalItems: number;
  folderId?: string;
  folderName?: string;
  folderWebViewLink?: string;
}

export const COUNTSHEET_DESC_MAX_CHARS = 50;
export const COUNTSHEET_MAX_ROWS_PER_SHEET = 34;

export interface CountsheetTemplateCutoffRow {
  docLabel: string;
  dateLabel: string;
  amountLabel: string;
}

export interface CountsheetCellFontStyle {
  fontFamily: string;
  fontSizePt: number;
  bold?: boolean;
  italic?: boolean;
}

export interface CountsheetTemplateSpec {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetId: number;
  sheetTitle: string;
  formTitle: string;
  docCode: string;
  revisionLine1: string;
  revisionLine2: string;
  privacyNotice: string;
  row5Left: string;
  row5Right: string;
  row6Left: string;
  row6Right: string;
  printHeaders: {
    stockDescription: string;
    unit: string;
    actualCount: string;
    perPos: string;
    variance: string;
    remarks: string;
  };
  dataHeaders: {
    itemCode: string;
    itemDescription: string;
    cost: string;
    selling: string;
    balance: string;
    unit: string;
  };
  colWidths: {
    B: number;
    C: number;
    D: number;
    E: number;
    F: number;
    G: number;
    H: number;
    I: number;
    J: number;
    K: number;
    L: number;
    M: number;
    N: number;
    O: number;
  };
  rowHeights: {
    headerRow2: number;
    headerRow3: number;
    privacyRow4: number;
    branchRow5: number;
    branchRow6: number;
    spacerRow7: number;
    tableHeaderRow8: number;
    itemRow: number;
    declarationRow43: number;
    cutoffRow: number;
    signatoryRow: number;
  };
  fontStyles: {
    baseFontFamily: string;
    formTitle: CountsheetCellFontStyle;
    docCode: CountsheetCellFontStyle;
    revisionLine1: CountsheetCellFontStyle;
    revisionLine2: CountsheetCellFontStyle;
    privacyNotice: CountsheetCellFontStyle;
    branchInfo: CountsheetCellFontStyle;
    printTableHeader: CountsheetCellFontStyle;
    dataTableHeader: CountsheetCellFontStyle;
    itemCodeCell: CountsheetCellFontStyle;
    itemDescCell: CountsheetCellFontStyle;
    itemUnitCell: CountsheetCellFontStyle;
    dataSourceCell: CountsheetCellFontStyle;
    declaration: CountsheetCellFontStyle;
    cutoffRow: CountsheetCellFontStyle;
    signatoryHeader: CountsheetCellFontStyle;
    signatoryTitle: CountsheetCellFontStyle;
  };
  declarationLine1: string;
  declarationLine2: string;
  cutoffRows: CountsheetTemplateCutoffRow[];
  signatoryHeaders: {
    preparedBy: string;
    conformedBy: string;
    notedBy: string;
  };
  signatoryLines: {
    preparedBy: string;
    conformedBy: string;
    notedBy: string;
  };
  signatoryTitles: {
    preparedBy: string;
    conformedBy: string;
    notedBy: string;
  };
  fetchedAt: string;
}

const TEMPLATE_SPEC_STORAGE_KEY = 'audit_countsheet_template_spec_v3';
const CUSTOM_TEMPLATE_URL_STORAGE_KEY = 'audit_countsheet_template_url_v1';

export function getSavedCountsheetTemplateUrl(): string {
  try {
    const adminConfig = getAdminDriveLinksConfig();
    const parsedAdminInv = extractDriveResourceFromLink(adminConfig.inventoryTemplateLink);
    if (parsedAdminInv) {
      if (!parsedAdminInv.isFolder) {
        return parsedAdminInv.webViewLink;
      }
      // If Admin Console configured a Drive folder for Countsheet Templates and we have a resolved template from it, use that
      const resolvedFromFolder = memoryHubCountsheetTemplates?.find(
        (t) => t.id && !t.id.startsWith('hub-') && t.id !== DEFAULT_COUNTSHEET_TEMPLATE_ID
      );
      if (resolvedFromFolder?.webViewLink) {
        return resolvedFromFolder.webViewLink;
      }
      return parsedAdminInv.webViewLink;
    }
    const saved = localStorage.getItem(CUSTOM_TEMPLATE_URL_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // ignore storage errors
  }
  return DEFAULT_COUNTSHEET_TEMPLATE_URL;
}

export function saveCountsheetTemplateUrl(url: string): void {
  try {
    if (url && url.trim()) {
      localStorage.setItem(CUSTOM_TEMPLATE_URL_STORAGE_KEY, url.trim());
    } else {
      localStorage.removeItem(CUSTOM_TEMPLATE_URL_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export const DEFAULT_COUNTSHEET_TEMPLATE_SPEC: CountsheetTemplateSpec = {
  spreadsheetId: DEFAULT_COUNTSHEET_TEMPLATE_ID,
  spreadsheetTitle: 'RANDOM INVENTORY COUNTSHEET TEMPLATE',
  sheetId: Number(DEFAULT_COUNTSHEET_TEMPLATE_GID),
  sheetTitle: 'Template',
  formTitle: 'Random Inventory Count Sheet',
  docCode: 'SIDC-SS-F-ICD-005',
  revisionLine1: 'REVISION 01',
  revisionLine2: '(Effectivity Date: January 2, 2026)',
  privacyNotice:
    'Privacy Notice: Pursuant to R.A. 10173 or Data Privacy Act of 2012, all information gathered will remain confidential and will be used for specified and intended purposes only. Data will be disposed after 1 year of retention through shredding',
  row5Left: 'Branch/Project:__________________________________',
  row5Right: 'Name of Sales Clerk: ___________________________',
  row6Left: 'As of:___________________________________________',
  row6Right: 'Stockman/Warehouseman: _____________________',
  printHeaders: {
    stockDescription: 'Stock Description',
    unit: 'Pc/Box',
    actualCount: 'Actual Count',
    perPos: 'Per POS',
    variance: 'Variance',
    remarks: 'Remarks',
  },
  dataHeaders: {
    itemCode: 'Item Code',
    itemDescription: 'Item Description',
    cost: 'Cost',
    selling: 'Selling',
    balance: 'Balance',
    unit: 'Unit',
  },
  colWidths: {
    B: 80,
    C: 400,
    D: 54,
    E: 128,
    F: 76,
    G: 84,
    H: 217,
    I: 28,
    J: 95,
    K: 380,
    L: 68,
    M: 68,
    N: 68,
    O: 52,
  },
  rowHeights: {
    headerRow2: 32,
    headerRow3: 32,
    privacyRow4: 22,
    branchRow5: 20,
    branchRow6: 20,
    spacerRow7: 14,
    tableHeaderRow8: 21,
    itemRow: 19,
    declarationRow43: 28,
    cutoffRow: 19,
    signatoryRow: 20,
  },
  fontStyles: {
    baseFontFamily: 'Calibri, Arial, sans-serif',
    formTitle: { fontFamily: 'Arial, sans-serif', fontSizePt: 12, bold: true },
    docCode: { fontFamily: 'Arial, sans-serif', fontSizePt: 11.5, bold: false },
    revisionLine1: { fontFamily: 'Arial, sans-serif', fontSizePt: 10.5, bold: false },
    revisionLine2: { fontFamily: 'Arial, sans-serif', fontSizePt: 8.5, italic: true },
    privacyNotice: { fontFamily: 'Calibri, Arial, sans-serif', fontSizePt: 8, italic: true },
    branchInfo: { fontFamily: 'Calibri, Arial, sans-serif', fontSizePt: 10, bold: true },
    printTableHeader: { fontFamily: 'Arial, sans-serif', fontSizePt: 10, bold: true },
    dataTableHeader: { fontFamily: 'Calibri, Arial, sans-serif', fontSizePt: 10.5, bold: true },
    itemCodeCell: { fontFamily: 'Arial, sans-serif', fontSizePt: 9, bold: false },
    itemDescCell: { fontFamily: 'Arial, sans-serif', fontSizePt: 9, bold: false },
    itemUnitCell: { fontFamily: 'Arial, sans-serif', fontSizePt: 9, bold: false },
    dataSourceCell: { fontFamily: 'Calibri, Arial, sans-serif', fontSizePt: 9.5, bold: false },
    declaration: { fontFamily: 'Calibri, Arial, sans-serif', fontSizePt: 8, bold: false },
    cutoffRow: { fontFamily: 'Calibri, Arial, sans-serif', fontSizePt: 10, bold: false },
    signatoryHeader: { fontFamily: 'Calibri, Arial, sans-serif', fontSizePt: 10, bold: true },
    signatoryTitle: { fontFamily: 'Calibri, Arial, sans-serif', fontSizePt: 10, bold: false },
  },
  declarationLine1:
    'I Hearby declare that all the information provided is final, complete, and accurate to the best of my knowledge.',
  declarationLine2:
    '(Ako ay taos-pusong nagpapahayag na ang lahat ng impormasyong nakasaad sa itaas ay pinal, kumpleto at totoo ayon sa aking nalalaman.)',
  cutoffRows: [
    { docLabel: 'Last SI: ______________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last SB: _____________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last COLA: ___________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last CI: ______________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last RG: _____________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last RV: _____________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last RR: _____________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last SO: _____________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last ST: _____________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last SP: _____________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
    { docLabel: 'Last DR: _____________________________', dateLabel: 'Date: __________________', amountLabel: 'Amount: ____________________' },
  ],
  signatoryHeaders: {
    preparedBy: 'Prepared by:',
    conformedBy: 'Conformed by:',
    notedBy: 'Noted by:',
  },
  signatoryLines: {
    preparedBy: '__________________',
    conformedBy: '',
    notedBy: '',
  },
  signatoryTitles: {
    preparedBy: 'Auditor/Operation',
    conformedBy: 'Warehouseman/ Clerk',
    notedBy: 'Store Officer',
  },
  fetchedAt: '',
};

export function getCachedCountsheetTemplateSpec(): CountsheetTemplateSpec {
  try {
    const raw = localStorage.getItem(TEMPLATE_SPEC_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC,
        ...parsed,
        printHeaders: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.printHeaders, ...(parsed.printHeaders || {}) },
        dataHeaders: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.dataHeaders, ...(parsed.dataHeaders || {}) },
        colWidths: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths, ...(parsed.colWidths || {}) },
        rowHeights: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights, ...(parsed.rowHeights || {}) },
        fontStyles: {
          ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles,
          ...(parsed.fontStyles || {}),
          formTitle: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.formTitle, ...(parsed.fontStyles?.formTitle || {}) },
          docCode: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.docCode, ...(parsed.fontStyles?.docCode || {}) },
          revisionLine1: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.revisionLine1, ...(parsed.fontStyles?.revisionLine1 || {}) },
          revisionLine2: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.revisionLine2, ...(parsed.fontStyles?.revisionLine2 || {}) },
          privacyNotice: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.privacyNotice, ...(parsed.fontStyles?.privacyNotice || {}) },
          branchInfo: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.branchInfo, ...(parsed.fontStyles?.branchInfo || {}) },
          printTableHeader: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.printTableHeader, ...(parsed.fontStyles?.printTableHeader || {}) },
          dataTableHeader: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.dataTableHeader, ...(parsed.fontStyles?.dataTableHeader || {}) },
          itemCodeCell: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.itemCodeCell, ...(parsed.fontStyles?.itemCodeCell || {}) },
          itemDescCell: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.itemDescCell, ...(parsed.fontStyles?.itemDescCell || {}) },
          itemUnitCell: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.itemUnitCell, ...(parsed.fontStyles?.itemUnitCell || {}) },
          dataSourceCell: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.dataSourceCell, ...(parsed.fontStyles?.dataSourceCell || {}) },
          declaration: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.declaration, ...(parsed.fontStyles?.declaration || {}) },
          cutoffRow: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.cutoffRow, ...(parsed.fontStyles?.cutoffRow || {}) },
          signatoryHeader: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.signatoryHeader, ...(parsed.fontStyles?.signatoryHeader || {}) },
          signatoryTitle: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles.signatoryTitle, ...(parsed.fontStyles?.signatoryTitle || {}) },
        },
        signatoryHeaders: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryHeaders, ...(parsed.signatoryHeaders || {}) },
        signatoryLines: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryLines, ...(parsed.signatoryLines || {}) },
        signatoryTitles: { ...DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryTitles, ...(parsed.signatoryTitles || {}) },
      };
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_COUNTSHEET_TEMPLATE_SPEC;
}

/**
 * Fetches the live RANDOM INVENTORY COUNTSHEET TEMPLATE layout, cell values (Rows 1-60),
 * font families, font sizes, row heights, and column widths (Columns B-O) directly from Google Sheets
 * so any updates the user makes to the template spreadsheet are immediately reflected in the app and Print Preview.
 */
export async function fetchCountsheetTemplateSpec(
  rawAccessToken: string | null,
  templateSpreadsheetIdOrUrl: string = DEFAULT_COUNTSHEET_TEMPLATE_URL,
  forceLiveFetch: boolean = false
): Promise<CountsheetTemplateSpec> {
  const isPeriodicRequested = /periodic/i.test(templateSpreadsheetIdOrUrl || '');
  const applyTemplateVariantOverrides = (baseSpec: CountsheetTemplateSpec): CountsheetTemplateSpec => {
    if (isPeriodicRequested) {
      return {
        ...baseSpec,
        spreadsheetId: extractSpreadsheetId(templateSpreadsheetIdOrUrl) || 'hub-countsheet-periodic-template',
        spreadsheetTitle: 'PERIODIC COUNTSHEET TEMPLATE',
        formTitle: 'Periodic Inventory Count Sheet',
      };
    }
    return baseSpec;
  };

  // 1. Check server Hub Cache (TEMPLATE/COUNTSHEET in icdhubsystems@gmail.com) first so auditors never get 403/404 or popups
  if (!forceLiveFetch) {
    try {
      const hubData = await fetchHubTemplatesFromServer();
      const cleanReqId = extractSpreadsheetId(templateSpreadsheetIdOrUrl || '');
      const matchedCs =
        hubData.countsheetTemplates?.find(
          (t) =>
            (cleanReqId && t.id === cleanReqId) ||
            (isPeriodicRequested ? /periodic/i.test(t.name) : /random/i.test(t.name))
        ) || hubData.countsheetTemplates?.[0];
      if (matchedCs?.spec && typeof matchedCs.spec === 'object') {
        try {
          localStorage.setItem(TEMPLATE_SPEC_STORAGE_KEY, JSON.stringify(matchedCs.spec));
        } catch {}
        return applyTemplateVariantOverrides(getCachedCountsheetTemplateSpec());
      }
    } catch {}
  }

  const accessToken =
    (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken || '';
  if (!accessToken || !isGoogleOAuthAccessToken(accessToken)) {
    return applyTemplateVariantOverrides(getCachedCountsheetTemplateSpec());
  }

  const effectiveInputUrl =
    templateSpreadsheetIdOrUrl && templateSpreadsheetIdOrUrl !== DEFAULT_COUNTSHEET_TEMPLATE_URL
      ? templateSpreadsheetIdOrUrl
      : getAdminDriveLinksConfig().inventoryTemplateLink || templateSpreadsheetIdOrUrl || DEFAULT_COUNTSHEET_TEMPLATE_ID;

  let cleanTemplateId = extractSpreadsheetId(effectiveInputUrl);
  if (cleanTemplateId.startsWith('hub-')) {
    return applyTemplateVariantOverrides(getCachedCountsheetTemplateSpec());
  }
  const parsedInputResource = extractDriveResourceFromLink(effectiveInputUrl);
  if (parsedInputResource?.isFolder) {
    try {
      const folderSheets = await listSpreadsheetsInDriveFolder(accessToken, parsedInputResource.id);
      const preferred =
        folderSheets.find((f) =>
          isPeriodicRequested ? /periodic/i.test(f.name) : /random|countsheet|template/i.test(f.name)
        ) || folderSheets[0];
      if (preferred?.id) {
        cleanTemplateId = preferred.id;
      }
    } catch {}
  }
  const gidMatch = (effectiveInputUrl || '').match(/gid=([0-9]+)/);
  const requestedGid = gidMatch ? gidMatch[1] : String(DEFAULT_COUNTSHEET_TEMPLATE_GID);

  // Step 1: Fetch spreadsheet title and sheet tab list (bypass browser cache)
  try {
    let simpleRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanTemplateId}?fields=properties.title,sheets.properties`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }
    );

    if (!simpleRes.ok && (simpleRes.status === 404 || simpleRes.status === 400)) {
      // Check if cleanTemplateId is actually a folder ID in Google Drive
      try {
        const folderSheets = await listSpreadsheetsInDriveFolder(accessToken, cleanTemplateId);
        const preferred =
          folderSheets.find((f) =>
            isPeriodicRequested ? /periodic/i.test(f.name) : /random|countsheet|template/i.test(f.name)
          ) || folderSheets[0];
        if (preferred?.id && preferred.id !== cleanTemplateId) {
          cleanTemplateId = preferred.id;
          simpleRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${cleanTemplateId}?fields=properties.title,sheets.properties`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              cache: 'no-store',
            }
          );
        }
      } catch {}
    }

    if (!simpleRes.ok) {
      // Cross-account template in icdhubsystems@gmail.com: gracefully return cached spec instead of throwing 403/404
      return applyTemplateVariantOverrides(getCachedCountsheetTemplateSpec());
    }

    const simpleData = await simpleRes.json();
    const sheets: any[] = simpleData.sheets || [];
    const targetSheet =
      sheets.find((s: any) => String(s.properties?.sheetId) === String(requestedGid)) ||
      sheets.find((s: any) => /countsheet|template|random|periodic|copy/i.test(s.properties?.title || '')) ||
      sheets[0];

    if (!targetSheet) {
      return applyTemplateVariantOverrides(getCachedCountsheetTemplateSpec());
    }

    const liveSpec = await buildTemplateSpecFromValues(
      accessToken,
      cleanTemplateId,
      simpleData.properties?.title ||
        (isPeriodicRequested ? 'PERIODIC COUNTSHEET TEMPLATE' : 'RANDOM INVENTORY COUNTSHEET TEMPLATE'),
      targetSheet
    );
    void syncHubAssetsToServer({ countsheetSpec: liveSpec });
    return applyTemplateVariantOverrides(liveSpec);
  } catch {
    return applyTemplateVariantOverrides(getCachedCountsheetTemplateSpec());
  }
}

async function buildTemplateSpecFromValues(
  accessToken: string,
  spreadsheetId: string,
  spreadsheetTitle: string,
  sheetObj: any
): Promise<CountsheetTemplateSpec> {
  const sheetId = Number(sheetObj.properties?.sheetId ?? DEFAULT_COUNTSHEET_TEMPLATE_GID);
  const sheetTitle = String(sheetObj.properties?.title || 'Template');

  const safeTab = `'${sheetTitle.replace(/'/g, "''")}'`;
  const range = encodeURIComponent(`${safeTab}!A1:O62`);

  let colMeta: any[] = [];
  let rowMeta: any[] = [];
  let rowDataGrid: any[] = [];

  // Step 2: Fetch full grid metadata (columnMetadata.pixelSize, rowMetadata.pixelSize, formattedValue, and effectiveFormat.textFormat)
  // specifically for the target template tab (`'TabName'!A1:O62`)
  try {
    const gridFields =
      'sheets(properties(sheetId,title),data(columnMetadata.pixelSize,rowMetadata.pixelSize,rowData.values(formattedValue,effectiveFormat.textFormat(fontFamily,fontSize,bold,italic))))';
    const gridRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true&ranges=${range}&fields=${encodeURIComponent(gridFields)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }
    );
    if (gridRes.ok) {
      const gridJson = await gridRes.json();
      const matchedSheet =
        (gridJson.sheets || []).find(
          (s: any) => Number(s.properties?.sheetId) === sheetId
        ) || gridJson.sheets?.[0];
      const gridBlock = matchedSheet?.data?.[0];
      if (gridBlock) {
        colMeta = gridBlock.columnMetadata || [];
        rowMeta = gridBlock.rowMetadata || [];
        rowDataGrid = gridBlock.rowData || [];
      }
    }
  } catch (gridErr) {
    console.warn('Grid metadata fetch notice, falling back to values API:', gridErr);
  }

  const rows: string[][] = [];
  if (rowDataGrid.length > 0) {
    for (let r = 0; r < rowDataGrid.length; r++) {
      const vals: any[] = rowDataGrid[r]?.values || [];
      rows.push(vals.map((v: any) => String(v?.formattedValue ?? '').trim()));
    }
  } else {
    const valRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }
    );
    if (valRes.ok) {
      const valData = await valRes.json();
      if (Array.isArray(valData.values)) {
        valData.values.forEach((r: any[]) => {
          rows.push((r || []).map((c: any) => String(c ?? '').trim()));
        });
      }
    }
  }

  const cell = (row1Idx: number, col0Idx: number): string => {
    const r = rows[row1Idx - 1];
    return r && r[col0Idx] !== undefined ? String(r[col0Idx]).trim() : '';
  };

  const firstNonEmptyInCols = (row1Idx: number, startCol0: number, endCol0: number): string => {
    for (let c = startCol0; c <= endCol0; c++) {
      const v = cell(row1Idx, c);
      if (v) return v;
    }
    return '';
  };

  const getColPx = (col0Idx: number, fallback: number): number => {
    const px = colMeta[col0Idx]?.pixelSize;
    return typeof px === 'number' && px >= 16 ? px : fallback;
  };

  const getRowPx = (row1Idx: number, fallback: number): number => {
    const px = rowMeta[row1Idx - 1]?.pixelSize;
    return typeof px === 'number' && px >= 12 ? px : fallback;
  };

  const getCellFontStyle = (
    row1Idx: number,
    col0Idx: number,
    fallback: CountsheetCellFontStyle
  ): CountsheetCellFontStyle => {
    const tf = rowDataGrid[row1Idx - 1]?.values?.[col0Idx]?.effectiveFormat?.textFormat;
    if (!tf) return fallback;
    const rawFamily = typeof tf.fontFamily === 'string' && tf.fontFamily.trim() ? tf.fontFamily.trim() : '';
    const fontFamily = rawFamily
      ? `${rawFamily}, Arial, sans-serif`
      : fallback.fontFamily;
    const fontSizePt =
      typeof tf.fontSize === 'number' && tf.fontSize >= 5 && tf.fontSize <= 36
        ? tf.fontSize
        : fallback.fontSizePt;
    const bold = typeof tf.bold === 'boolean' ? tf.bold : fallback.bold;
    const italic = typeof tf.italic === 'boolean' ? tf.italic : fallback.italic;
    return { fontFamily, fontSizePt, bold, italic };
  };

  const getFirstFontInCols = (
    row1Idx: number,
    startCol0: number,
    endCol0: number,
    fallback: CountsheetCellFontStyle
  ): CountsheetCellFontStyle => {
    for (let c = startCol0; c <= endCol0; c++) {
      const v = cell(row1Idx, c);
      if (v && rowDataGrid[row1Idx - 1]?.values?.[c]?.effectiveFormat?.textFormat) {
        return getCellFontStyle(row1Idx, c, fallback);
      }
    }
    return getCellFontStyle(row1Idx, startCol0, fallback);
  };

  // Row 2-3 header cells
  const formTitle = firstNonEmptyInCols(2, 2, 6) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.formTitle;
  const docCode = cell(2, 7) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.docCode;
  const rawRevCell = cell(3, 7);
  const revParts = rawRevCell ? rawRevCell.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  const revisionLine1 = revParts[0] || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.revisionLine1;
  const revisionLine2 = revParts[1] || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.revisionLine2;

  // Row 4 Privacy Notice
  const privacyNotice = firstNonEmptyInCols(4, 1, 7) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.privacyNotice;

  // Row 5 & Row 6
  const row5Left = firstNonEmptyInCols(5, 1, 5) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.row5Left;
  const row5Right = firstNonEmptyInCols(5, 6, 7) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.row5Right;
  const row6Left = firstNonEmptyInCols(6, 1, 5) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.row6Left;
  const row6Right = firstNonEmptyInCols(6, 6, 7) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.row6Right;

  // Row 8 Headers
  const printHeaders = {
    stockDescription: cell(8, 1) || cell(8, 2) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.printHeaders.stockDescription,
    unit: cell(8, 3) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.printHeaders.unit,
    actualCount: cell(8, 4) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.printHeaders.actualCount,
    perPos: cell(8, 5) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.printHeaders.perPos,
    variance: cell(8, 6) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.printHeaders.variance,
    remarks: cell(8, 7) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.printHeaders.remarks,
  };

  const dataHeaders = {
    itemCode: cell(8, 9) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.dataHeaders.itemCode,
    itemDescription: cell(8, 10) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.dataHeaders.itemDescription,
    cost: cell(8, 11) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.dataHeaders.cost,
    selling: cell(8, 12) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.dataHeaders.selling,
    balance: cell(8, 13) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.dataHeaders.balance,
    unit: cell(8, 14) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.dataHeaders.unit,
  };

  // Row 43 Declaration
  const rawDecl = firstNonEmptyInCols(43, 1, 7);
  const declParts = rawDecl ? rawDecl.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  const declarationLine1 = declParts[0] || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.declarationLine1;
  const declarationLine2 = declParts[1] || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.declarationLine2;

  // Rows 45-55 Cutoff documents
  const liveCutoffRows: CountsheetTemplateCutoffRow[] = [];
  for (let r = 45; r <= 55; r++) {
    const docLabel = firstNonEmptyInCols(r, 1, 3);
    const dateLabel = firstNonEmptyInCols(r, 4, 6);
    const amountLabel = cell(r, 7);
    if (docLabel || dateLabel || amountLabel) {
      const defRow = DEFAULT_COUNTSHEET_TEMPLATE_SPEC.cutoffRows[r - 45] || {
        docLabel: '',
        dateLabel: 'Date: __________________',
        amountLabel: 'Amount: ____________________',
      };
      liveCutoffRows.push({
        docLabel: docLabel || defRow.docLabel,
        dateLabel: dateLabel || defRow.dateLabel,
        amountLabel: amountLabel || defRow.amountLabel,
      });
    }
  }

  // Rows 57-59 Signatories
  const signatoryHeaders = {
    preparedBy: firstNonEmptyInCols(57, 1, 2) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryHeaders.preparedBy,
    conformedBy: firstNonEmptyInCols(57, 3, 6) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryHeaders.conformedBy,
    notedBy: cell(57, 7) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryHeaders.notedBy,
  };
  const signatoryLines = {
    preparedBy: firstNonEmptyInCols(58, 1, 2) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryLines.preparedBy,
    conformedBy: firstNonEmptyInCols(58, 3, 6) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryLines.conformedBy,
    notedBy: cell(58, 7) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryLines.notedBy,
  };
  const signatoryTitles = {
    preparedBy: firstNonEmptyInCols(59, 1, 2) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryTitles.preparedBy,
    conformedBy: firstNonEmptyInCols(59, 3, 6) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryTitles.conformedBy,
    notedBy: cell(59, 7) || DEFAULT_COUNTSHEET_TEMPLATE_SPEC.signatoryTitles.notedBy,
  };

  const defFonts = DEFAULT_COUNTSHEET_TEMPLATE_SPEC.fontStyles;
  const itemDescCellFont = getCellFontStyle(9, 2, defFonts.itemDescCell);
  const itemCodeCellFont = getCellFontStyle(9, 1, defFonts.itemCodeCell);
  const itemUnitCellFont = getCellFontStyle(9, 3, defFonts.itemUnitCell);
  const dataSourceCellFont = getCellFontStyle(9, 10, defFonts.dataSourceCell);

  const spec: CountsheetTemplateSpec = {
    spreadsheetId,
    spreadsheetTitle,
    sheetId,
    sheetTitle,
    formTitle,
    docCode,
    revisionLine1,
    revisionLine2,
    privacyNotice,
    row5Left,
    row5Right,
    row6Left,
    row6Right,
    printHeaders,
    dataHeaders,
    colWidths: {
      B: getColPx(1, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.B),
      C: getColPx(2, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.C),
      D: getColPx(3, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.D),
      E: getColPx(4, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.E),
      F: getColPx(5, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.F),
      G: getColPx(6, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.G),
      H: getColPx(7, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.H),
      I: getColPx(8, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.I),
      J: getColPx(9, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.J),
      K: getColPx(10, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.K),
      L: getColPx(11, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.L),
      M: getColPx(12, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.M),
      N: getColPx(13, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.N),
      O: getColPx(14, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.colWidths.O),
    },
    rowHeights: {
      headerRow2: getRowPx(2, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.headerRow2),
      headerRow3: getRowPx(3, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.headerRow3),
      privacyRow4: getRowPx(4, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.privacyRow4),
      branchRow5: getRowPx(5, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.branchRow5),
      branchRow6: getRowPx(6, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.branchRow6),
      spacerRow7: getRowPx(7, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.spacerRow7),
      tableHeaderRow8: getRowPx(8, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.tableHeaderRow8),
      itemRow: getRowPx(9, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.itemRow),
      declarationRow43: getRowPx(43, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.declarationRow43),
      cutoffRow: getRowPx(45, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.cutoffRow),
      signatoryRow: getRowPx(57, DEFAULT_COUNTSHEET_TEMPLATE_SPEC.rowHeights.signatoryRow),
    },
    fontStyles: {
      baseFontFamily: itemDescCellFont.fontFamily || defFonts.baseFontFamily,
      formTitle: getFirstFontInCols(2, 2, 6, defFonts.formTitle),
      docCode: getCellFontStyle(2, 7, defFonts.docCode),
      revisionLine1: getCellFontStyle(3, 7, defFonts.revisionLine1),
      revisionLine2: {
        ...getCellFontStyle(3, 7, defFonts.revisionLine2),
        fontSizePt: Math.max(7, getCellFontStyle(3, 7, defFonts.revisionLine1).fontSizePt - 2),
        italic: true,
      },
      privacyNotice: getFirstFontInCols(4, 1, 7, defFonts.privacyNotice),
      branchInfo: getFirstFontInCols(5, 1, 7, defFonts.branchInfo),
      printTableHeader: getFirstFontInCols(8, 1, 7, defFonts.printTableHeader),
      dataTableHeader: getFirstFontInCols(8, 9, 14, defFonts.dataTableHeader),
      itemCodeCell: itemCodeCellFont,
      itemDescCell: itemDescCellFont,
      itemUnitCell: itemUnitCellFont,
      dataSourceCell: dataSourceCellFont,
      declaration: getFirstFontInCols(43, 1, 7, defFonts.declaration),
      cutoffRow: getFirstFontInCols(45, 1, 7, defFonts.cutoffRow),
      signatoryHeader: getFirstFontInCols(57, 1, 7, defFonts.signatoryHeader),
      signatoryTitle: getFirstFontInCols(59, 1, 7, defFonts.signatoryTitle),
    },
    declarationLine1,
    declarationLine2,
    cutoffRows: liveCutoffRows.length > 0 ? liveCutoffRows : DEFAULT_COUNTSHEET_TEMPLATE_SPEC.cutoffRows,
    signatoryHeaders,
    signatoryLines,
    signatoryTitles,
    fetchedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(TEMPLATE_SPEC_STORAGE_KEY, JSON.stringify(spec));
  } catch {
    // ignore storage errors
  }

  return spec;
}

export interface SheetPhysicalRowSlot<T> {
  item: T | null;
  descriptionLine: string;
  isContinuation: boolean;
  isSpacer?: boolean;
  lineIndex: number;
  totalLines: number;
}

export interface PackedCountsheetPage<T> {
  items: T[];
  physicalRows: SheetPhysicalRowSlot<T>[];
  rowsUsed: number;
}

export function getNormalizedItemHierarchyKey(
  item?: {
    category?: string;
    subCategory?: string;
    subsubCategory?: string;
  } | null
): string {
  if (!item) return '';
  const cat = String(item.category ?? '').trim().toLowerCase();
  const subCat = String(item.subCategory ?? '').trim().toLowerCase();
  const subSubCat = String(item.subsubCategory ?? '').trim().toLowerCase();
  return `${cat}|||${subCat}|||${subSubCat}`;
}

export function hasDifferentItemHierarchy(
  prevItem?: { category?: string; subCategory?: string; subsubCategory?: string } | null,
  nextItem?: { category?: string; subCategory?: string; subsubCategory?: string } | null
): boolean {
  if (!prevItem || !nextItem) return false;
  return getNormalizedItemHierarchyKey(prevItem) !== getNormalizedItemHierarchyKey(nextItem);
}

/**
 * Splits an Item Description into lines of at most `maxChars` characters (default 50, including spaces).
 * Breaks cleanly at word boundaries when possible, falling back to a hard split at `maxChars` for unbroken tokens.
 */
export function splitItemDescriptionLines(
  description?: string,
  maxChars: number = COUNTSHEET_DESC_MAX_CHARS
): string[] {
  const raw = String(description ?? '').trim();
  if (!raw) return [''];
  if (raw.length <= maxChars) return [raw];

  const lines: string[] = [];
  let remaining = raw;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      break;
    }

    // Find last space at or before maxChars
    const spaceIdx = remaining.lastIndexOf(' ', maxChars);
    if (spaceIdx > 0) {
      const line = remaining.slice(0, spaceIdx).trimEnd();
      if (line.length > 0) {
        lines.push(line);
      }
      remaining = remaining.slice(spaceIdx + 1).trimStart();
    } else {
      // Single unbroken word exceeds maxChars: split at maxChars
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars).trimStart();
    }
  }

  return lines.length > 0 ? lines : [''];
}

export function getItemRowSpan(
  description?: string,
  maxChars: number = COUNTSHEET_DESC_MAX_CHARS
): number {
  return splitItemDescriptionLines(description, maxChars).length;
}

/**
 * Packs items into 34-row physical countsheet pages (Rows 9-42).
 * - If an item's wrapped description (> 50 chars) requires 2+ rows, those continuation rows
 *   count toward the 34-row sheet limit.
 * - Whenever consecutive items on a sheet belong to a different Category, SubCategory, or SubSubCategory,
 *   1 blank spacer row is inserted between them (e.g. if Rice occupies rows 1 to 14, row 15 is a blank space
 *   and the next Category/SubCat/SubSubCat starts at row 16).
 * - If the spacer + item would overflow the remaining rows on the current sheet, the item starts at row 1 of the next sheet.
 */
export function packItemsInto34RowSheets<
  T extends {
    itemDescription?: string;
    category?: string;
    subCategory?: string;
    subsubCategory?: string;
  }
>(
  items: T[],
  maxRowsPerSheet: number = COUNTSHEET_MAX_ROWS_PER_SHEET,
  maxChars: number = COUNTSHEET_DESC_MAX_CHARS,
  insertCategorySpacers: boolean = true
): PackedCountsheetPage<T>[] {
  if (!items || items.length === 0) return [];

  const pages: PackedCountsheetPage<T>[] = [];
  let currentPage: PackedCountsheetPage<T> = {
    items: [],
    physicalRows: [],
    rowsUsed: 0,
  };

  for (const item of items) {
    const rawLines = splitItemDescriptionLines(item.itemDescription || '', maxChars);
    const lines = rawLines.slice(0, maxRowsPerSheet);
    const neededRows = lines.length;

    const prevItemOnPage =
      currentPage.items.length > 0 ? currentPage.items[currentPage.items.length - 1] : null;
    const needsSpacerRow =
      insertCategorySpacers &&
      prevItemOnPage !== null &&
      hasDifferentItemHierarchy(prevItemOnPage, item);
    const spacerCount = needsSpacerRow ? 1 : 0;

    if (
      currentPage.rowsUsed + spacerCount + neededRows > maxRowsPerSheet &&
      currentPage.items.length > 0
    ) {
      pages.push(currentPage);
      currentPage = {
        items: [],
        physicalRows: [],
        rowsUsed: 0,
      };
    }

    // Insert 1 blank spacer row when transitioning to a different Category, SubCategory, or SubSubCategory on the same sheet
    if (currentPage.items.length > 0 && needsSpacerRow) {
      currentPage.physicalRows.push({
        item: null,
        descriptionLine: '',
        isContinuation: false,
        isSpacer: true,
        lineIndex: 0,
        totalLines: 1,
      });
    }

    currentPage.items.push(item);
    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      currentPage.physicalRows.push({
        item,
        descriptionLine: lines[lIdx],
        isContinuation: lIdx > 0,
        isSpacer: false,
        lineIndex: lIdx,
        totalLines: lines.length,
      });
    }
    currentPage.rowsUsed = currentPage.physicalRows.length;
  }

  if (currentPage.items.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

/**
 * Builds Google Sheets batchUpdate requests for a single countsheet tab (Rows 9-42, Columns B to H):
 * 1. Sets a pure white background across B9:H42 so Google Sheets never displays gray cell gridlines between multi-row item lines.
 * 2. Restores all standard 1px black horizontal borders across B9:H42 so if any 2-row item is removed or changed, the horizontal border returns.
 * 3. For every item that uses a 2nd (or 3rd) row (`physicalRows[r + 1]?.isContinuation`), removes the horizontal border
 *    between the 1st and 2nd row from Column B to Column H so it looks like a single unified item instead of two items.
 */
export function buildCountsheetRowBorderRequests<T>(
  sheetId: number,
  physicalRows: SheetPhysicalRowSlot<T>[],
  chunkSize: number = COUNTSHEET_MAX_ROWS_PER_SHEET
): any[] {
  const requests: any[] = [];

  // 1. Ensure pure white background across B9:H42 (rows 8..42, cols 1..8) so removing a black border never exposes a gray gridline
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 8,
        endRowIndex: 8 + chunkSize,
        startColumnIndex: 1, // Col B
        endColumnIndex: 8,   // Col H (exclusive index 8 = Cols B..H)
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
        },
      },
      fields: 'userEnteredFormat.backgroundColor',
    },
  });

  // 2. Restore standard 1px solid black horizontal borders across all 34 rows (B9:H42)
  // This guarantees that if a 2-row item is removed or reordered, the horizontal border from Col B to H returns.
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 8,
        endRowIndex: 8 + chunkSize,
        startColumnIndex: 1, // Col B
        endColumnIndex: 8,   // Col H
      },
      top: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
      bottom: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
      innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
    },
  });

  // 3. Remove horizontal border between the 1st and 2nd row from Col B to Col H for any wrapped multi-row item
  for (let r = 0; r < chunkSize - 1; r++) {
    if (physicalRows[r + 1]?.isContinuation) {
      // Clear bottom border of 1st row (B{9+r}:H{9+r})
      requests.push({
        updateBorders: {
          range: {
            sheetId,
            startRowIndex: 8 + r,
            endRowIndex: 8 + r + 1,
            startColumnIndex: 1,
            endColumnIndex: 8,
          },
          bottom: { style: 'NONE' },
        },
      });
      // Clear top border of 2nd row (B{10+r}:H{10+r})
      requests.push({
        updateBorders: {
          range: {
            sheetId,
            startRowIndex: 8 + r + 1,
            endRowIndex: 8 + r + 2,
            startColumnIndex: 1,
            endColumnIndex: 8,
          },
          top: { style: 'NONE' },
        },
      });
      // Clear shared innerHorizontal border across the 2-row pair
      requests.push({
        updateBorders: {
          range: {
            sheetId,
            startRowIndex: 8 + r,
            endRowIndex: 8 + r + 2,
            startColumnIndex: 1,
            endColumnIndex: 8,
          },
          innerHorizontal: { style: 'NONE' },
        },
      });
    }
  }

  return requests;
}

export const ALL_ITEMS_SHEET_NAME = 'All Items';
export const ALL_ITEMS_HEADERS = [
  'No',
  'Item Code',
  'Barcode',
  'Item Description',
  'Category',
  'SubCategory',
  'SubsubCategory',
  'Cost',
  'Selling',
  'Unit',
  'Balance',
  'CS',
];

function buildAllItemsSheetRows(
  plannedSheets: Array<{
    sheetTitle: string;
    groupName: string;
    csNumber: number;
    items: GroupCountsheetPlanItem[];
  }>
): any[][] {
  const rows: any[][] = [ALL_ITEMS_HEADERS];
  let seqNo = 1;

  for (let i = 0; i < plannedSheets.length; i++) {
    const plan = plannedSheets[i];
    const titleCsMatch = plan.sheetTitle.trim().match(/^CS0*(\d+)$/i);
    const csDisplayVal = titleCsMatch
      ? parseInt(titleCsMatch[1], 10)
      : plan.csNumber || i + 1;

    for (const item of plan.items) {
      rows.push([
        seqNo++,
        item.itemCode || '',
        item.barcode || '',
        item.itemDescription || '',
        item.category || '',
        item.subCategory || '',
        item.subsubCategory || '',
        item.cost !== undefined && item.cost !== null ? item.cost : '',
        item.selling !== undefined && item.selling !== null ? item.selling : '',
        item.unit || 'PCS',
        item.balance !== undefined && item.balance !== null ? item.balance : '',
        csDisplayVal,
      ]);
    }
  }

  return rows;
}

function buildAllItemsSheetFormatRequests(
  sheetId: number,
  totalRows: number
): any[] {
  const colWidths = [55, 115, 135, 360, 160, 160, 160, 95, 95, 75, 95, 65];
  const requests: any[] = [];

  // Format Columns B (Item Code) and C (Barcode) as plain TEXT so leading zeros and long barcodes are preserved
  if (totalRows > 1) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: totalRows,
          startColumnIndex: 1,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: 'TEXT',
            },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  // Format Header Row 1 (A1:L1)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 12,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 },
          textFormat: {
            bold: true,
            fontSize: 10,
          },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields:
        'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });

  // Center align No (Col A), Unit (Col J), and CS (Col L) on data rows
  if (totalRows > 1) {
    for (const colIdx of [0, 9, 11]) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: totalRows,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat.horizontalAlignment',
        },
      });
    }
  }

  // Set readable column widths for A..L
  colWidths.forEach((px, idx) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: idx,
          endIndex: idx + 1,
        },
        properties: {
          pixelSize: px,
        },
        fields: 'pixelSize',
      },
    });
  });

  return requests;
}

/**
 * Creates an audit countsheet spreadsheet by copying the user's template sheet.
 * The template header is on row 8 (Item Code, Stock Description, Cost, Selling, Balance, Unit).
 * Items are placed on rows 9-42 (34 physical rows max per countsheet tab).
 * Descriptions > 50 chars wrap onto the next row in Col K while leaving Cols J, L, M, N, O blank.
 * Also creates an "All Items" sheet listing all items in countsheet sequence with their CS number (e.g. 1 for CS01).
 */
export async function createCountsheetFromTemplate(
  options: CreateCountsheetFromTemplateOptions
): Promise<CreateCountsheetFromTemplateResult> {
  const {
    accessToken: rawAccessToken,
    templateSpreadsheetId = DEFAULT_COUNTSHEET_TEMPLATE_ID,
    templateGid = DEFAULT_COUNTSHEET_TEMPLATE_GID,
    targetSpreadsheetTitle = `Audit Countsheets - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    insertCategorySpacers = true,
    groups,
    onProgress,
  } = options;

  const accessToken = (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  if (!accessToken || !isGoogleOAuthAccessToken(accessToken)) {
    throw new Error('Google access token is required to generate countsheets.');
  }

  // 1. Resolve Template Spreadsheet ID and GID (prioritizing Admin Console link if default was passed)
  const adminInvLink = getAdminDriveLinksConfig().inventoryTemplateLink;
  const effectiveTemplateInput =
    (!templateSpreadsheetId ||
      templateSpreadsheetId === DEFAULT_COUNTSHEET_TEMPLATE_ID ||
      templateSpreadsheetId === DEFAULT_COUNTSHEET_TEMPLATE_URL) &&
    adminInvLink
      ? adminInvLink
      : templateSpreadsheetId || DEFAULT_COUNTSHEET_TEMPLATE_ID;

  let cleanTemplateId = extractSpreadsheetId(effectiveTemplateInput);
  const parsedTemplateResource = extractDriveResourceFromLink(effectiveTemplateInput);
  if (parsedTemplateResource?.isFolder) {
    try {
      const folderSheets = await listSpreadsheetsInDriveFolder(accessToken, parsedTemplateResource.id);
      const preferred =
        folderSheets.find((f) => /random|countsheet|template/i.test(f.name || '')) || folderSheets[0];
      if (preferred?.id) {
        cleanTemplateId = preferred.id;
      }
    } catch {}
  }
  const gidMatch = (effectiveTemplateInput || '').match(/gid=([0-9]+)/);
  let resolvedGid = gidMatch ? gidMatch[1] : String(templateGid || DEFAULT_COUNTSHEET_TEMPLATE_GID);

  // 2. Validate items to create
  const activeGroups = groups.filter((g) => g.items && g.items.length > 0);
  if (activeGroups.length === 0) {
    throw new Error('Please select at least 1 item across your groups.');
  }

  const CHUNK_SIZE = COUNTSHEET_MAX_ROWS_PER_SHEET;

  interface PlannedSheet {
    groupId: string;
    groupName: string;
    baseSheetName: string;
    sheetTitle: string;
    csNumber: number;
    items: GroupCountsheetPlanItem[];
    physicalRows: SheetPhysicalRowSlot<GroupCountsheetPlanItem>[];
    partNumber: number;
    totalParts: number;
  }

  const plannedSheets: PlannedSheet[] = [];
  const usedTitles = new Set<string>([ALL_ITEMS_SHEET_NAME.toLowerCase()]);

  let runningCsCounter = 1;
  for (let gIdx = 0; gIdx < activeGroups.length; gIdx++) {
    const grp = activeGroups[gIdx];
    const grpItems = grp.items;
    const packedPages = packItemsInto34RowSheets(
      grpItems,
      CHUNK_SIZE,
      COUNTSHEET_DESC_MAX_CHARS,
      insertCategorySpacers
    );
    const totalParts = Math.max(1, packedPages.length);
    const defaultCsName = `CS${String(runningCsCounter).padStart(2, '0')}`;

    // Base name from last selected category, subcategory, subsubcategory, or CS code
    let baseRaw = (grp.baseSheetName || grp.groupName || defaultCsName)
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!baseRaw || /^Group\s+\d+$/i.test(baseRaw)) baseRaw = defaultCsName;
    // Limit to safe sheet name length (max 70 chars)
    const cleanBase = baseRaw.slice(0, 70).trim();
    const csMatch = cleanBase.match(/^CS(\d+)$/i);

    for (let p = 0; p < totalParts; p++) {
      const page = packedPages[p] || { items: [], physicalRows: [], rowsUsed: 0 };
      const partNum = p + 1;
      const csNumber = csMatch ? parseInt(csMatch[1], 10) + p : runningCsCounter + p;

      // Naming convention:
      // If cleanBase is a CSxx code (e.g. CS01), advance to CS01, CS02, etc.
      // Otherwise: Part 1: "(Name)", Part 2: "(Name) 2", Part 3: "(Name) 3"
      let titleCandidate = (
        csMatch
          ? `CS${String(parseInt(csMatch[1], 10) + p).padStart(2, '0')}`
          : partNum === 1
          ? cleanBase
          : `${cleanBase} ${partNum}`
      )
        .replace(/\s+/g, ' ')
        .trim();

      // Deduplicate across groups if name collision occurs
      let counter = partNum;
      while (usedTitles.has(titleCandidate.toLowerCase())) {
        counter++;
        titleCandidate = (
          csMatch
            ? `CS${String(parseInt(csMatch[1], 10) + counter - 1).padStart(2, '0')}`
            : `${cleanBase} ${counter}`
        )
          .replace(/\s+/g, ' ')
          .trim();
      }
      usedTitles.add(titleCandidate.toLowerCase());

      plannedSheets.push({
        groupId: grp.groupId,
        groupName: grp.groupName || defaultCsName,
        baseSheetName: cleanBase,
        sheetTitle: titleCandidate,
        csNumber,
        items: page.items,
        physicalRows: page.physicalRows,
        partNumber: partNum,
        totalParts,
      });
    }

    runningCsCounter += totalParts;
  }

  if (plannedSheets.length === 0) {
    throw new Error('No countsheets could be planned. Check item selections.');
  }

  // 3. Ensure "Generated Countsheet" folder exists in the user's Google Drive and duplicate template spreadsheet into it
  onProgress?.(`Preparing "${GENERATED_COUNTSHEET_FOLDER_NAME}" folder in your Google Drive...`);
  const countsheetFolder = await ensureUserDriveFolder(accessToken, GENERATED_COUNTSHEET_FOLDER_NAME);

  onProgress?.(`Copying Countsheet Template to "${GENERATED_COUNTSHEET_FOLDER_NAME}" in Google Drive...`);
  let newSpreadsheetId = '';
  let webViewLink = '';
  const finalTitle = targetSpreadsheetTitle || `Audit Countsheets - ${new Date().toLocaleDateString()}`;

  // Strategy A: Drive API copy directly into the user's "Generated Countsheet" folder
  try {
    const copyPayload: Record<string, any> = {
      name: finalTitle,
    };
    if (countsheetFolder?.folderId) {
      copyPayload.parents = [countsheetFolder.folderId];
    }

    const driveCopyRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${cleanTemplateId}/copy?supportsAllDrives=true&fields=id,name,webViewLink,parents`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(copyPayload),
      }
    );

    if (driveCopyRes.ok) {
      const copyData = await driveCopyRes.json();
      newSpreadsheetId = copyData.id;
      webViewLink = copyData.webViewLink || `https://docs.google.com/spreadsheets/d/${copyData.id}/edit`;
      if (
        countsheetFolder?.folderId &&
        (!Array.isArray(copyData.parents) || !copyData.parents.includes(countsheetFolder.folderId))
      ) {
        await moveFileToDriveFolder(accessToken, newSpreadsheetId, countsheetFolder.folderId);
      }
    } else {
      const errText = await driveCopyRes.text();
      console.warn('Drive file copy notice, falling back to cached Hub template / Sheets API:', errText);
      const clonedFromHubXlsx = await instantiateCachedHubTemplateInUserDrive(
        accessToken,
        cleanTemplateId,
        finalTitle,
        countsheetFolder?.folderId
      );
      if (clonedFromHubXlsx) {
        newSpreadsheetId = clonedFromHubXlsx.id;
        webViewLink = clonedFromHubXlsx.webViewLink;
      }
    }
  } catch (driveErr) {
    console.warn('Drive copy exception, falling back to Sheets API:', driveErr);
  }

  // Strategy B: Google Sheets API create + copyTo fallback (with Strategy C self-contained construction from cached TEMPLATE/COUNTSHEET spec)
  if (!newSpreadsheetId) {
    onProgress?.(`Creating new Google Spreadsheet in "${GENERATED_COUNTSHEET_FOLDER_NAME}"...`);
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: finalTitle },
      }),
    });

    if (!createRes.ok) {
      const errTxt = await createRes.text();
      throw parseGoogleApiError(createRes.status, errTxt, 'Sheets');
    }

    const createdData = await createRes.json();
    newSpreadsheetId = createdData.spreadsheetId;
    const initialSheetId = Number(createdData.sheets?.[0]?.properties?.sheetId ?? 0);
    webViewLink = `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit`;

    // Move newly created countsheet into the user's "Generated Countsheet" folder in Google Drive
    if (countsheetFolder?.folderId) {
      await moveFileToDriveFolder(accessToken, newSpreadsheetId, countsheetFolder.folderId);
    }

    // Try copying template tab from source to destination; if source is in icdhubsystems@gmail.com and returns 403/404,
    // construct the template layout directly on initialSheetId from the cached CountsheetTemplateSpec!
    onProgress?.(`Applying TEMPLATE/COUNTSHEET layout and formulas...`);
    let targetGidNum = resolvedGid ? Number(resolvedGid) : 1328306184;
    try {
      const srcMetaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanTemplateId}?fields=sheets.properties`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        }
      );
      if (srcMetaRes.ok) {
        const srcMeta = await srcMetaRes.json();
        const srcSheets: any[] = srcMeta.sheets || [];
        const matchedSrcSheet =
          srcSheets.find((s: any) => String(s.properties?.sheetId) === String(resolvedGid)) ||
          srcSheets.find((s: any) => /countsheet|template|copy/i.test(s.properties?.title || '')) ||
          srcSheets[0];
        if (matchedSrcSheet?.properties?.sheetId !== undefined) {
          targetGidNum = Number(matchedSrcSheet.properties.sheetId);
        }
      }
    } catch {}

    let copiedTemplateTab = false;
    try {
      const copyToRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanTemplateId}/sheets/${targetGidNum}:copyTo`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            destinationSpreadsheetId: newSpreadsheetId,
          }),
        }
      );

      if (copyToRes.ok) {
        copiedTemplateTab = true;
        const copyToData = await copyToRes.json().catch(() => null);
        if (copyToData && copyToData.sheetId !== undefined) {
          resolvedGid = String(copyToData.sheetId);
        }
      }
    } catch {}

    if (!copiedTemplateTab) {
      // Strategy C: Build standalone Countsheet Template tab directly inside the auditor's spreadsheet
      // using the cached CountsheetTemplateSpec from icdhubsystems@gmail.com (TEMPLATE/COUNTSHEET)
      resolvedGid = String(initialSheetId);
      const spec = getCachedCountsheetTemplateSpec();
      const baseSheetTitle = 'Countsheet Template';
      const colPixelSizes = [
        24, // Col A margin
        spec.colWidths.B || 92,
        spec.colWidths.C || 295,
        spec.colWidths.D || 54,
        spec.colWidths.E || 74,
        spec.colWidths.F || 74,
        spec.colWidths.G || 74,
        spec.colWidths.H || 130,
        spec.colWidths.I || 24,
        spec.colWidths.J || 105,
        spec.colWidths.K || 280,
        spec.colWidths.L || 80,
        spec.colWidths.M || 80,
        spec.colWidths.N || 80,
        spec.colWidths.O || 60,
      ];

      const formatReqs: any[] = [
        {
          updateSheetProperties: {
            properties: {
              sheetId: initialSheetId,
              title: baseSheetTitle,
              gridProperties: {
                rowCount: 62,
                columnCount: 16,
              },
            },
            fields: 'title,gridProperties(rowCount,columnCount)',
          },
        },
      ];

      colPixelSizes.forEach((px, colIdx) => {
        formatReqs.push({
          updateDimensionProperties: {
            range: {
              sheetId: initialSheetId,
              dimension: 'COLUMNS',
              startIndex: colIdx,
              endIndex: colIdx + 1,
            },
            properties: { pixelSize: px },
            fields: 'pixelSize',
          },
        });
      });

      // Set standard Calibri 9pt across B1:O60 and table header formatting on Row 8
      formatReqs.push({
        repeatCell: {
          range: {
            sheetId: initialSheetId,
            startRowIndex: 0,
            endRowIndex: 60,
            startColumnIndex: 1,
            endColumnIndex: 15,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                fontFamily: 'Calibri',
                fontSize: spec.fontStyles?.itemDescCell?.fontSizePt || 9,
              },
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(textFormat,verticalAlignment)',
        },
      });

      formatReqs.push({
        repeatCell: {
          range: {
            sheetId: initialSheetId,
            startRowIndex: 7,
            endRowIndex: 8,
            startColumnIndex: 1,
            endColumnIndex: 15,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 },
              textFormat: {
                fontFamily: 'Calibri',
                fontSize: 9,
                bold: true,
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields:
            'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      });

      // Add full grid borders on B8:H42
      formatReqs.push({
        updateBorders: {
          range: {
            sheetId: initialSheetId,
            startRowIndex: 7,
            endRowIndex: 42,
            startColumnIndex: 1,
            endColumnIndex: 8,
          },
          top: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          bottom: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          left: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          right: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          innerVertical: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        },
      });

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests: formatReqs }),
      });

      // Populate template rows 1..59 (including Row 8 headers and Rows 9..42 formulas linking B..G to J..O)
      const isPeriodicTemplate = /periodic/i.test(templateSpreadsheetId || '') || /periodic/i.test(finalTitle || '');
      const gridRows: any[][] = Array.from({ length: 60 }, () => new Array(15).fill(''));
      gridRows[1][2] = isPeriodicTemplate
        ? 'Periodic Inventory Count Sheet'
        : spec.formTitle || 'Random Inventory Count Sheet';
      gridRows[1][7] = spec.docCode || 'FM-ICD-001';
      gridRows[2][7] = `${spec.revisionLine1 || 'Rev. 00'} ${spec.revisionLine2 || ''}`.trim();
      gridRows[3][1] = spec.privacyNotice || '';
      gridRows[4][1] = spec.row5Left || 'Branch / Warehouse: ________________________';
      gridRows[4][6] = spec.row5Right || 'Date of Count: ________________';
      gridRows[5][1] = spec.row6Left || 'Location / Area: ___________________________';
      gridRows[5][6] = spec.row6Right || 'Countsheet No.: _______________';

      // Row 8 (index 7): Printable Headers (B8:H8) + Data Headers (J8:O8)
      gridRows[7][1] = 'Item Code';
      gridRows[7][2] = spec.printHeaders?.stockDescription || 'Stock Description';
      gridRows[7][3] = spec.printHeaders?.unit || 'Unit';
      gridRows[7][4] = spec.printHeaders?.actualCount || 'Actual Count';
      gridRows[7][5] = spec.printHeaders?.perPos || 'Per POS';
      gridRows[7][6] = spec.printHeaders?.variance || 'Variance';
      gridRows[7][7] = spec.printHeaders?.remarks || 'Remarks';

      gridRows[7][9] = spec.dataHeaders?.itemCode || 'Item Code';
      gridRows[7][10] = spec.dataHeaders?.itemDescription || 'Stock Description';
      gridRows[7][11] = spec.dataHeaders?.cost || 'Cost';
      gridRows[7][12] = spec.dataHeaders?.selling || 'Selling';
      gridRows[7][13] = spec.dataHeaders?.balance || 'Balance';
      gridRows[7][14] = spec.dataHeaders?.unit || 'Unit';

      // Rows 9..42 (indices 8..41): Formulas in B..G referencing J..O
      for (let rNum = 9; rNum <= 42; rNum++) {
        const rIdx = rNum - 1;
        gridRows[rIdx][1] = `=IF(ISBLANK(J${rNum}),"",J${rNum})`; // Col B: Item Code
        gridRows[rIdx][2] = `=IF(ISBLANK(K${rNum}),"",K${rNum})`; // Col C: Stock Description
        gridRows[rIdx][3] = `=IF(ISBLANK(O${rNum}),"",O${rNum})`; // Col D: Unit
        gridRows[rIdx][4] = ''; // Col E: Actual Count (blank for physical count entry)
        gridRows[rIdx][5] = `=IF(ISBLANK(N${rNum}),"",N${rNum})`; // Col F: Per POS (Balance)
        gridRows[rIdx][6] = `=IF(ISBLANK(E${rNum}),"",E${rNum}-F${rNum})`; // Col G: Variance
        gridRows[rIdx][7] = ''; // Col H: Remarks
      }

      // Row 43 (index 42): Declaration
      gridRows[42][1] = `${spec.declarationLine1 || ''} ${spec.declarationLine2 || ''}`.trim();

      // Rows 45..55 (indices 44..54): Cutoff rows
      (spec.cutoffRows || []).slice(0, 11).forEach((cRow, idx) => {
        const rIdx = 44 + idx;
        gridRows[rIdx][1] = cRow.docLabel || '';
        gridRows[rIdx][4] = cRow.dateLabel || '';
        gridRows[rIdx][7] = cRow.amountLabel || '';
      });

      // Rows 57..59 (indices 56..58): Signatories
      gridRows[56][1] = spec.signatoryHeaders?.preparedBy || 'Prepared by:';
      gridRows[56][3] = spec.signatoryHeaders?.conformedBy || 'Conformed by:';
      gridRows[56][7] = spec.signatoryHeaders?.notedBy || 'Noted by:';
      gridRows[57][1] = spec.signatoryLines?.preparedBy || '________________________';
      gridRows[57][3] = spec.signatoryLines?.conformedBy || '________________________';
      gridRows[57][7] = spec.signatoryLines?.notedBy || '________________________';
      gridRows[58][1] = spec.signatoryTitles?.preparedBy || 'Auditor/Operation';
      gridRows[58][3] = spec.signatoryTitles?.conformedBy || 'Warehouseman/ Clerk';
      gridRows[58][7] = spec.signatoryTitles?.notedBy || 'Store Officer';

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}/values/${encodeURIComponent(
          `'${baseSheetTitle}'!A1:O60`
        )}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            majorDimension: 'ROWS',
            values: gridRows,
          }),
        }
      );
    }
  }

  // 4. Inspect sheets in the new spreadsheet to locate the template tab (bypass cache for fresh template state)
  onProgress?.(`Analyzing updated template layout and row 8 header columns...`);
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!metaRes.ok) {
    const err = await metaRes.text();
    throw parseGoogleApiError(metaRes.status, err, 'Sheets');
  }

  const metaData = await metaRes.json();
  const sheets: any[] = metaData.sheets || [];

  let templateSheetObj = sheets.find(
    (s: any) => String(s.properties.sheetId) === String(resolvedGid)
  );
  if (!templateSheetObj) {
    // If not found by exact GID, find first or matching name
    templateSheetObj =
      sheets.find((s: any) => /countsheet|template|copy/i.test(s.properties.title)) || sheets[0];
  }

  if (!templateSheetObj) {
    throw new Error('Could not locate the template sheet tab in the spreadsheet.');
  }

  const templateSheetId = templateSheetObj.properties.sheetId;
  const templateSheetTitle = templateSheetObj.properties.title;

  // 5. Read Row 8 of the template sheet to dynamically map columns
  // User explicit instruction:
  // Row 8 contains: Item Code, Stock Description, Cost, Selling, Balance, Unit in columns J, K, L, M, N, O
  // Col J = 9 (0-indexed), Col K = 10, Col L = 11, Col M = 12, Col N = 13, Col O = 14
  const row8Range = encodeURIComponent(`'${templateSheetTitle}'!A8:Z8`);
  const row8Res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}/values/${row8Range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  let row8Headers: string[] = [];
  if (row8Res.ok) {
    const rData = await row8Res.json();
    if (rData.values && rData.values[0]) {
      row8Headers = rData.values[0].map((v: any) => String(v || '').trim());
    }
  }

  // Target columns J, K, L, M, N, O (indices 9 to 14)
  let codeColIdx = 9;     // Column J: Item Code
  let descColIdx = 10;    // Column K: Stock Description
  let costColIdx = 11;    // Column L: Cost
  let sellingColIdx = 12; // Column M: Selling
  let balanceColIdx = 13; // Column N: Balance
  let unitColIdx = 14;    // Column O: Unit

  // If row 8 headers are present, inspect data columns (Columns J and onward, idx >= 9)
  // so printable headers in Columns B-H (e.g. Col B "Stock Description" or Col D "Unit") never override J-O
  if (row8Headers.length > 0) {
    row8Headers.forEach((h, idx) => {
      if (idx < 9) return;
      const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (/^(itemcode|code|itemno|sku|matcode)$/i.test(norm)) {
        codeColIdx = idx;
      } else if (/^(stockdescription|itemdescription|description|desc|particulars|itemname)$/i.test(norm)) {
        descColIdx = idx;
      } else if (/^(cost|unitcost|ucost|costprice)$/i.test(norm)) {
        costColIdx = idx;
      } else if (/^(selling|sellingprice|sprice|retail|srp)$/i.test(norm)) {
        sellingColIdx = idx;
      } else if (/^(balance|qty|quantity|begqty|onhand|stock)$/i.test(norm)) {
        balanceColIdx = idx;
      } else if (/^(unit|uom|pack)$/i.test(norm)) {
        unitColIdx = idx;
      }
    });
  }

  // Determine contiguous bounding box for columns (default J to O: 9 to 14)
  const minColIdx = Math.min(codeColIdx, descColIdx, costColIdx, sellingColIdx, balanceColIdx, unitColIdx);
  const maxColIdx = Math.max(codeColIdx, descColIdx, costColIdx, sellingColIdx, balanceColIdx, unitColIdx);
  const minColLetter = numberToColumnLetter(minColIdx);
  const maxColLetter = numberToColumnLetter(maxColIdx);
  const colSpan = maxColIdx - minColIdx + 1;

  // 6. Duplicate template sheet for each planned countsheet tab + create 'All Items' sheet
  const allItemsRows = buildAllItemsSheetRows(plannedSheets);
  onProgress?.(`Creating ${plannedSheets.length} countsheet tabs and "${ALL_ITEMS_SHEET_NAME}" sheet...`);

  // Rename templateSheetId to a guaranteed-unique temporary name and delete all other pre-existing tabs
  // BEFORE running duplicateSheet, so no pre-existing tab in the copied template spreadsheet (e.g. "BEVERAGES")
  // can ever collide with newSheetName!
  const tempSourceTitle = `__tpl_base_${Date.now().toString().slice(-6)}`;
  const preCleanRequests: any[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: Number(templateSheetId),
          title: tempSourceTitle,
        },
        fields: 'title',
      },
    },
  ];
  sheets.forEach((s: any) => {
    const sId = Number(s.properties?.sheetId);
    if (!isNaN(sId) && sId !== Number(templateSheetId)) {
      preCleanRequests.push({ deleteSheet: { sheetId: sId } });
    }
  });

  const duplicateRequests: any[] = [
    ...preCleanRequests,
    ...plannedSheets.map((plan, idx) => ({
      duplicateSheet: {
        sourceSheetId: templateSheetId,
        insertSheetIndex: idx,
        newSheetName: plan.sheetTitle,
      },
    })),
    {
      addSheet: {
        properties: {
          title: ALL_ITEMS_SHEET_NAME,
          index: plannedSheets.length,
          gridProperties: {
            rowCount: Math.max(100, allItemsRows.length + 20),
            columnCount: 12,
            frozenRowCount: 1,
          },
        },
      },
    },
  ];

  const batchDupRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: duplicateRequests }),
    }
  );

  if (!batchDupRes.ok) {
    const err = await batchDupRes.text();
    throw parseGoogleApiError(batchDupRes.status, err, 'Sheets');
  }

  const batchDupData = await batchDupRes.json();
  const allReplies: any[] = batchDupData.replies || [];
  const duplicateReplies = allReplies.slice(
    preCleanRequests.length,
    preCleanRequests.length + plannedSheets.length
  );
  const addedAllItemsSheetId =
    allReplies[preCleanRequests.length + plannedSheets.length]?.addSheet?.properties?.sheetId;

  // Format 'All Items' sheet (especially TEXT format on Item Code & Barcode columns before writing values)
  // and format multi-row item borders (Col B to H) on each countsheet tab
  onProgress?.(`Formatting countsheet borders and "${ALL_ITEMS_SHEET_NAME}" sheet...`);
  try {
    const borderBatchRequests: any[] = [];

    for (let i = 0; i < plannedSheets.length; i++) {
      const plan = plannedSheets[i];
      const dupSheetId = duplicateReplies[i]?.duplicateSheet?.properties?.sheetId;
      if (dupSheetId === undefined || dupSheetId === null) continue;

      borderBatchRequests.push(
        ...buildCountsheetRowBorderRequests(Number(dupSheetId), plan.physicalRows, CHUNK_SIZE)
      );
    }

    if (addedAllItemsSheetId !== undefined && addedAllItemsSheetId !== null) {
      borderBatchRequests.push(
        ...buildAllItemsSheetFormatRequests(Number(addedAllItemsSheetId), allItemsRows.length)
      );
    }

    if (borderBatchRequests.length > 0) {
      const borderRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: borderBatchRequests,
          }),
        }
      );
      if (!borderRes.ok) {
        const errTxt = await borderRes.text();
        console.warn('Border formatting batchUpdate notice:', errTxt);
      }
    }
  } catch (borderErr) {
    console.warn('Could not apply multi-row item border updates:', borderErr);
  }

  // 7. Populate Rows 9-42 (34 physical rows per sheet) on each duplicated tab in columns J through O
  // AND populate the "All Items" sheet in sequence of the countsheet
  onProgress?.(`Filling items across countsheets and "${ALL_ITEMS_SHEET_NAME}"...`);
  const valueUpdates: any[] = [];

  for (let i = 0; i < plannedSheets.length; i++) {
    const plan = plannedSheets[i];
    const sheetTitle = plan.sheetTitle;

    // Build exactly 34 physical rows for row 9 through 42 targeting columns J:O (or minColLetter:maxColLetter)
    // On continuation rows (2nd+ row of a wrapped >50-char description), only Column K receives the remaining description
    // while Columns J, L, M, N, and O are left blank.
    const rowsForSheet: any[][] = [];
    for (let r = 0; r < CHUNK_SIZE; r++) {
      const rowCells: any[] = new Array(colSpan).fill('');
      if (r < plan.physicalRows.length) {
        const slot = plan.physicalRows[r];
        const item = slot.item;
        if (slot.isSpacer || !item) {
          // Leave rowCells as all '' so this row is a blank space in the countsheet template
        } else if (slot.isContinuation) {
          if (descColIdx >= 0) rowCells[descColIdx - minColIdx] = slot.descriptionLine || '';
        } else {
          if (codeColIdx >= 0) rowCells[codeColIdx - minColIdx] = item.itemCode || item.barcode || '';
          if (descColIdx >= 0) rowCells[descColIdx - minColIdx] = slot.descriptionLine || '';
          if (costColIdx >= 0) rowCells[costColIdx - minColIdx] = item.cost !== undefined && item.cost !== 0 ? item.cost : '';
          if (sellingColIdx >= 0) rowCells[sellingColIdx - minColIdx] = item.selling !== undefined && item.selling !== 0 ? item.selling : '';
          if (balanceColIdx >= 0) rowCells[balanceColIdx - minColIdx] = item.balance !== undefined ? item.balance : '';
          if (unitColIdx >= 0) rowCells[unitColIdx - minColIdx] = item.unit || 'PCS';
        }
      }
      rowsForSheet.push(rowCells);
    }

    valueUpdates.push({
      range: `'${sheetTitle}'!${minColLetter}9:${maxColLetter}42`,
      majorDimension: 'ROWS',
      values: rowsForSheet,
    });
  }

  // Add "All Items" sheet values (A1:L{N})
  valueUpdates.push({
    range: `'${ALL_ITEMS_SHEET_NAME}'!A1:L${allItemsRows.length}`,
    majorDimension: 'ROWS',
    values: allItemsRows,
  });

  const valuesBatchRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: valueUpdates,
      }),
    }
  );

  if (!valuesBatchRes.ok) {
    const errText = await valuesBatchRes.text();
    console.warn('Batch update values notice:', errText);
  }

  // 8. Remove the temporary base template tab now that all countsheet tabs and 'All Items' have been created
  try {
    if (!isNaN(Number(templateSheetId))) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [{ deleteSheet: { sheetId: Number(templateSheetId) } }],
        }),
      });
    }
  } catch (delErr) {
    console.warn('Could not remove base template tab:', delErr);
  }

  // Build summary results
  const sheetsCreated: CreatedCountsheetTabSummary[] = plannedSheets.map((p, idx) => ({
    sheetId: duplicateReplies[idx]?.duplicateSheet?.properties?.sheetId || idx,
    title: p.sheetTitle,
    itemCount: p.items.length,
    groupName: p.groupName,
    partNumber: p.partNumber,
    totalParts: p.totalParts,
  }));

  const totalItems = plannedSheets.reduce((sum, p) => sum + p.items.length, 0);

  return {
    spreadsheetId: newSpreadsheetId,
    spreadsheetName: finalTitle,
    webViewLink,
    sheetsCreated,
    totalSheets: plannedSheets.length,
    totalItems,
    folderId: countsheetFolder?.folderId,
    folderName: countsheetFolder?.folderName || GENERATED_COUNTSHEET_FOLDER_NAME,
    folderWebViewLink: countsheetFolder?.webViewLink,
  };
}

/**
 * Updates an already-generated Countsheet Google Spreadsheet in-place when the user adds, removes,
 * or reorders items in the Countsheet builder.
 * Re-plots J9:O42 (with 50-char wrapping) and restores/updates horizontal borders across B9:H42
 * so removing a 2-row item immediately restores the horizontal border in the open Google Sheet.
 */
export async function updateExistingCountsheetSpreadsheet(
  options: CreateCountsheetFromTemplateOptions & { existingSpreadsheetId: string }
): Promise<CreateCountsheetFromTemplateResult | null> {
  const {
    accessToken: rawAccessToken,
    templateSpreadsheetId = DEFAULT_COUNTSHEET_TEMPLATE_ID,
    templateGid = DEFAULT_COUNTSHEET_TEMPLATE_GID,
    existingSpreadsheetId,
    targetSpreadsheetTitle,
    insertCategorySpacers = true,
    groups,
    onProgress,
  } = options;

  const cleanSpreadsheetId = extractSpreadsheetId(existingSpreadsheetId);
  if (!cleanSpreadsheetId || cleanSpreadsheetId.startsWith('cs_') || cleanSpreadsheetId.startsWith('draft_')) {
    return null;
  }

  const accessToken =
    (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken || '';
  if (!accessToken || !isGoogleOAuthAccessToken(accessToken)) {
    return null;
  }

  const activeGroups = groups.filter((g) => g.items && g.items.length > 0);
  if (activeGroups.length === 0) return null;

  const CHUNK_SIZE = COUNTSHEET_MAX_ROWS_PER_SHEET;

  interface PlannedSheet {
    groupId: string;
    groupName: string;
    baseSheetName: string;
    sheetTitle: string;
    csNumber: number;
    items: GroupCountsheetPlanItem[];
    physicalRows: SheetPhysicalRowSlot<GroupCountsheetPlanItem>[];
    partNumber: number;
    totalParts: number;
  }

  const plannedSheets: PlannedSheet[] = [];
  const usedTitles = new Set<string>([ALL_ITEMS_SHEET_NAME.toLowerCase()]);
  let runningCsCounter = 1;

  for (let gIdx = 0; gIdx < activeGroups.length; gIdx++) {
    const grp = activeGroups[gIdx];
    const packedPages = packItemsInto34RowSheets(
      grp.items,
      CHUNK_SIZE,
      COUNTSHEET_DESC_MAX_CHARS,
      insertCategorySpacers
    );
    const totalParts = Math.max(1, packedPages.length);
    const defaultCsName = `CS${String(runningCsCounter).padStart(2, '0')}`;
    let baseRaw = (grp.baseSheetName || grp.groupName || defaultCsName)
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!baseRaw || /^Group\s+\d+$/i.test(baseRaw)) baseRaw = defaultCsName;
    const cleanBase = baseRaw.slice(0, 70).trim();
    const csMatch = cleanBase.match(/^CS(\d+)$/i);

    for (let p = 0; p < totalParts; p++) {
      const page = packedPages[p] || { items: [], physicalRows: [], rowsUsed: 0 };
      const partNum = p + 1;
      const csNumber = csMatch ? parseInt(csMatch[1], 10) + p : runningCsCounter + p;
      let titleCandidate = (
        csMatch
          ? `CS${String(parseInt(csMatch[1], 10) + p).padStart(2, '0')}`
          : partNum === 1
          ? cleanBase
          : `${cleanBase} ${partNum}`
      )
        .replace(/\s+/g, ' ')
        .trim();

      let counter = partNum;
      while (usedTitles.has(titleCandidate.toLowerCase())) {
        counter++;
        titleCandidate = (
          csMatch
            ? `CS${String(parseInt(csMatch[1], 10) + counter - 1).padStart(2, '0')}`
            : `${cleanBase} ${counter}`
        )
          .replace(/\s+/g, ' ')
          .trim();
      }
      usedTitles.add(titleCandidate.toLowerCase());

      plannedSheets.push({
        groupId: grp.groupId,
        groupName: grp.groupName || defaultCsName,
        baseSheetName: cleanBase,
        sheetTitle: titleCandidate,
        csNumber,
        items: page.items,
        physicalRows: page.physicalRows,
        partNumber: partNum,
        totalParts,
      });
    }
    runningCsCounter += totalParts;
  }

  // Fetch existing spreadsheet metadata
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanSpreadsheetId}?fields=properties.title,sheets.properties`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }
  );
  if (!metaRes.ok) return null;

  const metaData = await metaRes.json();
  const existingSheets: any[] = metaData.sheets || [];
  if (existingSheets.length === 0) return null;

  onProgress?.(`Copying updated RANDOM INVENTORY COUNTSHEET TEMPLATE (font & column sizes)...`);
  let tempSheetId: number | null = null;

  // 1. Copy the latest template tab directly from the RANDOM INVENTORY COUNTSHEET TEMPLATE spreadsheet
  // so any updates to font and column sizes in the template are applied!
  try {
    const cleanTemplateId = extractSpreadsheetId(templateSpreadsheetId || DEFAULT_COUNTSHEET_TEMPLATE_ID);
    const gidMatch = (templateSpreadsheetId || '').match(/gid=([0-9]+)/);
    const requestedGid = gidMatch ? gidMatch[1] : String(templateGid || DEFAULT_COUNTSHEET_TEMPLATE_GID);
    let targetGidNum = Number(requestedGid || 1328306184);

    const srcMetaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanTemplateId}?fields=sheets.properties`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }
    );
    if (srcMetaRes.ok) {
      const srcMeta = await srcMetaRes.json();
      const srcSheets: any[] = srcMeta.sheets || [];
      const matchedSrcSheet =
        srcSheets.find((s: any) => String(s.properties?.sheetId) === String(requestedGid)) ||
        srcSheets.find((s: any) => /countsheet|template|random|copy/i.test(s.properties?.title || '')) ||
        srcSheets[0];
      if (matchedSrcSheet?.properties?.sheetId !== undefined) {
        targetGidNum = Number(matchedSrcSheet.properties.sheetId);
      }
    }

    const copyToRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanTemplateId}/sheets/${targetGidNum}:copyTo`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          destinationSpreadsheetId: cleanSpreadsheetId,
        }),
      }
    );
    if (copyToRes.ok) {
      const copyToData = await copyToRes.json().catch(() => null);
      if (copyToData && copyToData.sheetId !== undefined) {
        tempSheetId = Number(copyToData.sheetId);
      }
    }
  } catch (copyTplErr) {
    console.warn('Could not copy fresh template tab into existing spreadsheet, falling back to first tab:', copyTplErr);
  }

  // Fallback: duplicate first existing countsheet tab (excluding "All Items") if external template copyTo was unavailable
  if (tempSheetId === null || isNaN(tempSheetId)) {
    const candidateSheet =
      existingSheets.find(
        (s: any) =>
          String(s.properties?.title || '').trim().toLowerCase() !==
          ALL_ITEMS_SHEET_NAME.toLowerCase()
      ) || existingSheets[0];
    const sourceSheetId = Number(candidateSheet.properties.sheetId);
    const tempBaseName = `__tpl_sync_${Date.now().toString().slice(-5)}`;
    const dupTempRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanSpreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              duplicateSheet: {
                sourceSheetId,
                insertSheetIndex: 0,
                newSheetName: tempBaseName,
              },
            },
          ],
        }),
      }
    );
    if (!dupTempRes.ok) return null;
    const dupTempData = await dupTempRes.json();
    tempSheetId = Number(dupTempData.replies?.[0]?.duplicateSheet?.properties?.sheetId);
  }

  // Rename tempSheetId to a guaranteed-unique temporary name and delete all old sheets
  const tempSyncTitle = `__tpl_sync_${Date.now().toString().slice(-6)}`;
  const oldSheetDeleteReqs = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: Number(tempSheetId),
          title: tempSyncTitle,
        },
        fields: 'title',
      },
    },
    ...existingSheets.map((s: any) => ({
      deleteSheet: { sheetId: Number(s.properties.sheetId) },
    })),
  ];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanSpreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests: oldSheetDeleteReqs }),
  });

  // Duplicate tempSheetId for each planned sheet + add 'All Items' sheet
  const allItemsRows = buildAllItemsSheetRows(plannedSheets);
  const duplicateRequests: any[] = [
    ...plannedSheets.map((plan, idx) => ({
      duplicateSheet: {
        sourceSheetId: tempSheetId,
        insertSheetIndex: idx,
        newSheetName: plan.sheetTitle,
      },
    })),
    {
      addSheet: {
        properties: {
          title: ALL_ITEMS_SHEET_NAME,
          index: plannedSheets.length,
          gridProperties: {
            rowCount: Math.max(100, allItemsRows.length + 20),
            columnCount: 12,
            frozenRowCount: 1,
          },
        },
      },
    },
  ];
  const batchDupRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanSpreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: duplicateRequests }),
    }
  );
  if (!batchDupRes.ok) return null;
  const batchDupData = await batchDupRes.json();
  const allReplies: any[] = batchDupData.replies || [];
  const duplicateReplies = allReplies.slice(0, plannedSheets.length);
  const addedAllItemsSheetId = allReplies[plannedSheets.length]?.addSheet?.properties?.sheetId;

  // Format borders across B9:H42, format 'All Items' sheet, and delete tempSheetId
  const borderRequests: any[] = [];
  for (let i = 0; i < plannedSheets.length; i++) {
    const plan = plannedSheets[i];
    const dupSheetId = duplicateReplies[i]?.duplicateSheet?.properties?.sheetId;
    if (dupSheetId === undefined || dupSheetId === null) continue;
    borderRequests.push(
      ...buildCountsheetRowBorderRequests(Number(dupSheetId), plan.physicalRows, CHUNK_SIZE)
    );
  }
  if (addedAllItemsSheetId !== undefined && addedAllItemsSheetId !== null) {
    borderRequests.push(
      ...buildAllItemsSheetFormatRequests(Number(addedAllItemsSheetId), allItemsRows.length)
    );
  }
  borderRequests.push({
    deleteSheet: { sheetId: tempSheetId },
  });

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanSpreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests: borderRequests }),
  });

  // Populate J9:O42 for each tab + populate 'All Items' sheet
  const valueUpdates: any[] = [];
  for (let i = 0; i < plannedSheets.length; i++) {
    const plan = plannedSheets[i];
    const rowsForSheet: any[][] = [];
    for (let r = 0; r < CHUNK_SIZE; r++) {
      const rowCells: any[] = ['', '', '', '', '', ''];
      if (r < plan.physicalRows.length) {
        const slot = plan.physicalRows[r];
        const item = slot.item;
        if (slot.isSpacer || !item) {
          // Leave rowCells as all '' so this row is a blank space in the countsheet template
        } else if (slot.isContinuation) {
          rowCells[1] = slot.descriptionLine || '';
        } else {
          rowCells[0] = item.itemCode || item.barcode || '';
          rowCells[1] = slot.descriptionLine || '';
          rowCells[2] = item.cost !== undefined && item.cost !== 0 ? item.cost : '';
          rowCells[3] = item.selling !== undefined && item.selling !== 0 ? item.selling : '';
          rowCells[4] = item.balance !== undefined ? item.balance : '';
          rowCells[5] = item.unit || 'PCS';
        }
      }
      rowsForSheet.push(rowCells);
    }
    valueUpdates.push({
      range: `'${plan.sheetTitle}'!J9:O42`,
      majorDimension: 'ROWS',
      values: rowsForSheet,
    });
  }

  valueUpdates.push({
    range: `'${ALL_ITEMS_SHEET_NAME}'!A1:L${allItemsRows.length}`,
    majorDimension: 'ROWS',
    values: allItemsRows,
  });

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanSpreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: valueUpdates,
      }),
    }
  );

  const sheetsCreated: CreatedCountsheetTabSummary[] = plannedSheets.map((p, idx) => ({
    sheetId: duplicateReplies[idx]?.duplicateSheet?.properties?.sheetId || idx,
    title: p.sheetTitle,
    itemCount: p.items.length,
    groupName: p.groupName,
    partNumber: p.partNumber,
    totalParts: p.totalParts,
  }));

  const totalItems = plannedSheets.reduce((sum, p) => sum + p.items.length, 0);

  const countsheetFolder = await ensureUserDriveFolder(accessToken, GENERATED_COUNTSHEET_FOLDER_NAME);
  if (countsheetFolder?.folderId) {
    await moveFileToDriveFolder(accessToken, cleanSpreadsheetId, countsheetFolder.folderId);
  }

  return {
    spreadsheetId: cleanSpreadsheetId,
    spreadsheetName: targetSpreadsheetTitle || metaData.properties?.title || 'Audit Countsheets',
    webViewLink: `https://docs.google.com/spreadsheets/d/${cleanSpreadsheetId}/edit`,
    sheetsCreated,
    totalSheets: plannedSheets.length,
    totalItems,
    folderId: countsheetFolder?.folderId,
    folderName: countsheetFolder?.folderName || GENERATED_COUNTSHEET_FOLDER_NAME,
    folderWebViewLink: countsheetFolder?.webViewLink,
  };
}

// ============================================================================
// RECENT GENERATED COUNTSHEETS STORAGE & RESTORATION
// Allows users to view, re-open in Google Sheets, or restore/edit previous setups
// ============================================================================

export interface PreGeneratedCountsheetItem {
  id: string;
  rowIndex?: number;
  itemCode: string;
  barcode: string;
  itemDescription: string;
  category: string;
  subCategory: string;
  subsubCategory: string;
  unit: string;
  cost: number;
  selling: number;
  balance: number;
  actual?: number | null;
  csCode: string; // e.g. "CS01", "CS02"
  sheetTitle?: string;
  raw?: any[];
  isMissingItem?: boolean;
}

export interface SavedCountsheetGroupState {
  id: string;
  name: string;
  baseSheetName: string;
  selectedCat: string;
  selectedSubCat: string;
  selectedSubSubCat: string;
  selectedCats?: string[];
  selectedSubCats?: string[];
  selectedSubSubCats?: string[];
  lastSelectedHierarchy: string;
  hierarchySearchQuery?: string;
  selectedItemIds: string[];
  selectedRowIndices?: number[];
  selectedItemCodes?: string[];
  selectedBarcodes?: string[];
  randomCountInput?: number;
  startCsNumber?: number;
  endCsNumber?: number;
  csUsed?: number;
  orderedItems?: PreGeneratedCountsheetItem[];
}

export interface RecentCountsheetSession {
  id: string;
  spreadsheetId: string;
  spreadsheetName: string;
  webViewLink: string;
  createdAt: string;
  ownerEmail?: string;
  totalSheets: number;
  totalItems: number;
  sourceFile: {
    id: string;
    name: string;
    tabName?: string;
  };
  templateUrl?: string;
  onlyItemsWithBalance?: boolean;
  insertCategorySpacers?: boolean;
  sheetsCreated?: CreatedCountsheetTabSummary[];
  savedGroups?: SavedCountsheetGroupState[];
  iatdHeaders?: string[];
  headerRow?: number;
  orderedCountsheetItems?: PreGeneratedCountsheetItem[];
  rawItems?: PreGeneratedCountsheetItem[];
}

function getRecentCountsheetsStorageKey(): string {
  return `audit_recent_generated_countsheets_v2_${getUserStorageScopeKey()}`;
}

function sanitizeCountsheetSessionForStorage(session: RecentCountsheetSession): RecentCountsheetSession {
  return JSON.parse(
    JSON.stringify({
      ...session,
      savedGroups: (session.savedGroups || []).map((g) => ({
        ...g,
        orderedItems: (g.orderedItems || []).map(({ raw: _raw, ...rest }) => rest),
      })),
      orderedCountsheetItems: (session.orderedCountsheetItems || []).map(
        ({ raw: _raw, ...rest }) => rest
      ),
    })
  );
}

type CountsheetsListener = (sessions: RecentCountsheetSession[]) => void;
const countsheetsListeners = new Set<CountsheetsListener>();

export function subscribeToRecentCountsheets(listener: CountsheetsListener): () => void {
  countsheetsListeners.add(listener);
  return () => {
    countsheetsListeners.delete(listener);
  };
}

function notifyCountsheetsListeners(sessions: RecentCountsheetSession[]) {
  countsheetsListeners.forEach((l) => {
    try {
      l(sessions);
    } catch {}
  });
}

export async function syncRecentCountsheetsFromCloud(): Promise<RecentCountsheetSession[]> {
  const activeEmail = getActiveUserEmail();
  if (!activeEmail) {
    notifyCountsheetsListeners([]);
    return [];
  }
  const local = getRecentCountsheetsLocal();
  let serverSessions: RecentCountsheetSession[] = [];

  // 1. Fetch from Server API scoped to active user email
  try {
    const res = await fetch(`/api/recent-countsheets?email=${encodeURIComponent(activeEmail)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        serverSessions = data.filter(
          (s) => s && s.ownerEmail && s.ownerEmail.trim().toLowerCase() === activeEmail
        );
      }
    }
  } catch (e) {
    console.warn('Failed to fetch recent countsheets from server:', e);
  }

  // 2. Fetch from Google Drive Cloud Sync file
  let driveSessions: RecentCountsheetSession[] = [];
  let driveHadUnverifiedItems = false;
  try {
    const drivePayload = await readRecentsFromGoogleDrive();
    if (drivePayload?.deletedCountsheetIds?.length) {
      const localActiveIds = new Set<string>();
      local.forEach((s) => {
        if (s?.id) localActiveIds.add(s.id);
        if (s?.spreadsheetId) localActiveIds.add(s.spreadsheetId);
      });
      const safeToTombstone = drivePayload.deletedCountsheetIds.filter(
        (id) => !localActiveIds.has(id)
      );
      addDeletedIds(getDeletedCountsheetsStorageKey(), safeToTombstone, true);
    }
    if (drivePayload?.recentCountsheets) {
      driveSessions = drivePayload.recentCountsheets;
    }
  } catch {}

  const deletedIds = getDeletedIds(getDeletedCountsheetsStorageKey());
  let remoteHadDeleted = false;

  // Actively purge any deleted countsheets still lingering in Server SQLite
  serverSessions.forEach((s) => {
    if (s && (deletedIds.has(s.id) || (s.spreadsheetId && deletedIds.has(s.spreadsheetId)))) {
      remoteHadDeleted = true;
      if (s.id) {
        fetch(`/api/recent-countsheets/${encodeURIComponent(s.id)}`, { method: 'DELETE' }).catch(() => {});
      }
      if (s.spreadsheetId && s.spreadsheetId !== s.id) {
        fetch(`/api/recent-countsheets/${encodeURIComponent(s.spreadsheetId)}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  });

  driveSessions.forEach((s) => {
    if (s && (deletedIds.has(s.id) || (s.spreadsheetId && deletedIds.has(s.spreadsheetId)))) {
      remoteHadDeleted = true;
    }
  });

  const seenIds = new Set<string>();
  const seenSpreadsheetIds = new Set<string>();
  const map = new Map<string, RecentCountsheetSession>();
  [...serverSessions, ...driveSessions, ...local].forEach((s) => {
    if (!s || (!s.spreadsheetId && !s.id)) return;
    if (s.ownerEmail && s.ownerEmail.trim().toLowerCase() !== activeEmail) {
      driveHadUnverifiedItems = true;
      return;
    }
    if (deletedIds.has(s.id) || (s.spreadsheetId && deletedIds.has(s.spreadsheetId))) return;
    if (s.id && seenIds.has(s.id)) return;
    if (s.spreadsheetId && seenSpreadsheetIds.has(s.spreadsheetId)) return;
    if (s.id) seenIds.add(s.id);
    if (s.spreadsheetId) seenSpreadsheetIds.add(s.spreadsheetId);

    const key = s.id || s.spreadsheetId;
    map.set(key, sanitizeCountsheetSessionForStorage({ ...s, ownerEmail: activeEmail }));
  });

  const merged = Array.from(map.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);

  try {
    localStorage.setItem(getRecentCountsheetsStorageKey(), JSON.stringify(merged));
  } catch {}

  notifyCountsheetsListeners(merged);

  // Backfill any local-only countsheet sessions up to Server and Google Drive
  const serverIds = new Set(serverSessions.map((s) => s.spreadsheetId || s.id));
  for (const item of merged) {
    const key = item.spreadsheetId || item.id;
    if (deletedIds.has(item.id) || deletedIds.has(key)) continue;
    if (!serverIds.has(key)) {
      fetch('/api/recent-countsheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, ownerEmail: activeEmail }),
      }).catch(() => {});
    }
  }

  if (merged.length !== driveSessions.length || remoteHadDeleted || driveHadUnverifiedItems) {
    writeRecentsToGoogleDrive(undefined, merged).catch(() => {});
  }

  return merged;
}

export function getRecentCountsheetsLocal(): RecentCountsheetSession[] {
  try {
    const activeEmail = getActiveUserEmail();
    if (!activeEmail) return [];
    const raw = localStorage.getItem(getRecentCountsheetsStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const deletedIds = getDeletedIds(getDeletedCountsheetsStorageKey());
      const seenIds = new Set<string>();
      const seenSpreadsheetIds = new Set<string>();
      return parsed.filter((s) => {
        if (!s || deletedIds.has(s.id) || (s.spreadsheetId && deletedIds.has(s.spreadsheetId))) return false;
        if (s.ownerEmail && s.ownerEmail.trim().toLowerCase() !== activeEmail) return false;
        if (s.id && seenIds.has(s.id)) return false;
        if (s.spreadsheetId && seenSpreadsheetIds.has(s.spreadsheetId)) return false;
        if (s.id) seenIds.add(s.id);
        if (s.spreadsheetId) seenSpreadsheetIds.add(s.spreadsheetId);
        return true;
      });
    }
    return [];
  } catch (e) {
    console.warn('Failed to load recent countsheets from localStorage:', e);
    return [];
  }
}

export function getRecentCountsheets(): RecentCountsheetSession[] {
  setTimeout(() => {
    syncRecentCountsheetsFromCloud().catch(() => {});
  }, 50);
  return getRecentCountsheetsLocal();
}

export async function saveRecentCountsheet(
  session: Omit<RecentCountsheetSession, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
): Promise<RecentCountsheetSession> {
  lastCountsheetMutationAt = Date.now();
  const activeEmail = getActiveUserEmail();
  const current = getRecentCountsheetsLocal();
  const rawSession: RecentCountsheetSession = {
    id: session.id || `cs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    spreadsheetId: session.spreadsheetId,
    spreadsheetName: session.spreadsheetName,
    webViewLink: session.webViewLink,
    createdAt: session.createdAt || new Date().toISOString(),
    ownerEmail: activeEmail || session.ownerEmail,
    totalSheets: session.totalSheets,
    totalItems: session.totalItems,
    sourceFile: session.sourceFile,
    templateUrl: session.templateUrl || '',
    onlyItemsWithBalance: !!session.onlyItemsWithBalance,
    insertCategorySpacers: session.insertCategorySpacers !== undefined ? !!session.insertCategorySpacers : false,
    sheetsCreated: session.sheetsCreated || [],
    savedGroups: session.savedGroups || [],
    iatdHeaders: session.iatdHeaders || [],
    headerRow: session.headerRow ?? 2,
    orderedCountsheetItems: session.orderedCountsheetItems || [],
  };

  const newSession = sanitizeCountsheetSessionForStorage(rawSession);

  // If user is explicitly saving/updating this ID, remove it from deleted tombstones
  removeDeletedIds(getDeletedCountsheetsStorageKey(), [newSession.id, newSession.spreadsheetId]);

  const filtered = current.filter((r) => {
    if (!r) return false;
    if (r.id === newSession.id) return false;
    if (newSession.spreadsheetId && r.spreadsheetId === newSession.spreadsheetId) return false;
    return true;
  });
  const updated = [newSession, ...filtered].slice(0, 30);

  try {
    localStorage.setItem(getRecentCountsheetsStorageKey(), JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to save recent countsheet session to localStorage:', e);
  }

  notifyCountsheetsListeners(updated);

  // 1. Save to server SQLite API (non-blocking)
  fetch('/api/recent-countsheets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(newSession),
  }).catch((e) => {
    console.warn('Failed to save recent countsheet to server:', e);
  });

  // 2. Save to Google Drive Cloud Sync file
  writeRecentsToGoogleDrive(undefined, updated).catch(() => {});

  return newSession;
}

export function deleteRecentCountsheet(id: string): RecentCountsheetSession[] {
  lastCountsheetMutationAt = Date.now();
  const current = getRecentCountsheetsLocal();
  const target = current.find((r) => r.id === id || r.spreadsheetId === id);

  // Record in persistent tombstone set so cloud/Drive/SQLite sync never resurrects it
  addDeletedIds(getDeletedCountsheetsStorageKey(), [id, target?.id, target?.spreadsheetId]);

  const updated = current.filter((r) => r.id !== id && r.spreadsheetId !== id);
  if (target) {
    moveToTrash([{ item: target, type: 'countsheet' }]);
  }
  try {
    localStorage.setItem(getRecentCountsheetsStorageKey(), JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to delete recent countsheet session:', e);
  }

  notifyCountsheetsListeners(updated);

  // 1. Delete from server SQLite API
  try {
    fetch(`/api/recent-countsheets/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    if (target && target.id !== id) {
      fetch(`/api/recent-countsheets/${encodeURIComponent(target.id)}`, { method: 'DELETE' }).catch(() => {});
    }
    if (target && target.spreadsheetId && target.spreadsheetId !== id) {
      fetch(`/api/recent-countsheets/${encodeURIComponent(target.spreadsheetId)}`, { method: 'DELETE' }).catch(() => {});
    }
  } catch {}

  // 2. Update Google Drive Cloud Sync file
  writeRecentsToGoogleDrive(undefined, updated).catch(() => {});

  return updated;
}

export function clearRecentCountsheets(): void {
  lastCountsheetMutationAt = Date.now();
  const current = getRecentCountsheetsLocal();
  const idsToMark: string[] = [];
  current.forEach((item) => {
    if (item.id) idsToMark.push(item.id);
    if (item.spreadsheetId) idsToMark.push(item.spreadsheetId);
  });
  addDeletedIds(getDeletedCountsheetsStorageKey(), idsToMark);

  if (current.length > 0) {
    moveToTrash(current.map((item) => ({ item, type: 'countsheet' })));
  }

  try {
    localStorage.removeItem(getRecentCountsheetsStorageKey());
  } catch (e) {
    console.warn('Failed to clear recent countsheets:', e);
  }
  notifyCountsheetsListeners([]);

  for (const item of current) {
    fetch(`/api/recent-countsheets/${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => {});
    if (item.spreadsheetId && item.spreadsheetId !== item.id) {
      fetch(`/api/recent-countsheets/${encodeURIComponent(item.spreadsheetId)}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  writeRecentsToGoogleDrive(undefined, []).catch(() => {});
}

// ============================================================================
// PRE-GENERATED COUNTSHEET TO ENCODING INTEGRATION HELPERS
// ============================================================================

export interface IatdDetectedColumns {
  codeIdx: number;
  barcodeIdx: number;
  descIdx: number;
  catIdx: number;
  subCatIdx: number;
  subSubCatIdx: number;
  costIdx: number;
  sellingIdx: number;
  unitIdx: number;
  balanceIdx: number;
  actualIdx: number;
}

export function detectIatdColumnIndices(headers: string[]): IatdDetectedColumns {
  let codeIdx = -1;
  let barcodeIdx = -1;
  let descIdx = -1;
  let catIdx = -1;
  let subCatIdx = -1;
  let subSubCatIdx = -1;
  let costIdx = -1;
  let sellingIdx = -1;
  let unitIdx = -1;
  let balanceIdx = -1;
  let actualIdx = -1;

  headers.forEach((h, idx) => {
    const norm = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm) return;
    if (codeIdx === -1 && /^(itemcode|code|itemno|sku|matcode|productcode)$/i.test(norm)) {
      codeIdx = idx;
    } else if (barcodeIdx === -1 && /^(barcode|upc|ean|barcodeno|scancode)$/i.test(norm)) {
      barcodeIdx = idx;
    } else if (descIdx === -1 && /^(itemdescription|description|desc|particulars|itemname|productname|itemdesc|stockdescription)$/i.test(norm)) {
      descIdx = idx;
    } else if (catIdx === -1 && /^(category|cat|itemcategory|group|grp|class|classification|dept)$/i.test(norm)) {
      catIdx = idx;
    } else if (subCatIdx === -1 && /^(subcategory|subcat|subgroup|subclass|subgrp)$/i.test(norm)) {
      subCatIdx = idx;
    } else if (subSubCatIdx === -1 && /^(subsubcategory|subsubcat|subsubgroup|subsubclass)$/i.test(norm)) {
      subSubCatIdx = idx;
    } else if (costIdx === -1 && /^(cost|unitcost|ucost|costprice|buyprice|stdcost)$/i.test(norm)) {
      costIdx = idx;
    } else if (sellingIdx === -1 && /^(selling|sellingprice|sprice|sellprice|retail|srp|unitprice)$/i.test(norm)) {
      sellingIdx = idx;
    } else if (unitIdx === -1 && /^(unit|uom|unitofmeasure|pack|package)$/i.test(norm)) {
      unitIdx = idx;
    } else if (balanceIdx === -1 && /^(balance|qty|quantity|begqty|onhand|stock|endingbalance|perpos)$/i.test(norm)) {
      balanceIdx = idx;
    } else if (actualIdx === -1 && /^(actual|actualcount|actualqty|physicalcount|totalactual)$/i.test(norm)) {
      actualIdx = idx;
    }
  });

  if (codeIdx === -1) codeIdx = headers.findIndex((h) => /code/i.test(h) && !/bar/i.test(h));
  if (barcodeIdx === -1) barcodeIdx = headers.findIndex((h) => /bar/i.test(h));
  if (descIdx === -1) descIdx = headers.findIndex((h) => /desc|name|particular/i.test(h));
  if (catIdx === -1) catIdx = headers.findIndex((h) => /cat/i.test(h) && !/sub/i.test(h));
  if (subCatIdx === -1) subCatIdx = headers.findIndex((h) => /sub.*cat/i.test(h) && !/sub.*sub/i.test(h));
  if (subSubCatIdx === -1) subSubCatIdx = headers.findIndex((h) => /sub.*sub/i.test(h));
  if (costIdx === -1) costIdx = headers.findIndex((h) => /cost/i.test(h));
  if (sellingIdx === -1) sellingIdx = headers.findIndex((h) => /sell|retail|srp|price/i.test(h));
  if (unitIdx === -1) unitIdx = headers.findIndex((h) => /unit|uom|pc\/box/i.test(h));
  if (balanceIdx === -1) balanceIdx = headers.findIndex((h) => /bal|qty|onhand|pos/i.test(h));

  return {
    codeIdx,
    barcodeIdx,
    descIdx,
    catIdx,
    subCatIdx,
    subSubCatIdx,
    costIdx,
    sellingIdx,
    unitIdx,
    balanceIdx,
    actualIdx,
  };
}

export function parseIatdRowToCountsheetItem(
  row: any[],
  rowIndex: number,
  cols: IatdDetectedColumns,
  csCode: string = 'CS01',
  sheetTitle?: string
): PreGeneratedCountsheetItem {
  const itemCode = cols.codeIdx >= 0 ? String(row[cols.codeIdx] ?? '').trim() : '';
  const barcode = cols.barcodeIdx >= 0 ? String(row[cols.barcodeIdx] ?? '').trim() : '';
  const itemDescription =
    cols.descIdx >= 0
      ? String(row[cols.descIdx] ?? '').trim()
      : String(row[2] ?? row[1] ?? `Item ${rowIndex + 1}`).trim();
  const category = cols.catIdx >= 0 ? String(row[cols.catIdx] ?? '').trim() : '';
  const subCategory = cols.subCatIdx >= 0 ? String(row[cols.subCatIdx] ?? '').trim() : '';
  const subsubCategory = cols.subSubCatIdx >= 0 ? String(row[cols.subSubCatIdx] ?? '').trim() : '';
  const unit = (cols.unitIdx >= 0 ? String(row[cols.unitIdx] ?? '').trim() : '') || 'PCS';

  const parseNum = (val: any): number => {
    if (val === undefined || val === null || String(val).trim() === '') return 0;
    const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  const cost = cols.costIdx >= 0 ? parseNum(row[cols.costIdx]) : 0;
  const selling = cols.sellingIdx >= 0 ? parseNum(row[cols.sellingIdx]) : 0;
  const balance = cols.balanceIdx >= 0 ? parseNum(row[cols.balanceIdx]) : 0;
  const actualRaw =
    cols.actualIdx >= 0 && row[cols.actualIdx] !== undefined && String(row[cols.actualIdx]).trim() !== ''
      ? parseNum(row[cols.actualIdx])
      : null;

  return {
    id: `${itemCode || barcode || rowIndex}_${rowIndex}_${csCode}`,
    rowIndex,
    itemCode,
    barcode,
    itemDescription,
    category,
    subCategory,
    subsubCategory,
    unit,
    cost,
    selling,
    balance,
    actual: actualRaw,
    csCode,
    sheetTitle: sheetTitle || csCode,
    raw: [...row],
  };
}

/**
 * Reconstructs the ordered list of PreGeneratedCountsheetItem from a saved RecentCountsheetSession,
 * maintaining backward compatibility with sessions that only saved selectedRowIndices / selectedItemCodes.
 */
export function reconstructCountsheetItemsFromSession(
  session: RecentCountsheetSession,
  iatdHeaders: string[] = [],
  iatdRows: any[][] = []
): PreGeneratedCountsheetItem[] {
  const CHUNK_SIZE = 34;
  const cols = detectIatdColumnIndices(iatdHeaders);

  // Build quick lookup maps from iatdRows if available
  const rowByCode = new Map<string, { row: any[]; idx: number }>();
  const rowByBarcode = new Map<string, { row: any[]; idx: number }>();
  iatdRows.forEach((row, idx) => {
    if (!row) return;
    const c = cols.codeIdx >= 0 ? String(row[cols.codeIdx] ?? '').trim().toLowerCase() : String(row[0] ?? '').trim().toLowerCase();
    const b = cols.barcodeIdx >= 0 ? String(row[cols.barcodeIdx] ?? '').trim().toLowerCase() : '';
    if (c && !rowByCode.has(c)) rowByCode.set(c, { row, idx });
    if (b && !rowByBarcode.has(b)) rowByBarcode.set(b, { row, idx });
  });

  const enrichWithRaw = (item: PreGeneratedCountsheetItem, seqIdx: number): PreGeneratedCountsheetItem => {
    if (item.raw && item.raw.length > 0) return item;
    if (item.rowIndex !== undefined && iatdRows[item.rowIndex]) {
      return { ...item, raw: [...iatdRows[item.rowIndex]] };
    }
    const codeKey = (item.itemCode || '').trim().toLowerCase();
    if (codeKey && rowByCode.has(codeKey)) {
      const found = rowByCode.get(codeKey)!;
      return { ...item, rowIndex: found.idx, raw: [...found.row] };
    }
    const barKey = (item.barcode || '').trim().toLowerCase();
    if (barKey && rowByBarcode.has(barKey)) {
      const found = rowByBarcode.get(barKey)!;
      return { ...item, rowIndex: found.idx, raw: [...found.row] };
    }
    return {
      ...item,
      id: item.id || `cs_item_${seqIdx}_${Date.now()}`,
      raw: buildIatdRowFromCountsheetItem(item, iatdHeaders),
    };
  };

  // 1. If session has top-level orderedCountsheetItems, use them directly in exact sequence
  if (session.orderedCountsheetItems && session.orderedCountsheetItems.length > 0) {
    return session.orderedCountsheetItems.map((it, idx) => enrichWithRaw(it, idx));
  }

  // 2. Otherwise reconstruct from savedGroups in group & countsheet sequence
  if (session.savedGroups && session.savedGroups.length > 0) {
    const result: PreGeneratedCountsheetItem[] = [];
    let runningCsCounter = 1;

    for (const grp of session.savedGroups) {
      // 2a. If group has orderedItems saved
      if (grp.orderedItems && grp.orderedItems.length > 0) {
        const totalParts = Math.max(1, Math.ceil(grp.orderedItems.length / CHUNK_SIZE));
        grp.orderedItems.forEach((it, idxInGrp) => {
          const partOffset = Math.floor(idxInGrp / CHUNK_SIZE);
          const csCode = it.csCode || `CS${String(runningCsCounter + partOffset).padStart(2, '0')}`;
          result.push(enrichWithRaw({ ...it, csCode }, result.length));
        });
        runningCsCounter += totalParts;
        continue;
      }

      // 2b. Backward compatibility: reconstruct from selectedRowIndices / selectedItemIds / selectedItemCodes
      const matchedRows: Array<{ row: any[]; rowIndex: number }> = [];
      const seenIndices = new Set<number>();

      if (grp.selectedRowIndices && grp.selectedRowIndices.length > 0 && iatdRows.length > 0) {
        for (const rIdx of grp.selectedRowIndices) {
          if (iatdRows[rIdx] && !seenIndices.has(rIdx)) {
            seenIndices.add(rIdx);
            matchedRows.push({ row: iatdRows[rIdx], rowIndex: rIdx });
          }
        }
      }

      if (matchedRows.length === 0 && grp.selectedItemCodes && grp.selectedItemCodes.length > 0 && iatdRows.length > 0) {
        for (const code of grp.selectedItemCodes) {
          const cleanCode = String(code || '').trim().toLowerCase();
          const match = rowByCode.get(cleanCode);
          if (match && !seenIndices.has(match.idx)) {
            seenIndices.add(match.idx);
            matchedRows.push({ row: match.row, rowIndex: match.idx });
          }
        }
      }

      if (matchedRows.length === 0 && grp.selectedItemIds && grp.selectedItemIds.length > 0 && iatdRows.length > 0) {
        for (const itemId of grp.selectedItemIds) {
          const parts = String(itemId).split('_');
          const parsedIdx = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(parsedIdx) && iatdRows[parsedIdx] && !seenIndices.has(parsedIdx)) {
            seenIndices.add(parsedIdx);
            matchedRows.push({ row: iatdRows[parsedIdx], rowIndex: parsedIdx });
          }
        }
      }

      const totalParts = Math.max(1, Math.ceil(matchedRows.length / CHUNK_SIZE));
      matchedRows.forEach(({ row, rowIndex }, idxInGrp) => {
        const partOffset = Math.floor(idxInGrp / CHUNK_SIZE);
        const csCode = `CS${String(runningCsCounter + partOffset).padStart(2, '0')}`;
        const parsedItem = parseIatdRowToCountsheetItem(
          row,
          rowIndex,
          cols,
          csCode,
          grp.baseSheetName || csCode
        );
        if (session.onlyItemsWithBalance && (parsedItem.balance === 0 || isNaN(parsedItem.balance))) {
          return;
        }
        result.push(parsedItem);
      });

      runningCsCounter += totalParts;
    }

    return result;
  }

  return [];
}

/**
 * Synthesizes or updates an IATD-compatible row array from a PreGeneratedCountsheetItem
 * so that edited Balance, Actual, and newly added missing inventory items map cleanly into ENCODING columns.
 */
export function buildIatdRowFromCountsheetItem(
  item: PreGeneratedCountsheetItem,
  iatdHeaders: string[]
): any[] {
  const cols = detectIatdColumnIndices(iatdHeaders);
  const baseRow = item.raw && item.raw.length > 0
    ? [...item.raw]
    : new Array(Math.max(iatdHeaders.length, 10)).fill('');

  while (baseRow.length < iatdHeaders.length) {
    baseRow.push('');
  }

  if (cols.codeIdx >= 0) baseRow[cols.codeIdx] = item.itemCode || '';
  if (cols.barcodeIdx >= 0) baseRow[cols.barcodeIdx] = item.barcode || '';
  if (cols.descIdx >= 0) baseRow[cols.descIdx] = item.itemDescription || '';
  if (cols.catIdx >= 0) baseRow[cols.catIdx] = item.category || '';
  if (cols.subCatIdx >= 0) baseRow[cols.subCatIdx] = item.subCategory || '';
  if (cols.subSubCatIdx >= 0) baseRow[cols.subSubCatIdx] = item.subsubCategory || '';
  if (cols.costIdx >= 0) baseRow[cols.costIdx] = item.cost ?? 0;
  if (cols.sellingIdx >= 0) baseRow[cols.sellingIdx] = item.selling ?? 0;
  if (cols.unitIdx >= 0) baseRow[cols.unitIdx] = item.unit || 'PCS';
  if (cols.balanceIdx >= 0) baseRow[cols.balanceIdx] = item.balance ?? 0;
  if (cols.actualIdx >= 0 && item.actual !== undefined && item.actual !== null) {
    baseRow[cols.actualIdx] = item.actual;
  }

  return baseRow;
}

/**
 * Reads a pre-generated Countsheet Google Spreadsheet directly from Google Drive.
 * Inspects each tab (Rows 8-42, Columns B-O) to extract items in their exact sequence,
 * including Balance (Col N / Per POS Col F) and Actual Count (Col E) if entered in the sheet.
 */
export async function fetchCountsheetItemsFromSpreadsheet(
  rawAccessToken: string,
  spreadsheetId: string
): Promise<{
  spreadsheetId: string;
  spreadsheetTitle: string;
  totalSheets: number;
  items: PreGeneratedCountsheetItem[];
}> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const accessToken = (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  const { title: spreadsheetTitle, tabs } = await getSpreadsheetTabs(accessToken, cleanId);

  const items: PreGeneratedCountsheetItem[] = [];
  const parseNum = (val: any): number => {
    if (val === undefined || val === null || String(val).trim() === '') return 0;
    const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  // Check if an "All Items" summary sheet exists to enrich barcode, category, subCategory, and subsubCategory
  const allItemsTab = tabs.find(
    (t) => t.title.trim().toLowerCase() === ALL_ITEMS_SHEET_NAME.toLowerCase()
  );
  const allItemsMetadataByCode = new Map<
    string,
    {
      barcode: string;
      category: string;
      subCategory: string;
      subsubCategory: string;
      cost: number;
      selling: number;
      unit: string;
      balance: number;
    }
  >();

  if (allItemsTab) {
    try {
      const safeAllItemsTab = `'${allItemsTab.title.replace(/'/g, "''")}'`;
      const allItemsRange = encodeURIComponent(`${safeAllItemsTab}!A1:L5000`);
      const allRes = await fetchWithRetry(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${allItemsRange}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (allRes.ok) {
        const allData: any = await allRes.json();
        const allRows: any[][] = allData.values || [];
        for (let r = 1; r < allRows.length; r++) {
          const row = allRows[r] || [];
          const code = String(row[1] ?? '').trim().toLowerCase();
          if (!code) continue;
          allItemsMetadataByCode.set(code, {
            barcode: String(row[2] ?? '').trim(),
            category: String(row[4] ?? '').trim(),
            subCategory: String(row[5] ?? '').trim(),
            subsubCategory: String(row[6] ?? '').trim(),
            cost: parseNum(row[7]),
            selling: parseNum(row[8]),
            unit: String(row[9] ?? 'PCS').trim() || 'PCS',
            balance: parseNum(row[10]),
          });
        }
      }
    } catch {
      // ignore optional enrichment errors
    }
  }

  const countsheetTabs = tabs.filter(
    (t) => t.title.trim().toLowerCase() !== ALL_ITEMS_SHEET_NAME.toLowerCase()
  );

  for (let tIdx = 0; tIdx < countsheetTabs.length; tIdx++) {
    const tab = countsheetTabs[tIdx];
    const csMatch = tab.title.trim().match(/^CS0*(\d+)/i);
    const csCode = csMatch
      ? `CS${String(parseInt(csMatch[1], 10)).padStart(2, '0')}`
      : `CS${String(tIdx + 1).padStart(2, '0')}`;

    const safeTab = `'${tab.title.replace(/'/g, "''")}'`;
    const range = encodeURIComponent(`${safeTab}!A1:O45`);
    const res = await fetchWithRetry(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) continue;
    const data: any = await res.json();
    const rows: any[][] = data.values || [];

    // Check if this is a standard 12-col COUNTSHEET tab (Header on Row 1) or Template Countsheet (Header on Row 8, Items on Rows 9-42)
    const row0 = (rows[0] || []).map((c: any) => String(c || '').trim().toLowerCase());
    if (row0.includes('item code') && row0.includes('item description')) {
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const code = String(row[0] ?? '').trim();
        const barcode = String(row[1] ?? '').trim();
        const desc = String(row[2] ?? '').trim();
        if (!code && !desc && !barcode) continue;
        const actualStr = String(row[8] ?? '').trim();
        items.push({
          id: `sheet_${tIdx}_${r}_${code || r}`,
          rowIndex: items.length,
          itemCode: code,
          barcode,
          itemDescription: desc,
          category: String(row[3] ?? '').trim(),
          subCategory: String(row[4] ?? '').trim(),
          subsubCategory: String(row[5] ?? '').trim(),
          unit: String(row[6] ?? 'PCS').trim() || 'PCS',
          cost: 0,
          selling: 0,
          balance: parseNum(row[7]),
          actual: actualStr !== '' ? parseNum(actualStr) : null,
          csCode: String(row[9] || csCode).trim().toUpperCase(),
          sheetTitle: tab.title,
        });
      }
    } else {
      // Template Countsheet format: Rows 9-42 (0-indexed rows 8 to 41)
      // Printable columns: Col B (idx 1) = Code, Col C (idx 2) = Desc, Col D (idx 3) = Unit, Col E (idx 4) = Actual Count, Col F (idx 5) = Per POS
      // Data columns: Col J (idx 9) = Item Code, Col K (idx 10) = Stock Description, Col L (idx 11) = Cost, Col M (idx 12) = Selling, Col N (idx 13) = Balance, Col O (idx 14) = Unit
      const headerRow8 = (rows[7] || []).map((c: any) => String(c || '').trim().toLowerCase());
      const dynamicCodeCol = headerRow8.findIndex((h, idx) => idx >= 8 && (h === 'item code' || h === 'code' || h === 'item no'));
      const dynamicDescCol = headerRow8.findIndex((h, idx) => idx >= 8 && (h.includes('description') || h === 'particulars'));

      let lastTabItem: PreGeneratedCountsheetItem | null = null;
      for (let r = 8; r <= Math.min(41, rows.length - 1); r++) {
        const row = rows[r] || [];
        const codeFromDataCol = dynamicCodeCol >= 0 ? String(row[dynamicCodeCol] || '').trim() : String(row[9] || '').trim();
        const codeFromPrintCol = String(row[1] || '').trim();
        const itemCode = (codeFromDataCol || codeFromPrintCol) === '0' && !codeFromDataCol ? '' : (codeFromDataCol || codeFromPrintCol);

        const descFromDataCol = dynamicDescCol >= 0 ? String(row[dynamicDescCol] || '').trim() : String(row[10] || '').trim();
        const descFromPrintCol = String(row[2] || '').trim();
        const itemDescription = descFromDataCol || descFromPrintCol;
        if (!itemCode && !itemDescription) {
          lastTabItem = null;
          continue;
        }

        // Continuation row detection: if Item Code (Col J) is blank and Item Description (Col K) has text,
        // merge the continuation line onto the preceding item on this sheet tab.
        if (!itemCode && itemDescription && lastTabItem) {
          lastTabItem.itemDescription = `${lastTabItem.itemDescription} ${itemDescription}`.trim();
          continue;
        }

        const enriched = itemCode
          ? allItemsMetadataByCode.get(itemCode.trim().toLowerCase())
          : undefined;
        const cost = parseNum(row[11]) || enriched?.cost || 0;
        const selling = parseNum(row[12]) || enriched?.selling || 0;
        const balance = row[13] !== undefined && String(row[13]).trim() !== ''
          ? parseNum(row[13])
          : parseNum(row[5]);
        const unit = String(row[14] || row[3] || enriched?.unit || 'PCS').trim() || 'PCS';
        const actualCell = String(row[4] ?? '').trim();
        const actual = actualCell !== '' ? parseNum(actualCell) : null;

        const createdItem: PreGeneratedCountsheetItem = {
          id: `tpl_${tIdx}_${r}_${itemCode || r}`,
          rowIndex: items.length,
          itemCode,
          barcode: enriched?.barcode || '',
          itemDescription,
          category: enriched?.category || tab.title,
          subCategory: enriched?.subCategory || '',
          subsubCategory: enriched?.subsubCategory || '',
          unit,
          cost,
          selling,
          balance,
          actual,
          csCode,
          sheetTitle: tab.title,
        };
        items.push(createdItem);
        lastTabItem = createdItem;
      }
    }
  }

  return {
    spreadsheetId: cleanId,
    spreadsheetTitle,
    totalSheets: countsheetTabs.length,
    items,
  };
}

/**
 * Writes the edited Actual quantities from pre-generated countsheet items into the corresponding
 * CS01, CS02, ... columns in the target ENCODING tab (and updates Balance if needed).
 */
export async function writeCountsheetActualsToEncodingSheet(
  rawAccessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  headerRow: number,
  items: PreGeneratedCountsheetItem[]
): Promise<void> {
  const itemsWithActuals = items
    .map((item, idx) => ({ item, rowNumber: headerRow + 1 + idx }))
    .filter(({ item }) => item.actual !== undefined && item.actual !== null && String(item.actual).trim() !== '' && !isNaN(Number(item.actual)));

  if (itemsWithActuals.length === 0) return;

  const accessToken = (await resolveValidOAuthToken(rawAccessToken, { allowPopup: false })) || rawAccessToken;
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const safeTabName = `'${sheetTitle.replace(/'/g, "''")}'`;

  // Fetch current header row (A2:ZZ2) to find exact column index for each CSxx header (CS01, CS02, ...)
  const headerRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
      `${safeTabName}!A${headerRow}:ZZ${headerRow}`
    )}?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!headerRes.ok) return;
  const headerData: any = await headerRes.json();
  const headers: string[] = (headerData.values?.[0] || []).map((c: any) => String(c || '').trim());

  const csColIndexByNum = new Map<number, number>();
  let fallbackActualColIdx = -1;

  headers.forEach((h, colIdx) => {
    const m = h.match(/^CS0*(\d+)$/i);
    if (m) {
      csColIndexByNum.set(parseInt(m[1], 10), colIdx);
    } else if (fallbackActualColIdx === -1 && /^(actual|actualcount|actualqty|physicalcount|totalactual)$/i.test(h.replace(/[^a-z0-9]/gi, ''))) {
      fallbackActualColIdx = colIdx;
    }
  });

  if (csColIndexByNum.size === 0 && fallbackActualColIdx === -1) return;

  const dataPayload: Array<{ range: string; majorDimension: 'ROWS'; values: any[][] }> = [];

  for (const { item, rowNumber } of itemsWithActuals) {
    const csMatch = (item.csCode || 'CS01').match(/(\d+)/);
    const csNum = csMatch ? parseInt(csMatch[1], 10) : 1;
    const colIdx = csColIndexByNum.get(csNum) ?? csColIndexByNum.get(1) ?? (fallbackActualColIdx >= 0 ? fallbackActualColIdx : undefined);
    if (colIdx === undefined) continue;

    const colLetter = numberToColumnLetter(colIdx);
    dataPayload.push({
      range: `${safeTabName}!${colLetter}${rowNumber}`,
      majorDimension: 'ROWS',
      values: [[Number(item.actual)]],
    });
  }

  if (dataPayload.length === 0) return;

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: dataPayload,
      }),
    }
  );
}

// ============================================================================
// TRASH RECYCLE BIN SYSTEM (30-DAY RETENTION WITH MANUAL RESTORE / PURGE)
// ============================================================================

export interface TrashItem {
  trashId: string;
  originalId: string;
  type: 'audit_report' | 'countsheet';
  title: string;
  spreadsheetId?: string;
  webViewLink?: string;
  itemCount?: number;
  sheetCount?: number;
  deletedAt: number; // epoch ms
  expiresAt: number; // epoch ms (deletedAt + 30 days)
  data: RecentAuditReport | RecentCountsheetSession;
}

export const TRASH_STORAGE_KEY = 'audit_recents_trash_v1';
function getTrashStorageKey(): string {
  return `audit_recents_trash_v2_${getUserStorageScopeKey()}`;
}
const RETENTION_30_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

type TrashListener = (items: TrashItem[]) => void;
const trashListeners = new Set<TrashListener>();

export function getTrashItems(): TrashItem[] {
  try {
    if (!getActiveUserEmail()) return [];
    const storageKey = getTrashStorageKey();
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const list: TrashItem[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    const now = Date.now();
    // Auto-purge items that have been in trash for more than 30 days
    const valid = list.filter(
      (item) => item && typeof item.expiresAt === 'number' && item.expiresAt > now
    );

    if (valid.length !== list.length) {
      localStorage.setItem(storageKey, JSON.stringify(valid));
    }

    return valid.sort((a, b) => b.deletedAt - a.deletedAt);
  } catch (err) {
    console.warn('Error reading trash items from localStorage:', err);
    return [];
  }
}

function saveTrashItems(items: TrashItem[]): void {
  try {
    localStorage.setItem(getTrashStorageKey(), JSON.stringify(items));
  } catch (e) {
    console.warn('Failed to save trash items to localStorage:', e);
  }
  trashListeners.forEach((listener) => {
    try {
      listener(items);
    } catch {}
  });
}

export function subscribeToTrash(listener: TrashListener): () => void {
  trashListeners.add(listener);
  try {
    listener(getTrashItems());
  } catch {}
  return () => {
    trashListeners.delete(listener);
  };
}

export function moveToTrash(
  entries: Array<{
    item: RecentAuditReport | RecentCountsheetSession;
    type: 'audit_report' | 'countsheet';
  }>
): void {
  if (!entries || entries.length === 0) return;
  const current = getTrashItems();
  const now = Date.now();
  const expiresAt = now + RETENTION_30_DAYS_MS;

  const newItems: TrashItem[] = entries.map(({ item, type }) => {
    const isReport = type === 'audit_report';
    const rep = item as RecentAuditReport;
    const cs = item as RecentCountsheetSession;

    const title = isReport
      ? rep.spreadsheetName || rep.iatdTitle || rep.templateTitle || 'Audit Report'
      : cs.spreadsheetName || 'Countsheet Session';

    const originalId = item.id;
    const spreadsheetId = isReport ? rep.spreadsheetId : cs.spreadsheetId;
    const webViewLink = item.webViewLink;
    const itemCount = isReport ? rep.totalRows : cs.totalItems;
    const sheetCount = isReport ? 1 : cs.totalSheets;

    return {
      trashId: `trash_${type}_${originalId}_${now}_${Math.random().toString(36).substring(2, 6)}`,
      originalId,
      type,
      title,
      spreadsheetId,
      webViewLink,
      itemCount,
      sheetCount,
      deletedAt: now,
      expiresAt,
      data: item,
    };
  });

  // Deduplicate against existing trash items by originalId
  const newOriginalIds = new Set(newItems.map((n) => n.originalId));
  const merged = [...newItems, ...current.filter((c) => !newOriginalIds.has(c.originalId))];
  saveTrashItems(merged.slice(0, 150));
}

export async function restoreTrashItem(trashId: string): Promise<boolean> {
  const current = getTrashItems();
  const target = current.find((i) => i.trashId === trashId);
  if (!target) return false;

  try {
    // 1. Immediately remove the item from Trash and notify Trash listeners
    const updatedTrash = current.filter((i) => i.trashId !== trashId);
    saveTrashItems(updatedTrash);

    // 2. Untombstone and restore the item to active Recents
    if (target.type === 'audit_report') {
      const rep = target.data as RecentAuditReport;
      removeDeletedIds(getDeletedReportsStorageKey(), [
        target.originalId,
        target.spreadsheetId,
        rep?.id,
        rep?.spreadsheetId,
      ]);
      await saveRecentAuditReport({
        ...rep,
        id: rep?.id || target.originalId,
        spreadsheetId: rep?.spreadsheetId || target.spreadsheetId || target.originalId,
        spreadsheetName: rep?.spreadsheetName || target.title || 'Restored Audit Report',
        totalRows: rep?.totalRows ?? target.itemCount ?? 0,
        webViewLink: rep?.webViewLink || target.webViewLink || '',
        createdAt: rep?.createdAt || new Date().toISOString(),
      });
    } else {
      const cs = target.data as RecentCountsheetSession;
      removeDeletedIds(getDeletedCountsheetsStorageKey(), [
        target.originalId,
        target.spreadsheetId,
        cs?.id,
        cs?.spreadsheetId,
      ]);
      await saveRecentCountsheet({
        ...cs,
        id: cs?.id || target.originalId,
        spreadsheetId: cs?.spreadsheetId || target.spreadsheetId || target.originalId,
        spreadsheetName: cs?.spreadsheetName || target.title || 'Restored Countsheet',
        webViewLink: cs?.webViewLink || target.webViewLink || '',
        totalSheets: cs?.totalSheets ?? target.sheetCount ?? 1,
        totalItems: cs?.totalItems ?? target.itemCount ?? 0,
        sourceFile: cs?.sourceFile || {
          id: target.spreadsheetId || target.originalId,
          name: target.title || 'Restored Countsheet',
        },
        createdAt: cs?.createdAt || new Date().toISOString(),
      });
    }

    return true;
  } catch (err) {
    console.error('Failed to restore trash item:', err);
    return false;
  }
}

export function permanentlyDeleteTrashItem(trashId: string): TrashItem[] {
  const current = getTrashItems();
  const updated = current.filter((i) => i.trashId !== trashId);
  saveTrashItems(updated);
  return updated;
}

export function emptyTrash(): void {
  saveTrashItems([]);
}

// ============================================================================
// IMPORT GENERATED COUNTSHEETS (PLOTTED TEMPLATE SPREADSHEETS)
// ============================================================================

/**
 * Imports an existing generated Countsheet Google Spreadsheet (plotted in the template format)
 * and reconstructs the full RecentCountsheetSession with all items, categories, and tabs.
 * Persists the restored session to Recent Countsheets so it can be viewed, reused, or encoded.
 */
export async function importGeneratedCountsheetFromDrive(
  rawAccessToken: string,
  spreadsheetIdOrUrl: string
): Promise<RecentCountsheetSession> {
  const cleanId = extractSpreadsheetId(spreadsheetIdOrUrl);
  if (!cleanId) {
    throw new Error('Please provide a valid Google Spreadsheet URL or ID.');
  }

  const { spreadsheetTitle, totalSheets, items } = await fetchCountsheetItemsFromSpreadsheet(
    rawAccessToken,
    cleanId
  );

  if (!items || items.length === 0) {
    throw new Error(
      `No countsheet items could be extracted from "${spreadsheetTitle || cleanId}". Please verify the spreadsheet contains countsheet tabs (e.g., CS01, CS02) with items plotted in Rows 9-42.`
    );
  }

  // Partition items into groups by sheetTitle or csCode
  const groupMap = new Map<string, PreGeneratedCountsheetItem[]>();
  items.forEach((item) => {
    const key = (item.sheetTitle || item.csCode || 'CS01').trim();
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(item);
  });

  const CHUNK_SIZE = COUNTSHEET_MAX_ROWS_PER_SHEET;
  let runningCs = 1;
  const savedGroups: SavedCountsheetGroupState[] = [];

  groupMap.forEach((grpItems, sheetTitle) => {
    const packed = packItemsInto34RowSheets(grpItems, CHUNK_SIZE, COUNTSHEET_DESC_MAX_CHARS);
    const csUsed = Math.max(1, packed.length);
    const startCsNumber = runningCs;
    const endCsNumber = runningCs + csUsed - 1;
    runningCs += csUsed;

    const baseName = sheetTitle.trim();
    savedGroups.push({
      id: `grp_imp_${savedGroups.length + 1}_${Date.now()}`,
      name: baseName,
      baseSheetName: baseName,
      selectedCat: '',
      selectedSubCat: '',
      selectedSubSubCat: '',
      lastSelectedHierarchy: baseName,
      hierarchySearchQuery: '',
      selectedItemIds: grpItems.map((it) => it.id),
      selectedRowIndices: grpItems.map((it, idx) => it.rowIndex ?? idx),
      selectedItemCodes: grpItems.map((it) => it.itemCode).filter(Boolean),
      selectedBarcodes: grpItems.map((it) => it.barcode).filter(Boolean),
      randomCountInput: grpItems.length,
      startCsNumber,
      endCsNumber,
      csUsed,
      orderedItems: grpItems,
    });
  });

  const sessionId = `cs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const webViewLink = `https://docs.google.com/spreadsheets/d/${cleanId}/edit`;

  const newSession: RecentCountsheetSession = {
    id: sessionId,
    spreadsheetId: cleanId,
    spreadsheetName: spreadsheetTitle || `Imported Countsheet - ${cleanId.slice(0, 8)}`,
    webViewLink,
    createdAt: new Date().toISOString(),
    totalSheets: Math.max(totalSheets, savedGroups.length),
    totalItems: items.length,
    sourceFile: {
      id: 'imported-countsheet',
      name: spreadsheetTitle || 'Imported Countsheet',
      tabName: cleanId,
    },
    savedGroups,
    orderedCountsheetItems: items,
    rawItems: items,
  };

  // Remove from any tombstone deletion list in case this spreadsheet ID was deleted before
  removeDeletedIds(getDeletedCountsheetsStorageKey(), [sessionId, cleanId]);

  // Persist into recent countsheets (local, server SQLite, Firestore, and Drive)
  await saveRecentCountsheet(newSession);

  return newSession;
}


