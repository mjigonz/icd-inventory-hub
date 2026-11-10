/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import {
  initAuth,
  googleSignIn,
  logout,
  getRememberedUser,
  saveRememberedUser,
  getCustomPhotoURL,
  setCustomPhotoURL,
  SignInOptions,
  directAuditorSignIn,
  getStoredOAuthToken,
  subscribeToTokenChanges,
  instantContinueSignIn,
  isStoredTokenFresh,
  syncOAuthTokenFromCloud,
  isGoogleOAuthAccessToken,
} from './services/auth';
import {
  isUserAdminFromLocal,
  verifyUserAdminAccess,
  subscribeToDirectoryUpdates,
  subscribeToRoleDefinitions,
  fetchAdminRoleDefinitionsFromServer,
  fetchAdminDirectoryFromServer,
} from './services/adminService';
import { REALTIME_DATA_SYNC_EVENT } from './hooks/useAppUpdate';
import { usePresenceHeartbeat, registerImmediateGuestPresence } from './services/presenceService';
import { TopHeader } from './components/TopHeader';
import { BottomNav, NavTab } from './components/BottomNav';
import { CreateAuditReportModal } from './components/CreateAuditReportModal';
import { CreateRandomCountsheetModal } from './components/CreateRandomCountsheetModal';
import { FormsModal } from './components/FormsModal';
import {
  TelegramDoodleBackground,
  BackgroundIconTheme,
  BACKGROUND_ICON_THEMES,
  CharacterDensity,
  getAutoSeasonalTheme,
} from './components/TelegramDoodleBackground';
import { DecorationProvider, MotionPreference } from './components/PanelDecoration';
import { setActiveAuditUserEmail, RecentCountsheetSession } from './services/auditReportService';
import { SignInView } from './views/SignInView';
import { BranchView } from './views/BranchView';
import { CountView } from './views/CountView';
import { InventoryView } from './views/InventoryView';
import { MonitoringView } from './views/MonitoringView';
import { AdminView } from './views/AdminView';
import { SelectedBranch, RememberedUser } from './types';
import {
  getSavedBranch,
  getAllSavedBranches,
  subscribeToWorkspaceState,
  syncWorkspaceStateToCloud,
  ensureBranchInventoryHydrated,
  subscribeToBranchCountsheets,
  saveBranchMetadataLocalOnly,
  getActiveBranchStorageKey,
  getActiveRoleStorageKey,
  notifyAccountSwitched,
  syncMasterdataFromServerIfUpdated,
} from './services/db';
import { getIntegrationParams, resolveFeatureNavigation } from './utils/integration';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useTheme } from './hooks/useTheme';
import { LanguageProvider, useLanguage } from './services/i18n';
import { WifiOff, Store, ClipboardList, Activity, PackageSearch, Database } from 'lucide-react';

export default function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

