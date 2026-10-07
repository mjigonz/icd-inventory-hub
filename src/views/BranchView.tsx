import React, { useState, useEffect } from 'react';
import {
  Store,
  Search,
  RefreshCw,
  Check,
  Shield,
  UserCheck,
  AlertCircle,
  FileSpreadsheet,
  Database,
  Calendar,
  Layers,
  ArrowRight,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import {
  searchDriveSpreadsheets,
  fetchEncodingSheet,
  fetchMasterdataSheet,
  fetchExistingCountsheets,
  fetchMonitoringTab,
  DriveSpreadsheetFile,
} from '../services/googleSheets';
import {
  saveBranchInventory,
  getSavedBranch,
  getAllSavedBranches,
  deleteBranchLocal,
  saveCountsheetLocal,
  saveMonitoringBlock,
} from '../services/db';
import { SelectedBranch, BranchRoleInfo } from '../types';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface BranchViewProps {
  userEmail: string | null;
  userName: string | null;
  accessToken: string | null;
  selectedBranch: SelectedBranch | null;
  userRole: 'owner' | 'encoder' | 'unassigned';
  onSelectBranch: (branch: SelectedBranch, role: 'owner' | 'encoder' | 'unassigned') => void;
  onDisconnect?: () => void;
  onNavigateToCount: () => void;
}

export const BranchView: React.FC<BranchViewProps> = ({
  userEmail,
  userName,
  accessToken,
  selectedBranch,
  userRole,
  onSelectBranch,
  onDisconnect,
  onNavigateToCount,
}) => {
  const isOnline = useOnlineStatus();
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>([]);
  const [savedBranches, setSavedBranches] = useState<SelectedBranch[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualIdInput, setManualIdInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [claimRoleModalBranch, setClaimRoleModalBranch] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [roleInfo, setRoleInfo] = useState<BranchRoleInfo | null>(null);
  const [roleClaimError, setRoleClaimError] = useState<string | null>(null);
  const [isClaimingRole, setIsClaimingRole] = useState(false);
  const [branchToRemove, setBranchToRemove] = useState<SelectedBranch | null>(null);
  const [isDeletingBranch, setIsDeletingBranch] = useState(false);
  const [driveApiError, setDriveApiError] = useState<{
    title: string;
    message: string;
    enableUrl?: string;
    isAccessNotConfigured?: boolean;
  } | null>(null);
  const [searchRetryKey, setSearchRetryKey] = useState(0);

  // Load saved local branches
  useEffect(() => {
    getAllSavedBranches().then((list) => {
      setSavedBranches(list);
    });
  }, []);

  // Search Drive files when online
  useEffect(() => {
    if (!accessToken || !isOnline) return;

    let isMounted = true;
    setIsSearching(true);
    setDriveApiError(null);
    searchDriveSpreadsheets(accessToken, searchQuery)
      .then((files) => {
        if (isMounted) {
          setDriveFiles(files);
          setDriveApiError(null);
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          setDriveFiles([]);
          if (err?.isAccessNotConfigured) {
            setDriveApiError({
              title: 'Google Drive API Needs Activation',
              message:
                err.message ||
                'Google Drive API has not been activated in project 412785347562.',
              enableUrl:
                err.enableUrl ||
                'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=412785347562',
              isAccessNotConfigured: true,
            });
          } else {
            console.warn('Google Drive search unavailable:', err?.message || err);
            setDriveApiError({
              title: 'Drive Search Unavailable',
              message: err?.message || 'Unable to load spreadsheets from Google Drive.',
              isAccessNotConfigured: false,
            });
          }
        }
      })
      .finally(() => {
        if (isMounted) setIsSearching(false);
      });

    return () => {
      isMounted = false;
    };
  }, [accessToken, searchQuery, isOnline, searchRetryKey]);

  // Fetch branch role status from server
  const fetchBranchRoleStatus = async (branchId: string): Promise<BranchRoleInfo | null> => {
    if (!accessToken) return null;
    try {
      const res = await fetch(`/api/roles/status?spreadsheetId=${encodeURIComponent(branchId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        return {
          spreadsheetId: branchId,
          spreadsheetName: '',
          hasOwner: data.hasOwner,
          ownerEmail: data.ownerEmail,
          ownerName: data.ownerName,
          currentRole: data.currentRole,
        };
      }
    } catch (e) {
      console.error('Error fetching branch role status:', e);
    }
    return null;
  };

  // Handle clicking a branch spreadsheet
  const handleSelectBranchCandidate = async (candidate: { id: string; name: string }) => {
    setErrorMessage(null);
    setRoleClaimError(null);

    // If online, check role with server
    if (isOnline && accessToken) {
      const info = await fetchBranchRoleStatus(candidate.id);
      setRoleInfo(info);

      // If user is already assigned a role, proceed directly
      if (info && info.currentRole !== 'unassigned') {
        const existingBranch = await getSavedBranch(candidate.id);
        const branchObj: SelectedBranch = existingBranch || {
          id: candidate.id,
          name: candidate.name,
          encodingCount: 0,
          masterdataCount: 0,
        };
        onSelectBranch(branchObj, info.currentRole);
        return;
      }
    }

    // Otherwise open role choice modal
    setClaimRoleModalBranch(candidate);
  };

  // Claim role (Owner vs Encoder) via server
  const handleClaimRole = async (role: 'owner' | 'encoder') => {
    if (!claimRoleModalBranch || !accessToken) return;
    setIsClaimingRole(true);
    setRoleClaimError(null);

    try {
      const res = await fetch('/api/roles/claim', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          spreadsheetId: claimRoleModalBranch.id,
          spreadsheetName: claimRoleModalBranch.name,
          requestedRole: role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Show specific error from server e.g. "This branch already has an owner."
        setRoleClaimError(data.error || 'Failed to claim role on this branch.');
        return;
      }

      // Success!
      const existingBranch = await getSavedBranch(claimRoleModalBranch.id);
      const branchObj: SelectedBranch = existingBranch || {
        id: claimRoleModalBranch.id,
        name: claimRoleModalBranch.name,
        encodingCount: 0,
        masterdataCount: 0,
      };

      onSelectBranch(branchObj, role);
      setClaimRoleModalBranch(null);
    } catch (err: any) {
      console.error('Error claiming role:', err);
      setRoleClaimError(err.message || 'Network error claiming role');
    } finally {
      setIsClaimingRole(false);
    }
  };

  // Full Branch Sync
  const handleSyncBranch = async (branchToSync: SelectedBranch) => {
    if (!accessToken) {
      setErrorMessage('Google Workspace authorization required to sync.');
      return;
    }
    if (!isOnline) {
      setErrorMessage('Cannot sync branch data while offline. Connect to internet first.');
      return;
    }

    setIsSyncing(true);
    setErrorMessage(null);
    setSyncProgress('Reading ENCODING tab...');

    try {
      // 1. Fetch ENCODING
      const encodingItems = await fetchEncodingSheet(accessToken, branchToSync.id);
      setSyncProgress(`Loaded ${encodingItems.length} local items. Reading MASTERDATA tab...`);

      // 2. Fetch MASTERDATA
      const masterdataItems = await fetchMasterdataSheet(accessToken, branchToSync.id);
      setSyncProgress(`Loaded ${masterdataItems.length} master items. Reading existing countsheets...`);

      // 3. Fetch existing COUNTSHEETS tab
      const { itemsByCs } = await fetchExistingCountsheets(accessToken, branchToSync.id);

      // Save each existing countsheet to local DB
      for (const [csStr, items] of Object.entries(itemsByCs)) {
        const csNum = parseInt(csStr, 10);
        await saveCountsheetLocal(branchToSync.id, {
          cs: csNum,
          name: `CS${String(csNum).padStart(2, '0')}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          submittedAt: new Date().toISOString(),
          auditorName: userName || 'Auditor',
          auditorEmail: userEmail || '',
          items,
          status: 'submitted',
        });
      }

      // 4. Fetch MONITORING tab
      const blocks = await fetchMonitoringTab(accessToken, branchToSync.id);
      for (const b of blocks) {
        await saveMonitoringBlock(branchToSync.id, b);
      }

      // 5. Save all items into IndexedDB
      setSyncProgress('Caching inventory snapshot locally...');
      await saveBranchInventory(branchToSync, encodingItems, masterdataItems);

      const updatedBranch: SelectedBranch = {
        ...branchToSync,
        encodingCount: encodingItems.length,
        masterdataCount: masterdataItems.length,
        lastSyncedAt: new Date().toISOString(),
      };

      onSelectBranch(updatedBranch, userRole);
      setSavedBranches(await getAllSavedBranches());
      setSyncProgress('');
    } catch (err: any) {
      console.error('Sync failed:', err);
      setErrorMessage(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle manual spreadsheet link or ID
  const handleManualBranchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualIdInput.trim()) return;

    let id = manualIdInput.trim();
    // If it's a URL, extract spreadsheetId
    const match = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
      id = match[1];
    }

    handleSelectBranchCandidate({
      id,
      name: `Branch Sheet (${id.substring(0, 8)}...)`,
    });
    setManualIdInput('');
  };

  // Remove cached branch and local data from device
  const handleConfirmRemoveBranch = async () => {
    if (!branchToRemove) return;
    setIsDeletingBranch(true);
    setErrorMessage(null);
    try {
      await deleteBranchLocal(branchToRemove.id);

      // If active branch was the one removed, clear active branch
      if (selectedBranch?.id === branchToRemove.id) {
        localStorage.removeItem('countsheet_active_branch_id');
        localStorage.removeItem('countsheet_active_role');
        onSelectBranch(null as any, 'unassigned');
      }

      const updated = await getAllSavedBranches();
      setSavedBranches(updated);
      setBranchToRemove(null);
    } catch (err: any) {
      console.error('Failed to remove branch:', err);
      setErrorMessage(err?.message || 'Failed to remove branch from device.');
    } finally {
      setIsDeletingBranch(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-4 space-y-4 pb-32 animate-slide-up-fade-in">
      <SEOHead
        title="Branch Selection & Inventory Sync"
        description="Select branch Google Spreadsheet, assign audit roles, and sync branch inventory data for fast offline barcode scanning."
        routePath="/branch"
      />

      {/* Active Branch Card */}
      {selectedBranch && (
        <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200/80 dark:border-slate-800 transition-colors animate-slide-up-fade-in">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
                <Store className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Active Branch
                </span>
                <h2 className="text-base font-bold text-slate-900 dark:text-white truncate max-w-[220px]">
                  {selectedBranch.name}
                </h2>
              </div>
            </div>

            {/* Role indicator */}
            <div
              className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${
                userRole === 'owner'
                  ? 'bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 dark:border-amber-500/40'
                  : 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30 dark:border-blue-500/40'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span className="capitalize">{userRole}</span>
            </div>
          </div>

          <div className="my-3 text-xs bg-slate-50 dark:bg-slate-800/80 rounded-xl p-3 border border-slate-200/70 dark:border-slate-700/60">
            <p className="text-slate-500 dark:text-slate-400">Local Inventory (ENCODING)</p>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {selectedBranch.encodingCount.toLocaleString()} items
            </p>
          </div>

          {selectedBranch.lastSyncedAt && (
            <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              <Calendar className="w-3 h-3 text-slate-400 dark:text-slate-500" />
              <span>Synced: {new Date(selectedBranch.lastSyncedAt).toLocaleString()}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => handleSyncBranch(selectedBranch)}
              disabled={isSyncing || !isOnline}
              className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-white text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 active:scale-98 transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-500 dark:text-amber-400 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Re-sync Data'}</span>
            </button>

            <button
              onClick={onNavigateToCount}
              className="flex-1 py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white dark:text-zinc-100 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-98 transition shadow-sm cursor-pointer border border-transparent dark:border-zinc-700"
            >
              <span>Start Counting</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {isSyncing && syncProgress && (
            <p className="mt-2.5 text-xs text-amber-600 dark:text-amber-300 animate-pulse text-center">{syncProgress}</p>
          )}
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 3. Search Branch Spreadsheets in Google Drive */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-4 space-y-3 transition-colors animate-slide-up-fade-in-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-amber-500" />
            <span>Search Branch Spreadsheets</span>
          </h3>
          {isSearching && <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
        </div>

        {/* Drive API activation guide or error message */}
        {driveApiError && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-amber-900 dark:text-amber-200">{driveApiError.title}</p>
                <p className="text-amber-800 dark:text-amber-300/90 mt-0.5 leading-relaxed text-[11px]">
                  {driveApiError.isAccessNotConfigured
                    ? 'Your Google Cloud Project (412785347562 / icd-inventory-hub) requires the Google Drive API to be enabled in order to search and browse files automatically.'
                    : driveApiError.message}
                </p>
              </div>
            </div>

            {driveApiError.isAccessNotConfigured && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <a
                  href={driveApiError.enableUrl || 'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=412785347562'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] transition shadow-xs"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>1. Enable Drive API</span>
                </a>
                <a
                  href="https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=412785347562"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold text-[11px] transition shadow-xs"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>2. Enable Sheets API</span>
                </a>
                <button
                  type="button"
                  onClick={() => setSearchRetryKey((k) => k + 1)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-semibold text-[11px] hover:bg-amber-50 dark:hover:bg-slate-700 transition cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Search input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search files in Google Drive..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={!isOnline}
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white dark:focus:bg-slate-900 transition"
          />
        </div>

        {/* Files list */}
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {driveFiles.length > 0 ? (
            driveFiles.map((file) => {
              const isSelected = selectedBranch?.id === file.id;
              return (
                <button
                  key={file.id}
                  onClick={() => handleSelectBranchCandidate(file)}
                  className={`w-full text-left p-2.5 rounded-xl border transition flex items-center justify-between gap-2 cursor-pointer active:scale-98 ${
                    isSelected
                      ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-slate-950 dark:text-white font-bold'
                      : 'bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate leading-tight">{file.name}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      Owner: {file.owner} • Modified:{' '}
                      {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />}
                </button>
              );
            })
          ) : !isOnline ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-3 text-center">
              You are offline. Showing cached local branches below.
            </p>
          ) : isSearching ? (
            <p className="text-xs text-slate-400 py-3 text-center">Searching Google Drive...</p>
          ) : (
            <p className="text-xs text-slate-400 py-3 text-center">
              No spreadsheet files found matching your search.
            </p>
          )}
        </div>

        {/* Manual Spreadsheet ID / URL entry */}
        <form onSubmit={handleManualBranchSubmit} className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Or paste Google Spreadsheet URL / ID
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={manualIdInput}
              onChange={(e) => setManualIdInput(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="submit"
              disabled={!manualIdInput.trim()}
              className="px-3 py-1.5 text-xs font-semibold bg-slate-900 dark:bg-blue-600 text-white rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-40 cursor-pointer transition"
            >
              Open
            </button>
          </div>
        </form>
      </div>

      {/* 4. Locally Cached Branches */}
      {savedBranches.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-4 space-y-2 transition-colors animate-slide-up-fade-in-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            <span>Cached On Device ({savedBranches.length})</span>
          </h3>

          <div className="space-y-1.5">
            {savedBranches.map((sb) => {
              const isSelected = selectedBranch?.id === sb.id;
              return (
                <div
                  key={sb.id}
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition ${
                    isSelected
                      ? 'bg-amber-50/60 dark:bg-amber-950/40 border-amber-200 dark:border-amber-700/80'
                      : 'bg-slate-50/60 dark:bg-slate-800/60 border-slate-200/70 dark:border-slate-700/70'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{sb.name}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {sb.encodingCount.toLocaleString()} items cached
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSelectBranchCandidate(sb)}
                      className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-800 dark:text-slate-200 active:scale-95 transition cursor-pointer"
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      onClick={() => setBranchToRemove(sb)}
                      className="px-2.5 py-1 text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 rounded-lg text-rose-700 dark:text-rose-300 active:scale-95 transition cursor-pointer flex items-center gap-1"
                      title="Remove cached branch data from this device"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Remove Cached Branch Confirmation Modal */}
      {branchToRemove && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 flex items-center justify-center mx-auto mb-2">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Remove Cached Branch</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Are you sure you want to remove <strong className="text-slate-800 dark:text-slate-200">{branchToRemove.name}</strong> from this device?
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                All locally cached items and counts for this branch will be cleared. You can re-sync from Google Drive anytime.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setBranchToRemove(null)}
                disabled={isDeletingBranch}
                className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition cursor-pointer active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveBranch}
                disabled={isDeletingBranch}
                className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition shadow-sm cursor-pointer active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isDeletingBranch ? (
                  <span>Removing...</span>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role Claim Modal */}
      {claimRoleModalBranch && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-2">
                <UserCheck className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Branch Ownership Role</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Choose your role for <strong className="text-slate-800 dark:text-slate-200">{claimRoleModalBranch.name}</strong>
              </p>
            </div>

            {roleInfo?.hasOwner && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs text-amber-800 dark:text-amber-200">
                <p className="font-semibold">Registered Owner:</p>
                <p className="text-[11px] font-mono mt-0.5">{roleInfo.ownerEmail}</p>
              </div>
            )}

            {roleClaimError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{roleClaimError}</span>
              </div>
            )}

            <div className="space-y-2.5">
              {/* Option 1: Owner */}
              <button
                onClick={() => handleClaimRole('owner')}
                disabled={isClaimingRole}
                className="w-full text-left p-3.5 rounded-2xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/50 dark:bg-amber-950/30 hover:bg-amber-50 dark:hover:bg-amber-950/50 active:scale-98 transition flex items-start gap-3 cursor-pointer group"
              >
                <div className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">I am the Branch Owner</h4>
                    <span className="text-[10px] bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 px-1.5 py-0.2 rounded font-semibold">
                      Full Access
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                    First person to claim Owner becomes branch owner. Can create, edit, submit, and delete countsheets.
                  </p>
                </div>
              </button>

              {/* Option 2: Encoder */}
              <button
                onClick={() => handleClaimRole('encoder')}
                disabled={isClaimingRole}
                className="w-full text-left p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-98 transition flex items-start gap-3 cursor-pointer group"
              >
                <div className="w-8 h-8 rounded-xl bg-blue-500 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">I am an Encoder</h4>
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1.5 py-0.2 rounded font-semibold">
                      Auditor / Count
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                    Can create countsheets, scan barcodes, and submit items. Cannot delete existing countsheets.
                  </p>
                </div>
              </button>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setClaimRoleModalBranch(null)}
                disabled={isClaimingRole}
                className="w-full py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
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
