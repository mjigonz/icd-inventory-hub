/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { D1Database, BranchDbRecord, BranchMemberDbRecord } from '../db/d1Types';

export interface RoleStatusResult {
  hasOwner: boolean;
  ownerEmail: string | null;
  ownerName: string | null;
  currentRole: 'owner' | 'encoder' | 'unassigned';
}

export interface ClaimRoleParams {
  spreadsheetId: string;
  spreadsheetName?: string;
  requestedRole: 'owner' | 'encoder';
  userEmail: string;
  userName: string;
}

export interface ClaimRoleResult {
  success: boolean;
  role?: 'owner' | 'encoder';
  ownerEmail?: string | null;
  ownerName?: string | null;
  error?: string;
  statusCode: number;
}

/**
 * Repository layer for Branch Role & Permission persistence in Cloudflare D1.
 * Works seamlessly with Cloudflare Workers (`env.DB`) and local D1 adapters.
 */
export class D1BranchRoleRepository {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Retrieves status for a given branch spreadsheetId and user email.
   */
  public async getBranchRoleStatus(
    spreadsheetId: string,
    userEmail: string
  ): Promise<RoleStatusResult> {
    const cleanEmail = userEmail.trim().toLowerCase();

    const branch = await this.db
      .prepare(
        `SELECT spreadsheet_id, spreadsheet_name, owner_email, owner_name, claimed_at FROM branches WHERE spreadsheet_id = ?1`
      )
      .bind(spreadsheetId)
      .first<BranchDbRecord>();

    if (!branch) {
      return {
        hasOwner: false,
        ownerEmail: null,
        ownerName: null,
        currentRole: 'unassigned',
      };
    }

    const member = await this.db
      .prepare(
        `SELECT spreadsheet_id, email, role, name, assigned_at FROM branch_members WHERE spreadsheet_id = ?1 AND lower(email) = ?2`
      )
      .bind(spreadsheetId, cleanEmail)
      .first<BranchMemberDbRecord>();

    const isOwner = Boolean(branch.owner_email && branch.owner_email.toLowerCase() === cleanEmail);
    let currentRole: 'owner' | 'encoder' | 'unassigned' = 'unassigned';

    if (isOwner) {
      currentRole = 'owner';
    } else if (member) {
      currentRole = member.role;
    }

    return {
      hasOwner: Boolean(branch.owner_email && branch.owner_email.trim()),
      ownerEmail: branch.owner_email || null,
      ownerName: branch.owner_name || null,
      currentRole,
    };
  }

  /**
   * Claims a role ('owner' or 'encoder') for a branch.
   */
  public async claimRole(params: ClaimRoleParams): Promise<ClaimRoleResult> {
    const { spreadsheetId, spreadsheetName, requestedRole, userEmail, userName } = params;
    const cleanEmail = userEmail.trim().toLowerCase();
    const nowIso = new Date().toISOString();

    const existingBranch = await this.db
      .prepare(
        `SELECT spreadsheet_id, spreadsheet_name, owner_email, owner_name, claimed_at FROM branches WHERE spreadsheet_id = ?1`
      )
      .bind(spreadsheetId)
      .first<BranchDbRecord>();

    if (requestedRole === 'owner') {
      if (
        existingBranch &&
        existingBranch.owner_email &&
        existingBranch.owner_email.trim() &&
        existingBranch.owner_email.toLowerCase() !== cleanEmail
      ) {
        return {
          success: false,
          error: 'This branch already has an owner.',
          ownerEmail: existingBranch.owner_email,
          ownerName: existingBranch.owner_name,
          statusCode: 409,
        };
      }
    }

    const targetBranchName = spreadsheetName || existingBranch?.spreadsheet_name || 'Branch Inventory';

    if (!existingBranch) {
      await this.db
        .prepare(
          `INSERT INTO branches (spreadsheet_id, spreadsheet_name, owner_email, owner_name, claimed_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`
        )
        .bind(
          spreadsheetId,
          targetBranchName,
          requestedRole === 'owner' ? cleanEmail : '',
          requestedRole === 'owner' ? userName : '',
          nowIso
        )
        .run();
    } else {
      if (requestedRole === 'owner') {
        await this.db
          .prepare(
            `UPDATE branches
             SET owner_email = ?1, owner_name = ?2, spreadsheet_name = ?3
             WHERE spreadsheet_id = ?4`
          )
          .bind(cleanEmail, userName, targetBranchName, spreadsheetId)
          .run();
      } else if (spreadsheetName) {
        await this.db
          .prepare(`UPDATE branches SET spreadsheet_name = ?1 WHERE spreadsheet_id = ?2`)
          .bind(targetBranchName, spreadsheetId)
          .run();
      }
    }

    // Insert or update member assignment
    await this.db
      .prepare(
        `INSERT INTO branch_members (spreadsheet_id, email, role, name, assigned_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(spreadsheet_id, email) DO UPDATE SET
           role = excluded.role,
           name = excluded.name,
           assigned_at = excluded.assigned_at`
      )
      .bind(spreadsheetId, cleanEmail, requestedRole, userName, nowIso)
      .run();

    // Fetch updated branch owner details
    const updatedBranch = await this.db
      .prepare(
        `SELECT spreadsheet_id, spreadsheet_name, owner_email, owner_name, claimed_at FROM branches WHERE spreadsheet_id = ?1`
      )
      .bind(spreadsheetId)
      .first<BranchDbRecord>();

    return {
      success: true,
      role: requestedRole,
      ownerEmail: updatedBranch?.owner_email || (requestedRole === 'owner' ? cleanEmail : null),
      ownerName: updatedBranch?.owner_name || (requestedRole === 'owner' ? userName : null),
      statusCode: 200,
    };
  }

  /**
   * Retrieves the owner email of a branch.
   */
  public async getBranchOwnerEmail(spreadsheetId: string): Promise<string | null> {
    const branch = await this.db
      .prepare(`SELECT owner_email FROM branches WHERE spreadsheet_id = ?1`)
      .bind(spreadsheetId)
      .first<{ owner_email: string }>();

    return branch?.owner_email ? branch.owner_email.trim().toLowerCase() : null;
  }
}
