/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { SelectedBranch } from '../types';

export interface PresenceUser {
  sessionId: string;
  displayName: string;
  email: string;
  photoURL?: string | null;
  loginType: 'google' | 'guest';
  role: 'admin' | 'lead_auditor' | 'auditor' | 'guest';
  branchName?: string;
  currentTab?: string;
  joinedAt: string;
  lastSeenAt: string;
  lastSeenMs?: number;
  secondsAgo: number;
  isOnline: boolean;
}

export interface PresenceStats {
  totalOnline: number;
  totalGoogleUsers: number;
  totalGuests: number;
  users: PresenceUser[];
  serverTime?: number;
}

const SESSION_STORAGE_KEY = 'countsheet_active_session_id_v1';
const LOCAL_PRESENCE_CACHE_KEY = 'countsheet_local_presence_cache_v1';
const PRESENCE_ONLINE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const PRESENCE_UPDATED_EVENT = 'countsheet_presence_updated';

export function getOrCreateTabSessionId(): string {
  if (typeof window === 'undefined') return 'server_session';
  try {
    let sId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sId) {
      sId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem(SESSION_STORAGE_KEY, sId);
    }
    return sId;
  } catch {
    return `sess_${Date.now()}`;
  }
}

export function buildPresenceSessionId(
  loginType: 'google' | 'guest',
  email: string,
  displayName: string
): string {
  const tabId = getOrCreateTabSessionId();
  const cleanIdentity = (email || displayName || 'guest')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, '_');
  return `${tabId}_${loginType}_${cleanIdentity}`;
}

interface LocalPresenceRecord {
  sessionId: string;
  displayName: string;
  email: string;
  photoURL?: string | null;
  loginType: 'google' | 'guest';
  role: string;
  branchName?: string;
  currentTab?: string;
  joinedAt: string;
  lastSeenAt: string;
  lastSeenMs: number;
}

function readLocalPresenceCache(): Record<string, LocalPresenceRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_PRESENCE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {}
  return {};
}

function writeLocalPresenceRecord(record: LocalPresenceRecord): void {
  if (typeof window === 'undefined') return;
  try {
    const cache = readLocalPresenceCache();
    const now = Date.now();
    const cutoff = now - PRESENCE_ONLINE_WINDOW_MS;
    // Prune expired entries
    for (const key of Object.keys(cache)) {
      if ((cache[key]?.lastSeenMs || 0) < cutoff) {
        delete cache[key];
      }
    }
    const existing = cache[record.sessionId];
    cache[record.sessionId] = {
      ...record,
      joinedAt: existing?.joinedAt || record.joinedAt,
    };
    localStorage.setItem(LOCAL_PRESENCE_CACHE_KEY, JSON.stringify(cache));
    window.dispatchEvent(new CustomEvent(PRESENCE_UPDATED_EVENT));
  } catch {}
}

