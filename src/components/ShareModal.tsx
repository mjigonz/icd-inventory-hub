import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  QrCode,
  Share2,
  Copy,
  Check,
  Download,
  Smartphone,
  X,
  Sparkles,
  ExternalLink,
  Link,
} from 'lucide-react';
import { SelectedBranch } from '../types';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  branch?: SelectedBranch | null;
  isInstallable?: boolean;
  onNativeInstall?: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  branch,
  isInstallable = false,
  onNativeInstall,
}) => {
  const [mounted, setMounted] = useState(false);
  const { shouldRender, isVisible } = useAnimatedPresence(isOpen, 200);
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [includeBranch, setIncludeBranch] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle Escape key (scroll lock is managed via useAnimatedPresence -> useScrollLock)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Primary Cloudflare Workers URL for sharing with coworkers
  const CLOUDFLARE_WORKERS_URL = 'https://icd-inventory-hub.icdsystem.workers.dev';
  const baseUrl =
    typeof window !== 'undefined' &&
    !window.location.origin.includes('run.app') &&
    !window.location.origin.includes('localhost')
      ? `${window.location.origin}${window.location.pathname}`
      : CLOUDFLARE_WORKERS_URL;

  const shareUrl = useMemo(() => {
    if (includeBranch && branch?.id) {
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}spreadsheetId=${encodeURIComponent(branch.id)}&branch=${encodeURIComponent(branch.name)}`;
    }
    return baseUrl;
  }, [baseUrl, includeBranch, branch]);

  // Generate QR code whenever shareUrl changes, with guaranteed fallback
  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;

    const generateQR = async () => {
      try {
        const qrLib = (QRCode as any)?.toDataURL ? QRCode : (QRCode as any)?.default;
        if (qrLib && typeof qrLib.toDataURL === 'function') {
          const dataUri = await qrLib.toDataURL(shareUrl, {
            width: 320,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: {
              dark: '#0f172a',
              light: '#ffffff',
            },
          });
          if (isSubscribed) {
            setQrCodeUrl(dataUri);
            return;
          }
        }
      } catch (err) {
        console.warn('QRCode library toDataURL failed, falling back:', err);
      }

      // Safe immediate fallback: high-resolution QR service
      if (isSubscribed) {
        setQrCodeUrl(
          `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(shareUrl)}`
        );
      }
    };

    generateQR();

    return () => {
      isSubscribed = false;
    };
  }, [shareUrl, isOpen]);

  // Copy link handler with robust fallback
  const handleCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('input');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    }
  };

  // Safe native share to all device messaging platforms
  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Inventory Hub',
          text: branch
            ? `Open Inventory Hub for ${branch.name} counting & barcode scanning`
            : 'Open Inventory Hub for physical inventory counting',
          url: shareUrl,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }
    // Fallback if native share is not supported
    handleCopy();
  };

  if (!shouldRender || !mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[70] bg-slate-950/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 cursor-pointer ui-modal-backdrop ${
        isVisible ? 'ui-modal-open pointer-events-auto' : 'pointer-events-none'
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share and Download QR code"
    >
      <div
        className={`bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-zinc-800 text-slate-900 dark:text-white rounded-3xl max-w-sm sm:max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto relative cursor-default ui-modal-panel ${
          isVisible ? 'ui-modal-open pointer-events-auto' : 'pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400 border border-blue-200/80 dark:border-blue-500/30 flex items-center justify-center shadow-xs shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-tight">
                Share &amp; Scan to Open
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                Scan with smartphone camera to launch app
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
            title="Close"
            aria-label="Close share dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* QR Code Presentation Box */}
        <div className="flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-zinc-900/90 rounded-2xl border border-slate-200/80 dark:border-zinc-800 text-center space-y-3">
          <div className="relative p-2.5 bg-white rounded-2xl shadow-md border border-slate-200 dark:border-zinc-700 flex items-center justify-center">
            {qrCodeUrl ? (
              <img
                src={qrCodeUrl}
                alt="App Download QR Code"
                className="w-48 h-48 sm:w-56 sm:h-56 object-contain rounded-lg"
              />
            ) : (
              <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center text-xs text-slate-400">
                Generating QR code...
              </div>
            )}
            {/* Center ICD Emblem in QR */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-white shadow-xs p-1 border border-slate-200 flex items-center justify-center pointer-events-none shrink-0">
              <img src="/icd-logo.svg" alt="ICD" width="24" height="24" className="w-full h-full object-contain aspect-square shrink-0" />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>No typing needed &mdash; point camera &amp; tap</span>
            </p>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-normal max-w-xs mx-auto">
              Open your phone&apos;s camera app, point it at this QR code, and tap the link to open immediately.
            </p>
          </div>
        </div>

        {/* Optional Branch deep link toggle */}
        {branch && (
          <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-zinc-900/60 rounded-xl border border-slate-200/70 dark:border-zinc-800 text-xs">
            <div className="min-w-0 pr-2">
              <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">
                Include active branch: {branch.name}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-zinc-400 block truncate">
                Directly opens this branch on coworker&apos;s phone
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIncludeBranch(!includeBranch)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                includeBranch ? 'bg-blue-600' : 'bg-slate-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                  includeBranch ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}

        {/* Share, Copy & Save QR Actions */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {/* Share Link button (Native Web Share API) */}
          <button
            type="button"
            onClick={handleNativeShare}
            className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-98 shadow-xs cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share Link</span>
          </button>

          {/* Copy Link button */}
          <button
            type="button"
            onClick={handleCopy}
            className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-98 shadow-xs cursor-pointer ${
              copied
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Link className="w-3.5 h-3.5" />}
            <span>{copied ? 'Link Copied!' : 'Copy Link'}</span>
          </button>
        </div>

        {/* Save QR Image button */}
        {qrCodeUrl && (
          <div>
            <a
              href={qrCodeUrl}
              download="inventory-hub-qr.png"
              className="w-full py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition active:scale-98 border border-slate-200 dark:border-zinc-700 cursor-pointer text-center"
            >
              <Download className="w-3.5 h-3.5 text-slate-600 dark:text-zinc-300" />
              <span>Save QR Image</span>
            </a>
          </div>
        )}

        {/* Native Install Option on Current Device if ready */}
        {isInstallable && onNativeInstall && (
          <div className="p-3 bg-blue-50/80 dark:bg-blue-950/30 rounded-2xl border border-blue-200/80 dark:border-blue-800/60 flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-bold text-blue-900 dark:text-blue-200 block truncate">
                  Install on this device
                </span>
                <span className="text-[10px] text-blue-700 dark:text-blue-300 block truncate">
                  Standalone app with offline mode
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onNativeInstall();
                onClose();
              }}
              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shrink-0 cursor-pointer active:scale-95 transition"
            >
              Install
            </button>
          </div>
        )}

      </div>
    </div>,
    document.body
  );
};
