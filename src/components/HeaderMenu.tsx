import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Menu,
  Sun,
  Moon,
  LogOut,
  Download,
  RefreshCw,
  X,
  Camera,
  FileSpreadsheet,
} from 'lucide-react';
import { ThemeMode } from '../hooks/useTheme';
import { SelectedBranch } from '../types';
import { ChangePhotoModal } from './ChangePhotoModal';

interface HeaderMenuProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onSignOut: () => void;
  onSwitchEmail?: () => void;
  userEmail?: string | null;
  userName?: string | null;
  userPhoto?: string | null;
  googlePhoto?: string | null;
  onUpdatePhoto?: (newPhotoURL: string | null) => void;
  userRole?: 'owner' | 'encoder' | 'unassigned';
  branch?: SelectedBranch | null;
  onInstallClick?: () => void;
  isInstallable?: boolean;
  onOpenCreateAuditReport?: () => void;
}

export const HeaderMenu: React.FC<HeaderMenuProps> = ({
  theme,
  onToggleTheme,
  onSignOut,
  onSwitchEmail,
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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Manage background content blur when drawer is open (GPU accelerated single-layer blur for mobile app performance)
  useEffect(() => {
    const rootContainerEl = document.getElementById('app-root-container');

    if (isOpen) {
      rootContainerEl?.classList.add('drawer-active-blur');
    } else {
      rootContainerEl?.classList.remove('drawer-active-blur');
    }

    return () => {
      rootContainerEl?.classList.remove('drawer-active-blur');
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleSignOutClick = () => {
    setIsOpen(false);
    onSignOut();
  };

  const handleInstall = () => {
    setIsOpen(false);
    if (onInstallClick) onInstallClick();
  };

  const displayName = userName || (userEmail ? userEmail.split('@')[0] : 'Compliance Dept');

  const drawerContent = (
    <div className={`fixed inset-0 z-50 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {/* High-Performance Translucent Backdrop */}
      <div
        className={`fixed inset-0 bg-slate-950/30 dark:bg-black/60 backdrop-blur-[2px] transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel from Right (Hardware accelerated spring easing) */}
      <div
        className={`fixed inset-y-0 right-0 h-screen h-[100dvh] w-[75vw] sm:w-88 max-w-[75vw] sm:max-w-sm bg-white dark:bg-[#161618] text-slate-900 dark:text-slate-100 shadow-2xl border-l border-slate-200/90 dark:border-zinc-800 flex flex-col justify-between transform transition-transform duration-320 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform z-50 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backfaceVisibility: 'hidden', perspective: 1000 }}
        role="dialog"
        aria-modal="true"
        aria-label="Account and Settings Menu"
      >
        {/* Top Header Section: User Profile & Close button */}
        <div className={`p-3.5 sm:p-4 bg-slate-50 dark:bg-zinc-800/80 border-b border-slate-200/90 dark:border-zinc-800 flex items-start justify-between gap-2 shrink-0 transition-all duration-300 delay-50 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? 'translate-x-0 opacity-100' : 'translate-x-3 opacity-0'
        }`}>
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Profile Avatar: Google photo or custom photo, with fallback */}
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
              <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                {displayName}
              </div>
              <div className="text-[10.5px] sm:text-xs text-slate-500 dark:text-slate-400 truncate font-mono">
                {userEmail || 'Local session'}
              </div>
              {branch && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 truncate max-w-[120px] sm:max-w-[150px]">
                    {branch.name}
                  </span>
                  {userRole !== 'unassigned' && (
                    <span className="text-[8.5px] uppercase font-bold px-1.5 py-0.2 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 shrink-0">
                      {userRole}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-zinc-700/60 transition-all duration-200 cursor-pointer active:scale-90 hover:rotate-90 shrink-0"
            title="Close menu"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Scrollable Middle Content: Theme Mode & Account Settings */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-4 scrollbar-thin">
          {/* Section: Theme Mode */}
          <div className={`transition-all duration-300 delay-100 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isOpen ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
          }`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 mb-1.5 flex items-center justify-between">
              <span>Theme Mode</span>
              <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 normal-case transition-colors duration-200">
                {theme === 'dark' ? 'Dark theme' : 'Light theme'}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-100/90 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60 transition-colors duration-280">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 dark:bg-zinc-700/50 text-amber-500 dark:text-zinc-300 flex items-center justify-center shrink-0 transition-transform duration-300 ease-out">
                    <div className={`transition-all duration-300 ease-out transform ${theme === 'dark' ? 'rotate-180 scale-95' : 'rotate-0 scale-100'}`}>
                      {theme === 'dark' ? <Moon className="w-4 h-4 text-zinc-300" /> : <Sun className="w-4 h-4 text-amber-500" />}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block leading-none transition-colors duration-200">
                      {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight block mt-1 transition-colors duration-200">
                      {theme === 'dark' ? 'Dark charcoal palette' : 'High-contrast day palette'}
                    </span>
                  </div>
                </div>

                {/* Tactile spring toggle switch with micro icon */}
                <button
                  type="button"
                  onClick={onToggleTheme}
                  aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-out focus:outline-none active:scale-95 ${
                    theme === 'dark' ? 'bg-zinc-700 dark:bg-zinc-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  title="Toggle Light / Dark mode"
                >
                  <span
                    className={`pointer-events-none inline-flex items-center justify-center h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                      theme === 'dark' ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  >
                    {theme === 'dark' ? (
                      <Moon className="w-2.5 h-2.5 text-zinc-800" />
                    ) : (
                      <Sun className="w-2.5 h-2.5 text-amber-500" />
                    )}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Section: Account & Tools */}
          <div className={`transition-all duration-300 delay-150 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isOpen ? 'translate-x-0 opacity-100' : 'translate-x-5 opacity-0'
          }`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 mb-1.5">
              Account &amp; Tools
            </div>
            <div className="space-y-1">
              {/* Create Audit Report Tool */}
              {onOpenCreateAuditReport && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenCreateAuditReport();
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-amber-50/80 dark:hover:bg-amber-950/40 border border-transparent hover:border-amber-300 dark:hover:border-amber-700/60 transition-all duration-150 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight truncate flex items-center gap-1.5">
                        <span>Create Audit Report</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                          IATD
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        Map IATD rows into ENCODING template
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-amber-600 dark:text-amber-400 group-hover:translate-x-0.5 transition-transform duration-200 shrink-0 font-bold">&rarr;</span>
                </button>
              )}

              {/* Change Profile Photo Setting */}
              <button
                type="button"
                onClick={() => setIsPhotoModalOpen(true)}
                className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800/80 transition-all duration-150 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight truncate">
                      Change Profile Photo
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      Upload avatar or reset to Google
                    </div>
                  </div>
                </div>
                <span className="text-xs text-slate-400 group-hover:translate-x-0.5 transition-transform duration-200 shrink-0">&rarr;</span>
              </button>

              {/* Switch Google Account */}
              {onSwitchEmail && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onSwitchEmail();
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800/80 transition-all duration-150 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                      <RefreshCw className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight truncate">
                        Switch Google Account
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        Change active Google email
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 group-hover:translate-x-0.5 transition-transform duration-200 shrink-0">&rarr;</span>
                </button>
              )}

              {/* Install PWA */}
              {onInstallClick && (
                <button
                  type="button"
                  onClick={handleInstall}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800/80 transition-all duration-150 flex items-center justify-between gap-2 cursor-pointer group active:scale-98"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                      <Download className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight truncate">
                        Install App (PWA)
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        Home screen offline shortcut
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 group-hover:translate-x-0.5 transition-transform duration-200 shrink-0">&rarr;</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Section: Log Out & Footer */}
        <div className={`p-3 sm:p-4 border-t border-slate-200/90 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/80 space-y-2 shrink-0 transition-all duration-300 delay-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}>
          {userEmail && (
            <button
              type="button"
              onClick={handleSignOutClick}
              className="w-full text-left px-3.5 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-900/60 transition-all duration-150 flex items-center gap-3 cursor-pointer active:scale-98 shadow-2xs group"
            >
              <div className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                <LogOut className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold leading-tight">Log Out</div>
                <div className="text-[10px] text-rose-600/70 dark:text-rose-400/70">
                  Return to sign-in screen
                </div>
              </div>
            </button>
          )}

          <div className="text-center text-[9.5px] text-slate-400 dark:text-slate-500 pt-0.5">
            Inventory Hub • Offline Inventory Compliance PWA
          </div>
        </div>
      </div>

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

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      {/* Horizontal Hamburger Menu Trigger Button with Animated Morphing Icon */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isOpen}
        className={`p-1.5 sm:p-2 rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 active:scale-90 ${
          isOpen
            ? 'bg-slate-200 dark:bg-zinc-700 text-slate-900 dark:text-white shadow-inner scale-95'
            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800/80 hover:scale-102'
        }`}
        title="Menu: Theme mode, change profile photo, switch account, and log out"
      >
        {userPhoto ? (
          <img
            src={userPhoto}
            alt={displayName}
            className="w-6 h-6 rounded-full object-cover border border-zinc-300 dark:border-zinc-600 transition-transform duration-200 hover:scale-105"
            referrerPolicy="no-referrer"
          />
        ) : null}
        {/* Animated Morphing Hamburger Icon */}
        <div className="w-5 h-4 flex flex-col justify-between items-center relative shrink-0">
          <span
            className={`block h-0.5 bg-current rounded-full transition-all duration-280 ease-[cubic-bezier(0.16,1,0.3,1)] origin-center ${
              isOpen ? 'translate-y-[7px] rotate-45 w-4' : 'translate-y-0 rotate-0 w-4.5'
            }`}
          />
          <span
            className={`block h-0.5 w-4.5 bg-current rounded-full transition-all duration-180 ease-out ${
              isOpen ? 'opacity-0 scale-x-0' : 'opacity-100 scale-x-100'
            }`}
          />
          <span
            className={`block h-0.5 bg-current rounded-full transition-all duration-280 ease-[cubic-bezier(0.16,1,0.3,1)] origin-center ${
              isOpen ? '-translate-y-[7px] -rotate-45 w-4' : 'translate-y-0 rotate-0 w-4.5'
            }`}
          />
        </div>
      </button>

      {/* Portaled Drawer to Body so it spans full viewport height regardless of header containing blocks */}
      {mounted && createPortal(drawerContent, document.body)}
    </div>
  );
};
