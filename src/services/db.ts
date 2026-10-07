import { InventoryItem, Countsheet, MonitoringBlock, UnidentifiedItemRecord, SelectedBranch } from '../types';

const DB_NAME = 'CountSheetDB';
const DB_VERSION = 2;

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

// Save branch inventory snapshot (ENCODING and MASTERDATA)
export async function saveBranchInventory(
  branch: SelectedBranch,
  encodingItems: InventoryItem[],
  masterdataItems: InventoryItem[]
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(['inventory', 'branches'], 'readwrite');
  const invStore = tx.objectStore('inventory');
  const branchStore = tx.objectStore('branches');

  // Save branch metadata
  branchStore.put({
    ...branch,
    lastSyncedAt: new Date().toISOString(),
    encodingCount: encodingItems.length,
    masterdataCount: masterdataItems.length,
  });

  // First clear existing inventory for this branch
  // We can query index or clear all matching
  const index = invStore.index('branch_source');
  const rangeEnc = IDBKeyRange.only([branch.id, 'ENCODING']);
  const rangeMast = IDBKeyRange.only([branch.id, 'MASTERDATA']);

  // Clear existing items for this branch
  const cursorReq1 = index.openKeyCursor(rangeEnc);
  cursorReq1.onsuccess = (e) => {
    const cursor = (e.target as IDBRequest<IDBCursor>).result;
    if (cursor) {
      invStore.delete(cursor.primaryKey);
      cursor.continue();
    }
  };

  const cursorReq2 = index.openKeyCursor(rangeMast);
  cursorReq2.onsuccess = (e) => {
    const cursor = (e.target as IDBRequest<IDBCursor>).result;
    if (cursor) {
      invStore.delete(cursor.primaryKey);
      cursor.continue();
    }
  };

  // Add new items
  encodingItems.forEach((item, idx) => {
    invStore.put({
      ...item,
      id: `${branch.id}_ENCODING_${item.itemCode || 'no_code'}_${item.barcode || 'no_barcode'}_${idx}`,
      branchId: branch.id,
      source: 'ENCODING',
      cleanBarcode: (item.barcode || '').trim().toLowerCase(),
      cleanItemCode: (item.itemCode || '').trim().toLowerCase(),
    });
  });

  masterdataItems.forEach((item, idx) => {
    invStore.put({
      ...item,
      id: `${branch.id}_MASTERDATA_${item.itemCode || 'no_code'}_${item.barcode || 'no_barcode'}_${idx}`,
      branchId: branch.id,
      source: 'MASTERDATA',
      cleanBarcode: (item.barcode || '').trim().toLowerCase(),
      cleanItemCode: (item.itemCode || '').trim().toLowerCase(),
    });
  });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSavedBranch(branchId: string): Promise<SelectedBranch | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('branches', 'readonly');
    const req = tx.objectStore('branches').get(branchId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSavedBranches(): Promise<SelectedBranch[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('branches', 'readonly');
    const req = tx.objectStore('branches').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Remove cached branch and all its associated local inventory data
export async function deleteBranchLocal(branchId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['branches', 'inventory', 'countsheets', 'monitoring', 'unidentified'], 'readwrite');
    
    // 1. Delete branch record
    tx.objectStore('branches').delete(branchId);

    // 2. Delete inventory items for this branch
    const invStore = tx.objectStore('inventory');
    const invIndex = invStore.index('branch_source');
    const rangeEnc = IDBKeyRange.only([branchId, 'ENCODING']);
    const rangeMast = IDBKeyRange.only([branchId, 'MASTERDATA']);

    const c1 = invIndex.openKeyCursor(rangeEnc);
    c1.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursor>).result;
      if (cursor) {
        invStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    const c2 = invIndex.openKeyCursor(rangeMast);
    c2.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursor>).result;
      if (cursor) {
        invStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

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
}

export interface BarcodeLookupResult {
  exactMatch: InventoryItem | null;
  matches: InventoryItem[];
}

// Smart Barcode Lookup:
// 1. Checks exact barcode and exact item code in ENCODING and MASTERDATA.
//    If exact match is found, returns exactMatch immediately.
// 2. If barcode is incomplete (e.g. last 3 digits, last 6 digits, suffix, or partial code),
//    searches and returns candidate items prioritizing suffix matches.
export async function lookupInventoryBarcode(
  branchId: string,
  rawQuery: string,
  limit = 60
): Promise<BarcodeLookupResult> {
  const query = (rawQuery || '').trim().toLowerCase();
  if (!query) return { exactMatch: null, matches: [] };

  const db = await openDB();

  return new Promise((resolve) => {
    const tx = db.transaction('inventory', 'readonly');
    const store = tx.objectStore('inventory');
    const index = store.index('branch_source');

    const sources: Array<'ENCODING' | 'MASTERDATA'> = ['ENCODING', 'MASTERDATA'];
    const exactMatches: InventoryItem[] = [];
    const suffixMatches: InventoryItem[] = [];
    const containsMatches: InventoryItem[] = [];
    const seenKeys = new Set<string>();

    let currentSourceIdx = 0;

    const scanNextSource = () => {
      if (currentSourceIdx >= sources.length) {
        // If exact match was found, return it
        if (exactMatches.length > 0) {
          resolve({
            exactMatch: exactMatches[0],
            matches: exactMatches,
          });
          return;
        }

        // Return suffix matches first, followed by contains matches
        const combined = [...suffixMatches, ...containsMatches].slice(0, limit);
        resolve({
          exactMatch: null,
          matches: combined,
        });
        return;
      }

      const source = sources[currentSourceIdx];
      const range = IDBKeyRange.only([branchId, source]);
      const req = index.openCursor(range);

      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const item: InventoryItem = cursor.value;
          const bc = (item.barcode || '').toString().trim().toLowerCase();
          const ic = (item.itemCode || '').toString().trim().toLowerCase();
          const desc = (item.itemDescription || '').toString().trim().toLowerCase();
          const itemKey = `${item.source}_${ic}_${bc}`;

          if (!seenKeys.has(itemKey)) {
            // Check exact match (complete barcode or complete itemCode)
            if (bc === query || ic === query) {
              seenKeys.add(itemKey);
              exactMatches.push(item);
              // If exact match found in ENCODING, we can finish immediately!
              if (source === 'ENCODING') {
                resolve({
                  exactMatch: item,
                  matches: [item],
                });
                return;
              }
            } else if (bc.endsWith(query) || ic.endsWith(query)) {
              // Suffix match (e.g. user typed the last 3 or last 6 digits of barcode)
              seenKeys.add(itemKey);
              suffixMatches.push(item);
            } else if (bc.includes(query) || ic.includes(query) || desc.includes(query)) {
              // Contains match
              seenKeys.add(itemKey);
              containsMatches.push(item);
            }
          }
          cursor.continue();
        } else {
          currentSourceIdx++;
          scanNextSource();
        }
      };

      req.onerror = () => {
        currentSourceIdx++;
        scanNextSource();
      };
    };

    scanNextSource();
  });
}

