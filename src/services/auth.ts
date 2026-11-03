import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { RememberedUser } from '../types';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const isFirestoreEnabled = false;
export const db = null;

const REQUIRED_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.readonly',
];

function createGoogleAuthProvider(customParams?: Record<string, string>): GoogleAuthProvider {
  const freshProvider = new GoogleAuthProvider();
  for (const scope of REQUIRED_OAUTH_SCOPES) {
    freshProvider.addScope(scope);
  }
  if (customParams && Object.keys(customParams).length > 0) {
    freshProvider.setCustomParameters(customParams);
  }
  return freshProvider;
}

const tokensMissingGmailScope = new Set<string>();

const REMEMBERED_USER_KEY = 'countsheet_last_user';
const CUSTOM_PHOTO_KEY = 'countsheet_custom_user_photo';

export const getCustomPhotoURL = (): string | null => {
  try {
    return localStorage.getItem(CUSTOM_PHOTO_KEY) || null;
  } catch {
    return null;
  }
};

export const setCustomPhotoURL = (photoUrl: string | null) => {
  try {
    if (photoUrl) {
      localStorage.setItem(CUSTOM_PHOTO_KEY, photoUrl);
    } else {
      localStorage.removeItem(CUSTOM_PHOTO_KEY);
    }
  } catch {}
};

export const getRememberedUser = (): RememberedUser | null => {
  try {
    const raw = localStorage.getItem(REMEMBERED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.email === 'string' &&
      !parsed.email.endsWith('@sidc.local')
    ) {
      return parsed as RememberedUser;
    }
    return null;
  } catch {
    return null;
  }
};

export const saveRememberedUser = (user: {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
}) => {
  try {
    if (!user.email || user.email.endsWith('@sidc.local')) return;
    const profile: RememberedUser = {
      displayName: user.displayName || user.email.split('@')[0],
      email: user.email,
      photoURL: user.photoURL || null,
      lastSignedInAt: new Date().toISOString(),
    };
    localStorage.setItem(REMEMBERED_USER_KEY, JSON.stringify(profile));
  } catch {}
};

export const clearRememberedUser = () => {
  try {
    localStorage.removeItem(REMEMBERED_USER_KEY);
  } catch {}
};

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedTokenTimestamp: number = 0;
let activeSignInPromise: Promise<{ user: User; accessToken: string } | null> | null = null;

const EXPLICIT_LOGOUT_KEY = 'countsheet_explicit_logged_out';
export const TOKEN_FRESH_MAX_AGE_MS = 50 * 60 * 1000; // 50 minutes

type TokenListener = (token: string | null) => void;
const tokenListeners = new Set<TokenListener>();

export const subscribeToTokenChanges = (listener: TokenListener): (() => void) => {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
};

const notifyTokenListeners = (token: string | null) => {
  tokenListeners.forEach((listener) => {
    try {
      listener(token);
    } catch {}
  });
};

function getSyncKeyForAuth(): string | null {
  try {
    const email = auth.currentUser?.email || getRememberedUser()?.email;
    if (email) {
      return email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
    }
    if (auth.currentUser?.uid) {
      return auth.currentUser.uid;
    }
  } catch {}
  return null;
}

// Validate that a token is a genuine Google OAuth 2 access token (not an auditor or Firebase ID token)
export const isGoogleOAuthAccessToken = (token: string | null | undefined): boolean => {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();

  // Local auditor tokens are development/offline dummy tokens
  if (
    trimmed.startsWith('auditor:') ||
    trimmed === 'icd-local-session-token' ||
    trimmed.startsWith('icd-local-')
  ) {
    return false;
  }

  // Reject Firebase ID tokens or OpenID Connect JWTs (starts with eyJ and has 3 dot-delimited parts)
  if (trimmed.startsWith('eyJ') && trimmed.split('.').length === 3) {
    return false;
  }

  // Any non-empty access token from Google sign-in
  return trimmed.length >= 10;
};

