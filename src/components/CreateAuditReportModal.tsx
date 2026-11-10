import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  ChevronDown,
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
  GripVertical,
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
  importGeneratedCountsheetFromDrive,
  writeCountsheetActualsToEncodingSheet,
  detectIatdColumnIndices,
  parseIatdRowToCountsheetItem,
  isIatdTotalQuantityFooterRow,
  isIatdVersionFooterRow,
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
import { useScrollLock } from '../hooks/useScrollLock';

interface CreateAuditReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  userEmail?: string | null;
  userName?: string | null;
  isGoogleConnected?: boolean;
  onConnectGoogle?: () => void;
  activeBranch: SelectedBranch | null;
  initialCountsheetType?: 'random' | null;
  initialCountsheetSession?: RecentCountsheetSession | null;
  isFromCountsheetExport?: boolean;
  onBackToCountsheet?: (session?: RecentCountsheetSession | null) => void;
  onSaveCountsheetSession?: (session: RecentCountsheetSession) => void;
  transitionAnim?: 'none' | 'slide-in-right' | 'slide-out-right';
  isTransparentBackdrop?: boolean;
  onBranchCreatedOrUpdated?: (branchId: string, branchName: string) => void;
  onTokenRefreshed?: (newToken: string) => void;
}

type WizardStep = 'SOURCE_IATD' | 'TARGET_TEMPLATE' | 'MAP_HEADERS' | 'SUCCESS';

