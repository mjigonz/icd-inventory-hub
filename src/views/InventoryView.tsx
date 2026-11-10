import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Package,
  Plus,
  CheckCircle2,
  Database,
  Layers,
  Sparkles,
  Barcode,
  Tag,
  DollarSign,
  X,
  AlertCircle,
  RefreshCw,
  LayoutGrid,
  Table,
  Edit3,
  Pencil,
  Trash2,
  Save,
  ExternalLink,
  ShieldCheck,
  Lock,
  Copy,
  Check,
  FileSpreadsheet,
  Link2,
  ScanBarcode,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { SEOHead } from '../components/SEOHead';
import { PanelDecoration } from '../components/PanelDecoration';
import { HighlightedText } from '../components/HighlightedText';
import { CustomSelect } from '../components/CustomSelect';
import {
  InventoryItem,
  Countsheet,
  CountsheetItem,
  SelectedBranch,
  ItemCondition,
  IatdCsColumnMeta,
  IatdRemarksColumnMeta,
} from '../types';
import {
  searchInventoryList,
  searchItemsInMemory,
  getBranchCountsheets,
  saveCountsheetLocal,
  subscribeToBranchCountsheets,
  ensureBranchInventoryHydrated,
  saveBranchMasterdata,
  countBranchInventoryBySource,
  applyMasterdataItemMutationLocal,
  syncMasterdataFromServerIfUpdated,
  GUEST_LOCAL_BRANCH_ID,
  saveGuestLocalIatdItems,
  clearGuestLocalIatdItems,
  getGuestLocalIatdItems,
} from '../services/db';
import {
  fetchMasterdataSheet,
  saveMasterdataItemAdmin,
  addMasterdataItemAdmin,
  deleteMasterdataItemAdmin,
  FIXED_MASTERDATA_SPREADSHEET_ID,
  fetchGuestIatdSheet,
  inspectIatdItemRow,
  updateIatdSheetCell,
} from '../services/googleSheets';
import { refreshGoogleAccessToken, isGoogleOAuthAccessToken } from '../services/auth';
import { verifyAdminPassword } from '../services/adminService';
import { useLanguage } from '../services/i18n';
import { NotifyWebsiteUpdateAvailable } from '../hooks/useAppUpdate';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

export function getItemMasterdataSheet(it: InventoryItem): string {
  const explicit = String(it.masterdataSheet || '').trim().toUpperCase();
  if (explicit) {
    if (explicit === 'OTHER' || explicit.includes('OTHER') || explicit === 'NONGRO') return 'OTHERS';
    if (explicit.startsWith('GRO')) return 'GRO';
    return explicit;
  }
  const code = String(it.itemCode || '').trim().toUpperCase();
  if (code.startsWith('GRO')) {
    return 'GRO';
  }
  return 'OTHERS';
}

type CopyFieldMode =
  | 'ALL'
  | 'ITEM_CODE'
  | 'ITEM_DESCRIPTION'
  | 'BARCODE';

interface ItemCopyControlProps {
  item: InventoryItem;
  onShowToast: (msg: string) => void;
}

