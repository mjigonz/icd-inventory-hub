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
} from 'lucide-react';
import {
  searchDriveSpreadsheets,
  DriveSpreadsheetFile,
  parseGoogleApiError,
} from '../services/googleSheets';
import {
  inspectSheetHeaders,
  fetchAllSheetRows,
  generateAutoMapping,
  duplicateSpreadsheet,
  executeAuditReportMapping,
  setupCountsheetHeadersInTemplate,
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
} from '../services/auditReportService';
import { SelectedBranch } from '../types';
import { googleSignIn } from '../services/auth';

interface CreateAuditReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  activeBranch: SelectedBranch | null;
  onBranchCreatedOrUpdated?: (branchId: string, branchName: string) => void;
  onTokenRefreshed?: (newToken: string) => void;
}

type WizardStep = 'SOURCE_IATD' | 'TARGET_TEMPLATE' | 'MAP_HEADERS' | 'SUCCESS';

export const CreateAuditReportModal: React.FC<CreateAuditReportModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  activeBranch,
  onBranchCreatedOrUpdated,
  onTokenRefreshed,
}) => {
  const [step, setStep] = useState<WizardStep>('SOURCE_IATD');

  // Drive files state
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>([]);
  const [isSearchingDrive, setIsSearchingDrive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
  const [countsheetCount, setCountsheetCount] = useState<number>(70);
  const [autoAdjustDimensions, setAutoAdjustDimensions] = useState<boolean>(true);

  // 3. Mapping State
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [iatdAllRows, setIatdAllRows] = useState<any[][]>([]);
  const [isLoadingAllIatd, setIsLoadingAllIatd] = useState(false);

  // 4. Execution State
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<string>('');
  const [executionResult, setExecutionResult] = useState<{
    spreadsheetId: string;
    spreadsheetName: string;
    totalRows: number;
    webViewLink: string;
  } | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareSuccessMsg, setShareSuccessMsg] = useState<string | null>(null);

  // 5. Recent Reports State
  const [recentReports, setRecentReports] = useState<RecentAuditReport[]>([]);
  const [isViewingRecent, setIsViewingRecent] = useState<boolean>(false);
  const [recentReportFilter, setRecentReportFilter] = useState<string>('');

  const handleSelectRecentReport = (item: RecentAuditReport) => {
    setExecutionResult({
      spreadsheetId: item.spreadsheetId,
      spreadsheetName: item.spreadsheetName,
      totalRows: item.totalRows,
      webViewLink: item.webViewLink,
    });
    setIsViewingRecent(true);
    setStep('SUCCESS');
  };

  const handleDeleteRecentReport = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = deleteRecentAuditReport(id);
    setRecentReports(updated);
  };

  // Quick Re-Authorize to get new Drive permissions
  const handleReauthorize = async () => {
    try {
      setIsExecuting(true);
      setExecutionProgress('Requesting Google permissions...');
      const res = await googleSignIn({ forceSelectAccount: true });
      if (res?.accessToken) {
        if (onTokenRefreshed) {
          onTokenRefreshed(res.accessToken);
        }
        setExecutionError(null);
        setExecutionProgress('Retrying audit report generation...');
        // Retry execution with new token
        setTimeout(() => {
          handleExecuteAuditReport(res.accessToken);
        }, 300);
      }
    } catch (err: any) {
      setExecutionError(err.message || 'Could not re-authenticate.');
    } finally {
      setIsExecuting(false);
    }
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

  // Search Drive files on modal open
  useEffect(() => {
    if (isOpen && accessToken) {
      setIsSearchingDrive(true);
      searchDriveSpreadsheets(accessToken, searchQuery)
        .then((files) => setDriveFiles(files))
        .catch((err) => console.warn('Could not fetch drive spreadsheets:', err))
        .finally(() => setIsSearchingDrive(false));
    }
  }, [isOpen, accessToken, searchQuery]);

  // Reset state & load recents when modal opens
  useEffect(() => {
    if (isOpen) {
      setRecentReports(getRecentAuditReports());
      setStep('SOURCE_IATD');
      setIsViewingRecent(false);
      setExecutionResult(null);
      setExecutionError(null);
      setIatdError(null);
      setTemplateError(null);
      if (activeBranch) {
        setTemplateInputId(activeBranch.id);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Inspect IATD Spreadsheet
  const handleInspectIatd = async (rawId: string, tabName?: string, customHeaderRow?: number) => {
    const cleanId = extractSpreadsheetId(rawId);
    if (!cleanId || !accessToken) return;

    const rowToUse = customHeaderRow ?? iatdHeaderRow;
    setIsLoadingIatd(true);
    setIatdError(null);

    try {
      const { tabs } = await getSpreadsheetTabs(accessToken, cleanId);
      setIatdTabs(tabs);

      const targetTab = tabName || (tabs.length > 0 ? tabs[0].title : undefined);
      if (targetTab) setSelectedIatdTab(targetTab);

      const inspection = await inspectSheetHeaders(accessToken, cleanId, targetTab, rowToUse);
      setIatdInspection(inspection);
      setIatdInputId(cleanId);

      // Set default new copy title based on IATD title
      const dateStr = new Date().toISOString().split('T')[0];
      setNewCopyTitle(`${inspection.spreadsheetTitle} - Audit Encoding (${dateStr})`);
    } catch (err: any) {
      console.error('Error inspecting IATD sheet:', err);
      setIatdError(err.message || 'Could not load IATD spreadsheet. Please check link/permissions.');
    } finally {
      setIsLoadingIatd(false);
    }
  };

  // Inspect ENCODING Template Spreadsheet (Default Header Row is Row 2)
  const handleInspectTemplate = async (rawId: string, tabName?: string, customHeaderRow?: number) => {
    const cleanId = extractSpreadsheetId(rawId);
    if (!cleanId || !accessToken) return;

    const rowToUse = customHeaderRow ?? templateHeaderRow;
    setIsLoadingTemplate(true);
    setTemplateError(null);

    try {
      const { tabs } = await getSpreadsheetTabs(accessToken, cleanId);
      setTemplateTabs(tabs);

      // Prefer ENCODING tab
      const encodingTab = tabs.find((t) =>
        t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('ENCOD')
      );
      const targetTab = tabName || (encodingTab ? encodingTab.title : tabs[0]?.title);
      if (targetTab) setSelectedTemplateTab(targetTab);

      // Inspect ENCODING with specified header row (defaults to Row 2)
      const inspection = await inspectSheetHeaders(accessToken, cleanId, targetTab, rowToUse);
      setTemplateInspection(inspection);
      setTemplateInputId(cleanId);
    } catch (err: any) {
      console.error('Error inspecting template sheet:', err);
      setTemplateError(err.message || 'Could not load template spreadsheet.');
    } finally {
      setIsLoadingTemplate(false);
    }
  };

  // Select fixed template type (OVERALL COUNT TEMPLATE or CESSATION OVERALL COUNT TEMPLATE)
  const handleSelectTemplateType = async (type: 'OVERALL COUNT TEMPLATE' | 'CESSATION OVERALL COUNT TEMPLATE') => {
    setSelectedTemplateType(type);
    if (!accessToken) return;

    setIsSearchingTemplates(true);
    setTemplateError(null);

    if (iatdInspection) {
      const dateStr = new Date().toISOString().split('T')[0];
      setNewCopyTitle(`${iatdInspection.spreadsheetTitle} - ${type} (${dateStr})`);
    }

    try {
      const files = await searchDriveSpreadsheets(accessToken, type);
      setMatchingTemplateFiles(files);

      if (files.length > 0) {
        handleInspectTemplate(files[0].id, undefined, templateHeaderRow);
      } else {
        setTemplateError(`No Google Drive spreadsheet found with title "${type}". You can paste the spreadsheet link or ID below.`);
      }
    } catch (err: any) {
      console.warn('Error searching template:', err);
      setTemplateError(`Could not find "${type}" in Google Drive: ${err.message || 'Check connection/permissions'}`);
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
    setStep('TARGET_TEMPLATE');
    handleSelectTemplateType(selectedTemplateType);
  };

  // Move from Step 2 (Template) to Step 3 (Mapping)
  const handleProceedToMapping = async () => {
    if (!templateInspection || templateInspection.headers.length === 0) {
      setTemplateError(`Please select a valid ENCODING template spreadsheet with headers in Row ${templateHeaderRow}.`);
      return;
    }

    if (!accessToken || !iatdInspection) return;

    setStep('MAP_HEADERS');
    setIsLoadingAllIatd(true);

    try {
      // 1. Fetch full data rows from IATD (row after header to end)
      const { headers: fullIatdHeaders, rows: allRows } = await fetchAllSheetRows(
        accessToken,
        iatdInspection.spreadsheetId,
        selectedIatdTab || iatdInspection.sheetTitle,
        iatdHeaderRow
      );

      setIatdAllRows(allRows);

      // 2. Generate auto mapping from IATD headers to ENCODING headers
      const autoMap = generateAutoMapping(
        fullIatdHeaders.length > 0 ? fullIatdHeaders : iatdInspection.headers,
        templateInspection.headers
      );
      setMapping(autoMap);
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
    const activeToken = tokenOverride || accessToken;
    if (!activeToken || !iatdInspection || !templateInspection) return;

    setIsExecuting(true);
    setExecutionError(null);

    try {
      let targetSpreadsheetId = templateInspection.spreadsheetId;
      let targetSpreadsheetName = templateInspection.spreadsheetTitle;

      // 1. If user chose to create a new copy of the template
      if (createAsCopy) {
        setExecutionProgress('Creating copy of ENCODING template spreadsheet in Google Drive...');
        const copyTitle = newCopyTitle.trim() || `${iatdInspection.spreadsheetTitle} - Audit Encoding`;
        const copyResult = await duplicateSpreadsheet(
          activeToken,
          templateInspection.spreadsheetId,
          copyTitle
        );
        targetSpreadsheetId = copyResult.id;
        targetSpreadsheetName = copyResult.name;
      }

      // 2. Populate mapped rows into the target ENCODING tab & adjust rows (add & delete)
      const dataStartRow = templateHeaderRow + 1;
      setExecutionProgress(
        `Writing mapped IATD rows into "${selectedTemplateTab || 'ENCODING'}" tab & adjusting sheet rows (Row ${dataStartRow} onwards)...`
      );

      const result = await executeAuditReportMapping(
        activeToken,
        targetSpreadsheetId,
        selectedTemplateTab || templateInspection.sheetTitle || 'ENCODING',
        templateInspection.headers,
        templateHeaderRow, // Header is Row 2 (or chosen header row)
        iatdInspection.headers,
        iatdAllRows,
        mapping,
        true, // Clear old rows from dataStartRow downwards
        autoAdjustDimensions // Add/delete rows and columns dynamically
      );

      // 3. If enabled, adjust CS01 to CS{N} columns (add/delete columns) after Remarks with space before Total Actual,
      // and update Total Actual formula (=SUM(CS01:CS{N})) for all rows!
      if (enableCountsheetCols && countsheetCount > 0) {
        setExecutionProgress(
          `Adjusting CS columns (adding/deleting CS01 to CS${String(countsheetCount).padStart(2, '0')}) and setting Total Actual formulas...`
        );
        try {
          await setupCountsheetHeadersInTemplate(
            activeToken,
            targetSpreadsheetId,
            selectedTemplateTab || templateInspection.sheetTitle || 'ENCODING',
            templateHeaderRow,
            countsheetCount,
            result.totalRowsWritten,
            autoAdjustDimensions
          );
        } catch (csErr) {
          console.warn('Countsheet columns setup notice:', csErr);
        }
      }

      if (!createAsCopy && newCopyTitle.trim()) {
        targetSpreadsheetName = newCopyTitle.trim();
      }

      const finalResult = {
        spreadsheetId: result.spreadsheetId,
        spreadsheetName: targetSpreadsheetName,
        totalRows: result.totalRowsWritten,
        webViewLink: result.webViewLink,
      };

      setExecutionResult(finalResult);

      // Save to recent audit reports list
      saveRecentAuditReport({
        spreadsheetId: result.spreadsheetId,
        spreadsheetName: targetSpreadsheetName,
        totalRows: result.totalRowsWritten,
        webViewLink: result.webViewLink,
        iatdTitle: iatdInspection.spreadsheetTitle,
        templateTitle: templateInspection.spreadsheetTitle,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#161618] rounded-3xl border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200/90 dark:border-zinc-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
                <span>Create Audit Report</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-semibold">
                  IATD &rarr; ENCODING
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Map Row 2 headers &amp; transfer data from IATD into your ENCODING template (formulas protected).
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator Bar */}
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

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* STEP 1: SELECT IATD SPREADSHEET */}
          {step === 'SOURCE_IATD' && (
            <div className="space-y-4 animate-in fade-in">
              {/* Recent Generated Audit Reports Section */}
              {recentReports.length > 0 && (
                <div className="p-3.5 bg-gradient-to-r from-indigo-500/10 via-indigo-500/5 to-transparent dark:from-indigo-950/30 dark:via-indigo-950/10 dark:to-transparent border border-indigo-500/20 rounded-2xl space-y-2.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>Recent Generated Reports</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-bold">
                            {recentReports.length}
                          </span>
                        </span>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Click any report to view again, copy link, share, or set active branch
                        </p>
                      </div>
                    </div>

                    {recentReports.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Clear all recent audit report history?')) {
                            clearRecentAuditReports();
                            setRecentReports([]);
                          }
                        }}
                        className="text-[10px] font-semibold text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 px-2 py-1 rounded-lg hover:bg-rose-500/10 transition cursor-pointer"
                      >
                        Clear all
                      </button>
                    )}
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
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-thin">
                    {recentReports
                      .filter((r) =>
                        recentReportFilter
                          ? r.spreadsheetName.toLowerCase().includes(recentReportFilter.toLowerCase()) ||
                            (r.iatdTitle && r.iatdTitle.toLowerCase().includes(recentReportFilter.toLowerCase()))
                          : true
                      )
                      .map((report) => {
                        const dateStr = new Date(report.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        });

                        return (
                          <div
                            key={report.id}
                            onClick={() => handleSelectRecentReport(report)}
                            className="p-2.5 bg-white dark:bg-zinc-800/90 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30 border border-slate-200/90 dark:border-zinc-700/80 hover:border-indigo-300 rounded-xl transition cursor-pointer flex items-center justify-between gap-2 group shadow-2xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span className="truncate">{report.spreadsheetName}</span>
                              </div>

                              <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.2 rounded">
                                  {report.totalRows.toLocaleString()} items
                                </span>
                                <span>•</span>
                                <span>{dateStr}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleSelectRecentReport(report)}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10.5px] font-bold rounded-lg flex items-center gap-1 shadow-2xs active:scale-95 transition cursor-pointer"
                                title="View report options & share links"
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
                </div>
              )}

              <div className="bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 rounded-2xl p-3.5 text-xs text-slate-800 dark:text-slate-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                  <Database className="w-4 h-4 shrink-0" />
                  <span>Step 1: Choose IATD Source Spreadsheet</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  Select the source IATD file. The app reads header names from <strong>Row {iatdHeaderRow}</strong> and will import all data records from <strong>Row {iatdHeaderRow + 1} to the end</strong>.
                </p>
              </div>

              {/* Header Row Selector for IATD */}
              <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  IATD Header Row:
                </span>
                <div className="flex gap-1">
                  {[2, 1].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setIatdHeaderRow(r);
                        if (iatdInputId) {
                          handleInspectIatd(iatdInputId, selectedIatdTab, r);
                        }
                      }}
                      className={`px-3 py-1 rounded-lg font-bold text-xs cursor-pointer transition ${
                        iatdHeaderRow === r
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white dark:bg-zinc-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Row {r} {r === 2 ? '(Default)' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input ID or URL */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Paste IATD Spreadsheet Link or ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://docs.google.com/spreadsheets/d/... or Spreadsheet ID"
                    value={iatdInputId}
                    onChange={(e) => setIatdInputId(e.target.value)}
                    className="flex-1 text-xs px-3 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={() => handleInspectIatd(iatdInputId, selectedIatdTab, iatdHeaderRow)}
                    disabled={!iatdInputId.trim() || isLoadingIatd}
                    className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 cursor-pointer shrink-0"
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

              {iatdError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{iatdError}</span>
                </div>
              )}

              {/* Quick Pick from Google Drive */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Or select from your Google Drive files:
                  </span>
                  <div className="relative w-40">
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

                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-2xl">
                  {isSearchingDrive ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-indigo-500" />
                      Loading Drive spreadsheets...
                    </div>
                  ) : driveFiles.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      No spreadsheets found matching "{searchQuery}"
                    </div>
                  ) : (
                    driveFiles.map((file) => {
                      const isSelected = iatdInspection?.spreadsheetId === file.id;
                      return (
                        <div
                          key={file.id}
                          onClick={() => handleInspectIatd(file.id, selectedIatdTab, iatdHeaderRow)}
                          className={`p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-zinc-800/60 cursor-pointer transition ${
                            isSelected ? 'bg-indigo-50/60 dark:bg-indigo-950/30 border-l-4 border-indigo-600' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <span>{file.name}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              Owner: {file.owner || 'You'}
                            </div>
                          </div>
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
                      );
                    })
                  )}
                </div>
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
                        <select
                          value={selectedIatdTab}
                          onChange={(e) => {
                            setSelectedIatdTab(e.target.value);
                            handleInspectIatd(iatdInspection.spreadsheetId, e.target.value, iatdHeaderRow);
                          }}
                          className="text-xs font-bold bg-white dark:bg-zinc-700 border border-slate-200 dark:border-zinc-600 rounded-lg px-2 py-1 text-slate-900 dark:text-white"
                        >
                          {iatdTabs.map((t) => (
                            <option key={t.sheetId} value={t.title}>
                              {t.title}
                            </option>
                          ))}
                        </select>
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
            </div>
          )}

          {/* STEP 2: SELECT AUDIT TEMPLATE SPREADSHEET */}
          {step === 'TARGET_TEMPLATE' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-2xl p-3.5 text-xs text-blue-900 dark:text-blue-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Table className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Step 2: Choose Audit Template</span>
                </div>
                <p className="text-[11px] text-blue-800/90 dark:text-blue-300/90 leading-relaxed">
                  Select your audit template (**OVERALL COUNT TEMPLATE** or **CESSATION OVERALL COUNT TEMPLATE**). Headers are configured in <strong>Row {templateHeaderRow}</strong>.
                </p>
              </div>

              {/* Fixed Template Selection Cards */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  Select Audit Template:
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Template Option 1: OVERALL COUNT TEMPLATE */}
                  <button
                    type="button"
                    onClick={() => handleSelectTemplateType('OVERALL COUNT TEMPLATE')}
                    className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                      selectedTemplateType === 'OVERALL COUNT TEMPLATE'
                        ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-600 text-slate-900 dark:text-white ring-2 ring-indigo-500/20 shadow-xs'
                        : 'bg-slate-50 dark:bg-zinc-800/60 border-slate-200 dark:border-zinc-700 hover:border-slate-300 dark:hover:border-zinc-600 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold shrink-0 ${
                          selectedTemplateType === 'OVERALL COUNT TEMPLATE'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-slate-300'
                        }`}>
                          <FileSpreadsheet className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-snug">OVERALL COUNT TEMPLATE</div>
                          <span className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">
                            Standard Audit
                          </span>
                        </div>
                      </div>
                      {selectedTemplateType === 'OVERALL COUNT TEMPLATE' && (
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      )}
                    </div>
                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Standard overall count template for branch inventory compliance &amp; encoding.
                    </p>
                  </button>

                  {/* Template Option 2: CESSATION OVERALL COUNT TEMPLATE */}
                  <button
                    type="button"
                    onClick={() => handleSelectTemplateType('CESSATION OVERALL COUNT TEMPLATE')}
                    className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                      selectedTemplateType === 'CESSATION OVERALL COUNT TEMPLATE'
                        ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-600 text-slate-900 dark:text-white ring-2 ring-indigo-500/20 shadow-xs'
                        : 'bg-slate-50 dark:bg-zinc-800/60 border-slate-200 dark:border-zinc-700 hover:border-slate-300 dark:hover:border-zinc-600 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold shrink-0 ${
                          selectedTemplateType === 'CESSATION OVERALL COUNT TEMPLATE'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-slate-300'
                        }`}>
                          <Layers className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-snug">CESSATION OVERALL COUNT TEMPLATE</div>
                          <span className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">
                            Cessation / Store Closure
                          </span>
                        </div>
                      </div>
                      {selectedTemplateType === 'CESSATION OVERALL COUNT TEMPLATE' && (
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      )}
                    </div>
                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Cessation audit template for store closure / cessation inventory compliance.
                    </p>
                  </button>
                </div>
              </div>

              {/* Display matching Drive template file if found */}
              {isSearchingTemplates ? (
                <div className="p-4 text-center text-xs text-slate-400 space-y-1.5 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl border border-slate-200 dark:border-zinc-800">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto text-indigo-500" />
                  <p>Searching Google Drive for "{selectedTemplateType}"...</p>
                </div>
              ) : matchingTemplateFiles.length > 0 ? (
                <div className="p-3 bg-slate-50 dark:bg-zinc-800/80 rounded-2xl border border-slate-200 dark:border-zinc-700 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Matching Template Spreadsheet Found in Drive:</span>
                    </span>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                      {matchingTemplateFiles.length} file{matchingTemplateFiles.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {matchingTemplateFiles.map((file) => {
                      const isSelected = templateInspection?.spreadsheetId === file.id;
                      return (
                        <div
                          key={file.id}
                          onClick={() => handleInspectTemplate(file.id, selectedTemplateTab, templateHeaderRow)}
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

              {/* Fallback Paste ID / URL */}
              <div className="p-3 bg-slate-50 dark:bg-zinc-800/60 rounded-2xl border border-slate-200 dark:border-zinc-700 space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Or paste direct Google Sheet link/ID for {selectedTemplateType}:
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://docs.google.com/spreadsheets/d/... or Spreadsheet ID"
                    value={templateInputId}
                    onChange={(e) => setTemplateInputId(e.target.value)}
                    className="flex-1 text-xs px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={() => handleInspectTemplate(templateInputId, selectedTemplateTab, templateHeaderRow)}
                    disabled={!templateInputId.trim() || isLoadingTemplate}
                    className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {isLoadingTemplate ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    <span>Inspect</span>
                  </button>
                </div>
              </div>

              {templateError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <span>{templateError}</span>
                </div>
              )}

              {/* Header Row Selector for Audit Template */}
              <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Audit Template Header Row:
                </span>
                <div className="flex gap-1">
                  {[2, 1].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setTemplateHeaderRow(r);
                        if (templateInputId) {
                          handleInspectTemplate(templateInputId, selectedTemplateTab, r);
                        }
                      }}
                      className={`px-3 py-1 rounded-lg font-bold text-xs cursor-pointer transition ${
                        templateHeaderRow === r
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white dark:bg-zinc-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Row {r} {r === 2 ? '(Template Default)' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Report Generation Mode: Duplicate as New Copy vs Direct Update */}
              <div className="p-3 bg-slate-50 dark:bg-zinc-800/70 border border-slate-200 dark:border-zinc-700 rounded-2xl space-y-2">
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  Report Generation Mode:
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateAsCopy(true)}
                    className={`p-2.5 rounded-xl text-left border transition cursor-pointer ${
                      createAsCopy
                        ? 'bg-white dark:bg-zinc-800 border-indigo-600 text-slate-900 dark:text-white ring-2 ring-indigo-500/20'
                        : 'bg-transparent border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <Copy className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>Create New Copy</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                      Duplicates chosen template into a new Google Sheet (Recommended)
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreateAsCopy(false)}
                    className={`p-2.5 rounded-xl text-left border transition cursor-pointer ${
                      !createAsCopy
                        ? 'bg-white dark:bg-zinc-800 border-indigo-600 text-slate-900 dark:text-white ring-2 ring-indigo-500/20'
                        : 'bg-transparent border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <FileCheck className="w-3.5 h-3.5 text-blue-500" />
                      <span>Update Template</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                      Writes directly into selected template spreadsheet (Row {templateHeaderRow + 1}+)
                    </p>
                  </button>
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

              {/* Countsheet Columns Generator (CS01 - CS{N} after Remarks, space before Total Actual) */}
              <div className="p-3.5 bg-slate-50 dark:bg-zinc-800/70 border border-slate-200 dark:border-zinc-700 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Countsheet Columns Setup
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={enableCountsheetCols}
                      onChange={(e) => setEnableCountsheetCols(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span>Generate in Sheet</span>
                  </label>
                </div>

                {enableCountsheetCols && (
                  <div className="space-y-2 pt-1 border-t border-slate-200/80 dark:border-zinc-700/80">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Total Countsheets (e.g. 70):
                        </label>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          Generates <strong>CS01</strong> to <strong>CS{String(countsheetCount).padStart(2, '0')}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="1"
                          max="150"
                          value={countsheetCount}
                          onChange={(e) => setCountsheetCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          className="w-20 text-center font-mono font-bold text-sm px-2 py-1.5 bg-white dark:bg-zinc-700 border border-slate-300 dark:border-zinc-600 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <span className="text-xs font-semibold text-slate-500">sheets</span>
                      </div>
                    </div>

                    {/* Column order layout diagram */}
                    <div className="p-2 bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-700/80 rounded-xl text-[10.5px] font-mono text-slate-700 dark:text-slate-300 flex items-center gap-1 overflow-x-auto scrollbar-thin">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-bold text-slate-800 dark:text-slate-200 shrink-0">
                        Remarks
                      </span>
                      <span className="text-slate-400">&rarr;</span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 font-bold shrink-0">
                        CS01 ... CS{String(countsheetCount).padStart(2, '0')}
                      </span>
                      <span className="text-slate-400">&rarr;</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 border border-dashed border-slate-300 dark:border-zinc-600 text-slate-500 shrink-0">
                        (Space)
                      </span>
                      <span className="text-slate-400">&rarr;</span>
                      <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 font-bold shrink-0">
                        Total Actual
                      </span>
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
                      <select
                        value={selectedTemplateTab}
                        onChange={(e) => {
                          setSelectedTemplateTab(e.target.value);
                          handleInspectTemplate(templateInspection.spreadsheetId, e.target.value, templateHeaderRow);
                        }}
                        className="text-xs font-bold bg-white dark:bg-zinc-700 border border-slate-200 dark:border-zinc-600 rounded-lg px-2 py-1 text-slate-900 dark:text-white"
                      >
                        {templateTabs.map((t) => (
                          <option key={t.sheetId} value={t.title}>
                            {t.title}
                          </option>
                        ))}
                      </select>
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
            <div className="space-y-4 animate-in fade-in">
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

              {/* Formula & Template Safety Banner */}
              <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 text-xs">
                <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Formula &amp; Template Protection Active</div>
                  <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5 leading-relaxed">
                    Data will be written <strong>strictly into mapped columns</strong> (e.g. Barcode in Col {numberToColumnLetter(templateInspection?.headers.findIndex((h) => /bar/i.test(h)) ?? 14)}). All unmapped columns containing formulas, calculations, and custom formats in your ENCODING template are completely preserved.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between bg-indigo-50/70 dark:bg-indigo-950/30 p-3 rounded-2xl border border-indigo-200 dark:border-indigo-800/50">
                <div className="text-xs text-slate-900 dark:text-white">
                  <div className="font-bold flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Header Column Mapping (Row {templateHeaderRow} in ENCODING &larr; Row {iatdHeaderRow} in IATD)</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    Match each column in <strong>ENCODING</strong> with its source column in <strong>IATD</strong>.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAutoMap}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold active:scale-95 transition shadow-xs flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Auto-Match</span>
                </button>
              </div>

              {isLoadingAllIatd ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-500" />
                  <p>Loading {iatdInspection?.totalRows || 0} rows from IATD spreadsheet...</p>
                </div>
              ) : (
                <>
                  {/* Mapping List */}
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {templateInspection?.headers.map((encHeader, colIdx) => {
                      if (!encHeader) return null;
                      const mappedIatd = mapping[encHeader] ?? null;
                      const isMatched = !!mappedIatd;
                      const encColLetter = numberToColumnLetter(colIdx);

                      return (
                        <div
                          key={`enc_col_${colIdx}_${encHeader}`}
                          className={`p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition ${
                            isMatched
                              ? 'bg-slate-50 dark:bg-zinc-800/60 border-slate-200 dark:border-zinc-700'
                              : 'bg-indigo-50/30 dark:bg-indigo-950/20 border-indigo-200/80 dark:border-indigo-800/50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 sm:w-1/2">
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 shrink-0">
                              Col {encColLetter}
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {encHeader}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 sm:w-1/2 justify-end">
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0 hidden sm:block" />
                            <select
                              value={mappedIatd || ''}
                              onChange={(e) => {
                                const val = e.target.value || null;
                                setMapping((prev) => ({
                                  ...prev,
                                  [encHeader]: val,
                                }));
                              }}
                              className={`w-full text-xs font-semibold px-2.5 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                isMatched
                                  ? 'bg-white dark:bg-zinc-700 border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white font-medium'
                                  : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 text-indigo-900 dark:text-indigo-200 font-semibold'
                              }`}
                            >
                              <option value="">— Skip / Keep Formulas Intact —</option>
                              {iatdInspection?.headers.map((iatdH, i) => (
                                <option key={`iatd_opt_${i}_${iatdH}`} value={iatdH}>
                                  Col {numberToColumnLetter(i)}: {iatdH || `Column ${i + 1}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Live Sample Preview Table */}
                  {iatdAllRows.length > 0 && templateInspection && (
                    <div className="border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
                      <div className="bg-slate-100 dark:bg-zinc-800 px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                        <span>Preview Mapped Output (First 3 Data Rows)</span>
                        <span className="text-[10px] text-slate-500 font-normal">
                          Total: {iatdAllRows.length} rows to write (Starting at Row {templateHeaderRow + 1})
                        </span>
                      </div>
                      <div className="overflow-x-auto max-h-36 scrollbar-thin">
                        <table className="w-full text-[10px] text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-700 font-bold text-slate-800 dark:text-slate-200">
                              <th className="p-1.5 border-r border-slate-200 dark:border-zinc-800">Row #</th>
                              {templateInspection.headers.map((h, idx) => (
                                <th key={`preview_head_${idx}_${h}`} className="p-1.5 border-r border-slate-200 dark:border-zinc-800 whitespace-nowrap">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {iatdAllRows.slice(0, 3).map((row, rIdx) => {
                              const iatdIndexMap = new Map<string, number>();
                              iatdInspection?.headers.forEach((h, i) => iatdIndexMap.set(h, i));

                              return (
                                <tr key={`preview_row_${rIdx}`} className="border-b border-slate-100 dark:border-zinc-800/60 font-mono">
                                  <td className="p-1.5 text-slate-400 font-sans border-r border-slate-200 dark:border-zinc-800 font-bold">
                                    Row {templateHeaderRow + 1 + rIdx}
                                  </td>
                                  {templateInspection.headers.map((encHeader, cIdx) => {
                                    const mappedIatd = mapping[encHeader];
                                    let val = '';
                                    if (mappedIatd && iatdIndexMap.has(mappedIatd)) {
                                      const srcIdx = iatdIndexMap.get(mappedIatd)!;
                                      val = row[srcIdx] !== undefined ? String(row[srcIdx]) : '';
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
                      {(executionError.toLowerCase().includes('scope') ||
                        executionError.toLowerCase().includes('insufficient') ||
                        executionError.toLowerCase().includes('permission') ||
                        executionError.includes('403')) && (
                        <div className="pt-2 border-t border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-rose-800 dark:text-rose-300 font-medium">
                            Tap to refresh sign-in with the new Google Drive permissions:
                          </span>
                          <button
                            type="button"
                            onClick={handleReauthorize}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 active:scale-95 transition cursor-pointer shrink-0 shadow-xs"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Re-Authorize Drive</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 4: SUCCESS SUMMARY */}
          {step === 'SUCCESS' && executionResult && (
            <div className="py-2 space-y-4 animate-in zoom-in-95 duration-200">
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
        </div>

        {/* Modal Footer Navigation */}
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
              <button
                onClick={handleProceedToMapping}
                disabled={!templateInspection || templateInspection.headers.length === 0}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <span>Next: Review Column Mapping</span>
                <ChevronRight className="w-4 h-4" />
              </button>
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
                    <span>Generate ENCODING Data</span>
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
      </div>
    </div>
  );
};
