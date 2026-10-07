import { DriveSpreadsheetFile, parseGoogleApiError } from './googleSheets';

export interface RecentAuditReport {
  id: string;
  spreadsheetId: string;
  spreadsheetName: string;
  totalRows: number;
  webViewLink: string;
  createdAt: string;
  iatdTitle?: string;
  templateTitle?: string;
}

const RECENTS_STORAGE_KEY = 'countsheet_recent_audit_reports';

export function getRecentAuditReports(): RecentAuditReport[] {
  try {
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (e) {
    console.warn('Failed to load recent audit reports from localStorage:', e);
    return [];
  }
}

export function saveRecentAuditReport(
  report: Omit<RecentAuditReport, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
): RecentAuditReport {
  const current = getRecentAuditReports();
  const newReport: RecentAuditReport = {
    id: report.id || `report_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    spreadsheetId: report.spreadsheetId,
    spreadsheetName: report.spreadsheetName,
    totalRows: report.totalRows,
    webViewLink: report.webViewLink,
    createdAt: report.createdAt || new Date().toISOString(),
    iatdTitle: report.iatdTitle,
    templateTitle: report.templateTitle,
  };

  // Remove existing report with same spreadsheetId if present (to move it to top)
  const filtered = current.filter((r) => r.spreadsheetId !== newReport.spreadsheetId);
  const updated = [newReport, ...filtered].slice(0, 30); // Keep max 30 recent reports

  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to save recent audit report to localStorage:', e);
  }

  return newReport;
}

export function deleteRecentAuditReport(id: string): RecentAuditReport[] {
  const current = getRecentAuditReports();
  const updated = current.filter((r) => r.id !== id && r.spreadsheetId !== id);
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to delete recent audit report from localStorage:', e);
  }
  return updated;
}

export function clearRecentAuditReports(): void {
  try {
    localStorage.removeItem(RECENTS_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear recent audit reports from localStorage:', e);
  }
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

// Extract Google Spreadsheet ID from URL or raw ID string
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  return trimmed;
}

// Fetch all sheets/tabs for a spreadsheet
export async function getSpreadsheetTabs(
  accessToken: string,
  spreadsheetId: string
): Promise<{ title: string; tabs: SheetTabInfo[] }> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=properties.title,sheets.properties(sheetId,title,gridProperties)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw parseGoogleApiError(res.status, errText, 'Sheets');
  }

  const data = await res.json();
  const title = data.properties?.title || 'Spreadsheet';
  const tabs: SheetTabInfo[] = (data.sheets || []).map((s: any) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title || 'Sheet1',
    rowCount: s.properties?.gridProperties?.rowCount,
    columnCount: s.properties?.gridProperties?.columnCount,
  }));

  return { title, tabs };
}

// Fetch headers and sample preview rows from a specific sheet/tab
export async function inspectSheetHeaders(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle?: string,
  forceHeaderRow?: number
): Promise<SheetHeaderInspection> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const { title: spreadsheetTitle, tabs } = await getSpreadsheetTabs(accessToken, cleanId);

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

  const safeTabName = `'${(targetTab || 'Sheet1').replace(/'/g, "''")}'`;
  // Fetch first 30 rows to detect header row and samples (supporting wide sheets up to ZZ columns)
  const sampleRange = encodeURIComponent(`${safeTabName}!A1:ZZ30`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${sampleRange}?majorDimension=ROWS`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw parseGoogleApiError(res.status, errText, 'Sheets');
  }

  const data = await res.json();
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
  const countRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${totalRange}?majorDimension=COLUMNS`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  let totalDataRows = 0;
  if (countRes.ok) {
    const countData = await countRes.json();
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
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const safeTabName = `'${sheetTitle.replace(/'/g, "''")}'`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
    `${safeTabName}!A:AZ`
  )}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw parseGoogleApiError(res.status, errText, 'Sheets');
  }

  const data = await res.json();
  const allRows: any[][] = data.values || [];

  const zeroIndexedHeader = Math.max(0, headerRowIndex - 1);
  const headers = (allRows[zeroIndexedHeader] || []).map((h) => String(h || '').trim());
  const dataRows = allRows.slice(zeroIndexedHeader + 1);

  return { headers, rows: dataRows };
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

