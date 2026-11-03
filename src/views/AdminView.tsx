import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  Mail,
  Send,
  Trash2,
  Search,
  Copy,
  Check,
  Users,
  Radio,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Building2,
  ClipboardList,
  CheckCircle2,
  Clock,
  Plus,
  FolderOpen,
  FileSpreadsheet,
  FileText,
  Link2,
  Save,
  RotateCcw,
  User,
  Activity,
  LogOut,
  X,
  Settings,
  Edit3,
  Lock,
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import { PanelDecoration } from '../components/PanelDecoration';
import { SelectedBranch, MonitoringBlock } from '../types';
import { getBranchMonitoringBlocks } from '../services/db';
import {
  broadcastDirectoryUpdate,
  AdminRoleDefinition,
  RolePermissionKey,
  RoleBadgeColor,
  ROLE_PERMISSION_CATALOG,
  DEFAULT_ROLE_DEFINITIONS,
  getAdminRoleDefinitions,
  saveAdminRoleDefinitions,
  fetchAdminRoleDefinitionsFromServer,
  subscribeToRoleDefinitions,
  getRoleDefinitionById,
  getRoleBadgeClasses,
  doesRoleHavePermission,
} from '../services/adminService';
import {
  getAdminDriveLinksConfig,
  saveAdminDriveLinksConfig,
  fetchHubTemplatesFromServer,
  extractDriveResourceFromLink,
  subscribeToAdminDriveLinks,
} from '../services/auditReportService';
import { NotifyWebsiteUpdateAvailable } from '../hooks/useAppUpdate';
import { PresenceStats, fetchOnlinePresence, PRESENCE_UPDATED_EVENT } from '../services/presenceService';

export interface AdminDirectoryEntry {
  id: string;
  email: string;
  name: string;
  role: string;
  branchName: string;
  status: 'active' | 'on_field' | 'standby';
  createdAt: string;
}

export interface AdminDispatchMessage {
  id: string;
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  message: string;
  priority: 'normal' | 'important' | 'urgent';
  branchName: string;
  csRange: string;
  status: 'sent' | 'acknowledged';
  createdAt: string;
}

interface AdminViewProps {
  branch: SelectedBranch | null;
  userName: string | null;
  userEmail: string | null;
  accessToken?: string | null;
  isUserAdmin?: boolean;
  onOpenBranchTab: () => void;
  onOpenMonitoringTab: () => void;
  onExitAdminMode?: () => void;
}

const LOCAL_DIR_KEY = 'countsheet_admin_directory_v1';
const LOCAL_MSG_KEY = 'countsheet_admin_messages_v1';

const DEFAULT_DIRECTORY: AdminDirectoryEntry[] = [
  {
    id: 'dir_icdhubsystems@gmail.com',
    email: 'icdhubsystems@gmail.com',
    name: 'ICD Hub Systems',
    role: 'internal_compliance_manager',
    branchName: 'All Branches',
    status: 'active',
    createdAt: new Date().toISOString(),
  },
];

