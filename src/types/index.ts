export interface InventoryItem {
  itemCode: string;
  barcode: string;
  itemDescription: string;
  category: string;
  subCategory: string;
  subsubCategory: string;
  cost: number;
  selling: number;
  unit: string;
  balance: number;
  begQty?: number;
  in?: number;
  out?: number;
  amount?: number;
  gp?: number;
  source: 'ENCODING' | 'MASTERDATA';
}

export type ItemCondition = 'Good' | 'Bad' | 'Spoilage';

export interface CountsheetItem {
  id: string;
  itemCode: string;
  barcode: string;
  itemDescription: string;
  category: string;
  subCategory: string;
  subsubCategory: string;
  cost: number;
  selling: number;
  unit: string;
  balance: number;
  actualCount: number;
  condition?: ItemCondition;
  cs: number; // Numeric countsheet number: 1, 2, 3...
  isUnidentified?: boolean;
  timestamp: number;
}

export interface Countsheet {
  cs: number; // 1, 2, 3...
  name: string; // "CS01", "CS02"...
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  auditorName: string;
  auditorEmail: string;
  items: CountsheetItem[];
  status: 'draft' | 'submitted';
}

export interface MonitoringBlock {
  csRange: string; // e.g. "CS01–CS05"
  startCs: number;
  endCs: number;
  auditor: string;
  status: 'In Progress' | 'Completed';
  sheetCount: number;
  totalItems: number;
  lastUpdated?: string;
}

export interface UnidentifiedItemRecord {
  barcode: string;
  itemDescription: string;
  unit: string;
  actualCount: number;
  countsheet: string; // "CS01"
  auditor: string;
  date: string;
}

export interface BranchRoleInfo {
  spreadsheetId: string;
  spreadsheetName: string;
  hasOwner: boolean;
  ownerEmail: string | null;
  ownerName: string | null;
  currentRole: 'owner' | 'encoder' | 'unassigned';
}

export interface SelectedBranch {
  id: string;
  name: string;
  modifiedTime?: string;
  owner?: string;
  lastSyncedAt?: string;
  encodingCount: number;
  masterdataCount: number;
}

export interface RememberedUser {
  displayName: string;
  email: string;
  photoURL?: string | null;
  lastSignedInAt?: string;
}
