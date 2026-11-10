/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import initSqlJs, { Database, SqlValue } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { D1Database, D1PreparedStatement } from '../db/d1Types';

const DB_FILE_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE_PATH = path.join(DB_FILE_DIR, 'inventory_roles.sqlite');

/**
 * Creates and initializes a D1Database-compatible wrapper backed by sql.js with disk persistence.
 */
export async function createSqlJsD1Database(): Promise<D1Database> {
  const SQL = await initSqlJs();

  let db: Database;
  try {
    if (!fs.existsSync(DB_FILE_DIR)) {
      fs.mkdirSync(DB_FILE_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE_PATH)) {
      const fileBuffer = fs.readFileSync(DB_FILE_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
  } catch (err) {
    console.warn('Failed to load database from disk, starting with memory database:', err);
    db = new SQL.Database();
  }

  // Ensure tables exist
  db.run(`
    CREATE TABLE IF NOT EXISTS branches (
      spreadsheet_id TEXT PRIMARY KEY,
      spreadsheet_name TEXT,
      owner_email TEXT,
      owner_name TEXT,
      claimed_at TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS branch_members (
      spreadsheet_id TEXT,
      email TEXT,
      role TEXT,
      name TEXT,
      assigned_at TEXT,
      PRIMARY KEY (spreadsheet_id, email)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS recent_countsheets (
      id TEXT PRIMARY KEY,
      spreadsheet_id TEXT,
      spreadsheet_name TEXT,
      web_view_link TEXT,
      created_at TEXT,
      total_sheets INTEGER,
      total_items INTEGER,
      session_json TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS recent_audit_reports (
      id TEXT PRIMARY KEY,
      spreadsheet_id TEXT,
      spreadsheet_name TEXT,
      web_view_link TEXT,
      created_at TEXT,
      total_rows INTEGER,
      report_json TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_workspace_state (
      user_key TEXT PRIMARY KEY,
      state_json TEXT,
      updated_at TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS branch_countsheets_sync (
      id TEXT PRIMARY KEY,
      branch_id TEXT,
      cs_number INTEGER,
      updated_at TEXT,
      countsheet_json TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS branch_monitoring_sync (
      id TEXT PRIMARY KEY,
      branch_id TEXT,
      cs_range TEXT,
      updated_at TEXT,
      block_json TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS branch_inventory_snapshots (
      branch_id TEXT PRIMARY KEY,
      branch_json TEXT,
      encoding_json TEXT,
      masterdata_json TEXT,
      updated_at TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_auditor_directory (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      role TEXT,
      branch_name TEXT,
      status TEXT,
      created_at TEXT,
      entry_json TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_auditor_messages (
      id TEXT PRIMARY KEY,
      sender_name TEXT,
      sender_email TEXT,
      recipient_email TEXT,
      recipient_name TEXT,
      subject TEXT,
      message TEXT,
      priority TEXT,
      branch_name TEXT,
      cs_range TEXT,
      status TEXT,
      created_at TEXT,
      msg_json TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS active_presence (
      session_id TEXT PRIMARY KEY,
      display_name TEXT,
      email TEXT,
      photo_url TEXT,
      login_type TEXT,
      role TEXT,
      branch_name TEXT,
      current_tab TEXT,
      joined_at TEXT,
      last_seen_at TEXT,
      last_seen_ms INTEGER
    );
  `);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveToDisk = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        if (!fs.existsSync(DB_FILE_DIR)) {
          await fs.promises.mkdir(DB_FILE_DIR, { recursive: true });
        }
        const data = db.export();
        await fs.promises.writeFile(DB_FILE_PATH, Buffer.from(data));
      } catch (err) {
        console.warn('Error saving sqlite database to disk:', err);
      }
    }, 150);
  };

  // Only persist on startup if the database file does not exist yet
  if (!fs.existsSync(DB_FILE_PATH)) {
    saveToDisk();
  }

  const createStatement = (query: string): D1PreparedStatement => {
    let boundValues: any[] = [];

    const stmtObj: D1PreparedStatement = {
      bind(...values: any[]) {
        boundValues = values;
        return stmtObj;
      },

      async first<T = unknown>(colName?: string): Promise<T | null> {
        try {
          const stmt = db.prepare(query);
          stmt.bind(boundValues as SqlValue[]);
          if (stmt.step()) {
            const row = stmt.getAsObject() as any;
            stmt.free();
            if (colName) {
              return (row[colName] ?? null) as T;
            }
            return row as T;
          }
          stmt.free();
          return null;
        } catch (err) {
          console.error('SQL first error:', err, 'Query:', query, 'Values:', boundValues);
          throw err;
        }
      },

      async run<T = unknown>(): Promise<{
        success: boolean;
        meta: { changes?: number; last_row_id?: number; duration?: number; [key: string]: any };
        error?: string;
      }> {
        try {
          const startTime = Date.now();
          db.run(query, boundValues as SqlValue[]);
          saveToDisk();
          return {
            success: true,
            meta: {
              changes: db.getRowsModified(),
              duration: Date.now() - startTime,
            },
          };
        } catch (err: any) {
          console.error('SQL run error:', err, 'Query:', query, 'Values:', boundValues);
          return {
            success: false,
            meta: {},
            error: err?.message || String(err),
          };
        }
      },

      async all<T = unknown>(): Promise<{
        success: boolean;
        meta: { duration?: number; [key: string]: any };
        results: T[];
        error?: string;
      }> {
        try {
          const startTime = Date.now();
          const stmt = db.prepare(query);
          stmt.bind(boundValues as SqlValue[]);
          const results: T[] = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject() as T);
          }
          stmt.free();
          return {
            success: true,
            meta: {
              duration: Date.now() - startTime,
            },
            results,
          };
        } catch (err: any) {
          console.error('SQL all error:', err, 'Query:', query, 'Values:', boundValues);
          return {
            success: false,
            meta: {},
            results: [],
            error: err?.message || String(err),
          };
        }
      },
    };

    return stmtObj;
  };

  const d1Database: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return createStatement(query);
    },

    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<
      Array<{ success: boolean; meta: any; results?: T[]; error?: string }>
    > {
      const results: Array<{ success: boolean; meta: any; results?: T[]; error?: string }> = [];
      for (const stmt of statements) {
        const res = await stmt.all<T>();
        results.push(res);
      }
      return results;
    },

    async exec(query: string): Promise<{ count: number; duration: number }> {
      const startTime = Date.now();
      db.run(query);
      saveToDisk();
      return {
        count: db.getRowsModified(),
        duration: Date.now() - startTime,
      };
    },
  };

  return d1Database;
}
