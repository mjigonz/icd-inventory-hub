import React, { useState, useEffect, useRef } from 'react';
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
  const [mounted, setMounted] = useState(false);
  const { shouldRender, isVisible } = useAnimatedPresence(isOpen, 200);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPhoto(currentPhoto);
      setUploadError(null);
    }
  }, [isOpen, currentPhoto]);

  // Lock body scroll and listen for Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!shouldRender || !mounted) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type.toLowerCase()) && !file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file (JPG, PNG, WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image size must be less than 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setSelectedPhoto(result);
    };
    reader.onerror = () => {
      setUploadError('Failed to load selected image file.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
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

  const isGoogleSelected = selectedPhoto && googlePhoto && selectedPhoto === googlePhoto;
  const isDefaultSelected = selectedPhoto === null;
  const isCustomUploaded = selectedPhoto && (!googlePhoto || selectedPhoto !== googlePhoto);

  const modalContent = (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 dark:bg-black/60 backdrop-blur-xs ui-modal-backdrop ${
        isVisible ? 'ui-modal-open pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/jpeg,image/png,image/webp,image/jpg"
        className="hidden"
      />

      {/* Centered Minimalist Modal Container */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm bg-white dark:bg-[#161618] rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-2xl p-5 space-y-4 ui-modal-panel ${
          isVisible ? 'ui-modal-open' : ''
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Change Profile Photo"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Change Profile Photo
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload a photo or use your Google account picture
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

        {/* Circular Preview Section */}
        <div className="flex flex-col items-center justify-center py-2 space-y-2">
          <div className="relative">
            {selectedPhoto ? (
              <img
                src={selectedPhoto}
                alt={displayName}
                className="w-24 h-24 rounded-full object-cover border-2 border-indigo-500/30 dark:border-indigo-400/30 shadow-md"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-slate-900 dark:bg-zinc-800 text-white flex items-center justify-center text-3xl font-black border-2 border-slate-200 dark:border-zinc-700 shadow-md">
                {displayName ? displayName.charAt(0).toUpperCase() : <User className="w-10 h-10" />}
              </div>
            )}
          </div>

          <div className="text-center">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {isCustomUploaded
                ? 'Custom Uploaded Photo'
                : isGoogleSelected
                ? 'Google Account Picture'
                : 'Default Initial Avatar'}
            </span>
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
          {/* Upload Photo Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700/80 bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center justify-between transition cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
              <span>Upload Photo</span>
            </div>
            <span className="text-[10px] text-slate-400">JPG, PNG, WebP</span>
          </button>

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
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer shadow-xs active:scale-98 flex items-center justify-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save Changes</span>
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
