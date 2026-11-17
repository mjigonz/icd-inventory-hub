import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, X } from 'lucide-react';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

export interface SelectOption {
  value: string;
  label: string;
  badge?: string | number;
  sublabel?: string;
  dotColor?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'accent' | 'pill' | 'compact';
  pillClassName?: string;
  className?: string;
  triggerClassName?: string;
  menuMinWidth?: number;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  ariaLabel,
  disabled = false,
  searchable,
  searchPlaceholder = 'Search options...',
  icon,
  variant = 'default',
  pillClassName = '',
  className = '',
  triggerClassName = '',
  menuMinWidth = 190,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { shouldRender, isVisible } = useAnimatedPresence(isOpen, 150);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    openUpward: boolean;
  }>({
    top: 0,
    left: 0,
    width: 0,
    openUpward: false,
  });

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const showSearch = searchable ?? options.length > 8;

  const filteredOptions = useMemo(() => {
    if (!showSearch || !searchQuery.trim()) return options;
    const q = searchQuery.trim().toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(q)) ||
        String(opt.badge ?? '').toLowerCase().includes(q)
    );
  }, [options, showSearch, searchQuery]);

  const updateMenuPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const estimatedMenuHeight = Math.min(300, filteredOptions.length * 36 + (showSearch ? 52 : 16));

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;

    const maxAllowedWidth = Math.min(340, viewportWidth - 16);
    const menuWidth = Math.min(Math.max(rect.width, menuMinWidth), maxAllowedWidth);
    const clampedLeft = Math.max(8, Math.min(rect.left, viewportWidth - menuWidth - 8));

    setCoords({
      top: openUpward ? rect.top - 6 : rect.bottom + 6,
      left: clampedLeft,
      width: menuWidth,
      openUpward,
    });
  };

  const handleOpenToggle = () => {
    if (disabled) return;
    if (!isOpen) {
      setSearchQuery('');
      updateMenuPosition();
      const idx = options.findIndex((o) => o.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();
    if (showSearch) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen, showSearch]);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      updateMenuPosition();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          filteredOptions.length > 0 ? (prev + 1) % filteredOptions.length : -1
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          filteredOptions.length > 0
            ? (prev - 1 + filteredOptions.length) % filteredOptions.length
            : -1
        );
      } else if (e.key === 'Enter' && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
        e.preventDefault();
        onChange(filteredOptions[highlightedIndex].value);
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, filteredOptions, highlightedIndex, onChange]);

  const getTriggerVariantClasses = () => {
    if (variant === 'pill') {
      return `rounded-full pl-2.5 pr-2 py-1 text-[11px] font-semibold border shadow-2xs transition-all duration-150 ${pillClassName}`;
    }
    if (variant === 'accent') {
      return 'rounded-xl px-3 py-2 text-xs font-bold bg-gradient-to-b from-blue-50/90 to-blue-100/50 dark:from-blue-950/60 dark:to-blue-900/30 border border-blue-200/90 dark:border-blue-800/80 text-blue-900 dark:text-blue-200 hover:border-blue-300 dark:hover:border-blue-700 shadow-2xs transition-all duration-150';
    }
    if (variant === 'compact') {
      return 'rounded-lg px-2.5 py-1.5 text-[11px] font-bold bg-white dark:bg-zinc-800/90 hover:bg-slate-50 dark:hover:bg-zinc-700/90 border border-slate-200/90 dark:border-zinc-700 text-slate-800 dark:text-zinc-100 shadow-2xs transition-all duration-150';
    }
    return 'rounded-xl px-3 py-2 text-xs font-bold bg-gradient-to-b from-white to-slate-50/90 dark:from-slate-800/90 dark:to-slate-800 border border-slate-200/90 dark:border-slate-700/90 text-slate-800 dark:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-2xs transition-all duration-150';
  };

  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={handleOpenToggle}
        className={`w-full flex items-center justify-between gap-2 text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 disabled:pointer-events-none select-none ${getTriggerVariantClasses()} ${
          isOpen ? 'ring-2 ring-blue-500/35 border-blue-400 dark:border-blue-500' : ''
        } ${triggerClassName}`}
      >
        <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
          {(selectedOption?.icon || icon) && (
            <span className="shrink-0 text-slate-500 dark:text-slate-400 flex items-center">
              {selectedOption?.icon || icon}
            </span>
          )}
          {selectedOption?.dotColor && (
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${selectedOption.dotColor}`}
            />
          )}
          <span className="truncate">
            {selectedOption ? (
              selectedOption.label
            ) : (
              <span className="text-slate-400 dark:text-zinc-500 font-medium">{placeholder}</span>
            )}
          </span>
          {selectedOption?.badge !== undefined && (
            <span className="ml-0.5 px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold bg-slate-200/70 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 shrink-0">
              {selectedOption.badge}
            </span>
          )}
        </span>

        <span
          className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-zinc-400'
          }`}
        >
          <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
        </span>
      </button>

      {shouldRender &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: coords.openUpward ? undefined : coords.top,
              bottom: coords.openUpward ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              minWidth: coords.width,
              maxWidth: Math.min(340, window.innerWidth - 16),
            }}
            className={`z-[9999] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl border border-slate-200/90 dark:border-zinc-700/90 shadow-xl ring-1 ring-black/5 dark:ring-white/5 overflow-hidden ui-dropdown-panel ${
              isVisible ? 'ui-dropdown-open pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            {showSearch && (
              <div className="p-2 border-b border-slate-100 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/80">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setHighlightedIndex(0);
                    }}
                    placeholder={searchPlaceholder}
                    className="w-full pl-8 pr-7 py-1.5 text-xs rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 rounded-full cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value;
                  const isHighlighted = idx === highlightedIndex;
                  return (
                    <button
                      key={`${opt.value}_${idx}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => {
                        onChange(opt.value);
                        setIsOpen(false);
                      }}
                      className={`w-full px-2.5 py-2 rounded-xl text-xs flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/90 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold'
                          : isHighlighted
                          ? 'bg-slate-100/90 dark:bg-zinc-800/90 text-slate-900 dark:text-white font-medium'
                          : 'text-slate-700 dark:text-zinc-200 font-medium hover:bg-slate-100/80 dark:hover:bg-zinc-800/70'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {opt.icon && (
                          <span className="shrink-0 text-slate-500 dark:text-slate-400">
                            {opt.icon}
                          </span>
                        )}
                        {opt.dotColor && (
                          <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dotColor}`} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{opt.label}</div>
                          {opt.sublabel && (
                            <div className="text-[10px] text-slate-400 dark:text-zinc-400 font-normal truncate">
                              {opt.sublabel}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {opt.badge !== undefined && (
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                              isSelected
                                ? 'bg-blue-100 dark:bg-blue-900/70 text-blue-700 dark:text-blue-200'
                                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400'
                            }`}
                          >
                            {opt.badge}
                          </span>
                        )}
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 stroke-[2.5]" />
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="py-5 px-3 text-center text-xs text-slate-400 dark:text-zinc-500">
                  No matching options found
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
