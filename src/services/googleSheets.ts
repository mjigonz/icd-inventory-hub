import {
  InventoryItem,
  Countsheet,
  CountsheetItem,
  MonitoringBlock,
  MonitoringStatus,
  UnidentifiedItemRecord,
  ItemCondition,
  IatdCsColumnMeta,
  IatdRemarksColumnMeta,
} from '../types';
import {
  isGoogleOAuthAccessToken,
  clearCachedAccessToken,
  getStoredOAuthToken,
  resolveValidOAuthToken,
  auth,
  getRememberedUser,
} from './auth';

export interface DriveSpreadsheetFile {
  id: string;
  name: string;
  modifiedTime?: string;
  owner?: string;
  mimeType?: string;
}

const CACHED_DRIVE_FILES_KEY = 'countsheet_cached_drive_files';

function getDriveFilesStorageKey(): string {
  const email = auth.currentUser?.email || getRememberedUser()?.email;
  const userKey = email ? email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_') : 'default';
  return `${CACHED_DRIVE_FILES_KEY}_${userKey}`;
}

export function getCachedDriveFiles(searchQuery = ''): DriveSpreadsheetFile[] {
  try {
    const raw = localStorage.getItem(getDriveFilesStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parsed;
    return parsed.filter(
      (f: DriveSpreadsheetFile) =>
        f.name?.toLowerCase().includes(q) || f.id?.toLowerCase().includes(q)
    );
  } catch {
    return [];
  }
}

export function saveCachedDriveFiles(files: DriveSpreadsheetFile[]) {
  if (!Array.isArray(files) || files.length === 0) return;
  try {
    localStorage.setItem(getDriveFilesStorageKey(), JSON.stringify(files.slice(0, 80)));
    const email = auth.currentUser?.email || getRememberedUser()?.email;
    const userKey = email ? email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_') : null;
    if (userKey) {
      fetch(`/api/sync/workspace/${encodeURIComponent(userKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cachedDriveFiles: files.slice(0, 60),
          updatedAt: new Date().toISOString(),
        }),
      }).catch(() => {});
    }
  } catch {}
}

export class GoogleApiError extends Error {
  status: number;
  isAccessNotConfigured: boolean;
  isAuthError: boolean;
  enableUrl?: string;
  apiName?: string;
  projectId?: string;

  constructor(
    status: number,
    message: string,
    options?: {
      isAccessNotConfigured?: boolean;
      isAuthError?: boolean;
      enableUrl?: string;
      apiName?: string;
      projectId?: string;
    }
  ) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.isAccessNotConfigured = options?.isAccessNotConfigured ?? false;
    this.isAuthError = options?.isAuthError ?? false;
    this.enableUrl = options?.enableUrl;
    this.apiName = options?.apiName;
    this.projectId = options?.projectId;
  }
}

function extractBearerToken(headers?: HeadersInit): string | undefined {
  if (!headers) return undefined;
  let authVal: string | null | undefined;
  if (headers instanceof Headers) {
    authVal = headers.get('Authorization') || headers.get('authorization');
  } else if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === 'authorization');
    authVal = found?.[1];
  } else {
    const rec = headers as Record<string, string>;
    authVal = rec.Authorization || rec.authorization;
  }
  if (authVal && authVal.startsWith('Bearer ')) {
    return authVal.slice(7).trim();
  }
  return undefined;
}

function replaceBearerToken(options: RequestInit | undefined, newToken: string): RequestInit {
  const nextOptions: RequestInit = { ...(options || {}) };
  const prevHeaders = options?.headers;
  if (prevHeaders instanceof Headers) {
    const h = new Headers(prevHeaders);
    h.set('Authorization', `Bearer ${newToken}`);
    nextOptions.headers = h;
  } else if (Array.isArray(prevHeaders)) {
    nextOptions.headers = prevHeaders
      .filter(([k]) => k.toLowerCase() !== 'authorization')
      .concat([['Authorization', `Bearer ${newToken}`]]);
  } else {
    nextOptions.headers = {
      ...((prevHeaders as Record<string, string>) || {}),
      Authorization: `Bearer ${newToken}`,
    };
  }
  return nextOptions;
}

/**
 * Helper to execute HTTP requests with automatic retries, exponential backoff,
 * and automatic OAuth token recovery on 401 Unauthorized.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
  baseDelayMs = 800
): Promise<Response> {
  let lastError: any;
  let lastResponse: Response | null = null;
  let currentOptions = options;
  let didAttemptAuthRefresh = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, currentOptions);
      if (res.ok) {
        return res;
      }
      lastResponse = res;

      // Automatic 401 token recovery for Google APIs
      if (res.status === 401 && url.includes('googleapis.com') && !didAttemptAuthRefresh) {
        didAttemptAuthRefresh = true;
        const usedToken = extractBearerToken(currentOptions?.headers);
        const recoveredToken = await resolveValidOAuthToken(null, {
          forceRefresh: true,
          failedToken: usedToken,
          allowPopup: false,
        });
        if (recoveredToken && isGoogleOAuthAccessToken(recoveredToken)) {
          currentOptions = replaceBearerToken(currentOptions, recoveredToken);
          const retryRes = await fetch(url, currentOptions);
          if (retryRes.ok) {
            return retryRes;
          }
          lastResponse = retryRes;
        }
      }

      // Only retry on transient server errors or rate limiting
      if (![503, 502, 504, 500, 429].includes(res.status)) {
        return lastResponse; // Stop immediately on 400, 401, 403, 404
      }

      console.warn(`[Google API] Transient ${res.status} response for ${url}. Attempt ${attempt + 1}/${maxRetries + 1}.`);
    } catch (err) {
      lastError = err;
      console.warn(`[Google API] Network failure for ${url}. Attempt ${attempt + 1}/${maxRetries + 1}.`, err);
    }

    if (attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(1.5, attempt) + Math.random() * 200;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError || new Error('Network request failed after retries');
}

export function parseGoogleApiError(
  status: number,
  errText: string,
  defaultApiName: 'Drive' | 'Sheets',
  usedToken?: string
): GoogleApiError {
  let message = errText;
  let isAccessNotConfigured = false;
  let isAuthError = false;
  let enableUrl: string | undefined;
  let projectId = '412785347562';

  try {
    const parsed = JSON.parse(errText);
    if (parsed.error?.message) {
      message = parsed.error.message;
    }
    const hasConfigError =
      parsed.error?.errors?.some((e: any) => e.reason === 'accessNotConfigured') ||
      message.includes('has not been used in project') ||
      message.includes('disabled');

    if (hasConfigError) {
      isAccessNotConfigured = true;
      const urlMatch = message.match(/https:\/\/[^\s"'<>]+/);
      if (urlMatch) {
        enableUrl = urlMatch[0];
      }
      const projMatch = message.match(/project[ =:]*([0-9a-zA-Z_-]+)/i);
      if (projMatch) {
        projectId = projMatch[1];
      }
    }

    if (
      status === 401 ||
      parsed.error?.status === 'UNAUTHENTICATED' ||
      parsed.error?.errors?.some((e: any) => e.reason === 'authError' || e.reason === 'invalidCredentials')
    ) {
      isAuthError = true;
    }
  } catch {
    if (
      errText.includes('accessNotConfigured') ||
      errText.includes('has not been used in project') ||
      errText.includes('disabled')
    ) {
      isAccessNotConfigured = true;
    }
  }

  if (
    status === 401 ||
    message.toLowerCase().includes('invalid authentication credentials') ||
    message.toLowerCase().includes('unauthenticated') ||
    message.toLowerCase().includes('invalid credentials')
  ) {
    isAuthError = true;
  }

  if (
    status === 503 ||
    message.toLowerCase().includes('service is currently unavailable') ||
    message.toLowerCase().includes('temporarily unavailable')
  ) {
    message = 'The Google Sheets service is temporarily unavailable. Please try again in a moment.';
  }

  if (
    status === 404 ||
    message.toLowerCase().includes('requested entity was not found')
  ) {
    message =
      'Spreadsheet not found or access denied. If this is an uploaded Excel (.xlsx) file, please open it in Google Drive and click File > Save as Google Sheets, or ensure the file is shared with your Google account.';
  }

  if (isAuthError) {
    clearCachedAccessToken(usedToken);
  }

  if (isAccessNotConfigured && !enableUrl) {
    if (defaultApiName === 'Drive') {
      enableUrl = `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${projectId}`;
    } else {
      enableUrl = `https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=${projectId}`;
    }
  }

  return new GoogleApiError(status, message, {
    isAccessNotConfigured,
    isAuthError,
    enableUrl,
    apiName: defaultApiName,
    projectId,
  });
}

export function getDemoInventoryItems(): InventoryItem[] {
  return [
    {
      itemCode: 'BEV-001',
      barcode: '4800016644101',
      itemDescription: 'Coca-Cola Regular 1.5L PET Bottle',
      category: 'Beverages',
      subCategory: 'Carbonated Soft Drinks',
      subsubCategory: 'Cola',
      cost: 55.0,
      selling: 68.0,
      unit: 'BTL',
      balance: 142,
      source: 'ENCODING',
    },
    {
      itemCode: 'BEV-002',
      barcode: '4800016644200',
      itemDescription: 'Coca-Cola Zero Sugar 1.5L PET Bottle',
      category: 'Beverages',
      subCategory: 'Carbonated Soft Drinks',
      subsubCategory: 'Cola Zero',
      cost: 56.5,
      selling: 70.0,
      unit: 'BTL',
      balance: 85,
      source: 'ENCODING',
    },
    {
      itemCode: 'BEV-003',
      barcode: '4800016644309',
      itemDescription: 'Sprite Lemon-Lime 1.5L PET Bottle',
      category: 'Beverages',
      subCategory: 'Carbonated Soft Drinks',
      subsubCategory: 'Lemon-Lime',
      cost: 54.0,
      selling: 67.0,
      unit: 'BTL',
      balance: 110,
      source: 'ENCODING',
    },
    {
      itemCode: 'BEV-004',
      barcode: '4800016644408',
      itemDescription: 'Royal Tru-Orange 1.5L PET Bottle',
      category: 'Beverages',
      subCategory: 'Carbonated Soft Drinks',
      subsubCategory: 'Orange Soda',
      cost: 54.0,
      selling: 67.0,
      unit: 'BTL',
      balance: 96,
      source: 'ENCODING',
    },
    {
      itemCode: 'BEV-005',
      barcode: '4800016644507',
      itemDescription: 'Gatorade Blue Bolt Sports Drink 500ml',
      category: 'Beverages',
      subCategory: 'Sports Drinks',
      subsubCategory: 'Isotonic',
      cost: 38.0,
      selling: 48.0,
      unit: 'BTL',
      balance: 64,
      source: 'ENCODING',
    },
    {
      itemCode: 'SNK-101',
      barcode: '4800014023106',
      itemDescription: 'Piattos Cheese Potato Crisps 85g',
      category: 'Snacks',
      subCategory: 'Chips & Crisps',
      subsubCategory: 'Potato Crisps',
      cost: 28.5,
      selling: 36.0,
      unit: 'PC',
      balance: 230,
      source: 'ENCODING',
    },
    {
      itemCode: 'SNK-102',
      barcode: '4800014023205',
      itemDescription: 'Piattos Sour Cream & Onion 85g',
      category: 'Snacks',
      subCategory: 'Chips & Crisps',
      subsubCategory: 'Potato Crisps',
      cost: 28.5,
      selling: 36.0,
      unit: 'PC',
      balance: 180,
      source: 'ENCODING',
    },
    {
      itemCode: 'SNK-103',
      barcode: '4800014023304',
      itemDescription: 'Nova Country Cheddar Multigrain 78g',
      category: 'Snacks',
      subCategory: 'Chips & Crisps',
      subsubCategory: 'Multigrain',
      cost: 30.0,
      selling: 38.5,
      unit: 'PC',
      balance: 154,
      source: 'ENCODING',
    },
    {
      itemCode: 'SNK-104',
      barcode: '4800014023403',
      itemDescription: 'Chippy Barbecue Flavored Corn Chips 110g',
      category: 'Snacks',
      subCategory: 'Chips & Crisps',
      subsubCategory: 'Corn Chips',
      cost: 24.0,
      selling: 31.0,
      unit: 'PC',
      balance: 140,
      source: 'ENCODING',
    },
    {
      itemCode: 'GRO-201',
      barcode: '4800011120013',
      itemDescription: 'Century Tuna Flakes in Oil 180g',
      category: 'Grocery',
      subCategory: 'Canned Goods',
      subsubCategory: 'Canned Tuna',
      cost: 34.2,
      selling: 42.5,
      unit: 'CAN',
      balance: 310,
      source: 'ENCODING',
    },
    {
      itemCode: 'GRO-202',
      barcode: '4800011120020',
      itemDescription: 'Century Tuna Flakes Hot & Spicy 180g',
      category: 'Grocery',
      subCategory: 'Canned Goods',
      subsubCategory: 'Canned Tuna',
      cost: 34.2,
      selling: 42.5,
      unit: 'CAN',
      balance: 275,
      source: 'ENCODING',
    },
    {
      itemCode: 'GRO-203',
      barcode: '4800011130050',
      itemDescription: 'Argentina Corned Beef 260g Easy Open Can',
      category: 'Grocery',
      subCategory: 'Canned Goods',
      subsubCategory: 'Corned Beef',
      cost: 41.5,
      selling: 52.0,
      unit: 'CAN',
      balance: 195,
      source: 'ENCODING',
    },
    {
      itemCode: 'PC-301',
      barcode: '4800015501014',
      itemDescription: 'Safeguard Pure White Family Soap 130g',
      category: 'Personal Care',
      subCategory: 'Bath & Body',
      subsubCategory: 'Bar Soap',
      cost: 38.0,
      selling: 48.0,
      unit: 'PC',
      balance: 210,
      source: 'ENCODING',
    },
    {
      itemCode: 'PC-302',
      barcode: '4800015501021',
      itemDescription: 'Head & Shoulders Cool Menthol Shampoo 170ml',
      category: 'Personal Care',
      subCategory: 'Hair Care',
      subsubCategory: 'Anti-Dandruff Shampoo',
      cost: 110.0,
      selling: 135.0,
      unit: 'BTL',
      balance: 88,
      source: 'ENCODING',
    },
    {
      itemCode: 'HOU-401',
      barcode: '4800018802011',
      itemDescription: 'Joy Complete Clean Dishwashing Liquid Lemon 495ml',
      category: 'Household',
      subCategory: 'Cleaning & Wash',
      subsubCategory: 'Liquid Dishwashing',
      cost: 62.0,
      selling: 78.0,
      unit: 'BTL',
      balance: 120,
      source: 'ENCODING',
    },
    {
      itemCode: 'HOU-402',
      barcode: '4800018802028',
      itemDescription: 'Ariel Sunrise Fresh Detergent Powder 1.3kg',
      category: 'Household',
      subCategory: 'Laundry Care',
      subsubCategory: 'Detergent Powder',
      cost: 165.0,
      selling: 198.0,
      unit: 'PC',
      balance: 75,
      source: 'ENCODING',
    },
  ];
}

// 1. Search Google Drive for branch spreadsheets
export async function searchDriveSpreadsheets(
  accessToken: string,
  searchQuery = ''
): Promise<DriveSpreadsheetFile[]> {
  const tokenToUse = await resolveValidOAuthToken(accessToken, { allowPopup: false });
  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) {
    const cached = getCachedDriveFiles(searchQuery);
    if (cached.length > 0) {
      return cached;
    }
    throw new GoogleApiError(
      401,
      'Your Google Drive session has expired or is not connected. Please reconnect to load your Google Drive spreadsheets.',
      { isAuthError: true, apiName: 'Drive' }
    );
  }

  const queryTrimmed = searchQuery.trim();

  // If user pasted a full Google Sheets URL or raw file ID
  const urlMatch = queryTrimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const directIdCandidate = urlMatch?.[1] || (/^[a-zA-Z0-9-_]{25,60}$/.test(queryTrimmed) ? queryTrimmed : null);
  if (directIdCandidate) {
    try {
      const directUrl = `https://www.googleapis.com/drive/v3/files/${directIdCandidate}?fields=id,name,modifiedTime,owners&supportsAllDrives=true`;
      const directRes = await fetchWithRetry(directUrl, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      });
      if (directRes.ok) {
        const directData: any = await directRes.json();
        return [
          {
            id: directData.id,
            name: directData.name,
            modifiedTime: directData.modifiedTime,
            owner:
              directData.owners?.[0]?.displayName ||
              directData.owners?.[0]?.emailAddress ||
              'Google Drive',
          },
        ];
      }
    } catch (err) {
      console.warn('Direct file lookup notice:', err);
    }
  }

  // Search Google Sheets and uploaded Excel spreadsheets
  let q =
    "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel') and trashed = false";
  if (queryTrimmed) {
    const escaped = queryTrimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,modifiedTime,owners)&orderBy=modifiedTime desc&pageSize=100`;

  let res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${tokenToUse}` },
  });

  // Fallback without orderBy if Drive API rejects orderBy on compound query
  if (!res.ok && res.status === 400) {
    const fallbackUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,modifiedTime,owners)&pageSize=100`;
    res = await fetchWithRetry(fallbackUrl, {
      headers: { Authorization: `Bearer ${tokenToUse}` },
    });
  }

  if (!res.ok) {
    const cached = getCachedDriveFiles(searchQuery);
    if (cached.length > 0 && res.status === 401) {
      return cached;
    }
    const errText = await res.text();
    throw parseGoogleApiError(res.status, errText, 'Drive', tokenToUse);
  }

  const data: any = await res.json();
  const files: DriveSpreadsheetFile[] = (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    owner: f.owners?.[0]?.displayName || f.owners?.[0]?.emailAddress || 'Me',
    mimeType: f.mimeType,
  }));

  if (!queryTrimmed && files.length > 0) {
    saveCachedDriveFiles(files);
  }

  return files;
}

// 2. Fetch Spreadsheet metadata (tab titles)
export async function getSpreadsheetDetails(accessToken: string, spreadsheetId: string): Promise<any> {
  const tokenToUse = (await resolveValidOAuthToken(accessToken, { allowPopup: false })) || getStoredOAuthToken() || accessToken;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title,gridProperties)`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${tokenToUse}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw parseGoogleApiError(res.status, err, 'Sheets', tokenToUse);
  }

  return await res.json();
}

