import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Prevent Firebase Auth popup reset assertion errors from producing unhandled browser errors
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const message = String(reason?.message || reason || '');
  if (message.includes('INTERNAL ASSERTION FAILED') || message.includes('Pending promise')) {
    event.preventDefault();
  }
});

window.addEventListener('error', (event) => {
  const message = String(event?.message || event?.error?.message || '');
  if (message.includes('INTERNAL ASSERTION FAILED') || message.includes('Pending promise')) {
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

// Resilient PWA service worker registration
if ('serviceWorker' in navigator) {
  const registerSW = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
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

createRoot(document.getElementById('root')!).render(<App />);
