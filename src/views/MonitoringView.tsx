import React, { useState, useEffect } from 'react';
import {
  Activity,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  X,
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import { PanelDecoration } from '../components/PanelDecoration';
import { CustomSelect } from '../components/CustomSelect';
import {
  MonitoringBlock,
  MonitoringStatus,
  Countsheet,
  SelectedBranch,
} from '../types';
import {
  getBranchCountsheets,
  getBranchMonitoringBlocks,
  saveMonitoringBlock,
  clearBranchMonitoringMode,
  subscribeToBranchCountsheets,
  subscribeToBranchMonitoringBlocks,
} from '../services/db';
import {
  fetchMonitoringTab,
  updateMonitoringBlockForCs,
  clearMonitoringModeInSheets,
} from '../services/googleSheets';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useLanguage } from '../services/i18n';

interface MonitoringViewProps {
  branch: SelectedBranch | null;
  userName: string | null;
  userEmail: string | null;
  accessToken: string | null;
  isGoogleConnected?: boolean;
  onConnectGoogle?: () => void;
  onOpenBranchTab: () => void;
}

const DEFAULT_BLOCK_COUNT = 30; // 001-005 to 146-150 (30 blocks = 150 countsheets)

export const MonitoringView: React.FC<MonitoringViewProps> = ({
  branch,
  userName,
  accessToken,
  isGoogleConnected = true,
  onConnectGoogle,
  onOpenBranchTab,
}) => {
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();
  const [activeMode, setActiveMode] = useState<'ENCODING' | 'CHECKING'>('ENCODING');
  const [blocks, setBlocks] = useState<MonitoringBlock[]>([]);
  const [, setCountsheets] = useState<Countsheet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [confirmClearMode, setConfirmClearMode] = useState(false);
  const [updatingBlockRange, setUpdatingBlockRange] = useState<string | null>(null);
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Format 3-digit range like "001-005", "006-010", ..., "146-150"
  const formatThreeDigitRange = (startCs: number, endCs: number): string => {
    return `${String(startCs).padStart(3, '0')}-${String(endCs).padStart(3, '0')}`;
  };

  // Load 5-countsheet monitoring blocks (minimum 30 blocks: 001-005 to 146-150)
  const loadMonitoringData = async (options?: { silent?: boolean }) => {
    if (!branch) return;
    if (!options?.silent) {
      setIsLoading(true);
    }
    try {
      const csList = await getBranchCountsheets(branch.id);
      setCountsheets(csList);

      let sheetBlocks: MonitoringBlock[] = [];
      if (isOnline && accessToken) {
        try {
          sheetBlocks = await fetchMonitoringTab(accessToken, branch.id);
        } catch (e) {
          console.warn('Could not fetch sheet monitoring:', e);
        }
      }

      const cachedBlocks = await getBranchMonitoringBlocks(branch.id);
      const blockMap: Record<string, MonitoringBlock> = {};

      cachedBlocks.forEach((b) => {
        blockMap[b.csRange] = b;
      });
      sheetBlocks.forEach((b) => {
        const prev = blockMap[b.csRange] as any;
        const wasEncodingCleared = Boolean(prev?.clearedEncodingAt && !b.encoder && !b.encodingStatus);
        const wasCheckingCleared = Boolean(prev?.clearedCheckingAt && !b.checker && !b.checkingStatus);
        blockMap[b.csRange] = {
          ...prev,
          ...b,
          encoder: wasEncodingCleared ? '' : (b.encoder ?? prev?.encoder ?? b.auditor ?? ''),
          encodingStatus: wasEncodingCleared ? '' : (b.encodingStatus ?? prev?.encodingStatus ?? b.status ?? ''),
          checker: wasCheckingCleared ? '' : (b.checker ?? prev?.checker ?? ''),
          checkingStatus: wasCheckingCleared ? '' : (b.checkingStatus ?? prev?.checkingStatus ?? ''),
        };
      });

      const maxCsFromSheets = csList.reduce((max, cs) => Math.max(max, cs.cs), 150);
      const maxCsFromBlocks = Object.values(blockMap).reduce(
        (max, b) => Math.max(max, b.endCs || 0),
        150
      );
      const maxCs = Math.max(150, maxCsFromSheets, maxCsFromBlocks);
      const totalBlocksNeeded = Math.max(DEFAULT_BLOCK_COUNT, Math.ceil(maxCs / 5));

      const computedBlocks: MonitoringBlock[] = [];

      for (let bIndex = 0; bIndex < totalBlocksNeeded; bIndex++) {
        const startCs = bIndex * 5 + 1;
        const endCs = startCs + 4;
        const rangeStr = `CS${String(startCs).padStart(2, '0')}–CS${String(endCs).padStart(2, '0')}`;
        const rangeLabel = formatThreeDigitRange(startCs, endCs);

        const blockSheets = csList.filter((cs) => cs.cs >= startCs && cs.cs <= endCs);
        const totalItems = blockSheets.reduce((sum, cs) => sum + cs.items.length, 0);

        const existing = blockMap[rangeStr];

        const rawEncoder =
          existing?.encoder !== undefined
            ? existing.encoder
            : existing?.auditor && existing.auditor !== 'Unassigned' && existing.auditor !== 'Auditor'
            ? existing.auditor
            : blockSheets[0]?.auditorName || '';

        const rawEncodingStatus: MonitoringStatus =
          existing?.encodingStatus !== undefined
            ? existing.encodingStatus
            : existing?.status
            ? existing.status
            : blockSheets.length > 0 && blockSheets.every((s) => s.status === 'submitted')
            ? 'Completed'
            : blockSheets.length > 0
            ? 'In Progress'
            : '';

        const rawChecker = existing?.checker ?? '';
        const rawCheckingStatus: MonitoringStatus = existing?.checkingStatus ?? '';

        const blockRecord: MonitoringBlock = {
          csRange: rangeStr,
          rangeLabel,
          startCs,
          endCs,
          auditor: rawEncoder,
          status: rawEncodingStatus,
          encoder: rawEncoder,
          encodingStatus: rawEncodingStatus,
          checker: rawChecker,
          checkingStatus: rawCheckingStatus,
          sheetCount: blockSheets.length,
          totalItems,
        };

        computedBlocks.push(blockRecord);
      }

      setBlocks(computedBlocks);
    } catch (err: any) {
      console.error('Error loading monitoring data:', err);
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadMonitoringData({ silent: true });
    if (!branch) return;

    const unsubCs = subscribeToBranchCountsheets(branch.id, () => {
      void loadMonitoringData({ silent: true });
    });
    const unsubMon = subscribeToBranchMonitoringBlocks(branch.id, () => {
      void loadMonitoringData({ silent: true });
    });

    return () => {
      unsubCs();
      unsubMon();
    };
  }, [branch?.id, isOnline]);

  // Save updated Encoder/Checker name or Status for a row
  const handleUpdateBlock = async (
    block: MonitoringBlock,
    updates: { personName?: string; status?: MonitoringStatus }
  ) => {
    if (!branch) return;

    const isChecking = activeMode === 'CHECKING';
    const currentPerson = isChecking ? block.checker || '' : block.encoder || '';
    const currentStatus: MonitoringStatus = isChecking
      ? block.checkingStatus || ''
      : block.encodingStatus || '';

    const nextStatus = updates.status !== undefined ? updates.status : currentStatus;
    // Auto-fill current user name if user sets a status when name is blank
    const nextPerson =
      updates.personName !== undefined
        ? updates.personName
        : !currentPerson && nextStatus && userName
        ? userName
        : currentPerson;

    setUpdatingBlockRange(block.csRange);
    setMsg(null);

    const updatedBlock: MonitoringBlock = isChecking
      ? {
          ...block,
          checker: nextPerson,
          checkingStatus: nextStatus,
        }
      : {
          ...block,
          auditor: nextPerson,
          status: nextStatus,
          encoder: nextPerson,
          encodingStatus: nextStatus,
        };

    // Optimistic UI update
    setBlocks((prev) =>
      prev.map((b) => (b.csRange === block.csRange ? updatedBlock : b))
    );

    try {
      await saveMonitoringBlock(branch.id, updatedBlock);

      if (isOnline && accessToken) {
        await updateMonitoringBlockForCs(
          accessToken,
          branch.id,
          block.startCs,
          nextPerson,
          nextStatus,
          activeMode
        );
      }
    } catch (err: any) {
      console.error('Error updating monitoring block:', err);
      setMsg({
        text: `Failed to sync ${block.rangeLabel || block.csRange}: ${err.message}`,
        type: 'error',
      });
    } finally {
      setUpdatingBlockRange(null);
    }
  };

  // Clear all names and reset status to Set ('') for the currently active mode (ENCODING or CHECKING)
  const handleClearActiveMode = async () => {
    if (!branch || blocks.length === 0) return;
    const modeToClear = activeMode;
    setIsClearing(true);
    setConfirmClearMode(false);
    setMsg(null);

    // Clear editingNames for the active mode
    setEditingNames((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k.startsWith(`${modeToClear}_`)) {
          delete next[k];
        }
      });
      return next;
    });

    try {
      const clearedBlocks = await clearBranchMonitoringMode(branch.id, blocks, modeToClear);
      setBlocks(clearedBlocks);

      if (isOnline && accessToken) {
        await clearMonitoringModeInSheets(accessToken, branch.id, modeToClear);
      }

      setMsg({
        text:
          modeToClear === 'ENCODING'
            ? 'Cleared all Encoder names and reset Encoding status to Set.'
            : 'Cleared all Checker names and reset Checking status to Set.',
        type: 'success',
      });
    } catch (err: any) {
      console.error('Error clearing monitoring mode:', err);
      setMsg({
        text: `Failed to clear ${modeToClear.toLowerCase()} monitoring: ${err.message}`,
        type: 'error',
      });
    } finally {
      setIsClearing(false);
    }
  };

  if (!branch) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4 animate-fade-in-up">
        <PanelDecoration position="empty-state" tier="major" variant={0} />
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${
          !isGoogleConnected
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
        }`}>
          {!isGoogleConnected ? <AlertCircle className="w-7 h-7" /> : <Activity className="w-7 h-7" />}
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          {!isGoogleConnected ? 'Google Account Not Connected' : t.noBranchSelectedTitle}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
          {!isGoogleConnected
            ? 'Countsheet Encoding & Checking Monitoring requires a connected Google account and an active branch spreadsheet.'
            : t.noBranchSelectedMonitoringDesc}
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
              className="px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-800 hover:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-semibold text-xs active:scale-95 transition shadow-sm cursor-pointer border border-transparent dark:border-zinc-700"
            >
              {t.selectBranch}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Calculate completion percentages for Encoding and Checking
  const totalBlockCount = blocks.length || DEFAULT_BLOCK_COUNT;
  const encodingCompletedCount = blocks.filter(
    (b) => (b.encodingStatus ?? b.status) === 'Completed'
  ).length;
  const checkingCompletedCount = blocks.filter(
    (b) => b.checkingStatus === 'Completed'
  ).length;

  const encodingPercent = (encodingCompletedCount / totalBlockCount) * 100;
  const checkingPercent = (checkingCompletedCount / totalBlockCount) * 100;
  const activePercent = activeMode === 'ENCODING' ? encodingPercent : checkingPercent;

  // Pill styling for STATUS dropdown matching the spreadsheet screenshot
  const getStatusPillClasses = (status: MonitoringStatus) => {
    switch (status) {
      case 'Completed':
        return 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800';
      case 'In Progress':
        return 'bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-800';
      case 'Pending':
        return 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-800';
      default:
        return 'bg-[#e4e7ec] dark:bg-zinc-700/90 text-slate-700 dark:text-zinc-200 border-slate-300/80 dark:border-zinc-600';
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4 animate-slide-up-fade-in">
      <SEOHead
        title={`${activeMode === 'ENCODING' ? 'Encoding' : 'Checking'} Monitoring`}
        description="Track inventory countsheet Encoding and Checking status in 5-countsheet blocks (001-005 to 146-150)."
        routePath="/monitoring"
      />

      {/* Top Controls Bar: Branch Info + Switcher Button between Encoding and Checking */}
      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs mt-2">
        <PanelDecoration position="top-left" tier="major" variant={0} />
        <PanelDecoration position="top-border" tier="secondary" variant={2} />
        <PanelDecoration position="top-right" tier="playful" variant={1} />
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="truncate">{branch.name}</span>
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {t.monitoringSubtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Segmented Mode Switcher: ENCODING vs CHECKING */}
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                setActiveMode('ENCODING');
                setConfirmClearMode(false);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeMode === 'ENCODING'
                  ? 'bg-white dark:bg-slate-900 text-slate-950 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.encodingTab}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveMode('CHECKING');
                setConfirmClearMode(false);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeMode === 'CHECKING'
                  ? 'bg-white dark:bg-slate-900 text-slate-950 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.checkingTab}
            </button>
          </div>

          {/* Clear Active Mode (Encoding or Checking) Button */}
          {confirmClearMode ? (
            <div className="inline-flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 px-2 py-1 rounded-xl">
              <button
                type="button"
                onClick={handleClearActiveMode}
                disabled={isClearing}
                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {isClearing
                  ? t.clearingText
                  : `${t.confirmClearPrefix} ${activeMode === 'ENCODING' ? 'Encoding' : 'Checking'}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClearMode(false)}
                className="px-2 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t.cancelBtn}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClearMode(true)}
              disabled={isClearing || isLoading}
              className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 border border-rose-200/90 dark:border-rose-800/70 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition cursor-pointer disabled:opacity-50"
              title={
                activeMode === 'ENCODING'
                  ? 'Clear all Encoder names and set Encoding status to Set'
                  : 'Clear all Checker names and set Checking status to Set'
              }
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isClearing ? 'animate-spin' : ''}`} />
              <span>{activeMode === 'ENCODING' ? t.clearEncodingBtn : t.clearCheckingBtn}</span>
            </button>
          )}

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => loadMonitoringData({ silent: false })}
            disabled={isLoading}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 active:scale-95 transition cursor-pointer"
            title="Refresh Monitoring Sheet"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
            msg.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-300'
          }`}
        >
          {msg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Spreadsheet-Style Monitoring Window (Single Active Window: ENCODING or CHECKING) */}
      <div className="relative bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-xs p-3 sm:p-5 space-y-3 mt-2">
        <PanelDecoration position="top-left" tier="secondary" variant={1} />
        <PanelDecoration position="top-border" tier="major" variant={3} />
        <PanelDecoration position="top-right" tier="secondary" variant={0} />
        <PanelDecoration position="bottom-left" tier="playful" variant={2} />
        <PanelDecoration position="bottom-right" tier="secondary" variant={1} />
        {/* Refined 2-Bar Header: Upper Bar (ENCODING / CHECKING) + Lower Progress Bar with Percentage */}
        <div className="rounded-xl border border-slate-300 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-900 shadow-2xs">
          {/* Upper Bar: ENCODING or CHECKING Title */}
          <div className="py-2 px-4 bg-slate-100/90 dark:bg-zinc-800/90 border-b border-slate-300 dark:border-zinc-700 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
              {activeMode === 'ENCODING' ? encodingCompletedCount : checkingCompletedCount} / {totalBlockCount} {t.completedOfText}
            </span>
            <span className="font-extrabold text-xs sm:text-sm tracking-widest text-slate-900 dark:text-white uppercase">
              {activeMode}
            </span>
            <span className="text-[11px] font-mono tabular-nums font-semibold text-slate-500 dark:text-zinc-400">
              CS 001–{String(totalBlockCount * 5).padStart(3, '0')}
            </span>
          </div>

          {/* Lower Bar: Progress Track + Percentage */}
          <div className="py-2.5 px-4 bg-white dark:bg-zinc-900 flex items-center gap-3.5">
            <div className="flex-1 h-3 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, activePercent))}%` }}
              />
            </div>
            <div className="w-16 sm:w-20 text-right font-extrabold text-sm sm:text-base text-slate-950 dark:text-white font-mono tabular-nums shrink-0">
              {activePercent.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Spreadsheet Grid Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-zinc-700">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-zinc-800/90 border-b border-slate-300 dark:border-zinc-700 text-slate-800 dark:text-zinc-200">
                <th className="py-1.5 px-2 sm:px-2.5 text-left font-normal border-r border-slate-200 dark:border-zinc-700 w-20 sm:w-28 whitespace-nowrap">
                  CS No.
                </th>
                <th className="py-1.5 px-2 sm:px-2.5 text-center font-normal border-r border-slate-200 dark:border-zinc-700">
                  {activeMode === 'ENCODING' ? t.encoderColumn : t.checkerColumn}
                </th>
                <th className="py-1.5 px-2 sm:px-2.5 text-left font-normal w-28 sm:w-40 whitespace-nowrap">
                  {t.statusColumn}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-zinc-800">
              {blocks.map((block) => {
                const rangeDisplay =
                  block.rangeLabel || formatThreeDigitRange(block.startCs, block.endCs);
                const personKey = `${activeMode}_${block.csRange}`;
                const storedPerson =
                  activeMode === 'ENCODING'
                    ? block.encoder ?? block.auditor ?? ''
                    : block.checker ?? '';
                const personValue =
                  editingNames[personKey] !== undefined
                    ? editingNames[personKey]
                    : storedPerson;

                const currentStatus: MonitoringStatus =
                  activeMode === 'ENCODING'
                    ? block.encodingStatus ?? block.status ?? ''
                    : block.checkingStatus ?? '';

                const isRowUpdating = updatingBlockRange === block.csRange;

                return (
                  <tr
                    key={block.csRange}
                    className="hover:bg-slate-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    {/* Column 1: CS No. (001-005 .. 146-150) */}
                    <td className="py-1 px-2 sm:px-2.5 font-mono tabular-nums text-[11px] sm:text-xs text-slate-900 dark:text-zinc-100 border-r border-slate-200 dark:border-zinc-800 whitespace-nowrap">
                      {rangeDisplay}
                    </td>

                    {/* Column 2: Encoder / Checker Editable Cell with Per-Row Clear */}
                    <td className="py-0.5 px-1 sm:px-2 border-r border-slate-200 dark:border-zinc-800">
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          value={personValue}
                          placeholder=""
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingNames((prev) => ({
                              ...prev,
                              [personKey]: val,
                            }));
                          }}
                          onBlur={() => {
                            if (
                              editingNames[personKey] !== undefined &&
                              editingNames[personKey].trim() !== storedPerson
                            ) {
                              handleUpdateBlock(block, {
                                personName: editingNames[personKey].trim(),
                              });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-full text-center text-xs py-1 pl-1.5 pr-5 sm:px-5 bg-transparent text-slate-900 dark:text-zinc-100 focus:bg-blue-50/50 dark:focus:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                        />
                        {(personValue || currentStatus) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNames((prev) => {
                                const next = { ...prev };
                                delete next[personKey];
                                return next;
                              });
                              handleUpdateBlock(block, {
                                personName: '',
                                status: '',
                              });
                            }}
                            title={`Clear ${activeMode === 'ENCODING' ? 'Encoder' : 'Checker'} & reset status to Set`}
                            className="absolute right-0.5 sm:right-1 p-0.5 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Column 3: STATUS Dropdown Pill */}
                    <td className="py-1 px-1.5 sm:px-2.5">
                      <CustomSelect
                        value={currentStatus}
                        disabled={isRowUpdating}
                        onChange={(val) =>
                          handleUpdateBlock(block, {
                            status: val as MonitoringStatus,
                          })
                        }
                        placeholder={t.statusSet}
                        ariaLabel={`${activeMode} status for ${rangeDisplay}`}
                        variant="pill"
                        pillClassName={getStatusPillClasses(currentStatus)}
                        className="w-full"
                        menuMinWidth={165}
                        options={[
                          { value: '', label: t.statusSet, dotColor: 'bg-slate-300 dark:bg-zinc-600' },
                          { value: 'Pending', label: t.statusPending, dotColor: 'bg-amber-500' },
                          { value: 'In Progress', label: t.statusInProgress, dotColor: 'bg-blue-500' },
                          { value: 'Completed', label: t.statusCompleted, dotColor: 'bg-emerald-500' },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
