CREATE TABLE IF NOT EXISTS branches (
  spreadsheet_id TEXT PRIMARY KEY,
  spreadsheet_name TEXT NOT NULL DEFAULT 'Branch Inventory',
  owner_email TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  claimed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branch_members (
  spreadsheet_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'encoder')),
  name TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (spreadsheet_id, email),
  FOREIGN KEY (spreadsheet_id)
    REFERENCES branches(spreadsheet_id)
    ON DELETE CASCADE
);
