import React, { useState } from 'react';
import {
  Store,
  Wifi,
  WifiOff,
  Shield,
  ClipboardList,
  PackageSearch,
  Activity,
} from 'lucide-react';
import { SelectedBranch } from '../types';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { InstallModal } from './InstallModal';
import { HeaderMenu } from './HeaderMenu';
import { ShareModal } from './ShareModal';
import { ThemeMode } from '../hooks/useTheme';
import { NavTab } from './BottomNav';

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
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenCreateAuditReport?: () => void;
  currentTab?: NavTab;
  onSelectTab?: (tab: NavTab) => void;
  countItemTotal?: number;
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
  theme,
  onToggleTheme,
  onOpenCreateAuditReport,
  currentTab,
  onSelectTab,
  countItemTotal = 0,
}) => {
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const desktopTabs: { id: NavTab; label: string; icon: React.FC<{ className?: string }>; badge?: number | null }[] = [
    { id: 'branch', label: 'Branch', icon: Store },
    { id: 'count', label: 'Count', icon: ClipboardList, badge: countItemTotal > 0 ? countItemTotal : null },
    { id: 'inventory', label: 'Inventory', icon: PackageSearch },
    { id: 'monitoring', label: 'Monitoring', icon: Activity },
  ];

  const handleInstallClick = () => {
    if (isInstallable) {
      install();
    } else {
      setShowInstallModal(true);
    }
  };

  return (
    <header id="app-top-header" className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md text-slate-900 dark:text-white shadow-xs dark:shadow-md border-b border-slate-200/90 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3">
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
              title="Change branch or view sync status"
            >
              <Store className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="truncate max-w-[120px] sm:max-w-[200px] font-medium">
                {branch ? branch.name : 'Select Branch'}
              </span>
              <span className="text-[10px] text-slate-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">▾</span>
            </button>
          </div>
        </div>

        {/* Center: Desktop Navigation Tabs (Visible on md+ screens) */}
        {currentTab && onSelectTab && (
          <nav className="hidden md:flex items-center gap-1 bg-slate-100/90 dark:bg-zinc-800/90 p-1 rounded-xl border border-slate-200/90 dark:border-zinc-700/80">
            {desktopTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs transition cursor-pointer relative ${
                    isActive
                      ? 'bg-white dark:bg-zinc-900 text-slate-900 dark:text-white font-bold shadow-xs'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-200/50 dark:hover:bg-zinc-700/50 font-medium'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-zinc-400'}`} />
                  <span>{tab.label}</span>
                  {tab.badge !== null && tab.badge !== undefined && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-slate-900 dark:bg-blue-600 text-white text-[10px] font-black flex items-center justify-center">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {/* Right side controls: Role, Online status, and Hamburger Menu */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* User Role Badge */}
          {branch && userRole !== 'unassigned' && (
            <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700">
              <Shield className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
              <span className="capitalize">{userRole}</span>
            </div>
          )}

          {/* Online/Offline Status Indicator */}
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border ${
              isOnline
                ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/80'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700'
            }`}
            title={isOnline ? 'Online: Google Sheets sync active' : 'Offline: Counts saved locally'}
          >
            {isOnline ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span className="hidden sm:inline">Online</span>
                <Wifi className="w-3 h-3 sm:hidden" />
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-zinc-400"></span>
                <span className="hidden sm:inline">Offline</span>
                <WifiOff className="w-3 h-3 sm:hidden" />
              </>
            )}
          </div>

          {/* Menu containing Theme, Change Photo, Account Settings, Create Audit Report, and Log Out */}
          <HeaderMenu
            theme={theme}
            onToggleTheme={onToggleTheme}
            onSignOut={onSignOut}
            onSwitchEmail={onSwitchEmail}
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
            onOpenShare={() => setShowShareModal(true)}
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
