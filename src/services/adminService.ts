/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RolePermissionKey =
  | 'admin_console'      // Access Admin Console & Settings
  | 'create_encoding'    // Use Create Encoding (Audit Report Mapper)
  | 'create_countsheet'  // Use Create Countsheets
  | 'view_forms'         // Access Forms (Preview & Print ICD Forms)
  | 'branch_manage'      // Manage & Sync Branch Spreadsheets
  | 'count_items'        // Count Items & Plot Quantities in CS
  | 'inventory_edit'     // View & Edit Masterdata / Local Inventory
  | 'monitoring_manage'; // View & Update Monitoring Tab / Blocks

export type RoleBadgeColor =
  | 'purple'
  | 'amber'
  | 'blue'
  | 'emerald'
  | 'rose'
  | 'indigo'
  | 'cyan'
  | 'slate';

export interface AdminRoleDefinition {
  id: string;
  name: string;
  description: string;
  color: RoleBadgeColor;
  permissions: RolePermissionKey[];
  isSystem?: boolean;
  updatedAt?: string;
}

export interface AdminDirectoryEntry {
  id: string;
  email: string;
  name: string;
  role: string;
  branchName: string;
  status: 'active' | 'on_field' | 'standby';
  createdAt: string;
}

export const LOCAL_DIR_KEY = 'countsheet_admin_directory_v1';
export const ADMIN_DIRECTORY_EVENT = 'countsheet_admin_directory_updated';

export const LOCAL_ROLES_KEY = 'countsheet_admin_roles_v2';
export const ADMIN_ROLES_EVENT = 'countsheet_admin_roles_updated';

// Strictly only this email can access the Admin Console
export const ADMIN_ONLY_EMAIL = 'icdhubsystems@gmail.com';
export const DEFAULT_SUPER_ADMIN_EMAILS = [ADMIN_ONLY_EMAIL];

export const ROLE_PERMISSION_CATALOG: Array<{
  key: RolePermissionKey;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    key: 'admin_console',
    label: 'Admin Console Access',
    shortLabel: 'Admin Console',
    description: 'Admin Console settings, Drive links, and dispatches (Strictly restricted to icdhubsystems@gmail.com)',
  },
  {
    key: 'create_encoding',
    label: 'Create Encoding',
    shortLabel: 'Create Encoding',
    description: 'Generate and map Overall Count / Audit Encoding reports',
  },
  {
    key: 'create_countsheet',
    label: 'Create Countsheet',
    shortLabel: 'Create Countsheet',
    description: 'Create and print Random / Periodic Inventory Countsheets',
  },
  {
    key: 'view_forms',
    label: 'Forms Access',
    shortLabel: 'Forms',
    description: 'View, download, and print official PDF audit forms',
  },
  {
    key: 'branch_manage',
    label: 'Branch Management',
    shortLabel: 'Branch Sync',
    description: 'Connect, switch, and re-sync branch Google Sheets',
  },
  {
    key: 'count_items',
    label: 'Count & Plot CS',
    shortLabel: 'Count & Plot CS',
    description: 'Scan items, record physical counts, and plot quantities to CS columns',
  },
  {
    key: 'inventory_edit',
    label: 'Masterdata & Local Inventory',
    shortLabel: 'Masterdata & Local',
    description: 'Search, inspect, and update Masterdata & Local branch items',
  },
  {
    key: 'monitoring_manage',
    label: 'Monitoring Tab Access',
    shortLabel: 'Monitoring',
    description: 'Assign and update CS blocks in the Monitoring tab',
  },
];

export const ALL_ROLE_PERMISSIONS: RolePermissionKey[] = [
  'admin_console',
  'create_encoding',
  'create_countsheet',
  'view_forms',
  'branch_manage',
  'count_items',
  'inventory_edit',
  'monitoring_manage',
];

