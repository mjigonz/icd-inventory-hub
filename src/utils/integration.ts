/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { NavTab } from '../components/BottomNav';

/**
 * Standard supported feature names for deep linking and external integrations.
 */
export type AppFeature = 'home' | 'count' | 'inventory' | 'monitoring' | 'audit';

export const SUPPORTED_FEATURES: readonly AppFeature[] = [
  'home',
  'count',
  'inventory',
  'monitoring',
  'audit',
] as const;

/**
 * Parsed integration & navigation query parameters.
 * Note: These parameters are strictly navigation and context cues.
 * They MUST NOT be trusted as authorization or security boundaries.
 */
export interface IntegrationParams {
  /** Target branch name or keyword (e.g. "BATANGAS") */
  branch: string | null;
  /** Validated target feature, or null if missing/unrecognized */
  feature: AppFeature | null;
  /** Raw feature string passed in the URL before validation */
  rawFeature: string | null;
  /** Target Google Sheets spreadsheet ID (e.g. "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms") */
  spreadsheetId: string | null;
  /** True if any recognized integration parameter was provided */
  hasParams: boolean;
}

/**
 * Validates whether a given string is a supported AppFeature.
 */
export function isValidFeature(feature: unknown): feature is AppFeature {
  if (typeof feature !== 'string') return false;
  const normalized = feature.trim().toLowerCase();
  return (SUPPORTED_FEATURES as readonly string[]).includes(normalized);
}

/**
 * Parses and normalizes a feature string into a supported AppFeature or null.
 * Gracefully handles common aliases while strictly falling back to null for unknown features.
 */
export function parseFeature(rawFeature: string | null | undefined): AppFeature | null {
  if (!rawFeature) return null;
  const clean = rawFeature.trim().toLowerCase();

  switch (clean) {
    case 'home':
    case 'branch':
    case 'branches':
    case 'dashboard':
      return 'home';
    case 'count':
    case 'countsheet':
    case 'countsheets':
    case 'counting':
      return 'count';
    case 'inventory':
    case 'items':
    case 'catalog':
      return 'inventory';
    case 'monitoring':
    case 'monitor':
    case 'blocks':
      return 'monitoring';
    case 'audit':
    case 'audits':
    case 'audit-report':
    case 'report':
      return 'audit';
    default:
      // Unknown feature: returns null for safe fallback to normal landing
      return null;
  }
}

/**
 * Sanitizes a string parameter to prevent control character injection
 * while preserving valid branch names and spreadsheet IDs.
 */
function sanitizeParam(value: string | null | undefined, maxLength = 200): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Remove control characters and limit length
  const cleaned = trimmed.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').slice(0, maxLength);
  return cleaned || null;
}

/**
 * Reads and parses URL query parameters for external deep links.
 *
 * @param customSearch Optional URL or search string (defaults to window.location.search)
 * @returns IntegrationParams with sanitized branch, spreadsheetId, and validated feature
 */
export function getIntegrationParams(customSearch?: string): IntegrationParams {
  let search = '';

  if (typeof customSearch === 'string') {
    if (customSearch.includes('?')) {
      search = customSearch.slice(customSearch.indexOf('?'));
    } else {
      search = customSearch.startsWith('&') ? `?${customSearch.slice(1)}` : `?${customSearch}`;
    }
  } else if (typeof window !== 'undefined' && window.location) {
    search = window.location.search;
  }

  const params = new URLSearchParams(search);

  const rawBranch = params.get('branch');
  const rawFeature = params.get('feature');
  const rawSpreadsheetId = params.get('spreadsheetId') || params.get('sheetId');

  const branch = sanitizeParam(rawBranch, 120);
  const spreadsheetId = sanitizeParam(rawSpreadsheetId, 150);
  const feature = parseFeature(rawFeature);

  const hasParams = Boolean(branch || rawFeature || spreadsheetId);

  return {
    branch,
    feature,
    rawFeature: rawFeature ? rawFeature.trim() : null,
    spreadsheetId,
    hasParams,
  };
}

/**
 * Resolves the navigation state (tab and modal status) from the requested feature.
 *
 * Rules:
 * - 'home' -> 'branch' view
 * - 'count' -> 'count' view
 * - 'inventory' -> 'inventory' view
 * - 'monitoring' -> 'monitoring' view
 * - 'audit' -> opens Audit Report modal
 * - null/unknown -> preserves normal landing behavior
 *
 * @param feature Validated feature or null
 * @param hasActiveBranch Whether a branch is currently selected in app state
 */
export function resolveFeatureNavigation(
  feature: AppFeature | null,
  hasActiveBranch: boolean
): { tab: NavTab; openAuditModal: boolean } {
  switch (feature) {
    case 'home':
      return { tab: 'branch', openAuditModal: false };
    case 'count':
      return { tab: 'count', openAuditModal: false };
    case 'inventory':
      return { tab: 'inventory', openAuditModal: false };
    case 'monitoring':
      return { tab: 'monitoring', openAuditModal: false };
    case 'audit':
      // Open the Audit Report modal; stay on active branch tab or default to branch
      return { tab: hasActiveBranch ? 'count' : 'branch', openAuditModal: true };
    default:
      // Normal landing behavior: count if branch active, else branch selection
      return { tab: hasActiveBranch ? 'count' : 'branch', openAuditModal: false };
  }
}

/**
 * Helper to build an external integration deep-link URL.
 * Designed for use by external caller applications (e.g. Vercel-hosted portals).
 *
 * Example:
 * buildIntegrationUrl({
 *   baseUrl: 'https://inventory-hub.pages.dev',
 *   branch: 'BATANGAS',
 *   feature: 'count'
 * })
 * // -> "https://inventory-hub.pages.dev/?branch=BATANGAS&feature=count"
 */
export function buildIntegrationUrl(options: {
  baseUrl?: string;
  branch?: string;
  feature?: AppFeature | string;
  spreadsheetId?: string;
}): string {
  const { baseUrl = '', branch, feature, spreadsheetId } = options;
  const params = new URLSearchParams();

  if (branch && branch.trim()) {
    params.set('branch', branch.trim());
  }

  if (spreadsheetId && spreadsheetId.trim()) {
    params.set('spreadsheetId', spreadsheetId.trim());
  }

  if (feature && String(feature).trim()) {
    params.set('feature', String(feature).trim().toLowerCase());
  }

  const queryString = params.toString();
  if (!queryString) return baseUrl || '/';

  if (!baseUrl) {
    return `/?${queryString}`;
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${queryString}`;
}
