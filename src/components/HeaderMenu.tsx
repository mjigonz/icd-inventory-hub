import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Sun,
  Moon,
  LogOut,
  RefreshCw,
  X,
  Camera,
  FileSpreadsheet,
  QrCode,
  ClipboardList,
  Sparkles,
  Settings,
  ArrowLeft,
  User,
  Wrench,
  Palette,
  Smartphone,
  Shield,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Lock,
  Check,
  AlertCircle,
  Trash2,
  RotateCcw,
  ExternalLink,
  Search,
  Clock,
  Monitor,
  Calendar,
  Play,
  ChevronDown,
  Globe,
  FileText,
} from 'lucide-react';
import { ThemeMode, AppearanceMode } from '../hooks/useTheme';
import { SelectedBranch } from '../types';
import { ChangePhotoModal } from './ChangePhotoModal';
import {
  BACKGROUND_ICON_THEMES,
  BackgroundIconTheme,
  CharacterDensity,
  getAutoSeasonalTheme,
} from './TelegramDoodleBackground';
import {
  PanelDecoration,
  useDecorationSettings,
} from './PanelDecoration';
import {
  getTrashItems,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  emptyTrash,
  subscribeToTrash,
  TrashItem,
} from '../services/auditReportService';
import { useLanguage, LANGUAGE_OPTIONS } from '../services/i18n';

interface HeaderMenuProps {
  theme: ThemeMode;
  appearanceMode?: AppearanceMode;
  onSetAppearanceMode?: (mode: AppearanceMode) => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
  onSwitchEmail?: () => void;
  isGoogleConnected?: boolean;
  onConnectGoogle?: () => void;
  userEmail?: string | null;
  userName?: string | null;
  userPhoto?: string | null;
  googlePhoto?: string | null;
  onUpdatePhoto?: (newPhotoURL: string | null) => void;
  userRole?: 'owner' | 'encoder' | 'unassigned';
  branch?: SelectedBranch | null;
  onInstallClick?: () => void;
  isInstallable?: boolean;
  onOpenCreateAuditReport?: (type?: 'random') => void;
  onOpenCreateCountsheets?: (type?: 'random') => void;
  onOpenForms?: () => void;
  onOpenShare?: () => void;
  backgroundTheme?: BackgroundIconTheme;
  onSelectBackgroundTheme?: (theme: BackgroundIconTheme) => void;
  isAdminMode?: boolean;
  isUserAdmin?: boolean;
  onToggleAdminMode?: (enabled: boolean) => void;
  onOpenAdminPanel?: () => void;
}

const DEFAULT_ADMIN_CODES = ['ICD2026', 'SIDC2026', 'ADMIN', '1234'];

