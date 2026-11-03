import { useState, useEffect, useCallback, useRef } from 'react';

export interface AppUpdateNotification {
  id: string;
  title: string;
  message: string;
  senderName: string;
  senderEmail: string;
  createdAt: string;
  timestamp: number;
}

interface AppVersionResponse {
  version: string;
  codeModifiedAt?: number;
  dataUpdatedAt?: string;
  notifications?: AppUpdateNotification[];
  latestNotification?: AppUpdateNotification | null;
  serverTime?: number;
}

const STORAGE_VERSION_KEY = 'countsheet_applied_app_version';
const STORAGE_CODE_MTIME_KEY = 'countsheet_applied_code_mtime';
const SESSION_RELOADED_MTIME_KEY = 'countsheet_reloaded_code_mtime';
const STORAGE_APPLIED_NOTIF_TS_KEY = 'countsheet_last_applied_notif_ts';

export const REALTIME_DATA_SYNC_EVENT = 'countsheet-realtime-data-sync';

function isUserActivelyTyping(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    Boolean(active.isContentEditable)
  );
}

async function purgeCachesAndReload(newCodeMtime?: number, newVersion?: string) {
  try {
    if (newCodeMtime) {
      localStorage.setItem(STORAGE_CODE_MTIME_KEY, String(newCodeMtime));
      sessionStorage.setItem(SESSION_RELOADED_MTIME_KEY, String(newCodeMtime));
    }
    if (newVersion) {
      localStorage.setItem(STORAGE_VERSION_KEY, newVersion);
    }
  } catch {}

  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
  }

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map(async (reg) => {
          try {
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            await reg.update();
          } catch {}
        })
      );
    } catch {}
  }

  window.location.reload();
}

export function NotifyWebsiteUpdateAvailable() {
  try {
    window.dispatchEvent(new CustomEvent('countsheet-update-available'));
  } catch {}
}

