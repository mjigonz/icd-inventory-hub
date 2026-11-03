import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  X,
  Search,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Copy,
  ExternalLink,
  Layers,
  Sparkles,
  ArrowRightLeft,
  ChevronRight,
  ChevronLeft,
  Database,
  FileCheck,
  Table,
  ShieldCheck,
  Share2,
  MessageCircle,
  Send,
  Check,
  Mail,
  Clock,
  Trash2,
  Eye,
  Plus,
  ArrowUp,
  ArrowDown,
  Save,
  Edit3,
  Inbox,
  Paperclip,
  FileCheck2,
  FolderOpen,
} from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import {
  searchDriveSpreadsheets,
  DriveSpreadsheetFile,
  parseGoogleApiError,
  getCachedDriveFiles,
} from '../services/googleSheets';
import {
  BranchEmailSpreadsheetMessage,
  EmailSpreadsheetAttachment,
  ConvertedEmailSpreadsheetRecord,
  searchBranchEmailSpreadsheets,
  convertEmailAttachmentToGoogleSheet,
  convertDriveExcelFileToGoogleSheet,
  getCachedBranchEmails,
  getConvertedEmailSheetsMap,
} from '../services/gmailService';
import {
  inspectSheetHeaders,
  fetchAllSheetRows,
  generateAutoMapping,
  duplicateSpreadsheet,
  executeAuditReportMapping,
  setupCountsheetHeadersInTemplate,
  setupMonitoringTabInTemplate,
  renameSpreadsheetInDrive,
  SheetHeaderInspection,
  extractSpreadsheetId,
  getSpreadsheetTabs,
  SheetTabInfo,
  numberToColumnLetter,
  RecentAuditReport,
  getRecentAuditReports,
  saveRecentAuditReport,
  deleteRecentAuditReport,
  clearRecentAuditReports,
  syncRecentAuditReportsFromCloud,
  subscribeToRecentAuditReports,
  getRecentCountsheets,
  saveRecentCountsheet,
  syncRecentCountsheetsFromCloud,
  subscribeToRecentCountsheets,
  RecentCountsheetSession,
  PreGeneratedCountsheetItem,
  reconstructCountsheetItemsFromSession,
  buildIatdRowFromCountsheetItem,
  fetchCountsheetItemsFromSpreadsheet,
  writeCountsheetActualsToEncodingSheet,
  detectIatdColumnIndices,
  parseIatdRowToCountsheetItem,
  GENERATED_ENCODING_FOLDER_NAME,
  fetchHubTemplatesFromServer,
  getCachedHubEncodingTemplates,
  HUB_OWNER_EMAIL,
  getAdminDriveLinksConfig,
  extractDriveResourceFromLink,
  subscribeToAdminDriveLinks,
  listSpreadsheetsInDriveFolder,
} from '../services/auditReportService';
import { SelectedBranch } from '../types';
import {
  isGoogleOAuthAccessToken,
  getStoredOAuthToken,
  refreshGoogleAccessToken,
  resolveValidOAuthToken,
  subscribeToTokenChanges,
} from '../services/auth';

interface CreateAuditReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  isGoogleConnected?: boolean;
  onConnectGoogle?: () => void;
  activeBranch: SelectedBranch | null;
  initialCountsheetType?: 'random' | null;
  onBranchCreatedOrUpdated?: (branchId: string, branchName: string) => void;
  onTokenRefreshed?: (newToken: string) => void;
}

type WizardStep = 'SOURCE_IATD' | 'TARGET_TEMPLATE' | 'MAP_HEADERS' | 'SUCCESS';