// Ensure required tabs exist
export async function ensureRequiredTabs(accessToken: string, spreadsheetId: string, requiredTabs: string[]) {
  const details = await getSpreadsheetDetails(accessToken, spreadsheetId);
  const existingSheetTitles = new Set(
    (details.sheets || []).map((s: any) => s.properties.title)
  );

  const missingTabs = requiredTabs.filter((t) => !existingSheetTitles.has(t));
  if (missingTabs.length === 0) return;

  const requests = missingTabs.map((title) => ({
    addSheet: {
      properties: {
        title,
      },
    },
  }));

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    console.warn('Could not auto-create sheets, will attempt appending anyway:', await res.text());
  }

  // Initialize headers for created tabs
  for (const tab of missingTabs) {
    let headerRow: string[] = [];
    if (tab === 'COUNTSHEETS') {
      headerRow = [
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
        'Actual Count',
        'Item Condition',
        'CS',
      ];
    } else if (tab === 'MONITORING') {
      headerRow = ['CS', 'Name', 'Status'];
    } else if (tab === 'UNIDENTIFIED') {
      headerRow = ['Barcode', 'Item Description', 'Unit', 'Actual Count', 'Countsheet', 'Auditor', 'Date'];
    }

    if (headerRow.length > 0) {
      const targetRange = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1`);
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${targetRange}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: [headerRow] }),
        }
      );
    }
  }
}

// 3. Fetch and parse ENCODING and OTHERS inventory sheets from a branch spreadsheet
// Header row is Row 2 or Row 1!
// Expected columns: Item Code | Barcode | Item Description | Category | SubCategory | SubsubCategory | Cost | Selling | Unit | Beg. Qty | In | Out | Balance | Amount | GP
export async function fetchEncodingSheet(accessToken: string, spreadsheetId: string): Promise<InventoryItem[]> {
  if (spreadsheetId.startsWith('demo-')) {
    return getDemoInventoryItems();
  }

  const tokenToUse = await resolveValidOAuthToken(accessToken, { allowPopup: false });
  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) {
    throw new GoogleApiError(
      401,
      'Your Google Workspace session has expired. Please reconnect your Google account to sync branch data.',
      { isAuthError: true, apiName: 'Sheets' }
    );
  }

  // System tabs to ignore so we only read real inventory tabs
  const SYSTEM_SHEETS = new Set([
    'COUNTSHEETS',
    'MONITORING',
    'UNIDENTIFIED',
    'SUMMARY',
    'AUDIT',
    'SETTINGS',
    'USERS',
    'MEMBERS',
    'LOGS',
    'REPORTS',
    'REPORT',
  ]);

  const isSystemSheet = (title: string): boolean => {
    const clean = title.trim().toUpperCase().replace(/[\s_-]/g, '');
    return SYSTEM_SHEETS.has(clean);
  };

  let sheetTabsToFetch: Array<{ title: string; defaultSheet: 'GRO' | 'OTHERS' | 'ENCODING' }> = [];

  try {
    const details = await getSpreadsheetDetails(tokenToUse, spreadsheetId);
    const titles: string[] = (details.sheets || []).map((s: any) => s.properties.title as string);

    // Look for IATD or ENCODING or primary inventory sheet
    const encodingMatch = titles.find((t) => {
      if (isSystemSheet(t)) return false;
      const clean = t.trim().toUpperCase().replace(/[\s_-]/g, '');
      return clean === 'IATD' || clean.includes('IATD') || clean === 'ENCODING' || clean.includes('ENCOD');
    });

    // Look for GRO sheet
    const groMatch = titles.find((t) => {
      if (isSystemSheet(t)) return false;
      const clean = t.trim().toUpperCase().replace(/[\s_-]/g, '');
      return clean === 'GRO' || clean.startsWith('GRO');
    });

    // Look for OTHERS / OTHER sheet
    const othersMatch = titles.find((t) => {
      if (isSystemSheet(t)) return false;
      const clean = t.trim().toUpperCase().replace(/[\s_-]/g, '');
      return clean === 'OTHERS' || clean === 'OTHER' || clean.includes('OTHER') || clean === 'NONGRO';
    });

    if (encodingMatch) {
      sheetTabsToFetch.push({ title: encodingMatch, defaultSheet: 'ENCODING' });
    } else if (groMatch) {
      sheetTabsToFetch.push({ title: groMatch, defaultSheet: 'GRO' });
    }

    // Always fetch OTHERS sheet if present alongside primary inventory sheet
    if (othersMatch && !sheetTabsToFetch.some((s) => s.title === othersMatch)) {
      sheetTabsToFetch.push({ title: othersMatch, defaultSheet: 'OTHERS' });
    }

    // If no recognized inventory sheets were matched, fall back to the first non-system sheet
    if (sheetTabsToFetch.length === 0) {
      const firstNonSystem = titles.find((t) => !isSystemSheet(t)) || titles[0] || 'ENCODING';
      sheetTabsToFetch.push({ title: firstNonSystem, defaultSheet: 'ENCODING' });
    }
  } catch (err: any) {
    if (err instanceof GoogleApiError && (err.isAuthError || err.isAccessNotConfigured || err.status === 404 || err.status === 403)) {
      throw err;
    }
    console.warn('Failed to inspect sheet titles for ENCODING:', err);
    sheetTabsToFetch = [{ title: 'ENCODING', defaultSheet: 'ENCODING' }];
  }

  const parseSingleInventorySheet = (rows: string[][], tabTag: 'GRO' | 'OTHERS' | 'ENCODING'): InventoryItem[] => {
    if (!rows || rows.length < 2) return [];

    // Robust header row detection across the first 5 rows
    let headerIndex = 0;
    for (let r = 0; r < Math.min(5, rows.length); r++) {
      const rowStr = (rows[r] || []).map((c) => String(c || '').toLowerCase()).join(' ');
      if (
        rowStr.includes('item') ||
        rowStr.includes('desc') ||
        rowStr.includes('barcode') ||
        rowStr.includes('code') ||
        rowStr.includes('particulars')
      ) {
        headerIndex = r;
        break;
      }
    }

    const headerRow = rows[headerIndex] || rows[0];
    const colMap: Record<string, number> = {};
    headerRow.forEach((col, idx) => {
      const clean = String(col).trim().toLowerCase();
      if (clean) {
        colMap[clean] = idx;
        colMap[clean.replace(/[^a-z0-9]/g, '')] = idx;
      }
    });

    const getCol = (r: string[], names: string[], fallbackIdx: number): string => {
      for (const name of names) {
        const key = name.toLowerCase();
        const normKey = key.replace(/[^a-z0-9]/g, '');
        if (colMap[key] !== undefined && r[colMap[key]] !== undefined) {
          return String(r[colMap[key]]).trim();
        }
        if (colMap[normKey] !== undefined && r[colMap[normKey]] !== undefined) {
          return String(r[colMap[normKey]]).trim();
        }
      }
      return fallbackIdx >= 0 && r[fallbackIdx] !== undefined ? String(r[fallbackIdx]).trim() : '';
    };

    const getNum = (r: string[], names: string[], fallbackIdx: number): number => {
      const val = getCol(r, names, fallbackIdx).replace(/[^0-9.-]/g, '');
      const num = parseFloat(val);
      return isNaN(num) ? 0 : num;
    };

    const items: InventoryItem[] = [];
    const isStandardMasterdataLayout =
      colMap['barcode'] === 5 &&
      (colMap['itemdescription'] === 1 || colMap['description'] === 1);

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const itemCode = getCol(row, ['item code', 'itemcode', 'code', 'sku', 'material code', 'product code', 'item no'], 0);
      const barcode = getCol(
        row,
        ['barcode', 'bar code', 'upc', 'ean', 'upcean', 'barcodes'],
        isStandardMasterdataLayout ? 5 : 1
      );
      const itemDescription = getCol(
        row,
        ['item description', 'itemdescription', 'description', 'particulars', 'item name', 'name', 'desc'],
        isStandardMasterdataLayout ? 1 : 2
      );

      if (!itemCode && !barcode && !itemDescription) continue;
      if (itemCode.toLowerCase() === 'item code' && itemDescription.toLowerCase().includes('desc')) continue;

      const sheetTag =
        tabTag === 'OTHERS'
          ? 'OTHERS'
          : tabTag === 'GRO'
          ? 'GRO'
          : itemCode.toUpperCase().startsWith('GRO')
          ? 'GRO'
          : 'OTHERS';

      items.push({
        itemCode,
        barcode,
        itemDescription,
        category: getCol(row, ['category', 'cat', 'group', 'department', 'dept'], 3),
        subCategory: getCol(row, ['subcategory', 'subcat', 'sub category', 'sub department'], 4),
        subsubCategory: getCol(row, ['subsubcategory', 'subsubcat', 'sub sub category', 'segment'], 5),
        cost: getNum(row, ['cost', 'unit cost', 'cost price', 'unitcost'], 5),
        selling: getNum(row, ['selling', 'selling price', 'srp', 'retail', 'price'], 7),
        unit: getCol(row, ['unit', 'uom', 'baseuom', 'packaging', 'measure'], 7) || 'PCS',
        begQty: getNum(row, ['beg. qty', 'beg qty', 'begqty', 'beginning qty'], 9),
        in: getNum(row, ['in', 'qty in', 'receipts'], 10),
        out: getNum(row, ['out', 'qty out', 'issues'], 11),
        balance: getNum(row, ['balance', 'ending balance', 'qty', 'on hand', 'onhand', 'book balance'], 11),
        amount: getNum(row, ['amount', 'total amount'], 13),
        gp: getNum(row, ['gp', 'gp%'], 14),
        source: 'ENCODING',
        masterdataSheet: sheetTag,
        sheetRowNumber: i + 1,
        remarks: getCol(row, ['remarks', 'remark', 'notes', 'note'], -1),
      });
    }

    return items;
  };

  const allItems: InventoryItem[] = [];
  const seenItemKeys = new Set<string>();

  for (const { title, defaultSheet } of sheetTabsToFetch) {
    try {
      const safeRange = encodeURIComponent(`'${title.replace(/'/g, "''")}'!A:Z`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeRange}`;
      const res = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      });

      if (res.ok) {
        const data: any = await res.json();
        const tabItems = parseSingleInventorySheet(data.values || [], defaultSheet);
        for (const it of tabItems) {
          const key = `${it.itemCode}_${it.barcode}_${it.itemDescription}`.toLowerCase();
          if (!seenItemKeys.has(key)) {
            seenItemKeys.add(key);
            allItems.push(it);
          }
        }
      }
    } catch (tabErr) {
      console.warn(`Notice reading branch tab ${title}:`, tabErr);
    }
  }

  return allItems;
}

