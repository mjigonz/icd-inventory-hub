import { InventoryItem, Countsheet, CountsheetItem, MonitoringBlock, UnidentifiedItemRecord, ItemCondition } from '../types';
import { isGoogleOAuthAccessToken, clearCachedAccessToken } from './auth';

export interface DriveSpreadsheetFile {
  id: string;
  name: string;
  modifiedTime?: string;
  owner?: string;
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

export function parseGoogleApiError(
  status: number,
  errText: string,
  defaultApiName: 'Drive' | 'Sheets'
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

  if (isAuthError) {
    clearCachedAccessToken();
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

// 1. Search Google Drive for branch spreadsheets
export async function searchDriveSpreadsheets(
  accessToken: string,
  searchQuery = ''
): Promise<DriveSpreadsheetFile[]> {
  if (!accessToken || !isGoogleOAuthAccessToken(accessToken)) {
    throw new GoogleApiError(
      401,
      'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.',
      {
        isAuthError: true,
        apiName: 'Drive',
      }
    );
  }

  let q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  if (searchQuery.trim()) {
    const escaped = searchQuery.replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,modifiedTime,owners)&orderBy=modifiedTime desc&pageSize=30`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw parseGoogleApiError(res.status, errText, 'Drive');
  }

  const data: any = await res.json();
  const files: DriveSpreadsheetFile[] = (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    owner: f.owners?.[0]?.displayName || f.owners?.[0]?.emailAddress || 'Unknown',
  }));

  return files;
}

// 2. Fetch Spreadsheet metadata (tab titles)
export async function getSpreadsheetDetails(accessToken: string, spreadsheetId: string): Promise<any> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title,gridProperties)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw parseGoogleApiError(res.status, err, 'Sheets');
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

// 3. Fetch and parse ENCODING sheet
// Header row is Row 2!
// Expected columns: Item Code | Barcode | Item Description | Category | SubCategory | SubsubCategory | Cost | Selling | Unit | Beg. Qty | In | Out | Balance | Amount | GP
export async function fetchEncodingSheet(accessToken: string, spreadsheetId: string): Promise<InventoryItem[]> {
  let sheetName = 'ENCODING';

  try {
    const details = await getSpreadsheetDetails(accessToken, spreadsheetId);
    const titles: string[] = (details.sheets || []).map((s: any) => s.properties.title as string);

    // Look for exact match, case-insensitive match, or clean match
    const match = titles.find((t) => {
      const clean = t.trim().toUpperCase().replace(/[\s_-]/g, '');
      return clean === 'ENCODING' || clean.includes('ENCOD');
    });

    if (match) {
      sheetName = match;
    } else if (titles.length > 0) {
      sheetName = titles[0]; // Fallback to first sheet
    }
  } catch (err) {
    console.warn('Failed to inspect sheet titles for ENCODING:', err);
  }

  const safeRange = encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!A:O`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeRange}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to read "${sheetName}" tab: ${await res.text()}`);
  }

  const data: any = await res.json();
  const rows: string[][] = data.values || [];
  if (rows.length < 2) return [];

  // Row 2 is header (index 1), fallback to Row 1
  let headerIndex = 1;
  if (rows.length > 1 && rows[0].some((c) => String(c).toLowerCase().includes('item') || String(c).toLowerCase().includes('barcode'))) {
    headerIndex = 0;
  }

  const headerRow = rows[headerIndex] || rows[0];
  const colMap: Record<string, number> = {};
  headerRow.forEach((col, idx) => {
    colMap[String(col).trim().toLowerCase()] = idx;
  });

  const getCol = (r: string[], name: string, fallbackIdx: number): string => {
    const key = name.toLowerCase();
    if (colMap[key] !== undefined && r[colMap[key]] !== undefined) {
      return String(r[colMap[key]]).trim();
    }
    return r[fallbackIdx] ? String(r[fallbackIdx]).trim() : '';
  };

  const getNum = (r: string[], name: string, fallbackIdx: number): number => {
    const val = getCol(r, name, fallbackIdx).replace(/[^0-9.-]/g, '');
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  };

  const items: InventoryItem[] = [];
  // Data starts directly after header
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const itemCode = getCol(row, 'item code', 0);
    const barcode = getCol(row, 'barcode', 1);
    const itemDescription = getCol(row, 'item description', 2);

    if (!itemCode && !barcode && !itemDescription) continue;

    items.push({
      itemCode,
      barcode,
      itemDescription,
      category: getCol(row, 'category', 3),
      subCategory: getCol(row, 'subcategory', 4),
      subsubCategory: getCol(row, 'subsubcategory', 5),
      cost: getNum(row, 'cost', 6),
      selling: getNum(row, 'selling', 7),
      unit: getCol(row, 'unit', 8) || 'PCS',
      begQty: getNum(row, 'beg. qty', 9),
      in: getNum(row, 'in', 10),
      out: getNum(row, 'out', 11),
      balance: getNum(row, 'balance', 12),
      amount: getNum(row, 'amount', 13),
      gp: getNum(row, 'gp', 14),
      source: 'ENCODING',
    });
  }

  return items;
}

// 4. Fetch and parse MASTERDATA sheet (optional / supplementary)
export async function fetchMasterdataSheet(accessToken: string, spreadsheetId: string): Promise<InventoryItem[]> {
  let sheetName: string | null = null;

  try {
    const details = await getSpreadsheetDetails(accessToken, spreadsheetId);
    const titles: string[] = (details.sheets || []).map((s: any) => s.properties.title as string);

    // Look for matching tab: MASTERDATA, MASTER DATA, MASTER, PRODUCTS, ITEMS, CATALOG
    const match = titles.find((t) => {
      const clean = t.trim().toUpperCase().replace(/[\s_-]/g, '');
      return (
        clean === 'MASTERDATA' ||
        clean === 'MASTER' ||
        clean.includes('MASTER') ||
        clean === 'PRODUCTS' ||
        clean === 'ITEMS' ||
        clean === 'CATALOG'
      );
    });

    if (match) {
      sheetName = match;
    }
  } catch (err) {
    console.warn('Failed to inspect sheet titles for MASTERDATA:', err);
  }

  // If no MASTERDATA or product master sheet is found, return empty array gracefully
  if (!sheetName) {
    console.info('No MASTERDATA sheet found in spreadsheet. Syncing ENCODING tab only.');
    return [];
  }

  try {
    const safeRange = encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!A:O`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeRange}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      console.warn(`MASTERDATA tab "${sheetName}" was found but could not be read (${res.status}). Continuing without masterdata.`);
      return [];
    }