// Duplicate an existing Spreadsheet (First tries Drive API file clone, falls back to Sheets API copyTo)
export async function duplicateSpreadsheet(
  accessToken: string,
  sourceSpreadsheetId: string,
  newTitle: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const cleanId = extractSpreadsheetId(sourceSpreadsheetId);

  // Strategy 1: Fast Drive API File Copy
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${cleanId}/copy?fields=id,name,webViewLink`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: newTitle,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        id: data.id,
        name: data.name,
        webViewLink: data.webViewLink || `https://docs.google.com/spreadsheets/d/${data.id}/edit`,
      };
    }
  } catch (driveErr) {
    console.warn('Drive file copy attempt notice:', driveErr);
  }

  // Strategy 2: Pure Google Sheets API clone (only requires standard spreadsheets scope)
  try {
    // 1. Create target spreadsheet
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
      throw parseGoogleApiError(createRes.status, errText, 'Sheets');
    }

    const createdData = await createRes.json();
    const newSpreadsheetId = createdData.spreadsheetId;
    const defaultFirstSheetId = createdData.sheets?.[0]?.properties?.sheetId;

    // 2. Fetch source spreadsheet tabs
    const { tabs } = await getSpreadsheetTabs(accessToken, cleanId);

    // 3. Copy each tab from source to destination
    for (const tab of tabs) {
      const copyToUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/sheets/${tab.sheetId}:copyTo`;
      const copyRes = await fetch(copyToUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          destinationSpreadsheetId: newSpreadsheetId,
        }),
      });

      if (copyRes.ok) {
        const copyData = await copyRes.json();
        const copiedSheetId = copyData.sheetId;
        // Rename copied sheet to match original tab name
        try {
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`, {
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
                      sheetId: copiedSheetId,
                      title: tab.title,
                    },
                    fields: 'title',
                  },
                },
              ],
            }),
          });
        } catch {}
      }
    }

    // 4. Delete the empty initial Sheet1 if other tabs were copied
    if (defaultFirstSheetId !== undefined && tabs.length > 0) {
      try {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                deleteSheet: {
                  sheetId: defaultFirstSheetId,
                },
              },
            ],
          }),
        });
      } catch {}
    }

    return {
      id: newSpreadsheetId,
      name: newTitle,
      webViewLink: `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit`,
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
  accessToken: string,
  targetSpreadsheetId: string,
  targetSheetTitle: string,
  encodingHeaders: string[],
  encodingHeaderRow: number, // 1-indexed (e.g. 2)
  iatdHeaders: string[],
  iatdRows: any[][],
  mapping: Record<string, string | null>,
  clearOldData: boolean = true,
  autoAdjustDimensions: boolean = true
): Promise<{ totalRowsWritten: number; spreadsheetId: string; webViewLink: string; mappedColumnsCount: number; adjustedRowsCount: number }> {
  const cleanTargetId = extractSpreadsheetId(targetSpreadsheetId);
  const safeTabName = `'${targetSheetTitle.replace(/'/g, "''")}'`;

  // Build index lookup for IATD headers
  const iatdIndexMap = new Map<string, number>();
  iatdHeaders.forEach((h, idx) => {
    iatdIndexMap.set(h, idx);
  });

  // Determine non-empty source rows
  const validIatdRows: any[][] = [];
  for (let r = 0; r < iatdRows.length; r++) {
    const row = iatdRows[r] || [];
    const hasAnyContent = row.some(
      (val) => val !== null && val !== undefined && String(val).trim() !== ''
    );
    if (hasAnyContent) {
      validIatdRows.push(row);
    }
  }

  const totalRowCount = validIatdRows.length;
  if (totalRowCount === 0) {
    throw new Error('No data rows found in IATD spreadsheet to transfer.');
  }

  const startRow = encodingHeaderRow + 1; // e.g. Row 3 if header is Row 2
  const endRow = startRow + totalRowCount - 1;

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

  // 0. Fetch sheet properties to inspect and adjust grid dimensions (Add & Delete rows/columns)
  let sheetId = 0;
  let curRowCount = 1000;
  let curColCount = 50;

  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanTargetId}?fields=sheets.properties(sheetId,title,gridProperties)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      const currentSheet = (metaData.sheets || []).find(
        (s: any) => s.properties?.title === targetSheetTitle
      );
      if (currentSheet?.properties) {
        sheetId = currentSheet.properties.sheetId ?? 0;
        curRowCount = currentSheet.properties.gridProperties?.rowCount || 1000;
        curColCount = currentSheet.properties.gridProperties?.columnCount || 50;

        const maxEncColIdx = Math.max(...activeColumns.map((c) => c.encIndex), 0);
        const requiredColCount = Math.max(maxEncColIdx + 5, 26);
        const targetRowCount = Math.max(endRow + 5, startRow + 5);

        const requests: any[] = [];

        // Auto-adjust rows (Add if larger, Delete excess if smaller when autoAdjustDimensions is active)
        if (autoAdjustDimensions) {
          if (curRowCount !== targetRowCount) {
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
        } else if (targetRowCount > curRowCount) {
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
      const formJson = await formRes.json();
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

    // Replicate unmapped template formulas down to all data rows
    if (templateFormulasByCol.size > 0) {
      templateFormulasByCol.forEach((baseFormula, colIdx) => {
        const colLetter = numberToColumnLetter(colIdx);
        const colFormulas: string[] = [];
        for (let r = chunkStartRow; r <= chunkEndRow; r++) {
          if (r === startRow) {
            colFormulas.push(baseFormula);
          } else {
            // Adjust row numbers in formula
            const rowDiff = r - startRow;
            const adjusted = baseFormula.replace(
              /(?<!\$)([A-Za-z]+)(?<!\$)([0-9]+)/g,
              (m, letters, numStr) => {
                const num = parseInt(numStr, 10);
                if (num === startRow) {
                  return `${letters}${num + rowDiff}`;
                }
                return m;
              }
            );
            colFormulas.push(adjusted);
          }
        }

        batchData.push({
          range: `${safeTabName}!${colLetter}${chunkStartRow}:${colLetter}${chunkEndRow}`,
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
  return {
    totalRowsWritten: totalRowCount,
    spreadsheetId: cleanTargetId,
    webViewLink,
    mappedColumnsCount: activeColumns.length,
    adjustedRowsCount: endRow,
  };
}

// Generate CS01 to CS{N} countsheet columns placed after Remarks, followed by space, followed by Total Actual,
// automatically ADDS (inserts) or DELETES excess columns to match target count,
// and updates the Total Actual formula (=SUM(CS01:CS{N})) for all item data rows.
export async function setupCountsheetHeadersInTemplate(
  accessToken: string,
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
      const metaData = await metaRes.json();
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

  // 2. Fetch current header row (e.g. A2:ZZ2)
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
    `${safeTabName}!A${headerRow}:ZZ${headerRow}`
  )}?majorDimension=ROWS`;

  const res = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw parseGoogleApiError(res.status, err, 'Sheets');
  }

  const data = await res.json();
  const currentRow: string[] = (data.values?.[0] || []).map((c: any) => String(c || '').trim());

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

  // Count existing CS columns in template (e.g. CS01 to CS20 = 20 columns)
  let existingCsCount = 0;
  for (let i = cs01Idx; i < currentRow.length; i++) {
    const val = currentRow[i] || '';
    if (/^cs0*[0-9]+$/i.test(val)) {
      existingCsCount++;
    } else {
      break;
    }
  }

  // 4. Adjust Columns (ADDS / INSERTS if numCountsheets > existingCsCount, DELETES if numCountsheets < existingCsCount)
  if (autoAdjustColumns) {
    if (numCountsheets > existingCsCount) {
      // ADD / INSERT columns
      const colsToInsert = existingCsCount > 0 ? numCountsheets - existingCsCount : numCountsheets + 2;
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
                  inheritFromBefore: true,
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
    } else if (numCountsheets < existingCsCount && existingCsCount > 0) {
      // DELETE excess columns
      const colsToDelete = existingCsCount - numCountsheets;
      const deleteStartIndex = cs01Idx + numCountsheets;
      const deleteEndIndex = cs01Idx + existingCsCount;

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

  // 5. Build full CS01 .. CS{N} headers
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
  const totalActualLetter = numberToColumnLetter(totalActualColIdx);

  // 6. Expand row count if needed for formulas
  const dataStartRow = headerRow + 1;
  const rowsToPopulate = Math.max(1, totalDataRows);
  const requiredRowCountForFormulas = dataStartRow + rowsToPopulate + 10;

  if (requiredRowCountForFormulas > gridRowCount && sheetId !== undefined) {
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
                    rowCount: requiredRowCountForFormulas,
                  },
                },
                fields: 'gridProperties.rowCount',
              },
            },
          ],
        }),
      });
    } catch (e) {
      console.warn('Could not expand row count for formulas:', e);
    }
  }

  // 7. Write Row 2 Headers AND Total Actual Formulas in single/chunked batchUpdate calls
  const headersToWrite = [...csHeaders, '', 'Total Actual'];
  const targetHeaderRange = `${safeTabName}!${startLetter}${headerRow}:${totalActualLetter}${headerRow}`;

  const formulaChunkSize = 2500;
  for (let offset = 0; offset < rowsToPopulate; offset += formulaChunkSize) {
    const chunkRowCount = Math.min(formulaChunkSize, rowsToPopulate - offset);
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

  // 8. Auto-adjust grid column count (trimming excess blank columns on the right)
  if (autoAdjustColumns && sheetId !== undefined) {
    try {
      // Find trailing columns after totalActual (like Variance, Cost Variance, Status, etc.)
      const postHeadersRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(
          `${safeTabName}!A${headerRow}:ZZ${headerRow}`
        )}?majorDimension=ROWS`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (postHeadersRes.ok) {
        const postData = await postHeadersRes.json();
        const fullHeaderRow: string[] = postData.values?.[0] || [];
        let maxColWithHeader = 0;
        fullHeaderRow.forEach((val, idx) => {
          if (String(val || '').trim().length > 0) {
            maxColWithHeader = Math.max(maxColWithHeader, idx);
          }
        });
        const targetColCount = Math.max(maxColWithHeader + 3, totalActualColIdx + 5, 26);
        if (targetColCount < gridColCount || targetColCount > gridColCount) {
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
                        columnCount: targetColCount,
                      },
                    },
                    fields: 'gridProperties.columnCount',
                  },
                },
              ],
            }),
          });
        }
      }
    } catch (trimErr) {
      console.warn('Could not trim grid column dimensions:', trimErr);
    }
  }

  return {
    startColLetter: startLetter,
    endColLetter: endLetter,
    totalColumns: numCountsheets,
    remarksColLetter: numberToColumnLetter(remarksIdx),
    totalActualColLetter: totalActualLetter,
  };
}