export const FIXED_MASTERDATA_SPREADSHEET_ID = '1tIoDEOmqf-WOGuBalLtSrcCv-lPuz2lqRUzG7O90VUE';
export const FALLBACK_MASTERDATA_SPREADSHEET_ID = '1qnY9fJGHdYUqddEhXy4MDqh5qT7TOPorNsuz-7J8eQY';
export const FIXED_MASTERDATA_SHEET_NAME = 'GRO';
export const FIXED_MASTERDATA_SHEET_NAMES = ['GRO', 'OTHERS'] as const;

function parseMasterdataRows(rows: string[][], defaultSheetName?: string): InventoryItem[] {
  if (!rows || rows.length < 2) return [];

  // Fast path for standard GRO & OTHERS Row 1 header: Item Code | Item Description | Category | Subcategory | SubSubCategory | Barcode
  const firstRow = rows[0] || [];
  const isStandardGroHeader =
    String(firstRow[0] || '').toLowerCase().includes('code') &&
    String(firstRow[1] || '').toLowerCase().includes('desc');

  if (isStandardGroHeader) {
    const len = rows.length;
    const fastItems: InventoryItem[] = new Array(len - 1);
    let writeIdx = 0;
    for (let i = 1; i < len; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      const itemCode = r[0] ? String(r[0]).trim() : '';
      const itemDescription = r[1] ? String(r[1]).trim() : '';
      const barcode = r[5] ? String(r[5]).trim() : '';
      if (!itemCode && !barcode && !itemDescription) continue;
      if (itemCode.toLowerCase() === 'item code' && itemDescription.toLowerCase().includes('desc')) {
        continue;
      }

      const rawCol6 = r[6] ? String(r[6]).trim() : '';
      const isExplicitSheetCol =
        rawCol6.toUpperCase() === 'GRO' || rawCol6.toUpperCase() === 'OTHERS';
      const sheetTag =
        (isExplicitSheetCol ? rawCol6.toUpperCase() : defaultSheetName) ||
        (itemCode.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS');
      const unit =
        (!isExplicitSheetCol && rawCol6 ? rawCol6 : (r[7] ? String(r[7]).trim() : '')) || 'PCS';

      fastItems[writeIdx++] = {
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
    fastItems.length = writeIdx;
    return fastItems;
  }

  // Fallback dynamic header mapping for custom Masterdata tabs
  let headerIndex = 0;
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const rowStr = (rows[r] || []).map((c) => String(c || '').toLowerCase()).join(' ');
    if (rowStr.includes('item') || rowStr.includes('description') || rowStr.includes('barcode') || rowStr.includes('category')) {
      headerIndex = r;
      break;
    }
  }

  const headerRow = rows[headerIndex] || [];
  const colMap: Record<string, number> = {};
  headerRow.forEach((col, idx) => {
    const cleanKey = String(col).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanKey && colMap[cleanKey] === undefined) {
      colMap[cleanKey] = idx;
    }
  });

  const getCol = (r: string[], keys: string[], fallbackIdx: number): string => {
    for (const k of keys) {
      const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (colMap[cleanK] !== undefined && r[colMap[cleanK]] !== undefined) {
        return String(r[colMap[cleanK]]).trim();
      }
    }
    return fallbackIdx >= 0 && r[fallbackIdx] !== undefined ? String(r[fallbackIdx]).trim() : '';
  };

  const getNum = (r: string[], keys: string[], fallbackIdx: number): number => {
    const raw = getCol(r, keys, fallbackIdx).replace(/[^0-9.-]/g, '');
    const num = parseFloat(raw);
    return isNaN(num) ? 0 : num;
  };

  const items: InventoryItem[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const itemCode = getCol(row, ['itemcode', 'item code', 'code', 'sku', 'materialcode'], 0);
    const itemDescription = getCol(row, ['itemdescription', 'item description', 'stockdescription', 'description', 'particulars', 'itemname'], 1);
    const category = getCol(row, ['category', 'cat', 'department'], 2);
    const subCategory = getCol(row, ['subcategory', 'sub category', 'subcat'], 3);
    const subsubCategory = getCol(row, ['subsubcategory', 'sub subcategory', 'sub sub category', 'subsubcat'], 4);
    const barcode = getCol(row, ['barcode', 'ean', 'upc', 'bar code'], 5);
    const unit = getCol(row, ['unit', 'uom', 'pcbox'], -1) || 'PCS';
    const cost = getNum(row, ['cost', 'unitcost', 'costprice'], -1);
    const selling = getNum(row, ['selling', 'sellingprice', 'srp', 'retail'], -1);
    const balance = getNum(row, ['balance', 'onhand', 'qty', 'quantity'], -1);

    if (!itemCode && !barcode && !itemDescription) continue;
    if (itemCode.toLowerCase() === 'item code' && itemDescription.toLowerCase().includes('desc')) {
      continue;
    }

    const rawCol6 = row[6] ? String(row[6]).trim() : '';
    const isExplicitSheet = rawCol6.toUpperCase() === 'GRO' || rawCol6.toUpperCase() === 'OTHERS';
    const sheetTag =
      (isExplicitSheet ? rawCol6.toUpperCase() : defaultSheetName) ||
      (itemCode.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS');

    items.push({
      itemCode,
      barcode,
      itemDescription,
      category,
      subCategory,
      subsubCategory,
      cost,
      selling,
      unit,
      begQty: 0,
      in: 0,
      out: 0,
      balance,
      amount: 0,
      gp: 0,
      source: 'MASTERDATA',
      masterdataSheet: sheetTag,
    });
  }

  return items;
}

// 4. Fetch and parse MASTERDATA from fast server cache or fixed spreadsheet ID (1tIoDEOmqf-WOGuBalLtSrcCv-lPuz2lqRUzG7O90VUE, tabs "GRO" and "OTHERS")
// Row 1 Headers: Item Code | Item Description | Category | Subcategory | SubSubCategory | Barcode
export async function fetchMasterdataSheet(
  accessToken: string,
  branchSpreadsheetId?: string,
  options?: { strict?: boolean; forceRefresh?: boolean }
): Promise<InventoryItem[]> {
  if (branchSpreadsheetId?.startsWith('demo-')) {
    return getDemoInventoryItems().map((i) => ({ ...i, source: 'MASTERDATA' as const, masterdataSheet: 'GRO' }));
  }

  const quickToken = isGoogleOAuthAccessToken(accessToken) ? accessToken : getStoredOAuthToken();

  // 1. ULTRA-FAST PATH: Fetch from server's /api/masterdata cache (or force refresh from Google Sheets when forceRefresh/strict is true, including in Guest Mode)
  try {
    const shouldRefresh = Boolean(options?.forceRefresh || options?.strict);
    const endpoint = shouldRefresh
      ? `/api/masterdata?refresh=1&_ts=${Date.now()}`
      : '/api/masterdata';
    const cacheRes = await fetch(endpoint, {
      headers: quickToken ? { Authorization: `Bearer ${quickToken}` } : undefined,
      cache: shouldRefresh ? 'no-store' : 'default',
    });
    if (cacheRes.ok) {
      const cacheData: any = await cacheRes.json();
      if (Array.isArray(cacheData?.rows) && cacheData.rows.length > 1) {
        const parsed = parseMasterdataRows(cacheData.rows);
        const hasGro = parsed.some((it) => it.masterdataSheet === 'GRO');
        const hasOthers = parsed.some((it) => it.masterdataSheet === 'OTHERS');
        if (parsed.length > 0 && hasGro && hasOthers) {
          return parsed;
        }
      }
    }
  } catch (e) {
    console.warn('Fast server masterdata cache check notice:', e);
  }

  // 2. Fallback: Direct Google Sheets API fetch using full range GRO!A:Z and OTHERS!A:Z
  const tokenToUse =
    quickToken ||
    (await resolveValidOAuthToken(accessToken, { allowPopup: false }));

  if (!tokenToUse || !isGoogleOAuthAccessToken(tokenToUse)) {
    if (options?.strict) {
      throw new GoogleApiError(
        401,
        'Your Google Drive session has expired. Please reconnect your Google account to resync Masterdata.',
        { isAuthError: true, apiName: 'Sheets' }
      );
    }
    return [];
  }

  const candidateSpreadsheets = [
    { id: FIXED_MASTERDATA_SPREADSHEET_ID, tabs: FIXED_MASTERDATA_SHEET_NAMES },
    { id: FALLBACK_MASTERDATA_SPREADSHEET_ID, tabs: ['GRO', 'OTHERS'] as const },
  ];

  let lastApiError: any = null;

  for (const candidate of candidateSpreadsheets) {
    try {
      const tabResults = await Promise.allSettled(
        candidate.tabs.map(async (tabName) => {
          const directRange = encodeURIComponent(`'${tabName.replace(/'/g, "''")}'!A:Z`);
          const directUrl = `https://sheets.googleapis.com/v4/spreadsheets/${candidate.id}/values/${directRange}?fields=values`;
          const directRes = await fetchWithRetry(directUrl, {
            headers: { Authorization: `Bearer ${tokenToUse}` },
          });

          if (directRes.ok) {
            const directData: any = await directRes.json();
            return parseMasterdataRows(directData.values || [], tabName);
          } else if (directRes.status === 401) {
            const errText = await directRes.text();
            throw parseGoogleApiError(directRes.status, errText, 'Sheets', tokenToUse);
          }
          return [];
        })
      );

      const combined: InventoryItem[] = [];
      for (const r of tabResults) {
        if (r.status === 'fulfilled' && r.value.length > 0) {
          combined.push(...r.value);
        } else if (r.status === 'rejected') {
          lastApiError = r.reason;
        }
      }

      if (combined.length > 0) {
        return combined;
      }
    } catch (err) {
      lastApiError = err;
      console.warn(`Masterdata lookup notice on ${candidate.id}:`, err);
    }
  }

  if (options?.strict && lastApiError) {
    throw lastApiError;
  }

  return [];
}

export interface MasterdataMutationResponse {
  status: string;
  sheetUpdated: boolean;
  spreadsheetId?: string;
  updatedRange?: string;
  sheetWarning?: string | null;
  totalRowsCached?: number;
  item?: {
    itemCode: string;
    itemDescription: string;
    category: string;
    subCategory: string;
    subsubCategory: string;
    barcode: string;
    masterdataSheet: 'GRO' | 'OTHERS';
  };
}

// Update an existing Masterdata item in GRO or OTHERS tab (and server cache)
export async function saveMasterdataItemAdmin(
  accessToken: string,
  payload: {
    originalItemCode?: string;
    originalBarcode?: string;
    originalDescription?: string;
    originalSheet?: 'GRO' | 'OTHERS' | string;
    itemCode: string;
    itemDescription: string;
    category: string;
    subCategory: string;
    subsubCategory: string;
    barcode: string;
    targetSheet: 'GRO' | 'OTHERS';
  }
): Promise<MasterdataMutationResponse> {
  const tokenToUse =
    (await resolveValidOAuthToken(accessToken, { allowPopup: false })) ||
    getStoredOAuthToken() ||
    accessToken ||
    '';

  const res = await fetch('/api/masterdata/item', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(tokenToUse ? { Authorization: `Bearer ${tokenToUse}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to update Masterdata item.');
  }
  return data as MasterdataMutationResponse;
}

// Append a new Masterdata item to GRO or OTHERS tab (and server cache)
export async function addMasterdataItemAdmin(
  accessToken: string,
  payload: {
    itemCode: string;
    itemDescription: string;
    category: string;
    subCategory: string;
    subsubCategory: string;
    barcode: string;
    targetSheet: 'GRO' | 'OTHERS';
  }
): Promise<MasterdataMutationResponse> {
  const tokenToUse =
    (await resolveValidOAuthToken(accessToken, { allowPopup: false })) ||
    getStoredOAuthToken() ||
    accessToken ||
    '';

  const res = await fetch('/api/masterdata/item', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(tokenToUse ? { Authorization: `Bearer ${tokenToUse}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to add Masterdata item.');
  }
  return data as MasterdataMutationResponse;
}

// Delete a Masterdata item from GRO or OTHERS tab (and server cache)
export async function deleteMasterdataItemAdmin(
  accessToken: string,
  payload: {
    itemCode?: string;
    barcode?: string;
    itemDescription?: string;
    sheet?: 'GRO' | 'OTHERS' | string;
  }
): Promise<MasterdataMutationResponse> {
  const tokenToUse =
    (await resolveValidOAuthToken(accessToken, { allowPopup: false })) ||
    getStoredOAuthToken() ||
    accessToken ||
    '';

  const res = await fetch('/api/masterdata/item', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(tokenToUse ? { Authorization: `Bearer ${tokenToUse}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to delete Masterdata item.');
  }
  return data as MasterdataMutationResponse;
}

// 5. Fetch existing COUNTSHEETS tab rows
export async function fetchExistingCountsheets(
  accessToken: string,
  spreadsheetId: string
): Promise<{ csList: number[]; itemsByCs: Record<number, CountsheetItem[]> }> {
  try {
    const safeRange = encodeURIComponent("'COUNTSHEETS'!A:N");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeRange}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) return { csList: [], itemsByCs: {} };

    const data: any = await res.json();
    const rows: string[][] = data.values || [];
    if (rows.length <= 1) return { csList: [], itemsByCs: {} };

    const itemsByCs: Record<number, CountsheetItem[]> = {};
    const csSet = new Set<number>();

    // Header column mapping
    const headerRow = rows[0] || [];
    const colMap: Record<string, number> = {};
    headerRow.forEach((col, idx) => {
      colMap[String(col).trim().toLowerCase()] = idx;
    });

    const getCol = (r: string[], name: string, fallbackIdx: number): string => {
      const key = name.toLowerCase();
      if (colMap[key] !== undefined && r[colMap[key]] !== undefined) {
        return String(r[colMap[key]]).trim();
      }
      return r[fallbackIdx] !== undefined ? String(r[fallbackIdx]).trim() : '';
    };

    const getNum = (r: string[], name: string, fallbackIdx: number): number => {
      const val = getCol(r, name, fallbackIdx).replace(/[^0-9.-]/g, '');
      const num = parseFloat(val);
      return isNaN(num) ? 0 : num;
    };

    // Skip header (row 0)
    // Canonical Columns: No | Item Code | Barcode | Item Description | Category | SubCategory | SubsubCategory | Cost | Selling | Unit | Balance | Actual Count | Item Condition | CS
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 12) continue;

      let csRaw = getCol(row, 'cs', colMap['countsheet'] !== undefined ? colMap['countsheet'] : 13);
      let conditionRaw = getCol(row, 'item condition', colMap['condition'] !== undefined ? colMap['condition'] : 12);

      // Handle legacy column swap (if column 12 was CS and column 13 was Condition)
      if (colMap['cs'] === undefined && colMap['item condition'] === undefined) {
        if (!isNaN(parseInt(row[12], 10)) && ['Good', 'Bad', 'Spoilage'].includes(row[13])) {
          csRaw = row[12];
          conditionRaw = row[13];
        } else if (['Good', 'Bad', 'Spoilage'].includes(row[12])) {
          conditionRaw = row[12];
          csRaw = row[13] || '1';
        }
      }

      const csNum = parseInt(csRaw, 10);
      if (isNaN(csNum) || csNum <= 0) continue;

      const condition: ItemCondition =
        conditionRaw === 'Bad' || conditionRaw === 'Spoilage' ? conditionRaw : 'Good';

      csSet.add(csNum);
      if (!itemsByCs[csNum]) itemsByCs[csNum] = [];

      itemsByCs[csNum].push({
        id: `cs_${csNum}_item_${i}`,
        itemCode: getCol(row, 'item code', 1),
        barcode: getCol(row, 'barcode', 2),
        itemDescription: getCol(row, 'item description', 3),
        category: getCol(row, 'category', 4),
        subCategory: getCol(row, 'subcategory', 5),
        subsubCategory: getCol(row, 'subsubcategory', 6),
        cost: getNum(row, 'cost', 7),
        selling: getNum(row, 'selling', 8),
        unit: getCol(row, 'unit', 9) || 'PCS',
        balance: getNum(row, 'balance', 10),
        actualCount: getNum(row, 'actual count', 11),
        condition,
        cs: csNum,
        timestamp: Date.now(),
      });
    }

    return {
      csList: Array.from(csSet).sort((a, b) => a - b),
      itemsByCs,
    };
  } catch (err) {
    console.error('Error fetching existing countsheets:', err);
    return { csList: [], itemsByCs: {} };
  }
}

function parseMonitoringRangeCell(
  raw: string
): { startCs: number; endCs: number; csRange: string; rangeLabel: string } | null {
  if (!raw) return null;
  const match = String(raw)
    .trim()
    .match(/(?:CS)?0*(\d+)\s*[–-]\s*(?:CS)?0*(\d+)/i);
  if (!match) return null;
  const startCs = parseInt(match[1], 10);
  const endCs = parseInt(match[2], 10);
  if (isNaN(startCs) || isNaN(endCs) || startCs <= 0) return null;
  return {
    startCs,
    endCs,
    csRange: `CS${String(startCs).padStart(2, '0')}–CS${String(endCs).padStart(2, '0')}`,
    rangeLabel: `${String(startCs).padStart(3, '0')}-${String(endCs).padStart(3, '0')}`,
  };
}

export function normalizeMonitoringStatus(raw: string | undefined): MonitoringStatus {
  const s = (raw || '').trim().toLowerCase();
  if (!s || s === 'set' || s === 'unset' || s === 'select') return '';
  if (s.includes('comp') || s.includes('done') || s.includes('finish')) return 'Completed';
  if (
    s.includes('prog') ||
    s.includes('ongoing') ||
    s.includes('on-going') ||
    s.includes('encod') ||
    s.includes('check')
  ) {
    return 'In Progress';
  }
  if (s.includes('pend') || s.includes('wait')) return 'Pending';
  return 'Pending';
}

function colIndexToLetter(colIdx: number): string {
  let temp = colIdx + 1;
  let letter = '';
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

// 6. Fetch MONITORING tab (supports both dual ENCODING/CHECKING template and compact A:E table)
export async function fetchMonitoringTab(
  accessToken: string,
  spreadsheetId: string
): Promise<MonitoringBlock[]> {
  try {
    const safeRange = encodeURIComponent("'MONITORING'!A1:Z60");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeRange}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) return [];

    const data: any = await res.json();
    const rows: string[][] = data.values || [];
    if (rows.length <= 1) return [];

    // Detect if this sheet uses the side-by-side ENCODING / CHECKING header row
    let headerRowIdx = -1;
    let encRangeCol = -1;
    let encoderCol = -1;
    let encStatusCol = -1;
    let chkRangeCol = -1;
    let checkerCol = -1;
    let chkStatusCol = -1;

    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const row = rows[r] || [];
      const lowerCells = row.map((c) => String(c || '').trim().toLowerCase());
      const hasEncoder = lowerCells.some((c) => c === 'encoder' || c.includes('encoder'));
      const hasChecker = lowerCells.some((c) => c === 'checker' || c.includes('checker'));
      if (hasEncoder || hasChecker) {
        headerRowIdx = r;
        lowerCells.forEach((cell, cIdx) => {
          if (cell.includes('countsheet')) {
            if (encRangeCol === -1) encRangeCol = cIdx;
            else if (chkRangeCol === -1) chkRangeCol = cIdx;
          } else if (cell.includes('encoder')) {
            encoderCol = cIdx;
          } else if (cell.includes('checker')) {
            checkerCol = cIdx;
          } else if (cell === 'status') {
            if (encStatusCol === -1 && (checkerCol === -1 || cIdx < checkerCol)) {
              encStatusCol = cIdx;
            } else if (chkStatusCol === -1) {
              chkStatusCol = cIdx;
            }
          }
        });

        if (encoderCol !== -1 && encRangeCol === -1) encRangeCol = Math.max(0, encoderCol - 1);
        if (encoderCol !== -1 && encStatusCol === -1) encStatusCol = encoderCol + 1;
        if (checkerCol !== -1 && chkRangeCol === -1) chkRangeCol = Math.max(0, checkerCol - 1);
        if (checkerCol !== -1 && chkStatusCol === -1) chkStatusCol = checkerCol + 1;
        break;
      }
    }

    const blocksMap = new Map<string, MonitoringBlock>();

    if (headerRowIdx !== -1) {
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const rawRange =
          (encRangeCol !== -1 ? row[encRangeCol] : '') ||
          (chkRangeCol !== -1 ? row[chkRangeCol] : '');
        const parsed = parseMonitoringRangeCell(rawRange);
        if (!parsed) continue;

        const encoder = encoderCol !== -1 && row[encoderCol] ? String(row[encoderCol]).trim() : '';
        const encodingStatus =
          encStatusCol !== -1 ? normalizeMonitoringStatus(row[encStatusCol]) : '';
        const checker = checkerCol !== -1 && row[checkerCol] ? String(row[checkerCol]).trim() : '';
        const checkingStatus =
          chkStatusCol !== -1 ? normalizeMonitoringStatus(row[chkStatusCol]) : '';

        blocksMap.set(parsed.csRange, {
          csRange: parsed.csRange,
          rangeLabel: parsed.rangeLabel,
          startCs: parsed.startCs,
          endCs: parsed.endCs,
          auditor: encoder,
          status: encodingStatus,
          encoder,
          encodingStatus,
          checker,
          checkingStatus,
          sheetCount: 0,
          totalItems: 0,
        });
      }
      return Array.from(blocksMap.values());
    }

    // Fallback: Simple A:E layout (CS | Encoder/Name | Encoding Status | Checker | Checking Status)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const parsed = parseMonitoringRangeCell(row[0]);
      if (!parsed) continue;

      const encoder = row[1] ? row[1].trim() : '';
      const encodingStatus = normalizeMonitoringStatus(row[2]);
      const checker = row[3] ? row[3].trim() : '';
      const checkingStatus = normalizeMonitoringStatus(row[4]);

      blocksMap.set(parsed.csRange, {
        csRange: parsed.csRange,
        rangeLabel: parsed.rangeLabel,
        startCs: parsed.startCs,
        endCs: parsed.endCs,
        auditor: encoder,
        status: encodingStatus,
        encoder,
        encodingStatus,
        checker,
        checkingStatus,
        sheetCount: 0,
        totalItems: 0,
      });
    }

    return Array.from(blocksMap.values());
  } catch (err) {
    console.error('Error fetching monitoring tab:', err);
    return [];
  }
}

// 7. Submit Countsheet to Google Sheets
// - Single COUNTSHEETS tab
// - Canonical Columns: No | Item Code | Barcode | Item Description | Category | SubCategory | SubsubCategory | Cost | Selling | Unit | Balance | Actual Count | Item Condition | CS
// - Item Condition: "Good", "Bad", or "Spoilage" directly after Actual Count
// - CS: Numeric countsheet number in CS column (1, 2, 3...)
// - Replaces previous rows for that CS
// - Appends unidentified items to UNIDENTIFIED tab
// - Updates MONITORING tab for the 5-sheet block
export async function submitCountsheetToSheets(
  accessToken: string,
  spreadsheetId: string,
  countsheet: Countsheet,
  auditorName: string
): Promise<{ success: boolean; totalRows: number }> {
  // Ensure required tabs exist
  await ensureRequiredTabs(accessToken, spreadsheetId, ['COUNTSHEETS', 'MONITORING', 'UNIDENTIFIED']);

  // Step 1: Read existing rows from COUNTSHEETS
  const safeRange = encodeURIComponent("'COUNTSHEETS'!A:N");
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeRange}`;
  const getRes = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const existingData: any = getRes.ok ? await getRes.json() : { values: [] };
  const allRows: string[][] = existingData.values || [];

  const canonicalHeader = [
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
    'Actual Count',
    'Item Condition',
    'CS',
  ];

  const existingHeader = allRows.length > 0 ? allRows[0] : [];
  const existingColMap: Record<string, number> = {};
  existingHeader.forEach((col, idx) => {
    existingColMap[String(col).trim().toLowerCase()] = idx;
  });

  const getExistingCol = (r: string[], name: string, fallbackIdx: number): string => {
    const key = name.toLowerCase();
    if (existingColMap[key] !== undefined && r[existingColMap[key]] !== undefined) {
      return String(r[existingColMap[key]]).trim();
    }
    return r[fallbackIdx] !== undefined ? String(r[fallbackIdx]).trim() : '';
  };

  // Filter out any previous rows for this CS number
  const dataRows = allRows.slice(1).filter((r) => {
    let rowCs = getExistingCol(r, 'cs', 13);
    if (!rowCs || isNaN(parseInt(rowCs, 10))) {
      // Check fallback index 12 if legacy format
      if (r[12] && !['good', 'bad', 'spoilage'].includes(r[12].toLowerCase())) {
        rowCs = r[12];
      }
    }
    return String(rowCs).trim() !== String(countsheet.cs);
  });

  // Sanitize existing data rows into canonical format to prevent data misalignment
  const sanitizedExistingRows: string[][] = dataRows.map((r) => {
    let cond = getExistingCol(
      r,
      'item condition',
      existingColMap['condition'] !== undefined ? existingColMap['condition'] : 12
    );
    let csVal = getExistingCol(r, 'cs', 13);

    if (!['Good', 'Bad', 'Spoilage'].includes(cond)) {
      if (['Good', 'Bad', 'Spoilage'].includes(r[13])) {
        cond = r[13];
        csVal = r[12] || csVal;
      } else {
        cond = 'Good';
      }
    }

    return [
      '0', // No
      getExistingCol(r, 'item code', 1),
      getExistingCol(r, 'barcode', 2),
      getExistingCol(r, 'item description', 3),
      getExistingCol(r, 'category', 4),
      getExistingCol(r, 'subcategory', 5),
      getExistingCol(r, 'subsubcategory', 6),
      getExistingCol(r, 'cost', 7) || '0',
      getExistingCol(r, 'selling', 8) || '0',
      getExistingCol(r, 'unit', 9) || 'PCS',
      getExistingCol(r, 'balance', 10) || '0',
      getExistingCol(r, 'actual count', 11) || '0',
      cond || 'Good',
      csVal || '1',
    ];
  });

  // Prepare new rows for this countsheet
  const newCsRows: string[][] = countsheet.items.map((item) => [
    '0', // Will be renumbered sequentially
    item.itemCode || '',
    item.barcode || '',
    item.itemDescription || '',
    item.category || '',
    item.subCategory || '',
    item.subsubCategory || '',
    item.cost !== undefined ? String(item.cost) : '0',
    item.selling !== undefined ? String(item.selling) : '0',
    item.unit || 'PCS',
    item.balance !== undefined ? String(item.balance) : '0',
    String(item.actualCount),
    item.condition || 'Good', // Item Condition: "Good", "Bad", or "Spoilage" directly after Actual Count
    String(countsheet.cs), // CS numeric column
  ]);

  // Combine and renumber No (column 0) sequentially
  const combinedDataRows = [...sanitizedExistingRows, ...newCsRows].map((row, index) => {
    const copy = [...row];
    copy[0] = String(index + 1);
    return copy;
  });

  const finalRows = [canonicalHeader, ...combinedDataRows];

  // Clear existing sheet data
  const safeClear = encodeURIComponent("'COUNTSHEETS'!A:N");
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeClear}:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // Write updated data back
  const safePut = encodeURIComponent("'COUNTSHEETS'!A1");
  const putRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safePut}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: finalRows }),
    }
  );

  if (!putRes.ok) {
    throw new Error(`Failed to write to COUNTSHEETS tab: ${await putRes.text()}`);
  }

  // Step 2: Handle UNIDENTIFIED items (if any)
  const unidentifiedItems = countsheet.items.filter((item) => item.isUnidentified);
  if (unidentifiedItems.length > 0) {
    const dateStr = new Date().toISOString().split('T')[0];
    const unRows = unidentifiedItems.map((item) => [
      item.barcode || '',
      item.itemDescription || '',
      item.unit || 'PCS',
      String(item.actualCount),
      `CS${String(countsheet.cs).padStart(2, '0')}`,
      auditorName,
      dateStr,
    ]);

    const safeAppend = encodeURIComponent("'UNIDENTIFIED'!A:G");
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeAppend}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: unRows }),
      }
    );
  }

  // Step 3: Update MONITORING block
  await updateMonitoringBlockForCs(accessToken, spreadsheetId, countsheet.cs, auditorName);

  return { success: true, totalRows: finalRows.length - 1 };
}

