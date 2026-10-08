import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle,
  Clock,
  RefreshCw,
  Layers,
  User,
  ShieldCheck,
  Send,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import {
  MonitoringBlock,
  Countsheet,
  SelectedBranch,
} from '../types';
import {
  getBranchCountsheets,
  getBranchMonitoringBlocks,
  saveMonitoringBlock,
} from '../services/db';
import {
  fetchMonitoringTab,
  updateMonitoringBlockForCs,
  getCsBlockRange,
} from '../services/googleSheets';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface MonitoringViewProps {
  branch: SelectedBranch | null;
  userName: string | null;
  userEmail: string | null;
  accessToken: string | null;
  onOpenBranchTab: () => void;
}

export const MonitoringView: React.FC<MonitoringViewProps> = ({
  branch,
  userName,
  accessToken,
  onOpenBranchTab,
}) => {
  const isOnline = useOnlineStatus();
  const [blocks, setBlocks] = useState<MonitoringBlock[]>([]);
  const [countsheets, setCountsheets] = useState<Countsheet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [updatingBlockRange, setUpdatingBlockRange] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Compute and load 5-countsheet monitoring blocks
  const loadMonitoringData = async () => {
    if (!branch) return;
    setIsLoading(true);
    try {
      // 1. Load local countsheets to calculate stats per block
      const csList = await getBranchCountsheets(branch.id);
      setCountsheets(csList);

      // 2. Fetch sheet monitoring tab if online
      let sheetBlocks: MonitoringBlock[] = [];
      if (isOnline && accessToken) {
        try {
          sheetBlocks = await fetchMonitoringTab(accessToken, branch.id);
        } catch (e) {
          console.warn('Could not fetch sheet monitoring:', e);
        }
      }

      // Also get cached DB blocks
      const cachedBlocks = await getBranchMonitoringBlocks(branch.id);
      const blockMap: Record<string, MonitoringBlock> = {};

      cachedBlocks.forEach((b) => {
        blockMap[b.csRange] = b;
      });
      sheetBlocks.forEach((b) => {
        blockMap[b.csRange] = b;
      });

      // Find max CS number
      const maxCs = csList.reduce((max, cs) => Math.max(max, cs.cs), 5);
      const totalBlocksNeeded = Math.max(1, Math.ceil(maxCs / 5));

      const computedBlocks: MonitoringBlock[] = [];

      for (let bIndex = 0; bIndex < totalBlocksNeeded; bIndex++) {
        const startCs = bIndex * 5 + 1;
        const endCs = startCs + 4;
        const rangeStr = `CS${String(startCs).padStart(2, '0')}–CS${String(endCs).padStart(2, '0')}`;

        // Find sheets falling into this block
        const blockSheets = csList.filter((cs) => cs.cs >= startCs && cs.cs <= endCs);
        const totalItems = blockSheets.reduce((sum, cs) => sum + cs.items.length, 0);

        const existing = blockMap[rangeStr];
        const status = existing
          ? existing.status
          : blockSheets.length > 0 && blockSheets.every((s) => s.status === 'submitted')
          ? 'Completed'
          : 'In Progress';

        const auditor =
          existing?.auditor && existing.auditor !== 'Unassigned'
            ? existing.auditor
            : blockSheets[0]?.auditorName || userName || 'Auditor';

        const blockRecord: MonitoringBlock = {
          csRange: rangeStr,
          startCs,
          endCs,
          auditor,
          status,
          sheetCount: blockSheets.length,
          totalItems,
        };

        computedBlocks.push(blockRecord);
        await saveMonitoringBlock(branch.id, blockRecord);
      }

      setBlocks(computedBlocks);
    } catch (err: any) {
      console.error('Error loading monitoring data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMonitoringData();
  }, [branch?.id, isOnline]);

  // Toggle status between "In Progress" and "Completed"
  const handleToggleStatus = async (block: MonitoringBlock) => {
    if (!branch) return;
    const nextStatus: 'In Progress' | 'Completed' =
      block.status === 'Completed' ? 'In Progress' : 'Completed';

    setUpdatingBlockRange(block.csRange);
    setMsg(null);

    try {
      const updatedBlock: MonitoringBlock = {
        ...block,
        status: nextStatus,
        auditor: userName || block.auditor,
      };

      // Save locally
      await saveMonitoringBlock(branch.id, updatedBlock);

      // Sync to Google Sheets MONITORING tab if online
      if (isOnline && accessToken) {
        await updateMonitoringBlockForCs(
          accessToken,
          branch.id,
          block.startCs,
          userName || block.auditor,
          nextStatus
        );
      }

      setBlocks((prev) =>
        prev.map((b) => (b.csRange === block.csRange ? updatedBlock : b))
      );

      setMsg({
        text: `Updated ${block.csRange} to ${nextStatus}`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Error updating block status:', err);
      setMsg({ text: `Failed to update status: ${err.message}`, type: 'error' });
    } finally {
      setUpdatingBlockRange(null);
    }
  };

  if (!branch) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4 animate-fade-in-up">
        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
          <Activity className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Branch Not Selected</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
          Select a branch spreadsheet to track audit monitoring and five-sheet progress blocks.
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

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 pb-24 md:pb-8 animate-slide-up-fade-in">
      <SEOHead
        title="Audit Monitoring & 5-Sheet Blocks"
        description="Track physical inventory audit monitoring progress organized into five-countsheet blocks (CS01–CS05, CS06–CS10) with Google Sheets sync."
        routePath="/monitoring"
      />

      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up-fade-in">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400" />
            <span>Audit Monitoring &amp; Batch Blocks</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {branch.name} • 5-Sheet Sequential Batch Progress
          </p>
        </div>

        <button
          onClick={loadMonitoringData}
          disabled={isLoading}
          className="p-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 active:scale-95 transition cursor-pointer shadow-xs flex items-center gap-1.5 text-xs font-semibold"
          title="Refresh Monitoring Tab"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {msg && (
        <div
          className={`p-3 rounded-2xl text-xs flex items-center gap-2 ${
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

      {/* Concept Explainer Note */}
      <div className="p-3.5 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/50 rounded-2xl text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          Countsheets are organized into <strong>5-countsheet audit blocks</strong> (CS01–CS05, CS06–CS10). Toggling status automatically syncs with the branch spreadsheet's <strong>MONITORING</strong> tab.
        </p>
      </div>

      {/* Monitoring Grid on sm/md/lg+ screens */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Audit Batches ({blocks.length})
          </h3>
          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
            {blocks.filter((b) => b.status === 'Completed').length} of {blocks.length} Completed
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {blocks.map((block) => {
            const isCompleted = block.status === 'Completed';
            const isUpdating = updatingBlockRange === block.csRange;

            return (
              <div
                key={block.csRange}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition flex flex-col justify-between gap-3.5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-sm text-slate-950 dark:text-white bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-xl border border-slate-200/80 dark:border-slate-700">
                      {block.csRange}
                    </span>

                    <button
                      onClick={() => handleToggleStatus(block)}
                      disabled={isUpdating}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition active:scale-95 cursor-pointer ${
                        isCompleted
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                          : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60'
                      }`}
                      title="Tap to toggle status"
                    >
                      {isCompleted ? (
                        <>
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>Completed</span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>In Progress</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                    <span>Sheets: {block.sheetCount} active</span>
                    <span className="font-bold text-slate-900 dark:text-white font-mono">{block.totalItems} items counted</span>
                  </div>

                  {/* Visual 5-sheet block dots */}
                  <div className="grid grid-cols-5 gap-1.5 mt-2">
                    {[1, 2, 3, 4, 5].map((slot) => {
                      const hasSheet = slot <= block.sheetCount;
                      return (
                        <div
                          key={slot}
                          className={`h-1.5 rounded-full transition ${
                            isCompleted
                              ? 'bg-emerald-500'
                              : hasSheet
                              ? 'bg-blue-500'
                              : 'bg-slate-200 dark:bg-slate-800'
                          }`}
                          title={`Sheet ${slot} of 5`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Auditor and Range Info */}
                <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate font-medium text-slate-700 dark:text-slate-300">{block.auditor || 'Unassigned'}</span>
                  </div>

                  <span className="text-[10px] font-mono text-slate-400">
                    CS{String(block.startCs).padStart(2, '0')}–CS{String(block.endCs).padStart(2, '0')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spreadsheet Tab Info */}
      <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400 transition-colors">
        <p>
          Status updates sync automatically with the branch Google Spreadsheet's <strong className="text-slate-800 dark:text-slate-200 font-semibold">MONITORING</strong> tab.
        </p>
      </div>
    </div>
  );
};
