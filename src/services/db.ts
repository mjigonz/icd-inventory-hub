import {
  InventoryItem,
  Countsheet,
  MonitoringBlock,
  UnidentifiedItemRecord,
  SelectedBranch,
} from '../types';
import {
  auth,
  getRememberedUser,
  isGoogleOAuthAccessToken,
  getStoredOAuthToken,
  getStoredOAuthTokenTimestamp,
  saveOAuthTokenWithTimestamp,
  TOKEN_FRESH_MAX_AGE_MS,
} from './auth';

const DB_NAME = 'CountSheetDB';
const DB_VERSION = 2;

export interface WorkspaceSyncState {
  selectedBranch?: SelectedBranch | null;
  userRole?: 'owner' | 'encoder' | 'unassigned';
  savedBranches?: SelectedBranch[];
  activeCsByBranch?: Record<string, number>;
  customPhotoURL?: string | null;
  theme?: 'light' | 'dark';
  oauthAccessToken?: string | null;
  oauthTokenIssuedAt?: number;
  cachedDriveFiles?: Array<{ id: string; name: string; modifiedTime?: string; owner?: string }>;
  updatedAt?: string;
}

type CountsheetsListener = (countsheets: Countsheet[]) => void;
type MonitoringListener = (blocks: MonitoringBlock[]) => void;
type SavedBranchesListener = (branches: SelectedBranch[]) => void;
type WorkspaceListener = (state: WorkspaceSyncState) => void;

const countsheetsListeners = new Map<string, Set<CountsheetsListener>>();
const monitoringListeners = new Map<string, Set<MonitoringListener>>();
const savedBranchesListeners = new Set<SavedBranchesListener>();
const workspaceListeners = new Set<WorkspaceListener>();

export function getUserSyncKey(): string | null {
  try {
    const sessionToken = sessionStorage.getItem('countsheet_session_token');
    if (sessionToken && sessionToken.startsWith('auditor:')) {
      const parts = sessionToken.split(':');
      const decodedEmail = parts[1] ? decodeURIComponent(parts[1]).trim().toLowerCase() : '';
      if (!decodedEmail || decodedEmail.endsWith('@sidc.local') || decodedEmail === 'user') {
        return 'instant_preview_local';
      }
      return decodedEmail.replace(/[^a-z0-9@._-]/g, '_');
    }
  } catch {}
  const currentUser = auth.currentUser;
  if (currentUser?.email) {
    return currentUser.email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
  }
  const remembered = getRememberedUser();
  if (remembered?.email) {
    return remembered.email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
  }
  if (currentUser?.uid) {
    return currentUser.uid;
  }
  if (remembered?.displayName) {
    return remembered.displayName.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
  }
  return 'default_auditor_workspace';
}

export function getAccountScopeKey(emailOverride?: string | null): string {
  if (emailOverride && emailOverride.trim()) {
    return emailOverride.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
  }
  return getUserSyncKey() || 'default_auditor_workspace';
}

export function getActiveBranchStorageKey(emailOverride?: string | null): string {
  return `countsheet_active_branch_id_${getAccountScopeKey(emailOverride)}`;
}

