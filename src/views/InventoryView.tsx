import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import { HighlightedText } from '../components/HighlightedText';
import {
  InventoryItem,
  Countsheet,
  CountsheetItem,
  SelectedBranch,
  ItemCondition,
} from '../types';
import {
  searchInventoryList,
  getBranchCountsheets,
  saveCountsheetLocal,
} from '../services/db';

interface InventoryViewProps {
  branch: SelectedBranch | null;
  userName: string | null;
  userEmail: string | null;
  onOpenBranchTab: () => void;
  onNavigateToCount: () => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  branch,
  userName,
  userEmail,
  onOpenBranchTab,
  onNavigateToCount,
}) => {
  const [activeTab, setActiveTab] = useState<'ENCODING' | 'MASTERDATA'>('ENCODING');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Quick count modal
  const [countingItem, setCountingItem] = useState<InventoryItem | null>(null);
  const [countQuantity, setCountQuantity] = useState<number>(1);
  const [itemCondition, setItemCondition] = useState<ItemCondition>('Good');
  const [targetCsNumber, setTargetCsNumber] = useState<number>(1);
  const [countsheets, setCountsheets] = useState<Countsheet[]>([]);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Load branch countsheets to know available target sheets
  useEffect(() => {
    if (branch) {
      getBranchCountsheets(branch.id).then((list) => {
        setCountsheets(list);
        if (list.length > 0) {
          setTargetCsNumber(list[0].cs);
        }
      });
    }
  }, [branch?.id]);

  // Execute local search on IndexedDB snapshot only when a keyword is typed
  useEffect(() => {
    if (!branch || !keyword.trim()) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const timer = setTimeout(() => {
      searchInventoryList(branch.id, activeTab, keyword.trim(), 80)
        .then((res) => {
          if (isMounted) setItems(res);
        })
        .finally(() => {
          if (isMounted) setIsLoading(false);
        });
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [branch?.id, activeTab, keyword]);

  // Add counted item to target countsheet
  const handleAddToCountsheet = async () => {
    if (!branch || !countingItem) return;
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

    await saveCountsheetLocal(branch.id, updatedCs);

    setSuccessToast(`Added ${qty} ${countingItem.unit} of "${countingItem.itemDescription}" to ${targetCs.name}!`);
    setTimeout(() => setSuccessToast(null), 4000);

    setCountingItem(null);

    // Refresh list of countsheets
    const updatedList = await getBranchCountsheets(branch.id);
    setCountsheets(updatedList);
  };

  if (!branch) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4 animate-fade-in-up">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
          <Database className="w-7 h-7" />
        </div>
        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
          No Active Branch Selected
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
          Please select a branch to search local inventory and masterdata.
        </p>
        <button
          onClick={onOpenBranchTab}
          className="px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-800 hover:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-semibold text-xs active:scale-95 transition shadow-sm cursor-pointer border border-transparent dark:border-zinc-700"
        >
          Select Branch
        </button>
      </div>
    );
  }

  const hasSearchQuery = keyword.trim().length > 0;

  return (
    <div className="max-w-md mx-auto px-4 py-3 space-y-3 pb-32 animate-slide-up-fade-in">
      <SEOHead
        title="Inventory Search & Catalog"
        description="Search branch local ENCODING inventory and store MASTERDATA offline by barcode, item code, or description."
        routePath="/inventory"
      />

      {/* Header Info */}
      <div className="flex items-center justify-between animate-slide-up-fade-in">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Package className="w-4 h-4 text-amber-500" />
            <span>Product Inventory</span>
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {branch.name} • Offline Snapshot
          </p>
        </div>

        {/* View Countsheet link */}
        <button
          onClick={onNavigateToCount}
          className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:text-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800 transition cursor-pointer"
        >
          View Countsheet →
        </button>
      </div>

      {/* Tabs: Local (ENCODING) vs Masterdata (MASTERDATA) */}
      <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl animate-slide-up-fade-in-1">
        <button
          onClick={() => setActiveTab('ENCODING')}
          className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
            activeTab === 'ENCODING'
              ? 'bg-white dark:bg-slate-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Local ({branch.encodingCount.toLocaleString()})
        </button>

        <button
          onClick={() => setActiveTab('MASTERDATA')}
          className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
            activeTab === 'MASTERDATA'
              ? 'bg-white dark:bg-slate-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Masterdata ({branch.masterdataCount.toLocaleString()})
        </button>
      </div>

      {/* Search Input with Instant Highlight feedback */}
      <div className="relative animate-slide-up-fade-in-2">
        <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
        <input
          type="text"
          placeholder={`Search ${activeTab === 'ENCODING' ? 'Local' : 'Master'} by code, barcode, name...`}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-full pl-9 pr-8 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
        />
        {keyword && (
          <button
            onClick={() => setKeyword('')}
            className="absolute right-2.5 top-2 p-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer rounded-full"
            title="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Active Search Result Summary Chip */}
      {hasSearchQuery && !isLoading && (
        <div className="flex items-center justify-between px-1 text-[11px] text-slate-500 dark:text-slate-400 animate-slide-up-fade-in-3">
          <span>
            Found <strong className="text-amber-600 dark:text-amber-400">{items.length}</strong> matching item{items.length === 1 ? '' : 's'} with highlighted matches
          </span>
          <button
            onClick={() => setKeyword('')}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}

      {/* Success Toast */}
      {successToast && (
        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Product List with Highlighted Matching Terms */}
      {!hasSearchQuery ? (
        <div className="py-14 px-4 text-center text-slate-400 dark:text-slate-500 text-xs animate-slide-up-fade-in-3">
          <Search className="w-7 h-7 mx-auto mb-2 text-slate-300 dark:text-slate-600 opacity-60" />
          <p className="font-semibold text-slate-700 dark:text-slate-300 text-xs">Search Local Inventory</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 max-w-xs mx-auto">
            Type item code, barcode, or description above to search.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Searching local database...
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
              <p>No products found matching "{keyword}".</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Check spelling or switch between Local and Masterdata tabs.
              </p>
            </div>
          ) : (
            items.map((item, idx) => (
              <div
                key={`${item.itemCode}_${item.barcode}_${idx}`}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200/60 dark:border-slate-700/60">
                        <HighlightedText text={item.itemCode || 'No Code'} highlight={keyword} />
                      </span>
                      {item.barcode && (
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          <HighlightedText text={item.barcode} highlight={keyword} />
                        </span>
                      )}
                    </div>

                    <h3 className="text-xs font-bold text-slate-900 dark:text-white mt-1.5 line-clamp-2 leading-relaxed">
                      <HighlightedText text={item.itemDescription} highlight={keyword} />
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400 mt-1.5">
                      {item.category && (
                        <span>
                          Cat: <HighlightedText text={item.category} highlight={keyword} />
                        </span>
                      )}
                      {item.subCategory && (
                        <span>
                          • <HighlightedText text={item.subCategory} highlight={keyword} />
                        </span>
                      )}
                      <span>•</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Balance: {item.balance} {item.unit}
                      </span>
                      {item.selling > 0 && <span>• Price: ₱{item.selling.toFixed(2)}</span>}
                    </div>
                  </div>

                  {/* Count Button */}
                  <button
                    onClick={() => {
                      setCountingItem(item);
                      setCountQuantity(1);
                      setItemCondition('Good');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 active:scale-95 transition shrink-0 cursor-pointer shadow-2xs"
                    title="Count this product"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Count</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Add To Countsheet Modal */}
      {countingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 space-y-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                Add to Countsheet
              </span>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1.5 line-clamp-2">
                {countingItem.itemDescription}
              </h3>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                Barcode: {countingItem.barcode || 'N/A'} • Book: {countingItem.balance} {countingItem.unit}
              </p>
            </div>

            {/* Target Countsheet select */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Target Countsheet
              </label>
              <select
                value={targetCsNumber}
                onChange={(e) => setTargetCsNumber(parseInt(e.target.value, 10))}
                className="w-full text-xs font-bold p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {countsheets.map((cs) => (
                  <option key={cs.cs} value={cs.cs}>
                    {cs.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Quantity Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Actual Count ({countingItem.unit})
              </label>
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
                  className="flex-1 h-10 text-center font-mono font-bold text-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
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

            {/* Item Condition: Good (automatically chosen), Bad, Spoilage */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                Item Condition
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Good', 'Bad', 'Spoilage'] as const).map((cond) => {
                  const isSelected = itemCondition === cond;
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
                            ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                            : 'bg-amber-600 border-amber-600 text-white shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {cond === 'Good' && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {cond === 'Bad' && <AlertCircle className="w-3.5 h-3.5" />}
                      {cond === 'Spoilage' && <AlertCircle className="w-3.5 h-3.5" />}
                      <span>{cond}</span>
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
                Cancel
              </button>
              <button
                onClick={handleAddToCountsheet}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-xs cursor-pointer active:scale-95"
              >
                Confirm Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
