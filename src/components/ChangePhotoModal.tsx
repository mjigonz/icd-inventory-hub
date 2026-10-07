import React, { useState, useRef } from 'react';
import { Check, X, User, Upload } from 'lucide-react';

interface ChangePhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhoto: string | null;
  googlePhoto: string | null;
  displayName: string;
  onSave: (photoURL: string | null) => void;
}

export interface AnimalAvatar {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
}

export const ANIMAL_AVATARS: AnimalAvatar[] = [
  { id: 'lion', name: 'Lion', emoji: '🦁', bgColor: '#D97706' },
  { id: 'tiger', name: 'Tiger', emoji: '🐯', bgColor: '#EA580C' },
  { id: 'bear', name: 'Bear', emoji: '🐻', bgColor: '#78350F' },
  { id: 'panda', name: 'Panda', emoji: '🐼', bgColor: '#18181B' },
  { id: 'fox', name: 'Fox', emoji: '🦊', bgColor: '#C2410C' },
  { id: 'wolf', name: 'Wolf', emoji: '🐺', bgColor: '#475569' },
  { id: 'eagle', name: 'Eagle', emoji: '🦅', bgColor: '#B45309' },
  { id: 'owl', name: 'Owl', emoji: '🦉', bgColor: '#4338CA' },
  { id: 'leopard', name: 'Leopard', emoji: '🐆', bgColor: '#CA8A04' },
  { id: 'elephant', name: 'Elephant', emoji: '🐘', bgColor: '#64748B' },
  { id: 'rhino', name: 'Rhino', emoji: '🦏', bgColor: '#52525B' },
  { id: 'hippo', name: 'Hippo', emoji: '🦛', bgColor: '#475569' },
  { id: 'giraffe', name: 'Giraffe', emoji: '🦒', bgColor: '#D97706' },
  { id: 'zebra', name: 'Zebra', emoji: '🦓', bgColor: '#27272A' },
  { id: 'deer', name: 'Deer', emoji: '🦌', bgColor: '#854D0E' },
  { id: 'gorilla', name: 'Gorilla', emoji: '🦍', bgColor: '#1E293B' },
  { id: 'monkey', name: 'Monkey', emoji: '🐒', bgColor: '#92400E' },
  { id: 'koala', name: 'Koala', emoji: '🐨', bgColor: '#64748B' },
  { id: 'kangaroo', name: 'Kangaroo', emoji: '🦘', bgColor: '#B45309' },
  { id: 'sloth', name: 'Sloth', emoji: '🦥', bgColor: '#713F12' },
  { id: 'otter', name: 'Otter', emoji: '🦦', bgColor: '#A16207' },
  { id: 'hedgehog', name: 'Hedgehog', emoji: '🦔', bgColor: '#78350F' },
  { id: 'raccoon', name: 'Raccoon', emoji: '🦝', bgColor: '#3F3F46' },
  { id: 'badger', name: 'Badger', emoji: '🦡', bgColor: '#18181B' },
  { id: 'penguin', name: 'Penguin', emoji: '🐧', bgColor: '#0F172A' },
  { id: 'flamingo', name: 'Flamingo', emoji: '🦩', bgColor: '#DB2777' },
  { id: 'dolphin', name: 'Dolphin', emoji: '🐬', bgColor: '#0284C7' },
  { id: 'shark', name: 'Shark', emoji: '🦈', bgColor: '#0369A1' },
  { id: 'turtle', name: 'Turtle', emoji: '🐢', bgColor: '#059669' },
  { id: 'bee', name: 'Bee', emoji: '🐝', bgColor: '#EAB308' },
];