export const DEFAULT_ROLE_DEFINITIONS: AdminRoleDefinition[] = [
  {
    id: 'internal_compliance_manager',
    name: 'Internal Compliance Manager',
    description: 'Full access to all compliance, encoding, countsheets, forms, branch, inventory, and monitoring tools',
    color: 'purple',
    permissions: [...ALL_ROLE_PERMISSIONS],
    isSystem: true,
  },
  {
    id: 'assistant_manager_reach',
    name: 'Assistant Manager - Reach',
    description: 'Full access to all compliance, encoding, countsheets, forms, branch, inventory, and monitoring tools',
    color: 'indigo',
    permissions: [...ALL_ROLE_PERMISSIONS],
    isSystem: true,
  },
  {
    id: 'assistant_manager_return',
    name: 'Assistant Manager - Return',
    description: 'Full access to all compliance, encoding, countsheets, forms, branch, inventory, and monitoring tools',
    color: 'cyan',
    permissions: [...ALL_ROLE_PERMISSIONS],
    isSystem: true,
  },
  {
    id: 'internal_compliance_supervisor',
    name: 'Internal Compliance Supervisor',
    description: 'Full access to all compliance, encoding, countsheets, forms, branch, inventory, and monitoring tools',
    color: 'amber',
    permissions: [...ALL_ROLE_PERMISSIONS],
    isSystem: true,
  },
  {
    id: 'senior_auditor',
    name: 'Senior Auditor',
    description: 'Full access to all compliance, encoding, countsheets, forms, branch, inventory, and monitoring tools',
    color: 'blue',
    permissions: [...ALL_ROLE_PERMISSIONS],
    isSystem: true,
  },
  {
    id: 'junior_auditor',
    name: 'Junior Auditor',
    description: 'Full access to all compliance, encoding, countsheets, forms, branch, inventory, and monitoring tools',
    color: 'emerald',
    permissions: [...ALL_ROLE_PERMISSIONS],
    isSystem: true,
  },
  {
    id: 'internal_compliance_assistant_junior_auditor',
    name: 'Internal Compliance Assitant / Junior Auditor',
    description: 'Full access to all compliance, encoding, countsheets, forms, branch, inventory, and monitoring tools',
    color: 'rose',
    permissions: [...ALL_ROLE_PERMISSIONS],
    isSystem: true,
  },
];

export const DEFAULT_ADMIN_CODES = ['ICD2026', 'SIDC2026', 'ADMIN', '1234'];

const LEGACY_ROLE_ID_MAP: Record<string, string> = {
  admin: 'internal_compliance_manager',
  lead_auditor: 'internal_compliance_supervisor',
  auditor: 'senior_auditor',
  branch_email: 'internal_compliance_assistant_junior_auditor',
};

/**
 * Normalizes and merges role definitions so default roles are always present while preserving edits and custom roles.
 */
export function normalizeRoleDefinitions(rawList?: any[]): AdminRoleDefinition[] {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return DEFAULT_ROLE_DEFINITIONS;
  }

  const validPermSet = new Set<RolePermissionKey>(ROLE_PERMISSION_CATALOG.map((p) => p.key));
  const byId = new Map<string, AdminRoleDefinition>();

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rawId = String(item.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    // Skip obsolete legacy 4-role defaults if they were stored earlier
    if (rawId in LEGACY_ROLE_ID_MAP && DEFAULT_ROLE_DEFINITIONS.every((d) => d.id !== rawId)) {
      continue;
    }
    const id = rawId;
    const name = String(item.name || '').trim();
    if (!id || !name) continue;

    const rawPerms = Array.isArray(item.permissions) ? item.permissions : [];
    const permissions = rawPerms.filter((p: any): p is RolePermissionKey =>
      validPermSet.has(p as RolePermissionKey)
    );

    const defMatch = DEFAULT_ROLE_DEFINITIONS.find((d) => d.id === id);
    byId.set(id, {
      id,
      name,
      description: String(item.description ?? defMatch?.description ?? '').trim(),
      color: (item.color as RoleBadgeColor) || defMatch?.color || 'blue',
      permissions: permissions.length > 0 ? permissions : [...ALL_ROLE_PERMISSIONS],
      isSystem: Boolean(defMatch || item.isSystem),
      updatedAt: item.updatedAt,
    });
  }

  if (byId.size === 0) {
    return DEFAULT_ROLE_DEFINITIONS;
  }

  return Array.from(byId.values());
}