// Helper: Calculate 5-sheet block for a CS number (e.g. CS 1..5 => "CS01–CS05", rangeLabel "001-005")
export function getCsBlockRange(cs: number): {
  rangeStr: string;
  rangeLabel: string;
  startCs: number;
  endCs: number;
} {
  const blockIndex = Math.floor((cs - 1) / 5);
  const startCs = blockIndex * 5 + 1;
  const endCs = startCs + 4;
  const startStr = `CS${String(startCs).padStart(2, '0')}`;
  const endStr = `CS${String(endCs).padStart(2, '0')}`;
  return {
    rangeStr: `${startStr}–${endStr}`,
    rangeLabel: `${String(startCs).padStart(3, '0')}-${String(endCs).padStart(3, '0')}`,
    startCs,
    endCs,
  };
}

// Update or create MONITORING row for the countsheet block (supports Encoding & Checking modes)
export async function updateMonitoringBlockForCs(
  accessToken: string,
  spreadsheetId: string,
  cs: number,
  personName: string,
  status: MonitoringStatus = 'In Progress',
  mode: 'ENCODING' | 'CHECKING' = 'ENCODING'
) {
  try {
    const { rangeStr, rangeLabel, startCs } = getCsBlockRange(cs);
    const safeMon = encodeURIComponent("'MONITORING'!A1:Z60");
    const getRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeMon}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const data: any = getRes.ok ? await getRes.json() : { values: [] };
    const rows: string[][] = data.values || [];

    // 1. Check if sheet uses Dual-Table Template (ENCODING on left, CHECKING on right)
    let headerRowIdx = -1;
    let encRangeCol = -1;
    let encoderCol = -1;
    let encStatusCol = -1;
    let chkRangeCol = -1;
    let checkerCol = -1;
    let chkStatusCol = -1;

    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const row = rows[r] || [];
      const lowerCells = row.map((c) => String(c || '').trim().toLowerCase());
      const hasEncoder = lowerCells.some((c) => c === 'encoder' || c.includes('encoder'));
      const hasChecker = lowerCells.some((c) => c === 'checker' || c.includes('checker'));
      if (hasEncoder || hasChecker) {
        headerRowIdx = r;
        lowerCells.forEach((cell, cIdx) => {
          if (cell.includes('countsheet')) {
            if (encRangeCol === -1) encRangeCol = cIdx;
            else if (chkRangeCol === -1) chkRangeCol = cIdx;
          } else if (cell.includes('encoder')) {
            encoderCol = cIdx;
          } else if (cell.includes('checker')) {
            checkerCol = cIdx;
          } else if (cell === 'status') {
            if (encStatusCol === -1 && (checkerCol === -1 || cIdx < checkerCol)) {
              encStatusCol = cIdx;
            } else if (chkStatusCol === -1) {
              chkStatusCol = cIdx;
            }
          }
        });
        if (encoderCol !== -1 && encRangeCol === -1) encRangeCol = Math.max(0, encoderCol - 1);
        if (encoderCol !== -1 && encStatusCol === -1) encStatusCol = encoderCol + 1;
        if (checkerCol !== -1 && chkRangeCol === -1) chkRangeCol = Math.max(0, checkerCol - 1);
        if (checkerCol !== -1 && chkStatusCol === -1) chkStatusCol = checkerCol + 1;
        break;
      }
    }

    if (headerRowIdx !== -1) {
      let targetRowNumber = -1; // 1-indexed sheet row
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const rawRange =
          (encRangeCol !== -1 ? row[encRangeCol] : '') ||
          (chkRangeCol !== -1 ? row[chkRangeCol] : '');
        const parsed = parseMonitoringRangeCell(rawRange);
        if (parsed && parsed.startCs === startCs) {
          targetRowNumber = i + 1;
          break;
        }
      }

      if (targetRowNumber !== -1) {
        const nameColIdx = mode === 'CHECKING' ? checkerCol : encoderCol;
        const statusColIdx = mode === 'CHECKING' ? chkStatusCol : encStatusCol;
        if (nameColIdx !== -1 && statusColIdx !== -1) {
          const startColLetter = colIndexToLetter(nameColIdx);
          const endColLetter = colIndexToLetter(statusColIdx);
          const cellRange = encodeURIComponent(
            `'MONITORING'!${startColLetter}${targetRowNumber}:${endColLetter}${targetRowNumber}`
          );
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${cellRange}?valueInputOption=USER_ENTERED`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: [[personName, status]] }),
            }
          );
          return;
        }
      }
    }

    // 2. Fallback: Standard compact MONITORING table (A:E -> CS | Encoder | Encoding Status | Checker | Checking Status)
    const header =
      rows.length > 0 && rows[0].length >= 5
        ? rows[0]
        : ['Countsheet No.', 'Encoder', 'STATUS', 'Checker', 'Checking STATUS'];
    const dataRows = rows.slice(1).map((r) => [
      r[0] || '',
      r[1] || '',
      r[2] || '',
      r[3] || '',
      r[4] || '',
    ]);

    let foundIndex = -1;
    for (let i = 0; i < dataRows.length; i++) {
      const parsed = parseMonitoringRangeCell(dataRows[i][0]);
      if (parsed && parsed.startCs === startCs) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex >= 0) {
      dataRows[foundIndex][0] = rangeLabel;
      if (mode === 'CHECKING') {
        dataRows[foundIndex][3] = personName;
        dataRows[foundIndex][4] = status;
      } else {
        dataRows[foundIndex][1] = personName;
        dataRows[foundIndex][2] = status;
      }
    } else {
      if (mode === 'CHECKING') {
        dataRows.push([rangeLabel, '', '', personName, status]);
      } else {
        dataRows.push([rangeLabel, personName, status, '', '']);
      }
    }

    const finalRows = [header, ...dataRows];
    const safeMonPut = encodeURIComponent("'MONITORING'!A1");
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeMonPut}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: finalRows }),
      }
    );
  } catch (err) {
    console.error('Error updating monitoring block:', err);
  }
}

// Clear all Encoder names & Encoding statuses (when mode === 'ENCODING')
// OR all Checker names & Checking statuses (when mode === 'CHECKING') in the MONITORING sheet
export async function clearMonitoringModeInSheets(
  accessToken: string,
  spreadsheetId: string,
  mode: 'ENCODING' | 'CHECKING'
): Promise<void> {
  try {
    const safeMon = encodeURIComponent("'MONITORING'!A1:Z60");
    const getRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeMon}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!getRes.ok) return;
    const data: any = await getRes.json();
    const rows: string[][] = data.values || [];
    if (rows.length <= 1) return;

    let headerRowIdx = -1;
    let encRangeCol = -1;
    let encoderCol = -1;
    let encStatusCol = -1;
    let chkRangeCol = -1;
    let checkerCol = -1;
    let chkStatusCol = -1;

    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const row = rows[r] || [];
      const lowerCells = row.map((c) => String(c || '').trim().toLowerCase());
      const hasEncoder = lowerCells.some((c) => c === 'encoder' || c.includes('encoder'));
      const hasChecker = lowerCells.some((c) => c === 'checker' || c.includes('checker'));
      if (hasEncoder || hasChecker) {
        headerRowIdx = r;
        lowerCells.forEach((cell, cIdx) => {
          if (cell.includes('countsheet')) {
            if (encRangeCol === -1) encRangeCol = cIdx;
            else if (chkRangeCol === -1) chkRangeCol = cIdx;
          } else if (cell.includes('encoder')) {
            encoderCol = cIdx;
          } else if (cell.includes('checker')) {
            checkerCol = cIdx;
          } else if (cell === 'status') {
            if (encStatusCol === -1 && (checkerCol === -1 || cIdx < checkerCol)) {
              encStatusCol = cIdx;
            } else if (chkStatusCol === -1) {
              chkStatusCol = cIdx;
            }
          }
        });
        if (encoderCol !== -1 && encRangeCol === -1) encRangeCol = Math.max(0, encoderCol - 1);
        if (encoderCol !== -1 && encStatusCol === -1) encStatusCol = encoderCol + 1;
        if (checkerCol !== -1 && chkRangeCol === -1) chkRangeCol = Math.max(0, checkerCol - 1);
        if (checkerCol !== -1 && chkStatusCol === -1) chkStatusCol = checkerCol + 1;
        break;
      }
    }

    if (headerRowIdx !== -1) {
      const nameColIdx = mode === 'CHECKING' ? checkerCol : encoderCol;
      const statusColIdx = mode === 'CHECKING' ? chkStatusCol : encStatusCol;
      if (nameColIdx !== -1 && statusColIdx !== -1) {
        const startRow = headerRowIdx + 2; // 1-indexed first data row
        const endRow = rows.length;
        if (endRow >= startRow) {
          const emptyPairs = Array.from({ length: endRow - startRow + 1 }, () => ['', '']);
          const startColLetter = colIndexToLetter(nameColIdx);
          const endColLetter = colIndexToLetter(statusColIdx);
          const cellRange = encodeURIComponent(
            `'MONITORING'!${startColLetter}${startRow}:${endColLetter}${endRow}`
          );
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${cellRange}?valueInputOption=USER_ENTERED`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: emptyPairs }),
            }
          );
        }
        return;
      }
    }

    // Fallback: Standard compact MONITORING table (A:E -> CS | Encoder | Encoding Status | Checker | Checking Status)
    const header =
      rows.length > 0 && rows[0].length >= 5
        ? rows[0]
        : ['Countsheet No.', 'Encoder', 'STATUS', 'Checker', 'Checking STATUS'];
    const dataRows = rows.slice(1).map((r) => {
      const copy = [r[0] || '', r[1] || '', r[2] || '', r[3] || '', r[4] || ''];
      if (mode === 'CHECKING') {
        copy[3] = '';
        copy[4] = '';
      } else {
        copy[1] = '';
        copy[2] = '';
      }
      return copy;
    });

    const finalRows = [header, ...dataRows];
    const safeMonPut = encodeURIComponent("'MONITORING'!A1");
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeMonPut}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: finalRows }),
      }
    );
  } catch (err) {
    console.error('Error clearing monitoring mode in sheets:', err);
  }
}

