import React, { useState, useEffect, useMemo } from 'react';
import {
  Store,
  Wifi,
  WifiOff,
  Shield,
  ClipboardList,
  PackageSearch,
  Activity,
  RefreshCw,
  Bell,
  Send,
  CheckCircle2,
  Trash2,
  X,
  User,
  Users,
} from 'lucide-react';
import { SelectedBranch } from '../types';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { InstallModal } from './InstallModal';
import { HeaderMenu } from './HeaderMenu';
import { ShareModal } from './ShareModal';
import { ThemeMode, AppearanceMode } from '../hooks/useTheme';
import { NavTab } from './BottomNav';
import { BackgroundIconTheme } from './TelegramDoodleBackground';
import { PanelDecoration } from './PanelDecoration';
import { useLanguage } from '../services/i18n';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';
import {
  PresenceUser,
  fetchOnlinePresence,
  PRESENCE_UPDATED_EVENT,
} from '../services/presenceService';

const SHEETS_AVATAR_PALETTE = [
  { bg: 'bg-emerald-600', ring: 'ring-emerald-500', badge: 'bg-emerald-500' },
  { bg: 'bg-blue-600', ring: 'ring-blue-500', badge: 'bg-blue-500' },
  { bg: 'bg-violet-600', ring: 'ring-violet-500', badge: 'bg-violet-500' },
  { bg: 'bg-amber-600', ring: 'ring-amber-500', badge: 'bg-amber-500' },
  { bg: 'bg-rose-600', ring: 'ring-rose-500', badge: 'bg-rose-500' },
  { bg: 'bg-teal-600', ring: 'ring-teal-500', badge: 'bg-teal-500' },
  { bg: 'bg-indigo-600', ring: 'ring-indigo-500', badge: 'bg-indigo-500' },
  { bg: 'bg-cyan-600', ring: 'ring-cyan-500', badge: 'bg-cyan-500' },
];

function getAvatarColorForUser(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return SHEETS_AVATAR_PALETTE[hash % SHEETS_AVATAR_PALETTE.length];
}