export async function sendPresenceHeartbeat(payload: {
  sessionId?: string;
  displayName: string;
  email: string;
  photoURL?: string | null;
  loginType: 'google' | 'guest';
  role: string;
  branchName?: string;
  currentTab?: string;
}): Promise<boolean> {
  const isSidcLocal = payload.email.toLowerCase().endsWith('@sidc.local');
  const resolvedLoginType: 'google' | 'guest' =
    payload.loginType === 'google' && !isSidcLocal ? 'google' : 'guest';
  const sessionId =
    payload.sessionId ||
    buildPresenceSessionId(resolvedLoginType, payload.email, payload.displayName);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Save to local cache immediately for instant cross-tab visibility
  writeLocalPresenceRecord({
    sessionId,
    displayName: payload.displayName,
    email: payload.email,
    photoURL: payload.photoURL || null,
    loginType: resolvedLoginType,
    role: payload.role,
    branchName: payload.branchName || '',
    currentTab: payload.currentTab || '',
    joinedAt: nowIso,
    lastSeenAt: nowIso,
    lastSeenMs: now,
  });

  try {
    const res = await fetch('/api/presence/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        loginType: resolvedLoginType,
        sessionId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Immediately registers a Guest Mode user's presence when they enter their nickname.
 */
export function registerImmediateGuestPresence(displayName: string, email?: string): void {
  const cleanName = (displayName || '').trim();
  if (!cleanName || cleanName.toLowerCase() === 'guest') return;
  const cleanEmail =
    (email || '').trim() ||
    `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sidc.local`;
  void sendPresenceHeartbeat({
    displayName: cleanName,
    email: cleanEmail,
    photoURL: null,
    loginType: 'guest',
    role: 'guest',
    branchName: 'Masterdata',
    currentTab: 'branch',
  });
}

export function sendPresenceLeave(sessionId?: string): void {
  if (!sessionId) return;
  const data = JSON.stringify({ sessionId });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/presence/leave', data);
    } else {
      fetch('/api/presence/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {}
}

function normalizeBranchName(branchName?: string): string {
  const trimmed = (branchName || '').trim();
  if (/^global\s+masterdata/i.test(trimmed)) {
    return 'Masterdata';
  }
  return trimmed;
}

export async function fetchOnlinePresence(): Promise<PresenceStats> {
  const now = Date.now();
  const cutoff = now - PRESENCE_ONLINE_WINDOW_MS;
  let serverUsers: PresenceUser[] = [];

  try {
    const res = await fetch('/api/presence/online?_t=' + now, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.users)) {
        serverUsers = data.users;
      }
    }
  } catch (err) {
    console.warn('Could not fetch online presence:', err);
  }

  // Merge with local presence cache so same-browser Guest Mode tabs or sessions after server restart always appear
  const localCache = readLocalPresenceCache();
  const mergedByIdentity = new Map<string, PresenceUser>();

  for (const u of serverUsers) {
    const isLocalGuest = (u.email || '').toLowerCase().endsWith('@sidc.local');
    const loginType: 'google' | 'guest' =
      u.loginType === 'google' && !isLocalGuest ? 'google' : 'guest';
    const key = `${loginType}_${(u.email || u.displayName).toLowerCase().trim()}`;
    mergedByIdentity.set(key, {
      ...u,
      loginType,
      branchName: normalizeBranchName(u.branchName),
    });
  }

  for (const rec of Object.values(localCache)) {
    if (!rec || rec.lastSeenMs < cutoff) continue;
    const isLocalGuest = (rec.email || '').toLowerCase().endsWith('@sidc.local');
    const loginType: 'google' | 'guest' =
      rec.loginType === 'google' && !isLocalGuest ? 'google' : 'guest';
    const key = `${loginType}_${(rec.email || rec.displayName).toLowerCase().trim()}`;
    const secondsAgo = Math.max(0, Math.floor((now - rec.lastSeenMs) / 1000));
    const normalizedBranch = normalizeBranchName(rec.branchName);

    if (!mergedByIdentity.has(key)) {
      mergedByIdentity.set(key, {
        sessionId: rec.sessionId,
        displayName: rec.displayName,
        email: rec.email,
        photoURL: rec.photoURL || null,
        loginType,
        role: (rec.role as any) || (loginType === 'google' ? 'auditor' : 'guest'),
        branchName: normalizedBranch,
        currentTab: rec.currentTab || 'branch',
        joinedAt: rec.joinedAt,
        lastSeenAt: rec.lastSeenAt,
        lastSeenMs: rec.lastSeenMs,
        secondsAgo,
        isOnline: true,
      });
      // Re-sync missing local record to server in background
      fetch('/api/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: rec.sessionId,
          displayName: rec.displayName,
          email: rec.email,
          photoURL: rec.photoURL || null,
          loginType,
          role: rec.role,
          branchName: normalizedBranch,
          currentTab: rec.currentTab || 'branch',
        }),
      }).catch(() => {});
    }
  }

  const users = Array.from(mergedByIdentity.values()).sort(
    (a, b) => (a.secondsAgo || 0) - (b.secondsAgo || 0)
  );
  const totalOnline = users.length;
  const totalGoogleUsers = users.filter((u) => u.loginType === 'google').length;
  const totalGuests = users.filter((u) => u.loginType === 'guest').length;

  return {
    totalOnline,
    totalGoogleUsers,
    totalGuests,
    users,
    serverTime: now,
  };
}

/**
 * Hook to automatically broadcast client presence (Google account or Guest mode) to server.
 */
export function usePresenceHeartbeat(params: {
  user: User | null;
  accessToken?: string | null;
  isGoogleConnected: boolean;
  selectedBranch: SelectedBranch | null;
  currentTab: string;
  isUserAdmin: boolean;
  customPhotoURL?: string | null;
}) {
  const {
    user,
    accessToken,
    isGoogleConnected,
    selectedBranch,
    currentTab,
    isUserAdmin,
    customPhotoURL,
  } = params;
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    // Do not broadcast presence when sitting on the SignInView before signing in or entering a Guest nickname
    if (!user || !accessToken) {
      return;
    }

    // Determine whether this session is Guest Mode or a Google Account
    const isExplicitGuest =
      !isGoogleConnected ||
      Boolean(accessToken && accessToken.startsWith('auditor:')) ||
      Boolean(user.email && user.email.toLowerCase().endsWith('@sidc.local')) ||
      Boolean(user.uid && user.uid.startsWith('auditor-'));

    const loginType: 'google' | 'guest' = isExplicitGuest ? 'guest' : 'google';

    const displayName = (user.displayName || '').trim() || 'Guest Auditor';

    let email = user.email || '';
    if (!email || isExplicitGuest) {
      email =
        user.email && user.email.toLowerCase().endsWith('@sidc.local')
          ? user.email
          : `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sidc.local`;
    }

    let role = 'guest';
    if (!isExplicitGuest) {
      role = isUserAdmin ? 'admin' : 'auditor';
    }

    const sessionId = buildPresenceSessionId(loginType, email, displayName);
    const resolvedPhoto =
      customPhotoURL === 'NONE'
        ? null
        : customPhotoURL || (isExplicitGuest ? null : user.photoURL || null);

    const payload = {
      sessionId,
      displayName,
      email,
      photoURL: resolvedPhoto,
      loginType,
      role,
      branchName:
        selectedBranch?.name ||
        (currentTab === 'inventory' || isExplicitGuest ? 'Masterdata' : ''),
      currentTab,
    };

    // Send immediately on state change
    void sendPresenceHeartbeat(payload);

    // Periodic heartbeat every 20 seconds (including background tabs so open Guest Mode tabs stay online)
    const interval = setInterval(() => {
      if (isMountedRef.current) {
        void sendPresenceHeartbeat(payload);
      }
    }, 20000);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void sendPresenceHeartbeat(payload);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    user,
    user?.displayName,
    user?.email,
    user?.photoURL,
    user?.uid,
    accessToken,
    isGoogleConnected,
    selectedBranch?.name,
    currentTab,
    isUserAdmin,
    customPhotoURL,
  ]);
}