export function getAdminRoleDefinitions(): AdminRoleDefinition[] {
  try {
    const raw = localStorage.getItem(LOCAL_ROLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return normalizeRoleDefinitions(parsed);
      }
    }
  } catch {}
  return DEFAULT_ROLE_DEFINITIONS;
}

export function saveAdminRoleDefinitionsLocal(roles: AdminRoleDefinition[]): AdminRoleDefinition[] {
  const normalized = normalizeRoleDefinitions(roles);
  try {
    localStorage.setItem(LOCAL_ROLES_KEY, JSON.stringify(normalized));
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(ADMIN_ROLES_EVENT, { detail: { roles: normalized } })
    );
  }
  return normalized;
}

export async function saveAdminRoleDefinitions(
  roles: AdminRoleDefinition[]
): Promise<AdminRoleDefinition[]> {
  const normalized = saveAdminRoleDefinitionsLocal(roles);
  try {
    await fetch('/api/admin/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: normalized }),
    });
  } catch (err) {
    console.warn('Could not sync roles to server:', err);
  }
  return normalized;
}

export async function fetchAdminRoleDefinitionsFromServer(): Promise<AdminRoleDefinition[]> {
  try {
    const res = await fetch(`/api/admin/roles?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.roles) && data.roles.length > 0) {
        return saveAdminRoleDefinitionsLocal(data.roles);
      }
    }
  } catch {}
  return getAdminRoleDefinitions();
}

export async function fetchAdminDirectoryFromServer(): Promise<AdminDirectoryEntry[]> {
  try {
    const res = await fetch(`/api/admin/directory?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.entries)) {
        broadcastDirectoryUpdate(data.entries);
        return data.entries;
      }
    }
  } catch {}
  try {
    const raw = localStorage.getItem(LOCAL_DIR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function subscribeToRoleDefinitions(
  callback: (roles: AdminRoleDefinition[]) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ roles?: AdminRoleDefinition[] }>;
    callback(custom.detail?.roles || getAdminRoleDefinitions());
  };

  const storageHandler = (e: StorageEvent) => {
    if (e.key === LOCAL_ROLES_KEY) {
      callback(getAdminRoleDefinitions());
    }
  };

  window.addEventListener(ADMIN_ROLES_EVENT, handler);
  window.addEventListener('storage', storageHandler);

  return () => {
    window.removeEventListener(ADMIN_ROLES_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function getRoleDefinitionById(
  roleId: string | null | undefined,
  roles?: AdminRoleDefinition[]
): AdminRoleDefinition {
  const list = roles || getAdminRoleDefinitions();
  const rawId = String(roleId || 'senior_auditor').trim().toLowerCase();
  const mappedId = LEGACY_ROLE_ID_MAP[rawId] || rawId;
  return (
    list.find((r) => r.id.toLowerCase() === mappedId || r.name.toLowerCase() === rawId) ||
    list.find((r) => r.id === 'senior_auditor') ||
    list[0] ||
    DEFAULT_ROLE_DEFINITIONS[4]
  );
}

export function doesRoleHavePermission(
  roleId: string | null | undefined,
  permission: RolePermissionKey,
  roles?: AdminRoleDefinition[]
): boolean {
  if (!roleId) return false;
  // All roles can access all features except the admin feature/admin console
  if (permission !== 'admin_console') {
    return true;
  }
  const def = getRoleDefinitionById(roleId, roles);
  return def.permissions.includes('admin_console');
}

export function getRoleBadgeClasses(color: RoleBadgeColor): string {
  switch (color) {
    case 'purple':
      return 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30';
    case 'amber':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
    case 'emerald':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    case 'rose':
      return 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30';
    case 'indigo':
      return 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30';
    case 'cyan':
      return 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30';
    case 'slate':
      return 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30';
    case 'blue':
    default:
      return 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30';
  }
}

/**
 * Verifies whether the provided password/access code matches the configured custom admin code
 * or one of the system default admin codes.
 */
export function verifyAdminPassword(inputCode: string | null | undefined): boolean {
  const trimmed = (inputCode || '').trim();
  if (!trimmed) return false;

  let customCode = '';
  try {
    customCode = (localStorage.getItem('countsheet_custom_admin_code') || '').trim();
  } catch {
    // ignore storage errors
  }

  return Boolean(
    (customCode && trimmed.toLowerCase() === customCode.toLowerCase()) ||
      DEFAULT_ADMIN_CODES.some((code) => code.toLowerCase() === trimmed.toLowerCase())
  );
}

/**
 * Checks synchronously whether the given email has admin rights.
 * Admin Console is strictly restricted to icdhubsystems@gmail.com.
 */
export function isUserAdminFromLocal(
  email: string | null | undefined,
  _directory?: AdminDirectoryEntry[],
  _roles?: AdminRoleDefinition[]
): boolean {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  return cleanEmail === ADMIN_ONLY_EMAIL.toLowerCase();
}

/**
 * Returns the resolved role and permissions for a given email from local directory cache.
 * All roles have full operational access, while Admin Console is strictly accessible only to icdhubsystems@gmail.com.
 */
export function getUserRoleAndPermissionsFromLocal(
  email: string | null | undefined,
  directory?: AdminDirectoryEntry[],
  roles?: AdminRoleDefinition[]
): { roleId: string; roleDefinition: AdminRoleDefinition; isAdmin: boolean } {
  const roleList = roles || getAdminRoleDefinitions();
  if (!email) {
    const auditorDef = getRoleDefinitionById('senior_auditor', roleList);
    return { roleId: auditorDef.id, roleDefinition: auditorDef, isAdmin: false };
  }

  const cleanEmail = email.trim().toLowerCase();
  const isStrictAdmin = cleanEmail === ADMIN_ONLY_EMAIL.toLowerCase();

  let dirList = directory;
  if (!dirList) {
    try {
      const raw = localStorage.getItem(LOCAL_DIR_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) dirList = parsed;
      }
    } catch {
      dirList = [];
    }
  }

  const entry = dirList?.find((item) => item?.email && item.email.trim().toLowerCase() === cleanEmail);
  const rawRoleId = entry?.role || (isStrictAdmin ? 'internal_compliance_manager' : 'senior_auditor');
  const roleDefinition = getRoleDefinitionById(rawRoleId, roleList);

  return {
    roleId: roleDefinition.id,
    roleDefinition,
    isAdmin: isStrictAdmin,
  };
}

/**
 * Verifies with the server whether the given email or auth token has admin rights.
 * Admin Console is strictly restricted to icdhubsystems@gmail.com.
 */
export async function verifyUserAdminAccess(
  email: string | null | undefined,
  token?: string | null
): Promise<{ isAdmin: boolean; role: string; permissions?: RolePermissionKey[] }> {
  if (!email) return { isAdmin: false, role: 'guest' };
  const cleanEmail = email.trim().toLowerCase();
  const isStrictAdmin = cleanEmail === ADMIN_ONLY_EMAIL.toLowerCase();

  try {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`/api/admin/check-access?email=${encodeURIComponent(cleanEmail)}`, {
      headers,
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.roles) && data.roles.length > 0) {
        saveAdminRoleDefinitionsLocal(data.roles);
      }
      const roleId = data.role || (isStrictAdmin ? 'internal_compliance_manager' : 'senior_auditor');
      const roleDef = getRoleDefinitionById(roleId);
      return {
        isAdmin: isStrictAdmin,
        role: roleDef.id,
        permissions: roleDef.permissions,
      };
    }
  } catch (err) {
    console.warn('Could not verify admin access with server, falling back to local cache:', err);
  }

  // Fallback to local cache evaluation
  const localInfo = getUserRoleAndPermissionsFromLocal(cleanEmail);
  return {
    isAdmin: isStrictAdmin,
    role: localInfo.roleId,
    permissions: localInfo.roleDefinition.permissions,
  };
}