export const getStoredOAuthTokenTimestamp = (): number => {
  if (cachedTokenTimestamp > 0) return cachedTokenTimestamp;
  try {
    const raw =
      sessionStorage.getItem('countsheet_oauth_token_timestamp') ||
      localStorage.getItem('countsheet_oauth_token_timestamp');
    if (raw) {
      const parsed = Number(raw);
      if (!isNaN(parsed) && parsed > 0) {
        cachedTokenTimestamp = parsed;
        return parsed;
      }
    }
  } catch {}
  return 0;
};

export const isStoredTokenFresh = (maxAgeMs = TOKEN_FRESH_MAX_AGE_MS): boolean => {
  const token = getStoredOAuthToken();
  if (!token || !isGoogleOAuthAccessToken(token)) return false;
  const ts = getStoredOAuthTokenTimestamp();
  if (!ts) return false;
  return Date.now() - ts < maxAgeMs;
};

export const saveOAuthTokenWithTimestamp = (
  token: string,
  issuedAtMs: number = Date.now(),
  syncToCloud: boolean = true
) => {
  if (!token || !isGoogleOAuthAccessToken(token)) return;
  cachedAccessToken = token;
  cachedTokenTimestamp = issuedAtMs;
  const tsStr = String(issuedAtMs);
  try {
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
    sessionStorage.removeItem(EXPLICIT_LOGOUT_KEY);
    sessionStorage.removeItem('countsheet_session_token');
    localStorage.setItem('countsheet_oauth_token', token);
    localStorage.setItem('countsheet_oauth_token_timestamp', tsStr);
    sessionStorage.setItem('countsheet_oauth_token', token);
    sessionStorage.setItem('countsheet_oauth_token_timestamp', tsStr);
  } catch {}
  notifyTokenListeners(token);

  if (syncToCloud) {
    const userKey = getSyncKeyForAuth();
    if (userKey) {
      fetch(`/api/sync/workspace/${encodeURIComponent(userKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oauthAccessToken: token,
          oauthTokenIssuedAt: issuedAtMs,
          updatedAt: new Date().toISOString(),
        }),
      }).catch(() => {});
    }
  }
};

export const isGuestSessionActive = (): boolean => {
  try {
    const activeSessionToken = sessionStorage.getItem('countsheet_session_token');
    return Boolean(activeSessionToken && activeSessionToken.startsWith('auditor:'));
  } catch {
    return false;
  }
};

export const syncOAuthTokenFromCloud = async (): Promise<string | null> => {
  if (isGuestSessionActive()) return null;
  const userKey = getSyncKeyForAuth();
  if (!userKey) return null;
  try {
    const res = await fetch(`/api/sync/workspace/${encodeURIComponent(userKey)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const state = data?.state;
    if (
      state?.oauthAccessToken &&
      isGoogleOAuthAccessToken(state.oauthAccessToken) &&
      !tokensMissingGmailScope.has(state.oauthAccessToken) &&
      typeof state.oauthTokenIssuedAt === 'number'
    ) {
      if (isGuestSessionActive()) return null;
      const age = Date.now() - state.oauthTokenIssuedAt;
      if (age >= 0 && age < TOKEN_FRESH_MAX_AGE_MS) {
        const localToken = getStoredOAuthToken();
        const localTs = getStoredOAuthTokenTimestamp();
        if (!localToken || state.oauthTokenIssuedAt >= localTs) {
          saveOAuthTokenWithTimestamp(state.oauthAccessToken, state.oauthTokenIssuedAt, false);
          return state.oauthAccessToken;
        }
        return localToken;
      }
    }
  } catch {}
  return null;
};

export const markTokenMissingGmailScope = (token?: string | null) => {
  if (!token) return;
  const trimmed = token.trim();
  if (!trimmed) return;
  tokensMissingGmailScope.add(trimmed);
  if (cachedAccessToken === trimmed) {
    cachedAccessToken = null;
    cachedTokenTimestamp = 0;
  }
  try {
    if (localStorage.getItem('countsheet_oauth_token') === trimmed) {
      localStorage.removeItem('countsheet_oauth_token');
      localStorage.removeItem('countsheet_oauth_token_timestamp');
    }
    if (sessionStorage.getItem('countsheet_oauth_token') === trimmed) {
      sessionStorage.removeItem('countsheet_oauth_token');
      sessionStorage.removeItem('countsheet_oauth_token_timestamp');
    }
  } catch {}
};

export const isTokenMissingGmailScope = (token?: string | null): boolean => {
  if (!token) return false;
  return tokensMissingGmailScope.has(token.trim());
};

export const clearCachedAccessToken = (failedToken?: string) => {
  // If a specific failedToken was passed and we already have a newer/different token, do not wipe the new token
  if (failedToken && cachedAccessToken && failedToken !== cachedAccessToken) {
    return;
  }
  cachedAccessToken = null;
  cachedTokenTimestamp = 0;
  try {
    localStorage.removeItem('countsheet_oauth_token');
    localStorage.removeItem('countsheet_oauth_token_timestamp');
    sessionStorage.removeItem('countsheet_oauth_token');
    sessionStorage.removeItem('countsheet_oauth_token_timestamp');
  } catch {}
  notifyTokenListeners(null);
};

export const getStoredOAuthToken = (): string | null => {
  try {
    const activeSessionToken = sessionStorage.getItem('countsheet_session_token');
    if (activeSessionToken && activeSessionToken.startsWith('auditor:')) {
      return null;
    }

    const stored =
      cachedAccessToken ||
      sessionStorage.getItem('countsheet_oauth_token') ||
      localStorage.getItem('countsheet_oauth_token');

    if (!stored) return null;

    // Never allow legacy dummy token as a Google OAuth token
    if (stored === 'icd-local-session-token' || stored.startsWith('icd-local-')) {
      return null;
    }

    if (isGoogleOAuthAccessToken(stored)) {
      cachedAccessToken = stored;
      getStoredOAuthTokenTimestamp();
      return stored;
    }

    return null;
  } catch {
    return cachedAccessToken && isGoogleOAuthAccessToken(cachedAccessToken) ? cachedAccessToken : null;
  }
};

// Initialize cached token from localStorage or sessionStorage if available
try {
  getStoredOAuthToken();
} catch {
  // Ignore storage errors in private browsing
}

export const instantContinueSignIn = (
  remembered?: RememberedUser | null
): { user: User; accessToken: string } => {
  try {
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
    sessionStorage.removeItem(EXPLICIT_LOGOUT_KEY);
  } catch {}

  const profile = remembered || getRememberedUser();
  const firebaseUser = auth.currentUser;

  const displayName =
    firebaseUser?.displayName || profile?.displayName || 'Auditor';
  const email =
    firebaseUser?.email || profile?.email || 'mjigonzalessidc@gmail.com';
  const photoURL =
    firebaseUser?.photoURL || profile?.photoURL || null;

  const resolvedUser: User =
    firebaseUser ||
    ({
      displayName,
      email,
      uid: `user-${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
      photoURL,
    } as unknown as User);

  saveRememberedUser(resolvedUser);

  const existingOAuthToken = getStoredOAuthToken();
  const activeToken =
    existingOAuthToken && isGoogleOAuthAccessToken(existingOAuthToken)
      ? existingOAuthToken
      : `auditor:${encodeURIComponent(email)}:${encodeURIComponent(displayName)}`;

  if (!existingOAuthToken) {
    try {
      sessionStorage.setItem('countsheet_session_token', activeToken);
    } catch {}
  }

  return { user: resolvedUser, accessToken: activeToken };
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // If user explicitly clicked Sign Out, stay on SignInView until they click Continue
  try {
    if (
      sessionStorage.getItem(EXPLICIT_LOGOUT_KEY) === '1' ||
      localStorage.getItem(EXPLICIT_LOGOUT_KEY) === '1'
    ) {
      if (onAuthFailure) onAuthFailure();
      return () => {};
    }
  } catch {}

  // If an explicit instant/auditor session was started in this tab, require a valid non-empty name
  try {
    const sessionToken = sessionStorage.getItem('countsheet_session_token');
    if (sessionToken && sessionToken.startsWith('auditor:')) {
      const parts = sessionToken.split(':');
      const decodedEmail = parts[1] ? decodeURIComponent(parts[1]).trim() : '';
      const decodedName = parts[2] ? decodeURIComponent(parts[2]).trim() : '';
      if (!decodedName || decodedName.toLowerCase() === 'guest') {
        sessionStorage.removeItem('countsheet_session_token');
        if (onAuthFailure) onAuthFailure();
        return () => {};
      }
      const resolvedEmail =
        decodedEmail || `${decodedName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sidc.local`;
      const customUser = {
        displayName: decodedName,
        email: resolvedEmail,
        uid: `auditor-${resolvedEmail.replace(/[^a-zA-Z0-9]/g, '_')}`,
        photoURL: null,
      } as unknown as User;
      if (onAuthSuccess) {
        onAuthSuccess(customUser, sessionToken);
        return () => {};
      }
    }
  } catch {}

  return onAuthStateChanged(auth, async (user: User | null) => {
    // If this tab is currently in Guest Mode, never override it with Firebase Auth state
    if (isGuestSessionActive()) {
      return;
    }

    // Wait for any active signInWithPopup to complete so credential.accessToken is stored first
    if (isSigningIn && activeSignInPromise) {
      try {
        await activeSignInPromise;
      } catch {
        // Sign-in failed or was cancelled
      }
    }

    if (isGuestSessionActive()) {
      return;
    }

    try {
      if (
        sessionStorage.getItem(EXPLICIT_LOGOUT_KEY) === '1' ||
        localStorage.getItem(EXPLICIT_LOGOUT_KEY) === '1'
      ) {
        if (onAuthFailure) onAuthFailure();
        return;
      }
    } catch {}

    if (user) {
      saveRememberedUser(user);
      let oauthToken = getStoredOAuthToken();
      if (!oauthToken || !isStoredTokenFresh()) {
        const cloudToken = await syncOAuthTokenFromCloud();
        if (cloudToken) {
          oauthToken = cloudToken;
        }
      }
      const fallbackSessionToken = `auditor:${encodeURIComponent(user.email || 'user')}:${encodeURIComponent(user.displayName || 'Auditor')}`;
      const tokenToUse = oauthToken || fallbackSessionToken;
      if (onAuthSuccess) {
        onAuthSuccess(user, tokenToUse);
      }
    } else {
      // Check if user has a remembered profile and stored or cloud OAuth token
      const remembered = getRememberedUser();
      let oauthToken = getStoredOAuthToken();
      if (remembered && (!oauthToken || !isStoredTokenFresh())) {
        const cloudToken = await syncOAuthTokenFromCloud();
        if (cloudToken) {
          oauthToken = cloudToken;
        }
      }
      if (remembered && oauthToken && onAuthSuccess) {
        const customUser = {
          displayName: remembered.displayName,
          email: remembered.email,
          uid: `user-${remembered.email.replace(/[^a-zA-Z0-9]/g, '_')}`,
          photoURL: remembered.photoURL || null,
        } as unknown as User;
        onAuthSuccess(customUser, oauthToken);
        return;
      }
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export interface SignInOptions {
  forceSelectAccount?: boolean;
  forceConsent?: boolean;
  loginHint?: string;
}

export const googleSignIn = async (
  options?: SignInOptions | boolean
): Promise<{ user: User; accessToken: string } | null> => {
  if (activeSignInPromise) {
    return activeSignInPromise;
  }

  activeSignInPromise = (async () => {
    try {
      isSigningIn = true;

      const forceSelect = typeof options === 'boolean' ? options : Boolean(options?.forceSelectAccount);
      const forceConsent = typeof options === 'object' ? Boolean(options?.forceConsent) : false;
      const rawHint = typeof options === 'object' ? options?.loginHint : undefined;
      const isSyntheticHint =
        !rawHint ||
        rawHint.endsWith('@sidc.local') ||
        (rawHint === 'mjigonzalessidc@gmail.com' && auth.currentUser?.email !== 'mjigonzalessidc@gmail.com');
      const loginHint = isSyntheticHint ? undefined : rawHint;

      const params: Record<string, string> = {
        include_granted_scopes: 'true',
      };
      if (forceConsent) {
        params.prompt = 'consent';
        if (loginHint) params.login_hint = loginHint;
      } else if (forceSelect) {
        params.prompt = 'select_account';
      } else if (loginHint) {
        params.login_hint = loginHint;
      }
      const activeProvider = createGoogleAuthProvider(params);

      const result = await signInWithPopup(auth, activeProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Failed to get access token from Google sign-in');
      }

      tokensMissingGmailScope.delete(credential.accessToken);
      saveRememberedUser(result.user);
      saveOAuthTokenWithTimestamp(credential.accessToken, Date.now(), true);
      return { user: result.user, accessToken: credential.accessToken };
    } catch (error: any) {
      const errCode = error?.code || '';
      const errMsg = String(error?.message || error || '');

      const isAssertionError =
        errMsg.includes('INTERNAL ASSERTION FAILED') ||
        errMsg.includes('Pending promise') ||
        errCode === 'auth/cancelled-popup-request';

      const isPopupClosed =
        errCode === 'auth/popup-closed-by-user' ||
        errCode === 'auth/user-cancelled' ||
        errMsg.toLowerCase().includes('popup-closed-by-user') ||
        errMsg.toLowerCase().includes('closed-by-user') ||
        errMsg.toLowerCase().includes('cancelled') ||
        isAssertionError;

      if (!isPopupClosed && errCode !== 'auth/popup-blocked') {
        console.warn('Google sign-in notice:', errMsg);
      }

      let friendlyMessage = 'Sign-in window was closed or interrupted. Please try again.';
      if (errCode === 'auth/popup-blocked') {
        friendlyMessage =
          'The Google sign-in popup was blocked by your browser. Please allow popups in your browser address bar (top-right), or open in a full tab.';
      } else if (errCode === 'auth/unauthorized-domain') {
        friendlyMessage =
          'This domain is not yet authorized in Firebase Console. Please use Instant Continue below to proceed.';
      } else if (isPopupClosed) {
        friendlyMessage =
          'Google sign-in popup was closed before completing.';
      } else if (errCode === 'auth/network-request-failed') {
        friendlyMessage =
          'Network connection interrupted during sign-in. Please try again.';
      } else if (errMsg && !errMsg.includes('[object Object]')) {
        const cleanMsg = errMsg.replace(/^Firebase:\s*/, '').replace(/\s*\([a-z0-9/-]+\)\.?/i, '');
        friendlyMessage = `${cleanMsg}. Please try again.`;
      }

      const err = new Error(friendlyMessage);
      (err as any).code = errCode || (isPopupClosed ? 'auth/popup-closed-by-user' : 'auth/popup-reset');
      throw err;
    } finally {
      isSigningIn = false;
      activeSignInPromise = null;
    }
  })();

  return activeSignInPromise;
};

export const getAccessToken = async (): Promise<string | null> => {
  return getStoredOAuthToken();
};

export const setAccessToken = (token: string | null) => {
  if (token && isGoogleOAuthAccessToken(token)) {
    saveOAuthTokenWithTimestamp(token, Date.now(), true);
  } else if (token && token.startsWith('auditor:')) {
    try {
      sessionStorage.setItem('countsheet_session_token', token);
    } catch {}
    notifyTokenListeners(token);
  } else if (!token) {
    clearCachedAccessToken();
  }
};

export const refreshGoogleAccessToken = async (
  loginHint?: string,
  forceConsent = false
): Promise<string> => {
  // First check if another device or tab already pushed a fresh token to the cloud workspace
  if (!forceConsent) {
    const cloudToken = await syncOAuthTokenFromCloud();
    if (cloudToken && isStoredTokenFresh() && !tokensMissingGmailScope.has(cloudToken)) {
      return cloudToken;
    }
  } else {
    clearCachedAccessToken();
  }

  const remembered = getRememberedUser();
  const candidateHint = loginHint || auth.currentUser?.email || remembered?.email || undefined;
  const hint =
    candidateHint &&
    !candidateHint.endsWith('@sidc.local') &&
    (candidateHint !== 'mjigonzalessidc@gmail.com' || auth.currentUser?.email === 'mjigonzalessidc@gmail.com')
      ? candidateHint
      : undefined;
  const result = await googleSignIn({
    forceSelectAccount: false,
    forceConsent,
    loginHint: hint,
  });
  if (!result?.accessToken) {
    throw new Error('Google sign-in did not return an OAuth 2 access token.');
  }
  return result.accessToken;
};

export const resolveValidOAuthToken = async (
  candidateToken?: string | null,
  options?: { forceRefresh?: boolean; allowPopup?: boolean; failedToken?: string }
): Promise<string | null> => {
  const forceRefresh = Boolean(options?.forceRefresh);
  const allowPopup = options?.allowPopup !== false;
  const failedToken = options?.failedToken;

  // If this tab is in Guest Mode and popup sign-in is not explicitly requested, do not pull Google tokens
  if (
    !allowPopup &&
    (isGuestSessionActive() || (candidateToken && candidateToken.startsWith('auditor:')))
  ) {
    return null;
  }

  // 1. If not forcing refresh, check if we already have a fresh local token
  if (!forceRefresh) {
    if (
      candidateToken &&
      isGoogleOAuthAccessToken(candidateToken) &&
      candidateToken !== failedToken &&
      isStoredTokenFresh()
    ) {
      return candidateToken;
    }
    const stored = getStoredOAuthToken();
    if (stored && stored !== failedToken && isStoredTokenFresh()) {
      return stored;
    }
  } else {
    // Even if forceRefresh was requested for a specific failedToken, check if local token was already updated to a newer token
    const currentStored = getStoredOAuthToken();
    if (currentStored && failedToken && currentStored !== failedToken && isStoredTokenFresh()) {
      return currentStored;
    }
  }

  // 2. Check if another device synced a fresh token to the cloud workspace
  const cloudToken = await syncOAuthTokenFromCloud();
  if (cloudToken && cloudToken !== failedToken) {
    return cloudToken;
  }

  // 3. If not forcing refresh and we have an existing Google OAuth token (even if >50m old), try using it first
  // (if Google returns 401, fetchWithRetry will call resolveValidOAuthToken with forceRefresh: true)
  if (!forceRefresh) {
    const existing =
      (candidateToken && isGoogleOAuthAccessToken(candidateToken) ? candidateToken : null) ||
      getStoredOAuthToken();
    if (existing && existing !== failedToken) {
      return existing;
    }
  }

  // 4. Otherwise automatically refresh via Google Sign-In if allowed
  if (allowPopup) {
    try {
      const remembered = getRememberedUser();
      const hint = auth.currentUser?.email || remembered?.email || undefined;
      const result = await googleSignIn({
        forceSelectAccount: false,
        loginHint: hint,
      });
      if (result?.accessToken) {
        return result.accessToken;
      }
    } catch (err) {
      console.warn('Auto-refresh Google OAuth token notice:', err);
    }
  }

  return null;
};

export const directAuditorSignIn = (
  displayName: string,
  email?: string
): { user: User; accessToken: string } => {
  const cleanName = (displayName || '').trim();
  if (!cleanName || cleanName.toLowerCase() === 'guest') {
    throw new Error('Name is required to enter Guest Mode.');
  }

  try {
    sessionStorage.removeItem(EXPLICIT_LOGOUT_KEY);
    sessionStorage.removeItem('countsheet_oauth_token');
    sessionStorage.removeItem('countsheet_oauth_token_timestamp');
  } catch {}
  cachedAccessToken = null;
  cachedTokenTimestamp = 0;

  const rawEmail = email?.trim() || `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sidc.local`;
  const cleanEmail = rawEmail.endsWith('@sidc.local')
    ? rawEmail
    : `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sidc.local`;
  const customUser = {
    displayName: cleanName,
    email: cleanEmail,
    uid: `auditor-${Date.now()}`,
    photoURL: null,
  } as unknown as User;

  const sessionToken = `auditor:${encodeURIComponent(cleanEmail)}:${encodeURIComponent(cleanName)}`;
  setAccessToken(sessionToken);
  return { user: customUser, accessToken: sessionToken };
};

export const logout = async (clearRemembered = false) => {
  try {
    localStorage.setItem(EXPLICIT_LOGOUT_KEY, '1');
    sessionStorage.setItem(EXPLICIT_LOGOUT_KEY, '1');
    sessionStorage.removeItem('countsheet_session_token');
    clearCachedAccessToken();
    if (clearRemembered) {
      clearRememberedUser();
    }
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch {}
};