export interface GuestIatdFetchResult {
  spreadsheetId: string;
  items: InventoryItem[];
  sheetName: string;
  totalItems: number;
  csColumns?: IatdCsColumnMeta[];
  remarksColumn?: IatdRemarksColumnMeta | null;
}

function colIndexToLetterClient(index: number): string {
  let temp = index + 1;
  let letter = '';
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

function parseSheetNumberClient(raw: any): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  let str = String(raw).trim();
  if (!str || str === '-' || str === '—' || str === '–' || str.toLowerCase() === 'n/a') return 0;
  let isAccountingNegative = false;
  if (/^\(\s*[\d,.]+\s*\)$/.test(str)) {
    isAccountingNegative = true;
    str = str.replace(/[()]/g, '').trim();
  }
  const cleaned = str.replace(/,/g, '').replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return isAccountingNegative ? -Math.abs(parsed) : parsed;
}

export function scanIatdRow2Client(
  row1: string[] = [],
  row2: string[] = [],
  itemRowValues?: string[],
  rowNumber1Based?: number
): { csColumns: IatdCsColumnMeta[]; remarksColumn: IatdRemarksColumnMeta | null } {
  const normalize = (s: string) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const maxCols = Math.max(row1.length, row2.length, itemRowValues ? itemRowValues.length : 0);

  let remarksColIdx = -1;
  let remarksLabel = 'Remarks';
  for (let c = 0; c < maxCols; c++) {
    const r2 = String(row2[c] || '').trim();
    const r1 = String(row1[c] || '').trim();
    const n2 = normalize(r2);
    const n1 = normalize(r1);
    if (n2 === 'remarks' || n2 === 'remark' || n2.includes('remark')) {
      remarksColIdx = c;
      remarksLabel = r2 || 'Remarks';
      break;
    }
    if (n1 === 'remarks' || n1 === 'remark' || n1.includes('remark')) {
      remarksColIdx = c;
      remarksLabel = r1 || 'Remarks';
      break;
    }
  }

  let csStartIdx = -1;
  for (let c = 0; c < maxCols; c++) {
    const n2 = normalize(row2[c] || '');
    if (n2 === 'cs01' || n2 === 'cs1' || n2 === 'countsheet01' || n2 === 'countsheet1' || /^cs0*1$/.test(n2)) {
      csStartIdx = c;
      break;
    }
  }
  if (csStartIdx === -1) {
    for (let c = 12; c < maxCols; c++) {
      const n2 = normalize(row2[c] || '');
      if (/^cs\d+$/.test(n2) || /^cs0*\d+$/.test(n2)) {
        csStartIdx = c;
        break;
      }
    }
  }

  const csColumns: IatdCsColumnMeta[] = [];
  if (csStartIdx !== -1) {
    for (let c = csStartIdx; c < maxCols; c++) {
      const r2Raw = String(row2[c] || '').trim();
      const r1Raw = String(row1[c] || '').trim();
      const n2 = normalize(r2Raw);
      const n1 = normalize(r1Raw);

      const isTotalActual =
        n2.includes('totalactual') ||
        n1.includes('totalactual') ||
        (n2.includes('total') && n2.includes('actual')) ||
        (n1.includes('total') && n1.includes('actual'));
      if (isTotalActual) {
        break;
      }

      if (!r2Raw) continue;
      if (n2 === 'remarks' || n2 === 'remark') {
        if (remarksColIdx === -1) {
          remarksColIdx = c;
          remarksLabel = r2Raw;
        }
        continue;
      }

      const numMatch = r2Raw.match(/(\d+)/);
      const csNum = numMatch ? parseInt(numMatch[1], 10) : csColumns.length + 1;
      const formattedCsLabel = `CS${String(csNum).padStart(2, '0')}`;
      const colLetter = colIndexToLetterClient(c);
      const existingVal =
        itemRowValues && c < itemRowValues.length && itemRowValues[c] !== undefined
          ? String(itemRowValues[c]).trim()
          : '';

      csColumns.push({
        label: formattedCsLabel,
        csNumber: csNum,
        colIndex: c,
        colLetter,
        ...(rowNumber1Based && rowNumber1Based > 0 ? { cellA1: `${colLetter}${rowNumber1Based}` } : {}),
        ...(itemRowValues ? { existingValue: existingVal } : {}),
      });
    }
  }

  const remarksColumn: IatdRemarksColumnMeta | null =
    remarksColIdx !== -1
      ? {
          label: remarksLabel,
          colIndex: remarksColIdx,
          colLetter: colIndexToLetterClient(remarksColIdx),
          ...(rowNumber1Based && rowNumber1Based > 0
            ? { cellA1: `${colIndexToLetterClient(remarksColIdx)}${rowNumber1Based}` }
            : {}),
          ...(itemRowValues
            ? {
                existingValue:
                  remarksColIdx < itemRowValues.length && itemRowValues[remarksColIdx] !== undefined
                    ? String(itemRowValues[remarksColIdx]).trim()
                    : '',
              }
            : {}),
        }
      : null;

  return { csColumns, remarksColumn };
}