function AppContent() {
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();
  const { theme, appearanceMode, setAppearanceMode, toggleTheme } = useTheme();
  const [backgroundTheme, setBackgroundTheme] = useState<BackgroundIconTheme>(() => {
    try {
      const savedTheme = localStorage.getItem('countsheet_bg_icon_theme') as BackgroundIconTheme | null;
      if (savedTheme && BACKGROUND_ICON_THEMES.some((t) => t.id === savedTheme)) {
        return savedTheme;
      }
      // Migrate legacy boolean toggle if present
      if (localStorage.getItem('countsheet_bg_icons_enabled') === 'false') {
        return 'minimal_monochrome';
      }
    } catch {
      // ignore storage errors
    }
    return 'default';
  });

  const [seasonalDecorations, setSeasonalDecorations] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('countsheet_seasonal_decorations');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  });

  const [characterDensity, setCharacterDensity] = useState<CharacterDensity>(() => {
    try {
      const saved = localStorage.getItem('countsheet_character_density') as CharacterDensity | null;
      if (saved === 'off' || saved === 'minimal' || saved === 'balanced' || saved === 'playful') {
        return saved;
      }
    } catch {}
    return 'balanced';
  });

  const [characterAnimation, setCharacterAnimation] = useState<boolean>(() => {
    try {
      return localStorage.getItem('countsheet_char_anim') === 'true';
    } catch {}
    return false;
  });

  const [autoSeasonalTheme, setAutoSeasonalTheme] = useState<boolean>(() => {
    try {
      return localStorage.getItem('countsheet_auto_seasonal_theme') === 'true';
    } catch {}
    return false;
  });

  const [motionPreference, setMotionPreference] = useState<MotionPreference>(() => {
    try {
      const saved = localStorage.getItem('countsheet_motion_pref');
      if (saved === 'off' || saved === 'subtle' || saved === 'smooth') {
        return saved;
      }
    } catch {}
    return 'smooth';
  });

  const effectiveBackgroundTheme: BackgroundIconTheme = autoSeasonalTheme
    ? getAutoSeasonalTheme()
    : backgroundTheme;

  const handleSelectBackgroundTheme = (nextTheme: BackgroundIconTheme) => {
    setBackgroundTheme(nextTheme);
    try {
      localStorage.setItem('countsheet_bg_icon_theme', nextTheme);
    } catch {
      // ignore storage errors
    }
  };

  const handleSetSeasonalDecorations = (enabled: boolean) => {
    setSeasonalDecorations(enabled);
    try {
      localStorage.setItem('countsheet_seasonal_decorations', String(enabled));
    } catch {}
  };

  const handleSetCharacterDensity = (density: CharacterDensity) => {
    setCharacterDensity(density);
    try {
      localStorage.setItem('countsheet_character_density', density);
    } catch {}
  };

  const handleSetCharacterAnimation = (enabled: boolean) => {
    setCharacterAnimation(enabled);
    try {
      localStorage.setItem('countsheet_char_anim', String(enabled));
    } catch {}
  };

  const handleSetAutoSeasonalTheme = (enabled: boolean) => {
    setAutoSeasonalTheme(enabled);
    try {
      localStorage.setItem('countsheet_auto_seasonal_theme', String(enabled));
    } catch {}
  };

  const handleSetMotionPreference = (pref: MotionPreference) => {
    setMotionPreference(pref);
    try {
      localStorage.setItem('countsheet_motion_pref', pref);
    } catch {}
  };

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-window-theme', effectiveBackgroundTheme);
      document.body.setAttribute('data-window-theme', effectiveBackgroundTheme);
    } catch {
      // ignore DOM errors
    }
  }, [effectiveBackgroundTheme]);

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-char-anim', characterAnimation ? 'on' : 'off');
    } catch {}
  }, [characterAnimation]);

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-motion', motionPreference);
    } catch {}
  }, [motionPreference]);

  const decorationContextValue = React.useMemo(
    () => ({
      activeTheme: effectiveBackgroundTheme,
      selectedTheme: backgroundTheme,
      seasonalDecorations,
      characterDensity,
      characterAnimation,
      autoSeasonalTheme,
      motionPreference,
      onSetSeasonalDecorations: handleSetSeasonalDecorations,
      onSetCharacterDensity: handleSetCharacterDensity,
      onSetCharacterAnimation: handleSetCharacterAnimation,
      onSetAutoSeasonalTheme: handleSetAutoSeasonalTheme,
      onSetMotionPreference: handleSetMotionPreference,
    }),
    [
      effectiveBackgroundTheme,
      backgroundTheme,
      seasonalDecorations,
      characterDensity,
      characterAnimation,
      autoSeasonalTheme,
      motionPreference,
    ]
  );

  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(() => getStoredOAuthToken());
  const isExplicitGuestUser = Boolean(
    (accessToken && accessToken.startsWith('auditor:')) ||
    (user?.email && user.email.toLowerCase().endsWith('@sidc.local')) ||
    (user?.uid && user.uid.startsWith('auditor-'))
  );
  const effectiveAccessToken = isExplicitGuestUser
    ? accessToken
    : accessToken || getStoredOAuthToken();
  const isGoogleConnected = !isExplicitGuestUser && isGoogleOAuthAccessToken(effectiveAccessToken);

  const [isUserAdmin, setIsUserAdmin] = useState<boolean>(() => {
    return isUserAdminFromLocal(getRememberedUser()?.email);
  });

  const [isAdminMode, setIsAdminMode] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('countsheet_admin_mode') === 'true';
      const initialAdmin = isUserAdminFromLocal(getRememberedUser()?.email);
      return stored && initialAdmin;
    } catch {
      return false;
    }
  });

  // Active navigation tab & visited tabs (keeps views mounted to prevent blank flashes & preserve state)
  // Default to 'inventory' so the whole window contains only the Masterdata by default
  const [currentTab, setCurrentTab] = useState<NavTab>('inventory');
  const [visitedTabs, setVisitedTabs] = useState<Record<NavTab, boolean>>({
    branch: false,
    count: false,
    inventory: true,
    monitoring: false,
    admin: false,
  });

  useEffect(() => {
    setVisitedTabs((prev) => (prev[currentTab] ? prev : { ...prev, [currentTab]: true }));
  }, [currentTab]);

  // Keep active user email strictly synced with auditReportService so Recents & Trash are isolated per account
  useEffect(() => {
    setActiveAuditUserEmail(isGoogleConnected ? user?.email : null);
  }, [user?.email, isGoogleConnected]);

  const handleToggleAdminMode = (enabled: boolean) => {
    if (enabled && !isUserAdmin) {
      setIsAdminMode(false);
      try {
        localStorage.setItem('countsheet_admin_mode', 'false');
      } catch {}
      return;
    }
    setIsAdminMode(enabled);
    if (!enabled && currentTab === 'admin') {
      setCurrentTab('inventory');
    }
    try {
      localStorage.setItem('countsheet_admin_mode', String(enabled));
    } catch {
      // ignore storage errors
    }
  };

  // Check and sync admin privileges when user changes or directory updates
  useEffect(() => {
    const currentEmail = isGoogleConnected ? user?.email : null;
    const localCheck = isUserAdminFromLocal(currentEmail);
    setIsUserAdmin(localCheck);
    if (!localCheck && isAdminMode) {
      setIsAdminMode(false);
      try {
        localStorage.setItem('countsheet_admin_mode', 'false');
      } catch {}
      if (currentTab === 'admin') {
        setCurrentTab('inventory');
      }
    }

    if (currentEmail && isGoogleConnected) {
      verifyUserAdminAccess(currentEmail, effectiveAccessToken).then(({ isAdmin }) => {
        setIsUserAdmin(isAdmin);
        if (!isAdmin && isAdminMode) {
          setIsAdminMode(false);
          try {
            localStorage.setItem('countsheet_admin_mode', 'false');
          } catch {}
          if (currentTab === 'admin') {
            setCurrentTab('inventory');
          }
        }
      });
    }
  }, [user?.email, effectiveAccessToken, isGoogleConnected, isAdminMode, currentTab]);

  useEffect(() => {
    void fetchAdminRoleDefinitionsFromServer().catch(() => {});
    void fetchAdminDirectoryFromServer().catch(() => {});

    const handleRealtimeDataSync = () => {
      void fetchAdminRoleDefinitionsFromServer().catch(() => {});
      void fetchAdminDirectoryFromServer().catch(() => {});
      void syncMasterdataFromServerIfUpdated(null).catch(() => {});
    };

    window.addEventListener(REALTIME_DATA_SYNC_EVENT, handleRealtimeDataSync);
    return () => {
      window.removeEventListener(REALTIME_DATA_SYNC_EVENT, handleRealtimeDataSync);
    };
  }, []);

  useEffect(() => {
    const syncAdminFromDirOrRoles = (updatedDir?: any[]) => {
      const currentEmail = isGoogleConnected ? user?.email : null;
      const adminStatus = isUserAdminFromLocal(currentEmail, updatedDir);
      setIsUserAdmin(adminStatus);
      if (!adminStatus && isAdminMode) {
        setIsAdminMode(false);
        try {
          localStorage.setItem('countsheet_admin_mode', 'false');
        } catch {}
        if (currentTab === 'admin') {
          setCurrentTab('inventory');
        }
      }
    };
    const unsubDir = subscribeToDirectoryUpdates((updatedDir) => {
      syncAdminFromDirOrRoles(updatedDir);
    });
    const unsubRoles = subscribeToRoleDefinitions(() => {
      syncAdminFromDirOrRoles();
    });
    return () => {
      unsubDir();
      unsubRoles();
    };
  }, [user?.email, isGoogleConnected, isAdminMode, currentTab]);

  const [customPhotoURL, setCustomPhotoURLState] = useState<string | null>(() =>
    getCustomPhotoURL(getRememberedUser()?.email)
  );
  const lastLocalPhotoUpdateRef = React.useRef<number>(0);
  const [isAuthInitializing, setIsAuthInitializing] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) {
      const savedForEmail = getCustomPhotoURL(user.email);
      if (savedForEmail !== null) {
        setCustomPhotoURLState(savedForEmail);
      }
    }
  }, [user?.email]);

  const handleUpdatePhoto = (newPhotoURL: string | null) => {
    const storedValue = newPhotoURL === null ? 'NONE' : newPhotoURL;
    lastLocalPhotoUpdateRef.current = Date.now();
    setCustomPhotoURL(storedValue, user?.email);
    setCustomPhotoURLState(storedValue);
    if (user?.email && !user.email.endsWith('@sidc.local')) {
      saveRememberedUser({
        displayName: user.displayName,
        email: user.email,
        photoURL: newPhotoURL,
      });
    }
    syncWorkspaceStateToCloud({ customPhotoURL: storedValue }).catch(() => {});
  };

  const [isCreateAuditReportOpen, setIsCreateAuditReportOpen] = useState(false);
  const [isCreateCountsheetOpen, setIsCreateCountsheetOpen] = useState(false);
  const [isFormsOpen, setIsFormsOpen] = useState(false);
  const [auditReportCountsheetType, setAuditReportCountsheetType] = useState<'random' | null>(null);
  const [auditReportCountsheetSession, setAuditReportCountsheetSession] = useState<RecentCountsheetSession | null>(null);
  const [editingCountsheetSession, setEditingCountsheetSession] = useState<RecentCountsheetSession | null>(null);
  const [isExportedFromCountsheets, setIsExportedFromCountsheets] = useState<boolean>(false);
  const [isCountsheetStandby, setIsCountsheetStandby] = useState<boolean>(false);
  const [countsheetTransitionAnim, setCountsheetTransitionAnim] = useState<'none' | 'slide-out-left' | 'slide-in-left'>('none');
  const [auditReportTransitionAnim, setAuditReportTransitionAnim] = useState<'none' | 'slide-in-right' | 'slide-out-right'>('none');
  const modalTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenCreateAuditReport = (type?: 'random') => {
    if (type === 'random') {
      setEditingCountsheetSession(null);
      setIsCountsheetStandby(false);
      setIsCreateCountsheetOpen(true);
      return;
    }
    setAuditReportCountsheetType(type || null);
    setIsCreateAuditReportOpen(true);
  };

  const handleOpenCreateCountsheets = () => {
    setEditingCountsheetSession(null);
    setIsCountsheetStandby(false);
    setIsCreateCountsheetOpen(true);
  };

  const handleOpenForms = () => {
    setIsFormsOpen(true);
  };

  // Selected Branch & Role
  const [selectedBranch, setSelectedBranch] = useState<SelectedBranch | null>(null);
  const [userRole, setUserRole] = useState<'owner' | 'encoder' | 'unassigned'>('unassigned');

  // Live Presence Tracking: broadcast presence for both Google Accounts and Guest Mode users
  usePresenceHeartbeat({
    user,
    accessToken,
    isGoogleConnected,
    selectedBranch,
    currentTab,
    isUserAdmin,
    customPhotoURL,
  });

  // Unsent items count for badge
  const [countItemTotal, setCountItemTotal] = useState<number>(0);

  // Centralized URL deep link / integration parameters
  const integrationParams = React.useMemo(() => getIntegrationParams(), []);

  // 1. Initialize Firebase Auth & Token Subscription
  useEffect(() => {
    const unsubscribeToken = subscribeToTokenChanges((newToken) => {
      setAccessToken(newToken);
    });

    const unsubscribeAuth = initAuth(
      (authUser, token) => {
        setUser(authUser);
        setAccessToken(token);
        if (isGoogleOAuthAccessToken(token)) {
          saveRememberedUser(authUser);
        }
        setIsAuthInitializing(false);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setIsAuthInitializing(false);
      }
    );

    return () => {
      unsubscribeToken();
      if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
    };
  }, []);

  // 2. Load branch for the active Google account and execute centralized feature routing
  useEffect(() => {
    let isCancelled = false;

    async function initBranchAndFeature() {
      notifyAccountSwitched();
      if (!isGoogleConnected) {
        setSelectedBranch(null);
        setUserRole('unassigned');
        return;
      }
      const currentEmail = user?.email;
      const activeBranchKey = getActiveBranchStorageKey(currentEmail);
      const activeRoleKey = getActiveRoleStorageKey(currentEmail);

      const savedBranchId = localStorage.getItem(activeBranchKey);
      const savedRole = localStorage.getItem(activeRoleKey) as
        | 'owner'
        | 'encoder'
        | 'unassigned'
        | null;

      let resolvedBranch: SelectedBranch | null = null;
      const resolvedRole: 'owner' | 'encoder' | 'unassigned' = savedRole || 'unassigned';

      // Path A: spreadsheetId provided via URL query parameter
      if (integrationParams.spreadsheetId) {
        const found = await getSavedBranch(integrationParams.spreadsheetId);
        if (found) {
          resolvedBranch = found;
        } else {
          resolvedBranch = {
            id: integrationParams.spreadsheetId,
            name: integrationParams.branch || `Branch (${integrationParams.spreadsheetId.slice(0, 8)}...)`,
            encodingCount: 0,
            masterdataCount: 0,
          };
        }
        localStorage.setItem(activeBranchKey, resolvedBranch.id);
      }
      // Path B: branch name/keyword provided via URL query parameter without spreadsheetId
      else if (integrationParams.branch) {
        const allSaved = await getAllSavedBranches();
        const targetQuery = integrationParams.branch.trim().toLowerCase();
        const match = allSaved.find(
          (b) =>
            b.name.trim().toLowerCase() === targetQuery ||
            b.name.trim().toLowerCase().includes(targetQuery)
        );
        if (match) {
          resolvedBranch = match;
          localStorage.setItem(activeBranchKey, match.id);
        } else if (savedBranchId) {
          const saved = await getSavedBranch(savedBranchId);
          if (saved) resolvedBranch = saved;
        }
      }
      // Path C: Standard launch or account switch - load active branch for this account only
      else if (savedBranchId) {
        const saved = await getSavedBranch(savedBranchId);
        if (saved) resolvedBranch = saved;
      }

      if (isCancelled) return;

      if (resolvedBranch) {
        setSelectedBranch(resolvedBranch);
        setUserRole(resolvedRole);
      } else {
        setSelectedBranch(null);
        setUserRole('unassigned');
      }

      // Centralized feature routing on initial launch
      if (integrationParams.feature) {
        const { tab, openAuditModal } = resolveFeatureNavigation(
          integrationParams.feature,
          Boolean(resolvedBranch)
        );

        setCurrentTab(tab);
        if (openAuditModal) {
          setIsCreateAuditReportOpen(true);
        }
      }
    }

    initBranchAndFeature();

    return () => {
      isCancelled = true;
    };
  }, [integrationParams, user?.email, isGoogleConnected]);

  // 2b. Real-Time Cross-Device Workspace Sync (Active Branch, Role, Saved Branches, Custom Photo, OAuth Token)
  useEffect(() => {
    if (!user) return;
    const unsubscribeWorkspace = subscribeToWorkspaceState(async (remoteState) => {
      if (
        remoteState.customPhotoURL !== undefined &&
        Date.now() - lastLocalPhotoUpdateRef.current > 15000
      ) {
        setCustomPhotoURL(remoteState.customPhotoURL, user?.email);
        setCustomPhotoURLState(remoteState.customPhotoURL);
      }

      if (
        remoteState.oauthAccessToken &&
        isGoogleOAuthAccessToken(remoteState.oauthAccessToken)
      ) {
        const currentStored = getStoredOAuthToken();
        if (currentStored) {
          setAccessToken(currentStored);
        }
      }

      if (remoteState.selectedBranch && remoteState.selectedBranch.id) {
        const incomingBranch = remoteState.selectedBranch;
        const incomingRole = remoteState.userRole || 'unassigned';
        const activeBranchKey = getActiveBranchStorageKey(user?.email);
        const activeRoleKey = getActiveRoleStorageKey(user?.email);

        await saveBranchMetadataLocalOnly(incomingBranch);

        setSelectedBranch((prev) => {
          if (
            !prev ||
            prev.id !== incomingBranch.id ||
            (incomingBranch.lastSyncedAt && incomingBranch.lastSyncedAt !== prev.lastSyncedAt) ||
            (incomingBranch.encodingCount || 0) > (prev.encodingCount || 0) ||
            (incomingBranch.masterdataCount || 0) > (prev.masterdataCount || 0)
          ) {
            localStorage.setItem(activeBranchKey, incomingBranch.id);
            return incomingBranch;
          }
          return prev;
        });

        if (remoteState.userRole) {
          setUserRole((prevRole) => {
            if (prevRole !== incomingRole) {
              localStorage.setItem(activeRoleKey, incomingRole);
              return incomingRole;
            }
            return prevRole;
          });
        }

        // Automatically hydrate branch inventory items on this device if synced on another device
        const hydrated = await ensureBranchInventoryHydrated(incomingBranch);
        if (hydrated) {
          const refreshed = await getSavedBranch(incomingBranch.id);
          if (refreshed) {
            setSelectedBranch(refreshed);
          }
        }
      }
    });

    // Periodic check for cross-device OAuth token updates (only when already connected to Google)
    const tokenSyncTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && isGoogleConnected) {
        syncOAuthTokenFromCloud()
          .then((cloudToken) => {
            if (cloudToken && isGoogleOAuthAccessToken(cloudToken)) {
              setAccessToken(cloudToken);
            }
          })
          .catch(() => {});
      }
    }, 60000);

    return () => {
      unsubscribeWorkspace();
      window.clearInterval(tokenSyncTimer);
    };
  }, [user?.uid, user?.email, isGoogleConnected]);

  // 2c. Keep active branch inventory hydrated and live countsheet badge synced across devices
  useEffect(() => {
    if (!selectedBranch?.id) {
      setCountItemTotal(0);
      return;
    }

    ensureBranchInventoryHydrated(selectedBranch).then(async (hydrated) => {
      if (hydrated) {
        const refreshed = await getSavedBranch(selectedBranch.id);
        if (refreshed) {
          setSelectedBranch(refreshed);
        }
      }
    });

    const unsubCs = subscribeToBranchCountsheets(selectedBranch.id, (list) => {
      const totalItems = list.reduce((acc, cs) => acc + (cs.items?.length || 0), 0);
      setCountItemTotal(totalItems);
    });

    return () => {
      unsubCs();
    };
  }, [selectedBranch?.id]);

  // 2d. Proactively sync Masterdata from server on app boot and listen for updates
  useEffect(() => {
    if (isOnline) {
      void syncMasterdataFromServerIfUpdated(selectedBranch || null).then((res) => {
        if (res.updated && res.updatedBranch) {
          setSelectedBranch(res.updatedBranch);
        }
      });
    }

    const onMasterdataUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{ count?: number }>;
      const newCount = customEvent.detail?.count;
      if (typeof newCount === 'number' && newCount > 0) {
        setSelectedBranch((prev) =>
          prev && prev.masterdataCount !== newCount
            ? { ...prev, masterdataCount: newCount }
            : prev
        );
      }
    };

    window.addEventListener('masterdata-updated', onMasterdataUpdated);
    return () => {
      window.removeEventListener('masterdata-updated', onMasterdataUpdated);
    };
  }, [isOnline]);

  // 3. Google Sign-In Handler
  const handleSignIn = async (options?: SignInOptions | boolean) => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn(options);
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        saveRememberedUser(result.user);
        void syncMasterdataFromServerIfUpdated(selectedBranch || null);
      }
    } catch (err: any) {
      console.warn('Google sign-in attempt notice:', err?.message || err);
      setAuthError(err.message || 'Google Sign-In failed. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  // 3a. Continue Handler for Remembered User (Connects Google Drive immediately if token is not fresh)
  const handleInstantContinue = async (remembered?: RememberedUser | null) => {
    setAuthError(null);
    // 1. If we already have a verified fresh Google OAuth token locally, enter immediately
    if (isStoredTokenFresh()) {
      const result = instantContinueSignIn(remembered);
      setUser(result.user);
      setAccessToken(result.accessToken);
      void syncMasterdataFromServerIfUpdated(selectedBranch || null);
      return;
    }

    // 2. Otherwise sign in directly with Google OAuth (with loginHint) so Google Drive is connected from the start
    await handleSignIn({
      loginHint: remembered?.email || undefined,
      forceSelectAccount: false,
    });
  };

  // 3b. Auditor Direct Sign-In Handler (Instant Field/Offline Mode)
  const handleAuditorSignIn = (name: string, email?: string) => {
    const cleanName = (name || '').trim();
    if (!cleanName || cleanName.toLowerCase() === 'guest') {
      setAuthError('Name is required to enter Guest Mode.');
      return;
    }
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = directAuditorSignIn(cleanName, email);
      setSelectedBranch(null);
      setUserRole('unassigned');
      setIsUserAdmin(false);
      setIsAdminMode(false);
      setUser(result.user);
      setAccessToken(result.accessToken);
      registerImmediateGuestPresence(
        result.user.displayName || cleanName,
        result.user.email || email
      );
      void syncMasterdataFromServerIfUpdated(null);
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to start auditor session.');
    } finally {
      setIsSigningIn(false);
    }
  };

  // 4. Switch Google Account Handler
  const handleSwitchEmail = async () => {
    try {
      await logout(true);
      setSelectedBranch(null);
      setUserRole('unassigned');
      handleSignIn(true);
    } catch (err: any) {
      console.warn('Error switching email:', err);
    }
  };

  // 5. Sign Out Handler (preserves remembered user profile for SignInView, clears active session & branch)
  const handleSignOut = async () => {
    try {
      await logout(false);
      setSelectedBranch(null);
      setUserRole('unassigned');
      setUser(null);
      setAccessToken(null);
    } catch (err: any) {
      console.warn('Error signing out:', err);
    }
  };

  // 6. Select Branch Handler (syncs active branch & role for this Google account)
  const handleSelectBranch = async (
    branch: SelectedBranch,
    role: 'owner' | 'encoder' | 'unassigned'
  ) => {
    const activeBranchKey = getActiveBranchStorageKey(user?.email);
    const activeRoleKey = getActiveRoleStorageKey(user?.email);
    setSelectedBranch(branch);
    setUserRole(role);
    if (branch) {
      localStorage.setItem(activeBranchKey, branch.id);
      localStorage.setItem(activeRoleKey, role);
      await saveBranchMetadataLocalOnly(branch);
      const allSaved = await getAllSavedBranches();
      syncWorkspaceStateToCloud({
        selectedBranch: branch,
        userRole: role,
        savedBranches: allSaved,
      }).catch(() => {});
    } else {
      localStorage.removeItem(activeBranchKey);
      localStorage.removeItem(activeRoleKey);
      const allSaved = await getAllSavedBranches();
      syncWorkspaceStateToCloud({
        selectedBranch: null,
        userRole: 'unassigned',
        savedBranches: allSaved,
      }).catch(() => {});
    }
  };

  // Loading state
  if (isAuthInitializing) {
    return (
      <div className={`min-h-screen relative flex flex-col items-center justify-center p-6 select-none transition-colors duration-350 ease-in-out ${
        theme === 'dark' ? 'bg-[#121214] text-white dark' : 'bg-slate-50 text-slate-900'
      }`}>
        <TelegramDoodleBackground
          themeId={effectiveBackgroundTheme}
          seasonalDecorations={seasonalDecorations}
          characterDensity={characterDensity}
        />
        <div className="relative z-10 flex flex-col items-center">
          <div className="relative mb-5">
            <div className="w-16 h-16 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center shadow-lg p-2.5 shrink-0">
              <img src="/icd-logo.svg" alt="ICD Logo" width="44" height="44" className="w-full h-full object-contain aspect-square shrink-0" />
            </div>
            <div className="absolute -inset-1 rounded-2xl border-2 border-zinc-400/30 animate-ping opacity-25" />
          </div>
          <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight mb-1">
            Inventory Hub
          </h2>
          <div className="flex items-center gap-2 mt-2.5">
            <div className="w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-500 dark:text-zinc-400 font-semibold tracking-wide">{t.loadingHub}</p>
          </div>
        </div>
      </div>
    );
  }

  const hasValidGuestName =
    !isExplicitGuestUser ||
    Boolean(
      user?.displayName &&
        user.displayName.trim().length > 0 &&
        user.displayName.trim().toLowerCase() !== 'guest'
    );

  // Not signed in (or Guest Mode without a valid name): Show SignInView
  if (!user || !accessToken || !hasValidGuestName) {
    return (
      <DecorationProvider value={decorationContextValue}>
        <SignInView
          onSignIn={handleSignIn}
          onInstantContinue={handleInstantContinue}
          onAuditorSignIn={handleAuditorSignIn}
          isLoading={isSigningIn}
          error={authError}
          onClearError={() => setAuthError(null)}
          onCancelSignIn={() => setIsSigningIn(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
          backgroundTheme={effectiveBackgroundTheme}
        />
      </DecorationProvider>
    );
  }

  return (
    <DecorationProvider value={decorationContextValue}>
      <div
        id="app-root-container"
        data-window-theme={effectiveBackgroundTheme}
        className={`min-h-screen min-h-[100dvh] relative flex flex-col antialiased transition-colors duration-350 ease-in-out ${
          theme === 'dark' ? 'bg-slate-950 text-zinc-100 dark' : 'bg-slate-50 text-slate-900'
        }`}
      >
        {/* Background icons pattern */}
        <TelegramDoodleBackground
          themeId={effectiveBackgroundTheme}
          seasonalDecorations={seasonalDecorations}
          characterDensity={characterDensity}
        />

        {/* Top Header with Hamburger Menu and Desktop Navigation */}
        <TopHeader
          branch={selectedBranch}
          userRole={userRole}
          onOpenBranchModal={() => setCurrentTab('branch')}
          userEmail={user?.email}
          userName={user?.displayName}
          userPhoto={
            customPhotoURL === 'NONE'
              ? null
              : customPhotoURL || user?.photoURL || null
          }
          googlePhoto={user?.photoURL || null}
          onUpdatePhoto={handleUpdatePhoto}
          onSignOut={handleSignOut}
          onSwitchEmail={handleSwitchEmail}
          isGoogleConnected={isGoogleConnected}
          onConnectGoogle={() => handleSignIn({ forceSelectAccount: true })}
          theme={theme}
          appearanceMode={appearanceMode}
          onSetAppearanceMode={setAppearanceMode}
          onToggleTheme={toggleTheme}
          onOpenCreateAuditReport={handleOpenCreateAuditReport}
          onOpenCreateCountsheets={handleOpenCreateCountsheets}
          onOpenForms={handleOpenForms}
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          countItemTotal={countItemTotal}
          backgroundTheme={effectiveBackgroundTheme}
          onSelectBackgroundTheme={handleSelectBackgroundTheme}
          isAdminMode={isAdminMode}
          isUserAdmin={isUserAdmin}
          onToggleAdminMode={handleToggleAdminMode}
        />

      {/* Random Inventory Countsheet Modal (IATD Driven with Item Description, Cat, SubCat, SubSubCat filters) */}
      {isCreateCountsheetOpen && (
        <CreateRandomCountsheetModal
          isOpen={isCreateCountsheetOpen}
          initialSession={editingCountsheetSession}
          transitionAnim={countsheetTransitionAnim}
          isStandby={isCountsheetStandby}
          onClose={() => {
            if (modalTransitionTimerRef.current) {
              clearTimeout(modalTransitionTimerRef.current);
              modalTransitionTimerRef.current = null;
            }
            setIsCreateCountsheetOpen(false);
            setIsCountsheetStandby(false);
            setEditingCountsheetSession(null);
            setCountsheetTransitionAnim('none');
          }}
          onExportToEncoding={(session) => {
            if (modalTransitionTimerRef.current) {
              clearTimeout(modalTransitionTimerRef.current);
            }
            setAuditReportCountsheetSession(session);
            setIsExportedFromCountsheets(true);
            setIsCountsheetStandby(false);

            // Animate Editing Countsheet out to the left and Export to Encoding in from the right
            setCountsheetTransitionAnim('slide-out-left');
            setAuditReportTransitionAnim('slide-in-right');
            setIsCreateAuditReportOpen(true);

            modalTransitionTimerRef.current = setTimeout(() => {
              setIsCountsheetStandby(true);
              setCountsheetTransitionAnim('none');
              setAuditReportTransitionAnim('none');
              modalTransitionTimerRef.current = null;
            }, 420);
          }}
          accessToken={effectiveAccessToken}
          isGoogleConnected={isGoogleConnected}
          onConnectGoogle={() => handleSignIn({ forceSelectAccount: true })}
          onTokenRefreshed={(newToken: string) => setAccessToken(newToken)}
          userEmail={user?.email}
          userName={user?.displayName}
        />
      )}

      {/* Google Drive PDF Forms Modal (Preview & Print) */}
      {isFormsOpen && (
        <FormsModal
          isOpen={isFormsOpen}
          onClose={() => setIsFormsOpen(false)}
          accessToken={effectiveAccessToken}
          onTokenRefreshed={(newToken: string) => setAccessToken(newToken)}
        />
      )}

      {/* Create Audit Report Modal (IATD -> ENCODING Mapper) */}
      <CreateAuditReportModal
        isOpen={isCreateAuditReportOpen}
        transitionAnim={auditReportTransitionAnim}
        isTransparentBackdrop={auditReportTransitionAnim !== 'none'}
        onClose={() => {
          if (modalTransitionTimerRef.current) {
            clearTimeout(modalTransitionTimerRef.current);
            modalTransitionTimerRef.current = null;
          }
          setIsCreateAuditReportOpen(false);
          setIsCreateCountsheetOpen(false);
          setIsCountsheetStandby(false);
          setAuditReportCountsheetType(null);
          setAuditReportCountsheetSession(null);
          setIsExportedFromCountsheets(false);
          setEditingCountsheetSession(null);
          setAuditReportTransitionAnim('none');
          setCountsheetTransitionAnim('none');
        }}
        onBackToCountsheet={(updatedSession) => {
          if (modalTransitionTimerRef.current) {
            clearTimeout(modalTransitionTimerRef.current);
          }
          if (updatedSession) {
            setEditingCountsheetSession(updatedSession);
            setAuditReportCountsheetSession(updatedSession);
          }
          // Unhide Editing Countsheet (already mounted on FILTER_ITEMS) and animate back in from the left
          setIsCountsheetStandby(false);
          setIsCreateCountsheetOpen(true);
          setCountsheetTransitionAnim('slide-in-left');
          setAuditReportTransitionAnim('slide-out-right');

          modalTransitionTimerRef.current = setTimeout(() => {
            setIsCreateAuditReportOpen(false);
            setAuditReportCountsheetSession(null);
            setIsExportedFromCountsheets(false);
            setCountsheetTransitionAnim('none');
            setAuditReportTransitionAnim('none');
            modalTransitionTimerRef.current = null;
          }, 420);
        }}
        onSaveCountsheetSession={(updatedSession) => {
          setEditingCountsheetSession(updatedSession);
          setAuditReportCountsheetSession(updatedSession);
        }}
        isFromCountsheetExport={isExportedFromCountsheets}
        accessToken={effectiveAccessToken}
        isGoogleConnected={isGoogleConnected}
        onConnectGoogle={() => handleSignIn({ forceSelectAccount: true })}
        activeBranch={selectedBranch}
        initialCountsheetType={auditReportCountsheetType}
        initialCountsheetSession={auditReportCountsheetSession}
        onTokenRefreshed={(newToken) => setAccessToken(newToken)}
        userEmail={user?.email}
        userName={user?.displayName}
        onBranchCreatedOrUpdated={(branchId, branchName) => {
          handleSelectBranch(
            {
              id: branchId,
              name: branchName,
              encodingCount: 0,
              masterdataCount: 0,
            },
            'owner'
          );
          setCurrentTab('branch');
        }}
      />

      {/* Offline notification banner */}
      {!isOnline && (
        <div className="bg-slate-900 dark:bg-zinc-800 text-white dark:text-zinc-100 border-b border-slate-700/80 px-3 py-1.5 text-center text-xs font-medium flex items-center justify-center gap-2 shadow-xs sticky top-[49px] z-30">
          <WifiOff className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{t.offlineBanner}</span>
        </div>
      )}

      {/* Main Content Area (Inventory Masterdatafills the whole window by default;
          Inventory Count [Branch, Count, Monitoring] is opened from the Hamburger menu) */}
      <main id="app-main-content" className="relative z-10 flex-1 w-full max-w-[1560px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-16 py-4 sm:py-6 pb-[calc(7.5rem+env(safe-area-inset-bottom,16px))] md:pb-8">
        {(currentTab === 'branch' || currentTab === 'count' || currentTab === 'monitoring') && (
          <div className="mb-4 rounded-2xl p-3 sm:p-3.5 border bg-white/95 dark:bg-zinc-900/90 border-sky-300/80 dark:border-sky-700/60 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <ClipboardList className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-zinc-100">
                    Inventory Count
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-700/60">
                    {currentTab === 'branch' ? t.navBranch : currentTab === 'count' ? t.navCount : t.navMonitoring}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                  Branch selection, Countsheet workspace &amp; live Monitoring
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="grid grid-cols-3 gap-1.5 sm:flex sm:items-center sm:gap-1.5 bg-slate-100/90 dark:bg-zinc-950/80 p-1 rounded-xl border border-slate-200/80 dark:border-zinc-800 flex-1 sm:flex-initial">
                <button
                  type="button"
                  onClick={() => setCurrentTab('branch')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    currentTab === 'branch'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'text-slate-700 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800/90 hover:text-sky-600 dark:hover:text-sky-400'
                  }`}
                >
                  <Store className="w-3.5 h-3.5 shrink-0" />
                  <span>{t.navBranch}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentTab('count')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    currentTab === 'count'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'text-slate-700 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800/90 hover:text-sky-600 dark:hover:text-sky-400'
                  }`}
                >
                  <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                  <span>{t.navCount}</span>
                  {countItemTotal !== null && countItemTotal > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                        currentTab === 'count'
                          ? 'bg-white/25 text-white'
                          : 'bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300'
                      }`}
                    >
                      {countItemTotal > 999 ? '999+' : countItemTotal}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentTab('monitoring')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    currentTab === 'monitoring'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'text-slate-700 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800/90 hover:text-sky-600 dark:hover:text-sky-400'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5 shrink-0" />
                  <span>{t.navMonitoring}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setCurrentTab('inventory')}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs transition cursor-pointer shrink-0"
              >
                <PackageSearch className="w-3.5 h-3.5 shrink-0" />
                <span>Back to Masterdata</span>
              </button>
            </div>
          </div>
        )}

        {visitedTabs.branch && (
          <div
            className={currentTab === 'branch' ? 'ui-page-transition w-full' : 'hidden'}
            aria-hidden={currentTab !== 'branch'}
          >
            <BranchView
              userEmail={user?.email}
              userName={user?.displayName}
              accessToken={effectiveAccessToken}
              isGoogleConnected={isGoogleConnected}
              onConnectGoogle={() => handleSignIn({ forceSelectAccount: true })}
              selectedBranch={selectedBranch}
              userRole={userRole}
              onSelectBranch={handleSelectBranch}
              onDisconnect={handleSignOut}
              onNavigateToCount={() => setCurrentTab('count')}
              onNavigateToMasterdata={() => setCurrentTab('inventory')}
              initialSearchQuery={integrationParams.branch || ''}
              initialSpreadsheetId={integrationParams.spreadsheetId || ''}
              onTokenRefreshed={(newToken) => setAccessToken(newToken)}
              onOpenCreateAuditReport={handleOpenCreateAuditReport}
              onOpenCreateCountsheets={handleOpenCreateCountsheets}
              onOpenForms={handleOpenForms}
              isAdminMode={isAdminMode}
            />
          </div>
        )}

        {visitedTabs.count && (
          <div
            className={currentTab === 'count' ? 'ui-page-transition w-full' : 'hidden'}
            aria-hidden={currentTab !== 'count'}
          >
            <CountView
              branch={selectedBranch}
              userRole={userRole}
              userName={user?.displayName}
              userEmail={user?.email}
              accessToken={effectiveAccessToken}
              isGoogleConnected={isGoogleConnected}
              onConnectGoogle={() => handleSignIn({ forceSelectAccount: true })}
              onOpenBranchTab={() => setCurrentTab('branch')}
              onCountItemTotalChange={setCountItemTotal}
              isAdminMode={isAdminMode}
            />
          </div>
        )}

        {visitedTabs.inventory && (
          <div
            className={currentTab === 'inventory' ? 'ui-page-transition w-full' : 'hidden'}
            aria-hidden={currentTab !== 'inventory'}
          >
            <InventoryView
              branch={selectedBranch}
              userName={user?.displayName}
              userEmail={user?.email}
              accessToken={effectiveAccessToken}
              isGoogleConnected={isGoogleConnected}
              onConnectGoogle={() => handleSignIn({ forceSelectAccount: true })}
              onUpdateBranch={(updatedBranch) => setSelectedBranch(updatedBranch)}
              onTokenRefreshed={(newToken) => setAccessToken(newToken)}
              onOpenBranchTab={() => setCurrentTab('branch')}
              onNavigateToCount={() => setCurrentTab('count')}
              isAdminMode={isAdminMode}
            />
          </div>
        )}

        {visitedTabs.monitoring && (
          <div
            className={currentTab === 'monitoring' ? 'ui-page-transition w-full' : 'hidden'}
            aria-hidden={currentTab !== 'monitoring'}
          >
            <MonitoringView
              branch={selectedBranch}
              userName={user?.displayName}
              userEmail={user?.email}
              accessToken={effectiveAccessToken}
              isGoogleConnected={isGoogleConnected}
              onConnectGoogle={() => handleSignIn({ forceSelectAccount: true })}
              onOpenBranchTab={() => setCurrentTab('branch')}
            />
          </div>
        )}

        {visitedTabs.admin && isAdminMode && isUserAdmin && (
          <div
            className={currentTab === 'admin' ? 'ui-page-transition w-full' : 'hidden'}
            aria-hidden={currentTab !== 'admin'}
          >
            <AdminView
              branch={selectedBranch}
              userName={user?.displayName}
              userEmail={user?.email}
              accessToken={effectiveAccessToken}
              isUserAdmin={isUserAdmin}
              onOpenBranchTab={() => setCurrentTab('branch')}
              onOpenMonitoringTab={() => setCurrentTab('monitoring')}
              onExitAdminMode={() => handleToggleAdminMode(false)}
            />
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation (only shown when inside Inventory Count or Admin views so Masterdata owns the whole window) */}
      {currentTab !== 'inventory' && (
        <BottomNav
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          countItemTotal={countItemTotal}
          isAdminMode={isAdminMode}
          isUserAdmin={isUserAdmin}
        />
      )}
      </div>
    </DecorationProvider>
  );
}