export function getActiveRoleStorageKey(emailOverride?: string | null): string {
  return `countsheet_active_role_${getAccountScopeKey(emailOverride)}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('inventory')) {
        const store = db.createObjectStore('inventory', { keyPath: 'id' });
        store.createIndex('branch_source', ['branchId', 'source'], { unique: false });
        store.createIndex('branch_barcode', ['branchId', 'barcode'], { unique: false });
        store.createIndex('branch_itemCode', ['branchId', 'itemCode'], { unique: false });
      }

      if (!db.objectStoreNames.contains('countsheets')) {
        const store = db.createObjectStore('countsheets', { keyPath: 'id' });
        store.createIndex('branchId', 'branchId', { unique: false });
        store.createIndex('branch_cs', ['branchId', 'cs'], { unique: true });
      }

      if (!db.objectStoreNames.contains('branches')) {
        db.createObjectStore('branches', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('monitoring')) {
        const store = db.createObjectStore('monitoring', { keyPath: 'id' });
        store.createIndex('branchId', 'branchId', { unique: false });
      }

      if (!db.objectStoreNames.contains('unidentified')) {
        const store = db.createObjectStore('unidentified', { keyPath: 'id', autoIncrement: true });
        store.createIndex('branchId', 'branchId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function notifySavedBranchesListeners() {
  try {
    const list = await getAllSavedBranches();
    savedBranchesListeners.forEach((cb) => {
      try {
        cb(list);
      } catch (e) {
        console.warn('Error in savedBranches listener:', e);
      }
    });
  } catch (e) {
    console.warn('Failed to notify savedBranches listeners:', e);
  }
}

async function notifyCountsheetsListeners(branchId: string) {
  const set = countsheetsListeners.get(branchId);
  if (!set || set.size === 0) return;
  try {
    const list = await getBranchCountsheets(branchId);
    set.forEach((cb) => {
      try {
        cb(list);
      } catch (e) {
        console.warn('Error in countsheets listener:', e);
      }
    });
  } catch (e) {
    console.warn('Failed to notify countsheets listeners:', e);
  }
}

async function notifyMonitoringListeners(branchId: string) {
  const set = monitoringListeners.get(branchId);
  if (!set || set.size === 0) return;
  try {
    const list = await getBranchMonitoringBlocks(branchId);
    set.forEach((cb) => {
      try {
        cb(list);
      } catch (e) {
        console.warn('Error in monitoring listener:', e);
      }
    });
  } catch (e) {
    console.warn('Failed to notify monitoring listeners:', e);
  }
}

export function notifyAccountSwitched(): void {
  void notifySavedBranchesListeners();
}

// Save branch metadata only to IndexedDB (scoped per Google account so Local branches do not leak across accounts)
export async function saveBranchMetadataLocalOnly(branch: SelectedBranch): Promise<void> {
  const accountKey = getAccountScopeKey();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('branches', 'readwrite');
    tx.objectStore('branches').put({
      ...branch,
      id: `${accountKey}__${branch.id}`,
      branchId: branch.id,
      accountKey,
    });
    tx.oncomplete = () => {
      notifySavedBranchesListeners();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// ULTRA-FAST IN-MEMORY + SINGLE-RECORD SNAPSHOT INVENTORY ENGINE
// Stores ENCODING per account+branch and MASTERDATA globally as single compact records
// Masterdata is non-movable (shared across all accounts/branches); Local (ENCODING) is account-scoped
// ============================================================================

const memoryEncodingByBranch = new Map<string, InventoryItem[]>();
let memoryMasterdataItems: InventoryItem[] | null = null;
let inFlightMasterdataFetch: Promise<InventoryItem[]> | null = null;

const SNAP_MASTERDATA_KEY = '__SNAP_MAST_GLOBAL_V4__';
export const GUEST_LOCAL_BRANCH_ID = 'guest_local_iatd';
const getAccountBranchMemoryKey = (branchId: string, accountKey = getAccountScopeKey()) =>
  `${accountKey}__${branchId}`;
const getSnapEncodingKey = (branchId: string, accountKey = getAccountScopeKey()) =>
  `__SNAP_ENC_${accountKey}__${branchId}__`;

function parseServerMasterdataRows(rows: string[][]): InventoryItem[] {
  if (!rows || rows.length < 2) return [];
  const firstRow = rows[0] || [];
  const col2Header = String(firstRow[2] || '').trim().toLowerCase();
  const col6Header = String(firstRow[6] || '').trim().toLowerCase();
  const hasUnitAtCol2 = col2Header === 'unit' || col2Header === 'uom' || col2Header === 'unit/uom';
  const hasSheetAtCol6 = col6Header === 'sheet' || col6Header === 'tab';

  const len = rows.length;
  const items: InventoryItem[] = new Array(len - 1);
  let writeIdx = 0;
  for (let i = 1; i < len; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const itemCode = r[0] ? String(r[0]).trim() : '';
    const itemDescription = r[1] ? String(r[1]).trim() : '';

    if (hasUnitAtCol2) {
      const unit = (r[2] ? String(r[2]).trim() : '') || 'PCS';
      const category = r[3] ? String(r[3]).trim() : '';
      const subCategory = r[4] ? String(r[4]).trim() : '';
      const subsubCategory = r[5] ? String(r[5]).trim() : '';
      const barcode = r[6] ? String(r[6]).trim() : '';
      if (!itemCode && !barcode && !itemDescription) continue;
      if (itemCode.toLowerCase() === 'item code' && itemDescription.toLowerCase().includes('desc')) {
        continue;
      }
      const rawCol7 = r[7] ? String(r[7]).trim().toUpperCase() : '';
      const sheetTag =
        rawCol7 ||
        (itemCode.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS');

      items[writeIdx++] = {
        itemCode,
        barcode,
        itemDescription,
        category,
        subCategory,
        subsubCategory,
        cost: 0,
        selling: 0,
        unit,
        begQty: 0,
        in: 0,
        out: 0,
        balance: 0,
        amount: 0,
        gp: 0,
        source: 'MASTERDATA',
        masterdataSheet: sheetTag,
      };
    } else {
      const barcode = r[5] ? String(r[5]).trim() : '';
      if (!itemCode && !barcode && !itemDescription) continue;
      if (itemCode.toLowerCase() === 'item code' && itemDescription.toLowerCase().includes('desc')) {
        continue;
      }
      const rawCol6 = r[6] ? String(r[6]).trim() : '';
      const isExplicitSheetCol =
        hasSheetAtCol6 ? Boolean(rawCol6) : (rawCol6.toUpperCase() === 'GRO' || rawCol6.toUpperCase() === 'OTHERS');
      const sheetTag =
        (isExplicitSheetCol ? rawCol6.toUpperCase() : '') ||
        (itemCode.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS');
      const unit =
        (r[7] ? String(r[7]).trim() : '') ||
        (!isExplicitSheetCol && rawCol6 && rawCol6.length <= 6 ? rawCol6 : 'PCS');

      items[writeIdx++] = {
        itemCode,
        barcode,
        itemDescription,
        category: r[2] ? String(r[2]).trim() : '',
        subCategory: r[3] ? String(r[3]).trim() : '',
        subsubCategory: r[4] ? String(r[4]).trim() : '',
        cost: 0,
        selling: 0,
        unit,
        begQty: 0,
        in: 0,
        out: 0,
        balance: 0,
        amount: 0,
        gp: 0,
        source: 'MASTERDATA',
        masterdataSheet: sheetTag,
      };
    }
  }
  items.length = writeIdx;
  return items;
}

// Internal helper to write inventory items to IndexedDB without triggering recursive cloud upload
async function saveBranchInventoryLocalOnly(
  branch: SelectedBranch,
  encodingItems: InventoryItem[],
  masterdataItems: InventoryItem[]
): Promise<void> {
  const accountKey = getAccountScopeKey();
  const memKey = getAccountBranchMemoryKey(branch.id, accountKey);

  if (encodingItems.length > 0 || !memoryEncodingByBranch.has(memKey)) {
    memoryEncodingByBranch.set(memKey, encodingItems);
  }
  if (masterdataItems.length > 0) {
    memoryMasterdataItems = masterdataItems;
  }

  const effectiveEnc = memoryEncodingByBranch.get(memKey) || encodingItems;
  const effectiveMast =
    masterdataItems.length > 0
      ? masterdataItems
      : memoryMasterdataItems || masterdataItems;

  const syncedBranch: SelectedBranch = {
    ...branch,
    lastSyncedAt: branch.lastSyncedAt || new Date().toISOString(),
    encodingCount: effectiveEnc.length,
    masterdataCount: effectiveMast.length || branch.masterdataCount || 0,
  };

  const db = await openDB();
  const tx = db.transaction(['inventory', 'branches'], 'readwrite');
  const invStore = tx.objectStore('inventory');
  const branchStore = tx.objectStore('branches');

  branchStore.put({
    ...syncedBranch,
    id: `${accountKey}__${syncedBranch.id}`,
    branchId: syncedBranch.id,
    accountKey,
  });

  // Store account-scoped compact single-record snapshot for Local ENCODING
  invStore.put({
    id: getSnapEncodingKey(branch.id, accountKey),
    items: effectiveEnc,
    updatedAt: syncedBranch.lastSyncedAt,
  });

  // Store non-movable global Masterdata snapshot across all accounts
  if (effectiveMast.length > 0) {
    invStore.put({
      id: SNAP_MASTERDATA_KEY,
      items: effectiveMast,
      updatedAt: syncedBranch.lastSyncedAt,
    });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      notifySavedBranchesListeners();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Save branch inventory snapshot (ENCODING and MASTERDATA) + push to cloud in background
export async function saveBranchInventory(
  branch: SelectedBranch,
  encodingItems: InventoryItem[],
  masterdataItems: InventoryItem[]
): Promise<void> {
  const accountKey = getAccountScopeKey();
  const syncedBranch: SelectedBranch = {
    ...branch,
    lastSyncedAt: new Date().toISOString(),
    encodingCount: encodingItems.length,
    masterdataCount: masterdataItems.length || memoryMasterdataItems?.length || branch.masterdataCount || 0,
  };

  await saveBranchInventoryLocalOnly(syncedBranch, encodingItems, masterdataItems);

  // Push account-scoped branch ENCODING snapshot to server DB asynchronously in the background (non-blocking)
  void fetch(`/api/sync/branch-inventory/${encodeURIComponent(`${accountKey}__${branch.id}`)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branch: syncedBranch,
      encodingItems,
      masterdataItems: [], // Masterdata is cached globally via /api/masterdata
    }),
  }).catch((e) => {
    console.warn('Could not push branch inventory snapshot to server:', e);
  });

  // Also sync updated savedBranches list to user's cloud workspace in the background
  void getAllSavedBranches()
    .then((allSaved) =>
      syncWorkspaceStateToCloud({ savedBranches: allSaved, selectedBranch: syncedBranch })
    )
    .catch((e) => {
      console.warn('Could not sync savedBranches to cloud workspace:', e);
    });
}

