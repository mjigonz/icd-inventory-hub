/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, saveRememberedUser, getCustomPhotoURL, setCustomPhotoURL, SignInOptions } from './services/auth';
import { TopHeader } from './components/TopHeader';
import { BottomNav, NavTab } from './components/BottomNav';
import { CreateAuditReportModal } from './components/CreateAuditReportModal';
import { SignInView } from './views/SignInView';
import { BranchView } from './views/BranchView';
import { CountView } from './views/CountView';
import { InventoryView } from './views/InventoryView';
import { MonitoringView } from './views/MonitoringView';
import { SelectedBranch } from './types';
import { getSavedBranch } from './services/db';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useTheme } from './hooks/useTheme';
import { WifiOff } from 'lucide-react';

export default function App() {
  const isOnline = useOnlineStatus();
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [customPhotoURL, setCustomPhotoURLState] = useState<string | null>(() => getCustomPhotoURL());
  const [isAuthInitializing, setIsAuthInitializing] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleUpdatePhoto = (newPhotoURL: string | null) => {
    setCustomPhotoURL(newPhotoURL);
    setCustomPhotoURLState(newPhotoURL);
  };

  // Active navigation tab
  const [currentTab, setCurrentTab] = useState<NavTab>('branch');
  const [isCreateAuditReportOpen, setIsCreateAuditReportOpen] = useState(false);

  // Selected Branch & Role
  const [selectedBranch, setSelectedBranch] = useState<SelectedBranch | null>(null);
  const [userRole, setUserRole] = useState<'owner' | 'encoder' | 'unassigned'>('unassigned');

  // Unsent items count for badge
  const [countItemTotal, setCountItemTotal] = useState<number>(0);

  // 1. Initialize Firebase Auth
  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser, token) => {
        setUser(authUser);
        setAccessToken(token);
        saveRememberedUser(authUser);
        setIsAuthInitializing(false);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setIsAuthInitializing(false);
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // 2. Load last selected branch from local storage on launch
  useEffect(() => {
    const savedBranchId = localStorage.getItem('countsheet_active_branch_id');
    const savedRole = localStorage.getItem('countsheet_active_role') as
      | 'owner'
      | 'encoder'
      | 'unassigned'
      | null;

    if (savedBranchId) {
      getSavedBranch(savedBranchId).then((b) => {
        if (b) {
          setSelectedBranch(b);
          if (savedRole) setUserRole(savedRole);
          // Default to count tab if a branch is already active
          setCurrentTab('count');
        }
      });
    }
  }, []);

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
      }
    } catch (err: any) {
      console.warn('Google sign-in attempt notice:', err?.message || err);
      setAuthError(err.message || 'Google Sign-In failed. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  // 4. Switch Google Account Handler
  const handleSwitchEmail = async () => {
    try {
      await logout();
      handleSignIn(true);
    } catch (err: any) {
      console.warn('Error switching email:', err);
    }
  };

  // 5. Sign Out Handler (preserves remembered user profile for "Continue as <Name>")
  const handleSignOut = async () => {
    try {
      await logout(false);
      setUser(null);
      setAccessToken(null);
    } catch (err: any) {
      console.warn('Error signing out:', err);
    }
  };

  // 6. Select Branch Handler
  const handleSelectBranch = (
    branch: SelectedBranch,
    role: 'owner' | 'encoder' | 'unassigned'
  ) => {
    setSelectedBranch(branch);
    setUserRole(role);
    localStorage.setItem('countsheet_active_branch_id', branch.id);
    localStorage.setItem('countsheet_active_role', role);
  };

  // Loading state
  if (isAuthInitializing) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-6 select-none transition-colors ${
        theme === 'dark' ? 'bg-[#121214] text-white dark' : 'bg-slate-50 text-slate-900'
      }`}>
        <div className="relative mb-5">
          <div className="w-16 h-16 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center shadow-lg p-2.5">
            <img src="/icd-logo.svg" alt="ICD Logo" className="w-full h-full object-contain" />
          </div>
          <div className="absolute -inset-1 rounded-2xl border-2 border-zinc-400/30 animate-ping opacity-25" />
        </div>
        <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight mb-1">
          Inventory Hub
        </h2>
        <div className="flex items-center gap-2 mt-2.5">
          <div className="w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-semibold tracking-wide">Loading Inventory Hub...</p>
        </div>
      </div>
    );
  }

  // Not signed in: Show SignInView (Supports "Continue as <Name>" for 2nd time users)
  if (!user || !accessToken) {
    return (
      <SignInView
        onSignIn={handleSignIn}
        isLoading={isSigningIn}
        error={authError}
        onCancelSignIn={() => setIsSigningIn(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return (
    <div
      id="app-root-container"
      className={`min-h-screen flex flex-col select-none antialiased transition-colors ${
        theme === 'dark' ? 'bg-[#121214] text-zinc-100 dark' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top Header with Hamburger Menu (Theme, Change Photo, Switch Email, and Log out) */}
      <TopHeader
        branch={selectedBranch}
        userRole={userRole}
        onOpenBranchModal={() => setCurrentTab('branch')}
        userEmail={user.email}
        userName={user.displayName}
        userPhoto={customPhotoURL || user.photoURL || null}
        googlePhoto={user.photoURL || null}
        onUpdatePhoto={handleUpdatePhoto}
        onSignOut={handleSignOut}
        onSwitchEmail={handleSwitchEmail}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenCreateAuditReport={() => setIsCreateAuditReportOpen(true)}
      />

      {/* Create Audit Report Modal (IATD -> ENCODING Mapper) */}
      <CreateAuditReportModal
        isOpen={isCreateAuditReportOpen}
        onClose={() => setIsCreateAuditReportOpen(false)}
        accessToken={accessToken}
        activeBranch={selectedBranch}
        onTokenRefreshed={(newToken) => setAccessToken(newToken)}
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
        <div className="bg-amber-500 text-slate-950 px-3 py-1 text-center text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs sticky top-[49px] z-30">
          <WifiOff className="w-3.5 h-3.5 text-slate-950" />
          <span>Offline Mode — All counts and searches operate from cached data</span>
        </div>
      )}

      {/* Main Content Area (Branch, Count, Inventory, and Monitoring) */}
      <main id="app-main-content" className="flex-1 w-full max-w-md mx-auto transition-all duration-300">
        <div key={currentTab} className="animate-slide-up-fade-in w-full">
          {currentTab === 'branch' && (
            <BranchView
              userEmail={user.email}
              userName={user.displayName}
              accessToken={accessToken}
              selectedBranch={selectedBranch}
              userRole={userRole}
              onSelectBranch={handleSelectBranch}
              onDisconnect={handleSignOut}
              onNavigateToCount={() => setCurrentTab('count')}
            />
          )}

          {currentTab === 'count' && (
            <CountView
              branch={selectedBranch}
              userRole={userRole}
              userName={user.displayName}
              userEmail={user.email}
              accessToken={accessToken}
              onOpenBranchTab={() => setCurrentTab('branch')}
              onCountItemTotalChange={setCountItemTotal}
            />
          )}

          {currentTab === 'inventory' && (
            <InventoryView
              branch={selectedBranch}
              userName={user.displayName}
              userEmail={user.email}
              onOpenBranchTab={() => setCurrentTab('branch')}
              onNavigateToCount={() => setCurrentTab('count')}
            />
          )}

          {currentTab === 'monitoring' && (
            <MonitoringView
              branch={selectedBranch}
              userName={user.displayName}
              userEmail={user.email}
              accessToken={accessToken}
              onOpenBranchTab={() => setCurrentTab('branch')}
            />
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <BottomNav
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        countItemTotal={countItemTotal}
      />
    </div>
  );
}
