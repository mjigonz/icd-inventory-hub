import React, { useState, useEffect, useMemo } from 'react';
import {
  FileSpreadsheet,
  ClipboardList,
  X,
  Search,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Shuffle,
  Layers,
  Sparkles,
  ChevronRight,
  Database,
  ExternalLink,
  Table,
  Check,
  Package,
  SlidersHorizontal,
  ChevronDown,
  Download,
  Share2,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Info,
  Calendar,
  Clock,
  CheckSquare,
  Square,
  Eye,
  Printer,
  ZoomIn,
  ZoomOut,
  Mail,
  Inbox,
  Paperclip,
  FileCheck2,
  FolderOpen,
} from 'lucide-react';
import {
  searchDriveSpreadsheets,
  DriveSpreadsheetFile,
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
  fetchAllSheetRows,
  extractSpreadsheetId,
  getSpreadsheetTabs,
  SheetTabInfo,
  DEFAULT_COUNTSHEET_TEMPLATE_URL,
  DEFAULT_COUNTSHEET_TEMPLATE_ID,
  DEFAULT_COUNTSHEET_TEMPLATE_GID,
  createCountsheetFromTemplate,
  updateExistingCountsheetSpreadsheet,
  CreateCountsheetFromTemplateResult,
  GroupCountsheetPlan,
  RecentCountsheetSession,
  PreGeneratedCountsheetItem,
  getRecentCountsheets,
  saveRecentCountsheet,
  deleteRecentCountsheet,
  clearRecentCountsheets,
  syncRecentCountsheetsFromCloud,
  subscribeToRecentCountsheets,
  importGeneratedCountsheetFromDrive,
  COUNTSHEET_DESC_MAX_CHARS,
  COUNTSHEET_MAX_ROWS_PER_SHEET,
  splitItemDescriptionLines,
  getItemRowSpan,
  packItemsInto34RowSheets,
  getNormalizedItemHierarchyKey,
  SheetPhysicalRowSlot,
  CountsheetTemplateSpec,
  getCachedCountsheetTemplateSpec,
  fetchCountsheetTemplateSpec,
  getSavedCountsheetTemplateUrl,
  saveCountsheetTemplateUrl,
  GENERATED_COUNTSHEET_FOLDER_NAME,
  fetchHubTemplatesFromServer,
  getCachedHubCountsheetTemplates,
  HubCountsheetTemplateInfo,
  HUB_OWNER_EMAIL,
  isIatdTotalQuantityFooterRow,
  isIatdVersionFooterRow,
  getAdminDriveLinksConfig,
  extractDriveResourceFromLink,
  subscribeToAdminDriveLinks,
  listSpreadsheetsInDriveFolder,
} from '../services/auditReportService';
import { Countsheet, SelectedBranch } from '../types';
import {
  getStoredOAuthToken,
  isGoogleOAuthAccessToken,
  refreshGoogleAccessToken,
  resolveValidOAuthToken,
  subscribeToTokenChanges,
} from '../services/auth';

interface CreateRandomCountsheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  isGoogleConnected?: boolean;
  onConnectGoogle?: () => void;
  onTokenRefreshed?: (token: string) => void;
}

export interface ParsedIatdRow {
  id: string;
  rowIndex: number;
  itemCode: string;
  barcode: string;
  itemDescription: string;
  category: string;
  subCategory: string;
  subsubCategory: string;
  unit: string;
  balance: number;
  cost: number;
  selling: number;
  raw: any[];
}

export type HeaderButtonType = 'itemDescription' | 'cat' | 'subCat' | 'subSubCat';

export interface SelectionGroup {
  id: string;
  name: string;
  baseSheetName: string; // The last selected Category / SubCat / SubSubCat
  selectedCat: string;
  selectedSubCat: string;
  selectedSubSubCat: string;
  selectedCats: string[];
  selectedSubCats: string[];
  selectedSubSubCats: string[];
  lastSelectedHierarchy: string;
  activeHeaderButton: HeaderButtonType;
  itemSearchQuery: string;
  hierarchySearchQuery: string;
  selectedItemIds: Set<string>;
  randomCountInput: number;
}

