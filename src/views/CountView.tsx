import React, { useState, useEffect } from 'react';
import {
  Camera,
  Search,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  Send,
  HelpCircle,
  Hash,
  ChevronDown,
  Layers,
  Sparkles,
  WifiOff,
  Check,
  Package,
  AlertCircle,
} from 'lucide-react';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { SEOHead } from '../components/SEOHead';
import { PanelDecoration } from '../components/PanelDecoration';
import { HighlightedText } from '../components/HighlightedText';
import { CustomSelect } from '../components/CustomSelect';
import {
  Countsheet,
  CountsheetItem,
  InventoryItem,
  SelectedBranch,
  ItemCondition,
} from '../types';
import {
  lookupInventoryBarcode,
  lookupInventoryItem,
  getBranchCountsheets,
  saveCountsheetLocal,
  deleteCountsheetLocal,
  subscribeToBranchCountsheets,
  ensureBranchInventoryHydrated,
} from '../services/db';
import { submitCountsheetToSheets } from '../services/googleSheets';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useLanguage } from '../services/i18n';

const MAX_ITEMS_PER_COUNTSHEET = 45;

interface CountViewProps {
  branch: SelectedBranch | null;
  userRole: 'owner' | 'encoder' | 'unassigned';
  isAdminMode?: boolean;
  userName: string | null;
  userEmail: string | null;
  accessToken: string | null;
  isGoogleConnected?: boolean;
  onConnectGoogle?: () => void;
  onOpenBranchTab: () => void;
  onCountItemTotalChange?: (total: number) => void;
}