export const CreateAuditReportModal: React.FC<CreateAuditReportModalProps> = ({
  isOpen,
  onClose,
  onBackToCountsheet,
  onSaveCountsheetSession,
  isFromCountsheetExport = false,
  transitionAnim = 'none',
  isTransparentBackdrop = false,
  accessToken,
  userEmail,
  userName,
  isGoogleConnected: isGoogleConnectedProp,
  onConnectGoogle,
  activeBranch,
  initialCountsheetType = null,
  initialCountsheetSession = null,
  onBranchCreatedOrUpdated,
  onTokenRefreshed,
}) => {
  const [localToken, setLocalToken] = useState<string | null>(accessToken);

  useScrollLock(isOpen);

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
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>(() => getCachedDriveFiles('', userEmail));
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
      const files = await searchDriveSpreadsheets(newToken, searchQuery, {
        userEmail,
        excludeTemplates: true,
      });
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
  const [prevInitialSession, setPrevInitialSession] = useState<RecentCountsheetSession | null>(null);
  const internalSavedSessionRef = useRef<RecentCountsheetSession | null>(null);
  const iatdUpdateGenerationRef = useRef<number>(0);
  const [recentCountsheetSessions, setRecentCountsheetSessions] = useState<RecentCountsheetSession[]>(() => getRecentCountsheets());
  const [countsheetUrlToImport, setCountsheetUrlToImport] = useState('');
  const [isImportingCountsheetSheet, setIsImportingCountsheetSheet] = useState(false);
  const [countsheetImportError, setCountsheetImportError] = useState<string | null>(null);

  // Pre-generated countsheet ordered items (preserves sequence, Balance, Actual, and added missing items)
  const [countsheetItems, setCountsheetItems] = useState<PreGeneratedCountsheetItem[]>([]);
  const [countsheetEditorSearch, setCountsheetEditorSearch] = useState('');
  const [countsheetEditorCsFilter, setCountsheetEditorCsFilter] = useState<string>('ALL');
  const [showAddMissingPanel, setShowAddMissingPanel] = useState(false);
  const [showUpdateIatdPanel, setShowUpdateIatdPanel] = useState(false);
  const [updateIatdSourceTab, setUpdateIatdSourceTab] = useState<'DRIVE' | 'EMAIL'>('DRIVE');
  const [updateIatdSearchQuery, setUpdateIatdSearchQuery] = useState('');
  const [updateIatdUrlInput, setUpdateIatdUrlInput] = useState('');
  const [isUpdatingIatdSource, setIsUpdatingIatdSource] = useState(false);
  const [updateIatdError, setUpdateIatdError] = useState<string | null>(null);
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

  // Countsheet Editor Category drill-down filter and toolbar state (matching Create Countsheet layout)
  const [csActiveHeaderButton, setCsActiveHeaderButton] = useState<'cat' | 'subCat' | 'subSubCat'>('cat');
  const [csSelectedCats, setCsSelectedCats] = useState<string[]>([]);
  const [csSelectedSubCats, setCsSelectedSubCats] = useState<string[]>([]);
  const [csSelectedSubSubCats, setCsSelectedSubSubCats] = useState<string[]>([]);
  const [csHierarchySearchQuery, setCsHierarchySearchQuery] = useState<string>('');
  const [csItemSortBy, setCsItemSortBy] = useState<'seq' | 'itemCode' | 'itemDescription'>('seq');
  const [csShowSortDropdown, setCsShowSortDropdown] = useState(false);
  const [csOnlyWithBalance, setCsOnlyWithBalance] = useState(false);
  const [csOnlyWithActual, setCsOnlyWithActual] = useState(false);
  const [csOnlyMissingAdded, setCsOnlyMissingAdded] = useState(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const countsheetTableScrollRef = useRef<HTMLDivElement | null>(null);
  const rowDragStateRef = useRef<{
    seqIdx: number;
    itemId: string;
    startY: number;
    lastClientY: number;
    isDragging: boolean;
  } | null>(null);

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
    'Amount',
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

  // Distinct CS codes present in countsheetItems (restricted strictly to valid CSxx countsheets)
  const availableCsCodes = (() => {
    const csSet = new Set<string>();
    const addNormalizedCs = (raw?: string) => {
      const m = String(raw || '').trim().match(/^CS0*(\d+)$/i);
      if (m) {
        csSet.add(`CS${String(parseInt(m[1], 10)).padStart(2, '0')}`);
      }
    };

    countsheetItems.forEach((it) => addNormalizedCs(it.csCode || 'CS01'));

    if (csSet.size === 0 && importedCountsheetSession?.savedGroups) {
      let runningCs = 1;
      importedCountsheetSession.savedGroups.forEach((g) => {
        const startNum = g.startCsNumber && g.startCsNumber > 0 ? g.startCsNumber : runningCs;
        const used = g.csUsed && g.csUsed > 0 ? g.csUsed : 1;
        for (let k = 0; k < used; k++) {
          csSet.add(`CS${String(startNum + k).padStart(2, '0')}`);
        }
        runningCs = startNum + used;
      });
    }

    const list = Array.from(csSet);
    return list.length > 0
      ? list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      : ['CS01'];
  })();

  const handleImportCountsheet = async (session: RecentCountsheetSession, isBackgroundHydration = false) => {
    const headerRowToUse = session.headerRow || iatdHeaderRow;

    const computeMaxCsCount = (itemsList: PreGeneratedCountsheetItem[]): number => {
      const distinctCs = new Set<string>();
      let highestNum = 1;
      itemsList.forEach((it) => {
        const m = String(it.csCode || '').trim().match(/^CS0*(\d+)$/i);
        if (m) {
          const num = parseInt(m[1], 10);
          highestNum = Math.max(highestNum, num);
          distinctCs.add(`CS${String(num).padStart(2, '0')}`);
        }
      });
      return Math.max(1, highestNum, distinctCs.size);
    };

    const initialHeaders =
      session.iatdHeaders && session.iatdHeaders.length > 0
        ? session.iatdHeaders
        : iatdInspection?.headers && iatdInspection.headers.length > 0
        ? iatdInspection.headers
        : SYNTHETIC_IATD_HEADERS;

    const immediateItems = reconstructCountsheetItemsFromSession(session, initialHeaders, []);
    const embeddedCatalogItems: PreGeneratedCountsheetItem[] =
      session.rawItems && session.rawItems.length > 0
        ? session.rawItems.map((r, rIdx) => ({
            id: r.id || `raw_${rIdx}`,
            rowIndex: rIdx,
            csCode: 'CS01',
            sheetTitle: session.sourceFile?.tabName || 'COUNTSHEET',
            itemCode: r.itemCode || '',
            barcode: r.barcode || '',
            itemDescription: r.itemDescription || '',
            category: r.category || '',
            subCategory: r.subCategory || '',
            subsubCategory: r.subsubCategory || '',
            unit: r.unit || 'PC',
            cost: Number(r.cost) || 0,
            selling: Number(r.selling) || 0,
            balance: r.balance ?? 0,
            actual: r.actual ?? null,
            raw: [],
          }))
        : immediateItems;
    const embeddedCatalogRows = embeddedCatalogItems.map((it) =>
      buildIatdRowFromCountsheetItem(it, initialHeaders)
    );

    if (!isBackgroundHydration) {
      setImportedCountsheetSession(session);
      setCountsheetImportError(null);
      setEnableCountsheetCols(true);
      setCountsheetEditorCsFilter('ALL');
      setCountsheetEditorSearch('');
      setCsActiveHeaderButton('cat');
      setCsSelectedCats([]);
      setCsSelectedSubCats([]);
      setCsSelectedSubSubCats([]);
      setCsHierarchySearchQuery('');
      setCsItemSortBy('seq');
      setCsOnlyWithBalance(false);
      setCsOnlyWithActual(false);
      setCsOnlyMissingAdded(false);
      setIatdHeaderRow(headerRowToUse);

      if (embeddedCatalogRows.length > 0) {
        setFullSourceIatdRows(embeddedCatalogRows);
        setIatdAllRows(embeddedCatalogRows);
      }

      if (immediateItems.length > 0) {
        setCountsheetItems(immediateItems);
        setCountsheetCount(computeMaxCsCount(immediateItems));
        const firstCs = immediateItems[0]?.csCode || 'CS01';
        setNewMissingCsCode(firstCs);
        setInsertAfterSeqNum(immediateItems.length);

        if (!iatdInspection) {
          const synthRows =
            embeddedCatalogRows.length > 0
              ? embeddedCatalogRows
              : immediateItems.map((it) => buildIatdRowFromCountsheetItem(it, initialHeaders));
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
    }

    // 2. Inspect source IATD if it is a separate IATD spreadsheet (not the countsheet spreadsheet itself)
    const cleanCsSheetId =
      session.spreadsheetId &&
      !session.spreadsheetId.startsWith('draft_') &&
      !session.spreadsheetId.startsWith('cs_')
        ? extractSpreadsheetId(session.spreadsheetId)
        : '';
    let rawSourceId = session.sourceFile?.id || '';
    let sourceTabHint = session.sourceFile?.tabName;
    const isRealSheetId = (val?: string) =>
      Boolean(
        val &&
          val !== 'imported-countsheet' &&
          val !== 'saved-session' &&
          !val.startsWith('draft_') &&
          !val.startsWith('cs_') &&
          val !== 'countsheet-session'
      );

    if (!isRealSheetId(rawSourceId)) {
      const savedMatches = getRecentCountsheets();
      const matchedSaved = savedMatches.find(
        (s) =>
          isRealSheetId(s.sourceFile?.id) &&
          (s.id === session.id ||
            (cleanCsSheetId && extractSpreadsheetId(s.spreadsheetId || '') === cleanCsSheetId) ||
            (session.spreadsheetName && s.spreadsheetName === session.spreadsheetName))
      );
      if (matchedSaved?.sourceFile?.id) {
        rawSourceId = matchedSaved.sourceFile.id;
        sourceTabHint = sourceTabHint || matchedSaved.sourceFile.tabName;
      }
    }

    const sourceId = isRealSheetId(rawSourceId) ? extractSpreadsheetId(rawSourceId) : '';
    const hasSeparateIatdSource = Boolean(sourceId && sourceId !== cleanCsSheetId);

    if (hasSeparateIatdSource) {
      const hydrationGen = iatdUpdateGenerationRef.current;
      setIsLoadingIatd(true);
      setIatdError(null);
      try {
        const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) || effectiveToken || '';
        const { tabs, resolvedSpreadsheetId } = await getSpreadsheetTabs(tokenToUse, sourceId);
        if (iatdUpdateGenerationRef.current !== hydrationGen) return;
        const activeSourceId = resolvedSpreadsheetId || sourceId;
        setIatdTabs(tabs);
        const iatdTabMatch = tabs.find((t) =>
          t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('IATD')
        );
        const targetTab =
          sourceTabHint || (iatdTabMatch ? iatdTabMatch.title : tabs.length > 0 ? tabs[0].title : undefined);
        if (targetTab) setSelectedIatdTab(targetTab);

        const inspection = await inspectSheetHeaders(tokenToUse, activeSourceId, targetTab, headerRowToUse);
        if (iatdUpdateGenerationRef.current !== hydrationGen) return;
        setIatdInspection(inspection);
        setIatdInputId(activeSourceId);

        const dateStr = new Date().toISOString().split('T')[0];
        setNewCopyTitle(`${session.spreadsheetName || inspection.spreadsheetTitle} - Audit Encoding (${dateStr})`);

        const { headers: fullHeaders, rows: allRows } = await fetchAllSheetRows(
          tokenToUse,
          activeSourceId,
          targetTab || inspection.sheetTitle,
          inspection.detectedHeaderRow || headerRowToUse
        );
        if (iatdUpdateGenerationRef.current !== hydrationGen) return;
        const cleanRows = allRows.filter(
          (row, idx) =>
            Array.isArray(row) &&
            row.some((c) => c !== null && c !== undefined && String(c).trim() !== '') &&
            !isIatdTotalQuantityFooterRow(row) &&
            !isIatdVersionFooterRow(row, idx > 0 ? allRows[idx - 1] : undefined)
        );
        setFullSourceIatdRows(cleanRows.length > 0 ? cleanRows : embeddedCatalogRows);
        setIatdAllRows(cleanRows.length > 0 ? cleanRows : embeddedCatalogRows);

        const effectiveHeaders = fullHeaders.length > 0 ? fullHeaders : inspection.headers;
        const hydratedItems = reconstructCountsheetItemsFromSession(session, effectiveHeaders, cleanRows);

        // Also if session.spreadsheetId is a real Google Sheet, check if any Actual counts were entered in the sheet
        let finalItems = hydratedItems.length > 0 ? hydratedItems : immediateItems;
        if (cleanCsSheetId) {
          try {
            const sheetData = await fetchCountsheetItemsFromSpreadsheet(tokenToUse, cleanCsSheetId);
            if (iatdUpdateGenerationRef.current !== hydrationGen) return;
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
        if (iatdUpdateGenerationRef.current !== hydrationGen) return;

        setCountsheetItems((prev) => {
          if (isBackgroundHydration && prev.length > 0) {
            return prev.map((existingItem, idx) => {
              const hydratedMatch =
                finalItems[idx] && finalItems[idx].id === existingItem.id
                  ? finalItems[idx]
                  : finalItems.find(
                      (f) =>
                        f.id === existingItem.id ||
                        (f.itemCode &&
                          f.itemCode.toLowerCase() === (existingItem.itemCode || '').toLowerCase() &&
                          f.csCode === existingItem.csCode)
                    );
              if (!hydratedMatch) {
                return existingItem;
              }
              const nextCost =
                hydratedMatch.cost !== undefined && hydratedMatch.cost !== null
                  ? hydratedMatch.cost
                  : existingItem.cost;
              const nextSelling =
                hydratedMatch.selling !== undefined && hydratedMatch.selling !== null
                  ? hydratedMatch.selling
                  : existingItem.selling;
              const nextBal =
                existingItem.balance === null
                  ? null
                  : hydratedMatch.balance !== undefined && hydratedMatch.balance !== null
                  ? hydratedMatch.balance
                  : existingItem.balance;
              const nextAmount =
                nextBal === null || nextBal === undefined
                  ? 0
                  : hydratedMatch.amount !== undefined &&
                    nextBal === hydratedMatch.balance &&
                    nextCost === hydratedMatch.cost
                  ? hydratedMatch.amount
                  : Math.round((Number(nextBal) * Number(nextCost || 0) + Number.EPSILON) * 100) / 100;
              const nextAct =
                existingItem.actual !== undefined && existingItem.actual !== null
                  ? existingItem.actual
                  : hydratedMatch.actual ?? null;
              const merged: PreGeneratedCountsheetItem = {
                ...existingItem,
                ...hydratedMatch,
                id: existingItem.id,
                csCode: existingItem.csCode || hydratedMatch.csCode,
                sheetTitle: existingItem.sheetTitle || hydratedMatch.sheetTitle,
                isMissingItem: existingItem.isMissingItem,
                cost: nextCost,
                selling: nextSelling,
                balance: nextBal,
                amount: nextAmount,
                actual: nextAct,
              };
              merged.raw = buildIatdRowFromCountsheetItem(merged, effectiveHeaders);
              return merged;
            });
          }
          return finalItems;
        });
        if (finalItems.length > 0 && !isBackgroundHydration) {
          setCountsheetCount(computeMaxCsCount(finalItems));
          setInsertAfterSeqNum(finalItems.length);
          setNewMissingCsCode(finalItems[finalItems.length - 1]?.csCode || 'CS01');
        }
      } catch (err: any) {
        if (iatdUpdateGenerationRef.current !== hydrationGen) return;
        console.warn('Could not load source IATD for countsheet session, using embedded countsheet data:', err);
        if (embeddedCatalogRows.length > 0) {
          setFullSourceIatdRows((prev) => (prev.length > 0 ? prev : embeddedCatalogRows));
        }
        if (immediateItems.length > 0) {
          const fallbackHeaders =
            session.iatdHeaders && session.iatdHeaders.length > 0
              ? session.iatdHeaders
              : SYNTHETIC_IATD_HEADERS;
          const synthRows =
            embeddedCatalogRows.length > 0
              ? embeddedCatalogRows
              : immediateItems.map((it) => buildIatdRowFromCountsheetItem(it, fallbackHeaders));
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
          : iatdInspection?.headers && iatdInspection.headers.length > 0
          ? iatdInspection.headers
          : SYNTHETIC_IATD_HEADERS;
      const synthRows =
        embeddedCatalogRows.length > 0
          ? embeddedCatalogRows
          : immediateItems.map((it) => buildIatdRowFromCountsheetItem(it, fallbackHeaders));
      setFullSourceIatdRows((prev) => (prev.length > 0 ? prev : synthRows));
      setIatdAllRows((prev) => (prev.length > 0 ? prev : synthRows));
      if (!iatdInspection) {
        setIatdInspection({
          spreadsheetId: session.spreadsheetId || 'countsheet-session',
          spreadsheetTitle: session.spreadsheetName || 'Pre-Generated Countsheet',
          sheetTitle: 'COUNTSHEET',
          detectedHeaderRow: headerRowToUse,
          headers: fallbackHeaders,
          totalRows: synthRows.length,
          sampleRows: synthRows.slice(0, 5),
        });
      }
      const dateStr = new Date().toISOString().split('T')[0];
      setNewCopyTitle(`${session.spreadsheetName} - Audit Encoding (${dateStr})`);
    } else if (cleanCsSheetId) {
      // Fallback: if session had no embedded items and no separate IATD source, fetch directly from the countsheet Google Sheet
      setIsLoadingIatd(true);
      try {
        const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) || effectiveToken || '';
        const importedSession = await importGeneratedCountsheetFromDrive(tokenToUse, cleanCsSheetId);
        const fallbackHeaders =
          iatdInspection?.headers && iatdInspection.headers.length > 0
            ? iatdInspection.headers
            : SYNTHETIC_IATD_HEADERS;
        const hydrated = reconstructCountsheetItemsFromSession(importedSession, fallbackHeaders, []);
        setImportedCountsheetSession(importedSession);
        setCountsheetItems(hydrated);
        if (hydrated.length > 0) {
          setCountsheetCount(computeMaxCsCount(hydrated));
          setInsertAfterSeqNum(hydrated.length);
          setNewMissingCsCode(hydrated[0]?.csCode || 'CS01');
        }
      } catch (err: any) {
        setCountsheetImportError(err.message || 'Could not load Countsheet spreadsheet from Google Drive.');
      } finally {
        setIsLoadingIatd(false);
      }
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
      const importedSession = await importGeneratedCountsheetFromDrive(tokenToUse, cleanId);
      setRecentCountsheetSessions(getRecentCountsheets());
      await handleImportCountsheet(importedSession);
      setCountsheetUrlToImport('');
    } catch (err: any) {
      setCountsheetImportError(err.message || 'Failed to read Countsheet spreadsheet from Google Drive.');
    } finally {
      setIsImportingCountsheetSheet(false);
    }
  };

  // Track raw formula/text draft while typing in Balance or Actual inputs (e.g. "=5+4")
  const [editingQtyDrafts, setEditingQtyDrafts] = useState<Record<string, string>>({});

  // Safely evaluate arithmetic expressions like "=5+4" or "5+4" into a number (e.g. 9)
  const evaluateQtyFormula = (raw: string, stripTrailingOps = false): number | null => {
    let expr = raw.trim();
    if (!expr) return null;
    if (expr.startsWith('=')) {
      expr = expr.replace(/^=+/, '').trim();
    }
    if (stripTrailingOps) {
      expr = expr.replace(/[+\-*/.\s]+$/, '').trim();
    }
    if (!expr) return null;
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

    let pos = 0;
    const skipWhitespace = () => {
      while (pos < expr.length && /\s/.test(expr[pos])) pos++;
    };

    const parseExpression = (): number => {
      let value = parseTerm();
      while (true) {
        skipWhitespace();
        if (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
          const op = expr[pos++];
          const right = parseTerm();
          value = op === '+' ? value + right : value - right;
        } else {
          break;
        }
      }
      return value;
    };

    const parseTerm = (): number => {
      let value = parseFactor();
      while (true) {
        skipWhitespace();
        if (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/')) {
          const op = expr[pos++];
          const right = parseFactor();
          if (op === '/') {
            if (right === 0) return NaN;
            value = value / right;
          } else {
            value = value * right;
          }
        } else {
          break;
        }
      }
      return value;
    };

    const parseFactor = (): number => {
      skipWhitespace();
      if (pos >= expr.length) return NaN;
      if (expr[pos] === '+' || expr[pos] === '-') {
        const op = expr[pos++];
        const factor = parseFactor();
        return op === '-' ? -factor : factor;
      }
      if (expr[pos] === '(') {
        pos++;
        const val = parseExpression();
        skipWhitespace();
        if (pos >= expr.length || expr[pos] !== ')') return NaN;
        pos++;
        return val;
      }
      const start = pos;
      let hasDot = false;
      while (pos < expr.length && (/[0-9]/.test(expr[pos]) || expr[pos] === '.')) {
        if (expr[pos] === '.') {
          if (hasDot) return NaN;
          hasDot = true;
        }
        pos++;
      }
      if (start === pos) return NaN;
      return parseFloat(expr.slice(start, pos));
    };

    const result = parseExpression();
    skipWhitespace();
    if (pos !== expr.length || !Number.isFinite(result)) return null;
    return Math.round((result + Number.EPSILON) * 1e6) / 1e6;
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
      if ('balance' in updates || 'cost' in updates) {
        updatedItem.amount =
          updatedItem.balance === null || updatedItem.balance === undefined
            ? 0
            : Math.round(
                (Number(updatedItem.balance) * Number(updatedItem.cost || 0) + Number.EPSILON) * 100
              ) / 100;
      }
      updatedItem.raw = buildIatdRowFromCountsheetItem(updatedItem, headersToUse);
      next[indexInSequence] = updatedItem;
      return next;
    });
  };

  // Move item to a new index in sequence (via mouse drag-and-drop)
  const handleMoveCountsheetItemToIndex = (fromSeqIdx: number, toSeqIdx: number) => {
    if (fromSeqIdx === toSeqIdx) return;
    setCountsheetItems((prev) => {
      if (
        fromSeqIdx < 0 ||
        fromSeqIdx >= prev.length ||
        toSeqIdx < 0 ||
        toSeqIdx >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [movedItem] = next.splice(fromSeqIdx, 1);
      const targetItem = prev[toSeqIdx];
      if (targetItem?.csCode && movedItem.csCode !== targetItem.csCode) {
        const headersToUse =
          iatdInspection && iatdInspection.headers.length > 0
            ? iatdInspection.headers
            : importedCountsheetSession?.iatdHeaders && importedCountsheetSession.iatdHeaders.length > 0
            ? importedCountsheetSession.iatdHeaders
            : SYNTHETIC_IATD_HEADERS;
        const updatedMoved: PreGeneratedCountsheetItem = {
          ...movedItem,
          csCode: targetItem.csCode,
        };
        updatedMoved.raw = buildIatdRowFromCountsheetItem(updatedMoved, headersToUse);
        next.splice(toSeqIdx, 0, updatedMoved);
      } else {
        next.splice(toSeqIdx, 0, movedItem);
      }
      return next;
    });
  };

  const moveItemRef = useRef(handleMoveCountsheetItemToIndex);
  moveItemRef.current = handleMoveCountsheetItemToIndex;

  useEffect(() => {
    let autoScrollFrame: number | null = null;

    const checkRowUnderPointer = (clientY: number) => {
      const dragState = rowDragStateRef.current;
      const container = countsheetTableScrollRef.current;
      if (!dragState || !dragState.isDragging || !container) return;

      const rows = container.querySelectorAll<HTMLTableRowElement>('tbody tr[data-seq-idx]');
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rect = row.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
          const targetSeqIdx = parseInt(row.getAttribute('data-seq-idx') || '-1', 10);
          const fromSeqIdx = dragState.seqIdx;
          if (targetSeqIdx >= 0 && targetSeqIdx !== fromSeqIdx) {
            const midY = rect.top + rect.height / 2;
            if (
              (fromSeqIdx < targetSeqIdx && clientY >= midY) ||
              (fromSeqIdx > targetSeqIdx && clientY <= midY)
            ) {
              moveItemRef.current(fromSeqIdx, targetSeqIdx);
              dragState.seqIdx = targetSeqIdx;
            }
          }
          break;
        }
      }
    };

    const stepAutoScroll = () => {
      const dragState = rowDragStateRef.current;
      const container = countsheetTableScrollRef.current;
      if (!dragState || !dragState.isDragging || !container) {
        autoScrollFrame = null;
        return;
      }
      const rect = container.getBoundingClientRect();
      const edgeZone = 48;
      let scrolled = false;
      if (dragState.lastClientY < rect.top + edgeZone && container.scrollTop > 0) {
        const intensity = Math.max(2, Math.min(14, (rect.top + edgeZone - dragState.lastClientY) * 0.25));
        container.scrollTop -= intensity;
        scrolled = true;
      } else if (
        dragState.lastClientY > rect.bottom - edgeZone &&
        container.scrollTop + container.clientHeight < container.scrollHeight
      ) {
        const intensity = Math.max(2, Math.min(14, (dragState.lastClientY - (rect.bottom - edgeZone)) * 0.25));
        container.scrollTop += intensity;
        scrolled = true;
      }
      if (scrolled) {
        checkRowUnderPointer(dragState.lastClientY);
        autoScrollFrame = requestAnimationFrame(stepAutoScroll);
      } else {
        autoScrollFrame = null;
      }
    };

    const handleWindowMouseMove = (e: MouseEvent) => {
      const dragState = rowDragStateRef.current;
      if (!dragState) return;
      dragState.lastClientY = e.clientY;

      if (!dragState.isDragging) {
        if (Math.abs(e.clientY - dragState.startY) < 4) return;
        dragState.isDragging = true;
        setDraggingItemId(dragState.itemId);
        setCsItemSortBy((prev) => (prev !== 'seq' ? 'seq' : prev));
        window.getSelection()?.removeAllRanges();
      }

      e.preventDefault();
      checkRowUnderPointer(e.clientY);

      const container = countsheetTableScrollRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const edgeZone = 48;
        if (e.clientY < rect.top + edgeZone || e.clientY > rect.bottom - edgeZone) {
          if (autoScrollFrame === null) {
            autoScrollFrame = requestAnimationFrame(stepAutoScroll);
          }
        } else if (autoScrollFrame !== null) {
          cancelAnimationFrame(autoScrollFrame);
          autoScrollFrame = null;
        }
      }
    };

    const handleWindowMouseUp = () => {
      if (autoScrollFrame !== null) {
        cancelAnimationFrame(autoScrollFrame);
        autoScrollFrame = null;
      }
      if (rowDragStateRef.current) {
        rowDragStateRef.current = null;
        setDraggingItemId(null);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove, { passive: false });
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      if (autoScrollFrame !== null) {
        cancelAnimationFrame(autoScrollFrame);
      }
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

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

  // Select and apply an updated IATD spreadsheet for the loaded Countsheet (updates inventory catalog & item metadata)
  const handleApplyUpdatedIatdForCountsheet = async (
    rawId: string,
    tabName?: string,
    driveFile?: DriveSpreadsheetFile
  ) => {
    let cleanId = extractSpreadsheetId(rawId);
    if (!cleanId) return;

    iatdUpdateGenerationRef.current += 1;
    setIsUpdatingIatdSource(true);
    setUpdateIatdError(null);
    try {
      const tokenToUse =
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) ||
        effectiveToken ||
        '';

      // Auto-convert non-native Excel (.xlsx/.xls/.csv) file in Drive if selected
      const matchedDriveFile = driveFile || driveFiles.find((f) => f.id === cleanId);
      const isNonNativeExcel =
        matchedDriveFile &&
        ((matchedDriveFile.mimeType &&
          matchedDriveFile.mimeType !== 'application/vnd.google-apps.spreadsheet') ||
          /\.(xlsx|xls|xlsm|csv|ods)$/i.test(matchedDriveFile.name || ''));

      if (isNonNativeExcel && matchedDriveFile) {
        const converted = await convertDriveExcelFileToGoogleSheet(tokenToUse, {
          id: matchedDriveFile.id,
          name: matchedDriveFile.name,
          mimeType: matchedDriveFile.mimeType,
        });
        cleanId = converted.id;
        searchDriveSpreadsheets(tokenToUse, searchQuery, { userEmail, excludeTemplates: true })
          .then((files) => setDriveFiles(files))
          .catch(() => {});
      }

      const { tabs, resolvedSpreadsheetId } = await getSpreadsheetTabs(tokenToUse, cleanId);
      if (resolvedSpreadsheetId) {
        cleanId = resolvedSpreadsheetId;
      }
      setIatdTabs(tabs);
      const iatdTabMatch = tabs.find((t) =>
        t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('IATD')
      );
      const targetTab =
        tabName || (iatdTabMatch ? iatdTabMatch.title : tabs.length > 0 ? tabs[0].title : undefined);
      if (targetTab) setSelectedIatdTab(targetTab);

      const inspection = await inspectSheetHeaders(
        tokenToUse,
        cleanId,
        targetTab,
        iatdHeaderRow
      );
      const detectedHeaderRowToUse = inspection.detectedHeaderRow || iatdHeaderRow || 2;
      setIatdHeaderRow(detectedHeaderRowToUse);

      const { headers: fullHeaders, rows: allRows } = await fetchAllSheetRows(
        tokenToUse,
        cleanId,
        targetTab || inspection.sheetTitle,
        detectedHeaderRowToUse
      );

      const cleanIatdRows = allRows.filter(
        (row, idx) =>
          Array.isArray(row) &&
          row.some((c) => c !== null && c !== undefined && String(c).trim() !== '') &&
          !isIatdTotalQuantityFooterRow(row) &&
          !isIatdVersionFooterRow(row, idx > 0 ? allRows[idx - 1] : undefined)
      );

      const effectiveHeaders =
        fullHeaders && fullHeaders.length > 0 ? fullHeaders : inspection.headers;
      const updatedInspection: SheetHeaderInspection = {
        ...inspection,
        detectedHeaderRow: detectedHeaderRowToUse,
        headers: effectiveHeaders,
        totalRows: cleanIatdRows.length || inspection.totalRows,
        sampleRows: cleanIatdRows.slice(0, 5),
      };

      setIatdInspection(updatedInspection);
      setIatdInputId(cleanId);
      setFullSourceIatdRows(cleanIatdRows);
      setIatdAllRows(cleanIatdRows);

      // Build lookup map from the new IATD rows to refresh existing selected countsheet items
      const cols = detectIatdColumnIndices(effectiveHeaders);
      const normalizeLookupKey = (v: unknown) =>
        String(v ?? '')
          .trim()
          .toLowerCase()
          .replace(/\.0+$/, '');
      const stripLeadingZeros = (v: string) => v.replace(/^0+(?=\d)/, '');
      const stripNonAlnum = (v: string) => v.replace(/[^a-z0-9]/g, '');
      const normalizeDescKey = (v: unknown) =>
        String(v ?? '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');

      const parsedByCode = new Map<string, { parsed: PreGeneratedCountsheetItem; row: any[]; idx: number }>();
      const parsedByStripped = new Map<string, { parsed: PreGeneratedCountsheetItem; row: any[]; idx: number }>();
      const parsedByAlnum = new Map<string, { parsed: PreGeneratedCountsheetItem; row: any[]; idx: number }>();
      const parsedByDesc = new Map<string, { parsed: PreGeneratedCountsheetItem; row: any[]; idx: number }>();
      const newCatalogParsedItems: PreGeneratedCountsheetItem[] = [];

      cleanIatdRows.forEach((row, rIdx) => {
        if (!row) return;
        const parsed = parseIatdRowToCountsheetItem(row, rIdx, cols, 'CS01');
        if (!parsed.itemCode && !parsed.itemDescription) return;
        newCatalogParsedItems.push(parsed);

        const cKey = normalizeLookupKey(parsed.itemCode);
        const bKey = normalizeLookupKey(parsed.barcode);
        const dKey = normalizeDescKey(parsed.itemDescription);

        if (cKey) {
          if (!parsedByCode.has(cKey)) parsedByCode.set(cKey, { parsed, row, idx: rIdx });
          const cs = stripLeadingZeros(cKey);
          if (cs && !parsedByStripped.has(cs)) parsedByStripped.set(cs, { parsed, row, idx: rIdx });
          const ca = stripNonAlnum(cs || cKey);
          if (ca && !parsedByAlnum.has(ca)) parsedByAlnum.set(ca, { parsed, row, idx: rIdx });
        }
        if (bKey) {
          if (!parsedByCode.has(bKey)) parsedByCode.set(bKey, { parsed, row, idx: rIdx });
          const bs = stripLeadingZeros(bKey);
          if (bs && !parsedByStripped.has(bs)) parsedByStripped.set(bs, { parsed, row, idx: rIdx });
          const ba = stripNonAlnum(bs || bKey);
          if (ba && !parsedByAlnum.has(ba)) parsedByAlnum.set(ba, { parsed, row, idx: rIdx });
        }
        if (dKey && !parsedByDesc.has(dKey)) {
          parsedByDesc.set(dKey, { parsed, row, idx: rIdx });
        }
      });

      // Preserve any typed Actual Qty drafts, and clear Balance drafts so the new IATD balances take effect
      const itemsWithCommittedActuals = countsheetItems.map((it) => {
        let nextAct = it.actual;
        const actDraft = editingQtyDrafts[`actual_${it.id}`];
        if (actDraft !== undefined) {
          if (actDraft.trim() === '') {
            nextAct = null;
          } else {
            const evaluated = evaluateQtyFormula(actDraft, true);
            if (evaluated !== null) {
              nextAct = evaluated;
            } else {
              const parsedNum = parseFloat(actDraft);
              if (!isNaN(parsedNum)) nextAct = parsedNum;
            }
          }
        }
        return {
          ...it,
          actual: nextAct,
        };
      });
      setEditingQtyDrafts({});

      const refreshedSelectedItems: PreGeneratedCountsheetItem[] = itemsWithCommittedActuals.map((it) => {
        const cKey = normalizeLookupKey(it.itemCode);
        const bKey = normalizeLookupKey(it.barcode);
        const dKey = normalizeDescKey(it.itemDescription);
        const match =
          (cKey &&
            (parsedByCode.get(cKey) ||
              parsedByStripped.get(stripLeadingZeros(cKey)) ||
              parsedByAlnum.get(stripNonAlnum(stripLeadingZeros(cKey) || cKey)))) ||
          (bKey &&
            (parsedByCode.get(bKey) ||
              parsedByStripped.get(stripLeadingZeros(bKey)) ||
              parsedByAlnum.get(stripNonAlnum(stripLeadingZeros(bKey) || bKey)))) ||
          (dKey && parsedByDesc.get(dKey));

        if (match) {
          const nextCost =
            cols.costIdx >= 0
              ? match.parsed.cost
              : match.parsed.cost !== undefined && match.parsed.cost !== null && match.parsed.cost !== 0
              ? match.parsed.cost
              : it.cost || 0;
          const nextSelling =
            cols.sellingIdx >= 0
              ? match.parsed.selling
              : match.parsed.selling !== undefined && match.parsed.selling !== null && match.parsed.selling !== 0
              ? match.parsed.selling
              : it.selling || 0;
          const nextBalance =
            cols.balanceIdx >= 0 && match.parsed.balance !== undefined && match.parsed.balance !== null
              ? match.parsed.balance
              : match.parsed.balance ?? it.balance;
          const nextAmount =
            cols.amountIdx >= 0 && match.parsed.amount !== undefined
              ? match.parsed.amount
              : Math.round((Number(nextBalance ?? 0) * Number(nextCost || 0) + Number.EPSILON) * 100) / 100;

          const mergedItem: PreGeneratedCountsheetItem = {
            ...it,
            rowIndex: match.idx,
            itemCode: match.parsed.itemCode || it.itemCode,
            barcode: match.parsed.barcode || it.barcode,
            itemDescription: match.parsed.itemDescription || it.itemDescription,
            category: match.parsed.category || it.category,
            subCategory: match.parsed.subCategory || it.subCategory,
            subsubCategory: match.parsed.subsubCategory || it.subsubCategory,
            unit: match.parsed.unit || it.unit,
            cost: nextCost,
            selling: nextSelling,
            balance: nextBalance,
            amount: nextAmount,
            actual: it.actual,
          };
          mergedItem.raw = buildIatdRowFromCountsheetItem(
            { ...mergedItem, raw: [...match.row] },
            effectiveHeaders
          );
          return mergedItem;
        }

        const rebuilt: PreGeneratedCountsheetItem = {
          ...it,
          amount:
            it.amount !== undefined
              ? it.amount
              : Math.round((Number(it.balance ?? 0) * Number(it.cost || 0) + Number.EPSILON) * 100) / 100,
        };
        rebuilt.raw = buildIatdRowFromCountsheetItem(rebuilt, effectiveHeaders);
        return rebuilt;
      });

      setCountsheetItems(refreshedSelectedItems);

      if (importedCountsheetSession) {
        const selectedByCode = new Map<string, PreGeneratedCountsheetItem>();
        refreshedSelectedItems.forEach((selIt) => {
          const ck = normalizeLookupKey(selIt.itemCode || selIt.barcode);
          if (ck && !selectedByCode.has(ck)) selectedByCode.set(ck, selIt);
          const stripped = stripLeadingZeros(ck);
          if (stripped && !selectedByCode.has(stripped)) selectedByCode.set(stripped, selIt);
        });

        const updatedRawCatalog: PreGeneratedCountsheetItem[] = newCatalogParsedItems.map((catIt, idx) => {
          const ck = normalizeLookupKey(catIt.itemCode || catIt.barcode);
          const matchedSel =
            (ck && (selectedByCode.get(ck) || selectedByCode.get(stripLeadingZeros(ck)))) ||
            undefined;
          return {
            id: matchedSel?.id || catIt.id || `item_${idx}`,
            rowIndex: idx,
            csCode: matchedSel?.csCode || '',
            sheetTitle: targetTab || inspection.sheetTitle || 'COUNTSHEET',
            itemCode: catIt.itemCode,
            barcode: catIt.barcode,
            itemDescription: catIt.itemDescription,
            category: catIt.category,
            subCategory: catIt.subCategory,
            subsubCategory: catIt.subsubCategory,
            cost: catIt.cost,
            selling: catIt.selling,
            unit: catIt.unit,
            balance: matchedSel !== undefined ? matchedSel.balance : catIt.balance,
            amount: matchedSel?.amount !== undefined ? matchedSel.amount : catIt.amount,
            actual: matchedSel?.actual ?? null,
            raw: catIt.raw || [],
          };
        });

        const shortDateStr = new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        const nextCountsheetTitle = `Audit Countsheets - ${inspection.spreadsheetTitle} (${shortDateStr})`;
        const isoDateStr = new Date().toISOString().split('T')[0];
        setNewCopyTitle(`${nextCountsheetTitle} - Audit Encoding (${isoDateStr})`);

        const baseNextSession: RecentCountsheetSession = {
          ...importedCountsheetSession,
          spreadsheetName: nextCountsheetTitle,
          sourceFile: {
            id: cleanId,
            name: inspection.spreadsheetTitle,
            tabName: targetTab || inspection.sheetTitle,
          },
          headerRow: detectedHeaderRowToUse,
          iatdHeaders: effectiveHeaders,
          rawItems: updatedRawCatalog,
        };
        const syncedNextSession = applyCommittedItemsToSession(
          baseNextSession,
          refreshedSelectedItems
        );
        internalSavedSessionRef.current = syncedNextSession;
        setPrevInitialSession(syncedNextSession);
        setImportedCountsheetSession(syncedNextSession);
        if (onSaveCountsheetSession) {
          onSaveCountsheetSession(syncedNextSession);
        }
        saveRecentCountsheet(syncedNextSession)
          .then((saved) => {
            internalSavedSessionRef.current = saved;
            setPrevInitialSession(saved);
            setImportedCountsheetSession(saved);
            if (onSaveCountsheetSession) {
              onSaveCountsheetSession(saved);
            }
            setRecentCountsheetSessions(getRecentCountsheets());
          })
          .catch(() => {});
      }

      setUpdateIatdUrlInput('');
      setShowUpdateIatdPanel(false);
      setCountsheetSaveMsg(
        `Updated IATD applied: ${inspection.spreadsheetTitle} (${cleanIatdRows.length.toLocaleString()} items)`
      );
      setTimeout(() => setCountsheetSaveMsg(null), 4000);
    } catch (err: any) {
      setUpdateIatdError(
        err?.message || 'Could not load the selected IATD spreadsheet. Please check link or permissions.'
      );
    } finally {
      setIsUpdatingIatdSource(false);
    }
  };

  // Helper to flush any active Balance or Actual Qty text drafts onto countsheetItems
  const buildCommittedCountsheetItems = (): PreGeneratedCountsheetItem[] => {
    const headersToUse =
      iatdInspection && iatdInspection.headers.length > 0
        ? iatdInspection.headers
        : importedCountsheetSession?.iatdHeaders && importedCountsheetSession.iatdHeaders.length > 0
        ? importedCountsheetSession.iatdHeaders
        : SYNTHETIC_IATD_HEADERS;

    return countsheetItems.map((it) => {
      let nextBal = it.balance;
      let nextAct = it.actual;
      const balDraft = editingQtyDrafts[`balance_${it.id}`];
      if (balDraft !== undefined) {
        if (balDraft.trim() === '') {
          nextBal = null;
        } else {
          const evaluated = evaluateQtyFormula(balDraft, true);
          if (evaluated !== null) {
            nextBal = evaluated;
          } else {
            const parsed = parseFloat(balDraft);
            if (!isNaN(parsed)) nextBal = parsed;
          }
        }
      }
      const actDraft = editingQtyDrafts[`actual_${it.id}`];
      if (actDraft !== undefined) {
        if (actDraft.trim() === '') {
          nextAct = null;
        } else {
          const evaluated = evaluateQtyFormula(actDraft, true);
          if (evaluated !== null) {
            nextAct = evaluated;
          } else {
            const parsed = parseFloat(actDraft);
            if (!isNaN(parsed)) nextAct = parsed;
          }
        }
      }
      const nextAmount =
        nextBal === null || nextBal === undefined
          ? 0
          : nextBal !== it.balance
          ? Math.round((Number(nextBal) * Number(it.cost || 0) + Number.EPSILON) * 100) / 100
          : it.amount !== undefined
          ? it.amount
          : Math.round((Number(nextBal) * Number(it.cost || 0) + Number.EPSILON) * 100) / 100;
      const updatedItem: PreGeneratedCountsheetItem = {
        ...it,
        balance: nextBal,
        amount: nextAmount,
        actual: nextAct,
      };
      updatedItem.raw = buildIatdRowFromCountsheetItem(updatedItem, headersToUse);
      return updatedItem;
    });
  };

  // Build updated savedGroups & rawItems with the committed Balance and Actual Qty values
  const applyCommittedItemsToSession = (
    baseSession: RecentCountsheetSession,
    committedItems: PreGeneratedCountsheetItem[]
  ): RecentCountsheetSession => {
    const normalizeCs = (raw?: string) => {
      const m = String(raw || '').trim().match(/^CS0*(\d+)$/i);
      return m ? `CS${String(parseInt(m[1], 10)).padStart(2, '0')}` : 'CS01';
    };

    const itemsByCs = new Map<string, PreGeneratedCountsheetItem[]>();
    committedItems.forEach((it) => {
      const csKey = normalizeCs(it.csCode);
      const normalizedItem: PreGeneratedCountsheetItem = {
        ...it,
        csCode: csKey,
      };
      if (!itemsByCs.has(csKey)) itemsByCs.set(csKey, []);
      itemsByCs.get(csKey)!.push(normalizedItem);
    });

    const distinctCsCount = itemsByCs.size;
    let updatedSavedGroups = baseSession.savedGroups;
    if (baseSession.savedGroups && baseSession.savedGroups.length > 0) {
      const handledCs = new Set<string>();
      updatedSavedGroups = baseSession.savedGroups
        .map((grp, grpIdx) => {
          const grpCsKey = normalizeCs(grp.orderedItems?.[0]?.csCode || grp.name || `CS${grpIdx + 1}`);
          const grpItems = itemsByCs.get(grpCsKey) || [];
          handledCs.add(grpCsKey);
          return {
            ...grp,
            orderedItems: grpItems,
            selectedItemIds: grpItems.map((i) => i.id),
            selectedItemCodes: grpItems.map((i) => i.itemCode).filter(Boolean),
            selectedBarcodes: grpItems.map((i) => i.barcode).filter(Boolean),
          };
        })
        .filter((grp) => grp.orderedItems && grp.orderedItems.length > 0);

      // Append any newly added CS groups not previously in savedGroups
      itemsByCs.forEach((grpItems, csKey) => {
        if (!handledCs.has(csKey) && grpItems.length > 0) {
          const csMatch = csKey.match(/(\d+)/);
          const csNum = csMatch ? parseInt(csMatch[1], 10) : (updatedSavedGroups?.length || 0) + 1;
          updatedSavedGroups!.push({
            id: `grp_${csKey}_${Date.now()}`,
            name: csKey,
            baseSheetName: csKey,
            selectedCat: '',
            selectedSubCat: '',
            selectedSubSubCat: '',
            selectedCats: [],
            selectedSubCats: [],
            selectedSubSubCats: [],
            lastSelectedHierarchy: csKey,
            selectedItemIds: grpItems.map((i) => i.id),
            selectedItemCodes: grpItems.map((i) => i.itemCode).filter(Boolean),
            selectedBarcodes: grpItems.map((i) => i.barcode).filter(Boolean),
            randomCountInput: grpItems.length,
            onlyItemsWithBalance: false,
            insertCategorySpacers: false,
            showSelectedItemsOnly: false,
            startCsNumber: csNum,
            endCsNumber: csNum,
            csUsed: 1,
            orderedItems: grpItems,
          });
        }
      });
    }

    // Also sync edited Balance and Actual Qty into rawItems pool if present
    const byId = new Map<string, PreGeneratedCountsheetItem>();
    const byCode = new Map<string, PreGeneratedCountsheetItem>();
    committedItems.forEach((it) => {
      if (it.id) byId.set(it.id, it);
      const c = String(it.itemCode || it.barcode || '').trim().toLowerCase();
      if (c && !byCode.has(c)) byCode.set(c, it);
    });

    const updatedRawItems = baseSession.rawItems
      ? baseSession.rawItems.map((rawIt) => {
          const c = String(rawIt.itemCode || rawIt.barcode || '').trim().toLowerCase();
          const matched = (rawIt.id && byId.get(rawIt.id)) || (c && byCode.get(c));
          if (matched) {
            return {
              ...rawIt,
              cost: matched.cost ?? rawIt.cost,
              selling: matched.selling ?? rawIt.selling,
              balance: matched.balance,
              amount: matched.amount ?? rawIt.amount,
              actual: matched.actual,
            };
          }
          return rawIt;
        })
      : undefined;

    return {
      ...baseSession,
      totalSheets: distinctCsCount || baseSession.totalSheets,
      totalItems: committedItems.length,
      savedGroups: updatedSavedGroups,
      orderedCountsheetItems: committedItems,
      rawItems: updatedRawItems,
    };
  };

  // Save edited countsheet items (Balance, Actual, Missing Items, Sequence) back to the session
  const handlePersistEditedCountsheetSession = async () => {
    if (!importedCountsheetSession) return;
    setIsSavingEditsLoading(true);
    try {
      const committedItems = buildCommittedCountsheetItems();
      setEditingQtyDrafts({});
      setCountsheetItems(committedItems);

      const sessionToSave = applyCommittedItemsToSession(importedCountsheetSession, committedItems);
      internalSavedSessionRef.current = sessionToSave;
      setPrevInitialSession(sessionToSave);
      const updatedSession = await saveRecentCountsheet(sessionToSave);
      internalSavedSessionRef.current = updatedSession;
      setPrevInitialSession(updatedSession);
      setImportedCountsheetSession(updatedSession);
      onSaveCountsheetSession?.(updatedSession);
      setRecentCountsheetSessions(getRecentCountsheets());
      setCountsheetSaveMsg('Balance, Actual Qty & sequence saved!');
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
    searchDriveSpreadsheets(effectiveToken || '', searchQuery, {
      userEmail,
      excludeTemplates: true,
    })
      .then((files) => {
        setDriveFiles(files);
        setDriveSearchError(null);
      })
      .catch((err) => {
        console.warn('Could not fetch drive spreadsheets:', err);
        const cached = getCachedDriveFiles(searchQuery, userEmail);
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
      const activeQuery = showUpdateIatdPanel ? updateIatdSearchQuery : searchQuery;
      const cached = getCachedDriveFiles(activeQuery, userEmail);
      if (cached.length > 0) {
        setDriveFiles(cached);
      }
      setIsSearchingDrive(true);
      setDriveSearchError(null);
      searchDriveSpreadsheets(effectiveToken || '', activeQuery, {
        userEmail,
        excludeTemplates: true,
      })
        .then((files) => {
          setDriveFiles(files);
          setDriveSearchError(null);
        })
        .catch((err) => {
          console.warn('Could not fetch drive spreadsheets:', err);
          const fallbackCached = getCachedDriveFiles(activeQuery, userEmail);
          if (fallbackCached.length > 0) {
            setDriveFiles(fallbackCached);
            setDriveSearchError(null);
          } else {
            setDriveSearchError(err?.message || 'Could not load spreadsheets from Google Drive.');
          }
        })
        .finally(() => setIsSearchingDrive(false));
    };

    const timer = setTimeout(searchDriveOnOpen, showUpdateIatdPanel && updateIatdSearchQuery ? 250 : 0);
    return () => clearTimeout(timer);
  }, [isOpen, searchQuery, showUpdateIatdPanel, updateIatdSearchQuery, effectiveToken, userEmail]);

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
      if (initialCountsheetSession && initialCountsheetSession === internalSavedSessionRef.current) {
        return;
      }
      setStep('SOURCE_IATD');
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
      if (initialCountsheetSession) {
        const timer = setTimeout(() => {
          void handleImportCountsheet(initialCountsheetSession, true);
        }, 350);
        return () => clearTimeout(timer);
      } else {
        setImportedCountsheetSession(null);
        setIatdHeaderRow(2);
        setRecentReports(getRecentAuditReports());
        setRecentCountsheetSessions(getRecentCountsheets());
        handleSyncCloudRecents();
      }
    }
  }, [isOpen, initialCountsheetType, initialCountsheetSession]);

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
      searchDriveSpreadsheets(tokenToUse, searchQuery, { userEmail, excludeTemplates: true })
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

      searchDriveSpreadsheets(tokenToUse, searchQuery, { userEmail, excludeTemplates: true })
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

  if (!isOpen) {
    if (prevInitialSession !== null) {
      setPrevInitialSession(null);
    }
    return null;
  }

  if (
    initialCountsheetSession &&
    prevInitialSession !== initialCountsheetSession
  ) {
    if (initialCountsheetSession === internalSavedSessionRef.current) {
      setPrevInitialSession(initialCountsheetSession);
    } else {
      const headerRowToUse = initialCountsheetSession.headerRow || 2;
      const initialHeaders =
        initialCountsheetSession.iatdHeaders && initialCountsheetSession.iatdHeaders.length > 0
          ? initialCountsheetSession.iatdHeaders
          : SYNTHETIC_IATD_HEADERS;
      const immediateItems = reconstructCountsheetItemsFromSession(initialCountsheetSession, initialHeaders, []);
      const initialCatalogItems: PreGeneratedCountsheetItem[] =
        initialCountsheetSession.rawItems && initialCountsheetSession.rawItems.length > 0
          ? initialCountsheetSession.rawItems.map((r, rIdx) => {
              const cVal = Number(r.cost) || 0;
              const bVal = r.balance ?? 0;
              const aVal =
                r.amount !== undefined
                  ? Number(r.amount) || 0
                  : Math.round((Number(bVal) * cVal + Number.EPSILON) * 100) / 100;
              return {
                id: r.id || `raw_${rIdx}`,
                rowIndex: rIdx,
                csCode: 'CS01',
                sheetTitle: initialCountsheetSession.sourceFile?.tabName || 'COUNTSHEET',
                itemCode: r.itemCode || '',
                barcode: r.barcode || '',
                itemDescription: r.itemDescription || '',
                category: r.category || '',
                subCategory: r.subCategory || '',
                subsubCategory: r.subsubCategory || '',
                unit: r.unit || 'PC',
                cost: cVal,
                selling: Number(r.selling) || 0,
                balance: bVal,
                amount: aVal,
                actual: r.actual ?? null,
                raw: [],
              };
            })
          : immediateItems;
      const synthRows = initialCatalogItems.map((it) =>
        buildIatdRowFromCountsheetItem(it, initialHeaders)
      );
      const distinctCs = new Set<string>();
      let highestNum = 1;
      immediateItems.forEach((it) => {
        const m = String(it.csCode || '').trim().match(/^CS0*(\d+)$/i);
        if (m) {
          const num = parseInt(m[1], 10);
          highestNum = Math.max(highestNum, num);
          distinctCs.add(`CS${String(num).padStart(2, '0')}`);
        }
      });
      const maxCsCount = Math.max(1, highestNum, distinctCs.size);

      setPrevInitialSession(initialCountsheetSession);
      setImportedCountsheetSession(initialCountsheetSession);
    setStep('SOURCE_IATD');
    setCountsheetImportError(null);
    setEnableCountsheetCols(true);
    setCountsheetEditorCsFilter('ALL');
    setCountsheetEditorSearch('');
    setCsActiveHeaderButton('cat');
    setCsSelectedCats([]);
    setCsSelectedSubCats([]);
    setCsSelectedSubSubCats([]);
    setCsHierarchySearchQuery('');
    setCsItemSortBy('seq');
    setCsOnlyWithBalance(false);
    setCsOnlyWithActual(false);
    setCsOnlyMissingAdded(false);
    setIatdHeaderRow(headerRowToUse);
    setCountsheetItems(immediateItems);
    setCountsheetCount(maxCsCount);
    setNewMissingCsCode(immediateItems[0]?.csCode || 'CS01');
    setInsertAfterSeqNum(immediateItems.length);
    setFullSourceIatdRows(synthRows);
    setIatdAllRows(synthRows);
      setIatdInspection({
        spreadsheetId: initialCountsheetSession.sourceFile?.id || initialCountsheetSession.spreadsheetId || 'countsheet-session',
        spreadsheetTitle: initialCountsheetSession.sourceFile?.name || initialCountsheetSession.spreadsheetName || 'Pre-Generated Countsheet',
        sheetTitle: initialCountsheetSession.sourceFile?.tabName || 'COUNTSHEET',
        detectedHeaderRow: headerRowToUse,
        headers: initialHeaders,
        totalRows: synthRows.length,
        sampleRows: synthRows.slice(0, 5),
      });
    }
  }

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
        searchDriveSpreadsheets(tokenToUse, searchQuery, { userEmail, excludeTemplates: true })
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

  // Handle Cancel or Back (returns to editing countsheets if opened via Export to Encoding)
  const handleCancelOrBack = () => {
    if (isFromCountsheetExport && onBackToCountsheet) {
      const committedItems = buildCommittedCountsheetItems();
      const currentSession = importedCountsheetSession
        ? applyCommittedItemsToSession(importedCountsheetSession, committedItems)
        : null;
      onBackToCountsheet(currentSession);
    } else {
      onClose();
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

      // Determine required CS columns count up front so we can skip redundant formula replication
      // when setupCountsheetHeadersInTemplate will immediately shift CS columns and replicate formulas
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
      const willSetupCsHeaders =
        (enableCountsheetCols || (Boolean(importedCountsheetSession) && countsheetItems.length > 0)) &&
        effectiveCsCount > 0;

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
        autoAdjustDimensions, // Add/delete rows and columns dynamically
        {
          skipFormulaReplication: willSetupCsHeaders,
          skipFolderMove: createAsCopy,
        }
      );

      // 3. Adjust CS columns and MONITORING ranges
      if (willSetupCsHeaders) {
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
            autoAdjustDimensions,
            result.footerRowCount
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
    const stripZeroKey = (v: string) => v.replace(/^0+(?=\d)/, '');
    const existingCodeSet = new Set<string>();
    countsheetItems.forEach((it) => {
      const c = (it.itemCode || '').trim().toLowerCase();
      const b = (it.barcode || '').trim().toLowerCase();
      if (c) {
        existingCodeSet.add(c);
        existingCodeSet.add(stripZeroKey(c));
      }
      if (b) {
        existingCodeSet.add(b);
        existingCodeSet.add(stripZeroKey(b));
      }
    });

    const safeLower = (val: unknown) => String(val ?? '').trim().toLowerCase();
    const qHierarchyLower = safeLower(csHierarchySearchQuery);

    // Unified active IATD item catalog (works whether active IATD is newly updated or original)
    const activeIatdCatalogItems: PreGeneratedCountsheetItem[] = (() => {
      if (fullSourceIatdRows.length > 0) {
        return fullSourceIatdRows
          .filter(
            (row, idx) =>
              Array.isArray(row) &&
              row.some((c) => c !== null && c !== undefined && String(c).trim() !== '') &&
              !isIatdTotalQuantityFooterRow(row) &&
              !isIatdVersionFooterRow(row, idx > 0 ? fullSourceIatdRows[idx - 1] : undefined)
          )
          .map((row, rIdx) =>
            parseIatdRowToCountsheetItem(row, rIdx, detectedCols, newMissingCsCode)
          )
          .filter((parsed) => Boolean(parsed.itemCode || parsed.itemDescription));
      }
      if (importedCountsheetSession.rawItems && importedCountsheetSession.rawItems.length > 0) {
        return importedCountsheetSession.rawItems
          .map((r, rIdx) => {
            const itemObj: PreGeneratedCountsheetItem = {
              id: r.id || `raw_${rIdx}`,
              rowIndex: rIdx,
              csCode: newMissingCsCode,
              sheetTitle: importedCountsheetSession.sourceFile?.tabName || 'COUNTSHEET',
              itemCode: r.itemCode || '',
              barcode: r.barcode || '',
              itemDescription: r.itemDescription || '',
              category: r.category || '',
              subCategory: r.subCategory || '',
              subsubCategory: r.subsubCategory || '',
              unit: r.unit || 'PC',
              cost: Number(r.cost) || 0,
              selling: Number(r.selling) || 0,
              balance: r.balance ?? 0,
              actual: r.actual ?? null,
              raw: [],
            };
            itemObj.raw = buildIatdRowFromCountsheetItem(itemObj, effectiveHeaders);
            return itemObj;
          })
          .filter((parsed) => Boolean(parsed.itemCode || parsed.itemDescription));
      }
      return countsheetItems.map((it, idx) => ({
        ...it,
        rowIndex: idx,
        csCode: newMissingCsCode,
      }));
    })();

    const hierarchySourceItems = showAddMissingPanel ? activeIatdCatalogItems : countsheetItems;

    // 1. UNIQUE CATEGORIES in Countsheet / Active IATD
    const uniqueCsCategories = (() => {
      const map = new Map<string, number>();
      for (const it of hierarchySourceItems) {
        const cat = (it.category ?? '').trim();
        if (!cat) continue;
        if (qHierarchyLower && !safeLower(cat).includes(qHierarchyLower)) continue;
        map.set(cat, (map.get(cat) || 0) + 1);
      }
      return Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name));
    })();

    // 2. UNIQUE SUBCATEGORIES in Countsheet / Active IATD
    const uniqueCsSubCategories = (() => {
      const filtered =
        csSelectedCats.length > 0
          ? hierarchySourceItems.filter((i) =>
              csSelectedCats.some((c) => safeLower(c) === safeLower(i.category))
            )
          : hierarchySourceItems;
      const map = new Map<string, number>();
      for (const it of filtered) {
        const sub = (it.subCategory ?? '').trim();
        const subKey = sub === '' ? '(Blanks)' : sub;
        if (
          qHierarchyLower &&
          !safeLower(subKey).includes(qHierarchyLower) &&
          !safeLower(it.category).includes(qHierarchyLower)
        ) {
          continue;
        }
        map.set(subKey, (map.get(subKey) || 0) + 1);
      }
      return Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
          if (a.name === '(Blanks)') return -1;
          if (b.name === '(Blanks)') return 1;
          return a.name.localeCompare(b.name);
        });
    })();

    // 3. UNIQUE SUBSUBCATEGORIES in Countsheet / Active IATD
    const uniqueCsSubSubCategories = (() => {
      const filtered = hierarchySourceItems.filter((i) => {
        if (csSelectedCats.length > 0 && !csSelectedCats.some((c) => safeLower(c) === safeLower(i.category))) {
          return false;
        }
        if (csSelectedSubCats.length > 0) {
          const sub = (i.subCategory ?? '').trim();
          const match = csSelectedSubCats.some((s) => {
            const sLower = safeLower(s);
            if (sLower === '(blanks)' || sLower === 'blanks') return sub === '';
            return safeLower(sub) === sLower;
          });
          if (!match) return false;
        }
        return true;
      });
      const map = new Map<string, number>();
      for (const it of filtered) {
        const ssc = (it.subsubCategory ?? '').trim();
        const sscKey = ssc === '' ? '(Blanks)' : ssc;
        if (
          qHierarchyLower &&
          !safeLower(sscKey).includes(qHierarchyLower) &&
          !safeLower(it.category).includes(qHierarchyLower)
        ) {
          continue;
        }
        map.set(sscKey, (map.get(sscKey) || 0) + 1);
      }
      return Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
          if (a.name === '(Blanks)') return -1;
          if (b.name === '(Blanks)') return 1;
          return a.name.localeCompare(b.name);
        });
    })();

    // Filtered countsheet items based on CS tab, search query, drilldown category filters, and toggles
    const filteredWithOriginalIndex = countsheetItems
      .map((item, seqIdx) => ({ item, seqIdx }))
      .filter(({ item }) => {
        if (countsheetEditorCsFilter !== 'ALL' && (item.csCode || 'CS01') !== countsheetEditorCsFilter) {
          return false;
        }
        if (countsheetEditorSearch.trim()) {
          const q = countsheetEditorSearch.trim().toLowerCase();
          const matches =
            (item.itemCode || '').toLowerCase().includes(q) ||
            (item.barcode || '').toLowerCase().includes(q) ||
            (item.itemDescription || '').toLowerCase().includes(q) ||
            (item.category || '').toLowerCase().includes(q) ||
            (item.csCode || '').toLowerCase().includes(q);
          if (!matches) return false;
        }
        if (csSelectedCats.length > 0) {
          if (!csSelectedCats.some((c) => safeLower(c) === safeLower(item.category))) {
            return false;
          }
        }
        if (csSelectedSubCats.length > 0) {
          const sub = (item.subCategory ?? '').trim();
          const match = csSelectedSubCats.some((s) => {
            const sLower = safeLower(s);
            if (sLower === '(blanks)' || sLower === 'blanks') return sub === '';
            return safeLower(sub) === sLower;
          });
          if (!match) return false;
        }
        if (csSelectedSubSubCats.length > 0) {
          const ssc = (item.subsubCategory ?? '').trim();
          const match = csSelectedSubSubCats.some((s) => {
            const sLower = safeLower(s);
            if (sLower === '(blanks)' || sLower === 'blanks') return ssc === '';
            return safeLower(ssc) === sLower;
          });
          if (!match) return false;
        }
        if (csOnlyWithBalance && !(Number(item.balance) > 0)) {
          return false;
        }
        if (
          csOnlyWithActual &&
          !(item.actual !== undefined && item.actual !== null && String(item.actual).trim() !== '')
        ) {
          return false;
        }
        if (csOnlyMissingAdded && !item.isMissingItem) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (csItemSortBy === 'itemCode') {
          return (a.item.itemCode || '').localeCompare(b.item.itemCode || '');
        }
        if (csItemSortBy === 'itemDescription') {
          return (a.item.itemDescription || '').localeCompare(b.item.itemDescription || '');
        }
        return a.seqIdx - b.seqIdx;
      });

    const countedCount = countsheetItems.filter(
      (it) => it.actual !== undefined && it.actual !== null && String(it.actual).trim() !== ''
    ).length;
    const missingAddedCount = countsheetItems.filter((it) => it.isMissingItem).length;
    const activeFilteredCounted = filteredWithOriginalIndex.filter(
      ({ item }) => item.actual !== undefined && item.actual !== null && String(item.actual).trim() !== ''
    ).length;

    const candidateIatdItems = activeIatdCatalogItems
      .map((parsed) => {
        const cKey = (parsed.itemCode || '').trim().toLowerCase();
        const bKey = (parsed.barcode || '').trim().toLowerCase();
        const alreadyInCountsheet = Boolean(
          (cKey && (existingCodeSet.has(cKey) || existingCodeSet.has(stripZeroKey(cKey)))) ||
            (bKey && (existingCodeSet.has(bKey) || existingCodeSet.has(stripZeroKey(bKey))))
        );
        return { parsed, alreadyInCountsheet };
      })
      .filter(({ parsed, alreadyInCountsheet }) => {
        if (!parsed.itemCode && !parsed.itemDescription) return false;
        if (onlyShowUnselectedIatd && alreadyInCountsheet) return false;
        if (csSelectedCats.length > 0) {
          if (!csSelectedCats.some((c) => safeLower(c) === safeLower(parsed.category))) {
            return false;
          }
        }
        if (csSelectedSubCats.length > 0) {
          const sub = (parsed.subCategory ?? '').trim();
          const match = csSelectedSubCats.some((s) => {
            const sLower = safeLower(s);
            if (sLower === '(blanks)' || sLower === 'blanks') return sub === '';
            return safeLower(sub) === sLower;
          });
          if (!match) return false;
        }
        if (csSelectedSubSubCats.length > 0) {
          const ssc = (parsed.subsubCategory ?? '').trim();
          const match = csSelectedSubSubCats.some((s) => {
            const sLower = safeLower(s);
            if (sLower === '(blanks)' || sLower === 'blanks') return ssc === '';
            return safeLower(ssc) === sLower;
          });
          if (!match) return false;
        }
        if (!missingIatdSearchQuery.trim()) return true;
        const q = missingIatdSearchQuery.trim().toLowerCase();
        return (
          (parsed.itemCode || '').toLowerCase().includes(q) ||
          (parsed.barcode || '').toLowerCase().includes(q) ||
          (parsed.itemDescription || '').toLowerCase().includes(q) ||
          (parsed.category || '').toLowerCase().includes(q) ||
          (parsed.subCategory || '').toLowerCase().includes(q) ||
          (parsed.subsubCategory || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 200);

    return (
      <div className="space-y-4 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 items-start w-full">
          {/* LEFT COLUMN: IATD Source, Countsheet Source & Hierarchy/Category Selection (30% - lg:col-span-3) */}
          <div className="lg:col-span-3 xl:col-span-3 min-w-0 space-y-3.5">
            {/* 1. Loaded IATD & Countsheet Source Card */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-3 text-xs">
              {/* Top: Loaded IATD Source (matching Create Countsheets) */}
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                        Loaded IATD
                      </span>
                      {(iatdInspection?.sheetTitle || importedCountsheetSession.sourceFile?.tabName) && (
                        <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                          {iatdInspection?.sheetTitle || importedCountsheetSession.sourceFile?.tabName}
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-slate-800 dark:text-white truncate block mt-0.5 text-xs sm:text-sm">
                      {iatdInspection?.spreadsheetTitle ||
                        importedCountsheetSession.sourceFile?.name ||
                        importedCountsheetSession.spreadsheetName}
                    </span>
                    <span className="text-slate-400 truncate block text-[11px]">
                      {activeIatdCatalogItems.length.toLocaleString()} items in IATD
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowUpdateIatdPanel((prev) => !prev)}
                  className={`px-2.5 py-1 rounded-lg border font-semibold transition-colors shrink-0 text-[11px] cursor-pointer ${
                    showUpdateIatdPanel
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                  }`}
                  title="Update or change the active IATD source"
                >
                  Change IATD
                </button>
              </div>

              {/* Bottom: Loaded Countsheet & Status */}
              <div className="pt-2.5 border-t border-slate-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      Countsheet:
                    </span>
                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                      {countsheetItems.length} selected • {countedCount}/{countsheetItems.length} Actuals
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-slate-600 dark:text-zinc-300 truncate block mt-0.5">
                    {importedCountsheetSession.spreadsheetName}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {countsheetSaveMsg && (
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">
                      {countsheetSaveMsg}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setImportedCountsheetSession(null);
                      setCountsheetItems([]);
                    }}
                    className="px-2 py-0.5 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400 font-semibold transition-colors text-[10px] cursor-pointer"
                    title="Switch to a different countsheet session"
                  >
                    Switch CS
                  </button>
                </div>
              </div>
            </div>

            {/* 2. Countsheets (CS01, CS02...) Vertical List & Sheet Name Card */}
            <div className="space-y-2.5 p-3 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-zinc-200">
                  <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Countsheets ({availableCsCodes.length})</span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddMissingPanel((prev) => !prev)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                    showAddMissingPanel
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                  }`}
                  title="Add missing item to countsheet"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Item</span>
                </button>
              </div>

              {/* Vertical List of CS01, CS02 Onwards */}
              <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
                {/* ALL Countsheets Filter Tab */}
                <div
                  onClick={() => setCountsheetEditorCsFilter('ALL')}
                  className={`group relative w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl cursor-pointer text-xs font-semibold transition-all border ${
                    countsheetEditorCsFilter === 'ALL'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-800 hover:bg-slate-100/80 dark:hover:bg-zinc-800/80 hover:border-blue-300 dark:hover:border-blue-700'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`font-mono font-bold px-2 py-0.5 rounded-lg text-[11px] shrink-0 ${
                        countsheetEditorCsFilter === 'ALL'
                          ? 'bg-white/20 text-white'
                          : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200/70 dark:border-blue-800/60'
                      }`}
                    >
                      ALL
                    </span>
                    <span
                      className={`truncate text-xs ${
                        countsheetEditorCsFilter === 'ALL'
                          ? 'text-white font-bold'
                          : 'text-slate-700 dark:text-zinc-200 font-medium'
                      }`}
                    >
                      All Countsheets
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[10.5px] px-2 py-0.5 rounded-full font-mono font-bold ${
                        countsheetEditorCsFilter === 'ALL'
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400'
                      }`}
                    >
                      {countsheetItems.length} items
                    </span>
                  </div>
                </div>

                {/* Individual CS Tabs */}
                {availableCsCodes.map((cs) => {
                  const isSelected = countsheetEditorCsFilter === cs;
                  const itemsCount = countsheetItems.filter((i) => (i.csCode || 'CS01') === cs).length;

                  return (
                    <div
                      key={`cs_tab_btn_${cs}`}
                      onClick={() => setCountsheetEditorCsFilter(cs)}
                      className={`group relative w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl cursor-pointer text-xs font-semibold transition-all border ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-800 hover:bg-slate-100/80 dark:hover:bg-zinc-800/80 hover:border-blue-300 dark:hover:border-blue-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded-lg text-[11px] shrink-0 ${
                            isSelected
                              ? 'bg-white/20 text-white'
                              : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200/70 dark:border-blue-800/60'
                          }`}
                        >
                          {cs}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-[10.5px] px-2 py-0.5 rounded-full font-mono font-bold ${
                            isSelected
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400'
                          }`}
                        >
                          {itemsCount} {itemsCount === 1 ? 'item' : 'items'}
                        </span>

                        {availableCsCodes.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveCountsheetCsGroup(cs);
                            }}
                            title={`Remove ${cs} (${itemsCount} items)`}
                            className={`p-1 rounded-lg transition-colors cursor-pointer ${
                              isSelected
                                ? 'hover:bg-white/20 text-white/80 hover:text-white'
                                : 'hover:bg-rose-100 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400'
                            }`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Sheet Name & Selected Count Bar */}
              <div className="pt-2 border-t border-slate-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-500 dark:text-zinc-400 font-medium">Sheet Name:</span>
                  <span className="font-bold text-blue-700 dark:text-blue-300 truncate">
                    {countsheetEditorCsFilter === 'ALL'
                      ? (importedCountsheetSession.spreadsheetName || 'All Countsheets')
                      : countsheetEditorCsFilter}
                  </span>
                </div>

                <div className="font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5 font-mono text-[11px] shrink-0">
                  <span>{filteredWithOriginalIndex.length} items</span>
                </div>
              </div>
            </div>

            {/* 3. Category / SubCat / SubSubCat Selection Card */}
            <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-zinc-800/70 border border-slate-200 dark:border-zinc-700/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCsActiveHeaderButton('cat')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                      csActiveHeaderButton === 'cat'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                    }`}
                  >
                    <span>Category</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                        csActiveHeaderButton === 'cat'
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300'
                      }`}
                    >
                      {uniqueCsCategories.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCsActiveHeaderButton('subCat')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                      csActiveHeaderButton === 'subCat'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                    }`}
                  >
                    <span>SubCat</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                        csActiveHeaderButton === 'subCat'
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300'
                      }`}
                    >
                      {uniqueCsSubCategories.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCsActiveHeaderButton('subSubCat')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                      csActiveHeaderButton === 'subSubCat'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                    }`}
                  >
                    <span>SubSubCat</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                        csActiveHeaderButton === 'subSubCat'
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300'
                      }`}
                    >
                      {uniqueCsSubSubCategories.length}
                    </span>
                  </button>
                </div>

                {(csSelectedCats.length > 0 ||
                  csSelectedSubCats.length > 0 ||
                  csSelectedSubSubCats.length > 0 ||
                  csHierarchySearchQuery) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCsSelectedCats([]);
                      setCsSelectedSubCats([]);
                      setCsSelectedSubSubCats([]);
                      setCsHierarchySearchQuery('');
                    }}
                    className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline shrink-0 cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Active Filter Pills */}
              {(csSelectedCats.length > 0 || csSelectedSubCats.length > 0 || csSelectedSubSubCats.length > 0) && (
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {csSelectedCats.map((cat) => (
                    <span
                      key={`sel_cat_${cat}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 border border-blue-200 dark:border-blue-800/70 font-semibold text-blue-700 dark:text-blue-300 text-[11px]"
                    >
                      <span>{cat}</span>
                      <button
                        type="button"
                        onClick={() => setCsSelectedCats((p) => p.filter((x) => x !== cat))}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 ml-0.5 cursor-pointer font-bold"
                        title={`Remove category ${cat}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  {csSelectedSubCats.map((subCat) => (
                    <span
                      key={`sel_subcat_${subCat}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 border border-indigo-200 dark:border-indigo-800/70 font-semibold text-indigo-700 dark:text-indigo-300 text-[11px]"
                    >
                      <span>{subCat}</span>
                      <button
                        type="button"
                        onClick={() => setCsSelectedSubCats((p) => p.filter((x) => x !== subCat))}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 ml-0.5 cursor-pointer font-bold"
                        title={`Remove subcategory ${subCat}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  {csSelectedSubSubCats.map((ssc) => (
                    <span
                      key={`sel_subsubcat_${ssc}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 border border-purple-200 dark:border-purple-800/70 font-semibold text-purple-700 dark:text-purple-300 text-[11px]"
                    >
                      <span>{ssc}</span>
                      <button
                        type="button"
                        onClick={() => setCsSelectedSubSubCats((p) => p.filter((x) => x !== ssc))}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 ml-0.5 cursor-pointer font-bold"
                        title={`Remove sub-subcategory ${ssc}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search Bar for Category Drill-Down */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={csHierarchySearchQuery}
                  onChange={(e) => setCsHierarchySearchQuery(e.target.value)}
                  placeholder={`Search ${
                    csActiveHeaderButton === 'cat'
                      ? 'categories'
                      : csActiveHeaderButton === 'subCat'
                      ? 'subcategories'
                      : 'sub-subcategories'
                  }...`}
                  className="w-full pl-8 pr-7 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {csHierarchySearchQuery && (
                  <button
                    type="button"
                    onClick={() => setCsHierarchySearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Category / SubCat / SubSubCat Options Chips List */}
              <div className="p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                {csActiveHeaderButton === 'cat' && (
                  uniqueCsCategories.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-56 lg:max-h-72 overflow-y-auto pr-1">
                      {uniqueCsCategories.map((c) => {
                        const isSel = csSelectedCats.some(
                          (sel) => safeLower(sel) === safeLower(c.name)
                        );
                        return (
                          <button
                            key={c.name}
                            type="button"
                            onClick={() =>
                              setCsSelectedCats((prev) =>
                                prev.some((x) => safeLower(x) === safeLower(c.name))
                                  ? prev.filter((x) => safeLower(x) !== safeLower(c.name))
                                  : [...prev, c.name]
                              )
                            }
                            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all border inline-flex items-center gap-1.5 cursor-pointer ${
                              isSel
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                            }`}
                          >
                            {isSel && <Check className="w-3 h-3 shrink-0" />}
                            <span>
                              {c.name} <span className="opacity-70 text-[10px]">({c.count})</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-400">
                      No categories found.
                    </div>
                  )
                )}

                {csActiveHeaderButton === 'subCat' && (
                  uniqueCsSubCategories.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-56 lg:max-h-72 overflow-y-auto pr-1">
                      {uniqueCsSubCategories.map((sc) => {
                        const isSel = csSelectedSubCats.some(
                          (sel) => safeLower(sel) === safeLower(sc.name)
                        );
                        return (
                          <button
                            key={sc.name}
                            type="button"
                            onClick={() =>
                              setCsSelectedSubCats((prev) =>
                                prev.some((x) => safeLower(x) === safeLower(sc.name))
                                  ? prev.filter((x) => safeLower(x) !== safeLower(sc.name))
                                  : [...prev, sc.name]
                              )
                            }
                            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all border inline-flex items-center gap-1.5 cursor-pointer ${
                              isSel
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                            }`}
                          >
                            {isSel && <Check className="w-3 h-3 shrink-0" />}
                            <span>
                              {sc.name} <span className="opacity-70 text-[10px]">({sc.count})</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-400">
                      No subcategories found.
                    </div>
                  )
                )}

                {csActiveHeaderButton === 'subSubCat' && (
                  uniqueCsSubSubCategories.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-56 lg:max-h-72 overflow-y-auto pr-1">
                      {uniqueCsSubSubCategories.map((ssc) => {
                        const isSel = csSelectedSubSubCats.some(
                          (sel) => safeLower(sel) === safeLower(ssc.name)
                        );
                        return (
                          <button
                            key={ssc.name}
                            type="button"
                            onClick={() =>
                              setCsSelectedSubSubCats((prev) =>
                                prev.some((x) => safeLower(x) === safeLower(ssc.name))
                                  ? prev.filter((x) => safeLower(x) !== safeLower(ssc.name))
                                  : [...prev, ssc.name]
                              )
                            }
                            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all border inline-flex items-center gap-1.5 cursor-pointer ${
                              isSel
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                            }`}
                          >
                            {isSel && <Check className="w-3 h-3 shrink-0" />}
                            <span>
                              {ssc.name} <span className="opacity-70 text-[10px]">({ssc.count})</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-400">
                      No sub-subcategories found.
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Search Toolbar, Missing Panel, Allocation Ribbon & Items Table (70% - lg:col-span-7) */}
          <div className="lg:col-span-7 xl:col-span-7 min-w-0 space-y-3.5">
            {/* ITEM SEARCH & SIMPLE ACTION BUTTONS TOOLBAR */}
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={countsheetEditorSearch}
                    onChange={(e) => setCountsheetEditorSearch(e.target.value)}
                    placeholder="Search items in countsheet..."
                    className="w-full pl-10 pr-8 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                  />
                  {countsheetEditorSearch && (
                    <button
                      type="button"
                      onClick={() => setCountsheetEditorSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const headersToUse =
                        iatdInspection && iatdInspection.headers.length > 0
                          ? iatdInspection.headers
                          : importedCountsheetSession?.iatdHeaders &&
                            importedCountsheetSession.iatdHeaders.length > 0
                          ? importedCountsheetSession.iatdHeaders
                          : SYNTHETIC_IATD_HEADERS;
                      const targetCsFilter = countsheetEditorCsFilter || 'ALL';
                      const isAllCs = targetCsFilter === 'ALL';
                      const targetItemIds = new Set(
                        countsheetItems
                          .filter((it) => isAllCs || (it.csCode || 'CS01') === targetCsFilter)
                          .map((it) => it.id)
                      );

                      setCsOnlyWithBalance(false);
                      setEditingQtyDrafts((prev) => {
                        const next = { ...prev };
                        Object.keys(next).forEach((k) => {
                          if (!k.startsWith('balance_')) return;
                          const itemId = k.slice('balance_'.length);
                          if (isAllCs || targetItemIds.has(itemId)) {
                            delete next[k];
                          }
                        });
                        return next;
                      });
                      setCountsheetItems((prev) =>
                        prev.map((it) => {
                          if (!isAllCs && (it.csCode || 'CS01') !== targetCsFilter) {
                            return it;
                          }
                          const updated: PreGeneratedCountsheetItem = {
                            ...it,
                            balance: null,
                            amount: 0,
                          };
                          updated.raw = buildIatdRowFromCountsheetItem(updated, headersToUse);
                          return updated;
                        })
                      );
                      setCountsheetSaveMsg(
                        isAllCs ? 'All balances removed' : `${targetCsFilter} balances removed`
                      );
                      setTimeout(() => setCountsheetSaveMsg(null), 3000);
                      setTimeout(() => {
                        const firstBalanceInput = document.querySelector<HTMLInputElement>(
                          'input[data-balance-qty-row="0"]'
                        );
                        if (firstBalanceInput) {
                          firstBalanceInput.focus();
                        }
                      }, 50);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 text-xs font-bold transition cursor-pointer"
                    title={
                      countsheetEditorCsFilter === 'ALL'
                        ? 'Remove all balances across all countsheets'
                        : `Remove balances in ${countsheetEditorCsFilter} only`
                    }
                  >
                    Remove Balances
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUpdateIatdPanel((prev) => !prev);
                      setUpdateIatdError(null);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                      showUpdateIatdPanel
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-zinc-700'
                    }`}
                    title="Select an updated IATD spreadsheet with the latest inventory list"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingIatdSource ? 'animate-spin' : ''}`} />
                    <span>{showUpdateIatdPanel ? 'Hide Update IATD' : 'Update IATD'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAddMissingPanel((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                      showAddMissingPanel
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{showAddMissingPanel ? 'Hide Add Items' : 'Add Items'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePersistEditedCountsheetSession}
                    disabled={isSavingEditsLoading}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all duration-200 cursor-pointer shadow-2xs select-none active:scale-95 ${
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
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        <span>Saved!</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Edits</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Toolbar Filter Toggles & Sort Menu */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/80 dark:border-zinc-800/80">
                <div className="flex items-center gap-2 flex-wrap">
                  <label
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
                      csOnlyWithBalance
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-900 dark:text-amber-200'
                        : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={csOnlyWithBalance}
                      onChange={(e) => setCsOnlyWithBalance(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                    />
                    <span>With Balance</span>
                  </label>

                  <label
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
                      csOnlyWithActual
                        ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-900 dark:text-indigo-200'
                        : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={csOnlyWithActual}
                      onChange={(e) => setCsOnlyWithActual(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                    />
                    <span>Entered Actuals ({countedCount})</span>
                  </label>

                  {missingAddedCount > 0 && (
                    <label
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
                        csOnlyMissingAdded
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-900 dark:text-amber-200'
                          : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={csOnlyMissingAdded}
                        onChange={(e) => setCsOnlyMissingAdded(e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer accent-amber-600"
                      />
                      <span>Missing Added ({missingAddedCount})</span>
                    </label>
                  )}
                </div>

                {/* Sort Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCsShowSortDropdown((prev) => !prev)}
                    className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 hover:border-blue-500 text-slate-700 dark:text-zinc-200 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>
                      Sort:{' '}
                      {csItemSortBy === 'itemCode'
                        ? 'Code'
                        : csItemSortBy === 'itemDescription'
                        ? 'Description'
                        : 'Default'}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        csShowSortDropdown ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {csShowSortDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setCsShowSortDropdown(false)}
                      />
                      <div
                        data-scroll-lock-panel
                        className="absolute right-0 mt-1.5 w-44 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 shadow-xl py-1 z-30"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setCsItemSortBy('seq');
                            setCsShowSortDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                            csItemSortBy === 'seq'
                              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                              : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <span>Default Order</span>
                          {csItemSortBy === 'seq' && (
                            <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCsItemSortBy('itemCode');
                            setCsShowSortDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                            csItemSortBy === 'itemCode'
                              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                              : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <span>Item Code</span>
                          {csItemSortBy === 'itemCode' && (
                            <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCsItemSortBy('itemDescription');
                            setCsShowSortDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                            csItemSortBy === 'itemDescription'
                              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                              : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <span>Item Description</span>
                          {csItemSortBy === 'itemDescription' && (
                            <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* UPDATE IATD INVENTORY SOURCE PANEL */}
            {showUpdateIatdPanel && (
              <div className="p-3.5 bg-white dark:bg-zinc-900 border border-blue-300 dark:border-blue-800/70 rounded-2xl space-y-3 animate-in fade-in shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-zinc-800 pb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Database className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        Update IATD Inventory List
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                        Current IATD:{' '}
                        <strong className="text-slate-700 dark:text-zinc-200">
                          {iatdInspection?.spreadsheetTitle || importedCountsheetSession.sourceFile?.name || 'None'}
                        </strong>{' '}
                        ({fullSourceIatdRows.length.toLocaleString()} inventory items loaded)
                      </div>
                    </div>
                  </div>

                  {iatdTabs.length > 1 && iatdInputId && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="font-semibold text-slate-600 dark:text-slate-400">Sheet Tab:</span>
                      <CustomSelect
                        value={selectedIatdTab || iatdTabs[0]?.title || ''}
                        onChange={(val) => {
                          setSelectedIatdTab(val);
                          handleApplyUpdatedIatdForCountsheet(iatdInputId, val);
                        }}
                        variant="compact"
                        menuMinWidth={150}
                        options={iatdTabs.map((t) => ({
                          value: t.title,
                          label: t.title,
                        }))}
                      />
                    </div>
                  )}
                </div>

                {/* Option 1: Paste Updated IATD Google Sheet URL or ID */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[220px]">
                    <input
                      type="text"
                      placeholder="Paste updated IATD Google Sheet link or Spreadsheet ID..."
                      value={updateIatdUrlInput}
                      onChange={(e) => setUpdateIatdUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && updateIatdUrlInput.trim()) {
                          e.preventDefault();
                          handleApplyUpdatedIatdForCountsheet(updateIatdUrlInput.trim());
                        }
                      }}
                      className="w-full text-xs px-3 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={!updateIatdUrlInput.trim() || isUpdatingIatdSource}
                    onClick={() => handleApplyUpdatedIatdForCountsheet(updateIatdUrlInput.trim())}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {isUpdatingIatdSource ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Loading IATD...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Load Updated IATD</span>
                      </>
                    )}
                  </button>
                </div>

                {updateIatdError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{updateIatdError}</span>
                  </div>
                )}

                {/* Option 2: Search & Pick Updated IATD from Google Drive or Branch Emails */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setUpdateIatdSourceTab('DRIVE')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                          updateIatdSourceTab === 'DRIVE'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Google Drive
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUpdateIatdSourceTab('EMAIL');
                          handleRefreshEmails();
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition ${
                          updateIatdSourceTab === 'EMAIL'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <Mail className="w-3 h-3" />
                        <span>Branch Emails</span>
                      </button>
                    </div>
                  </div>

                  {updateIatdSourceTab === 'DRIVE' ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            placeholder="Search updated IATD spreadsheet in Google Drive..."
                            value={updateIatdSearchQuery}
                            onChange={(e) => setUpdateIatdSearchQuery(e.target.value)}
                            className="w-full text-xs pl-7 pr-3 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
                        </div>
                        <button
                          type="button"
                          onClick={handleRefreshDrive}
                          disabled={isSearchingDrive}
                          className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          title="Refresh Google Drive spreadsheets"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSearchingDrive ? 'animate-spin' : ''}`} />
                          <span>Refresh</span>
                        </button>
                      </div>

                      <div
                        data-scroll-lock-panel
                        className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-xl"
                      >
                        {(() => {
                          const q = updateIatdSearchQuery.trim().toLowerCase();
                          const filteredDrive = driveFiles.filter(
                            (f) => !q || (f.name || '').toLowerCase().includes(q)
                          );
                          if (filteredDrive.length === 0) {
                            return (
                              <div className="p-4 text-center text-xs text-slate-400">
                                {isSearchingDrive
                                  ? 'Searching Google Drive spreadsheets...'
                                  : 'No matching spreadsheets found in Google Drive.'}
                              </div>
                            );
                          }
                          return filteredDrive.slice(0, 30).map((file) => {
                            const isCurrentIatd = iatdInspection?.spreadsheetId === file.id;
                            return (
                              <div
                                key={`upd_iatd_${file.id}`}
                                className="p-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-zinc-800/60"
                              >
                                <div className="min-w-0 flex-1 flex items-center gap-2">
                                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <div className="min-w-0">
                                    <div className="font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                      <span className="truncate">{file.name}</span>
                                      {isCurrentIatd && (
                                        <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold shrink-0">
                                          Active IATD
                                        </span>
                                      )}
                                    </div>
                                    {file.modifiedTime && (
                                      <div className="text-[10px] text-slate-400">
                                        Modified: {new Date(file.modifiedTime).toLocaleString()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={isUpdatingIatdSource}
                                  onClick={() => handleApplyUpdatedIatdForCountsheet(file.id, undefined, file)}
                                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                                >
                                  <span>Select IATD</span>
                                </button>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            placeholder="Filter emailed branch spreadsheets..."
                            value={emailQuery}
                            onChange={(e) => setEmailQuery(e.target.value)}
                            className="w-full text-xs pl-7 pr-3 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRefreshEmails()}
                          disabled={isSearchingEmail}
                          className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSearchingEmail ? 'animate-spin' : ''}`} />
                          <span>Refresh</span>
                        </button>
                      </div>

                      <div
                        data-scroll-lock-panel
                        className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-xl"
                      >
                        {(() => {
                          const q = emailQuery.trim().toLowerCase();
                          const filteredEmails = emailMessages.filter(
                            (m) =>
                              !q ||
                              (m.subject || '').toLowerCase().includes(q) ||
                              (m.fromName || '').toLowerCase().includes(q) ||
                              (m.fromEmail || '').toLowerCase().includes(q) ||
                              m.attachments.some((a) => (a.filename || '').toLowerCase().includes(q))
                          );
                          if (filteredEmails.length === 0) {
                            return (
                              <div className="p-4 text-center text-xs text-slate-400">
                                {isSearchingEmail
                                  ? 'Searching branch email attachments...'
                                  : 'No matching branch email spreadsheets found.'}
                              </div>
                            );
                          }
                          return filteredEmails.slice(0, 20).flatMap((msg) =>
                            msg.attachments.map((att) => {
                              const convKey = `${msg.messageId}:${att.filename}`;
                              const convertedRecord = convertedSheetsMap[convKey];
                              const isConverting = convertingAttachmentKey === convKey;
                              return (
                                <div
                                  key={`upd_email_${convKey}`}
                                  className="p-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-zinc-800/60"
                                >
                                  <div className="min-w-0 flex-1 flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                    <div className="min-w-0">
                                      <div className="font-bold text-slate-900 dark:text-white truncate">
                                        {att.filename}
                                      </div>
                                      <div className="text-[10px] text-slate-400 truncate">
                                        {msg.subject}
                                      </div>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={isUpdatingIatdSource || isConverting}
                                    onClick={async () => {
                                      if (convertedRecord?.spreadsheetId) {
                                        await handleApplyUpdatedIatdForCountsheet(convertedRecord.spreadsheetId);
                                      } else {
                                        try {
                                          setConvertingAttachmentKey(convKey);
                                          const tokenToUse =
                                            (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) ||
                                            effectiveToken ||
                                            '';
                                          const cleanSubject = (msg.subject || '')
                                            .replace(/^(re|fwd|fw):\s*/i, '')
                                            .trim();
                                          const baseFilename = att.filename
                                            .replace(/\.(xlsx|xls|xlsm|csv|ods)$/i, '')
                                            .trim();
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
                                          await handleApplyUpdatedIatdForCountsheet(converted.id, undefined, converted);
                                        } catch (e: any) {
                                          setUpdateIatdError(
                                            e?.message || 'Failed to convert email attachment to Google Sheet.'
                                          );
                                        } finally {
                                          setConvertingAttachmentKey(null);
                                        }
                                      }
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                                  >
                                    {isConverting ? (
                                      <>
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                        <span>Converting...</span>
                                      </>
                                    ) : (
                                      <span>{convertedRecord?.spreadsheetId ? 'Select IATD' : 'Convert & Use IATD'}</span>
                                    )}
                                  </button>
                                </div>
                              );
                            })
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ADD MISSING INVENTORY ITEM PANEL */}
            {showAddMissingPanel && (
              <div className="p-3.5 bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-800/70 rounded-2xl space-y-3 animate-in fade-in shadow-xs">
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
                      Search from Active IATD ({activeIatdCatalogItems.length.toLocaleString()})
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
                            value={insertPositionMode === 'AFTER_SEQ' ? 'END' : insertPositionMode}
                            onChange={(val) => setInsertPositionMode(val as 'END' | 'START' | 'AFTER_SEQ')}
                            variant="compact"
                            menuMinWidth={160}
                            options={[
                              { value: 'END', label: `End of ${activeTargetCs}` },
                              { value: 'START', label: `Start of ${activeTargetCs}` },
                            ]}
                          />
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
                          placeholder="Search item from active IATD by Code, Barcode, Description, or Category..."
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

                    <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-xl">
                      {candidateIatdItems.length > 0 ? (
                        candidateIatdItems.map(({ parsed, alreadyInCountsheet }) => {
                          const activeTargetCs =
                            (countsheetEditorCsFilter !== 'ALL' ? countsheetEditorCsFilter : newMissingCsCode) ||
                            availableCsCodes[0] ||
                            'CS01';

                          return (
                            <div
                              key={`missing_cand_${parsed.id}_${parsed.itemCode}`}
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
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                                  <span>Cat: {parsed.category || '—'}</span>
                                  <span>•</span>
                                  <span>Unit: {parsed.unit}</span>
                                  <span>•</span>
                                  <span>Cost: <strong>{Number(parsed.cost || 0).toFixed(2)}</strong></span>
                                  <span>•</span>
                                  <span>Sell: <strong>{Number(parsed.selling || 0).toFixed(2)}</strong></span>
                                  <span>•</span>
                                  <span>Bal: <strong>{parsed.balance ?? 0}</strong></span>
                                  <span>•</span>
                                  <span>
                                    Amt:{' '}
                                    <strong>
                                      {Number(
                                        parsed.amount !== undefined
                                          ? parsed.amount
                                          : Number(parsed.balance ?? 0) * Number(parsed.cost || 0)
                                      ).toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                    </strong>
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  insertMissingItemAtConfiguredPosition(
                                    {
                                      ...parsed,
                                      id: `missing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                      csCode: activeTargetCs,
                                      isMissingItem: true,
                                    },
                                    activeTargetCs
                                  );
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
                          {activeIatdCatalogItems.length === 0
                            ? 'No IATD items loaded yet. You can select an IATD via "Update IATD" or switch to "Add Custom / Unlisted Item" above.'
                            : onlyShowUnselectedIatd && !missingIatdSearchQuery.trim()
                            ? 'All items from the active IATD are already in the countsheet. Uncheck "Only show items missing from countsheet" to view or re-add items.'
                            : 'No matching items found in the active IATD.'}
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
                          type="text"
                          inputMode="text"
                          placeholder="Bal"
                          value={customMissingItem.balance}
                          onChange={(e) => setCustomMissingItem((p) => ({ ...p, balance: e.target.value }))}
                          onBlur={(e) => {
                            const evaluated = evaluateQtyFormula(e.target.value, true);
                            if (evaluated !== null) {
                              setCustomMissingItem((p) => ({ ...p, balance: String(evaluated) }));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const evaluated = evaluateQtyFormula(e.currentTarget.value, true);
                              if (evaluated !== null) {
                                setCustomMissingItem((p) => ({ ...p, balance: String(evaluated) }));
                              }
                            }
                          }}
                          className="w-1/2 text-xs px-2 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          inputMode="text"
                          placeholder="Act"
                          value={customMissingItem.actual}
                          onChange={(e) => setCustomMissingItem((p) => ({ ...p, actual: e.target.value }))}
                          onBlur={(e) => {
                            const evaluated = evaluateQtyFormula(e.target.value, true);
                            if (evaluated !== null) {
                              setCustomMissingItem((p) => ({ ...p, actual: String(evaluated) }));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const evaluated = evaluateQtyFormula(e.currentTarget.value, true);
                              if (evaluated !== null) {
                                setCustomMissingItem((p) => ({ ...p, actual: String(evaluated) }));
                              }
                            }
                          }}
                          className="w-1/2 text-xs px-2 py-1.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-6 flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={!customMissingItem.itemDescription.trim() && !customMissingItem.itemCode.trim()}
                        onClick={() => {
                          const evalBal = evaluateQtyFormula(customMissingItem.balance, true);
                          const balNum = evalBal !== null ? evalBal : parseFloat(customMissingItem.balance) || 0;
                          const evalAct = evaluateQtyFormula(customMissingItem.actual, true);
                          const actNum =
                            customMissingItem.actual.trim() !== ''
                              ? evalAct !== null
                                ? evalAct
                                : parseFloat(customMissingItem.actual)
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

            {/* LIVE ALLOCATION RIBBON */}
            <div className="px-3 py-1.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5 text-slate-600 dark:text-zinc-300">
                <span className="font-semibold text-slate-800 dark:text-zinc-100">
                  {countsheetEditorCsFilter === 'ALL' ? 'All Countsheets' : countsheetEditorCsFilter} Allocation:
                </span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {filteredWithOriginalIndex.length} items
                </span>
                <span>·</span>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {activeFilteredCounted} actuals entered
                </span>
                {missingAddedCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="px-1.5 py-0.2 rounded-md bg-amber-100/80 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300/70 dark:border-amber-800/70 font-semibold">
                      {missingAddedCount} missing added
                    </span>
                  </>
                )}
              </div>
              <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {Math.round(
                  (activeFilteredCounted / Math.max(1, filteredWithOriginalIndex.length)) * 100
                )}% Complete
              </div>
            </div>

            {/* ORDERED COUNTSHEET ITEMS TABLE */}
            <div className="border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-xs">
              <div
                ref={countsheetTableScrollRef}
                className={`max-h-[460px] lg:max-h-[520px] xl:max-h-[580px] overflow-x-auto overflow-y-auto ${
                  draggingItemId ? 'select-none cursor-grabbing' : ''
                }`}
              >
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-zinc-800/80 sticky top-0 z-10 border-b border-slate-200 dark:border-zinc-700">
                    <tr>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300 whitespace-nowrap">Code</th>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300">Description</th>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300 text-right whitespace-nowrap">Cost</th>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300 text-right whitespace-nowrap">Selling</th>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300 text-right whitespace-nowrap">Balance</th>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300 text-right whitespace-nowrap">Actual Qty</th>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300 text-right whitespace-nowrap">Variance</th>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300 text-center whitespace-nowrap">Unit</th>
                      <th className="p-2.5 font-bold text-slate-700 dark:text-zinc-300">Category</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60 font-mono text-[11px]">
                    {filteredWithOriginalIndex.length > 0 ? (
                      filteredWithOriginalIndex.map(({ item, seqIdx }, rowIdx) => {
                        const hasActual =
                          item.actual !== undefined && item.actual !== null && String(item.actual).trim() !== '';
                        const variance = hasActual ? Number(item.actual) - Number(item.balance || 0) : null;
                        const rowKeyId = item.id || `row_${seqIdx}`;
                        const isDraggingThisRow = draggingItemId === rowKeyId;

                        return (
                          <tr
                            key={rowKeyId}
                            data-seq-idx={seqIdx}
                            onMouseDown={(e) => {
                              if (e.button !== 0) return;
                              const targetEl = e.target as HTMLElement;
                              if (
                                targetEl.closest('input, button, select, textarea, a, [data-no-row-drag]')
                              ) {
                                return;
                              }
                              rowDragStateRef.current = {
                                seqIdx,
                                itemId: rowKeyId,
                                startY: e.clientY,
                                lastClientY: e.clientY,
                                isDragging: false,
                              };
                            }}
                            title="Drag with mouse to move item in sequence"
                            className={`group transition-colors ${
                              isDraggingThisRow
                                ? 'bg-indigo-50/95 dark:bg-indigo-950/60 ring-1 ring-indigo-500/50 shadow-sm cursor-grabbing'
                                : item.isMissingItem
                                ? 'bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50/70 dark:hover:bg-amber-950/35 cursor-grab'
                                : 'hover:bg-slate-50/90 dark:hover:bg-zinc-800/50 cursor-grab'
                            }`}
                          >
                            <td className="p-2.5 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <GripVertical className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500 group-hover:text-indigo-500 shrink-0 transition-colors" />
                                <span>{item.itemCode || item.barcode || '—'}</span>
                              </div>
                            </td>
                            <td className="p-2.5 font-sans font-medium text-slate-900 dark:text-white">
                              <div className="flex items-center gap-1.5">
                                <span>{item.itemDescription}</span>
                                {item.isMissingItem && (
                                  <span className="shrink-0 text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
                                    Added Missing
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                              {item.cost ? Number(item.cost).toFixed(2) : '—'}
                            </td>
                            <td className="p-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                              {item.selling ? Number(item.selling).toFixed(2) : '—'}
                            </td>
                            <td className="p-2.5 text-right">
                              <input
                                type="text"
                                inputMode="text"
                                placeholder="—"
                                data-balance-qty-row={rowIdx}
                                value={
                                  editingQtyDrafts[`balance_${item.id}`] !== undefined
                                    ? editingQtyDrafts[`balance_${item.id}`]
                                    : item.balance !== undefined && item.balance !== null
                                    ? String(item.balance)
                                    : ''
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const draftKey = `balance_${item.id}`;
                                  setEditingQtyDrafts((prev) => ({ ...prev, [draftKey]: raw }));
                                  if (raw.trim() === '') {
                                    handleUpdateCountsheetItem(seqIdx, { balance: null });
                                  } else {
                                    const evaluated = evaluateQtyFormula(raw, false);
                                    if (evaluated !== null) {
                                      handleUpdateCountsheetItem(seqIdx, { balance: evaluated });
                                    }
                                  }
                                }}
                                onBlur={(e) => {
                                  const raw = e.currentTarget.value;
                                  const draftKey = `balance_${item.id}`;
                                  if (raw.trim() === '') {
                                    handleUpdateCountsheetItem(seqIdx, { balance: null });
                                  } else {
                                    const evaluated = evaluateQtyFormula(raw, true);
                                    if (evaluated !== null) {
                                      handleUpdateCountsheetItem(seqIdx, { balance: evaluated });
                                    }
                                  }
                                  setEditingQtyDrafts((prev) => {
                                    if (prev[draftKey] === undefined) return prev;
                                    const next = { ...prev };
                                    delete next[draftKey];
                                    return next;
                                  });
                                }}
                                onWheel={(e) => (e.target as HTMLElement).blur()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const raw = e.currentTarget.value;
                                    const draftKey = `balance_${item.id}`;
                                    if (raw.trim() === '') {
                                      handleUpdateCountsheetItem(seqIdx, { balance: null });
                                    } else {
                                      const evaluated = evaluateQtyFormula(raw, true);
                                      if (evaluated !== null) {
                                        handleUpdateCountsheetItem(seqIdx, { balance: evaluated });
                                      }
                                    }
                                    setEditingQtyDrafts((prev) => {
                                      if (prev[draftKey] === undefined) return prev;
                                      const next = { ...prev };
                                      delete next[draftKey];
                                      return next;
                                    });
                                    const tbody = e.currentTarget.closest('tbody');
                                    const nextInput = tbody?.querySelector<HTMLInputElement>(
                                      `input[data-balance-qty-row="${rowIdx + 1}"]`
                                    );
                                    if (nextInput) {
                                      nextInput.focus();
                                      nextInput.scrollIntoView({ block: 'nearest' });
                                    }
                                  } else if (e.key === 'Backspace') {
                                    const input = e.currentTarget;
                                    const currentVal = input.value;
                                    const draftKey = `balance_${item.id}`;

                                    // If there is no character, go to the previous item and delete it
                                    if (!currentVal || currentVal.trim() === '') {
                                      e.preventDefault();
                                      setEditingQtyDrafts((prev) => {
                                        if (prev[draftKey] === undefined) return prev;
                                        const next = { ...prev };
                                        delete next[draftKey];
                                        return next;
                                      });
                                      if (rowIdx > 0) {
                                        const prevRowIdx = rowIdx - 1;
                                        const prevEntry = filteredWithOriginalIndex[prevRowIdx];
                                        if (prevEntry) {
                                          const prevDraftKey = `balance_${prevEntry.item.id}`;
                                          setEditingQtyDrafts((prev) => {
                                            if (prev[prevDraftKey] === undefined) return prev;
                                            const next = { ...prev };
                                            delete next[prevDraftKey];
                                            return next;
                                          });
                                          handleUpdateCountsheetItem(prevEntry.seqIdx, { balance: null });
                                        }
                                        const tbody = input.closest('tbody');
                                        const prevInput = tbody?.querySelector<HTMLInputElement>(
                                          `input[data-balance-qty-row="${prevRowIdx}"]`
                                        );
                                        if (prevInput) {
                                          prevInput.focus();
                                          prevInput.scrollIntoView({ block: 'nearest' });
                                        }
                                      }
                                    } else if (
                                      input.selectionStart !== null &&
                                      input.selectionEnd !== null &&
                                      input.selectionStart !== input.selectionEnd
                                    ) {
                                      // If text was selected, delete per character (just the last character) instead of wiping all text
                                      e.preventDefault();
                                      const end = input.selectionEnd;
                                      const nextStr = currentVal.slice(0, end - 1) + currentVal.slice(end);
                                      setEditingQtyDrafts((prev) => ({ ...prev, [draftKey]: nextStr }));
                                      const evaluated = evaluateQtyFormula(nextStr, true);
                                      handleUpdateCountsheetItem(seqIdx, {
                                        balance: nextStr.trim() === '' || evaluated === null ? null : evaluated,
                                      });
                                    }
                                  }
                                }}
                                className="w-20 text-right font-mono font-bold text-xs px-2 py-1 rounded-lg bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </td>
                            <td className="p-2.5 text-right">
                              <input
                                type="text"
                                inputMode="text"
                                placeholder="—"
                                data-actual-qty-row={rowIdx}
                                value={
                                  editingQtyDrafts[`actual_${item.id}`] !== undefined
                                    ? editingQtyDrafts[`actual_${item.id}`]
                                    : item.actual !== undefined && item.actual !== null
                                    ? String(item.actual)
                                    : ''
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const draftKey = `actual_${item.id}`;
                                  setEditingQtyDrafts((prev) => ({ ...prev, [draftKey]: raw }));
                                  if (raw.trim() === '') {
                                    handleUpdateCountsheetItem(seqIdx, { actual: null });
                                  } else {
                                    const evaluated = evaluateQtyFormula(raw, false);
                                    if (evaluated !== null) {
                                      handleUpdateCountsheetItem(seqIdx, { actual: evaluated });
                                    }
                                  }
                                }}
                                onBlur={(e) => {
                                  const raw = e.currentTarget.value;
                                  const draftKey = `actual_${item.id}`;
                                  if (raw.trim() === '') {
                                    handleUpdateCountsheetItem(seqIdx, { actual: null });
                                  } else {
                                    const evaluated = evaluateQtyFormula(raw, true);
                                    if (evaluated !== null) {
                                      handleUpdateCountsheetItem(seqIdx, { actual: evaluated });
                                    }
                                  }
                                  setEditingQtyDrafts((prev) => {
                                    if (prev[draftKey] === undefined) return prev;
                                    const next = { ...prev };
                                    delete next[draftKey];
                                    return next;
                                  });
                                }}
                                onWheel={(e) => (e.target as HTMLElement).blur()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const raw = e.currentTarget.value;
                                    const draftKey = `actual_${item.id}`;
                                    if (raw.trim() === '') {
                                      handleUpdateCountsheetItem(seqIdx, { actual: null });
                                    } else {
                                      const evaluated = evaluateQtyFormula(raw, true);
                                      if (evaluated !== null) {
                                        handleUpdateCountsheetItem(seqIdx, { actual: evaluated });
                                      }
                                    }
                                    setEditingQtyDrafts((prev) => {
                                      if (prev[draftKey] === undefined) return prev;
                                      const next = { ...prev };
                                      delete next[draftKey];
                                      return next;
                                    });
                                    const tbody = e.currentTarget.closest('tbody');
                                    const nextInput = tbody?.querySelector<HTMLInputElement>(
                                      `input[data-actual-qty-row="${rowIdx + 1}"]`
                                    );
                                    if (nextInput) {
                                      nextInput.focus();
                                      nextInput.scrollIntoView({ block: 'nearest' });
                                    }
                                  } else if (e.key === 'Backspace') {
                                    const input = e.currentTarget;
                                    const currentVal = input.value;
                                    const draftKey = `actual_${item.id}`;

                                    // If there is no character, go to the previous item and delete it
                                    if (!currentVal || currentVal.trim() === '') {
                                      e.preventDefault();
                                      setEditingQtyDrafts((prev) => {
                                        if (prev[draftKey] === undefined) return prev;
                                        const next = { ...prev };
                                        delete next[draftKey];
                                        return next;
                                      });
                                      if (rowIdx > 0) {
                                        const prevRowIdx = rowIdx - 1;
                                        const prevEntry = filteredWithOriginalIndex[prevRowIdx];
                                        if (prevEntry) {
                                          const prevDraftKey = `actual_${prevEntry.item.id}`;
                                          setEditingQtyDrafts((prev) => {
                                            if (prev[prevDraftKey] === undefined) return prev;
                                            const next = { ...prev };
                                            delete next[prevDraftKey];
                                            return next;
                                          });
                                          handleUpdateCountsheetItem(prevEntry.seqIdx, { actual: null });
                                        }
                                        const tbody = input.closest('tbody');
                                        const prevInput = tbody?.querySelector<HTMLInputElement>(
                                          `input[data-actual-qty-row="${prevRowIdx}"]`
                                        );
                                        if (prevInput) {
                                          prevInput.focus();
                                          prevInput.scrollIntoView({ block: 'nearest' });
                                        }
                                      }
                                    } else if (
                                      input.selectionStart !== null &&
                                      input.selectionEnd !== null &&
                                      input.selectionStart !== input.selectionEnd
                                    ) {
                                      // If text was selected, delete per character (just the last character) instead of wiping all text
                                      e.preventDefault();
                                      const end = input.selectionEnd;
                                      const nextStr = currentVal.slice(0, end - 1) + currentVal.slice(end);
                                      setEditingQtyDrafts((prev) => ({ ...prev, [draftKey]: nextStr }));
                                      const evaluated = evaluateQtyFormula(nextStr, true);
                                      handleUpdateCountsheetItem(seqIdx, {
                                        actual: nextStr.trim() === '' || evaluated === null ? null : evaluated,
                                      });
                                    }
                                  }
                                }}
                                className="w-20 text-right font-mono font-bold text-xs px-2 py-1 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold">
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
                            <td className="p-2.5 text-center font-mono text-slate-600 dark:text-slate-300">
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-[10px]">
                                {item.unit || 'PCS'}
                              </span>
                            </td>
                            <td className="p-2.5 font-sans text-slate-500 dark:text-slate-400 max-w-[160px]">
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="truncate">
                                  {item.category || ''}
                                  {item.subCategory ? ` › ${item.subCategory}` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCountsheetItem(seqIdx)}
                                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 transition-opacity shrink-0 cursor-pointer"
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
                        <td colSpan={9} className="p-8 text-center text-slate-400 font-sans">
                          No countsheet items match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-2.5 bg-slate-50 dark:bg-zinc-800/50 border-t border-slate-200 dark:border-zinc-700 text-[11px] text-slate-500 flex items-center justify-between">
                <span>{filteredWithOriginalIndex.length} items</span>
                <span>
                  {countedCount}/{countsheetItems.length} actuals entered
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const panelAnimationClass =
    transitionAnim === 'slide-in-right'
      ? 'animate-slide-in-right'
      : transitionAnim === 'slide-out-right'
      ? 'animate-slide-out-right'
      : '';

  const backdropClass = isTransparentBackdrop
    ? 'bg-transparent'
    : 'bg-slate-950/70 backdrop-blur-xs';

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 md:p-6 overflow-hidden ${backdropClass}`}
      style={{ overscrollBehavior: 'contain' }}
    >
      <div
        data-scroll-lock-panel
        className={`relative w-[92vw] h-[88dvh] sm:h-auto sm:w-full max-w-[90vw] xl:max-w-[1440px] 2xl:max-w-[1540px] bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col sm:max-h-[86dvh] overflow-hidden ${panelAnimationClass}`}
      >
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
                  if (importedCountsheetSession) {
                    setStep('SOURCE_IATD');
                    setShowAddMissingPanel(false);
                    setShowUpdateIatdPanel(true);
                    setUpdateIatdSourceTab('EMAIL');
                    handleRefreshEmails();
                  } else {
                    setStep('SOURCE_IATD');
                    setSourceViewMode((prev) => (prev === 'EMAIL' ? 'DRIVE' : 'EMAIL'));
                  }
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                  (step === 'SOURCE_IATD' && sourceViewMode === 'EMAIL' && !importedCountsheetSession) ||
                  (importedCountsheetSession && showUpdateIatdPanel && updateIatdSourceTab === 'EMAIL')
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
            <div className={`space-y-4 w-full ${(importedCountsheetSession || initialCountsheetSession) ? '' : 'max-w-5xl mx-auto'}`}>
              {(importedCountsheetSession || initialCountsheetSession) && renderPreGeneratedCountsheetEditor()}

              {!(importedCountsheetSession || initialCountsheetSession) && (
                <>
                  {/* Recent Generated Audit Reports Section */}
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
                          <span>Google Drive ({userEmail || `${driveFiles.length} files`})</span>
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

                    {sourceViewMode === 'DRIVE' && (
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-2 px-1">
                        <span className="flex items-center gap-1.5 font-medium truncate">
                          <FolderOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span>Branch IATD source: searching files from <strong>{userEmail || 'signed-in user'}</strong></span>
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500 hidden sm:inline shrink-0">
                          (Blank encoding forms are loaded from Admin Links in Step 2)
                        </span>
                      </div>
                    )}

                    {sourceViewMode === 'DRIVE' ? (
                      <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/40">
                        {isSearchingDrive ? (
                          <div className="p-6 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
                            <span>Searching branch spreadsheets from {userEmail || 'your Google Drive'}...</span>
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

              {/* Form / Blank Template Source (Overall Count Template & Cessation Overall Count Template from Saved Admin Links) */}
              <div className="p-3.5 bg-indigo-50/60 dark:bg-indigo-950/25 border border-indigo-200/80 dark:border-indigo-800/60 rounded-2xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Form / Blank Template Source (Admin Drive Links)</span>
                  </span>
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/60">
                    Source: Overall Count Template (Saved Admin Link)
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
            <div className={`space-y-4 w-full ${importedCountsheetSession ? '' : 'max-w-5xl mx-auto'} animate-in fade-in`}>
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
                type="button"
                onClick={handleCancelOrBack}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-zinc-800 cursor-pointer flex items-center gap-1.5"
              >
                {isFromCountsheetExport ? (
                  <>
                    <ChevronLeft className="w-4 h-4" />
                    <span>Back</span>
                  </>
                ) : (
                  <span>Cancel</span>
                )}
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
    </div>
  );
};
