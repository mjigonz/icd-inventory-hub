import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

export type AppLanguage = 'en' | 'fil' | 'capiznon' | 'cuyonon' | 'mindoro' | 'bikol';

export interface LanguageOption {
  id: AppLanguage;
  name: string;
  nativeName: string;
  regionLabel: string;
  badge: string;
  description: string;
  greeting: string;
  accentClass: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    id: 'en',
    name: 'English',
    nativeName: 'English',
    regionLabel: 'Default International',
    badge: 'DEFAULT',
    description: 'Standard English interface for audit & inventory workflows',
    greeting: 'Welcome to Inventory Hub',
    accentClass:
      'bg-slate-200/80 dark:bg-zinc-700/80 text-slate-700 dark:text-zinc-200 border-slate-300 dark:border-zinc-600',
  },
  {
    id: 'fil',
    name: 'Filipino (Tagalog)',
    nativeName: 'Wikang Filipino',
    regionLabel: 'Philippines (National)',
    badge: 'PILIPINAS',
    description: 'Pambansang wika ng Pilipinas para sa pagbibilang ng imbentaryo',
    greeting: 'Maligayang pagdating sa Inventory Hub',
    accentClass:
      'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  },
  {
    id: 'mindoro',
    name: 'Mindoreño (Tagalog-Mindoro)',
    nativeName: 'Salitang Mindoreño',
    regionLabel: 'Oriental & Occidental Mindoro',
    badge: 'MINDORO',
    description: 'Karaniwang salita at puntong Mindoreño sa Oriental at Occidental Mindoro',
    greeting: 'Maligayang pagdating ga sa Inventory Hub',
    accentClass:
      'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  },
  {
    id: 'bikol',
    name: 'Bikol / Bikolano',
    nativeName: 'Tataramon na Bikol',
    regionLabel: 'Bicol Region',
    badge: 'BICOL',
    description: 'An komun na tataramon sa Kabikolan para sa pagbilang nin imbentaryo',
    greeting: 'Marhay na pag-abot sa Inventory Hub',
    accentClass:
      'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
  },
  {
    id: 'capiznon',
    name: 'Capiznon / Hiligaynon',
    nativeName: 'Binisaya nga Capiznon',
    regionLabel: 'Roxas City, Capiz',
    badge: 'ROXAS, CAPIZ',
    description: 'Lokal nga hambalanon sa syudad sang Roxas kag probinsya sang Capiz',
    greeting: 'Maayong pag-abot sa Inventory Hub',
    accentClass:
      'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  {
    id: 'cuyonon',
    name: 'Cuyonon / Palawano',
    nativeName: 'Binitakan i’ang Cuyonon',
    regionLabel: 'Palawan',
    badge: 'PALAWAN',
    description: 'Ang katutubong binitakan sa probinsya i’ang Palawan',
    greeting: 'Mayad nga pag-abot sa Inventory Hub',
    accentClass:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
];

export interface TranslationDictionary {
  // App & Header
  appTitle: string;
  selectBranch: string;
  changeBranchOrSync: string;
  navBranch: string;
  navCount: string;
  navMonitoring: string;
  navInventory: string;
  adminMode: string;
  online: string;
  offline: string;
  offlineBanner: string;
  loadingHub: string;

  // Common Buttons & Labels
  openBtn: string;
  hideBtn: string;
  saveBtn: string;
  cancelBtn: string;
  selectBtn: string;
  removeBtn: string;
  removingText: string;
  refreshBtn: string;
  searchingText: string;
  retryBtn: string;
  itemsWord: string;

  // Drawer Menu
  menuTitle: string;
  reportsSection: string;
  createEncodingTitle: string;
  createEncodingSubtitle: string;
  createCountsheetTitle: string;
  createCountsheetSubtitle: string;
  formsTitle: string;
  formsSubtitle: string;
  preferencesSection: string;
  settingsTitle: string;
  settingsSubtitle: string;
  trashTitle: string;
  trashEmptyDesc: string;
  trashRetentionTitle: string;
  trashRetentionDesc: string;
  emptyTrashBtn: string;
  confirmEmptyBtn: string;
  restoreBtn: string;
  trashIsEmpty: string;
  logOutTitle: string;
  logOutSubtitle: string;

  // Settings View
  themeAndAppearance: string;
  appearanceMode: string;
  lightMode: string;
  darkMode: string;
  systemMode: string;
  autoSeasonalTheme: string;
  autoSeasonalDesc: string;
  seasonalDecorations: string;
  seasonalDecorationsDesc: string;
  decorativeCharacters: string;
  densityOff: string;
  densityMinimal: string;
  densityBalanced: string;
  densityPlayful: string;
  characterAnimation: string;
  characterAnimationOnDesc: string;
  characterAnimationOffDesc: string;
  themeSelection: string;
  themeClickToCollapse: string;
  themeClickToCustomize: string;

  // Language Section in Settings
  languageSection: string;
  changeLanguageTitle: string;
  changeLanguageSubtitle: string;
  languageActiveLabel: string;

  // Account & Tools in Settings
  accountSection: string;
  changeProfilePhoto: string;
  changeProfilePhotoDesc: string;
  switchGoogleAccount: string;
  switchGoogleAccountDesc: string;
  activeEmail: string;
  currentBranch: string;
  accessRole: string;
  adminAccessCode: string;
  adminModeUnlocked: string;
  adminModeActiveDesc: string;
  adminModeEnterCodeDesc: string;
  unlockBtn: string;
  exitAdminMode: string;
  changeAdminCode: string;
  toolsSection: string;
  shareAndQrTitle: string;
  shareAndQrDesc: string;
  installAppTitle: string;
  installAppDesc: string;

  // Branch View
  activeBranchLabel: string;
  localInventoryLabel: string;
  masterCatalogLabel: string;
  auditAccessRoleLabel: string;
  lastSyncedLabel: string;
  neverSynced: string;
  resyncBranchData: string;
  syncingText: string;
  startPhysicalCount: string;
  searchBranchSpreadsheets: string;
  searchFilesInDrivePlaceholder: string;
  pasteSpreadsheetUrlLabel: string;
  cachedOnDevice: string;
  offlineReady: string;
  itemsCached: string;
  noBranchesCachedYet: string;
  noBranchesCachedDesc: string;
  fullOfflineCountingTitle: string;
  fullOfflineCountingDesc: string;
  removeCachedBranchTitle: string;
  branchOwnershipRoleTitle: string;
  chooseYourRoleFor: string;
  iAmBranchOwner: string;
  fullAccessBadge: string;
  branchOwnerDesc: string;
  iAmEncoder: string;
  encoderDesc: string;
  offlineShowingCached: string;
  noSpreadsheetFilesFound: string;

  // Count View
  noBranchSelectedTitle: string;
  noBranchSelectedCountDesc: string;
  loadingCountsheets: string;
  sheetLabel: string;
  submittedBadge: string;
  draftBadge: string;
  newCsBtn: string;
  sheetCapacityLabel: string;
  fullWord: string;
  scanOrLookupItem: string;
  enterOrScanBarcodePlaceholder: string;
  findBtn: string;
  matchingItemsFound: string;
  notInListUnidentified: string;
  unidentifiedItem: string;
  foundInPrefix: string;
  enterItemDescriptionLabel: string;
  itemCodeLabel: string;
  categoryLabel: string;
  bookBalanceLabel: string;
  actualCountLabel: string;
  itemConditionLabel: string;
  conditionGood: string;
  conditionBad: string;
  conditionSpoilage: string;
  addToPrefix: string;
  submittingToSheets: string;
  offlineSavedLocallyBtn: string;
  submitToGoogleSheetsPrefix: string;
  submitToGoogleSheetsSuffix: string;
  itemsInPrefix: string;
  totalUnitsLabel: string;
  filterAll: string;
  filterWithVariance: string;
  filterMatched: string;
  filterBadUnid: string;
  filterItemsInCountsheetPlaceholder: string;
  noItemsAddedYetPrefix: string;
  scanBarcodeToAddDesc: string;
  editQtyAndConditionTitle: string;
  deleteCountsheetTitlePrefix: string;
  discardAndDeleteBtn: string;
  deletingText: string;

  // Monitoring View
  monitoringSubtitle: string;
  encodingTab: string;
  checkingTab: string;
  clearEncodingBtn: string;
  clearCheckingBtn: string;
  confirmClearPrefix: string;
  clearingText: string;
  completedOfText: string;
  encoderColumn: string;
  checkerColumn: string;
  statusColumn: string;
  statusSet: string;
  statusPending: string;
  statusInProgress: string;
  statusCompleted: string;
  noBranchSelectedMonitoringDesc: string;

  // Inventory View
  noBranchSelectedInventoryDesc: string;
  productInventoryCatalog: string;
  offlineSnapshotDatabase: string;
  viewCountsheetBtn: string;
  localTab: string;
  masterdataTab: string;
  allItemsFilter: string;
  categoryFilter: string;
  subcategoryFilter: string;
  subSubCategoryFilter: string;
  resyncMasterdataBtn: string;
  resyncingMasterdataText: string;
  searchInventoryPlaceholderPrefix: string;
  foundWord: string;
  matchingItemsWord: string;
  showingWord: string;
  resetFiltersBtn: string;
  allBalancesBtn: string;
  withBalanceBtn: string;
  zeroNegBtn: string;
  cardsViewBtn: string;
  tableViewBtn: string;
  barcodeLabel: string;
  descriptionLabel: string;
  categoryHierarchyLabel: string;
  unitLabel: string;
  sellingLabel: string;
  actionLabel: string;
  countBtn: string;
  loadMoreBtn: string;
  addToCountsheetModalBadge: string;
  targetCountsheetLabel: string;
  confirmAddBtn: string;
}

export const TRANSLATIONS: Record<AppLanguage, TranslationDictionary> = {
  en: {
    appTitle: 'Inventory Hub',
    selectBranch: 'Select Branch',
    changeBranchOrSync: 'Change branch or view sync status',
    navBranch: 'Branch',
    navCount: 'Count',
    navMonitoring: 'Monitoring',
    navInventory: 'Inventory Masterdata',
    adminMode: 'Admin Mode',
    online: 'Online',
    offline: 'Offline',
    offlineBanner: 'Offline Mode — All counts and searches operate from local cache',
    loadingHub: 'Loading Inventory Hub...',

    openBtn: 'Open',
    hideBtn: 'Hide',
    saveBtn: 'Save',
    cancelBtn: 'Cancel',
    selectBtn: 'Select',
    removeBtn: 'Remove',
    removingText: 'Removing...',
    refreshBtn: 'Refresh',
    searchingText: 'Searching...',
    retryBtn: 'Retry',
    itemsWord: 'items',

    menuTitle: 'Menu',
    reportsSection: 'Reports',
    createEncodingTitle: 'Create Encoding',
    createEncodingSubtitle: 'IATD to audit template report',
    createCountsheetTitle: 'Create Countsheet',
    createCountsheetSubtitle: 'Generate CS01–CSn item lists',
    formsTitle: 'FORMS',
    formsSubtitle: 'ICD FORMS (icdhubsystems@gmail.com) — Preview & Print',
    preferencesSection: 'Preferences',
    settingsTitle: 'Settings',
    settingsSubtitle: 'Theme, Language, Account, and Tools',
    trashTitle: 'Trash',
    trashEmptyDesc: 'Stores deleted recents for 30 days',
    trashRetentionTitle: '30-Day Auto Retention',
    trashRetentionDesc:
      'Deleted countsheets and audit reports are preserved here for 30 days before being automatically purged. You can restore them anytime or delete them manually below.',
    emptyTrashBtn: 'Empty Trash',
    confirmEmptyBtn: 'Confirm Empty',
    restoreBtn: 'Restore',
    trashIsEmpty: 'Trash is Empty',
    logOutTitle: 'Log Out',
    logOutSubtitle: 'Return to sign-in screen',

    themeAndAppearance: 'Theme & Appearance',
    appearanceMode: 'Appearance Mode',
    lightMode: 'Light',
    darkMode: 'Dark',
    systemMode: 'System',
    autoSeasonalTheme: 'Automatic Seasonal Theme',
    autoSeasonalDesc: 'Match theme to current calendar season',
    seasonalDecorations: 'Seasonal Decorations',
    seasonalDecorationsDesc: 'Panel characters, ornaments & themed objects',
    decorativeCharacters: 'Decorative Characters',
    densityOff: 'Off',
    densityMinimal: 'Minimal',
    densityBalanced: 'Balanced',
    densityPlayful: 'Playful',
    characterAnimation: 'Character Animation',
    characterAnimationOnDesc: 'Subtle sway, blink & float active',
    characterAnimationOffDesc: 'Static illustrations (Default Off)',
    themeSelection: 'Theme Selection',
    themeClickToCollapse: 'Click to collapse theme & character settings',
    themeClickToCustomize: 'Click to customize theme & characters',

    languageSection: 'Language & Region',
    changeLanguageTitle: 'Change Language',
    changeLanguageSubtitle: 'English, Filipino, Roxas Capiz & Palawan',
    languageActiveLabel: 'Active Language',

    accountSection: 'Account',
    changeProfilePhoto: 'Change Profile Photo',
    changeProfilePhotoDesc: 'Upload avatar or reset to Google photo',
    switchGoogleAccount: 'Switch Google Account',
    switchGoogleAccountDesc: 'Connect different Google account',
    activeEmail: 'Active Email',
    currentBranch: 'Current Branch',
    accessRole: 'Access Role',
    adminAccessCode: 'Admin Access Code',
    adminModeUnlocked: 'Admin Mode Unlocked',
    adminModeActiveDesc: 'Full Owner & Admin privileges active',
    adminModeEnterCodeDesc: 'Enter admin code to access Admin Mode',
    unlockBtn: 'Unlock',
    exitAdminMode: 'Exit Admin Mode',
    changeAdminCode: 'Change Admin Code',
    toolsSection: 'Tools',
    shareAndQrTitle: 'Share & QR Download',
    shareAndQrDesc: 'QR code for phone scanning & download',
    installAppTitle: 'Install App to Home Screen',
    installAppDesc: 'Install PWA for offline use',

    // Branch View
    activeBranchLabel: 'Active Branch',
    localInventoryLabel: 'Local Inventory (ENCODING)',
    masterCatalogLabel: 'Master Catalog (MASTERDATA)',
    auditAccessRoleLabel: 'Audit Access Role',
    lastSyncedLabel: 'Last Synced',
    neverSynced: 'Never synced',
    resyncBranchData: 'Re-sync Branch Data',
    syncingText: 'Syncing...',
    startPhysicalCount: 'Start Physical Count',
    searchBranchSpreadsheets: 'Search Branch Spreadsheets',
    searchFilesInDrivePlaceholder: 'Search files in Google Drive...',
    pasteSpreadsheetUrlLabel: 'Or paste Google Spreadsheet URL / ID',
    cachedOnDevice: 'Cached On Device',
    offlineReady: 'Offline-Ready',
    itemsCached: 'items cached',
    noBranchesCachedYet: 'No branches cached yet',
    noBranchesCachedDesc:
      'Search or open a Google Spreadsheet on the left to sync products for offline barcode scanning.',
    fullOfflineCountingTitle: '⚡ Full Offline Counting',
    fullOfflineCountingDesc:
      'Once synced, branch inventories and barcodes work 100% without internet. Counted items persist in local storage and batch upload to Google Sheets when reconnected.',
    removeCachedBranchTitle: 'Remove Cached Branch',
    branchOwnershipRoleTitle: 'Branch Ownership Role',
    chooseYourRoleFor: 'Choose your role for',
    iAmBranchOwner: 'I am the Branch Owner',
    fullAccessBadge: 'Full Access',
    branchOwnerDesc:
      'First person to claim Owner becomes branch owner. Can create, edit, submit, and delete countsheets.',
    iAmEncoder: 'I am an Encoder',
    encoderDesc:
      'Can create countsheets, scan barcodes, and submit items. Cannot delete existing countsheets.',
    offlineShowingCached: 'You are offline. Showing cached local branches below.',
    noSpreadsheetFilesFound: 'No spreadsheet files found matching your search.',

    // Count View
    noBranchSelectedTitle: 'No Branch Selected',
    noBranchSelectedCountDesc:
      'Please select a branch Google Spreadsheet to start physical inventory counting.',
    loadingCountsheets: 'Loading countsheets...',
    sheetLabel: 'Sheet:',
    submittedBadge: 'Submitted',
    draftBadge: 'Draft',
    newCsBtn: 'New CS',
    sheetCapacityLabel: 'Sheet Capacity',
    fullWord: 'Full',
    scanOrLookupItem: 'Scan or Lookup Item',
    enterOrScanBarcodePlaceholder: 'Enter or scan barcode...',
    findBtn: 'Find',
    matchingItemsFound: 'Matching Items Found',
    notInListUnidentified: 'Not in this list? Record as Unidentified Item →',
    unidentifiedItem: 'Unidentified Item',
    foundInPrefix: 'Found in',
    enterItemDescriptionLabel: 'Enter Item Description *',
    itemCodeLabel: 'Item Code',
    categoryLabel: 'Category',
    bookBalanceLabel: 'Book Balance',
    actualCountLabel: 'Actual Count',
    itemConditionLabel: 'Item Condition',
    conditionGood: 'Good',
    conditionBad: 'Bad',
    conditionSpoilage: 'Spoilage',
    addToPrefix: 'Add to',
    submittingToSheets: 'Submitting to Google Sheets...',
    offlineSavedLocallyBtn: 'Offline: Saved locally (Online submission paused)',
    submitToGoogleSheetsPrefix: 'Submit',
    submitToGoogleSheetsSuffix: 'to Google Sheets',
    itemsInPrefix: 'Items in',
    totalUnitsLabel: 'Total Units:',
    filterAll: 'All',
    filterWithVariance: 'With Variance',
    filterMatched: 'Matched',
    filterBadUnid: 'Bad / Unidentified',
    filterItemsInCountsheetPlaceholder: 'Filter items in this countsheet...',
    noItemsAddedYetPrefix: 'No items added to',
    scanBarcodeToAddDesc: 'Scan barcode or enter item code on the left to add items.',
    editQtyAndConditionTitle: 'Edit Quantity & Condition',
    deleteCountsheetTitlePrefix: 'Delete Countsheet',
    discardAndDeleteBtn: 'Discard & Delete',
    deletingText: 'Deleting...',

    // Monitoring View
    monitoringSubtitle: 'Monitoring Sheet • Switch between Encoding and Checking views',
    encodingTab: 'ENCODING',
    checkingTab: 'CHECKING',
    clearEncodingBtn: 'Clear Encoding',
    clearCheckingBtn: 'Clear Checking',
    confirmClearPrefix: 'Confirm Clear',
    clearingText: 'Clearing...',
    completedOfText: 'completed',
    encoderColumn: 'Encoder',
    checkerColumn: 'Checker',
    statusColumn: 'STATUS',
    statusSet: 'Set',
    statusPending: 'Pending',
    statusInProgress: 'In Progress',
    statusCompleted: 'Completed',
    noBranchSelectedMonitoringDesc:
      'Select a branch spreadsheet to track Encoding and Checking progress.',

    // Inventory View
    noBranchSelectedInventoryDesc:
      'Please select a branch to search local inventory and masterdata.',
    productInventoryCatalog: 'Product Inventory Catalog',
    offlineSnapshotDatabase: 'Offline Snapshot Database',
    viewCountsheetBtn: 'View Countsheet',
    localTab: 'Local',
    masterdataTab: 'Masterdata',
    allItemsFilter: 'All Items',
    categoryFilter: 'Category',
    subcategoryFilter: 'Subcategory',
    subSubCategoryFilter: 'SubSubCategory',
    resyncMasterdataBtn: 'Resync Masterdata',
    resyncingMasterdataText: 'Resyncing Masterdata...',
    searchInventoryPlaceholderPrefix: 'Search by name, item code, or barcode...',
    foundWord: 'Found',
    matchingItemsWord: 'matching items',
    showingWord: 'Showing',
    resetFiltersBtn: 'Reset Filters',
    allBalancesBtn: 'All Balances',
    withBalanceBtn: 'With Balance',
    zeroNegBtn: 'Zero / Neg',
    cardsViewBtn: 'Cards',
    tableViewBtn: 'Table',
    barcodeLabel: 'Barcode',
    descriptionLabel: 'Description',
    categoryHierarchyLabel: 'Category Hierarchy',
    unitLabel: 'Unit',
    sellingLabel: 'Selling',
    actionLabel: 'Action',
    countBtn: 'Count',
    loadMoreBtn: 'Load More',
    addToCountsheetModalBadge: 'Add to Countsheet',
    targetCountsheetLabel: 'Target Countsheet',
    confirmAddBtn: 'Confirm Add',
  },

  fil: {
    appTitle: 'Inventory Hub',
    selectBranch: 'Pumili ng Sangay',
    changeBranchOrSync: 'Palitan ang sangay o tingnan ang sync',
    navBranch: 'Sangay',
    navCount: 'Bilang',
    navMonitoring: 'Monitoring',
    navInventory: 'Imbentaryo',
    adminMode: 'Admin Mode',
    online: 'Online',
    offline: 'Offline',
    offlineBanner: 'Offline Mode — Lahat ng bilang at paghahanap ay mula sa lokal na cache',
    loadingHub: 'Binubuksan ang Inventory Hub...',

    openBtn: 'Buksan',
    hideBtn: 'Itago',
    saveBtn: 'I-save',
    cancelBtn: 'Kanselahin',
    selectBtn: 'Piliin',
    removeBtn: 'Alisin',
    removingText: 'Inaalis...',
    refreshBtn: 'I-refresh',
    searchingText: 'Naghahanap...',
    retryBtn: 'Subukan Muli',
    itemsWord: 'aytem',

    menuTitle: 'Menu',
    reportsSection: 'Mga Ulat',
    createEncodingTitle: 'Gumawa ng Encoding',
    createEncodingSubtitle: 'IATD tungo sa audit template report',
    createCountsheetTitle: 'Gumawa ng Countsheet',
    createCountsheetSubtitle: 'Bumuo ng listahan ng CS01–CSn',
    formsTitle: 'FORMS',
    formsSubtitle: 'ICD FORMS (icdhubsystems@gmail.com) — Tingnan at I-print',
    preferencesSection: 'Mga Kagustuhan',
    settingsTitle: 'Mga Setting',
    settingsSubtitle: 'Tema, Wika, Account, at Kagamitan',
    trashTitle: 'Basurahan (Trash)',
    trashEmptyDesc: 'Nakatabi nang 30 araw ang mga nabura',
    trashRetentionTitle: '30-Araw na Awtomatikong Pagtatabi',
    trashRetentionDesc:
      'Ang mga naburang countsheet at audit report ay nakatabi rito nang 30 araw bago tuluyang mabura. Maaari mo itong ibalik anumang oras.',
    emptyTrashBtn: 'ubusin ang Trash',
    confirmEmptyBtn: 'Kumpirmahin',
    restoreBtn: 'Ibalik',
    trashIsEmpty: 'Walang laman ang Trash',
    logOutTitle: 'Mag-log Out',
    logOutSubtitle: 'Bumalik sa sign-in screen',

    themeAndAppearance: 'Tema',
    appearanceMode: 'Hitsura',
    lightMode: 'Maliwanag',
    darkMode: 'Madilim',
    systemMode: 'System',
    autoSeasonalTheme: 'Auto Panahon',
    autoSeasonalDesc: '',
    seasonalDecorations: 'Palamuti',
    seasonalDecorationsDesc: '',
    decorativeCharacters: 'Dami ng Karakter',
    densityOff: 'Wala',
    densityMinimal: 'Kaunti',
    densityBalanced: 'Katamtaman',
    densityPlayful: 'Marami',
    characterAnimation: 'Galaw ng Karakter',
    characterAnimationOnDesc: '',
    characterAnimationOffDesc: '',
    themeSelection: 'Mga Tema',
    themeClickToCollapse: '',
    themeClickToCustomize: '',

    languageSection: 'Wika',
    changeLanguageTitle: 'Wika',
    changeLanguageSubtitle: '',
    languageActiveLabel: 'Wika',

    accountSection: 'Account',
    changeProfilePhoto: 'Palitan ang Litrato',
    changeProfilePhotoDesc: '',
    switchGoogleAccount: 'Magpalit ng Account',
    switchGoogleAccountDesc: '',
    activeEmail: 'Email',
    currentBranch: 'Sangay',
    accessRole: 'Role',
    adminAccessCode: 'Admin Access',
    adminModeUnlocked: 'Admin Mode',
    adminModeActiveDesc: '',
    adminModeEnterCodeDesc: '',
    unlockBtn: 'Buksan',
    exitAdminMode: 'Isara',
    changeAdminCode: 'Palitan ang Code',
    toolsSection: 'Gamit',
    shareAndQrTitle: 'I-share at QR',
    shareAndQrDesc: '',
    installAppTitle: 'I-install ang App',
    installAppDesc: '',

    // Branch View
    activeBranchLabel: 'Aktibong Sangay',
    localInventoryLabel: 'Lokal na Imbentaryo (ENCODING)',
    masterCatalogLabel: 'Master Catalog (MASTERDATA)',
    auditAccessRoleLabel: 'Tungkulin sa Audit',
    lastSyncedLabel: 'Huling Na-sync',
    neverSynced: 'Hindi pa na-sync',
    resyncBranchData: 'I-sync Muli ang Sangay',
    syncingText: 'Nag-si-sync...',
    startPhysicalCount: 'Simulan ang Pagbibilang',
    searchBranchSpreadsheets: 'Maghanap ng Spreadsheet ng Sangay',
    searchFilesInDrivePlaceholder: 'Maghanap ng file sa Google Drive...',
    pasteSpreadsheetUrlLabel: 'O i-paste ang URL / ID ng Google Spreadsheet',
    cachedOnDevice: 'Naka-save sa Device',
    offlineReady: 'Handa sa Offline',
    itemsCached: 'aytem na naka-save',
    noBranchesCachedYet: 'Wala pang naka-save na sangay',
    noBranchesCachedDesc:
      'Maghanap o magbukas ng Google Spreadsheet sa kaliwa upang i-sync ang mga produkto para sa offline barcode scanning.',
    fullOfflineCountingTitle: '⚡ Buong Offline na Pagbibilang',
    fullOfflineCountingDesc:
      'Kapag na-sync na, gagana nang 100% ang imbentaryo at barcode kahit walang internet. Naka-save sa device ang bilang at ia-upload sa Google Sheets kapag online.',
    removeCachedBranchTitle: 'Alisin ang Naka-save na Sangay',
    branchOwnershipRoleTitle: 'Tungkulin sa Sangay',
    chooseYourRoleFor: 'Piliin ang iyong tungkulin para sa',
    iAmBranchOwner: 'Ako ang Branch Owner',
    fullAccessBadge: 'Buong Access',
    branchOwnerDesc:
      'Ang unang kukuha ng Owner ang magiging may-ari ng sangay. Maaaring gumawa, mag-edit, mag-submit, at magbura ng countsheets.',
    iAmEncoder: 'Ako ay Encoder',
    encoderDesc:
      'Maaaring gumawa ng countsheets, mag-scan ng barcode, at mag-submit ng bilang. Hindi maaaring magbura ng countsheets.',
    offlineShowingCached: 'Ikaw ay offline. Ipinapakita ang mga naka-save na sangay sa ibaba.',
    noSpreadsheetFilesFound: 'Walang nahanap na spreadsheet na tumutugma sa iyong hinahanap.',

    // Count View
    noBranchSelectedTitle: 'Walang Napiling Sangay',
    noBranchSelectedCountDesc:
      'Mangyaring pumili muna ng Google Spreadsheet ng sangay upang magsimula ng pagbibilang.',
    loadingCountsheets: 'Binubuksan ang mga countsheet...',
    sheetLabel: 'Sheet:',
    submittedBadge: 'Naipasa na',
    draftBadge: 'Draft',
    newCsBtn: 'Bagong CS',
    sheetCapacityLabel: 'Laman ng Sheet',
    fullWord: 'Puno na',
    scanOrLookupItem: 'Mag-scan o Maghanap ng Aytem',
    enterOrScanBarcodePlaceholder: 'Ilagay o i-scan ang barcode...',
    findBtn: 'Hanapin',
    matchingItemsFound: 'Mga Tumugmang Aytem',
    notInListUnidentified: 'Wala sa listahan? Itala bilang Unidentified Item →',
    unidentifiedItem: 'Hindi Kilalang Aytem (Unidentified)',
    foundInPrefix: 'Nahanap sa',
    enterItemDescriptionLabel: 'Ilagay ang Pangalan / Deskripsyon ng Aytem *',
    itemCodeLabel: 'Item Code',
    categoryLabel: 'Kategorya',
    bookBalanceLabel: 'Book Balance',
    actualCountLabel: 'Aktwal na Bilang',
    itemConditionLabel: 'Kondisyon ng Aytem',
    conditionGood: 'Maayos (Good)',
    conditionBad: 'Sira (Bad)',
    conditionSpoilage: 'Spoilage',
    addToPrefix: 'Idagdag sa',
    submittingToSheets: 'Ipina-pasa sa Google Sheets...',
    offlineSavedLocallyBtn: 'Offline: Naka-save sa device (Ipapasa kapag online)',
    submitToGoogleSheetsPrefix: 'Ipasa ang',
    submitToGoogleSheetsSuffix: 'sa Google Sheets',
    itemsInPrefix: 'Mga Aytem sa',
    totalUnitsLabel: 'Kabuuang Bilang:',
    filterAll: 'Lahat',
    filterWithVariance: 'May Variance',
    filterMatched: 'Tugma (Matched)',
    filterBadUnid: 'Sira / Unidentified',
    filterItemsInCountsheetPlaceholder: 'Salain ang mga aytem sa countsheet na ito...',
    noItemsAddedYetPrefix: 'Wala pang nailalagay na aytem sa',
    scanBarcodeToAddDesc: 'Mag-scan ng barcode o maglagay ng item code sa kaliwa upang magdagdag.',
    editQtyAndConditionTitle: 'Baguhin ang Bilang at Kondisyon',
    deleteCountsheetTitlePrefix: 'Burahin ang Countsheet',
    discardAndDeleteBtn: 'Ituloy ang Pagbura',
    deletingText: 'Binubura...',

    // Monitoring View
    monitoringSubtitle: 'Monitoring Sheet • Lumipat sa pagitan ng Encoding at Checking',
    encodingTab: 'ENCODING',
    checkingTab: 'CHECKING',
    clearEncodingBtn: 'Linisin ang Encoding',
    clearCheckingBtn: 'Linisin ang Checking',
    confirmClearPrefix: 'Kumpirmahin ang Paglinis sa',
    clearingText: 'Nililinis...',
    completedOfText: 'ang tapos',
    encoderColumn: 'Encoder',
    checkerColumn: 'Checker',
    statusColumn: 'STATUS',
    statusSet: 'Itakda',
    statusPending: 'Nakabinbin',
    statusInProgress: 'Ginagawa',
    statusCompleted: 'Tapos na',
    noBranchSelectedMonitoringDesc:
      'Pumili ng spreadsheet ng sangay upang subaybayan ang progreso ng Encoding at Checking.',

    // Inventory View
    noBranchSelectedInventoryDesc:
      'Mangyaring pumili ng sangay upang maghanap sa lokal na imbentaryo at masterdata.',
    productInventoryCatalog: 'Katalogo ng Imbentaryo ng Produkto',
    offlineSnapshotDatabase: 'Offline Snapshot Database',
    viewCountsheetBtn: 'Tingnan ang Countsheet',
    localTab: 'Lokal',
    masterdataTab: 'Masterdata',
    allItemsFilter: 'Lahat ng Aytem',
    categoryFilter: 'Kategorya',
    subcategoryFilter: 'Subcategory',
    subSubCategoryFilter: 'SubSubCategory',
    resyncMasterdataBtn: 'I-sync Muli ang Masterdata',
    resyncingMasterdataText: 'Nag-si-sync ng Masterdata...',
    searchInventoryPlaceholderPrefix: 'Maghanap ng pangalan, item code, o barcode...',
    foundWord: 'Nahanap:',
    matchingItemsWord: 'tumugmang aytem',
    showingWord: 'Ipinapakita:',
    resetFiltersBtn: 'I-reset ang Filter',
    allBalancesBtn: 'Lahat ng Balanse',
    withBalanceBtn: 'May Balanse',
    zeroNegBtn: 'Zero / Neg',
    cardsViewBtn: 'Cards',
    tableViewBtn: 'Talahanayan',
    barcodeLabel: 'Barcode',
    descriptionLabel: 'Deskripsyon',
    categoryHierarchyLabel: 'Kategorya',
    unitLabel: 'Yunit',
    sellingLabel: 'Presyo',
    actionLabel: 'Aksyon',
    countBtn: 'Bilangin',
    loadMoreBtn: 'Magpakita pa',
    addToCountsheetModalBadge: 'Idagdag sa Countsheet',
    targetCountsheetLabel: 'Patutunguhang Countsheet',
    confirmAddBtn: 'Kumpirmahin',
  },

  capiznon: {
    appTitle: 'Inventory Hub',
    selectBranch: 'Magpili sang Branch',
    changeBranchOrSync: 'Islan ang branch ukon tan-awon ang sync',
    navBranch: 'Branch',
    navCount: 'Isip',
    navMonitoring: 'Monitoring',
    navInventory: 'Imbentaryo',
    adminMode: 'Admin Mode',
    online: 'Online',
    offline: 'Offline',
    offlineBanner: 'Offline Mode — Ang tanan nga isip kag pagpangita halin sa lokal nga cache',
    loadingHub: 'Gina-load ang Inventory Hub...',

    openBtn: 'Buksan',
    hideBtn: 'Taguon',
    saveBtn: 'I-save',
    cancelBtn: 'Kanselahon',
    selectBtn: 'Pilion',
    removeBtn: 'Kuhaon',
    removingText: 'Ginakuha...',
    refreshBtn: 'I-refresh',
    searchingText: 'Nagapangita...',
    retryBtn: 'Tilawan Liwat',
    itemsWord: 'ka butang',

    menuTitle: 'Menu',
    reportsSection: 'Mga Report',
    createEncodingTitle: 'Maghimo sang Encoding',
    createEncodingSubtitle: 'IATD pakadto sa audit template report',
    createCountsheetTitle: 'Maghimo sang Countsheet',
    createCountsheetSubtitle: 'Maghimo sang listahan sang CS01–CSn',
    formsTitle: 'FORMS',
    formsSubtitle: 'ICD FORMS (icdhubsystems@gmail.com) — Tan-awon kag I-print',
    preferencesSection: 'Mga Gusto (Preferences)',
    settingsTitle: 'Mga Setting',
    settingsSubtitle: 'Tema, Hambalanon, Account, kag Gamit',
    trashTitle: 'Basurahan (Trash)',
    trashEmptyDesc: 'Ginapundo ang ginpanas sa sulod sang 30 ka adlaw',
    trashRetentionTitle: '30-Adlaw nga Pagtago',
    trashRetentionDesc:
      'Ang mga ginpanas nga countsheet kag report ginatago diri sa sulod sang 30 ka adlaw bag-o madula sing lubos. Pwede mo pa ini ibalik bisan san-o.',
    emptyTrashBtn: 'Tinloan ang Basurahan',
    confirmEmptyBtn: 'Kumpirmahon',
    restoreBtn: 'Ibalik',
    trashIsEmpty: 'Wala unod ang Basurahan',
    logOutTitle: 'Mag-gwa (Log Out)',
    logOutSubtitle: 'Magbalik sa sign-in screen',

    themeAndAppearance: 'Tema',
    appearanceMode: 'Hitsura',
    lightMode: 'Masanag',
    darkMode: 'Madulom',
    systemMode: 'System',
    autoSeasonalTheme: 'Auto Panahon',
    autoSeasonalDesc: '',
    seasonalDecorations: 'Mga Punî',
    seasonalDecorationsDesc: '',
    decorativeCharacters: 'Kadamo sang Karakter',
    densityOff: 'Wala',
    densityMinimal: 'Diutay',
    densityBalanced: 'Sakto',
    densityPlayful: 'Madamo',
    characterAnimation: 'Hulag sang Karakter',
    characterAnimationOnDesc: '',
    characterAnimationOffDesc: '',
    themeSelection: 'Mga Tema',
    themeClickToCollapse: '',
    themeClickToCustomize: '',

    languageSection: 'Hambalanon',
    changeLanguageTitle: 'Hambalanon',
    changeLanguageSubtitle: '',
    languageActiveLabel: 'Hambalanon',

    accountSection: 'Account',
    changeProfilePhoto: 'Islan ang Litrato',
    changeProfilePhotoDesc: '',
    switchGoogleAccount: 'Magbaylo sang Account',
    switchGoogleAccountDesc: '',
    activeEmail: 'Email',
    currentBranch: 'Branch',
    accessRole: 'Role',
    adminAccessCode: 'Admin Access',
    adminModeUnlocked: 'Admin Mode',
    adminModeActiveDesc: '',
    adminModeEnterCodeDesc: '',
    unlockBtn: 'Buksan',
    exitAdminMode: 'Gwa',
    changeAdminCode: 'Islan ang Code',
    toolsSection: 'Gamit',
    shareAndQrTitle: 'I-share kag QR',
    shareAndQrDesc: '',
    installAppTitle: 'I-install ang App',
    installAppDesc: '',

    // Branch View
    activeBranchLabel: 'Aktibo nga Branch',
    localInventoryLabel: 'Lokal nga Imbentaryo (ENCODING)',
    masterCatalogLabel: 'Master Catalog (MASTERDATA)',
    auditAccessRoleLabel: 'Papel sa Audit',
    lastSyncedLabel: 'Ulihi nga Sync',
    neverSynced: 'Wala pa na-sync',
    resyncBranchData: 'I-sync Liwat ang Branch',
    syncingText: 'Gina-sync...',
    startPhysicalCount: 'Umpisahan ang Pag-isip',
    searchBranchSpreadsheets: 'Magpangita sang Spreadsheet sang Branch',
    searchFilesInDrivePlaceholder: 'Magpangita sang file sa Google Drive...',
    pasteSpreadsheetUrlLabel: 'Ukon i-paste ang URL / ID sang Google Spreadsheet',
    cachedOnDevice: 'Naka-save sa Device',
    offlineReady: 'Handa maskin Offline',
    itemsCached: 'ka produkto nga naka-save',
    noBranchesCachedYet: 'Wala pa sang branch nga naka-save',
    noBranchesCachedDesc:
      'Magpangita ukon magbukas sang Google Spreadsheet sa wala para ma-sync ang mga produkto sa offline barcode scanning.',
    fullOfflineCountingTitle: '⚡ Bug-os nga Offline nga Pag-isip',
    fullOfflineCountingDesc:
      'Kon ma-sync na, ang imbentaryo kag barcode magagana 100% maskin wala internet. Ang mga naisip ginatago sa device kag gina-upload sa Google Sheets kon may internet na.',
    removeCachedBranchTitle: 'Kuhaon ang Naka-save nga Branch',
    branchOwnershipRoleTitle: 'Papel sa Branch',
    chooseYourRoleFor: 'Pilia ang imo papel para sa',
    iAmBranchOwner: 'Ako ang Branch Owner',
    fullAccessBadge: 'Bug-os nga Access',
    branchOwnerDesc:
      'Ang una nga magpili sang Owner amo ang mangin tag-iya sang branch. Makahimo, maka-edit, maka-submit, kag makapanas sang countsheets.',
    iAmEncoder: 'Ako isa ka Encoder',
    encoderDesc:
      'Makahimo sang countsheets, maka-scan sang barcode, kag maka-submit sang isip. Indi makapanas sang countsheets.',
    offlineShowingCached: 'Offline ikaw subong. Ginapakita ang mga naka-save nga branch sa idalom.',
    noSpreadsheetFilesFound: 'Wala sang spreadsheet nga nakita suno sa imo ginpangita.',

    // Count View
    noBranchSelectedTitle: 'Wala sang Napili nga Branch',
    noBranchSelectedCountDesc:
      'Palihog magpili anay sang Google Spreadsheet sang branch para makaumpisa sang pag-isip.',
    loadingCountsheets: 'Gina-load ang mga countsheet...',
    sheetLabel: 'Sheet:',
    submittedBadge: 'Na-submit na',
    draftBadge: 'Draft',
    newCsBtn: 'Bag-o nga CS',
    sheetCapacityLabel: 'Kapasidad sang Sheet',
    fullWord: 'Puno na',
    scanOrLookupItem: 'I-scan ukon Pangitaon ang Produkto',
    enterOrScanBarcodePlaceholder: 'Ibutang ukon i-scan ang barcode...',
    findBtn: 'Pangitaa',
    matchingItemsFound: 'Mga Nagasanto nga Produkto',
    notInListUnidentified: 'Wala sa listahan? Ilista bilang Unidentified Item →',
    unidentifiedItem: 'Wala Nakilala nga Produkto (Unidentified)',
    foundInPrefix: 'Nakita sa',
    enterItemDescriptionLabel: 'Ibutang ang Ngalan / Deskripsyon sang Produkto *',
    itemCodeLabel: 'Item Code',
    categoryLabel: 'Kategorya',
    bookBalanceLabel: 'Book Balance',
    actualCountLabel: 'Aktwal nga Isip',
    itemConditionLabel: 'Kondisyon sang Produkto',
    conditionGood: 'Maayo (Good)',
    conditionBad: 'Guba (Bad)',
    conditionSpoilage: 'Spoilage',
    addToPrefix: 'Idugang sa',
    submittingToSheets: 'Gina-submit sa Google Sheets...',
    offlineSavedLocallyBtn: 'Offline: Naka-save sa device (I-submit kon online na)',
    submitToGoogleSheetsPrefix: 'I-submit ang',
    submitToGoogleSheetsSuffix: 'sa Google Sheets',
    itemsInPrefix: 'Mga Produkto sa',
    totalUnitsLabel: 'Kabilugan nga Isip:',
    filterAll: 'Tanan',
    filterWithVariance: 'May Variance',
    filterMatched: 'Nagasanto (Matched)',
    filterBadUnid: 'Guba / Unidentified',
    filterItemsInCountsheetPlaceholder: 'Pangitaon ang produkto sa sini nga countsheet...',
    noItemsAddedYetPrefix: 'Wala pa sang nadugang nga produkto sa',
    scanBarcodeToAddDesc: 'Mag-scan sang barcode ukon magbutang sang item code sa wala para makadugang.',
    editQtyAndConditionTitle: 'Islan ang Isip kag Kondisyon',
    deleteCountsheetTitlePrefix: 'Panason ang Countsheet',
    discardAndDeleteBtn: 'Padayunon ang Pagpanas',
    deletingText: 'Ginapanas...',

    // Monitoring View
    monitoringSubtitle: 'Monitoring Sheet • Magbaylo sa tunga sang Encoding kag Checking',
    encodingTab: 'ENCODING',
    checkingTab: 'CHECKING',
    clearEncodingBtn: 'Tinloan ang Encoding',
    clearCheckingBtn: 'Tinloan ang Checking',
    confirmClearPrefix: 'Kumpirmahon ang Pagtinlo sang',
    clearingText: 'Ginatinloan...',
    completedOfText: 'ang tapos',
    encoderColumn: 'Encoder',
    checkerColumn: 'Checker',
    statusColumn: 'STATUS',
    statusSet: 'Ibutang',
    statusPending: 'Nagahulat',
    statusInProgress: 'Gina-ubra',
    statusCompleted: 'Tapos na',
    noBranchSelectedMonitoringDesc:
      'Magpili sang spreadsheet sang branch para makita ang progreso sang Encoding kag Checking.',

    // Inventory View
    noBranchSelectedInventoryDesc:
      'Palihog magpili sang branch para makapangita sa lokal nga imbentaryo kag masterdata.',
    productInventoryCatalog: 'Katalogo sang Imbentaryo sang Produkto',
    offlineSnapshotDatabase: 'Offline Snapshot Database',
    viewCountsheetBtn: 'Tan-awon ang Countsheet',
    localTab: 'Lokal',
    masterdataTab: 'Masterdata',
    allItemsFilter: 'Tanan nga Produkto',
    categoryFilter: 'Kategorya',
    subcategoryFilter: 'Subcategory',
    subSubCategoryFilter: 'SubSubCategory',
    resyncMasterdataBtn: 'I-sync Liwat ang Masterdata',
    resyncingMasterdataText: 'Gina-sync ang Masterdata...',
    searchInventoryPlaceholderPrefix: 'Magpangita sang ngalan, item code, ukon barcode...',
    foundWord: 'Nakita:',
    matchingItemsWord: 'ka nagasanto nga produkto',
    showingWord: 'Ginapakita:',
    resetFiltersBtn: 'I-reset ang Filter',
    allBalancesBtn: 'Tanan nga Balanse',
    withBalanceBtn: 'May Balanse',
    zeroNegBtn: 'Zero / Neg',
    cardsViewBtn: 'Cards',
    tableViewBtn: 'Lamesa (Table)',
    barcodeLabel: 'Barcode',
    descriptionLabel: 'Deskripsyon',
    categoryHierarchyLabel: 'Kategorya',
    unitLabel: 'Unit',
    sellingLabel: 'Presyo',
    actionLabel: 'Aksyon',
    countBtn: 'Isipon',
    loadMoreBtn: 'Magpakita pa gid',
    addToCountsheetModalBadge: 'Idugang sa Countsheet',
    targetCountsheetLabel: 'Pakadtuan nga Countsheet',
    confirmAddBtn: 'Kumpirmahon',
  },

  cuyonon: {
    appTitle: 'Inventory Hub',
    selectBranch: 'Magpili i’ang Branch',
    changeBranchOrSync: 'Bayloan ang branch o teleken ang sync',
    navBranch: 'Branch',
    navCount: 'Bilang',
    navMonitoring: 'Monitoring',
    navInventory: 'Imbentaryo',
    adminMode: 'Admin Mode',
    online: 'Online',
    offline: 'Offline',
    offlineBanner: 'Offline Mode — Tanan nga bilang ag pag-intrigo ay alin sa lokal nga cache',
    loadingHub: 'Gina-buksan ang Inventory Hub...',

    openBtn: 'Buksan',
    hideBtn: 'Itago',
    saveBtn: 'I-save',
    cancelBtn: 'Kanselahon',
    selectBtn: 'Pilion',
    removeBtn: 'Boien (Remove)',
    removingText: 'Gina-boî...',
    refreshBtn: 'I-refresh',
    searchingText: 'Gina-intrigo...',
    retryBtn: 'umanen (Retry)',
    itemsWord: 'ka gamit',

    menuTitle: 'Menu',
    reportsSection: 'Mga Report',
    createEncodingTitle: 'Magbuwat i’ang Encoding',
    createEncodingSubtitle: 'IATD pakon sa audit template report',
    createCountsheetTitle: 'Magbuwat i’ang Countsheet',
    createCountsheetSubtitle: 'Magbuwat i’ang listahan i’ang CS01–CSn',
    formsTitle: 'FORMS',
    formsSubtitle: 'ICD FORMS (icdhubsystems@gmail.com) — Teleken ag I-print',
    preferencesSection: 'Mga Kaliliagan',
    settingsTitle: 'Mga Setting',
    settingsSubtitle: 'Tema, Binitakan, Account, ag Gamit',
    trashTitle: 'Basurahan (Trash)',
    trashEmptyDesc: 'Gina-tago ang mga binura sa 30 ka adlaw',
    trashRetentionTitle: '30-Adlaw nga Pag-tago',
    trashRetentionDesc:
      'Ang mga binura nga countsheet ag report ay gina-tago digi sa 30 ka adlaw bago lubos nga mabura. Pwede mo pa ibalik maski anong oras.',
    emptyTrashBtn: 'Limpyuhan ang Trash',
    confirmEmptyBtn: 'Kumpirmahon',
    restoreBtn: 'Ibalik',
    trashIsEmpty: 'Ara laman ang Basurahan',
    logOutTitle: 'Mag-luwas (Log Out)',
    logOutSubtitle: 'Magbalik sa sign-in screen',

    themeAndAppearance: 'Tema',
    appearanceMode: 'Itsura',
    lightMode: 'Maäwag',
    darkMode: 'Madlem',
    systemMode: 'System',
    autoSeasonalTheme: 'Auto Tiempuhan',
    autoSeasonalDesc: '',
    seasonalDecorations: 'Mga Puni',
    seasonalDecorationsDesc: '',
    decorativeCharacters: 'Karake i’ang Karakter',
    densityOff: 'Ara',
    densityMinimal: 'Intik',
    densityBalanced: 'Sakto',
    densityPlayful: 'Marake',
    characterAnimation: 'Giho i’ang Karakter',
    characterAnimationOnDesc: '',
    characterAnimationOffDesc: '',
    themeSelection: 'Mga Tema',
    themeClickToCollapse: '',
    themeClickToCustomize: '',

    languageSection: 'Binitakan',
    changeLanguageTitle: 'Binitakan',
    changeLanguageSubtitle: '',
    languageActiveLabel: 'Binitakan',

    accountSection: 'Account',
    changeProfilePhoto: 'Bayloan ang Litrato',
    changeProfilePhotoDesc: '',
    switchGoogleAccount: 'Magbaylo i’ang Account',
    switchGoogleAccountDesc: '',
    activeEmail: 'Email',
    currentBranch: 'Branch',
    accessRole: 'Role',
    adminAccessCode: 'Admin Access',
    adminModeUnlocked: 'Admin Mode',
    adminModeActiveDesc: '',
    adminModeEnterCodeDesc: '',
    unlockBtn: 'Buksan',
    exitAdminMode: 'Luwas',
    changeAdminCode: 'Bayloan ang Code',
    toolsSection: 'Gamit',
    shareAndQrTitle: 'I-share ag QR',
    shareAndQrDesc: '',
    installAppTitle: 'I-install ang App',
    installAppDesc: '',

    // Branch View
    activeBranchLabel: 'Aktibo nga Branch',
    localInventoryLabel: 'Lokal nga Imbentaryo (ENCODING)',
    masterCatalogLabel: 'Master Catalog (MASTERDATA)',
    auditAccessRoleLabel: 'Katungdanan sa Audit',
    lastSyncedLabel: 'Urihing Sync',
    neverSynced: 'Ara pa ma-sync',
    resyncBranchData: 'I-sync Uman ang Branch',
    syncingText: 'Gina-sync...',
    startPhysicalCount: 'Mag-umpisa i’ang Pagbilang',
    searchBranchSpreadsheets: 'Mag-intrigo i’ang Spreadsheet i’ang Branch',
    searchFilesInDrivePlaceholder: 'Mag-intrigo i’ang file sa Google Drive...',
    pasteSpreadsheetUrlLabel: 'O i-paste ang URL / ID i’ang Google Spreadsheet',
    cachedOnDevice: 'Naka-save sa Device',
    offlineReady: 'Andam sa Offline',
    itemsCached: 'ka produkto nga naka-save',
    noBranchesCachedYet: 'Ara pa branch nga naka-save',
    noBranchesCachedDesc:
      'Mag-intrigo o magbukas i’ang Google Spreadsheet sa wala para ma-sync ang mga produkto sa offline barcode scanning.',
    fullOfflineCountingTitle: '⚡ Lubos nga Offline nga Pagbilang',
    fullOfflineCountingDesc:
      'Pagkatapos ma-sync, ang imbentaryo ag barcode ay gagana 100% maski ara internet. Ang mga nabilang ay naka-save sa device ag gina-upload sa Google Sheets pag may internet ren.',
    removeCachedBranchTitle: 'Boien ang Naka-save nga Branch',
    branchOwnershipRoleTitle: 'Katungdanan sa Branch',
    chooseYourRoleFor: 'Pilia ang imong katungdanan para sa',
    iAmBranchOwner: 'Ako ang Branch Owner',
    fullAccessBadge: 'Lubos nga Access',
    branchOwnerDesc:
      'Ang unang magpili i’ang Owner ang magiging tag-iya i’ang branch. Makabuwat, maka-edit, maka-submit, ag makabura i’ang countsheets.',
    iAmEncoder: 'Ako ay Encoder',
    encoderDesc:
      'Makabuwat i’ang countsheets, maka-scan i’ang barcode, ag maka-submit i’ang bilang. Indi makabura i’ang countsheets.',
    offlineShowingCached: 'Offline kaw dadi. Gina-pakita ang mga naka-save nga branch sa idalem.',
    noSpreadsheetFilesFound: 'Ara spreadsheet nga nakita suno sa imong gina-intrigo.',

    // Count View
    noBranchSelectedTitle: 'Ara Napili nga Branch',
    noBranchSelectedCountDesc:
      'Paki-pili anay i’ang Google Spreadsheet i’ang branch para maka-umpisa i’ang pagbilang.',
    loadingCountsheets: 'Gina-buksan ang mga countsheet...',
    sheetLabel: 'Sheet:',
    submittedBadge: 'Na-pasa ren',
    draftBadge: 'Draft',
    newCsBtn: 'Bagong CS',
    sheetCapacityLabel: 'Laman i’ang Sheet',
    fullWord: 'Puno ren',
    scanOrLookupItem: 'I-scan o Intriguhon ang Produkto',
    enterOrScanBarcodePlaceholder: 'Ibutang o i-scan ang barcode...',
    findBtn: 'Intriguhon',
    matchingItemsFound: 'Mga Nagatugma nga Produkto',
    notInListUnidentified: 'Ara sa listahan? Ilista bilang Unidentified Item →',
    unidentifiedItem: 'Indi Kilala nga Produkto (Unidentified)',
    foundInPrefix: 'Nakita sa',
    enterItemDescriptionLabel: 'Ibutang ang Ngaran / Deskripsyon i’ang Produkto *',
    itemCodeLabel: 'Item Code',
    categoryLabel: 'Kategorya',
    bookBalanceLabel: 'Book Balance',
    actualCountLabel: 'Aktwal nga Bilang',
    itemConditionLabel: 'Kondisyon i’ang Produkto',
    conditionGood: 'Mayad (Good)',
    conditionBad: 'Raet (Bad)',
    conditionSpoilage: 'Spoilage',
    addToPrefix: 'Idugang sa',
    submittingToSheets: 'Gina-pasa sa Google Sheets...',
    offlineSavedLocallyBtn: 'Offline: Naka-save sa device (Ipasa pag online ren)',
    submitToGoogleSheetsPrefix: 'Ipasa ang',
    submitToGoogleSheetsSuffix: 'sa Google Sheets',
    itemsInPrefix: 'Mga Produkto sa',
    totalUnitsLabel: 'Kabilugan nga Bilang:',
    filterAll: 'Tanan',
    filterWithVariance: 'May Variance',
    filterMatched: 'Tugma (Matched)',
    filterBadUnid: 'Raet / Unidentified',
    filterItemsInCountsheetPlaceholder: 'Salain ang mga produkto sa countsheet nga dia...',
    noItemsAddedYetPrefix: 'Ara pa nadugang nga produkto sa',
    scanBarcodeToAddDesc: 'Mag-scan i’ang barcode o magbutang i’ang item code sa wala para makadugang.',
    editQtyAndConditionTitle: 'Bayloan ang Bilang ag Kondisyon',
    deleteCountsheetTitlePrefix: 'Burahon ang Countsheet',
    discardAndDeleteBtn: 'Padayunon ang Pagbura',
    deletingText: 'Gina-bura...',

    // Monitoring View
    monitoringSubtitle: 'Monitoring Sheet • Magbaylo sa tunga i’ang Encoding ag Checking',
    encodingTab: 'ENCODING',
    checkingTab: 'CHECKING',
    clearEncodingBtn: 'Limpyuhan ang Encoding',
    clearCheckingBtn: 'Limpyuhan ang Checking',
    confirmClearPrefix: 'Kumpirmahon ang Paglimpyo sa',
    clearingText: 'Gina-limpyuhan...',
    completedOfText: 'ang tapos',
    encoderColumn: 'Encoder',
    checkerColumn: 'Checker',
    statusColumn: 'STATUS',
    statusSet: 'Ibutang',
    statusPending: 'Nagahulat',
    statusInProgress: 'Gina-buwat',
    statusCompleted: 'Tapos ren',
    noBranchSelectedMonitoringDesc:
      'Magpili i’ang spreadsheet i’ang branch para makita ang progreso i’ang Encoding ag Checking.',

    // Inventory View
    noBranchSelectedInventoryDesc:
      'Paki-pili i’ang branch para maka-intrigo sa lokal nga imbentaryo ag masterdata.',
    productInventoryCatalog: 'Katalogo i’ang Imbentaryo i’ang Produkto',
    offlineSnapshotDatabase: 'Offline Snapshot Database',
    viewCountsheetBtn: 'Teleken ang Countsheet',
    localTab: 'Lokal',
    masterdataTab: 'Masterdata',
    allItemsFilter: 'Tanan nga Produkto',
    categoryFilter: 'Kategorya',
    subcategoryFilter: 'Subcategory',
    subSubCategoryFilter: 'SubSubCategory',
    resyncMasterdataBtn: 'I-sync Uman ang Masterdata',
    resyncingMasterdataText: 'Gina-sync ang Masterdata...',
    searchInventoryPlaceholderPrefix: 'Mag-intrigo i’ang ngaran, item code, o barcode...',
    foundWord: 'Nakita:',
    matchingItemsWord: 'ka nagatugma nga produkto',
    showingWord: 'Gina-pakita:',
    resetFiltersBtn: 'I-reset ang Filter',
    allBalancesBtn: 'Tanan nga Balanse',
    withBalanceBtn: 'May Balanse',
    zeroNegBtn: 'Zero / Neg',
    cardsViewBtn: 'Cards',
    tableViewBtn: 'Lamesa (Table)',
    barcodeLabel: 'Barcode',
    descriptionLabel: 'Deskripsyon',
    categoryHierarchyLabel: 'Kategorya',
    unitLabel: 'Unit',
    sellingLabel: 'Presyo',
    actionLabel: 'Aksyon',
    countBtn: 'Bilangon',
    loadMoreBtn: 'Magpakita pa',
    addToCountsheetModalBadge: 'Idugang sa Countsheet',
    targetCountsheetLabel: 'Pakadtuan nga Countsheet',
    confirmAddBtn: 'Kumpirmahon',
  },

  mindoro: {
    appTitle: 'Inventory Hub',
    selectBranch: 'Pumili ga ng Sangay',
    changeBranchOrSync: 'Palitan ang sangay o tingnan baga ang sync',
    navBranch: 'Sangay',
    navCount: 'Bilang',
    navMonitoring: 'Monitoring',
    navInventory: 'Imbentaryo',
    adminMode: 'Admin Mode',
    online: 'Online',
    offline: 'Offline',
    offlineBanner: 'Offline Mode — Lahat ga ng bilang at hanap ay galing sa lokal na cache',
    loadingHub: 'Binubuksan ga ang Inventory Hub...',

    openBtn: 'Buksan',
    hideBtn: 'Itago',
    saveBtn: 'I-save',
    cancelBtn: 'Kanselahin',
    selectBtn: 'Piliin',
    removeBtn: 'Alisin',
    removingText: 'Inaalis...',
    refreshBtn: 'I-refresh',
    searchingText: 'Naghahanap ga...',
    retryBtn: 'Ulitin',
    itemsWord: 'na gamit',

    menuTitle: 'Menu',
    reportsSection: 'Mga Ulat',
    createEncodingTitle: 'Gumawa ng Encoding',
    createEncodingSubtitle: 'IATD papuntang audit template report',
    createCountsheetTitle: 'Gumawa ng Countsheet',
    createCountsheetSubtitle: 'Bumuo ng listahan ng CS01–CSn',
    formsTitle: 'FORMS',
    formsSubtitle: 'ICD FORMS — Tingnan at I-print',
    preferencesSection: 'Mga Gusto',
    settingsTitle: 'Mga Setting',
    settingsSubtitle: 'Tema, Salita, Account, at Gamit',
    trashTitle: 'Basurahan (Trash)',
    trashEmptyDesc: 'Nakatabi nang 30 araw ang mga nabura',
    trashRetentionTitle: '30-Araw na Pagtatabi',
    trashRetentionDesc:
      'Ang mga naburang countsheet at report ay nakatabi rito nang 30 araw bago tuluyang mabura. Pwede mo pa baga itong ibalik kahit anong oras.',
    emptyTrashBtn: 'Linisin ang Trash',
    confirmEmptyBtn: 'Sigurado Ga',
    restoreBtn: 'Ibalik',
    trashIsEmpty: 'Walang laman ga ang Trash',
    logOutTitle: 'Mag-log Out',
    logOutSubtitle: 'Bumalik sa sign-in screen',

    themeAndAppearance: 'Tema',
    appearanceMode: 'Hitsura',
    lightMode: 'Maliwanag',
    darkMode: 'Madilim',
    systemMode: 'System',
    autoSeasonalTheme: 'Auto Panahon',
    autoSeasonalDesc: '',
    seasonalDecorations: 'Palamuti',
    seasonalDecorationsDesc: '',
    decorativeCharacters: 'Dami ng Karakter',
    densityOff: 'Wala',
    densityMinimal: 'Kaunti',
    densityBalanced: 'Katamtaman',
    densityPlayful: 'Marami',
    characterAnimation: 'Galaw ng Karakter',
    characterAnimationOnDesc: '',
    characterAnimationOffDesc: '',
    themeSelection: 'Mga Tema',
    themeClickToCollapse: '',
    themeClickToCustomize: '',

    languageSection: 'Salita (Mindoreño)',
    changeLanguageTitle: 'Salita',
    changeLanguageSubtitle: '',
    languageActiveLabel: 'Salita',

    accountSection: 'Account',
    changeProfilePhoto: 'Palitan ang Litrato',
    changeProfilePhotoDesc: '',
    switchGoogleAccount: 'Magpalit ng Account',
    switchGoogleAccountDesc: '',
    activeEmail: 'Email',
    currentBranch: 'Sangay',
    accessRole: 'Role',
    adminAccessCode: 'Admin Access',
    adminModeUnlocked: 'Admin Mode',
    adminModeActiveDesc: '',
    adminModeEnterCodeDesc: '',
    unlockBtn: 'Buksan',
    exitAdminMode: 'Isara',
    changeAdminCode: 'Palitan ang Code',
    toolsSection: 'Gamit',
    shareAndQrTitle: 'I-share at QR',
    shareAndQrDesc: '',
    installAppTitle: 'I-install ang App',
    installAppDesc: '',

    // Branch View
    activeBranchLabel: 'Aktibong Sangay',
    localInventoryLabel: 'Lokal na Imbentaryo (ENCODING)',
    masterCatalogLabel: 'Master Catalog (MASTERDATA)',
    auditAccessRoleLabel: 'Tungkulin sa Audit',
    lastSyncedLabel: 'Huling Na-sync',
    neverSynced: 'Hindi pa ga na-sync',
    resyncBranchData: 'I-sync Ulit ang Sangay',
    syncingText: 'Nag-si-sync ga...',
    startPhysicalCount: 'Simulan na ang Pagbibilang',
    searchBranchSpreadsheets: 'Maghanap ga ng Spreadsheet ng Sangay',
    searchFilesInDrivePlaceholder: 'Maghanap ng file sa Google Drive...',
    pasteSpreadsheetUrlLabel: 'O i-paste baga ang URL / ID ng Google Spreadsheet',
    cachedOnDevice: 'Naka-save sa Device',
    offlineReady: 'Handa sa Offline',
    itemsCached: 'aytem na naka-save',
    noBranchesCachedYet: 'Wala pa gang naka-save na sangay',
    noBranchesCachedDesc:
      'Maghanap o magbukas muna ga ng Google Spreadsheet sa kaliwa para ma-sync ang mga paninda sa offline barcode scanning.',
    fullOfflineCountingTitle: '⚡ Buong Offline na Pagbibilang',
    fullOfflineCountingDesc:
      'Pagka na-sync na, gagana nang 100% ang imbentaryo at barcode kahit walang signal o internet. Naka-save sa device ang bilang at ia-upload sa Google Sheets pag may internet na ulit.',
    removeCachedBranchTitle: 'Alisin ang Naka-save na Sangay',
    branchOwnershipRoleTitle: 'Tungkulin sa Sangay',
    chooseYourRoleFor: 'Ano ga ang tungkulin mo para sa',
    iAmBranchOwner: 'Ako ang Branch Owner',
    fullAccessBadge: 'Buong Access',
    branchOwnerDesc:
      'Ang unang kukuha ng Owner ang magiging may-ari ng sangay. Pwede gumawa, mag-edit, mag-submit, at magbura ng countsheets.',
    iAmEncoder: 'Ako ay Encoder',
    encoderDesc:
      'Pwede gumawa ng countsheets, mag-scan ng barcode, at mag-submit ng bilang. Hindi pwedeng magbura ng countsheets.',
    offlineShowingCached: 'Offline ka ga ngayon. Ipinapakita ang mga naka-save na sangay sa ibaba.',
    noSpreadsheetFilesFound: 'Walang nakitang spreadsheet na tugma sa hinahanap mo ga.',

    // Count View
    noBranchSelectedTitle: 'Walang Napiling Sangay',
    noBranchSelectedCountDesc:
      'Pumili muna ga ng Google Spreadsheet ng sangay para makapagsimula ng pagbibilang.',
    loadingCountsheets: 'Binubuksan ga ang mga countsheet...',
    sheetLabel: 'Sheet:',
    submittedBadge: 'Naipasa na',
    draftBadge: 'Draft',
    newCsBtn: 'Bagong CS',
    sheetCapacityLabel: 'Laman ng Sheet',
    fullWord: 'Puno na',
    scanOrLookupItem: 'I-scan o Hanapin ga ang Aytem',
    enterOrScanBarcodePlaceholder: 'Ilagay o i-scan ang barcode...',
    findBtn: 'Hanapin',
    matchingItemsFound: 'Mga Tugmang Aytem',
    notInListUnidentified: 'Wala ga sa listahan? Itala bilang Unidentified Item →',
    unidentifiedItem: 'Hindi Kilalang Aytem (Unidentified)',
    foundInPrefix: 'Nakita sa',
    enterItemDescriptionLabel: 'Ilagay ang Pangalan / Deskripsyon ng Aytem *',
    itemCodeLabel: 'Item Code',
    categoryLabel: 'Kategorya',
    bookBalanceLabel: 'Book Balance',
    actualCountLabel: 'Aktwal na Bilang',
    itemConditionLabel: 'Kondisyon ng Aytem',
    conditionGood: 'Maayos (Good)',
    conditionBad: 'Sira (Bad)',
    conditionSpoilage: 'Spoilage',
    addToPrefix: 'Idagdag sa',
    submittingToSheets: 'Ipina-pasa na sa Google Sheets...',
    offlineSavedLocallyBtn: 'Offline: Naka-save sa device (Ipapasa pag online na)',
    submitToGoogleSheetsPrefix: 'Ipasa ang',
    submitToGoogleSheetsSuffix: 'sa Google Sheets',
    itemsInPrefix: 'Mga Aytem sa',
    totalUnitsLabel: 'Kabuuang Bilang:',
    filterAll: 'Lahat',
    filterWithVariance: 'May Variance',
    filterMatched: 'Tugma (Matched)',
    filterBadUnid: 'Sira / Unidentified',
    filterItemsInCountsheetPlaceholder: 'Hanapin ang aytem sa countsheet na ito...',
    noItemsAddedYetPrefix: 'Wala pa gang nailalagay na aytem sa',
    scanBarcodeToAddDesc: 'Mag-scan ng barcode o maglagay ng item code sa kaliwa para makapagdagdag.',
    editQtyAndConditionTitle: 'Baguhin ang Bilang at Kondisyon',
    deleteCountsheetTitlePrefix: 'Burahin ga ang Countsheet',
    discardAndDeleteBtn: 'Ituloy ang Pagbura',
    deletingText: 'Binubura...',

    // Monitoring View
    monitoringSubtitle: 'Monitoring Sheet • Lumipat sa pagitan ng Encoding at Checking',
    encodingTab: 'ENCODING',
    checkingTab: 'CHECKING',
    clearEncodingBtn: 'Linisin ang Encoding',
    clearCheckingBtn: 'Linisin ang Checking',
    confirmClearPrefix: 'Sigurado ga sa Paglinis ng',
    clearingText: 'Nililinis...',
    completedOfText: 'ang tapos',
    encoderColumn: 'Encoder',
    checkerColumn: 'Checker',
    statusColumn: 'STATUS',
    statusSet: 'Itakda',
    statusPending: 'Naghihintay',
    statusInProgress: 'Ginagawa',
    statusCompleted: 'Tapos na',
    noBranchSelectedMonitoringDesc:
      'Pumili muna ga ng spreadsheet ng sangay para makita ang progreso ng Encoding at Checking.',

    // Inventory View
    noBranchSelectedInventoryDesc:
      'Pumili muna ga ng sangay para makapaghanap sa lokal na imbentaryo at masterdata.',
    productInventoryCatalog: 'Katalogo ng Imbentaryo ng Produkto',
    offlineSnapshotDatabase: 'Offline Snapshot Database',
    viewCountsheetBtn: 'Tingnan ang Countsheet',
    localTab: 'Lokal',
    masterdataTab: 'Masterdata',
    allItemsFilter: 'Lahat ng Aytem',
    categoryFilter: 'Kategorya',
    subcategoryFilter: 'Subcategory',
    subSubCategoryFilter: 'SubSubCategory',
    resyncMasterdataBtn: 'I-sync Ulit ang Masterdata',
    resyncingMasterdataText: 'Nag-si-sync ga ng Masterdata...',
    searchInventoryPlaceholderPrefix: 'Maghanap ga ng pangalan, item code, o barcode...',
    foundWord: 'Nakita:',
    matchingItemsWord: 'tugmang aytem',
    showingWord: 'Ipinapakita:',
    resetFiltersBtn: 'I-reset ang Filter',
    allBalancesBtn: 'Lahat ng Balanse',
    withBalanceBtn: 'May Balanse',
    zeroNegBtn: 'Zero / Neg',
    cardsViewBtn: 'Cards',
    tableViewBtn: 'Talahanayan',
    barcodeLabel: 'Barcode',
    descriptionLabel: 'Deskripsyon',
    categoryHierarchyLabel: 'Kategorya',
    unitLabel: 'Yunit',
    sellingLabel: 'Presyo',
    actionLabel: 'Aksyon',
    countBtn: 'Bilangin',
    loadMoreBtn: 'Magpakita pa',
    addToCountsheetModalBadge: 'Idagdag sa Countsheet',
    targetCountsheetLabel: 'Patutunguhang Countsheet',
    confirmAddBtn: 'Kumpirmahin',
  },

  bikol: {
    appTitle: 'Inventory Hub',
    selectBranch: 'Magpili nin Branch',
    changeBranchOrSync: 'Ribayan an branch o hilingon an sync',
    navBranch: 'Branch',
    navCount: 'Bilang',
    navMonitoring: 'Monitoring',
    navInventory: 'Imbentaryo',
    adminMode: 'Admin Mode',
    online: 'Online',
    offline: 'Offline',
    offlineBanner: 'Offline Mode — Gabos na bilang asin paghanap hali sa lokal na cache',
    loadingHub: 'Binubuksan an Inventory Hub...',

    openBtn: 'Buksan',
    hideBtn: 'Tagoon',
    saveBtn: 'I-save',
    cancelBtn: 'Kanselaron',
    selectBtn: 'Pilion',
    removeBtn: 'Halion',
    removingText: 'Hinahali...',
    refreshBtn: 'I-refresh',
    searchingText: 'Naghahanap...',
    retryBtn: 'Purbaran Giraray',
    itemsWord: 'na gamit',

    menuTitle: 'Menu',
    reportsSection: 'Mga Report',
    createEncodingTitle: 'Magibo nin Encoding',
    createEncodingSubtitle: 'IATD pasiring sa audit template report',
    createCountsheetTitle: 'Magibo nin Countsheet',
    createCountsheetSubtitle: 'Magibo nin listahan nin CS01–CSn',
    formsTitle: 'FORMS',
    formsSubtitle: 'ICD FORMS — Hilingon asin I-print',
    preferencesSection: 'Mga Mawot',
    settingsTitle: 'Mga Setting',
    settingsSubtitle: 'Tema, Tataramon, Account, asin Gamit',
    trashTitle: 'Basurahan (Trash)',
    trashEmptyDesc: 'Nakatago nin 30 aldaw an mga pinara',
    trashRetentionTitle: '30-Aldaw na Pagtago',
    trashRetentionDesc:
      'An mga pinarang countsheet asin report nakatago digdi sa laog nin 30 aldaw bago biyong mapara. Pwede mo pa ining ibalik maski anong oras.',
    emptyTrashBtn: 'Linigan an Trash',
    confirmEmptyBtn: 'Kumpirmaron',
    restoreBtn: 'Ibalik',
    trashIsEmpty: 'Mayo nin laog an Trash',
    logOutTitle: 'Mag-luwas (Log Out)',
    logOutSubtitle: 'Magbwelta sa sign-in screen',

    themeAndAppearance: 'Tema',
    appearanceMode: 'Itsura',
    lightMode: 'Maliwanag',
    darkMode: 'Madiklom',
    systemMode: 'System',
    autoSeasonalTheme: 'Auto Panahon',
    autoSeasonalDesc: '',
    seasonalDecorations: 'Mga Samno',
    seasonalDecorationsDesc: '',
    decorativeCharacters: 'Kadakulan nin Karakter',
    densityOff: 'Mayo',
    densityMinimal: 'Diit',
    densityBalanced: 'Sakto',
    densityPlayful: 'Dakol',
    characterAnimation: 'Hiro nin Karakter',
    characterAnimationOnDesc: '',
    characterAnimationOffDesc: '',
    themeSelection: 'Mga Tema',
    themeClickToCollapse: '',
    themeClickToCustomize: '',

    languageSection: 'Tataramon (Bikol)',
    changeLanguageTitle: 'Tataramon',
    changeLanguageSubtitle: '',
    languageActiveLabel: 'Tataramon',

    accountSection: 'Account',
    changeProfilePhoto: 'Ribayan an Litrato',
    changeProfilePhotoDesc: '',
    switchGoogleAccount: 'Magribay nin Account',
    switchGoogleAccountDesc: '',
    activeEmail: 'Email',
    currentBranch: 'Branch',
    accessRole: 'Role',
    adminAccessCode: 'Admin Access',
    adminModeUnlocked: 'Admin Mode',
    adminModeActiveDesc: '',
    adminModeEnterCodeDesc: '',
    unlockBtn: 'Buksan',
    exitAdminMode: 'Luwas',
    changeAdminCode: 'Ribayan an Code',
    toolsSection: 'Gamit',
    shareAndQrTitle: 'I-share asin QR',
    shareAndQrDesc: '',
    installAppTitle: 'I-install an App',
    installAppDesc: '',

    // Branch View
    activeBranchLabel: 'Aktibong Branch',
    localInventoryLabel: 'Lokal na Imbentaryo (ENCODING)',
    masterCatalogLabel: 'Master Catalog (MASTERDATA)',
    auditAccessRoleLabel: 'Katungdanan sa Audit',
    lastSyncedLabel: 'Huring Na-sync',
    neverSynced: 'Dai pa na-sync',
    resyncBranchData: 'I-sync Giraray an Branch',
    syncingText: 'Nag-si-sync...',
    startPhysicalCount: 'Pun-an na an Pagbilang',
    searchBranchSpreadsheets: 'Maghanap nin Spreadsheet kan Branch',
    searchFilesInDrivePlaceholder: 'Maghanap nin file sa Google Drive...',
    pasteSpreadsheetUrlLabel: 'O i-paste an URL / ID kan Google Spreadsheet',
    cachedOnDevice: 'Naka-save sa Device',
    offlineReady: 'Andam sa Offline',
    itemsCached: 'na produkto an naka-save',
    noBranchesCachedYet: 'Mayo pa nin naka-save na branch',
    noBranchesCachedDesc:
      'Maghanap o magbukas nin Google Spreadsheet sa wala tanganing ma-sync an mga produkto para sa offline barcode scanning.',
    fullOfflineCountingTitle: '⚡ Bilog na Offline na Pagbilang',
    fullOfflineCountingDesc:
      'Pag na-sync na, an imbentaryo asin barcode ma-andar nin 100% maski mayo nin internet. An mga nabilang naka-save sa device asin i-a-upload sa Google Sheets pag may internet na.',
    removeCachedBranchTitle: 'Halion an Naka-save na Branch',
    branchOwnershipRoleTitle: 'Katungdanan sa Branch',
    chooseYourRoleFor: 'Pilion an saimong katungdanan para sa',
    iAmBranchOwner: 'Ako an Branch Owner',
    fullAccessBadge: 'Bilog na Access',
    branchOwnerDesc:
      'An enot na magkua kan Owner iyo an magigingagsadiri kan branch. Makagibo, maka-edit, maka-submit, asin makapara nin countsheets.',
    iAmEncoder: 'Ako sarong Encoder',
    encoderDesc:
      'Makagibo nin countsheets, maka-scan nin barcode, asin maka-submit nin bilang. Dai makapara nin countsheets.',
    offlineShowingCached: 'Offline ka ngunyan. Ipinapahiling an mga naka-save na branch sa ibaba.',
    noSpreadsheetFilesFound: 'Mayo nin nahanap na spreadsheet na kapareho kan saimong hinahanap.',

    // Count View
    noBranchSelectedTitle: 'Mayong Napiling Branch',
    noBranchSelectedCountDesc:
      'Magpili muna nin Google Spreadsheet kan branch tanganing makapoon sa pagbilang.',
    loadingCountsheets: 'Binubuksan an mga countsheet...',
    sheetLabel: 'Sheet:',
    submittedBadge: 'Naipasa na',
    draftBadge: 'Draft',
    newCsBtn: 'Bagong CS',
    sheetCapacityLabel: 'Laog kan Sheet',
    fullWord: 'Pano na',
    scanOrLookupItem: 'I-scan o Hanapon an Produkto',
    enterOrScanBarcodePlaceholder: 'Ilaag o i-scan an barcode...',
    findBtn: 'Hanapon',
    matchingItemsFound: 'Mga Nagkaparehong Produkto',
    notInListUnidentified: 'Mayo sa listahan? Ilista bilang Unidentified Item →',
    unidentifiedItem: 'Dai Midbid na Produkto (Unidentified)',
    foundInPrefix: 'Nahanap sa',
    enterItemDescriptionLabel: 'Ilaag an Pangaran / Deskripsyon kan Produkto *',
    itemCodeLabel: 'Item Code',
    categoryLabel: 'Kategorya',
    bookBalanceLabel: 'Book Balance',
    actualCountLabel: 'Aktwal na Bilang',
    itemConditionLabel: 'Kondisyon kan Produkto',
    conditionGood: 'Marhay (Good)',
    conditionBad: 'Raot (Bad)',
    conditionSpoilage: 'Spoilage',
    addToPrefix: 'Idagdag sa',
    submittingToSheets: 'Ipinapasa sa Google Sheets...',
    offlineSavedLocallyBtn: 'Offline: Naka-save sa device (Ipapasa pag online na)',
    submitToGoogleSheetsPrefix: 'Ipasa an',
    submitToGoogleSheetsSuffix: 'sa Google Sheets',
    itemsInPrefix: 'Mga Produkto sa',
    totalUnitsLabel: 'Kabilogan na Bilang:',
    filterAll: 'Gabos',
    filterWithVariance: 'May Variance',
    filterMatched: 'Tugma (Matched)',
    filterBadUnid: 'Raot / Unidentified',
    filterItemsInCountsheetPlaceholder: 'Pilion an mga produkto sa countsheet na ini...',
    noItemsAddedYetPrefix: 'Mayo pa nin nadagdag na produkto sa',
    scanBarcodeToAddDesc: 'Mag-scan nin barcode o maglaag nin item code sa wala tanganing makadagdag.',
    editQtyAndConditionTitle: 'Ribayan an Bilang asin Kondisyon',
    deleteCountsheetTitlePrefix: 'Paraon an Countsheet',
    discardAndDeleteBtn: 'Padagos an Pagpara',
    deletingText: 'Pinapara...',

    // Monitoring View
    monitoringSubtitle: 'Monitoring Sheet • Magribay sa pag-ultanan kan Encoding asin Checking',
    encodingTab: 'ENCODING',
    checkingTab: 'CHECKING',
    clearEncodingBtn: 'Linigan an Encoding',
    clearCheckingBtn: 'Linigan an Checking',
    confirmClearPrefix: 'Kumpirmaron an Paglinig sa',
    clearingText: 'Nililinigan...',
    completedOfText: 'an tapos',
    encoderColumn: 'Encoder',
    checkerColumn: 'Checker',
    statusColumn: 'STATUS',
    statusSet: 'Ilaag',
    statusPending: 'Naglalaom',
    statusInProgress: 'Ginibo',
    statusCompleted: 'Tapos na',
    noBranchSelectedMonitoringDesc:
      'Magpili nin spreadsheet kan branch tanganing mahiling an progreso kan Encoding asin Checking.',

    // Inventory View
    noBranchSelectedInventoryDesc:
      'Magpili muna nin branch tanganing makahanap sa lokal na imbentaryo asin masterdata.',
    productInventoryCatalog: 'Katalogo kan Imbentaryo nin Produkto',
    offlineSnapshotDatabase: 'Offline Snapshot Database',
    viewCountsheetBtn: 'Hilingon an Countsheet',
    localTab: 'Lokal',
    masterdataTab: 'Masterdata',
    allItemsFilter: 'Gabos na Produkto',
    categoryFilter: 'Kategorya',
    subcategoryFilter: 'Subcategory',
    subSubCategoryFilter: 'SubSubCategory',
    resyncMasterdataBtn: 'I-sync Giraray an Masterdata',
    resyncingMasterdataText: 'Nag-si-sync kan Masterdata...',
    searchInventoryPlaceholderPrefix: 'Maghanap nin pangaran, item code, o barcode...',
    foundWord: 'Nahanap:',
    matchingItemsWord: 'na nagkaparehong produkto',
    showingWord: 'Ipinapahiling:',
    resetFiltersBtn: 'I-reset an Filter',
    allBalancesBtn: 'Gabos na Balanse',
    withBalanceBtn: 'May Balanse',
    zeroNegBtn: 'Zero / Neg',
    cardsViewBtn: 'Cards',
    tableViewBtn: 'Lamesa (Table)',
    barcodeLabel: 'Barcode',
    descriptionLabel: 'Deskripsyon',
    categoryHierarchyLabel: 'Kategorya',
    unitLabel: 'Unit',
    sellingLabel: 'Presyo',
    actionLabel: 'Aksyon',
    countBtn: 'Bilangon',
    loadMoreBtn: 'Magpahiling pa',
    addToCountsheetModalBadge: 'Idagdag sa Countsheet',
    targetCountsheetLabel: 'Pasiringan na Countsheet',
    confirmAddBtn: 'Kumpirmaron',
  },
};

const STORAGE_KEY = 'countsheet_app_language';
const LANGUAGE_CHANGE_EVENT = 'countsheet-language-change';

export function getSavedLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as AppLanguage | null;
    if (
      saved &&
      (saved === 'en' ||
        saved === 'fil' ||
        saved === 'mindoro' ||
        saved === 'bikol' ||
        saved === 'capiznon' ||
        saved === 'cuyonon')
    ) {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'en';
}

export function setSavedLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.setAttribute('lang', lang === 'fil' ? 'tl' : lang);
    window.dispatchEvent(new CustomEvent<AppLanguage>(LANGUAGE_CHANGE_EVENT, { detail: lang }));
  } catch {
    // ignore storage errors
  }
}

interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  t: TranslationDictionary;
  currentLanguageMeta: LanguageOption;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
  t: TRANSLATIONS.en,
  currentLanguageMeta: LANGUAGE_OPTIONS[0],
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<AppLanguage>(() => getSavedLanguage());

  useEffect(() => {
    const handleStorageOrCustom = (e: Event) => {
      const customEvent = e as CustomEvent<AppLanguage>;
      if (customEvent.detail) {
        setLanguageState(customEvent.detail);
      } else {
        setLanguageState(getSavedLanguage());
      }
    };

    window.addEventListener(LANGUAGE_CHANGE_EVENT, handleStorageOrCustom);
    window.addEventListener('storage', handleStorageOrCustom);
    return () => {
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, handleStorageOrCustom);
      window.removeEventListener('storage', handleStorageOrCustom);
    };
  }, []);

  const handleSetLanguage = (nextLang: AppLanguage) => {
    setLanguageState(nextLang);
    setSavedLanguage(nextLang);
  };

  const value = useMemo<LanguageContextValue>(() => {
    const currentLanguageMeta =
      LANGUAGE_OPTIONS.find((opt) => opt.id === language) || LANGUAGE_OPTIONS[0];
    return {
      language,
      setLanguage: handleSetLanguage,
      t: TRANSLATIONS[language] || TRANSLATIONS.en,
      currentLanguageMeta,
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
