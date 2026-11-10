import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, User, Upload, Image as ImageIcon, Trash2, Check, AlertCircle } from 'lucide-react';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface ChangePhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhoto: string | null;
  googlePhoto: string | null;
  displayName: string;
  onSave: (photoURL: string | null) => void;
}

const AVATAR_PRESET_PALETTES = [
  { id: 'blue', label: 'Ocean Blue', bg1: '#2563EB', bg2: '#1D4ED8' },
  { id: 'emerald', label: 'Emerald', bg1: '#10B981', bg2: '#047857' },
  { id: 'indigo', label: 'Indigo', bg1: '#6366F1', bg2: '#4338CA' },
  { id: 'amber', label: 'Amber', bg1: '#F59E0B', bg2: '#B45309' },
  { id: 'rose', label: 'Rose', bg1: '#F43F5E', bg2: '#BE123C' },
  { id: 'slate', label: 'Carbon', bg1: '#334155', bg2: '#0F172A' },
];

function buildInitialsAvatarDataUrl(name: string, bg1: string, bg2: string): string {
  const clean = (name || 'U').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : clean.slice(0, 2).toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bg1}" />
        <stop offset="100%" stop-color="${bg2}" />
      </linearGradient>
    </defs>
    <rect width="256" height="256" rx="128" fill="url(#g)" />
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="system-ui, -apple-system, sans-serif" font-size="96" font-weight="800" letter-spacing="2">${initials}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const ChangePhotoModal: React.FC<ChangePhotoModalProps> = ({
  isOpen,
  onClose,
  currentPhoto,
  googlePhoto,
  displayName,
  onSave,
}) => {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(currentPhoto);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { shouldRender, isVisible } = useAnimatedPresence(isOpen, 200);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPhoto(currentPhoto);
      setUploadError(null);
      setIsDraggingOver(false);
    }
  }, [isOpen, currentPhoto]);

  const compressAndResizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          try {
            const MAX_SIZE = 320;
            const canvas = document.createElement('canvas');
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;
            const targetSize = Math.min(MAX_SIZE, Math.max(128, minDim));
            canvas.width = targetSize;
            canvas.height = targetSize;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(dataUrl);
              return;
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);

            let compressed = canvas.toDataURL('image/webp', 0.86);
            if (!compressed || !compressed.startsWith('data:image/webp')) {
              compressed = canvas.toDataURL('image/jpeg', 0.86);
            }
            resolve(compressed);
          } catch {
            resolve(dataUrl);
          }
        };
        img.onerror = () => {
          resolve(dataUrl);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  };

  const processFileObject = async (file: File | null | undefined) => {
    setUploadError(null);
    if (!file) return;

    if (
      !file.type.startsWith('image/') &&
      !/\.(jpe?g|png|webp|gif|bmp|svg|avif|heic)$/i.test(file.name)
    ) {
      setUploadError('Please select a valid image file (JPG, PNG, WebP, GIF).');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setUploadError('Image size must be less than 25MB.');
      return;
    }

    setIsProcessingImage(true);
    try {
      const compressedDataUrl = await compressAndResizeImage(file);
      setSelectedPhoto(compressedDataUrl);
    } catch {
      setUploadError('Failed to process selected image file.');
    } finally {
      setIsProcessingImage(false);
    }
  };

  // Lock body scroll, listen for Escape key, and support pasting an image (Ctrl+V)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const blob = items[i].getAsFile();
          if (blob) {
            e.preventDefault();
            void processFileObject(blob);
            break;
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('paste', handlePaste);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('paste', handlePaste);
    };
  }, [isOpen, onClose]);

  if (!shouldRender || !mounted) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await processFileObject(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      await processFileObject(file);
    }
  };

  const handleUseGooglePhoto = () => {
    setUploadError(null);
    setSelectedPhoto(googlePhoto || null);
  };

  const handleRemovePhoto = () => {
    setUploadError(null);
    setSelectedPhoto(null);
  };

  const handleSave = () => {
    onSave(selectedPhoto);
    onClose();
  };

  const isGoogleSelected = Boolean(selectedPhoto && googlePhoto && selectedPhoto === googlePhoto);
  const isDefaultSelected = selectedPhoto === null;
  const isCustomUploaded = Boolean(selectedPhoto && (!googlePhoto || selectedPhoto !== googlePhoto));

  const modalContent = (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={`fixed inset-0 z-[250] flex items-center justify-center p-4 bg-slate-950/50 dark:bg-black/70 backdrop-blur-xs ui-modal-backdrop ${
        isVisible ? 'ui-modal-open pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {/* Centered Minimalist Modal Container */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm bg-white dark:bg-[#161618] rounded-2xl border ${
          isDraggingOver
            ? 'border-indigo-500 ring-2 ring-indigo-500/40'
            : 'border-slate-200 dark:border-zinc-800'
        } shadow-2xl p-5 space-y-4 ui-modal-panel ${isVisible ? 'ui-modal-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Change Profile Photo"
      >
        {/* Native file input inside modal container so its click event never bubbles to backdrop */}
        <input
          id="profile-photo-upload-input"
          type="file"
          onChange={handleFileChange}
          onClick={(e) => e.stopPropagation()}
          accept="image/*"
          className="sr-only"
        />

        {/* Modal Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Change Profile Photo
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload, drag &amp; drop, or choose an avatar
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Circular Preview Section (Native label for 100% reliable file picker trigger) */}
        <div className="flex flex-col items-center justify-center py-1.5 space-y-2">
          <label
            htmlFor="profile-photo-upload-input"
            title="Click to upload a photo from your device"
            className="relative group cursor-pointer rounded-full focus-within:ring-2 focus-within:ring-indigo-500"
          >
            {selectedPhoto ? (
              <img
                src={selectedPhoto}
                alt={displayName}
                className="w-24 h-24 rounded-full object-cover border-2 border-indigo-500/30 dark:border-indigo-400/30 shadow-md transition-transform group-hover:scale-105"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-slate-900 dark:bg-zinc-800 text-white flex items-center justify-center text-3xl font-black border-2 border-slate-200 dark:border-zinc-700 shadow-md transition-transform group-hover:scale-105">
                {displayName ? displayName.charAt(0).toUpperCase() : <User className="w-10 h-10" />}
              </div>
            )}
            <div className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
              <Upload className="w-6 h-6" />
            </div>
          </label>

          <div className="text-center">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {isProcessingImage
                ? 'Processing image...'
                : isCustomUploaded
                ? 'Custom Profile Photo Selected'
                : isGoogleSelected
                ? 'Google Account Picture'
                : 'Default Initial Avatar'}
            </span>
          </div>
        </div>

        {/* Quick Color Avatar Presets */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 text-center">
            Quick Avatar Styles
          </div>
          <div className="flex items-center justify-center gap-2">
            {AVATAR_PRESET_PALETTES.map((preset) => {
              const presetUrl = buildInitialsAvatarDataUrl(displayName, preset.bg1, preset.bg2);
              const isSelectedPreset = selectedPhoto === presetUrl;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setUploadError(null);
                    setSelectedPhoto(presetUrl);
                  }}
                  title={preset.label}
                  style={{
                    background: `linear-gradient(135deg, ${preset.bg1}, ${preset.bg2})`,
                  }}
                  className={`w-8 h-8 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center transition transform cursor-pointer shadow-xs ${
                    isSelectedPreset
                      ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-zinc-900 scale-110'
                      : 'hover:scale-105 opacity-90 hover:opacity-100'
                  }`}
                >
                  {isSelectedPreset ? (
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  ) : (
                    (displayName || 'U').trim().charAt(0).toUpperCase()
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {uploadError && (
          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Action Options List */}
        <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-zinc-800/80">
          {/* Upload Photo Button (Native <label> so file dialog opens without bubbling or popup blocks) */}
          <label
            htmlFor="profile-photo-upload-input"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700/80 bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center justify-between transition cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
              <span>Upload Photo from Device</span>
            </div>
            <span className="text-[10px] text-slate-400">JPG, PNG, WebP</span>
          </label>

          {/* Use Google Photo Button (if googlePhoto exists) */}
          {googlePhoto && (
            <button
              type="button"
              onClick={handleUseGooglePhoto}
              className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
                isGoogleSelected
                  ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 font-bold'
                  : 'border-slate-200 dark:border-zinc-700/80 bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-800 dark:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Use Google Photo</span>
              </div>
              {isGoogleSelected && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
            </button>
          )}

          {/* Remove Photo Button */}
          <button
            type="button"
            onClick={handleRemovePhoto}
            className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
              isDefaultSelected
                ? 'border-slate-400 dark:border-zinc-600 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-white font-bold'
                : 'border-slate-200 dark:border-zinc-700/80 bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Trash2 className="w-4 h-4 text-rose-500" />
              <span>Remove Photo</span>
            </div>
            {isDefaultSelected && <Check className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />}
          </button>
        </div>

        {/* Modal Action Buttons: Cancel & Save Changes */}
        <div className="flex items-center gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition cursor-pointer active:scale-98"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isProcessingImage}
            className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs shadow-sm transition cursor-pointer active:scale-98"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
