import { useEffect } from 'react';

let activeLockCount = 0;
let savedHtmlOverflow = '';
let savedBodyOverflow = '';
let savedHtmlOverscroll = '';
let savedBodyOverscroll = '';

const PANEL_ROOT_SELECTOR = [
  '.ui-modal-panel',
  '.ui-modal-slide-bottom',
  '.drawer-panel-right',
  '.ui-dropdown-panel',
  '[data-scroll-lock-panel]',
  '[role="dialog"]',
  '[role="listbox"]',
].join(', ');

function isScrollableOverflow(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'overlay';
}

function canElementScroll(el: HTMLElement, deltaX: number, deltaY: number): boolean {
  const style = window.getComputedStyle(el);
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absY >= absX && absY > 0) {
    if (isScrollableOverflow(style.overflowY) && el.scrollHeight > el.clientHeight) {
      if (deltaY < 0 && el.scrollTop > 0) return true;
      if (deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight) return true;
    }
  }

  if (absX > absY && absX > 0) {
    if (isScrollableOverflow(style.overflowX) && el.scrollWidth > el.clientWidth) {
      if (deltaX < 0 && el.scrollLeft > 0) return true;
      if (deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth) return true;
    }
  }

  return false;
}

function hasScrollableContainer(target: EventTarget | null, panelRoot: Element): boolean {
  let curr = target instanceof HTMLElement ? target : null;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    const style = window.getComputedStyle(curr);
    if (
      (isScrollableOverflow(style.overflowY) && curr.scrollHeight > curr.clientHeight) ||
      (isScrollableOverflow(style.overflowX) && curr.scrollWidth > curr.clientWidth)
    ) {
      return true;
    }
    if (curr === panelRoot) break;
    curr = curr.parentElement;
  }
  return false;
}

function handleGlobalWheel(e: WheelEvent) {
  if (activeLockCount <= 0) return;

  const target = e.target instanceof HTMLElement ? e.target : null;
  if (!target) {
    e.preventDefault();
    return;
  }

  const panelRoot = target.closest(PANEL_ROOT_SELECTOR);
  if (!panelRoot) {
    // Wheel occurred on the backdrop or outside any open panel
    e.preventDefault();
    return;
  }

  let curr: HTMLElement | null = target;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    if (canElementScroll(curr, e.deltaX, e.deltaY)) {
      return; // Allow native scroll inside the panel's scrollable container
    }
    if (curr === panelRoot) break;
    curr = curr.parentElement;
  }

  // No scrollable container inside the panel can scroll further in this direction
  e.preventDefault();
}

function handleGlobalTouchMove(e: TouchEvent) {
  if (activeLockCount <= 0) return;

  const target = e.target instanceof HTMLElement ? e.target : null;
  if (!target) {
    e.preventDefault();
    return;
  }

  if (target instanceof HTMLInputElement && target.type === 'range') {
    return;
  }

  const panelRoot = target.closest(PANEL_ROOT_SELECTOR);
  if (!panelRoot) {
    // Touch drag on backdrop or outside the open panel
    e.preventDefault();
    return;
  }

  if (!hasScrollableContainer(target, panelRoot)) {
    // Touch drag on a non-scrollable section of the panel
    e.preventDefault();
  }
}

function lockBackgroundScroll() {
  if (typeof document === 'undefined') return;
  if (activeLockCount === 0) {
    const html = document.documentElement;
    const body = document.body;
    savedHtmlOverflow = html.style.overflow;
    savedBodyOverflow = body.style.overflow;
    savedHtmlOverscroll = html.style.overscrollBehavior;
    savedBodyOverscroll = body.style.overscrollBehavior;

    html.classList.add('panel-scroll-locked');
    body.classList.add('panel-scroll-locked');
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';

    window.addEventListener('wheel', handleGlobalWheel, { passive: false });
    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
  }
  activeLockCount++;
}

function unlockBackgroundScroll() {
  if (typeof document === 'undefined') return;
  if (activeLockCount <= 0) return;
  activeLockCount--;
  if (activeLockCount === 0) {
    const html = document.documentElement;
    const body = document.body;
    html.classList.remove('panel-scroll-locked');
    body.classList.remove('panel-scroll-locked');
    html.style.overflow = savedHtmlOverflow;
    body.style.overflow = savedBodyOverflow;
    html.style.overscrollBehavior = savedHtmlOverscroll;
    body.style.overscrollBehavior = savedBodyOverscroll;

    window.removeEventListener('wheel', handleGlobalWheel);
    window.removeEventListener('touchmove', handleGlobalTouchMove);
  }
}

/**
 * Locks background page scrolling while a modal, drawer, or dropdown panel is open.
 * Uses reference counting so nested modals never prematurely unlock background scroll.
 */
export function useScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked) return;
    lockBackgroundScroll();
    return () => {
      unlockBackgroundScroll();
    };
  }, [isLocked]);
}