export const AdminView: React.FC<AdminViewProps> = ({
  branch,
  userName,
  userEmail,
  accessToken,
  isUserAdmin,
  onOpenBranchTab,
  onOpenMonitoringTab,
  onExitAdminMode,
}) => {
  // Access check guard
  if (isUserAdmin === false) {
    return (
      <div className="w-full max-w-lg mx-auto my-12 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-4 shadow-xs">
        <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Admin Access Restricted</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Your signed-in account (<strong className="font-mono text-slate-800 dark:text-slate-200">{userEmail || 'Guest'}</strong>) does not have Admin Console access. The Admin Console is strictly accessible only for <strong className="font-mono text-slate-800 dark:text-slate-200">icdhubsystems@gmail.com</strong>.
        </p>
        <button
          type="button"
          onClick={onOpenBranchTab}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-2xs cursor-pointer"
        >
          Return to Branch View
        </button>
      </div>
    );
  }

  // Directory State
  const [directory, setDirectory] = useState<AdminDirectoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_DIR_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_DIRECTORY;
  });

  // Add Email / Auditor Form State
  const [inputEmail, setInputEmail] = useState('');
  const [inputName, setInputName] = useState('');
  const [inputRole, setInputRole] = useState<string>('internal_compliance_manager');
  const [inputBranch, setInputBranch] = useState(() => branch?.name || '');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkEmailsText, setBulkEmailsText] = useState('');
  const [dirSearch, setDirSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);

  // Editable Role Types & Access Control State
  const [roles, setRoles] = useState<AdminRoleDefinition[]>(() => getAdminRoleDefinitions());
  const [isRoleManagerOpen, setIsRoleManagerOpen] = useState<boolean>(true);
  const [editingRoleId, setEditingRoleId] = useState<string | null>('internal_compliance_manager');
  const [isAddingNewRole, setIsAddingNewRole] = useState<boolean>(false);
  const [roleFormName, setRoleFormName] = useState<string>(() => {
    const def = getRoleDefinitionById('internal_compliance_manager', getAdminRoleDefinitions());
    return def.name;
  });
  const [roleFormDesc, setRoleFormDesc] = useState<string>(() => {
    const def = getRoleDefinitionById('internal_compliance_manager', getAdminRoleDefinitions());
    return def.description || '';
  });
  const [roleFormColor, setRoleFormColor] = useState<RoleBadgeColor>(() => {
    const def = getRoleDefinitionById('internal_compliance_manager', getAdminRoleDefinitions());
    return def.color || 'purple';
  });
  const [roleFormPermissions, setRoleFormPermissions] = useState<RolePermissionKey[]>(() => {
    const def = getRoleDefinitionById('internal_compliance_manager', getAdminRoleDefinitions());
    return [...def.permissions];
  });
  const [isSavingRoles, setIsSavingRoles] = useState<boolean>(false);

  // Reach Auditors / Dispatch State
  const [messages, setMessages] = useState<AdminDispatchMessage[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_MSG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [targetMode, setTargetMode] = useState<'all' | 'branch' | 'selected'>('all');
  const [dispatchSubject, setDispatchSubject] = useState('');
  const [dispatchMessage, setDispatchMessage] = useState('');
  const [dispatchPriority, setDispatchPriority] = useState<'normal' | 'important' | 'urgent'>('normal');
  const [dispatchCsRange, setDispatchCsRange] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingSync, setIsLoadingSync] = useState(false);

  // Active Branch Monitoring Blocks (to see live auditors on the floor)
  const [monitoringBlocks, setMonitoringBlocks] = useState<MonitoringBlock[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Admin Google Drive Links State (Forms Location, Inventory Template, Overall Count Template)
  const [formsLocationLink, setFormsLocationLink] = useState<string>(
    () => getAdminDriveLinksConfig().formsLocationLink
  );
  const [inventoryTemplateLink, setInventoryTemplateLink] = useState<string>(
    () => getAdminDriveLinksConfig().inventoryTemplateLink
  );
  const [overallCountTemplateLink, setOverallCountTemplateLink] = useState<string>(
    () => getAdminDriveLinksConfig().overallCountTemplateLink
  );
  const [isSavingDriveLinks, setIsSavingDriveLinks] = useState<boolean>(false);

  // Online Presence State (Real-time tracking for Google Accounts and Guest Mode users)
  const [onlinePresence, setOnlinePresence] = useState<PresenceStats>({
    totalOnline: 0,
    totalGoogleUsers: 0,
    totalGuests: 0,
    users: [],
  });
  const [isLoadingPresence, setIsLoadingPresence] = useState(false);
  const [presenceFilter, setPresenceFilter] = useState<'all' | 'google' | 'guest'>('all');
  const [presenceSearch, setPresenceSearch] = useState('');

  const refreshPresence = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoadingPresence(true);
    }
    try {
      const stats = await fetchOnlinePresence();
      setOnlinePresence(stats);
    } finally {
      if (!options?.silent) {
        setIsLoadingPresence(false);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    const fetchNow = async () => {
      const stats = await fetchOnlinePresence();
      if (isMounted) setOnlinePresence(stats);
    };

    fetchNow();
    const interval = setInterval(fetchNow, 15000);
    const handleStorageOrPresence = () => {
      void fetchNow();
    };
    window.addEventListener('storage', handleStorageOrPresence);
    window.addEventListener(PRESENCE_UPDATED_EVENT, handleStorageOrPresence);
    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageOrPresence);
      window.removeEventListener(PRESENCE_UPDATED_EVENT, handleStorageOrPresence);
    };
  }, []);

  const filteredOnlineUsers = useMemo(() => {
    return onlinePresence.users.filter((user) => {
      if (presenceFilter === 'google' && user.loginType !== 'google') return false;
      if (presenceFilter === 'guest' && user.loginType !== 'guest') return false;
      if (presenceSearch.trim()) {
        const q = presenceSearch.toLowerCase().trim();
        const matchesName = user.displayName?.toLowerCase().includes(q);
        const matchesEmail = user.email?.toLowerCase().includes(q);
        const matchesBranch = user.branchName?.toLowerCase().includes(q);
        const matchesTab = user.currentTab?.toLowerCase().includes(q);
        return Boolean(matchesName || matchesEmail || matchesBranch || matchesTab);
      }
      return true;
    });
  }, [onlinePresence.users, presenceFilter, presenceSearch]);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackToast({ text, type });
    setTimeout(() => {
      setFeedbackToast((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  };

  useEffect(() => {
    if (branch?.name && !inputBranch) {
      setInputBranch(branch.name);
    }
  }, [branch?.name]);

  // Load synced Hub links and custom Role Definitions from server on mount
  useEffect(() => {
    let active = true;
    fetchHubTemplatesFromServer()
      .then((res) => {
        if (!active || !res.customLinks) return;
        const { formsLocationLink: fLink, inventoryTemplateLink: iLink, overallCountTemplateLink: oLink } =
          res.customLinks;
        if (fLink) setFormsLocationLink(fLink);
        if (iLink) setInventoryTemplateLink(iLink);
        if (oLink) setOverallCountTemplateLink(oLink);
      })
      .catch(() => {});

    fetchAdminRoleDefinitionsFromServer()
      .then((serverRoles) => {
        if (active && Array.isArray(serverRoles) && serverRoles.length > 0) {
          setRoles(serverRoles);
        }
      })
      .catch(() => {});

    const unsubRoles = subscribeToRoleDefinitions((updatedRoles) => {
      if (active) setRoles(updatedRoles);
    });

    const unsubLinks = subscribeToAdminDriveLinks((updatedLinks) => {
      if (!active) return;
      setFormsLocationLink(updatedLinks.formsLocationLink || '');
      setInventoryTemplateLink(updatedLinks.inventoryTemplateLink || '');
      setOverallCountTemplateLink(updatedLinks.overallCountTemplateLink || '');
    });

    return () => {
      active = false;
      unsubRoles();
      unsubLinks();
    };
  }, []);

  // Keep inline role form fields synced when roles list updates
  useEffect(() => {
    if (isAddingNewRole) return;
    const targetId = editingRoleId || inputRole;
    const def = getRoleDefinitionById(targetId, roles);
    if (def) {
      setEditingRoleId(def.id);
      setRoleFormName(def.name);
      setRoleFormDesc(def.description || '');
      setRoleFormColor(def.color || 'blue');
      setRoleFormPermissions([...def.permissions]);
    }
  }, [roles]);

  // Select a role in the Add Email / Auditor panel and load its editable fields inline
  const handleSelectInputRole = (roleId: string) => {
    if (roleId === '__new__') {
      handleStartAddRole();
      return;
    }
    setInputRole(roleId);
    setIsAddingNewRole(false);
    setEditingRoleId(roleId);
    const roleDef = getRoleDefinitionById(roleId, roles);
    setRoleFormName(roleDef.name);
    setRoleFormDesc(roleDef.description || '');
    setRoleFormColor(roleDef.color || 'blue');
    setRoleFormPermissions([...roleDef.permissions]);
  };

  // Role Management Handlers
  const handleStartAddRole = () => {
    setIsRoleManagerOpen(true);
    setIsAddingNewRole(true);
    setEditingRoleId(null);
    setRoleFormName('');
    setRoleFormDesc('');
    setRoleFormColor('indigo');
    setRoleFormPermissions(ROLE_PERMISSION_CATALOG.map((p) => p.key));
  };

  const handleStartEditRole = (roleDef: AdminRoleDefinition) => {
    setInputRole(roleDef.id);
    setIsRoleManagerOpen(true);
    setIsAddingNewRole(false);
    setEditingRoleId(roleDef.id);
    setRoleFormName(roleDef.name);
    setRoleFormDesc(roleDef.description || '');
    setRoleFormColor(roleDef.color || 'blue');
    setRoleFormPermissions([...roleDef.permissions]);
  };

  const handleCancelRoleForm = () => {
    setIsAddingNewRole(false);
    const fallbackDef = getRoleDefinitionById(inputRole, roles);
    setEditingRoleId(fallbackDef.id);
    setRoleFormName(fallbackDef.name);
    setRoleFormDesc(fallbackDef.description || '');
    setRoleFormColor(fallbackDef.color || 'blue');
    setRoleFormPermissions([...fallbackDef.permissions]);
  };

  const handleToggleRoleFormPermission = (permKey: RolePermissionKey) => {
    setRoleFormPermissions((prev) =>
      prev.includes(permKey) ? prev.filter((k) => k !== permKey) : [...prev, permKey]
    );
  };

  // Helper to persist inline role changes or create a new role before/when saving
  const persistInlineRoleChanges = async (options?: {
    forceCreateNew?: boolean;
    silentToast?: boolean;
  }): Promise<string> => {
    const cleanName = roleFormName.trim();
    if (!cleanName) {
      if (!options?.silentToast) {
        showToast('Please enter a Role Type name.', 'error');
      }
      return inputRole;
    }

    const shouldCreateNew = Boolean(options?.forceCreateNew || isAddingNewRole);
    setIsSavingRoles(true);
    try {
      let nextRoles: AdminRoleDefinition[];
      let resolvedRoleId = editingRoleId || inputRole;

      if (shouldCreateNew) {
        const slugId = cleanName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        const uniqueId =
          !slugId || roles.some((r) => r.id === slugId)
            ? `role_${slugId || 'custom'}_${Date.now().toString(36).slice(-4)}`
            : slugId;

        const newRole: AdminRoleDefinition = {
          id: uniqueId,
          name: cleanName,
          description: roleFormDesc.trim() || `${cleanName} access role`,
          color: roleFormColor,
          permissions: roleFormPermissions,
          isSystem: false,
        };
        nextRoles = [...roles, newRole];
        resolvedRoleId = newRole.id;
        setInputRole(newRole.id);
        setEditingRoleId(newRole.id);
        setIsAddingNewRole(false);
      } else {
        const targetId = editingRoleId || inputRole;
        nextRoles = roles.map((r) => {
          if (r.id !== targetId) return r;
          const ensuredPerms =
            r.id === 'admin' && !roleFormPermissions.includes('admin_console')
              ? ([...roleFormPermissions, 'admin_console'] as RolePermissionKey[])
              : roleFormPermissions;
          return {
            ...r,
            name: cleanName,
            description: roleFormDesc.trim(),
            color: roleFormColor,
            permissions: ensuredPerms,
          };
        });
        resolvedRoleId = targetId;
      }

      const saved = await saveAdminRoleDefinitions(nextRoles);
      setRoles(saved);
      if (!options?.silentToast) {
        showToast(
          shouldCreateNew
            ? `Created new Role Type "${cleanName}" with ${roleFormPermissions.length} access permissions.`
            : `Saved Role Type "${cleanName}" and updated access permissions.`
        );
      }
      return resolvedRoleId;
    } catch {
      if (!options?.silentToast) {
        showToast('Failed to save role configuration.', 'error');
      }
      return inputRole;
    } finally {
      setIsSavingRoles(false);
    }
  };

  const handleSaveRoleForm = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await persistInlineRoleChanges({ forceCreateNew: isAddingNewRole });
  };

  const handleSaveAsNewRole = async () => {
    await persistInlineRoleChanges({ forceCreateNew: true });
  };

  const handleQuickToggleRolePermission = async (
    roleDef: AdminRoleDefinition,
    permKey: RolePermissionKey
  ) => {
    if (roleDef.id === 'admin' && permKey === 'admin_console') {
      showToast('The primary Admin role must retain Admin Console access.', 'error');
      return;
    }
    const hasPerm = roleDef.permissions.includes(permKey);
    const updatedPermissions = hasPerm
      ? roleDef.permissions.filter((p) => p !== permKey)
      : [...roleDef.permissions, permKey];

    const nextRoles = roles.map((r) =>
      r.id === roleDef.id ? { ...r, permissions: updatedPermissions } : r
    );
    setRoles(nextRoles);
    if ((editingRoleId || inputRole) === roleDef.id && !isAddingNewRole) {
      setRoleFormPermissions(updatedPermissions);
    }
    await saveAdminRoleDefinitions(nextRoles);
    const permMeta = ROLE_PERMISSION_CATALOG.find((p) => p.key === permKey);
    showToast(
      `${hasPerm ? 'Revoked' : 'Granted'} "${permMeta?.label || permKey}" for ${roleDef.name}`
    );
  };

  const handleDeleteCustomRole = async (roleDef: AdminRoleDefinition) => {
    if (roleDef.isSystem) {
      showToast('Built-in roles cannot be deleted, but you can edit their name and access permissions.', 'error');
      return;
    }
    const nextRoles = roles.filter((r) => r.id !== roleDef.id);
    const saved = await saveAdminRoleDefinitions(nextRoles);
    setRoles(saved);
    if (inputRole === roleDef.id || editingRoleId === roleDef.id) {
      handleSelectInputRole('senior_auditor');
    }
    if (roleFilter === roleDef.id) setRoleFilter('all');

    // Reassign any directory entries using the deleted role to 'senior_auditor'
    const affectedEntries = directory.filter((d) => d.role === roleDef.id);
    if (affectedEntries.length > 0) {
      const nextDir = directory.map((d) =>
        d.role === roleDef.id ? { ...d, role: 'senior_auditor' } : d
      );
      persistDirectoryLocal(nextDir);
      broadcastDirectoryUpdate(nextDir);
      try {
        await fetch('/api/admin/directory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: affectedEntries.map((d) => ({ ...d, role: 'senior_auditor' })),
          }),
        });
      } catch {}
    }
    showToast(`Deleted role "${roleDef.name}".`);
  };

  const handleResetRolesToDefault = async () => {
    setIsSavingRoles(true);
    try {
      const saved = await saveAdminRoleDefinitions(DEFAULT_ROLE_DEFINITIONS);
      setRoles(saved);
      handleCancelRoleForm();
      showToast('Reset role types and access permissions to default.');
    } finally {
      setIsSavingRoles(false);
    }
  };

  const handleSaveDriveLinks = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingDriveLinks(true);
    try {
      const ok = await saveAdminDriveLinksConfig(
        {
          formsLocationLink: formsLocationLink.trim(),
          inventoryTemplateLink: inventoryTemplateLink.trim(),
          overallCountTemplateLink: overallCountTemplateLink.trim(),
        },
        accessToken
      );
      if (ok) {
        showToast('Saved & synced Google Drive links for Forms, Inventory Template, and Overall Count Template.');
      } else {
        showToast('Saved Google Drive links locally. Server sync will complete when connected.');
      }
      NotifyWebsiteUpdateAvailable();
    } catch {
      showToast('Failed to save Google Drive links.', 'error');
    } finally {
      setIsSavingDriveLinks(false);
    }
  };

  const handleResetDriveLinks = async () => {
    setFormsLocationLink('');
    setInventoryTemplateLink('');
    setOverallCountTemplateLink('');
    setIsSavingDriveLinks(true);
    try {
      await saveAdminDriveLinksConfig(
        {
          formsLocationLink: '',
          inventoryTemplateLink: '',
          overallCountTemplateLink: '',
        },
        accessToken
      );
      showToast('Reset Google Drive links to default ICD Hub templates.');
      NotifyWebsiteUpdateAvailable();
    } finally {
      setIsSavingDriveLinks(false);
    }
  };

  const parsedFormsResource = useMemo(
    () => extractDriveResourceFromLink(formsLocationLink),
    [formsLocationLink]
  );
  const parsedInventoryResource = useMemo(
    () => extractDriveResourceFromLink(inventoryTemplateLink),
    [inventoryTemplateLink]
  );
  const parsedOverallResource = useMemo(
    () => extractDriveResourceFromLink(overallCountTemplateLink),
    [overallCountTemplateLink]
  );

  // Save directory to localStorage
  const persistDirectoryLocal = (list: AdminDirectoryEntry[]) => {
    setDirectory(list);
    try {
      localStorage.setItem(LOCAL_DIR_KEY, JSON.stringify(list));
    } catch {}
  };

  const persistMessagesLocal = (list: AdminDispatchMessage[]) => {
    setMessages(list);
    try {
      localStorage.setItem(LOCAL_MSG_KEY, JSON.stringify(list));
    } catch {}
  };

  // Load directory, discovered members, and messages from server + monitoring blocks
  const syncWithServer = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoadingSync(true);
    }
    try {
      const [dirRes, msgRes] = await Promise.all([
        fetch('/api/admin/directory').catch(() => null),
        fetch('/api/admin/messages').catch(() => null),
      ]);

      if (dirRes && dirRes.ok) {
        const dirData = await dirRes.json();
        const remoteEntries: AdminDirectoryEntry[] = Array.isArray(dirData?.entries) ? dirData.entries : [];
        const discovered: Array<{ email: string; name: string; role: string; spreadsheet_name?: string }> =
          Array.isArray(dirData?.discoveredMembers) ? dirData.discoveredMembers : [];

        setDirectory((prev) => {
          const map = new Map<string, AdminDirectoryEntry>();
          prev.forEach((item) => map.set(item.email.toLowerCase() || item.id, item));
          remoteEntries.forEach((item) => {
            if (item && (item.email || item.id)) {
              map.set((item.email || item.id).toLowerCase(), item);
            }
          });
          discovered.forEach((d) => {
            const em = (d.email || '').trim().toLowerCase();
            if (em && !map.has(em) && !em.endsWith('@sidc.local')) {
              map.set(em, {
                id: `dir_${em}`,
                email: em,
                name: d.name || em.split('@')[0],
                role: d.role === 'owner' ? 'internal_compliance_supervisor' : 'senior_auditor',
                branchName: d.spreadsheet_name || branch?.name || '',
                status: 'active',
                createdAt: new Date().toISOString(),
              });
            }
          });
          const merged = Array.from(map.values());
          try {
            localStorage.setItem(LOCAL_DIR_KEY, JSON.stringify(merged));
          } catch {}
          return merged;
        });
      }

      if (msgRes && msgRes.ok) {
        const msgData = await msgRes.json();
        if (Array.isArray(msgData?.messages) && msgData.messages.length > 0) {
          persistMessagesLocal(msgData.messages);
        }
      }

      if (branch?.id) {
        const blocks = await getBranchMonitoringBlocks(branch.id);
        setMonitoringBlocks(blocks);
      }

      void refreshPresence({ silent: true });
    } catch (e) {
      console.warn('Admin sync notice:', e);
    } finally {
      if (!options?.silent) {
        setIsLoadingSync(false);
      }
    }
  };

  useEffect(() => {
    void syncWithServer({ silent: true });
  }, [branch?.id]);

  // Extract active auditors from Monitoring blocks
  const activeMonitoringAuditors = useMemo(() => {
    const byName = new Map<
      string,
      { name: string; encodingRanges: string[]; checkingRanges: string[]; completedCount: number }
    >();

    monitoringBlocks.forEach((b) => {
      const enc = (b.encoder || b.auditor || '').trim();
      if (enc && enc.toLowerCase() !== 'unassigned') {
        const key = enc.toLowerCase();
        const curr = byName.get(key) || {
          name: enc,
          encodingRanges: [],
          checkingRanges: [],
          completedCount: 0,
        };
        curr.encodingRanges.push(b.rangeLabel || b.csRange);
        if (b.encodingStatus === 'Completed') curr.completedCount++;
        byName.set(key, curr);
      }

      const chk = (b.checker || '').trim();
      if (chk && chk.toLowerCase() !== 'unassigned') {
        const key = chk.toLowerCase();
        const curr = byName.get(key) || {
          name: chk,
          encodingRanges: [],
          checkingRanges: [],
          completedCount: 0,
        };
        curr.checkingRanges.push(b.rangeLabel || b.csRange);
        if (b.checkingStatus === 'Completed') curr.completedCount++;
        byName.set(key, curr);
      }
    });

    return Array.from(byName.values());
  }, [monitoringBlocks]);

  // Add single email / auditor
  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = inputEmail.trim().toLowerCase();
    const cleanName = inputName.trim() || (cleanEmail ? cleanEmail.split('@')[0] : '');

    if (!cleanEmail && !cleanName) {
      showToast('Please enter an email address or auditor name.', 'error');
      return;
    }

    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }

    // Automatically save any inline role edits or newly typed role type
    const resolvedRoleId = await persistInlineRoleChanges({
      forceCreateNew: isAddingNewRole,
      silentToast: true,
    });

    const id = cleanEmail ? `dir_${cleanEmail}` : `dir_${cleanName.toLowerCase().replace(/\s+/g, '_')}`;
    const newEntry: AdminDirectoryEntry = {
      id,
      email: cleanEmail,
      name: cleanName,
      role: resolvedRoleId,
      branchName: inputBranch.trim() || branch?.name || 'All Branches',
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    const nextList = [
      newEntry,
      ...directory.filter((item) => item.id !== id && (!cleanEmail || item.email.toLowerCase() !== cleanEmail)),
    ];
    persistDirectoryLocal(nextList);
    broadcastDirectoryUpdate(nextList);
    setInputEmail('');
    setInputName('');
    showToast(`Added ${cleanName}${cleanEmail ? ` (${cleanEmail})` : ''} as ${roleFormName.trim() || roleLabelText(resolvedRoleId)}`);

    try {
      await fetch('/api/admin/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEntry),
      });
    } catch {}
  };

  // Bulk add emails
  const handleBulkAddEmails = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawLines = bulkEmailsText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawLines.length === 0) {
      showToast('Paste one or more emails to add.', 'error');
      return;
    }

    const resolvedRoleId = await persistInlineRoleChanges({
      forceCreateNew: isAddingNewRole,
      silentToast: true,
    });

    const addedEntries: AdminDirectoryEntry[] = [];
    for (const token of rawLines) {
      // Support "Name <email@domain.com>" or plain "email@domain.com"
      const angleMatch = token.match(/^([^<]+)<([^>]+)>$/);
      const emailPart = angleMatch ? angleMatch[2].trim().toLowerCase() : token.trim().toLowerCase();
      const namePart = angleMatch
        ? angleMatch[1].trim()
        : emailPart.includes('@')
        ? emailPart.split('@')[0]
        : token.trim();

      if (!emailPart.includes('@') && !namePart) continue;
      const id = emailPart.includes('@')
        ? `dir_${emailPart}`
        : `dir_${namePart.toLowerCase().replace(/\s+/g, '_')}`;

      addedEntries.push({
        id,
        email: emailPart.includes('@') ? emailPart : '',
        name: namePart,
        role: resolvedRoleId,
        branchName: inputBranch.trim() || branch?.name || 'All Branches',
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    }

    if (addedEntries.length === 0) {
      showToast('No valid emails found in input.', 'error');
      return;
    }

    const addedIds = new Set(addedEntries.map((a) => a.id));
    const nextList = [...addedEntries, ...directory.filter((d) => !addedIds.has(d.id))];
    persistDirectoryLocal(nextList);
    broadcastDirectoryUpdate(nextList);
    setBulkEmailsText('');
    setIsBulkMode(false);
    showToast(`Added ${addedEntries.length} email${addedEntries.length > 1 ? 's' : ''} to directory`);

    try {
      await fetch('/api/admin/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: addedEntries }),
      });
    } catch {}
  };

  // Promote, demote, or change designation of an auditor / person
  const handleUpdateEntryRole = async (
    entry: AdminDirectoryEntry,
    newRole: AdminDirectoryEntry['role']
  ) => {
    if (entry.role === newRole) return;

    const updatedEntry: AdminDirectoryEntry = {
      ...entry,
      role: newRole,
    };

    const nextList = directory.map((item) => (item.id === entry.id ? updatedEntry : item));
    persistDirectoryLocal(nextList);
    broadcastDirectoryUpdate(nextList);

    const isPromotingToAdmin = doesRoleHavePermission(newRole, 'admin_console', roles);
    const wasAdmin = doesRoleHavePermission(entry.role, 'admin_console', roles);

    if (isPromotingToAdmin && !wasAdmin) {
      showToast(`Assigned ${entry.name} to ${roleLabelText(newRole)} (Admin Console access granted)`);
    } else if (!isPromotingToAdmin && wasAdmin) {
      showToast(`Assigned ${entry.name} to ${roleLabelText(newRole)} (Admin Console access removed)`);
    } else {
      showToast(`Updated role for ${entry.name} to ${roleLabelText(newRole)}`);
    }

    try {
      await fetch('/api/admin/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedEntry),
      });
    } catch (e) {
      console.warn('Failed to update directory role on server:', e);
    }
  };

  // Remove email / auditor
  const handleRemoveEntry = async (entry: AdminDirectoryEntry) => {
    const nextList = directory.filter((item) => item.id !== entry.id);
    persistDirectoryLocal(nextList);
    broadcastDirectoryUpdate(nextList);
    setSelectedEmails((prev) => prev.filter((em) => em !== entry.email && em !== entry.id));
    showToast(`Removed ${entry.name || entry.email}`);

    try {
      await fetch(`/api/admin/directory/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      });
    } catch {}
  };

  const toggleSelectRecipient = (entry: AdminDirectoryEntry) => {
    const key = entry.email || entry.id;
    setTargetMode('selected');
    setSelectedEmails((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleQuickReachAuditor = (entry: AdminDirectoryEntry) => {
    const key = entry.email || entry.id;
    setTargetMode('selected');
    if (!selectedEmails.includes(key)) {
      setSelectedEmails((prev) => [...prev, key]);
    }
    if (!dispatchSubject) {
      setDispatchSubject(
        branch?.name ? `[Audit] ${branch.name} — Countsheet Follow-up` : `[Inventory Hub] Audit Notice`
      );
    }
  };

  // Filtered directory
  const filteredDirectory = useMemo(() => {
    const q = dirSearch.trim().toLowerCase();
    return directory.filter((item) => {
      const resolvedDef = getRoleDefinitionById(item.role, roles);
      if (roleFilter !== 'all' && resolvedDef.id !== roleFilter) {
        return false;
      }
      if (!q) return true;
      const roleName = resolvedDef.name.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.branchName.toLowerCase().includes(q) ||
        roleName.includes(q)
      );
    });
  }, [directory, dirSearch, roleFilter, roles]);

  // Resolved recipients for Reach Auditors
  const resolvedRecipients = useMemo(() => {
    if (targetMode === 'all') {
      return directory;
    }
    if (targetMode === 'branch') {
      const activeBranchLower = (branch?.name || '').trim().toLowerCase();
      if (!activeBranchLower) return directory;
      const matched = directory.filter(
        (d) =>
          !d.branchName ||
          d.branchName.toLowerCase() === 'all branches' ||
          d.branchName.toLowerCase().includes(activeBranchLower)
      );
      return matched.length > 0 ? matched : directory;
    }
    return directory.filter((d) => selectedEmails.includes(d.email || d.id));
  }, [directory, targetMode, branch?.name, selectedEmails]);

  const recipientEmailList = useMemo(
    () => resolvedRecipients.map((r) => r.email).filter((em) => Boolean(em && em.includes('@'))),
    [resolvedRecipients]
  );

  // Apply quick message template
  const applyTemplate = (type: 'assign' | 'recount' | 'submit' | 'sync') => {
    const bName = branch?.name || 'Active Branch';
    const csLabel = dispatchCsRange.trim() || 'assigned countsheets';
    if (type === 'assign') {
      setDispatchSubject(`[Audit Assignment] ${bName} (${csLabel})`);
      setDispatchMessage(
        `Please proceed with physical counting for ${bName} (${csLabel}). Verify barcodes against MASTERDATA and submit your countsheet once completed.`
      );
      setDispatchPriority('normal');
    } else if (type === 'recount') {
      setDispatchSubject(`[Urgent Recount] Variance Check — ${bName}`);
      setDispatchMessage(
        `Please recount and verify items with variance on ${csLabel} for ${bName}. Confirm actual physical quantities and update Monitoring status.`
      );
      setDispatchPriority('urgent');
    } else if (type === 'submit') {
      setDispatchSubject(`[Reminder] Submit Pending Countsheets — ${bName}`);
      setDispatchMessage(
        `Please submit all pending draft countsheets (${csLabel}) to Google Sheets for ${bName} so Encoding and Checking can be finalized.`
      );
      setDispatchPriority('important');
    } else if (type === 'sync') {
      setDispatchSubject(`[Action Required] Re-sync Branch Inventory — ${bName}`);
      setDispatchMessage(
        `Branch inventory for ${bName} has been updated. Please click "Re-sync Branch Data" in the Branch tab before continuing your count.`
      );
      setDispatchPriority('important');
    }
  };

  // Send in-app dispatch to auditors
  const handleSendDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchMessage.trim()) {
      showToast('Please enter a message for the auditors.', 'error');
      return;
    }

    setIsSending(true);
    const recipientLabel =
      targetMode === 'all'
        ? `All Auditors (${resolvedRecipients.length})`
        : targetMode === 'branch'
        ? `${branch?.name || 'Branch'} Auditors (${resolvedRecipients.length})`
        : resolvedRecipients.map((r) => r.name || r.email).join(', ') || 'Selected Auditors';

    const newMsg: AdminDispatchMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderName: userName || 'Admin',
      senderEmail: userEmail || '',
      recipientEmail: recipientEmailList.join(', ') || 'all',
      recipientName: recipientLabel,
      subject: dispatchSubject.trim() || 'Audit Dispatch',
      message: dispatchMessage.trim(),
      priority: dispatchPriority,
      branchName: branch?.name || 'All Branches',
      csRange: dispatchCsRange.trim(),
      status: 'sent',
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [newMsg, ...messages];
    persistMessagesLocal(nextMessages);
    setDispatchMessage('');
    showToast(`Dispatch sent to ${recipientLabel}`);

    try {
      await fetch('/api/admin/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMsg),
      });
    } catch {}
    setIsSending(false);
  };

  const handleToggleAcknowledge = async (msg: AdminDispatchMessage) => {
    const updated: AdminDispatchMessage = {
      ...msg,
      status: msg.status === 'acknowledged' ? 'sent' : 'acknowledged',
    };
    const next = messages.map((m) => (m.id === msg.id ? updated : m));
    persistMessagesLocal(next);
    try {
      await fetch('/api/admin/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch {}
  };

  const handleDeleteMessage = async (id: string) => {
    const next = messages.filter((m) => m.id !== id);
    persistMessagesLocal(next);
    try {
      await fetch(`/api/admin/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {}
  };

  // Build Gmail compose URL
  const gmailComposeUrl = useMemo(() => {
    const to = recipientEmailList.join(',');
    const su = dispatchSubject.trim() || `[Inventory Hub] ${branch?.name || 'Audit Dispatch'}`;
    const branchLink = branch?.id
      ? `\n\nBranch Spreadsheet: https://docs.google.com/spreadsheets/d/${branch.id}/edit`
      : '';
    const csNote = dispatchCsRange.trim() ? `\nCS Range: ${dispatchCsRange.trim()}` : '';
    const body = `${dispatchMessage.trim() || 'Hello Team,'}${csNote}${branchLink}`;
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(
      su
    )}&body=${encodeURIComponent(body)}`;
  }, [recipientEmailList, dispatchSubject, dispatchMessage, dispatchCsRange, branch]);

  const handleCopyText = (text: string, id: string, label: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      showToast(label);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    });
  };

  const roleBadgeStyle = (role: AdminDirectoryEntry['role']) => {
    const def = getRoleDefinitionById(role, roles);
    return getRoleBadgeClasses(def.color);
  };

  const roleLabelText = (role: AdminDirectoryEntry['role']) => {
    const def = getRoleDefinitionById(role, roles);
    return def.name;
  };

  return (
    <div className="space-y-4">
      <SEOHead
        title="Admin Console — Emails & Reach Auditors"
        description="Manage branch & auditor emails and reach auditors directly in Admin Mode."
        routePath="/admin"
      />

      {/* Toast Notification */}
      {feedbackToast && (
        <div
          className={`fixed bottom-20 md:bottom-6 right-4 z-50 px-4 py-2.5 rounded-2xl shadow-lg border text-xs font-bold flex items-center gap-2 animate-in fade-in ${
            feedbackToast.type === 'error'
              ? 'bg-rose-600 text-white border-rose-500'
              : 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 border-slate-700'
          }`}
        >
          {feedbackToast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
          )}
          <span>{feedbackToast.text}</span>
        </div>
      )}

      {/* Top Admin Header Banner */}
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-amber-300/80 dark:border-amber-800/70 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <PanelDecoration position="top-right" tier="major" variant={0} />
        <PanelDecoration position="top-left" tier="secondary" variant={2} />

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                Admin Console
              </h2>
              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                Admin Mode
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add or remove auditor &amp; branch emails and reach auditors directly
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-blue-500" />
            <span>{directory.length} Saved</span>
          </div>
          <button
            type="button"
            onClick={() => syncWithServer({ silent: false })}
            disabled={isLoadingSync}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSync ? 'animate-spin text-blue-500' : ''}`} />
            <span>Sync</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (onExitAdminMode) {
                onExitAdminMode();
              } else {
                onOpenBranchTab();
              }
            }}
            title="Exit Admin Console"
            className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/70 border border-rose-200 dark:border-rose-800/80 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5 cursor-pointer transition active:scale-95"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Exit</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* LIVE ONLINE USERS DASHBOARD (Google Accounts & Guest Mode Users)           */}
      {/* ========================================================================= */}
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-emerald-300/80 dark:border-emerald-800/70 shadow-xs space-y-4">
        <PanelDecoration position="top-right" tier="major" variant={1} />

        {/* Header with Live Status & Counters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Live Online Users
                </h3>
                <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{onlinePresence.totalOnline} Active Now</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real-time tracking of active Guest Mode sessions and logged-in Google accounts
              </p>
            </div>
          </div>

          {/* Quick Metrics & Refresh */}
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 text-blue-700 dark:text-blue-300 font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span>{onlinePresence.totalGoogleUsers} Google</span>
              </span>
              <span className="px-2.5 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/80 text-purple-700 dark:text-purple-300 font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                <span>{onlinePresence.totalGuests} Guests</span>
              </span>
            </div>

            <button
              type="button"
              onClick={() => refreshPresence({ silent: false })}
              disabled={isLoadingPresence}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 transition cursor-pointer"
              title="Refresh online users now"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPresence ? 'animate-spin text-emerald-500' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Tabs and Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-zinc-800/80 p-1 rounded-xl border border-slate-200 dark:border-zinc-700/80 self-start">
            <button
              type="button"
              onClick={() => setPresenceFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                presenceFilter === 'all'
                  ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Online ({onlinePresence.totalOnline})
            </button>
            <button
              type="button"
              onClick={() => setPresenceFilter('google')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                presenceFilter === 'google'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30'
              }`}
            >
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              <span>Google Accounts ({onlinePresence.totalGoogleUsers})</span>
            </button>
            <button
              type="button"
              onClick={() => setPresenceFilter('guest')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                presenceFilter === 'guest'
                  ? 'bg-purple-600 text-white shadow-2xs'
                  : 'text-purple-700 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30'
              }`}
            >
              <User className="w-3 h-3 shrink-0" />
              <span>Guest Mode ({onlinePresence.totalGuests})</span>
            </button>
          </div>

          <div className="relative max-w-xs w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={presenceSearch}
              onChange={(e) => setPresenceSearch(e.target.value)}
              placeholder="Search online users..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {presenceSearch && (
              <button
                type="button"
                onClick={() => setPresenceSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Online Users Grid */}
        {filteredOnlineUsers.length === 0 ? (
          <div className="py-8 text-center rounded-xl bg-slate-50/60 dark:bg-zinc-800/40 border border-dashed border-slate-200 dark:border-zinc-700/80 space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-400 flex items-center justify-center mx-auto">
              <Users className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold text-slate-700 dark:text-zinc-300">
              {onlinePresence.totalOnline === 0
                ? 'No users active right now'
                : 'No online users match the current filter'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
              {onlinePresence.totalOnline === 0
                ? 'When auditors sign in with Google or start Guest Mode with their nickname, they will appear here in real time.'
                : 'Try switching the filter tab or clearing the search query.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredOnlineUsers.map((u) => {
              const isGoogle = u.loginType === 'google';
              return (
                <div
                  key={u.sessionId}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 shadow-2xs ${
                    isGoogle
                      ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-200/80 dark:border-blue-900/60'
                      : 'bg-purple-50/40 dark:bg-purple-950/20 border-purple-200/80 dark:border-purple-900/60'
                  }`}
                >
                  <div className="space-y-2">
                    {/* User Profile Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Avatar with pulse dot */}
                        <div className="relative shrink-0">
                          {u.photoURL ? (
                            <img
                              src={u.photoURL}
                              alt={u.displayName}
                              className="w-9 h-9 rounded-full object-cover border border-slate-300 dark:border-zinc-700 shadow-2xs"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white shadow-2xs ${
                                isGoogle
                                  ? 'bg-blue-600 dark:bg-blue-500'
                                  : 'bg-purple-600 dark:bg-purple-500'
                              }`}
                            >
                              {u.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          {/* Live green dot */}
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-white dark:border-slate-900"></span>
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {u.displayName}
                            </h4>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono truncate">
                            {u.email}
                          </div>
                        </div>
                      </div>

                      {/* Login Type Badge */}
                      <span
                        className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md border shrink-0 flex items-center gap-1 ${
                          isGoogle
                            ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25'
                            : 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/25'
                        }`}
                      >
                        {isGoogle ? 'Google Account' : 'Guest Mode'}
                      </span>
                    </div>

                    {/* Active Location & View Details */}
                    <div className="space-y-1 pt-1 text-[11px]">
                      {u.branchName && (
                        <div className="flex items-center gap-1.5 text-slate-700 dark:text-zinc-300">
                          <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-semibold truncate">{u.branchName}</span>
                        </div>
                      )}
                      {u.currentTab && (
                        <div className="flex items-center gap-1.5 text-slate-500 dark:text-zinc-400">
                          <ClipboardList className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="capitalize">{u.currentTab} View</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer: Last active timestamp & Message trigger */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-zinc-800/70 text-[11px]">
                    <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                      <Clock className="w-3 h-3" />
                      <span>
                        {u.secondsAgo < 60
                          ? 'Active now'
                          : `Active ${Math.floor(u.secondsAgo / 60)}m ago`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleCopyText(u.email, u.sessionId, `Copied email for ${u.displayName}`)}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
                        title="Copy email/identifier"
                      >
                        {copiedId === u.sessionId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEmails([u.email]);
                          setTargetMode('selected');
                          setDispatchSubject(`[Admin Message to ${u.displayName}]`);
                          showToast(`Selected ${u.displayName} for dispatch message.`);
                        }}
                        className="px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 text-[10.5px] font-bold text-slate-700 dark:text-zinc-200 transition cursor-pointer flex items-center gap-1"
                        title="Reach out or dispatch to this active user"
                      >
                        <Send className="w-2.5 h-2.5 text-blue-500" />
                        <span>Reach</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Google Drive Links Configuration: Forms Location, Inventory Template, Overall Count Template */}
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-blue-200/90 dark:border-blue-900/60 shadow-xs space-y-3.5">
        <PanelDecoration position="top-right" tier="secondary" variant={1} />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/25 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Link2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Google Drive Links — Forms &amp; Templates Storage
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                  Admin Storage Links
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Set the Google Drive / Google Sheets links for the Forms folder, Inventory Countsheet Template, and Overall Count Template so auditors can access them without signing into the admin email.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            {(formsLocationLink || inventoryTemplateLink || overallCountTemplateLink) && (
              <button
                type="button"
                onClick={handleResetDriveLinks}
                disabled={isSavingDriveLinks}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 text-[11px] font-bold text-slate-600 dark:text-zinc-300 flex items-center gap-1 cursor-pointer transition"
                title="Reset to default ICD Hub links"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Defaults</span>
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSaveDriveLinks} className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* 1. Location of the Forms */}
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-zinc-800/50 border border-slate-200/80 dark:border-zinc-700/70 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-zinc-200">
                  <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Location of the Forms</span>
                </label>
                {parsedFormsResource ? (
                  <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                    ID: {parsedFormsResource.id.slice(0, 10)}…
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">
                    Default: ICD FORMS
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={formsLocationLink}
                  onChange={(e) => setFormsLocationLink(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                {parsedFormsResource && (
                  <a
                    href={parsedFormsResource.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 shrink-0 transition"
                    title="Open Forms Location in Google Drive"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              <p className="text-[10.5px] text-slate-500 dark:text-zinc-400">
                Google Drive folder link containing printable PDF audit forms (e.g. ICD FORMS).
              </p>
            </div>

            {/* 2. Inventory Template (Random / Periodic Countsheet Template) */}
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-zinc-800/50 border border-slate-200/80 dark:border-zinc-700/70 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-zinc-200">
                  <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span>Inventory Template</span>
                </label>
                {parsedInventoryResource ? (
                  <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                    ID: {parsedInventoryResource.id.slice(0, 10)}…
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">
                    Default: Countsheet Template
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={inventoryTemplateLink}
                  onChange={(e) => setInventoryTemplateLink(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                {parsedInventoryResource && (
                  <a
                    href={parsedInventoryResource.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 shrink-0 transition"
                    title="Open Inventory Template in Google Sheets / Drive"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              <p className="text-[10.5px] text-slate-500 dark:text-zinc-400">
                Google Sheet or Drive folder link for the Random / Periodic Inventory Countsheet Template.
              </p>
            </div>

            {/* 3. Overall Count Template (Encoding Template) */}
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-zinc-800/50 border border-slate-200/80 dark:border-zinc-700/70 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-zinc-200">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>Overall Count Template</span>
                </label>
                {parsedOverallResource ? (
                  <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                    ID: {parsedOverallResource.id.slice(0, 10)}…
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">
                    Default: Overall Count Template
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={overallCountTemplateLink}
                  onChange={(e) => setOverallCountTemplateLink(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                {parsedOverallResource && (
                  <a
                    href={parsedOverallResource.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 shrink-0 transition"
                    title="Open Overall Count Template in Google Sheets / Drive"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              <p className="text-[10.5px] text-slate-500 dark:text-zinc-400">
                Google Sheet or Drive folder link for the Overall Count / Encoding Audit Template.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={isSavingDriveLinks}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition shadow-2xs active:scale-98"
            >
              <Save className={`w-3.5 h-3.5 ${isSavingDriveLinks ? 'animate-pulse' : ''}`} />
              <span>{isSavingDriveLinks ? 'Saving & Syncing Links...' : 'Save Google Drive Links'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Main Two-Column Grid: Left = Manage Emails & Auditors | Right = Reach Auditors */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* =============================================================== */}
        {/* LEFT COLUMN (7 cols): ADD & REMOVE EMAILS / AUDITORS DIRECTORY  */}
        {/* =============================================================== */}
        <div className="lg:col-span-7 space-y-4">
          {/* Add Email / Auditor Card */}
          <div
            id="admin-add-auditor-panel"
            className="relative bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3.5"
          >
            <PanelDecoration position="bottom-left" tier="secondary" variant={1} />

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Add Email or Auditor
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
                  Editable Role Type &amp; Access
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleStartAddRole}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1 cursor-pointer transition shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Role Type</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsBulkMode((prev) => !prev)}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 cursor-pointer transition"
                >
                  {isBulkMode ? 'Single Add' : 'Bulk Paste Emails'}
                </button>
              </div>
            </div>

            <form
              onSubmit={isBulkMode ? handleBulkAddEmails : handleAddEntry}
              className="space-y-3"
            >
              {!isBulkMode ? (
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-4">
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={inputEmail}
                        onChange={(e) => setInputEmail(e.target.value)}
                        placeholder="auditor@gmail.com"
                        className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                      Auditor / Branch Name
                    </label>
                    <input
                      type="text"
                      value={inputName}
                      onChange={(e) => setInputName(e.target.value)}
                      placeholder="e.g. Juan Dela Cruz"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                      Assigned Branch
                    </label>
                    <input
                      type="text"
                      value={inputBranch}
                      onChange={(e) => setInputBranch(e.target.value)}
                      placeholder={branch?.name || 'All Branches'}
                      className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <div className="sm:col-span-8">
                      <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                        Bulk Paste Emails (Supports plain emails or Name &lt;email&gt;)
                      </label>
                      <textarea
                        rows={2}
                        value={bulkEmailsText}
                        onChange={(e) => setBulkEmailsText(e.target.value)}
                        placeholder="Paste emails separated by commas or new lines (e.g. juan@gmail.com, Maria <maria@sidc.com>)..."
                        className="w-full p-2.5 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                        Assigned Branch
                      </label>
                      <input
                        type="text"
                        value={inputBranch}
                        onChange={(e) => setInputBranch(e.target.value)}
                        placeholder={branch?.name || 'All Branches'}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================================= */}
              {/* INLINE EDITABLE ROLE TYPE & ACCESS PERMISSIONS (DIRECTLY IN ADD PANEL)    */}
              {/* ========================================================================= */}
              <div className="p-3.5 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/90 dark:border-purple-800/70 space-y-3">
                {/* Top Row: Role Type Selector Dropdown + Interactive Role Chips + New Role Button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Lock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                      Role / Type (Editable) &amp; Access
                    </span>
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${getRoleBadgeClasses(
                        roleFormColor
                      )}`}
                    >
                      {roleFormName.trim() || (isAddingNewRole ? 'New Role' : 'Role')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <select
                      value={isAddingNewRole ? '__new__' : inputRole}
                      onChange={(e) => handleSelectInputRole(e.target.value)}
                      aria-label="Select Role Type"
                      className="px-2.5 py-1.5 text-xs font-bold rounded-xl bg-white dark:bg-zinc-900 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.permissions.length} access)
                        </option>
                      ))}
                      <option value="__new__">+ Add New Role Type...</option>
                    </select>

                    <button
                      type="button"
                      onClick={handleStartAddRole}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer transition border ${
                        isAddingNewRole
                          ? 'bg-purple-600 text-white border-purple-500 shadow-2xs'
                          : 'bg-white dark:bg-zinc-900 hover:bg-purple-50 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700'
                      }`}
                      title="Create a new Role Type"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Role</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleResetRolesToDefault}
                      disabled={isSavingRoles}
                      className="px-2 py-1.5 rounded-xl bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 text-[10.5px] font-bold flex items-center gap-1 cursor-pointer transition"
                      title="Reset all roles to default"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  </div>
                </div>

                {/* Quick Role Type Selector Buttons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {roles.map((r) => {
                    const isSelected = !isAddingNewRole && inputRole === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleSelectInputRole(r.id)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border flex items-center gap-1.5 cursor-pointer transition ${
                          isSelected
                            ? 'bg-purple-600 text-white border-purple-500 shadow-2xs'
                            : 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-purple-400'
                        }`}
                      >
                        <span>{r.name}</span>
                        <span
                          className={`text-[9.5px] px-1.5 py-0.2 rounded ${
                            isSelected
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400'
                          }`}
                        >
                          {r.permissions.length}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Editable Role Type Name, Description & Badge Color */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-4">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                      {isAddingNewRole ? 'New Role Type Name' : 'Role Type Name (Editable)'}
                    </label>
                    <input
                      type="text"
                      value={roleFormName}
                      onChange={(e) => setRoleFormName(e.target.value)}
                      placeholder="e.g. Regional Supervisor / Checker"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div className="sm:col-span-5">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                      Role Description
                    </label>
                    <input
                      type="text"
                      value={roleFormDesc}
                      onChange={(e) => setRoleFormDesc(e.target.value)}
                      placeholder="Short description of this role's access"
                      className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                      Badge Color
                    </label>
                    <select
                      value={roleFormColor}
                      onChange={(e) => setRoleFormColor(e.target.value as RoleBadgeColor)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
                    >
                      <option value="purple">Purple</option>
                      <option value="amber">Amber</option>
                      <option value="blue">Blue</option>
                      <option value="emerald">Emerald</option>
                      <option value="rose">Rose</option>
                      <option value="indigo">Indigo</option>
                      <option value="cyan">Cyan</option>
                      <option value="slate">Slate</option>
                    </select>
                  </div>
                </div>

                {/* Assignable Access Permissions Checkboxes */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                      Assign Access to Role ({roleFormPermissions.length} of {ROLE_PERMISSION_CATALOG.length} active)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setRoleFormPermissions(ROLE_PERMISSION_CATALOG.map((p) => p.key))
                        }
                        className="text-[10px] font-bold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                      >
                        Select All Access
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRoleFormPermissions(
                            !isAddingNewRole && editingRoleId === 'admin' ? ['admin_console'] : []
                          )
                        }
                        className="text-[10px] font-bold text-slate-500 hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {ROLE_PERMISSION_CATALOG.map((perm) => {
                      const checked = roleFormPermissions.includes(perm.key);
                      const isLockedAdminPerm =
                        !isAddingNewRole && editingRoleId === 'admin' && perm.key === 'admin_console';
                      return (
                        <label
                          key={perm.key}
                          className={`p-2 rounded-xl border flex items-start gap-2 cursor-pointer transition ${
                            checked
                              ? 'bg-white dark:bg-zinc-900 border-purple-400 dark:border-purple-500/70 shadow-2xs'
                              : 'bg-white/60 dark:bg-zinc-900/50 border-slate-200 dark:border-zinc-800 opacity-75 hover:opacity-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isLockedAdminPerm}
                            onChange={() => handleToggleRoleFormPermission(perm.key)}
                            className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-bold text-slate-900 dark:text-white leading-tight">
                              {perm.label}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-zinc-400 leading-tight mt-0.5">
                              {perm.description}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Role Action Bar & Submit Add Email / Auditor Button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1.5 border-t border-purple-200/70 dark:border-purple-800/50">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleSaveRoleForm()}
                      disabled={isSavingRoles}
                      className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition shadow-2xs"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        {isAddingNewRole ? 'Create & Save Role Type' : 'Save Role & Access Changes'}
                      </span>
                    </button>

                    {!isAddingNewRole && (
                      <button
                        type="button"
                        onClick={handleSaveAsNewRole}
                        disabled={isSavingRoles}
                        className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 hover:bg-purple-50 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                        title="Save the typed Role Name and Access Permissions as a brand-new Role Type"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Save as New Role</span>
                      </button>
                    )}

                    {!isAddingNewRole &&
                      (() => {
                        const currentDef = roles.find((r) => r.id === (editingRoleId || inputRole));
                        if (currentDef && !currentDef.isSystem) {
                          return (
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomRole(currentDef)}
                              className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Role</span>
                            </button>
                          );
                        }
                        return null;
                      })()}

                    {isAddingNewRole && (
                      <button
                        type="button"
                        onClick={handleCancelRoleForm}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-200/80 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-[11px] font-bold cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="py-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition shadow-2xs active:scale-98 shrink-0"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>{isBulkMode ? 'Add All Emails with Role' : 'Add Email / Auditor'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Saved Emails & Auditors List Card */}
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setRoleFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    roleFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  All ({directory.length})
                </button>
                {roles.map((r) => {
                  const count = directory.filter(
                    (d) => getRoleDefinitionById(d.role, roles).id === r.id
                  ).length;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRoleFilter(r.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        roleFilter === r.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {r.name} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="relative min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={dirSearch}
                  onChange={(e) => setDirSearch(e.target.value)}
                  placeholder="Search email, name, or role..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Directory Rows */}
            {filteredDirectory.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <Mail className="w-8 h-8 text-slate-300 dark:text-zinc-600 mx-auto" />
                <div className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                  No matching emails or auditors
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-0.5">
                {filteredDirectory.map((entry) => {
                  const key = entry.email || entry.id;
                  const isSelectedForReach = selectedEmails.includes(key);
                  const entryRoleDef = getRoleDefinitionById(entry.role, roles);
                  const liveFloorMatch = activeMonitoringAuditors.find(
                    (a) =>
                      a.name.toLowerCase() === entry.name.toLowerCase() ||
                      (entry.email && a.name.toLowerCase() === entry.email.split('@')[0].toLowerCase())
                  );

                  return (
                    <div
                      key={entry.id}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                        isSelectedForReach
                          ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-400 dark:border-blue-500/70'
                          : 'bg-slate-50/70 dark:bg-zinc-800/50 border-slate-200/80 dark:border-zinc-700/70 hover:border-slate-300 dark:hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={isSelectedForReach}
                          onChange={() => toggleSelectRecipient(entry)}
                          aria-label={`Select ${entry.name}`}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                        />

                        <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-100 flex items-center justify-center font-bold text-xs shrink-0">
                          {(entry.name || entry.email || 'A').charAt(0).toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {entry.name}
                            </span>
                            <span
                              className={`text-[9.5px] font-bold uppercase px-1.5 py-0.2 rounded border ${roleBadgeStyle(
                                entry.role
                              )}`}
                              title={`Assigned Access: ${
                                entryRoleDef.permissions
                                  .map(
                                    (pk) =>
                                      ROLE_PERMISSION_CATALOG.find((p) => p.key === pk)?.label || pk
                                  )
                                  .join(', ') || 'View-only'
                              }`}
                            >
                              {roleLabelText(entry.role)}
                            </span>
                            <span className="text-[9.5px] font-semibold px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-zinc-700/70 text-slate-600 dark:text-zinc-300">
                              {entryRoleDef.permissions.length} access
                            </span>
                            {liveFloorMatch && (
                              <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                Active on Sheet ({liveFloorMatch.encodingRanges.length + liveFloorMatch.checkingRanges.length} CS blocks)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 flex-wrap">
                            {entry.email && (
                              <span className="font-mono truncate">{entry.email}</span>
                            )}
                            {entry.branchName && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-zinc-400">
                                <Building2 className="w-3 h-3" />
                                <span>{entry.branchName}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap sm:flex-nowrap">
                        {/* Designation / Role Selector (Dynamic Roles + Edit Role Button) */}
                        <div className="flex items-center gap-1">
                          <select
                            value={entryRoleDef.id}
                            onChange={(e) => {
                              if (e.target.value === '__new__') {
                                handleStartAddRole();
                                document
                                  .getElementById('admin-add-auditor-panel')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                return;
                              }
                              handleUpdateEntryRole(entry, e.target.value);
                            }}
                            aria-label={`Designation for ${entry.name}`}
                            className="text-[11px] font-semibold py-1 px-2 rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                            title="Change designation / role"
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} ({r.permissions.length} access)
                              </option>
                            ))}
                            <option value="__new__">+ Add / Edit Role Type...</option>
                          </select>

                          <button
                            type="button"
                            onClick={() => {
                              handleStartEditRole(entryRoleDef);
                              document
                                .getElementById('admin-add-auditor-panel')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                            className="p-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/50 dark:hover:bg-purple-900/50 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 transition cursor-pointer"
                            title={`Edit "${entryRoleDef.name}" role type & access permissions`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleQuickReachAuditor(entry)}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition shadow-2xs"
                          title="Reach this auditor"
                        >
                          <Send className="w-3 h-3" />
                          <span className="hidden sm:inline">Reach</span>
                        </button>

                        {entry.email && (
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyText(entry.email, `copy_${entry.id}`, `Copied ${entry.email}`)
                            }
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-zinc-700 transition cursor-pointer"
                            title="Copy email"
                          >
                            {copiedId === `copy_${entry.id}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleRemoveEntry(entry)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                          title="Remove email / auditor"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Floor Auditors from Current Branch Monitoring */}
          {activeMonitoringAuditors.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Auditors on Active Branch ({branch?.name})
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onOpenMonitoringTab}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  View Monitoring &rarr;
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeMonitoringAuditors.map((aud) => (
                  <div
                    key={aud.name}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {aud.name}
                      </div>
                      <div className="text-[10.5px] text-slate-500 dark:text-zinc-400 truncate">
                        {aud.encodingRanges.length > 0 && `Enc: ${aud.encodingRanges.slice(0, 2).join(', ')} `}
                        {aud.checkingRanges.length > 0 && `Chk: ${aud.checkingRanges.slice(0, 2).join(', ')}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDispatchCsRange(
                          [...aud.encodingRanges, ...aud.checkingRanges].slice(0, 2).join(', ')
                        );
                        setDispatchSubject(`[Audit Follow-up] ${aud.name} — ${branch?.name || 'Branch'}`);
                        setDispatchMessage(
                          `Hi ${aud.name}, checking in on your countsheet blocks (${[
                            ...aud.encodingRanges,
                            ...aud.checkingRanges,
                          ].join(', ')}) for ${branch?.name || 'the branch'}.`
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shrink-0 cursor-pointer transition"
                    >
                      Reach
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* =============================================================== */}
        {/* RIGHT COLUMN (5 cols): REACH AUDITORS (DISPATCH & GMAIL)        */}
        {/* =============================================================== */}
        <div className="lg:col-span-5 space-y-4">
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3.5">
            <PanelDecoration position="bottom-right" tier="playful" variant={3} />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Reach Auditors
                </h3>
              </div>
              <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                {resolvedRecipients.length} recipient{resolvedRecipients.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* Recipient Mode Selector */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700">
              {(
                [
                  { id: 'all', label: 'All Auditors' },
                  { id: 'branch', label: 'Active Branch' },
                  { id: 'selected', label: `Selected (${selectedEmails.length})` },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTargetMode(opt.id)}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition cursor-pointer truncate ${
                    targetMode === opt.id
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-600 dark:text-zinc-300 hover:bg-white/60 dark:hover:bg-zinc-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Quick Templates */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                Quick Templates
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => applyTemplate('assign')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 dark:bg-zinc-800 dark:hover:bg-blue-950/40 text-slate-700 dark:text-zinc-300 text-[11px] font-semibold border border-slate-200/80 dark:border-zinc-700 cursor-pointer transition"
                >
                  Assign CS
                </button>
                <button
                  type="button"
                  onClick={() => applyTemplate('recount')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 dark:bg-zinc-800 dark:hover:bg-rose-950/40 text-slate-700 dark:text-zinc-300 text-[11px] font-semibold border border-slate-200/80 dark:border-zinc-700 cursor-pointer transition"
                >
                  Variance Recount
                </button>
                <button
                  type="button"
                  onClick={() => applyTemplate('submit')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-amber-50 dark:bg-zinc-800 dark:hover:bg-amber-950/40 text-slate-700 dark:text-zinc-300 text-[11px] font-semibold border border-slate-200/80 dark:border-zinc-700 cursor-pointer transition"
                >
                  Submit Pending
                </button>
                <button
                  type="button"
                  onClick={() => applyTemplate('sync')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 dark:bg-zinc-800 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-zinc-300 text-[11px] font-semibold border border-slate-200/80 dark:border-zinc-700 cursor-pointer transition"
                >
                  Re-sync Notice
                </button>
              </div>
            </div>

            <form onSubmit={handleSendDispatch} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                    Priority
                  </label>
                  <select
                    value={dispatchPriority}
                    onChange={(e) => setDispatchPriority(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="important">Important</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                    CS Range (Optional)
                  </label>
                  <input
                    type="text"
                    value={dispatchCsRange}
                    onChange={(e) => setDispatchCsRange(e.target.value)}
                    placeholder="e.g. CS01–CS10"
                    className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={dispatchSubject}
                  onChange={(e) => setDispatchSubject(e.target.value)}
                  placeholder={`[Audit] ${branch?.name || 'Branch'} Update`}
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
                  Message / Instructions
                </label>
                <textarea
                  rows={3}
                  value={dispatchMessage}
                  onChange={(e) => setDispatchMessage(e.target.value)}
                  placeholder="Write instructions, countsheet assignments, or recount requests for auditors..."
                  className="w-full p-3 text-xs rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Action Buttons: In-App Dispatch + Gmail Compose + Copy */}
              <div className="space-y-2 pt-1">
                <button
                  type="submit"
                  disabled={isSending}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-sm active:scale-98"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Dispatch to Auditors</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={gmailComposeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 text-slate-800 dark:text-zinc-100 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                  >
                    <Mail className="w-3.5 h-3.5 text-rose-500" />
                    <span>Email via Gmail</span>
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </a>

                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        `To: ${recipientEmailList.join(', ')}\nSubject: ${
                          dispatchSubject || 'Audit Dispatch'
                        }\n\n${dispatchMessage}`,
                        'copy_dispatch_all',
                        'Copied emails & message'
                      )
                    }
                    className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 text-slate-800 dark:text-zinc-100 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
                  >
                    <Copy className="w-3.5 h-3.5 text-blue-500" />
                    <span>Copy Message</span>
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Recent Dispatches Log */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Recent Dispatches ({messages.length})
                </h3>
              </div>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleDeleteMessage('all')}
                  className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>

            {messages.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 dark:text-zinc-500">
                No dispatches sent yet. Use the panel above to reach auditors.
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/70 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-[9.5px] font-extrabold uppercase px-1.5 py-0.2 rounded ${
                            msg.priority === 'urgent'
                              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                              : msg.priority === 'important'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                              : 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30'
                          }`}
                        >
                          {msg.priority}
                        </span>
                        {msg.csRange && (
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-200">
                            {msg.csRange}
                          </span>
                        )}
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {msg.subject}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(msg.id)}
                        className="text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer shrink-0"
                        title="Delete dispatch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
                      {msg.message}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-1 text-[10.5px] text-slate-400 dark:text-zinc-500">
                      <span className="truncate">To: {msg.recipientName}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleAcknowledge(msg)}
                          className={`px-2 py-0.5 rounded-md font-bold cursor-pointer transition ${
                            msg.status === 'acknowledged'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-300'
                          }`}
                        >
                          {msg.status === 'acknowledged' ? 'Acknowledged' : 'Mark Seen'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
