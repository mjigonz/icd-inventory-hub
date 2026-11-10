import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  FolderOpen,
  Search,
  RefreshCw,
  Printer,
  Eye,
  ExternalLink,
  X,
  Upload,
  Check,
  AlertCircle,
  Download,
  ChevronRight,
  FolderPlus,
  Link2,
} from 'lucide-react';
import {
  getStoredOAuthToken,
  isGoogleOAuthAccessToken,
  refreshGoogleAccessToken,
  resolveValidOAuthToken,
} from '../services/auth';
import {
  ensureUserDriveFolder,
  getAdminDriveLinksConfig,
  extractDriveResourceFromLink,
  subscribeToAdminDriveLinks,
} from '../services/auditReportService';
import { useScrollLock } from '../hooks/useScrollLock';

export interface DriveFolderItem {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
  ownerEmail?: string;
}

export interface DrivePdfFormFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  parents?: string[];
  ownerEmail?: string;
}

interface FormsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  onTokenRefreshed?: (newToken: string) => void;
}

const SAVED_FORMS_FOLDER_STORAGE_KEY = 'countsheet_icd_forms_drive_folder_v2';
export const DEFAULT_FORMS_FOLDER_NAME = 'ICD FORMS';
export const FORMS_OWNER_EMAIL = 'icdhubsystems@gmail.com';
const HUB_FORMS_SYNC_KEY = 'icdhubsystems_icd_forms_v1';

export function extractDriveFolderId(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch && folderMatch[1]) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch && idParamMatch[1]) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return trimmed;
}

