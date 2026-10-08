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

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/spreadsheets');

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
    if (parsed && typeof parsed.email === 'string') {
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
    if (!user.email) return;
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
let activeSignInPromise: Promise<{ user: User; accessToken: string } | null> | null = null;

// Validate that a token is a genuine Google OAuth 2 access token (not an auditor or Firebase ID token)
export const isGoogleOAuthAccessToken = (token: string | null | undefined): boolean => {
  if (!token || typeof token !== 'string') return false;
  // Local auditor tokens are development/offline dummy tokens
  if (token.startsWith('auditor:') || token === 'icd-local-session-token') return false;
  
  // Reject Firebase ID tokens: they are JWTs (3 dot-separated base64 segments)
  const dotParts = token.split('.');
  if (dotParts.length === 3) {
    try {
      const payloadStr = atob(dotParts[1].replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(payloadStr);
      if (payload.iss && payload.iss.includes('securetoken.google.com')) {
        // This is a Firebase ID token, NOT a Google OAuth 2 access token
        return false;
      }
    } catch {
      // Continue validation
    }
  }

  // Google OAuth 2 access tokens returned by Google Identity start with ya29.
  return token.startsWith('ya29.') || token.length > 50;
};

export const clearCachedAccessToken = () => {
  cachedAccessToken = null;
  try {
    sessionStorage.removeItem('countsheet_oauth_token');
    sessionStorage.removeItem('countsheet_oauth_token_timestamp');
  } catch {}
};

// Initialize cached token from sessionStorage if valid and not expired (tokens expire after 1 hour)
try {
  const storedToken = sessionStorage.getItem('countsheet_oauth_token');
  const storedTimestamp = Number(sessionStorage.getItem('countsheet_oauth_token_timestamp') || '0');
  // 55 minutes expiration threshold to guarantee validity
  const isExpired = storedTimestamp > 0 && Date.now() - storedTimestamp > 55 * 60 * 1000;

  if (storedToken && !isExpired && isGoogleOAuthAccessToken(storedToken)) {
    cachedAccessToken = storedToken;
  } else if (storedToken && isExpired) {
    clearCachedAccessToken();
  } else if (storedToken && (storedToken.startsWith('auditor:') || storedToken === 'icd-local-session-token')) {
    cachedAccessToken = storedToken;
  }
} catch {
  // Ignore storage errors in private browsing
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // If an auditor session was previously active in sessionStorage
  if (cachedAccessToken && (cachedAccessToken.startsWith('auditor:') || cachedAccessToken === 'icd-local-session-token')) {
    const remembered = getRememberedUser();
    if (remembered) {
      const customUser = {
        displayName: remembered.displayName,
        email: remembered.email,
        uid: `auditor-${remembered.email}`,
        photoURL: remembered.photoURL || null,
      } as unknown as User;
      if (onAuthSuccess) {
        onAuthSuccess(customUser, cachedAccessToken);
        return () => {};
      }
    }
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      saveRememberedUser(user);
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // User is logged into Firebase Auth, but accessToken was not retrieved in this session yet.
        // Prompt re-auth or trigger onAuthFailure so UI can show connection card
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      if (cachedAccessToken && (cachedAccessToken.startsWith('auditor:') || cachedAccessToken === 'icd-local-session-token')) {
        // Retain auditor session
        const remembered = getRememberedUser();
        if (remembered && onAuthSuccess) {
          const customUser = {
            displayName: remembered.displayName,
            email: remembered.email,
            uid: `auditor-${remembered.email}`,
            photoURL: remembered.photoURL || null,
          } as unknown as User;
          onAuthSuccess(customUser, cachedAccessToken);
          return;
        }
      }
      cachedAccessToken = null;
      try {
        sessionStorage.removeItem('countsheet_oauth_token');
      } catch {}
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export interface SignInOptions {
  forceSelectAccount?: boolean;
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
      const loginHint = typeof options === 'object' ? options?.loginHint : undefined;

      const params: Record<string, string> = {};
      if (forceSelect) {
        params.prompt = 'select_account';
      }
      if (loginHint) {
        params.login_hint = loginHint;
      }
      provider.setCustomParameters(params);

      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Failed to get access token from Google sign-in');
      }

      cachedAccessToken = credential.accessToken;
      try {
        sessionStorage.setItem('countsheet_oauth_token', credential.accessToken);
        sessionStorage.setItem('countsheet_oauth_token_timestamp', String(Date.now()));
      } catch {}
      saveRememberedUser(result.user);
      return { user: result.user, accessToken: cachedAccessToken };
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
          'This domain is not yet authorized in Firebase Console. Please use Auditor Field Access below to proceed.';
      } else if (isPopupClosed) {
        friendlyMessage =
          'Sign-in window was closed or interrupted. Tap "Retry Google Sign-In" to try again, or use Auditor Field Access.';
      } else if (errCode === 'auth/network-request-failed') {
        friendlyMessage =
          'Network connection interrupted during sign-in. Please try again or use Auditor Field Access.';
      } else if (errMsg && !errMsg.includes('[object Object]')) {
        const cleanMsg = errMsg.replace(/^Firebase:\s*/, '').replace(/\s*\([a-z0-9/-]+\)\.?/i, '');
        friendlyMessage = `${cleanMsg}. Please try again or use Auditor Field Access.`;
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
  return cachedAccessToken;
};

export const setAccessToken = (token: string | null) => {
  cachedAccessToken = token;
  try {
    if (token) {
      sessionStorage.setItem('countsheet_oauth_token', token);
      sessionStorage.setItem('countsheet_oauth_token_timestamp', String(Date.now()));
    } else {
      sessionStorage.removeItem('countsheet_oauth_token');
      sessionStorage.removeItem('countsheet_oauth_token_timestamp');
    }
  } catch {}
};

export const refreshGoogleAccessToken = async (loginHint?: string): Promise<string> => {
  const result = await googleSignIn({
    forceSelectAccount: false,
    loginHint,
  });
  if (!result?.accessToken) {
    throw new Error('Google sign-in did not return an OAuth 2 access token.');
  }
  return result.accessToken;
};

export const directAuditorSignIn = (
  displayName: string,
  email?: string
): { user: User; accessToken: string } => {
  const cleanName = displayName.trim() || 'Auditor';
  const cleanEmail = email?.trim() || `${cleanName.toLowerCase().replace(/\s+/g, '.')}@sidc.local`;
  const customUser = {
    displayName: cleanName,
    email: cleanEmail,
    uid: `auditor-${Date.now()}`,
    photoURL: null,
  } as unknown as User;

  saveRememberedUser(customUser);
  cachedAccessToken = `auditor:${encodeURIComponent(cleanEmail)}:${encodeURIComponent(cleanName)}`;
  setAccessToken(cachedAccessToken);
  return { user: customUser, accessToken: cachedAccessToken };
};

export const logout = async (clearRemembered = false) => {
  try {
    if (auth.currentUser) {
      await signOut(auth);
    }
  } finally {
    cachedAccessToken = null;
    try {
      sessionStorage.removeItem('countsheet_oauth_token');
      if (clearRemembered) {
        clearRememberedUser();
      }
    } catch {}
  }
};
