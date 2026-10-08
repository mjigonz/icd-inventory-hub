import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  UserPlus,
  X,
  Sun,
  Moon,
  ExternalLink,
  Zap,
  User,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import { getRememberedUser, clearRememberedUser, SignInOptions } from '../services/auth';
import { RememberedUser } from '../types';
import { ThemeMode } from '../hooks/useTheme';

interface SignInViewProps {
  onSignIn: (options?: SignInOptions) => void;
  onAuditorSignIn?: (displayName: string, email?: string) => void;
  isLoading: boolean;
  error?: string | null;
  onClearError?: () => void;
  onCancelSignIn?: () => void;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}

export const SignInView: React.FC<SignInViewProps> = ({
  onSignIn,
  onAuditorSignIn,
  isLoading,
  error,
  onClearError,
  onCancelSignIn,
  theme = 'light',
  onToggleTheme,
}) => {
  const [rememberedUser, setRememberedUser] = useState<RememberedUser | null>(() => getRememberedUser());
  const [showAuditorForm, setShowAuditorForm] = useState(false);
  const [auditorName, setAuditorName] = useState(() => rememberedUser?.displayName || 'Auditor');
  const [auditorEmail, setAuditorEmail] = useState(() => rememberedUser?.email || 'mjigonzalessidc@gmail.com');

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const isInterruptedOrClosed = Boolean(
    error &&
    (error.toLowerCase().includes('closed') ||
      error.toLowerCase().includes('interrupted') ||
      error.toLowerCase().includes('popup') ||
      error.toLowerCase().includes('authorized') ||
      error.toLowerCase().includes('network'))
  );

  useEffect(() => {
    // Refresh remembered user state on mount
    const saved = getRememberedUser();
    if (saved) {
      setRememberedUser(saved);
      if (!auditorName || auditorName === 'Auditor') {
        setAuditorName(saved.displayName);
      }
      if (!auditorEmail || auditorEmail === 'mjigonzalessidc@gmail.com') {
        setAuditorEmail(saved.email);
      }
    }
  }, []);

  const handleForgetAccount = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearRememberedUser();
    setRememberedUser(null);
  };

  const handleDirectAuditorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onAuditorSignIn) {
      onAuditorSignIn(auditorName.trim() || 'Auditor', auditorEmail.trim() || undefined);
    }
  };

  const handleQuickAuditorContinue = () => {
    if (onAuditorSignIn) {
      if (rememberedUser) {
        onAuditorSignIn(rememberedUser.displayName, rememberedUser.email);
      } else {
        onAuditorSignIn(auditorName.trim() || 'Auditor', auditorEmail.trim() || undefined);
      }
    }
  };

  return (
    <div
      className={`min-h-screen relative flex flex-col justify-between p-4 sm:p-6 transition-colors duration-280 ${
        theme === 'dark' ? 'bg-[#121214] text-white dark' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top right floating theme toggle */}
      {onToggleTheme && (
        <div className="absolute top-3.5 right-3.5 z-20">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            className="w-9 h-9 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200/90 dark:border-zinc-700/80 shadow-xs flex items-center justify-center text-slate-700 dark:text-zinc-200 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
            title="Toggle Light / Dark mode"
          >
            <div
              className={`transition-all duration-300 ease-out transform ${
                theme === 'dark' ? 'rotate-180 scale-95' : 'rotate-0 scale-100'
              }`}
            >
              {theme === 'dark' ? (
                <Moon className="w-4 h-4 text-zinc-300" />
              ) : (
                <Sun className="w-4 h-4 text-sky-500" />
              )}
            </div>
          </button>
        </div>
      )}

      <SEOHead
        title="Sign In with Google"
        description="Sign in to Inventory Hub to manage physical inventory counting, scan retail barcodes, and sync with branch Google Spreadsheets."
        routePath="/signin"
      />

      {/* Top branding */}
      <div className="pt-2 sm:pt-4 max-w-md mx-auto w-full text-center flex flex-col items-center">
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
      <div className="max-w-md mx-auto w-full my-auto py-3 space-y-3">
        {/* Dedicated Interrupted / Closed Window Resolution Panel */}
        {isInterruptedOrClosed && (
          <div className="bg-blue-50/80 dark:bg-blue-950/40 border-2 border-blue-200 dark:border-blue-800/80 rounded-3xl p-4 sm:p-5 text-xs space-y-3.5 shadow-sm animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black shrink-0 mt-0.5">
                  !
                </div>
                <div>
                  <h3 className="font-bold text-blue-950 dark:text-blue-200 text-sm">
                    Sign-In Window Closed or Interrupted
                  </h3>
                  <p className="text-slate-700 dark:text-slate-300 text-[11px] mt-0.5 leading-relaxed">
                    The Google popup window was closed before completing authorization. Choose one of the quick options below to continue:
                  </p>
                </div>
              </div>
              {onClearError && (
                <button
                  type="button"
                  onClick={onClearError}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
                  title="Dismiss error"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Quick Resolution Actions */}
            <div className="space-y-2 pt-1">
              {/* Option 1: Retry Google Sign In */}
              <button
                type="button"
                onClick={() => {
                  if (onClearError) onClearError();
                  onSignIn({ forceSelectAccount: true });
                }}
                disabled={isLoading}
                className="w-full py-2.5 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition active:scale-98 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Google Sign-In</span>
              </button>

              {/* Option 2: Auditor Field Mode (Instant access) */}
              {onAuditorSignIn && (
                <button
                  type="button"
                  onClick={handleQuickAuditorContinue}
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-900 dark:bg-zinc-800 hover:bg-slate-800 dark:hover:bg-zinc-700 text-white font-semibold text-xs flex items-center justify-center gap-2 transition active:scale-98 border border-slate-700 dark:border-zinc-700 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 text-sky-400" />
                  <span>
                    Continue as {rememberedUser?.displayName || 'Auditor'} (Field Mode)
                  </span>
                </button>
              )}

              {/* Option 3: Open in Standalone Tab if inside iframe */}
              {isInIframe && typeof window !== 'undefined' && (
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2 px-3 rounded-xl bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-900 text-slate-800 dark:text-zinc-200 text-[11px] font-medium flex items-center justify-center gap-1.5 transition border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3 text-slate-500" />
                  <span>Open in Full Browser Tab (Bypasses Preview Sandbox)</span>
                </a>
              )}
            </div>

            <div className="bg-slate-100/90 dark:bg-slate-900/90 rounded-xl p-2.5 border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 leading-normal">
              <strong>Tip:</strong> If your browser blocked popups, look at the top-right of your address bar for the small <strong>Pop-up blocked icon (🚫)</strong> and click "Always allow popups".
            </div>
          </div>
        )}

        {/* Regular Container Card */}
        <div className="bg-white dark:bg-slate-800/90 backdrop-blur-md rounded-3xl p-5 sm:p-6 border border-slate-200/90 dark:border-slate-700/80 shadow-xl space-y-4 transition-colors">
          {error && !isInterruptedOrClosed && (
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

          {/* Active Connection Guidance Banner */}
          {isLoading && (
            <div className="p-3 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  <div className="w-3.5 h-3.5 border-2 border-zinc-700 dark:border-zinc-300 border-t-transparent rounded-full animate-spin" />
                  <span>Connecting to Google...</span>
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
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                A Google sign-in window was opened. If you closed it or don't see it, look for the popup icon in your browser URL bar.
              </p>
            </div>
          )}

          {/* Sign In Options Area */}
          <div className="pt-1 space-y-2.5">
            {!isInterruptedOrClosed && (
              <>
                {rememberedUser ? (
                  /* 2nd-time User: "Continue as <Name>" Card */
                  <div className="space-y-2 animate-in fade-in zoom-in-98">
                    <button
                      onClick={() => onSignIn({ loginHint: rememberedUser.email, forceSelectAccount: false })}
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
                        <div className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                          Welcome Back
                        </div>
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
              </>
            )}

            {/* Offline / Field Auditor Direct Access Section */}
            {onAuditorSignIn && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAuditorForm(!showAuditorForm)}
                  className="w-full flex items-center justify-between py-2 px-1 text-xs text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition font-medium cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Auditor Field Mode (Direct Access)</span>
                  </div>
                  {showAuditorForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showAuditorForm && (
                  <form
                    onSubmit={handleDirectAuditorSubmit}
                    className="mt-2 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5 animate-in fade-in"
                  >
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-normal">
                      Use this mode to start counting immediately without Google OAuth popups. Full offline caching and scanning supported.
                    </p>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                        Auditor Name
                      </label>
                      <input
                        type="text"
                        value={auditorName}
                        onChange={(e) => setAuditorName(e.target.value)}
                        placeholder="e.g. Maria Gonzales"
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                        Auditor Email
                      </label>
                      <input
                        type="email"
                        value={auditorEmail}
                        onChange={(e) => setAuditorEmail(e.target.value)}
                        placeholder="e.g. mjigonzalessidc@gmail.com"
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-98 shadow-xs cursor-pointer"
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>Start Auditor Session</span>
                    </button>
                  </form>
                )}
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
      <div className="pb-3 max-w-md mx-auto w-full text-center text-xs text-slate-500">
        <p>Built for physical inventory counting teams &amp; auditors</p>
      </div>
    </div>
  );
};