function parseCsvTextClient(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (ch === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      } else if (ch !== '\r') {
        currentField += ch;
      }
    }
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  return rows;
}

export async function fetchGuestIatdSheet(urlOrId: string, token?: string): Promise<GuestIatdFetchResult> {
  const cleanInput = (urlOrId || '').trim();
  if (!cleanInput) {
    throw new Error('Please enter a Google Sheet link or spreadsheet ID.');
  }

  // 1. First attempt: Use our server-side proxy route /api/guest/fetch-iatd-sheet
  try {
    const authHeader = token ? { Authorization: `Bearer ${token}` } : undefined;
    const res = await fetch('/api/guest/fetch-iatd-sheet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader || {}),
      },
      body: JSON.stringify({ urlOrId: cleanInput }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        return {
          spreadsheetId: data.spreadsheetId,
          items: data.items,
          sheetName: data.sheetName || 'IATD',
          totalItems: data.totalItems ?? data.items.length,
          csColumns: Array.isArray(data.csColumns) ? data.csColumns : [],
          remarksColumn: data.remarksColumn || null,
        };
      }
    } else {
      const errJson = await res.json().catch(() => null);
      if (errJson?.error) {
        throw new Error(errJson.error);
      }
    }
  } catch (err: any) {
    if (err?.message && !err.message.includes('fetch') && !err.message.includes('Network')) {
      throw err;
    }
  }

  // 2. Client-side fallback: Fetch directly from Google Sheets gviz CSV endpoint (range=A2:Z&headers=1 + range=1:2&headers=0)
  const dMatch =
    cleanInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) ||
    cleanInput.match(/\/d\/(?:e\/)?([a-zA-Z0-9-_]{15,})/);
  let spreadsheetId = dMatch && dMatch[1] ? dMatch[1] : '';
  if (!spreadsheetId) {
    const parts = cleanInput.split(/[/\\?#]/);
    for (const part of parts) {
      if (/^[a-zA-Z0-9-_]{20,}$/.test(part)) {
        spreadsheetId = part;
        break;
      }
    }
  }
  if (!spreadsheetId) {
    spreadsheetId = cleanInput;
  }

  const [cRes, hdrRes] = await Promise.all([
    fetch(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
        'IATD'
      )}&range=A2:Z&headers=1&_ts=${Date.now()}`,
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      }
    ),
    fetch(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
        'IATD'
      )}&range=A1:ZZ2&headers=0&_ts=${Date.now()}`,
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      }
    ).catch(() => null),
  ]);

  if (!cRes.ok) {
    throw new Error(
      `Failed to access Google Sheet (${cRes.status}). Ensure the sheet is shared as "Anyone with the link can view".`
    );
  }

  const csvText = await cRes.text();
  if (
    csvText.includes('<!DOCTYPE html>') ||
    csvText.includes('<html') ||
    csvText.includes('google-site-verification')
  ) {
    throw new Error(
      'This Google Sheet is private. Please set sharing to "Anyone with the link can view" to load as a guest.'
    );
  }

  let fullHeaderRows: string[][] = [];
  if (hdrRes && hdrRes.ok) {
    const hdrText = await hdrRes.text();
    if (!hdrText.includes('<!DOCTYPE html>') && !hdrText.includes('<html')) {
      fullHeaderRows = parseCsvTextClient(hdrText);
    }
  }

  const rows = parseCsvTextClient(csvText);
  if (rows.length < 2) {
    throw new Error(
      'The "IATD" tab was not found or has no data. Ensure your sheet has an "IATD" tab with headers on Row 2.'
    );
  }

  const row1Full = fullHeaderRows.length >= 2 ? fullHeaderRows[0] : [];
  const row2Full =
    fullHeaderRows.length >= 2
      ? fullHeaderRows[1]
      : fullHeaderRows.length === 1
      ? fullHeaderRows[0]
      : rows[0] || [];

  const { csColumns, remarksColumn } = scanIatdRow2Client(row1Full, row2Full);

  const normalize = (s: string) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const rawHeaderRow = rows[0] || [];
  const maxHdrLen = Math.max(rawHeaderRow.length, row2Full.length, row1Full.length);
  const headerCols: string[] = [];
  for (let c = 0; c < maxHdrLen; c++) {
    headerCols.push(normalize(row2Full[c] ?? rawHeaderRow[c] ?? '') || normalize(row1Full[c] ?? ''));
  }

  let codeIdx = headerCols.findIndex((h) => h.includes('itemcode') || h === 'code' || h.includes('code'));
  let descIdx = headerCols.findIndex(
    (h) => h.includes('itemdescription') || h.includes('description') || h === 'desc' || h.includes('desc')
  );
  let bcIdx = headerCols.findIndex(
    (h) =>
      h === 'barcode' ||
      h.includes('barcode') ||
      h === 'bar' ||
      h.includes('upc') ||
      h.includes('ean') ||
      h.includes('codebar')
  );
  if (codeIdx === -1) codeIdx = 0;
  if (descIdx === -1) descIdx = 2;
  if (bcIdx === -1) bcIdx = 1;

  const costIdx = 5;
  const unitIdx = 7;
  const balIdx = 11;
  const remarksIdx = remarksColumn ? remarksColumn.colIndex : -1;

  const items: InventoryItem[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const itemCode = codeIdx >= 0 && codeIdx < row.length ? String(row[codeIdx] || '').trim() : '';
    const itemDescription = descIdx >= 0 && descIdx < row.length ? String(row[descIdx] || '').trim() : '';
    const barcode = bcIdx >= 0 && bcIdx < row.length ? String(row[bcIdx] || '').trim() : '';

    if (!itemCode && !itemDescription && !barcode) continue;
    if (itemCode.toLowerCase() === 'item code' && itemDescription.toLowerCase().includes('desc')) continue;

    const rawCost = costIdx < row.length ? row[costIdx] : '0';
    const rawUnit = unitIdx < row.length ? String(row[unitIdx] || '').trim() : '';
    const rawBal = balIdx < row.length ? row[balIdx] : '0';
    const rawRemarks =
      remarksIdx >= 0 && remarksIdx < row.length ? String(row[remarksIdx] || '').trim() : '';

    const cost = parseSheetNumberClient(rawCost);
    const balance = parseSheetNumberClient(rawBal);
    const unit = rawUnit || 'PCS';
    const sheetRowNumber = i + 2; // rows[0] is Row 2, so rows[1] is Row 3 (1 + 2 = 3)

    items.push({
      itemCode,
      barcode,
      itemDescription,
      category: '',
      subCategory: '',
      subsubCategory: '',
      cost,
      selling: 0,
      unit,
      balance,
      begQty: balance,
      in: 0,
      out: 0,
      amount: Number((balance * cost).toFixed(2)),
      gp: 0,
      source: 'ENCODING',
      sheetRowNumber,
      remarks: rawRemarks,
    });
  }

  return {
    spreadsheetId,
    items,
    sheetName: 'IATD',
    totalItems: items.length,
    csColumns,
    remarksColumn,
  };
}