function getInitials(name?: string | null): string {
  const clean = (name || 'Guest').trim();
  if (!clean) return 'G';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

interface TopHeaderProps {
  branch: SelectedBranch | null;
  userRole: 'owner' | 'encoder' | 'unassigned';
  onOpenBranchModal: () => void;
  userEmail?: string | null;
  userName?: string | null;
  userPhoto?: string | null;
  googlePhoto?: string | null;
  onUpdatePhoto?: (newPhotoURL: string | null) => void;
  onSignOut: () => void;
  onSwitchEmail?: () => void;
  isGoogleConnected?: boolean;
  onConnectGoogle?: () => void;
  theme: ThemeMode;
  appearanceMode?: AppearanceMode;
  onSetAppearanceMode?: (mode: AppearanceMode) => void;
  onToggleTheme: () => void;
  onOpenCreateAuditReport?: (type?: 'random') => void;
  onOpenCreateCountsheets?: (type?: 'random') => void;
  onOpenForms?: () => void;
  currentTab?: NavTab;
  onSelectTab?: (tab: NavTab) => void;
  countItemTotal?: number;
  backgroundTheme?: BackgroundIconTheme;
  onSelectBackgroundTheme?: (theme: BackgroundIconTheme) => void;
  isAdminMode?: boolean;
  isUserAdmin?: boolean;
  onToggleAdminMode?: (enabled: boolean) => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  branch,
  userRole,
  onOpenBranchModal,
  userEmail,
  userName,
  userPhoto,
  googlePhoto,
  onUpdatePhoto,
  onSignOut,
  onSwitchEmail,
  isGoogleConnected = true,
  onConnectGoogle,
  theme,
  appearanceMode,
  onSetAppearanceMode,
  onToggleTheme,
  onOpenCreateAuditReport,
  onOpenCreateCountsheets,
  onOpenForms,
  currentTab,
  onSelectTab,
  countItemTotal = 0,
  backgroundTheme = 'default',
  onSelectBackgroundTheme,
  isAdminMode = false,
  isUserAdmin = false,
  onToggleAdminMode,
}) => {
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();
  const {
    adminHasCodeUpdate,
    notifications,
    unreadNotifications,
    hasUnreadNotification,
    isUpdating,
    isSendingNotification,
    applyUpdate,
    sendUpdateNotification,
    clearAllUpdateNotifications,
    markNotificationsRead,
  } = useAppUpdate();
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const notifPresence = useAnimatedPresence(showNotifMenu, 150);
  const [customUpdateMsg, setCustomUpdateMsg] = useState('');
  const [notifSentToast, setNotifSentToast] = useState(false);
  const notifMenuRef = React.useRef<HTMLDivElement | null>(null);

  // Admin-only Google Sheets–style online presence avatars (including Guest Mode avatar-only users)
  const canViewAdminPresence = Boolean(isUserAdmin || isAdminMode);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [failedAvatarIds, setFailedAvatarIds] = useState<Record<string, boolean>>({});
  const [showPresenceMenu, setShowPresenceMenu] = useState(false);
  const presenceMenuAnimation = useAnimatedPresence(showPresenceMenu, 150);
  const presenceMenuRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!canViewAdminPresence) {
      setOnlineUsers([]);
      setShowPresenceMenu(false);
      return;
    }

    let isMounted = true;
    const loadPresence = async () => {
      try {
        const stats = await fetchOnlinePresence();
        if (isMounted) {
          setOnlineUsers(stats.users || []);
        }
      } catch {}
    };

    void loadPresence();
    const interval = window.setInterval(loadPresence, 15000);
    const handlePresenceEvent = () => {
      void loadPresence();
    };
    window.addEventListener('storage', handlePresenceEvent);
    window.addEventListener(PRESENCE_UPDATED_EVENT, handlePresenceEvent);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
      window.removeEventListener('storage', handlePresenceEvent);
      window.removeEventListener(PRESENCE_UPDATED_EVENT, handlePresenceEvent);
    };
  }, [canViewAdminPresence]);

  useEffect(() => {
    if (!showPresenceMenu) return;
    const handleOutsidePresenceClick = (e: MouseEvent) => {
      if (presenceMenuRef.current && !presenceMenuRef.current.contains(e.target as Node)) {
        setShowPresenceMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsidePresenceClick);
    return () => document.removeEventListener('mousedown', handleOutsidePresenceClick);
  }, [showPresenceMenu]);

  // Prioritize Guest Mode and other active users first, just like Google Sheets collaborators
  const sortedOnlineUsers = useMemo(() => {
    const currentEmailClean = (userEmail || '').trim().toLowerCase();
    return [...onlineUsers].sort((a, b) => {
      const aIsSelf = currentEmailClean && (a.email || '').trim().toLowerCase() === currentEmailClean;
      const bIsSelf = currentEmailClean && (b.email || '').trim().toLowerCase() === currentEmailClean;
      if (aIsSelf !== bIsSelf) return aIsSelf ? 1 : -1;
      if (a.loginType !== b.loginType) return a.loginType === 'guest' ? -1 : 1;
      return (a.secondsAgo || 0) - (b.secondsAgo || 0);
    });
  }, [onlineUsers, userEmail]);

  const visibleAvatars = useMemo(() => sortedOnlineUsers.slice(0, 5), [sortedOnlineUsers]);
  const extraOnlineCount = Math.max(0, sortedOnlineUsers.length - 5);

  useEffect(() => {
    if (!showNotifMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target as Node)) {
        setShowNotifMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showNotifMenu]);

  const handleAdminSendUpdateNotif = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const ok = await sendUpdateNotification({
      title: 'Update & Refresh Available',
      message:
        customUpdateMsg.trim() ||
        'A new update has been published by the Admin. Please click Update & Refresh below to load the latest features and data.',
      senderName: userName || 'Admin',
      senderEmail: userEmail || '',
    });
    if (ok) {
      setCustomUpdateMsg('');
      setNotifSentToast(true);
      window.setTimeout(() => setNotifSentToast(false), 3000);
    }
  };

  const handleInstallClick = () => {
    if (isInstallable) {
      install();
    } else {
      setShowInstallModal(true);
    }
  };

  // Global keyboard shortcut: '/' to focus active page search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (!isTyping && e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="text"]:not([disabled]), input[type="search"]:not([disabled])'
        );
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header id="app-top-header" className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md text-slate-900 dark:text-white shadow-xs dark:shadow-md border-b border-slate-200/90 dark:border-slate-800 transition-colors pt-[env(safe-area-inset-top,0px)]">
      {/* Header-edge hanging ornaments/garlands/icicles in safe non-interactive areas */}
      <PanelDecoration position="header-edge" tier="major" variant={0} />
      <PanelDecoration position="header-edge" tier="secondary" variant={1} />
      <PanelDecoration position="header-edge" tier="playful" variant={3} />
      <div className="w-full max-w-[1560px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-16 py-2 flex items-center justify-between gap-4">
        {/* App Title & Branding */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center p-1 shrink-0 shadow-xs">
            <img src="/icd-logo.svg" alt="ICD Logo" width="24" height="24" className="w-full h-full object-contain aspect-square shrink-0" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5 leading-none">
              <span className="truncate">Inventory Hub</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 shrink-0">
                HUB
              </span>
            </h1>
            {/* Branch pill */}
            <button
              onClick={onOpenBranchModal}
              className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition truncate cursor-pointer text-left group"
              title={t.changeBranchOrSync}
            >
              <Store className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="truncate max-w-[120px] sm:max-w-[200px] font-medium">
                {branch ? branch.name : t.selectBranch}
              </span>
              <span className="text-[10px] text-slate-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">▾</span>
            </button>
          </div>
        </div>

        {/* Desktop Navigation: Separated Overall Count (containing Branch, Count, Monitoring) & Inventory (Masterdata Access) */}
        {onSelectTab && (() => {
          const isOverallCountActive =
            currentTab === 'branch' || currentTab === 'count' || currentTab === 'monitoring';
          const isInventoryActive = currentTab === 'inventory';

          return (
            <nav
              aria-label="Desktop primary navigation"
              className="hidden md:flex items-center gap-2"
            >
              {/* Large Clickable Button 1: Overall Count (houses Branch, Count & Monitoring inside) */}
              <div
                onClick={() => {
                  if (!isOverallCountActive) {
                    onSelectTab('branch');
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isOverallCountActive) {
                    e.preventDefault();
                    onSelectTab('branch');
                  }
                }}
                className={`flex items-center gap-2 px-2.5 py-1 rounded-2xl border transition-all cursor-pointer select-none ${
                  isOverallCountActive
                    ? 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-300 dark:border-blue-800 shadow-xs'
                    : 'bg-slate-100/90 dark:bg-slate-800/80 border-slate-200/80 dark:border-slate-700/80 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 pl-1 pr-1.5">
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      isOverallCountActive
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                  </div>
                  <div className="leading-tight">
                    <div
                      className={`text-xs font-extrabold tracking-tight whitespace-nowrap ${
                        isOverallCountActive
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      Overall Count
                    </div>
                  </div>
                </div>

                {/* Inner Branch, Count, and Monitoring tabs inside Overall Count */}
                <div className="flex items-center gap-1 bg-white/80 dark:bg-slate-900/80 p-0.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTab('branch');
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      currentTab === 'branch'
                        ? 'bg-blue-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold'
                    }`}
                  >
                    <Store className="w-3 h-3" />
                    <span>{t.navBranch}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTab('count');
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      currentTab === 'count'
                        ? 'bg-blue-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold'
                    }`}
                  >
                    <ClipboardList className="w-3 h-3" />
                    <span>{t.navCount}</span>
                    {countItemTotal > 0 && (
                      <span
                        className={`ml-0.5 px-1.5 py-0.2 text-[9.5px] font-bold font-mono rounded-full leading-tight ${
                          currentTab === 'count'
                            ? 'bg-white text-blue-700'
                            : 'bg-blue-600 text-white'
                        }`}
                      >
                        {countItemTotal > 99 ? '99+' : countItemTotal}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTab('monitoring');
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      currentTab === 'monitoring'
                        ? 'bg-blue-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold'
                    }`}
                  >
                    <Activity className="w-3 h-3" />
                    <span>{t.navMonitoring}</span>
                  </button>
                </div>
              </div>

              {/* Large Clickable Button 2: Inventory (for Masterdata Access) */}
              <button
                type="button"
                onClick={() => onSelectTab('inventory')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-2xl border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  isInventoryActive
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs font-bold'
                    : 'bg-slate-100/90 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-slate-700/80 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30 font-semibold'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    isInventoryActive
                      ? 'bg-white/20 text-white'
                      : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                  }`}
                >
                  <PackageSearch className="w-3.5 h-3.5" />
                </div>
                <div className="text-left leading-tight">
                  <div className="text-xs font-extrabold tracking-tight">{t.navInventory}</div>
                  <div
                    className={`text-[9.5px] font-semibold ${
                      isInventoryActive
                        ? 'text-indigo-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    Masterdata Access
                  </div>
                </div>
              </button>
            </nav>
          );
        })()}

        {/* Right side controls: Separated Admin Section, Role, Online status, and Hamburger Menu */}
        <div className="flex items-center gap-2 shrink-0">

          {/* Separated Admin Section on the Top Bar */}
          {isAdminMode && isUserAdmin ? (
            <div className="flex items-center pr-1.5 border-r border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onSelectTab?.('admin')}
                title="Open Admin Console (Emails & Reach Auditors)"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  currentTab === 'admin'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-emerald-50/90 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/70'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Admin</span>
              </button>
            </div>
          ) : branch && userRole !== 'unassigned' ? (
            <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700 whitespace-nowrap shrink-0">
              <Shield className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
              <span className="capitalize">{userRole}</span>
            </div>
          ) : null}

          {/* Admin-Only Update Button — Only shown to Admin when code/data changes */}
          {isAdminMode && isUserAdmin && adminHasCodeUpdate && (
            <button
              type="button"
              onClick={() => setShowNotifMenu(true)}
              disabled={isUpdating}
              title="Admin: New changes detected. Click to broadcast an Update notification or refresh."
              className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all whitespace-nowrap shrink-0 cursor-pointer active:scale-95 disabled:opacity-60 bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-sm ring-2 ring-blue-400/40 animate-in fade-in zoom-in-95"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping shrink-0" />
              <RefreshCw className={`w-3 h-3 shrink-0 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>Update</span>
            </button>
          )}

          {/* Admin-Only Google Sheets–Style Online Avatars (Up to 5 Avatars + 6th Overflow Count Badge) */}
          {canViewAdminPresence && sortedOnlineUsers.length > 0 && (
            <div ref={presenceMenuRef} className="relative flex items-center shrink-0">
              <div
                className="flex items-center -space-x-1.5 pr-0.5 select-none"
                role="group"
                aria-label={`${sortedOnlineUsers.length} online user${sortedOnlineUsers.length === 1 ? '' : 's'}`}
              >
                {visibleAvatars.map((u, idx) => {
                  const color = getAvatarColorForUser(u.email || u.displayName || u.sessionId);
                  const isGuestUser = u.loginType === 'guest';
                  const hasValidPhoto =
                    !isGuestUser && Boolean(u.photoURL) && !failedAvatarIds[u.sessionId];
                  const initials = getInitials(u.displayName);

                  return (
                    <div
                      key={u.sessionId}
                      style={{ zIndex: 20 - idx }}
                      className="relative group/avatar"
                    >
                      <button
                        type="button"
                        onClick={() => setShowPresenceMenu((prev) => !prev)}
                        aria-label={`${u.displayName} (${isGuestUser ? 'Guest Mode' : 'Google Account'}) — Online`}
                        className={`relative w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold tracking-tight ring-2 ${color.ring} border-2 border-white dark:border-slate-900 shadow-xs transition-transform duration-150 hover:scale-110 hover:z-30 active:scale-95 cursor-pointer overflow-visible ${
                          hasValidPhoto ? 'bg-slate-200 dark:bg-slate-800' : color.bg
                        }`}
                      >
                        {hasValidPhoto ? (
                          <img
                            src={u.photoURL!}
                            alt={u.displayName}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedAvatarIds((prev) => ({ ...prev, [u.sessionId]: true }))
                            }
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : isGuestUser ? (
                          /* Guest Mode Avatar-Only representation (Google Sheets anonymous/guest avatar style) */
                          <span className="flex items-center justify-center w-full h-full rounded-full relative">
                            <User className="w-3.5 h-3.5 text-white/95 stroke-[2.5]" />
                          </span>
                        ) : (
                          <span>{initials}</span>
                        )}

                        {/* Online active green dot */}
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900 pointer-events-none" />
                      </button>

                      {/* Google Sheets–style hover name pill */}
                      <div className="pointer-events-none opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 whitespace-nowrap px-2 py-1 rounded-lg bg-slate-900/95 dark:bg-zinc-800 text-white text-[10px] font-semibold shadow-lg border border-slate-700/80 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span>{u.displayName || 'Guest'}</span>
                        <span
                          className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase ${
                            isGuestUser
                              ? 'bg-purple-500/30 text-purple-200'
                              : 'bg-blue-500/30 text-blue-200'
                          }`}
                        >
                          {isGuestUser ? 'Guest' : 'Google'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* 6th Avatar Slot: Number of additional online people (+N) just like Google Sheets */}
                {extraOnlineCount > 0 && (
                  <button
                    type="button"
                    style={{ zIndex: 10 }}
                    onClick={() => setShowPresenceMenu((prev) => !prev)}
                    title={`${extraOnlineCount} more online (${sortedOnlineUsers.length} total online)`}
                    aria-label={`${extraOnlineCount} more users online`}
                    className="relative w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-slate-300 dark:ring-slate-700 border-2 border-white dark:border-slate-900 shadow-xs transition-transform duration-150 hover:scale-110 hover:z-30 active:scale-95 cursor-pointer"
                  >
                    <span>+{extraOnlineCount}</span>
                  </button>
                )}
              </div>

              {/* Google Sheets–style Collaborator Presence Dropdown */}
              {presenceMenuAnimation.shouldRender && (
                <div
                  className={`fixed left-3 right-3 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 z-50 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xl overflow-hidden ui-dropdown-panel ${
                    presenceMenuAnimation.isVisible
                      ? 'ui-dropdown-open pointer-events-auto'
                      : 'pointer-events-none'
                  }`}
                >
                  <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Online Now ({sortedOnlineUsers.length})
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                        {sortedOnlineUsers.filter((u) => u.loginType === 'guest').length} Guest
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                        {sortedOnlineUsers.filter((u) => u.loginType === 'google').length} Google
                      </span>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                    {sortedOnlineUsers.map((u) => {
                      const color = getAvatarColorForUser(u.email || u.displayName || u.sessionId);
                      const isGuestUser = u.loginType === 'guest';
                      const hasValidPhoto =
                        !isGuestUser && Boolean(u.photoURL) && !failedAvatarIds[u.sessionId];
                      const initials = getInitials(u.displayName);

                      return (
                        <div
                          key={u.sessionId}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-2.5 hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`relative w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold shrink-0 ring-2 ${color.ring} ${
                                hasValidPhoto ? 'bg-slate-200 dark:bg-slate-800' : color.bg
                              }`}
                            >
                              {hasValidPhoto ? (
                                <img
                                  src={u.photoURL!}
                                  alt={u.displayName}
                                  referrerPolicy="no-referrer"
                                  onError={() =>
                                    setFailedAvatarIds((prev) => ({ ...prev, [u.sessionId]: true }))
                                  }
                                  className="w-full h-full rounded-full object-cover"
                                />
                              ) : isGuestUser ? (
                                <User className="w-3.5 h-3.5 text-white/95 stroke-[2.5]" />
                              ) : (
                                <span>{initials}</span>
                              )}
                              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white dark:ring-slate-900" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                <span className="truncate">{u.displayName || 'Guest'}</span>
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                {u.branchName || (isGuestUser ? 'Masterdata' : 'Active')}
                              </div>
                            </div>
                          </div>

                          <span
                            className={`text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border shrink-0 ${
                              isGuestUser
                                ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/70'
                                : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/70'
                            }`}
                          >
                            {isGuestUser ? 'Guest' : 'Google'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {onSelectTab && (
                    <div className="p-2 bg-slate-50/90 dark:bg-slate-800/60 border-t border-slate-200/80 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPresenceMenu(false);
                          onSelectTab('admin');
                        }}
                        className="w-full py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        <span>View All in Admin Console</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Top Notification Bell (Receives Admin Update/Refresh Notifications & lets Admin broadcast manually) */}
          <div ref={notifMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowNotifMenu((prev) => !prev)}
              title="Notifications & App Updates"
              aria-label="Notifications"
              className={`relative p-1.5 rounded-full border transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                hasUnreadNotification
                  ? 'bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 shadow-2xs'
                  : 'bg-slate-100/90 hover:bg-slate-200/70 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-slate-700'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              {hasUnreadNotification && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9.5px] font-bold flex items-center justify-center shadow-2xs ring-2 ring-white dark:ring-slate-900">
                  {unreadNotifications.length > 9 ? '9+' : unreadNotifications.length}
                </span>
              )}
            </button>

            {notifPresence.shouldRender && (
              <div
                className={`fixed left-3 right-3 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-88 z-50 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xl overflow-hidden ui-dropdown-panel ${
                  notifPresence.isVisible
                    ? 'ui-dropdown-open pointer-events-auto'
                    : 'pointer-events-none'
                }`}
              >
                <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Notifications
                    </span>
                    {hasUnreadNotification && (
                      <span className="px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                        {unreadNotifications.length} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {hasUnreadNotification && (
                      <button
                        type="button"
                        onClick={markNotificationsRead}
                        className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Mark read
                      </button>
                    )}
                    {isAdminMode && isUserAdmin && notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={clearAllUpdateNotifications}
                        title="Clear all notifications for everyone"
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowNotifMenu(false)}
                      className="p-0.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Admin Manual Update Broadcast Composer */}
                {isAdminMode && isUserAdmin && (
                  <form
                    onSubmit={handleAdminSendUpdateNotif}
                    className="p-3 bg-indigo-50/60 dark:bg-indigo-950/30 border-b border-indigo-200/70 dark:border-indigo-800/60 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                        Admin: Send App / Website Update Alert
                      </span>
                      <button
                        type="button"
                        onClick={applyUpdate}
                        disabled={isUpdating}
                        className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 cursor-pointer inline-flex items-center gap-1"
                        title="Refresh your own browser now"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isUpdating ? 'animate-spin' : ''}`} />
                        <span>Refresh Mine</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={customUpdateMsg}
                      onChange={(e) => setCustomUpdateMsg(e.target.value)}
                      placeholder="Optional note (e.g., New Masterdata & features added — please refresh)"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={isSendingNotification}
                      className="w-full py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-98 disabled:opacity-60 shadow-2xs"
                    >
                      <Send className="w-3 h-3" />
                      <span>
                        {isSendingNotification
                          ? 'Sending Notification...'
                          : 'Send Update / Refresh Notification'}
                      </span>
                    </button>
                    {notifSentToast && (
                      <div className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span>Update notification sent to all users!</span>
                      </div>
                    )}
                  </form>
                )}

                {/* Notification List */}
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {notifications.length === 0 ? (
                    <div className="py-8 px-4 text-center text-xs text-slate-400 dark:text-slate-500">
                      <Bell className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
                      <p className="font-semibold text-slate-600 dark:text-slate-400">
                        No update notifications yet
                      </p>
                      <p className="text-[11px] mt-0.5">
                        When an admin publishes an update, it will appear here to refresh your app.
                      </p>
                    </div>
                  ) : (
                    notifications.map((notif) => {
                      const isUnread = unreadNotifications.some((u) => u.id === notif.id);
                      return (
                        <div
                          key={notif.id}
                          className={`p-3 space-y-2 transition ${
                            isUnread
                              ? 'bg-blue-50/50 dark:bg-blue-950/30'
                              : 'bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              {isUnread && (
                                <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                              )}
                              <span className="text-xs font-bold text-slate-900 dark:text-white">
                                {notif.title}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">
                              {new Date(notif.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-[10px] text-slate-400">
                              By {notif.senderName || 'Admin'}
                            </span>
                            <button
                              type="button"
                              onClick={applyUpdate}
                              disabled={isUpdating}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] inline-flex items-center gap-1 shadow-2xs transition cursor-pointer active:scale-95 disabled:opacity-60"
                            >
                              <RefreshCw
                                className={`w-3 h-3 shrink-0 ${isUpdating ? 'animate-spin' : ''}`}
                              />
                              <span>{isUpdating ? 'Updating...' : 'Update & Refresh'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Online/Offline Status Indicator */}
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap shrink-0 ${
              isOnline
                ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/80'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700'
            }`}
            title={isOnline ? 'Online: Google Sheets sync active' : 'Offline: Counts saved locally'}
          >
            {isOnline ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span className="hidden sm:inline">{t.online}</span>
                <Wifi className="w-3 h-3 sm:hidden" />
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-zinc-400"></span>
                <span className="hidden sm:inline">{t.offline}</span>
                <WifiOff className="w-3 h-3 sm:hidden" />
              </>
            )}
          </div>

          {/* Menu containing Theme, Change Photo, Account Settings, Create Audit Report, and Log Out */}
          <HeaderMenu
            theme={theme}
            appearanceMode={appearanceMode}
            onSetAppearanceMode={onSetAppearanceMode}
            onToggleTheme={onToggleTheme}
            onSignOut={onSignOut}
            onSwitchEmail={onSwitchEmail}
            isGoogleConnected={isGoogleConnected}
            onConnectGoogle={onConnectGoogle}
            userEmail={userEmail}
            userName={userName}
            userPhoto={userPhoto}
            googlePhoto={googlePhoto}
            onUpdatePhoto={onUpdatePhoto}
            userRole={userRole}
            branch={branch}
            onInstallClick={handleInstallClick}
            isInstallable={isInstallable && !isInstalled}
            onOpenCreateAuditReport={onOpenCreateAuditReport}
            onOpenCreateCountsheets={onOpenCreateCountsheets}
            onOpenForms={onOpenForms}
            onOpenShare={() => setShowShareModal(true)}
            backgroundTheme={backgroundTheme}
            onSelectBackgroundTheme={onSelectBackgroundTheme}
            isAdminMode={isAdminMode}
            isUserAdmin={isUserAdmin}
            onToggleAdminMode={onToggleAdminMode}
            onOpenAdminPanel={() => onSelectTab?.('admin')}
          />
        </div>
      </div>

      {/* PWA Install Guidance Modal */}
      <InstallModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
        isInstallable={isInstallable}
        onNativeInstall={install}
      />

      {/* Share & QR Download Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        branch={branch}
        isInstallable={isInstallable && !isInstalled}
        onNativeInstall={handleInstallClick}
      />
    </header>
  );
};
