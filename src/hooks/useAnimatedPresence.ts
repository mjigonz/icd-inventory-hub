import { useState, useEffect } from 'react';

function getEffectiveDuration(durationMs: number): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0;
  try {
    const motionAttr = document.documentElement.getAttribute('data-motion');
    if (motionAttr === 'off') return 0;
    if (
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return 0;
    }
    if (motionAttr === 'subtle') {
      return Math.round(durationMs * 0.75);
    }
  } catch {}
  return durationMs;
}

/**
 * Manages mount and visibility states for enter/exit CSS transitions so elements
 * do not unmount abruptly before exit animations complete.
 */
export function useAnimatedPresence(isOpen: boolean, durationMs = 200) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(isOpen);

  useEffect(() => {
    const effectiveDuration = getEffectiveDuration(durationMs);

    if (isOpen) {
      setShouldRender(true);
      setIsVisible(false);
      if (effectiveDuration === 0) {
        setIsVisible(true);
        return;
      }
      let raf1 = 0;
      let raf2 = 0;
      raf1 = requestAnimationFrame(() => {
        // Force browser layout flush so initial offscreen transform is committed before transition starts
        if (typeof document !== 'undefined' && document.body) {
          void document.body.offsetHeight;
        }
        raf2 = requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    } else {
      setIsVisible(false);
      if (effectiveDuration === 0) {
        setShouldRender(false);
        return;
      }
      const timer = window.setTimeout(() => {
        setShouldRender(false);
      }, effectiveDuration);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, durationMs]);

  return {
    shouldRender: isOpen || shouldRender,
    isVisible: isOpen && isVisible,
  };
}