function formatFileSize(bytesStr?: string, mimeType?: string): string {
  if (!bytesStr) {
    if (mimeType && mimeType.includes('google-apps')) return 'Google Doc PDF';
    return 'PDF';
  }
  const bytes = parseInt(bytesStr, 10);
  if (isNaN(bytes) || bytes <= 0) return 'PDF';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isPlaceholderFolderId(id?: string | null): boolean {
  if (!id) return true;
  const clean = id.trim();
  return (
    !clean ||
    clean.startsWith('hub_') ||
    clean.startsWith('default_') ||
    clean.startsWith('icd-form-')
  );
}

export const FormsModal: React.FC<FormsModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  onTokenRefreshed,
}) => {
  useScrollLock(isOpen);

  const [localToken, setLocalToken] = useState<string | null>(accessToken);
  const [hubAccountToken, setHubAccountToken] = useState<string | null>(null);
  const effectiveToken = hubAccountToken || localToken || accessToken || getStoredOAuthToken();

  // Folder state
  const [folders, setFolders] = useState<DriveFolderItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<DriveFolderItem | null>(() => {
    try {
      const adminForms = extractDriveResourceFromLink(getAdminDriveLinksConfig().formsLocationLink);
      if (adminForms && !isPlaceholderFolderId(adminForms.id)) {
        return {
          id: adminForms.id,
          name: DEFAULT_FORMS_FOLDER_NAME,
          webViewLink: adminForms.webViewLink,
          ownerEmail: FORMS_OWNER_EMAIL,
        };
      }
      const raw = localStorage.getItem(SAVED_FORMS_FOLDER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && !isPlaceholderFolderId(parsed.id)) {
          return parsed;
        }
        localStorage.removeItem(SAVED_FORMS_FOLDER_STORAGE_KEY);
      }
    } catch {}
    return null;
  });
  const [folderScopeMode, setFolderScopeMode] = useState<'FOLDER' | 'ALL_DRIVE'>('FOLDER');
  const [showFolderPicker, setShowFolderPicker] = useState<boolean>(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState<string>('');
  const [customFolderUrlInput, setCustomFolderUrlInput] = useState<string>('');
  const [isCreatingFormsFolder, setIsCreatingFormsFolder] = useState<boolean>(false);

  // PDF files state
  const [pdfFiles, setPdfFiles] = useState<DrivePdfFormFile[]>([]);
  const [pdfSearchQuery, setPdfSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Selected PDF for Preview & Print
  const [activePdf, setActivePdf] = useState<DrivePdfFormFile | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<'BLOB' | 'DRIVE_EMBED'>('BLOB');
  const [isPrintingId, setIsPrintingId] = useState<string | null>(null);

  // Upload PDF to current folder
  const [isUploadingPdf, setIsUploadingPdf] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (accessToken && isGoogleOAuthAccessToken(accessToken)) {
      setLocalToken(accessToken);
    }
  }, [accessToken]);

  // Clean up object URL when changing active PDF or closing modal
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const saveSelectedFolderPreference = (folder: DriveFolderItem | null) => {
    const validFolder = folder && !isPlaceholderFolderId(folder.id) ? folder : null;
    setSelectedFolder(validFolder);
    try {
      if (validFolder) {
        localStorage.setItem(SAVED_FORMS_FOLDER_STORAGE_KEY, JSON.stringify(validFolder));
      } else {
        localStorage.removeItem(SAVED_FORMS_FOLDER_STORAGE_KEY);
      }
    } catch {}
  };

  // Try fetching synced hub token or folder metadata for icdhubsystems@gmail.com
  const fetchSyncedHubTokenAndFolder = async (): Promise<{
    hubToken: string | null;
    hubFolder: DriveFolderItem | null;
  }> => {
    let resolvedHubToken: string | null = null;
    let resolvedHubFolder: DriveFolderItem | null = null;

    try {
      const [ownerWorkspaceRes, hubFormsRes] = await Promise.all([
        fetch(`/api/sync/workspace/${encodeURIComponent(FORMS_OWNER_EMAIL)}`).catch(() => null),
        fetch(`/api/sync/workspace/${encodeURIComponent(HUB_FORMS_SYNC_KEY)}`).catch(() => null),
      ]);

      if (hubFormsRes && hubFormsRes.ok) {
        const hubData = await hubFormsRes.json();
        const state = hubData?.state;
        if (state?.oauthAccessToken && isGoogleOAuthAccessToken(state.oauthAccessToken)) {
          resolvedHubToken = state.oauthAccessToken;
        }
        if (
          state?.icdFormsFolder &&
          state.icdFormsFolder.id &&
          !isPlaceholderFolderId(state.icdFormsFolder.id)
        ) {
          resolvedHubFolder = state.icdFormsFolder as DriveFolderItem;
        }
      }

      if (!resolvedHubToken && ownerWorkspaceRes && ownerWorkspaceRes.ok) {
        const ownerData = await ownerWorkspaceRes.json();
        const state = ownerData?.state;
        if (state?.oauthAccessToken && isGoogleOAuthAccessToken(state.oauthAccessToken)) {
          resolvedHubToken = state.oauthAccessToken;
        }
      }
    } catch {}

    return { hubToken: resolvedHubToken, hubFolder: resolvedHubFolder };
  };

  const syncHubFormsConfigToCloud = async (tokenToSave?: string, folderToSave?: DriveFolderItem) => {
    try {
      const payload: Record<string, any> = {
        ownerEmail: FORMS_OWNER_EMAIL,
        folderName: DEFAULT_FORMS_FOLDER_NAME,
        updatedAt: new Date().toISOString(),
      };
      if (tokenToSave && isGoogleOAuthAccessToken(tokenToSave)) {
        payload.oauthAccessToken = tokenToSave;
        payload.oauthTokenIssuedAt = Date.now();
      }
      if (folderToSave && folderToSave.id) {
        payload.icdFormsFolder = folderToSave;
      }
      await fetch(`/api/sync/workspace/${encodeURIComponent(HUB_FORMS_SYNC_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {}
  };

  // Search Google Drive specifically for the "ICD FORMS" folder from icdhubsystems@gmail.com
  const findIcdFormsFolderInDrive = async (
    token: string,
    allFolders: DriveFolderItem[]
  ): Promise<DriveFolderItem | null> => {
    // 1. Direct query for folder named "ICD FORMS" owned by icdhubsystems@gmail.com
    try {
      const exactOwnerQuery = `mimeType = 'application/vnd.google-apps.folder' and name = '${DEFAULT_FORMS_FOLDER_NAME}' and '${FORMS_OWNER_EMAIL}' in owners and trashed = false`;
      const exactOwnerUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        exactOwnerQuery
      )}&fields=files(id,name,webViewLink,modifiedTime,owners)&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`;

      const res = await fetch(exactOwnerUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data.files) && data.files.length > 0) {
          const f = data.files[0];
          return {
            id: f.id,
            name: f.name,
            webViewLink: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
            modifiedTime: f.modifiedTime,
            ownerEmail: f.owners?.[0]?.emailAddress || FORMS_OWNER_EMAIL,
          };
        }
      }
    } catch {}

    // 2. Direct query for folder named "ICD FORMS" across all accessible/shared drives
    try {
      const nameQuery = `mimeType = 'application/vnd.google-apps.folder' and name contains '${DEFAULT_FORMS_FOLDER_NAME}' and trashed = false`;
      const nameUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        nameQuery
      )}&fields=files(id,name,webViewLink,modifiedTime,owners)&pageSize=30&supportsAllDrives=true&includeItemsFromAllDrives=true`;

      const res = await fetch(nameUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: any = await res.json();
        const files: any[] = data.files || [];
        if (files.length > 0) {
          // Prioritize exact owner icdhubsystems@gmail.com, then exact name "ICD FORMS"
          const sorted = [...files].sort((a, b) => {
            const aOwnerMatch = (a.owners || []).some(
              (o: any) => String(o.emailAddress || '').toLowerCase() === FORMS_OWNER_EMAIL
            );
            const bOwnerMatch = (b.owners || []).some(
              (o: any) => String(o.emailAddress || '').toLowerCase() === FORMS_OWNER_EMAIL
            );
            if (aOwnerMatch && !bOwnerMatch) return -1;
            if (!aOwnerMatch && bOwnerMatch) return 1;

            const aExact = String(a.name || '').trim().toUpperCase() === DEFAULT_FORMS_FOLDER_NAME;
            const bExact = String(b.name || '').trim().toUpperCase() === DEFAULT_FORMS_FOLDER_NAME;
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;
            return 0;
          });
          const best = sorted[0];
          return {
            id: best.id,
            name: best.name,
            webViewLink: best.webViewLink || `https://drive.google.com/drive/folders/${best.id}`,
            modifiedTime: best.modifiedTime,
            ownerEmail: best.owners?.[0]?.emailAddress,
          };
        }
      }
    } catch {}

    // 3. Fallback check in already-loaded folder list
    const matchedInList =
      allFolders.find(
        (f) =>
          f.name.trim().toUpperCase() === DEFAULT_FORMS_FOLDER_NAME &&
          (!f.ownerEmail || f.ownerEmail.toLowerCase() === FORMS_OWNER_EMAIL)
      ) ||
      allFolders.find((f) => f.name.trim().toUpperCase() === DEFAULT_FORMS_FOLDER_NAME) ||
      allFolders.find((f) => /icd\s*forms?/i.test(f.name.trim()));

    return matchedInList || null;
  };

  // Discover folders and load PDFs from "ICD FORMS" (icdhubsystems@gmail.com)
  const loadDriveFoldersAndPdfs = async (
    overrideToken?: string,
    targetFolderOverride?: DriveFolderItem | null,
    scopeOverride?: 'FOLDER' | 'ALL_DRIVE'
  ) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const userToken =
        overrideToken ||
        (await resolveValidOAuthToken(localToken || accessToken, { allowPopup: false })) ||
        localToken ||
        accessToken ||
        getStoredOAuthToken() ||
        '';

      // 0. First check server-side Hub Cache (/api/hub/forms) for icdhubsystems@gmail.com ICD FORMS
      // so auditors never see a Firebase popup or permission error!
      let loadedFromServerCache = false;
      if ((scopeOverride || folderScopeMode) === 'FOLDER') {
        try {
          const hubHeaders: Record<string, string> = {};
          if (userToken && isGoogleOAuthAccessToken(userToken)) {
            hubHeaders.Authorization = `Bearer ${userToken}`;
          }
          const cachedRes = await fetch('/api/hub/forms', { headers: hubHeaders });
          if (cachedRes.ok) {
            const cachedData = await cachedRes.json();
            if (
              cachedData?.folder &&
              cachedData.folder.id &&
              !isPlaceholderFolderId(cachedData.folder.id)
            ) {
              setSelectedFolder(cachedData.folder);
            }
            if (Array.isArray(cachedData?.files) && cachedData.files.length > 0) {
              const serverFiles: DrivePdfFormFile[] = cachedData.files.map((f: any) => ({
                id: f.id,
                name: f.name,
                mimeType: f.mimeType || 'application/pdf',
                size: f.size,
                modifiedTime: f.modifiedTime,
                webViewLink:
                  f.webViewLink ||
                  (String(f.id || '').startsWith('icd-form-')
                    ? `/api/hub/forms/${f.id}/pdf`
                    : `https://drive.google.com/file/d/${f.id}/view`),
                webContentLink: f.webContentLink,
                ownerEmail: f.ownerEmail || FORMS_OWNER_EMAIL,
              }));
              setPdfFiles(serverFiles);
              loadedFromServerCache = true;
              if (!activePdf || !serverFiles.some((f) => f.id === activePdf.id)) {
                void handleSelectPdfForPreview(serverFiles[0], userToken || undefined);
              }
            }
          }
        } catch {}
      }

      const { hubToken, hubFolder } = await fetchSyncedHubTokenAndFolder();
      if (hubToken && isGoogleOAuthAccessToken(hubToken)) {
        setHubAccountToken(hubToken);
      }

      // Candidate tokens: try overrideToken first, then userToken, then hubToken
      const candidateTokens = Array.from(
        new Set(
          [overrideToken, userToken, hubToken].filter(
            (t): t is string => Boolean(t && isGoogleOAuthAccessToken(t))
          )
        )
      );

      if (candidateTokens.length === 0) {
        setIsLoading(false);
        return;
      }

      let verifiedWorkingToken: string | null = null;
      let discoveredFolders: DriveFolderItem[] = [];
      let foundIcdFormsFolder: DriveFolderItem | null = null;

      // Try candidate tokens to find "ICD FORMS"
      for (const tokenCandidate of candidateTokens) {
        try {
          const folderQuery =
            "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
          const foldersUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            folderQuery
          )}&fields=files(id,name,webViewLink,modifiedTime,owners)&orderBy=modifiedTime desc&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;

          const foldersRes = await fetch(foldersUrl, {
            headers: { Authorization: `Bearer ${tokenCandidate}` },
          });

          if (foldersRes.ok) {
            if (!verifiedWorkingToken) {
              verifiedWorkingToken = tokenCandidate;
            }
            const fData: any = await foldersRes.json();
            const currentFolders: DriveFolderItem[] = (fData.files || []).map((f: any) => ({
              id: f.id,
              name: f.name,
              webViewLink: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
              modifiedTime: f.modifiedTime,
              ownerEmail: f.owners?.[0]?.emailAddress,
            }));

            // Sort folders so "ICD FORMS" owned by icdhubsystems@gmail.com appears first
            currentFolders.sort((a, b) => {
              const aIsIcdForms = /^icd\s*forms?$/i.test(a.name.trim());
              const bIsIcdForms = /^icd\s*forms?$/i.test(b.name.trim());
              if (aIsIcdForms && !bIsIcdForms) return -1;
              if (!aIsIcdForms && bIsIcdForms) return 1;

              const aIsOwner = (a.ownerEmail || '').toLowerCase() === FORMS_OWNER_EMAIL;
              const bIsOwner = (b.ownerEmail || '').toLowerCase() === FORMS_OWNER_EMAIL;
              if (aIsOwner && !bIsOwner) return -1;
              if (!aIsOwner && bIsOwner) return 1;

              const aHasForm = /form/i.test(a.name);
              const bHasForm = /form/i.test(b.name);
              if (aHasForm && !bHasForm) return -1;
              if (!aHasForm && bHasForm) return 1;
              return a.name.localeCompare(b.name);
            });

            if (discoveredFolders.length === 0) {
              discoveredFolders = currentFolders;
            }

            const matched = await findIcdFormsFolderInDrive(tokenCandidate, currentFolders);
            if (matched && !isPlaceholderFolderId(matched.id)) {
              foundIcdFormsFolder = matched;
              verifiedWorkingToken = tokenCandidate;
              discoveredFolders = currentFolders;
              break;
            }
          }
        } catch {}
      }

      if (discoveredFolders.length > 0) {
        setFolders(discoveredFolders);
      }

      // If no candidate token could access Google Drive (e.g. token expired), keep server-cached forms without error
      if (!verifiedWorkingToken) {
        setIsLoading(false);
        return;
      }

      const workingToken = verifiedWorkingToken;

      // 2. Determine which folder or direct PDF to use from Admin Console (never use a synthetic placeholder ID)
      const adminConfiguredForms = extractDriveResourceFromLink(
        getAdminDriveLinksConfig().formsLocationLink
      );
      let folderToUse =
        targetFolderOverride !== undefined ? targetFolderOverride : selectedFolder;
      if (folderToUse && isPlaceholderFolderId(folderToUse.id)) {
        folderToUse = null;
      }

      let directAdminPdfFile: DrivePdfFormFile | null = null;

      if (
        targetFolderOverride === undefined &&
        adminConfiguredForms &&
        !isPlaceholderFolderId(adminConfiguredForms.id)
      ) {
        let resolvedFolderName = DEFAULT_FORMS_FOLDER_NAME;
        try {
          const adminMetaRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              adminConfiguredForms.id
            )}?fields=id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink,parents,owners&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${workingToken}` } }
          );
          if (adminMetaRes.ok) {
            const adminMeta: any = await adminMetaRes.json();
            if (adminMeta.name) resolvedFolderName = adminMeta.name;
            if (adminMeta.mimeType === 'application/pdf') {
              directAdminPdfFile = {
                id: adminMeta.id,
                name: adminMeta.name,
                mimeType: adminMeta.mimeType,
                size: adminMeta.size,
                modifiedTime: adminMeta.modifiedTime,
                webViewLink:
                  adminMeta.webViewLink || `https://drive.google.com/file/d/${adminMeta.id}/view`,
                webContentLink: adminMeta.webContentLink,
                iconLink: adminMeta.iconLink,
                parents: adminMeta.parents,
                ownerEmail: adminMeta.owners?.[0]?.emailAddress,
              };
            }
          }
        } catch {}

        const matchedDiscovered = discoveredFolders.find((d) => d.id === adminConfiguredForms.id);
        folderToUse = matchedDiscovered || {
          id: adminConfiguredForms.id,
          name: resolvedFolderName,
          webViewLink: adminConfiguredForms.webViewLink,
          ownerEmail: FORMS_OWNER_EMAIL,
        };
        saveSelectedFolderPreference(folderToUse);
      } else if (
        foundIcdFormsFolder &&
        (!folderToUse ||
          (targetFolderOverride === undefined &&
            folderToUse.name.trim().toUpperCase() !== DEFAULT_FORMS_FOLDER_NAME))
      ) {
        folderToUse = foundIcdFormsFolder;
        saveSelectedFolderPreference(foundIcdFormsFolder);
        void syncHubFormsConfigToCloud(workingToken, foundIcdFormsFolder);
      } else if (!folderToUse && hubFolder && !isPlaceholderFolderId(hubFolder.id)) {
        folderToUse = hubFolder;
        saveSelectedFolderPreference(hubFolder);
      }

      if (
        folderToUse &&
        !isPlaceholderFolderId(folderToUse.id) &&
        !discoveredFolders.some((d) => d.id === folderToUse!.id)
      ) {
        setFolders([folderToUse, ...discoveredFolders]);
      }

      const activeScope = scopeOverride || folderScopeMode;

      // 3. Query PDF files inside the Admin-configured folder or "ICD FORMS" folder (including any immediate subfolders)
      const candidateQueries: string[] = [];

      if (activeScope === 'FOLDER') {
        if (folderToUse?.id && !isPlaceholderFolderId(folderToUse.id)) {
          const parentIds = [folderToUse.id];
          try {
            const subFolderQuery = `'${folderToUse.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
            const subUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
              subFolderQuery
            )}&fields=files(id,name)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`;
            const subRes = await fetch(subUrl, {
              headers: { Authorization: `Bearer ${workingToken}` },
            });
            if (subRes.ok) {
              const subData: any = await subRes.json();
              for (const sf of subData.files || []) {
                if (sf.id && !parentIds.includes(sf.id)) {
                  parentIds.push(sf.id);
                }
              }
            }
          } catch {}

          const parentsClause =
            parentIds.length === 1
              ? `'${parentIds[0]}' in parents`
              : `(${parentIds.map((pid) => `'${pid}' in parents`).join(' or ')})`;

          candidateQueries.push(`${parentsClause} and mimeType = 'application/pdf' and trashed = false`);
        }

        if (!adminConfiguredForms) {
          candidateQueries.push(
            `'${FORMS_OWNER_EMAIL}' in owners and mimeType = 'application/pdf' and trashed = false`
          );
        }
      } else {
        candidateQueries.push(`mimeType = 'application/pdf' and trashed = false`);
      }

      let files: DrivePdfFormFile[] = directAdminPdfFile ? [directAdminPdfFile] : [];

      for (const q of candidateQueries) {
        try {
          const pdfUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            q
          )}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink,parents,owners)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;

          const pdfRes = await fetch(pdfUrl, {
            headers: { Authorization: `Bearer ${workingToken}` },
          });

          if (pdfRes.ok) {
            const pdfData: any = await pdfRes.json();
            const mapped: DrivePdfFormFile[] = (pdfData.files || []).map((f: any) => ({
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              size: f.size,
              modifiedTime: f.modifiedTime,
              webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
              webContentLink: f.webContentLink,
              iconLink: f.iconLink,
              parents: f.parents,
              ownerEmail: f.owners?.[0]?.emailAddress,
            }));
            if (mapped.length > 0) {
              const combined = directAdminPdfFile
                ? [directAdminPdfFile, ...mapped.filter((m) => m.id !== directAdminPdfFile!.id)]
                : mapped;
              files = combined;
              break;
            }
          }
        } catch {}
      }

      if (files.length > 0) {
        setPdfFiles(files);
        // Trigger background server sync so PDFs & templates are cached for all auditors
        fetch('/api/hub/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${workingToken}`,
          },
          body: JSON.stringify({ accessToken: workingToken }),
        }).catch(() => {});

        if (!activePdf || !files.some((f) => f.id === activePdf.id)) {
          void handleSelectPdfForPreview(files[0], workingToken);
        }
      } else if (!loadedFromServerCache) {
        setPdfFiles([]);
        setActivePdf(null);
        if (pdfBlobUrl) {
          URL.revokeObjectURL(pdfBlobUrl);
          setPdfBlobUrl(null);
        }
      }
    } catch (err: any) {
      console.warn('Error loading Drive PDF forms:', err);
      if (pdfFiles.length === 0) {
        setErrorMessage(err?.message || 'Unable to load PDF forms from Google Drive.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const adminForms = extractDriveResourceFromLink(getAdminDriveLinksConfig().formsLocationLink);
      if (adminForms && !isPlaceholderFolderId(adminForms.id)) {
        const adminFolder: DriveFolderItem = {
          id: adminForms.id,
          name: selectedFolder?.id === adminForms.id ? selectedFolder.name : DEFAULT_FORMS_FOLDER_NAME,
          webViewLink: adminForms.webViewLink,
          ownerEmail: FORMS_OWNER_EMAIL,
        };
        saveSelectedFolderPreference(adminFolder);
        void loadDriveFoldersAndPdfs(undefined, adminFolder, 'FOLDER');
      } else {
        void loadDriveFoldersAndPdfs();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return subscribeToAdminDriveLinks((updatedLinks) => {
      const parsed = extractDriveResourceFromLink(updatedLinks.formsLocationLink);
      if (parsed && !isPlaceholderFolderId(parsed.id)) {
        const nextFolder: DriveFolderItem = {
          id: parsed.id,
          name: DEFAULT_FORMS_FOLDER_NAME,
          webViewLink: parsed.webViewLink,
          ownerEmail: FORMS_OWNER_EMAIL,
        };
        saveSelectedFolderPreference(nextFolder);
        if (isOpen) {
          void loadDriveFoldersAndPdfs(undefined, nextFolder, 'FOLDER');
        }
      } else if (isOpen) {
        void loadDriveFoldersAndPdfs();
      }
    });
  }, [isOpen]);

  const handleRefreshAccess = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const newToken = await refreshGoogleAccessToken(undefined, false);
      setLocalToken(newToken);
      onTokenRefreshed?.(newToken);
      await loadDriveFoldersAndPdfs(newToken);
      showToast('Google Drive access refreshed.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to refresh Google Drive authorization.');
      setIsLoading(false);
    }
  };

  // Load a specific folder by ID or URL pasted by the user
  const handleLoadFolderByUrlOrId = async () => {
    const cleanId = extractDriveFolderId(customFolderUrlInput);
    if (!cleanId) return;

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const token =
        hubAccountToken ||
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';
      const metaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        cleanId
      )}?fields=id,name,mimeType,webViewLink,owners&supportsAllDrives=true`;

      const res = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error('Could not access that Google Drive folder. Verify the folder link or permissions.');
      }

      const meta: any = await res.json();
      const folderItem: DriveFolderItem = {
        id: meta.id,
        name: meta.name || DEFAULT_FORMS_FOLDER_NAME,
        webViewLink: meta.webViewLink || `https://drive.google.com/drive/folders/${meta.id}`,
        ownerEmail: meta.owners?.[0]?.emailAddress || FORMS_OWNER_EMAIL,
      };

      saveSelectedFolderPreference(folderItem);
      void syncHubFormsConfigToCloud(token, folderItem);
      setFolderScopeMode('FOLDER');
      setCustomFolderUrlInput('');
      setShowFolderPicker(false);
      await loadDriveFoldersAndPdfs(token, folderItem, 'FOLDER');
      showToast(`Connected folder "${folderItem.name}"`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Invalid Google Drive folder URL or ID.');
      setIsLoading(false);
    }
  };

  // Locate or ensure "ICD FORMS" folder
  const handleEnsureFormsFolder = async () => {
    setIsCreatingFormsFolder(true);
    setErrorMessage(null);
    try {
      const token =
        hubAccountToken ||
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';

      // First try finding existing "ICD FORMS" from icdhubsystems@gmail.com
      const existing = await findIcdFormsFolderInDrive(token, folders);
      if (existing) {
        saveSelectedFolderPreference(existing);
        void syncHubFormsConfigToCloud(token, existing);
        setFolderScopeMode('FOLDER');
        setShowFolderPicker(false);
        await loadDriveFoldersAndPdfs(token, existing, 'FOLDER');
        showToast(`Connected "${existing.name}" (${existing.ownerEmail || FORMS_OWNER_EMAIL})`);
        return;
      }

      const ensured = await ensureUserDriveFolder(token, DEFAULT_FORMS_FOLDER_NAME);
      if (!ensured) {
        throw new Error(`Could not locate or create the "${DEFAULT_FORMS_FOLDER_NAME}" folder in Google Drive.`);
      }
      const folderObj: DriveFolderItem = {
        id: ensured.folderId,
        name: ensured.folderName,
        webViewLink: ensured.webViewLink,
        ownerEmail: FORMS_OWNER_EMAIL,
      };
      saveSelectedFolderPreference(folderObj);
      void syncHubFormsConfigToCloud(token, folderObj);
      setFolderScopeMode('FOLDER');
      setShowFolderPicker(false);
      await loadDriveFoldersAndPdfs(token, folderObj, 'FOLDER');
      showToast(`Using "${folderObj.name}" folder in Google Drive`);
    } catch (err: any) {
      setErrorMessage(err?.message || `Could not locate "${DEFAULT_FORMS_FOLDER_NAME}" folder.`);
    } finally {
      setIsCreatingFormsFolder(false);
    }
  };

  // Upload a PDF form into the active "ICD FORMS" Google Drive folder
  const handleUploadPdfForm = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMessage('Please select a valid PDF file (.pdf).');
      return;
    }

    setIsUploadingPdf(true);
    setErrorMessage(null);
    try {
      const token =
        hubAccountToken ||
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';

      let targetFolderId =
        selectedFolder?.id && !isPlaceholderFolderId(selectedFolder.id)
          ? selectedFolder.id
          : undefined;
      if (!targetFolderId) {
        const existing = await findIcdFormsFolderInDrive(token, folders);
        if (existing && !isPlaceholderFolderId(existing.id)) {
          targetFolderId = existing.id;
          saveSelectedFolderPreference(existing);
        } else {
          const ensured = await ensureUserDriveFolder(token, DEFAULT_FORMS_FOLDER_NAME);
          if (ensured) {
            targetFolderId = ensured.folderId;
            saveSelectedFolderPreference({
              id: ensured.folderId,
              name: ensured.folderName,
              webViewLink: ensured.webViewLink,
            });
          }
        }
      }

      const metadata: Record<string, any> = {
        name: file.name,
        mimeType: 'application/pdf',
      };
      if (targetFolderId) {
        metadata.parents = [targetFolderId];
      }

      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;

      const fileArrayBuffer = await file.arrayBuffer();
      const metaPart =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/pdf\r\n\r\n';

      const encoder = new TextEncoder();
      const metaBytes = encoder.encode(metaPart);
      const closeBytes = encoder.encode(closeDelim);
      const pdfBytes = new Uint8Array(fileArrayBuffer);

      const combined = new Uint8Array(metaBytes.length + pdfBytes.length + closeBytes.length);
      combined.set(metaBytes, 0);
      combined.set(pdfBytes, metaBytes.length);
      combined.set(closeBytes, metaBytes.length + pdfBytes.length);

      const uploadRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink&supportsAllDrives=true',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: combined,
        }
      );

      if (!uploadRes.ok) {
        const errTxt = await uploadRes.text();
        throw new Error(`Upload failed (${uploadRes.status}): ${errTxt}`);
      }

      const uploaded: any = await uploadRes.json();
      showToast(`Uploaded "${uploaded.name}" to ${selectedFolder?.name || DEFAULT_FORMS_FOLDER_NAME}`);
      await loadDriveFoldersAndPdfs(token);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to upload PDF form to Google Drive.');
    } finally {
      setIsUploadingPdf(false);
    }
  };

  // Fetch PDF binary from server Hub Cache (/api/hub/forms/:fileId/pdf) first (zero popups!),
  // falling back to Google Drive API media download if needed.
  const fetchPdfBlobUrl = async (fileId: string, overrideToken?: string): Promise<string | null> => {
    try {
      const token =
        overrideToken ||
        hubAccountToken ||
        (await resolveValidOAuthToken(effectiveToken, { allowPopup: false })) ||
        effectiveToken ||
        '';

      // 1. Try server-cached PDF stream (/api/hub/forms/:fileId/pdf) first so auditors never need icdhubsystems@gmail.com permissions
      try {
        const serverHeaders: Record<string, string> = {};
        if (token) {
          serverHeaders.Authorization = `Bearer ${token}`;
        }
        const serverPdfRes = await fetch(`/api/hub/forms/${encodeURIComponent(fileId)}/pdf`, {
          headers: serverHeaders,
        });
        if (serverPdfRes.ok) {
          const arrayBuffer = await serverPdfRes.arrayBuffer();
          if (arrayBuffer.byteLength > 0) {
            const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
            return URL.createObjectURL(blob);
          }
        }
      } catch {}

      if (!token) return null;

      // 2. Fallback: Direct Google Drive API media fetch
      const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?alt=media&supportsAllDrives=true`;

      const res = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      return URL.createObjectURL(blob);
    } catch (err) {
      console.warn('Could not fetch PDF media blob, using Drive embed fallback:', err);
      return null;
    }
  };

  const handleSelectPdfForPreview = async (file: DrivePdfFormFile, overrideToken?: string) => {
    setActivePdf(file);
    setIsLoadingPreview(true);
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }

    const blobUrl = await fetchPdfBlobUrl(file.id, overrideToken);
    if (blobUrl) {
      setPdfBlobUrl(blobUrl);
      setPreviewMode('BLOB');
    } else {
      setPreviewMode('DRIVE_EMBED');
    }
    setIsLoadingPreview(false);
  };

  // Direct Print handler for any PDF form
  const handlePrintPdf = async (file: DrivePdfFormFile) => {
    setIsPrintingId(file.id);
    setErrorMessage(null);
    try {
      let urlToPrint = activePdf?.id === file.id && pdfBlobUrl ? pdfBlobUrl : null;
      if (!urlToPrint) {
        urlToPrint = await fetchPdfBlobUrl(file.id);
      }

      if (urlToPrint) {
        if (activePdf?.id !== file.id) {
          setActivePdf(file);
          if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
          setPdfBlobUrl(urlToPrint);
          setPreviewMode('BLOB');
        }

        const iframe = printIframeRef.current;
        if (iframe) {
          iframe.onload = () => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch (e) {
              console.warn('Direct iframe print fallback:', e);
            }
            setIsPrintingId(null);
          };
          iframe.src = urlToPrint;
          return;
        }
      }

      // Fallback if Blob stream is restricted: switch to Drive preview and trigger print
      setActivePdf(file);
      setPreviewMode('DRIVE_EMBED');
      setIsPrintingId(null);
      showToast('Loaded PDF in preview — click the print icon in the PDF toolbar.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not print PDF form.');
      setIsPrintingId(null);
    }
  };

  const handleDownloadPdf = async (file: DrivePdfFormFile) => {
    let urlToUse = activePdf?.id === file.id && pdfBlobUrl ? pdfBlobUrl : null;
    let revokeAfter = false;
    if (!urlToUse) {
      urlToUse = await fetchPdfBlobUrl(file.id);
      revokeAfter = true;
    }
    if (urlToUse) {
      const a = document.createElement('a');
      a.href = urlToUse;
      a.download = file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (revokeAfter) {
        setTimeout(() => URL.revokeObjectURL(urlToUse!), 5000);
      }
    }
  };

  if (!isOpen) return null;

  const filteredPdfFiles = pdfFiles.filter((f) =>
    pdfSearchQuery.trim()
      ? f.name.toLowerCase().includes(pdfSearchQuery.trim().toLowerCase())
      : true
  );

  const filteredFolders = folders.filter((f) =>
    folderSearchQuery.trim()
      ? f.name.toLowerCase().includes(folderSearchQuery.trim().toLowerCase())
      : true
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200"
      style={{ overscrollBehavior: 'contain' }}
    >
      {/* Hidden iframe dedicated to direct native PDF printing */}
      <iframe
        ref={printIframeRef}
        title="PDF Direct Print Frame"
        className="hidden"
      />

      {/* Hidden file input for uploading PDF forms to the Google Drive folder */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleUploadPdfForm}
        className="hidden"
      />

      <div
        data-scroll-lock-panel
        className="relative w-[90vw] sm:w-[68vw] max-w-[980px] h-[76dvh] sm:h-[68dvh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Compact Top Header */}
        <div className="px-3 py-2.5 border-b border-slate-200/90 dark:border-zinc-800 flex items-center justify-between gap-2 bg-slate-50/80 dark:bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/25">
              <FileText className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
              Forms
            </h2>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300/60 dark:border-amber-800">
              {pdfFiles.length}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Folder Picker Toggle */}
            <button
              type="button"
              onClick={() => setShowFolderPicker((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 border transition cursor-pointer ${
                showFolderPicker
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:bg-amber-50 dark:hover:bg-amber-950/30'
              }`}
              title="Folder settings"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span className="hidden sm:inline">Folder</span>
            </button>

            {/* Upload PDF */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingPdf}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
              title="Upload PDF"
            >
              {isUploadingPdf ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Upload</span>
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => loadDriveFoldersAndPdfs()}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-white dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700 transition cursor-pointer disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-600' : ''}`} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toast Banner */}
        {toastMessage && (
          <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/60 border-b border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-[11px] font-bold flex items-center justify-between">
            <div className="flex items-center gap-1.5 truncate">
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="truncate">{toastMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:underline text-[10px] ml-2"
            >
              OK
            </button>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-[11px] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 truncate">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span className="truncate">{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={handleRefreshAccess}
              className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer shrink-0"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Compact Folder Drawer */}
        {showFolderPicker && (
          <div className="p-2.5 bg-amber-50/60 dark:bg-zinc-800/80 border-b border-amber-200 dark:border-zinc-700 space-y-2 animate-in fade-in duration-150 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg bg-white dark:bg-zinc-900 p-0.5 border border-slate-200 dark:border-zinc-700 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setFolderScopeMode('FOLDER');
                    loadDriveFoldersAndPdfs(undefined, selectedFolder, 'FOLDER');
                  }}
                  className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                    folderScopeMode === 'FOLDER'
                      ? 'bg-amber-500 text-white'
                      : 'text-slate-600 dark:text-zinc-400'
                  }`}
                >
                  {DEFAULT_FORMS_FOLDER_NAME}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFolderScopeMode('ALL_DRIVE');
                    loadDriveFoldersAndPdfs(undefined, selectedFolder, 'ALL_DRIVE');
                  }}
                  className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                    folderScopeMode === 'ALL_DRIVE'
                      ? 'bg-amber-500 text-white'
                      : 'text-slate-600 dark:text-zinc-400'
                  }`}
                >
                  All PDFs
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleEnsureFormsFolder}
                  disabled={isCreatingFormsFolder}
                  className="px-2 py-0.5 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>{isCreatingFormsFolder ? '...' : 'Locate'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFolderPicker(false)}
                  className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white px-1.5"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="flex gap-1.5 items-center">
                <Link2 className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <input
                  type="text"
                  value={customFolderUrlInput}
                  onChange={(e) => setCustomFolderUrlInput(e.target.value)}
                  placeholder="Folder URL or ID..."
                  className="flex-1 text-[11px] px-2.5 py-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleLoadFolderByUrlOrId}
                  disabled={!customFolderUrlInput.trim()}
                  className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[10px] font-bold cursor-pointer shrink-0"
                >
                  Link
                </button>
              </div>

              <div className="flex gap-1.5 items-center">
                <div className="relative flex-1">
                  <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={folderSearchQuery}
                    onChange={(e) => setFolderSearchQuery(e.target.value)}
                    placeholder={`Folders (${folders.length})...`}
                    className="w-full pl-6 pr-2 py-1 text-[11px] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {filteredFolders.length > 0 && (
              <div className="max-h-20 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg">
                {filteredFolders.map((folder) => {
                  const isCurrent = selectedFolder?.id === folder.id && folderScopeMode === 'FOLDER';
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => {
                        saveSelectedFolderPreference(folder);
                        setFolderScopeMode('FOLDER');
                        setShowFolderPicker(false);
                        loadDriveFoldersAndPdfs(undefined, folder, 'FOLDER');
                      }}
                      className={`w-full px-2 py-1 text-left text-[11px] flex items-center justify-between gap-2 transition cursor-pointer ${
                        isCurrent
                          ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200 font-bold'
                          : 'hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300'
                      }`}
                    >
                      <span className="truncate">{folder.name}</span>
                      <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Main Split Layout */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Column: Compact PDF Forms List */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-zinc-800 flex flex-col min-h-0 bg-slate-50/40 dark:bg-zinc-900/40">
            <div className="p-2 border-b border-slate-200/80 dark:border-zinc-800">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={pdfSearchQuery}
                  onChange={(e) => setPdfSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-[11px] bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-200/70 dark:divide-zinc-800/80">
              {isLoading ? (
                <div className="p-6 text-center">
                  <RefreshCw className="w-5 h-5 animate-spin text-amber-600 mx-auto" />
                </div>
              ) : filteredPdfFiles.length > 0 ? (
                filteredPdfFiles.map((file) => {
                  const isSelected = activePdf?.id === file.id;

                  return (
                    <div
                      key={file.id}
                      onClick={() => handleSelectPdfForPreview(file)}
                      className={`px-2.5 py-2 flex items-center gap-2 cursor-pointer transition ${
                        isSelected
                          ? 'bg-amber-50/90 dark:bg-amber-950/35 border-l-3 border-l-amber-500'
                          : 'hover:bg-white dark:hover:bg-zinc-800/60'
                      }`}
                    >
                      <FileText
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? 'text-amber-600 dark:text-amber-400' : 'text-rose-500'
                        }`}
                      />
                      <span className="text-[11px] font-semibold text-slate-900 dark:text-white truncate">
                        {file.name.replace(/\.pdf$/i, '')}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="p-5 text-center space-y-2">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
                    No forms found
                  </p>
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Upload className="w-3 h-3" />
                      <span>Upload</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Live PDF Preview */}
          <div className="lg:col-span-8 flex flex-col min-h-0 bg-slate-100 dark:bg-zinc-950">
            {activePdf ? (
              <>
                <div className="px-3 py-1.5 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {activePdf.name.replace(/\.pdf$/i, '')}
                    </span>
                    <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 shrink-0">
                      {formatFileSize(activePdf.size, activePdf.mimeType)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewMode((prev) => (prev === 'BLOB' ? 'DRIVE_EMBED' : 'BLOB'))
                      }
                      disabled={!pdfBlobUrl}
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition cursor-pointer disabled:opacity-40"
                      title="Switch viewer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(activePdf)}
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 transition cursor-pointer"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>

                    {activePdf.webViewLink && (
                      <a
                        href={activePdf.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 transition"
                        title="Open"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => handlePrintPdf(activePdf)}
                      disabled={isPrintingId === activePdf.id}
                      className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer shadow-xs"
                    >
                      {isPrintingId === activePdf.id ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Printer className="w-3 h-3" />
                      )}
                      <span>Print</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-[260px] relative bg-zinc-800">
                  {isLoadingPreview ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-10">
                      <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                    </div>
                  ) : null}

                  {previewMode === 'BLOB' && pdfBlobUrl ? (
                    <iframe
                      key={pdfBlobUrl}
                      src={pdfBlobUrl}
                      title={activePdf.name}
                      className="w-full h-full border-0"
                    />
                  ) : (
                    <iframe
                      key={`embed_${activePdf.id}`}
                      src={
                        activePdf.id.startsWith('icd-form-')
                          ? `/api/hub/forms/${encodeURIComponent(activePdf.id)}/pdf`
                          : `https://drive.google.com/file/d/${encodeURIComponent(activePdf.id)}/preview`
                      }
                      title={activePdf.name}
                      className="w-full h-full border-0"
                      allow="autoplay"
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <FileText className="w-6 h-6 text-slate-400 mb-1.5" />
                <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                  Select a form
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
