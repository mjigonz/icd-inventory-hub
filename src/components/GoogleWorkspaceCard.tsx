import React from 'react';
import { CheckCircle2, ShieldCheck, WifiOff, LogOut } from 'lucide-react';

interface GoogleWorkspaceCardProps {
  email: string | null;
  name?: string | null;
  onDisconnect?: () => void;
  isLoading?: boolean;
}

export const GoogleWorkspaceCard: React.FC<GoogleWorkspaceCardProps> = ({
  email,
  name,
  onDisconnect,
  isLoading = false,
}) => {
  const isRealGoogleUser = Boolean(email && !email.endsWith('.local'));

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-4 sm:p-5 transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-800 text-amber-400 flex items-center justify-center font-bold shadow-sm border border-slate-800 dark:border-slate-700">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">Google Workspace</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Google Drive &amp; Sheets Integration</p>
          </div>
        </div>

        {/* Connection status badge */}
        {isRealGoogleUser ? (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Connected</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Offline Local</span>
          </div>
        )}
      </div>

      <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-slate-900 dark:bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
            {name ? name.charAt(0).toUpperCase() : email ? email.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="min-w-0">
            {name && <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{name}</p>}
            <p className="text-xs text-slate-600 dark:text-slate-400 truncate font-mono">
              {email || 'Local Offline Session'}
            </p>
          </div>
        </div>

        {onDisconnect && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onDisconnect}
              disabled={isLoading}
              title="Sign out"
              className="inline-flex items-center justify-center p-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 active:scale-95 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 px-1">
        <ShieldCheck className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
        <span>
          {isRealGoogleUser
            ? 'Authorized for branch file search and countsheet submissions.'
            : 'Counting and scanning operate locally. Use top menu to switch accounts.'}
        </span>
      </div>
    </div>
  );
};
