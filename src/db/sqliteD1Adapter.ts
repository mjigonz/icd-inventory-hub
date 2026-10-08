/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { D1Database, D1PreparedStatement } from './d1Types';

/**
 * Local SQLite adapter implementing Cloudflare D1Database interface.
 * Allows server.ts to operate using exact D1 SQL queries and bindings during local dev.
 */
export class SqliteD1Adapter implements D1Database {
  private db: SqlJsDatabase;
  private dbFilePath: string | null;

  private constructor(db: SqlJsDatabase, dbFilePath: string | null = null) {
    this.db = db;
    this.dbFilePath = dbFilePath;
  }

  /**
   * Initializes SqliteD1Adapter with optional local file persistence.
   */
  public static async create(dbFilePath?: string): Promise<SqliteD1Adapter> {
    const SQL = await initSqlJs();
    let db: SqlJsDatabase;

    if (dbFilePath) {
      const resolvedPath = path.resolve(dbFilePath);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(resolvedPath)) {
        const fileBuffer = fs.readFileSync(resolvedPath);
        db = new SQL.Database(fileBuffer);
      } else {
        db = new SQL.Database();
      }
      return new SqliteD1Adapter(db, resolvedPath);
    } else {
      db = new SQL.Database();
      return new SqliteD1Adapter(db, null);
    }
  }

  private persistIfNeeded(): void {
    if (this.dbFilePath) {
      try {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbFilePath, buffer);
      } catch (err) {
        console.error('Failed to persist local SQLite DB:', err);
      }
    }
  }

  public prepare(query: string): D1PreparedStatement {
    const dbInstance = this.db;
    const persist = () => this.persistIfNeeded();

    class PreparedStatement implements D1PreparedStatement {
      private sql: string;
      private boundValues: any[];

      constructor(sql: string, boundValues: any[] = []) {
        this.sql = sql;
        this.boundValues = boundValues;
      }

      public bind(...values: any[]): D1PreparedStatement {
        return new PreparedStatement(this.sql, values);
      }

      public async first<T = unknown>(colName?: string): Promise<T | null> {
        const stmt = dbInstance.prepare(this.sql);
        try {
          stmt.bind(this.boundValues);
          if (stmt.step()) {
            const row = stmt.getAsObject() as any;
            if (colName) {
              return (row[colName] ?? null) as T;
            }
            return row as T;
          }
          return null;
        } finally {
          stmt.free();
        }
      }

      public async run<T = unknown>(): Promise<{
        success: boolean;
        meta: { changes?: number; last_row_id?: number };
        error?: string;
      }> {
        try {
          dbInstance.run(this.sql, this.boundValues);
          persist();
          const changes = dbInstance.getRowsModified();
          return {
            success: true,
            meta: { changes },
          };
        } catch (err: any) {
          return {
            success: false,
            meta: {},
            error: err.message || String(err),
          };
        }
      }

      public async all<T = unknown>(): Promise<{
        success: boolean;
        meta: {};
        results: T[];
        error?: string;
      }> {
        const stmt = dbInstance.prepare(this.sql);
        const results: T[] = [];
        try {
          stmt.bind(this.boundValues);
          while (stmt.step()) {
            results.push(stmt.getAsObject() as unknown as T);
          }
          return {
            success: true,
            meta: {},
            results,
          };
        } catch (err: any) {
          return {
            success: false,
            meta: {},
            results: [],
            error: err.message || String(err),
          };
        } finally {
          stmt.free();
        }
      }
    }

    return new PreparedStatement(query);
  }

  public async batch<T = unknown>(
    statements: D1PreparedStatement[]
  ): Promise<Array<{ success: boolean; meta: any; results?: T[]; error?: string }>> {
    const outputs: Array<{ success: boolean; meta: any; results?: T[]; error?: string }> = [];
    for (const stmt of statements) {
      const res = await stmt.run<T>();
      outputs.push(res);
    }
    return outputs;
  }

  public async exec(query: string): Promise<{ count: number; duration: number }> {
    const start = Date.now();
    this.db.exec(query);
    this.persistIfNeeded();
    return {
      count: 1,
      duration: Date.now() - start,
    };
  }
}