export const HeaderMenu: React.FC<HeaderMenuProps> = ({
  theme,
  appearanceMode = 'system',
  onSetAppearanceMode,
  onToggleTheme,
  onSignOut,
  onSwitchEmail,
  isGoogleConnected = true,
  onConnectGoogle,
  userEmail,
  userName,
  userPhoto,
  googlePhoto,
  onUpdatePhoto,
  userRole = 'unassigned',
  branch,
  onInstallClick,
  isInstallable = false,
  onOpenCreateAuditReport,
  onOpenCreateCountsheets,
  onOpenForms,
  onOpenShare,
  backgroundTheme = 'default',
  onSelectBackgroundTheme,
  isAdminMode = false,
  isUserAdmin = false,
  onToggleAdminMode,
  onOpenAdminPanel,
}) => {
  const {
    activeTheme,
    seasonalDecorations,
    characterDensity,
    characterAnimation,
    autoSeasonalTheme,
    motionPreference = 'smooth',
    onSetSeasonalDecorations,
    onSetCharacterDensity,
    onSetCharacterAnimation,
    onSetAutoSeasonalTheme,
    onSetMotionPreference,
  } = useDecorationSettings();
  const { language, setLanguage, t, currentLanguageMeta } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<'menu' | 'settings' | 'trash'>('menu');
  const [isThemeBoxOpen, setIsThemeBoxOpen] = useState(false);
  const [isLanguageBoxOpen, setIsLanguageBoxOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Trash state (30-day retention for deleted recents)
  const [trashItems, setTrashItems] = useState<TrashItem[]>(() => getTrashItems());
  const [trashSearchQuery, setTrashSearchQuery] = useState('');
  const [trashTypeFilter, setTrashTypeFilter] = useState<'all' | 'countsheet' | 'audit_report'>('all');
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [restoredToastMsg, setRestoredToastMsg] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToTrash((items) => {
      setTrashItems(items);
    });
  }, []);

  const handleRestoreItem = async (trashId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const targetItem = trashItems.find((i) => i.trashId === trashId);
    const success = await restoreTrashItem(trashId);
    setTrashItems(getTrashItems());
    if (success) {
      const label = targetItem?.title ? `"${targetItem.title}"` : 'Item';
      setRestoredToastMsg(`Restored ${label} back to Recents!`);
      setTimeout(() => setRestoredToastMsg(null), 3500);
    }
  };

  const handleDeletePermanently = (trashId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const updated = permanentlyDeleteTrashItem(trashId);
    setTrashItems(updated);
  };

  const handleEmptyAllTrash = () => {
    emptyTrash();
    setTrashItems([]);
    setConfirmEmptyTrash(false);
  };

  // Admin code state
  const [adminCodeInput, setAdminCodeInput] = useState('');
  const [adminCodeError, setAdminCodeError] = useState<string | null>(null);
  const [adminCodeSuccess, setAdminCodeSuccess] = useState<string | null>(null);
  const [isChangingAdminCode, setIsChangingAdminCode] = useState(false);
  const [newCustomAdminCode, setNewCustomAdminCode] = useState('');
  const adminInputRef = useRef<HTMLInputElement | null>(null);

  const handleVerifyAdminCode = (e: React.FormEvent) => {
    e.preventDefault();
    setAdminCodeError(null);
    setAdminCodeSuccess(null);

    const trimmed = adminCodeInput.trim();
    if (!trimmed) {
      setAdminCodeError('Please enter an admin access code.');
      return;
    }

    let customCode = '';
    try {
      customCode = (localStorage.getItem('countsheet_custom_admin_code') || '').trim();
    } catch {
      // ignore storage errors
    }

    const isValid =
      (customCode && trimmed.toLowerCase() === customCode.toLowerCase()) ||
      DEFAULT_ADMIN_CODES.some((code) => code.toLowerCase() === trimmed.toLowerCase());

    if (isValid) {
      setAdminCodeInput('');
      setAdminCodeSuccess('Admin Mode unlocked! Full administrative access enabled.');
      onToggleAdminMode?.(true);
      setTimeout(() => setAdminCodeSuccess(null), 4000);
    } else {
      setAdminCodeError('Invalid admin access code. Please try again.');
    }
  };

  const handleSaveCustomAdminCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newCustomAdminCode.trim();
    if (cleaned.length < 4) {
      setAdminCodeError('Custom admin code must be at least 4 characters.');
      return;
    }
    try {
      localStorage.setItem('countsheet_custom_admin_code', cleaned);
    } catch {
      // ignore storage errors
    }
    setNewCustomAdminCode('');
    setIsChangingAdminCode(false);
    setAdminCodeError(null);
    setAdminCodeSuccess('Custom admin code updated.');
    setTimeout(() => setAdminCodeSuccess(null), 3500);
  };

  const touchStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape key & lock body scroll smoothly
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    let resetViewTimer: number | null = null;
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      // Wait for sidebar exit animation (420ms) before releasing scroll lock & resetting internal drawer view
      resetViewTimer = window.setTimeout(() => {
        document.body.style.overflow = '';
        setCurrentView('menu');
        setIsThemeBoxOpen(false);
        setIsLanguageBoxOpen(false);
      }, 420);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (resetViewTimer !== null) {
        window.clearTimeout(resetViewTimer);
      }
    };
  }, [isOpen]);

  // Touch swipe-right-to-close handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!e.changedTouches?.[0]) return;
    const diffX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const diffY = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y);

    if (diffX > 60 && diffX > diffY * 1.2) {
      if (currentView === 'settings' || currentView === 'trash') {
        setCurrentView('menu');
      } else {
        setIsOpen(false);
      }
    }
  };

  const handleSignOutClick = () => {
    setIsOpen(false);
    onSignOut();
  };

  const displayName = userName || (userEmail ? userEmail.split('@')[0] : 'Compliance Dept');

  const drawerContent = (
    <div
      className={`fixed inset-0 z-[90] overflow-hidden ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      style={{
        visibility: isOpen ? 'visible' : 'hidden',
        transition: isOpen ? 'visibility 0ms linear 0ms' : 'visibility 0ms linear 420ms',
      }}
      aria-hidden={!isOpen}
    >
      {/* Translucent Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-[2px] drawer-backdrop ${
          isOpen ? 'drawer-backdrop-open pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Right Slide-Over Drawer Panel */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: isOpen ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)',
          transition: 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className={`fixed inset-y-0 right-0 h-screen h-[100dvh] w-[86vw] sm:w-96 max-w-[380px] bg-white/98 dark:bg-slate-900/98 backdrop-blur-xl text-slate-900 dark:text-slate-100 shadow-[-16px_0_48px_rgba(15,23,42,0.16)] dark:shadow-[-20px_0_60px_rgba(0,0,0,0.65)] border-l border-slate-200/90 dark:border-zinc-800/90 flex flex-col justify-between z-50 drawer-panel-right ${
          isOpen ? 'drawer-panel-right-open' : ''
        }`}
        role="dialog"
        aria-modal={isOpen}
        aria-label="Account and Settings Menu"
      >
        {/* Sidebar-edge attached seasonal decorations (hanging vines / dangling ornaments / peeking characters) */}
        <PanelDecoration position="sidebar-edge" tier="major" variant={0} />
        <PanelDecoration position="sidebar-edge" tier="secondary" variant={1} />
        <PanelDecoration position="sidebar-edge" tier="playful" variant={3} />

        {/* Subtle left-edge swipe indicator pill on mobile */}
        <div className="sm:hidden absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full bg-slate-200/80 dark:bg-zinc-700/60 pointer-events-none" />

        {/* Top Header Section */}
        {currentView === 'menu' ? (
          <div className="drawer-stagger-item drawer-stagger-1 p-4 bg-slate-50/90 dark:bg-zinc-800/70 border-b border-slate-200/90 dark:border-zinc-800 flex items-start justify-between gap-2.5 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {/* Profile Avatar */}
              <div className="relative shrink-0">
                {userPhoto ? (
                  <img
                    src={userPhoto}
                    alt={displayName}
                    className="w-10 h-10 rounded-full object-cover border-2 border-zinc-400 dark:border-zinc-600 shadow-xs transition-transform duration-200 hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 dark:bg-zinc-700 text-white flex items-center justify-center font-bold text-base shrink-0 shadow-xs">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                  <span className="truncate">{displayName}</span>
                  {isAdminMode && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] uppercase font-extrabold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      <span>Admin</span>
                    </span>
                  )}
                </div>
                <div className="text-[10.5px] sm:text-xs text-slate-500 dark:text-slate-400 truncate font-mono">
                  {userEmail || 'Local session'}
                </div>
                {!isGoogleConnected && (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                      <Lock className="w-2.5 h-2.5" />
                      <span>Guest Mode (Google Not Linked)</span>
                    </span>
                    {onConnectGoogle && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsOpen(false);
                          onConnectGoogle();
                        }}
                        className="text-[9.5px] font-bold px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white transition cursor-pointer shadow-2xs"
                      >
                        Link Google
                      </button>
                    )}
                  </div>
                )}
                {branch && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 truncate max-w-[130px] sm:max-w-[160px]">
                      {branch.name}
                    </span>
                    {(userRole !== 'unassigned' || isAdminMode) && (
                      <span className="text-[8.5px] uppercase font-bold px-1.5 py-0.2 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 shrink-0">
                        {isAdminMode ? 'admin' : userRole}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-zinc-700/70 transition-all duration-200 cursor-pointer active:scale-90 hover:rotate-90 shrink-0"
              title="Close menu"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        ) : currentView === 'trash' ? (
          <div className="drawer-stagger-item drawer-stagger-1 p-3.5 sm:p-4 bg-slate-50/90 dark:bg-zinc-800/70 border-b border-slate-200/90 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCurrentView('menu')}
              className="flex items-center gap-2 px-2 py-1 -ml-1 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-zinc-700/70 text-xs font-bold transition active:scale-95 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Menu</span>
            </button>

            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
              <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <span>Trash ({trashItems.length})</span>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-zinc-700/70 transition-all duration-200 cursor-pointer active:scale-90 shrink-0"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="drawer-stagger-item drawer-stagger-1 p-3.5 sm:p-4 bg-slate-50/90 dark:bg-zinc-800/70 border-b border-slate-200/90 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCurrentView('menu')}
              className="flex items-center gap-2 px-2 py-1 -ml-1 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-zinc-700/70 text-xs font-bold transition active:scale-95 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t.menuTitle}</span>
            </button>

            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
              <Settings className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>{t.settingsTitle}</span>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-zinc-700/70 transition-all duration-200 cursor-pointer active:scale-90 shrink-0"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scrollable Middle Content */}
        {currentView === 'menu' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4 space-y-4 scrollbar-thin">
            {/* Section: Reports */}
            {(onOpenCreateAuditReport || onOpenCreateCountsheets) && (
              <div className="drawer-stagger-item drawer-stagger-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 mb-1.5 flex items-center justify-between">
                  <span>{t.reportsSection}</span>
                </div>
                <div className="space-y-1.5">
                  {onOpenCreateAuditReport && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        onOpenCreateAuditReport();
                      }}
                      title={t.createEncodingTitle}
                      className="w-full text-left px-3 py-2.5 rounded-xl border border-transparent hover:bg-blue-50/80 dark:hover:bg-blue-950/40 hover:border-blue-200 dark:hover:border-blue-800/60 transition-all duration-200 flex items-center justify-between gap-2 group cursor-pointer active:scale-98"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                          <FileSpreadsheet className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5">
                            <span className="truncate">{t.createEncodingTitle}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {t.createEncodingSubtitle}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-blue-600 dark:text-blue-400 group-hover:translate-x-1 transition-transform duration-200 shrink-0 font-bold">&rarr;</span>
                    </button>
                  )}

                  {/* Create Countsheet Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      if (onOpenCreateCountsheets) {
                        onOpenCreateCountsheets('random');
                      } else if (onOpenCreateAuditReport) {
                        onOpenCreateAuditReport('random');
                      }
                    }}
                    title={t.createCountsheetTitle}
                    className="w-full text-left px-3 py-2.5 rounded-xl border border-transparent hover:bg-emerald-50/80 dark:hover:bg-emerald-950/40 hover:border-emerald-200 dark:hover:border-emerald-800/60 transition-all duration-200 flex items-center justify-between gap-2 group cursor-pointer active:scale-98"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <ClipboardList className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5">
                          <span className="truncate">{t.createCountsheetTitle}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {t.createCountsheetSubtitle}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 group-hover:translate-x-1 transition-transform duration-200 shrink-0 font-bold">&rarr;</span>
                  </button>

                  {/* FORMS (Google Drive PDF Forms Preview & Print) */}
                  {onOpenForms && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        onOpenForms();
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-amber-50/80 dark:hover:bg-amber-950/40 border border-transparent hover:border-amber-200 dark:hover:border-amber-800/60 transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {t.formsTitle}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {t.formsSubtitle}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-amber-600 dark:text-amber-400 group-hover:translate-x-1 transition-transform duration-200 shrink-0 font-bold">&rarr;</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Section: Simple Settings Button */}
            <div className="drawer-stagger-item drawer-stagger-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 mb-1.5 flex items-center justify-between">
                <span>{t.preferencesSection}</span>
              </div>

              {/* Simple Settings Row Button */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsThemeBoxOpen(false);
                    setIsLanguageBoxOpen(false);
                    setCurrentView('settings');
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800/80 border border-transparent hover:border-slate-200 dark:hover:border-zinc-700/60 transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                      <Settings className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {t.settingsTitle}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {t.settingsSubtitle}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 group-hover:translate-x-1 transition-transform duration-200 shrink-0 font-bold">&rarr;</span>
                </button>

                {/* Trash Button */}
                <button
                  type="button"
                  onClick={() => {
                    setTrashItems(getTrashItems());
                    setCurrentView('trash');
                    setConfirmEmptyTrash(false);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-rose-50/70 dark:hover:bg-rose-950/30 border border-transparent hover:border-rose-200/80 dark:hover:border-rose-900/50 transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate flex items-center gap-2">
                        <span>{t.trashTitle}</span>
                        {trashItems.length > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                            {trashItems.length}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {trashItems.length > 0
                          ? `${trashItems.length} deleted recent${trashItems.length > 1 ? 's' : ''} • 30-day retention`
                          : t.trashEmptyDesc}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 group-hover:text-rose-600 dark:group-hover:text-rose-400 group-hover:translate-x-1 transition-transform duration-200 shrink-0 font-bold">&rarr;</span>
                </button>
              </div>
            </div>
          </div>
        ) : currentView === 'trash' ? (
          /* ================================================================= */
          /* TRASH VIEW (30-DAY RETENTION FOR DELETED RECENTS)                 */
          /* ================================================================= */
          <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4 space-y-3.5 scrollbar-thin">
            {restoredToastMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 font-semibold animate-in fade-in">
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{restoredToastMsg}</span>
              </div>
            )}

            {/* Retention Notice & Empty Trash bar */}
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  <span>{t.trashRetentionTitle}</span>
                </div>
                {trashItems.length > 0 && (
                  confirmEmptyTrash ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleEmptyAllTrash}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white cursor-pointer transition shadow-2xs"
                      >
                        {t.confirmEmptyBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmEmptyTrash(false)}
                        className="text-[10px] font-semibold px-1.5 py-1 text-slate-500 hover:text-slate-700 dark:text-zinc-400 cursor-pointer"
                      >
                        {t.cancelBtn}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmEmptyTrash(true)}
                      className="text-[10.5px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 px-2 py-0.5 rounded-lg cursor-pointer transition"
                    >
                      {t.emptyTrashBtn}
                    </button>
                  )
                )}
              </div>
              <p className="text-[10.5px] text-slate-500 dark:text-zinc-400 leading-relaxed">
                {t.trashRetentionDesc}
              </p>
            </div>

            {/* Filter Pills & Search */}
            {trashItems.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setTrashTypeFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      trashTypeFilter === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200'
                    }`}
                  >
                    All ({trashItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrashTypeFilter('countsheet')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      trashTypeFilter === 'countsheet'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200'
                    }`}
                  >
                    Countsheets ({trashItems.filter((i) => i.type === 'countsheet').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrashTypeFilter('audit_report')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      trashTypeFilter === 'audit_report'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200'
                    }`}
                  >
                    Reports ({trashItems.filter((i) => i.type === 'audit_report').length})
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={trashSearchQuery}
                    onChange={(e) => setTrashSearchQuery(e.target.value)}
                    placeholder="Search trash..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            {/* Trashed Items List */}
            {(() => {
              const filtered = trashItems.filter((item) => {
                const matchesType = trashTypeFilter === 'all' || item.type === trashTypeFilter;
                const matchesSearch = !trashSearchQuery || item.title.toLowerCase().includes(trashSearchQuery.toLowerCase());
                return matchesType && matchesSearch;
              });

              if (filtered.length === 0) {
                return (
                  <div className="py-12 px-4 text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-zinc-800/80 text-slate-400 dark:text-zinc-500 flex items-center justify-center mx-auto">
                      <Trash2 className="w-6 h-6" />
                    </div>
                    <div className="text-xs font-bold text-slate-700 dark:text-zinc-300">
                      {trashItems.length === 0 ? 'Trash is Empty' : 'No matching items'}
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-zinc-500 max-w-xs mx-auto">
                      {trashItems.length === 0
                        ? 'Deleted recent countsheets and audit reports will be stored here for 30 days.'
                        : 'No deleted recents matched your search filter.'}
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-0.5">
                  {filtered.map((item, idx) => {
                    const daysRemaining = Math.max(
                      1,
                      Math.ceil((item.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
                    );
                    const deletedDateStr = new Date(item.deletedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    });

                    return (
                      <div
                        key={`trash_${item.trashId}_${idx}`}
                        className="p-3 rounded-xl bg-white dark:bg-zinc-800/70 border border-slate-200 dark:border-zinc-700 flex flex-col gap-2 hover:border-slate-300 dark:hover:border-zinc-600 transition shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-[9.5px] uppercase font-bold px-1.5 py-0.2 rounded-full shrink-0 ${
                                  item.type === 'countsheet'
                                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300/40'
                                    : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300/40'
                                }`}
                              >
                                {item.type === 'countsheet' ? 'Countsheet' : 'Audit Report'}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                                Deleted {deletedDateStr}
                              </span>
                            </div>
                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate mt-1">
                              {item.title}
                            </div>
                            <div className="text-[10.5px] text-slate-500 dark:text-zinc-400 mt-0.5 flex items-center gap-2">
                              {item.itemCount !== undefined && (
                                <span>{item.itemCount} items</span>
                              )}
                              <span>•</span>
                              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                Expires in {daysRemaining} day{daysRemaining > 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-zinc-700/60">
                          <div>
                            {item.webViewLink && (
                              <a
                                href={item.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10.5px] font-semibold text-slate-600 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-300 flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Open Sheet</span>
                              </a>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => handleRestoreItem(item.trashId, e)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold flex items-center gap-1 transition cursor-pointer shadow-2xs"
                              title="Restore back to active Recents"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Restore</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeletePermanently(item.trashId, e)}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                              title="Delete permanently right now"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        ) : (
          /* ================================================================= */
          /* COMPACT SETTINGS VIEW (Reduced Text, Clean Controls)              */
          /* ================================================================= */
          <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4 space-y-3.5 scrollbar-thin">
            {/* 1. THEME & APPEARANCE */}
            {(() => {
              const currentThemeMeta =
                BACKGROUND_ICON_THEMES.find((t) => t.id === activeTheme) || BACKGROUND_ICON_THEMES[0];
              const currentTokens = theme === 'dark' ? currentThemeMeta.dark : currentThemeMeta.light;
              const modeLabel =
                appearanceMode === 'system'
                  ? `System`
                  : theme === 'dark'
                  ? t.darkMode
                  : t.lightMode;

              return (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-sky-500" />
                    <span>{t.themeAndAppearance}</span>
                  </div>

                  <div className="rounded-2xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60 overflow-hidden transition-all duration-200">
                    {/* Clickable Box Summary Trigger */}
                    <button
                      type="button"
                      onClick={() => setIsThemeBoxOpen((prev) => !prev)}
                      aria-expanded={isThemeBoxOpen}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all duration-200 flex items-center justify-between gap-2.5 cursor-pointer group active:scale-99"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                          <Palette className="w-4 h-4" />
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {currentThemeMeta.name}
                          </span>
                          <span className="inline-flex items-center -space-x-1 shrink-0">
                            <span
                              className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                              style={{ backgroundColor: currentTokens.background }}
                            />
                            <span
                              className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                              style={{ backgroundColor: currentTokens.cards }}
                            />
                            <span
                              className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                              style={{ backgroundColor: currentTokens.primary }}
                            />
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-zinc-400">
                          <span className="relative w-3.5 h-3.5 inline-flex items-center justify-center overflow-hidden">
                            <Sun
                              className={`w-3.5 h-3.5 text-amber-500 absolute theme-toggle-icon ${
                                theme === 'dark'
                                  ? 'opacity-0 -rotate-90 scale-50'
                                  : 'opacity-100 rotate-0 scale-100'
                              }`}
                            />
                            <Moon
                              className={`w-3.5 h-3.5 text-sky-400 absolute theme-toggle-icon ${
                                theme === 'dark'
                                  ? 'opacity-100 rotate-0 scale-100'
                                  : 'opacity-0 rotate-90 scale-50'
                              }`}
                            />
                          </span>
                          <span>{modeLabel}</span>
                        </span>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                            isThemeBoxOpen ? 'rotate-180 text-blue-500' : ''
                          }`}
                        />
                      </div>
                    </button>

                    {/* Expandable Theme & Appearance Content */}
                    {isThemeBoxOpen && (
                      <div className="p-3 border-t border-slate-200/80 dark:border-zinc-700/60 bg-slate-100/90 dark:bg-zinc-800/80 space-y-2.5 animate-in fade-in">
                        {/* Control 1: Light / Dark / System Appearance with Smooth Sliding Pill */}
                        <div
                          role="radiogroup"
                          aria-label="Appearance Mode"
                          className="relative grid grid-cols-3 p-1 rounded-xl bg-white/85 dark:bg-zinc-900/75 border border-slate-200/80 dark:border-zinc-700/70 overflow-hidden"
                        >
                          {/* GPU-composited sliding active indicator pill */}
                          <span
                            aria-hidden="true"
                            style={{
                              transform:
                                appearanceMode === 'dark'
                                  ? 'translate3d(100%, 0, 0)'
                                  : appearanceMode === 'system'
                                  ? 'translate3d(200%, 0, 0)'
                                  : 'translate3d(0%, 0, 0)',
                            }}
                            className="theme-pill-indicator pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-blue-600 shadow-2xs"
                          />
                          {(
                            [
                              { id: 'light' as AppearanceMode, label: t.lightMode, Icon: Sun },
                              { id: 'dark' as AppearanceMode, label: t.darkMode, Icon: Moon },
                              { id: 'system' as AppearanceMode, label: t.systemMode, Icon: Monitor },
                            ] as const
                          ).map(({ id, label, Icon }) => {
                            const isActive = appearanceMode === id;
                            return (
                              <button
                                key={id}
                                type="button"
                                role="radio"
                                aria-checked={isActive}
                                onClick={() => {
                                  if (onSetAppearanceMode) {
                                    onSetAppearanceMode(id);
                                  } else if ((id === 'dark') !== (theme === 'dark')) {
                                    onToggleTheme();
                                  }
                                }}
                                className={`relative z-10 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                                  isActive
                                    ? 'text-white'
                                    : 'text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white'
                                }`}
                              >
                                <Icon
                                  className={`w-3.5 h-3.5 theme-toggle-icon ${
                                    isActive
                                      ? id === 'light'
                                        ? 'rotate-0 scale-105'
                                        : id === 'dark'
                                        ? '-rotate-12 scale-105'
                                        : 'scale-105'
                                      : 'scale-95 opacity-85'
                                  }`}
                                />
                                <span>{label}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Control 2: Automatic Seasonal Theme */}
                        {onSetAutoSeasonalTheme && (
                          <div className="pt-2 border-t border-slate-200/80 dark:border-zinc-700/60 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Calendar className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                                {t.autoSeasonalTheme}
                              </span>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={autoSeasonalTheme}
                              onClick={() => onSetAutoSeasonalTheme(!autoSeasonalTheme)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                                autoSeasonalTheme ? 'bg-blue-600' : 'bg-slate-300 dark:bg-zinc-700'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition duration-200 ${
                                  autoSeasonalTheme ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        )}

                        {/* Control 3: Seasonal Decorations */}
                        {onSetSeasonalDecorations && (
                          <div className="pt-2 border-t border-slate-200/80 dark:border-zinc-700/60 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Sparkles className="w-3.5 h-3.5 text-pink-500 shrink-0" />
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                                {t.seasonalDecorations}
                              </span>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={seasonalDecorations}
                              onClick={() => onSetSeasonalDecorations(!seasonalDecorations)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                                seasonalDecorations ? 'bg-blue-600' : 'bg-slate-300 dark:bg-zinc-700'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition duration-200 ${
                                  seasonalDecorations ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        )}

                        {/* Control 4: Decorative Characters Density */}
                        {onSetCharacterDensity && (
                          <div className="pt-2 border-t border-slate-200/80 dark:border-zinc-700/60 space-y-1.5">
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 block">
                              {t.decorativeCharacters}
                            </span>
                            <div
                              role="radiogroup"
                              aria-label="Decorative Characters Density"
                              className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-white/80 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-700/70"
                            >
                              {(
                                [
                                  { id: 'off' as CharacterDensity, label: t.densityOff },
                                  { id: 'minimal' as CharacterDensity, label: t.densityMinimal },
                                  { id: 'balanced' as CharacterDensity, label: t.densityBalanced },
                                  { id: 'playful' as CharacterDensity, label: t.densityPlayful },
                                ] as const
                              ).map((opt) => {
                                const isSelected = characterDensity === opt.id;
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    onClick={() => onSetCharacterDensity(opt.id)}
                                    className={`py-1 px-1.5 rounded-lg text-[10.5px] font-bold transition cursor-pointer truncate ${
                                      isSelected
                                        ? 'bg-blue-600 text-white shadow-2xs'
                                        : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Control 5: Motion Preference (Off / Subtle / Smooth) */}
                        {onSetMotionPreference && (
                          <div className="pt-2 border-t border-slate-200/80 dark:border-zinc-700/60 space-y-1.5">
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 block">
                              Motion Preference
                            </span>
                            <div
                              role="radiogroup"
                              aria-label="Motion Preference"
                              className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-white/80 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-700/70"
                            >
                              {(
                                [
                                  { id: 'off' as const, label: 'Off' },
                                  { id: 'subtle' as const, label: 'Subtle' },
                                  { id: 'smooth' as const, label: 'Smooth' },
                                ] as const
                              ).map((opt) => {
                                const isSelected = motionPreference === opt.id;
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    onClick={() => onSetMotionPreference(opt.id)}
                                    className={`py-1 px-2 rounded-lg text-[10.5px] font-bold transition cursor-pointer truncate ${
                                      isSelected
                                        ? 'bg-blue-600 text-white shadow-2xs'
                                        : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Control 6: Character Animation */}
                        {onSetCharacterAnimation && (
                          <div className="pt-2 border-t border-slate-200/80 dark:border-zinc-700/60 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Play className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                                {t.characterAnimation}
                              </span>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={characterAnimation}
                              onClick={() => onSetCharacterAnimation(!characterAnimation)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                                characterAnimation ? 'bg-blue-600' : 'bg-slate-300 dark:bg-zinc-700'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition duration-200 ${
                                  characterAnimation ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        )}

                        {/* Control 7: Theme Selection */}
                        {onSelectBackgroundTheme && (
                          <div className="pt-2.5 border-t border-slate-200/80 dark:border-zinc-700/60 space-y-2">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block">
                              {t.themeSelection}
                            </span>

                            {/* Standard Themes */}
                            <div role="radiogroup" aria-label="Standard Themes" className="grid grid-cols-1 gap-1">
                              {BACKGROUND_ICON_THEMES.filter((t) => t.category === 'enterprise').map((option) => {
                                const isSelected = activeTheme === option.id;
                                const activeTokens = theme === 'dark' ? option.dark : option.light;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    onClick={() => {
                                      if (autoSeasonalTheme && onSetAutoSeasonalTheme) {
                                        onSetAutoSeasonalTheme(false);
                                      }
                                      onSelectBackgroundTheme(option.id);
                                    }}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-xl border transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer ${
                                      isSelected
                                        ? 'bg-white dark:bg-zinc-900 border-blue-500 dark:border-blue-400 shadow-2xs'
                                        : 'bg-white/70 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-zinc-900/90 border-slate-200/90 dark:border-zinc-700/70'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="inline-flex items-center -space-x-1 shrink-0">
                                        <span
                                          className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                                          style={{ backgroundColor: activeTokens.background }}
                                        />
                                        <span
                                          className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                                          style={{ backgroundColor: activeTokens.cards }}
                                        />
                                        <span
                                          className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                                          style={{ backgroundColor: activeTokens.primary }}
                                        />
                                      </span>
                                      <span
                                        className={`text-xs font-semibold truncate ${
                                          isSelected
                                            ? 'text-blue-700 dark:text-blue-300'
                                            : 'text-slate-800 dark:text-slate-100'
                                        }`}
                                      >
                                        {option.name}
                                      </span>
                                    </div>
                                    {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Seasonal Themes */}
                            <div
                              role="radiogroup"
                              aria-label="Seasonal Themes"
                              className="grid grid-cols-1 gap-1 max-h-56 overflow-y-auto pr-0.5 pt-1"
                            >
                              {BACKGROUND_ICON_THEMES.filter((t) => t.category === 'seasonal').map((option) => {
                                const isSelected = activeTheme === option.id;
                                const activeTokens = theme === 'dark' ? option.dark : option.light;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    onClick={() => {
                                      if (autoSeasonalTheme && onSetAutoSeasonalTheme) {
                                        onSetAutoSeasonalTheme(false);
                                      }
                                      onSelectBackgroundTheme(option.id);
                                    }}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-xl border transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer ${
                                      isSelected
                                        ? 'bg-white dark:bg-zinc-900 border-blue-500 dark:border-blue-400 shadow-2xs'
                                        : 'bg-white/70 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-zinc-900/90 border-slate-200/90 dark:border-zinc-700/70'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="inline-flex items-center -space-x-1 shrink-0">
                                        <span
                                          className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                                          style={{ backgroundColor: activeTokens.background }}
                                        />
                                        <span
                                          className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                                          style={{ backgroundColor: activeTokens.cards }}
                                        />
                                        <span
                                          className="w-3 h-3 rounded-full border border-slate-300 dark:border-zinc-600"
                                          style={{ backgroundColor: activeTokens.primary }}
                                        />
                                      </span>
                                      <span
                                        className={`text-xs font-semibold truncate ${
                                          isSelected
                                            ? 'text-blue-700 dark:text-blue-300'
                                            : 'text-slate-800 dark:text-slate-100'
                                        }`}
                                      >
                                        {option.name}
                                      </span>
                                    </div>
                                    {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 1B. LANGUAGE */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-500" />
                <span>{t.languageSection}</span>
              </div>

              <div className="rounded-2xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60 overflow-hidden transition-all duration-200">
                <button
                  type="button"
                  onClick={() => setIsLanguageBoxOpen((prev) => !prev)}
                  aria-expanded={isLanguageBoxOpen}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all duration-200 flex items-center justify-between gap-2.5 cursor-pointer group active:scale-99"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      <Globe className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {currentLanguageMeta.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-medium text-slate-500 dark:text-zinc-400">
                      {currentLanguageMeta.regionLabel}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                        isLanguageBoxOpen ? 'rotate-180 text-blue-500' : ''
                      }`}
                    />
                  </div>
                </button>

                {isLanguageBoxOpen && (
                  <div className="p-2.5 border-t border-slate-200/80 dark:border-zinc-700/60 bg-slate-100/90 dark:bg-zinc-800/80 animate-in fade-in">
                    <div role="radiogroup" aria-label="Change Language" className="grid grid-cols-1 gap-1">
                      {LANGUAGE_OPTIONS.map((option) => {
                        const isSelected = language === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => setLanguage(option.id)}
                            className={`w-full text-left px-2.5 py-2 rounded-xl border transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer ${
                              isSelected
                                ? 'bg-white dark:bg-zinc-900 border-blue-500 dark:border-blue-400 shadow-2xs'
                                : 'bg-white/75 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-zinc-900/90 border-slate-200/90 dark:border-zinc-700/70'
                            }`}
                          >
                            <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                              <span
                                className={`text-xs font-bold truncate ${
                                  isSelected
                                    ? 'text-blue-700 dark:text-blue-300'
                                    : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {option.name}
                              </span>
                              <span className="text-[10px] text-slate-500 dark:text-zinc-400 shrink-0">
                                {option.regionLabel}
                              </span>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. ACCOUNT */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-blue-500" />
                <span>{t.accountSection}</span>
              </div>

              <div className="space-y-1.5">
                {/* Change Profile Photo */}
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    setIsPhotoModalOpen(true);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700/60 transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 flex items-center justify-center shrink-0">
                      <Camera className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {t.changeProfilePhoto}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0">&rarr;</span>
                </button>

                {/* Switch Google Account (Only shown when connected to a Google account) */}
                {isGoogleConnected && onSwitchEmail && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onSwitchEmail();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700/60 transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 flex items-center justify-center shrink-0">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {t.switchGoogleAccount}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0">&rarr;</span>
                  </button>
                )}

                {/* Compact Active Account Details */}
                <div className="px-3 py-2 rounded-xl bg-slate-50/80 dark:bg-zinc-800/40 border border-slate-200/60 dark:border-zinc-800 text-[11px] space-y-1">
                  <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                    <span>{t.activeEmail}</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200 truncate max-w-[175px]">
                      {userEmail || 'Local'}
                    </span>
                  </div>
                  {branch && (
                    <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                      <span>{t.currentBranch}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[175px]">
                        {branch.name}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                    <span>{t.accessRole}</span>
                    <span
                      className={`uppercase text-[10px] font-bold px-1.5 py-0.2 rounded ${
                        isAdminMode
                          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                          : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      {isAdminMode ? 'Admin' : userRole}
                    </span>
                  </div>
                </div>

                {/* Admin Mode Access Panel (Only for signed-in Google accounts, hidden in Guest Mode) */}
                {isGoogleConnected && (
                  !isUserAdmin ? (
                    <div className="p-3 rounded-2xl border bg-slate-50 dark:bg-zinc-800/60 border-slate-200/90 dark:border-zinc-700/80 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-zinc-700 text-slate-500 dark:text-zinc-400 flex items-center justify-center shrink-0">
                            <ShieldAlert className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-800 dark:text-zinc-200 truncate">
                              Admin Console
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-zinc-400 truncate">
                              Role-Based Access
                            </div>
                          </div>
                        </div>
                        <span className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200/80 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 shrink-0">
                          Restricted
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed bg-white/70 dark:bg-zinc-900/60 p-2.5 rounded-xl border border-slate-200/70 dark:border-zinc-800">
                        Admin Console is not accessible for this account. All roles have full operational access, while the Admin Console is strictly accessible only for <strong className="font-mono text-slate-800 dark:text-zinc-200">icdhubsystems@gmail.com</strong>.
                      </p>
                    </div>
                  ) : (
                    <div
                      className={`p-3 rounded-2xl border transition-colors space-y-2.5 ${
                        isAdminMode
                          ? 'bg-amber-50/70 dark:bg-amber-950/25 border-amber-300/80 dark:border-amber-800/70'
                          : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              isAdminMode
                                ? 'bg-amber-500 text-white shadow-2xs'
                                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {isAdminMode ? <ShieldCheck className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {isAdminMode ? 'Admin Mode Active' : 'Admin Mode Security'}
                            </div>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                              Registered Administrator
                            </div>
                          </div>
                        </div>

                        {isAdminMode && (
                          <span className="text-[9.5px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30 shrink-0">
                            Active
                          </span>
                        )}
                      </div>

                      {adminCodeError && (
                        <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                          <span>{adminCodeError}</span>
                        </div>
                      )}

                      {adminCodeSuccess && (
                        <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                          <span>{adminCodeSuccess}</span>
                        </div>
                      )}

                      {!isAdminMode ? (
                        <form onSubmit={handleVerifyAdminCode} className="pt-1">
                          <div className="flex items-center gap-1.5">
                            <input
                              ref={adminInputRef}
                              type="password"
                              value={adminCodeInput}
                              onChange={(e) => {
                                setAdminCodeInput(e.target.value);
                                if (adminCodeError) setAdminCodeError(null);
                              }}
                              placeholder="Admin access code..."
                              aria-label="Admin Access Code"
                              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                            <button
                              type="submit"
                              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shrink-0 active:scale-95 transition cursor-pointer shadow-2xs"
                            >
                              Enter
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="space-y-2">
                          {onOpenAdminPanel && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsOpen(false);
                                onOpenAdminPanel();
                              }}
                              className="w-full py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center justify-between gap-2 cursor-pointer transition shadow-2xs active:scale-98"
                            >
                              <span className="flex items-center gap-1.5">
                                <Shield className="w-3.5 h-3.5" />
                                <span>Emails &amp; Reach Auditors</span>
                              </span>
                              <span>&rarr;</span>
                            </button>
                          )}

                          <div className="flex items-center justify-end gap-2 pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
                            <button
                              type="button"
                              onClick={() => {
                                onToggleAdminMode?.(false);
                                setAdminCodeSuccess(null);
                                setAdminCodeError(null);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                            >
                              <Lock className="w-3 h-3" />
                              <span>Exit Admin Mode</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>

            {/* 3. TOOLS */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-emerald-500" />
                <span>{t.toolsSection}</span>
              </div>

              <div className="space-y-1.5">
                {/* Share & QR Download */}
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    if (onOpenShare) onOpenShare();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700/60 transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <QrCode className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {t.shareAndQrTitle}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0">&rarr;</span>
                </button>

                {/* Install App to Device (PWA) */}
                {onInstallClick && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onInstallClick();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700/60 transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Smartphone className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {t.installAppTitle}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0">&rarr;</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Section: Log Out & Footer */}
        <div className="drawer-stagger-item drawer-stagger-5 p-3.5 sm:p-4 border-t border-slate-200/90 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/80 space-y-2 shrink-0">
          {currentView === 'menu' && userEmail ? (
            <button
              type="button"
              onClick={handleSignOutClick}
              className="w-full text-left px-3.5 py-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-900/60 transition-all duration-200 flex items-center gap-3 cursor-pointer active:scale-98 shadow-2xs group"
            >
              <div className="w-7 h-7 rounded-xl bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center shrink-0">
                <LogOut className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="text-xs font-bold leading-tight">{t.logOutTitle}</div>
            </button>
          ) : null}

          <div className="text-center text-[9.5px] text-slate-400 dark:text-slate-500 pt-0.5">
            Inventory Hub
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      {/* Hamburger Menu Trigger Button with Symmetrical Morphing Icon */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isOpen}
        className={`p-1.5 sm:p-2 rounded-xl transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer flex items-center justify-center gap-1.5 active:scale-92 ${
          isOpen
            ? 'bg-slate-200/90 dark:bg-zinc-700/90 text-slate-900 dark:text-white shadow-inner'
            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800/80'
        }`}
        title="Menu: Settings, reports, theme, account, tools, and log out"
      >
        {userPhoto ? (
          <img
            src={userPhoto}
            alt={displayName}
            className="w-6 h-6 rounded-full object-cover border border-zinc-300 dark:border-zinc-600 transition-transform duration-250 ease-out hover:scale-105"
            referrerPolicy="no-referrer"
          />
        ) : null}
        {/* Geometrically Centered 3-Bar Morphing Hamburger Icon */}
        <div className="w-5 h-5 relative flex items-center justify-center shrink-0">
          <span
            className={`absolute h-[2px] rounded-full bg-current transition-all duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] origin-center ${
              isOpen
                ? 'w-4 translate-y-0 rotate-45'
                : 'w-4.5 -translate-y-[5.5px] rotate-0'
            }`}
          />
          <span
            className={`absolute h-[2px] rounded-full bg-current transition-all duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] origin-center ${
              isOpen
                ? 'w-2 opacity-0 scale-x-0 translate-x-2'
                : 'w-4.5 opacity-100 scale-x-100 translate-x-0'
            }`}
          />
          <span
            className={`absolute h-[2px] rounded-full bg-current transition-all duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] origin-center ${
              isOpen
                ? 'w-4 translate-y-0 -rotate-45'
                : 'w-4.5 translate-y-[5.5px] rotate-0'
            }`}
          />
        </div>
      </button>

      {/* Portaled Drawer to Body (stays mounted so both open and close slide transitions complete smoothly) */}
      {mounted && createPortal(drawerContent, document.body)}

      {/* Change Photo Modal */}
      <ChangePhotoModal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        currentPhoto={userPhoto || null}
        googlePhoto={googlePhoto || null}
        displayName={displayName}
        onSave={(photo) => {
          if (onUpdatePhoto) onUpdatePhoto(photo);
        }}
      />
    </div>
  );
};