export const createAnimalSvgDataUri = (emoji: string, bg: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${bg}"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="central" font-size="52" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">${emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSelectAnimal = (animal: AnimalAvatar) => {
    setUploadError(null);
    const dataUri = createAnimalSvgDataUri(animal.emoji, animal.bgColor);
    setSelectedPhoto(dataUri);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file (PNG, JPG, WEBP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image file is too large (max 5MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setSelectedPhoto(result);
    };
    reader.onerror = () => {
      setUploadError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
    // Reset file input so selecting the same file again triggers change
    e.target.value = '';
  };

  const handleResetToGoogle = () => {
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

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/20 dark:bg-black/40 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      {/* Hidden file input triggered by the corner upload icon */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      <div className="bg-white dark:bg-[#161618] rounded-3xl max-w-sm sm:max-w-md w-full p-4 sm:p-5 shadow-2xl border border-slate-200 dark:border-zinc-800 animate-in fade-in zoom-in-95 space-y-3.5 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">Change Profile Photo</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Choose an animal avatar or upload your photo</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Avatar Preview with Corner Upload Arrow */}
        <div className="flex items-center gap-3.5 bg-slate-50 dark:bg-zinc-800/60 p-3 rounded-2xl border border-slate-200/80 dark:border-zinc-700/60 shrink-0">
          <div className="relative shrink-0">
            {selectedPhoto ? (
              <img
                src={selectedPhoto}
                alt={displayName}
                className="w-16 h-16 rounded-full object-cover border-2 border-zinc-400 dark:border-zinc-600 shadow-sm"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-zinc-800 dark:bg-zinc-700 text-white flex items-center justify-center text-2xl font-black border-2 border-zinc-400 dark:border-zinc-600 shadow-sm">
                {displayName ? displayName.charAt(0).toUpperCase() : <User className="w-7 h-7" />}
              </div>
            )}

            {/* Up arrow upload symbol on the corner of the circle */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 flex items-center justify-center shadow-md cursor-pointer active:scale-95 transition border border-white dark:border-zinc-900"
              title="Upload photo from device"
            >
              <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
              {displayName}
            </div>
            <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>
                {selectedPhoto?.startsWith('data:image/svg+xml')
                  ? 'Animal Avatar'
                  : selectedPhoto === googlePhoto
                  ? 'Google Account Photo'
                  : selectedPhoto
                  ? 'Custom Uploaded Photo'
                  : 'Default Initials'}
              </span>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">• Click ⇡ to upload</span>
            </div>
          </div>
        </div>

        {uploadError && (
          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs shrink-0">
            {uploadError}
          </div>
        )}

        {/* 30 Animal Avatars Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-0.5">
            30 Animal Avatars
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
            {ANIMAL_AVATARS.map((animal) => {
              const svgUri = createAnimalSvgDataUri(animal.emoji, animal.bgColor);
              const isSelected = selectedPhoto === svgUri;

              return (
                <button
                  key={animal.id}
                  type="button"
                  onClick={() => handleSelectAnimal(animal)}
                  className={`group relative flex flex-col items-center justify-center p-2 rounded-2xl transition cursor-pointer active:scale-95 ${
                    isSelected
                      ? 'bg-zinc-900 dark:bg-zinc-700 text-white ring-2 ring-zinc-500 shadow-md scale-105'
                      : 'bg-slate-100/90 dark:bg-zinc-800/80 hover:bg-slate-200 dark:hover:bg-zinc-700/80 border border-slate-200/80 dark:border-zinc-700/60'
                  }`}
                  title={animal.name}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-xl shadow-xs transition-transform group-hover:scale-110"
                    style={{ backgroundColor: animal.bgColor }}
                  >
                    <span>{animal.emoji}</span>
                  </div>
                  <span
                    className={`text-[9.5px] font-semibold mt-1 truncate max-w-full leading-none ${
                      isSelected ? 'text-white' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {animal.name}
                  </span>
                  {isSelected && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Reset Options */}
        <div className="flex gap-2 pt-1 shrink-0 border-t border-slate-100 dark:border-zinc-800">
          {googlePhoto && (
            <button
              type="button"
              onClick={handleResetToGoogle}
              className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-semibold transition cursor-pointer border ${
                selectedPhoto === googlePhoto
                  ? 'bg-zinc-900 text-white dark:bg-zinc-700 border-zinc-700'
                  : 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 hover:bg-slate-200 dark:hover:bg-zinc-700'
              }`}
            >
              Reset to Google Photo
            </button>
          )}
          <button
            type="button"
            onClick={handleRemovePhoto}
            className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-semibold transition cursor-pointer border ${
              selectedPhoto === null
                ? 'bg-zinc-900 text-white dark:bg-zinc-700 border-zinc-700'
                : 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 hover:bg-slate-200 dark:hover:bg-zinc-700'
            }`}
          >
            Default Initials
          </button>
        </div>

        {/* Modal Action Buttons */}
        <div className="flex gap-2 pt-1 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer border border-transparent dark:border-zinc-700"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save Avatar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
