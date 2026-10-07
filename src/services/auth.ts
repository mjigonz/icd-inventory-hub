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

// Initialize cached token from sessionStorage if valid
try {
  const storedToken = sessionStorage.getItem('countsheet_oauth_token');
  if (storedToken) {
    cachedAccessToken = storedToken;
  }
} catch {
  // Ignore storage errors in private browsing
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
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

      if (errCode !== 'auth/popup-closed-by-user' && !isAssertionError) {
        console.warn('Google sign-in notice:', errMsg);
      }

      let friendlyMessage = 'Sign-in window was closed or interrupted. Please try again.';
      if (errCode === 'auth/popup-blocked') {
        friendlyMessage =
          'The Google sign-in popup was blocked by your browser. Please allow popups in your browser address bar (top-right).';
      } else if (errCode === 'auth/popup-closed-by-user') {
        friendlyMessage = 'The sign-in window was closed. Click "Sign in with Google" when ready.';
      } else if (isAssertionError) {
        friendlyMessage = 'Sign-in window was closed. Click "Sign in with Google" when ready.';
      }

      const err = new Error(friendlyMessage);
      (err as any).code = errCode || 'auth/popup-reset';
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
    } else {
      sessionStorage.removeItem('countsheet_oauth_token');
    }
  } catch {}
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
  } as unknown as User;

  saveRememberedUser(customUser);
  cachedAccessToken = 'icd-local-session-token';
  setAccessToken(cachedAccessToken);
  return { user: customUser, accessToken: cachedAccessToken };
};

export const logout = async (clearRemembered = false) => {
  try {
    await signOut(auth);
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