export const CountView: React.FC<CountViewProps> = ({
  branch,
  userRole,
  isAdminMode = false,
  userName,
  userEmail,
  accessToken,
  isGoogleConnected = true,
  onConnectGoogle,
  onOpenBranchTab,
  onCountItemTotalChange,
}) => {
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();

  // Countsheets list for this branch
  const [countsheets, setCountsheets] = useState<Countsheet[]>([]);
  const [activeCsNumber, setActiveCsNumber] = useState<number>(1);

  // Scanner modal state
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Barcode input & lookup state
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);

  // Incomplete barcode candidates list
  const [candidateItems, setCandidateItems] = useState<InventoryItem[]>([]);
  const [candidateSearchTerm, setCandidateSearchTerm] = useState<string>('');

  // Active item draft state
  const [activeItem, setActiveItem] = useState<{
    itemCode: string;
    barcode: string;
    itemDescription: string;
    category: string;
    subCategory: string;
    subsubCategory: string;
    cost: number;
    selling: number;
    unit: string;
    balance: number;
    actualCount: number | '';
    condition: ItemCondition;
    isUnidentified: boolean;
    source?: 'ENCODING' | 'MASTERDATA' | 'MANUAL';
  } | null>(null);

  // Editing existing line item modal/drawer
  const [editingItem, setEditingItem] = useState<CountsheetItem | null>(null);
  const [editQty, setEditQty] = useState<number>(1);
  const [editCondition, setEditCondition] = useState<ItemCondition>('Good');

  // Delete CS confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Submit CS state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccessMsg, setSubmitSuccessMsg] = useState<string | null>(null);
  const [submitErrorMsg, setSubmitErrorMsg] = useState<string | null>(null);
  const [sheetSearchFilter, setSheetSearchFilter] = useState('');
  const [sheetStatusFilter, setSheetStatusFilter] = useState<'ALL' | 'VARIANCE' | 'MATCHED' | 'ISSUE'>('ALL');

  // Load countsheets from IndexedDB
  const refreshCountsheets = async (branchId: string, preferredCs?: number) => {
    const list = await getBranchCountsheets(branchId);
    if (list.length === 0) {
      // Create initial CS01
      const initialCs: Countsheet = {
        cs: 1,
        name: 'CS01',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        auditorName: userName || 'Auditor',
        auditorEmail: userEmail || '',
        items: [],
        status: 'draft',
      };
      await saveCountsheetLocal(branchId, initialCs);
      setCountsheets([initialCs]);
      setActiveCsNumber(1);
      return [initialCs];
    } else {
      setCountsheets(list);
      if (preferredCs && list.some((cs) => cs.cs === preferredCs)) {
        setActiveCsNumber(preferredCs);
      } else if (!list.some((cs) => cs.cs === activeCsNumber)) {
        setActiveCsNumber(list[0].cs);
      }
      return list;
    }
  };

  useEffect(() => {
    if (!branch) return;
    ensureBranchInventoryHydrated(branch).catch(() => {});
    refreshCountsheets(branch.id);

    const unsubscribe = subscribeToBranchCountsheets(branch.id, (list) => {
      if (list.length > 0) {
        setCountsheets(list);
        setActiveCsNumber((prevCs) =>
          list.some((cs) => cs.cs === prevCs) ? prevCs : list[0].cs
        );
      }
    });

    return () => {
      unsubscribe();
    };
  }, [branch?.id]);

  // Current active countsheet
  const currentCountsheet = countsheets.find((cs) => cs.cs === activeCsNumber) || null;

  // Update total items count badge
  useEffect(() => {
    if (currentCountsheet && onCountItemTotalChange) {
      onCountItemTotalChange(currentCountsheet.items.length);
    }
  }, [currentCountsheet?.items.length, onCountItemTotalChange]);

  const filteredSheetItems = React.useMemo(() => {
    if (!currentCountsheet) return [];
    const q = sheetSearchFilter.trim().toLowerCase();
    return currentCountsheet.items.filter((item) => {
      if (sheetStatusFilter === 'VARIANCE' && item.actualCount === (item.balance || 0)) {
        return false;
      }
      if (sheetStatusFilter === 'MATCHED' && item.actualCount !== (item.balance || 0)) {
        return false;
      }
      if (
        sheetStatusFilter === 'ISSUE' &&
        (!item.condition || item.condition === 'Good') &&
        !item.isUnidentified
      ) {
        return false;
      }
      if (!q) return true;
      return (
        (item.itemDescription && item.itemDescription.toLowerCase().includes(q)) ||
        (item.itemCode && item.itemCode.toLowerCase().includes(q)) ||
        (item.barcode && item.barcode.toLowerCase().includes(q))
      );
    });
  }, [currentCountsheet, sheetSearchFilter, sheetStatusFilter]);

  // Select item from candidates list
  const handleSelectCandidate = (item: InventoryItem) => {
    setActiveItem({
      itemCode: item.itemCode || '',
      barcode: item.barcode || '',
      itemDescription: item.itemDescription || '',
      category: item.category || '',
      subCategory: item.subCategory || '',
      subsubCategory: item.subsubCategory || '',
      cost: item.cost || 0,
      selling: item.selling || 0,
      unit: item.unit || 'PCS',
      balance: item.balance || 0,
      actualCount: 1,
      condition: 'Good',
      isUnidentified: false,
      source: item.source,
    });
    setBarcodeInput(item.barcode || item.itemCode || '');
    setCandidateItems([]);
    setCandidateSearchTerm('');
    setLookupMessage(`Selected from ${item.source}: ${item.itemDescription}`);
  };

  // Execute smart lookup in IndexedDB:
  // - Complete barcode -> selects exact item immediately (no picker)
  // - Incomplete barcode -> shows candidate items matching the last 3 or last 6 digits / suffix
  const performLookup = async (codeToSearch: string) => {
    if (!branch) return;
    const clean = codeToSearch.trim();
    if (!clean) return;

    setIsLookingUp(true);
    setLookupMessage(null);

    try {
      const result = await lookupInventoryBarcode(branch.id, clean);

      if (result.exactMatch) {
        // Complete barcode exact match: select directly without any selection dialog
        const found = result.exactMatch;
        setActiveItem({
          itemCode: found.itemCode || '',
          barcode: found.barcode || clean,
          itemDescription: found.itemDescription || '',
          category: found.category || '',
          subCategory: found.subCategory || '',
          subsubCategory: found.subsubCategory || '',
          cost: found.cost || 0,
          selling: found.selling || 0,
          unit: found.unit || 'PCS',
          balance: found.balance || 0,
          actualCount: 1,
          condition: 'Good',
          isUnidentified: false,
          source: found.source,
        });
        setCandidateItems([]);
        setCandidateSearchTerm('');
        setLookupMessage(`Found exact match in ${found.source}: ${found.itemDescription}`);
      } else if (result.matches.length === 1) {
        // Single matching item found by suffix or partial code -> select directly
        const found = result.matches[0];
        setActiveItem({
          itemCode: found.itemCode || '',
          barcode: found.barcode || clean,
          itemDescription: found.itemDescription || '',
          category: found.category || '',
          subCategory: found.subCategory || '',
          subsubCategory: found.subsubCategory || '',
          cost: found.cost || 0,
          selling: found.selling || 0,
          unit: found.unit || 'PCS',
          balance: found.balance || 0,
          actualCount: 1,
          condition: 'Good',
          isUnidentified: false,
          source: found.source,
        });
        setCandidateItems([]);
        setCandidateSearchTerm('');
        setLookupMessage(`Matched item in ${found.source}: ${found.itemDescription}`);
      } else if (result.matches.length > 1) {
        // Multiple items share this suffix/partial barcode -> show selection list
        setActiveItem(null);
        setCandidateItems(result.matches);
        setCandidateSearchTerm(clean);
        setLookupMessage(
          `Found ${result.matches.length} items with barcode ending with "${clean}". Please choose the item below:`
        );
      } else {
        // Not found in ENCODING or MASTERDATA -> Mark as Unidentified!
        setCandidateItems([]);
        setCandidateSearchTerm('');
        setActiveItem({
          itemCode: 'UNIDENTIFIED',
          barcode: clean,
          itemDescription: '',
          category: 'Unidentified',
          subCategory: '',
          subsubCategory: '',
          cost: 0,
          selling: 0,
          unit: 'PCS',
          balance: 0,
          actualCount: 1,
          condition: 'Good',
          isUnidentified: true,
          source: 'MANUAL',
        });
        setLookupMessage('Item not found in inventory. You can record it as an Unidentified Item.');
      }
    } catch (err: any) {
      console.error('Lookup failed:', err);
      setLookupMessage('Lookup error: ' + err.message);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (barcodeInput.trim()) {
      performLookup(barcodeInput.trim());
    }
  };

  const handleBarcodeScan = (scannedCode: string) => {
    setBarcodeInput(scannedCode);
    performLookup(scannedCode);
  };

  // Add Item to active Countsheet
  const handleAddItem = async () => {
    if (!branch || !currentCountsheet || !activeItem) return;

    if (currentCountsheet.items.length >= MAX_ITEMS_PER_COUNTSHEET) {
      alert(`Countsheet ${currentCountsheet.name} is full (${MAX_ITEMS_PER_COUNTSHEET}/${MAX_ITEMS_PER_COUNTSHEET} items). Please submit this countsheet or create a new one.`);
      return;
    }

    const countNum = Number(activeItem.actualCount);
    if (isNaN(countNum) || countNum <= 0) {
      alert('Please enter a valid actual count greater than 0.');
      return;
    }

    if (activeItem.isUnidentified && !activeItem.itemDescription.trim()) {
      alert('Please enter a description for the unidentified item.');
      return;
    }

    const newItem: CountsheetItem = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      itemCode: activeItem.itemCode,
      barcode: activeItem.barcode,
      itemDescription: activeItem.itemDescription,
      category: activeItem.category,
      subCategory: activeItem.subCategory,
      subsubCategory: activeItem.subsubCategory,
      cost: activeItem.cost,
      selling: activeItem.selling,
      unit: activeItem.unit || 'PCS',
      balance: activeItem.balance,
      actualCount: countNum,
      condition: activeItem.condition || 'Good',
      cs: currentCountsheet.cs,
      isUnidentified: activeItem.isUnidentified,
      timestamp: Date.now(),
    };

    const updatedItems = [newItem, ...currentCountsheet.items];
    const updatedCs: Countsheet = {
      ...currentCountsheet,
      items: updatedItems,
      updatedAt: new Date().toISOString(),
      status: 'draft',
    };

    await saveCountsheetLocal(branch.id, updatedCs);
    await refreshCountsheets(branch.id, currentCountsheet.cs);

    // Reset input
    setActiveItem(null);
    setCandidateItems([]);
    setCandidateSearchTerm('');
    setBarcodeInput('');
    setLookupMessage(null);
  };

  // Create new sequential countsheet
  const handleCreateCountsheet = async () => {
    if (!branch) return;
    const existingNumbers = new Set(countsheets.map((cs) => cs.cs));
    let nextCs = 1;
    while (existingNumbers.has(nextCs)) {
      nextCs++;
    }

    const newCs: Countsheet = {
      cs: nextCs,
      name: `CS${String(nextCs).padStart(2, '0')}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditorName: userName || 'Auditor',
      auditorEmail: userEmail || '',
      items: [],
      status: 'draft',
    };

    await saveCountsheetLocal(branch.id, newCs);
    await refreshCountsheets(branch.id, nextCs);
  };

  // Delete Countsheet (Owner or Admin Mode, removes local and calls server to delete from Google Sheets)
  const handleDeleteCountsheet = async () => {
    if (!branch || !currentCountsheet) return;
    if (userRole !== 'owner' && !isAdminMode) {
      alert('Only the branch Owner or Admin can delete a countsheet.');
      return;
    }

    setIsDeleting(true);
    try {
      // 1. If online and accessToken exists, call server delete endpoint
      if (isOnline && accessToken) {
        const res = await fetch('/api/sheets/delete-countsheet', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            spreadsheetId: branch.id,
            csNumber: currentCountsheet.cs,
            isAdminMode,
          }),
        });

        if (!res.ok) {
          const err: any = await res.json();
          throw new Error(err.error || 'Server error removing countsheet rows');
        }
      }

      // 2. Delete locally
      await deleteCountsheetLocal(branch.id, currentCountsheet.cs);
      setShowDeleteModal(false);
      await refreshCountsheets(branch.id);
    } catch (err: any) {
      console.error('Delete countsheet error:', err);
      alert(`Could not delete countsheet: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Remove individual item line
  const handleRemoveItem = async (itemId: string) => {
    if (!branch || !currentCountsheet) return;
    const updatedItems = currentCountsheet.items.filter((item) => item.id !== itemId);
    const updatedCs: Countsheet = {
      ...currentCountsheet,
      items: updatedItems,
      updatedAt: new Date().toISOString(),
    };
    await saveCountsheetLocal(branch.id, updatedCs);
    await refreshCountsheets(branch.id, currentCountsheet.cs);
  };

  // Save edited count quantity
  const handleSaveEditQty = async () => {
    if (!branch || !currentCountsheet || !editingItem) return;
    const num = Number(editQty);
    if (isNaN(num) || num <= 0) return;

    const updatedItems = currentCountsheet.items.map((item) =>
      item.id === editingItem.id ? { ...item, actualCount: num, condition: editCondition } : item
    );

    const updatedCs: Countsheet = {
      ...currentCountsheet,
      items: updatedItems,
      updatedAt: new Date().toISOString(),
    };

    await saveCountsheetLocal(branch.id, updatedCs);
    await refreshCountsheets(branch.id, currentCountsheet.cs);
    setEditingItem(null);
  };

  // Submit Countsheet to Google Sheets
  const handleSubmitCountsheet = async () => {
    setSubmitSuccessMsg(null);
    setSubmitErrorMsg(null);

    if (!branch || !currentCountsheet) return;

    if (currentCountsheet.items.length === 0) {
      setSubmitErrorMsg('Cannot submit an empty countsheet. Please add counted items first.');
      return;
    }

    if (!isOnline) {
      setSubmitErrorMsg('Offline: Your count is saved locally and can be submitted when you are online again.');
      return;
    }

    if (!accessToken) {
      setSubmitErrorMsg('Google Workspace authorization required to submit.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitCountsheetToSheets(
        accessToken,
        branch.id,
        currentCountsheet,
        userName || 'Auditor'
      );

      // Mark locally as submitted
      const submittedCs: Countsheet = {
        ...currentCountsheet,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
      };
      await saveCountsheetLocal(branch.id, submittedCs);
      await refreshCountsheets(branch.id, currentCountsheet.cs);

      setSubmitSuccessMsg(`Successfully submitted ${currentCountsheet.name} (${currentCountsheet.items.length} items) to Google Sheets!`);
    } catch (err: any) {
      console.error('Submit error:', err);
      setSubmitErrorMsg(`Submission failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!branch) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4 animate-fade-in-up">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${
          !isGoogleConnected
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
        }`}>
          {!isGoogleConnected ? <AlertCircle className="w-7 h-7" /> : <Layers className="w-7 h-7" />}
        </div>
        <PanelDecoration position="empty-state" tier="major" variant={0} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          {!isGoogleConnected ? 'Google Account Not Connected' : t.noBranchSelectedTitle}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
          {!isGoogleConnected
            ? 'Physical counting and countsheet submission require a connected Google account and an active branch spreadsheet.'
            : t.noBranchSelectedCountDesc}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {!isGoogleConnected && onConnectGoogle ? (
            <>
              <button
                type="button"
                onClick={onConnectGoogle}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs active:scale-95 transition shadow-sm cursor-pointer"
              >
                Connect Google Account
              </button>
              <button
                type="button"
                onClick={onOpenBranchTab}
                className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs active:scale-95 transition cursor-pointer"
              >
                {t.selectBranch}
              </button>
            </>
          ) : (
            <button
              onClick={onOpenBranchTab}
              className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white font-semibold text-xs active:scale-95 transition shadow-sm cursor-pointer"
            >
              {t.selectBranch}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!currentCountsheet) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center text-slate-500 dark:text-slate-400 text-xs animate-fade-in-up">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p>{t.loadingCountsheets}</p>
      </div>
    );
  }

  const itemCount = currentCountsheet.items.length;
  const isFull = itemCount >= MAX_ITEMS_PER_COUNTSHEET;

  return (
    <div className="w-full space-y-4 animate-slide-up-fade-in">
      <SEOHead
        title={`Count - ${currentCountsheet?.name || 'Inventory'}`}
        description="Physical inventory counting workflow with camera barcode scanner, 45-item limit, Google Sheets sync, and offline persistence."
        routePath="/count"
      />

      {/* Responsive layout: 2-column grid on desktop (lg+), stacked on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column on Desktop: CS selector, Scanner & Input, Active Item, Submit */}
        <div className="lg:col-span-5 xl:col-span-4 2xl:col-span-4 space-y-4">
          {/* 1. Countsheet Selector & Actions Row */}
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-3.5 transition-colors mt-2">
            <PanelDecoration position="top-left" tier="secondary" variant={2} />
            <PanelDecoration position="top-border" tier="playful" variant={3} />
            <div className="flex items-center justify-between gap-2 mb-2.5">
              {/* CS Selector Dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t.sheetLabel}</span>
                <CustomSelect
                  value={String(activeCsNumber)}
                  onChange={(val) => setActiveCsNumber(parseInt(val, 10))}
                  ariaLabel="Select active countsheet"
                  menuMinWidth={185}
                  triggerClassName="py-1.5 px-3 text-sm font-black"
                  options={countsheets.map((cs) => ({
                    value: String(cs.cs),
                    label: cs.name,
                    badge: `${cs.items.length}/${MAX_ITEMS_PER_COUNTSHEET}`,
                    dotColor: cs.status === 'submitted' ? 'bg-emerald-500' : 'bg-blue-500',
                  }))}
                />

                {currentCountsheet?.status === 'submitted' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    <Check className="w-3 h-3" /> {t.submittedBadge}
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                    {t.draftBadge}
                  </span>
                )}
              </div>

              {/* Action buttons: New CS & Delete CS (Owner or Admin Mode) */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCreateCountsheet}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-700 border border-slate-800 dark:border-slate-700 active:scale-95 transition cursor-pointer shadow-xs"
                  title="Create next sequential countsheet"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-400" />
                  <span>{t.newCsBtn}</span>
                </button>

                {/* Delete button: Visible to Owner or Admin Mode */}
                {(userRole === 'owner' || isAdminMode) && (
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="p-1.5 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 active:scale-95 transition cursor-pointer"
                    title="Delete this countsheet"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 45 Items Capacity Progress Bar */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                <span>{t.sheetCapacityLabel}</span>
                <span className={isFull ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}>
                  {itemCount} / {MAX_ITEMS_PER_COUNTSHEET} {t.itemsWord} {isFull && `(${t.fullWord})`}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    isFull
                      ? 'bg-rose-500'
                      : itemCount > 35
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, (itemCount / MAX_ITEMS_PER_COUNTSHEET) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* 2. Barcode Entry Row: Input + Camera Icon + Find Button */}
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-3.5 transition-colors">
            <PanelDecoration position="top-right" tier="major" variant={0} />
            <PanelDecoration position="top-left" tier="playful" variant={1} />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {t.scanOrLookupItem}
            </h4>
            <form onSubmit={handleBarcodeSubmit} className="flex items-center gap-1.5">
              {/* Barcode text input */}
              <div className="relative flex-1">
                <input
                  type="text"
                  inputMode="text"
                  placeholder={t.enterOrScanBarcodePlaceholder}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  className="w-full pl-3 pr-2 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>

              {/* Camera Icon Button immediately beside the input */}
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="w-11 h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white flex items-center justify-center shrink-0 active:scale-95 transition shadow-xs cursor-pointer border border-transparent dark:border-zinc-700"
                title="Scan barcode with camera"
              >
                <Camera className="w-5 h-5 stroke-[2.2]" />
              </button>

              {/* Find Button after camera button */}
              <button
                type="submit"
                disabled={!barcodeInput.trim() || isLookingUp}
                className="px-4 h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white text-xs font-bold shrink-0 flex items-center justify-center gap-1 active:scale-95 transition disabled:opacity-50 cursor-pointer border border-transparent dark:border-zinc-700"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{t.findBtn}</span>
              </button>
            </form>

            {lookupMessage && (
              <p
                className={`text-xs mt-2 px-1 ${
                  activeItem?.isUnidentified ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {lookupMessage}
              </p>
            )}
          </div>

          {/* 2.5 Incomplete Barcode Multiple Matches Candidate Picker */}
          {candidateItems.length > 0 && !activeItem && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-blue-400/90 dark:border-blue-500/90 shadow-md p-4 space-y-3 animate-in fade-in zoom-in-98 transition-colors">
              <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                      {t.matchingItemsFound} ({candidateItems.length})
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Barcodes ending with or containing <strong className="text-blue-600 dark:text-blue-400 font-mono">"{candidateSearchTerm}"</strong>. Tap an item to count:
                  </p>
                </div>
                <button
                  onClick={() => {
                    setCandidateItems([]);
                    setCandidateSearchTerm('');
                  }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 text-xs cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                  title="Dismiss list"
                >
                  ✕
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 pr-1 space-y-1.5">
                {candidateItems.map((item, idx) => (
                  <div
                    key={`${item.source}_${item.itemCode}_${item.barcode}_${idx}`}
                    onClick={() => handleSelectCandidate(item)}
                    className="p-2.5 rounded-xl hover:bg-blue-50/70 dark:hover:bg-blue-950/30 border border-slate-200/70 dark:border-slate-800 hover:border-blue-400/80 dark:hover:border-blue-500/80 transition cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                          {item.itemCode || 'No Code'}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-slate-800 dark:text-slate-200">
                          Barcode: <HighlightedText text={item.barcode || 'N/A'} highlight={candidateSearchTerm} />
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded uppercase bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                          {item.source}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 dark:text-white mt-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition leading-snug">
                        <HighlightedText text={item.itemDescription} highlight={candidateSearchTerm} />
                      </h4>

                      <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                        {item.category && <span>{item.category}</span>}
                        {item.category && <span>•</span>}
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          Bal: {item.balance} {item.unit}
                        </span>
                        {item.selling > 0 && <span>• ₱{item.selling.toFixed(2)}</span>}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectCandidate(item);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-bold text-xs flex items-center gap-1 shrink-0 active:scale-95 transition shadow-2xs group-hover:bg-blue-600 group-hover:text-white cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Select</span>
                    </button>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                <button
                  onClick={() => {
                    setCandidateItems([]);
                    setActiveItem({
                      itemCode: 'UNIDENTIFIED',
                      barcode: candidateSearchTerm || barcodeInput,
                      itemDescription: '',
                      category: 'Unidentified',
                      subCategory: '',
                      subsubCategory: '',
                      cost: 0,
                      selling: 0,
                      unit: 'PCS',
                      balance: 0,
                      actualCount: 1,
                      condition: 'Good',
                      isUnidentified: true,
                      source: 'MANUAL',
                    });
                  }}
                  className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                >
                  Not in this list? Record as Unidentified Item →
                </button>
              </div>
            </div>
          )}

          {/* 3. Item Details and Actual Count Field */}
          {activeItem && (
            <div
              className={`rounded-2xl border shadow-sm p-4 space-y-3 animate-in fade-in zoom-in-98 transition-colors ${
                activeItem.isUnidentified
                  ? 'border-blue-300 dark:border-blue-700/80 bg-blue-50/20 dark:bg-blue-950/20'
                  : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        activeItem.isUnidentified
                          ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {activeItem.isUnidentified ? t.unidentifiedItem : `${t.foundInPrefix} ${activeItem.source}`}
                    </span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{activeItem.barcode}</span>
                  </div>

                  {activeItem.isUnidentified ? (
                    <div className="mt-2">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        {t.enterItemDescriptionLabel}
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Unknown Brand Soda Can 330ml"
                        value={activeItem.itemDescription}
                        onChange={(e) =>
                          setActiveItem({ ...activeItem, itemDescription: e.target.value })
                        }
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ) : (
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                      {activeItem.itemDescription}
                    </h4>
                  )}
                </div>

                <button
                  onClick={() => setActiveItem(null)}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Details Grid */}
              {!activeItem.isUnidentified && (
                <div className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-800/80 rounded-xl p-2.5 text-[11px] border border-slate-100 dark:border-slate-700/80">
                  <div>
                    <span className="text-slate-400 dark:text-slate-400 block">{t.itemCodeLabel}</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate block">
                      {activeItem.itemCode}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-slate-400 block">{t.categoryLabel}</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                      {activeItem.category || 'General'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-slate-400 block">{t.bookBalanceLabel}</span>
                    <span className="font-bold text-slate-900 dark:text-white block">
                      {activeItem.balance} {activeItem.unit}
                    </span>
                  </div>
                </div>
              )}

              {/* Actual Count Entry Field */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t.actualCountLabel} ({activeItem.unit || 'PCS'})
                  </label>
                  <div className="flex items-center gap-1">
                    {[5, 10].map((stepVal) => (
                      <button
                        key={stepVal}
                        type="button"
                        onClick={() =>
                          setActiveItem({
                            ...activeItem,
                            actualCount: Number(activeItem.actualCount || 0) + stepVal,
                          })
                        }
                        className="px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[11px] font-mono font-bold transition active:scale-95 cursor-pointer"
                      >
                        +{stepVal}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Stepper down */}
                  <button
                    type="button"
                    onClick={() =>
                      setActiveItem({
                        ...activeItem,
                        actualCount: Math.max(1, Number(activeItem.actualCount || 1) - 1),
                      })
                    }
                    className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-black text-lg flex items-center justify-center active:scale-95 transition cursor-pointer border border-slate-200 dark:border-slate-700"
                  >
                    -
                  </button>

                  {/* Number Input */}
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="any"
                    value={activeItem.actualCount}
                    onChange={(e) =>
                      setActiveItem({
                        ...activeItem,
                        actualCount: e.target.value === '' ? '' : parseFloat(e.target.value),
                      })
                    }
                    className="flex-1 h-12 text-center text-xl font-bold font-mono bg-slate-50 dark:bg-slate-800 border-2 border-blue-500 dark:border-blue-400 rounded-xl text-slate-950 dark:text-white focus:outline-none focus:bg-white dark:focus:bg-slate-900"
                  />

                  {/* Stepper up */}
                  <button
                    type="button"
                    onClick={() =>
                      setActiveItem({
                        ...activeItem,
                        actualCount: Number(activeItem.actualCount || 0) + 1,
                      })
                    }
                    className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-black text-lg flex items-center justify-center active:scale-95 transition cursor-pointer border border-slate-200 dark:border-slate-700"
                  >
                    +
                  </button>
                </div>

                {/* Item Condition Selector: Good (automatically chosen), Bad, Spoilage */}
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    {t.itemConditionLabel}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['Good', 'Bad', 'Spoilage'] as const).map((cond) => {
                      const isSelected = (activeItem.condition || 'Good') === cond;
                      const condLabel = cond === 'Good' ? t.conditionGood : cond === 'Bad' ? t.conditionBad : t.conditionSpoilage;
                      return (
                        <button
                          key={cond}
                          type="button"
                          onClick={() =>
                            setActiveItem({
                              ...activeItem,
                              condition: cond,
                            })
                          }
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
                          {cond === 'Good' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {cond === 'Bad' && <AlertCircle className="w-3.5 h-3.5" />}
                          {cond === 'Spoilage' && <AlertCircle className="w-3.5 h-3.5" />}
                          <span>{condLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 4. Add Item Button */}
              <button
                type="button"
                onClick={handleAddItem}
                disabled={isFull}
                className="w-full py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-98 transition shadow-xs disabled:opacity-50 cursor-pointer border border-transparent dark:border-zinc-700"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>{t.addToPrefix} {currentCountsheet.name}</span>
              </button>
            </div>
          )}

          {/* 6. Submit Actions (Placed in Left Column for Easy Accessibility) */}
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-3.5 space-y-2 transition-colors">
            <PanelDecoration position="bottom-left" tier="secondary" variant={2} />
            <PanelDecoration position="bottom-right" tier="playful" variant={3} />
            {submitSuccessMsg && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{submitSuccessMsg}</span>
              </div>
            )}

            {submitErrorMsg && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>{submitErrorMsg}</span>
              </div>
            )}

            <button
              onClick={handleSubmitCountsheet}
              disabled={isSubmitting || itemCount === 0}
              className={`w-full py-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-98 cursor-pointer disabled:opacity-50 ${
                !isOnline
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                  : 'bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>{t.submittingToSheets}</span>
                </>
              ) : !isOnline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>{t.offlineSavedLocallyBtn}</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 text-blue-400" />
                  <span>{t.submitToGoogleSheetsPrefix} {currentCountsheet.name} {t.submitToGoogleSheetsSuffix}</span>
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-600 dark:text-slate-400 text-center">
              Submits all items to <strong className="text-slate-800 dark:text-slate-200">COUNTSHEETS</strong>, replaces previous rows for {currentCountsheet.name}, and updates audit monitoring.
            </p>
          </div>
        </div>

        {/* Right Column on Desktop: Items Currently Added to Selected Countsheet */}
        <div className="lg:col-span-7 xl:col-span-8 2xl:col-span-8 space-y-4">
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-4 space-y-3 transition-colors mt-2">
            <PanelDecoration position="top-left" tier="major" variant={0} />
            <PanelDecoration position="top-border" tier="secondary" variant={1} />
            <PanelDecoration position="top-right" tier="playful" variant={2} />
            <PanelDecoration position="bottom-right" tier="secondary" variant={3} />
            {/* Header with Stats and in-sheet Search filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <h3 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                  {t.itemsInPrefix} {currentCountsheet.name} ({itemCount})
                </h3>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-slate-600 dark:text-slate-300 font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  {t.totalUnitsLabel} {currentCountsheet.items.reduce((sum, item) => sum + item.actualCount, 0).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Quick in-sheet filter & status pills if items exist */}
            {currentCountsheet.items.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {[
                    { id: 'ALL' as const, label: `${t.filterAll} (${currentCountsheet.items.length})` },
                    {
                      id: 'VARIANCE' as const,
                      label: `${t.filterWithVariance} (${
                        currentCountsheet.items.filter((i) => i.actualCount !== (i.balance || 0)).length
                      })`,
                    },
                    {
                      id: 'MATCHED' as const,
                      label: `${t.filterMatched} (${
                        currentCountsheet.items.filter((i) => i.actualCount === (i.balance || 0)).length
                      })`,
                    },
                    {
                      id: 'ISSUE' as const,
                      label: `${t.filterBadUnid} (${
                        currentCountsheet.items.filter(
                          (i) => (i.condition && i.condition !== 'Good') || i.isUnidentified
                        ).length
                      })`,
                    },
                  ].map((pill) => {
                    const active = sheetStatusFilter === pill.id;
                    return (
                      <button
                        key={pill.id}
                        type="button"
                        onClick={() => setSheetStatusFilter(pill.id)}
                        className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer border whitespace-nowrap ${
                          active
                            ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                            : 'bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        {pill.label}
                      </button>
                    );
                  })}
                </div>

                {currentCountsheet.items.length > 3 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder={t.filterItemsInCountsheetPlaceholder}
                      value={sheetSearchFilter}
                      onChange={(e) => setSheetSearchFilter(e.target.value)}
                      className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {sheetSearchFilter && (
                      <button
                        onClick={() => setSheetSearchFilter('')}
                        className="absolute right-2 top-1.5 p-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {currentCountsheet.items.length === 0 ? (
              <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-xs space-y-1.5">
                <PanelDecoration position="empty-state" tier="major" variant={2} />
                <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400 mb-2">
                  <Package className="w-5 h-5" />
                </div>
                <p className="font-semibold text-slate-600 dark:text-slate-400">{t.noItemsAddedYetPrefix} {currentCountsheet.name}</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">{t.scanBarcodeToAddDesc}</p>
              </div>
            ) : filteredSheetItems.length === 0 ? (
              <div className="py-8 text-center text-slate-400 dark:text-slate-500 text-xs">
                No items match the current filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[calc(100vh-230px)] min-h-[500px] overflow-y-auto pr-1 space-y-1.5">
                {filteredSheetItems.map((item, index) => {
                  const diff = Number(item.actualCount || 0) - Number(item.balance || 0);
                  return (
                    <div
                      key={`count_itm_${item.id || 'itm'}_${index}`}
                      className="py-2.5 px-2 flex items-center justify-between gap-3 group hover:bg-slate-50/80 dark:hover:bg-slate-800/60 rounded-xl transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 w-5">
                            {index + 1}.
                          </span>
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate leading-tight">
                            {item.itemDescription || 'Unidentified Item'}
                          </p>
                          {item.isUnidentified && (
                            <span className="text-[9px] bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 font-bold px-1.5 py-0.2 rounded">
                              UNID
                            </span>
                          )}
                          {item.condition && (
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                item.condition === 'Good'
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                  : item.condition === 'Bad'
                                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                  : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                              }`}
                            >
                              {item.condition}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center flex-wrap gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-1 ml-6">
                          <span className="font-mono">{item.barcode || item.itemCode}</span>
                          <span>·</span>
                          <span className="font-mono">
                            Book: {item.balance} {item.unit}
                          </span>
                          <span>·</span>
                          <span
                            className={`font-mono font-bold ${
                              diff === 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : diff > 0
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {diff === 0 ? 'Matched' : `Var: ${diff > 0 ? `+${diff}` : diff}`}
                          </span>
                          {item.category && (
                            <>
                              <span>·</span>
                              <span>{item.category}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Actual Count badge and actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => {
                            setEditingItem(item);
                            setEditQty(item.actualCount);
                            setEditCondition(item.condition || 'Good');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 hover:bg-blue-500/20 dark:hover:bg-blue-500/30 text-blue-800 dark:text-blue-200 border border-blue-400/30 dark:border-blue-500/40 text-xs font-black font-mono flex items-center gap-1 active:scale-95 transition cursor-pointer"
                          title="Edit quantity & condition"
                        >
                          <span>{item.actualCount}</span>
                          <Edit2 className="w-2.5 h-2.5 text-slate-500 dark:text-slate-400" />
                        </button>

                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                          title="Remove item"
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
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleBarcodeScan}
      />

      {/* Edit Quantity & Condition Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xs w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t.editQtyAndConditionTitle}</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{editingItem.itemDescription}</p>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                {t.actualCountLabel} ({editingItem.unit})
              </label>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                value={editQty}
                onChange={(e) => setEditQty(parseFloat(e.target.value) || 0)}
                className="w-full h-11 text-center font-mono font-bold text-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                {t.itemConditionLabel}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Good', 'Bad', 'Spoilage'] as const).map((cond) => {
                  const isSelected = editCondition === cond;
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
                      onClick={() => setEditCondition(cond)}
                      className={`py-2 px-1 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer active:scale-95 border ${
                        isSelected
                          ? cond === 'Good'
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                            : cond === 'Bad'
                            ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                            : 'bg-purple-600 border-purple-600 text-white shadow-xs'
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

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setEditingItem(null)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={handleSaveEditQty}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white cursor-pointer transition shadow-xs border border-transparent dark:border-zinc-700"
              >
                {t.saveBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Countsheet Confirmation Modal (Owner Only) */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 space-y-3.5">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t.deleteCountsheetTitlePrefix} {currentCountsheet.name}?
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
                Are you sure you want to delete <strong className="text-slate-900 dark:text-white">{currentCountsheet.name}</strong>?
                <br />
                <span className="text-rose-600 dark:text-rose-400 font-semibold block mt-1">
                  Unsent local items for this countsheet will be permanently discarded, and any matching rows in Google Sheets will be removed.
                </span>
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={handleDeleteCountsheet}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 transition shadow-sm cursor-pointer"
              >
                {isDeleting ? t.deletingText : t.discardAndDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