export interface InspectIatdRowParams {
  spreadsheetId: string;
  rowNumber?: number;
  itemCode?: string;
  barcode?: string;
  itemDescription?: string;
  token?: string;
}

export interface InspectIatdRowResult {
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  csColumns: IatdCsColumnMeta[];
  remarksColumn: IatdRemarksColumnMeta | null;
}

export async function inspectIatdItemRow(params: InspectIatdRowParams): Promise<InspectIatdRowResult> {
  const { spreadsheetId, rowNumber, itemCode, barcode, itemDescription, token } = params;
  if (!spreadsheetId) {
    throw new Error('Spreadsheet ID is required.');
  }

  const effectiveToken = token || getStoredOAuthToken() || '';
  const authHeader = effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : undefined;

  const res = await fetch('/api/guest/inspect-iatd-row', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader || {}),
    },
    body: JSON.stringify({
      spreadsheetId,
      rowNumber,
      itemCode,
      barcode,
      itemDescription,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Failed to inspect item row in IATD sheet (HTTP ${res.status})`);
  }

  return {
    spreadsheetId: data.spreadsheetId,
    sheetName: data.sheetName || 'IATD',
    rowNumber: data.rowNumber,
    csColumns: Array.isArray(data.csColumns) ? data.csColumns : [],
    remarksColumn: data.remarksColumn || null,
  };
}

export interface UpdateIatdCellParams {
  spreadsheetId: string;
  rowNumber?: number;
  itemCode?: string;
  barcode?: string;
  itemDescription?: string;
  csNumber?: number;
  csLabel?: string;
  targetColLetter?: string;
  qty?: number | string;
  qtyMode?: 'set' | 'add' | 'skip';
  allowOverwrite?: boolean;
  remarks?: string;
  remarksMode?: 'append' | 'replace' | 'skip';
  token?: string;
}

export interface UpdateIatdCellResponse {
  success: boolean;
  spreadsheetId: string;
  rowNumber: number;
  columnLetter: string;
  csLabel: string;
  cellA1: string;
  remarksColumnLetter: string;
  remarksCellA1: string;
  existingQty: string;
  updatedQty: string | number;
  qtyUpdated: boolean;
  existingRemarks: string;
  updatedRemarks: string;
  remarksUpdated: boolean;
}

export async function updateIatdSheetCell(params: UpdateIatdCellParams): Promise<UpdateIatdCellResponse> {
  const {
    spreadsheetId,
    rowNumber,
    itemCode,
    barcode,
    itemDescription,
    csNumber,
    csLabel,
    targetColLetter,
    qty,
    qtyMode = 'set',
    allowOverwrite = false,
    remarks,
    remarksMode = 'append',
    token,
  } = params;
  if (!spreadsheetId) {
    throw new Error('Spreadsheet ID is required.');
  }

  const effectiveToken = token || getStoredOAuthToken() || '';
  const authHeader = effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : undefined;
  const res = await fetch('/api/guest/update-iatd-cell', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader || {}),
    },
    body: JSON.stringify({
      spreadsheetId,
      rowNumber,
      itemCode,
      barcode,
      itemDescription,
      csNumber,
      csLabel,
      targetColLetter,
      qty,
      qtyMode,
      allowOverwrite,
      remarks,
      remarksMode,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    const err: any = new Error(data?.error || `Failed to update sheet cell (HTTP ${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    err.data = data;
    throw err;
  }
  return data;
}