// Backward-compatible lookup item by barcode or item code
export async function lookupInventoryItem(
  branchId: string,
  rawQuery: string
): Promise<InventoryItem | null> {
  const res = await lookupInventoryBarcode(branchId, rawQuery);
  return res.exactMatch || (res.matches.length === 1 ? res.matches[0] : null);
}

// Search inventory list for Inventory page (Local vs Masterdata)
export async function searchInventoryList(
  branchId: string,
  source: 'ENCODING' | 'MASTERDATA',
  keyword: string,
  limit = 60
): Promise<InventoryItem[]> {
  const q = (keyword || '').trim().toLowerCase();
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('inventory', 'readonly');
    const store = tx.objectStore('inventory');
    const index = store.index('branch_source');
    const range = IDBKeyRange.only([branchId, source]);
    const req = index.openCursor(range);

    const results: InventoryItem[] = [];

    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor && results.length < limit) {
        const item = cursor.value;
        if (!q) {
          results.push(item);
        } else {
          const desc = (item.itemDescription || '').toLowerCase();
          const bc = (item.barcode || '').toLowerCase();
          const ic = (item.itemCode || '').toLowerCase();
          const cat = (item.category || '').toLowerCase();

          if (desc.includes(q) || bc.includes(q) || ic.includes(q) || cat.includes(q)) {
            results.push(item);
          }
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    req.onerror = () => reject(req.error);
  });
}

// Countsheets storage
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
      // Sort by cs number ascending
      countsheets.sort((a, b) => a.cs - b.cs);
      resolve(countsheets);
    };

    req.onerror = () => reject(req.error);
  });
}

export async function saveCountsheetLocal(
  branchId: string,
  countsheet: Countsheet
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('countsheets', 'readwrite');
    const store = tx.objectStore('countsheets');
    const record = {
      ...countsheet,
      id: `${branchId}_${countsheet.cs}`,
      branchId,
      updatedAt: new Date().toISOString(),
    };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCountsheetLocal(branchId: string, cs: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('countsheets', 'readwrite');
    const store = tx.objectStore('countsheets');
    const req = store.delete(`${branchId}_${cs}`);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Monitoring blocks storage
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

export async function saveMonitoringBlock(
  branchId: string,
  block: MonitoringBlock
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('monitoring', 'readwrite');
    const store = tx.objectStore('monitoring');
    const record = {
      ...block,
      id: `${branchId}_${block.csRange}`,
      branchId,
      lastUpdated: new Date().toISOString(),
    };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
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