const ItemCopyControl: React.FC<ItemCopyControlProps> = React.memo(({ item, onShowToast }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [copiedMode, setCopiedMode] = useState<CopyFieldMode | null>(null);
  const leaveTimerRef = React.useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) window.clearTimeout(leaveTimerRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (leaveTimerRef.current) window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      setIsHovered(false);
    }, 90);
  };

  const handleCopy = async (e: React.MouseEvent, copyMode: CopyFieldMode) => {
    e.stopPropagation();
    const itemCode = (item.itemCode || '').trim();
    const itemDescription = (item.itemDescription || '').trim();
    const barcode = (item.barcode || '').trim();

    // Copy sequence: Item Code, Item Description, Barcode
    let textToCopy = [itemCode, itemDescription, barcode].join('\t');
    let toastMessage = `Copied: ${itemCode || '—'} | ${itemDescription || '—'} | ${barcode || '—'}`;

    if (copyMode === 'ITEM_CODE') {
      textToCopy = itemCode;
      toastMessage = `Copied Item Code: ${itemCode || '—'}`;
    } else if (copyMode === 'ITEM_DESCRIPTION') {
      textToCopy = itemDescription;
      toastMessage = `Copied Item Description: ${itemDescription || '—'}`;
    } else if (copyMode === 'BARCODE') {
      textToCopy = barcode;
      toastMessage = `Copied Barcode: ${barcode || '—'}`;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        throw new Error('Fallback to execCommand');
      }
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {}
      document.body.removeChild(textarea);
    }

    setCopiedMode(copyMode);
    onShowToast(toastMessage);
    window.setTimeout(() => {
      setCopiedMode((prev) => (prev === copyMode ? null : prev));
    }, 2000);
  };

  const isAllCopied = copiedMode === 'ALL';
  const isCodeCopied = copiedMode === 'ITEM_CODE';
  const isDescCopied = copiedMode === 'ITEM_DESCRIPTION';
  const isBarcodeCopied = copiedMode === 'BARCODE';

  return (
    <div
      className="relative inline-flex items-center justify-end select-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Slide-out buttons emerging smoothly from the Copy logo button (right to left) */}
      <div
        className={`absolute right-full top-1/2 -translate-y-1/2 z-20 overflow-hidden py-1 pl-1 pr-1.5 ${
          isHovered ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
      >
        <div
          style={{
            transform: isHovered
              ? 'translate3d(0%, 0, 0) scale(1)'
              : 'translate3d(108%, 0, 0) scale(0.88)',
            opacity: isHovered ? 1 : 0,
            transformOrigin: 'right center',
            transition:
              'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="flex items-center gap-1 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs px-1 py-0.5 rounded-lg border border-slate-200/90 dark:border-slate-700/90 shadow-sm"
        >
          <button
            type="button"
            onClick={(e) => handleCopy(e, 'ITEM_CODE')}
            style={{
              transform: isHovered
                ? 'translate3d(0, 0, 0) scale(1)'
                : 'translate3d(14px, 0, 0) scale(0.9)',
              opacity: isHovered ? 1 : 0,
              transition:
                'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms ease-out, background-color 150ms ease, color 150ms ease, border-color 150ms ease',
              transitionDelay: isHovered ? '40ms' : '0ms',
            }}
            className={`px-1.5 py-0.5 rounded-md border text-[9.5px] leading-tight font-bold whitespace-nowrap cursor-pointer active:scale-95 inline-flex items-center gap-0.5 ${
              isCodeCopied
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700'
                : 'bg-slate-50 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
            title="Copy only Item Code"
          >
            {isCodeCopied && <Check className="w-2.5 h-2.5 shrink-0" />}
            <span>Item Code</span>
          </button>

          <button
            type="button"
            onClick={(e) => handleCopy(e, 'ITEM_DESCRIPTION')}
            style={{
              transform: isHovered
                ? 'translate3d(0, 0, 0) scale(1)'
                : 'translate3d(10px, 0, 0) scale(0.9)',
              opacity: isHovered ? 1 : 0,
              transition:
                'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms ease-out, background-color 150ms ease, color 150ms ease, border-color 150ms ease',
              transitionDelay: isHovered ? '20ms' : '15ms',
            }}
            className={`px-1.5 py-0.5 rounded-md border text-[9.5px] leading-tight font-bold whitespace-nowrap cursor-pointer active:scale-95 inline-flex items-center gap-0.5 ${
              isDescCopied
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700'
                : 'bg-slate-50 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
            title="Copy only Item Description"
          >
            {isDescCopied && <Check className="w-2.5 h-2.5 shrink-0" />}
            <span>Item Description</span>
          </button>

          <button
            type="button"
            onClick={(e) => handleCopy(e, 'BARCODE')}
            style={{
              transform: isHovered
                ? 'translate3d(0, 0, 0) scale(1)'
                : 'translate3d(6px, 0, 0) scale(0.9)',
              opacity: isHovered ? 1 : 0,
              transition:
                'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms ease-out, background-color 150ms ease, color 150ms ease, border-color 150ms ease',
              transitionDelay: isHovered ? '0ms' : '30ms',
            }}
            className={`px-1.5 py-0.5 rounded-md border text-[9.5px] leading-tight font-bold whitespace-nowrap cursor-pointer active:scale-95 inline-flex items-center gap-0.5 ${
              isBarcodeCopied
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700'
                : 'bg-slate-50 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
            title="Copy only Barcode"
          >
            {isBarcodeCopied && <Check className="w-2.5 h-2.5 shrink-0" />}
            <span>Barcode</span>
          </button>
        </div>
      </div>

      {/* Main Copy Logo Button (copies Item Code, Item Description, and Barcode) */}
      <button
        type="button"
        onClick={(e) => handleCopy(e, 'ALL')}
        className={`relative z-30 p-1.5 rounded-lg border transition-colors duration-150 cursor-pointer active:scale-95 inline-flex items-center justify-center shrink-0 ${
          isAllCopied
            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700'
            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700'
        }`}
        title="Copy Item Code, Item Description, and Barcode"
        aria-label="Copy Item Code, Item Description, and Barcode"
      >
        {isAllCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
});

interface InventoryViewProps {
  branch: SelectedBranch | null;
  userName: string | null;
  userEmail: string | null;
  accessToken?: string | null;
  isGoogleConnected?: boolean;
  onConnectGoogle?: () => void;
  onUpdateBranch?: (updatedBranch: SelectedBranch) => void;
  onTokenRefreshed?: (token: string) => void;
  onOpenBranchTab: () => void;
  onNavigateToCount: () => void;
  isAdminMode?: boolean;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  branch,
  userName,
  userEmail,
  accessToken,
  isGoogleConnected: isGoogleConnectedProp,
  onConnectGoogle,
  onUpdateBranch,
  onTokenRefreshed,
  onOpenBranchTab,
  onNavigateToCount,
  isAdminMode = false,
}) => {
  const { t } = useLanguage();
  const isGoogleConnected =
    isGoogleConnectedProp !== undefined
      ? isGoogleConnectedProp
      : isGoogleOAuthAccessToken(accessToken);
  const [activeTab, setActiveTab] = useState<'ENCODING' | 'MASTERDATA'>('MASTERDATA');
  const [masterdataSheetFilter, setMasterdataSheetFilter] = useState<string>('ALL');
  const [filterMode, setFilterMode] = useState<'ALL' | 'CATEGORY' | 'SUBCATEGORY' | 'SUBSUBCATEGORY'>('ALL');
  const [selectedFilterValue, setSelectedFilterValue] = useState<string>('');
  const [balanceFilter, setBalanceFilter] = useState<'ALL' | 'WITH_BALANCE' | 'ZERO'>('ALL');
  const [viewLayout, setViewLayout] = useState<'cards' | 'table'>('cards');
  const [keyword, setKeyword] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [allTabItems, setAllTabItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Quick count modal
  const [countingItem, setCountingItem] = useState<InventoryItem | null>(null);
  const [countQuantity, setCountQuantity] = useState<number>(1);
  const [itemCondition, setItemCondition] = useState<ItemCondition>('Good');
  const [targetCsNumber, setTargetCsNumber] = useState<number>(1);
  const [countsheets, setCountsheets] = useState<Countsheet[]>([]);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const [hydrationTick, setHydrationTick] = useState(0);
  const [isResyncingMasterdata, setIsResyncingMasterdata] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [localEncodingCount, setLocalEncodingCount] = useState<number>(
    branch?.encodingCount || 0
  );
  const [localMasterdataCount, setLocalMasterdataCount] = useState<number>(
    branch?.masterdataCount || 0
  );
  const [visibleCount, setVisibleCount] = useState<number>(60);
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null);
  const tableScrollRef = React.useRef<HTMLDivElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // Floating right-edge scrollbar indicator (appears smoothly from the right)
  const [showRightScrollIndicator, setShowRightScrollIndicator] = useState(false);
  const [scrollPercentage, setScrollPercentage] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      if (viewLayout === 'table' && tableScrollRef.current) {
        const el = tableScrollRef.current;
        const total = el.scrollHeight - el.clientHeight;
        if (total > 60) {
          setShowRightScrollIndicator(el.scrollTop > 30);
          setScrollPercentage(Math.round((el.scrollTop / total) * 100));
          return;
        }
      }
      const winScroll = window.scrollY || document.documentElement.scrollTop;
      const winHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (winHeight > 80) {
        setShowRightScrollIndicator(winScroll > 60);
        setScrollPercentage(Math.round((winScroll / winHeight) * 100));
      } else {
        setShowRightScrollIndicator(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    const tableEl = tableScrollRef.current;
    if (tableEl) {
      tableEl.addEventListener('scroll', handleScroll, { passive: true });
    }
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (tableEl) tableEl.removeEventListener('scroll', handleScroll);
    };
  }, [viewLayout, visibleCount]);

  const handleScrollToTop = () => {
    if (viewLayout === 'table' && tableScrollRef.current && tableScrollRef.current.scrollTop > 0) {
      tableScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleScrollToBottom = () => {
    if (viewLayout === 'table' && tableScrollRef.current) {
      tableScrollRef.current.scrollTo({ top: tableScrollRef.current.scrollHeight, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    }
  };

  // Count / Plot modal remarks state
  const [countRemarks, setCountRemarks] = useState<string>('');

  // Guest Local Google Sheet (IATD) state
  const [guestSheetUrl, setGuestSheetUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('guest_iatd_sheet_url') || '';
    } catch {
      return '';
    }
  });
  const [guestSpreadsheetId, setGuestSpreadsheetId] = useState<string>(() => {
    try {
      return localStorage.getItem('guest_iatd_sheet_id') || '';
    } catch {
      return '';
    }
  });
  const [guestLoadedAt, setGuestLoadedAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem('guest_iatd_loaded_at') || null;
    } catch {
      return null;
    }
  });
  const [isLoadingGuestSheet, setIsLoadingGuestSheet] = useState(false);
  const [guestSheetError, setGuestSheetError] = useState<string | null>(null);
  const [guestSheetSuccess, setGuestSheetSuccess] = useState<string | null>(null);
  const [isChangingSheetLink, setIsChangingSheetLink] = useState(false);

  // Scanned Row 2 CS columns (CS01 up to before Total Actual) and Remarks column metadata for IATD
  const [cachedIatdCsColumns, setCachedIatdCsColumns] = useState<IatdCsColumnMeta[]>(() => {
    try {
      const raw = localStorage.getItem('guest_iatd_cs_columns');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [cachedIatdRemarksCol, setCachedIatdRemarksCol] = useState<IatdRemarksColumnMeta | null>(() => {
    try {
      const raw = localStorage.getItem('guest_iatd_remarks_col');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // Admin Mode: Local IATD Single-Cell Qty & Remarks Plotter state
  const [plottingItem, setPlottingItem] = useState<InventoryItem | null>(null);
  const [renderedPlottingItem, setRenderedPlottingItem] = useState<InventoryItem | null>(null);
  useEffect(() => {
    if (plottingItem) setRenderedPlottingItem(plottingItem);
  }, [plottingItem]);
  const plotModalPresence = useAnimatedPresence(Boolean(isAdminMode && plottingItem), 200);
  const activePlottingItem = plottingItem || renderedPlottingItem;

  const [isInspectingIatdRow, setIsInspectingIatdRow] = useState(false);
  const [inspectIatdError, setInspectIatdError] = useState<string | null>(null);
  const [inspectedRowNumber, setInspectedRowNumber] = useState<number | null>(null);
  const [scannedCsColumns, setScannedCsColumns] = useState<IatdCsColumnMeta[]>([]);
  const [scannedRemarksCol, setScannedRemarksCol] = useState<IatdRemarksColumnMeta | null>(null);
  const [plotCsNumberInput, setPlotCsNumberInput] = useState<string>('01');
  const [selectedPlotColLetter, setSelectedPlotColLetter] = useState<string>('');
  const [plotQtyInput, setPlotQtyInput] = useState<string>('1');
  const [plotQtyMode, setPlotQtyMode] = useState<'set' | 'add' | 'skip'>('set');
  const [plotAllowOverwrite, setPlotAllowOverwrite] = useState<boolean>(false);
  const [plotRemarksInput, setPlotRemarksInput] = useState<string>('');
  const [plotRemarksMode, setPlotRemarksMode] = useState<'append' | 'replace' | 'skip'>('append');
  const [isSavingPlotCell, setIsSavingPlotCell] = useState(false);
  const [plotCellError, setPlotCellError] = useState<string | null>(null);

  const activeLocalSpreadsheetId = guestSpreadsheetId || branch?.id || '';

  const formatCsDigits = React.useCallback((num: number): string => {
    if (!Number.isFinite(num) || num <= 0) return '';
    return String(Math.floor(num)).padStart(2, '0');
  }, []);

  const formatCsCode = React.useCallback((num: number): string => {
    if (!Number.isFinite(num) || num <= 0) return '';
    return `CS${String(Math.floor(num)).padStart(2, '0')}`;
  }, []);

  const findCsColByNumber = React.useCallback(
    (numStr: string, cols: IatdCsColumnMeta[]): IatdCsColumnMeta | null => {
      const parsed = parseInt(String(numStr || '').replace(/[^0-9]/g, ''), 10);
      if (isNaN(parsed) || parsed <= 0) return null;
      const formattedLabel = `CS${String(parsed).padStart(2, '0')}`;
      return (
        cols.find(
          (c) =>
            c.csNumber === parsed ||
            c.label.toUpperCase().replace(/[^A-Z0-9]/g, '') === formattedLabel
        ) || null
      );
    },
    []
  );

  const openPlotIatdModal = async (item: InventoryItem) => {
    const sheetId = guestSpreadsheetId || branch?.id || '';
    if (!sheetId) {
      setGuestSheetError('Please load a Local Google Sheet (IATD) first.');
      return;
    }

    setPlottingItem(item);
    setInspectedRowNumber(item.sheetRowNumber || null);
    setPlotQtyInput('1');
    setPlotQtyMode('set');
    setPlotAllowOverwrite(false);
    setPlotRemarksInput('');
    setPlotRemarksMode('append');
    setPlotCellError(null);
    setInspectIatdError(null);

    // Pre-populate from cached Row 2 columns while live row inspection runs
    const initialCsCols = cachedIatdCsColumns.map((col) => ({
      ...col,
      label: formatCsCode(col.csNumber),
      cellA1: item.sheetRowNumber ? `${col.colLetter}${item.sheetRowNumber}` : undefined,
      existingValue: '',
    }));
    setScannedCsColumns(initialCsCols);
    const currentTypedNum = plotCsNumberInput.trim() || '01';
    const initialMatched = findCsColByNumber(currentTypedNum, initialCsCols) || initialCsCols[0];
    if (initialMatched) {
      setSelectedPlotColLetter(initialMatched.colLetter);
      const parsedCurrent = parseInt(plotCsNumberInput.replace(/[^0-9]/g, ''), 10);
      if (!plotCsNumberInput.trim() || isNaN(parsedCurrent) || parsedCurrent <= 0) {
        setPlotCsNumberInput(formatCsDigits(initialMatched.csNumber));
      } else {
        setPlotCsNumberInput(formatCsDigits(parsedCurrent));
      }
    }
    setScannedRemarksCol(
      cachedIatdRemarksCol
        ? {
            ...cachedIatdRemarksCol,
            cellA1: item.sheetRowNumber ? `${cachedIatdRemarksCol.colLetter}${item.sheetRowNumber}` : undefined,
            existingValue: item.remarks || '',
          }
        : null
    );

    // Live-inspect Row 2 (CS01 up to before Total Actual) and the item's exact row in the Google Sheet
    setIsInspectingIatdRow(true);
    try {
      const inspectRes = await inspectIatdItemRow({
        spreadsheetId: sheetId,
        rowNumber: item.sheetRowNumber,
        itemCode: item.itemCode,
        barcode: item.barcode,
        itemDescription: item.itemDescription,
        token: accessToken || undefined,
      });

      const normalizedCsColumns = (inspectRes.csColumns || []).map((col) => ({
        ...col,
        label: formatCsCode(col.csNumber),
      }));

      setInspectedRowNumber(inspectRes.rowNumber);
      setScannedCsColumns(normalizedCsColumns);
      setScannedRemarksCol(inspectRes.remarksColumn);

      if (normalizedCsColumns.length > 0) {
        try {
          localStorage.setItem('guest_iatd_cs_columns', JSON.stringify(normalizedCsColumns));
          setCachedIatdCsColumns(normalizedCsColumns);
        } catch {}

        const matchedFromInput = findCsColByNumber(plotCsNumberInput, normalizedCsColumns);
        if (matchedFromInput) {
          setSelectedPlotColLetter(matchedFromInput.colLetter);
          setPlotCsNumberInput(formatCsDigits(matchedFromInput.csNumber));
          const existing = (matchedFromInput.existingValue || '').trim();
          const hasVal = existing !== '' && existing !== '0' && existing !== '-';
          setPlotQtyMode(hasVal ? 'add' : 'set');
        } else {
          // Prefer the first CS column that is currently empty in this row, or CS01
          const firstEmpty =
            normalizedCsColumns.find(
              (c) => !c.existingValue || c.existingValue.trim() === '' || c.existingValue.trim() === '0'
            ) || normalizedCsColumns[0];
          setSelectedPlotColLetter(firstEmpty.colLetter);
          setPlotCsNumberInput(formatCsDigits(firstEmpty.csNumber));
          setPlotQtyMode('set');
        }
      }
      if (inspectRes.remarksColumn) {
        try {
          localStorage.setItem('guest_iatd_remarks_col', JSON.stringify(inspectRes.remarksColumn));
          setCachedIatdRemarksCol(inspectRes.remarksColumn);
        } catch {}
      }
    } catch (err: any) {
      console.warn('Could not live-inspect IATD row:', err);
      setInspectIatdError(err?.message || 'Could not inspect live row values from Google Sheet.');
    } finally {
      setIsInspectingIatdRow(false);
    }
  };

  const handleSavePlotIatdCell = async () => {
    if (!activePlottingItem) return;
    const sheetId = guestSpreadsheetId || branch?.id || '';
    if (!sheetId) {
      setPlotCellError('Spreadsheet ID is missing.');
      return;
    }

    const parsedCsNum = parseInt(String(plotCsNumberInput || '').replace(/[^0-9]/g, ''), 10);
    const formattedCsLabel =
      !isNaN(parsedCsNum) && parsedCsNum > 0
        ? formatCsCode(parsedCsNum)
        : '';

    const selectedCsMeta = findCsColByNumber(plotCsNumberInput, scannedCsColumns);

    const cleanQtyStr = String(plotQtyInput ?? '').trim();
    const cleanRemarksStr = String(plotRemarksInput ?? '').trim();
    const wantsQtyWrite = plotQtyMode !== 'skip' && cleanQtyStr !== '';
    const wantsRemarksWrite = plotRemarksMode !== 'skip' && cleanRemarksStr !== '';

    if (!wantsQtyWrite && !wantsRemarksWrite) {
      setPlotCellError('Please enter a Quantity to plot and/or Remarks to write.');
      return;
    }

    if (wantsQtyWrite && (isNaN(parsedCsNum) || parsedCsNum <= 0)) {
      setPlotCellError('Please type a valid Countsheet number (e.g. 6 for CS06).');
      return;
    }

    if (wantsQtyWrite && scannedCsColumns.length > 0 && !selectedCsMeta) {
      const minLabel = scannedCsColumns[0]?.label || 'CS01';
      const maxLabel = scannedCsColumns[scannedCsColumns.length - 1]?.label || '';
      setPlotCellError(
        `${formattedCsLabel} was not found in Row 2 before "Total Actual" (available: ${minLabel}${maxLabel ? ` to ${maxLabel}` : ''}).`
      );
      return;
    }

    const existingValInSelectedCs = (selectedCsMeta?.existingValue || '').trim();
    const hasExistingQtyInCell =
      existingValInSelectedCs !== '' && existingValInSelectedCs !== '0' && existingValInSelectedCs !== '-';

    if (wantsQtyWrite && hasExistingQtyInCell && plotQtyMode === 'set' && !plotAllowOverwrite) {
      setPlotCellError(
        `Cell ${selectedCsMeta?.colLetter}${inspectedRowNumber || ''} (${selectedCsMeta?.label || formattedCsLabel}) already has "${existingValInSelectedCs}" plotted. Please choose "Add to Existing" or "Overwrite Cell" to replace it.`
      );
      return;
    }

    setIsSavingPlotCell(true);
    setPlotCellError(null);

    try {
      let tokenToUse = accessToken || '';
      let resp;
      try {
        resp = await updateIatdSheetCell({
          spreadsheetId: sheetId,
          rowNumber: inspectedRowNumber || activePlottingItem.sheetRowNumber,
          itemCode: activePlottingItem.itemCode,
          barcode: activePlottingItem.barcode,
          itemDescription: activePlottingItem.itemDescription,
          csNumber: selectedCsMeta?.csNumber || parsedCsNum,
          csLabel: selectedCsMeta?.label || formattedCsLabel,
          targetColLetter: selectedCsMeta?.colLetter,
          qty: wantsQtyWrite ? cleanQtyStr : undefined,
          qtyMode: wantsQtyWrite ? plotQtyMode : 'skip',
          allowOverwrite: plotAllowOverwrite,
          remarks: wantsRemarksWrite ? cleanRemarksStr : undefined,
          remarksMode: wantsRemarksWrite ? plotRemarksMode : 'skip',
          token: tokenToUse || undefined,
        });
      } catch (firstErr: any) {
        if (firstErr?.status === 401 || firstErr?.status === 403) {
          const freshToken = await refreshGoogleAccessToken(userEmail || undefined);
          if (freshToken) {
            tokenToUse = freshToken;
            onTokenRefreshed?.(freshToken);
            resp = await updateIatdSheetCell({
              spreadsheetId: sheetId,
              rowNumber: inspectedRowNumber || activePlottingItem.sheetRowNumber,
              itemCode: activePlottingItem.itemCode,
              barcode: activePlottingItem.barcode,
              itemDescription: activePlottingItem.itemDescription,
              csNumber: selectedCsMeta?.csNumber || parsedCsNum,
              csLabel: selectedCsMeta?.label || formattedCsLabel,
              targetColLetter: selectedCsMeta?.colLetter,
              qty: wantsQtyWrite ? cleanQtyStr : undefined,
              qtyMode: wantsQtyWrite ? plotQtyMode : 'skip',
              allowOverwrite: plotAllowOverwrite,
              remarks: wantsRemarksWrite ? cleanRemarksStr : undefined,
              remarksMode: wantsRemarksWrite ? plotRemarksMode : 'skip',
              token: freshToken,
            });
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }

      // Update local state item's remarks & sheetRowNumber so UI reflects immediately without altering any other cells
      const nextItems = allTabItems.map((it) => {
        if (
          it.itemCode === activePlottingItem.itemCode &&
          it.barcode === activePlottingItem.barcode &&
          it.itemDescription === activePlottingItem.itemDescription
        ) {
          return {
            ...it,
            sheetRowNumber: resp.rowNumber || it.sheetRowNumber,
            remarks: resp.remarksUpdated ? resp.updatedRemarks : it.remarks,
          };
        }
        return it;
      });
      setAllTabItems(nextItems);
      if (guestSpreadsheetId) {
        await saveGuestLocalIatdItems(nextItems, guestSpreadsheetId);
      }

      const parts: string[] = [];
      if (resp.qtyUpdated) {
        parts.push(`Qty ${resp.updatedQty} → IATD!${resp.cellA1} (${resp.csLabel})`);
      }
      if (resp.remarksUpdated) {
        parts.push(`Remarks → IATD!${resp.remarksCellA1}`);
      }

      setSuccessToast(
        `Plotted ${parts.join(' & ')} for "${activePlottingItem.itemDescription}" (Row ${resp.rowNumber})!`
      );
      setTimeout(() => setSuccessToast(null), 5000);
      setPlottingItem(null);
    } catch (err: any) {
      console.error('Error plotting cell to IATD sheet:', err);
      setPlotCellError(err?.message || 'Failed to update target cell in Google Sheet.');
    } finally {
      setIsSavingPlotCell(false);
    }
  };

  const handleLoadGuestIatdSheet = async (targetUrl?: string) => {
    const urlToUse = (targetUrl !== undefined ? targetUrl : guestSheetUrl).trim();
    if (!urlToUse) {
      setGuestSheetError('Please enter a Google Sheet link or spreadsheet ID.');
      return;
    }

    setIsLoadingGuestSheet(true);
    setGuestSheetError(null);
    setGuestSheetSuccess(null);

    try {
      const result = await fetchGuestIatdSheet(urlToUse, accessToken || undefined);
      if (!result.items || result.items.length === 0) {
        throw new Error('No items found in the "IATD" tab. Please check that headers are on Row 2.');
      }

      await saveGuestLocalIatdItems(result.items, result.spreadsheetId);
      try {
        localStorage.setItem('guest_iatd_sheet_url', urlToUse);
        localStorage.setItem('guest_iatd_sheet_id', result.spreadsheetId);
        localStorage.setItem('guest_iatd_loaded_at', new Date().toISOString());
        localStorage.setItem('guest_iatd_item_count', String(result.items.length));
        localStorage.setItem('guest_iatd_parser_version', 'v5');
        if (result.csColumns && result.csColumns.length > 0) {
          localStorage.setItem('guest_iatd_cs_columns', JSON.stringify(result.csColumns));
          setCachedIatdCsColumns(result.csColumns);
        }
        if (result.remarksColumn) {
          localStorage.setItem('guest_iatd_remarks_col', JSON.stringify(result.remarksColumn));
          setCachedIatdRemarksCol(result.remarksColumn);
        }
      } catch {}

      setGuestSheetUrl(urlToUse);
      setGuestSpreadsheetId(result.spreadsheetId);
      setGuestLoadedAt(new Date().toISOString());
      setLocalEncodingCount(result.items.length);
      setAllTabItems(result.items);
      setIsChangingSheetLink(false);
      setGuestSheetSuccess(`Successfully loaded ${result.items.length.toLocaleString()} items from IATD tab!`);
      setHydrationTick((t) => t + 1);
      setTimeout(() => setGuestSheetSuccess(null), 5000);
    } catch (err: any) {
      console.error('Error loading guest IATD sheet:', err);
      setGuestSheetError(err?.message || 'Failed to load Google Sheet. Please check the link and sharing permissions.');
    } finally {
      setIsLoadingGuestSheet(false);
    }
  };

  const handleClearGuestIatdSheet = async () => {
    if (!window.confirm('Are you sure you want to clear loaded Local IATD items?')) return;
    try {
      await clearGuestLocalIatdItems();
      localStorage.removeItem('guest_iatd_sheet_url');
      localStorage.removeItem('guest_iatd_sheet_id');
      localStorage.removeItem('guest_iatd_loaded_at');
      localStorage.removeItem('guest_iatd_item_count');
      localStorage.removeItem('guest_iatd_parser_version');
      localStorage.removeItem('guest_iatd_cs_columns');
      localStorage.removeItem('guest_iatd_remarks_col');
      setGuestSheetUrl('');
      setGuestSpreadsheetId('');
      setGuestLoadedAt(null);
      setCachedIatdCsColumns([]);
      setCachedIatdRemarksCol(null);
      setLocalEncodingCount(0);
      setAllTabItems([]);
      setHydrationTick((t) => t + 1);
    } catch {}
  };

  // Auto-upgrade cached Local IATD sheet if loaded with an older parser version so Cost (Col F), Unit (Col H), Balance (Col L), and Row 2 CS columns appear immediately
  useEffect(() => {
    if (guestSheetUrl || guestSpreadsheetId) {
      try {
        const ver = localStorage.getItem('guest_iatd_parser_version');
        if (ver !== 'v5') {
          void handleLoadGuestIatdSheet(guestSheetUrl || guestSpreadsheetId);
        }
      } catch {}
    }
  }, [branch]);

  // Admin Mode Masterdata Editor state (GRO & OTHERS synced with Google Sheet)
  const [masterdataModalMode, setMasterdataModalMode] = useState<'EDIT' | 'ADD' | null>(null);
  const [editingOriginalItem, setEditingOriginalItem] = useState<InventoryItem | null>(null);
  const [masterdataForm, setMasterdataForm] = useState<{
    targetSheet: 'GRO' | 'OTHERS';
    itemCode: string;
    barcode: string;
    itemDescription: string;
    category: string;
    subCategory: string;
    subsubCategory: string;
  }>({
    targetSheet: 'GRO',
    itemCode: '',
    barcode: '',
    itemDescription: '',
    category: '',
    subCategory: '',
    subsubCategory: '',
  });
  const [isSavingMasterdataItem, setIsSavingMasterdataItem] = useState(false);
  const [masterdataModalError, setMasterdataModalError] = useState<string | null>(null);
  const [deletingItemKey, setDeletingItemKey] = useState<string | null>(null);
  const [isDeletePasswordOpen, setIsDeletePasswordOpen] = useState(false);
  const [deletePasswordInput, setDeletePasswordInput] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState<string | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<InventoryItem | null>(null);
  const toastTimerRef = React.useRef<number | null>(null);

  // Smooth exit presence for modals
  const [renderedCountingItem, setRenderedCountingItem] = useState<InventoryItem | null>(null);
  useEffect(() => {
    if (countingItem) setRenderedCountingItem(countingItem);
  }, [countingItem]);
  const countingModalPresence = useAnimatedPresence(Boolean(countingItem), 200);
  const activeCountingItem = countingItem || renderedCountingItem;

  const [renderedMasterdataMode, setRenderedMasterdataMode] = useState<'EDIT' | 'ADD' | null>(null);
  useEffect(() => {
    if (masterdataModalMode) setRenderedMasterdataMode(masterdataModalMode);
  }, [masterdataModalMode]);
  const masterdataModalPresence = useAnimatedPresence(Boolean(isAdminMode && masterdataModalMode), 200);
  const activeMasterdataModalMode = masterdataModalMode || renderedMasterdataMode;

  const [renderedPendingDeleteItem, setRenderedPendingDeleteItem] = useState<InventoryItem | null>(null);
  useEffect(() => {
    if (pendingDeleteItem) setRenderedPendingDeleteItem(pendingDeleteItem);
  }, [pendingDeleteItem]);
  const deleteConfirmModalPresence = useAnimatedPresence(Boolean(isAdminMode && pendingDeleteItem), 200);
  const activePendingDeleteItem = pendingDeleteItem || renderedPendingDeleteItem;

  const showCopyToast = React.useCallback((msg: string) => {
    setSuccessToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setSuccessToast(null);
    }, 3000);
  }, []);

  const renderItemCopyControl = (item: InventoryItem, _baseKey?: string) => (
    <ItemCopyControl item={item} onShowToast={showCopyToast} />
  );

  const handleCopyCategoryHierarchy = async (e: React.MouseEvent, item: InventoryItem) => {
    e.stopPropagation();
    const cat = (item.category || '').trim();
    const subCat = (item.subCategory || '').trim();
    const subSubCat = (item.subsubCategory || '').trim();
    const textToCopy = [cat, subCat, subSubCat].join('\t');
    const toastMessage = `Copied: ${cat || '—'} | ${subCat || '—'} | ${subSubCat || '—'}`;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        throw new Error('Fallback to execCommand');
      }
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {}
      document.body.removeChild(textarea);
    }

    showCopyToast(toastMessage);
  };

  const openEditMasterdataModal = (item: InventoryItem) => {
    const detectedSheet: 'GRO' | 'OTHERS' =
      (item.masterdataSheet || (item.itemCode?.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS')) === 'OTHERS'
        ? 'OTHERS'
        : 'GRO';
    setEditingOriginalItem(item);
    setMasterdataForm({
      targetSheet: detectedSheet,
      itemCode: item.itemCode || '',
      barcode: item.barcode || '',
      itemDescription: item.itemDescription || '',
      category: item.category || '',
      subCategory: item.subCategory || '',
      subsubCategory: item.subsubCategory || '',
    });
    setMasterdataModalError(null);
    setIsDeletePasswordOpen(false);
    setDeletePasswordInput('');
    setDeletePasswordError(null);
    setMasterdataModalMode('EDIT');
  };

  const openAddMasterdataModal = () => {
    const defaultSheet: 'GRO' | 'OTHERS' =
      masterdataSheetFilter === 'OTHERS' ? 'OTHERS' : 'GRO';
    setEditingOriginalItem(null);
    setMasterdataForm({
      targetSheet: defaultSheet,
      itemCode: '',
      barcode: '',
      itemDescription: '',
      category: '',
      subCategory: '',
      subsubCategory: '',
    });
    setMasterdataModalError(null);
    setIsDeletePasswordOpen(false);
    setDeletePasswordInput('');
    setDeletePasswordError(null);
    setMasterdataModalMode('ADD');
  };

  const requestDeleteMasterdataItem = (item: InventoryItem) => {
    setPendingDeleteItem(item);
    setDeletePasswordInput('');
    setDeletePasswordError(null);
  };

  const handleSaveMasterdataModal = async () => {
    if (!masterdataForm.itemCode.trim() && !masterdataForm.itemDescription.trim()) {
      setMasterdataModalError('Please enter at least an Item Code or Item Description.');
      return;
    }

    setIsSavingMasterdataItem(true);
    setMasterdataModalError(null);

    try {
      let tokenToUse = accessToken || '';
      if (masterdataModalMode === 'EDIT' && editingOriginalItem) {
        const originalSheet =
          (editingOriginalItem.masterdataSheet ||
            (editingOriginalItem.itemCode?.toUpperCase().startsWith('GRO') ? 'GRO' : 'OTHERS')) === 'OTHERS'
            ? 'OTHERS'
            : 'GRO';

        let resp = await saveMasterdataItemAdmin(tokenToUse, {
          originalItemCode: editingOriginalItem.itemCode,
          originalBarcode: editingOriginalItem.barcode,
          originalDescription: editingOriginalItem.itemDescription,
          originalSheet,
          itemCode: masterdataForm.itemCode.trim(),
          itemDescription: masterdataForm.itemDescription.trim(),
          category: masterdataForm.category.trim(),
          subCategory: masterdataForm.subCategory.trim(),
          subsubCategory: masterdataForm.subsubCategory.trim(),
          barcode: masterdataForm.barcode.trim(),
          targetSheet: masterdataForm.targetSheet,
        });

        // If Google Sheet write returned a warning due to expired token, refresh token and retry once
        if (!resp.sheetUpdated && resp.sheetWarning) {
          try {
            const freshToken = await refreshGoogleAccessToken(userEmail || undefined);
            if (freshToken) {
              tokenToUse = freshToken;
              onTokenRefreshed?.(freshToken);
              resp = await saveMasterdataItemAdmin(freshToken, {
                originalItemCode: editingOriginalItem.itemCode,
                originalBarcode: editingOriginalItem.barcode,
                originalDescription: editingOriginalItem.itemDescription,
                originalSheet,
                itemCode: masterdataForm.itemCode.trim(),
                itemDescription: masterdataForm.itemDescription.trim(),
                category: masterdataForm.category.trim(),
                subCategory: masterdataForm.subCategory.trim(),
                subsubCategory: masterdataForm.subsubCategory.trim(),
                barcode: masterdataForm.barcode.trim(),
                targetSheet: masterdataForm.targetSheet,
              });
            }
          } catch {}
        }

        const updatedInventoryItem: InventoryItem = {
          ...editingOriginalItem,
          itemCode: masterdataForm.itemCode.trim(),
          barcode: masterdataForm.barcode.trim(),
          itemDescription: masterdataForm.itemDescription.trim(),
          category: masterdataForm.category.trim(),
          subCategory: masterdataForm.subCategory.trim(),
          subsubCategory: masterdataForm.subsubCategory.trim(),
          source: 'MASTERDATA',
          masterdataSheet: masterdataForm.targetSheet,
        };

        const { items: nextItems, updatedBranch } = await applyMasterdataItemMutationLocal(branch, {
          type: 'update',
          originalItem: editingOriginalItem,
          updatedItem: updatedInventoryItem,
        });

        setLocalMasterdataCount(nextItems.length);
        if (updatedBranch) onUpdateBranch?.(updatedBranch);
        setHydrationTick((t) => t + 1);
        setMasterdataModalMode(null);
        setEditingOriginalItem(null);

        setSuccessToast(
          resp.sheetUpdated
            ? `Updated "${updatedInventoryItem.itemDescription || updatedInventoryItem.itemCode}" in Masterdata (${masterdataForm.targetSheet} Google Sheet${resp.updatedRange ? ` • ${resp.updatedRange}` : ''})!`
            : `Updated "${updatedInventoryItem.itemDescription || updatedInventoryItem.itemCode}" in Masterdata (${masterdataForm.targetSheet})!`
        );
        setTimeout(() => setSuccessToast(null), 4500);
      } else if (masterdataModalMode === 'ADD') {
        let resp = await addMasterdataItemAdmin(tokenToUse, {
          itemCode: masterdataForm.itemCode.trim(),
          itemDescription: masterdataForm.itemDescription.trim(),
          category: masterdataForm.category.trim(),
          subCategory: masterdataForm.subCategory.trim(),
          subsubCategory: masterdataForm.subsubCategory.trim(),
          barcode: masterdataForm.barcode.trim(),
          targetSheet: masterdataForm.targetSheet,
        });

        if (!resp.sheetUpdated && resp.sheetWarning) {
          try {
            const freshToken = await refreshGoogleAccessToken(userEmail || undefined);
            if (freshToken) {
              tokenToUse = freshToken;
              onTokenRefreshed?.(freshToken);
              resp = await addMasterdataItemAdmin(freshToken, {
                itemCode: masterdataForm.itemCode.trim(),
                itemDescription: masterdataForm.itemDescription.trim(),
                category: masterdataForm.category.trim(),
                subCategory: masterdataForm.subCategory.trim(),
                subsubCategory: masterdataForm.subsubCategory.trim(),
                barcode: masterdataForm.barcode.trim(),
                targetSheet: masterdataForm.targetSheet,
              });
            }
          } catch {}
        }

        const createdInventoryItem: InventoryItem = {
          itemCode: masterdataForm.itemCode.trim(),
          barcode: masterdataForm.barcode.trim(),
          itemDescription: masterdataForm.itemDescription.trim(),
          category: masterdataForm.category.trim(),
          subCategory: masterdataForm.subCategory.trim(),
          subsubCategory: masterdataForm.subsubCategory.trim(),
          cost: 0,
          selling: 0,
          unit: 'PCS',
          begQty: 0,
          in: 0,
          out: 0,
          balance: 0,
          amount: 0,
          gp: 0,
          source: 'MASTERDATA',
          masterdataSheet: masterdataForm.targetSheet,
        };

        const { items: nextItems, updatedBranch } = await applyMasterdataItemMutationLocal(branch, {
          type: 'add',
          newItem: createdInventoryItem,
        });

        setLocalMasterdataCount(nextItems.length);
        if (updatedBranch) onUpdateBranch?.(updatedBranch);
        setHydrationTick((t) => t + 1);
        setMasterdataModalMode(null);
        NotifyWebsiteUpdateAvailable();

        setSuccessToast(
          resp.sheetUpdated
            ? `Added "${createdInventoryItem.itemDescription || createdInventoryItem.itemCode}" to Masterdata (${masterdataForm.targetSheet} Google Sheet)!`
            : `Added "${createdInventoryItem.itemDescription || createdInventoryItem.itemCode}" to Masterdata (${masterdataForm.targetSheet})!`
        );
        setTimeout(() => setSuccessToast(null), 4500);
      }
    } catch (err: any) {
      setMasterdataModalError(err?.message || 'Failed to save Masterdata item.');
    } finally {
      setIsSavingMasterdataItem(false);
    }
  };

  const handleDeleteMasterdataItem = async (item: InventoryItem) => {
    const itemSheet = getItemMasterdataSheet(item);
    const key = `${itemSheet}_${item.itemCode}_${item.barcode}_${item.itemDescription}`;
    setDeletingItemKey(key);
    try {
      let tokenToUse = accessToken || '';
      let resp = await deleteMasterdataItemAdmin(tokenToUse, {
        itemCode: item.itemCode,
        barcode: item.barcode,
        itemDescription: item.itemDescription,
        sheet: itemSheet,
      });

      if (!resp.sheetUpdated && resp.sheetWarning) {
        try {
          const freshToken = await refreshGoogleAccessToken(userEmail || undefined);
          if (freshToken) {
            tokenToUse = freshToken;
            onTokenRefreshed?.(freshToken);
            resp = await deleteMasterdataItemAdmin(freshToken, {
              itemCode: item.itemCode,
              barcode: item.barcode,
              itemDescription: item.itemDescription,
              sheet: itemSheet,
            });
          }
        } catch {}
      }

      const { items: nextItems, updatedBranch } = await applyMasterdataItemMutationLocal(branch, {
        type: 'delete',
        targetItem: item,
      });

      setLocalMasterdataCount(nextItems.length);
      if (updatedBranch) onUpdateBranch?.(updatedBranch);
      setHydrationTick((t) => t + 1);
      if (editingOriginalItem && editingOriginalItem.itemCode === item.itemCode) {
        setIsDeletePasswordOpen(false);
        setDeletePasswordInput('');
        setDeletePasswordError(null);
        setMasterdataModalMode(null);
        setEditingOriginalItem(null);
      }
      setPendingDeleteItem(null);
      NotifyWebsiteUpdateAvailable();

      setSuccessToast(
        resp.sheetUpdated
          ? `Deleted "${item.itemDescription || item.itemCode}" from Masterdata (${itemSheet} Google Sheet).`
          : `Deleted "${item.itemDescription || item.itemCode}" from Masterdata (${itemSheet}).`
      );
      setTimeout(() => setSuccessToast(null), 4000);
    } catch (err: any) {
      setResyncError(err?.message || 'Failed to delete Masterdata item.');
    } finally {
      setDeletingItemKey(null);
    }
  };

  const handleConfirmDeleteWithPassword = async (e: React.FormEvent, itemToDelete: InventoryItem | null) => {
    e.preventDefault();
    if (!itemToDelete) return;
    setDeletePasswordError(null);

    if (!deletePasswordInput.trim()) {
      setDeletePasswordError('Admin password is required to delete an item.');
      return;
    }

    if (!verifyAdminPassword(deletePasswordInput)) {
      setDeletePasswordError('Invalid admin password. Please try again.');
      return;
    }

    await handleDeleteMasterdataItem(itemToDelete);
  };

  useEffect(() => {
    if (guestSpreadsheetId) {
      countBranchInventoryBySource(GUEST_LOCAL_BRANCH_ID, 'ENCODING').then((cnt) => {
        setLocalEncodingCount(cnt);
      });
    } else if (branch?.encodingCount !== undefined) {
      setLocalEncodingCount(branch.encodingCount);
    } else if (!branch) {
      countBranchInventoryBySource(GUEST_LOCAL_BRANCH_ID, 'ENCODING').then((cnt) => {
        setLocalEncodingCount(cnt);
      });
    }
    if (branch?.masterdataCount !== undefined && branch.masterdataCount > 0) {
      setLocalMasterdataCount(branch.masterdataCount);
    }
  }, [branch?.id, branch?.encodingCount, branch?.masterdataCount, guestSpreadsheetId]);

  // Resync Masterdata directly from Google Sheets or global server snapshot into IndexedDB (works in Guest Mode & Signed-In Mode)
  const isSilentResyncInFlightRef = React.useRef(false);
  const handleResyncMasterdata = async (options?: { silent?: boolean }) => {
    const isManualResync = !options?.silent;
    if (isResyncingMasterdata || (options?.silent && isSilentResyncInFlightRef.current)) return;
    if (isManualResync) {
      setIsResyncingMasterdata(true);
    } else {
      isSilentResyncInFlightRef.current = true;
    }
    setResyncError(null);
    const branchIdForFetch = branch?.id || 'global_masterdata';
    const useStrictOAuth = isManualResync && isGoogleConnected;

    try {
      let masterItems = await fetchMasterdataSheet(accessToken || '', branchIdForFetch, {
        forceRefresh: isManualResync,
        strict: useStrictOAuth,
      });

      // If strict resync returned 0 items and Google is connected, refresh Google token and retry once
      if (masterItems.length === 0 && useStrictOAuth) {
        const freshToken = await refreshGoogleAccessToken(userEmail || undefined);
        if (freshToken) {
          onTokenRefreshed?.(freshToken);
          masterItems = await fetchMasterdataSheet(freshToken, branchIdForFetch, {
            forceRefresh: true,
            strict: true,
          });
        }
      }

      if (masterItems.length > 0) {
        const updatedBranch = await saveBranchMasterdata(branch, masterItems);
        if (updatedBranch) {
          onUpdateBranch?.(updatedBranch);
        }
        setLocalMasterdataCount(masterItems.length);
        setHydrationTick((t) => t + 1);
        if (!options?.silent) {
          let groCount = 0;
          let othersCount = 0;
          for (let i = 0; i < masterItems.length; i++) {
            const s = getItemMasterdataSheet(masterItems[i]);
            if (s === 'OTHERS') othersCount++;
            else groCount++;
          }
          setSuccessToast(
            `Resynced ${masterItems.length.toLocaleString()} Masterdata items from Google Sheet (GRO: ${groCount.toLocaleString()} • OTHERS: ${othersCount.toLocaleString()}).`
          );
          setTimeout(() => setSuccessToast(null), 4000);
        }
      } else if (!options?.silent) {
        setResyncError('No Masterdata items found.');
      }
    } catch (err: any) {
      // Attempt interactive token refresh on auth error only when Google account is connected
      if (useStrictOAuth) {
        try {
          const freshToken = await refreshGoogleAccessToken(userEmail || undefined);
          if (freshToken) {
            onTokenRefreshed?.(freshToken);
            const retryItems = await fetchMasterdataSheet(freshToken, branchIdForFetch, {
              forceRefresh: true,
              strict: true,
            });
            if (retryItems.length > 0) {
              const updatedBranch = await saveBranchMasterdata(branch, retryItems);
              if (updatedBranch) {
                onUpdateBranch?.(updatedBranch);
              }
              setLocalMasterdataCount(retryItems.length);
              setHydrationTick((t) => t + 1);
              let groCount = 0;
              let othersCount = 0;
              for (let i = 0; i < retryItems.length; i++) {
                const s = getItemMasterdataSheet(retryItems[i]);
                if (s === 'OTHERS') othersCount++;
                else groCount++;
              }
              setSuccessToast(
                `Resynced ${retryItems.length.toLocaleString()} Masterdata items (GRO: ${groCount.toLocaleString()} • OTHERS: ${othersCount.toLocaleString()}) from Google Sheets.`
              );
              setTimeout(() => setSuccessToast(null), 4000);
              return;
            }
          }
        } catch (refreshErr: any) {
          setResyncError(refreshErr?.message || err?.message || 'Failed to resync Masterdata.');
          return;
        }
        setResyncError(err?.message || 'Failed to resync Masterdata.');
      } else if (!options?.silent) {
        setResyncError(err?.message || 'Failed to load Masterdata catalog.');
      }
    } finally {
      isSilentResyncInFlightRef.current = false;
      if (isManualResync) {
        setIsResyncingMasterdata(false);
      }
    }
  };

  // Load and subscribe to branch countsheets in real time across devices + ensure global Masterdata is always synced
  useEffect(() => {
    if (!branch) {
      countBranchInventoryBySource(GUEST_LOCAL_BRANCH_ID, 'ENCODING').then((guestEncCount) => {
        setLocalEncodingCount(guestEncCount);
      });
      countBranchInventoryBySource('global_masterdata', 'MASTERDATA').then((currentMastCount) => {
        if (currentMastCount > 0) {
          setLocalMasterdataCount(currentMastCount);
          if (currentMastCount < 70000) {
            handleResyncMasterdata({ silent: true });
          } else {
            void syncMasterdataFromServerIfUpdated(null).then((res) => {
              if (res.updated && res.count > 0) {
                setLocalMasterdataCount(res.count);
                setHydrationTick((t) => t + 1);
              }
            });
          }
        } else {
          handleResyncMasterdata({ silent: true });
        }
      });
      return;
    }
    ensureBranchInventoryHydrated(branch).then(async (hydrated) => {
      if (hydrated) setHydrationTick((t) => t + 1);
      const encodingSourceId = guestSpreadsheetId ? GUEST_LOCAL_BRANCH_ID : branch.id;
      const [currentEncCount, currentMastCount] = await Promise.all([
        countBranchInventoryBySource(encodingSourceId, 'ENCODING'),
        countBranchInventoryBySource(branch.id, 'MASTERDATA'),
      ]);
      setLocalEncodingCount(currentEncCount);
      if (currentMastCount > 0) {
        setLocalMasterdataCount(currentMastCount);
        if (currentMastCount < 70000) {
          // Upgrade Masterdata cache to include both GRO and OTHERS sheets
          handleResyncMasterdata({ silent: true });
        } else {
          const syncRes = await syncMasterdataFromServerIfUpdated(branch);
          if (syncRes.updated && syncRes.count > 0) {
            setLocalMasterdataCount(syncRes.count);
            if (syncRes.updatedBranch) {
              onUpdateBranch?.(syncRes.updatedBranch);
            }
            setHydrationTick((t) => t + 1);
          }
        }
      } else {
        // Automatically resync Masterdata when opening Inventory if Masterdata is empty
        handleResyncMasterdata({ silent: true });
      }
    });

    const unsubscribe = subscribeToBranchCountsheets(branch.id, (list) => {
      setCountsheets(list);
      if (list.length > 0) {
        setTargetCsNumber((prev) => (list.some((c) => c.cs === prev) ? prev : list[0].cs));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [branch?.id, userEmail]);

  // Periodically check if Masterdata item count or snapshot was updated on the server so all users stay in sync
  useEffect(() => {
    let cancelled = false;
    const checkServerMasterdataUpdate = async () => {
      if (cancelled || isResyncingMasterdata) return;
      const res = await syncMasterdataFromServerIfUpdated(branch);
      if (!cancelled && res.updated && res.count > 0) {
        setLocalMasterdataCount(res.count);
        if (res.updatedBranch) {
          onUpdateBranch?.(res.updatedBranch);
        }
        setHydrationTick((t) => t + 1);
      }
    };

    const intervalId = window.setInterval(checkServerMasterdataUpdate, 10000);
    const onFocus = () => {
      void checkServerMasterdataUpdate();
    };
    window.addEventListener('focus', onFocus);

    const onMasterdataUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{ count?: number }>;
      if (customEvent.detail?.count && typeof customEvent.detail.count === 'number') {
        setLocalMasterdataCount(customEvent.detail.count);
      }
      setHydrationTick((t) => t + 1);
    };
    window.addEventListener('masterdata-updated', onMasterdataUpdated);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('masterdata-updated', onMasterdataUpdated);
    };
  }, [branch, isResyncingMasterdata]);

  // Reset visible pagination count when tab, keyword, filter, layout, or branch changes
  useEffect(() => {
    setVisibleCount(60);
    if (tableScrollRef.current) {
      tableScrollRef.current.scrollTop = 0;
    }
  }, [branch?.id, activeTab, masterdataSheetFilter, keyword, filterMode, selectedFilterValue, viewLayout]);

  // Global Ctrl+F / Cmd+F shortcut to focus search input, and Tab key shortcut to toggle between Local and Masterdata tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (masterdataModalMode || countingItem || plottingItem) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
      } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        const activeType = (document.activeElement as HTMLInputElement)?.type?.toLowerCase();
        // Only toggle tab with Tab key if user is not currently typing inside an input or textarea
        if (activeTag !== 'input' && activeTag !== 'textarea' && activeTag !== 'select' && activeType !== 'text') {
          e.preventDefault();
          setActiveTab((prev) => (prev === 'ENCODING' ? 'MASTERDATA' : 'ENCODING'));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [masterdataModalMode, countingItem, plottingItem]);

  // Load all inventories for the active tab (only when tab, branch, linked local sheet, or hydration changes)
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    const effectiveBranchId =
      activeTab === 'ENCODING'
        ? guestSpreadsheetId
          ? GUEST_LOCAL_BRANCH_ID
          : branch?.id || GUEST_LOCAL_BRANCH_ID
        : branch?.id || 'global_masterdata';

    searchInventoryList(effectiveBranchId, activeTab, '', 0)
      .then((fullList) => {
        if (!isMounted) return;
        setAllTabItems(fullList);
        if (activeTab === 'MASTERDATA' && fullList.length > 0) {
          setLocalMasterdataCount(fullList.length);
          if (branch && branch.masterdataCount !== fullList.length) {
            saveBranchMasterdata(branch, fullList)
              .then((updated) => {
                if (updated) onUpdateBranch?.(updated);
              })
              .catch(() => {});
          }
        } else if (activeTab === 'ENCODING') {
          setLocalEncodingCount(fullList.length);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [branch?.id, guestSpreadsheetId, activeTab, hydrationTick]);

  // Compute sheet counts for Masterdata (GRO, OTHERS, and any custom sheets)
  const masterdataSheetCounts = React.useMemo(() => {
    if (activeTab !== 'MASTERDATA') return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (let i = 0; i < allTabItems.length; i++) {
      const it = allTabItems[i];
      const sheet = getItemMasterdataSheet(it);
      counts[sheet] = (counts[sheet] || 0) + 1;
    }
    return counts;
  }, [allTabItems, activeTab]);

  // Compute distinct options for Category, Subcategory, or SubSubCategory
  const filterValueOptions = React.useMemo(() => {
    if (filterMode === 'ALL') return [];
    const counts = new Map<string, number>();
    for (let i = 0; i < allTabItems.length; i++) {
      const it = allTabItems[i];
      if (activeTab === 'MASTERDATA' && masterdataSheetFilter !== 'ALL') {
        const sheet = getItemMasterdataSheet(it);
        if (sheet !== masterdataSheetFilter) continue;
      }
      const rawVal =
        filterMode === 'CATEGORY'
          ? it.category
          : filterMode === 'SUBCATEGORY'
          ? it.subCategory
          : it.subsubCategory;
      const val = (rawVal || '').trim();
      if (val) {
        counts.set(val, (counts.get(val) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }));
  }, [allTabItems, filterMode, activeTab, masterdataSheetFilter]);

  // Apply All Items / Category / Subcategory / SubSubCategory, Sheet, Balance, and Search filters synchronously in memory
  const filteredItems = React.useMemo(() => {
    const needSheetFilter = activeTab === 'MASTERDATA' && masterdataSheetFilter !== 'ALL';
    const needBalanceFilter = activeTab === 'ENCODING' && balanceFilter !== 'ALL';
    const needClassFilter = filterMode !== 'ALL' && Boolean(selectedFilterValue);

    let baseList = allTabItems;
    if (needSheetFilter || needBalanceFilter || needClassFilter) {
      baseList = allTabItems.filter((it) => {
        if (needSheetFilter) {
          const sheet = getItemMasterdataSheet(it);
          if (sheet !== masterdataSheetFilter) return false;
        }
        if (needBalanceFilter) {
          const bal = Number(it.balance || 0);
          if (balanceFilter === 'WITH_BALANCE' && bal <= 0) {
            return false;
          }
          if (balanceFilter === 'ZERO' && bal > 0) {
            return false;
          }
        }
        if (needClassFilter) {
          const fieldVal =
            (filterMode === 'CATEGORY'
              ? it.category
              : filterMode === 'SUBCATEGORY'
              ? it.subCategory
              : it.subsubCategory
            )?.trim() || '';
          if (fieldVal !== selectedFilterValue) {
            return false;
          }
        }
        return true;
      });
    }

    return searchItemsInMemory(baseList, keyword, 0);
  }, [
    allTabItems,
    activeTab,
    masterdataSheetFilter,
    filterMode,
    selectedFilterValue,
    balanceFilter,
    keyword,
  ]);

  // Infinite scroll observer to smoothly reveal inventory items only when user scrolls to the bottom
  useEffect(() => {
    if (isLoading || visibleCount >= filteredItems.length) return;
    const node = loadMoreRef.current;
    if (!node) return;

    const scrollRoot = viewLayout === 'table' ? tableScrollRef.current : null;
    if (viewLayout === 'table' && !scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setVisibleCount((prev) => Math.min(prev + 80, filteredItems.length));
      },
      {
        root: scrollRoot,
        rootMargin: '160px',
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isLoading, visibleCount, filteredItems.length, viewLayout]);

  // Add counted item to target countsheet
  const handleAddToCountsheet = async () => {
    if (!countingItem) return;
    const qty = Number(countQuantity);
    if (isNaN(qty) || qty <= 0) return;

    let targetCs: Countsheet | undefined = countsheets.find((cs) => cs.cs === targetCsNumber);
    if (!targetCs) {
      targetCs = {
        cs: targetCsNumber,
        name: `CS${String(targetCsNumber).padStart(2, '0')}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        auditorName: userName || 'Auditor',
        auditorEmail: userEmail || '',
        items: [],
        status: 'draft',
      };
    }

    if (targetCs.items.length >= 45) {
      alert(`Countsheet ${targetCs.name} is already full (45/45 items).`);
      return;
    }

    const newItem: CountsheetItem = {
      id: `${targetCs.cs}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      itemCode: countingItem.itemCode || '',
      barcode: countingItem.barcode || '',
      itemDescription: countingItem.itemDescription,
      category: countingItem.category || '',
      subCategory: countingItem.subCategory || '',
      subsubCategory: countingItem.subsubCategory || '',
      cost: countingItem.cost || 0,
      selling: countingItem.selling || 0,
      unit: countingItem.unit || 'PC',
      balance: countingItem.balance || 0,
      actualCount: qty,
      condition: itemCondition,
      cs: targetCs.cs,
      timestamp: Date.now(),
    };

    const updatedCs: Countsheet = {
      ...targetCs,
      items: [newItem, ...targetCs.items],
      updatedAt: new Date().toISOString(),
      status: 'draft',
    };

    if (branch) {
      await saveCountsheetLocal(branch.id, updatedCs);
    }

    // If guest mode with a loaded spreadsheet ID, also update the Google Sheet cell directly (e.g. T5)
    if (guestSpreadsheetId) {
      try {
        await updateIatdSheetCell({
          spreadsheetId: guestSpreadsheetId,
          itemCode: countingItem.itemCode,
          barcode: countingItem.barcode,
          itemDescription: countingItem.itemDescription,
          csNumber: targetCs.cs,
          qty,
          remarks: countRemarks,
          token: accessToken || undefined,
        });
      } catch (sheetErr: any) {
        console.error('Error writing qty to Google Sheet cell:', sheetErr);
        alert(`Saved locally, but failed to update Google Sheet cell: ${sheetErr?.message || sheetErr}`);
      }
    }

    setSuccessToast(
      `Added ${qty} ${countingItem.unit} of "${countingItem.itemDescription}" to ${targetCs.name}${
        guestSpreadsheetId ? ' (Synced to Google Sheet)' : ''
      }!`
    );
    setTimeout(() => setSuccessToast(null), 4000);

    setCountingItem(null);
    setCountRemarks('');

    if (branch) {
      const updatedList = await getBranchCountsheets(branch.id);
      setCountsheets(updatedList);
    }
  };

  const hasSearchQuery = keyword.trim().length > 0;
  const displayedItems = filteredItems.slice(0, visibleCount);

  return (
    <div className="w-full space-y-4 animate-slide-up-fade-in">
      <SEOHead
        title="Inventory Search & Catalog"
        description="Search branch local ENCODING inventory and store MASTERDATA offline by barcode, item code, or description."
        routePath="/inventory"
      />

      {/* Header Info */}
      <div className="flex items-center justify-between animate-slide-up-fade-in">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Package className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400" />
            <span>Inventory Masterdata</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {branch ? branch.name : 'Masterdata Catalog'} • Local IATD and Masterdata offline database
          </p>
        </div>
      </div>

      {/* Unified Toolbar: Tabs (Local vs Masterdata) + Filter Dropdown + Resync + Search Input */}
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-3 space-y-2.5 lg:space-y-0 lg:flex lg:items-center lg:justify-between lg:gap-3 transition-colors mt-2">
        <PanelDecoration position="top-left" tier="secondary" variant={2} />
        <PanelDecoration position="top-border" tier="major" variant={0} />
        <PanelDecoration position="top-right" tier="secondary" variant={1} />
        <PanelDecoration position="bottom-right" tier="playful" variant={3} />
        {/* Tabs: Local (ENCODING) vs Masterdata (MASTERDATA) + Filter Dropdown + Resync Masterdata button */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex p-1 bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 rounded-xl shrink-0">
            <button
              onClick={() => setActiveTab('ENCODING')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                activeTab === 'ENCODING'
                  ? 'bg-white dark:bg-slate-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {t.localTab} ({localEncodingCount.toLocaleString()})
            </button>

            <button
              onClick={() => setActiveTab('MASTERDATA')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                activeTab === 'MASTERDATA'
                  ? 'bg-white dark:bg-slate-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {t.masterdataTab} ({localMasterdataCount.toLocaleString()})
            </button>
          </div>

          {/* Direct GRO / OTHERS sheet switcher when inside Masterdata tab */}
          {activeTab === 'MASTERDATA' && (
            <div className="flex p-1 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/60 rounded-xl shrink-0 flex-wrap gap-1">
              {[
                {
                  id: 'ALL',
                  label: `${t.filterAll} (${allTabItems.length.toLocaleString()})`,
                },
                ...Object.keys(masterdataSheetCounts).map((sheetName) => ({
                  id: sheetName,
                  label: `${sheetName} (${(masterdataSheetCounts[sheetName] || 0).toLocaleString()})`,
                })),
              ].map((sOpt) => (
                <button
                  key={`top_${sOpt.id}`}
                  type="button"
                  onClick={() => {
                    setMasterdataSheetFilter(sOpt.id);
                    setSelectedFilterValue('');
                    if (sOpt.id === 'ALL') {
                      setFilterMode('ALL');
                    }
                  }}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                    masterdataSheetFilter === sOpt.id
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100/70 dark:hover:bg-indigo-900/40'
                  }`}
                >
                  {sOpt.label}
                </button>
              ))}
            </div>
          )}

          {/* Filter Dropdown between Masterdata and Resync: All Items, Category, Subcategory, SubSubCategory */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <CustomSelect
              value={filterMode}
              onChange={(val) => {
                const nextMode = val as 'ALL' | 'CATEGORY' | 'SUBCATEGORY' | 'SUBSUBCATEGORY';
                setFilterMode(nextMode);
                setSelectedFilterValue('');
                if (nextMode === 'ALL') {
                  setMasterdataSheetFilter('ALL');
                }
              }}
              ariaLabel="Filter items by classification"
              icon={<Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
              options={[
                { value: 'ALL', label: t.allItemsFilter, dotColor: 'bg-slate-400' },
                { value: 'CATEGORY', label: t.categoryFilter, dotColor: 'bg-blue-500' },
                { value: 'SUBCATEGORY', label: t.subcategoryFilter, dotColor: 'bg-indigo-500' },
                { value: 'SUBSUBCATEGORY', label: t.subSubCategoryFilter, dotColor: 'bg-emerald-500' },
              ]}
              menuMinWidth={190}
            />

            {filterMode !== 'ALL' && (
              <CustomSelect
                value={selectedFilterValue}
                onChange={(val) => setSelectedFilterValue(val)}
                ariaLabel={`Select ${filterMode.toLowerCase()}`}
                variant="accent"
                searchable={filterValueOptions.length > 5}
                searchPlaceholder={`Search ${
                  filterMode === 'CATEGORY'
                    ? 'category'
                    : filterMode === 'SUBCATEGORY'
                    ? 'subcategory'
                    : 'sub-subcategory'
                }...`}
                icon={<Tag className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                triggerClassName="max-w-[220px]"
                menuMinWidth={240}
                options={[
                  {
                    value: '',
                    label: `${t.filterAll} ${
                      filterMode === 'CATEGORY'
                        ? t.categoryFilter
                        : filterMode === 'SUBCATEGORY'
                        ? t.subcategoryFilter
                        : t.subSubCategoryFilter
                    }`,
                    badge: filterValueOptions.length,
                  },
                  ...filterValueOptions.map((opt) => ({
                    value: opt.value,
                    label: opt.value,
                    badge: opt.count.toLocaleString(),
                  })),
                ]}
              />
            )}
          </div>

          {activeTab === 'ENCODING' && (
            <button
              type="button"
              onClick={() => setIsChangingSheetLink((prev) => !prev)}
              title="Link or change Local Branch Google Sheet (IATD)"
              className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                isChangingSheetLink
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                  : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/80'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{guestSpreadsheetId || branch?.id ? 'Change Local Link' : 'Link Local Sheet'}</span>
            </button>
          )}

          {activeTab === 'MASTERDATA' && (
            <>
              <button
                type="button"
                onClick={() => handleResyncMasterdata({ silent: false })}
                disabled={isResyncingMasterdata}
                title="Resync Masterdata from Google Sheets"
                className="px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isResyncingMasterdata ? 'animate-spin' : ''}`} />
                <span>{isResyncingMasterdata ? t.resyncingMasterdataText : t.resyncMasterdataBtn}</span>
              </button>

              {isAdminMode && (
                <>
                  <button
                    type="button"
                    onClick={openAddMasterdataModal}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs active:scale-95 shrink-0"
                    title="Add a new item to GRO or OTHERS in Masterdata Google Sheet"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Item (GRO / OTHERS)</span>
                  </button>

                  <a
                    href={`https://docs.google.com/spreadsheets/d/${FIXED_MASTERDATA_SPREADSHEET_ID}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 text-xs font-bold flex items-center gap-1 transition shrink-0"
                    title="Open Masterdata Google Sheet (GRO & OTHERS)"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Sheet</span>
                  </a>
                </>
              )}
            </>
          )}
        </div>

        {/* Search Input with Instant Highlight feedback + Icon-Only Barcode Scanner */}
        <div className="flex items-center gap-1.5 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={`${t.searchInventoryPlaceholderPrefix} (Ctrl+F)`}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
                  e.preventDefault();
                  searchInputRef.current?.select();
                } else if (e.key === 'Escape') {
                  setKeyword('');
                }
              }}
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => {
                  setKeyword('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2.5 top-2 p-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer rounded-full"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white border border-slate-900 dark:border-zinc-700 flex items-center justify-center shrink-0 active:scale-95 transition cursor-pointer shadow-xs"
            title={`Scan barcode to search ${activeTab === 'ENCODING' ? t.localTab : t.masterdataTab}`}
            aria-label="Scan barcode"
          >
            <ScanBarcode className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Active Local IATD Sheet Banner (Available for everyone — both Logged-in & Guest mode) */}
      {activeTab === 'ENCODING' && (guestSpreadsheetId || branch?.id) && allTabItems.length > 0 && !isChangingSheetLink && (
        <div className="bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                  Local Sheet: IATD
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold">
                  {allTabItems.length.toLocaleString()} items loaded
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Headers on Row 2
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate max-w-md sm:max-w-lg mt-0.5 flex items-center gap-1 font-mono">
                <Link2 className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="truncate">
                  {guestSheetUrl || guestSpreadsheetId || (branch ? `${branch.name} (${branch.id})` : '')}
                </span>
                {(guestSpreadsheetId || branch?.id) && (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${guestSpreadsheetId || branch?.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-0.5 ml-1 font-sans text-[10.5px] font-medium"
                  >
                    <span>Open Sheet</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                handleLoadGuestIatdSheet(guestSheetUrl || guestSpreadsheetId || branch?.id || '')
              }
              disabled={isLoadingGuestSheet}
              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Re-fetch and reload items from IATD sheet"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGuestSheet ? 'animate-spin' : ''}`} />
              <span>{isLoadingGuestSheet ? 'Reloading...' : 'Refresh IATD'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsChangingSheetLink(true)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition cursor-pointer"
            >
              Change Link
            </button>
            {guestSpreadsheetId && (
              <button
                type="button"
                onClick={handleClearGuestIatdSheet}
                className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                title="Clear loaded Local sheet"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Link / Change Sheet Link Box (Available for everyone — both Logged-in & Guest mode) */}
      {activeTab === 'ENCODING' && isChangingSheetLink && (
        <div className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900/60 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Link / Change Google Sheet (IATD)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsChangingSheetLink(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Paste Google Sheet URL or Spreadsheet ID..."
              value={guestSheetUrl}
              onChange={(e) => setGuestSheetUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && guestSheetUrl.trim()) {
                  handleLoadGuestIatdSheet(guestSheetUrl);
                }
              }}
              className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleLoadGuestIatdSheet(guestSheetUrl)}
                disabled={isLoadingGuestSheet || !guestSheetUrl.trim()}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGuestSheet ? 'animate-spin' : ''}`} />
                <span>{isLoadingGuestSheet ? 'Loading...' : 'Load IATD Sheet'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsChangingSheetLink(false)}
                className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
          {guestSheetError && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{guestSheetError}</span>
            </div>
          )}
        </div>
      )}

      {/* Guest Mode: Success Notification Toast */}
      {guestSheetSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-3.5 py-2 rounded-xl text-xs flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-medium">{guestSheetSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setGuestSheetSuccess(null)}
            className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200 p-0.5 rounded cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Inventory Count, Balance Filter Pills (Local IATD only), & View Mode Toggle Bar */}
      {!isLoading && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            {hasSearchQuery ||
            filterMode !== 'ALL' ||
            (activeTab === 'ENCODING' && balanceFilter !== 'ALL') ||
            (activeTab === 'MASTERDATA' && masterdataSheetFilter !== 'ALL') ? (
              <span>
                Found{' '}
                <strong className="text-blue-600 dark:text-blue-400 font-bold font-mono">
                  {filteredItems.length.toLocaleString()}
                </strong>{' '}
                matching item{filteredItems.length === 1 ? '' : 's'}
                {activeTab === 'MASTERDATA' && masterdataSheetFilter !== 'ALL'
                  ? ` in ${masterdataSheetFilter} sheet`
                  : ''}
                {selectedFilterValue ? ` in "${selectedFilterValue}"` : ''}
                {hasSearchQuery ? ` for "${keyword.trim()}"` : ''}
              </span>
            ) : (
              <span>
                Showing{' '}
                <strong className="text-slate-700 dark:text-slate-200 font-bold font-mono">
                  {filteredItems.length.toLocaleString()}
                </strong>{' '}
                {activeTab === 'ENCODING' ? 'Local' : 'Masterdata (GRO & OTHERS)'} inventory item
                {filteredItems.length === 1 ? '' : 's'}
              </span>
            )}

            {(hasSearchQuery ||
              filterMode !== 'ALL' ||
              (activeTab === 'ENCODING' && balanceFilter !== 'ALL') ||
              (activeTab === 'MASTERDATA' && masterdataSheetFilter !== 'ALL')) && (
              <button
                onClick={() => {
                  setKeyword('');
                  setFilterMode('ALL');
                  setSelectedFilterValue('');
                  setBalanceFilter('ALL');
                  setMasterdataSheetFilter('ALL');
                }}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer text-xs"
              >
                {t.resetFiltersBtn}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Balance Filter Pills — Only for Local (IATD ENCODING) inventory */}
            {activeTab === 'ENCODING' && (
              <div className="inline-flex items-center p-0.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-semibold">
                {[
                  { id: 'ALL' as const, label: t.allBalancesBtn },
                  { id: 'WITH_BALANCE' as const, label: t.withBalanceBtn },
                  { id: 'ZERO' as const, label: t.zeroNegBtn },
                ].map((bOpt) => (
                  <button
                    key={bOpt.id}
                    type="button"
                    onClick={() => setBalanceFilter(bOpt.id)}
                    className={`px-2.5 py-1 rounded-lg transition cursor-pointer whitespace-nowrap ${
                      balanceFilter === bOpt.id
                        ? 'bg-blue-600 text-white font-bold shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {bOpt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Cards vs High-Density Table Toggle */}
            <div className="inline-flex items-center p-0.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => {
                  if (viewLayout !== 'cards') {
                    setVisibleCount(60);
                    React.startTransition(() => {
                      setViewLayout('cards');
                    });
                  }
                }}
                className={`px-2.5 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer ${
                  viewLayout === 'cards'
                    ? 'bg-slate-900 dark:bg-slate-800 text-white font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Card Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>{t.cardsViewBtn}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewLayout !== 'table') {
                    setVisibleCount(60);
                    React.startTransition(() => {
                      setViewLayout('table');
                    });
                  }
                }}
                className={`px-2.5 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer ${
                  viewLayout === 'table'
                    ? 'bg-slate-900 dark:bg-slate-800 text-white font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Template / Spreadsheet Table View"
              >
                <Table className="w-3.5 h-3.5" />
                <span>{activeTab === 'MASTERDATA' ? 'Template (Table)' : t.tableViewBtn}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {successToast && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Resync Error Notice */}
      {activeTab === 'MASTERDATA' && resyncError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center justify-between gap-2 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{resyncError}</span>
          </div>
          <button
            onClick={() => handleResyncMasterdata({ silent: false })}
            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold shrink-0 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Product Inventory Grid (All items by default, filtered on search) */}
      <div>
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-xs bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p>Loading {activeTab === 'ENCODING' ? 'Local' : 'Masterdata'} inventory...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-14 text-center text-slate-400 text-xs bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-1.5">
            <PanelDecoration position="empty-state" tier="secondary" variant={2} />
            {hasSearchQuery || filterMode !== 'ALL' ? (
              <>
                <p className="font-bold text-slate-700 dark:text-slate-300">
                  No products found matching your current filter{hasSearchQuery ? ` "${keyword}"` : ''}.
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Try selecting a different Category/Subcategory or switch between Local and Masterdata tabs.
                </p>
              </>
            ) : activeTab === 'ENCODING' ? (
              <div className="max-w-md mx-auto py-8 px-4 space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Load Local Branch Inventory (IATD)
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
                    Paste your Google Sheet link or spreadsheet ID below to load local inventory.
                  </p>
                </div>

                <div className="space-y-2 pt-1 text-left">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="https://docs.google.com/spreadsheets/d/.../edit or Spreadsheet ID"
                      value={guestSheetUrl}
                      onChange={(e) => setGuestSheetUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleLoadGuestIatdSheet(guestSheetUrl);
                        }
                      }}
                      className="w-full pl-3 pr-8 py-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition shadow-2xs font-mono"
                    />
                    {guestSheetUrl && (
                      <button
                        type="button"
                        onClick={() => setGuestSheetUrl('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                        title="Clear input"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {guestSheetError && (
                    <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{guestSheetError}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleLoadGuestIatdSheet(guestSheetUrl)}
                    disabled={isLoadingGuestSheet || !guestSheetUrl.trim()}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGuestSheet ? 'animate-spin' : ''}`} />
                    <span>{isLoadingGuestSheet ? 'Loading IATD Sheet...' : 'Load IATD Sheet'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-center border-t border-slate-100 dark:border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setActiveTab('MASTERDATA')}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                  >
                    View Masterdata ({localMasterdataCount.toLocaleString()})
                  </button>
                  {!isGoogleConnected && onConnectGoogle && (
                    <>
                      <span className="text-slate-300 dark:text-slate-700">•</span>
                      <button
                        type="button"
                        onClick={onConnectGoogle}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                      >
                        Connect Google Account
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                <p className="font-bold text-slate-700 dark:text-slate-300">
                  No Masterdata inventory items loaded yet.
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Click &quot;Resync Masterdata&quot; above to load the latest Masterdata catalog.
                </p>
              </>
            )}
          </div>
        ) : viewLayout === 'table' ? (
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-visible mt-2 select-text">
            <PanelDecoration position="top-left" tier="secondary" variant={1} />
            <PanelDecoration position="top-right" tier="playful" variant={3} />
            <div
              ref={tableScrollRef}
              className="inventory-scroll-stable overflow-x-auto max-h-[70vh] overflow-y-auto rounded-2xl select-text"
            >
              <table className="w-full min-w-[680px] text-left text-xs border-collapse select-text">
                <thead className="bg-slate-50 dark:bg-slate-800/90 sticky top-0 z-20 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">Item Code</th>
                    <th className="py-2.5 px-3 font-bold">Item Description</th>
                    <th className="py-2.5 px-3 font-bold text-center">Unit/UOM</th>
                    <th className="py-2.5 px-3 font-bold">Barcode</th>
                    <th className="py-2.5 px-3 font-bold">Category Hierarchy</th>
                    {activeTab !== 'MASTERDATA' && (
                      <>
                        <th className="py-2.5 px-3 font-bold text-right">Cost</th>
                        <th className="py-2.5 px-3 font-bold text-right">{t.bookBalanceLabel}</th>
                      </>
                    )}
                    <th className="py-2.5 px-3 font-bold text-right select-none">{t.actionLabel}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 select-text">
                  {displayedItems.map((item, idx) => (
                    <tr
                      key={`tbl_${item.itemCode}_${item.barcode}_${idx}`}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 select-text"
                    >
                      <td className="py-2 px-3 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap select-text cursor-text">
                        <div className="inline-flex items-center gap-1.5">
                          <span>
                            {hasSearchQuery ? (
                              <HighlightedText text={item.itemCode || '—'} highlight={keyword} />
                            ) : (
                              item.itemCode || '—'
                            )}
                          </span>
                          {activeTab === 'MASTERDATA' && item.itemCode?.trim() && (() => {
                            const itemCodePrefix = item.itemCode.trim().slice(0, 3).toUpperCase();
                            return (
                              <span
                                className={`text-[9.5px] font-bold font-mono px-1.5 py-0.2 rounded border select-none ${
                                  itemCodePrefix !== 'GRO'
                                    ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60'
                                    : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60'
                                }`}
                              >
                                {itemCodePrefix}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white max-w-xs select-text cursor-text break-words">
                        {hasSearchQuery ? (
                          <HighlightedText text={item.itemDescription} highlight={keyword} />
                        ) : (
                          item.itemDescription
                        )}
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300 select-text cursor-text whitespace-nowrap">
                        {item.unit || 'PCS'}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap select-text cursor-text">
                        <div className="flex items-center gap-1.5">
                          <Barcode className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                          <span>
                            {item.barcode ? (
                              hasSearchQuery ? (
                                <HighlightedText text={item.barcode} highlight={keyword} />
                              ) : (
                                item.barcode
                              )
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 italic font-sans font-normal text-[10px]">
                                —
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td
                        onClick={(e) => {
                          if (item.category || item.subCategory || item.subsubCategory) {
                            void handleCopyCategoryHierarchy(e, item);
                          }
                        }}
                        title={
                          item.category || item.subCategory || item.subsubCategory
                            ? `${[item.category, item.subCategory, item.subsubCategory].filter(Boolean).join(' › ')} (Click to copy)`
                            : undefined
                        }
                        className={`py-2 px-3 text-[10px] text-slate-500 dark:text-slate-400 max-w-[220px] select-text break-words ${
                          item.category || item.subCategory || item.subsubCategory
                            ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors'
                            : 'cursor-text'
                        }`}
                      >
                        {[item.category, item.subCategory, item.subsubCategory]
                          .filter(Boolean)
                          .join(' › ') || '—'}
                      </td>
                      {activeTab !== 'MASTERDATA' && (
                        <>
                          <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300 select-text cursor-text">
                            ₱{(item.cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-blue-600 dark:text-blue-400 select-text cursor-text">
                            {item.balance}
                          </td>
                        </>
                      )}
                      <td className="py-2 px-3 text-right select-none">
                        <div className="inline-flex items-center justify-end gap-1.5 select-none">
                          {renderItemCopyControl(
                            item,
                            `tbl_${item.itemCode}_${item.barcode}_${idx}`
                          )}
                          {isAdminMode && activeTab === 'ENCODING' && activeLocalSpreadsheetId && (
                            <button
                              type="button"
                              onClick={() => openPlotIatdModal(item)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] inline-flex items-center gap-1 active:scale-95 transition cursor-pointer shadow-2xs"
                              title="Plot Quantity & Remarks directly to this item's row in IATD Google Sheet"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Plot CS / Remarks</span>
                            </button>
                          )}
                          {isAdminMode && activeTab === 'MASTERDATA' && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditMasterdataModal(item)}
                                className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 text-amber-600 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/60 inline-flex items-center justify-center active:scale-95 transition cursor-pointer"
                                title="Edit item in Masterdata"
                                aria-label="Edit item in Masterdata"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={
                                  deletingItemKey ===
                                  `${getItemMasterdataSheet(item)}_${item.itemCode}_${item.barcode}_${item.itemDescription}`
                                }
                                onClick={() => requestDeleteMasterdataItem(item)}
                                className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-800/60 transition cursor-pointer disabled:opacity-50"
                                title="Delete this item from Masterdata (Requires Admin Password)"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                          {branch && (
                            <button
                              onClick={() => {
                                setCountingItem(item);
                                setCountQuantity(1);
                                setItemCondition('Good');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-bold text-[11px] inline-flex items-center gap-1 active:scale-95 transition cursor-pointer"
                              title={t.addToCountsheetModalBadge}
                            >
                              <Plus className="w-3 h-3" />
                              <span>{t.countBtn}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {visibleCount < filteredItems.length && (
                <div
                  ref={loadMoreRef}
                  className="py-4 px-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-col items-center gap-2 select-none"
                >
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => Math.min(prev + 120, filteredItems.length))}
                    className="px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 shadow-2xs transition cursor-pointer"
                  >
                    {t.showingWord} {displayedItems.length.toLocaleString()} / {filteredItems.length.toLocaleString()} {t.itemsWord} • {t.loadMoreBtn}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5 select-text">
              {displayedItems.map((item, idx) => (
                <div
                  key={`${item.itemCode}_${item.barcode}_${idx}`}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 flex flex-col justify-between gap-3 select-text"
                >
                  <div className="select-text">
                    <div className="flex items-center justify-between gap-1.5 flex-wrap select-text">
                      <div className="flex items-center gap-1.5 flex-wrap select-text">
                        <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200/60 dark:border-slate-700/60 select-text cursor-text">
                          {hasSearchQuery ? (
                            <HighlightedText text={item.itemCode || 'No Code'} highlight={keyword} />
                          ) : (
                            item.itemCode || 'No Code'
                          )}
                        </span>
                        {activeTab === 'MASTERDATA' && item.itemCode?.trim() && (() => {
                          const itemCodePrefix = item.itemCode.trim().slice(0, 3).toUpperCase();
                          return (
                            <span
                              className={`text-[9.5px] font-bold font-mono px-1.5 py-0.2 rounded border select-text cursor-text ${
                                itemCodePrefix !== 'GRO'
                                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60'
                                  : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60'
                              }`}
                            >
                              {itemCodePrefix}
                            </span>
                          );
                        })()}
                      </div>

                      {/* Category Hierarchy placed safely in top header away from description */}
                      {(item.category || item.subCategory || item.subsubCategory) && (
                        <div
                          onClick={(e) => void handleCopyCategoryHierarchy(e, item)}
                          className="text-[9.5px] text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 max-w-[165px] truncate select-text cursor-pointer text-right transition-colors active:opacity-75"
                          title={[item.category, item.subCategory, item.subsubCategory].filter(Boolean).join(' › ')}
                        >
                          {[item.category, item.subCategory, item.subsubCategory].filter(Boolean).join(' › ')}
                        </div>
                      )}
                    </div>

                    {/* Item Name / Description */}
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white mt-1.5 leading-snug select-text cursor-text break-words">
                      {hasSearchQuery ? (
                        <HighlightedText text={item.itemDescription} highlight={keyword} />
                      ) : (
                        item.itemDescription
                      )}
                    </h3>

                    {/* Barcode located directly under Item Description — ONLY Barcode here */}
                    <div className="mt-1 flex items-center gap-1.5 select-text cursor-text">
                      <Barcode className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                      <span className="text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 tracking-wider select-text cursor-text">
                        {item.barcode ? (
                          hasSearchQuery ? (
                            <HighlightedText text={item.barcode} highlight={keyword} />
                          ) : (
                            item.barcode
                          )
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 italic font-sans font-normal text-[10px]">
                            No Barcode
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="select-text cursor-text space-y-0.5 min-w-0">
                      {activeTab === 'MASTERDATA' ? (
                        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block font-mono select-text cursor-text">
                          {item.unit || 'PCS'}
                        </span>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                            <span className="font-bold text-slate-900 dark:text-white font-mono">
                              Bal: <strong className="text-blue-600 dark:text-blue-400">{item.balance}</strong> {item.unit || 'PCS'}
                            </span>
                            <span className="text-slate-400 dark:text-slate-600">•</span>
                            <span className="text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                              Cost: ₱{(item.cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            {isAdminMode && item.sheetRowNumber && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/70 dark:border-slate-700/70">
                                Row {item.sheetRowNumber}
                              </span>
                            )}
                          </div>
                          {item.remarks && (
                            <p className="text-[10.5px] text-amber-700 dark:text-amber-300 truncate max-w-[210px]" title={`Remarks: ${item.remarks}`}>
                              Remarks: {item.remarks}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 select-none">
                      {renderItemCopyControl(
                        item,
                        `card_${item.itemCode}_${item.barcode}_${idx}`
                      )}
                      {isAdminMode && activeTab === 'ENCODING' && activeLocalSpreadsheetId && (
                        <button
                          type="button"
                          onClick={() => openPlotIatdModal(item)}
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 active:scale-95 transition shrink-0 cursor-pointer shadow-xs"
                          title="Plot Quantity & Remarks directly to this item's row in IATD Google Sheet"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Plot CS</span>
                        </button>
                      )}
                      {isAdminMode && activeTab === 'MASTERDATA' && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditMasterdataModal(item)}
                            className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border border-amber-500/30 font-bold text-xs flex items-center gap-1 active:scale-95 transition cursor-pointer"
                            title="Edit this item in Masterdata (GRO / OTHERS Google Sheet)"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={
                              deletingItemKey ===
                              `${getItemMasterdataSheet(item)}_${item.itemCode}_${item.barcode}_${item.itemDescription}`
                            }
                            onClick={() => requestDeleteMasterdataItem(item)}
                            className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-800/60 transition cursor-pointer disabled:opacity-50"
                            title="Delete item from Masterdata (Requires Admin Password)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {branch && (
                        <button
                          onClick={() => {
                            setCountingItem(item);
                            setCountQuantity(1);
                            setItemCondition('Good');
                          }}
                          className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 active:scale-95 transition shrink-0 cursor-pointer shadow-xs"
                          title={t.addToCountsheetModalBadge}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{t.countBtn}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {visibleCount < filteredItems.length && (
              <div ref={loadMoreRef} className="py-6 flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => Math.min(prev + 120, filteredItems.length))}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 shadow-2xs transition cursor-pointer"
                >
                  {t.showingWord} {displayedItems.length.toLocaleString()} / {filteredItems.length.toLocaleString()} {t.itemsWord} • {t.loadMoreBtn}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add To Countsheet Modal */}
      {countingModalPresence.shouldRender && activeCountingItem && (() => {
        const countModalNode = (
          <div
            className={`fixed inset-0 w-screen h-screen h-[100dvh] z-[100] bg-black/60 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 ui-modal-backdrop ${
              countingModalPresence.isVisible ? 'ui-modal-open pointer-events-auto' : 'pointer-events-none'
            }`}
            onClick={() => setCountingItem(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 ui-modal-panel ${
                countingModalPresence.isVisible ? 'ui-modal-open' : ''
              }`}
            >
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                {t.addToCountsheetModalBadge}
              </span>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1.5 line-clamp-2">
                {activeCountingItem.itemDescription}
              </h3>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                {t.barcodeLabel}: {activeCountingItem.barcode || 'N/A'}
                {activeTab !== 'MASTERDATA'
                  ? ` • Bal: ${activeCountingItem.balance} ${activeCountingItem.unit}`
                  : ` • ${activeCountingItem.unit || 'PCS'}`}
              </p>
            </div>

            {/* Target Countsheet select */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t.targetCountsheetLabel}
              </label>
              <CustomSelect
                value={String(targetCsNumber)}
                onChange={(val) => setTargetCsNumber(parseInt(val, 10))}
                className="w-full"
                triggerClassName="py-2.5"
                options={countsheets.map((cs) => ({
                  value: String(cs.cs),
                  label: cs.name,
                  badge: `${cs.items.length}/45`,
                  dotColor: cs.status === 'submitted' ? 'bg-emerald-500' : 'bg-blue-500',
                }))}
              />
            </div>

            {/* Quantity Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {t.actualCountLabel} ({activeCountingItem.unit})
                </label>
                <div className="flex items-center gap-1">
                  {[5, 10].map((stepVal) => (
                    <button
                      key={stepVal}
                      type="button"
                      onClick={() => setCountQuantity((q) => Number(q || 0) + stepVal)}
                      className="px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[11px] font-mono font-bold transition active:scale-95 cursor-pointer"
                    >
                      +{stepVal}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCountQuantity((q) => Math.max(1, q - 1))}
                  className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold active:scale-95 transition cursor-pointer"
                >
                  -
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="any"
                  value={countQuantity}
                  onChange={(e) => setCountQuantity(parseFloat(e.target.value) || 0)}
                  className="flex-1 h-10 text-center font-mono font-bold text-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setCountQuantity((q) => q + 1)}
                  className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold active:scale-95 transition cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            {/* Remarks Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Remarks / Notes
              </label>
              <input
                type="text"
                placeholder="Optional remarks (e.g. damaged, recount)..."
                value={countRemarks}
                onChange={(e) => setCountRemarks(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Item Condition: Good (automatically chosen), Bad, Spoilage */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                {t.itemConditionLabel}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Good', 'Bad', 'Spoilage'] as const).map((cond) => {
                  const isSelected = itemCondition === cond;
                  const condLabel =
                    cond === 'Good'
                      ? t.conditionGood
                      : cond === 'Bad'
                      ? t.conditionBad
                      : t.conditionSpoilage;
                  return (
                    <button
                      key={cond}
                      type="button"
                      onClick={() => setItemCondition(cond)}
                      className={`py-2 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer active:scale-95 border ${
                        isSelected
                          ? cond === 'Good'
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                            : cond === 'Bad'
                            ? 'bg-amber-500 border-amber-500 text-white shadow-xs'
                            : 'bg-rose-600 border-rose-600 text-white shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {cond === 'Good' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                      {cond === 'Bad' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                      {cond === 'Spoilage' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                      <span className="truncate">{condLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setCountingItem(null)}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={handleAddToCountsheet}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition shadow-xs cursor-pointer active:scale-95"
              >
                {t.confirmAddBtn}
              </button>
            </div>
          </div>
          </div>
        );
        return typeof document !== 'undefined'
          ? createPortal(countModalNode, document.body)
          : countModalNode;
      })()}

      {/* Admin Mode: Local IATD Single-Cell Qty & Remarks Plotter Modal */}
      {plotModalPresence.shouldRender && activePlottingItem && (() => {
        const parsedCsNum = parseInt(String(plotCsNumberInput || '').replace(/[^0-9]/g, ''), 10);
        const formattedCsLabel =
          !isNaN(parsedCsNum) && parsedCsNum > 0
            ? formatCsCode(parsedCsNum)
            : '';

        const selectedCsCol = findCsColByNumber(plotCsNumberInput, scannedCsColumns);

        const rowNumDisplay = inspectedRowNumber || activePlottingItem.sheetRowNumber || null;
        const targetCsCellA1 =
          selectedCsCol && rowNumDisplay ? `${selectedCsCol.colLetter}${rowNumDisplay}` : '';
        const existingCsQty = (selectedCsCol?.existingValue || '').trim();
        const hasExistingCsQty =
          existingCsQty !== '' && existingCsQty !== '0' && existingCsQty !== '-';

        const targetRemarksCellA1 =
          scannedRemarksCol && rowNumDisplay
            ? `${scannedRemarksCol.colLetter}${rowNumDisplay}`
            : '';
        const existingRemarksText = (
          scannedRemarksCol?.existingValue ??
          activePlottingItem.remarks ??
          ''
        ).trim();

        const plottedCsInThisRow = scannedCsColumns.filter(
          (c) =>
            c.existingValue &&
            c.existingValue.trim() !== '' &&
            c.existingValue.trim() !== '0' &&
            c.existingValue.trim() !== '-'
        );

        const modalNode = (
          <div
            className={`fixed inset-0 w-screen h-screen h-[100dvh] z-[100] bg-black/60 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 ui-modal-backdrop ${
              plotModalPresence.isVisible ? 'ui-modal-open pointer-events-auto' : 'pointer-events-none'
            }`}
            onClick={() => {
              if (!isSavingPlotCell) setPlottingItem(null);
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full max-h-[88vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden ui-modal-panel ${
                plotModalPresence.isVisible ? 'ui-modal-open' : ''
              }`}
            >
              {/* Modal Header */}
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/90 flex items-start justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white break-words">
                      {activePlottingItem.itemDescription}
                    </h3>
                    {rowNumDisplay && (
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        Row {rowNumDisplay}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                    <span>{activePlottingItem.itemCode || 'N/A'}</span>
                    {activePlottingItem.barcode && (
                      <>
                        <span>•</span>
                        <span>{activePlottingItem.barcode}</span>
                      </>
                    )}
                    <span>•</span>
                    <span>
                      Bal: <strong className="text-blue-600 dark:text-blue-400">{activePlottingItem.balance}</strong> {activePlottingItem.unit || 'PCS'}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openPlotIatdModal(activePlottingItem)}
                    disabled={isInspectingIatdRow}
                    title="Refresh row data from sheet"
                    className="p-1.5 rounded-xl text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isInspectingIatdRow ? 'animate-spin text-blue-500' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => !isSavingPlotCell && setPlottingItem(null)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
                {/* Existing plotted CS badges in this row (if any) */}
                {plottedCsInThisRow.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Plotted:
                    </span>
                    {plottedCsInThisRow.map((c) => (
                      <button
                        key={c.colLetter}
                        type="button"
                        onClick={() => {
                          setPlotCsNumberInput(formatCsDigits(c.csNumber));
                          setSelectedPlotColLetter(c.colLetter);
                          setPlotAllowOverwrite(false);
                          setPlotQtyMode('add');
                        }}
                        className={`px-2 py-0.5 rounded-lg font-mono text-[11px] font-bold border transition cursor-pointer ${
                          selectedCsCol?.colLetter === c.colLetter
                            ? 'bg-amber-500 text-white border-amber-600'
                            : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                        }`}
                      >
                        {formatCsCode(c.csNumber)}: {c.existingValue}
                      </button>
                    ))}
                  </div>
                )}

                {/* Countsheet (CS) Number Input — Typed Numbers Only (01-99 for 2 digits, 100+ for 3 digits) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-bold text-slate-700 dark:text-slate-200">
                      Countsheet #
                    </label>
                    <div className="flex items-center gap-1.5">
                      {formattedCsLabel && (
                        <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                          {formattedCsLabel}
                        </span>
                      )}
                      {targetCsCellA1 && (
                        <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                          Cell {targetCsCellA1}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 font-mono font-bold text-sm text-slate-400 dark:text-slate-500 select-none pointer-events-none">
                      CS
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="01 to 99, 100..."
                      value={plotCsNumberInput}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
                        if (!digitsOnly) {
                          setPlotCsNumberInput('');
                          setSelectedPlotColLetter('');
                          setPlotAllowOverwrite(false);
                          setPlotCellError(null);
                          return;
                        }
                        const parsed = parseInt(digitsOnly.slice(-3), 10);
                        if (isNaN(parsed) || parsed <= 0) {
                          setPlotCsNumberInput('');
                          setSelectedPlotColLetter('');
                          setPlotAllowOverwrite(false);
                          setPlotCellError(null);
                          return;
                        }
                        const formattedDigits = formatCsDigits(parsed);
                        setPlotCsNumberInput(formattedDigits);
                        setPlotAllowOverwrite(false);
                        setPlotCellError(null);
                        const matched = findCsColByNumber(formattedDigits, scannedCsColumns);
                        if (matched) {
                          setSelectedPlotColLetter(matched.colLetter);
                          const existing = (matched.existingValue || '').trim();
                          const hasVal = existing !== '' && existing !== '0' && existing !== '-';
                          setPlotQtyMode(hasVal ? 'add' : 'set');
                        } else {
                          setSelectedPlotColLetter('');
                        }
                      }}
                      className="w-full h-10 pl-10 pr-24 font-mono font-bold text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    {formattedCsLabel && (
                      <span
                        className={`absolute right-3 font-mono text-[11px] font-bold px-2 py-0.5 rounded-md ${
                          !isInspectingIatdRow && scannedCsColumns.length > 0 && !selectedCsCol
                            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        → {formattedCsLabel}
                      </span>
                    )}
                  </div>

                  {!isInspectingIatdRow &&
                    scannedCsColumns.length > 0 &&
                    formattedCsLabel &&
                    !selectedCsCol && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 font-medium">
                        {formattedCsLabel} not found in Row 2 (available: {formatCsCode(scannedCsColumns[0]?.csNumber || 1)}–
                        {formatCsCode(scannedCsColumns[scannedCsColumns.length - 1]?.csNumber || 1)}).
                      </p>
                    )}
                </div>

                {/* Overwrite Protection if selected CS cell already has a quantity */}
                {hasExistingCsQty && (
                  <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 space-y-2">
                    <div className="flex items-center gap-1.5 text-amber-900 dark:text-amber-200 font-bold text-[11px]">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>
                        {selectedCsCol?.label} ({targetCsCellA1}) has qty:{' '}
                        <span className="font-mono underline">{existingCsQty}</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPlotQtyMode('add');
                          setPlotAllowOverwrite(false);
                        }}
                        className={`py-1.5 px-2 rounded-lg font-bold text-[11px] border transition cursor-pointer ${
                          plotQtyMode === 'add'
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Add (+{existingCsQty})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlotQtyMode('set');
                          setPlotAllowOverwrite(true);
                        }}
                        className={`py-1.5 px-2 rounded-lg font-bold text-[11px] border transition cursor-pointer ${
                          plotQtyMode === 'set' && plotAllowOverwrite
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Overwrite
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlotQtyMode('skip');
                          setPlotAllowOverwrite(false);
                        }}
                        className={`py-1.5 px-2 rounded-lg font-bold text-[11px] border transition cursor-pointer ${
                          plotQtyMode === 'skip'
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Skip Qty
                      </button>
                    </div>
                  </div>
                )}

                {/* Quantity Input */}
                {plotQtyMode !== 'skip' && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-bold text-slate-700 dark:text-slate-200">
                        Quantity ({activePlottingItem.unit || 'PCS'})
                      </label>
                      <div className="flex items-center gap-1">
                        {[1, 5, 10].map((stepVal) => (
                          <button
                            key={stepVal}
                            type="button"
                            onClick={() =>
                              setPlotQtyInput((prev) => String((parseFloat(prev || '0') || 0) + stepVal))
                            }
                            className="px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[11px] font-mono font-bold transition cursor-pointer"
                          >
                            +{stepVal}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setPlotQtyInput((prev) =>
                            String(Math.max(0, (parseFloat(prev || '0') || 0) - 1))
                          )
                        }
                        className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold active:scale-95 transition cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        placeholder="Qty"
                        value={plotQtyInput}
                        onChange={(e) => setPlotQtyInput(e.target.value)}
                        className="flex-1 h-10 text-center font-mono font-bold text-base bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setPlotQtyInput((prev) => String((parseFloat(prev || '0') || 0) + 1))
                        }
                        className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold active:scale-95 transition cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                {/* Remarks Section (Same Row as Item) */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-700 dark:text-slate-200">
                      Remarks {targetRemarksCellA1 ? `(${targetRemarksCellA1})` : ''}
                    </label>
                    {existingRemarksText && (
                      <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[10.5px]">
                        <button
                          type="button"
                          onClick={() => setPlotRemarksMode('append')}
                          className={`px-2 py-0.5 rounded-md font-bold cursor-pointer transition ${
                            plotRemarksMode === 'append'
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          Append
                        </button>
                        <button
                          type="button"
                          onClick={() => setPlotRemarksMode('replace')}
                          className={`px-2 py-0.5 rounded-md font-bold cursor-pointer transition ${
                            plotRemarksMode === 'replace'
                              ? 'bg-amber-600 text-white'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          Replace
                        </button>
                      </div>
                    )}
                  </div>

                  {existingRemarksText && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200 text-[11px] font-mono break-words">
                      Current: "{existingRemarksText}"
                    </div>
                  )}

                  <input
                    type="text"
                    placeholder="Enter remarks (optional)..."
                    value={plotRemarksInput}
                    onChange={(e) => setPlotRemarksInput(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {plotCellError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{plotCellError}</span>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/90 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isSavingPlotCell}
                  onClick={() => setPlottingItem(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingPlotCell || isInspectingIatdRow}
                  onClick={handleSavePlotIatdCell}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  {isSavingPlotCell ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        Plot {targetCsCellA1 ? `to ${targetCsCellA1}` : formattedCsLabel}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );

        return typeof document !== 'undefined'
          ? createPortal(modalNode, document.body)
          : modalNode;
      })()}

      {/* Admin Mode: Edit / Add Masterdata Item Modal (Syncs directly with GRO & OTHERS in Google Sheets) */}
      {masterdataModalPresence.shouldRender && activeMasterdataModalMode && (() => {
        const masterdataModalNode = (
          <div
            className={`fixed inset-0 w-screen h-screen h-[100dvh] z-[100] bg-black/60 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 ui-modal-backdrop ${
              masterdataModalPresence.isVisible ? 'ui-modal-open pointer-events-auto' : 'pointer-events-none'
            }`}
            onClick={() => {
              if (!isSavingMasterdataItem && !deletingItemKey) {
                setIsDeletePasswordOpen(false);
                setDeletePasswordInput('');
                setDeletePasswordError(null);
                setMasterdataModalMode(null);
                setEditingOriginalItem(null);
                setMasterdataModalError(null);
              }
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden ui-modal-panel ${
                masterdataModalPresence.isVisible ? 'ui-modal-open' : ''
              }`}
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/90 bg-slate-50/70 dark:bg-slate-900/90 flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                    activeMasterdataModalMode === 'EDIT'
                      ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border-amber-200/80 dark:border-amber-800/60'
                      : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border-indigo-200/80 dark:border-indigo-800/60'
                  }`}
                >
                  {activeMasterdataModalMode === 'EDIT' ? (
                    <Pencil className="w-4 h-4" />
                  ) : (
                    <Plus className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200/80 dark:border-indigo-800/70 inline-flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Masterdata Admin</span>
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                        masterdataForm.targetSheet === 'GRO'
                          ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/70'
                          : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/70'
                      }`}
                    >
                      {masterdataForm.targetSheet} Sheet
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1 truncate">
                    {activeMasterdataModalMode === 'EDIT'
                      ? 'Edit Masterdata Item'
                      : 'Add New Masterdata Item'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Updates Masterdata and syncs directly with the Google Sheet.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingMasterdataItem || Boolean(deletingItemKey)}
                onClick={() => {
                  setIsDeletePasswordOpen(false);
                  setDeletePasswordInput('');
                  setDeletePasswordError(null);
                  setMasterdataModalMode(null);
                  setEditingOriginalItem(null);
                  setMasterdataModalError(null);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {masterdataModalError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{masterdataModalError}</span>
                </div>
              )}

              {/* Target Sheet Selector: GRO vs OTHERS */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Target Masterdata Sheet
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                  {(['GRO', 'OTHERS'] as const).map((sheetTab) => {
                    const isSelected = masterdataForm.targetSheet === sheetTab;
                    return (
                      <button
                        key={sheetTab}
                        type="button"
                        onClick={() =>
                          setMasterdataForm((prev) => ({ ...prev, targetSheet: sheetTab }))
                        }
                        className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? sheetTab === 'GRO'
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'bg-amber-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Database className="w-3.5 h-3.5" />
                        <span>{sheetTab} Sheet</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Primary Item Details: Item Code & Barcode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                      Item Code
                    </label>
                    {masterdataForm.itemCode.trim() && (
                      <span
                        className={`text-[9.5px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                          masterdataForm.itemCode.trim().slice(0, 3).toUpperCase() !== 'GRO'
                            ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60'
                            : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60'
                        }`}
                      >
                        {masterdataForm.itemCode.trim().slice(0, 3).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Tag className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={masterdataForm.itemCode}
                      onChange={(e) =>
                        setMasterdataForm((prev) => ({ ...prev, itemCode: e.target.value }))
                      }
                      placeholder="e.g. GRO001456"
                      className="w-full pl-8 pr-3 py-2.5 text-xs font-mono font-bold bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Barcode
                  </label>
                  <div className="relative">
                    <Barcode className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={masterdataForm.barcode}
                      onChange={(e) =>
                        setMasterdataForm((prev) => ({ ...prev, barcode: e.target.value }))
                      }
                      placeholder="e.g. 4800016644801"
                      className="w-full pl-8 pr-3 py-2.5 text-xs font-mono font-semibold bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition"
                    />
                  </div>
                </div>
              </div>

              {/* Item Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  Item Description
                </label>
                <div className="relative">
                  <Package className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={masterdataForm.itemDescription}
                    onChange={(e) =>
                      setMasterdataForm((prev) => ({ ...prev, itemDescription: e.target.value }))
                    }
                    placeholder="Enter full item description"
                    className="w-full pl-8 pr-3 py-2.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition"
                  />
                </div>
              </div>

              {/* Category Hierarchy Card */}
              <div className="p-3.5 rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Category Hierarchy</span>
                  </span>
                  {(masterdataForm.category.trim() ||
                    masterdataForm.subCategory.trim() ||
                    masterdataForm.subsubCategory.trim()) && (
                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[230px]">
                      {[
                        masterdataForm.category.trim(),
                        masterdataForm.subCategory.trim(),
                        masterdataForm.subsubCategory.trim(),
                      ]
                        .filter(Boolean)
                        .join(' › ')}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Category
                    </label>
                    <input
                      type="text"
                      value={masterdataForm.category}
                      onChange={(e) =>
                        setMasterdataForm((prev) => ({ ...prev, category: e.target.value }))
                      }
                      placeholder="Category"
                      className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      SubCategory
                    </label>
                    <input
                      type="text"
                      value={masterdataForm.subCategory}
                      onChange={(e) =>
                        setMasterdataForm((prev) => ({ ...prev, subCategory: e.target.value }))
                      }
                      placeholder="SubCategory"
                      className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      SubSubCategory
                    </label>
                    <input
                      type="text"
                      value={masterdataForm.subsubCategory}
                      onChange={(e) =>
                        setMasterdataForm((prev) => ({ ...prev, subsubCategory: e.target.value }))
                      }
                      placeholder="SubSubCategory"
                      className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                    />
                  </div>
                </div>
              </div>

              {/* Admin Password Verification Box when Delete is clicked inside Edit Modal */}
              {activeMasterdataModalMode === 'EDIT' && editingOriginalItem && isDeletePasswordOpen && (
                <form
                  onSubmit={(e) => handleConfirmDeleteWithPassword(e, editingOriginalItem)}
                  className="p-3.5 rounded-2xl bg-rose-50/90 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-300 font-bold text-xs">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      <span>Admin Password Required to Delete Item</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDeletePasswordOpen(false);
                        setDeletePasswordInput('');
                        setDeletePasswordError(null);
                      }}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-[11px] text-rose-600/90 dark:text-rose-300/90">
                    Enter your admin password to permanently delete{' '}
                    <span className="font-bold">
                      {editingOriginalItem.itemDescription || editingOriginalItem.itemCode}
                    </span>{' '}
                    from Masterdata.
                  </p>
                  {deletePasswordError && (
                    <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{deletePasswordError}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Lock className="w-3.5 h-3.5 text-rose-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="password"
                        autoFocus
                        value={deletePasswordInput}
                        onChange={(e) => {
                          setDeletePasswordInput(e.target.value);
                          if (deletePasswordError) setDeletePasswordError(null);
                        }}
                        placeholder="Enter admin password..."
                        className="w-full pl-8 pr-3 py-2 text-xs bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={Boolean(deletingItemKey)}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                    >
                      {deletingItemKey ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Deleting...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Confirm Delete</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800/90 bg-slate-50/70 dark:bg-slate-900/90 flex items-center justify-between gap-2 shrink-0">
              {activeMasterdataModalMode === 'EDIT' && editingOriginalItem ? (
                <button
                  type="button"
                  disabled={isSavingMasterdataItem || Boolean(deletingItemKey)}
                  onClick={() => {
                    setIsDeletePasswordOpen((prev) => !prev);
                    setDeletePasswordInput('');
                    setDeletePasswordError(null);
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 ${
                    isDeletePasswordOpen
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'text-rose-600 dark:text-rose-400 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 border-rose-200/80 dark:border-rose-800/60'
                  }`}
                  title="Delete this item from Masterdata (Requires Admin Password)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSavingMasterdataItem || Boolean(deletingItemKey)}
                  onClick={() => {
                    setIsDeletePasswordOpen(false);
                    setDeletePasswordInput('');
                    setDeletePasswordError(null);
                    setMasterdataModalMode(null);
                    setEditingOriginalItem(null);
                    setMasterdataModalError(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t.cancelBtn}
                </button>
                <button
                  type="button"
                  disabled={isSavingMasterdataItem || Boolean(deletingItemKey)}
                  onClick={handleSaveMasterdataModal}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-xs cursor-pointer active:scale-95 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSavingMasterdataItem ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        {activeMasterdataModalMode === 'EDIT'
                          ? `Save Changes`
                          : `Add Item`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          </div>
        );
        return typeof document !== 'undefined'
          ? createPortal(masterdataModalNode, document.body)
          : masterdataModalNode;
      })()}

      {/* Admin Mode: Standalone Delete Confirmation Modal with Admin Password */}
      {deleteConfirmModalPresence.shouldRender && activePendingDeleteItem && (() => {
        const deleteModalNode = (
          <div
            className={`fixed inset-0 w-screen h-screen h-[100dvh] z-[100] bg-black/60 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 ui-modal-backdrop ${
              deleteConfirmModalPresence.isVisible ? 'ui-modal-open pointer-events-auto' : 'pointer-events-none'
            }`}
            onClick={() => {
              if (!deletingItemKey) {
                setPendingDeleteItem(null);
                setDeletePasswordInput('');
                setDeletePasswordError(null);
              }
            }}
          >
            <form
              onSubmit={(e) => handleConfirmDeleteWithPassword(e, activePendingDeleteItem)}
              onClick={(e) => e.stopPropagation()}
              className={`bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 ui-modal-panel ${
                deleteConfirmModalPresence.isVisible ? 'ui-modal-open' : ''
              }`}
            >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-800/60 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-md border border-rose-200/80 dark:border-rose-800/70">
                    Admin Verification
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                    Delete Masterdata Item
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                    {activePendingDeleteItem.itemCode
                      ? `${activePendingDeleteItem.itemCode} — `
                      : ''}
                    {activePendingDeleteItem.itemDescription}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={Boolean(deletingItemKey)}
                onClick={() => {
                  setPendingDeleteItem(null);
                  setDeletePasswordInput('');
                  setDeletePasswordError(null);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {deletePasswordError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{deletePasswordError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                Admin Password
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  autoFocus
                  value={deletePasswordInput}
                  onChange={(e) => {
                    setDeletePasswordInput(e.target.value);
                    if (deletePasswordError) setDeletePasswordError(null);
                  }}
                  placeholder="Enter admin password to confirm delete"
                  className="w-full pl-8 pr-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={Boolean(deletingItemKey)}
                onClick={() => {
                  setPendingDeleteItem(null);
                  setDeletePasswordInput('');
                  setDeletePasswordError(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                {t.cancelBtn}
              </button>
              <button
                type="submit"
                disabled={Boolean(deletingItemKey)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {deletingItemKey ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Item</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
        );
        return typeof document !== 'undefined'
          ? createPortal(deleteModalNode, document.body)
          : deleteModalNode;
      })()}

      {/* Barcode Scanner Modal for searching Local and Masterdata */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={(scannedCode) => {
          const cleanCode = (scannedCode || '').trim();
          setIsScannerOpen(false);
          if (cleanCode) {
            setFilterMode('ALL');
            setSelectedFilterValue('');
            setMasterdataSheetFilter('ALL');
            setBalanceFilter('ALL');
            setKeyword(cleanCode);
          }
        }}
      />

      {/* Floating Right-Edge Scroll Controller (appears smoothly from the right without adjusting window layout) */}
      {showRightScrollIndicator && (
        <div
          className="fixed right-2 sm:right-3.5 bottom-24 z-30 flex flex-col items-center gap-1 p-1 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-slate-200/90 dark:border-zinc-700/80 rounded-2xl shadow-xl transition-all duration-300 animate-in slide-in-from-right fade-in select-none group"
          title={`Scroll position: ${scrollPercentage}%`}
        >
          <button
            type="button"
            onClick={handleScrollToTop}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition cursor-pointer"
            title="Scroll to Top"
            aria-label="Scroll to top"
          >
            <ChevronUp className="w-4 h-4" />
          </button>

          {/* Mini vertical progress rail */}
          <div className="w-1.5 h-10 bg-slate-100 dark:bg-zinc-800 rounded-full relative overflow-hidden my-0.5">
            <div
              className="w-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-150 absolute top-0"
              style={{ height: `${Math.max(12, scrollPercentage)}%` }}
            />
          </div>

          <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-slate-300 px-0.5">
            {scrollPercentage}%
          </span>

          <button
            type="button"
            onClick={handleScrollToBottom}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition cursor-pointer"
            title="Scroll to Bottom"
            aria-label="Scroll to bottom"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
