import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Prevent Firebase Auth popup reset assertion errors from producing unhandled browser errors
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const message = String(reason?.message || reason || '');
  if (
    message.includes('INTERNAL ASSERTION FAILED') ||
    message.includes('Pending promise') ||
    message.includes('Could not reach Cloud Firestore backend')
  ) {
    event.preventDefault();
  }
});

window.addEventListener('error', (event) => {
  const message = String(event?.message || event?.error?.message || '');
  if (
    message.includes('INTERNAL ASSERTION FAILED') ||
    message.includes('Pending promise') ||
    message.includes('Could not reach Cloud Firestore backend')
  ) {
    event.preventDefault();
  }
});

// Capture beforeinstallprompt without calling preventDefault(), allowing the native browser install prompt to display automatically
(window as any).__pwaInstallPrompt = (window as any).__pwaInstallPrompt || null;
window.addEventListener('beforeinstallprompt', (e) => {
  // Do NOT call e.preventDefault() - allowing the browser to show its native Install prompt
  (window as any).__pwaInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('pwa-prompt-available', { detail: e }));
});

// Clear any stale Service Worker caches that may have cached older JS modules
if ('caches' in window) {
  caches
    .keys()
    .then((keys) => {
      keys.forEach((key) => {
        if (key !== 'countsheet-v16') {
          caches.delete(key).catch(() => {});
        }
      });
    })
    .catch(() => {});
}

// Resilient PWA service worker registration with automatic reload when a new SW claims control
if ('serviceWorker' in navigator) {
  let isSwRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isSwRefreshing) return;
    isSwRefreshing = true;
    window.location.reload();
  });

  const registerSW = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      reg.update().catch(() => {});
      console.log('CountSheet ServiceWorker registered with scope:', reg.scope);
    } catch (err) {
      console.warn('CountSheet ServiceWorker registration error:', err);
    }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    registerSW();
  } else {
    window.addEventListener('load', registerSW);
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