export const CreateAuditReportModal: React.FC<CreateAuditReportModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  isGoogleConnected: isGoogleConnectedProp,
  onConnectGoogle,
  activeBranch,
  initialCountsheetType = null,
  onBranchCreatedOrUpdated,
  onTokenRefreshed,
}) => {
  const [localToken, setLocalToken] = useState<string | null>(accessToken);

  useEffect(() => {
    setLocalToken(accessToken);
  }, [accessToken]);

  useEffect(() => {
    const unsub = subscribeToTokenChanges((newToken) => {
      if (newToken && isGoogleOAuthAccessToken(newToken)) {
        setLocalToken(newToken);
      }
    });
    return () => unsub();
  }, []);

  const effectiveToken = localToken || accessToken || getStoredOAuthToken();
  const isGoogleConnected =
    isGoogleConnectedProp !== undefined
      ? isGoogleConnectedProp
      : Boolean(effectiveToken && isGoogleOAuthAccessToken(effectiveToken));

  const isAuthErrorMessage = (errMsg: string | null): boolean => {
    if (!errMsg) return false;
    const lower = errMsg.toLowerCase();
    return (
      lower.includes('invalid authentication credentials') ||
      lower.includes('expected oauth 2 access token') ||
      lower.includes('unauthenticated') ||
      lower.includes('google authentication required') ||
      lower.includes('google sign-in is required') ||
      lower.includes('re-authenticate') ||
      lower.includes('login cookie') ||
      lower.includes('oauth') ||
      lower.includes('401')
    );
  };

  const [step, setStep] = useState<WizardStep>('SOURCE_IATD');

  // Drive files state (initialized from cache so spreadsheets appear immediately)
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>(() => getCachedDriveFiles());
  const [isSearchingDrive, setIsSearchingDrive] = useState(false);
  const [driveSearchError, setDriveSearchError] = useState<string | null>(null);
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleRefreshGoogleAccess = async () => {
    setIsRefreshingToken(true);
    setDriveSearchError(null);
    setIatdError(null);
    setTemplateError(null);
    try {
      const newToken = await refreshGoogleAccessToken();
      setLocalToken(newToken);
      if (onTokenRefreshed) onTokenRefreshed(newToken);
      setIsSearchingDrive(true);
      const files = await searchDriveSpreadsheets(newToken, searchQuery);
      setDriveFiles(files);
    } catch (err: any) {
      setDriveSearchError(err?.message || 'Failed to refresh Google Drive access.');
    } finally {
      setIsRefreshingToken(false);
      setIsSearchingDrive(false);
    }
  };

  // 1. Source (IATD) State
  const [iatdInputId, setIatdInputId] = useState('');
  const [iatdHeaderRow, setIatdHeaderRow] = useState<number>(2);
  const [iatdInspection, setIatdInspection] = useState<SheetHeaderInspection | null>(null);
  const [iatdTabs, setIatdTabs] = useState<SheetTabInfo[]>([]);
  const [selectedIatdTab, setSelectedIatdTab] = useState<string>('');
  const [isLoadingIatd, setIsLoadingIatd] = useState(false);
  const [iatdError, setIatdError] = useState<string | null>(null);

  // 2. Target (Audit Template) State
  const [selectedTemplateType, setSelectedTemplateType] = useState<'OVERALL COUNT TEMPLATE' | 'CESSATION OVERALL COUNT TEMPLATE'>('OVERALL COUNT TEMPLATE');
  const [matchingTemplateFiles, setMatchingTemplateFiles] = useState<DriveSpreadsheetFile[]>([]);
  const [isSearchingTemplates, setIsSearchingTemplates] = useState<boolean>(false);

  const [templateInputId, setTemplateInputId] = useState('');
  const [templateHeaderRow, setTemplateHeaderRow] = useState<number>(2);
  const [templateInspection, setTemplateInspection] = useState<SheetHeaderInspection | null>(null);
  const [templateTabs, setTemplateTabs] = useState<SheetTabInfo[]>([]);
  const [selectedTemplateTab, setSelectedTemplateTab] = useState<string>('ENCODING');
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [createAsCopy, setCreateAsCopy] = useState<boolean>(true);
  const [newCopyTitle, setNewCopyTitle] = useState<string>('');
  const [enableCountsheetCols, setEnableCountsheetCols] = useState<boolean>(true);
  const [countsheetCount, setCountsheetCount] = useState<number>(100);
  const [autoAdjustDimensions, setAutoAdjustDimensions] = useState<boolean>(true);

  // 3. Mapping & Pre-Generated Countsheet Integration State
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [iatdAllRows, setIatdAllRows] = useState<any[][]>([]);
  const [fullSourceIatdRows, setFullSourceIatdRows] = useState<any[][]>([]);
  const [isLoadingAllIatd, setIsLoadingAllIatd] = useState(false);
  const [importedCountsheetSession, setImportedCountsheetSession] = useState<RecentCountsheetSession | null>(null);
  const [showCountsheetImportPicker, setShowCountsheetImportPicker] = useState(false);
  const [recentCountsheetSessions, setRecentCountsheetSessions] = useState<RecentCountsheetSession[]>(() => getRecentCountsheets());
  const [countsheetUrlToImport, setCountsheetUrlToImport] = useState('');
  const [isImportingCountsheetSheet, setIsImportingCountsheetSheet] = useState(false);
  const [countsheetImportError, setCountsheetImportError] = useState<string | null>(null);

  // Pre-generated countsheet ordered items (preserves sequence, Balance, Actual, and added missing items)
  const [countsheetItems, setCountsheetItems] = useState<PreGeneratedCountsheetItem[]>([]);
  const [countsheetEditorSearch, setCountsheetEditorSearch] = useState('');
  const [countsheetEditorCsFilter, setCountsheetEditorCsFilter] = useState<string>('ALL');
  const [showAddMissingPanel, setShowAddMissingPanel] = useState(false);
  const [addMissingMode, setAddMissingMode] = useState<'IATD_SEARCH' | 'CUSTOM'>('IATD_SEARCH');
  const [missingIatdSearchQuery, setMissingIatdSearchQuery] = useState('');
  const [onlyShowUnselectedIatd, setOnlyShowUnselectedIatd] = useState(true);
  const [insertPositionMode, setInsertPositionMode] = useState<'END' | 'START' | 'AFTER_SEQ'>('END');
  const [insertAfterSeqNum, setInsertAfterSeqNum] = useState<number>(1);
  const [newMissingCsCode, setNewMissingCsCode] = useState<string>('CS01');
  const [customMissingItem, setCustomMissingItem] = useState<{
    itemCode: string;
    barcode: string;
    itemDescription: string;
    category: string;
    subCategory: string;
    subsubCategory: string;
    unit: string;
    cost: string;
    selling: string;
    balance: string;
    actual: string;
  }>({
    itemCode: '',
    barcode: '',
    itemDescription: '',
    category: '',
    subCategory: '',
    subsubCategory: '',
    unit: 'PCS',
    cost: '0',
    selling: '0',
    balance: '0',
    actual: '',
  });
  const [countsheetSaveMsg, setCountsheetSaveMsg] = useState<string | null>(null);
  const [isSavingEditsLoading, setIsSavingEditsLoading] = useState(false);
  const [isSaveEditsSuccess, setIsSaveEditsSuccess] = useState(false);

  // Branch Email Spreadsheets & Google Sheets Conversion state
  const [sourceViewMode, setSourceViewMode] = useState<'DRIVE' | 'EMAIL'>('DRIVE');
  const [emailMessages, setEmailMessages] = useState<BranchEmailSpreadsheetMessage[]>(() => getCachedBranchEmails());
  const [isSearchingEmail, setIsSearchingEmail] = useState(false);
  const [emailSearchError, setEmailSearchError] = useState<string | null>(null);
  const [emailNeedsScopeConsent, setEmailNeedsScopeConsent] = useState(false);
  const [emailQuery, setEmailQuery] = useState('');
  const [convertingAttachmentKey, setConvertingAttachmentKey] = useState<string | null>(null);
  const [convertedSheetsMap, setConvertedSheetsMap] = useState<Record<string, ConvertedEmailSpreadsheetRecord>>(() =>
    getConvertedEmailSheetsMap()
  );
  const [emailConversionToast, setEmailConversionToast] = useState<string | null>(null);

  const SYNTHETIC_IATD_HEADERS = [
    'Item Code',
    'Barcode',
    'Item Description',
    'Category',
    'SubCategory',
    'SubsubCategory',
    'Unit',
    'Cost',
    'Selling Price',
    'Balance',
  ];

  // Keep iatdAllRows synchronized with countsheetItems in exact sequence whenever a countsheet is active
  useEffect(() => {
    if (!importedCountsheetSession) return;
    const headersToUse =
      iatdInspection && iatdInspection.headers.length > 0
        ? iatdInspection.headers
        : importedCountsheetSession.iatdHeaders && importedCountsheetSession.iatdHeaders.length > 0
        ? importedCountsheetSession.iatdHeaders
        : SYNTHETIC_IATD_HEADERS;

    const synthesizedRows = countsheetItems.map((item) =>
      buildIatdRowFromCountsheetItem(item, headersToUse)
    );
    setIatdAllRows(synthesizedRows);
  }, [countsheetItems, importedCountsheetSession, iatdInspection]);

  // Synchronize target countsheet whenever active countsheet filter changes
  useEffect(() => {
    if (countsheetEditorCsFilter && countsheetEditorCsFilter !== 'ALL') {
      setNewMissingCsCode(countsheetEditorCsFilter);
    }
  }, [countsheetEditorCsFilter]);

  // Distinct CS codes present in countsheetItems (restricted strictly to existing countsheets)
  const availableCsCodes = (() => {
    const fromItems = countsheetItems.map((it) => it.csCode || 'CS01');
    const fromSession = (importedCountsheetSession?.savedGroups || []).map((g) => g.name);
    const set = new Set([...fromItems, ...fromSession]);
    const list = Array.from(set).filter(Boolean);
    return list.length > 0
      ? list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      : ['CS01'];
  })();

  const handleImportCountsheet = async (session: RecentCountsheetSession) => {
    setImportedCountsheetSession(session);
    setShowCountsheetImportPicker(false);
    setCountsheetImportError(null);
    setEnableCountsheetCols(true);

    const headerRowToUse = session.headerRow || iatdHeaderRow;
    setIatdHeaderRow(headerRowToUse);

    // 1. Immediately reconstruct any embedded items so the UI updates right away
    const initialHeaders =
      session.iatdHeaders && session.iatdHeaders.length > 0
        ? session.iatdHeaders
        : iatdInspection?.headers && iatdInspection.headers.length > 0
        ? iatdInspection.headers
        : SYNTHETIC_IATD_HEADERS;

    const immediateItems = reconstructCountsheetItemsFromSession(session, initialHeaders, []);
    if (immediateItems.length > 0) {
      setCountsheetItems(immediateItems);
      const maxCs = immediateItems.reduce((acc, it) => {
        const m = (it.csCode || '').match(/(\d+)/);
        return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
      }, 1);
      setCountsheetCount(maxCs);
      const firstCs = immediateItems[0]?.csCode || 'CS01';
      setNewMissingCsCode(firstCs);
      setInsertAfterSeqNum(immediateItems.length);

      if (!iatdInspection) {
        const synthRows = immediateItems.map((it) => buildIatdRowFromCountsheetItem(it, initialHeaders));
        setIatdInspection({
          spreadsheetId: session.sourceFile?.id || session.spreadsheetId || 'countsheet-session',
          spreadsheetTitle: session.sourceFile?.name || session.spreadsheetName || 'Pre-Generated Countsheet',
          sheetTitle: session.sourceFile?.tabName || 'COUNTSHEET',
          detectedHeaderRow: headerRowToUse,
          headers: initialHeaders,
          totalRows: synthRows.length,
          sampleRows: synthRows.slice(0, 5),
        });
      }
    }

    // 2. Inspect source IATD if available and fetch all source rows for missing-item search & legacy reconstruction
    const sourceId = extractSpreadsheetId(session.sourceFile?.id || '');
    if (sourceId && !sourceId.startsWith('draft_')) {
      setIsLoadingIatd(true);
      setIatdError(null);
      try {
        const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) || effectiveToken || '';
        const { tabs } = await getSpreadsheetTabs(tokenToUse, sourceId);
        setIatdTabs(tabs);
        const targetTab = session.sourceFile?.tabName || (tabs.length > 0 ? tabs[0].title : undefined);
        if (targetTab) setSelectedIatdTab(targetTab);

        const inspection = await inspectSheetHeaders(tokenToUse, sourceId, targetTab, headerRowToUse);
        setIatdInspection(inspection);
        setIatdInputId(sourceId);

        const dateStr = new Date().toISOString().split('T')[0];
        setNewCopyTitle(`${session.spreadsheetName || inspection.spreadsheetTitle} - Audit Encoding (${dateStr})`);

        const { headers: fullHeaders, rows: allRows } = await fetchAllSheetRows(
          tokenToUse,
          sourceId,
          targetTab || inspection.sheetTitle,
          headerRowToUse
        );
        setFullSourceIatdRows(allRows);

        const effectiveHeaders = fullHeaders.length > 0 ? fullHeaders : inspection.headers;
        const hydratedItems = reconstructCountsheetItemsFromSession(session, effectiveHeaders, allRows);

        // Also if session.spreadsheetId is a real Google Sheet, check if any Actual counts were entered in the sheet
        let finalItems = hydratedItems.length > 0 ? hydratedItems : immediateItems;
        const cleanCsSheetId = extractSpreadsheetId(session.spreadsheetId || '');
        if (cleanCsSheetId && !cleanCsSheetId.startsWith('draft_') && cleanCsSheetId !== sourceId) {
          try {
            const sheetData = await fetchCountsheetItemsFromSpreadsheet(tokenToUse, cleanCsSheetId);
            if (sheetData.items.length > 0) {
              if (finalItems.length === 0) {
                finalItems = sheetData.items;
              } else {
                // Merge Actuals from the live countsheet tabs by sequence/itemCode
                finalItems = finalItems.map((it, idx) => {
                  const matchBySeq = sheetData.items[idx];
                  const matchByCode =
                    matchBySeq && matchBySeq.itemCode === it.itemCode
                      ? matchBySeq
                      : sheetData.items.find(
                          (s) =>
                            s.itemCode &&
                            s.itemCode.toLowerCase() === (it.itemCode || '').toLowerCase() &&
                            s.csCode === it.csCode
                        );
                  if (matchByCode) {
                    return {
                      ...it,
                      actual: it.actual !== undefined && it.actual !== null ? it.actual : matchByCode.actual,
                    };
                  }
                  return it;
                });
              }
            }
          } catch {
            // Ignore if countsheet spreadsheet isn't accessible
          }
        }

        setCountsheetItems(finalItems);
        if (finalItems.length > 0) {
          setInsertAfterSeqNum(finalItems.length);
          setNewMissingCsCode(finalItems[finalItems.length - 1]?.csCode || 'CS01');
        }
      } catch (err: any) {
        console.warn('Could not load source IATD for countsheet session, using embedded countsheet data:', err);
        if (immediateItems.length > 0) {
          const fallbackHeaders =
            session.iatdHeaders && session.iatdHeaders.length > 0
              ? session.iatdHeaders
              : SYNTHETIC_IATD_HEADERS;
          const synthRows = immediateItems.map((it) => buildIatdRowFromCountsheetItem(it, fallbackHeaders));
          setIatdInspection({
            spreadsheetId: sourceId || session.spreadsheetId || 'countsheet-session',
            spreadsheetTitle: session.sourceFile?.name || session.spreadsheetName || 'Pre-Generated Countsheet',
            sheetTitle: session.sourceFile?.tabName || 'COUNTSHEET',
            detectedHeaderRow: headerRowToUse,
            headers: fallbackHeaders,
            totalRows: synthRows.length,
            sampleRows: synthRows.slice(0, 5),
          });
          const dateStr = new Date().toISOString().split('T')[0];
          setNewCopyTitle(`${session.spreadsheetName} - Audit Encoding (${dateStr})`);
        } else {
          setIatdError(err.message || 'Could not load source IATD spreadsheet.');
        }
      } finally {
        setIsLoadingIatd(false);
      }
    } else if (immediateItems.length > 0) {
      const fallbackHeaders =
        session.iatdHeaders && session.iatdHeaders.length > 0
          ? session.iatdHeaders
          : SYNTHETIC_IATD_HEADERS;
      const synthRows = immediateItems.map((it) => buildIatdRowFromCountsheetItem(it, fallbackHeaders));
      setIatdInspection({
        spreadsheetId: session.spreadsheetId || 'countsheet-session',
        spreadsheetTitle: session.spreadsheetName || 'Pre-Generated Countsheet',
        sheetTitle: session.sourceFile?.tabName || 'COUNTSHEET',
        detectedHeaderRow: headerRowToUse,
        headers: fallbackHeaders,
        totalRows: synthRows.length,
        sampleRows: synthRows.slice(0, 5),
      });
      const dateStr = new Date().toISOString().split('T')[0];
      setNewCopyTitle(`${session.spreadsheetName} - Audit Encoding (${dateStr})`);
    }
  };

  // Load a pre-generated countsheet directly by Google Spreadsheet URL or ID
  const handleImportFromCountsheetUrl = async () => {
    const cleanId = extractSpreadsheetId(countsheetUrlToImport.trim());
    if (!cleanId) return;

    setIsImportingCountsheetSheet(true);
    setCountsheetImportError(null);
    try {
      const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) || effectiveToken || '';
      const sheetData = await fetchCountsheetItemsFromSpreadsheet(tokenToUse, cleanId);
      if (sheetData.items.length === 0) {
        setCountsheetImportError('No countsheet items found in that spreadsheet. Make sure it is a generated Countsheet Google Sheet.');
        setIsImportingCountsheetSheet(false);
        return;
      }

      const headersToUse =
        iatdInspection && iatdInspection.headers.length > 0
          ? iatdInspection.headers
          : SYNTHETIC_IATD_HEADERS;

      const enrichedItems = sheetData.items.map((it) => ({
        ...it,
        raw: buildIatdRowFromCountsheetItem(it, headersToUse),
      }));

      const savedSession = await saveRecentCountsheet({
        spreadsheetId: sheetData.spreadsheetId,
        spreadsheetName: sheetData.spreadsheetTitle,
        webViewLink: `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`,
        totalSheets: sheetData.totalSheets,
        totalItems: enrichedItems.length,
        sourceFile: {
          id: iatdInspection?.spreadsheetId || sheetData.spreadsheetId,
          name: iatdInspection?.spreadsheetTitle || sheetData.spreadsheetTitle,
          tabName: selectedIatdTab || iatdInspection?.sheetTitle || 'COUNTSHEET',
        },
        iatdHeaders: headersToUse,
        headerRow: iatdHeaderRow,
        orderedCountsheetItems: enrichedItems,
      });

      setRecentCountsheetSessions(getRecentCountsheets());
      setImportedCountsheetSession(savedSession);
      setCountsheetItems(enrichedItems);
      setEnableCountsheetCols(true);

      if (!iatdInspection) {
        const synthRows = enrichedItems.map((it) => buildIatdRowFromCountsheetItem(it, headersToUse));
        setIatdInspection({
          spreadsheetId: sheetData.spreadsheetId,
          spreadsheetTitle: sheetData.spreadsheetTitle,
          sheetTitle: 'COUNTSHEET',
          detectedHeaderRow: 2,
          headers: headersToUse,
          totalRows: synthRows.length,
          sampleRows: synthRows.slice(0, 5),
        });
      }

      const dateStr = new Date().toISOString().split('T')[0];
      setNewCopyTitle(`${sheetData.spreadsheetTitle} - Audit Encoding (${dateStr})`);
      setCountsheetUrlToImport('');
      setShowCountsheetImportPicker(false);
    } catch (err: any) {
      setCountsheetImportError(err.message || 'Failed to read Countsheet spreadsheet from Google Drive.');
    } finally {
      setIsImportingCountsheetSheet(false);
    }
  };

  // Update a single countsheet item's Balance, Actual, or CS code in sequence
  const handleUpdateCountsheetItem = (
    indexInSequence: number,
    updates: Partial<PreGeneratedCountsheetItem>
  ) => {
    setCountsheetItems((prev) => {
      const next = [...prev];
      const target = next[indexInSequence];
      if (!target) return prev;
      const headersToUse =
        iatdInspection && iatdInspection.headers.length > 0
          ? iatdInspection.headers
          : importedCountsheetSession?.iatdHeaders && importedCountsheetSession.iatdHeaders.length > 0
          ? importedCountsheetSession.iatdHeaders
          : SYNTHETIC_IATD_HEADERS;
      const updatedItem: PreGeneratedCountsheetItem = {
        ...target,
        ...updates,
      };
      updatedItem.raw = buildIatdRowFromCountsheetItem(updatedItem, headersToUse);
      next[indexInSequence] = updatedItem;
      return next;
    });
  };

  // Move item up or down in sequence
  const handleMoveCountsheetItem = (indexInSequence: number, direction: 'UP' | 'DOWN') => {
    setCountsheetItems((prev) => {
      const targetIdx = direction === 'UP' ? indexInSequence - 1 : indexInSequence + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const temp = next[indexInSequence];
      next[indexInSequence] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  };

  // Remove item from countsheet sequence
  const handleRemoveCountsheetItem = (indexInSequence: number) => {
    setCountsheetItems((prev) => prev.filter((_, idx) => idx !== indexInSequence));
  };

  // Remove an entire CS group (e.g. CS08) and all its items from the countsheet sequence
  const handleRemoveCountsheetCsGroup = (csCodeToRemove: string) => {
    setCountsheetItems((prev) =>
      prev.filter((item) => (item.csCode || 'CS01') !== csCodeToRemove)
    );
    if (countsheetEditorCsFilter === csCodeToRemove) {
      setCountsheetEditorCsFilter('ALL');
    }
  };

  // Insert a missing inventory item into the selected countsheet at the configured position
  const insertMissingItemAtConfiguredPosition = (
    newItem: PreGeneratedCountsheetItem,
    targetCsCode?: string
  ) => {
    const headersToUse =
      iatdInspection && iatdInspection.headers.length > 0
        ? iatdInspection.headers
        : importedCountsheetSession?.iatdHeaders && importedCountsheetSession.iatdHeaders.length > 0
        ? importedCountsheetSession.iatdHeaders
        : SYNTHETIC_IATD_HEADERS;

    const chosenCs = (
      targetCsCode ||
      (countsheetEditorCsFilter !== 'ALL' ? countsheetEditorCsFilter : newMissingCsCode) ||
      availableCsCodes[0] ||
      'CS01'
    ).trim().toUpperCase();

    const itemWithRaw: PreGeneratedCountsheetItem = {
      ...newItem,
      csCode: chosenCs,
      isMissingItem: true,
      raw: buildIatdRowFromCountsheetItem({ ...newItem, csCode: chosenCs }, headersToUse),
    };

    setCountsheetItems((prev) => {
      const next = [...prev];

      if (insertPositionMode === 'START') {
        // Find first occurrence of chosenCs
        const firstIdx = next.findIndex((it) => (it.csCode || 'CS01') === chosenCs);
        if (firstIdx !== -1) {
          next.splice(firstIdx, 0, itemWithRaw);
        } else {
          next.unshift(itemWithRaw);
        }
      } else if (insertPositionMode === 'AFTER_SEQ') {
        const clampedIdx = Math.max(0, Math.min(next.length, insertAfterSeqNum));
        next.splice(clampedIdx, 0, itemWithRaw);
      } else {
        // 'END': Insert at the end of the items for chosenCs (so it stays strictly inside chosenCs)
        let lastIdx = -1;
        for (let i = next.length - 1; i >= 0; i--) {
          if ((next[i].csCode || 'CS01') === chosenCs) {
            lastIdx = i;
            break;
          }
        }
        if (lastIdx !== -1) {
          next.splice(lastIdx + 1, 0, itemWithRaw);
        } else {
          next.push(itemWithRaw);
        }
      }
      return next;
    });

    setCountsheetSaveMsg(`Item added to ${chosenCs}`);
    setTimeout(() => setCountsheetSaveMsg(null), 3000);
  };

  // Save edited countsheet items (Balance, Actual, Missing Items, Sequence) back to the session
  const handlePersistEditedCountsheetSession = async () => {
    if (!importedCountsheetSession) return;
    setIsSavingEditsLoading(true);
    try {
      const distinctCsCount = new Set(countsheetItems.map((it) => it.csCode || 'CS01')).size;
      const remainingCsSet = new Set(countsheetItems.map((it) => it.csCode || 'CS01'));
      const updatedSavedGroups = importedCountsheetSession.savedGroups
        ? importedCountsheetSession.savedGroups
            .map((grp) => {
              if (!grp.orderedItems) return grp;
              const filteredGrpItems = grp.orderedItems.filter((it) =>
                remainingCsSet.has(it.csCode || grp.name || 'CS01')
              );
              return {
                ...grp,
                orderedItems: filteredGrpItems,
              };
            })
            .filter((grp) => !grp.orderedItems || grp.orderedItems.length > 0)
        : undefined;

      const updatedSession = await saveRecentCountsheet({
        ...importedCountsheetSession,
        totalSheets: distinctCsCount || importedCountsheetSession.totalSheets,
        totalItems: countsheetItems.length,
        savedGroups: updatedSavedGroups,
        orderedCountsheetItems: countsheetItems,
      });
      setImportedCountsheetSession(updatedSession);
      setRecentCountsheetSessions(getRecentCountsheets());
      setCountsheetSaveMsg('Countsheet changes & sequence saved!');
      setTimeout(() => setCountsheetSaveMsg(null), 3000);

      // Trigger interactive checkmark animation
      setIsSaveEditsSuccess(true);
      setTimeout(() => {
        setIsSaveEditsSuccess(false);
      }, 2200);
    } catch (saveErr) {
      console.error('Failed to save edited countsheet session:', saveErr);
      setCountsheetSaveMsg('Error saving changes');
      setTimeout(() => setCountsheetSaveMsg(null), 3000);
    } finally {
      setIsSavingEditsLoading(false);
    }
  };

  // 4. Execution State
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<string>('');
  const [executionResult, setExecutionResult] = useState<{
    spreadsheetId: string;
    spreadsheetName: string;
    totalRows: number;
    webViewLink: string;
    folderName?: string;
    folderWebViewLink?: string;
  } | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareSuccessMsg, setShareSuccessMsg] = useState<string | null>(null);

  // 5. Recent Reports State
  const [recentReports, setRecentReports] = useState<RecentAuditReport[]>([]);
  const [isSyncingRecents, setIsSyncingRecents] = useState<boolean>(false);
  const [isViewingRecent, setIsViewingRecent] = useState<boolean>(false);
  const [editingRecentReport, setEditingRecentReport] = useState<RecentAuditReport | null>(null);
  const [recentReportFilter, setRecentReportFilter] = useState<string>('');
  const [confirmClearReports, setConfirmClearReports] = useState<boolean>(false);

  const handleSyncCloudRecents = async () => {
    setIsSyncingRecents(true);
    try {
      const [syncedReports, syncedCountsheets] = await Promise.all([
        syncRecentAuditReportsFromCloud(),
        syncRecentCountsheetsFromCloud(),
      ]);
      setRecentReports(syncedReports);
      setRecentCountsheetSessions(syncedCountsheets);
    } catch {} finally {
      setIsSyncingRecents(false);
    }
  };

  const handleSelectRecentReport = (item: RecentAuditReport, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExecutionResult({
      spreadsheetId: item.spreadsheetId,
      spreadsheetName: item.spreadsheetName,
      totalRows: item.totalRows,
      webViewLink: item.webViewLink,
      folderName: item.folderName,
      folderWebViewLink: item.folderWebViewLink,
    });
    setIsViewingRecent(true);
    setStep('SUCCESS');
  };

  // Edit a recent generated Encoding report — brings the user directly to Step 2 (Audit Template)
  const handleEditRecentReport = async (item: RecentAuditReport, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const cleanSheetId = extractSpreadsheetId(item.spreadsheetId);
    if (!cleanSheetId) return;

    setEditingRecentReport(item);
    setIsViewingRecent(false);
    setExecutionError(null);
    setTemplateError(null);
    setIatdError(null);

    // Update the existing generated spreadsheet in-place by default
    setCreateAsCopy(false);
    setNewCopyTitle(item.spreadsheetName);
    setTemplateInputId(cleanSheetId);
    setEnableCountsheetCols(true);
    if (item.countsheetCount && item.countsheetCount > 0) {
      setCountsheetCount(item.countsheetCount);
    }

    const rowToUse = item.templateHeaderRow || 2;
    setTemplateHeaderRow(rowToUse);
    setIatdHeaderRow(item.iatdHeaderRow || rowToUse);

    // Immediately bring user to Step 2: Audit Template
    setStep('TARGET_TEMPLATE');
    setIsLoadingTemplate(true);

    try {
      const tokenToUse =
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';

      // Also populate the template list in Step 2 from Hub Cache
      fetchHubTemplatesFromServer()
        .then((hubData) => {
          const hubTemplates =
            hubData.encodingTemplates && hubData.encodingTemplates.length > 0
              ? hubData.encodingTemplates
              : getCachedHubEncodingTemplates();
          setMatchingTemplateFiles(
            hubTemplates.map((t) => ({
              id: t.id,
              name: t.name,
              owner: `${t.ownerEmail || HUB_OWNER_EMAIL} • ${t.folderPath || 'TEMPLATE/ENCODING'}`,
              modifiedTime: t.modifiedTime,
            }))
          );
        })
        .catch(() => {});

      const { tabs } = await getSpreadsheetTabs(tokenToUse, cleanSheetId);
      setTemplateTabs(tabs);

      const encodingTab = tabs.find((t) =>
        t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('ENCOD')
      );
      const targetTab = encodingTab ? encodingTab.title : tabs[0]?.title || 'ENCODING';
      setSelectedTemplateTab(targetTab);

      const inspection = await inspectSheetHeaders(tokenToUse, cleanSheetId, targetTab, rowToUse);
      setTemplateInspection({
        ...inspection,
        spreadsheetTitle: item.spreadsheetName || inspection.spreadsheetTitle,
      });

      // Detect existing CS01..CS{N} columns from Row 2 headers
      const firstCsIdx = inspection.headers.findIndex((h) => /^cs0*1$/i.test(String(h || '').trim()));
      let detectedCsCols = 0;
      if (firstCsIdx !== -1) {
        for (let i = firstCsIdx; i < inspection.headers.length; i++) {
          if (/^cs0*\d+$/i.test(String(inspection.headers[i] || '').trim())) {
            detectedCsCols++;
          } else {
            break;
          }
        }
      }
      if (detectedCsCols > 0 && !item.countsheetCount) {
        setCountsheetCount(detectedCsCols);
      }

      // Extract item columns (columns prior to CS01) and load existing rows so the user can edit & re-save in Step 2 or Step 3
      const itemColEnd = firstCsIdx > 0 ? firstCsIdx : Math.min(14, inspection.headers.length);
      const itemHeaders = inspection.headers.slice(0, itemColEnd).filter((h) => String(h || '').trim() !== '');
      const effectiveItemHeaders = itemHeaders.length > 0 ? itemHeaders : SYNTHETIC_IATD_HEADERS;

      const { rows: existingRows } = await fetchAllSheetRows(
        tokenToUse,
        cleanSheetId,
        targetTab,
        rowToUse
      );
      const trimmedItemRows = existingRows.map((r) => r.slice(0, itemColEnd));

      setIatdInputId(item.iatdSpreadsheetId || cleanSheetId);
      setSelectedIatdTab(item.iatdTabName || targetTab);
      setIatdTabs(tabs);
      setIatdInspection({
        spreadsheetId: item.iatdSpreadsheetId || cleanSheetId,
        spreadsheetTitle: item.iatdTitle || item.spreadsheetName,
        sheetTitle: item.iatdTabName || targetTab,
        detectedHeaderRow: item.iatdHeaderRow || rowToUse,
        headers: effectiveItemHeaders,
        totalRows: trimmedItemRows.length || item.totalRows || inspection.totalRows,
        sampleRows: trimmedItemRows.slice(0, 5),
      });
      setFullSourceIatdRows(trimmedItemRows);
      setIatdAllRows(trimmedItemRows);

      const autoMap = generateAutoMapping(effectiveItemHeaders, inspection.headers);
      setMapping(autoMap);
    } catch (err: any) {
      console.warn('Error loading recent encoding sheet for editing:', err);
      const fallbackTemplates = getCachedHubEncodingTemplates();
      const fallbackTmpl = fallbackTemplates[0];
      if (fallbackTmpl) {
        setTemplateTabs(fallbackTmpl.tabs);
        setSelectedTemplateTab(fallbackTmpl.sheetTitle || 'ENCODING');
        setTemplateInspection({
          spreadsheetId: cleanSheetId,
          spreadsheetTitle: item.spreadsheetName,
          sheetTitle: fallbackTmpl.sheetTitle || 'ENCODING',
          detectedHeaderRow: rowToUse,
          headers: fallbackTmpl.headers,
          totalRows: item.totalRows,
          sampleRows: [],
        });
        if (!iatdInspection) {
          setIatdInspection({
            spreadsheetId: item.iatdSpreadsheetId || cleanSheetId,
            spreadsheetTitle: item.iatdTitle || item.spreadsheetName,
            sheetTitle: 'ENCODING',
            detectedHeaderRow: rowToUse,
            headers: SYNTHETIC_IATD_HEADERS,
            totalRows: item.totalRows,
            sampleRows: [],
          });
        }
      }
      setTemplateError(
        err?.message || 'Loaded recent report metadata. Reconnect Google Drive if you wish to fetch live rows.'
      );
    } finally {
      setIsLoadingTemplate(false);
    }
  };

  const handleDeleteRecentReport = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = deleteRecentAuditReport(id);
    setRecentReports(updated);
  };

  // Copy Google Sheet link
  const handleCopyLink = async () => {
    if (!executionResult?.webViewLink) return;
    try {
      await navigator.clipboard.writeText(executionResult.webViewLink);
      setCopiedLink(true);
      setShareSuccessMsg('Link copied to clipboard!');
      setTimeout(() => {
        setCopiedLink(false);
        setShareSuccessMsg(null);
      }, 3500);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    }
  };

  // Share to Messenger and other messaging apps
  const handleShareToMessengerAndApps = async () => {
    if (!executionResult?.webViewLink) return;
    const url = executionResult.webViewLink;
    const title = executionResult.spreadsheetName;
    const shareText = `Audit Report ENCODING Google Sheet (${executionResult.totalRows.toLocaleString()} items):\n${url}`;

    // Native Web Share API (supports Messenger, WhatsApp, Telegram, Viber, Mail, etc.)
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: `Audit Report ENCODING Sheet (${executionResult.totalRows.toLocaleString()} items)`,
          url,
        });
        return;
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.warn('Web share failed, falling back to copy:', e);
        } else {
          return;
        }
      }
    }

    // Fallback: Copy link
    handleCopyLink();
  };

  const handleRefreshDrive = () => {
    setIsSearchingDrive(true);
    setDriveSearchError(null);
    searchDriveSpreadsheets(effectiveToken || '', searchQuery)
      .then((files) => {
        setDriveFiles(files);
        setDriveSearchError(null);
      })
      .catch((err) => {
        console.warn('Could not fetch drive spreadsheets:', err);
        const cached = getCachedDriveFiles(searchQuery);
        if (cached.length > 0) {
          setDriveFiles(cached);
          setDriveSearchError(null);
        } else {
          setDriveSearchError(err?.message || 'Could not load spreadsheets from Google Drive.');
        }
      })
      .finally(() => setIsSearchingDrive(false));
  };

  // Auto-search Drive files on modal open using existing or auto-resolved session
  useEffect(() => {
    const searchDriveOnOpen = async () => {
      if (!isOpen) return;
      const cached = getCachedDriveFiles(searchQuery);
      if (cached.length > 0) {
        setDriveFiles(cached);
      }
      setIsSearchingDrive(true);
      setDriveSearchError(null);
      searchDriveSpreadsheets(effectiveToken || '', searchQuery)
        .then((files) => {
          setDriveFiles(files);
          setDriveSearchError(null);
        })
        .catch((err) => {
          console.warn('Could not fetch drive spreadsheets:', err);
          const fallbackCached = getCachedDriveFiles(searchQuery);
          if (fallbackCached.length > 0) {
            setDriveFiles(fallbackCached);
            setDriveSearchError(null);
          } else {
            setDriveSearchError(err?.message || 'Could not load spreadsheets from Google Drive.');
          }
        })
        .finally(() => setIsSearchingDrive(false));
    };

    searchDriveOnOpen();
  }, [isOpen, searchQuery, effectiveToken]);

  // Reset state & load recents (local + cloud cross-device sync) when modal opens
  useEffect(() => {
    const unsubReports = subscribeToRecentAuditReports((updated) => {
      setRecentReports(updated);
    });
    const unsubCountsheets = subscribeToRecentCountsheets((updated) => {
      setRecentCountsheetSessions(updated);
    });
    const unsubAdminLinks = subscribeToAdminDriveLinks((updatedLinks) => {
      const parsedOverall = extractDriveResourceFromLink(updatedLinks.overallCountTemplateLink);
      if (parsedOverall && !parsedOverall.isFolder) {
        setTemplateInputId(parsedOverall.id);
      } else if (updatedLinks.overallCountTemplateLink) {
        setTemplateInputId(updatedLinks.overallCountTemplateLink);
      }
    });
    return () => {
      unsubReports();
      unsubCountsheets();
      unsubAdminLinks();
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setRecentReports(getRecentAuditReports());
      setRecentCountsheetSessions(getRecentCountsheets());
      handleSyncCloudRecents();
      setStep('SOURCE_IATD');
      setIatdHeaderRow(2);
      setTemplateHeaderRow(2);
      setIsViewingRecent(false);
      setEditingRecentReport(null);
      setCreateAsCopy(true);
      setExecutionResult(null);
      setExecutionError(null);
      setIatdError(null);
      setTemplateError(null);
      const adminOverallLink = getAdminDriveLinksConfig().overallCountTemplateLink;
      const parsedAdminOverall = extractDriveResourceFromLink(adminOverallLink);
      if (parsedAdminOverall) {
        setTemplateInputId(parsedAdminOverall.isFolder ? adminOverallLink : parsedAdminOverall.id);
      } else if (activeBranch) {
        setTemplateInputId(activeBranch.id);
      }
      if (initialCountsheetType === 'random') {
        setCountsheetCount(20);
        setEnableCountsheetCols(true);
      }
    }
  }, [isOpen, initialCountsheetType]);

  const handleRefreshEmails = async (overrideToken?: string, interactive = false) => {
    setIsSearchingEmail(true);
    setEmailSearchError(null);
    setEmailNeedsScopeConsent(false);
    try {
      const tokenToUse = overrideToken || (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) || '';
      if (!tokenToUse) {
        setEmailSearchError('Please connect your Google account to view branch email spreadsheets.');
        return;
      }
      const messages = await searchBranchEmailSpreadsheets(tokenToUse, emailQuery, {
        allowInteractiveConsent: interactive,
      });
      setEmailMessages(messages);
      setConvertedSheetsMap(getConvertedEmailSheetsMap());
    } catch (err: any) {
      console.warn('Error fetching branch email spreadsheets:', err);
      const cached = getCachedBranchEmails(emailQuery);
      if (err?.isInsufficientScope || err?.message === 'GMAIL_SCOPE_REQUIRED') {
        setEmailNeedsScopeConsent(true);
        setEmailSearchError('Gmail read permission is needed to view emailed spreadsheets from branches.');
      } else if (cached.length > 0 && !emailQuery.trim()) {
        setEmailMessages(cached);
        setEmailSearchError(null);
      } else {
        setEmailSearchError(err?.message || 'Could not load emailed spreadsheets from Gmail.');
      }
    } finally {
      setIsSearchingEmail(false);
    }
  };

  const handleAuthorizeGmailScope = async () => {
    setIsRefreshingToken(true);
    setEmailSearchError(null);
    try {
      const newToken = await refreshGoogleAccessToken(undefined, true);
      if (newToken) {
        setLocalToken(newToken);
        if (onTokenRefreshed) onTokenRefreshed(newToken);
        setEmailNeedsScopeConsent(false);
        await handleRefreshEmails(newToken, true);
      }
    } catch (err: any) {
      setEmailSearchError(err?.message || 'Could not authorize Gmail access.');
    } finally {
      setIsRefreshingToken(false);
    }
  };

  const handleConvertEmailAttachment = async (
    msg: BranchEmailSpreadsheetMessage,
    att: EmailSpreadsheetAttachment,
    loadImmediately = true
  ) => {
    const key = `${msg.messageId}:${att.filename}`;
    setConvertingAttachmentKey(key);
    setEmailSearchError(null);
    setEmailConversionToast(null);
    try {
      const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) || effectiveToken || '';
      if (!tokenToUse) {
        throw new Error('Google access token is required to convert attachments.');
      }
      const cleanSubject = (msg.subject || '').replace(/^(re|fwd|fw):\s*/i, '').trim();
      const baseFilename = att.filename.replace(/\.(xlsx|xls|xlsm|csv|ods)$/i, '').trim();
      const customTitle = cleanSubject
        ? `${baseFilename} (${cleanSubject.slice(0, 40)})`
        : `${baseFilename} (Branch Email)`;

      const converted = await convertEmailAttachmentToGoogleSheet({
        accessToken: tokenToUse,
        messageId: msg.messageId,
        attachment: att,
        customTitle,
      });

      setConvertedSheetsMap(getConvertedEmailSheetsMap());
      setEmailConversionToast(`Converted "${att.filename}" to Google Sheets format!`);
      setTimeout(() => setEmailConversionToast(null), 5000);

      // Refresh Drive list in background so it appears in Drive files too
      searchDriveSpreadsheets(tokenToUse, searchQuery)
        .then((files) => setDriveFiles(files))
        .catch(() => {});

      if (loadImmediately) {
        await handleInspectIatd(converted.id, undefined, iatdHeaderRow, tokenToUse);
      }
    } catch (err: any) {
      console.error('Error converting email spreadsheet attachment:', err);
      if (err?.isInsufficientScope || err?.message === 'GMAIL_SCOPE_REQUIRED') {
        setEmailNeedsScopeConsent(true);
        setEmailSearchError('Gmail permission is required to download & convert this branch spreadsheet.');
      } else {
        setEmailSearchError(err?.message || 'Failed to convert attachment to Google Sheets.');
      }
    } finally {
      setConvertingAttachmentKey(null);
    }
  };

  const handleConvertDriveExcelFile = async (file: DriveSpreadsheetFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const key = `drive_${file.id}`;
    setConvertingAttachmentKey(key);
    setIatdError(null);
    setEmailConversionToast(null);
    try {
      const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) || effectiveToken || '';
      if (!tokenToUse) {
        throw new Error('Google access token is required to convert Excel file.');
      }
      const converted = await convertDriveExcelFileToGoogleSheet(tokenToUse, {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
      });
      setEmailConversionToast(`Converted "${file.name}" into Google Sheets compatible format!`);
      setTimeout(() => setEmailConversionToast(null), 5000);

      searchDriveSpreadsheets(tokenToUse, searchQuery)
        .then((files) => setDriveFiles(files))
        .catch(() => {});

      await handleInspectIatd(converted.id, undefined, iatdHeaderRow, tokenToUse);
    } catch (err: any) {
      setIatdError(err?.message || 'Could not convert Excel file to Google Sheets.');
    } finally {
      setConvertingAttachmentKey(null);
    }
  };

  useEffect(() => {
    if (isOpen && sourceViewMode === 'EMAIL') {
      handleRefreshEmails();
    }
  }, [isOpen, sourceViewMode]);

  if (!isOpen) return null;

  // Inspect IATD Spreadsheet
  const handleInspectIatd = async (rawId: string, tabName?: string, customHeaderRow?: number, overrideToken?: string, driveFile?: DriveSpreadsheetFile) => {
    let cleanId = extractSpreadsheetId(rawId);
    if (!cleanId) return;

    const rowToUse = customHeaderRow ?? iatdHeaderRow;
    setIsLoadingIatd(true);
    setIatdError(null);

    try {
      const tokenToUse = overrideToken || (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) || effectiveToken || '';

      // If user clicked a raw Excel (.xlsx/.xls/.csv) file in Drive, auto-convert it to Google Sheets compatible format first
      const matchedDriveFile = driveFile || driveFiles.find((f) => f.id === cleanId);
      const isNonNativeExcel =
        matchedDriveFile &&
        ((matchedDriveFile.mimeType && matchedDriveFile.mimeType !== 'application/vnd.google-apps.spreadsheet') ||
          /\.(xlsx|xls|xlsm|csv|ods)$/i.test(matchedDriveFile.name || ''));

      if (isNonNativeExcel && matchedDriveFile) {
        const converted = await convertDriveExcelFileToGoogleSheet(tokenToUse, {
          id: matchedDriveFile.id,
          name: matchedDriveFile.name,
          mimeType: matchedDriveFile.mimeType,
        });
        cleanId = converted.id;
        setEmailConversionToast(`Converted "${matchedDriveFile.name}" to Google Sheets compatible format!`);
        setTimeout(() => setEmailConversionToast(null), 5000);
        searchDriveSpreadsheets(tokenToUse, searchQuery)
          .then((files) => setDriveFiles(files))
          .catch(() => {});
      }

      const { tabs } = await getSpreadsheetTabs(tokenToUse, cleanId);
      setIatdTabs(tabs);

      const targetTab = tabName || (tabs.length > 0 ? tabs[0].title : undefined);
      if (targetTab) setSelectedIatdTab(targetTab);

      const inspection = await inspectSheetHeaders(tokenToUse, cleanId, targetTab, rowToUse);
      setIatdInspection(inspection);
      setIatdInputId(cleanId);

      // Set default new copy title based on IATD title
      const dateStr = new Date().toISOString().split('T')[0];
      setNewCopyTitle(`${inspection.spreadsheetTitle} - Audit Encoding (${dateStr})`);
    } catch (err: any) {
      console.error('Error inspecting IATD sheet:', err);
      setDriveFiles(getCachedDriveFiles(searchQuery));
      setIatdError(err.message || 'Could not load IATD spreadsheet. Please check link/permissions.');
    } finally {
      setIsLoadingIatd(false);
    }
  };

  // Inspect ENCODING Template Spreadsheet (Default Header Row is Row 2; uses zero-popup Hub Cache for TEMPLATE/ENCODING)
  const handleInspectTemplate = async (rawId: string, tabName?: string, customHeaderRow?: number, overrideToken?: string) => {
    const cleanId = extractSpreadsheetId(rawId);
    if (!cleanId) return;

    const rowToUse = customHeaderRow ?? templateHeaderRow;
    setIsLoadingTemplate(true);
    setTemplateError(null);

    try {
      const tokenToUse =
        overrideToken ||
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';
      const { tabs } = await getSpreadsheetTabs(tokenToUse, cleanId);
      setTemplateTabs(tabs);

      // Prefer ENCODING tab
      const encodingTab = tabs.find((t) =>
        t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('ENCOD')
      );
      const targetTab = tabName || (encodingTab ? encodingTab.title : tabs[0]?.title);
      if (targetTab) setSelectedTemplateTab(targetTab);

      // Inspect ENCODING with specified header row (defaults to Row 2)
      const inspection = await inspectSheetHeaders(tokenToUse, cleanId, targetTab, rowToUse);
      setTemplateInspection(inspection);
      setTemplateInputId(cleanId);
      if (iatdInspection && inspection.spreadsheetTitle) {
        const dateStr = new Date().toISOString().split('T')[0];
        setNewCopyTitle(`${iatdInspection.spreadsheetTitle} - ${inspection.spreadsheetTitle} (${dateStr})`);
      }
    } catch (err: any) {
      console.error('Error inspecting template sheet:', err);
      setTemplateError(err.message || 'Could not load template spreadsheet.');
    } finally {
      setIsLoadingTemplate(false);
    }
  };

  // Select fixed template type (OVERALL COUNT TEMPLATE or CESSATION OVERALL COUNT TEMPLATE)
  // Loads directly from cached icdhubsystems@gmail.com TEMPLATE/ENCODING on the server so auditors never see a Firebase popup
  const handleSelectTemplateType = async (type: 'OVERALL COUNT TEMPLATE' | 'CESSATION OVERALL COUNT TEMPLATE') => {
    setSelectedTemplateType(type);

    setIsSearchingTemplates(true);
    setTemplateError(null);

    if (iatdInspection) {
      const dateStr = new Date().toISOString().split('T')[0];
      setNewCopyTitle(`${iatdInspection.spreadsheetTitle} - ${type} (${dateStr})`);
    }

    try {
      const tokenToUse =
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';

      // 1. Check Admin Console Overall Count Template Link first
      const adminOverallRaw = getAdminDriveLinksConfig().overallCountTemplateLink;
      const parsedAdminOverall = extractDriveResourceFromLink(adminOverallRaw);

      if (parsedAdminOverall) {
        if (!parsedAdminOverall.isFolder && type === 'OVERALL COUNT TEMPLATE') {
          setMatchingTemplateFiles([
            {
              id: parsedAdminOverall.id,
              name: 'OVERALL COUNT TEMPLATE (Admin Console)',
              owner: `${HUB_OWNER_EMAIL} • Admin Console Link`,
            },
          ]);
          setTemplateInputId(parsedAdminOverall.id);
          await handleInspectTemplate(parsedAdminOverall.id, undefined, templateHeaderRow, tokenToUse);
          return;
        } else if (parsedAdminOverall.isFolder && tokenToUse) {
          const folderSheets = await listSpreadsheetsInDriveFolder(tokenToUse, parsedAdminOverall.id);
          if (folderSheets.length > 0) {
            const folderAsDriveFiles: DriveSpreadsheetFile[] = folderSheets.map((f) => ({
              id: f.id,
              name: f.name,
              owner: `${HUB_OWNER_EMAIL} • Admin Console Folder`,
              modifiedTime: f.modifiedTime,
            }));
            setMatchingTemplateFiles(folderAsDriveFiles);
            const matchedInFolder =
              folderSheets.find((f) =>
                type === 'CESSATION OVERALL COUNT TEMPLATE'
                  ? /cessation/i.test(f.name)
                  : !/cessation/i.test(f.name) && /overall|encoding|template|count/i.test(f.name)
              ) || folderSheets[0];
            if (matchedInFolder) {
              setTemplateInputId(matchedInFolder.id);
              await handleInspectTemplate(matchedInFolder.id, undefined, templateHeaderRow, tokenToUse);
              return;
            }
          }
        }
      }

      // 2. Load cached templates from icdhubsystems@gmail.com (TEMPLATE/ENCODING) via server Hub Cache (zero popups)
      const hubData = await fetchHubTemplatesFromServer();
      const hubTemplates =
        hubData.encodingTemplates && hubData.encodingTemplates.length > 0
          ? hubData.encodingTemplates
          : getCachedHubEncodingTemplates();

      const matchingHub = hubTemplates.filter(
        (t) =>
          t.templateType.toUpperCase() === type.toUpperCase() ||
          t.name.toUpperCase().includes(type.toUpperCase())
      );
      const hubAsDriveFiles: DriveSpreadsheetFile[] = hubTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        owner: `${t.ownerEmail || HUB_OWNER_EMAIL} • ${t.folderPath || 'TEMPLATE/ENCODING'}`,
        modifiedTime: t.modifiedTime,
      }));

      setMatchingTemplateFiles(hubAsDriveFiles);

      const targetToInspect = matchingHub[0] || hubTemplates[0];
      if (targetToInspect) {
        await handleInspectTemplate(targetToInspect.id, undefined, templateHeaderRow, tokenToUse);
      }
    } catch (err: any) {
      console.warn('Error loading template:', err);
      const fallbackHub = getCachedHubEncodingTemplates().find(
        (t) => t.templateType.toUpperCase() === type.toUpperCase()
      );
      if (fallbackHub) {
        setMatchingTemplateFiles([
          {
            id: fallbackHub.id,
            name: fallbackHub.name,
            owner: `${HUB_OWNER_EMAIL} • TEMPLATE/ENCODING`,
          },
        ]);
        await handleInspectTemplate(fallbackHub.id, undefined, templateHeaderRow);
      } else {
        setTemplateError(`Could not load "${type}". You can paste the template URL directly below.`);
      }
    } finally {
      setIsSearchingTemplates(false);
    }
  };

  // Move from Step 1 (IATD) to Step 2 (Audit Template)
  const handleProceedToTemplate = () => {
    if (!iatdInspection || iatdInspection.headers.length === 0) {
      setIatdError(`Please select a valid IATD spreadsheet with header columns in Row ${iatdHeaderRow}.`);
      return;
    }
    setEditingRecentReport(null);
    setCreateAsCopy(true);
    setStep('TARGET_TEMPLATE');
    handleSelectTemplateType(selectedTemplateType);
  };

  // Move from Step 2 (Template) to Step 3 (Mapping)
  const handleProceedToMapping = async () => {
    if (!templateInspection || templateInspection.headers.length === 0) {
      setTemplateError(`Please select a valid ENCODING template spreadsheet with headers in Row ${templateHeaderRow}.`);
      return;
    }

    if (!iatdInspection) return;

    setStep('MAP_HEADERS');
    setIsLoadingAllIatd(true);

    try {
      const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) || effectiveToken || '';
      let effectiveIatdHeaders =
        iatdInspection.headers && iatdInspection.headers.length > 0
          ? iatdInspection.headers
          : SYNTHETIC_IATD_HEADERS;

      // If a pre-generated countsheet session is loaded, preserve its edited items & sequence!
      if (importedCountsheetSession) {
        let currentCsItems = countsheetItems;
        const canFetchRemoteIatd =
          iatdInspection.spreadsheetId &&
          !iatdInspection.spreadsheetId.startsWith('draft_') &&
          iatdInspection.spreadsheetId !== 'countsheet-session';

        if (canFetchRemoteIatd && (fullSourceIatdRows.length === 0 || currentCsItems.length === 0)) {
          try {
            const { headers: fullIatdHeaders, rows: allRows } = await fetchAllSheetRows(
              tokenToUse,
              iatdInspection.spreadsheetId,
              selectedIatdTab || iatdInspection.sheetTitle,
              iatdHeaderRow
            );
            if (fullIatdHeaders.length > 0) {
              effectiveIatdHeaders = fullIatdHeaders;
            }
            setFullSourceIatdRows(allRows);
            if (currentCsItems.length === 0) {
              currentCsItems = reconstructCountsheetItemsFromSession(
                importedCountsheetSession,
                effectiveIatdHeaders,
                allRows
              );
              setCountsheetItems(currentCsItems);
            }
          } catch (fetchErr) {
            console.warn('Using embedded countsheet items for mapping:', fetchErr);
          }
        }

        const orderedRows = currentCsItems.map((item) =>
          buildIatdRowFromCountsheetItem(item, effectiveIatdHeaders)
        );
        setIatdAllRows(orderedRows);

        const autoMap = generateAutoMapping(effectiveIatdHeaders, templateInspection.headers);
        setMapping(autoMap);
      } else {
        // Standard full IATD flow
        const { headers: fullIatdHeaders, rows: allRows } = await fetchAllSheetRows(
          tokenToUse,
          iatdInspection.spreadsheetId,
          selectedIatdTab || iatdInspection.sheetTitle,
          iatdHeaderRow
        );
        if (fullIatdHeaders.length > 0) {
          effectiveIatdHeaders = fullIatdHeaders;
        }
        setFullSourceIatdRows(allRows);
        setIatdAllRows(allRows);

        const autoMap = generateAutoMapping(effectiveIatdHeaders, templateInspection.headers);
        setMapping(autoMap);
      }
    } catch (err: any) {
      console.error('Error preparing mapping:', err);
      setTemplateError(err.message || 'Error fetching IATD rows for mapping.');
    } finally {
      setIsLoadingAllIatd(false);
    }
  };

  // Re-run auto mapping
  const handleAutoMap = () => {
    if (!iatdInspection || !templateInspection) return;
    const autoMap = generateAutoMapping(iatdInspection.headers, templateInspection.headers);
    setMapping(autoMap);
  };

  // Execute Creation / Population of ENCODING Sheet
  const handleExecuteAuditReport = async (tokenOverride?: string) => {
    if (!iatdInspection || !templateInspection) return;

    setIsExecuting(true);
    setExecutionError(null);

    try {
      const activeToken = tokenOverride || (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) || effectiveToken || '';
      if (!activeToken) {
        setExecutionError('Unable to generate encoding sheet. Please check your Google Drive connection.');
        setIsExecuting(false);
        return;
      }
      let targetSpreadsheetId = templateInspection.spreadsheetId;
      let targetSpreadsheetName = templateInspection.spreadsheetTitle;

      let targetFolderName: string | undefined = GENERATED_ENCODING_FOLDER_NAME;
      let targetFolderWebViewLink: string | undefined;

      // 1. If user chose to create a new copy of the template
      if (createAsCopy) {
        setExecutionProgress(
          `Creating copy of ENCODING template inside "${GENERATED_ENCODING_FOLDER_NAME}" folder in your Google Drive...`
        );
        const copyTitle = newCopyTitle.trim() || `${iatdInspection.spreadsheetTitle} - Audit Encoding`;
        const copyResult = await duplicateSpreadsheet(
          activeToken,
          templateInspection.spreadsheetId,
          copyTitle,
          GENERATED_ENCODING_FOLDER_NAME
        );
        targetSpreadsheetId = copyResult.id;
        targetSpreadsheetName = copyResult.name;
        targetFolderName = copyResult.folderName || GENERATED_ENCODING_FOLDER_NAME;
        targetFolderWebViewLink = copyResult.folderWebViewLink;
      }

      // 2. Prepare ordered rows to write (preserving countsheet sequence, edited Balance, and added missing items)
      const effectiveHeaders =
        iatdInspection.headers && iatdInspection.headers.length > 0
          ? iatdInspection.headers
          : SYNTHETIC_IATD_HEADERS;

      const rowsToWrite =
        importedCountsheetSession && countsheetItems.length > 0
          ? countsheetItems.map((item) => buildIatdRowFromCountsheetItem(item, effectiveHeaders))
          : iatdAllRows;

      const targetTabTitle = selectedTemplateTab || templateInspection.sheetTitle || 'ENCODING';
      const dataStartRow = templateHeaderRow + 1;
      setExecutionProgress(
        `Writing ${rowsToWrite.length.toLocaleString()} ordered rows into "${targetTabTitle}" tab (Row ${dataStartRow} onwards)...`
      );

      const result = await executeAuditReportMapping(
        activeToken,
        targetSpreadsheetId,
        targetTabTitle,
        templateInspection.headers,
        templateHeaderRow, // Header is Row 2 (or chosen header row)
        effectiveHeaders,
        rowsToWrite,
        mapping,
        true, // Clear old rows from dataStartRow downwards
        autoAdjustDimensions // Add/delete rows and columns dynamically
      );

      // 3. Determine required CS columns count (respect user-selected countsheetCount while covering any imported CSxx codes)
      const maxCsInItems =
        importedCountsheetSession && countsheetItems.length > 0
          ? countsheetItems.reduce((acc, it) => {
              const m = (it.csCode || '').match(/(\d+)/);
              return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
            }, 1)
          : 1;
      const effectiveCsCount = enableCountsheetCols
        ? Math.max(1, countsheetCount, importedCountsheetSession ? maxCsInItems : 1)
        : importedCountsheetSession
        ? maxCsInItems
        : Math.max(1, countsheetCount);

      if ((enableCountsheetCols || (importedCountsheetSession && countsheetItems.length > 0)) && effectiveCsCount > 0) {
        setExecutionProgress(
          `Adjusting CS columns (CS01 to CS${String(effectiveCsCount).padStart(2, '0')}) and MONITORING ranges (1-5 to ${
            Math.max(1, Math.ceil(effectiveCsCount / 5) - 1) * 5 + 1
          }-${Math.ceil(effectiveCsCount / 5) * 5} + 3 buffer rows)...`
        );
        try {
          await setupCountsheetHeadersInTemplate(
            activeToken,
            targetSpreadsheetId,
            targetTabTitle,
            templateHeaderRow,
            effectiveCsCount,
            result.totalRowsWritten,
            autoAdjustDimensions
          );
        } catch (csErr) {
          console.warn('Countsheet columns setup notice:', csErr);
          try {
            await setupMonitoringTabInTemplate(activeToken, targetSpreadsheetId, effectiveCsCount);
          } catch {}
        }
      } else {
        try {
          await setupMonitoringTabInTemplate(activeToken, targetSpreadsheetId, effectiveCsCount);
        } catch {}
      }

      // 4. Transfer edited Actual quantities from pre-generated countsheet items into the appropriate CS01..CS{N} columns
      if (importedCountsheetSession && countsheetItems.length > 0) {
        const hasAnyActuals = countsheetItems.some(
          (it) => it.actual !== undefined && it.actual !== null && String(it.actual).trim() !== ''
        );
        if (hasAnyActuals) {
          setExecutionProgress('Transferring countsheet Actual quantities into ENCODING CS columns...');
          try {
            await writeCountsheetActualsToEncodingSheet(
              activeToken,
              targetSpreadsheetId,
              targetTabTitle,
              templateHeaderRow,
              countsheetItems
            );
          } catch (actErr) {
            console.warn('Countsheet Actuals transfer notice:', actErr);
          }
        }

        // Persist updated countsheet session items & sequence
        saveRecentCountsheet({
          ...importedCountsheetSession,
          totalItems: countsheetItems.length,
          orderedCountsheetItems: countsheetItems,
        }).catch(() => {});
      }

      if (!createAsCopy && newCopyTitle.trim()) {
        targetSpreadsheetName = newCopyTitle.trim();
        await renameSpreadsheetInDrive(activeToken, targetSpreadsheetId, targetSpreadsheetName);
      }

      const finalResult = {
        spreadsheetId: result.spreadsheetId,
        spreadsheetName: targetSpreadsheetName,
        totalRows: result.totalRowsWritten,
        webViewLink: result.webViewLink,
        folderName: result.folderName || targetFolderName || GENERATED_ENCODING_FOLDER_NAME,
        folderWebViewLink: result.folderWebViewLink || targetFolderWebViewLink,
      };

      setExecutionResult(finalResult);

      // Save to recent audit reports list (preserving id if editing an existing recent report in-place)
      saveRecentAuditReport({
        id: !createAsCopy && editingRecentReport ? editingRecentReport.id : undefined,
        spreadsheetId: result.spreadsheetId,
        spreadsheetName: targetSpreadsheetName,
        totalRows: result.totalRowsWritten,
        webViewLink: result.webViewLink,
        iatdTitle: iatdInspection.spreadsheetTitle,
        templateTitle: templateInspection.spreadsheetTitle,
        countsheetCount: effectiveCsCount,
        iatdSpreadsheetId: iatdInspection.spreadsheetId,
        iatdTabName: selectedIatdTab || iatdInspection.sheetTitle,
        iatdHeaderRow,
        templateSpreadsheetId: templateInspection.spreadsheetId,
        templateHeaderRow,
        folderName: finalResult.folderName,
        folderWebViewLink: finalResult.folderWebViewLink,
      });

      setRecentReports(getRecentAuditReports());
      setIsViewingRecent(false);

      setStep('SUCCESS');
    } catch (err: any) {
      console.error('Audit report execution error:', err);
      setExecutionError(err.message || 'Failed to populate ENCODING sheet.');
    } finally {
      setIsExecuting(false);
    }
  };

  // Render the Pre-Generated Countsheet Items Editor (Edit Balance & Actual, Add Missing Items, Preserve Sequence)
  const renderPreGeneratedCountsheetEditor = () => {
    if (!importedCountsheetSession) return null;

    const effectiveHeaders =
      iatdInspection && iatdInspection.headers.length > 0
        ? iatdInspection.headers
        : importedCountsheetSession.iatdHeaders && importedCountsheetSession.iatdHeaders.length > 0
        ? importedCountsheetSession.iatdHeaders
        : SYNTHETIC_IATD_HEADERS;

    const detectedCols = detectIatdColumnIndices(effectiveHeaders);
    const existingCodeSet = new Set(
      countsheetItems.map((it) => (it.itemCode || '').trim().toLowerCase()).filter(Boolean)
    );

    const filteredWithOriginalIndex = countsheetItems
      .map((item, seqIdx) => ({ item, seqIdx }))
      .filter(({ item }) => {
        if (countsheetEditorCsFilter !== 'ALL' && item.csCode !== countsheetEditorCsFilter) {
          return false;
        }
        if (countsheetEditorSearch.trim()) {
          const q = countsheetEditorSearch.trim().toLowerCase();
          return (
            (item.itemCode || '').toLowerCase().includes(q) ||
            (item.barcode || '').toLowerCase().includes(q) ||
            (item.itemDescription || '').toLowerCase().includes(q) ||
            (item.category || '').toLowerCase().includes(q) ||
            (item.csCode || '').toLowerCase().includes(q)
          );
        }
        return true;
      });

    const countedCount = countsheetItems.filter(
      (it) => it.actual !== undefined && it.actual !== null && String(it.actual).trim() !== ''
    ).length;
    const missingAddedCount = countsheetItems.filter((it) => it.isMissingItem).length;

    // Candidate items from fullSourceIatdRows for adding missing inventory items
    const candidateIatdItems = fullSourceIatdRows
      .map((row, rIdx) => {
        const parsed = parseIatdRowToCountsheetItem(row, rIdx, detectedCols, newMissingCsCode);
        const alreadyInCountsheet =
          parsed.itemCode && existingCodeSet.has(parsed.itemCode.toLowerCase());
        return { parsed, alreadyInCountsheet };
      })
      .filter(({ parsed, alreadyInCountsheet }) => {
        if (!parsed.itemCode && !parsed.itemDescription) return false;
        if (onlyShowUnselectedIatd && alreadyInCountsheet) return false;
        if (!missingIatdSearchQuery.trim()) return true;
        const q = missingIatdSearchQuery.trim().toLowerCase();
        return (
          parsed.itemCode.toLowerCase().includes(q) ||
          parsed.barcode.toLowerCase().includes(q) ||
          parsed.itemDescription.toLowerCase().includes(q) ||
          parsed.category.toLowerCase().includes(q)
        );
      })
      .slice(0, 40);

    return (
      <div className="p-4 sm:p-5 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/70 rounded-2xl space-y-4 shadow-2xs">
        {/* Top Header & Summary Badges */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 font-bold">
              <Edit3 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                  Pre-Generated Countsheet: {importedCountsheetSession.spreadsheetName}
                </h4>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
                  {countsheetItems.length} Items in Sequence
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200">
                  {countedCount}/{countsheetItems.length} Actuals Entered
                </span>
                {missingAddedCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
                    +{missingAddedCount} Missing Added
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Edit Balance &amp; Actual quantities, add missing inventory items, and preserve exact sequence into ENCODING columns.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {countsheetSaveMsg && (
              <span className="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/80 px-2 py-1 rounded-lg flex items-center gap-1">
                <Check className="w-3 h-3" />
                {countsheetSaveMsg}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setCountsheetItems((prev) =>
                  prev.map((it) => ({
                    ...it,
                    actual:
                      it.actual !== undefined && it.actual !== null && String(it.actual).trim() !== ''
                        ? it.actual
                        : it.balance,
                  }))
                );
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-zinc-700 text-[11px] font-bold transition cursor-pointer"
              title="Fill empty Actual fields with current Balance"
            >
              Fill Empty Actual = Balance
            </button>

            <button
              type="button"
              onClick={() => setShowAddMissingPanel((prev) => !prev)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 transition cursor-pointer ${
                showAddMissingPanel
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border border-amber-500/30'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddMissingPanel ? 'Hide Add Missing Item' : 'Add Missing Item'}</span>
            </button>

            <button
              type="button"
              onClick={handlePersistEditedCountsheetSession}
              disabled={isSavingEditsLoading}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all duration-200 cursor-pointer shadow-2xs select-none active:scale-95 ${
                isSaveEditsSuccess
                  ? 'bg-emerald-500 text-white shadow-md ring-2 ring-emerald-300 dark:ring-emerald-400/60 scale-105'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
              title="Save edited Balance, Actual, and sequence back to this countsheet session"
            >
              {isSavingEditsLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : isSaveEditsSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 stroke-[3] animate-in zoom-in-50 spin-in-45 duration-200" />
                  <span className="font-extrabold tracking-wide animate-in fade-in duration-200">Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Edits</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setImportedCountsheetSession(null);
                setCountsheetItems([]);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500 hover:text-white border border-rose-200 dark:border-rose-800/60 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
              title="Close Pre-Generated Countsheet and return to IATD selection"
            >
              <X className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Remove</span>
            </button>
          </div>
        </div>

        {/* Add Missing Inventory Item Panel */}
        {showAddMissingPanel && (
          <div className="p-3.5 bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-800/70 rounded-xl space-y-3 animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-zinc-800 pb-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAddMissingMode('IATD_SEARCH')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                    addMissingMode === 'IATD_SEARCH'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Search from IATD Master ({fullSourceIatdRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAddMissingMode('CUSTOM')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                    addMissingMode === 'CUSTOM'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Add Custom / Unlisted Item
                </button>
              </div>

              {/* Target Countsheet and Position Selection */}
              {(() => {
                const activeTargetCs =
                  (countsheetEditorCsFilter !== 'ALL' ? countsheetEditorCsFilter : newMissingCsCode) ||
                  availableCsCodes[0] ||
                  'CS01';

                return (
                  <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-700 dark:text-slate-300">Add to Countsheet:</span>
                      <CustomSelect
                        value={activeTargetCs}
                        onChange={(val) => {
                          setNewMissingCsCode(val);
                          if (countsheetEditorCsFilter !== 'ALL') {
                            setCountsheetEditorCsFilter(val);
                          }
                        }}
                        variant="compact"
                        menuMinWidth={140}
                        options={availableCsCodes.map((c) => {
                          const count = countsheetItems.filter((i) => (i.csCode || 'CS01') === c).length;
                          return {
                            value: c,
                            label: `${c} (${count} items)`,
                            badge: c === countsheetEditorCsFilter ? 'Active' : undefined,
                          };
                        })}
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-600 dark:text-slate-400">Position:</span>
                      <CustomSelect
                        value={insertPositionMode}
                        onChange={(val) => setInsertPositionMode(val as 'END' | 'START' | 'AFTER_SEQ')}
                        variant="compact"
                        menuMinWidth={180}
                        options={[
                          { value: 'END', label: `End of ${activeTargetCs}` },
                          { value: 'START', label: `Start of ${activeTargetCs}` },
                          { value: 'AFTER_SEQ', label: 'Insert After Seq #...' },
                        ]}
                      />
                      {insertPositionMode === 'AFTER_SEQ' && (
                        <input
                          type="number"
                          min={1}
                          max={Math.max(1, countsheetItems.length)}
                          value={insertAfterSeqNum}
                          onChange={(e) => setInsertAfterSeqNum(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          className="w-16 px-2 py-1 text-xs font-mono font-bold bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white text-center"
                        />
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {addMissingMode === 'IATD_SEARCH' ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <input
                      type="text"
                      placeholder="Search missing inventory item by Code, Barcode, Description, or Category..."
                      value={missingIatdSearchQuery}
                      onChange={(e) => setMissingIatdSearchQuery(e.target.value)}
                      className="w-full text-xs pl-7 pr-3 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyShowUnselectedIatd}
                      onChange={(e) => setOnlyShowUnselectedIatd(e.target.checked)}
                      className="rounded text-indigo-600 accent-indigo-600"
                    />
                    <span>Only show items missing from countsheet</span>
                  </label>
                </div>

                <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-xl">
                  {candidateIatdItems.length > 0 ? (
                    candidateIatdItems.map(({ parsed, alreadyInCountsheet }) => {
                      const activeTargetCs =
                        (countsheetEditorCsFilter !== 'ALL' ? countsheetEditorCsFilter : newMissingCsCode) ||
                        availableCsCodes[0] ||
                        'CS01';

                      return (
                        <div
                          key={`missing_cand_${parsed.id}`}
                          className="p-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-zinc-800/60"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                              <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                                {parsed.itemCode || 'NO-CODE'}
                              </span>
                              <span className="truncate">{parsed.itemDescription}</span>
                              {alreadyInCountsheet && (
                                <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-slate-300">
                                  In Countsheet
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                              <span>Cat: {parsed.category || '—'}</span>
                              <span>•</span>
                              <span>Unit: {parsed.unit}</span>
                              <span>•</span>
                              <span>Balance: <strong>{parsed.balance}</strong></span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              insertMissingItemAtConfiguredPosition({
                                ...parsed,
                                id: `missing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                csCode: activeTargetCs,
                                isMissingItem: true,
                              }, activeTargetCs);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add to {activeTargetCs}</span>
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-400">
                      {fullSourceIatdRows.length === 0
                        ? 'No source IATD rows loaded yet. You can switch to "Add Custom / Unlisted Item" above to add any item manually.'
                        : 'No matching missing items found in IATD.'}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Item Code</label>
                  <input
                    type="text"
                    placeholder="e.g. 100234"
                    value={customMissingItem.itemCode}
                    onChange={(e) => setCustomMissingItem((p) => ({ ...p, itemCode: e.target.value }))}
                    className="w-full text-xs px-2.5 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Item Description *</label>
                  <input
                    type="text"
                    placeholder="Enter item description"
                    value={customMissingItem.itemDescription}
                    onChange={(e) => setCustomMissingItem((p) => ({ ...p, itemDescription: e.target.value }))}
                    className="w-full text-xs px-2.5 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Category / Unit</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      placeholder="Category"
                      value={customMissingItem.category}
                      onChange={(e) => setCustomMissingItem((p) => ({ ...p, category: e.target.value }))}
                      className="w-2/3 text-xs px-2 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      placeholder="PCS"
                      value={customMissingItem.unit}
                      onChange={(e) => setCustomMissingItem((p) => ({ ...p, unit: e.target.value }))}
                      className="w-1/3 text-xs px-1.5 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white text-center"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Cost / Selling</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      placeholder="Cost"
                      value={customMissingItem.cost}
                      onChange={(e) => setCustomMissingItem((p) => ({ ...p, cost: e.target.value }))}
                      className="w-1/2 text-xs px-2 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="Sell"
                      value={customMissingItem.selling}
                      onChange={(e) => setCustomMissingItem((p) => ({ ...p, selling: e.target.value }))}
                      className="w-1/2 text-xs px-2 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Balance / Actual</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      placeholder="Bal"
                      value={customMissingItem.balance}
                      onChange={(e) => setCustomMissingItem((p) => ({ ...p, balance: e.target.value }))}
                      className="w-1/2 text-xs px-2 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="Act"
                      value={customMissingItem.actual}
                      onChange={(e) => setCustomMissingItem((p) => ({ ...p, actual: e.target.value }))}
                      className="w-1/2 text-xs px-2 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-6 flex justify-end pt-1">
                  <button
                    type="button"
                    disabled={!customMissingItem.itemDescription.trim() && !customMissingItem.itemCode.trim()}
                    onClick={() => {
                      const balNum = parseFloat(customMissingItem.balance) || 0;
                      const actNum =
                        customMissingItem.actual.trim() !== ''
                          ? parseFloat(customMissingItem.actual)
                          : null;
                      const activeTargetCs =
                        (countsheetEditorCsFilter !== 'ALL' ? countsheetEditorCsFilter : newMissingCsCode) ||
                        availableCsCodes[0] ||
                        'CS01';

                      insertMissingItemAtConfiguredPosition({
                        id: `custom_missing_${Date.now()}`,
                        itemCode: customMissingItem.itemCode.trim(),
                        barcode: customMissingItem.barcode.trim(),
                        itemDescription: customMissingItem.itemDescription.trim() || customMissingItem.itemCode.trim(),
                        category: customMissingItem.category.trim(),
                        subCategory: customMissingItem.subCategory.trim(),
                        subsubCategory: customMissingItem.subsubCategory.trim(),
                        unit: customMissingItem.unit.trim() || 'PCS',
                        cost: parseFloat(customMissingItem.cost) || 0,
                        selling: parseFloat(customMissingItem.selling) || 0,
                        balance: balNum,
                        actual: actNum !== null && !isNaN(actNum) ? actNum : null,
                        csCode: activeTargetCs,
                        isMissingItem: true,
                      }, activeTargetCs);
                      setCustomMissingItem({
                        itemCode: '',
                        barcode: '',
                        itemDescription: '',
                        category: '',
                        subCategory: '',
                        subsubCategory: '',
                        unit: 'PCS',
                        cost: '0',
                        selling: '0',
                        balance: '0',
                        actual: '',
                      });
                    }}
                    className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Insert Missing Item into {((countsheetEditorCsFilter !== 'ALL' ? countsheetEditorCsFilter : newMissingCsCode) || availableCsCodes[0] || 'CS01')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filter & Search Bar for Countsheet Sequence Table */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setCountsheetEditorCsFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition ${
                countsheetEditorCsFilter === 'ALL'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-zinc-700'
              }`}
            >
              All ({countsheetItems.length})
            </button>
            {Array.from(new Set(countsheetItems.map((i) => i.csCode || 'CS01')))
              .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
              .map((cs) => {
                const count = countsheetItems.filter((i) => (i.csCode || 'CS01') === cs).length;
                const isSelectedCs = countsheetEditorCsFilter === cs;
                return (
                  <div
                    key={`cs_tab_filter_${cs}`}
                    className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-xl text-[11px] font-mono font-bold transition shadow-2xs ${
                      isSelectedCs
                        ? 'bg-emerald-600 text-white border border-emerald-600'
                        : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-zinc-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setCountsheetEditorCsFilter(cs)}
                      className="cursor-pointer hover:opacity-90 transition py-0.5"
                    >
                      {cs} ({count})
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveCountsheetCsGroup(cs);
                      }}
                      title={`Remove ${cs} (${count} items)`}
                      aria-label={`Remove ${cs}`}
                      className={`w-5 h-5 rounded-md flex items-center justify-center cursor-pointer transition ${
                        isSelectedCs
                          ? 'bg-emerald-700/80 text-white hover:bg-rose-500 hover:text-white'
                          : 'bg-slate-100 dark:bg-zinc-700/80 text-slate-500 dark:text-slate-300 hover:bg-rose-500 hover:text-white dark:hover:bg-rose-600'
                      }`}
                    >
                      <X className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                  </div>
                );
              })}
          </div>

          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Filter items in sequence..."
              value={countsheetEditorSearch}
              onChange={(e) => setCountsheetEditorSearch(e.target.value)}
              className="w-full text-xs pl-7 pr-2.5 py-1 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <Search className="w-3.5 h-3.5 absolute left-2 top-1.5 text-slate-400" />
          </div>
        </div>

        {/* Ordered Countsheet Items Table */}
        <div className="border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900">
          <div className="max-h-96 sm:max-h-[420px] overflow-y-auto scrollbar-thin">
            <table className="w-full text-[11px] text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 font-bold border-b border-slate-200 dark:border-zinc-700">
                <tr>
                  <th className="py-2 px-2 w-14 text-center">Seq #</th>
                  <th className="py-2 px-2 w-20">CS Col</th>
                  <th className="py-2 px-2">Item Code</th>
                  <th className="py-2 px-2">Item Description</th>
                  <th className="py-2 px-2 hidden md:table-cell">Category</th>
                  <th className="py-2 px-2 w-14 text-center">Unit</th>
                  <th className="py-2 px-2 w-24 text-right">Balance</th>
                  <th className="py-2 px-2 w-24 text-right">Actual Qty</th>
                  <th className="py-2 px-2 w-20 text-right">Variance</th>
                  <th className="py-2 px-2 w-20 text-center">Sequence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/70">
                {filteredWithOriginalIndex.length > 0 ? (
                  filteredWithOriginalIndex.map(({ item, seqIdx }) => {
                    const hasActual =
                      item.actual !== undefined && item.actual !== null && String(item.actual).trim() !== '';
                    const variance = hasActual ? Number(item.actual) - Number(item.balance || 0) : null;

                    return (
                      <tr
                        key={`seq_row_${item.id || 'it'}_${seqIdx}`}
                        className={`hover:bg-slate-50/90 dark:hover:bg-zinc-800/50 transition-colors ${
                          item.isMissingItem ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
                        }`}
                      >
                        <td className="py-1.5 px-2 font-mono font-bold text-center text-slate-500 dark:text-slate-400">
                          #{seqIdx + 1}
                        </td>
                        <td className="py-1.5 px-2">
                          <CustomSelect
                            value={item.csCode || 'CS01'}
                            onChange={(val) => handleUpdateCountsheetItem(seqIdx, { csCode: val })}
                            variant="compact"
                            menuMinWidth={110}
                            options={availableCsCodes.map((c) => ({
                              value: c,
                              label: c,
                            }))}
                          />
                        </td>
                        <td className="py-1.5 px-2 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {item.itemCode || '—'}
                        </td>
                        <td className="py-1.5 px-2 text-slate-900 dark:text-white font-medium max-w-[220px] truncate">
                          <span>{item.itemDescription}</span>
                          {item.isMissingItem && (
                            <span className="ml-1.5 text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
                              Added Missing
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-slate-500 dark:text-slate-400 hidden md:table-cell truncate max-w-[120px]">
                          {item.category || '—'}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono text-slate-600 dark:text-slate-300">
                          {item.unit || 'PCS'}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            step="any"
                            value={item.balance ?? 0}
                            onChange={(e) => {
                              const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                              handleUpdateCountsheetItem(seqIdx, { balance: isNaN(val) ? 0 : val });
                            }}
                            className="w-20 text-right font-mono font-bold text-xs px-2 py-1 rounded-lg bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            step="any"
                            placeholder="—"
                            value={item.actual !== undefined && item.actual !== null ? item.actual : ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw.trim() === '') {
                                handleUpdateCountsheetItem(seqIdx, { actual: null });
                              } else {
                                const parsed = parseFloat(raw);
                                handleUpdateCountsheetItem(seqIdx, {
                                  actual: isNaN(parsed) ? null : parsed,
                                });
                              }
                            }}
                            className="w-20 text-right font-mono font-bold text-xs px-2 py-1 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold">
                          {variance === null ? (
                            <span className="text-slate-300 dark:text-zinc-600">—</span>
                          ) : variance === 0 ? (
                            <span className="text-emerald-600 dark:text-emerald-400">0</span>
                          ) : variance > 0 ? (
                            <span className="text-blue-600 dark:text-blue-400">+{variance}</span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400">{variance}</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              type="button"
                              disabled={seqIdx === 0}
                              onClick={() => handleMoveCountsheetItem(seqIdx, 'UP')}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-500 disabled:opacity-30 cursor-pointer"
                              title="Move up in sequence"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={seqIdx === countsheetItems.length - 1}
                              onClick={() => handleMoveCountsheetItem(seqIdx, 'DOWN')}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-500 disabled:opacity-30 cursor-pointer"
                              title="Move down in sequence"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveCountsheetItem(seqIdx)}
                              className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="Remove item from sequence"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="p-6 text-center text-xs text-slate-400">
                      No countsheet items match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 md:p-6 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200"
      style={{ overscrollBehavior: 'contain' }}
    >
      <div className="relative w-[92vw] h-[88dvh] sm:h-auto sm:w-full max-w-[90vw] xl:max-w-[1440px] 2xl:max-w-[1540px] bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col sm:max-h-[86dvh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200/90 dark:border-zinc-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
                <span>Create Encoding</span>
                {initialCountsheetType === 'random' ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 border border-emerald-200/80 dark:border-emerald-800/40">
                    Random Inventory Countsheet (CS01-CS20)
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-semibold">
                    IATD &rarr; ENCODING
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {initialCountsheetType === 'random'
                  ? 'Configure Random Inventory Countsheet & map IATD data into your ENCODING template.'
                  : 'Map Row 2 headers & transfer data from IATD into your ENCODING template (formulas protected).'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isGoogleConnected && (
              <button
                type="button"
                onClick={() => {
                  setStep('SOURCE_IATD');
                  setImportedCountsheetSession(null);
                  setShowCountsheetImportPicker(false);
                  setSourceViewMode((prev) => (prev === 'EMAIL' ? 'DRIVE' : 'EMAIL'));
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                  step === 'SOURCE_IATD' && sourceViewMode === 'EMAIL'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500'
                }`}
                title="View emailed spreadsheets from branches and convert to Google Sheets"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Email</span>
                {emailMessages.length > 0 && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
                      step === 'SOURCE_IATD' && sourceViewMode === 'EMAIL'
                        ? 'bg-white/20 text-white'
                        : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                    }`}
                  >
                    {emailMessages.length}
                  </span>
                )}
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Step Indicator Bar */}
        {isGoogleConnected && (
          <div className="grid grid-cols-3 border-b border-slate-200 dark:border-zinc-800 bg-slate-100/60 dark:bg-zinc-900/30 text-xs font-semibold">
            <div
              className={`py-2 px-3 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                step === 'SOURCE_IATD'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-bold bg-white dark:bg-zinc-800'
                  : 'border-transparent text-slate-500 dark:text-zinc-500'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-zinc-700 flex items-center justify-center text-[10px]">1</span>
              <span>Select IATD</span>
            </div>
            <div
              className={`py-2 px-3 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                step === 'TARGET_TEMPLATE'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-bold bg-white dark:bg-zinc-800'
                  : 'border-transparent text-slate-500 dark:text-zinc-500'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-zinc-700 flex items-center justify-center text-[10px]">2</span>
              <span>Audit Template</span>
            </div>
            <div
              className={`py-2 px-3 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                step === 'MAP_HEADERS' || step === 'SUCCESS'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-bold bg-white dark:bg-zinc-800'
                  : 'border-transparent text-slate-500 dark:text-zinc-500'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-zinc-700 flex items-center justify-center text-[10px]">3</span>
              <span>Map &amp; Generate</span>
            </div>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {!isGoogleConnected ? (
            <div className="max-w-md mx-auto py-14 px-4 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  Google Account Not Connected
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Create Encoding requires a linked Google account to access your IATD spreadsheets from Google Drive or Gmail and generate Audit Encoding sheets.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                {onConnectGoogle && (
                  <button
                    type="button"
                    onClick={onConnectGoogle}
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition shadow-sm cursor-pointer active:scale-95"
                  >
                    Connect Google Account
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 font-semibold text-xs transition cursor-pointer active:scale-95"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
          {/* STEP 1: SELECT IATD SPREADSHEET */}
          {step === 'SOURCE_IATD' && (
            <div className="space-y-4 w-full max-w-5xl mx-auto animate-in fade-in">
              {importedCountsheetSession && renderPreGeneratedCountsheetEditor()}

              {!importedCountsheetSession && !showCountsheetImportPicker && (
                <>
                  {/* Recent Generated Audit Reports Section with Horizontal Import Button */}
                  <div className="p-3.5 bg-gradient-to-r from-indigo-500/10 via-indigo-500/5 to-transparent dark:from-indigo-950/30 dark:via-indigo-950/10 dark:to-transparent border border-indigo-500/20 rounded-2xl space-y-2.5 shadow-2xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                          <span>Recent</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-bold">
                            {recentReports.length}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setShowCountsheetImportPicker(true)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 shadow-xs transition cursor-pointer shrink-0 active:scale-95"
                          title="Use the IATD and selected items from a recent countsheet session"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Import Countsheet Items</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleSyncCloudRecents}
                          disabled={isSyncingRecents}
                          className="text-[10.5px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 px-2 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                          title="Sync recent reports from your cloud account"
                        >
                          <RefreshCw className={`w-3 h-3 ${isSyncingRecents ? 'animate-spin' : ''}`} />
                          <span>{isSyncingRecents ? 'Syncing...' : 'Sync'}</span>
                        </button>

                        {recentReports.length > 1 && (
                          confirmClearReports ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  clearRecentAuditReports();
                                  setRecentReports([]);
                                  setConfirmClearReports(false);
                                }}
                                className="text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-500 px-2 py-1 rounded-lg transition cursor-pointer"
                              >
                                Confirm Clear
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmClearReports(false)}
                                className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 px-1.5 py-1 rounded-lg transition cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmClearReports(true)}
                              className="text-[10px] font-semibold text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 px-2 py-1 rounded-lg hover:bg-rose-500/10 transition cursor-pointer"
                            >
                              Clear all
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    {/* Filter inside recents if more than 3 */}
                    {recentReports.length > 3 && (
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search recent reports..."
                          value={recentReportFilter}
                          onChange={(e) => setRecentReportFilter(e.target.value)}
                          className="w-full text-[11px] pl-7 pr-2 py-1 bg-white/80 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
                      </div>
                    )}

                    {/* Scrollable Recents List */}
                    {recentReports.length > 0 && (
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-thin">
                        {recentReports
                          .filter((r) =>
                            recentReportFilter
                              ? r.spreadsheetName.toLowerCase().includes(recentReportFilter.toLowerCase()) ||
                                (r.iatdTitle && r.iatdTitle.toLowerCase().includes(recentReportFilter.toLowerCase()))
                              : true
                          )
                          .map((report, rIdx) => {
                            const dateStr = new Date(report.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            });

                            return (
                              <div
                                key={`${report.id || 'rep'}_${report.spreadsheetId || ''}_${rIdx}`}
                                onClick={(e) => handleEditRecentReport(report, e)}
                                className="p-2.5 bg-white dark:bg-zinc-800/90 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30 border border-slate-200/90 dark:border-zinc-700/80 hover:border-indigo-300 rounded-xl transition cursor-pointer flex items-center justify-between gap-2 group shadow-2xs"
                                title="Click to edit this generated Encoding in Step 2 (Audit Template)"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span className="truncate">{report.spreadsheetName}</span>
                                  </div>

                                  <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 flex-wrap">
                                    <span className="font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.2 rounded">
                                      {report.totalRows.toLocaleString()} items
                                    </span>
                                    {report.countsheetCount && (
                                      <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 px-1.5 py-0.2 rounded">
                                        {report.countsheetCount} CS
                                      </span>
                                    )}
                                    <span>•</span>
                                    <span>{dateStr}</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => handleEditRecentReport(report, e)}
                                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10.5px] font-bold rounded-lg flex items-center gap-1 shadow-2xs active:scale-95 transition cursor-pointer"
                                    title="Edit this generated Encoding in Step 2 (Audit Template)"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    <span>Edit</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => handleSelectRecentReport(report, e)}
                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-slate-700 dark:text-slate-200 text-[10.5px] font-semibold rounded-lg flex items-center gap-1 active:scale-95 transition cursor-pointer"
                                    title="View link & share options"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>View</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteRecentReport(e, report.id)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
                                    title="Remove from recents list"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  {/* Paste IATD Spreadsheet Link & IATD Header Row in one horizontal row */}
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    {/* Paste IATD Spreadsheet Link or ID */}
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Paste IATD Spreadsheet Link or ID
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="https://docs.google.com/spreadsheets/d/... or Spreadsheet ID"
                          value={iatdInputId}
                          onChange={(e) => setIatdInputId(e.target.value)}
                          className="flex-1 min-w-0 text-xs px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button
                          onClick={() => handleInspectIatd(iatdInputId, selectedIatdTab, iatdHeaderRow)}
                          disabled={!iatdInputId.trim() || isLoadingIatd}
                          className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 cursor-pointer shrink-0"
                        >
                          {isLoadingIatd ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Search className="w-3.5 h-3.5" />
                          )}
                          <span>Inspect</span>
                        </button>
                      </div>
                    </div>

                    {/* Header Row Number Selector */}
                    <div className="shrink-0">
                      <div className="flex items-center justify-end mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300">
                          {iatdHeaderRow === 2 ? 'Default' : `Row ${iatdHeaderRow}`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2.5 px-3 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs">
                        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          Header Row
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={iatdHeaderRow}
                          onChange={(e) => {
                            const parsed = parseInt(e.target.value, 10);
                            const nextRow = isNaN(parsed) ? 2 : Math.max(1, Math.min(30, parsed));
                            setIatdHeaderRow(nextRow);
                            const targetId = iatdInspection?.spreadsheetId || iatdInputId;
                            if (targetId) {
                              handleInspectIatd(targetId, selectedIatdTab, nextRow);
                            }
                          }}
                          className="w-16 text-center font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                  </div>

                  {iatdError && (
                    <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                        <span className="flex-1">{iatdError}</span>
                      </div>
                    </div>
                  )}

                  {/* Source Switcher: Google Drive vs Email (Branch Spreadsheets) */}
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-2.5 gap-2">
                      <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-zinc-800/90 p-1 rounded-xl border border-slate-200/80 dark:border-zinc-700/80">
                        <button
                          type="button"
                          onClick={() => setSourceViewMode('DRIVE')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                            sourceViewMode === 'DRIVE'
                              ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Google Drive ({driveFiles.length})</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSourceViewMode('EMAIL')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                            sourceViewMode === 'EMAIL'
                              ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <Mail className="w-3.5 h-3.5" />
                          <span>Email (Branch Spreadsheets)</span>
                          {emailMessages.length > 0 && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold">
                              {emailMessages.length}
                            </span>
                          )}
                        </button>
                      </div>

                      {sourceViewMode === 'DRIVE' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleRefreshDrive}
                            disabled={isSearchingDrive}
                            className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Refresh Google Drive files"
                          >
                            <RefreshCw className={`w-3 h-3 ${isSearchingDrive ? 'animate-spin' : ''}`} />
                            <span>Refresh</span>
                          </button>
                          <div className="relative w-44 sm:w-52">
                            <input
                              type="text"
                              placeholder="Search Drive..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full text-[11px] pl-6 pr-2 py-1 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <Search className="w-3 h-3 absolute left-2 top-2 text-slate-400" />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleRefreshEmails()}
                            disabled={isSearchingEmail}
                            className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Search Gmail for emailed spreadsheets from branches"
                          >
                            <RefreshCw className={`w-3 h-3 ${isSearchingEmail ? 'animate-spin' : ''}`} />
                            <span>Refresh Inbox</span>
                          </button>
                          <div className="relative w-48 sm:w-60">
                            <input
                              type="text"
                              placeholder="Search branch, subject, sender..."
                              value={emailQuery}
                              onChange={(e) => setEmailQuery(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleRefreshEmails();
                                }
                              }}
                              className="w-full text-[11px] pl-6 pr-12 py-1 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <Search className="w-3 h-3 absolute left-2 top-2 text-slate-400" />
                            <button
                              type="button"
                              onClick={() => handleRefreshEmails()}
                              className="absolute right-1 top-1 px-1.5 py-0.5 text-[10px] font-bold bg-indigo-600 text-white rounded hover:bg-indigo-500 cursor-pointer"
                            >
                              Find
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {emailConversionToast && (
                      <div className="mb-2.5 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                        <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>{emailConversionToast}</span>
                      </div>
                    )}

                    {sourceViewMode === 'DRIVE' ? (
                      <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/40">
                        {isSearchingDrive ? (
                          <div className="p-6 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
                            <span>Searching your Google Drive spreadsheets...</span>
                          </div>
                        ) : driveFiles.length > 0 ? (
                          driveFiles.map((file) => {
                            const isSelected = iatdInspection?.spreadsheetId === file.id;
                            const isExcel =
                              file.name?.toLowerCase().endsWith('.xlsx') ||
                              file.name?.toLowerCase().endsWith('.xls') ||
                              file.name?.toLowerCase().endsWith('.csv') ||
                              Boolean(file.mimeType && file.mimeType !== 'application/vnd.google-apps.spreadsheet');
                            const isConvertingThisDrive = convertingAttachmentKey === `drive_${file.id}`;
                            return (
                              <div
                                key={file.id}
                                onClick={() => handleInspectIatd(file.id, selectedIatdTab, iatdHeaderRow, undefined, file)}
                                className={`p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-zinc-800/60 cursor-pointer transition ${
                                  isSelected ? 'bg-indigo-50/60 dark:bg-indigo-950/30 border-l-4 border-indigo-600' : ''
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5 flex-wrap">
                                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span className="truncate">{file.name}</span>
                                    {isExcel && (
                                      <span className="text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 shrink-0">
                                        Excel / CSV
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                    Owner: {file.owner || 'You'} &bull; ID: {file.id}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isExcel && (
                                    <button
                                      type="button"
                                      onClick={(e) => handleConvertDriveExcelFile(file, e)}
                                      disabled={isConvertingThisDrive}
                                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold flex items-center gap-1 shadow-2xs transition cursor-pointer disabled:opacity-50"
                                      title="Convert this Excel/CSV file into a native Google Sheets file"
                                    >
                                      {isConvertingThisDrive ? (
                                        <>
                                          <RefreshCw className="w-3 h-3 animate-spin" />
                                          <span>Converting...</span>
                                        </>
                                      ) : (
                                        <>
                                          <ArrowRightLeft className="w-3 h-3" />
                                          <span>Convert to Google Sheets</span>
                                        </>
                                      )}
                                    </button>
                                  )}
                                  {isSelected ? (
                                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950/50 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3" /> Selected
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-700 shrink-0"
                                    >
                                      Choose &rarr;
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        ) : driveSearchError ? (
                          <div className="p-5 text-center text-xs text-rose-600 dark:text-rose-400 space-y-2.5">
                            <p className="font-semibold">{driveSearchError}</p>
                            <div className="flex items-center justify-center gap-2">
                              {(isAuthErrorMessage(driveSearchError) || !isGoogleConnected) ? (
                                <button
                                  type="button"
                                  onClick={handleRefreshGoogleAccess}
                                  disabled={isRefreshingToken}
                                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingToken ? 'animate-spin' : ''}`} />
                                  <span>{isRefreshingToken ? 'Refreshing Access...' : 'Refresh Google Access'}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={handleRefreshDrive}
                                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  <span>Retry Drive Search</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="p-6 text-center text-xs text-slate-400 dark:text-zinc-500 space-y-1">
                            <p>{searchQuery ? `No spreadsheets found matching "${searchQuery}".` : 'No spreadsheets found in your Google Drive.'}</p>
                            <p className="text-[11px] text-slate-400">You can paste the spreadsheet link or ID above.</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* EMAIL (BRANCH SPREADSHEETS) VIEW */
                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/40">
                        {isSearchingEmail ? (
                          <div className="p-6 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
                            <span>Scanning Gmail for emailed spreadsheets from branches (.xlsx, .xls, .csv, Google Sheets)...</span>
                          </div>
                        ) : emailSearchError ? (
                          <div className="p-5 text-center text-xs text-rose-600 dark:text-rose-400 space-y-2.5">
                            <p className="font-semibold">{emailSearchError}</p>
                            <div className="flex items-center justify-center gap-2 flex-wrap">
                              {emailNeedsScopeConsent || isAuthErrorMessage(emailSearchError) || !isGoogleConnected ? (
                                <button
                                  type="button"
                                  onClick={handleAuthorizeGmailScope}
                                  disabled={isRefreshingToken}
                                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                                >
                                  <Mail className={`w-3.5 h-3.5 ${isRefreshingToken ? 'animate-spin' : ''}`} />
                                  <span>{isRefreshingToken ? 'Authorizing Gmail...' : 'Connect Gmail Inbox'}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleRefreshEmails()}
                                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  <span>Retry Email Search</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ) : emailMessages.length > 0 ? (
                          emailMessages.map((msg) => {
                            const formattedDate = msg.date
                              ? new Date(msg.date).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '';

                            return (
                              <div
                                key={msg.messageId}
                                className="p-3 hover:bg-slate-50/80 dark:hover:bg-zinc-800/50 transition space-y-2"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                      <Inbox className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                      <span className="truncate">{msg.subject}</span>
                                    </div>
                                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                      From: <strong className="text-slate-700 dark:text-slate-300">{msg.fromName || msg.fromEmail}</strong>
                                      {formattedDate && ` • ${formattedDate}`}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300 shrink-0">
                                    {msg.attachments.length > 0
                                      ? `${msg.attachments.length} file${msg.attachments.length > 1 ? 's' : ''}`
                                      : `${msg.sharedSheetLinks.length} link${msg.sharedSheetLinks.length > 1 ? 's' : ''}`}
                                  </span>
                                </div>

                                {/* Spreadsheet Attachments List */}
                                {msg.attachments.length > 0 && (
                                  <div className="space-y-1.5 pl-2 border-l-2 border-indigo-200 dark:border-indigo-900/60">
                                    {msg.attachments.map((att) => {
                                      const attKey = `${msg.messageId}:${att.filename}`;
                                      const existingConverted = convertedSheetsMap[attKey];
                                      const isConverting = convertingAttachmentKey === attKey;
                                      const isLoaded =
                                        existingConverted &&
                                        iatdInspection?.spreadsheetId === existingConverted.spreadsheetId;
                                      const sizeKb = att.size ? `${Math.max(1, Math.round(att.size / 1024))} KB` : '';

                                      return (
                                        <div
                                          key={att.attachmentId || att.filename}
                                          className="p-2 rounded-xl bg-slate-50 dark:bg-zinc-800/80 border border-slate-200/80 dark:border-zinc-700/80 flex flex-wrap items-center justify-between gap-2"
                                        >
                                          <div className="flex items-center gap-2 min-w-0">
                                            <Paperclip className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            <div className="min-w-0">
                                              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                                                <span className="truncate">{att.filename}</span>
                                                <span className="text-[9.5px] uppercase font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/70 dark:border-amber-800">
                                                  {att.filename.split('.').pop() || 'XLSX'}
                                                </span>
                                                {existingConverted && (
                                                  <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center gap-0.5">
                                                    <Check className="w-2.5 h-2.5" /> Google Sheets Compatible
                                                  </span>
                                                )}
                                              </div>
                                              {sizeKb && (
                                                <div className="text-[10px] text-slate-400">
                                                  Attachment size: {sizeKb}
                                                  {existingConverted && ` • Sheet ID: ${existingConverted.spreadsheetId.slice(0, 12)}...`}
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-1.5 shrink-0">
                                            {existingConverted ? (
                                              <>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleInspectIatd(
                                                      existingConverted.spreadsheetId,
                                                      selectedIatdTab,
                                                      iatdHeaderRow
                                                    )
                                                  }
                                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer ${
                                                    isLoaded
                                                      ? 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800'
                                                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-2xs'
                                                  }`}
                                                >
                                                  {isLoaded ? (
                                                    <>
                                                      <CheckCircle2 className="w-3 h-3" />
                                                      <span>Loaded</span>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <FileSpreadsheet className="w-3 h-3" />
                                                      <span>Use Converted Sheet</span>
                                                    </>
                                                  )}
                                                </button>
                                                <a
                                                  href={existingConverted.webViewLink}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200/60 dark:hover:bg-zinc-700 transition"
                                                  title="Open converted Google Sheet in new tab"
                                                >
                                                  <ExternalLink className="w-3.5 h-3.5" />
                                                </a>
                                                <button
                                                  type="button"
                                                  onClick={() => handleConvertEmailAttachment(msg, att, true)}
                                                  disabled={isConverting}
                                                  className="text-[10px] font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-1.5 py-1 rounded hover:bg-slate-200/50 dark:hover:bg-zinc-700 cursor-pointer"
                                                  title="Re-convert a fresh copy to Google Sheets"
                                                >
                                                  {isConverting ? '...' : 'Re-convert'}
                                                </button>
                                              </>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => handleConvertEmailAttachment(msg, att, true)}
                                                disabled={isConverting}
                                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1.5 shadow-2xs active:scale-95 transition cursor-pointer disabled:opacity-50"
                                                title="Convert this branch spreadsheet attachment to Google Sheets compatible format and load it"
                                              >
                                                {isConverting ? (
                                                  <>
                                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                    <span>Converting to Google Sheets...</span>
                                                  </>
                                                ) : (
                                                  <>
                                                    <ArrowRightLeft className="w-3.5 h-3.5" />
                                                    <span>Convert to Google Sheets &amp; Use</span>
                                                  </>
                                                )}
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Shared Google Sheet Links found inside Email Body */}
                                {msg.sharedSheetLinks.length > 0 && (
                                  <div className="space-y-1 pl-2 border-l-2 border-emerald-200 dark:border-emerald-900/60">
                                    {msg.sharedSheetLinks.map((link) => {
                                      const isSelected = iatdInspection?.spreadsheetId === link.spreadsheetId;
                                      return (
                                        <div
                                          key={link.spreadsheetId}
                                          className="p-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-900/50 flex items-center justify-between gap-2"
                                        >
                                          <div className="flex items-center gap-2 min-w-0 text-xs">
                                            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                                              {link.label}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => handleInspectIatd(link.spreadsheetId, selectedIatdTab, iatdHeaderRow)}
                                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                                          >
                                            {isSelected ? 'Selected' : 'Load Sheet →'}
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="p-6 text-center text-xs text-slate-400 dark:text-zinc-500 space-y-1.5">
                            <Mail className="w-5 h-5 mx-auto text-slate-300 dark:text-zinc-600" />
                            <p className="font-semibold text-slate-600 dark:text-slate-300">
                              {emailQuery
                                ? `No emailed spreadsheets found matching "${emailQuery}".`
                                : 'No emailed spreadsheets (.xlsx, .xls, .csv) found in recent emails.'}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              Try searching by branch name or sender email above, or click Refresh Inbox.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* IATD Inspection Result Preview */}
                  {iatdInspection && (
                    <div className="p-3.5 bg-slate-50 dark:bg-zinc-800/80 rounded-2xl border border-slate-200 dark:border-zinc-700 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Loaded IATD File
                          </span>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {iatdInspection.spreadsheetTitle}
                          </h4>
                        </div>

                        {iatdTabs.length > 1 && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-500 font-semibold">Tab:</span>
                            <CustomSelect
                              value={selectedIatdTab}
                              onChange={(val) => {
                                setSelectedIatdTab(val);
                                handleInspectIatd(iatdInspection.spreadsheetId, val, iatdHeaderRow);
                              }}
                              variant="compact"
                              menuMinWidth={180}
                              options={iatdTabs.map((t) => ({
                                value: t.title,
                                label: t.title,
                              }))}
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                        <span className="font-semibold">
                          Row {iatdHeaderRow} Headers: <strong className="text-indigo-600 dark:text-indigo-400">{iatdInspection.headers.length} columns</strong>
                        </span>
                        <span>•</span>
                        <span className="font-semibold">
                          Data Rows: <strong className="text-emerald-600 dark:text-emerald-400">{iatdInspection.totalRows.toLocaleString()} rows</strong> (Row {iatdHeaderRow + 1} to end)
                        </span>
                      </div>

                      {/* Header tags chips */}
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-1">
                        {iatdInspection.headers.map((h, i) => (
                          <span
                            key={`iatd_head_tag_${i}_${h}`}
                            className="text-[10px] font-mono bg-white dark:bg-zinc-700 border border-slate-200 dark:border-zinc-600 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-200"
                          >
                            {h || `Col ${i + 1}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 2: SELECT AUDIT TEMPLATE SPREADSHEET */}
          {step === 'TARGET_TEMPLATE' && (
            <div className="space-y-4 w-full max-w-5xl mx-auto animate-in fade-in">
              {editingRecentReport && (
                <div className="p-3.5 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/70 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                      <Edit3 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
                        <span>Editing Recent Generated Encoding</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-bold">
                          Step 2 • Audit Template
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                        Adjust report title, Countsheets Setup (updates ENCODING &amp; MONITORING rows), or template settings below.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateAsCopy(false);
                        setTemplateInputId(editingRecentReport.spreadsheetId);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                        !createAsCopy
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-zinc-700'
                      }`}
                    >
                      Update Existing Sheet
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateAsCopy(true)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                        createAsCopy
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-zinc-700'
                      }`}
                    >
                      Save as New Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Admin Encoding Template Selector (Overall Count Template & Cessation Overall Count Template in icdhubsystems@gmail.com) */}
              <div className="p-3.5 bg-indigo-50/60 dark:bg-indigo-950/25 border border-indigo-200/80 dark:border-indigo-800/60 rounded-2xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Select Admin Encoding Template ({HUB_OWNER_EMAIL})</span>
                  </span>
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/60">
                    IATD from Your Drive/Email &rarr; Template from {HUB_OWNER_EMAIL}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(
                    [
                      {
                        type: 'OVERALL COUNT TEMPLATE' as const,
                        label: 'Overall Count Template',
                        desc: 'Standard branch overall inventory audit encoding template',
                      },
                      {
                        type: 'CESSATION OVERALL COUNT TEMPLATE' as const,
                        label: 'Cessation Overall Count Template',
                        desc: 'Cessation / closing overall inventory audit encoding template',
                      },
                    ]
                  ).map((opt) => {
                    const isActiveType = selectedTemplateType === opt.type;
                    return (
                      <button
                        key={opt.type}
                        type="button"
                        onClick={() => handleSelectTemplateType(opt.type)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-center justify-between gap-2 ${
                          isActiveType
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500 text-slate-800 dark:text-slate-100'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate flex items-center gap-1.5">
                            <FileSpreadsheet
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isActiveType ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'
                              }`}
                            />
                            <span className="truncate">{opt.label}</span>
                          </div>
                          <div
                            className={`text-[10px] truncate mt-0.5 ${
                              isActiveType ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {opt.desc}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                            isActiveType
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {isActiveType ? 'Selected' : 'Use'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Display matching Drive template file if found */}
              {isSearchingTemplates ? (
                <div className="p-4 text-center text-xs text-slate-400 space-y-1.5 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl border border-slate-200 dark:border-zinc-800">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto text-indigo-500" />
                  <p>Searching Google Drive for audit templates...</p>
                </div>
              ) : matchingTemplateFiles.length > 0 ? (
                <div className="p-3 bg-slate-50 dark:bg-zinc-800/80 rounded-2xl border border-slate-200 dark:border-zinc-700 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Template Source: TEMPLATE / ENCODING ({HUB_OWNER_EMAIL})</span>
                    </span>
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/60">
                      Zero-Popup Cached • Saves to your Drive: {GENERATED_ENCODING_FOLDER_NAME}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {matchingTemplateFiles.map((file) => {
                      const isSelected = templateInspection?.spreadsheetId === file.id;
                      return (
                        <div
                          key={file.id}
                          onClick={() => {
                            if (/cessation/i.test(file.name)) {
                              setSelectedTemplateType('CESSATION OVERALL COUNT TEMPLATE');
                            } else if (/overall\s*count/i.test(file.name)) {
                              setSelectedTemplateType('OVERALL COUNT TEMPLATE');
                            }
                            handleInspectTemplate(file.id, selectedTemplateTab, templateHeaderRow);
                          }}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition ${
                            isSelected
                              ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-600 text-indigo-900 dark:text-indigo-100 font-bold'
                              : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs truncate flex items-center gap-1.5">
                              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span className="truncate">{file.name}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-normal">Owner: {file.owner || 'You'}</div>
                          </div>

                          {isSelected ? (
                            <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/60 px-2 py-0.5 rounded-full shrink-0">
                              Active Template
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-[10.5px] font-bold text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                            >
                              Select &rarr;
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Paste Template URL or ID directly */}
              <div className="p-3 bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-2xl space-y-2">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Or Paste Template Spreadsheet URL / ID:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={templateInputId}
                    onChange={(e) => setTemplateInputId(e.target.value)}
                    placeholder="Paste ENCODING template Google Sheet URL or ID..."
                    className="flex-1 text-xs px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    disabled={!templateInputId.trim() || isLoadingTemplate}
                    onClick={() => handleInspectTemplate(templateInputId.trim(), undefined, templateHeaderRow)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {isLoadingTemplate ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileCheck className="w-3.5 h-3.5" />
                    )}
                    <span>Load Template</span>
                  </button>
                </div>
              </div>

              {templateError && (
                <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-200 text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <span className="flex-1">{templateError}</span>
                  </div>
                </div>
              )}

              {/* Header Row Number Selector for Audit Template */}
              <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Audit Template Header Row:
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300">
                    {templateHeaderRow === 2 ? 'Row 2 (Default)' : `Row ${templateHeaderRow}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Row #
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={templateHeaderRow}
                    onChange={(e) => {
                      const parsed = parseInt(e.target.value, 10);
                      const nextRow = isNaN(parsed) ? 2 : Math.max(1, Math.min(30, parsed));
                      setTemplateHeaderRow(nextRow);
                      const targetId = templateInspection?.spreadsheetId || templateInputId;
                      if (targetId) {
                        handleInspectTemplate(targetId, selectedTemplateTab, nextRow);
                      }
                    }}
                    className="w-16 text-center font-mono font-bold text-xs px-2 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Explicit Spreadsheet Name / Report Title Input Box */}
              <div className="p-3.5 bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/50 rounded-2xl space-y-1.5 shadow-2xs">
                <label className="block text-xs font-bold text-slate-900 dark:text-white flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Spreadsheet Name / Report Title:</span>
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-900 dark:text-indigo-200 font-bold">
                    Editable Name
                  </span>
                </label>
                <input
                  type="text"
                  value={newCopyTitle}
                  onChange={(e) => setNewCopyTitle(e.target.value)}
                  placeholder="e.g. Branch Audit Encoding - 2026-10-06"
                  className="w-full text-xs font-bold px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                />
                <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                  Type any custom name for your generated Google Sheet report.
                </p>
              </div>

              {/* Minimalist Countsheets Setup Settings Card */}
              <div className="p-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xs hover:border-slate-300 dark:hover:border-zinc-700 transition-colors">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                  {/* LEFT SECTION: Icon + Title & Subtitle */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100/80 dark:border-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 shadow-2xs">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug truncate">
                        Countsheets Setup
                      </h4>
                      <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-snug truncate">
                        Total countsheets to generate (e.g. 100)
                      </p>
                    </div>
                  </div>

                  {/* CENTER & RIGHT SECTION: Controls Row */}
                  <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto justify-end pt-1 sm:pt-0">
                    {/* CENTER SECTION: Compact Numeric Input with Up/Down Stepper */}
                    <div className={`flex items-center transition-opacity ${enableCountsheetCols ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                      <div className="relative flex items-center bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl overflow-hidden shadow-2xs focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                        <input
                          type="number"
                          min="1"
                          max="200"
                          disabled={!enableCountsheetCols}
                          value={countsheetCount}
                          onChange={(e) => setCountsheetCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          className="w-16 sm:w-20 text-center font-mono font-bold text-xs sm:text-sm py-1.5 pl-2 pr-1 text-slate-900 dark:text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none bg-transparent"
                        />
                        {/* Subtle Up/Down Stepper Controls */}
                        <div className="flex flex-col border-l border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/80">
                          <button
                            type="button"
                            disabled={!enableCountsheetCols || countsheetCount >= 200}
                            onClick={() => setCountsheetCount((prev) => Math.min(200, prev + 1))}
                            className="px-1.5 py-0.5 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-slate-300 transition text-[8px] leading-none cursor-pointer border-b border-slate-200 dark:border-zinc-700"
                            title="Increase total countsheets"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            disabled={!enableCountsheetCols || countsheetCount <= 1}
                            onClick={() => setCountsheetCount((prev) => Math.max(1, prev - 1))}
                            className="px-1.5 py-0.5 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-slate-300 transition text-[8px] leading-none cursor-pointer"
                            title="Decrease total countsheets"
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT SECTION: Vertical Divider */}
                    <div className="h-7 w-px bg-slate-200 dark:bg-zinc-800 shrink-0" />

                    {/* RIGHT SECTION: Purple Checkbox + Label */}
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-slate-800 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition shrink-0">
                      <input
                        type="checkbox"
                        checked={enableCountsheetCols}
                        onChange={(e) => setEnableCountsheetCols(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-zinc-600 dark:bg-zinc-800 cursor-pointer accent-indigo-600"
                      />
                      <span className="whitespace-nowrap">Generate in Sheet</span>
                    </label>
                  </div>
                </div>

                {/* Live MONITORING Tab Row 6 Preview (e.g. 1-5 .. 21-25 + 3 blank buffer rows) */}
                {enableCountsheetCols && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                    <span className="font-semibold">
                      MONITORING Tab (Row 6 <strong className="text-slate-800 dark:text-slate-200">Countsheet No.</strong>):
                    </span>
                    <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
                      {(() => {
                        const numRanges = Math.max(1, Math.ceil(countsheetCount / 5));
                        const previewRanges: string[] = [];
                        for (let i = 0; i < Math.min(numRanges, 6); i++) {
                          previewRanges.push(`${i * 5 + 1}-${(i + 1) * 5}`);
                        }
                        const lastStart = (numRanges - 1) * 5 + 1;
                        const lastEnd = numRanges * 5;
                        return (
                          <>
                            {previewRanges.map((r) => (
                              <span
                                key={`mon_prev_${r}`}
                                className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60 font-bold"
                              >
                                {r}
                              </span>
                            ))}
                            {numRanges > 6 && (
                              <>
                                <span className="text-slate-400">…</span>
                                <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60 font-bold">
                                  {lastStart}-{lastEnd}
                                </span>
                              </>
                            )}
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 font-bold">
                              + 3 blank buffer rows
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Template Inspection Preview */}
              {templateInspection && (
                <div className="p-3.5 bg-slate-50 dark:bg-zinc-800/80 rounded-2xl border border-slate-200 dark:border-zinc-700 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Loaded Template File
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {templateInspection.spreadsheetTitle}
                      </h4>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500 font-semibold">Target Tab:</span>
                      <CustomSelect
                        value={selectedTemplateTab}
                        onChange={(val) => {
                          setSelectedTemplateTab(val);
                          handleInspectTemplate(templateInspection.spreadsheetId, val, templateHeaderRow);
                        }}
                        variant="compact"
                        menuMinWidth={180}
                        options={templateTabs.map((t) => ({
                          value: t.title,
                          label: t.title,
                        }))}
                      />
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-600 dark:text-slate-300 font-semibold">
                    Row {templateHeaderRow} Template Headers: <strong className="text-indigo-600 dark:text-indigo-400">{templateInspection.headers.length} columns</strong>
                  </div>

                  {/* Template header chips */}
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {templateInspection.headers.map((h, i) => (
                      <span
                        key={`tmpl_head_tag_${i}_${h}`}
                        className="text-[10px] font-mono bg-white dark:bg-zinc-700 border border-slate-200 dark:border-zinc-600 px-1.5 py-0.5 rounded text-indigo-700 dark:text-indigo-300 font-bold"
                      >
                        {h || `Col ${i + 1}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: HEADER MAPPING & DATA PREVIEW */}
          {step === 'MAP_HEADERS' && (
            <div className="space-y-4 w-full max-w-5xl mx-auto animate-in fade-in">
              {/* Spreadsheet Name Confirmation Input Box */}
              <div className="p-3 bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-2xs">
                <label className="font-bold text-slate-900 dark:text-white shrink-0 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Spreadsheet Report Name:</span>
                </label>
                <input
                  type="text"
                  value={newCopyTitle}
                  onChange={(e) => setNewCopyTitle(e.target.value)}
                  placeholder="e.g. Branch Audit Encoding - 2026-10-06"
                  className="flex-1 text-xs px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-xl text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {isLoadingAllIatd ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-500" />
                  <p>Loading {iatdInspection?.totalRows || 0} rows from IATD spreadsheet...</p>
                </div>
              ) : (
                <>
                  {/* Pre-Generated Countsheet Interactive Sequence, Balance & Actual Editor */}
                  {importedCountsheetSession && renderPreGeneratedCountsheetEditor()}

                  {/* Column Mapping Controls */}
                  {templateInspection && iatdInspection && (
                    <div className="p-3.5 bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-2xl space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ArrowRightLeft className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            ENCODING Template Column Mapping
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleAutoMap}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold hover:bg-indigo-100 transition cursor-pointer"
                        >
                          Auto-Map Columns
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1 scrollbar-thin">
                        {templateInspection.headers
                          .filter((h) => h && !/^CS\d+$/i.test(h.trim()))
                          .map((encHeader, idx) => (
                            <div
                              key={`map_ctrl_${idx}_${encHeader}`}
                              className="p-2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl flex flex-col gap-1"
                            >
                              <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 truncate" title={encHeader}>
                                {encHeader}
                              </span>
                              <CustomSelect
                                value={mapping[encHeader] || ''}
                                onChange={(val) =>
                                  setMapping((prev) => ({
                                    ...prev,
                                    [encHeader]: val || null,
                                  }))
                                }
                                variant="compact"
                                className="w-full"
                                menuMinWidth={210}
                                options={[
                                  {
                                    value: '',
                                    label: '(Formula / Leave Blank)',
                                    dotColor: 'bg-slate-300 dark:bg-zinc-600',
                                  },
                                  ...iatdInspection.headers.map((iatdH) => ({
                                    value: iatdH,
                                    label: iatdH,
                                    dotColor: 'bg-indigo-500',
                                  })),
                                ]}
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Live Sample Preview Table */}
                  {iatdAllRows.length > 0 && templateInspection && (
                    <div className="border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
                      <div className="bg-slate-100 dark:bg-zinc-800 px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                        <span>Preview Mapped Output (First 5 Data Rows in Sequence)</span>
                        <span className="text-[10px] text-slate-500 font-normal">
                          Total: {iatdAllRows.length} rows to write (Starting at Row {templateHeaderRow + 1})
                        </span>
                      </div>
                      <div className="overflow-x-auto max-h-44 scrollbar-thin">
                        <table className="w-full text-[10px] text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-700 font-bold text-slate-800 dark:text-slate-200">
                              <th className="p-1.5 border-r border-slate-200 dark:border-zinc-800">Row #</th>
                              {importedCountsheetSession && (
                                <th className="p-1.5 border-r border-slate-200 dark:border-zinc-800 whitespace-nowrap text-emerald-700 dark:text-emerald-400">
                                  CS Column &rarr; Actual
                                </th>
                              )}
                              {templateInspection.headers.map((h, idx) => (
                                <th key={`preview_head_${idx}_${h}_${idx}`} className="p-1.5 border-r border-slate-200 dark:border-zinc-800 whitespace-nowrap">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {iatdAllRows.slice(0, 5).map((row, rIdx) => {
                              const iatdIndexMap = new Map<string, number>();
                              iatdInspection?.headers.forEach((h, i) => iatdIndexMap.set(h, i));
                              const csItem = importedCountsheetSession ? countsheetItems[rIdx] : undefined;

                              return (
                                <tr key={`preview_row_${rIdx}`} className="border-b border-slate-100 dark:border-zinc-800/60 font-mono">
                                  <td className="p-1.5 text-slate-400 font-sans border-r border-slate-200 dark:border-zinc-800 font-bold whitespace-nowrap">
                                    Row {templateHeaderRow + 1 + rIdx} (#{rIdx + 1})
                                  </td>
                                  {importedCountsheetSession && (
                                    <td className="p-1.5 border-r border-slate-200 dark:border-zinc-800 whitespace-nowrap font-bold text-emerald-700 dark:text-emerald-400">
                                      {csItem ? (
                                        <span>
                                          {csItem.csCode || 'CS01'}:{' '}
                                          {csItem.actual !== undefined && csItem.actual !== null && String(csItem.actual).trim() !== ''
                                            ? csItem.actual
                                            : '—'}
                                        </span>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                  )}
                                  {templateInspection.headers.map((encHeader, cIdx) => {
                                    const mappedIatd = mapping[encHeader];
                                    let val = '';
                                    if (mappedIatd && iatdIndexMap.has(mappedIatd)) {
                                      const srcIdx = iatdIndexMap.get(mappedIatd)!;
                                      val = row[srcIdx] !== undefined ? String(row[srcIdx]) : '';
                                    } else if (
                                      csItem &&
                                      csItem.actual !== undefined &&
                                      csItem.actual !== null &&
                                      encHeader.trim().toUpperCase() === (csItem.csCode || 'CS01').toUpperCase()
                                    ) {
                                      val = String(csItem.actual);
                                    }
                                    return (
                                      <td key={`preview_cell_${rIdx}_${cIdx}`} className="p-1.5 border-r border-slate-200 dark:border-zinc-800 whitespace-nowrap max-w-[120px] truncate">
                                        {val || <span className="text-slate-300 dark:text-zinc-600">—</span>}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {executionError && (
                    <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{executionError}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 4: SUCCESS SUMMARY */}
          {step === 'SUCCESS' && executionResult && (
            <div className="py-2 space-y-4 w-full max-w-xl mx-auto animate-in zoom-in-95 duration-200">
              {/* Recents Navigation Top Banner */}
              <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-2xl text-xs">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{isViewingRecent ? 'Viewing Recent Generated Report' : 'Report Generated Successfully'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStep('SOURCE_IATD');
                    setIsViewingRecent(false);
                  }}
                  className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Back to Reports &amp; Generator</span>
                </button>
              </div>

              <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border-2 border-emerald-500/30">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="space-y-1 text-center">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  {executionResult.spreadsheetName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Total items: <strong className="text-emerald-600 dark:text-emerald-400">{executionResult.totalRows.toLocaleString()} rows</strong> populated in ENCODING sheet.
                </p>
              </div>

              {/* Stored in User's Google Drive "Generated Encoding" Folder Badge */}
              <div className="p-3 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/70 flex items-center justify-between gap-3 text-left">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <FolderOpen className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200 truncate">
                      Saved in Google Drive: {executionResult.folderName || GENERATED_ENCODING_FOLDER_NAME}
                    </div>
                    <div className="text-[10px] text-indigo-700 dark:text-indigo-400 truncate">
                      Stored directly in your account&apos;s Google Drive folder
                    </div>
                  </div>
                </div>
                {executionResult.folderWebViewLink && (
                  <a
                    href={executionResult.folderWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 hover:bg-indigo-100 dark:hover:bg-zinc-700 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 text-[11px] font-bold flex items-center gap-1 shrink-0 transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Open Folder</span>
                  </a>
                )}
              </div>

              {/* Generated Google Sheet Link Display Box */}
              <div className="p-3 bg-slate-50 dark:bg-zinc-800/80 rounded-2xl border border-slate-200 dark:border-zinc-700 text-left space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                    <span>New Google Sheet Link:</span>
                  </span>
                  {copiedLink && (
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Copied!
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={executionResult.webViewLink}
                    className="flex-1 text-[11px] font-mono px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-700 dark:text-slate-300 select-all focus:outline-none"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-2 bg-white hover:bg-slate-100 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-zinc-600 rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-95 transition cursor-pointer shrink-0"
                    title="Copy Google Sheets link"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* 2 Primary Options: 1. Open | 2. Share to Messenger & Apps */}
              <div className="space-y-2.5 pt-1">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 text-left px-1">
                  Choose an action:
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Option 1: Open in Google Sheets */}
                  <a
                    href={executionResult.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3.5 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white flex items-center justify-between gap-2 shadow-sm transition active:scale-98 group cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 text-left">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                        <ExternalLink className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold">1. Open Sheet</div>
                        <div className="text-[10px] text-slate-300">View in Google Sheets ↗</div>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                  </a>

                  {/* Option 2: Share to Messenger and other messaging platforms */}
                  <button
                    type="button"
                    onClick={handleShareToMessengerAndApps}
                    className="p-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-between gap-2 shadow-sm transition active:scale-98 group cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-white/20 text-white flex items-center justify-center shrink-0">
                        <MessageCircle className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold">2. Share Link</div>
                        <div className="text-[10px] text-blue-100">Send to Messenger / Apps</div>
                      </div>
                    </div>
                    <Share2 className="w-4 h-4 text-blue-200 group-hover:scale-110 transition-transform" />
                  </button>
                </div>

                {/* Quick Messaging App Shortcuts */}
                <div className="pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2">
                    Or send directly via:
                  </div>

                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {/* Messenger Direct Web / Native */}
                    <button
                      type="button"
                      onClick={() => {
                        const url = executionResult.webViewLink;
                        const fbUrl = `https://www.facebook.com/dialog/send?link=${encodeURIComponent(url)}&app_id=291494419107518&redirect_uri=${encodeURIComponent(url)}`;
                        // Open messenger share or fallback to native share
                        if (navigator.share) {
                          navigator.share({ title: executionResult.spreadsheetName, url }).catch(() => {});
                        } else {
                          window.open(fbUrl, '_blank');
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60 text-xs font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Messenger</span>
                    </button>

                    {/* WhatsApp */}
                    <a
                      href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                        `Audit Report ENCODING Google Sheet: ${executionResult.webViewLink}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                    >
                      <Send className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>WhatsApp</span>
                    </a>

                    {/* Telegram */}
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(
                        executionResult.webViewLink
                      )}&text=${encodeURIComponent(
                        `Audit Report ENCODING: ${executionResult.spreadsheetName}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-900/60 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                    >
                      <Send className="w-3.5 h-3.5 text-sky-500" />
                      <span>Telegram</span>
                    </a>

                    {/* Email */}
                    <a
                      href={`mailto:?subject=${encodeURIComponent(
                        `Audit Report ENCODING - ${executionResult.spreadsheetName}`
                      )}&body=${encodeURIComponent(
                        `Hi,\n\nHere is the generated Audit Report ENCODING spreadsheet:\n${executionResult.webViewLink}\n\nTotal records: ${executionResult.totalRows.toLocaleString()}`
                      )}`}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-zinc-700 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                    >
                      <Mail className="w-3.5 h-3.5 text-slate-500" />
                      <span>Email</span>
                    </a>
                  </div>
                </div>

                {/* Optional: Load as active branch */}
                {onBranchCreatedOrUpdated && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        onBranchCreatedOrUpdated(
                          executionResult.spreadsheetId,
                          executionResult.spreadsheetName
                        );
                        onClose();
                      }}
                      className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition active:scale-95 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Set as Active Branch in Hub</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          )}
        </div>

        {/* Modal Footer Navigation */}
        {isGoogleConnected && (
        <div className="p-3.5 sm:p-4 border-t border-slate-200/90 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 flex items-center justify-between gap-2">
          {step === 'SOURCE_IATD' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleProceedToTemplate}
                disabled={!iatdInspection || iatdInspection.headers.length === 0}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <span>Next: Choose Audit Template</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 'TARGET_TEMPLATE' && (
            <>
              <button
                onClick={() => setStep('SOURCE_IATD')}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-zinc-800 cursor-pointer flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <div className="flex items-center gap-2">
                {editingRecentReport && (
                  <button
                    type="button"
                    onClick={() => handleExecuteAuditReport()}
                    disabled={isExecuting || isLoadingTemplate || !templateInspection || !iatdInspection}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {isExecuting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>{executionProgress || 'Updating...'}</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>{createAsCopy ? 'Generate New Copy' : 'Save & Update Encoding'}</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={handleProceedToMapping}
                  disabled={!templateInspection || templateInspection.headers.length === 0 || isExecuting}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  <span>Next: Review Column Mapping</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {step === 'MAP_HEADERS' && (
            <>
              <button
                onClick={() => setStep('TARGET_TEMPLATE')}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-zinc-800 cursor-pointer flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                onClick={() => handleExecuteAuditReport()}
                disabled={isExecuting || isLoadingAllIatd}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{executionProgress || 'Processing...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{editingRecentReport && !createAsCopy ? 'Update ENCODING Data' : 'Generate ENCODING Data'}</span>
                  </>
                )}
              </button>
            </>
          )}

          {step === 'SUCCESS' && (
            <div className="w-full flex items-center justify-between gap-2">
              <button
                onClick={() => {
                  setStep('SOURCE_IATD');
                  setIsViewingRecent(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back to Recents &amp; Generator</span>
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-700 text-white font-bold text-xs active:scale-95 transition cursor-pointer"
              >
                Done
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Countsheet Import Picker Modal */}
      {showCountsheetImportPicker && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-2 bg-slate-50/80 dark:bg-zinc-800/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    Load Pre-Generated Countsheet into Encoding
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Import items &amp; sequence from a generated Countsheet
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCountsheetImportPicker(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Option A: Load directly from a Countsheet Google Sheet URL or ID */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Load from Pre-Generated Countsheet Google Sheet URL or ID:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Paste Countsheet Google Sheet link or ID..."
                    value={countsheetUrlToImport}
                    onChange={(e) => setCountsheetUrlToImport(e.target.value)}
                    className="flex-1 text-xs px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleImportFromCountsheetUrl}
                    disabled={!countsheetUrlToImport.trim() || isImportingCountsheetSheet}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0 cursor-pointer transition shadow-xs"
                  >
                    {isImportingCountsheetSheet ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                    )}
                    <span>{isImportingCountsheetSheet ? 'Reading...' : 'Load Sheet'}</span>
                  </button>
                </div>
                {countsheetImportError && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
                    {countsheetImportError}
                  </p>
                )}
              </div>

              {/* Option B: Select from Saved / Recent Countsheet Sessions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    Saved &amp; Recent Pre-Generated Countsheets ({recentCountsheetSessions.length}):
                  </span>
                  <button
                    type="button"
                    onClick={handleSyncCloudRecents}
                    disabled={isSyncingRecents}
                    className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncingRecents ? 'animate-spin' : ''}`} />
                    <span>Sync</span>
                  </button>
                </div>

                <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                  {recentCountsheetSessions.length > 0 ? (
                    recentCountsheetSessions.map((session, sIdx) => (
                      <div
                        key={`${session.id || 'cs'}_${session.spreadsheetId || ''}_${sIdx}`}
                        onClick={() => handleImportCountsheet(session)}
                        className="p-2.5 bg-slate-50 dark:bg-zinc-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-slate-200 dark:border-zinc-700 rounded-xl cursor-pointer transition flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                            <span>{session.spreadsheetName}</span>
                            {session.totalSheets > 0 && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                                {session.totalSheets} CS tabs
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                            Source IATD: {session.sourceFile?.name || 'IATD'} •{' '}
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                              {session.totalItems} items in sequence
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shrink-0 cursor-pointer"
                        >
                          Load Countsheet
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-center text-xs text-slate-400">
                      No saved countsheet sessions found. Generate or save a countsheet first in "Create Countsheet", or paste a Countsheet Google Sheet link above.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-zinc-800/60 border-t border-slate-200 dark:border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCountsheetImportPicker(false)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
