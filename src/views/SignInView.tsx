import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  UserPlus,
  X,
  Sun,
  Moon,
  Zap,
  User,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import {
  TelegramDoodleBackground,
  BackgroundIconTheme,
} from '../components/TelegramDoodleBackground';
import { PanelDecoration } from '../components/PanelDecoration';
import { getRememberedUser, clearRememberedUser, SignInOptions } from '../services/auth';
import { RememberedUser } from '../types';
import { ThemeMode } from '../hooks/useTheme';
import { useScrollLock } from '../hooks/useScrollLock';

interface SignInViewProps {
  onSignIn: (options?: SignInOptions) => void;
  onInstantContinue?: (remembered?: RememberedUser | null) => void;
  onAuditorSignIn?: (displayName: string, email?: string) => void;
  isLoading: boolean;
  error?: string | null;
  onClearError?: () => void;
  onCancelSignIn?: () => void;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
  backgroundTheme?: BackgroundIconTheme;
}

export const SignInView: React.FC<SignInViewProps> = ({
  onSignIn,
  onInstantContinue,
  onAuditorSignIn,
  isLoading,
  error,
  onClearError,
  onCancelSignIn,
  theme = 'light',
  onToggleTheme,
  backgroundTheme = 'default',
}) => {
  const [rememberedUser, setRememberedUser] = useState<RememberedUser | null>(() => getRememberedUser());
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);
  useScrollLock(isNicknameModalOpen);
  const [guestNickname, setGuestNickname] = useState('');
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const nicknameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Refresh remembered user state on mount
    const saved = getRememberedUser();
    if (saved && !saved.email.endsWith('@sidc.local')) {
      setRememberedUser(saved);
    } else {
      setRememberedUser(null);
    }
  }, []);

  useEffect(() => {
    if (isNicknameModalOpen) {
      setNicknameError(null);
      const timer = setTimeout(() => {
        nicknameInputRef.current?.focus({ preventScroll: true });
      }, 320);
      return () => clearTimeout(timer);
    } else {
      nicknameInputRef.current?.blur();
    }
  }, [isNicknameModalOpen]);

  const handleForgetAccount = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearRememberedUser();
    setRememberedUser(null);
  };

  const handleOpenGuestModal = () => {
    setGuestNickname('');
    setNicknameError(null);
    setIsNicknameModalOpen(true);
  };

  const handleCloseGuestModal = () => {
    setIsNicknameModalOpen(false);
    setNicknameError(null);
  };

  const handleSubmitGuestNickname = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = guestNickname.trim();
    if (!clean) {
      setNicknameError('Name is required to enter Guest Mode.');
      nicknameInputRef.current?.focus();
      return;
    }
    if (clean.toLowerCase() === 'guest') {
      setNicknameError('Please enter your actual name instead of "Guest".');
      nicknameInputRef.current?.focus();
      return;
    }

    try {
      localStorage.setItem('countsheet_guest_nickname', clean);
    } catch {}

    const cleanEmail = `${clean.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sidc.local`;
    setIsNicknameModalOpen(false);
    if (onAuditorSignIn) {
      onAuditorSignIn(clean, cleanEmail);
    }
  };

  return (
    <div
      data-window-theme={backgroundTheme}
      className={`min-h-screen relative flex flex-col justify-between p-4 sm:p-6 bg-[var(--theme-bg)] text-[var(--theme-text)] transition-colors duration-[var(--duration-theme)] ease-in-out ${
        theme === 'dark' ? 'dark' : ''
      }`}
    >
      {/* Background icons pattern */}
      <TelegramDoodleBackground themeId={backgroundTheme} />

      {/* Top right floating Theme button */}
      <div className="absolute top-3.5 right-3.5 z-20 flex items-center gap-2">
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            className="relative w-9 h-9 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200/90 dark:border-zinc-700/80 shadow-xs flex items-center justify-center text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700/80 transition-colors duration-[var(--duration-theme)] ease-in-out cursor-pointer overflow-hidden"
            title="Toggle Light / Dark mode"
          >
            <Sun
              className={`w-4 h-4 text-sky-500 absolute theme-toggle-icon ${
                theme === 'dark'
                  ? 'opacity-0 pointer-events-none'
                  : 'opacity-100'
              }`}
            />
            <Moon
              className={`w-4 h-4 text-zinc-200 absolute theme-toggle-icon ${
                theme === 'dark'
                  ? 'opacity-100'
                  : 'opacity-0 pointer-events-none'
              }`}
            />
          </button>
        )}
      </div>

      <SEOHead
        title="Sign In with Google"
        description="Sign in to Inventory Hub to manage physical inventory counting, scan retail barcodes, and sync with branch Google Spreadsheets."
        routePath="/signin"
      />

      {/* Top branding */}
      <div className="relative z-10 pt-2 sm:pt-4 max-w-md mx-auto w-full text-center flex flex-col items-center">
        <div className="w-14 h-14 rounded-2xl bg-white dark:bg-zinc-800 shadow-md border border-slate-200 dark:border-zinc-700 flex items-center justify-center p-2 mb-3 shrink-0">
          <img src="/icd-logo.svg" alt="Inventory Hub Logo" width="40" height="40" className="w-full h-full object-contain aspect-square shrink-0" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
          Inventory Hub
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-xs sm:text-sm font-semibold tracking-wide mt-1">
          Branch Inventory Audit &amp; Counting System
        </p>
      </div>

      {/* Main card */}
      <div className="relative z-10 max-w-md mx-auto w-full my-auto py-3 space-y-3">
        {/* Regular Container Card */}
        <div className="relative bg-white dark:bg-slate-800/90 backdrop-blur-md rounded-3xl p-5 sm:p-6 border border-slate-200/90 dark:border-slate-700/80 shadow-xl space-y-4 transition-colors">
          <PanelDecoration position="top-right" tier="major" variant={0} />
          <PanelDecoration position="top-left" tier="secondary" variant={1} />
          <PanelDecoration position="top-border" tier="playful" variant={3} />
          <PanelDecoration position="bottom-left" tier="secondary" variant={2} />
          <PanelDecoration position="bottom-right" tier="playful" variant={1} />
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 dark:text-rose-400 mt-0.5" />
                <div className="leading-relaxed">{error}</div>
              </div>
              {onClearError && (
                <button
                  type="button"
                  onClick={onClearError}
                  className="text-rose-400 hover:text-rose-600 p-0.5 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Active Connection Banner */}
          {isLoading && (
            <div className="p-3 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  <div className="w-3.5 h-3.5 border-2 border-zinc-700 dark:border-zinc-300 border-t-transparent rounded-full animate-spin" />
                  <span>Signing in with Google...</span>
                </div>
                {onCancelSignIn && (
                  <button
                    onClick={onCancelSignIn}
                    className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700/50 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Sign In Options Area */}
          <div className="pt-1 space-y-2.5">
            {rememberedUser ? (
                  /* Returning User: Instant "Continue as <Name>" Card (Zero Popup) */
                  <div className="space-y-2 animate-in fade-in zoom-in-98">
                    <button
                      onClick={() =>
                        onInstantContinue
                          ? onInstantContinue(rememberedUser)
                          : onSignIn({ loginHint: rememberedUser.email, forceSelectAccount: false })
                      }
                      disabled={isLoading}
                      className="w-full group p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/90 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 shadow-sm active:scale-98 transition flex items-center gap-3 text-left cursor-pointer disabled:opacity-75"
                    >
                      {/* Avatar or Initials */}
                      <div className="relative shrink-0">
                        {rememberedUser.photoURL ? (
                          <img
                            src={rememberedUser.photoURL}
                            alt={rememberedUser.displayName}
                            className="w-11 h-11 rounded-full object-cover border-2 border-zinc-500 shadow-sm"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-zinc-800 dark:bg-zinc-700 text-white font-black text-base flex items-center justify-center border-2 border-zinc-600 shadow-sm">
                            {rememberedUser.displayName.charAt(0).toUpperCase()}
                          </div>
                        )}
                        {/* Tiny Google G badge */}
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center shadow-xs border border-slate-200 dark:border-slate-700">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 48 48">
                            <path
                              fill="#EA4335"
                              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                            />
                            <path
                              fill="#4285F4"
                              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                            />
                            <path
                              fill="#34A853"
                              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                            />
                          </svg>
                        </div>
                      </div>

                      {/* Name & Continue prompt */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          Continue as {rememberedUser.displayName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono">
                          {rememberedUser.email}
                        </div>
                      </div>

                      {/* Arrow indicator */}
                      <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shrink-0 group-hover:bg-zinc-900 group-hover:text-white dark:group-hover:bg-zinc-700 dark:group-hover:text-white transition">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </button>

                    {/* Secondary Actions: Switch account or Forget */}
                    <div className="flex items-center justify-between px-1 text-xs">
                      <button
                        type="button"
                        onClick={() => onSignIn({ forceSelectAccount: true })}
                        disabled={isLoading}
                        className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Use a different Google account</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleForgetAccount}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition flex items-center gap-1 cursor-pointer"
                        title="Forget this remembered account on this device"
                      >
                        <X className="w-3 h-3" />
                        <span>Forget</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* 1st-time User: Generic Google Sign-In */
                  <button
                    onClick={() => onSignIn({ forceSelectAccount: true })}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-slate-50 dark:bg-slate-900/90 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-98 transition text-slate-800 dark:text-white font-semibold text-xs sm:text-sm shadow-xs border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-75"
                  >
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                    <span>{isLoading ? 'Connecting to Google...' : 'Sign in with Google'}</span>
                  </button>
                )}

            {/* Guest Mode Access */}
            {onAuditorSignIn && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleOpenGuestModal}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold text-xs border border-blue-200 dark:border-blue-800/80 active:scale-98 transition shadow-2xs cursor-pointer disabled:opacity-50"
                  title="Enter Guest Mode to view Masterdata and Forms without Google Sign-In"
                >
                  <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Guest Mode</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 text-center pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Encrypted local storage with full PWA offline support</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 pb-3 max-w-md mx-auto w-full text-center text-xs text-slate-500">
        <p>Built for physical inventory counting teams &amp; auditors</p>
      </div>

      {/* Guest Nickname Modal (kept mounted at root so fixed inset-0 covers full viewport and bottom-to-middle transition never drops initial frame) */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 dark:bg-black/75 backdrop-blur-sm ui-modal-backdrop ${
          isNicknameModalOpen
            ? 'ui-modal-open pointer-events-auto'
            : 'pointer-events-none'
        }`}
        style={{
          visibility: isNicknameModalOpen ? 'visible' : 'hidden',
          transition: isNicknameModalOpen
            ? 'opacity 540ms cubic-bezier(0.12, 0.96, 0.22, 1), visibility 0ms linear 0ms'
            : 'opacity 540ms cubic-bezier(0.12, 0.96, 0.22, 1), visibility 0ms linear 540ms',
        }}
        aria-hidden={!isNicknameModalOpen}
        onClick={handleCloseGuestModal}
      >
        <div
          className={`relative w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/90 shadow-2xl overflow-hidden ui-modal-slide-bottom ${
            isNicknameModalOpen ? 'ui-modal-open' : ''
          }`}
          onClick={(e) => e.stopPropagation()}
        >
            {/* Modal Header */}
            <div className="px-5 py-4 bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/25 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                    Guest Mode
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Enter your name to continue
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseGuestModal}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/70 transition cursor-pointer shrink-0"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitGuestNickname} noValidate className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                  Your Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={nicknameInputRef}
                    type="text"
                    value={guestNickname}
                    onChange={(e) => {
                      setGuestNickname(e.target.value);
                      if (nicknameError) setNicknameError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        handleCloseGuestModal();
                      }
                    }}
                    placeholder="Enter your name..."
                    maxLength={24}
                    aria-required="true"
                    aria-invalid={Boolean(nicknameError)}
                    className={`w-full pl-9 pr-3.5 py-2.5 text-sm rounded-xl bg-slate-50 dark:bg-slate-800/90 border ${
                      nicknameError
                        ? 'border-rose-400 dark:border-rose-500 focus:ring-rose-500'
                        : 'border-slate-200 dark:border-slate-700 focus:ring-blue-500'
                    } text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:bg-white dark:focus:bg-slate-800 transition font-medium`}
                    required
                  />
                </div>
                {nicknameError && (
                  <p className="text-xs text-rose-500 dark:text-rose-400 mt-1.5 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{nicknameError}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleCloseGuestModal}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  aria-disabled={!guestNickname.trim()}
                  className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-xs ${
                    guestNickname.trim()
                      ? 'bg-blue-600 hover:bg-blue-500 text-white active:scale-98 cursor-pointer'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <span>Continue</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>
        </div>
    </div>
  );
};
