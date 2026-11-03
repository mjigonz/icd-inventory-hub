import { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';

export type ThemeMode = 'light' | 'dark';
export type AppearanceMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'countsheet_theme';
const APPEARANCE_MODE_STORAGE_KEY = 'countsheet_appearance_mode';

function resolveSystemTheme(): ThemeMode {
  try {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
  } catch {}
  return 'light';
}

function applyThemeToDOM(resolvedTheme: ThemeMode) {
  try {
    const root = document.documentElement;
    const isDark = resolvedTheme === 'dark';
    root.classList.toggle('dark', isDark);
    document.body.classList.toggle('dark', isDark);
    const appContainer = document.getElementById('app-root-container');
    if (appContainer) {
      appContainer.classList.toggle('dark', isDark);
    }
    root.style.colorScheme = isDark ? 'dark' : 'light';
    root.style.backgroundColor = 'var(--theme-bg)';
    document.body.style.backgroundColor = 'var(--theme-bg)';
    document.body.style.color = 'var(--theme-text)';

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isDark ? '#0B1220' : '#F8FAFC');
    }
  } catch {}
}

export const useTheme = () => {
  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>(() => {
    try {
      const savedMode = localStorage.getItem(APPEARANCE_MODE_STORAGE_KEY);
      if (savedMode === 'light' || savedMode === 'dark' || savedMode === 'system') {
        return savedMode;
      }
      const savedLegacy = localStorage.getItem(THEME_STORAGE_KEY);
      if (savedLegacy === 'dark' || savedLegacy === 'light') {
        return savedLegacy;
      }
    } catch {}
    return 'system';
  });

  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const savedMode = localStorage.getItem(APPEARANCE_MODE_STORAGE_KEY);
      if (savedMode === 'dark' || savedMode === 'light') {
        return savedMode;
      }
      if (savedMode === 'system') {
        return resolveSystemTheme();
      }
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
      return resolveSystemTheme();
    } catch {}
    return 'light';
  });

  const fallbackTimerRef = useRef<number | null>(null);

  // Apply theme classes and colors to documentElement & body on mount/updates
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  // Listen for OS/system theme changes when appearanceMode === 'system'
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      try {
        const currentMode = localStorage.getItem(APPEARANCE_MODE_STORAGE_KEY) || 'system';
        if (currentMode === 'system') {
          const nextResolved: ThemeMode = e.matches ? 'dark' : 'light';
          setThemeState(nextResolved);
          applyThemeToDOM(nextResolved);
        }
      } catch {}
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const commitThemeChange = useCallback((nextMode: AppearanceMode, resolved: ThemeMode) => {
    try {
      localStorage.setItem(APPEARANCE_MODE_STORAGE_KEY, nextMode);
      if (nextMode === 'light' || nextMode === 'dark') {
        localStorage.setItem(THEME_STORAGE_KEY, nextMode);
      } else {
        localStorage.removeItem(THEME_STORAGE_KEY);
      }
    } catch {}
    setAppearanceModeState(nextMode);
    setThemeState(resolved);
    applyThemeToDOM(resolved);
  }, []);

  const setAppearanceMode = useCallback(
    (nextMode: AppearanceMode) => {
      const resolved: ThemeMode = nextMode === 'system' ? resolveSystemTheme() : nextMode;

      // If the effective visual theme isn't changing (e.g. Light -> System when OS is Light), update immediately
      if (resolved === theme || typeof document === 'undefined') {
        commitThemeChange(nextMode, resolved);
        return;
      }

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const motionOff = document.documentElement.getAttribute('data-motion') === 'off';

      if (prefersReducedMotion || motionOff) {
        commitThemeChange(nextMode, resolved);
        return;
      }

      const root = document.documentElement;
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      // GPU-accelerated View Transitions API path (zero per-element layout/paint lag)
      if ('startViewTransition' in document && typeof (document as any).startViewTransition === 'function') {
        try {
          root.classList.add('theme-switching');
          const transition = (document as any).startViewTransition(() => {
            flushSync(() => {
              commitThemeChange(nextMode, resolved);
            });
          });
          if (transition && transition.finished && typeof transition.finished.finally === 'function') {
            transition.finished.finally(() => {
              root.classList.remove('theme-switching');
            });
          } else {
            fallbackTimerRef.current = window.setTimeout(() => {
              root.classList.remove('theme-switching');
            }, 260);
          }
          return;
        } catch {
          root.classList.remove('theme-switching');
        }
      }

      // Lightweight fallback for browsers without View Transitions API
      root.classList.add('theme-fallback-switching');
      commitThemeChange(nextMode, resolved);
      fallbackTimerRef.current = window.setTimeout(() => {
        root.classList.remove('theme-fallback-switching');
        fallbackTimerRef.current = null;
      }, 240);
    },
    [theme, commitThemeChange]
  );

  const setTheme = useCallback(
    (nextTheme: ThemeMode) => {
      setAppearanceMode(nextTheme);
    },
    [setAppearanceMode]
  );

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemeMode = theme === 'light' ? 'dark' : 'light';
    setAppearanceMode(nextTheme);
  }, [theme, setAppearanceMode]);

  return { theme, appearanceMode, setTheme, setAppearanceMode, toggleTheme };
};