/**
 * Notify all components in the app that the admin directory has changed.
 */
export function broadcastDirectoryUpdate(updatedDirectory?: AdminDirectoryEntry[]) {
  if (updatedDirectory) {
    try {
      localStorage.setItem(LOCAL_DIR_KEY, JSON.stringify(updatedDirectory));
    } catch {}
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(ADMIN_DIRECTORY_EVENT, { detail: { directory: updatedDirectory } })
    );
  }
}

/**
 * Subscribe to admin directory changes.
 */
export function subscribeToDirectoryUpdates(
  callback: (directory?: AdminDirectoryEntry[]) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ directory?: AdminDirectoryEntry[] }>;
    callback(custom.detail?.directory);
  };

  window.addEventListener(ADMIN_DIRECTORY_EVENT, handler);
  window.addEventListener('storage', (e) => {
    if (e.key === LOCAL_DIR_KEY) {
      callback();
    }
  });

  return () => {
    window.removeEventListener(ADMIN_DIRECTORY_EVENT, handler);
  };
}

export interface MasterdataSheetInfo {
  name: string;
  count: number;
  isDefault?: boolean;
}

export interface MasterdataSheetsResponse {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheets: MasterdataSheetInfo[];
  availableSheets?: string[];
  totalItems: number;
}

export async function fetchMasterdataSheetsInfo(
  spreadsheetUrl?: string,
  accessToken?: string | null
): Promise<MasterdataSheetsResponse> {
  const params = new URLSearchParams({ _ts: String(Date.now()) });
  if (spreadsheetUrl && spreadsheetUrl.trim()) {
    params.set('spreadsheetUrl', spreadsheetUrl.trim());
  }
  const headers: Record<string, string> = {};
  if (accessToken && accessToken.trim()) {
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }
  const res = await fetch(`/api/admin/masterdata/sheets?${params.toString()}`, { headers });
  if (!res.ok) {
    throw new Error('Failed to load masterdata sheets');
  }
  return res.json();
}

export async function addMasterdataSheet(
  sheetName: string,
  spreadsheetUrl?: string,
  accessToken?: string | null
): Promise<{ success: boolean; sheetName: string; addedCount: number; totalItems: number; sheets: MasterdataSheetInfo[] }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken && accessToken.trim()) {
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }
  const res = await fetch('/api/admin/masterdata/sheets', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sheetName, spreadsheetUrl }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to add sheet');
  }
  return data;
}

export async function removeMasterdataSheet(
  sheetName: string
): Promise<{ success: boolean; sheetName: string; totalItems: number; sheets: MasterdataSheetInfo[] }> {
  const isRemoveAll = sheetName === '__ALL__';
  const res = await fetch('/api/admin/masterdata/sheets', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheetName, removeAll: isRemoveAll }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to remove sheet');
  }
  return data;
}

export async function syncMasterdataSheet(
  sheetName?: string,
  spreadsheetUrl?: string
): Promise<{ success: boolean; totalItems: number; sheets: MasterdataSheetInfo[] }> {
  const res = await fetch('/api/admin/masterdata/sheets/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheetName, spreadsheetUrl }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to sync sheets');
  }
  return data;
}