    const data: any = await res.json();
    const rows: string[][] = data.values || [];
    if (rows.length < 1) return [];

    // Header detection
    let headerIndex = 0;
    if (rows.length > 1 && rows[0].join('').toLowerCase().indexOf('item') === -1 && rows[1].join('').toLowerCase().indexOf('item') !== -1) {
      headerIndex = 1;
    }

    const headerRow = rows[headerIndex];
    const colMap: Record<string, number> = {};
    headerRow.forEach((col, idx) => {
      colMap[String(col).trim().toLowerCase()] = idx;
    });

    const getCol = (r: string[], name: string, fallbackIdx: number): string => {
      const key = name.toLowerCase();
      if (colMap[key] !== undefined && r[colMap[key]] !== undefined) {
        return String(r[colMap[key]]).trim();
      }
      return r[fallbackIdx] ? String(r[fallbackIdx]).trim() : '';
    };

    const getNum = (r: string[], name: string, fallbackIdx: number): number => {
      const val = getCol(r, name, fallbackIdx).replace(/[^0-9.-]/g, '');
      const num = parseFloat(val);
      return isNaN(num) ? 0 : num;
    };

    const items: InventoryItem[] = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const itemCode = getCol(row, 'item code', 0);
      const barcode = getCol(row, 'barcode', 1);
      const itemDescription = getCol(row, 'item description', 2);

      if (!itemCode && !barcode && !itemDescription) continue;

      items.push({
        itemCode,
        barcode,
        itemDescription,
        category: getCol(row, 'category', 3),
        subCategory: getCol(row, 'subcategory', 4),
        subsubCategory: getCol(row, 'subsubcategory', 5),
        cost: getNum(row, 'cost', 6),
        selling: getNum(row, 'selling', 7),
        unit: getCol(row, 'unit', 8) || 'PCS',
        balance: getNum(row, 'balance', 12),
        source: 'MASTERDATA',
      });
    }

    return items;
  } catch (err) {
    console.warn('Error reading MASTERDATA sheet rows:', err);
    return [];
  }
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

// 6. Fetch MONITORING tab
export async function fetchMonitoringTab(
  accessToken: string,
  spreadsheetId: string
): Promise<MonitoringBlock[]> {
  try {
    const safeRange = encodeURIComponent("'MONITORING'!A:C");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeRange}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) return [];

    const data: any = await res.json();
    const rows: string[][] = data.values || [];
    if (rows.length <= 1) return [];

    const blocks: MonitoringBlock[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const csRange = row[0].trim();
      const auditor = row[1] ? row[1].trim() : 'Unassigned';
      const statusRaw = row[2] ? row[2].trim() : 'In Progress';
      const status = statusRaw.toLowerCase().includes('comp') ? 'Completed' : 'In Progress';

      // Parse start and end CS
      const match = csRange.match(/CS(\d+)[–-]CS(\d+)/i);
      const startCs = match ? parseInt(match[1], 10) : 1;
      const endCs = match ? parseInt(match[2], 10) : 5;

      blocks.push({
        csRange,
        startCs,
        endCs,
        auditor,
        status,
        sheetCount: 0,
        totalItems: 0,
      });
    }

    return blocks;
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

// Helper: Calculate 5-sheet block for a CS number (e.g. CS 1..5 => "CS01–CS05")
export function getCsBlockRange(cs: number): { rangeStr: string; startCs: number; endCs: number } {
  const blockIndex = Math.floor((cs - 1) / 5);
  const startCs = blockIndex * 5 + 1;
  const endCs = startCs + 4;
  const startStr = `CS${String(startCs).padStart(2, '0')}`;
  const endStr = `CS${String(endCs).padStart(2, '0')}`;
  return {
    rangeStr: `${startStr}–${endStr}`,
    startCs,
    endCs,
  };
}

// Update or create MONITORING row for the countsheet block
export async function updateMonitoringBlockForCs(
  accessToken: string,
  spreadsheetId: string,
  cs: number,
  auditorName: string,
  status: 'In Progress' | 'Completed' = 'In Progress'
) {
  try {
    const { rangeStr } = getCsBlockRange(cs);
    const safeMon = encodeURIComponent("'MONITORING'!A:C");
    const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${safeMon}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data: any = getRes.ok ? await getRes.json() : { values: [] };
    const rows: string[][] = data.values || [];

    const header = rows.length > 0 ? rows[0] : ['CS', 'Name', 'Status'];
    const dataRows = rows.slice(1);

    let foundIndex = -1;
    for (let i = 0; i < dataRows.length; i++) {
      if (dataRows[i][0] && dataRows[i][0].trim() === rangeStr) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex >= 0) {
      // Update existing block
      dataRows[foundIndex][1] = auditorName || dataRows[foundIndex][1] || 'Auditor';
      dataRows[foundIndex][2] = status;
    } else {
      // Append new block row
      dataRows.push([rangeStr, auditorName || 'Auditor', status]);
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
