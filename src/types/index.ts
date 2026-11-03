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
  masterdataSheet?: 'GRO' | 'OTHERS' | string;
  sheetRowNumber?: number; // 1-based row number in the IATD / ENCODING Google Sheet
  remarks?: string;        // Existing remarks read from the IATD / ENCODING Google Sheet
}

export interface IatdCsColumnMeta {
  label: string;           // Exact header in Row 2, e.g. "CS01", "CS02"
  csNumber: number;        // Numeric CS number, e.g. 1, 2
  colIndex: number;        // 0-based column index, e.g. 19
  colLetter: string;       // Column letter, e.g. "T", "AA"
  cellA1?: string;         // Target cell A1 coordinate when row is known, e.g. "T5"
  existingValue?: string;  // Existing quantity in that cell (empty string if blank)
}

export interface IatdRemarksColumnMeta {
  label: string;           // Exact header in Row 2, e.g. "Remarks"
  colIndex: number;        // 0-based column index
  colLetter: string;       // Column letter, e.g. "R"
  cellA1?: string;         // Target cell A1 coordinate when row is known, e.g. "R5"
  existingValue?: string;  // Existing remarks text in that cell
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

export type MonitoringStatus = '' | 'Pending' | 'In Progress' | 'Completed';

export interface MonitoringBlock {
  csRange: string; // e.g. "CS01–CS05"
  rangeLabel?: string; // e.g. "001-005"
  startCs: number;
  endCs: number;
  auditor: string;
  status: MonitoringStatus;
  encoder?: string;
  encodingStatus?: MonitoringStatus;
  checker?: string;
  checkingStatus?: MonitoringStatus;
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
