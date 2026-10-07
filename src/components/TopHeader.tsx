import React, { useState } from 'react';
import {
  Store,
  Wifi,
  WifiOff,
  Shield,
} from 'lucide-react';
import { SelectedBranch } from '../types';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { InstallModal } from './InstallModal';
import { HeaderMenu } from './HeaderMenu';
import { ThemeMode } from '../hooks/useTheme';

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
}) => {
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [showInstallModal, setShowInstallModal] = useState(false);

  const handleInstallClick = () => {
    if (isInstallable) {
      install();
    } else {
      setShowInstallModal(true);
    }
  };

  return (
    <header id="app-top-header" className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md text-slate-900 dark:text-white shadow-xs dark:shadow-md border-b border-slate-200/90 dark:border-slate-800">
      <div className="max-w-4xl mx-auto px-3.5 py-2.5 flex items-center justify-between gap-2">
        {/* App Title & Branding */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center p-1 shrink-0 shadow-xs">
            <img src="/icd-logo.svg" alt="ICD Logo" className="w-full h-full object-contain" />
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
              <Store className="w-3 h-3 text-amber-500 dark:text-zinc-400 shrink-0" />
              <span className="truncate max-w-[120px] sm:max-w-[180px] font-medium">
                {branch ? branch.name : 'Select Branch'}
              </span>
              <span className="text-[10px] text-slate-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">▾</span>
            </button>
          </div>
        </div>

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
                : 'bg-amber-50 dark:bg-amber-950/90 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-700 animate-pulse'
            }`}
            title={isOnline ? 'Online: Google Sheets sync active' : 'Offline: Counts saved locally'}
          >
            {isOnline ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span className="hidden sm:inline">Online</span>
                <Wifi className="w-3 h-3 sm:hidden" />
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
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
    </header>
  );
};
