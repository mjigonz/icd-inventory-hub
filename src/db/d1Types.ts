/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cloudflare D1 Database Abstraction Interfaces.
 * These match Cloudflare Workers D1 API specification (`env.DB`).
 */

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<{
    success: boolean;
    meta: {
      changes?: number;
      last_row_id?: number;
      duration?: number;
      [key: string]: any;
    };
    error?: string;
  }>;
  all<T = unknown>(): Promise<{
    success: boolean;
    meta: {
      duration?: number;
      [key: string]: any;
    };
    results: T[];
    error?: string;
  }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(
    statements: D1PreparedStatement[]
  ): Promise<
    Array<{
      success: boolean;
      meta: any;
      results?: T[];
      error?: string;
    }>
  >;
  exec(query: string): Promise<{
    count: number;
    duration: number;
  }>;
}

export interface BranchDbRecord {
  spreadsheet_id: string;
  spreadsheet_name: string;
  owner_email: string;
  owner_name: string;
  claimed_at: string;
}

export interface BranchMemberDbRecord {
  spreadsheet_id: string;
  email: string;
  role: 'owner' | 'encoder';
  name: string;
  assigned_at: string;
}