export const CreateRandomCountsheetModal: React.FC<CreateRandomCountsheetModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  isGoogleConnected: isGoogleConnectedProp,
  onConnectGoogle,
  onTokenRefreshed: _onTokenRefreshed,
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
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);

  const handleRefreshGoogleAccess = async () => {
    setIsRefreshingToken(true);
    setDriveSearchError(null);
    setIatdError(null);
    try {
      const newToken = await refreshGoogleAccessToken();
      setLocalToken(newToken);
      if (_onTokenRefreshed) _onTokenRefreshed(newToken);
      setIsSearchingDrive(true);
      const files = await searchDriveSpreadsheets(newToken, driveQuery);
      setDriveFiles(files);
    } catch (err: any) {
      setDriveSearchError(err?.message || 'Failed to refresh Google Drive access.');
    } finally {
      setIsRefreshingToken(false);
      setIsSearchingDrive(false);
    }
  };

  const handleRefreshDrive = () => {
    setIsSearchingDrive(true);
    setDriveSearchError(null);
    searchDriveSpreadsheets(effectiveToken || '', driveQuery)
      .then((files) => {
        setDriveFiles(files);
        setDriveSearchError(null);
      })
      .catch((err) => {
        console.warn('Drive search error:', err);
        const cached = getCachedDriveFiles(driveQuery);
        if (cached.length > 0) {
          setDriveFiles(cached);
          setDriveSearchError(null);
        } else {
          setDriveSearchError(err?.message || 'Could not load spreadsheets from Google Drive.');
        }
      })
      .finally(() => setIsSearchingDrive(false));
  };

  // Wizard steps: SELECT_FILE -> FILTER_ITEMS -> SUCCESS
  const [currentStep, setCurrentStep] = useState<'SELECT_FILE' | 'FILTER_ITEMS' | 'SUCCESS'>('SELECT_FILE');

  // Drive search & file selection (initialized from cache so spreadsheets appear immediately)
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>(() => getCachedDriveFiles());
  const [isSearchingDrive, setIsSearchingDrive] = useState(false);
  const [driveSearchError, setDriveSearchError] = useState<string | null>(null);
  const [driveQuery, setDriveQuery] = useState('');
  const [customFileUrl, setCustomFileUrl] = useState('');

  // Source selector: Google Drive vs Email (Branch Spreadsheets)
  const [sourceViewMode, setSourceViewMode] = useState<'DRIVE' | 'EMAIL'>('DRIVE');
  const [emailMessages, setEmailMessages] = useState<BranchEmailSpreadsheetMessage[]>(() =>
    getCachedBranchEmails()
  );
  const [isSearchingEmail, setIsSearchingEmail] = useState(false);
  const [emailSearchError, setEmailSearchError] = useState<string | null>(null);
  const [emailNeedsScopeConsent, setEmailNeedsScopeConsent] = useState(false);
  const [emailQuery, setEmailQuery] = useState('');
  const [convertingAttachmentKey, setConvertingAttachmentKey] = useState<string | null>(null);
  const [convertedSheetsMap, setConvertedSheetsMap] = useState<
    Record<string, ConvertedEmailSpreadsheetRecord>
  >(() => getConvertedEmailSheetsMap());
  const [emailConversionToast, setEmailConversionToast] = useState<{
    message: string;
    webViewLink?: string;
    spreadsheetId?: string;
    spreadsheetName?: string;
  } | null>(null);

  const handleRefreshEmails = async (
    overrideToken?: string,
    customQuery?: string,
    interactive = false
  ) => {
    const qToUse = customQuery !== undefined ? customQuery : emailQuery;
    setIsSearchingEmail(true);
    setEmailSearchError(null);
    setEmailNeedsScopeConsent(false);
    try {
      const tokenToUse =
        overrideToken ||
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';
      const msgs = await searchBranchEmailSpreadsheets(tokenToUse, qToUse, {
        allowInteractiveConsent: interactive,
      });
      setEmailMessages(msgs);
      setConvertedSheetsMap(getConvertedEmailSheetsMap());
    } catch (err: any) {
      console.warn('Gmail branch email search notice:', err);
      const cached = getCachedBranchEmails(qToUse);
      if (err?.isInsufficientScope || err?.message === 'GMAIL_SCOPE_REQUIRED') {
        setEmailNeedsScopeConsent(true);
        setEmailSearchError(
          err.message ||
            'Gmail access permission is needed to read branch emails. Please authorize Gmail below.'
        );
      } else if (cached.length > 0 && !qToUse.trim()) {
        setEmailMessages(cached);
        setEmailSearchError(null);
      } else {
        setEmailSearchError(
          err?.message || 'Could not load emailed spreadsheets from Gmail.'
        );
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
      setLocalToken(newToken);
      if (_onTokenRefreshed) _onTokenRefreshed(newToken);
      setEmailNeedsScopeConsent(false);
      await handleRefreshEmails(newToken, undefined, true);
    } catch (err: any) {
      setEmailSearchError(
        err?.message || 'Could not complete Gmail authorization. Please try again.'
      );
    } finally {
      setIsRefreshingToken(false);
    }
  };

  const handleConvertEmailAttachment = async (
    msg: BranchEmailSpreadsheetMessage,
    att: EmailSpreadsheetAttachment,
    loadAfterConvert: boolean
  ) => {
    const attKey = `${msg.messageId}:${att.filename}`;
    setConvertingAttachmentKey(attKey);
    setIatdError(null);
    setEmailSearchError(null);
    try {
      const convertedFile = await convertEmailAttachmentToGoogleSheet({
        accessToken: effectiveToken || '',
        messageId: msg.messageId,
        attachment: att,
      });
      setConvertedSheetsMap(getConvertedEmailSheetsMap());
      setDriveFiles((prev) => {
        const filtered = prev.filter((f) => f.id !== convertedFile.id);
        return [convertedFile, ...filtered];
      });
      setEmailConversionToast({
        message: `Converted "${att.filename}" into Google Sheets compatible format ("${convertedFile.name}")!`,
        webViewLink: convertedFile.webViewLink,
        spreadsheetId: convertedFile.id,
        spreadsheetName: convertedFile.name,
      });
      if (loadAfterConvert) {
        await handleSelectIatdSpreadsheet(convertedFile);
      }
    } catch (err: any) {
      console.error('Failed to convert emailed spreadsheet:', err);
      setEmailSearchError(
        err?.message || `Failed to convert "${att.filename}" to Google Sheets.`
      );
    } finally {
      setConvertingAttachmentKey(null);
    }
  };

  const handleConvertDriveExcelFile = async (
    file: DriveSpreadsheetFile,
    loadAfterConvert: boolean,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    const convKey = `drive:${file.id}`;
    setConvertingAttachmentKey(convKey);
    setIatdError(null);
    try {
      const convertedFile = await convertDriveExcelFileToGoogleSheet(effectiveToken || '', file);
      setDriveFiles((prev) => {
        const filtered = prev.filter((f) => f.id !== convertedFile.id);
        return [convertedFile, ...filtered];
      });
      setEmailConversionToast({
        message: `Converted "${file.name}" into Google Sheets ("${convertedFile.name}")!`,
        webViewLink: convertedFile.webViewLink,
        spreadsheetId: convertedFile.id,
        spreadsheetName: convertedFile.name,
      });
      if (loadAfterConvert) {
        await handleSelectIatdSpreadsheet(convertedFile);
      }
    } catch (err: any) {
      setIatdError(err?.message || `Could not convert "${file.name}" into Google Sheets.`);
    } finally {
      setConvertingAttachmentKey(null);
    }
  };

  // Selected IATD spreadsheet
  const [selectedFile, setSelectedFile] = useState<DriveSpreadsheetFile | null>(null);
  const [spreadsheetTabs, setSpreadsheetTabs] = useState<SheetTabInfo[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [headerRow, setHeaderRow] = useState<number>(2);
  const [isLoadingIatd, setIsLoadingIatd] = useState(false);
  const [iatdError, setIatdError] = useState<string | null>(null);

  // Raw data from IATD
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [allItems, setAllItems] = useState<ParsedIatdRow[]>([]);

  // Column header mapping (pertains to headers in IATD)
  const [mappedDescCol, setMappedDescCol] = useState<string>('');
  const [mappedCatCol, setMappedCatCol] = useState<string>('');
  const [mappedSubCatCol, setMappedSubCatCol] = useState<string>('');
  const [mappedSubSubCatCol, setMappedSubSubCatCol] = useState<string>('');
  const [mappedCodeCol, setMappedCodeCol] = useState<string>('');
  const [mappedBarcodeCol, setMappedBarcodeCol] = useState<string>('');
  const [mappedCostCol, setMappedCostCol] = useState<string>('');
  const [mappedSellingCol, setMappedSellingCol] = useState<string>('');
  const [mappedUnitCol, setMappedUnitCol] = useState<string>('');
  const [mappedBalanceCol, setMappedBalanceCol] = useState<string>('');
  const [showColumnSettings, setShowColumnSettings] = useState(false);

  // COUNTSHEET GROUPS STATE: CS01, CS02, CS03 (advances by number of countsheets used)
  const formatCsCode = (num: number): string => `CS${String(num).padStart(2, '0')}`;
  const isDefaultGroupOrCsName = (val?: string): boolean =>
    !val || /^(Group\s+\d+|CS\d+)$/i.test(val.trim());

  const createInitialGroup = (csNum = 1): SelectionGroup => {
    const csLabel = formatCsCode(csNum);
    return {
      id: `grp-${csNum}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: csLabel,
      baseSheetName: csLabel,
      selectedCat: '',
      selectedSubCat: '',
      selectedSubSubCat: '',
      selectedCats: [],
      selectedSubCats: [],
      selectedSubSubCats: [],
      lastSelectedHierarchy: '',
      activeHeaderButton: 'cat',
      itemSearchQuery: '',
      hierarchySearchQuery: '',
      selectedItemIds: new Set<string>(),
      randomCountInput: 34,
    };
  };

  const [groups, setGroups] = useState<SelectionGroup[]>(() => [createInitialGroup(1)]);
  const [activeGroupId, setActiveGroupId] = useState<string>(() => groups[0]?.id || 'grp-1');
  const [editingBaseSheetName, setEditingBaseSheetName] = useState(false);

  // Group Preview Modal state (Google Sheets Ctrl+P Print Preview replica)
  const [showGroupsPreview, setShowGroupsPreview] = useState(false);
  const [previewActiveGroupId, setPreviewActiveGroupId] = useState<string>('ALL');
  const [previewLayoutMode, setPreviewLayoutMode] = useState<'print' | 'sheet'>('print');
  const [previewZoom, setPreviewZoom] = useState<number>(85);

  // Support Ctrl + P keyboard shortcut to open Countsheet Print Preview
  useEffect(() => {
    if (!isOpen || currentStep !== 'FILTER_ITEMS') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPreviewActiveGroupId('ALL');
        setShowGroupsPreview(true);
      } else if (e.key === 'Escape' && showGroupsPreview) {
        setShowGroupsPreview(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStep, showGroupsPreview]);

  // Target Template Spreadsheet configuration (Admin Templates in icdhubsystems@gmail.com: Random Inventory Countsheet & Periodic Countsheet)
  const [hubCountsheetTemplates, setHubCountsheetTemplates] = useState<HubCountsheetTemplateInfo[]>(() =>
    getCachedHubCountsheetTemplates()
  );
  const [templateUrl, setTemplateUrl] = useState<string>(() => getSavedCountsheetTemplateUrl());
  const [templateSpec, setTemplateSpec] = useState<CountsheetTemplateSpec>(() =>
    getCachedCountsheetTemplateSpec()
  );
  const [isRefreshingTemplate, setIsRefreshingTemplate] = useState<boolean>(false);
  const [showTemplateSettings, setShowTemplateSettings] = useState(false);
  const [targetSpreadsheetTitle, setTargetSpreadsheetTitle] = useState<string>('');
  // Transfer with balance tickmark:
  // "Insert a tickamark where if checked then it will only transfer items with balance from the IATD, all items with zero balances are not incuded in transfer to Template. and if the tickmark is not on then it includes all zero items from the IATD."
  const [onlyItemsWithBalance, setOnlyItemsWithBalance] = useState<boolean>(false);
  const [insertCategorySpacers, setInsertCategorySpacers] = useState<boolean>(false);
  const [showSelectedItemsOnly, setShowSelectedItemsOnly] = useState<boolean>(false);
  const [itemSortBy, setItemSortBy] = useState<'itemCode' | 'itemDescription'>('itemCode');
  const [showSortDropdown, setShowSortDropdown] = useState<boolean>(false);

  const compareItemsBySortMode = (
    a: ParsedIatdRow,
    b: ParsedIatdRow,
    mode: 'itemCode' | 'itemDescription' = itemSortBy
  ): number => {
    if (mode === 'itemDescription') {
      const descA = (a.itemDescription || '').trim();
      const descB = (b.itemDescription || '').trim();
      if (descA && descB) {
        const cmp = descA.localeCompare(descB, undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
      } else if (descA && !descB) {
        return -1;
      } else if (!descA && descB) {
        return 1;
      }
      const codeA = (a.itemCode || a.barcode || '').trim();
      const codeB = (b.itemCode || b.barcode || '').trim();
      const codeCmp = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      if (codeCmp !== 0) return codeCmp;
      return a.rowIndex - b.rowIndex;
    }

    const codeA = (a.itemCode || a.barcode || '').trim();
    const codeB = (b.itemCode || b.barcode || '').trim();
    if (codeA && codeB) {
      const cmp = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return cmp;
    } else if (codeA && !codeB) {
      return -1;
    } else if (!codeA && codeB) {
      return 1;
    }
    const descFallback = (a.itemDescription || '').trim().localeCompare(
      (b.itemDescription || '').trim(),
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
    if (descFallback !== 0) return descFallback;
    return a.rowIndex - b.rowIndex;
  };

  // Orders countsheet items A–Z by Item Code or Item Description.
  // When Space Categories (insertCategorySpacers) is enabled, items sharing the same
  // (Category, SubCategory, SubsubCategory) stay grouped together and are sorted A–Z
  // within each category block; otherwise all selected items are sorted strictly A–Z.
  const groupItemsByHierarchyOrder = (
    items: ParsedIatdRow[],
    mode: 'itemCode' | 'itemDescription' = itemSortBy,
    groupByCategory: boolean = insertCategorySpacers
  ): ParsedIatdRow[] => {
    if (items.length <= 1) return [...items];
    if (!groupByCategory) {
      return [...items].sort((a, b) => compareItemsBySortMode(a, b, mode));
    }
    const buckets = new Map<string, ParsedIatdRow[]>();
    for (const item of items) {
      const key = getNormalizedItemHierarchyKey(item);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        buckets.set(key, [item]);
      }
    }
    const result: ParsedIatdRow[] = [];
    buckets.forEach((bucket) => {
      bucket.sort((a, b) => compareItemsBySortMode(a, b, mode));
      result.push(...bucket);
    });
    return result;
  };

  // Generation status & result
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedResult, setSavedResult] = useState<CreateCountsheetFromTemplateResult | null>(null);
  // Recents state: view, re-open in Google Sheets, or restore/edit previous setups
  const [recentCountsheets, setRecentCountsheets] = useState<RecentCountsheetSession[]>([]);
  const [isSyncingRecents, setIsSyncingRecents] = useState<boolean>(false);
  const [recentCountsheetsFilter, setRecentCountsheetsFilter] = useState<string>('');
  const [confirmClearRecents, setConfirmClearRecents] = useState<boolean>(false);
  const [isLoadingRecentSession, setIsLoadingRecentSession] = useState<boolean>(false);
  const [lastAttemptedSession, setLastAttemptedSession] = useState<RecentCountsheetSession | null>(null);

  const handleSyncCloudRecents = async () => {
    setIsSyncingRecents(true);
    try {
      const synced = await syncRecentCountsheetsFromCloud();
      setRecentCountsheets(synced);
    } catch {} finally {
      setIsSyncingRecents(false);
    }
  };

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionSpreadsheetId, setActiveSessionSpreadsheetId] = useState<string | null>(null);
  const [activeSessionWebViewLink, setActiveSessionWebViewLink] = useState<string | null>(null);
  const [savedToastMessage, setSavedToastMessage] = useState<string | null>(null);

  // Restore and resume editing / reusing from a recent countsheet session
  const handleRestoreRecentSession = async (session: RecentCountsheetSession, asCopy = false) => {
    setIsLoadingRecentSession(true);
    setIatdError(null);
    setLastAttemptedSession(session);
    try {
      setActiveSessionId(asCopy ? null : session.id);
      const isRealDriveSheet =
        !asCopy &&
        Boolean(
          session.spreadsheetId &&
            !session.spreadsheetId.startsWith('cs_') &&
            !session.spreadsheetId.startsWith('draft_')
        );
      setActiveSessionSpreadsheetId(isRealDriveSheet ? session.spreadsheetId : null);
      setActiveSessionWebViewLink(isRealDriveSheet ? session.webViewLink || null : null);

      if (session.templateUrl) setTemplateUrl(session.templateUrl);
      if (session.onlyItemsWithBalance !== undefined) setOnlyItemsWithBalance(session.onlyItemsWithBalance);
      if (session.insertCategorySpacers !== undefined) setInsertCategorySpacers(session.insertCategorySpacers);
      if (session.headerRow) setHeaderRow(session.headerRow);
      if (session.spreadsheetName) {
        setTargetSpreadsheetTitle(
          asCopy ? `${session.spreadsheetName} (Copy)` : session.spreadsheetName
        );
      }

      let loadedItems: ParsedIatdRow[] = [];
      const srcId = session.sourceFile?.id || '';
      const isLocalOrDraftSource =
        !srcId ||
        srcId === 'saved-session' ||
        srcId === 'imported-countsheet' ||
        srcId === session.spreadsheetId ||
        srcId.startsWith('draft_') ||
        srcId.startsWith('cs_');

      if (!isLocalOrDraftSource && session.sourceFile) {
        loadedItems = await handleSelectIatdSpreadsheet(
          {
            id: srcId,
            name: session.sourceFile.name || 'IATD',
          },
          session.sourceFile.tabName,
          session.headerRow || headerRow
        );
      }

      // Helper to merge any legacy continuation rows (blank itemCode & barcode with description text) onto preceding item
      const mergeContinuationSnapshotItems = (
        rawList: PreGeneratedCountsheetItem[]
      ): PreGeneratedCountsheetItem[] => {
        const mergedList: PreGeneratedCountsheetItem[] = [];
        for (const entry of rawList) {
          const code = String(entry.itemCode || '').trim();
          const bar = String(entry.barcode || '').trim();
          const desc = String(entry.itemDescription || '').trim();
          const prev = mergedList[mergedList.length - 1];
          if (
            !code &&
            !bar &&
            desc &&
            prev &&
            (prev.csCode || '') === (entry.csCode || '') &&
            (prev.sheetTitle || '') === (entry.sheetTitle || '')
          ) {
            prev.itemDescription = `${prev.itemDescription} ${desc}`.trim();
          } else {
            mergedList.push({ ...entry });
          }
        }
        return mergedList;
      };

      // Fallback: if IATD rows could not be fetched remotely, hydrate from existing allItems + saved orderedItems snapshot
      if (loadedItems.length === 0) {
        const rawSnapshotItems: PreGeneratedCountsheetItem[] =
          session.rawItems && session.rawItems.length > 0
            ? session.rawItems
            : session.orderedCountsheetItems && session.orderedCountsheetItems.length > 0
            ? session.orderedCountsheetItems
            : (session.savedGroups || []).flatMap((sg) => sg.orderedItems || []);
        const snapshotItems = mergeContinuationSnapshotItems(rawSnapshotItems);

        const normalizeCodeKey = (val?: string) => String(val || '').trim().toLowerCase();
        const stripLeadingZeros = (val?: string) =>
          normalizeCodeKey(val).replace(/^0+(?=\d)/, '');

        if (allItems.length > 0) {
          // Keep current IATD inventory items and append any template items whose Item Code is missing from IATD
          const existingCodes = new Set<string>();
          allItems.forEach((it) => {
            if (it.itemCode) {
              existingCodes.add(normalizeCodeKey(it.itemCode));
              existingCodes.add(stripLeadingZeros(it.itemCode));
            }
          });
          const merged = [...allItems];
          snapshotItems.forEach((it, idx) => {
            const cKey = normalizeCodeKey(it.itemCode);
            const cStripped = stripLeadingZeros(it.itemCode);
            if (!cKey || (!existingCodes.has(cKey) && !existingCodes.has(cStripped))) {
              const newRowIndex = merged.length;
              merged.push({
                id: it.id || `${it.itemCode || it.barcode || idx}_${newRowIndex}`,
                rowIndex: newRowIndex,
                itemCode: it.itemCode || '',
                barcode: it.barcode || '',
                itemDescription: it.itemDescription || `Item ${idx + 1}`,
                category: it.category || '',
                subCategory: it.subCategory || '',
                subsubCategory: it.subsubCategory || '',
                unit: it.unit || 'PCS',
                balance: it.balance ?? 0,
                cost: it.cost ?? 0,
                selling: it.selling ?? 0,
                raw: it.raw || [],
              });
              if (cKey) existingCodes.add(cKey);
              if (cStripped) existingCodes.add(cStripped);
            }
          });
          loadedItems = merged;
          setAllItems(loadedItems);
        } else if (snapshotItems.length > 0) {
          setIatdError(null);
          loadedItems = snapshotItems.map((it, idx) => ({
            id: it.id || `${it.itemCode || it.barcode || idx}_${it.rowIndex ?? idx}`,
            rowIndex: it.rowIndex ?? idx,
            itemCode: it.itemCode || '',
            barcode: it.barcode || '',
            itemDescription: it.itemDescription || `Item ${idx + 1}`,
            category: it.category || '',
            subCategory: it.subCategory || '',
            subsubCategory: it.subsubCategory || '',
            unit: it.unit || 'PCS',
            balance: it.balance ?? 0,
            cost: it.cost ?? 0,
            selling: it.selling ?? 0,
            raw: it.raw || [],
          }));
          setAllItems(loadedItems);
          if (session.iatdHeaders && session.iatdHeaders.length > 0) {
            setRawHeaders(session.iatdHeaders);
          }
          if (session.sourceFile) {
            setSelectedFile({
              id: session.sourceFile.id || 'saved-session',
              name: session.sourceFile.name || session.spreadsheetName || 'Saved Countsheet',
            });
          }
        }
      }

      const normalizeCodeLookup = (val?: string) => String(val || '').trim().toLowerCase();
      const stripZeroLookup = (val?: string) =>
        normalizeCodeLookup(val).replace(/^0+(?=\d)/, '');

      const idLookup = new Set(loadedItems.map((i) => i.id));
      const byRowIndex = new Map<number, string>();
      const byCode = new Map<string, string>();
      const byStrippedCode = new Map<string, string>();
      loadedItems.forEach((i) => {
        byRowIndex.set(i.rowIndex, i.id);
        if (i.itemCode) {
          const exact = normalizeCodeLookup(i.itemCode);
          const stripped = stripZeroLookup(i.itemCode);
          if (!byCode.has(exact)) byCode.set(exact, i.id);
          if (stripped && !byStrippedCode.has(stripped)) byStrippedCode.set(stripped, i.id);
        }
        if (i.barcode) {
          const barExact = normalizeCodeLookup(i.barcode);
          if (!byCode.has(barExact)) byCode.set(barExact, i.id);
        }
      });

      const findIdByItemCode = (rawCode?: string): string | undefined => {
        const clean = normalizeCodeLookup(rawCode);
        if (!clean) return undefined;
        if (byCode.has(clean)) return byCode.get(clean);
        const stripped = stripZeroLookup(rawCode);
        if (stripped && byStrippedCode.has(stripped)) return byStrippedCode.get(stripped);
        return undefined;
      };

      if (session.savedGroups && session.savedGroups.length > 0) {
        let runningCs = 1;
        const restoredGroups: SelectionGroup[] = session.savedGroups.map((sg, idx) => {
          const resolvedIds: string[] = [];
          const addId = (id?: string) => {
            if (id && !resolvedIds.includes(id)) resolvedIds.push(id);
          };

          // Priority 1: Rebuild the list of items per sheet using the Item Code from the template
          if (sg.orderedItems && sg.orderedItems.length > 0) {
            sg.orderedItems.forEach((oi) => {
              const matchedByCode = findIdByItemCode(oi.itemCode) || findIdByItemCode(oi.barcode);
              if (matchedByCode) {
                addId(matchedByCode);
              } else if (oi.id && idLookup.has(oi.id)) {
                addId(oi.id);
              } else if (!isLocalOrDraftSource && oi.rowIndex !== undefined && byRowIndex.has(oi.rowIndex)) {
                addId(byRowIndex.get(oi.rowIndex));
              }
            });
          }

          if (resolvedIds.length === 0 && sg.selectedItemCodes && sg.selectedItemCodes.length > 0) {
            sg.selectedItemCodes.forEach((c) => {
              const matchedByCode = findIdByItemCode(c);
              if (matchedByCode) addId(matchedByCode);
            });
          }

          if (resolvedIds.length === 0 && sg.selectedItemIds && sg.selectedItemIds.length > 0) {
            sg.selectedItemIds.forEach((rawId) => {
              if (idLookup.has(rawId)) {
                addId(rawId);
              }
            });
          }

          if (resolvedIds.length === 0 && sg.selectedRowIndices && sg.selectedRowIndices.length > 0) {
            sg.selectedRowIndices.forEach((rIdx) => {
              if (byRowIndex.has(rIdx)) addId(byRowIndex.get(rIdx));
            });
          }

          const finalIds = resolvedIds.length > 0 ? resolvedIds : sg.selectedItemIds || [];
          const resolvedItemsForGroup = finalIds
            .map((fid) => loadedItems.find((li) => li.id === fid))
            .filter(Boolean) as ParsedIatdRow[];
          const packedForGroup = packItemsInto34RowSheets(
            resolvedItemsForGroup,
            COUNTSHEET_MAX_ROWS_PER_SHEET,
            COUNTSHEET_DESC_MAX_CHARS,
            session.insertCategorySpacers ?? insertCategorySpacers
          );
          const csUsed = Math.max(1, packedForGroup.length);
          const csLabel = formatCsCode(runningCs);
          runningCs += csUsed;
          const savedBase = sg.baseSheetName && !isDefaultGroupOrCsName(sg.baseSheetName)
            ? sg.baseSheetName
            : csLabel;
          const restoredCats =
            sg.selectedCats && sg.selectedCats.length > 0
              ? sg.selectedCats
              : sg.selectedCat
              ? [sg.selectedCat]
              : [];
          const restoredSubCats =
            sg.selectedSubCats && sg.selectedSubCats.length > 0
              ? sg.selectedSubCats
              : sg.selectedSubCat
              ? [sg.selectedSubCat]
              : [];
          const restoredSubSubCats =
            sg.selectedSubSubCats && sg.selectedSubSubCats.length > 0
              ? sg.selectedSubSubCats
              : sg.selectedSubSubCat
              ? [sg.selectedSubSubCat]
              : [];
          return {
            id: sg.id || `grp-${idx + 1}`,
            name: csLabel,
            baseSheetName: savedBase,
            selectedCat: restoredCats.join(', '),
            selectedSubCat: restoredSubCats.join(', '),
            selectedSubSubCat: restoredSubSubCats.join(', '),
            selectedCats: restoredCats,
            selectedSubCats: restoredSubCats,
            selectedSubSubCats: restoredSubSubCats,
            lastSelectedHierarchy: sg.lastSelectedHierarchy || '',
            activeHeaderButton: 'itemDescription' as HeaderButtonType,
            itemSearchQuery: '',
            hierarchySearchQuery: sg.hierarchySearchQuery || '',
            selectedItemIds: new Set(finalIds),
            randomCountInput: sg.randomCountInput || 34,
          };
        });
        setGroups(restoredGroups);
        setActiveGroupId(restoredGroups[0]?.id || 'grp-1');
      }

      setCurrentStep('FILTER_ITEMS');
    } catch (err: any) {
      console.error('Failed to restore recent countsheet session:', err);
      setIatdError(err.message || 'Could not load recent session file.');
    } finally {
      setIsLoadingRecentSession(false);
    }
  };

  const handleDeleteRecentSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = deleteRecentCountsheet(id);
    setRecentCountsheets(updated);
  };

  const handleClearAllRecents = () => {
    clearRecentCountsheets();
    setRecentCountsheets([]);
    setConfirmClearRecents(false);
  };

  // State & handler for importing existing generated countsheets (plotted Google Sheets)
  const [showImportPlottedModal, setShowImportPlottedModal] = useState<boolean>(false);
  const [importPlottedSpreadsheetInput, setImportPlottedSpreadsheetInput] = useState<string>('');
  const [isImportingPlottedSheet, setIsImportingPlottedSheet] = useState<boolean>(false);
  const [importPlottedError, setImportPlottedError] = useState<string | null>(null);
  const [importPlottedSuccess, setImportPlottedSuccess] = useState<string | null>(null);
  const [importDriveFilter, setImportDriveFilter] = useState<string>('');

  const handleImportGeneratedCountsheet = async (targetIdOrUrl?: string) => {
    const target = (targetIdOrUrl || importPlottedSpreadsheetInput).trim();
    if (!target) {
      setImportPlottedError('Please enter a Google Spreadsheet URL or select a sheet below.');
      return;
    }

    setIsImportingPlottedSheet(true);
    setImportPlottedError(null);
    setImportPlottedSuccess(null);

    try {
      const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) || effectiveToken || '';
      if (!tokenToUse) {
        setImportPlottedError('Google OAuth token required to read Google Drive spreadsheet.');
        setIsImportingPlottedSheet(false);
        return;
      }

      const session = await importGeneratedCountsheetFromDrive(tokenToUse, target);
      setRecentCountsheets(getRecentCountsheets());
      setImportPlottedSuccess(`Successfully imported "${session.spreadsheetName}" with ${session.totalItems} items!`);

      setTimeout(async () => {
        setShowImportPlottedModal(false);
        setImportPlottedSuccess(null);
        setImportPlottedSpreadsheetInput('');
        await handleRestoreRecentSession(session, false);
      }, 700);
    } catch (err: any) {
      console.error('Failed to import generated countsheet:', err);
      setImportPlottedError(err.message || 'Could not import countsheet spreadsheet.');
    } finally {
      setIsImportingPlottedSheet(false);
    }
  };

  // Subscribe to cross-device recents updates
  useEffect(() => {
    const unsub = subscribeToRecentCountsheets((updated) => {
      setRecentCountsheets(updated);
    });
    const unsubAdminLinks = subscribeToAdminDriveLinks((updatedLinks) => {
      const parsedInv = extractDriveResourceFromLink(updatedLinks.inventoryTemplateLink);
      if (parsedInv) {
        setTemplateUrl(parsedInv.webViewLink);
      } else {
        setTemplateUrl(getSavedCountsheetTemplateUrl());
      }
    });
    return () => {
      unsub();
      unsubAdminLinks();
    };
  }, []);

  const handleRefreshTemplate = async (showFeedback = true, overrideTemplateUrl?: string) => {
    setIsRefreshingTemplate(true);
    try {
      const tokenToUse =
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';
      let targetUrl = (overrideTemplateUrl ?? templateUrl) || DEFAULT_COUNTSHEET_TEMPLATE_URL;
      if (overrideTemplateUrl !== undefined) {
        setTemplateUrl(targetUrl);
        saveCountsheetTemplateUrl(targetUrl);
      } else {
        // 1. Prioritize Admin Console Inventory Template Link if configured
        const adminInvRaw = getAdminDriveLinksConfig().inventoryTemplateLink;
        const parsedAdminInv = extractDriveResourceFromLink(adminInvRaw);

        if (parsedAdminInv) {
          if (!parsedAdminInv.isFolder) {
            targetUrl = parsedAdminInv.webViewLink;
            setTemplateUrl(targetUrl);
            setHubCountsheetTemplates((prev) => {
              const adminItem: HubCountsheetTemplateInfo = {
                id: parsedAdminInv.id,
                name: 'RANDOM INVENTORY COUNTSHEET TEMPLATE (Admin Console)',
                gid: parsedAdminInv.gid || DEFAULT_COUNTSHEET_TEMPLATE_GID,
                folderPath: 'TEMPLATE/COUNTSHEET',
                ownerEmail: HUB_OWNER_EMAIL,
                webViewLink: parsedAdminInv.webViewLink,
              };
              const rest = prev.filter((item) => item.id !== parsedAdminInv.id);
              return [adminItem, ...rest];
            });
          } else if (tokenToUse) {
            try {
              const folderSheets = await listSpreadsheetsInDriveFolder(tokenToUse, parsedAdminInv.id);
              if (folderSheets.length > 0) {
                const mappedFolderTemplates: HubCountsheetTemplateInfo[] = folderSheets.map((f) => ({
                  id: f.id,
                  name: f.name,
                  gid: '0',
                  folderPath: 'TEMPLATE/COUNTSHEET (Admin Console)',
                  ownerEmail: HUB_OWNER_EMAIL,
                  webViewLink: `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
                  modifiedTime: f.modifiedTime,
                }));
                setHubCountsheetTemplates(mappedFolderTemplates);
                const preferred =
                  mappedFolderTemplates.find((t) => /random|countsheet|template/i.test(t.name)) ||
                  mappedFolderTemplates[0];
                if (preferred?.webViewLink) {
                  targetUrl = preferred.webViewLink;
                  setTemplateUrl(targetUrl);
                }
              }
            } catch {}
          }
        } else {
          // 2. Check server Hub Cache for icdhubsystems@gmail.com TEMPLATE/COUNTSHEET without any popup
          try {
            const hubData = await fetchHubTemplatesFromServer();
            if (Array.isArray(hubData.countsheetTemplates) && hubData.countsheetTemplates.length > 0) {
              setHubCountsheetTemplates(hubData.countsheetTemplates);
            }
            const hubCs = hubData.countsheetTemplates?.[0];
            if (hubCs?.webViewLink) {
              targetUrl = hubCs.webViewLink;
              setTemplateUrl(targetUrl);
            }
          } catch {}
        }
      }
      const updatedSpec = await fetchCountsheetTemplateSpec(tokenToUse, targetUrl, showFeedback);
      setTemplateSpec(updatedSpec);

      // If user explicitly clicked Refresh Template while editing an already-generated Google Sheet countsheet,
      // also push the updated RANDOM INVENTORY COUNTSHEET TEMPLATE (new font & column sizes) into that Google Sheet!
      const linkedSheetId = savedResult?.spreadsheetId || activeSessionSpreadsheetId;
      let syncedOpenSheet = false;
      if (
        showFeedback &&
        tokenToUse &&
        linkedSheetId &&
        !linkedSheetId.startsWith('cs_') &&
        !linkedSheetId.startsWith('draft_') &&
        totalSelectedCount > 0
      ) {
        try {
          const groupPlans: GroupCountsheetPlan[] = groups
            .map((g) => ({
              groupId: g.id,
              groupName: g.name,
              baseSheetName: g.baseSheetName || g.lastSelectedHierarchy || g.name,
              items: getOrderedGroupItems(g, onlyItemsWithBalance),
            }))
            .filter((g) => g.items.length > 0);
          if (groupPlans.length > 0) {
            const refreshedSheet = await updateExistingCountsheetSpreadsheet({
              accessToken: tokenToUse,
              templateSpreadsheetId: targetUrl,
              existingSpreadsheetId: linkedSheetId,
              targetSpreadsheetTitle:
                targetSpreadsheetTitle || `Audit Countsheets - ${selectedFile?.name || 'IATD'}`,
              insertCategorySpacers,
              groups: groupPlans,
            });
            if (refreshedSheet) {
              syncedOpenSheet = true;
              setSavedResult(refreshedSheet);
            }
          }
        } catch (syncSheetErr) {
          console.warn('Could not push refreshed template to linked sheet:', syncSheetErr);
        }
      }

      if (showFeedback) {
        const cleanFont = (updatedSpec.fontStyles?.itemDescCell?.fontFamily || 'Calibri')
          .split(',')[0]
          .replace(/['"]/g, '')
          .trim();
        const fontPt = updatedSpec.fontStyles?.itemDescCell?.fontSizePt || 9;
        setSavedToastMessage(
          `Refreshed "${updatedSpec.spreadsheetTitle}" (Font: ${cleanFont} ${fontPt}pt • Col B: ${updatedSpec.colWidths.B}px, Col C: ${updatedSpec.colWidths.C}px, Col K: ${updatedSpec.colWidths.K}px)${
            syncedOpenSheet ? ' & updated Google Sheet' : ''
          }`
        );
        setTimeout(() => setSavedToastMessage(null), 4500);
      }
    } catch (err: any) {
      if (showFeedback) {
        setSaveError(
          err?.message || 'Could not refresh RANDOM INVENTORY COUNTSHEET TEMPLATE from Google Sheets.'
        );
      }
    } finally {
      setIsRefreshingTemplate(false);
    }
  };

  // Reset state and lock body scroll when modal opens
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setCurrentStep('SELECT_FILE');
      setIatdError(null);
      setSaveError(null);
      setSavedResult(null);
      setActiveSessionId(null);
      setActiveSessionSpreadsheetId(null);
      setActiveSessionWebViewLink(null);
      setEditingBaseSheetName(false);
      setOnlyItemsWithBalance(false);
      setInsertCategorySpacers(false);
      const initial = [createInitialGroup(1)];
      setGroups(initial);
      setActiveGroupId(initial[0].id);
      setRecentCountsheets(getRecentCountsheets());
      handleSyncCloudRecents();
      handleRefreshTemplate(false);

      // Fetch drive files (immediately show cached files, then refresh from Drive)
      const cached = getCachedDriveFiles(driveQuery);
      if (cached.length > 0) {
        setDriveFiles(cached);
      }
      setIsSearchingDrive(true);
      setDriveSearchError(null);
      searchDriveSpreadsheets(effectiveToken || '', driveQuery)
        .then((files) => {
          setDriveFiles(files);
          setDriveSearchError(null);
        })
        .catch((err) => {
          console.warn('Drive search notice:', err);
          const fallbackCached = getCachedDriveFiles(driveQuery);
          if (fallbackCached.length > 0) {
            setDriveFiles(fallbackCached);
            setDriveSearchError(null);
          } else {
            setDriveSearchError(err?.message || 'Could not load spreadsheets from Google Drive.');
          }
        })
        .finally(() => setIsSearchingDrive(false));
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, effectiveToken]);

  // Search drive spreadsheets when query changes
  useEffect(() => {
    if (isOpen && currentStep === 'SELECT_FILE' && sourceViewMode === 'DRIVE') {
      const timer = setTimeout(() => {
        setIsSearchingDrive(true);
        setDriveSearchError(null);
        searchDriveSpreadsheets(effectiveToken || '', driveQuery)
          .then((files) => {
            setDriveFiles(files);
            setDriveSearchError(null);
          })
          .catch((err) => {
            console.warn('Drive search error:', err);
            const fallbackCached = getCachedDriveFiles(driveQuery);
            if (fallbackCached.length > 0) {
              setDriveFiles(fallbackCached);
              setDriveSearchError(null);
            } else {
              setDriveSearchError(err?.message || 'Could not load spreadsheets from Google Drive.');
            }
          })
          .finally(() => setIsSearchingDrive(false));
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [driveQuery, isOpen, effectiveToken, currentStep, sourceViewMode]);

  // Search Gmail branch spreadsheets when Email tab is active or emailQuery changes
  useEffect(() => {
    if (isOpen && currentStep === 'SELECT_FILE' && sourceViewMode === 'EMAIL') {
      const timer = setTimeout(() => {
        handleRefreshEmails(undefined, emailQuery);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [emailQuery, isOpen, effectiveToken, currentStep, sourceViewMode]);

  // Dynamically calculate each group's starting CS number (CS01, CS02, CS03...)
  // Uses row-aware 34-row packing so items with >40-char descriptions that span 2+ rows
  // accurately count toward the 34 physical rows per countsheet tab.
  const groupCsMeta = useMemo(() => {
    const CHUNK_SIZE = COUNTSHEET_MAX_ROWS_PER_SHEET;
    let nextCsNumber = 1;
    const itemById = new Map<string, ParsedIatdRow>();
    allItems.forEach((it) => itemById.set(it.id, it));

    const byGroupId = new Map<
      string,
      {
        startCsNumber: number;
        endCsNumber: number;
        csUsed: number;
        csName: string;
        validItemCount: number;
        physicalRowCount: number;
      }
    >();

    groups.forEach((grp) => {
      let validItemCount = grp.selectedItemIds.size;
      let physicalRowCount = validItemCount;
      let csUsed = Math.max(1, Math.ceil(validItemCount / CHUNK_SIZE));

      if (allItems.length > 0) {
        const rawOrdered: ParsedIatdRow[] = [];
        grp.selectedItemIds.forEach((id) => {
          const found = itemById.get(id);
          if (found) rawOrdered.push(found);
        });
        const ordered = groupItemsByHierarchyOrder(rawOrdered, itemSortBy, insertCategorySpacers);
        const validItems = onlyItemsWithBalance
          ? ordered.filter(
              (item) => item.balance !== 0 && item.balance !== undefined && item.balance !== null
            )
          : ordered;
        validItemCount = validItems.length;
        const packed = packItemsInto34RowSheets(
          validItems,
          CHUNK_SIZE,
          COUNTSHEET_DESC_MAX_CHARS,
          insertCategorySpacers
        );
        physicalRowCount = packed.reduce((sum, p) => sum + p.rowsUsed, 0);
        csUsed = Math.max(1, packed.length);
      }

      const startCsNumber = nextCsNumber;
      const endCsNumber = startCsNumber + csUsed - 1;
      const csName = formatCsCode(startCsNumber);

      byGroupId.set(grp.id, {
        startCsNumber,
        endCsNumber,
        csUsed,
        csName,
        validItemCount,
        physicalRowCount,
      });

      nextCsNumber += csUsed;
    });

    return {
      byGroupId,
      nextAvailableCsNumber: nextCsNumber,
      nextAvailableCsName: formatCsCode(nextCsNumber),
    };
  }, [groups, allItems, onlyItemsWithBalance, insertCategorySpacers, itemSortBy]);

  // Keep each group's name (and default baseSheetName when no category is chosen) synced to its dynamic CS number
  useEffect(() => {
    setGroups((prev) => {
      let changed = false;
      const updated = prev.map((g) => {
        const meta = groupCsMeta.byGroupId.get(g.id);
        if (!meta) return g;
        const expectedName = meta.csName;
        const shouldSyncBase =
          !g.lastSelectedHierarchy && isDefaultGroupOrCsName(g.baseSheetName);
        const expectedBase = shouldSyncBase ? expectedName : g.baseSheetName;
        if (g.name !== expectedName || g.baseSheetName !== expectedBase) {
          changed = true;
          return {
            ...g,
            name: expectedName,
            baseSheetName: expectedBase,
          };
        }
        return g;
      });
      return changed ? updated : prev;
    });
  }, [groupCsMeta]);

  // Active group accessor
  const activeGroup = useMemo(() => {
    return groups.find((g) => g.id === activeGroupId) || groups[0];
  }, [groups, activeGroupId]);

  const activeGroupMeta = useMemo(() => {
    const meta = groupCsMeta.byGroupId.get(activeGroup.id);
    if (!meta) return undefined;
    const csRangeLabel =
      meta.csUsed > 1
        ? `${formatCsCode(meta.startCsNumber)}–${formatCsCode(meta.endCsNumber)}`
        : meta.csName;
    return {
      ...meta,
      csRangeLabel,
      sheetsNeeded: meta.csUsed,
    };
  }, [groupCsMeta, activeGroup.id]);

  // Update active group helper
  const updateActiveGroup = (
    updater: Partial<SelectionGroup> | ((prev: SelectionGroup) => SelectionGroup)
  ) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== activeGroup.id) return g;
        return typeof updater === 'function' ? updater(g) : { ...g, ...updater };
      })
    );
  };

  // Add a new Countsheet Group (CS02, or CS03 if previous group used 2 countsheets, etc.)
  const handleAddGroup = () => {
    const nextNum = groupCsMeta.nextAvailableCsNumber;
    const newGrp = createInitialGroup(nextNum);
    setGroups((prev) => [...prev, newGrp]);
    setActiveGroupId(newGrp.id);
  };

  // Remove a group
  const handleRemoveGroup = (groupId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (groups.length <= 1) return;
    setGroups((prev) => {
      const filtered = prev.filter((g) => g.id !== groupId);
      if (activeGroupId === groupId) {
        setActiveGroupId(filtered[0]?.id || '');
      }
      return filtered;
    });
  };

  // Load IATD file
  const handleSelectIatdSpreadsheet = async (
    file: DriveSpreadsheetFile,
    preferredTab?: string,
    customHeaderRow?: number
  ) => {
    setIsLoadingIatd(true);
    setIatdError(null);
    setSelectedFile(file);

    try {
      const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) || effectiveToken || '';
      let activeFile = file;
      const isExcelOrCsv =
        (file.mimeType && file.mimeType !== 'application/vnd.google-apps.spreadsheet') ||
        /\.(xlsx|xls|csv|ods|xlsm|xlsb)$/i.test(file.name || '');

      if (isExcelOrCsv) {
        try {
          const converted = await convertDriveExcelFileToGoogleSheet(tokenToUse, file);
          activeFile = converted;
          setSelectedFile(converted);
          setDriveFiles((prev) => [converted, ...prev.filter((f) => f.id !== converted.id)]);
          setEmailConversionToast({
            message: `Auto-converted "${file.name}" into Google Sheets compatible format ("${converted.name}")!`,
            webViewLink: converted.webViewLink,
            spreadsheetId: converted.id,
            spreadsheetName: converted.name,
          });
        } catch (convErr) {
          console.warn('Could not auto-convert Excel file before loading:', convErr);
        }
      }

      const cleanId = extractSpreadsheetId(activeFile.id);
      const { tabs } = await getSpreadsheetTabs(tokenToUse, cleanId);
      setSpreadsheetTabs(tabs);

      const targetTab = preferredTab || (tabs.length > 0 ? tabs[0].title : 'Sheet1');
      setSelectedTab(targetTab);

      // Fetch all sheet rows
      const { headers, rows } = await fetchAllSheetRows(
        tokenToUse,
        cleanId,
        targetTab,
        customHeaderRow ?? headerRow
      );

      setRawHeaders(headers);

      // Auto-detect headers for "Item Description", "Cat", "SubCat", "SubSubCat", "Cost", "Selling", etc.
      let descCol = '';
      let catCol = '';
      let subCatCol = '';
      let subSubCatCol = '';
      let codeCol = '';
      let barcodeCol = '';
      let costCol = '';
      let sellingCol = '';
      let unitCol = '';
      let balanceCol = '';

      headers.forEach((h) => {
        const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!descCol && /^(itemdescription|description|desc|particulars|itemname|productname|itemdesc|stockdescription)$/i.test(norm)) {
          descCol = h;
        } else if (!catCol && /^(category|cat|itemcategory|group|grp|class|classification|dept)$/i.test(norm)) {
          catCol = h;
        } else if (!subCatCol && /^(subcategory|subcat|subgroup|subclass|subgrp)$/i.test(norm)) {
          subCatCol = h;
        } else if (!subSubCatCol && /^(subsubcategory|subsubcat|subsubgroup|subsubclass)$/i.test(norm)) {
          subSubCatCol = h;
        } else if (!codeCol && /^(itemcode|code|itemno|sku|matcode|productcode)$/i.test(norm)) {
          codeCol = h;
        } else if (!barcodeCol && /^(barcode|upc|ean|barcodeno|scancode)$/i.test(norm)) {
          barcodeCol = h;
        } else if (!costCol && /^(cost|unitcost|ucost|costprice|buyprice|stdcost)$/i.test(norm)) {
          costCol = h;
        } else if (!sellingCol && /^(selling|sellingprice|sprice|sellprice|retail|srp|unitprice)$/i.test(norm)) {
          sellingCol = h;
        } else if (!unitCol && /^(unit|uom|unitofmeasure|pack|package)$/i.test(norm)) {
          unitCol = h;
        } else if (!balanceCol && /^(balance|qty|quantity|begqty|onhand|stock|endingbalance)$/i.test(norm)) {
          balanceCol = h;
        }
      });

      // Fallbacks if exact regex didn't catch
      if (!descCol) descCol = headers.find((h) => /desc/i.test(h)) || headers[1] || '';
      if (!catCol) catCol = headers.find((h) => /cat/i.test(h) && !/sub/i.test(h)) || '';
      if (!subCatCol) subCatCol = headers.find((h) => /sub.*cat/i.test(h)) || '';
      if (!subSubCatCol) subSubCatCol = headers.find((h) => /sub.*sub/i.test(h)) || '';
      if (!codeCol) codeCol = headers.find((h) => /code/i.test(h) && !/bar/i.test(h)) || headers[0] || '';
      if (!barcodeCol) barcodeCol = headers.find((h) => /bar/i.test(h)) || '';
      if (!costCol) costCol = headers.find((h) => /cost/i.test(h)) || '';
      if (!sellingCol) sellingCol = headers.find((h) => /sell|retail|srp/i.test(h)) || '';
      if (!unitCol) unitCol = headers.find((h) => /unit|uom/i.test(h)) || '';
      if (!balanceCol) balanceCol = headers.find((h) => /bal|qty/i.test(h)) || '';

      setMappedDescCol(descCol);
      setMappedCatCol(catCol);
      setMappedSubCatCol(subCatCol);
      setMappedSubSubCatCol(subSubCatCol);
      setMappedCodeCol(codeCol);
      setMappedBarcodeCol(barcodeCol);
      setMappedCostCol(costCol);
      setMappedSellingCol(sellingCol);
      setMappedUnitCol(unitCol);
      setMappedBalanceCol(balanceCol);

      // Parse rows
      const parsedItems = parseRowsWithHeaders(
        headers,
        rows,
        descCol,
        catCol,
        subCatCol,
        subSubCatCol,
        codeCol,
        barcodeCol,
        costCol,
        sellingCol,
        unitCol,
        balanceCol
      );

      // If groups already have selected items (e.g., from an imported Countsheet template),
      // re-link their selectedItemIds to the newly loaded IATD items using Item Code!
      if (allItems.length > 0 && groups.some((g) => g.selectedItemIds.size > 0)) {
        const oldItemById = new Map<string, ParsedIatdRow>();
        allItems.forEach((it) => oldItemById.set(it.id, it));

        const normCode = (v?: string) => String(v || '').trim().toLowerCase();
        const stripZero = (v?: string) => normCode(v).replace(/^0+(?=\d)/, '');

        const newByCode = new Map<string, string>();
        const newByStripped = new Map<string, string>();
        parsedItems.forEach((it) => {
          if (it.itemCode) {
            const c = normCode(it.itemCode);
            const s = stripZero(it.itemCode);
            if (!newByCode.has(c)) newByCode.set(c, it.id);
            if (s && !newByStripped.has(s)) newByStripped.set(s, it.id);
          }
          if (it.barcode) {
            const b = normCode(it.barcode);
            if (!newByCode.has(b)) newByCode.set(b, it.id);
          }
        });

        setGroups((prevGroups) =>
          prevGroups.map((g) => {
            if (g.selectedItemIds.size === 0) return g;
            const remappedIds: string[] = [];
            g.selectedItemIds.forEach((oldId) => {
              const oldItem = oldItemById.get(oldId);
              const rawCode = oldItem?.itemCode || oldItem?.barcode || '';
              const c = normCode(rawCode);
              const s = stripZero(rawCode);
              const matchedId =
                (c && newByCode.get(c)) ||
                (s && newByStripped.get(s)) ||
                (parsedItems.some((p) => p.id === oldId) ? oldId : undefined);
              if (matchedId && !remappedIds.includes(matchedId)) {
                remappedIds.push(matchedId);
              }
            });
            return remappedIds.length > 0
              ? { ...g, selectedItemIds: new Set(remappedIds) }
              : g;
          })
        );
      }

      setAllItems(parsedItems);

      // Set target spreadsheet name default
      const dateStr = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      setTargetSpreadsheetTitle(`Audit Countsheets - ${file.name || 'IATD'} (${dateStr})`);

      setCurrentStep('FILTER_ITEMS');
      return parsedItems;
    } catch (err: any) {
      console.error('Failed to load IATD:', err);
      setDriveFiles(getCachedDriveFiles(driveQuery));
      setIatdError(err.message || 'Could not load IATD spreadsheet. Check access permissions.');
      return [];
    } finally {
      setIsLoadingIatd(false);
    }
  };

  // Helper to parse rows into ParsedIatdRow
  const parseRowsWithHeaders = (
    headers: string[],
    rows: any[][],
    descCol: string,
    catCol: string,
    subCatCol: string,
    subSubCatCol: string,
    codeCol: string,
    barcodeCol: string,
    costCol: string,
    sellingCol: string,
    unitCol: string,
    balanceCol: string
  ): ParsedIatdRow[] => {
    const descIdx = headers.indexOf(descCol);
    const catIdx = headers.indexOf(catCol);
    const subCatIdx = headers.indexOf(subCatCol);
    const subSubCatIdx = headers.indexOf(subSubCatCol);
    const codeIdx = headers.indexOf(codeCol);
    const barcodeIdx = headers.indexOf(barcodeCol);
    const costIdx = headers.indexOf(costCol);
    const sellingIdx = headers.indexOf(sellingCol);
    const unitIdx = headers.indexOf(unitCol);
    const balanceIdx = headers.indexOf(balanceCol);

    return rows
      .filter((row, idx) => {
        if (!row || !row.some((cell) => cell !== undefined && String(cell).trim().length > 0)) {
          return false;
        }
        // Exclude IATD trailing footer rows ("Total Quantity:" and "v.1.26.26" / "v.X.X.X") from selectable inventory items
        if (isIatdTotalQuantityFooterRow(row)) return false;
        if (isIatdVersionFooterRow(row, idx > 0 ? rows[idx - 1] : undefined)) return false;
        return true;
      })
      .map((row, index) => {
        const itemCode = codeIdx >= 0 ? String(row[codeIdx] || '').trim() : '';
        const barcode = barcodeIdx >= 0 ? String(row[barcodeIdx] || '').trim() : '';
        const itemDescription = descIdx >= 0 ? String(row[descIdx] || '').trim() : `Item ${index + 1}`;
        const category = catIdx >= 0 ? String(row[catIdx] || '').trim() : '';
        const subCategory = subCatIdx >= 0 ? String(row[subCatIdx] || '').trim() : '';
        const subsubCategory = subSubCatIdx >= 0 ? String(row[subSubCatIdx] || '').trim() : '';
        const unit = unitIdx >= 0 ? String(row[unitIdx] || '').trim() : 'PCS';

        const rawBal = balanceIdx >= 0 ? parseFloat(String(row[balanceIdx]).replace(/,/g, '')) : 0;
        const balance = isNaN(rawBal) ? 0 : rawBal;

        const rawCost = costIdx >= 0 ? parseFloat(String(row[costIdx]).replace(/[^0-9.-]/g, '')) : 0;
        const cost = isNaN(rawCost) ? 0 : rawCost;

        const rawSelling = sellingIdx >= 0 ? parseFloat(String(row[sellingIdx]).replace(/[^0-9.-]/g, '')) : 0;
        const selling = isNaN(rawSelling) ? 0 : rawSelling;

        return {
          id: `${itemCode || barcode || index}_${index}`,
          rowIndex: index,
          itemCode,
          barcode,
          itemDescription,
          category,
          subCategory,
          subsubCategory,
          unit: unit || 'PCS',
          balance,
          cost,
          selling,
          raw: row,
        };
      });
  };

  // Reparse if user manually changes mapped headers
  const handleUpdateHeaderMapping = (
    newDescCol = mappedDescCol,
    newCatCol = mappedCatCol,
    newSubCatCol = mappedSubCatCol,
    newSubSubCatCol = mappedSubSubCatCol,
    newCostCol = mappedCostCol,
    newSellingCol = mappedSellingCol
  ) => {
    setMappedDescCol(newDescCol);
    setMappedCatCol(newCatCol);
    setMappedSubCatCol(newSubCatCol);
    setMappedSubSubCatCol(newSubSubCatCol);
    setMappedCostCol(newCostCol);
    setMappedSellingCol(newSellingCol);

    const remapped = parseRowsWithHeaders(
      rawHeaders,
      allItems.map((i) => i.raw),
      newDescCol,
      newCatCol,
      newSubCatCol,
      newSubSubCatCol,
      mappedCodeCol,
      mappedBarcodeCol,
      newCostCol,
      newSellingCol,
      mappedUnitCol,
      mappedBalanceCol
    );
    setAllItems(remapped);
  };

  const safeLower = (val: unknown) => String(val ?? '').trim().toLowerCase();

  // HIERARCHY SEARCH FILTER (Drill-Down Box Search Bar)
  // "when i said put a searchbar, im pertaining to search on the Cat, SubCat, SubSubCat Names. not the Item Description. and i want it on the drill down box"
  // "and for example i searches Beverages then the selection of unique Category, SubSubCategory and SubCategory below will only show beverages"

  // 1. UNIQUE CATEGORIES (pertains to "Cat" header in IATD)
  const uniqueCategories = useMemo(() => {
    const qLower = safeLower(activeGroup.hierarchySearchQuery);
    const map = new Map<string, number>();
    for (const item of allItems) {
      const cat = (item.category ?? '').trim();
      if (!cat) continue;
      // If drill-down search is active, match category name
      if (qLower && !safeLower(cat).includes(qLower)) {
        continue;
      }
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allItems, activeGroup.hierarchySearchQuery]);

  const getGroupSelectedCats = (g: SelectionGroup): string[] =>
    g.selectedCats && g.selectedCats.length > 0
      ? g.selectedCats
      : g.selectedCat
      ? [g.selectedCat]
      : [];

  const getGroupSelectedSubCats = (g: SelectionGroup): string[] =>
    g.selectedSubCats && g.selectedSubCats.length > 0
      ? g.selectedSubCats
      : g.selectedSubCat
      ? [g.selectedSubCat]
      : [];

  const getGroupSelectedSubSubCats = (g: SelectionGroup): string[] =>
    g.selectedSubSubCats && g.selectedSubSubCats.length > 0
      ? g.selectedSubSubCats
      : g.selectedSubSubCat
      ? [g.selectedSubSubCat]
      : [];

  const activeSelectedCats = useMemo(
    () => getGroupSelectedCats(activeGroup),
    [activeGroup.selectedCats, activeGroup.selectedCat]
  );

  const activeSelectedSubCats = useMemo(
    () => getGroupSelectedSubCats(activeGroup),
    [activeGroup.selectedSubCats, activeGroup.selectedSubCat]
  );

  const activeSelectedSubSubCats = useMemo(
    () => getGroupSelectedSubSubCats(activeGroup),
    [activeGroup.selectedSubSubCats, activeGroup.selectedSubSubCat]
  );

  const matchesCategoryList = (itemCat: string, selectedCatsList: string[]): boolean => {
    if (selectedCatsList.length === 0) return true;
    const itemCatLower = safeLower(itemCat);
    return selectedCatsList.some((c) => safeLower(c) === itemCatLower);
  };

  const matchesSubLevelList = (itemVal: string, selectedList: string[]): boolean => {
    if (selectedList.length === 0) return true;
    const itemLower = safeLower(itemVal);
    return selectedList.some((s) => {
      const sLower = safeLower(s);
      if (sLower === '(blanks)' || sLower === 'blanks') {
        return itemLower === '';
      }
      return itemLower === sLower;
    });
  };

  // 2. UNIQUE SUBCATEGORIES UNDER SELECTED CATEGORIES OF ACTIVE GROUP
  const uniqueSubCategories = useMemo(() => {
    const qLower = safeLower(activeGroup.hierarchySearchQuery);
    const filtered =
      activeSelectedCats.length > 0
        ? allItems.filter((i) => matchesCategoryList(i.category, activeSelectedCats))
        : allItems;
    const map = new Map<string, number>();
    for (const item of filtered) {
      const sub = (item.subCategory ?? '').trim();
      const subKey = sub === '' ? '(Blanks)' : sub;
      // If drill-down search is active, match subcategory name (or parent category name)
      if (qLower && !safeLower(subKey).includes(qLower) && !safeLower(item.category).includes(qLower)) {
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
  }, [allItems, activeSelectedCats, activeGroup.hierarchySearchQuery]);

  // 3. UNIQUE SUBSUBCATEGORIES UNDER SELECTED SUBCATEGORIES OF ACTIVE GROUP
  const uniqueSubSubCategories = useMemo(() => {
    const qLower = safeLower(activeGroup.hierarchySearchQuery);
    const filtered = allItems.filter((i) => {
      if (!matchesCategoryList(i.category, activeSelectedCats)) {
        return false;
      }
      if (!matchesSubLevelList(i.subCategory, activeSelectedSubCats)) {
        return false;
      }
      return true;
    });
    const map = new Map<string, number>();
    for (const item of filtered) {
      const subsub = (item.subsubCategory ?? '').trim();
      const subsubKey = subsub === '' ? '(Blanks)' : subsub;
      // If drill-down search is active, match subsubcategory name (or subcat / category name)
      if (
        qLower &&
        !safeLower(subsubKey).includes(qLower) &&
        !safeLower(item.subCategory).includes(qLower) &&
        !safeLower(item.category).includes(qLower)
      ) {
        continue;
      }
      map.set(subsubKey, (map.get(subsubKey) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === '(Blanks)') return -1;
        if (b.name === '(Blanks)') return 1;
        return a.name.localeCompare(b.name);
      });
  }, [allItems, activeSelectedCats, activeSelectedSubCats, activeGroup.hierarchySearchQuery]);

  // 4. FILTERED ITEMS LIST FOR ACTIVE GROUP
  const displayedItems = useMemo(() => {
    const qLower = safeLower(activeGroup.itemSearchQuery);
    const hqLower = safeLower(activeGroup.hierarchySearchQuery);

    if (showSelectedItemsOnly) {
      const orderedSelected = getOrderedGroupItems(activeGroup, onlyItemsWithBalance);
      if (!qLower) return orderedSelected;
      return orderedSelected.filter((item) => {
        const matchesDesc = safeLower(item.itemDescription).includes(qLower);
        const matchesCode = safeLower(item.itemCode).includes(qLower);
        const matchesBar = safeLower(item.barcode).includes(qLower);
        return matchesDesc || matchesCode || matchesBar;
      });
    }

    return allItems
      .filter((item) => {
        // Balance filter: if checked, only transfer items with balance (non-zero balance)
        if (
          onlyItemsWithBalance &&
          (item.balance === 0 || item.balance === undefined || item.balance === null)
        ) {
          return false;
        }
        // Drill-down hierarchy name search:
        if (hqLower) {
          const matchesCat = safeLower(item.category).includes(hqLower);
          const matchesSubCat =
            safeLower(item.subCategory).includes(hqLower) ||
            (hqLower.includes('blank') && !item.subCategory);
          const matchesSubSubCat =
            safeLower(item.subsubCategory).includes(hqLower) ||
            (hqLower.includes('blank') && !item.subsubCategory);
          if (!matchesCat && !matchesSubCat && !matchesSubSubCat) {
            return false;
          }
        }
        // Multi-Category filter
        if (!matchesCategoryList(item.category, activeSelectedCats)) {
          return false;
        }
        // Multi-SubCat filter
        if (!matchesSubLevelList(item.subCategory, activeSelectedSubCats)) {
          return false;
        }
        // Multi-SubSubCat filter
        if (!matchesSubLevelList(item.subsubCategory, activeSelectedSubSubCats)) {
          return false;
        }
        // Item Description Search Query
        if (qLower) {
          const matchesDesc = safeLower(item.itemDescription).includes(qLower);
          const matchesCode = safeLower(item.itemCode).includes(qLower);
          const matchesBar = safeLower(item.barcode).includes(qLower);
          if (!matchesDesc && !matchesCode && !matchesBar) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => compareItemsBySortMode(a, b, itemSortBy));
  }, [
    allItems,
    activeGroup,
    activeSelectedCats,
    activeSelectedSubCats,
    activeSelectedSubSubCats,
    activeGroup.itemSearchQuery,
    activeGroup.hierarchySearchQuery,
    onlyItemsWithBalance,
    showSelectedItemsOnly,
    itemSortBy,
  ]);

  const handleChangeItemSort = (mode: 'itemCode' | 'itemDescription') => {
    setItemSortBy(mode);
    setShowSortDropdown(false);
    // Arrange selected items in the countsheet A–Z based on Item Code or Item Description
    const itemById = new Map<string, ParsedIatdRow>();
    allItems.forEach((it) => itemById.set(it.id, it));
    setGroups((prev) =>
      prev.map((g) => {
        if (g.selectedItemIds.size <= 1) return g;
        const rawOrdered: ParsedIatdRow[] = [];
        g.selectedItemIds.forEach((id) => {
          const found = itemById.get(id);
          if (found) rawOrdered.push(found);
        });
        const sortedItems = groupItemsByHierarchyOrder(rawOrdered, mode, insertCategorySpacers);
        return {
          ...g,
          selectedItemIds: new Set(sortedItems.map((item) => item.id)),
        };
      })
    );
  };

  const deriveHierarchyLabelAndSheetName = (
    cats: string[],
    subCats: string[],
    subSubCats: string[],
    fallbackGroupName: string
  ): { lastHierarchy: string; sheetName: string } => {
    if (subSubCats.length > 0) {
      const parentName = subCats[0] || cats[0] || 'Category';
      const formatted = subSubCats
        .map((s) => (s === '(Blanks)' ? `${parentName} - Blanks` : s))
        .join(', ');
      return { lastHierarchy: formatted, sheetName: formatted.slice(0, 60) };
    }
    if (subCats.length > 0) {
      const parentName = cats[0] || '';
      const formatted = subCats
        .map((s) => (s === '(Blanks)' ? (parentName ? `${parentName} - Blanks` : 'Blanks') : s))
        .join(', ');
      return { lastHierarchy: formatted, sheetName: formatted.slice(0, 60) };
    }
    if (cats.length > 0) {
      const formatted = cats.join(', ');
      return { lastHierarchy: formatted, sheetName: formatted.slice(0, 60) };
    }
    return { lastHierarchy: '', sheetName: fallbackGroupName };
  };

  // MULTI-SELECT CATEGORY / SUBCAT / SUBSUBCAT CLICK HANDLERS
  const handleSelectCategory = (catName: string) => {
    const exists = activeSelectedCats.some((c) => safeLower(c) === safeLower(catName));
    const nextCats = exists
      ? activeSelectedCats.filter((c) => safeLower(c) !== safeLower(catName))
      : [...activeSelectedCats, catName];

    // Keep only subcategories/sub-subcategories that still exist under the selected categories
    const catFilteredItems =
      nextCats.length > 0
        ? allItems.filter((i) => matchesCategoryList(i.category, nextCats))
        : allItems;
    const validSubSet = new Set(
      catFilteredItems.map((i) => {
        const s = (i.subCategory ?? '').trim();
        return safeLower(s === '' ? '(Blanks)' : s);
      })
    );
    const nextSubCats = activeSelectedSubCats.filter((sc) => validSubSet.has(safeLower(sc)));

    const subFilteredItems =
      nextSubCats.length > 0
        ? catFilteredItems.filter((i) => matchesSubLevelList(i.subCategory, nextSubCats))
        : catFilteredItems;
    const validSubSubSet = new Set(
      subFilteredItems.map((i) => {
        const ss = (i.subsubCategory ?? '').trim();
        return safeLower(ss === '' ? '(Blanks)' : ss);
      })
    );
    const nextSubSubCats = activeSelectedSubSubCats.filter((ssc) =>
      validSubSubSet.has(safeLower(ssc))
    );

    const { lastHierarchy, sheetName } = deriveHierarchyLabelAndSheetName(
      nextCats,
      nextSubCats,
      nextSubSubCats,
      activeGroup.name
    );

    updateActiveGroup({
      selectedCats: nextCats,
      selectedSubCats: nextSubCats,
      selectedSubSubCats: nextSubSubCats,
      selectedCat: nextCats.join(', '),
      selectedSubCat: nextSubCats.join(', '),
      selectedSubSubCat: nextSubSubCats.join(', '),
      lastSelectedHierarchy: lastHierarchy,
      baseSheetName: sheetName,
    });
  };

  const handleSelectSubCategory = (subCatName: string) => {
    const exists = activeSelectedSubCats.some((sc) => safeLower(sc) === safeLower(subCatName));
    const nextSubCats = exists
      ? activeSelectedSubCats.filter((sc) => safeLower(sc) !== safeLower(subCatName))
      : [...activeSelectedSubCats, subCatName];

    const catFilteredItems =
      activeSelectedCats.length > 0
        ? allItems.filter((i) => matchesCategoryList(i.category, activeSelectedCats))
        : allItems;
    const subFilteredItems =
      nextSubCats.length > 0
        ? catFilteredItems.filter((i) => matchesSubLevelList(i.subCategory, nextSubCats))
        : catFilteredItems;
    const validSubSubSet = new Set(
      subFilteredItems.map((i) => {
        const ss = (i.subsubCategory ?? '').trim();
        return safeLower(ss === '' ? '(Blanks)' : ss);
      })
    );
    const nextSubSubCats = activeSelectedSubSubCats.filter((ssc) =>
      validSubSubSet.has(safeLower(ssc))
    );

    const { lastHierarchy, sheetName } = deriveHierarchyLabelAndSheetName(
      activeSelectedCats,
      nextSubCats,
      nextSubSubCats,
      activeGroup.name
    );

    updateActiveGroup({
      selectedSubCats: nextSubCats,
      selectedSubSubCats: nextSubSubCats,
      selectedSubCat: nextSubCats.join(', '),
      selectedSubSubCat: nextSubSubCats.join(', '),
      lastSelectedHierarchy: lastHierarchy,
      baseSheetName: sheetName,
    });
  };

  const handleSelectSubSubCategory = (subSubCatName: string) => {
    const exists = activeSelectedSubSubCats.some(
      (ssc) => safeLower(ssc) === safeLower(subSubCatName)
    );
    const nextSubSubCats = exists
      ? activeSelectedSubSubCats.filter((ssc) => safeLower(ssc) !== safeLower(subSubCatName))
      : [...activeSelectedSubSubCats, subSubCatName];

    const { lastHierarchy, sheetName } = deriveHierarchyLabelAndSheetName(
      activeSelectedCats,
      activeSelectedSubCats,
      nextSubSubCats,
      activeGroup.name
    );

    updateActiveGroup({
      selectedSubSubCats: nextSubSubCats,
      selectedSubSubCat: nextSubSubCats.join(', '),
      lastSelectedHierarchy: lastHierarchy,
      baseSheetName: sheetName,
    });
  };

  // CHECKBOX SELECTION IN ACTIVE GROUP
  const handleToggleSelectItem = (id: string) => {
    updateActiveGroup((prev) => {
      const next = new Set(prev.selectedItemIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { ...prev, selectedItemIds: next };
    });
  };

  const handleSelectAllDisplayed = () => {
    updateActiveGroup((prev) => {
      const next = new Set(prev.selectedItemIds);
      displayedItems.forEach((i) => next.add(i.id));
      return { ...prev, selectedItemIds: next };
    });
  };

  const handleDeselectAllDisplayed = () => {
    updateActiveGroup((prev) => {
      const next = new Set(prev.selectedItemIds);
      displayedItems.forEach((i) => next.delete(i.id));
      return { ...prev, selectedItemIds: next };
    });
  };

  // RANDOM PICKER FOR ACTIVE GROUP (Row-aware 34-row physical budget including spacer rows between different Category/SubCat/SubSubCat)
  const handlePickRandomItems = (count: number) => {
    if (displayedItems.length === 0) return;
    const targetRowBudget = Math.max(1, count);
    const shuffled = [...displayedItems].sort(() => 0.5 - Math.random());

    const picked: ParsedIatdRow[] = [];

    for (const candidate of shuffled) {
      const candidateList = groupItemsByHierarchyOrder(
        [...picked, candidate].sort((a, b) => compareItemsBySortMode(a, b, itemSortBy))
      );
      const packed = packItemsInto34RowSheets(
        candidateList,
        COUNTSHEET_MAX_ROWS_PER_SHEET,
        COUNTSHEET_DESC_MAX_CHARS,
        insertCategorySpacers
      );
      const totalPhysicalRows =
        packed.length <= 1
          ? packed[0]?.rowsUsed || 0
          : (packed.length - 1) * COUNTSHEET_MAX_ROWS_PER_SHEET +
            (packed[packed.length - 1]?.rowsUsed || 0);

      if (totalPhysicalRows <= targetRowBudget) {
        picked.push(candidate);
        if (totalPhysicalRows >= targetRowBudget) {
          break;
        }
      }
    }

    if (picked.length === 0 && shuffled.length > 0) {
      picked.push(shuffled[0]);
    }

    const selected = groupItemsByHierarchyOrder(
      picked.sort((a, b) => compareItemsBySortMode(a, b, itemSortBy))
    );

    updateActiveGroup((prev) => ({
      ...prev,
      selectedItemIds: new Set(selected.map((i) => i.id)),
    }));
  };

  // Helper: Get group items ordered for the countsheet (A–Z by Item Code or Item Description)
  const getOrderedGroupItems = (g: SelectionGroup, filterBalance = onlyItemsWithBalance): ParsedIatdRow[] => {
    const itemById = new Map<string, ParsedIatdRow>();
    allItems.forEach((item) => itemById.set(item.id, item));
    const rawOrdered: ParsedIatdRow[] = [];
    g.selectedItemIds.forEach((id) => {
      const found = itemById.get(id);
      if (found) rawOrdered.push(found);
    });
    const ordered = groupItemsByHierarchyOrder(rawOrdered, itemSortBy, insertCategorySpacers);
    if (filterBalance) {
      return ordered.filter(
        (item) => item.balance !== 0 && item.balance !== undefined && item.balance !== null
      );
    }
    return ordered;
  };

  // Template row & spacer allocation for the active group (Rows 1..34 per countsheet tab)
  const activeGroupRowAllocation = useMemo(() => {
    const ordered = getOrderedGroupItems(activeGroup, onlyItemsWithBalance);
    const pages = packItemsInto34RowSheets(
      ordered,
      COUNTSHEET_MAX_ROWS_PER_SHEET,
      COUNTSHEET_DESC_MAX_CHARS,
      insertCategorySpacers
    );
    const activeMeta = groupCsMeta.byGroupId.get(activeGroup.id);
    const baseCsNum = activeMeta?.startCsNumber || 1;

    const itemAllocation = new Map<
      string,
      {
        csLabel: string;
        pageIndex: number;
        startRow: number;
        endRow: number;
        precededBySpacerRow: number | null;
      }
    >();

    let spacerCount = 0;

    pages.forEach((page, pIdx) => {
      const csLabel = formatCsCode(baseCsNum + pIdx);
      let pendingSpacerRow: number | null = null;

      (page.physicalRows || []).forEach((slot, sIdx) => {
        const rowNum = sIdx + 1;
        if (slot.isSpacer) {
          spacerCount += 1;
          pendingSpacerRow = rowNum;
          return;
        }
        if (slot.item) {
          const existing = itemAllocation.get(slot.item.id);
          if (!existing) {
            itemAllocation.set(slot.item.id, {
              csLabel,
              pageIndex: pIdx,
              startRow: rowNum,
              endRow: rowNum,
              precededBySpacerRow: pendingSpacerRow,
            });
            pendingSpacerRow = null;
          } else {
            existing.endRow = rowNum;
          }
        }
      });
    });

    return {
      itemAllocation,
      spacerCount,
      totalPages: pages.length,
    };
  }, [activeGroup, allItems, onlyItemsWithBalance, insertCategorySpacers, itemSortBy, groupCsMeta]);

  // OVERALL COUNTSHEET PLAN CALCULATION
  // Packs items into 34 physical rows per sheet (accounting for >40-char descriptions that use 2+ rows)
  const overallPlan = useMemo(() => {
    const CHUNK_SIZE = COUNTSHEET_MAX_ROWS_PER_SHEET;
    const planList: Array<{
      groupIndex: number;
      groupId: string;
      groupName: string;
      baseSheetName: string;
      sheetTitle: string;
      itemCount: number;
      physicalRowCount: number;
      partNumber: number;
      totalParts: number;
    }> = [];

    const usedTitles = new Set<string>(['all items']);

    groups.forEach((grp, gIdx) => {
      const validItems = getOrderedGroupItems(grp, onlyItemsWithBalance);
      const itemsCount = validItems.length;
      if (itemsCount === 0) return;

      const packedPages = packItemsInto34RowSheets(
        validItems,
        CHUNK_SIZE,
        COUNTSHEET_DESC_MAX_CHARS,
        insertCategorySpacers
      );
      const meta = groupCsMeta.byGroupId.get(grp.id);
      const fallbackCsName = meta?.csName || formatCsCode(gIdx + 1);
      const totalParts = Math.max(1, packedPages.length);
      let baseRaw = (grp.baseSheetName || grp.lastSelectedHierarchy || grp.name || fallbackCsName)
        .replace(/[\\/?*[\]:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!baseRaw) baseRaw = fallbackCsName;
      const cleanBase = baseRaw.slice(0, 60).trim();
      const csMatch = cleanBase.match(/^CS(\d+)$/i);

      for (let p = 0; p < totalParts; p++) {
        const page = packedPages[p] || { items: [], physicalRows: [], rowsUsed: 0 };
        const partNum = p + 1;
        // If base is CS01 and spans 2 parts, name them CS01, CS02; otherwise "(Name)", "(Name) 2"
        let titleCandidate = (
          csMatch
            ? formatCsCode(parseInt(csMatch[1], 10) + p)
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
              ? formatCsCode(parseInt(csMatch[1], 10) + counter - 1)
              : `${cleanBase} ${counter}`
          )
            .replace(/\s+/g, ' ')
            .trim();
        }
        usedTitles.add(titleCandidate.toLowerCase());

        planList.push({
          groupIndex: gIdx + 1,
          groupId: grp.id,
          groupName: fallbackCsName,
          baseSheetName: cleanBase,
          sheetTitle: titleCandidate,
          itemCount: page.items.length,
          physicalRowCount: page.rowsUsed,
          partNumber: partNum,
          totalParts,
        });
      }
    });

    return planList;
  }, [groups, allItems, onlyItemsWithBalance, insertCategorySpacers, itemSortBy, groupCsMeta]);

  const totalSelectedCount = useMemo(() => {
    return groups.reduce((acc, g) => {
      const groupItems = allItems.filter((item) => g.selectedItemIds.has(item.id));
      const validItems = onlyItemsWithBalance
        ? groupItems.filter((item) => item.balance !== 0 && item.balance !== undefined && item.balance !== null)
        : groupItems;
      return acc + validItems.length;
    }, 0);
  }, [groups, allItems, onlyItemsWithBalance]);

  // Build full RecentCountsheetSession payload for saving/reusing & Create Encoding integration
  const buildSessionSavePayload = (
    overrideSpreadsheetId?: string,
    overrideSpreadsheetName?: string,
    overrideWebViewLink?: string,
    overrideSheetsCreated?: CreateCountsheetFromTemplateResult['sheetsCreated']
  ) => {
    const CHUNK_SIZE = COUNTSHEET_MAX_ROWS_PER_SHEET;
    let runningCs = 1;
    const allOrderedCountsheetItems: PreGeneratedCountsheetItem[] = [];

    const savedGroups = groups.map((g) => {
      const groupItems = getOrderedGroupItems(g, onlyItemsWithBalance);
      const packedPages = packItemsInto34RowSheets(
        groupItems,
        CHUNK_SIZE,
        COUNTSHEET_DESC_MAX_CHARS,
        insertCategorySpacers
      );
      const csUsed = Math.max(1, packedPages.length);
      const startCsNumber = runningCs;
      const endCsNumber = startCsNumber + csUsed - 1;

      const orderedItems: PreGeneratedCountsheetItem[] = [];
      packedPages.forEach((page, pageIdx) => {
        const csCode = formatCsCode(startCsNumber + pageIdx);
        page.items.forEach((item) => {
          const entry: PreGeneratedCountsheetItem = {
            id: item.id,
            rowIndex: item.rowIndex,
            itemCode: item.itemCode,
            barcode: item.barcode,
            itemDescription: item.itemDescription,
            category: item.category,
            subCategory: item.subCategory,
            subsubCategory: item.subsubCategory,
            unit: item.unit || 'PCS',
            cost: item.cost ?? 0,
            selling: item.selling ?? 0,
            balance: item.balance ?? 0,
            actual: null,
            csCode,
            sheetTitle: g.baseSheetName || csCode,
            raw: item.raw,
          };
          orderedItems.push(entry);
          allOrderedCountsheetItems.push(entry);
        });
      });

      runningCs += csUsed;

      return {
        id: g.id,
        name: formatCsCode(startCsNumber),
        baseSheetName: g.baseSheetName,
        selectedCat: g.selectedCat,
        selectedSubCat: g.selectedSubCat,
        selectedSubSubCat: g.selectedSubSubCat,
        selectedCats: getGroupSelectedCats(g),
        selectedSubCats: getGroupSelectedSubCats(g),
        selectedSubSubCats: getGroupSelectedSubSubCats(g),
        lastSelectedHierarchy: g.lastSelectedHierarchy,
        hierarchySearchQuery: g.hierarchySearchQuery,
        selectedItemIds: Array.from(g.selectedItemIds),
        selectedRowIndices: groupItems.map((i) => i.rowIndex),
        selectedItemCodes: groupItems.map((i) => i.itemCode).filter(Boolean),
        selectedBarcodes: groupItems.map((i) => i.barcode).filter(Boolean),
        randomCountInput: g.randomCountInput,
        startCsNumber,
        endCsNumber,
        csUsed,
        orderedItems,
      };
    });

    const sessionId = activeSessionId || `cs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const preservedSpreadsheetId =
      overrideSpreadsheetId ||
      savedResult?.spreadsheetId ||
      activeSessionSpreadsheetId ||
      sessionId;
    const preservedWebViewLink =
      overrideWebViewLink ||
      savedResult?.webViewLink ||
      activeSessionWebViewLink ||
      '';
    const titleToUse =
      overrideSpreadsheetName ||
      targetSpreadsheetTitle ||
      `Audit Countsheets - ${selectedFile?.name || 'IATD'}`;

    return {
      id: sessionId,
      spreadsheetId: preservedSpreadsheetId,
      spreadsheetName: titleToUse,
      webViewLink: preservedWebViewLink,
      totalSheets: overrideSheetsCreated ? overrideSheetsCreated.length : overallPlan.length,
      totalItems: allOrderedCountsheetItems.length,
      sourceFile: {
        id: selectedFile?.id || '',
        name: selectedFile?.name || 'IATD',
        tabName: selectedTab,
      },
      templateUrl: templateUrl || DEFAULT_COUNTSHEET_TEMPLATE_URL,
      onlyItemsWithBalance,
      insertCategorySpacers,
      sheetsCreated:
        overrideSheetsCreated ||
        overallPlan.map((p, idx) => ({
          sheetId: idx,
          title: p.sheetTitle,
          itemCount: p.itemCount,
          groupName: p.groupName,
          partNumber: p.partNumber,
          totalParts: p.totalParts,
        })),
      savedGroups,
      iatdHeaders: rawHeaders,
      headerRow,
      orderedCountsheetItems: allOrderedCountsheetItems,
    };
  };

  // Save pre-generated countsheet session directly for retrieval & reuse in Create Countsheet & Create Encoding
  // If linked to an existing Google Spreadsheet on Drive, also updates that Google Sheet (and its B9:H42 borders) in-place!
  const handleSaveCountsheetSessionOnly = async () => {
    if (totalSelectedCount === 0) {
      setSaveError('Please select at least 1 item across your groups to save.');
      return;
    }
    setSaveError(null);
    try {
      const linkedSheetId = savedResult?.spreadsheetId || activeSessionSpreadsheetId;
      let updatedSheetResult: CreateCountsheetFromTemplateResult | null = null;

      if (
        linkedSheetId &&
        !linkedSheetId.startsWith('cs_') &&
        !linkedSheetId.startsWith('draft_')
      ) {
        setIsSaving(true);
        setSaveProgress('Updating Google Sheet items & borders (Col B to H)...');
        try {
          const tokenToUse =
            (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
            effectiveToken ||
            '';
          if (tokenToUse) {
            const groupPlans: GroupCountsheetPlan[] = groups
              .map((g) => ({
                groupId: g.id,
                groupName: g.name,
                baseSheetName: g.baseSheetName || g.lastSelectedHierarchy || g.name,
                items: getOrderedGroupItems(g, onlyItemsWithBalance),
              }))
              .filter((g) => g.items.length > 0);

            updatedSheetResult = await updateExistingCountsheetSpreadsheet({
              accessToken: tokenToUse,
              existingSpreadsheetId: linkedSheetId,
              targetSpreadsheetTitle:
                targetSpreadsheetTitle || `Audit Countsheets - ${selectedFile?.name || 'IATD'}`,
              insertCategorySpacers,
              groups: groupPlans,
              onProgress: (status) => setSaveProgress(status),
            });
            if (updatedSheetResult) {
              setSavedResult(updatedSheetResult);
              setActiveSessionSpreadsheetId(updatedSheetResult.spreadsheetId);
              setActiveSessionWebViewLink(updatedSheetResult.webViewLink);
            }
          }
        } catch (syncErr) {
          console.warn('Could not sync in-place Google Sheet update:', syncErr);
        } finally {
          setIsSaving(false);
        }
      }

      const payload = buildSessionSavePayload(
        updatedSheetResult?.spreadsheetId,
        updatedSheetResult?.spreadsheetName,
        updatedSheetResult?.webViewLink,
        updatedSheetResult?.sheetsCreated
      );
      const saved = await saveRecentCountsheet(payload);
      setActiveSessionId(saved.id);
      setRecentCountsheets(getRecentCountsheets());
      setSavedToastMessage(
        updatedSheetResult
          ? `Saved & updated Google Sheet "${saved.spreadsheetName}" (${saved.totalItems} items across ${saved.totalSheets} CS)`
          : `Saved "${saved.spreadsheetName}" (${saved.totalItems} items across ${saved.totalSheets} CS)`
      );
      setTimeout(() => setSavedToastMessage(null), 3500);
    } catch (err: any) {
      setSaveError(err.message || 'Could not save countsheet session.');
    }
  };

  // EXECUTE COUNTSHEET GENERATION
  const handleGenerateCountsheets = async () => {
    if (totalSelectedCount === 0) {
      setSaveError('Please select at least 1 item across your groups.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveProgress('Initializing template clone in Google Drive...');

    try {
      const tokenToUse = (await resolveValidOAuthToken(effectiveToken, { allowPopup: true })) || effectiveToken || '';
      if (!tokenToUse) {
        setSaveError('Unable to generate countsheets. Please check your Google Drive connection.');
        setIsSaving(false);
        return;
      }
      // Build group plans preserving exact selection sequence
      const groupPlans: GroupCountsheetPlan[] = groups
        .map((g) => {
          const finalItems = getOrderedGroupItems(g, onlyItemsWithBalance);
          return {
            groupId: g.id,
            groupName: g.name,
            baseSheetName: g.baseSheetName || g.lastSelectedHierarchy || g.name,
            items: finalItems,
          };
        })
        .filter((g) => g.items.length > 0);

      const result = await createCountsheetFromTemplate({
        accessToken: tokenToUse,
        templateSpreadsheetId: templateUrl || DEFAULT_COUNTSHEET_TEMPLATE_URL,
        targetSpreadsheetTitle: targetSpreadsheetTitle || `Audit Countsheets - ${selectedFile?.name || 'IATD'}`,
        insertCategorySpacers,
        groups: groupPlans,
        onProgress: (status) => setSaveProgress(status),
      });

      setSavedResult(result);
      setActiveSessionSpreadsheetId(result.spreadsheetId);
      setActiveSessionWebViewLink(result.webViewLink);
      // Persist in Recent Countsheets for easy viewing, reusing, and Create Encoding integration
      try {
        const payload = buildSessionSavePayload(
          result.spreadsheetId,
          result.spreadsheetName,
          result.webViewLink,
          result.sheetsCreated
        );
        const saved = await saveRecentCountsheet(payload);
        setActiveSessionId(saved.id);
        setRecentCountsheets(getRecentCountsheets());
      } catch (recErr) {
        console.warn('Could not save countsheet session to recents:', recErr);
      }
      setCurrentStep('SUCCESS');
    } catch (err: any) {
      console.error('Error creating countsheet from template:', err);
      setSaveError(err.message || 'Failed to generate countsheets. Check template access permissions.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 md:p-6 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200"
      style={{ overscrollBehavior: 'contain' }}
    >
      <div className="relative w-[92vw] h-[88dvh] sm:h-auto sm:w-full max-w-[90vw] xl:max-w-[1440px] 2xl:max-w-[1540px] bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col sm:max-h-[86dvh] overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200/90 dark:border-zinc-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                  Create Countsheets
                </h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/25">
                  TEMPLATE / COUNTSHEET ({HUB_OWNER_EMAIL})
                </span>
              </div>
              <p className="text-[10.5px] text-slate-500 dark:text-zinc-400 truncate flex items-center gap-1 mt-0.5">
                <FolderOpen className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Auto-saves to your Google Drive folder: <strong className="text-slate-700 dark:text-zinc-200">{GENERATED_COUNTSHEET_FOLDER_NAME}</strong></span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isGoogleConnected && (
              <button
                type="button"
                onClick={() => {
                  setCurrentStep('SELECT_FILE');
                  setSourceViewMode((prev) => (prev === 'EMAIL' && currentStep === 'SELECT_FILE' ? 'DRIVE' : 'EMAIL'));
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                  currentStep === 'SELECT_FILE' && sourceViewMode === 'EMAIL'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:border-blue-300 dark:hover:border-blue-700'
                }`}
                title="View emailed spreadsheets from branches and convert them into Google Sheets compatible format"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Email</span>
                {emailMessages.length > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      currentStep === 'SELECT_FILE' && sourceViewMode === 'EMAIL'
                        ? 'bg-white/20 text-white'
                        : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                    }`}
                  >
                    {emailMessages.length}
                  </span>
                )}
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
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
                  Create Countsheet requires a linked Google account to access your IATD spreadsheets from Google Drive or Gmail and generate Countsheet templates.
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
          {/* STEP 1: SELECT IATD SPREADSHEET FROM GOOGLE DRIVE OR EMAIL */}
          {currentStep === 'SELECT_FILE' && (
            <div className="space-y-4 w-full max-w-5xl mx-auto">
              {/* Conversion Success Toast Banner */}
              {emailConversionToast && (
                <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-200 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-semibold truncate">{emailConversionToast.message}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {emailConversionToast.webViewLink && (
                      <a
                        href={emailConversionToast.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open in Google Sheets</span>
                      </a>
                    )}
                    {emailConversionToast.spreadsheetId && (
                      <button
                        type="button"
                        onClick={() =>
                          handleSelectIatdSpreadsheet({
                            id: emailConversionToast.spreadsheetId!,
                            name: emailConversionToast.spreadsheetName || 'Converted Spreadsheet',
                            mimeType: 'application/vnd.google-apps.spreadsheet',
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <span>Use in Countsheet</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEmailConversionToast(null)}
                      className="p-1 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200/50 dark:hover:bg-emerald-900/40"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* RECENT COUNTSHEETS SECTION WITH HORIZONTAL IMPORT BUTTON */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                      Recent
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                        {recentCountsheets.length}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setShowImportPlottedModal(true);
                        setImportPlottedError(null);
                        setImportPlottedSuccess(null);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition shadow-xs shrink-0 cursor-pointer active:scale-95"
                      title="Import any previously generated Countsheet Google Sheet to restore and edit it"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Import Plotted Sheet</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSyncCloudRecents}
                      disabled={isSyncingRecents}
                      className="text-[10.5px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 px-2 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                      title="Sync recent countsheets from your cloud account"
                    >
                      <RefreshCw className={`w-3 h-3 ${isSyncingRecents ? 'animate-spin' : ''}`} />
                      <span>{isSyncingRecents ? 'Syncing...' : 'Sync'}</span>
                    </button>
                    {recentCountsheets.length > 1 && (
                      confirmClearRecents ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={handleClearAllRecents}
                            className="text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-500 px-2 py-1 rounded-lg transition cursor-pointer"
                          >
                            Confirm Clear
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmClearRecents(false)}
                            className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 px-1.5 py-1 rounded-lg transition cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmClearRecents(true)}
                          className="text-[10px] font-semibold text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 px-2 py-1 rounded-lg hover:bg-rose-500/10 transition cursor-pointer"
                        >
                          Clear all
                        </button>
                      )
                    )}
                  </div>
                </div>

                {recentCountsheets.length > 3 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search recent..."
                      value={recentCountsheetsFilter}
                      onChange={(e) => setRecentCountsheetsFilter(e.target.value)}
                      className="w-full text-xs pl-8 pr-3 py-1.5 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}

                {recentCountsheets.length > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                    {recentCountsheets
                      .filter((r) =>
                        recentCountsheetsFilter
                          ? r.spreadsheetName.toLowerCase().includes(recentCountsheetsFilter.toLowerCase()) ||
                            (r.sourceFile?.name && r.sourceFile.name.toLowerCase().includes(recentCountsheetsFilter.toLowerCase()))
                          : true
                      )
                      .map((recent, rIdx) => {
                        const dateFormatted = new Date(recent.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        });
                        return (
                          <div
                            key={`${recent.id || 'rc'}_${recent.spreadsheetId || ''}_${rIdx}`}
                            className="p-3 bg-white dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-700 transition flex items-center justify-between gap-3 group shadow-2xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-slate-800 dark:text-white truncate flex items-center gap-1.5">
                                <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span className="truncate">{recent.spreadsheetName}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                                <span>
                                  {recent.totalSheets} Sheet{recent.totalSheets > 1 ? 's' : ''} • {recent.totalItems} Items
                                </span>
                                <span>•</span>
                                <span className="text-slate-400">{dateFormatted}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {recent.webViewLink && (
                                <a
                                  href={recent.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold flex items-center gap-1 transition-colors"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Open</span>
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRestoreRecentSession(recent, false)}
                                disabled={isLoadingRecentSession || isLoadingIatd}
                                className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1 transition-colors shadow-xs cursor-pointer"
                                title="Load and edit this saved countsheet"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteRecentSession(recent.id, e)}
                                className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors cursor-pointer"
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

              {/* SOURCE SWITCHER: GOOGLE DRIVE SPREADSHEETS VS EMAIL (BRANCH SPREADSHEETS) */}
              <div className="flex items-center gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setSourceViewMode('DRIVE')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    sourceViewMode === 'DRIVE'
                      ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs border border-slate-200/80 dark:border-zinc-700'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4 shrink-0" />
                  <span>Google Drive Spreadsheets</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/70 dark:bg-zinc-700 text-slate-700 dark:text-zinc-300">
                    {driveFiles.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceViewMode('EMAIL')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    sourceViewMode === 'EMAIL'
                      ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs border border-slate-200/80 dark:border-zinc-700'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>Email (Branch Spreadsheets)</span>
                  {emailMessages.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                      {emailMessages.length}
                    </span>
                  )}
                </button>
              </div>

              {sourceViewMode === 'DRIVE' ? (
                <>
                  {/* Search Drive Spreadsheets */}
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                    <input
                      type="text"
                      value={driveQuery}
                      onChange={(e) => setDriveQuery(e.target.value)}
                      placeholder="Search spreadsheet..."
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Drive files list */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                        Spreadsheets ({driveFiles.length})
                      </div>
                      <button
                        type="button"
                        onClick={handleRefreshDrive}
                        disabled={isSearchingDrive}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSearchingDrive ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>
                    <div className="border border-slate-200 dark:border-zinc-800 rounded-2xl divide-y divide-slate-100 dark:divide-zinc-800/60 max-h-60 overflow-y-auto bg-slate-50/50 dark:bg-zinc-900/30">
                      {driveFiles.length > 0 ? (
                        driveFiles.map((file) => {
                          const isExcelFile =
                            (file.mimeType && file.mimeType !== 'application/vnd.google-apps.spreadsheet') ||
                            /\.(xlsx|xls|csv|ods|xlsm|xlsb)$/i.test(file.name || '');
                          const isConvertingThis = convertingAttachmentKey === `drive:${file.id}`;

                          return (
                            <div
                              key={file.id}
                              onClick={() => !isLoadingIatd && !isConvertingThis && handleSelectIatdSpreadsheet(file)}
                              className="w-full p-3 text-left flex items-center justify-between gap-3 hover:bg-blue-50/60 dark:hover:bg-blue-950/20 transition-colors group cursor-pointer"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                  <FileSpreadsheet className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-800 dark:text-zinc-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 flex items-center gap-2">
                                    <span className="truncate">{file.name}</span>
                                    {isExcelFile && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold uppercase shrink-0">
                                        Excel / CSV
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {isExcelFile && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleConvertDriveExcelFile(file, false, e)}
                                    disabled={isConvertingThis || isLoadingIatd}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                                    title="Convert this Excel/CSV file into a Google Sheets compatible file"
                                  >
                                    <RefreshCw className={`w-3 h-3 ${isConvertingThis ? 'animate-spin' : ''}`} />
                                    <span>{isConvertingThis ? 'Converting...' : 'Convert to Google Sheets'}</span>
                                  </button>
                                )}
                                <ArrowRight className="w-4 h-4 text-slate-300 dark:text-zinc-600 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
                              </div>
                            </div>
                          );
                        })
                      ) : isSearchingDrive ? (
                        <div className="p-8 text-center text-xs text-slate-400 dark:text-zinc-500 flex flex-col items-center justify-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                          <span>Searching...</span>
                        </div>
                      ) : driveSearchError ? (
                        <div className="p-6 text-center text-xs text-rose-600 dark:text-rose-400 space-y-2.5">
                          <p className="font-semibold">{driveSearchError}</p>
                          <div className="flex items-center justify-center gap-2">
                            {(driveSearchError.toLowerCase().includes('expired') ||
                              driveSearchError.toLowerCase().includes('oauth') ||
                              driveSearchError.toLowerCase().includes('401') ||
                              !isGoogleConnected) ? (
                              <button
                                type="button"
                                onClick={handleRefreshGoogleAccess}
                                disabled={isRefreshingToken}
                                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingToken ? 'animate-spin' : ''}`} />
                                <span>{isRefreshingToken ? 'Refreshing...' : 'Reconnect'}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={handleRefreshDrive}
                                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Retry</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="p-6 text-center text-xs text-slate-400 dark:text-zinc-500">
                          <p>No spreadsheets found.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                /* EMAIL (BRANCH SPREADSHEETS) INBOX & GOOGLE SHEETS CONVERTER */
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                    <input
                      type="text"
                      value={emailQuery}
                      onChange={(e) => setEmailQuery(e.target.value)}
                      placeholder="Search branch email, sender, subject, or spreadsheet filename..."
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                      <Inbox className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Emailed Spreadsheets from Branches ({emailMessages.length})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRefreshEmails()}
                      disabled={isSearchingEmail}
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSearchingEmail ? 'animate-spin' : ''}`} />
                      <span>{isSearchingEmail ? 'Checking Inbox...' : 'Refresh Email'}</span>
                    </button>
                  </div>

                  <div className="border border-slate-200 dark:border-zinc-800 rounded-2xl divide-y divide-slate-100 dark:divide-zinc-800/60 max-h-80 overflow-y-auto bg-slate-50/50 dark:bg-zinc-900/30">
                    {emailMessages.length > 0 ? (
                      emailMessages.map((msg) => {
                        const dateStr = new Date(msg.timestamp).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        });
                        return (
                          <div
                            key={msg.messageId}
                            className="p-3.5 space-y-2.5 hover:bg-white dark:hover:bg-zinc-900/70 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                  <Mail className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                  <span className="truncate">{msg.subject}</span>
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                                  <span className="font-semibold text-slate-700 dark:text-zinc-300">
                                    {msg.fromName}
                                  </span>
                                  {msg.fromEmail && msg.fromEmail !== msg.fromName && (
                                    <span className="text-slate-400"> &lt;{msg.fromEmail}&gt;</span>
                                  )}
                                </div>
                              </div>
                              <span className="text-[10.5px] text-slate-400 dark:text-zinc-500 shrink-0">
                                {dateStr}
                              </span>
                            </div>

                            {/* Spreadsheet Attachments */}
                            {msg.attachments.length > 0 && (
                              <div className="space-y-1.5">
                                {msg.attachments.map((att) => {
                                  const attKey = `${msg.messageId}:${att.filename}`;
                                  const converted = convertedSheetsMap[attKey];
                                  const isConverting = convertingAttachmentKey === attKey;
                                  const ext =
                                    att.filename.split('.').pop()?.toUpperCase() || 'XLSX';
                                  const sizeKb = Math.max(1, Math.round((att.size || 0) / 1024));

                                  return (
                                    <div
                                      key={attKey}
                                      className="p-2.5 rounded-xl bg-white dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-2.5"
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                          <Paperclip className="w-4 h-4" />
                                        </div>
                                        <div className="min-w-0">
                                          <div className="text-xs font-bold text-slate-800 dark:text-zinc-100 truncate flex items-center gap-1.5">
                                            <span className="truncate">{att.filename}</span>
                                            <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300 font-bold uppercase shrink-0">
                                              {ext}
                                            </span>
                                            {converted && (
                                              <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1 shrink-0">
                                                <FileCheck2 className="w-2.5 h-2.5" />
                                                Google Sheets Compatible
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-[10.5px] text-slate-400">
                                            {sizeKb} KB
                                            {converted
                                              ? ` • Converted to "${converted.spreadsheetName}"`
                                              : ' • Branch Spreadsheet Attachment'}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {converted ? (
                                          <>
                                            <a
                                              href={converted.webViewLink}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold flex items-center gap-1 transition-colors"
                                            >
                                              <ExternalLink className="w-3 h-3" />
                                              <span>Open in Sheets</span>
                                            </a>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleSelectIatdSpreadsheet({
                                                  id: converted.spreadsheetId,
                                                  name: converted.spreadsheetName,
                                                  mimeType: 'application/vnd.google-apps.spreadsheet',
                                                })
                                              }
                                              disabled={isLoadingIatd}
                                              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                              <span>Use Spreadsheet</span>
                                              <ArrowRight className="w-3 h-3" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleConvertEmailAttachment(msg, att, false)
                                              }
                                              disabled={isConverting || isLoadingIatd}
                                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
                                              title="Convert a fresh Google Sheets copy from this email attachment"
                                            >
                                              <RefreshCw
                                                className={`w-3.5 h-3.5 ${
                                                  isConverting ? 'animate-spin text-blue-600' : ''
                                                }`}
                                              />
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleConvertEmailAttachment(msg, att, false)
                                              }
                                              disabled={isConverting || isLoadingIatd}
                                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                                              title="Convert this branch spreadsheet into a Google Sheets compatible file in Google Drive"
                                            >
                                              <RefreshCw
                                                className={`w-3 h-3 ${
                                                  isConverting ? 'animate-spin' : ''
                                                }`}
                                              />
                                              <span>
                                                {isConverting
                                                  ? 'Converting...'
                                                  : 'Convert to Google Sheets'}
                                              </span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleConvertEmailAttachment(msg, att, true)
                                              }
                                              disabled={isConverting || isLoadingIatd}
                                              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                                              title="Convert to Google Sheets compatible format and immediately load into Create Countsheets"
                                            >
                                              <span>Convert & Load</span>
                                              <ArrowRight className="w-3 h-3" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Direct Shared Google Sheet Links in Email Body */}
                            {msg.sharedSheetLinks.length > 0 && (
                              <div className="space-y-1.5">
                                {msg.sharedSheetLinks.map((link) => (
                                  <div
                                    key={`${msg.messageId}_${link.spreadsheetId}`}
                                    className="p-2.5 rounded-xl bg-white dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 flex items-center justify-between gap-2.5"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 truncate">
                                        {msg.subject || link.label}
                                      </span>
                                      <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 font-bold">
                                        Google Sheet Link
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <a
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold flex items-center gap-1"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        <span>Open</span>
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleSelectIatdSpreadsheet({
                                            id: link.spreadsheetId,
                                            name: msg.subject || 'Emailed Google Sheet',
                                            mimeType: 'application/vnd.google-apps.spreadsheet',
                                          })
                                        }
                                        disabled={isLoadingIatd}
                                        className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                      >
                                        <span>Use Sheet</span>
                                        <ArrowRight className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : isSearchingEmail ? (
                      <div className="p-8 text-center text-xs text-slate-400 dark:text-zinc-500 flex flex-col items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                        <span>Searching Gmail for branch spreadsheets...</span>
                      </div>
                    ) : emailSearchError ? (
                      <div className="p-6 text-center text-xs text-rose-600 dark:text-rose-400 space-y-3">
                        <p className="font-semibold">{emailSearchError}</p>
                        <div className="flex items-center justify-center gap-2">
                          {emailNeedsScopeConsent || !isGoogleConnected ? (
                            <button
                              type="button"
                              onClick={handleAuthorizeGmailScope}
                              disabled={isRefreshingToken}
                              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              <span>
                                {isRefreshingToken ? 'Authorizing...' : 'Authorize Gmail Access'}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRefreshEmails()}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-8 text-center text-xs text-slate-400 dark:text-zinc-500 space-y-1.5">
                        <Mail className="w-6 h-6 mx-auto text-slate-300 dark:text-zinc-600" />
                        <p className="font-semibold text-slate-600 dark:text-zinc-400">
                          No emailed spreadsheets found in your inbox.
                        </p>
                        <p className="text-[11px]">
                          Emails with .xlsx, .xls, .csv attachments or Google Sheets links from branches will appear here.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Paste URL or ID alternative */}
              <div className="pt-2 border-t border-slate-100 dark:border-zinc-800/60 flex gap-2">
                <input
                  type="text"
                  value={customFileUrl}
                  onChange={(e) => setCustomFileUrl(e.target.value)}
                  placeholder="Paste spreadsheet link or ID..."
                  className="flex-1 px-4 py-2 text-sm rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    if (!customFileUrl.trim()) return;
                    const cleanId = extractSpreadsheetId(customFileUrl.trim());
                    handleSelectIatdSpreadsheet({
                      id: cleanId,
                      name: 'Spreadsheet',
                    });
                  }}
                  disabled={!customFileUrl.trim() || isLoadingIatd}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
                >
                  Load
                </button>
              </div>

              {iatdError && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{iatdError}</span>
                  </div>
                  {lastAttemptedSession && (
                    <button
                      type="button"
                      onClick={() => handleRestoreRecentSession(lastAttemptedSession)}
                      disabled={isLoadingRecentSession || isLoadingIatd}
                      className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs shrink-0 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRecentSession || isLoadingIatd ? 'animate-spin' : ''}`} />
                      <span>Retry</span>
                    </button>
                  )}
                </div>
              )}

              {isLoadingIatd && (
                <div className="p-6 rounded-2xl bg-slate-50 dark:bg-zinc-900 text-center space-y-2 border border-slate-200 dark:border-zinc-800">
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                    Loading...
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: GROUP & ITEM SELECTION */}
          {currentStep === 'FILTER_ITEMS' && (
            <div className="space-y-4">
              {/* Top File Bar & RANDOM INVENTORY COUNTSHEET TEMPLATE Sync Bar */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-2.5 text-xs">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  {/* Left: Source of Items (IATD from User Drive/Email) */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                          User IATD Source (Your Drive / Email)
                        </span>
                        <span className="font-bold text-slate-800 dark:text-white truncate">
                          {selectedFile?.name || 'Spreadsheet'}
                        </span>
                      </div>
                      <span className="text-slate-400 truncate block text-[11px]">
                        {allItems.length} items loaded from your IATD
                      </span>
                    </div>
                  </div>

                  {/* Right: Admin Countsheet Template Selector (icdhubsystems@gmail.com) & File Actions */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/60">
                      <span className="hidden xl:inline text-[10px] font-bold text-blue-700 dark:text-blue-300 px-1.5">
                        Admin Template ({HUB_OWNER_EMAIL}):
                      </span>
                      {hubCountsheetTemplates.map((tmpl) => {
                        const isPeriodic = /periodic/i.test(tmpl.name);
                        const isCurrentlySelected = isPeriodic
                          ? /periodic/i.test(templateUrl) || /periodic/i.test(templateSpec.spreadsheetTitle || '')
                          : !/periodic/i.test(templateUrl) && !/periodic/i.test(templateSpec.spreadsheetTitle || '');
                        return (
                          <button
                            key={tmpl.id}
                            type="button"
                            onClick={() => {
                              const nextUrl =
                                tmpl.webViewLink ||
                                `https://docs.google.com/spreadsheets/d/${tmpl.id}/edit#gid=${tmpl.gid || '1328306184'}`;
                              handleRefreshTemplate(false, nextUrl);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer flex items-center gap-1 ${
                              isCurrentlySelected
                                ? 'bg-blue-600 text-white shadow-2xs'
                                : 'text-blue-800 dark:text-blue-200 hover:bg-blue-100/80 dark:hover:bg-blue-900/40'
                            }`}
                            title={`${tmpl.name} (${HUB_OWNER_EMAIL})`}
                          >
                            <Table className="w-3 h-3 shrink-0" />
                            <span>{isPeriodic ? 'Periodic Countsheet' : 'Random Inventory Countsheet'}</span>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRefreshTemplate(true)}
                      disabled={isRefreshingTemplate}
                      className="px-3 py-1.5 rounded-xl border border-blue-300 dark:border-blue-700 bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
                      title="Refresh active Countsheet Template from icdhubsystems@gmail.com"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingTemplate ? 'animate-spin' : ''}`} />
                      <span>{isRefreshingTemplate ? 'Refreshing...' : 'Refresh Template'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowImportPlottedModal(true);
                        setImportPlottedError(null);
                        setImportPlottedSuccess(null);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="Import a generated Countsheet template and rebuild items per sheet by Item Code"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Import Countsheet</span>
                    </button>
                    <button
                      onClick={() => setCurrentStep('SELECT_FILE')}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-semibold transition-colors shrink-0"
                    >
                      Change IATD
                    </button>
                  </div>
                </div>
              </div>

              {/* GROUPS TAB BAR */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {groups.map((grp, gIdx) => {
                      const isActive = grp.id === activeGroup.id;
                      const itemsCount = grp.selectedItemIds.size;
                      const meta = groupCsMeta.byGroupId.get(grp.id);
                      const displayCsName = meta?.csName || grp.name;

                      return (
                        <div
                          key={`grp_tab_${grp.id}_${gIdx}`}
                          onClick={() => setActiveGroupId(grp.id)}
                          className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl cursor-pointer text-xs font-semibold transition-all border shrink-0 ${
                            isActive
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/80'
                          }`}
                        >
                          <span>{displayCsName}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                              isActive
                                ? 'bg-white/20 text-white'
                                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400'
                            }`}
                          >
                            {itemsCount}
                          </span>

                          {groups.length > 1 && (
                            <button
                              onClick={(e) => handleRemoveGroup(grp.id, e)}
                              className={`p-0.5 rounded-md transition-colors ${
                                isActive
                                  ? 'hover:bg-white/20 text-white/80 hover:text-white'
                                  : 'hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-400'
                              }`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setPreviewActiveGroupId('ALL');
                        setShowGroupsPreview(true);
                        handleRefreshTemplate(false);
                      }}
                      title="Preview Countsheets as in Google Sheets (Ctrl + P)"
                      className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Preview</span>
                    </button>

                    <button
                      onClick={handleAddGroup}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{groupCsMeta.nextAvailableCsName}</span>
                    </button>
                  </div>
                </div>

                {/* Sheet Name & Selected Count Bar */}
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-slate-500 dark:text-zinc-400 font-medium">Sheet Name:</span>
                    {editingBaseSheetName ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={activeGroup.baseSheetName}
                          onChange={(e) => updateActiveGroup({ baseSheetName: e.target.value })}
                          className="px-2 py-0.5 text-xs font-bold rounded-lg border border-blue-300 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white"
                        />
                        <button
                          onClick={() => setEditingBaseSheetName(false)}
                          className="p-1 text-emerald-600 font-bold"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-blue-700 dark:text-blue-300">
                          {activeGroup.baseSheetName || activeGroup.name}
                        </span>
                        <button
                          onClick={() => setEditingBaseSheetName(true)}
                          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5 font-mono">
                    <span>{activeGroup.selectedItemIds.size} selected</span>
                    {(() => {
                      const activeMeta = groupCsMeta.byGroupId.get(activeGroup.id);
                      if (
                        activeMeta &&
                        activeMeta.validItemCount > 0 &&
                        activeMeta.physicalRowCount !== activeMeta.validItemCount
                      ) {
                        return (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            {activeMeta.physicalRowCount} rows
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              </div>

              {/* CATEGORY / SUBCAT / SUBSUBCAT FILTER BAR */}
              <div className="p-3 rounded-2xl bg-slate-100 dark:bg-zinc-800/70 border border-slate-200 dark:border-zinc-700/80 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateActiveGroup({ activeHeaderButton: 'cat' })}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                        activeGroup.activeHeaderButton === 'cat'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                      }`}
                    >
                      <span>Category</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                        activeGroup.activeHeaderButton === 'cat' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300'
                      }`}>
                        {uniqueCategories.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateActiveGroup({ activeHeaderButton: 'subCat' })}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                        activeGroup.activeHeaderButton === 'subCat'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                      }`}
                    >
                      <span>SubCategory</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                        activeGroup.activeHeaderButton === 'subCat' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300'
                      }`}>
                        {uniqueSubCategories.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateActiveGroup({ activeHeaderButton: 'subSubCat' })}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                        activeGroup.activeHeaderButton === 'subSubCat'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                      }`}
                    >
                      <span>SubSubCategory</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                        activeGroup.activeHeaderButton === 'subSubCat' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300'
                      }`}>
                        {uniqueSubSubCategories.length}
                      </span>
                    </button>

                    {activeSelectedCats.map((cat) => (
                      <span
                        key={`sel_cat_${cat}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 border border-blue-200 dark:border-blue-800/70 font-semibold text-blue-700 dark:text-blue-300"
                      >
                        <span>{cat}</span>
                        <button
                          type="button"
                          onClick={() => handleSelectCategory(cat)}
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 ml-0.5 cursor-pointer"
                          title={`Remove category ${cat}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}

                    {activeSelectedSubCats.map((subCat) => (
                      <span
                        key={`sel_subcat_${subCat}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 border border-indigo-200 dark:border-indigo-800/70 font-semibold text-indigo-700 dark:text-indigo-300"
                      >
                        <span>{subCat}</span>
                        <button
                          type="button"
                          onClick={() => handleSelectSubCategory(subCat)}
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 ml-0.5 cursor-pointer"
                          title={`Remove subcategory ${subCat}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}

                    {activeSelectedSubSubCats.map((subSubCat) => (
                      <span
                        key={`sel_subsubcat_${subSubCat}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 border border-purple-200 dark:border-purple-800/70 font-semibold text-purple-700 dark:text-purple-300"
                      >
                        <span>{subSubCat}</span>
                        <button
                          type="button"
                          onClick={() => handleSelectSubSubCategory(subSubCat)}
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 ml-0.5 cursor-pointer"
                          title={`Remove sub-subcategory ${subSubCat}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>

                  {(activeSelectedCats.length > 0 ||
                    activeSelectedSubCats.length > 0 ||
                    activeSelectedSubSubCats.length > 0 ||
                    activeGroup.hierarchySearchQuery) && (
                    <button
                      onClick={() =>
                        updateActiveGroup({
                          selectedCat: '',
                          selectedSubCat: '',
                          selectedSubSubCat: '',
                          selectedCats: [],
                          selectedSubCats: [],
                          selectedSubSubCats: [],
                          hierarchySearchQuery: '',
                          lastSelectedHierarchy: '',
                          baseSheetName: activeGroup.name,
                        })
                      }
                      className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline shrink-0 ml-auto"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Search Category / SubCategory */}
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={activeGroup.hierarchySearchQuery || ''}
                    onChange={(e) => updateActiveGroup({ hierarchySearchQuery: e.target.value })}
                    placeholder="Search category..."
                    className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                  />
                  {activeGroup.hierarchySearchQuery && (
                    <button
                      onClick={() => updateActiveGroup({ hierarchySearchQuery: '' })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 text-xs px-1"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* CATEGORY / SUBCAT / SUBSUBCAT OPTIONS */}
              {activeGroup.activeHeaderButton === 'cat' && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
                    {uniqueCategories.map((c) => {
                      const isSel = activeSelectedCats.some(
                        (sel) => safeLower(sel) === safeLower(c.name)
                      );
                      return (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => handleSelectCategory(c.name)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border inline-flex items-center gap-1.5 cursor-pointer ${
                            isSel
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
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
                </div>
              )}

              {activeGroup.activeHeaderButton === 'subCat' && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                  {uniqueSubCategories.length > 0 ? (
                    <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
                      {uniqueSubCategories.map((sc) => {
                        const isSel = activeSelectedSubCats.some(
                          (sel) => safeLower(sel) === safeLower(sc.name)
                        );
                        return (
                          <button
                            key={sc.name}
                            type="button"
                            onClick={() => handleSelectSubCategory(sc.name)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border inline-flex items-center gap-1.5 cursor-pointer ${
                              isSel
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
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
                  )}
                </div>
              )}

              {activeGroup.activeHeaderButton === 'subSubCat' && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                  {uniqueSubSubCategories.length > 0 ? (
                    <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
                      {uniqueSubSubCategories.map((ssc) => {
                        const isSel = activeSelectedSubSubCats.some(
                          (sel) => safeLower(sel) === safeLower(ssc.name)
                        );
                        return (
                          <button
                            key={ssc.name}
                            type="button"
                            onClick={() => handleSelectSubSubCategory(ssc.name)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border inline-flex items-center gap-1.5 cursor-pointer ${
                              isSel
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:border-blue-400'
                            }`}
                          >
                            {isSel && <Check className="w-3 h-3 shrink-0" />}
                            <span>
                              {ssc.name}{' '}
                              <span className="opacity-70 text-[10px]">({ssc.count})</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-400">
                      No sub-subcategories found.
                    </div>
                  )}
                </div>
              )}

              {/* ITEM SEARCH & SIMPLE ACTION BUTTONS */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={activeGroup.itemSearchQuery}
                    onChange={(e) => updateActiveGroup({ itemSearchQuery: e.target.value })}
                    placeholder="Search items..."
                    className="w-full pl-10 pr-8 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {activeGroup.itemSearchQuery && (
                    <button
                      onClick={() => updateActiveGroup({ itemSearchQuery: '' })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={displayedItems.length || 1000}
                      value={activeGroup.randomCountInput}
                      onChange={(e) => updateActiveGroup({ randomCountInput: parseInt(e.target.value) || 1 })}
                      className="w-16 px-2 py-1.5 text-center rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white font-bold"
                    />
                    <button
                      onClick={() => handlePickRandomItems(activeGroup.randomCountInput)}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1 transition-colors"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      <span>Random</span>
                    </button>
                  </div>

                  <label
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
                      onlyItemsWithBalance
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-900 dark:text-amber-200'
                        : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={onlyItemsWithBalance}
                      onChange={(e) => setOnlyItemsWithBalance(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                    />
                    <span>With Balance</span>
                  </label>

                  <label
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
                      insertCategorySpacers
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-900 dark:text-amber-200'
                        : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300'
                    }`}
                    title="Insert a 1-row blank space in the countsheet template whenever Category, SubCategory, or SubSubCategory changes"
                  >
                    <input
                      type="checkbox"
                      checked={insertCategorySpacers}
                      onChange={(e) => setInsertCategorySpacers(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                    />
                    <span>Space Categories</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowSelectedItemsOnly((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                      showSelectedItemsOnly
                        ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                        : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:border-blue-400'
                    }`}
                    title="Filter table to show only selected items in their exact countsheet sequence with 1-row category spacers"
                  >
                    <span>Selected Only ({activeGroup.selectedItemIds.size})</span>
                  </button>

                  <button
                    onClick={handleSelectAllDisplayed}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 hover:border-emerald-500 text-emerald-600 font-bold text-xs cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    onClick={handleDeselectAllDisplayed}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 hover:border-rose-500 text-rose-500 font-bold text-xs cursor-pointer"
                  >
                    Clear
                  </button>

                  {/* Sort Dropdown (Item Code / Item Description) */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowSortDropdown((prev) => !prev)}
                      className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 hover:border-blue-500 text-slate-700 dark:text-zinc-200 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span>Sort</span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                          showSortDropdown ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {showSortDropdown && (
                      <>
                        <div
                          className="fixed inset-0 z-20"
                          onClick={() => setShowSortDropdown(false)}
                        />
                        <div className="absolute right-0 mt-1.5 w-44 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 shadow-xl py-1 z-30">
                          <button
                            type="button"
                            onClick={() => handleChangeItemSort('itemCode')}
                            className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                              itemSortBy === 'itemCode'
                                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                                : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span>Item Code</span>
                            {itemSortBy === 'itemCode' && (
                              <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleChangeItemSort('itemDescription')}
                            className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                              itemSortBy === 'itemDescription'
                                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                                : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span>Item Description</span>
                            {itemSortBy === 'itemDescription' && (
                              <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* LIVE TEMPLATE ROW & CATEGORY SPACER ALLOCATION RIBBON */}
              {activeGroup.selectedItemIds.size > 0 && (
                <div className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-zinc-300">
                    <span className="font-semibold text-slate-800 dark:text-zinc-100">
                      {activeGroupMeta?.csRangeLabel || activeGroup.name} Allocation:
                    </span>
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                      {activeGroupMeta?.validItemCount || activeGroup.selectedItemIds.size} items
                    </span>
                    <span>·</span>
                    <span className="font-mono">
                      {activeGroupMeta?.physicalRowCount || 0} template rows
                    </span>
                    {activeGroupRowAllocation.spacerCount > 0 && (
                      <>
                        <span>·</span>
                        <span className="px-2 py-0.5 rounded-md bg-amber-100/80 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300/70 dark:border-amber-800/70 font-semibold">
                          {activeGroupRowAllocation.spacerCount} blank spacer row{activeGroupRowAllocation.spacerCount === 1 ? '' : 's'} (Category / SubCat / SubSubCat breaks)
                        </span>
                      </>
                    )}
                  </div>
                  <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {activeGroupMeta?.sheetsNeeded || 1} × 34-row sheet{(activeGroupMeta?.sheetsNeeded || 1) === 1 ? '' : 's'}
                  </div>
                </div>
              )}

              {/* ITEMS TABLE FOR ACTIVE GROUP */}
              <div className="border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-xs">
                <div className="max-h-72 overflow-x-auto overflow-y-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-zinc-800/80 sticky top-0 z-10 border-b border-slate-200 dark:border-zinc-700">
                      <tr>
                        <th className="p-3 w-10 text-center">
                          <span className="sr-only">Select</span>
                        </th>
                        <th className="p-3 font-bold text-slate-700 dark:text-zinc-300">Code</th>
                        <th className="p-3 font-bold text-slate-700 dark:text-zinc-300">Description</th>
                        <th className="p-3 font-bold text-slate-700 dark:text-zinc-300 text-right">Cost</th>
                        <th className="p-3 font-bold text-slate-700 dark:text-zinc-300 text-right">Selling</th>
                        <th className="p-3 font-bold text-slate-700 dark:text-zinc-300 text-right">Balance</th>
                        <th className="p-3 font-bold text-slate-700 dark:text-zinc-300 text-center">Unit</th>
                        <th className="p-3 font-bold text-slate-700 dark:text-zinc-300">Category</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60 font-mono text-[11px]">
                      {displayedItems.length > 0 ? (
                        displayedItems.slice(0, 300).map((item, itmIdx) => {
                          const isSelected = activeGroup.selectedItemIds.has(item.id);
                          const rowAlloc = isSelected
                            ? activeGroupRowAllocation.itemAllocation.get(item.id)
                            : undefined;
                          return (
                            <React.Fragment key={`item_row_${item.id || 'itm'}_${itmIdx}`}>
                              {rowAlloc?.precededBySpacerRow !== null &&
                                rowAlloc?.precededBySpacerRow !== undefined && (
                                  <tr className="bg-amber-50/70 dark:bg-amber-950/25 border-y border-dashed border-amber-300 dark:border-amber-800/70 text-[10.5px] font-sans text-amber-800 dark:text-amber-300">
                                    <td colSpan={8} className="px-3 py-1">
                                      <div className="flex items-center justify-between">
                                        <span className="font-semibold">
                                          Template Row {rowAlloc.precededBySpacerRow}: Blank Space (Different Category / SubCat / SubSubCat)
                                        </span>
                                        <span className="font-mono text-[10px] opacity-80">
                                          {rowAlloc.csLabel} • Next item starts at Row {rowAlloc.startRow}
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              <tr
                                onClick={() => handleToggleSelectItem(item.id)}
                                className={`cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-blue-50/70 dark:bg-blue-950/20 text-slate-900 dark:text-white'
                                    : 'hover:bg-slate-50 dark:hover:bg-zinc-800/40 text-slate-700 dark:text-zinc-300'
                                }`}
                              >
                                <td className="p-3 text-center">
                                  <div className="flex flex-col items-center gap-0.5">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {}}
                                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    />
                                    {rowAlloc && (
                                      <span className="px-1 py-0.2 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-[9px] font-sans font-bold whitespace-nowrap">
                                        {rowAlloc.startRow === rowAlloc.endRow
                                          ? `R${rowAlloc.startRow}`
                                          : `R${rowAlloc.startRow}-${rowAlloc.endRow}`}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3 font-semibold text-slate-800 dark:text-zinc-200">
                                  {item.itemCode || item.barcode || '—'}
                                </td>
                                <td className="p-3 font-sans font-medium text-slate-900 dark:text-white max-w-md">
                                  {(() => {
                                    const lines = splitItemDescriptionLines(
                                      item.itemDescription,
                                      COUNTSHEET_DESC_MAX_CHARS
                                    );
                                    if (lines.length <= 1) {
                                      return <span className="block truncate">{item.itemDescription}</span>;
                                    }
                                    return (
                                      <div className="space-y-0.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="truncate">{lines[0]}</span>
                                          <span className="shrink-0 px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/70 dark:border-amber-800 text-[9.5px] font-bold">
                                            {lines.length} rows
                                          </span>
                                        </div>
                                        {lines.slice(1).map((ln, lIdx) => (
                                          <div
                                            key={lIdx}
                                            className="text-[10.5px] text-blue-700 dark:text-blue-300 font-normal truncate"
                                          >
                                            ↳ {ln}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td className="p-3 text-right">
                                  {item.cost ? item.cost.toFixed(2) : '—'}
                                </td>
                                <td className="p-3 text-right">
                                  {item.selling ? item.selling.toFixed(2) : '—'}
                                </td>
                                <td className="p-3 text-right font-bold text-blue-600 dark:text-blue-400">
                                  {item.balance}
                                </td>
                                <td className="p-3 text-center">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-[10px]">
                                    {item.unit || 'PCS'}
                                  </span>
                                </td>
                                <td className="p-3 font-sans text-slate-500 dark:text-zinc-400 truncate max-w-[160px]">
                                  {item.category || ''}
                                  {item.subCategory ? ` › ${item.subCategory}` : ''}
                                  {item.subsubCategory ? ` › ${item.subsubCategory}` : ''}
                                </td>
                              </tr>
                            </React.Fragment>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-400 font-sans">
                            No items found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-2.5 bg-slate-50 dark:bg-zinc-800/50 border-t border-slate-200 dark:border-zinc-700 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>{displayedItems.length} items</span>
                  <span>
                    {activeGroup.selectedItemIds.size} selected
                    {activeGroupMeta
                      ? ` • ${activeGroupMeta.physicalRowCount} template row${
                          activeGroupMeta.physicalRowCount === 1 ? '' : 's'
                        }${
                          activeGroupRowAllocation.spacerCount > 0
                            ? ` (incl. ${activeGroupRowAllocation.spacerCount} space row${
                                activeGroupRowAllocation.spacerCount === 1 ? '' : 's'
                              })`
                            : ''
                        }`
                      : ''}
                  </span>
                </div>
              </div>

              {saveError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}
              {isSaving && (
                <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs flex items-center gap-3">
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0 text-blue-600 dark:text-blue-400" />
                  <span className="font-bold">{saveProgress || 'Creating...'}</span>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: SUCCESS STATE */}
          {currentStep === 'SUCCESS' && savedResult && (
            <div className="space-y-5 max-w-xl mx-auto py-6 text-center animate-in zoom-in-95 duration-200">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border-2 border-emerald-500/30">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Countsheets Created
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {savedResult.totalSheets} sheets • {savedResult.totalItems} items
                </p>
              </div>

              {/* Stored in User's Google Drive "Generated Countsheet" Folder Badge */}
              <div className="p-3 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between gap-3 text-left">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <FolderOpen className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200 truncate">
                      Saved in Google Drive: {savedResult.folderName || GENERATED_COUNTSHEET_FOLDER_NAME}
                    </div>
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate">
                      Stored directly in your account&apos;s Google Drive folder
                    </div>
                  </div>
                </div>
                {savedResult.folderWebViewLink && (
                  <a
                    href={savedResult.folderWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 hover:bg-emerald-100 dark:hover:bg-zinc-700 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 text-[11px] font-bold flex items-center gap-1 shrink-0 transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Open Folder</span>
                  </a>
                )}
              </div>

              {/* Created tabs list */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-left space-y-2">
                <div className="divide-y divide-slate-100 dark:divide-zinc-800/80 max-h-48 overflow-y-auto">
                  {savedResult.sheetsCreated.map((s, idx) => (
                    <div
                      key={s.title + idx}
                      className="py-2 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-slate-800 dark:text-white">
                          {s.title}
                        </span>
                      </div>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                        {s.itemCount} items
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <a
                  href={savedResult.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Open Countsheet</span>
                </a>

                {savedResult.folderWebViewLink && (
                  <a
                    href={savedResult.folderWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Open &ldquo;{savedResult.folderName || GENERATED_COUNTSHEET_FOLDER_NAME}&rdquo; Folder</span>
                  </a>
                )}

                <button
                  onClick={() => setCurrentStep('FILTER_ITEMS')}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 font-bold text-xs transition-colors"
                >
                  Back
                </button>

                <button
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-400 font-bold text-xs transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        {isGoogleConnected && currentStep === 'FILTER_ITEMS' && (
          <div className="p-3.5 sm:p-5 border-t border-slate-200/90 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentStep('SELECT_FILE')}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Back
              </button>
              {savedToastMessage && (
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{savedToastMessage}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveCountsheetSessionOnly}
                disabled={totalSelectedCount === 0 || isSaving}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Save Countsheet</span>
              </button>

              <button
                onClick={handleGenerateCountsheets}
                disabled={totalSelectedCount === 0 || isSaving}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Create</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* GOOGLE SHEETS CTRL+P PRINT PREVIEW MODAL */}
        {showGroupsPreview && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="relative w-full max-w-[1280px] h-[94vh] bg-[#3c4043] rounded-2xl border border-zinc-700 shadow-2xl flex flex-col overflow-hidden text-white">
              {/* Top Google Sheets Print Preview Toolbar */}
              <div className="px-4 py-2.5 bg-[#202124] border-b border-zinc-700/80 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Printer className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-bold text-white tracking-tight">
                      Print preview
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-300">
                      Ctrl + P
                    </span>
                  </div>
                  <span className="text-xs text-zinc-400 hidden sm:inline">
                    {overallPlan.length} {overallPlan.length === 1 ? 'countsheet' : 'countsheets'} • {totalSelectedCount} items
                  </span>
                </div>

                {/* View Mode & Zoom Controls */}
                <div className="flex items-center flex-wrap gap-2">
                  <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/90 border border-zinc-700 text-[10.5px] text-zinc-300 font-mono">
                    <span className="text-blue-400 font-sans font-bold">
                      {templateSpec.spreadsheetTitle || 'RANDOM INVENTORY COUNTSHEET TEMPLATE'}:
                    </span>
                    <span>
                      {(templateSpec.fontStyles?.itemDescCell?.fontFamily || 'Calibri')
                        .split(',')[0]
                        .replace(/['"]/g, '')
                        .trim()}{' '}
                      {templateSpec.fontStyles?.itemDescCell?.fontSizePt || 9}pt
                    </span>
                    <span className="text-zinc-500">•</span>
                    <span>
                      B:{templateSpec.colWidths.B}px C:{templateSpec.colWidths.C}px D:{templateSpec.colWidths.D}px K:{templateSpec.colWidths.K}px
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRefreshTemplate(true)}
                    disabled={isRefreshingTemplate}
                    className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-200 text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    title="Refresh RANDOM INVENTORY COUNTSHEET TEMPLATE (syncs latest Font, Font Sizes, Row Heights, and Column Sizes from Google Sheets)"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRefreshingTemplate ? 'animate-spin' : ''}`} />
                    <span>{isRefreshingTemplate ? 'Refreshing Template...' : 'Refresh Template'}</span>
                  </button>

                  <div className="inline-flex rounded-lg bg-zinc-800 p-0.5 border border-zinc-700 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setPreviewLayoutMode('print')}
                      className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                        previewLayoutMode === 'print'
                          ? 'bg-blue-600 text-white shadow-2xs'
                          : 'text-zinc-300 hover:text-white'
                      }`}
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Preview (Ctrl+P)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewLayoutMode('sheet')}
                      className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                        previewLayoutMode === 'sheet'
                          ? 'bg-emerald-600 text-white shadow-2xs'
                          : 'text-zinc-300 hover:text-white'
                      }`}
                    >
                      <Table className="w-3.5 h-3.5" />
                      <span>Google Sheet Grid (B–O)</span>
                    </button>
                  </div>

                  {/* Zoom */}
                  <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-lg px-1.5 py-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setPreviewZoom((z) => Math.max(60, z - 10))}
                      className="p-1 text-zinc-300 hover:text-white cursor-pointer"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono text-[11px] text-zinc-200 w-10 text-center">
                      {previewZoom}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreviewZoom((z) => Math.min(130, z + 10))}
                      className="p-1 text-zinc-300 hover:text-white cursor-pointer"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    onClick={() => setShowGroupsPreview(false)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                    title="Close Preview"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Group / Countsheet Tab Selector Bar */}
              <div className="px-4 py-2 bg-[#292a2d] border-b border-zinc-700/80 flex items-center gap-2 overflow-x-auto">
                <button
                  onClick={() => setPreviewActiveGroupId('ALL')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 border cursor-pointer ${
                    previewActiveGroupId === 'ALL'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-2xs'
                      : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                  }`}
                >
                  <span>All Sheets</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/25 font-mono">
                    {overallPlan.length}
                  </span>
                </button>

                {groups.map((grp, gIdx) => {
                  const isSelected = grp.id === previewActiveGroupId;
                  const count = grp.selectedItemIds.size;
                  const meta = groupCsMeta.byGroupId.get(grp.id);
                  const displayCsName = meta?.csName || grp.name;

                  return (
                    <button
                      key={`grp_pill_${grp.id}_${gIdx}`}
                      onClick={() => setPreviewActiveGroupId(grp.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 border cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-500 shadow-2xs'
                          : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                      }`}
                    >
                      <span>{displayCsName}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-zinc-700 text-zinc-300'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Body: Google Sheets Print Preview / Sheet Grid Canvas */}
              {(() => {
                const CHUNK_SIZE = COUNTSHEET_MAX_ROWS_PER_SHEET;
                const cutoffRows = templateSpec.cutoffRows;
                const cw = templateSpec.colWidths;
                const rh = templateSpec.rowHeights;
                const fs = templateSpec.fontStyles;
                const printTableWidth = cw.B + cw.C + cw.D + cw.E + cw.F + cw.G + cw.H;
                const printPageWidth = printTableWidth + 48;
                const sheetGridTableWidth =
                  36 +
                  cw.B +
                  cw.C +
                  cw.D +
                  cw.E +
                  cw.F +
                  cw.G +
                  cw.H +
                  cw.I +
                  cw.J +
                  cw.K +
                  cw.L +
                  cw.M +
                  cw.N +
                  cw.O;

                // Build list of planned countsheet pages across either ALL groups or the selected group
                const targetGroups =
                  previewActiveGroupId === 'ALL'
                    ? groups
                    : groups.filter((g) => g.id === previewActiveGroupId);

                interface PreviewSheetPage {
                  sheetTitle: string;
                  groupName: string;
                  partNum: number;
                  totalParts: number;
                  items: ParsedIatdRow[];
                  physicalRows: SheetPhysicalRowSlot<ParsedIatdRow>[];
                }

                const pages: PreviewSheetPage[] = [];
                targetGroups.forEach((grp) => {
                  const filteredSelected = getOrderedGroupItems(grp, onlyItemsWithBalance);
                  const packedPages = packItemsInto34RowSheets(
                    filteredSelected,
                    CHUNK_SIZE,
                    COUNTSHEET_DESC_MAX_CHARS,
                    insertCategorySpacers
                  );
                  const totalSheetsForGroup = Math.max(1, packedPages.length);
                  const curMeta = groupCsMeta.byGroupId.get(grp.id);
                  const defaultCsName = curMeta?.csName || grp.name;
                  const baseName =
                    grp.baseSheetName && !isDefaultGroupOrCsName(grp.baseSheetName)
                      ? grp.baseSheetName
                      : grp.lastSelectedHierarchy || defaultCsName;
                  const csMatch = baseName.trim().match(/^CS(\d+)$/i);

                  for (let pIdx = 0; pIdx < totalSheetsForGroup; pIdx++) {
                    const partNum = pIdx + 1;
                    const sheetTabTitle = csMatch
                      ? formatCsCode(parseInt(csMatch[1], 10) + pIdx)
                      : partNum === 1
                      ? baseName
                      : `${baseName} ${partNum}`;
                    const packedPage = packedPages[pIdx] || {
                      items: [],
                      physicalRows: [],
                      rowsUsed: 0,
                    };
                    pages.push({
                      sheetTitle: sheetTabTitle,
                      groupName: defaultCsName,
                      partNum,
                      totalParts: totalSheetsForGroup,
                      items: packedPage.items,
                      physicalRows: packedPage.physicalRows,
                    });
                  }
                });

                const scaleVal = previewZoom / 100;

                return (
                  <div className="flex-1 overflow-auto bg-[#525659] p-4 sm:p-8 space-y-8">
                    {pages.map((page, pageIndex) => (
                      <div key={page.sheetTitle + pageIndex} className="flex flex-col items-center">
                        {/* Sheet Page Badge */}
                        <div className="mb-2.5 flex items-center justify-between gap-4 w-full max-w-[960px] text-xs text-zinc-200 px-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[11px] shadow-xs">
                              Tab: {page.sheetTitle}
                            </span>
                            <span className="text-zinc-300 font-medium">
                              Page {pageIndex + 1} of {pages.length}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-zinc-300">
                            {page.items.length} items • {page.physicalRows.length} / 34 rows filled
                          </span>
                        </div>

                        {/* Printable Paper Sheet / Google Sheet Container */}
                        <div className="w-full overflow-x-auto flex justify-center pb-2">
                          <div
                            style={{
                              transform: `scale(${scaleVal})`,
                              transformOrigin: 'top center',
                            }}
                            className="bg-white text-black shadow-[0_10px_35px_rgba(0,0,0,0.55)] border border-zinc-400 transition-transform"
                          >
                            {previewLayoutMode === 'print' ? (
                              /* =========================================================
                               * MODE 1: GOOGLE SHEETS CTRL+P PRINTABLE PAGE (Cols B to H)
                               * Live Font & Column Sizes synced from RANDOM INVENTORY COUNTSHEET TEMPLATE
                               * ========================================================= */
                              <div
                                className="p-6 sm:p-8 bg-white text-black select-text"
                                style={{
                                  width: `${printPageWidth}px`,
                                  fontFamily: fs.baseFontFamily,
                                }}
                              >
                                <table
                                  className="w-full border-collapse text-black"
                                  style={{ tableLayout: 'fixed', width: `${printTableWidth}px` }}
                                >
                                  <colgroup>
                                    <col style={{ width: `${cw.B}px` }} />
                                    <col style={{ width: `${cw.C}px` }} />
                                    <col style={{ width: `${cw.D}px` }} />
                                    <col style={{ width: `${cw.E}px` }} />
                                    <col style={{ width: `${cw.F}px` }} />
                                    <col style={{ width: `${cw.G}px` }} />
                                    <col style={{ width: `${cw.H}px` }} />
                                  </colgroup>
                                  <tbody>
                                    {/* ROWS 2-3: Form Title & Document Control Header */}
                                    <tr style={{ height: `${rh.headerRow2}px` }}>
                                      <td
                                        rowSpan={2}
                                        style={{
                                          borderTop: '1px solid #000',
                                          borderBottom: '1px solid #000',
                                          borderLeft: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          padding: '2px',
                                        }}
                                      >
                                        <img
                                          src="/sidc-countsheet-logo.jpg"
                                          alt="SIDC"
                                          style={{
                                            width: '55px',
                                            height: '56px',
                                            objectFit: 'contain',
                                            margin: '0 auto',
                                            display: 'block',
                                          }}
                                        />
                                      </td>
                                      <td
                                        colSpan={5}
                                        rowSpan={2}
                                        style={{
                                          borderTop: '1px solid #000',
                                          borderBottom: '1px solid #000',
                                          borderRight: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.formTitle.fontFamily,
                                          fontSize: `${fs.formTitle.fontSizePt}pt`,
                                          fontWeight: fs.formTitle.bold ? 700 : 400,
                                          fontStyle: fs.formTitle.italic ? 'italic' : 'normal',
                                        }}
                                      >
                                        {templateSpec.formTitle}
                                      </td>
                                      <td
                                        style={{
                                          border: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.docCode.fontFamily,
                                          fontSize: `${fs.docCode.fontSizePt}pt`,
                                          fontWeight: fs.docCode.bold ? 700 : 400,
                                          fontStyle: fs.docCode.italic ? 'italic' : 'normal',
                                        }}
                                      >
                                        {templateSpec.docCode}
                                      </td>
                                    </tr>
                                    <tr style={{ height: `${rh.headerRow3}px` }}>
                                      <td
                                        style={{
                                          border: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.revisionLine1.fontFamily,
                                          fontSize: `${fs.revisionLine1.fontSizePt}pt`,
                                          fontWeight: fs.revisionLine1.bold ? 700 : 400,
                                          lineHeight: 1.15,
                                        }}
                                      >
                                        <div>{templateSpec.revisionLine1}</div>
                                        <div
                                          style={{
                                            fontFamily: fs.revisionLine2.fontFamily,
                                            fontSize: `${fs.revisionLine2.fontSizePt}pt`,
                                            fontStyle: fs.revisionLine2.italic ? 'italic' : 'normal',
                                            fontWeight: fs.revisionLine2.bold ? 700 : 400,
                                          }}
                                        >
                                          {templateSpec.revisionLine2}
                                        </div>
                                      </td>
                                    </tr>

                                    {/* ROW 4: Privacy Notice */}
                                    <tr style={{ height: `${rh.privacyRow4}px` }}>
                                      <td
                                        colSpan={7}
                                        style={{
                                          fontFamily: fs.privacyNotice.fontFamily,
                                          fontSize: `${fs.privacyNotice.fontSizePt}pt`,
                                          fontStyle: fs.privacyNotice.italic ? 'italic' : 'normal',
                                          padding: '2px 3px',
                                          lineHeight: 1.2,
                                        }}
                                      >
                                        {templateSpec.privacyNotice.replace(/^privacy notice:\s*/i, '') !==
                                        templateSpec.privacyNotice ? (
                                          <>
                                            <span style={{ fontWeight: 700 }}>Privacy Notice:</span>{' '}
                                            {templateSpec.privacyNotice.replace(/^privacy notice:\s*/i, '')}
                                          </>
                                        ) : (
                                          templateSpec.privacyNotice
                                        )}
                                      </td>
                                    </tr>

                                    {/* ROW 5: Branch/Project & Name of Sales Clerk */}
                                    <tr style={{ height: `${rh.branchRow5}px` }}>
                                      <td
                                        colSpan={5}
                                        style={{
                                          fontFamily: fs.branchInfo.fontFamily,
                                          fontSize: `${fs.branchInfo.fontSizePt}pt`,
                                          fontWeight: fs.branchInfo.bold ? 700 : 400,
                                          fontStyle: fs.branchInfo.italic ? 'italic' : 'normal',
                                          padding: '1px 3px',
                                        }}
                                      >
                                        {templateSpec.row5Left}
                                      </td>
                                      <td
                                        colSpan={2}
                                        style={{
                                          fontFamily: fs.branchInfo.fontFamily,
                                          fontSize: `${fs.branchInfo.fontSizePt}pt`,
                                          fontWeight: fs.branchInfo.bold ? 700 : 400,
                                          fontStyle: fs.branchInfo.italic ? 'italic' : 'normal',
                                          padding: '1px 3px',
                                        }}
                                      >
                                        {templateSpec.row5Right}
                                      </td>
                                    </tr>

                                    {/* ROW 6: As of & Stockman/Warehouseman */}
                                    <tr style={{ height: `${rh.branchRow6}px` }}>
                                      <td
                                        colSpan={5}
                                        style={{
                                          fontFamily: fs.branchInfo.fontFamily,
                                          fontSize: `${fs.branchInfo.fontSizePt}pt`,
                                          fontWeight: fs.branchInfo.bold ? 700 : 400,
                                          fontStyle: fs.branchInfo.italic ? 'italic' : 'normal',
                                          padding: '1px 3px',
                                        }}
                                      >
                                        {templateSpec.row6Left}
                                      </td>
                                      <td
                                        colSpan={2}
                                        style={{
                                          fontFamily: fs.branchInfo.fontFamily,
                                          fontSize: `${fs.branchInfo.fontSizePt}pt`,
                                          fontWeight: fs.branchInfo.bold ? 700 : 400,
                                          fontStyle: fs.branchInfo.italic ? 'italic' : 'normal',
                                          padding: '1px 3px',
                                        }}
                                      >
                                        {templateSpec.row6Right}
                                      </td>
                                    </tr>

                                    {/* ROW 7: Blank Spacer */}
                                    <tr style={{ height: `${rh.spacerRow7}px` }}>
                                      <td colSpan={7}></td>
                                    </tr>

                                    {/* ROW 8: Countsheet Table Header */}
                                    <tr style={{ height: `${rh.tableHeaderRow8}px` }}>
                                      <td
                                        colSpan={2}
                                        style={{
                                          border: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.printTableHeader.fontFamily,
                                          fontSize: `${fs.printTableHeader.fontSizePt}pt`,
                                          fontWeight: fs.printTableHeader.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.printHeaders.stockDescription}
                                      </td>
                                      <td
                                        style={{
                                          border: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.printTableHeader.fontFamily,
                                          fontSize: `${fs.printTableHeader.fontSizePt}pt`,
                                          fontWeight: fs.printTableHeader.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.printHeaders.unit}
                                      </td>
                                      <td
                                        style={{
                                          border: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.printTableHeader.fontFamily,
                                          fontSize: `${fs.printTableHeader.fontSizePt}pt`,
                                          fontWeight: fs.printTableHeader.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.printHeaders.actualCount}
                                      </td>
                                      <td
                                        style={{
                                          border: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.printTableHeader.fontFamily,
                                          fontSize: `${fs.printTableHeader.fontSizePt}pt`,
                                          fontWeight: fs.printTableHeader.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.printHeaders.perPos}
                                      </td>
                                      <td
                                        style={{
                                          border: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.printTableHeader.fontFamily,
                                          fontSize: `${fs.printTableHeader.fontSizePt}pt`,
                                          fontWeight: fs.printTableHeader.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.printHeaders.variance}
                                      </td>
                                      <td
                                        style={{
                                          border: '1px solid #000',
                                          textAlign: 'center',
                                          verticalAlign: 'middle',
                                          fontFamily: fs.printTableHeader.fontFamily,
                                          fontSize: `${fs.printTableHeader.fontSizePt}pt`,
                                          fontWeight: fs.printTableHeader.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.printHeaders.remarks}
                                      </td>
                                    </tr>

                                    {/* ROWS 9-42: All 34 Countsheet Physical Rows (=J9..=J42, =K9..=K42, =O9..=O42) */}
                                    {Array.from({ length: CHUNK_SIZE }).map((_, rIdx) => {
                                      const slot = page.physicalRows[rIdx];
                                      const nextSlot =
                                        rIdx + 1 < CHUNK_SIZE ? page.physicalRows[rIdx + 1] : undefined;
                                      const item = slot?.item;
                                      const isCont = slot?.isContinuation ?? false;
                                      const hasContinuationBelow = Boolean(slot && nextSlot?.isContinuation);
                                      const topBorder = isCont ? '0px solid transparent' : '1px solid #000';
                                      const bottomBorder = hasContinuationBelow
                                        ? '0px solid transparent'
                                        : '1px solid #000';
                                      return (
                                        <tr
                                          key={`${rIdx}_${item?.id || 'empty'}_${isCont ? 'cont' : 'main'}`}
                                          style={{ height: `${rh.itemRow}px` }}
                                          className="group/csrow"
                                        >
                                          {/* Col B: =J{row} Item Code (blank on continuation rows) */}
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              padding: '0 4px',
                                              fontSize: `${fs.itemCodeCell.fontSizePt}pt`,
                                              fontFamily: fs.itemCodeCell.fontFamily,
                                              fontWeight: fs.itemCodeCell.bold ? 700 : 400,
                                              fontStyle: fs.itemCodeCell.italic ? 'italic' : 'normal',
                                              whiteSpace: 'nowrap',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                            }}
                                          >
                                            {item && !isCont ? item.itemCode || item.barcode || '' : ''}
                                          </td>
                                          {/* Col C: =K{row} Stock Description (wrapped <= 50 chars per row) */}
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderRight: '1px solid #000',
                                              padding: '0 4px',
                                              fontSize: `${fs.itemDescCell.fontSizePt}pt`,
                                              fontFamily: fs.itemDescCell.fontFamily,
                                              fontWeight: fs.itemDescCell.bold ? 700 : 400,
                                              fontStyle: fs.itemDescCell.italic ? 'italic' : 'normal',
                                              whiteSpace: 'nowrap',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                            }}
                                          >
                                            {slot ? slot.descriptionLine : ''}
                                          </td>
                                          {/* Col D: =O{row} Pc/Box (Unit - blank on continuation rows) */}
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                              textAlign: 'center',
                                              padding: '0 2px',
                                              fontSize: `${fs.itemUnitCell.fontSizePt}pt`,
                                              fontFamily: fs.itemUnitCell.fontFamily,
                                              fontWeight: fs.itemUnitCell.bold ? 700 : 400,
                                              fontStyle: fs.itemUnitCell.italic ? 'italic' : 'normal',
                                              whiteSpace: 'nowrap',
                                            }}
                                          >
                                            {item && !isCont ? item.unit || 'PCS' : ''}
                                          </td>
                                          {/* Col E: Actual Count */}
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                            }}
                                          ></td>
                                          {/* Col F: Per POS */}
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                            }}
                                          ></td>
                                          {/* Col G: Variance */}
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                            }}
                                          ></td>
                                          {/* Col H: Remarks (with hover Remove button so removing a 2-row item immediately restores the horizontal border) */}
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                              position: 'relative',
                                            }}
                                          >
                                            {item && !isCont && (
                                              <button
                                                type="button"
                                                onClick={() => handleToggleSelectItem(item.id)}
                                                title="Remove this item from countsheet (restores standard row border)"
                                                className="print:hidden opacity-0 group-hover/csrow:opacity-100 focus:opacity-100 transition-opacity absolute right-1 top-1/2 -translate-y-1/2 px-1.5 py-0.2 rounded bg-rose-600 hover:bg-rose-700 text-white text-[9px] font-sans font-bold cursor-pointer shadow-2xs"
                                              >
                                                Remove ×
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}

                                    {/* ROW 43: Accuracy Declaration */}
                                    <tr style={{ height: `${rh.declarationRow43}px` }}>
                                      <td
                                        colSpan={7}
                                        style={{
                                          fontFamily: fs.declaration.fontFamily,
                                          fontSize: `${fs.declaration.fontSizePt}pt`,
                                          padding: '3px 3px 1px 3px',
                                          lineHeight: 1.2,
                                        }}
                                      >
                                        <div>{templateSpec.declarationLine1}</div>
                                        <div style={{ fontStyle: 'italic' }}>
                                          {templateSpec.declarationLine2}
                                        </div>
                                      </td>
                                    </tr>

                                    {/* ROW 44: Spacer */}
                                    <tr style={{ height: '14px' }}>
                                      <td colSpan={7}></td>
                                    </tr>

                                    {/* ROWS 45-55: Last SI through Last DR */}
                                    {cutoffRows.map((cRow, dIdx) => (
                                      <tr key={dIdx} style={{ height: `${rh.cutoffRow}px` }}>
                                        <td
                                          colSpan={3}
                                          style={{
                                            fontFamily: fs.cutoffRow.fontFamily,
                                            fontSize: `${fs.cutoffRow.fontSizePt}pt`,
                                            fontWeight: fs.cutoffRow.bold ? 700 : 400,
                                            padding: '0 3px',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {cRow.docLabel}
                                        </td>
                                        <td
                                          colSpan={3}
                                          style={{
                                            fontFamily: fs.cutoffRow.fontFamily,
                                            fontSize: `${fs.cutoffRow.fontSizePt}pt`,
                                            fontWeight: fs.cutoffRow.bold ? 700 : 400,
                                            padding: '0 3px',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {cRow.dateLabel}
                                        </td>
                                        <td
                                          style={{
                                            fontFamily: fs.cutoffRow.fontFamily,
                                            fontSize: `${fs.cutoffRow.fontSizePt}pt`,
                                            fontWeight: fs.cutoffRow.bold ? 700 : 400,
                                            padding: '0 3px',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {cRow.amountLabel}
                                        </td>
                                      </tr>
                                    ))}

                                    {/* ROW 56: Spacer */}
                                    <tr style={{ height: '16px' }}>
                                      <td colSpan={7}></td>
                                    </tr>

                                    {/* ROW 57: Signatory Headers */}
                                    <tr style={{ height: `${rh.signatoryRow}px` }}>
                                      <td
                                        colSpan={2}
                                        style={{
                                          fontFamily: fs.signatoryHeader.fontFamily,
                                          fontSize: `${fs.signatoryHeader.fontSizePt}pt`,
                                          fontWeight: fs.signatoryHeader.bold ? 700 : 400,
                                          padding: '0 3px',
                                        }}
                                      >
                                        {templateSpec.signatoryHeaders.preparedBy}
                                      </td>
                                      <td
                                        colSpan={4}
                                        style={{
                                          fontFamily: fs.signatoryHeader.fontFamily,
                                          fontSize: `${fs.signatoryHeader.fontSizePt}pt`,
                                          fontWeight: fs.signatoryHeader.bold ? 700 : 400,
                                          padding: '0 3px',
                                        }}
                                      >
                                        {templateSpec.signatoryHeaders.conformedBy}
                                      </td>
                                      <td
                                        style={{
                                          fontFamily: fs.signatoryHeader.fontFamily,
                                          fontSize: `${fs.signatoryHeader.fontSizePt}pt`,
                                          fontWeight: fs.signatoryHeader.bold ? 700 : 400,
                                          padding: '0 3px',
                                        }}
                                      >
                                        {templateSpec.signatoryHeaders.notedBy}
                                      </td>
                                    </tr>

                                    {/* ROW 58: Signature Lines */}
                                    <tr style={{ height: `${rh.signatoryRow}px` }}>
                                      <td
                                        colSpan={2}
                                        style={{
                                          fontFamily: fs.signatoryTitle.fontFamily,
                                          fontSize: `${fs.signatoryTitle.fontSizePt}pt`,
                                          padding: '0 3px',
                                          verticalAlign: 'bottom',
                                        }}
                                      >
                                        {templateSpec.signatoryLines.preparedBy}
                                      </td>
                                      <td
                                        colSpan={3}
                                        style={{
                                          borderBottom: '1px solid #000',
                                        }}
                                      >
                                        {templateSpec.signatoryLines.conformedBy}
                                      </td>
                                      <td></td>
                                      <td
                                        style={{
                                          borderBottom: '1px solid #000',
                                        }}
                                      >
                                        {templateSpec.signatoryLines.notedBy}
                                      </td>
                                    </tr>

                                    {/* ROW 59: Signatory Titles */}
                                    <tr style={{ height: `${rh.signatoryRow}px` }}>
                                      <td
                                        colSpan={2}
                                        style={{
                                          fontFamily: fs.signatoryTitle.fontFamily,
                                          fontSize: `${fs.signatoryTitle.fontSizePt}pt`,
                                          padding: '1px 3px',
                                        }}
                                      >
                                        {templateSpec.signatoryTitles.preparedBy}
                                      </td>
                                      <td
                                        colSpan={3}
                                        style={{
                                          fontFamily: fs.signatoryTitle.fontFamily,
                                          fontSize: `${fs.signatoryTitle.fontSizePt}pt`,
                                          textAlign: 'center',
                                          padding: '1px 3px',
                                        }}
                                      >
                                        {templateSpec.signatoryTitles.conformedBy}
                                      </td>
                                      <td></td>
                                      <td
                                        style={{
                                          fontFamily: fs.signatoryTitle.fontFamily,
                                          fontSize: `${fs.signatoryTitle.fontSizePt}pt`,
                                          textAlign: 'center',
                                          padding: '1px 3px',
                                        }}
                                      >
                                        {templateSpec.signatoryTitles.notedBy}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              /* =========================================================
                               * MODE 2: FULL GOOGLE SHEET GRID VIEW (Cols B to O, Rows 1-42)
                               * Live Font & Column Sizes synced from RANDOM INVENTORY COUNTSHEET TEMPLATE
                               * ========================================================= */
                              <div
                                className="bg-white text-black select-text"
                                style={{
                                  width: `${sheetGridTableWidth}px`,
                                  fontFamily: fs.baseFontFamily,
                                }}
                              >
                                <table
                                  className="w-full border-collapse text-black"
                                  style={{ tableLayout: 'fixed', width: `${sheetGridTableWidth}px` }}
                                >
                                  <thead>
                                    <tr className="bg-[#f8f9fa] text-[#5f6368] text-[11px] font-normal">
                                      <th className="border border-[#dadce0] w-[36px] py-1 text-center bg-[#f8f9fa]"></th>
                                      <th className="border border-[#dadce0] py-1 text-center" style={{ width: `${cw.B}px` }}>B</th>
                                      <th className="border border-[#dadce0] py-1 text-center" style={{ width: `${cw.C}px` }}>C</th>
                                      <th className="border border-[#dadce0] py-1 text-center" style={{ width: `${cw.D}px` }}>D</th>
                                      <th className="border border-[#dadce0] py-1 text-center" style={{ width: `${cw.E}px` }}>E</th>
                                      <th className="border border-[#dadce0] py-1 text-center" style={{ width: `${cw.F}px` }}>F</th>
                                      <th className="border border-[#dadce0] py-1 text-center" style={{ width: `${cw.G}px` }}>G</th>
                                      <th className="border border-[#dadce0] py-1 text-center" style={{ width: `${cw.H}px` }}>H</th>
                                      <th className="border border-[#dadce0] py-1 text-center" style={{ width: `${cw.I}px` }}>I</th>
                                      <th className="border border-[#dadce0] py-1 text-center bg-emerald-50/70 font-bold text-emerald-900" style={{ width: `${cw.J}px` }}>J</th>
                                      <th className="border border-[#dadce0] py-1 text-center bg-emerald-50/70 font-bold text-emerald-900" style={{ width: `${cw.K}px` }}>K</th>
                                      <th className="border border-[#dadce0] py-1 text-center bg-emerald-50/70 font-bold text-emerald-900" style={{ width: `${cw.L}px` }}>L</th>
                                      <th className="border border-[#dadce0] py-1 text-center bg-emerald-50/70 font-bold text-emerald-900" style={{ width: `${cw.M}px` }}>M</th>
                                      <th className="border border-[#dadce0] py-1 text-center bg-emerald-50/70 font-bold text-emerald-900" style={{ width: `${cw.N}px` }}>N</th>
                                      <th className="border border-[#dadce0] py-1 text-center bg-emerald-50/70 font-bold text-emerald-900" style={{ width: `${cw.O}px` }}>O</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {/* Row 2-3 */}
                                    <tr style={{ height: `${rh.headerRow2}px` }}>
                                      <td className="bg-[#f8f9fa] border border-[#dadce0] text-center text-[10px] text-[#5f6368]">2</td>
                                      <td rowSpan={2} className="border border-black text-center align-middle p-0.5">
                                        <img src="/sidc-countsheet-logo.jpg" alt="SIDC" className="w-12 h-12 object-contain mx-auto" />
                                      </td>
                                      <td
                                        colSpan={5}
                                        rowSpan={2}
                                        className="border border-black text-center align-middle"
                                        style={{
                                          fontFamily: fs.formTitle.fontFamily,
                                          fontSize: `${fs.formTitle.fontSizePt}pt`,
                                          fontWeight: fs.formTitle.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.formTitle}
                                      </td>
                                      <td
                                        className="border border-black text-center align-middle"
                                        style={{
                                          fontFamily: fs.docCode.fontFamily,
                                          fontSize: `${fs.docCode.fontSizePt}pt`,
                                          fontWeight: fs.docCode.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.docCode}
                                      </td>
                                      <td className="border border-[#e2e8f0]"></td>
                                      <td colSpan={6} className="border border-[#e2e8f0]"></td>
                                    </tr>
                                    <tr style={{ height: `${rh.headerRow3}px` }}>
                                      <td className="bg-[#f8f9fa] border border-[#dadce0] text-center text-[10px] text-[#5f6368]">3</td>
                                      <td
                                        className="border border-black text-center align-middle leading-tight"
                                        style={{
                                          fontFamily: fs.revisionLine1.fontFamily,
                                          fontSize: `${fs.revisionLine1.fontSizePt}pt`,
                                        }}
                                      >
                                        <div>{templateSpec.revisionLine1}</div>
                                        <div
                                          style={{
                                            fontFamily: fs.revisionLine2.fontFamily,
                                            fontSize: `${fs.revisionLine2.fontSizePt}pt`,
                                            fontStyle: fs.revisionLine2.italic ? 'italic' : 'normal',
                                          }}
                                        >
                                          {templateSpec.revisionLine2}
                                        </div>
                                      </td>
                                      <td className="border border-[#e2e8f0]"></td>
                                      <td colSpan={6} className="border border-[#e2e8f0]"></td>
                                    </tr>
                                    {/* Row 4 */}
                                    <tr style={{ height: `${rh.privacyRow4}px` }}>
                                      <td className="bg-[#f8f9fa] border border-[#dadce0] text-center text-[10px] text-[#5f6368]">4</td>
                                      <td
                                        colSpan={7}
                                        className="border border-[#e2e8f0] px-1 truncate"
                                        style={{
                                          fontFamily: fs.privacyNotice.fontFamily,
                                          fontSize: `${fs.privacyNotice.fontSizePt}pt`,
                                          fontStyle: fs.privacyNotice.italic ? 'italic' : 'normal',
                                        }}
                                      >
                                        {templateSpec.privacyNotice}
                                      </td>
                                      <td className="border border-[#e2e8f0]"></td>
                                      <td colSpan={6} className="border border-[#e2e8f0]"></td>
                                    </tr>
                                    {/* Row 5 */}
                                    <tr style={{ height: `${rh.branchRow5}px` }}>
                                      <td className="bg-[#f8f9fa] border border-[#dadce0] text-center text-[10px] text-[#5f6368]">5</td>
                                      <td
                                        colSpan={5}
                                        className="border border-[#e2e8f0] px-1"
                                        style={{
                                          fontFamily: fs.branchInfo.fontFamily,
                                          fontSize: `${fs.branchInfo.fontSizePt}pt`,
                                          fontWeight: fs.branchInfo.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.row5Left}
                                      </td>
                                      <td
                                        colSpan={2}
                                        className="border border-[#e2e8f0] px-1"
                                        style={{
                                          fontFamily: fs.branchInfo.fontFamily,
                                          fontSize: `${fs.branchInfo.fontSizePt}pt`,
                                          fontWeight: fs.branchInfo.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.row5Right}
                                      </td>
                                      <td className="border border-[#e2e8f0]"></td>
                                      <td colSpan={6} className="border border-[#e2e8f0]"></td>
                                    </tr>
                                    {/* Row 6 */}
                                    <tr style={{ height: `${rh.branchRow6}px` }}>
                                      <td className="bg-[#f8f9fa] border border-[#dadce0] text-center text-[10px] text-[#5f6368]">6</td>
                                      <td
                                        colSpan={5}
                                        className="border border-[#e2e8f0] px-1"
                                        style={{
                                          fontFamily: fs.branchInfo.fontFamily,
                                          fontSize: `${fs.branchInfo.fontSizePt}pt`,
                                          fontWeight: fs.branchInfo.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.row6Left}
                                      </td>
                                      <td
                                        colSpan={2}
                                        className="border border-[#e2e8f0] px-1"
                                        style={{
                                          fontFamily: fs.branchInfo.fontFamily,
                                          fontSize: `${fs.branchInfo.fontSizePt}pt`,
                                          fontWeight: fs.branchInfo.bold ? 700 : 400,
                                        }}
                                      >
                                        {templateSpec.row6Right}
                                      </td>
                                      <td className="border border-[#e2e8f0]"></td>
                                      <td colSpan={6} className="border border-[#e2e8f0]"></td>
                                    </tr>
                                    {/* Row 7 */}
                                    <tr style={{ height: `${rh.spacerRow7}px` }}>
                                      <td className="bg-[#f8f9fa] border border-[#dadce0] text-center text-[10px] text-[#5f6368]">7</td>
                                      <td colSpan={14} className="border border-[#e2e8f0]"></td>
                                    </tr>
                                    {/* Row 8 Headers */}
                                    <tr style={{ height: `${rh.tableHeaderRow8}px` }}>
                                      <td className="bg-[#f8f9fa] border border-[#dadce0] text-center text-[10px] text-[#5f6368]">8</td>
                                      {[
                                        { label: templateSpec.printHeaders.stockDescription, colSpan: 2 },
                                        { label: templateSpec.printHeaders.unit, colSpan: 1 },
                                        { label: templateSpec.printHeaders.actualCount, colSpan: 1 },
                                        { label: templateSpec.printHeaders.perPos, colSpan: 1 },
                                        { label: templateSpec.printHeaders.variance, colSpan: 1 },
                                        { label: templateSpec.printHeaders.remarks, colSpan: 1 },
                                      ].map((hdr, hIdx) => (
                                        <td
                                          key={hIdx}
                                          colSpan={hdr.colSpan}
                                          className="border border-black text-center"
                                          style={{
                                            fontFamily: fs.printTableHeader.fontFamily,
                                            fontSize: `${fs.printTableHeader.fontSizePt}pt`,
                                            fontWeight: fs.printTableHeader.bold ? 700 : 400,
                                          }}
                                        >
                                          {hdr.label}
                                        </td>
                                      ))}
                                      <td className="border border-[#e2e8f0]"></td>
                                      {[
                                        templateSpec.dataHeaders.itemCode,
                                        templateSpec.dataHeaders.itemDescription,
                                        templateSpec.dataHeaders.cost,
                                        templateSpec.dataHeaders.selling,
                                        templateSpec.dataHeaders.balance,
                                        templateSpec.dataHeaders.unit,
                                      ].map((dHdr, dIdx) => (
                                        <td
                                          key={dIdx}
                                          className="border border-black text-center bg-emerald-50/40"
                                          style={{
                                            fontFamily: fs.dataTableHeader.fontFamily,
                                            fontSize: `${fs.dataTableHeader.fontSizePt}pt`,
                                            fontWeight: fs.dataTableHeader.bold ? 700 : 400,
                                          }}
                                        >
                                          {dHdr}
                                        </td>
                                      ))}
                                    </tr>
                                    {/* Rows 9-42 */}
                                    {Array.from({ length: CHUNK_SIZE }).map((_, rIdx) => {
                                      const sheetRowNum = rIdx + 9;
                                      const slot = page.physicalRows[rIdx];
                                      const nextSlot =
                                        rIdx + 1 < CHUNK_SIZE ? page.physicalRows[rIdx + 1] : undefined;
                                      const item = slot?.item;
                                      const isCont = slot?.isContinuation ?? false;
                                      const hasContinuationBelow = Boolean(slot && nextSlot?.isContinuation);
                                      const topBorder = isCont ? '0px solid transparent' : '1px solid #000';
                                      const bottomBorder = hasContinuationBelow
                                        ? '0px solid transparent'
                                        : '1px solid #000';
                                      return (
                                        <tr
                                          key={`${sheetRowNum}_${item?.id || 'empty'}_${isCont ? 'cont' : 'main'}`}
                                          style={{ height: `${rh.itemRow}px` }}
                                          className="group/csrow"
                                        >
                                          <td className="bg-[#f8f9fa] border border-[#dadce0] text-center text-[10px] text-[#5f6368]">
                                            {sheetRowNum}
                                          </td>
                                          <td
                                            className="px-1 truncate"
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              fontFamily: fs.itemCodeCell.fontFamily,
                                              fontSize: `${fs.itemCodeCell.fontSizePt}pt`,
                                              fontWeight: fs.itemCodeCell.bold ? 700 : 400,
                                              fontStyle: fs.itemCodeCell.italic ? 'italic' : 'normal',
                                            }}
                                          >
                                            {item && !isCont ? item.itemCode || item.barcode || '' : ''}
                                          </td>
                                          <td
                                            className="px-1 truncate"
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderRight: '1px solid #000',
                                              fontFamily: fs.itemDescCell.fontFamily,
                                              fontSize: `${fs.itemDescCell.fontSizePt}pt`,
                                              fontWeight: fs.itemDescCell.bold ? 700 : 400,
                                              fontStyle: fs.itemDescCell.italic ? 'italic' : 'normal',
                                            }}
                                          >
                                            {slot ? slot.descriptionLine : ''}
                                          </td>
                                          <td
                                            className="text-center"
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                              fontFamily: fs.itemUnitCell.fontFamily,
                                              fontSize: `${fs.itemUnitCell.fontSizePt}pt`,
                                              fontWeight: fs.itemUnitCell.bold ? 700 : 400,
                                              fontStyle: fs.itemUnitCell.italic ? 'italic' : 'normal',
                                            }}
                                          >
                                            {item && !isCont ? item.unit || 'PCS' : ''}
                                          </td>
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                            }}
                                          ></td>
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                            }}
                                          ></td>
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                            }}
                                          ></td>
                                          <td
                                            style={{
                                              borderTop: topBorder,
                                              borderBottom: bottomBorder,
                                              borderLeft: '1px solid #000',
                                              borderRight: '1px solid #000',
                                              position: 'relative',
                                            }}
                                          >
                                            {item && !isCont && (
                                              <button
                                                type="button"
                                                onClick={() => handleToggleSelectItem(item.id)}
                                                title="Remove this item from countsheet (restores standard row border)"
                                                className="print:hidden opacity-0 group-hover/csrow:opacity-100 focus:opacity-100 transition-opacity absolute right-1 top-1/2 -translate-y-1/2 px-1.5 py-0.2 rounded bg-rose-600 hover:bg-rose-700 text-white text-[9px] font-sans font-bold cursor-pointer shadow-2xs"
                                              >
                                                Remove ×
                                              </button>
                                            )}
                                          </td>
                                          <td className="border border-[#e2e8f0]"></td>
                                          {/* Source Columns J-O (on continuation rows, only Col K has remaining description; J, L, M, N, O are blank) */}
                                          <td
                                            className="border border-black px-1 truncate"
                                            style={{
                                              fontFamily: fs.dataSourceCell.fontFamily,
                                              fontSize: `${fs.dataSourceCell.fontSizePt}pt`,
                                            }}
                                          >
                                            {item && !isCont ? item.itemCode || item.barcode || '' : ''}
                                          </td>
                                          <td
                                            className="border border-black px-1 truncate"
                                            style={{
                                              fontFamily: fs.dataSourceCell.fontFamily,
                                              fontSize: `${fs.dataSourceCell.fontSizePt}pt`,
                                            }}
                                          >
                                            {slot ? slot.descriptionLine : ''}
                                          </td>
                                          <td
                                            className="border border-black px-1 text-center"
                                            style={{
                                              fontFamily: fs.dataSourceCell.fontFamily,
                                              fontSize: `${fs.dataSourceCell.fontSizePt}pt`,
                                            }}
                                          >
                                            {item && !isCont && item.cost ? item.cost.toFixed(2) : ''}
                                          </td>
                                          <td
                                            className="border border-black px-1 text-center"
                                            style={{
                                              fontFamily: fs.dataSourceCell.fontFamily,
                                              fontSize: `${fs.dataSourceCell.fontSizePt}pt`,
                                            }}
                                          >
                                            {item && !isCont && item.selling ? item.selling.toFixed(2) : ''}
                                          </td>
                                          <td
                                            className="border border-black px-1 text-center"
                                            style={{
                                              fontFamily: fs.dataSourceCell.fontFamily,
                                              fontSize: `${fs.dataSourceCell.fontSizePt}pt`,
                                            }}
                                          >
                                            {item && !isCont && item.balance !== undefined ? item.balance : ''}
                                          </td>
                                          <td
                                            className="border border-black px-1 text-center"
                                            style={{
                                              fontFamily: fs.dataSourceCell.fontFamily,
                                              fontSize: `${fs.dataSourceCell.fontSizePt}pt`,
                                            }}
                                          >
                                            {item && !isCont ? item.unit || 'PCS' : ''}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Bottom Google Sheets Tab Bar & Close Action */}
              <div className="px-4 py-2 bg-[#202124] border-t border-zinc-700/80 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1 overflow-x-auto text-xs">
                  {overallPlan.map((gp) => (
                    <button
                      key={gp.groupId + gp.sheetTitle}
                      onClick={() => setPreviewActiveGroupId(gp.groupId)}
                      className={`px-3 py-1 rounded-t-md font-bold border-b-2 transition-colors cursor-pointer ${
                        previewActiveGroupId === gp.groupId
                          ? 'bg-zinc-800 text-emerald-400 border-emerald-400'
                          : 'bg-zinc-900/60 text-zinc-400 border-transparent hover:text-zinc-200'
                      }`}
                    >
                      {gp.sheetTitle}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setShowGroupsPreview(false)}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors shrink-0 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* IMPORT GENERATED COUNTSHEET MODAL (PLOTTED TEMPLATE RECOVERY) */}
        {showImportPlottedModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="p-4 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-2 bg-slate-50/80 dark:bg-zinc-800/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Import Generated Countsheets
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                      Recover countsheets already plotted in a template Google Sheet
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImportPlottedModal(false)}
                  disabled={isImportingPlottedSheet}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                {importPlottedError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{importPlottedError}</span>
                  </div>
                )}

                {importPlottedSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{importPlottedSuccess}</span>
                  </div>
                )}

                {/* Option 1: URL / ID input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-zinc-300 block">
                    Paste Countsheet Google Sheets Link or ID:
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={importPlottedSpreadsheetInput}
                      onChange={(e) => setImportPlottedSpreadsheetInput(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                      disabled={isImportingPlottedSheet}
                      className="flex-1 px-3 py-2 text-xs bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleImportGeneratedCountsheet()}
                      disabled={isImportingPlottedSheet || !importPlottedSpreadsheetInput.trim()}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0 cursor-pointer transition shadow-xs"
                    >
                      {isImportingPlottedSheet ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                      )}
                      <span>{isImportingPlottedSheet ? 'Importing...' : 'Import'}</span>
                    </button>
                  </div>
                </div>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-slate-200 dark:border-zinc-800"></div>
                  <span className="flex-shrink mx-3 text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500">
                    Or select from your Google Drive
                  </span>
                  <div className="flex-grow border-t border-slate-200 dark:border-zinc-800"></div>
                </div>

                {/* Option 2: Search Drive Spreadsheets */}
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                    <input
                      type="text"
                      value={importDriveFilter}
                      onChange={(e) => setImportDriveFilter(e.target.value)}
                      placeholder="Search countsheet spreadsheets..."
                      disabled={isImportingPlottedSheet}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="border border-slate-200 dark:border-zinc-800 rounded-xl divide-y divide-slate-100 dark:divide-zinc-800 max-h-52 overflow-y-auto bg-slate-50/50 dark:bg-zinc-900/40">
                    {driveFiles
                      .filter((f) =>
                        importDriveFilter
                          ? f.name.toLowerCase().includes(importDriveFilter.toLowerCase())
                          : true
                      )
                      .map((file, fIdx) => (
                        <button
                          key={`imp_drive_${file.id}_${fIdx}`}
                          type="button"
                          onClick={() => handleImportGeneratedCountsheet(file.id)}
                          disabled={isImportingPlottedSheet}
                          className="w-full p-2.5 text-left flex items-center justify-between gap-2.5 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30 transition group cursor-pointer disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200 truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
                              {file.name}
                            </span>
                          </div>
                          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 group-hover:translate-x-0.5 transition-transform shrink-0">
                            Import &rarr;
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-3 bg-slate-50 dark:bg-zinc-800/60 border-t border-slate-200 dark:border-zinc-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowImportPlottedModal(false)}
                  disabled={isImportingPlottedSheet}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