function hasBothGroAndOthers(items: InventoryItem[] | null | undefined): boolean {
  if (!items || items.length < 70000) return false;
  let hasGro = false;
  let hasOthers = false;
  for (let i = 0; i < items.length; i++) {
    const sheet =
      items[i].masterdataSheet ||
      (String(items[i].itemCode || '').toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS');
    if (sheet === 'GRO') hasGro = true;
    else if (sheet === 'OTHERS') hasOthers = true;
    if (hasGro && hasOthers) return true;
  }
  return false;
}

// Get all items in memory / IndexedDB for a given branch and source
export async function getBranchInventoryBySource(
  branchId: string,
  source: 'ENCODING' | 'MASTERDATA'
): Promise<InventoryItem[]> {
  const effectiveBranchId = branchId || GUEST_LOCAL_BRANCH_ID;

  if (source === 'MASTERDATA') {
    if (memoryMasterdataItems !== null) {
      void syncMasterdataFromServerIfUpdated(null);
      return memoryMasterdataItems;
    }
    try {
      const db = await openDB();
      const snap = await new Promise<any>((resolve) => {
        const tx = db.transaction('inventory', 'readonly');
        const req = tx.objectStore('inventory').get(SNAP_MASTERDATA_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      const isExplicitlyEmptySnap =
        Array.isArray(snap?.configuredSheets) && snap.configuredSheets.length === 0;
      if (snap && Array.isArray(snap.items) && (snap.items.length > 0 || isExplicitlyEmptySnap)) {
        memoryMasterdataItems = snap.items;
        if (snap.updatedAt && !lastKnownServerMasterdataUpdatedAt) {
          lastKnownServerMasterdataUpdatedAt = snap.updatedAt;
        }
        if (snap.spreadsheetId && !lastKnownServerSpreadsheetId) {
          lastKnownServerSpreadsheetId = snap.spreadsheetId;
        }
        if (Array.isArray(snap.configuredSheets) && !lastKnownServerConfiguredSheets) {
          lastKnownServerConfiguredSheets = snap.configuredSheets;
        }
        void syncMasterdataFromServerIfUpdated(null);
        return snap.items;
      }

      // Auto-hydrate Masterdata from server /api/masterdata cache if missing
      if (!inFlightMasterdataFetch) {
        inFlightMasterdataFetch = (async () => {
          try {
            const storedToken = getStoredOAuthToken();
            const res = await fetch(`/api/masterdata?_ts=${Date.now()}`, {
              headers:
                storedToken && isGoogleOAuthAccessToken(storedToken)
                  ? { Authorization: `Bearer ${storedToken}` }
                  : undefined,
              cache: 'no-store',
            });
            if (res.ok) {
              const data: any = await res.json();
              const configuredList: string[] | null = Array.isArray(data?.configuredSheets)
                ? data.configuredSheets.map((s: any) => String(s || '').trim().toUpperCase()).filter(Boolean)
                : null;
              const serverSpreadsheetId =
                typeof data?.spreadsheetId === 'string' ? data.spreadsheetId.trim() : '';
              const serverUpdatedAt =
                typeof data?.updatedAt === 'string' && data.updatedAt.trim()
                  ? data.updatedAt.trim()
                  : new Date().toISOString();

              if (configuredList !== null) {
                lastKnownServerConfiguredSheets = configuredList;
                try {
                  localStorage.setItem(
                    'countsheet_active_masterdata_sheets_v1',
                    JSON.stringify(configuredList)
                  );
                } catch {}
              }
              if (serverSpreadsheetId) {
                lastKnownServerSpreadsheetId = serverSpreadsheetId;
                try {
                  localStorage.setItem(
                    'countsheet_active_masterdata_spreadsheet_id_v1',
                    serverSpreadsheetId
                  );
                } catch {}
              }

              const parsed =
                Array.isArray(data?.rows) && data.rows.length > 1
                  ? parseServerMasterdataRows(data.rows)
                  : [];
              const isExplicitlyEmpty = configuredList !== null && configuredList.length === 0;

              if (parsed.length > 0 || isExplicitlyEmpty) {
                memoryMasterdataItems = parsed;
                lastKnownServerMasterdataUpdatedAt = serverUpdatedAt;
                const writeDb = await openDB();
                await new Promise<void>((resolve) => {
                  const tx = writeDb.transaction('inventory', 'readwrite');
                  tx.objectStore('inventory').put({
                    id: SNAP_MASTERDATA_KEY,
                    items: parsed,
                    updatedAt: serverUpdatedAt,
                    spreadsheetId: serverSpreadsheetId || undefined,
                    configuredSheets: configuredList || undefined,
                  });
                  tx.oncomplete = () => resolve();
                  tx.onerror = () => resolve();
                });
                return parsed;
              }
            }
          } catch {}
          return snap && Array.isArray(snap.items) ? snap.items : [];
        })().finally(() => {
          inFlightMasterdataFetch = null;
        });
      }

      const hydrated = await inFlightMasterdataFetch;
      if (hydrated && (hydrated.length > 0 || memoryMasterdataItems !== null)) {
        return hydrated;
      }
    } catch {}
    return memoryMasterdataItems || [];
  }

  // ENCODING source (strictly scoped to the current Google account so switching accounts never shows previous account's Local inventory)
  const accountKey = getAccountScopeKey();
  const memKey = getAccountBranchMemoryKey(effectiveBranchId, accountKey);
  const cachedEnc = memoryEncodingByBranch.get(memKey);
  if (cachedEnc && cachedEnc.length > 0) {
    return cachedEnc;
  }

  try {
    const db = await openDB();
    const snap = await new Promise<any>((resolve) => {
      const tx = db.transaction('inventory', 'readonly');
      const req = tx.objectStore('inventory').get(getSnapEncodingKey(effectiveBranchId, accountKey));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (snap && Array.isArray(snap.items) && snap.items.length > 0) {
      memoryEncodingByBranch.set(memKey, snap.items);
      return snap.items;
    }
  } catch {}

  return [];
}

// Persist Guest Local IATD items to memory and IndexedDB snapshot
export async function saveGuestLocalIatdItems(items: InventoryItem[], spreadsheetId?: string): Promise<void> {
  const accountKey = getAccountScopeKey();
  const memKey = getAccountBranchMemoryKey(GUEST_LOCAL_BRANCH_ID, accountKey);
  memoryEncodingByBranch.set(memKey, items);

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('inventory', 'readwrite');
    tx.objectStore('inventory').put({
      id: getSnapEncodingKey(GUEST_LOCAL_BRANCH_ID, accountKey),
      items,
      updatedAt: new Date().toISOString(),
      spreadsheetId: spreadsheetId || '',
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Clear Guest Local IATD items from memory and IndexedDB
export async function clearGuestLocalIatdItems(): Promise<void> {
  const accountKey = getAccountScopeKey();
  const memKey = getAccountBranchMemoryKey(GUEST_LOCAL_BRANCH_ID, accountKey);
  memoryEncodingByBranch.delete(memKey);

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('inventory', 'readwrite');
    tx.objectStore('inventory').delete(getSnapEncodingKey(GUEST_LOCAL_BRANCH_ID, accountKey));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Retrieve Guest Local IATD items
export async function getGuestLocalIatdItems(): Promise<InventoryItem[]> {
  return getBranchInventoryBySource(GUEST_LOCAL_BRANCH_ID, 'ENCODING');
}

// Count how many items exist in memory / IndexedDB for a given branch and source
export async function countBranchInventoryBySource(
  branchId: string,
  source: 'ENCODING' | 'MASTERDATA'
): Promise<number> {
  const list = await getBranchInventoryBySource(branchId, source);
  return list.length;
}

let lastKnownServerMasterdataUpdatedAt: string | null = null;
let lastKnownServerSpreadsheetId: string | null = null;
let lastKnownServerConfiguredSheets: string[] | null = null;
let inFlightMasterdataSyncPromise: Promise<{
  updated: boolean;
  count: number;
  updatedBranch?: SelectedBranch | null;
}> | null = null;

// Save/Resync ONLY the MASTERDATA items (global & non-movable) while updating branch metadata if a branch is provided (works in Guest Mode when branch is null too)
export async function saveBranchMasterdata(
  branch: SelectedBranch | null,
  masterdataItems: InventoryItem[],
  serverUpdatedAt?: string | null,
  serverSpreadsheetId?: string | null,
  serverConfiguredSheets?: string[] | null
): Promise<SelectedBranch | null> {
  const accountKey = getAccountScopeKey();
  memoryMasterdataItems = masterdataItems;
  if (serverUpdatedAt) {
    lastKnownServerMasterdataUpdatedAt = serverUpdatedAt;
  }
  if (serverSpreadsheetId) {
    lastKnownServerSpreadsheetId = serverSpreadsheetId;
    try {
      localStorage.setItem('countsheet_active_masterdata_spreadsheet_id_v1', serverSpreadsheetId);
    } catch {}
  }
  if (Array.isArray(serverConfiguredSheets)) {
    lastKnownServerConfiguredSheets = serverConfiguredSheets;
    try {
      localStorage.setItem(
        'countsheet_active_masterdata_sheets_v1',
        JSON.stringify(serverConfiguredSheets)
      );
    } catch {}
  }
  const nowIso = new Date().toISOString();

  let updatedBranch: SelectedBranch | null = null;
  if (branch) {
    const existingEncoding = await getBranchInventoryBySource(branch.id, 'ENCODING');
    updatedBranch = {
      ...branch,
      encodingCount: existingEncoding.length || branch.encodingCount || 0,
      masterdataCount: masterdataItems.length,
      lastSyncedAt: nowIso,
    };
  }

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['inventory', 'branches'], 'readwrite');
    const branchStore = tx.objectStore('branches');

    if (updatedBranch) {
      branchStore.put({
        ...updatedBranch,
        id: `${accountKey}__${updatedBranch.id}`,
        branchId: updatedBranch.id,
        accountKey,
      });
    }

    // Update masterdataCount on all saved branches in IndexedDB so every branch reflects the new item count
    const cursorReq = branchStore.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const rec = cursor.value;
        if (rec && rec.masterdataCount !== masterdataItems.length) {
          cursor.update({
            ...rec,
            masterdataCount: masterdataItems.length,
          });
        }
        cursor.continue();
      }
    };

    tx.objectStore('inventory').put({
      id: SNAP_MASTERDATA_KEY,
      items: masterdataItems,
      updatedAt: serverUpdatedAt || lastKnownServerMasterdataUpdatedAt || nowIso,
      spreadsheetId: serverSpreadsheetId || lastKnownServerSpreadsheetId || undefined,
      configuredSheets:
        (Array.isArray(serverConfiguredSheets)
          ? serverConfiguredSheets
          : lastKnownServerConfiguredSheets) || undefined,
    });
    tx.oncomplete = () => {
      notifySavedBranchesListeners();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });

  // Update workspace state in background if a branch is active
  if (updatedBranch) {
    void getAllSavedBranches()
      .then((allSaved) =>
        syncWorkspaceStateToCloud({ savedBranches: allSaved, selectedBranch: updatedBranch! })
      )
      .catch(() => {});
  }

  return updatedBranch;
}

// Check if the server's global Masterdata snapshot has a newer timestamp, item count, spreadsheet ID, or configured sheets and sync if needed
export async function syncMasterdataFromServerIfUpdated(
  branch: SelectedBranch | null
): Promise<{ updated: boolean; count: number; updatedBranch?: SelectedBranch | null }> {
  if (inFlightMasterdataSyncPromise) {
    return inFlightMasterdataSyncPromise;
  }

  inFlightMasterdataSyncPromise = (async () => {
    try {
      const metaRes = await fetch(`/api/masterdata?meta=1&_ts=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!metaRes.ok) {
        return { updated: false, count: memoryMasterdataItems?.length || 0 };
      }
      const meta: {
        updatedAt?: string | null;
        totalItems?: number;
        configuredSheets?: string[];
        spreadsheetId?: string;
      } = await metaRes.json();
      const serverTotal = Number(meta?.totalItems || 0);
      const serverUpdatedAt = meta?.updatedAt || null;
      const serverSpreadsheetId =
        typeof meta?.spreadsheetId === 'string' && meta.spreadsheetId.trim()
          ? meta.spreadsheetId.trim()
          : null;
      const serverConfiguredSheets = Array.isArray(meta?.configuredSheets)
        ? meta.configuredSheets.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
        : null;

      const isExplicitlyEmptyConfig =
        serverConfiguredSheets !== null && serverConfiguredSheets.length === 0;

      if (serverTotal <= 0 && !isExplicitlyEmptyConfig) {
        return { updated: false, count: memoryMasterdataItems?.length || 0 };
      }

      let localUpdatedAt = lastKnownServerMasterdataUpdatedAt;
      let localSpreadsheetId = lastKnownServerSpreadsheetId;
      let localConfiguredSheets = lastKnownServerConfiguredSheets;
      let localCount = memoryMasterdataItems?.length || 0;

      // Inspect IndexedDB snapshot if in-memory metadata isn't set yet
      if (
        !localUpdatedAt ||
        !localSpreadsheetId ||
        !localConfiguredSheets ||
        (localCount === 0 && memoryMasterdataItems === null)
      ) {
        try {
          const db = await openDB();
          const snap = await new Promise<any>((resolve) => {
            const tx = db.transaction('inventory', 'readonly');
            const req = tx.objectStore('inventory').get(SNAP_MASTERDATA_KEY);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
          });
          if (snap) {
            if (!localUpdatedAt && snap.updatedAt) localUpdatedAt = snap.updatedAt;
            if (!localSpreadsheetId && snap.spreadsheetId) localSpreadsheetId = snap.spreadsheetId;
            if (!localConfiguredSheets && Array.isArray(snap.configuredSheets)) {
              localConfiguredSheets = snap.configuredSheets;
            }
            if (localCount === 0 && Array.isArray(snap.items)) localCount = snap.items.length;
          }
        } catch {}
      }

      if (!localSpreadsheetId) {
        try {
          localSpreadsheetId = localStorage.getItem('countsheet_active_masterdata_spreadsheet_id_v1');
        } catch {}
      }

      let isSheetsDifferent = false;
      if (serverConfiguredSheets !== null) {
        const serverSig = [...serverConfiguredSheets].sort().join(',');
        try {
          const savedSheetsRaw = localStorage.getItem('countsheet_active_masterdata_sheets_v1');
          if (savedSheetsRaw) {
            const savedSheets: string[] = JSON.parse(savedSheetsRaw);
            if (
              Array.isArray(savedSheets) &&
              savedSheets.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean).sort().join(',') !==
                serverSig
            ) {
              isSheetsDifferent = true;
            }
          }
        } catch {}

        if (
          !isSheetsDifferent &&
          localConfiguredSheets &&
          localConfiguredSheets.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean).sort().join(',') !==
            serverSig
        ) {
          isSheetsDifferent = true;
        }

        if (!isSheetsDifferent && memoryMasterdataItems && memoryMasterdataItems.length > 0) {
          const localSheetSet = new Set<string>();
          for (let i = 0; i < memoryMasterdataItems.length; i++) {
            const s = String(
              memoryMasterdataItems[i].masterdataSheet ||
                (memoryMasterdataItems[i].itemCode?.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS')
            )
              .trim()
              .toUpperCase();
            if (s) localSheetSet.add(s);
          }
          const serverSheetSet = new Set(serverConfiguredSheets);
          for (const ls of localSheetSet) {
            if (!serverSheetSet.has(ls)) {
              isSheetsDifferent = true;
              break;
            }
          }
          if (!isSheetsDifferent) {
            for (const ss of serverSheetSet) {
              if (!localSheetSet.has(ss)) {
                isSheetsDifferent = true;
                break;
              }
            }
          }
        }
      }

      const isCountDifferent = localCount !== serverTotal;
      const isTimestampNewer =
        Boolean(serverUpdatedAt) &&
        (!localUpdatedAt || serverUpdatedAt !== localUpdatedAt);
      const isSpreadsheetDifferent =
        Boolean(serverSpreadsheetId) && serverSpreadsheetId !== (localSpreadsheetId || '');

      if (!isCountDifferent && !isTimestampNewer && !isSheetsDifferent && !isSpreadsheetDifferent) {
        if (serverUpdatedAt && !lastKnownServerMasterdataUpdatedAt) {
          lastKnownServerMasterdataUpdatedAt = serverUpdatedAt;
        }
        if (serverSpreadsheetId && !lastKnownServerSpreadsheetId) {
          lastKnownServerSpreadsheetId = serverSpreadsheetId;
        }
        if (serverConfiguredSheets && !lastKnownServerConfiguredSheets) {
          lastKnownServerConfiguredSheets = serverConfiguredSheets;
        }
        return { updated: false, count: localCount };
      }

      const storedToken = getStoredOAuthToken();
      const dataRes = await fetch(`/api/masterdata?_ts=${Date.now()}`, {
        headers:
          storedToken && isGoogleOAuthAccessToken(storedToken)
            ? { Authorization: `Bearer ${storedToken}` }
            : undefined,
        cache: 'no-store',
      });
      if (!dataRes.ok) {
        return { updated: false, count: localCount };
      }
      const data: any = await dataRes.json();
      if (Array.isArray(data?.rows)) {
        const parsed = data.rows.length > 1 ? parseServerMasterdataRows(data.rows) : [];
        const dataConfiguredSheets: string[] | null = Array.isArray(data?.configuredSheets)
          ? data.configuredSheets.map((s: any) => String(s || '').trim().toUpperCase()).filter(Boolean)
          : serverConfiguredSheets;
        const dataSpreadsheetId: string | null =
          typeof data?.spreadsheetId === 'string' && data.spreadsheetId.trim()
            ? data.spreadsheetId.trim()
            : serverSpreadsheetId;
        const allowEmptySave =
          Array.isArray(dataConfiguredSheets) && dataConfiguredSheets.length === 0;

        if (parsed.length > 0 || allowEmptySave) {
          const effectiveUpdatedAt = data.updatedAt || serverUpdatedAt || new Date().toISOString();

          const updatedBranch = await saveBranchMasterdata(
            branch,
            parsed,
            effectiveUpdatedAt,
            dataSpreadsheetId,
            dataConfiguredSheets
          );

          // Notify UI components across the app to update item counts, sheet tabs, and tables automatically
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('masterdata-updated', {
                detail: {
                  count: parsed.length,
                  updatedAt: effectiveUpdatedAt,
                  sheets: dataConfiguredSheets || undefined,
                  spreadsheetId: dataSpreadsheetId || undefined,
                },
              })
            );
          }

          return {
            updated: true,
            count: parsed.length,
            updatedBranch,
          };
        }
      }
    } catch {}
    return { updated: false, count: memoryMasterdataItems?.length || 0 };
  })().finally(() => {
    inFlightMasterdataSyncPromise = null;
  });

  return inFlightMasterdataSyncPromise;
}

// Apply an in-place Masterdata item edit/add/delete to local memory and IndexedDB snapshot immediately
export async function applyMasterdataItemMutationLocal(
  branch: SelectedBranch | null,
  mutation:
    | {
        type: 'update';
        originalItem: InventoryItem;
        updatedItem: InventoryItem;
      }
    | {
        type: 'add';
        newItem: InventoryItem;
      }
    | {
        type: 'delete';
        targetItem: InventoryItem;
      }
): Promise<{ items: InventoryItem[]; updatedBranch?: SelectedBranch }> {
  const currentList = await getBranchInventoryBySource(branch?.id || '', 'MASTERDATA');
  const nextList = [...currentList];

  const matchesItem = (a: InventoryItem, b: InventoryItem): boolean => {
    const aSheet =
      (a.masterdataSheet || (a.itemCode?.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS')).toUpperCase();
    const bSheet =
      (b.masterdataSheet || (b.itemCode?.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS')).toUpperCase();
    if (aSheet !== bSheet) return false;
    if (b.itemCode && a.itemCode.trim().toLowerCase() === b.itemCode.trim().toLowerCase()) {
      if (!b.barcode || !a.barcode || a.barcode.trim().toLowerCase() === b.barcode.trim().toLowerCase()) {
        return true;
      }
    }
    if (b.barcode && a.barcode.trim().toLowerCase() === b.barcode.trim().toLowerCase()) {
      return true;
    }
    if (
      b.itemDescription &&
      a.itemDescription.trim().toLowerCase() === b.itemDescription.trim().toLowerCase()
    ) {
      return true;
    }
    return false;
  };

  if (mutation.type === 'update') {
    const idx = nextList.findIndex((it) => matchesItem(it, mutation.originalItem));
    if (idx !== -1) {
      nextList[idx] = mutation.updatedItem;
    } else {
      nextList.unshift(mutation.updatedItem);
    }
  } else if (mutation.type === 'add') {
    nextList.unshift(mutation.newItem);
  } else if (mutation.type === 'delete') {
    const idx = nextList.findIndex((it) => matchesItem(it, mutation.targetItem));
    if (idx !== -1) {
      nextList.splice(idx, 1);
    }
  }

  const updatedBranch = await saveBranchMasterdata(branch, nextList);
  return { items: nextList, updatedBranch: updatedBranch || undefined };
}

// Check if local IndexedDB has the inventory items for `branch` under the current account; if not, hydrate from server snapshot
const hydratingBranches = new Set<string>();
export async function ensureBranchInventoryHydrated(branch: SelectedBranch | null): Promise<boolean> {
  if (!branch || !branch.id) return false;
  const accountKey = getAccountScopeKey();
  const scopedKey = `${accountKey}__${branch.id}`;
  if (hydratingBranches.has(scopedKey)) return false;

  try {
    const [localEncCount, localMastCount] = await Promise.all([
      countBranchInventoryBySource(branch.id, 'ENCODING'),
      countBranchInventoryBySource(branch.id, 'MASTERDATA'),
    ]);

    const encOk = localEncCount > 0 && (!branch.encodingCount || localEncCount >= branch.encodingCount);
    const mastOk = localMastCount > 0;

    if (encOk && mastOk) {
      return false;
    }

    hydratingBranches.add(scopedKey);
    const res = await fetch(`/api/sync/branch-inventory/${encodeURIComponent(scopedKey)}`);
    if (!res.ok) return false;
    const data = await res.json();
    if (
      data?.snapshot &&
      (Array.isArray(data.snapshot.encodingItems) || Array.isArray(data.snapshot.masterdataItems))
    ) {
      const enc: InventoryItem[] =
        data.snapshot.encodingItems && data.snapshot.encodingItems.length > 0
          ? data.snapshot.encodingItems
          : await getBranchInventoryBySource(branch.id, 'ENCODING');
      const existingMast = await getBranchInventoryBySource(branch.id, 'MASTERDATA');
      const snapshotMast: InventoryItem[] = Array.isArray(data.snapshot.masterdataItems)
        ? data.snapshot.masterdataItems
        : [];
      const mast: InventoryItem[] =
        existingMast.length >= snapshotMast.length ? existingMast : snapshotMast;
      if (enc.length > 0 || mast.length > 0) {
        const mergedBranch: SelectedBranch = {
          ...branch,
          ...(data.snapshot.branch || {}),
          id: branch.id,
          encodingCount: enc.length,
          masterdataCount: mast.length || branch.masterdataCount || 0,
        };
        await saveBranchInventoryLocalOnly(mergedBranch, enc, mast);
        return true;
      }
    }
  } catch (e) {
    console.warn('Background branch inventory hydration notice:', e);
  } finally {
    hydratingBranches.delete(scopedKey);
  }
  return false;
}

function normalizeBranchRecord(record: any): SelectedBranch {
  const { branchId, accountKey: _ak, ...rest } = record;
  return {
    ...rest,
    id: branchId || record.id,
  };
}

export async function getSavedBranch(branchId: string): Promise<SelectedBranch | null> {
  const accountKey = getAccountScopeKey();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('branches', 'readonly');
    const store = tx.objectStore('branches');
    const req = store.get(`${accountKey}__${branchId}`);
    req.onsuccess = () => {
      if (req.result) {
        resolve(normalizeBranchRecord(req.result));
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSavedBranches(): Promise<SelectedBranch[]> {
  const accountKey = getAccountScopeKey();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('branches', 'readonly');
    const req = tx.objectStore('branches').getAll();
    req.onsuccess = () => {
      const all: any[] = req.result || [];
      const scoped = all
        .filter((r) => r && r.accountKey === accountKey)
        .map((r) => normalizeBranchRecord(r));
      resolve(scoped);
    };
    req.onerror = () => reject(req.error);
  });
}

export function subscribeToSavedBranches(listener: SavedBranchesListener): () => void {
  savedBranchesListeners.add(listener);
  getAllSavedBranches().then((list) => listener(list)).catch(() => {});
  return () => {
    savedBranchesListeners.delete(listener);
  };
}

// Remove cached branch and all its associated local & cloud inventory data for the current account
export async function deleteBranchLocal(branchId: string): Promise<void> {
  const accountKey = getAccountScopeKey();
  const memKey = getAccountBranchMemoryKey(branchId, accountKey);
  memoryEncodingByBranch.delete(memKey);
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['branches', 'inventory', 'countsheets', 'monitoring', 'unidentified'], 'readwrite');

    // 1. Delete account-scoped branch record (and any legacy un-prefixed key)
    tx.objectStore('branches').delete(`${accountKey}__${branchId}`);
    tx.objectStore('branches').delete(branchId);

    // 2. Delete account-scoped inventory snapshot for this branch
    const invStore = tx.objectStore('inventory');
    invStore.delete(getSnapEncodingKey(branchId, accountKey));

    // 3. Delete countsheets for this branch
    const csStore = tx.objectStore('countsheets');
    const csIndex = csStore.index('branchId');
    const csCursor = csIndex.openKeyCursor(IDBKeyRange.only(branchId));
    csCursor.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursor>).result;
      if (cursor) {
        csStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    // 4. Delete monitoring for this branch
    const monStore = tx.objectStore('monitoring');
    const monIndex = monStore.index('branchId');
    const monCursor = monIndex.openKeyCursor(IDBKeyRange.only(branchId));
    monCursor.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursor>).result;
      if (cursor) {
        monStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  notifySavedBranchesListeners();

  try {
    await fetch(`/api/sync/branch-inventory/${encodeURIComponent(`${accountKey}__${branchId}`)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    console.warn('Could not delete branch snapshot on server:', e);
  }

  try {
    const remaining = await getAllSavedBranches();
    await syncWorkspaceStateToCloud({ savedBranches: remaining });
  } catch (e) {
    console.warn('Could not sync branch removal to cloud workspace:', e);
  }
}

export interface BarcodeLookupResult {
  exactMatch: InventoryItem | null;
  matches: InventoryItem[];
}

export async function lookupInventoryBarcode(
  branchId: string,
  rawQuery: string,
  limit = 60
): Promise<BarcodeLookupResult> {
  const query = (rawQuery || '').trim().toLowerCase();
  if (!query) return { exactMatch: null, matches: [] };

  const [encodingList, masterdataList] = await Promise.all([
    getBranchInventoryBySource(branchId, 'ENCODING'),
    getBranchInventoryBySource(branchId, 'MASTERDATA'),
  ]);

  const sources: Array<{ source: 'ENCODING' | 'MASTERDATA'; items: InventoryItem[] }> = [
    { source: 'ENCODING', items: encodingList },
    { source: 'MASTERDATA', items: masterdataList },
  ];

  const exactMatches: InventoryItem[] = [];
  const suffixMatches: InventoryItem[] = [];
  const containsMatches: InventoryItem[] = [];
  const seenKeys = new Set<string>();

  for (const { source, items } of sources) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const bc = (item.barcode || '').toString().trim().toLowerCase();
      const ic = (item.itemCode || '').toString().trim().toLowerCase();
      const desc = (item.itemDescription || '').toString().trim().toLowerCase();
      const itemKey = ic || bc ? `${source}_${ic}_${bc}` : `${source}_${desc}_${i}`;

      if (seenKeys.has(itemKey)) continue;

      if (bc === query || ic === query) {
        seenKeys.add(itemKey);
        exactMatches.push(item);
        if (source === 'ENCODING') {
          return {
            exactMatch: item,
            matches: [item],
          };
        }
      } else if (query.length >= 3 && (bc.endsWith(query) || ic.endsWith(query))) {
        seenKeys.add(itemKey);
        if (suffixMatches.length < limit) suffixMatches.push(item);
      } else if (bc.includes(query) || ic.includes(query) || desc.includes(query)) {
        seenKeys.add(itemKey);
        if (containsMatches.length < limit) containsMatches.push(item);
      }
    }
  }

  if (exactMatches.length > 0) {
    return {
      exactMatch: exactMatches[0],
      matches: exactMatches,
    };
  }

  return {
    exactMatch: null,
    matches: [...suffixMatches, ...containsMatches].slice(0, limit),
  };
}

export async function lookupInventoryItem(
  branchId: string,
  rawQuery: string
): Promise<InventoryItem | null> {
  const res = await lookupInventoryBarcode(branchId, rawQuery);
  return res.exactMatch || (res.matches.length === 1 ? res.matches[0] : null);
}

interface IndexedSearchFields {
  ic: string;
  bc: string;
  desc: string;
  combined: string;
  normCombined: string;
  compactCombined: string;
}

const itemSearchIndexCache = new WeakMap<InventoryItem, IndexedSearchFields>();

function getIndexedSearchFields(item: InventoryItem): IndexedSearchFields {
  let cached = itemSearchIndexCache.get(item);
  if (cached) return cached;

  const ic = String(item.itemCode ?? '').trim().toLowerCase();
  const bc = String(item.barcode ?? '').trim().toLowerCase();
  const desc = String(item.itemDescription ?? '').trim().toLowerCase();
  const cat = String(item.category ?? '').trim().toLowerCase();
  const subcat = String(item.subCategory ?? '').trim().toLowerCase();
  const subsubcat = String(item.subsubCategory ?? '').trim().toLowerCase();
  const combined = `${desc} ${ic} ${bc} ${cat} ${subcat} ${subsubcat}`.trim();
  const normCombined = combined.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const compactCombined = combined.replace(/[^a-z0-9]/g, '');

  cached = {
    ic,
    bc,
    desc,
    combined,
    normCombined,
    compactCombined,
  };
  itemSearchIndexCache.set(item, cached);
  return cached;
}

export function searchItemsInMemory(
  list: InventoryItem[],
  keyword: string,
  limit = 0
): InventoryItem[] {
  const q = String(keyword ?? '').trim().toLowerCase();
  if (!q) {
    return limit > 0 ? list.slice(0, limit) : list;
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const normQ = q.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normTokens = normQ ? normQ.split(/\s+/).filter(Boolean) : [];
  const compactQ = q.replace(/[^a-z0-9]/g, '');

  const scored: Array<{ item: InventoryItem; score: number }> = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item) continue;
    const { ic, bc, desc, combined, normCombined, compactCombined } = getIndexedSearchFields(item);

    let score = 0;
    if (ic === q || bc === q || desc === q) {
      score = 100;
    } else if (desc.startsWith(q) || ic.startsWith(q) || bc.startsWith(q)) {
      score = 85;
    } else if (desc.includes(q)) {
      score = 75;
    } else if (ic.includes(q) || bc.includes(q)) {
      score = 65;
    } else if (tokens.length > 1 && tokens.every((t) => desc.includes(t))) {
      score = 55;
    } else if (tokens.every((t) => combined.includes(t))) {
      score = 45;
    } else if (normTokens.length > 0 && normTokens.every((t) => normCombined.includes(t))) {
      score = 35;
    } else if (compactQ.length >= 2 && compactCombined.includes(compactQ)) {
      score = 25;
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.map((entry) => entry.item);
  return limit > 0 ? results.slice(0, limit) : results;
}

export async function searchInventoryList(
  branchId: string,
  source: 'ENCODING' | 'MASTERDATA',
  keyword: string,
  limit = 0
): Promise<InventoryItem[]> {
  const list = await getBranchInventoryBySource(branchId, source);
  return searchItemsInMemory(list, keyword, limit);
}

// ============================================================================
// COUNTSHEETS STORAGE + REAL-TIME CROSS-DEVICE SYNC
// ============================================================================

export async function getBranchCountsheets(branchId: string): Promise<Countsheet[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('countsheets', 'readonly');
    const store = tx.objectStore('countsheets');
    const index = store.index('branchId');
    const req = index.getAll(branchId);

    req.onsuccess = () => {
      const list: any[] = req.result || [];
      const countsheets: Countsheet[] = list.map((item) => ({
        cs: item.cs,
        name: item.name || `CS${String(item.cs).padStart(2, '0')}`,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        submittedAt: item.submittedAt,
        auditorName: item.auditorName,
        auditorEmail: item.auditorEmail,
        items: item.items || [],
        status: item.status || 'draft',
      }));
      countsheets.sort((a, b) => a.cs - b.cs);
      resolve(countsheets);
    };

    req.onerror = () => reject(req.error);
  });
}

async function saveCountsheetIndexedDBOnly(
  branchId: string,
  countsheet: Countsheet
): Promise<Countsheet> {
  const db = await openDB();
  const updatedAt = countsheet.updatedAt || new Date().toISOString();
  const normalized: Countsheet = {
    ...countsheet,
    name: countsheet.name || `CS${String(countsheet.cs).padStart(2, '0')}`,
    items: Array.isArray(countsheet.items) ? countsheet.items : [],
    status: countsheet.status || 'draft',
    updatedAt,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('countsheets', 'readwrite');
    const store = tx.objectStore('countsheets');
    const record = {
      ...normalized,
      id: `${branchId}_${normalized.cs}`,
      branchId,
    };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return normalized;
}

export async function saveCountsheetLocal(
  branchId: string,
  countsheet: Countsheet
): Promise<void> {
  const stamped: Countsheet = {
    ...countsheet,
    updatedAt: new Date().toISOString(),
  };
  const saved = await saveCountsheetIndexedDBOnly(branchId, stamped);
  await notifyCountsheetsListeners(branchId);

  // Push to Server SQLite DB
  fetch(`/api/sync/countsheets/${encodeURIComponent(branchId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(saved),
  }).catch((e) => console.warn('Server countsheet sync notice:', e));
}

async function deleteCountsheetIndexedDBOnly(branchId: string, cs: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('countsheets', 'readwrite');
    const store = tx.objectStore('countsheets');
    const req = store.delete(`${branchId}_${cs}`);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCountsheetLocal(branchId: string, cs: number): Promise<void> {
  await deleteCountsheetIndexedDBOnly(branchId, cs);
  await notifyCountsheetsListeners(branchId);

  fetch(`/api/sync/countsheets/${encodeURIComponent(branchId)}/${encodeURIComponent(String(cs))}`, {
    method: 'DELETE',
  }).catch((e) => console.warn('Server countsheet delete sync notice:', e));
}

function shouldReplaceCountsheet(localCs: Countsheet | undefined, remoteCs: Countsheet): boolean {
  if (!localCs) return true;
  const localTime = localCs.updatedAt ? new Date(localCs.updatedAt).getTime() : 0;
  const remoteTime = remoteCs.updatedAt ? new Date(remoteCs.updatedAt).getTime() : 0;
  if (remoteTime > localTime) return true;
  if (
    remoteTime === localTime &&
    (remoteCs.items?.length || 0) !== (localCs.items?.length || 0) &&
    (remoteCs.items?.length || 0) > (localCs.items?.length || 0)
  ) {
    return true;
  }
  if (localCs.status !== 'submitted' && remoteCs.status === 'submitted') {
    return true;
  }
  return false;
}

export async function syncBranchCountsheetsFromCloud(branchId: string): Promise<Countsheet[]> {
  if (!branchId) return [];
  const localList = await getBranchCountsheets(branchId);
  const byCs = new Map<number, Countsheet>();
  localList.forEach((cs) => byCs.set(cs.cs, cs));

  let changed = false;

  // 1. Pull from Server SQLite API
  try {
    const res = await fetch(`/api/sync/countsheets/${encodeURIComponent(branchId)}`);
    if (res.ok) {
      const data = await res.json();
      const remoteList: Countsheet[] = Array.isArray(data?.countsheets) ? data.countsheets : [];
      for (const remoteCs of remoteList) {
        if (!remoteCs || typeof remoteCs.cs !== 'number') continue;
        const existing = byCs.get(remoteCs.cs);
        // Ignore empty auto-created CS01 from overwriting a populated CS01
        if (existing && existing.items.length > 0 && (!remoteCs.items || remoteCs.items.length === 0)) {
          continue;
        }
        if (shouldReplaceCountsheet(existing, remoteCs)) {
          byCs.set(remoteCs.cs, remoteCs);
          await saveCountsheetIndexedDBOnly(branchId, remoteCs);
          changed = true;
        }
      }
    }
  } catch (e) {
    console.warn('Server countsheets pull notice:', e);
  }

  // 2. Push any local countsheets with items that aren't in cloud yet
  for (const cs of byCs.values()) {
    if (cs.items && cs.items.length > 0) {
      fetch(`/api/sync/countsheets/${encodeURIComponent(branchId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cs),
      }).catch(() => {});
    }
  }

  if (changed) {
    await notifyCountsheetsListeners(branchId);
  }

  return getBranchCountsheets(branchId);
}

export function subscribeToBranchCountsheets(
  branchId: string,
  listener: CountsheetsListener
): () => void {
  if (!branchId) return () => {};

  let set = countsheetsListeners.get(branchId);
  if (!set) {
    set = new Set();
    countsheetsListeners.set(branchId, set);
  }
  set.add(listener);

  // Initial local + cloud sync
  getBranchCountsheets(branchId).then((list) => listener(list)).catch(() => {});
  syncBranchCountsheetsFromCloud(branchId).then((list) => listener(list)).catch(() => {});

  // Periodic + visibility focus sync for Server DB
  const pollInterval = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      syncBranchCountsheetsFromCloud(branchId).catch(() => {});
    }
  }, 6000);

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      syncBranchCountsheetsFromCloud(branchId).catch(() => {});
    }
  };
  window.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('focus', handleVisibility);

  return () => {
    const s = countsheetsListeners.get(branchId);
    if (s) {
      s.delete(listener);
      if (s.size === 0) countsheetsListeners.delete(branchId);
    }
    window.clearInterval(pollInterval);
    window.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('focus', handleVisibility);
  };
}

// ============================================================================
// MONITORING BLOCKS STORAGE + REAL-TIME CROSS-DEVICE SYNC
// ============================================================================

export async function getBranchMonitoringBlocks(branchId: string): Promise<MonitoringBlock[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('monitoring', 'readonly');
    const store = tx.objectStore('monitoring');
    const index = store.index('branchId');
    const req = index.getAll(branchId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function saveMonitoringBlockIndexedDBOnly(
  branchId: string,
  block: MonitoringBlock
): Promise<MonitoringBlock & { id: string; branchId: string; lastUpdated: string }> {
  const db = await openDB();
  const lastUpdated = (block as any).lastUpdated || new Date().toISOString();
  const record = {
    ...block,
    id: `${branchId}_${block.csRange}`,
    branchId,
    lastUpdated,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('monitoring', 'readwrite');
    const store = tx.objectStore('monitoring');
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  return record;
}

export async function saveMonitoringBlock(
  branchId: string,
  block: MonitoringBlock
): Promise<void> {
  const saved = await saveMonitoringBlockIndexedDBOnly(branchId, {
    ...block,
    ...({ lastUpdated: new Date().toISOString() } as any),
  });
  await notifyMonitoringListeners(branchId);

  // Push to Server DB
  fetch(`/api/sync/monitoring/${encodeURIComponent(branchId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(saved),
  }).catch(() => {});
}

export async function clearBranchMonitoringMode(
  branchId: string,
  blocks: MonitoringBlock[],
  mode: 'ENCODING' | 'CHECKING'
): Promise<MonitoringBlock[]> {
  const nowIso = new Date().toISOString();
  const updatedBlocks: MonitoringBlock[] = blocks.map((b) =>
    mode === 'CHECKING'
      ? {
          ...b,
          checker: '',
          checkingStatus: '',
          ...({ lastUpdated: nowIso, clearedCheckingAt: nowIso } as any),
        }
      : {
          ...b,
          auditor: '',
          status: '',
          encoder: '',
          encodingStatus: '',
          ...({ lastUpdated: nowIso, clearedEncodingAt: nowIso } as any),
        }
  );

  await Promise.all(
    updatedBlocks.map(async (b) => {
      const saved = await saveMonitoringBlockIndexedDBOnly(branchId, b);
      fetch(`/api/sync/monitoring/${encodeURIComponent(branchId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saved),
      }).catch(() => {});
    })
  );

  await notifyMonitoringListeners(branchId);
  return updatedBlocks;
}

export async function syncBranchMonitoringFromCloud(branchId: string): Promise<MonitoringBlock[]> {
  if (!branchId) return [];
  const localBlocks = await getBranchMonitoringBlocks(branchId);
  const byRange = new Map<string, any>();
  localBlocks.forEach((b: any) => byRange.set(b.csRange, b));
  let changed = false;

  try {
    const res = await fetch(`/api/sync/monitoring/${encodeURIComponent(branchId)}`);
    if (res.ok) {
      const data = await res.json();
      const remoteBlocks: any[] = Array.isArray(data?.blocks) ? data.blocks : [];
      for (const remote of remoteBlocks) {
        if (!remote?.csRange) continue;
        const existing = byRange.get(remote.csRange);
        const localTime = existing?.lastUpdated ? new Date(existing.lastUpdated).getTime() : 0;
        const remoteTime = remote?.lastUpdated ? new Date(remote.lastUpdated).getTime() : 0;
        if (!existing || remoteTime > localTime) {
          byRange.set(remote.csRange, remote);
          await saveMonitoringBlockIndexedDBOnly(branchId, remote);
          changed = true;
        }
      }
    }
  } catch (e) {
    console.warn('Server monitoring pull notice:', e);
  }

  if (changed) {
    await notifyMonitoringListeners(branchId);
  }
  return getBranchMonitoringBlocks(branchId);
}

export function subscribeToBranchMonitoringBlocks(
  branchId: string,
  listener: MonitoringListener
): () => void {
  if (!branchId) return () => {};
  let set = monitoringListeners.get(branchId);
  if (!set) {
    set = new Set();
    monitoringListeners.set(branchId, set);
  }
  set.add(listener);

  getBranchMonitoringBlocks(branchId).then((list) => listener(list)).catch(() => {});
  syncBranchMonitoringFromCloud(branchId).then((list) => listener(list)).catch(() => {});

  return () => {
    const s = monitoringListeners.get(branchId);
    if (s) {
      s.delete(listener);
      if (s.size === 0) monitoringListeners.delete(branchId);
    }
  };
}

// ============================================================================
// WORKSPACE STATE (ACTIVE BRANCH, ROLE, SAVED BRANCHES, ACTIVE CS, PHOTO, THEME)
// ============================================================================

export async function syncWorkspaceStateToCloud(partial: Partial<WorkspaceSyncState>): Promise<void> {
  const userKey = getUserSyncKey();
  if (!userKey || userKey === 'instant_preview_local') return;

  const payload: WorkspaceSyncState = {
    ...partial,
    updatedAt: new Date().toISOString(),
  };

  try {
    await fetch(`/api/sync/workspace/${encodeURIComponent(userKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('Server workspace state sync notice:', e);
  }
}

async function applyRemoteWorkspaceBranches(remoteState: WorkspaceSyncState | null) {
  if (!remoteState) return;

  // 1. Apply fresh OAuth token synced from another device
  if (
    remoteState.oauthAccessToken &&
    isGoogleOAuthAccessToken(remoteState.oauthAccessToken) &&
    typeof remoteState.oauthTokenIssuedAt === 'number'
  ) {
    const age = Date.now() - remoteState.oauthTokenIssuedAt;
    if (age >= 0 && age < TOKEN_FRESH_MAX_AGE_MS) {
      const localTs = getStoredOAuthTokenTimestamp();
      const localToken = getStoredOAuthToken();
      if (!localToken || remoteState.oauthTokenIssuedAt > localTs) {
        saveOAuthTokenWithTimestamp(
          remoteState.oauthAccessToken,
          remoteState.oauthTokenIssuedAt,
          false
        );
      }
    }
  }

  // 2. Apply cached Drive spreadsheet files synced from another device
  if (Array.isArray(remoteState.cachedDriveFiles) && remoteState.cachedDriveFiles.length > 0) {
    try {
      const existingRaw = localStorage.getItem('countsheet_cached_drive_files');
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      if (!Array.isArray(existing) || existing.length === 0) {
        localStorage.setItem(
          'countsheet_cached_drive_files',
          JSON.stringify(remoteState.cachedDriveFiles)
        );
      }
    } catch {}
  }

  const branchesToSave: SelectedBranch[] = [];
  if (Array.isArray(remoteState.savedBranches)) {
    branchesToSave.push(...remoteState.savedBranches);
  }
  if (
    remoteState.selectedBranch &&
    !branchesToSave.some((b) => b.id === remoteState.selectedBranch?.id)
  ) {
    branchesToSave.push(remoteState.selectedBranch);
  }

  if (branchesToSave.length > 0) {
    let anyUpdated = false;
    for (const b of branchesToSave) {
      if (!b || !b.id) continue;
      const existing = await getSavedBranch(b.id);
      if (
        !existing ||
        (b.lastSyncedAt && (!existing.lastSyncedAt || b.lastSyncedAt > existing.lastSyncedAt)) ||
        (b.encodingCount || 0) > (existing.encodingCount || 0)
      ) {
        await saveBranchMetadataLocalOnly({
          ...existing,
          ...b,
        });
        anyUpdated = true;
      }
    }
    if (anyUpdated) {
      await notifySavedBranchesListeners();
    }
  }
}

export async function fetchWorkspaceStateFromCloud(): Promise<WorkspaceSyncState | null> {
  const userKey = getUserSyncKey();
  if (!userKey || userKey === 'instant_preview_local') return null;

  let bestState: WorkspaceSyncState | null = null;

  try {
    const res = await fetch(`/api/sync/workspace/${encodeURIComponent(userKey)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.state) {
        bestState = data.state;
      }
    }
  } catch (e) {
    console.warn('Server workspace fetch notice:', e);
  }

  if (bestState) {
    await applyRemoteWorkspaceBranches(bestState);
  }

  return bestState;
}

export function subscribeToWorkspaceState(listener: WorkspaceListener): () => void {
  workspaceListeners.add(listener);

  fetchWorkspaceStateFromCloud()
    .then((state) => {
      if (state) listener(state);
    })
    .catch(() => {});

  const pollInterval = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchWorkspaceStateFromCloud()
        .then((state) => {
          if (state) listener(state);
        })
        .catch(() => {});
    }
  }, 8000);

  const handleFocus = () => {
    if (document.visibilityState === 'visible') {
      fetchWorkspaceStateFromCloud()
        .then((state) => {
          if (state) listener(state);
        })
        .catch(() => {});
    }
  };
  window.addEventListener('visibilitychange', handleFocus);
  window.addEventListener('focus', handleFocus);

  return () => {
    workspaceListeners.delete(listener);
    window.clearInterval(pollInterval);
    window.removeEventListener('visibilitychange', handleFocus);
    window.removeEventListener('focus', handleFocus);
  };
}

// Unidentified items storage
export async function saveUnidentifiedItemLocal(
  branchId: string,
  item: UnidentifiedItemRecord
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('unidentified', 'readwrite');
    const store = tx.objectStore('unidentified');
    const req = store.add({ ...item, branchId });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
