import React from 'react';
import {
  Download,
  Smartphone,
  Monitor,
  ExternalLink,
  X,
  Sparkles,
} from 'lucide-react';

interface InstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInstallable: boolean;
  onNativeInstall: () => void;
}

export const InstallModal: React.FC<InstallModalProps> = ({
  isOpen,
  onClose,
  isInstallable,
  onNativeInstall,
}) => {
  if (!isOpen) return null;

  const isInIframe = window.self !== window.top;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/20 dark:bg-black/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/icon.svg"
              alt="Inventory Hub Logo"
              width="48"
              height="48"
              className="w-12 h-12 rounded-2xl shadow-md shadow-blue-500/20 object-contain aspect-square shrink-0"
              referrerPolicy="no-referrer"
            />
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Install Inventory Hub
              </h3>
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                Install to home screen for 100% offline counting
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* If the browser's native prompt is ready */}
        {isInstallable ? (
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 text-center space-y-3">
            <p className="text-xs text-blue-900 dark:text-blue-200 font-medium">
              Your browser is ready to install Inventory Hub as a standalone app!
            </p>
            <button
              onClick={() => {
                onNativeInstall();
                onClose();
              }}
              className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition active:scale-98 cursor-pointer"
            >
              <Download className="w-4 h-4 text-white" />
              <span>Install to Device Now</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Note about iFrame preview */}
            {isInIframe && (
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 text-xs flex items-start gap-2">
                <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                <div className="leading-relaxed">
                  <strong>Preview Notice:</strong> Web browsers disable install prompts inside preview windows. Open the app in its own tab or on your phone to install directly!
                </div>
              </div>
            )}

            {/* Platform Instructions */}
            <div className="space-y-2 text-xs">
              {/* iOS Guide */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                  <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>iPhone / iPad (Safari)</span>
                </div>
                <ol className="list-decimal pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-[11px] leading-relaxed">
                  <li>
                    Tap the <strong className="text-slate-900 dark:text-slate-100">Share</strong> icon (square with arrow) in Safari.
                  </li>
                  <li>
                    Scroll down and tap <strong className="text-slate-900 dark:text-slate-100">Add to Home Screen</strong>.
                  </li>
                  <li>
                    Tap <strong className="text-blue-600 dark:text-blue-400">Add</strong> in the top-right corner.
                  </li>
                </ol>
              </div>

              {/* Android Guide */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                  <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Android (Chrome / Edge)</span>
                </div>
                <ol className="list-decimal pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-[11px] leading-relaxed">
                  <li>
                    Tap Chrome's <strong className="text-slate-900 dark:text-slate-100">Three Dots (&vellip;)</strong> menu at the top-right.
                  </li>
                  <li>
                    Tap <strong className="text-slate-900 dark:text-slate-100">Install app</strong> or <strong className="text-slate-900 dark:text-slate-100">Add to Home screen</strong>.
                  </li>
                  <li>
                    Tap <strong className="text-blue-600 dark:text-blue-400">Install</strong> to confirm.
                  </li>
                </ol>

                <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-700 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-800/60 p-2 rounded-lg leading-relaxed">
                  <strong>Reinstalling & Chrome says &ldquo;This cannot be installed&rdquo;?</strong>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5 text-[10.5px]">
                    <li>
                      <strong>Clear Site Data:</strong> Tap the lock or tune icon (&#x2257;) in Chrome&apos;s address bar &rarr; <em>Site settings</em> &rarr; tap <em>Clear &amp; reset</em>, then reload.
                    </li>
                    <li>
                      <strong>Check Phone Settings:</strong> Go to Android <em>Settings &rarr; Apps</em>. If a previous version of &ldquo;Inventory Hub&rdquo; is still installed, tap it and select <em>Uninstall</em>.
                    </li>
                  </ul>
                </div>
              </div>

              {/* Desktop Guide */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                  <Monitor className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Desktop (Chrome / Edge)</span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px] pl-1 leading-relaxed">
                  Click the <strong className="text-slate-900 dark:text-slate-100">Install icon</strong> (screen with arrow 📥) in the address bar, or click Menu (&vellip;) &rarr; <em>Save and share</em> &rarr; <em>Install page as app</em>.
                </p>
              </div>
            </div>

            {/* Direct Link button */}
            <a
              href="https://icd-inventory-hub.icdsystem.workers.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-xs flex items-center justify-center gap-2 transition active:scale-98"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Open in Full Mobile / Browser Tab</span>
            </a>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 font-medium text-xs transition cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  );
};