export function useAppUpdate() {
  const [adminHasCodeUpdate, setAdminHasCodeUpdate] = useState(false);
  const [notifications, setNotifications] = useState<AppUpdateNotification[]>([]);
  const [lastAppliedNotifTs, setLastAppliedNotifTs] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_APPLIED_NOTIF_TS_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) return parsed;
      }
    } catch {}
    return 0;
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState(false);

  const initialVersionRef = useRef<string | null>(null);
  const latestVersionRef = useRef<string | null>(null);
  const initialCodeMtimeRef = useRef<number | null>(null);
  const initialDataUpdatedAtRef = useRef<string | null>(null);
  const isAutoReloadingRef = useRef<boolean>(false);

  const checkServerVersion = useCallback(async () => {
    try {
      const res = await fetch(`/api/app-version?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });
      if (!res.ok) return;
      const data = (await res.json()) as AppVersionResponse;

      if (Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
      }

      const serverCodeMtime = data?.codeModifiedAt || 0;
      const serverDataUpdatedAt = data?.dataUpdatedAt || '';

      // 1. Real-time Code Update detection (auto-clears SW cache & reloads ais-pre / ais-dev in real time)
      if (serverCodeMtime > 0) {
        if (initialCodeMtimeRef.current === null) {
          let savedCodeMtime = '';
          let sessionReloadedMtime = '';
          try {
            savedCodeMtime = localStorage.getItem(STORAGE_CODE_MTIME_KEY) || '';
            sessionReloadedMtime = sessionStorage.getItem(SESSION_RELOADED_MTIME_KEY) || '';
          } catch {}

          initialCodeMtimeRef.current = serverCodeMtime;
          try {
            localStorage.setItem(STORAGE_CODE_MTIME_KEY, String(serverCodeMtime));
          } catch {}

          // If the browser had an older code timestamp cached from a previous session, reload once with fresh cache
          if (
            savedCodeMtime &&
            savedCodeMtime !== String(serverCodeMtime) &&
            sessionReloadedMtime !== String(serverCodeMtime) &&
            !isAutoReloadingRef.current
          ) {
            isAutoReloadingRef.current = true;
            void purgeCachesAndReload(serverCodeMtime, data.version);
            return;
          }
        } else if (serverCodeMtime !== initialCodeMtimeRef.current) {
          setAdminHasCodeUpdate(true);
          if (!isUserActivelyTyping() && !isAutoReloadingRef.current) {
            isAutoReloadingRef.current = true;
            void purgeCachesAndReload(serverCodeMtime, data.version);
            return;
          }
        }
      }

      // 2. Real-time Data / Admin Console / Masterdata / Drive Links sync without page reload
      if (serverDataUpdatedAt) {
        if (initialDataUpdatedAtRef.current === null) {
          initialDataUpdatedAtRef.current = serverDataUpdatedAt;
        } else if (serverDataUpdatedAt !== initialDataUpdatedAtRef.current) {
          initialDataUpdatedAtRef.current = serverDataUpdatedAt;
          window.dispatchEvent(new CustomEvent(REALTIME_DATA_SYNC_EVENT));
        }
      }

      if (data?.version) {
        latestVersionRef.current = data.version;

        if (!initialVersionRef.current) {
          initialVersionRef.current = data.version;
          try {
            localStorage.setItem(STORAGE_VERSION_KEY, data.version);
          } catch {}
        } else if (data.version !== initialVersionRef.current) {
          setAdminHasCodeUpdate(true);
        }
      }
    } catch {
      // ignore offline or transient errors
    }
  }, []);

  useEffect(() => {
    void checkServerVersion();

    const interval = window.setInterval(() => {
      void checkServerVersion();
    }, 3500);

    const handleFocus = () => {
      void checkServerVersion();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkServerVersion();
      }
    };

    const handleLocalMutation = () => {
      setAdminHasCodeUpdate(true);
      void checkServerVersion();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('countsheet-update-available', handleLocalMutation);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('countsheet-update-available', handleLocalMutation);
    };
  }, [checkServerVersion]);

  const unreadNotifications = notifications.filter(
    (n) => (n.timestamp || 0) > lastAppliedNotifTs
  );
  const hasUnreadNotification = unreadNotifications.length > 0;

  const markNotificationsRead = useCallback(() => {
    const newestTs = notifications[0]?.timestamp || Date.now();
    setLastAppliedNotifTs(newestTs);
    try {
      localStorage.setItem(STORAGE_APPLIED_NOTIF_TS_KEY, String(newestTs));
    } catch {}
  }, [notifications]);

  const sendUpdateNotification = useCallback(
    async (payload?: {
      title?: string;
      message?: string;
      senderName?: string;
      senderEmail?: string;
    }): Promise<boolean> => {
      setIsSendingNotification(true);
      try {
        const res = await fetch('/api/app-update-notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: payload?.title || 'App & Website Update Available',
            message:
              payload?.message ||
              'New features or updates have been added by the Admin. Click Update & Refresh to load the latest version.',
            senderName: payload?.senderName || 'Admin',
            senderEmail: payload?.senderEmail || '',
          }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (Array.isArray(data?.notifications)) {
          setNotifications(data.notifications);
        }
        setAdminHasCodeUpdate(false);
        if (latestVersionRef.current) {
          initialVersionRef.current = latestVersionRef.current;
        }
        return true;
      } catch {
        return false;
      } finally {
        setIsSendingNotification(false);
      }
    },
    []
  );

  const clearAllUpdateNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/app-update-notifications', {
        method: 'DELETE',
      });
      if (res.ok) {
        setNotifications([]);
      }
    } catch {}
  }, []);

  const applyUpdate = useCallback(async () => {
    if (isUpdating) return;
    setIsUpdating(true);

    try {
      const newestTs = notifications[0]?.timestamp || Date.now();
      try {
        localStorage.setItem(STORAGE_APPLIED_NOTIF_TS_KEY, String(newestTs));
        if (latestVersionRef.current) {
          localStorage.setItem(STORAGE_VERSION_KEY, latestVersionRef.current);
        }
      } catch {}

      // Clear all Cache Storage entries so fresh JS/CSS/HTML bundles are fetched
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch {}
      }

      // Update / unregister stale service workers before reload
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(
            registrations.map(async (reg) => {
              try {
                if (reg.waiting) {
                  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                await reg.update();
              } catch {}
            })
          );
        } catch {}
      }
    } finally {
      window.location.reload();
    }
  }, [isUpdating, notifications]);

  return {
    hasUpdate: hasUnreadNotification,
    adminHasCodeUpdate,
    notifications,
    unreadNotifications,
    hasUnreadNotification,
    isUpdating,
    isSendingNotification,
    applyUpdate,
    sendUpdateNotification,
    clearAllUpdateNotifications,
    markNotificationsRead,
    checkServerVersion,
  };
}
