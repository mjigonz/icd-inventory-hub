import { useState, useEffect, useCallback, useRef } from 'react';

export type ThemeMode = 'light' | 'dark';
export type AppearanceMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'countsheet_theme';
const APPEARANCE_MODE_STORAGE_KEY = 'countsheet_appearance_mode';
const THEME_TRANSITION_DURATION_MS = 300;

function getInitialAppearanceMode(): AppearanceMode {
  try {
    const savedMode = localStorage.getItem(APPEARANCE_MODE_STORAGE_KEY);
    if (savedMode === 'light' || savedMode === 'dark') {
      return savedMode;
    }
    const savedLegacy = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedLegacy === 'dark' || savedLegacy === 'light') {
      return savedLegacy;
    }
  } catch {}
  return 'light';
}

function getInitialResolvedTheme(mode: AppearanceMode): ThemeMode {
  return mode;
}

function applyThemeToDOM(resolvedTheme: ThemeMode) {
  try {
    const root = document.documentElement;
    const isDark = resolvedTheme === 'dark';

    if (root.classList.contains('dark') !== isDark) {
      root.classList.toggle('dark', isDark);
    }
    if (root.getAttribute('data-theme') !== resolvedTheme) {
      root.setAttribute('data-theme', resolvedTheme);
    }
    if (root.style.colorScheme !== resolvedTheme) {
      root.style.colorScheme = resolvedTheme;
    }

    if (document.body && document.body.classList.contains('dark') !== isDark) {
      document.body.classList.toggle('dark', isDark);
    }

    const appContainer = document.getElementById('app-root-container');
    if (appContainer && appContainer.classList.contains('dark') !== isDark) {
      appContainer.classList.toggle('dark', isDark);
    }

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      const targetColor = isDark ? '#0B1220' : '#F8FAFC';
      if (metaThemeColor.getAttribute('content') !== targetColor) {
        metaThemeColor.setAttribute('content', targetColor);
      }
    }
  } catch {}
}

const THEME_ANIMATION_STORAGE_KEY = 'countsheet_theme_animation';

function getInitialThemeAnimation(): boolean {
  try {
    const saved = localStorage.getItem(THEME_ANIMATION_STORAGE_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
  } catch {}
  return true;
}

export const useTheme = () => {
  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>(getInitialAppearanceMode);
  const [theme, setThemeState] = useState<ThemeMode>(() => getInitialResolvedTheme(appearanceMode));
  const [themeAnimationEnabled, setThemeAnimationEnabledState] = useState<boolean>(getInitialThemeAnimation);

  const transitionTimerRef = useRef<number | null>(null);
  const themeRef = useRef<ThemeMode>(theme);
  const modeRef = useRef<AppearanceMode>(appearanceMode);
  const animationEnabledRef = useRef<boolean>(themeAnimationEnabled);
  themeRef.current = theme;
  modeRef.current = appearanceMode;
  animationEnabledRef.current = themeAnimationEnabled;

  const setThemeAnimationEnabled = useCallback((enabled: boolean) => {
    setThemeAnimationEnabledState(enabled);
    try {
      localStorage.setItem(THEME_ANIMATION_STORAGE_KEY, String(enabled));
    } catch {}
  }, []);

  const triggerCssThemeTransition = useCallback((nextResolved: ThemeMode) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (animationEnabledRef.current) {
      root.classList.add('theme-fading');
      applyThemeToDOM(nextResolved);
      window.setTimeout(() => {
        root.classList.remove('theme-fading');
      }, 180);
    } else {
      applyThemeToDOM(nextResolved);
    }
  }, []);

  // Ensure DOM attributes stay synchronized on initial mount
  useEffect(() => {
    applyThemeToDOM(themeRef.current);
    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);



  const setAppearanceMode = useCallback(
    (nextMode: AppearanceMode) => {
      const resolved: ThemeMode = nextMode;
      const modeChanged = nextMode !== modeRef.current;
      const themeChanged = resolved !== themeRef.current;

      // Persist user preference across page refreshes and navigation
      try {
        localStorage.setItem(APPEARANCE_MODE_STORAGE_KEY, nextMode);
        localStorage.setItem(THEME_STORAGE_KEY, nextMode);
      } catch {}

      if (!modeChanged && !themeChanged) {
        return;
      }

      if (themeChanged) {
        themeRef.current = resolved;
        // Apply new theme to DOM immediately so CSS transitions start on the exact click frame
        triggerCssThemeTransition(resolved);
        setThemeState(resolved);
      }

      if (modeChanged) {
        modeRef.current = nextMode;
        setAppearanceModeState(nextMode);
      }
    },
    [triggerCssThemeTransition]
  );

  const setTheme = useCallback(
    (nextTheme: ThemeMode) => {
      setAppearanceMode(nextTheme);
    },
    [setAppearanceMode]
  );

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemeMode = themeRef.current === 'light' ? 'dark' : 'light';
    setAppearanceMode(nextTheme);
  }, [setAppearanceMode]);

  return {
    theme,
    appearanceMode,
    setTheme,
    setAppearanceMode,
    toggleTheme,
    themeAnimationEnabled,
    setThemeAnimationEnabled,
  };
};

