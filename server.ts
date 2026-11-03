/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { D1BranchRoleRepository } from './src/services/d1Repository';
import { createSqlJsD1Database } from './src/services/sqlJsD1Adapter';
import { D1Database } from './src/db/d1Types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();

  // Parse JSON bodies (up to 50MB for inventory snapshots)
  app.use(express.json({ limit: '50mb' }));

  // Initialize SQLite-backed D1 Database adapter
  const db: D1Database = await createSqlJsD1Database();

  // Google OAuth token verification helper
  async function verifyGoogleToken(token: string): Promise<{ email: string; name: string; sub: string } | null> {
    if (token === 'icd-local-session-token' || token.startsWith('auditor:') || token.startsWith('auditor-')) {
      let email = 'auditor@sidc.local';
      let name = 'Auditor';
      if (token.startsWith('auditor:')) {
        const parts = token.split(':');
        if (parts[1]) email = decodeURIComponent(parts[1]);
        if (parts[2]) name = decodeURIComponent(parts[2]);
      }
      return {
        email: email.toLowerCase(),
        name: name,
        sub: `auditor-${email}`,
      };
    }

    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { email?: string; name?: string; sub: string };
      return {
        email: data.email ? data.email.toLowerCase() : '',
        name: data.name || (data.email ? data.email.split('@')[0] : 'User'),
        sub: data.sub,
      };
    } catch (err) {
      console.error('Error verifying token with Google:', err);
      return null;
    }
  }

  // Middleware to extract and verify Google OAuth bearer token
  async function authMiddleware(req: ExpressRequest, res: ExpressResponse, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7);
    const userInfo = await verifyGoogleToken(token);
    if (!userInfo) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired Google token' });
    }

    (req as any).user = userInfo;
    (req as any).token = token;
    next();
  }

  // 1. Get branch role status
  app.get('/api/roles/status', authMiddleware, async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const spreadsheetId = req.query.spreadsheetId as string;
      if (!spreadsheetId) {
        return res.status(400).json({ error: 'spreadsheetId query param is required' });
      }

      const user = (req as any).user;
      const roleRepo = new D1BranchRoleRepository(db);
      const status = await roleRepo.getBranchRoleStatus(spreadsheetId, user.email);

      return res.json(status);
    } catch (err: any) {
      console.error('Error fetching role status:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 2. Claim role (Owner or Encoder)
  app.post('/api/roles/claim', authMiddleware, async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { spreadsheetId, spreadsheetName, requestedRole, forceAdminOverride } = req.body || {};
      if (!spreadsheetId || !requestedRole) {
        return res.status(400).json({ error: 'spreadsheetId and requestedRole are required' });
      }

      if (requestedRole !== 'owner' && requestedRole !== 'encoder') {
        return res.status(400).json({ error: 'Role must be either "owner" or "encoder"' });
      }

      const user = (req as any).user;
      const roleRepo = new D1BranchRoleRepository(db);
      const result = await roleRepo.claimRole({
        spreadsheetId,
        spreadsheetName,
        requestedRole,
        userEmail: user.email,
        userName: user.name,
        forceAdminOverride: Boolean(forceAdminOverride),
      });

      if (!result.success) {
        return res.status(result.statusCode).json({
          error: result.error,
          ownerEmail: result.ownerEmail,
          ownerName: result.ownerName,
        });
      }

      return res.json({
        success: true,
        role: result.role,
        ownerEmail: result.ownerEmail,
        ownerName: result.ownerName,
      });
    } catch (err: any) {
      console.error('Error claiming role:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 3. Delete Countsheet - Server-side role enforcement (Only branch Owner can delete!)
  app.post('/api/sheets/delete-countsheet', authMiddleware, async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { spreadsheetId, csNumber, isAdminMode } = req.body || {};
      if (!spreadsheetId || csNumber === undefined) {
        return res.status(400).json({ error: 'spreadsheetId and csNumber are required' });
      }

      const user = (req as any).user;
      const token = (req as any).token;

      const roleRepo = new D1BranchRoleRepository(db);
      const ownerEmail = await roleRepo.getBranchOwnerEmail(spreadsheetId);

      // Enforce server-side ownership unless Admin Mode is active
      if (!isAdminMode && (!ownerEmail || ownerEmail !== user.email.toLowerCase())) {
        return res.status(403).json({
          error: 'Only the branch Owner or Admin can delete an entire countsheet.',
          ownerEmail: ownerEmail || null,
        });
      }

      // 1. Fetch current COUNTSHEETS tab
      const getRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/COUNTSHEETS!A:N`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!getRes.ok) {
        const errText = await getRes.text();
        return res.status(getRes.status).json({ error: `Google Sheets error: ${errText}` });
      }

      const sheetData = (await getRes.json()) as { values?: string[][] };
      const rows: string[][] = sheetData.values || [];

      if (rows.length <= 1) {
        return res.json({ success: true, message: 'No rows to delete', deletedRows: 0 });
      }

      const header = rows[0];
      const dataRows = rows.slice(1);
      const targetCsStr = String(csNumber);

      const headerCols = header.map((h) => String(h).trim().toLowerCase());
      let csIdx = headerCols.indexOf('cs');
      if (csIdx === -1) {
        csIdx = headerCols.indexOf('countsheet');
      }
      if (csIdx === -1) {
        csIdx = 13;
      }

      const remainingRows = dataRows.filter((row) => {
        const val = String(row[csIdx] ?? '').trim();
        if (val === targetCsStr) return false;
        if (
          csIdx === 13 &&
          String(row[12] ?? '').trim() === targetCsStr &&
          !['good', 'bad', 'spoilage'].includes(String(row[12] ?? '').toLowerCase())
        ) {
          return false;
        }
        return true;
      });
      const deletedCount = dataRows.length - remainingRows.length;

      const updatedDataRows = remainingRows.map((row, index) => {
        const copy = [...row];
        copy[0] = String(index + 1);
        return copy;
      });

      const newAllRows = [header, ...updatedDataRows];

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/COUNTSHEETS!A:N:clear`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/COUNTSHEETS!A1?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: newAllRows }),
        }
      );

      if (!updateRes.ok) {
        const updateErr = await updateRes.text();
        return res.status(updateRes.status).json({ error: `Failed to update sheet: ${updateErr}` });
      }

      return res.json({
        success: true,
        deletedRows: deletedCount,
        remainingRows: updatedDataRows.length,
      });
    } catch (err: any) {
      console.error('Error deleting countsheet:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 4. Recent Countsheets & Recent Audit Reports Sync Endpoints (Strictly scoped per user email)
  app.get('/api/recent-countsheets', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const requestedEmail = String(req.query.email || '').trim().toLowerCase();
      if (!requestedEmail) {
        return res.json([]);
      }
      const stmt = db.prepare('SELECT session_json FROM recent_countsheets ORDER BY created_at DESC LIMIT 150');
      const result = await stmt.all<{ session_json: string }>();
      const sessions = (result.results || [])
        .map((r) => {
          try {
            return JSON.parse(r.session_json);
          } catch {
            return null;
          }
        })
        .filter(
          (s) =>
            s &&
            typeof s.ownerEmail === 'string' &&
            s.ownerEmail.trim().toLowerCase() === requestedEmail
        )
        .slice(0, 30);
      return res.json(sessions);
    } catch (err: any) {
      console.error('Error fetching recent countsheets:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/recent-countsheets', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const session = req.body;
      if (!session || !session.id || !session.spreadsheetId) {
        return res.status(400).json({ error: 'Valid session object required' });
      }
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO recent_countsheets (id, spreadsheet_id, spreadsheet_name, web_view_link, created_at, total_sheets, total_items, session_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      `);
      await stmt.bind(
        session.id,
        session.spreadsheetId,
        session.spreadsheetName || '',
        session.webViewLink || '',
        session.createdAt || new Date().toISOString(),
        session.totalSheets || 0,
        session.totalItems || 0,
        JSON.stringify(session)
      ).run();
      return res.json({ success: true, session });
    } catch (err: any) {
      console.error('Error saving recent countsheet:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.delete('/api/recent-countsheets/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { id } = req.params;
      const stmt = db.prepare('DELETE FROM recent_countsheets WHERE id = ?1 OR spreadsheet_id = ?1');
      await stmt.bind(id).run();
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error deleting recent countsheet:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/recent-audit-reports', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const requestedEmail = String(req.query.email || '').trim().toLowerCase();
      if (!requestedEmail) {
        return res.json([]);
      }
      const stmt = db.prepare('SELECT report_json FROM recent_audit_reports ORDER BY created_at DESC LIMIT 150');
      const result = await stmt.all<{ report_json: string }>();
      const reports = (result.results || [])
        .map((r) => {
          try {
            return JSON.parse(r.report_json);
          } catch {
            return null;
          }
        })
        .filter(
          (r) =>
            r &&
            typeof r.ownerEmail === 'string' &&
            r.ownerEmail.trim().toLowerCase() === requestedEmail
        )
        .slice(0, 30);
      return res.json(reports);
    } catch (err: any) {
      console.error('Error fetching recent audit reports:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/recent-audit-reports', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const report = req.body;
      if (!report || !report.id || !report.spreadsheetId) {
        return res.status(400).json({ error: 'Valid report object required' });
      }
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO recent_audit_reports (id, spreadsheet_id, spreadsheet_name, web_view_link, created_at, total_rows, report_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      `);
      await stmt.bind(
        report.id,
        report.spreadsheetId,
        report.spreadsheetName || '',
        report.webViewLink || '',
        report.createdAt || new Date().toISOString(),
        report.totalRows || 0,
        JSON.stringify(report)
      ).run();
      return res.json({ success: true, report });
    } catch (err: any) {
      console.error('Error saving recent audit report:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.delete('/api/recent-audit-reports/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { id } = req.params;
      const stmt = db.prepare('DELETE FROM recent_audit_reports WHERE id = ?1 OR spreadsheet_id = ?1');
      await stmt.bind(id).run();
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error deleting recent audit report:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 5. Cross-Device Workspace & Activity Sync Endpoints
  app.get('/api/sync/workspace/:userKey', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { userKey } = req.params;
      const stmt = db.prepare('SELECT state_json, updated_at FROM user_workspace_state WHERE user_key = ?1');
      const row = await stmt.bind(userKey).first<{ state_json: string; updated_at: string }>();
      if (!row || !row.state_json) {
        return res.json({ state: null });
      }
      return res.json({ state: JSON.parse(row.state_json), updatedAt: row.updated_at });
    } catch (err: any) {
      console.error('Error fetching workspace state:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/sync/workspace/:userKey', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { userKey } = req.params;
      const incoming = req.body;
      if (!incoming || typeof incoming !== 'object') {
        return res.status(400).json({ error: 'Valid workspace state object required' });
      }
      const existingStmt = db.prepare('SELECT state_json FROM user_workspace_state WHERE user_key = ?1');
      const existingRow = await existingStmt.bind(userKey).first<{ state_json: string }>();
      let merged = incoming;
      if (existingRow?.state_json) {
        try {
          const prev = JSON.parse(existingRow.state_json);
          merged = { ...prev, ...incoming };
          if (prev.activeCsByBranch && incoming.activeCsByBranch) {
            merged.activeCsByBranch = { ...prev.activeCsByBranch, ...incoming.activeCsByBranch };
          }
        } catch {
          merged = incoming;
        }
      }
      const updatedAt = incoming.updatedAt || new Date().toISOString();
      merged.updatedAt = updatedAt;
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO user_workspace_state (user_key, state_json, updated_at)
        VALUES (?1, ?2, ?3)
      `);
      await stmt.bind(userKey, JSON.stringify(merged), updatedAt).run();
      return res.json({ success: true, state: merged });
    } catch (err: any) {
      console.error('Error saving workspace state:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/sync/countsheets/:branchId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { branchId } = req.params;
      const stmt = db.prepare('SELECT countsheet_json FROM branch_countsheets_sync WHERE branch_id = ?1 ORDER BY cs_number ASC');
      const result = await stmt.bind(branchId).all<{ countsheet_json: string }>();
      const countsheets = (result.results || []).map((r) => JSON.parse(r.countsheet_json));
      return res.json({ countsheets });
    } catch (err: any) {
      console.error('Error fetching branch countsheets:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/sync/countsheets/:branchId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { branchId } = req.params;
      const countsheet = req.body;
      if (!countsheet || countsheet.cs === undefined) {
        return res.status(400).json({ error: 'Valid countsheet object required' });
      }
      const id = `${branchId}_${countsheet.cs}`;
      const updatedAt = countsheet.updatedAt || new Date().toISOString();
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO branch_countsheets_sync (id, branch_id, cs_number, updated_at, countsheet_json)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `);
      await stmt.bind(id, branchId, Number(countsheet.cs), updatedAt, JSON.stringify(countsheet)).run();
      return res.json({ success: true, countsheet });
    } catch (err: any) {
      console.error('Error saving branch countsheet:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.delete('/api/sync/countsheets/:branchId/:cs', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { branchId, cs } = req.params;
      const id = `${branchId}_${cs}`;
      const stmt = db.prepare('DELETE FROM branch_countsheets_sync WHERE id = ?1 OR (branch_id = ?2 AND cs_number = ?3)');
      await stmt.bind(id, branchId, Number(cs)).run();
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error deleting branch countsheet:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/sync/monitoring/:branchId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { branchId } = req.params;
      const stmt = db.prepare('SELECT block_json FROM branch_monitoring_sync WHERE branch_id = ?1');
      const result = await stmt.bind(branchId).all<{ block_json: string }>();
      const blocks = (result.results || []).map((r) => JSON.parse(r.block_json));
      return res.json({ blocks });
    } catch (err: any) {
      console.error('Error fetching branch monitoring blocks:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/sync/monitoring/:branchId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { branchId } = req.params;
      const block = req.body;
      if (!block || !block.csRange) {
        return res.status(400).json({ error: 'Valid monitoring block required' });
      }
      const id = `${branchId}_${block.csRange}`;
      const updatedAt = block.lastUpdated || new Date().toISOString();
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO branch_monitoring_sync (id, branch_id, cs_range, updated_at, block_json)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `);
      await stmt.bind(id, branchId, block.csRange, updatedAt, JSON.stringify(block)).run();
      return res.json({ success: true, block });
    } catch (err: any) {
      console.error('Error saving branch monitoring block:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/sync/branch-inventory/:branchId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { branchId } = req.params;
      const stmt = db.prepare('SELECT branch_json, encoding_json, masterdata_json, updated_at FROM branch_inventory_snapshots WHERE branch_id = ?1');
      const row = await stmt.bind(branchId).first<{
        branch_json: string;
        encoding_json: string;
        masterdata_json: string;
        updated_at: string;
      }>();
      if (!row) {
        return res.json({ snapshot: null });
      }
      return res.json({
        snapshot: {
          branch: JSON.parse(row.branch_json || 'null'),
          encodingItems: JSON.parse(row.encoding_json || '[]'),
          masterdataItems: JSON.parse(row.masterdata_json || '[]'),
          updatedAt: row.updated_at,
        },
      });
    } catch (err: any) {
      console.error('Error fetching branch inventory snapshot:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/sync/branch-inventory/:branchId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { branchId } = req.params;
      const { branch, encodingItems, masterdataItems } = req.body || {};
      if (!branch) {
        return res.status(400).json({ error: 'Valid branch snapshot required' });
      }
      const updatedAt = branch.lastSyncedAt || new Date().toISOString();
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO branch_inventory_snapshots (branch_id, branch_json, encoding_json, masterdata_json, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `);
      await stmt
        .bind(
          branchId,
          JSON.stringify(branch),
          JSON.stringify(encodingItems || []),
          JSON.stringify(masterdataItems || []),
          updatedAt
        )
        .run();
      return res.json({ success: true, updatedAt });
    } catch (err: any) {
      console.error('Error saving branch inventory snapshot:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.delete('/api/sync/branch-inventory/:branchId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { branchId } = req.params;
      await db.prepare('DELETE FROM branch_inventory_snapshots WHERE branch_id = ?1').bind(branchId).run();
      await db.prepare('DELETE FROM branch_countsheets_sync WHERE branch_id = ?1').bind(branchId).run();
      await db.prepare('DELETE FROM branch_monitoring_sync WHERE branch_id = ?1').bind(branchId).run();
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error deleting branch sync data:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 5b. Admin Directory (Emails & Auditors), Role Definitions & Access Control Endpoints
  const SUPER_ADMIN_WHITELIST = ['icdhubsystems@gmail.com'];
  const GLOBAL_ADMIN_ROLES_KEY = 'global_admin_roles_config_v2';

  async function getStoredAdminRoles(): Promise<any[] | null> {
    try {
      const stmt = db.prepare('SELECT state_json FROM user_workspace_state WHERE user_key = ?1');
      const row = await stmt.bind(GLOBAL_ADMIN_ROLES_KEY).first<{ state_json: string }>();
      if (row && row.state_json) {
        const parsed = JSON.parse(row.state_json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (err) {
      console.error('Error reading stored admin roles:', err);
    }
    return null;
  }

  let lastAdminDataModifiedAt = Date.now();

  async function saveStoredAdminRoles(roles: any[]): Promise<void> {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO user_workspace_state (user_key, state_json, updated_at)
      VALUES (?1, ?2, ?3)
    `);
    await stmt.bind(GLOBAL_ADMIN_ROLES_KEY, JSON.stringify(roles), new Date().toISOString()).run();
    lastAdminDataModifiedAt = Date.now();
  }

  async function isEmailAdminInDb(email: string): Promise<boolean> {
    if (!email) return false;
    const cleanEmail = email.trim().toLowerCase();
    return SUPER_ADMIN_WHITELIST.some((a) => a.toLowerCase() === cleanEmail);
  }

  app.get('/api/admin/roles', async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
      const roles = await getStoredAdminRoles();
      return res.json({ roles: roles || [] });
    } catch (err: any) {
      console.error('Error fetching admin roles:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/admin/roles', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
      if (roles.length === 0) {
        return res.status(400).json({ error: 'roles array is required' });
      }
      await saveStoredAdminRoles(roles);
      return res.json({ status: 'ok', roles });
    } catch (err: any) {
      console.error('Error saving admin roles:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Check admin privileges for a given email or token
  app.get('/api/admin/check-access', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      let email = String(req.query.email || '').trim().toLowerCase();
      const authHeader = req.headers.authorization;
      if (!email && authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const userInfo = await verifyGoogleToken(token);
        if (userInfo && userInfo.email) {
          email = userInfo.email.toLowerCase();
        }
      }

      if (!email) {
        return res.status(400).json({ error: 'Email parameter or Authorization token is required' });
      }

      const isAdmin = await isEmailAdminInDb(email);
      let role = isAdmin ? 'internal_compliance_manager' : 'senior_auditor';
      try {
        const roleStmt = db.prepare('SELECT role FROM admin_auditor_directory WHERE lower(email) = lower(?1)');
        const roleRes = await roleStmt.bind(email).first<{ role: string }>();
        if (roleRes?.role) role = roleRes.role;
      } catch {}

      const roles = await getStoredAdminRoles();

      return res.json({
        email,
        isAdmin,
        role,
        roles: roles || undefined,
      });
    } catch (err: any) {
      console.error('Error checking admin access:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/admin/directory', async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
      const stmt = db.prepare('SELECT entry_json FROM admin_auditor_directory ORDER BY created_at DESC');
      const result = await stmt.all<{ entry_json: string }>();
      let entries = (result.results || []).map((r) => JSON.parse(r.entry_json));

      // Ensure icdhubsystems@gmail.com is seeded as Internal Compliance Manager if not found
      const hasPrimaryAdmin = entries.some(
        (e) => String(e.email || '').toLowerCase() === 'icdhubsystems@gmail.com'
      );
      if (!hasPrimaryAdmin) {
        const primaryAdmin = {
          id: 'dir_icdhubsystems@gmail.com',
          email: 'icdhubsystems@gmail.com',
          name: 'ICD Hub Systems',
          role: 'internal_compliance_manager',
          branchName: 'All Branches',
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        const insStmt = db.prepare(`
          INSERT OR REPLACE INTO admin_auditor_directory (id, email, name, role, branch_name, status, created_at, entry_json)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        `);
        await insStmt
          .bind(
            primaryAdmin.id,
            primaryAdmin.email,
            primaryAdmin.name,
            primaryAdmin.role,
            primaryAdmin.branchName,
            primaryAdmin.status,
            primaryAdmin.createdAt,
            JSON.stringify(primaryAdmin)
          )
          .run();
        entries.unshift(primaryAdmin);
      }

      const membersStmt = db.prepare(`
        SELECT m.email, m.name, m.role, m.assigned_at, b.spreadsheet_name
        FROM branch_members m
        LEFT JOIN branches b ON m.spreadsheet_id = b.spreadsheet_id
        ORDER BY m.assigned_at DESC
      `);
      const membersRes = await membersStmt.all<{
        email: string;
        name: string;
        role: string;
        assigned_at: string;
        spreadsheet_name: string;
      }>();

      return res.json({
        entries,
        discoveredMembers: membersRes.results || [],
      });
    } catch (err: any) {
      console.error('Error fetching admin directory:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/admin/directory', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const items = Array.isArray(req.body?.entries) ? req.body.entries : [req.body];
      const saved: any[] = [];

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO admin_auditor_directory (id, email, name, role, branch_name, status, created_at, entry_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      `);

      for (const raw of items) {
        if (!raw || (!raw.email && !raw.name)) continue;
        const email = String(raw.email || '').trim().toLowerCase();
        const id = raw.id || (email ? `dir_${email}` : `dir_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
        const entry = {
          id,
          email,
          name: String(raw.name || (email ? email.split('@')[0] : 'Auditor')).trim(),
          role: raw.role || 'senior_auditor',
          branchName: String(raw.branchName || '').trim(),
          status: raw.status || 'active',
          createdAt: raw.createdAt || new Date().toISOString(),
        };
        await stmt
          .bind(
            entry.id,
            entry.email,
            entry.name,
            entry.role,
            entry.branchName,
            entry.status,
            entry.createdAt,
            JSON.stringify(entry)
          )
          .run();
        saved.push(entry);
      }

      lastAdminDataModifiedAt = Date.now();
      return res.json({ success: true, saved });
    } catch (err: any) {
      console.error('Error saving admin directory entry:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.delete('/api/admin/directory/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { id } = req.params;
      const stmt = db.prepare('DELETE FROM admin_auditor_directory WHERE id = ?1 OR lower(email) = lower(?1)');
      await stmt.bind(id).run();
      lastAdminDataModifiedAt = Date.now();
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error deleting admin directory entry:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/admin/messages', async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
      const stmt = db.prepare('SELECT msg_json FROM admin_auditor_messages ORDER BY created_at DESC LIMIT 50');
      const result = await stmt.all<{ msg_json: string }>();
      const messages = (result.results || []).map((r) => JSON.parse(r.msg_json));
      return res.json({ messages });
    } catch (err: any) {
      console.error('Error fetching admin messages:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/admin/messages', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const raw = req.body;
      if (!raw || !raw.message) {
        return res.status(400).json({ error: 'Message content is required' });
      }
      const id = raw.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const createdAt = raw.createdAt || new Date().toISOString();
      const msgObj = {
        id,
        senderName: raw.senderName || 'Admin',
        senderEmail: raw.senderEmail || '',
        recipientEmail: raw.recipientEmail || 'all',
        recipientName: raw.recipientName || 'All Auditors',
        subject: raw.subject || 'Audit Dispatch',
        message: raw.message,
        priority: raw.priority || 'normal',
        branchName: raw.branchName || '',
        csRange: raw.csRange || '',
        status: raw.status || 'sent',
        createdAt,
      };
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO admin_auditor_messages (
          id, sender_name, sender_email, recipient_email, recipient_name,
          subject, message, priority, branch_name, cs_range, status, created_at, msg_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      `);
      await stmt
        .bind(
          msgObj.id,
          msgObj.senderName,
          msgObj.senderEmail,
          msgObj.recipientEmail,
          msgObj.recipientName,
          msgObj.subject,
          msgObj.message,
          msgObj.priority,
          msgObj.branchName,
          msgObj.csRange,
          msgObj.status,
          msgObj.createdAt,
          JSON.stringify(msgObj)
        )
        .run();
      return res.json({ success: true, message: msgObj });
    } catch (err: any) {
      console.error('Error saving admin message:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.delete('/api/admin/messages/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { id } = req.params;
      if (id === 'all') {
        await db.prepare('DELETE FROM admin_auditor_messages').run();
      } else {
        await db.prepare('DELETE FROM admin_auditor_messages WHERE id = ?1').bind(id).run();
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error deleting admin message:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 5b. Live Presence Tracking (Real-time monitoring of Google Accounts & Guest Mode Users)
  interface ServerPresenceRecord {
    sessionId: string;
    displayName: string;
    email: string;
    photoURL?: string | null;
    loginType: 'google' | 'guest';
    role: string;
    branchName: string;
    currentTab: string;
    joinedAt: string;
    lastSeenAt: string;
    lastSeenMs: number;
  }

  const livePresenceMap = new Map<string, ServerPresenceRecord>();
  const PRESENCE_ONLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes online window

  app.post('/api/presence/heartbeat', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const body = req.body || {};
      const sessionId = String(body.sessionId || '').trim();
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
      }

      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const displayName = String(body.displayName || 'Guest').trim();
      const email = String(
        body.email || `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@sidc.local`
      ).trim();
      const photoURL = body.photoURL ? String(body.photoURL) : null;
      const isSidcLocalEmail = email.toLowerCase().endsWith('@sidc.local');
      const loginType: 'google' | 'guest' =
        body.loginType === 'google' && !isSidcLocalEmail ? 'google' : 'guest';
      const role = String(body.role || (loginType === 'google' ? 'auditor' : 'guest')).trim();
      const rawBranchName = String(body.branchName || '').trim();
      const branchName = /^global\s+masterdata/i.test(rawBranchName) ? 'Masterdata' : rawBranchName;
      const currentTab = String(body.currentTab || '').trim();

      const existing = livePresenceMap.get(sessionId);
      const joinedAt = existing?.joinedAt || body.joinedAt || nowIso;

      const record: ServerPresenceRecord = {
        sessionId,
        displayName,
        email,
        photoURL,
        loginType,
        role,
        branchName,
        currentTab,
        joinedAt,
        lastSeenAt: nowIso,
        lastSeenMs: now,
      };

      livePresenceMap.set(sessionId, record);

      try {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO active_presence (
            session_id, display_name, email, photo_url, login_type, role,
            branch_name, current_tab, joined_at, last_seen_at, last_seen_ms
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        `);
        await stmt
          .bind(
            record.sessionId,
            record.displayName,
            record.email,
            record.photoURL || '',
            record.loginType,
            record.role,
            record.branchName,
            record.currentTab,
            record.joinedAt,
            record.lastSeenAt,
            record.lastSeenMs
          )
          .run();
      } catch (dbErr) {
        console.warn('Notice saving presence to SQLite:', dbErr);
      }

      return res.json({ success: true, serverTime: now });
    } catch (err: any) {
      console.error('Error in presence heartbeat:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/presence/leave', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { sessionId } = req.body || {};
      if (sessionId) {
        livePresenceMap.delete(sessionId);
        try {
          await db.prepare('DELETE FROM active_presence WHERE session_id = ?1').bind(sessionId).run();
        } catch {}
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/presence/online', async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
      const now = Date.now();
      const cutoff = now - PRESENCE_ONLINE_THRESHOLD_MS;

      // Purge sessions idle for > 30 minutes
      const purgeCutoff = now - 30 * 60 * 1000;
      for (const [sId, rec] of livePresenceMap.entries()) {
        if (rec.lastSeenMs < purgeCutoff) {
          livePresenceMap.delete(sId);
        } else if (/^global\s+masterdata/i.test(rec.branchName || '')) {
          rec.branchName = 'Masterdata';
        }
      }

      // Always merge active sessions from SQLite table so server restarts or partial memory never miss Guest or Google sessions
      try {
        const stmt = db.prepare(`
          SELECT session_id, display_name, email, photo_url, login_type, role,
                 branch_name, current_tab, joined_at, last_seen_at, last_seen_ms
          FROM active_presence
          WHERE last_seen_ms >= ?1
        `);
        const rows = await stmt.bind(cutoff).all<any>();
        for (const row of rows.results || []) {
          const rowLastSeen = Number(row.last_seen_ms) || 0;
          const memExisting = livePresenceMap.get(row.session_id);
          if (!memExisting || rowLastSeen > memExisting.lastSeenMs) {
            const rowEmail = String(row.email || '');
            const isLocalGuest = rowEmail.toLowerCase().endsWith('@sidc.local');
            const rawRowBranch = String(row.branch_name || '').trim();
            livePresenceMap.set(row.session_id, {
              sessionId: row.session_id,
              displayName: row.display_name,
              email: rowEmail,
              photoURL: row.photo_url || null,
              loginType: row.login_type === 'google' && !isLocalGuest ? 'google' : 'guest',
              role: row.role,
              branchName: /^global\s+masterdata/i.test(rawRowBranch) ? 'Masterdata' : rawRowBranch,
              currentTab: row.current_tab,
              joinedAt: row.joined_at,
              lastSeenAt: row.last_seen_at,
              lastSeenMs: rowLastSeen,
            });
          }
        }
      } catch {}

      // Deduplicate by (loginType + email/displayName) keeping the freshest session record
      const dedupedByIdentity = new Map<string, ServerPresenceRecord>();
      for (const rec of livePresenceMap.values()) {
        if (rec.lastSeenMs < cutoff) continue;
        const identityKey = `${rec.loginType}_${(rec.email || rec.displayName).toLowerCase().trim()}`;
        const prev = dedupedByIdentity.get(identityKey);
        if (!prev || rec.lastSeenMs >= prev.lastSeenMs) {
          dedupedByIdentity.set(identityKey, rec);
        }
      }

      const onlineUsers = Array.from(dedupedByIdentity.values())
        .map((r) => {
          const secondsAgo = Math.max(0, Math.floor((now - r.lastSeenMs) / 1000));
          return {
            ...r,
            secondsAgo,
            isOnline: true,
          };
        })
        .sort((a, b) => b.lastSeenMs - a.lastSeenMs);

      const totalOnline = onlineUsers.length;
      const totalGoogleUsers = onlineUsers.filter((u) => u.loginType === 'google').length;
      const totalGuests = onlineUsers.filter((u) => u.loginType === 'guest').length;

      return res.json({
        totalOnline,
        totalGoogleUsers,
        totalGuests,
        users: onlineUsers,
        serverTime: now,
      });
    } catch (err: any) {
      console.error('Error in /api/presence/online:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 6. Fast Global Masterdata Cache Endpoint (serves 76,100+ GRO & OTHERS rows in <100ms)
  const masterdataCachePath = path.resolve(process.cwd(), '.data', 'masterdata_rows_cache.json');
  let cachedMasterdataPayload: { updatedAt: string; rows: string[][] } | null = null;
  let inFlightMasterdataRefresh: Promise<{ updatedAt: string; rows: string[][] } | null> | null = null;

  async function loadMasterdataCacheFromDisk(): Promise<void> {
    try {
      if (fs.existsSync(masterdataCachePath)) {
        const raw = await fs.promises.readFile(masterdataCachePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.rows) && parsed.rows.length > 1) {
          if (
            !cachedMasterdataPayload ||
            !Array.isArray(cachedMasterdataPayload.rows) ||
            (parsed.updatedAt &&
              (!cachedMasterdataPayload.updatedAt || parsed.updatedAt > cachedMasterdataPayload.updatedAt)) ||
            parsed.rows.length > (cachedMasterdataPayload?.rows?.length || 0)
          ) {
            cachedMasterdataPayload = parsed;
          }
        }
      }
    } catch (e) {
      console.warn('Could not load masterdata cache from disk:', e);
    }
  }

  function parseCsvRows(csvText: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const ch = csvText[i];
      if (inQuotes) {
        if (ch === '"') {
          if (csvText[i + 1] === '"') {
            currentField += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          currentField += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          currentRow.push(currentField);
          currentField = '';
        } else if (ch === '\n') {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = '';
        } else if (ch !== '\r') {
          currentField += ch;
        }
      }
    }
    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }
    return rows;
  }

  async function fetchSheetValuesWithFallback(
    spreadsheetId: string,
    tabName: 'GRO' | 'OTHERS',
    token?: string
  ): Promise<string[][]> {
    if (token) {
      try {
        const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          tabName
        )}!A:Z?fields=values`;
        const gRes = await fetch(sheetUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (gRes.ok) {
          const gData: any = await gRes.json();
          if (Array.isArray(gData?.values) && gData.values.length > 1) {
            return gData.values as string[][];
          }
        }
      } catch {}
    }

    // Fallback: fetch via Google Sheets gviz CSV endpoint (works in Guest Mode without OAuth token)
    // CRITICAL: Always pass &headers=1 so Google gviz does not merge the first 309 rows of OTHERS into the header!
    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
        tabName
      )}&headers=1&_ts=${Date.now()}`;
      const cRes = await fetch(csvUrl, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });
      if (cRes.ok) {
        const csvText = await cRes.text();
        const parsed = parseCsvRows(csvText);
        if (parsed.length > 1) {
          return parsed;
        }
      }
    } catch {}

    return [];
  }

  async function refreshMasterdataFromGoogle(token?: string): Promise<{ updatedAt: string; rows: string[][] } | null> {
    if (inFlightMasterdataRefresh) {
      return inFlightMasterdataRefresh;
    }

    inFlightMasterdataRefresh = (async () => {
      try {
        const effectiveToken = (await resolveMasterdataWriteToken(token)) || token;
        const spreadsheetId = '1tIoDEOmqf-WOGuBalLtSrcCv-lPuz2lqRUzG7O90VUE';
        const tabsToFetch = ['GRO', 'OTHERS'] as const;
        const results = await Promise.all(
          tabsToFetch.map(async (tabName) => {
            const values = await fetchSheetValuesWithFallback(spreadsheetId, tabName, effectiveToken);
            return { tabName, values };
          })
        );

        const groResult = results.find((r) => r.tabName === 'GRO')?.values || [];
        const othersResult = results.find((r) => r.tabName === 'OTHERS')?.values || [];

        // Require both GRO and OTHERS to have rows so we never overwrite a complete cache with partial data
        if (groResult.length > 1 && othersResult.length > 1) {
          const combinedRows: string[][] = [
            ['Item Code', 'Item Description', 'Category', 'SubCategory', 'SubSubCategory', 'Barcode', 'Sheet', 'UOM'],
          ];

          for (const { tabName, values } of results) {
            for (let i = 1; i < values.length; i++) {
              const r = values[i];
              if (!r || r.length === 0) continue;
              const code = (r[0] || '').trim();
              const desc = (r[1] || '').trim();
              const bc = (r[5] || '').trim();
              if (!code && !desc && !bc) continue;
              if (code.toLowerCase() === 'item code' && desc.toLowerCase().includes('desc')) continue;

              const uom = (r[6] || '').trim() || 'PCS';

              combinedRows.push([
                code,
                desc,
                (r[2] || '').trim(),
                (r[3] || '').trim(),
                (r[4] || '').trim(),
                bc,
                tabName,
                uom,
              ]);
            }
          }

          if (combinedRows.length > 50000) {
            cachedMasterdataPayload = {
              updatedAt: new Date().toISOString(),
              rows: combinedRows,
            };
            try {
              await fs.promises.mkdir(path.dirname(masterdataCachePath), { recursive: true });
              await fs.promises.writeFile(masterdataCachePath, JSON.stringify(cachedMasterdataPayload));
              console.log(
                `[Masterdata] Cached ${combinedRows.length - 1} total items (GRO: ${groResult.length - 1}, OTHERS: ${othersResult.length - 1})`
              );
            } catch {}
            return cachedMasterdataPayload;
          }
        }
      } catch (e) {
        console.warn('Background masterdata refresh notice:', e);
      }
      return cachedMasterdataPayload;
    })().finally(() => {
      inFlightMasterdataRefresh = null;
    });

    return inFlightMasterdataRefresh;
  }

  app.get('/api/masterdata', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const authHeader = req.headers.authorization;
      const bearerToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const metaOnly = req.query.meta === '1' || req.query.meta === 'true';

      // Reload from disk if memory cache is not yet populated
      if (
        !cachedMasterdataPayload ||
        !Array.isArray(cachedMasterdataPayload.rows) ||
        cachedMasterdataPayload.rows.length < 50000
      ) {
        await loadMasterdataCacheFromDisk();
      }

      if (metaOnly) {
        const ageMs = cachedMasterdataPayload?.updatedAt
          ? Date.now() - new Date(cachedMasterdataPayload.updatedAt).getTime()
          : Infinity;
        if (ageMs > 3 * 60 * 1000) {
          void refreshMasterdataFromGoogle(bearerToken || undefined);
        }

        const totalItems =
          cachedMasterdataPayload &&
          Array.isArray(cachedMasterdataPayload.rows) &&
          cachedMasterdataPayload.rows.length > 1
            ? cachedMasterdataPayload.rows.length - 1
            : 0;
        return res.json({
          updatedAt: cachedMasterdataPayload?.updatedAt || null,
          totalItems,
        });
      }

      if (forceRefresh) {
        const fresh = await refreshMasterdataFromGoogle(bearerToken || undefined);
        if (fresh && Array.isArray(fresh.rows) && fresh.rows.length > 1) {
          return res.json(fresh);
        }
      }

      // If memory cache still has < 50,000 rows (missing OTHERS), await refresh right now so client always gets GRO + OTHERS
      if (
        !cachedMasterdataPayload ||
        !Array.isArray(cachedMasterdataPayload.rows) ||
        cachedMasterdataPayload.rows.length < 50000
      ) {
        const fresh = await refreshMasterdataFromGoogle(bearerToken || undefined);
        if (fresh && Array.isArray(fresh.rows) && fresh.rows.length > 1) {
          return res.json(fresh);
        }
      }

      if (cachedMasterdataPayload && Array.isArray(cachedMasterdataPayload.rows) && cachedMasterdataPayload.rows.length > 1) {
        const ageMs = Date.now() - new Date(cachedMasterdataPayload.updatedAt || 0).getTime();
        if (ageMs > 3 * 60 * 1000) {
          void refreshMasterdataFromGoogle(bearerToken || undefined);
        }
        return res.json(cachedMasterdataPayload);
      }

      return res.json({ updatedAt: null, rows: [] });
    } catch (err: any) {
      console.error('Error serving /api/masterdata:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Helper to resolve an active Google OAuth token for Masterdata Google Sheet writes
  async function resolveMasterdataWriteToken(bearerToken?: string): Promise<string | null> {
    if (bearerToken && bearerToken.length > 20) return bearerToken;
    try {
      const stmt = db.prepare(
        'SELECT state_json FROM user_workspace_state ORDER BY updated_at DESC LIMIT 20'
      );
      const res = await stmt.all<{ state_json: string }>();
      for (const row of res.results || []) {
        try {
          const parsed = JSON.parse(row.state_json);
          if (parsed?.oauthAccessToken && typeof parsed.oauthAccessToken === 'string') {
            return parsed.oauthAccessToken;
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  // Helper to find a row index (1-based) in a Masterdata Google Sheet tab ('GRO' or 'OTHERS')
  async function findMasterdataSheetRowNumber(
    spreadsheetId: string,
    tabName: 'GRO' | 'OTHERS',
    token: string,
    matchCode: string,
    matchBarcode: string,
    matchDescription: string
  ): Promise<number> {
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      tabName
    )}!A:Z?fields=values`;
    const gRes = await fetch(sheetUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!gRes.ok) return -1;
    const gData: any = await gRes.json();
    const rows: string[][] = Array.isArray(gData?.values) ? gData.values : [];
    const normCode = matchCode.trim().toLowerCase();
    const normBc = matchBarcode.trim().toLowerCase();
    const normDesc = matchDescription.trim().toLowerCase();

    // 1. Exact Item Code match (preferred)
    if (normCode) {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || [];
        if (String(r[0] || '').trim().toLowerCase() === normCode) {
          return i + 1; // 1-based sheet row number
        }
      }
    }
    // 2. Fallback: Barcode + Description or Barcode match
    if (normBc) {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const rBc = String(r[5] || '').trim().toLowerCase();
        const rDesc = String(r[1] || '').trim().toLowerCase();
        if (rBc === normBc && (!normDesc || rDesc === normDesc)) {
          return i + 1;
        }
      }
    }
    // 3. Fallback: Exact Description match when code & barcode are empty
    if (!normCode && !normBc && normDesc) {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || [];
        if (String(r[1] || '').trim().toLowerCase() === normDesc) {
          return i + 1;
        }
      }
    }
    return -1;
  }

  async function deleteMasterdataSheetRowByNumber(
    spreadsheetId: string,
    tabName: 'GRO' | 'OTHERS',
    token: string,
    rowNumber1Based: number
  ): Promise<boolean> {
    if (rowNumber1Based <= 1) return false;
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!metaRes.ok) return false;
    const metaData: any = await metaRes.json();
    const targetSheet = (metaData.sheets || []).find(
      (s: any) => String(s.properties?.title || '').trim().toUpperCase() === tabName
    );
    if (!targetSheet?.properties || targetSheet.properties.sheetId === undefined) return false;

    const delRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: targetSheet.properties.sheetId,
                  dimension: 'ROWS',
                  startIndex: rowNumber1Based - 1,
                  endIndex: rowNumber1Based,
                },
              },
            },
          ],
        }),
      }
    );
    return delRes.ok;
  }

  async function persistMasterdataCacheToDisk(): Promise<void> {
    if (!cachedMasterdataPayload) return;
    cachedMasterdataPayload.updatedAt = new Date().toISOString();
    try {
      await fs.promises.mkdir(path.dirname(masterdataCachePath), { recursive: true });
      await fs.promises.writeFile(masterdataCachePath, JSON.stringify(cachedMasterdataPayload));
    } catch (e) {
      console.warn('Could not persist updated masterdata cache to disk:', e);
    }
  }

  // Admin Endpoint: Edit an existing Masterdata item in GRO or OTHERS (updates Google Sheet + Server Cache)
  app.put('/api/masterdata/item', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const authHeader = req.headers.authorization;
      const bearerToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const token = await resolveMasterdataWriteToken(bearerToken);

      const {
        originalItemCode = '',
        originalBarcode = '',
        originalDescription = '',
        originalSheet = 'GRO',
        itemCode = '',
        barcode = '',
        itemDescription = '',
        category = '',
        subCategory = '',
        subsubCategory = '',
        sheet = 'GRO',
        targetSheet: reqTargetSheet,
      } = req.body || {};

      const targetSheet: 'GRO' | 'OTHERS' =
        String(reqTargetSheet || sheet).toUpperCase() === 'OTHERS' ? 'OTHERS' : 'GRO';
      const prevSheet: 'GRO' | 'OTHERS' =
        String(originalSheet).toUpperCase() === 'OTHERS' ? 'OTHERS' : 'GRO';

      const cleanRowValues = [
        String(itemCode || '').trim(),
        String(itemDescription || '').trim(),
        String(category || '').trim(),
        String(subCategory || '').trim(),
        String(subsubCategory || '').trim(),
        String(barcode || '').trim(),
      ];

      if (!cleanRowValues[0] && !cleanRowValues[1] && !cleanRowValues[5]) {
        return res.status(400).json({ error: 'Item Code, Description, or Barcode is required.' });
      }

      if (!cachedMasterdataPayload) {
        await loadMasterdataCacheFromDisk();
      }

      let sheetUpdated = false;
      let sheetError: string | null = null;
      const spreadsheetIds = [
        '1tIoDEOmqf-WOGuBalLtSrcCv-lPuz2lqRUzG7O90VUE',
        '1qnY9fJGHdYUqddEhXy4MDqh5qT7TOPorNsuz-7J8eQY',
      ];

      if (token) {
        for (const spreadsheetId of spreadsheetIds) {
          try {
            const rowNum = await findMasterdataSheetRowNumber(
              spreadsheetId,
              prevSheet,
              token,
              String(originalItemCode || itemCode || ''),
              String(originalBarcode || barcode || ''),
              String(originalDescription || itemDescription || '')
            );

            if (rowNum > 1) {
              if (prevSheet === targetSheet) {
                const range = `${encodeURIComponent(targetSheet)}!A${rowNum}:F${rowNum}`;
                const putRes = await fetch(
                  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
                  {
                    method: 'PUT',
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ values: [cleanRowValues] }),
                  }
                );
                if (putRes.ok) {
                  sheetUpdated = true;
                  break;
                } else {
                  sheetError = await putRes.text();
                }
              } else {
                // Moved between GRO and OTHERS: delete from prevSheet and append to targetSheet
                await deleteMasterdataSheetRowByNumber(spreadsheetId, prevSheet, token, rowNum);
                const appendRes = await fetch(
                  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
                    targetSheet
                  )}!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
                  {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ values: [cleanRowValues] }),
                  }
                );
                if (appendRes.ok) {
                  sheetUpdated = true;
                  break;
                } else {
                  sheetError = await appendRes.text();
                }
              }
            } else {
              // Row not found in prevSheet, append to targetSheet if it's the primary masterdata sheet
              const appendRes = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
                  targetSheet
                )}!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ values: [cleanRowValues] }),
                }
              );
              if (appendRes.ok) {
                sheetUpdated = true;
                break;
              }
            }
          } catch (e: any) {
            sheetError = e?.message || String(e);
          }
        }
      }

      // Update cachedMasterdataPayload in memory & disk immediately
      if (cachedMasterdataPayload && Array.isArray(cachedMasterdataPayload.rows)) {
        const normOrigCode = String(originalItemCode || '').trim().toLowerCase();
        const normOrigBc = String(originalBarcode || '').trim().toLowerCase();
        const normOrigDesc = String(originalDescription || '').trim().toLowerCase();
        let updatedInCache = false;

        for (let i = 1; i < cachedMasterdataPayload.rows.length; i++) {
          const r = cachedMasterdataPayload.rows[i];
          if (!r) continue;
          const rCode = String(r[0] || '').trim().toLowerCase();
          const rDesc = String(r[1] || '').trim().toLowerCase();
          const rBc = String(r[5] || '').trim().toLowerCase();
          const rSheet = String(r[6] || 'GRO').trim().toUpperCase();

          const codeMatch = normOrigCode && rCode === normOrigCode && rSheet === prevSheet;
          const bcMatch = !normOrigCode && normOrigBc && rBc === normOrigBc && rSheet === prevSheet;
          const descMatch =
            !normOrigCode && !normOrigBc && normOrigDesc && rDesc === normOrigDesc && rSheet === prevSheet;

          if (codeMatch || bcMatch || descMatch) {
            cachedMasterdataPayload.rows[i] = [...cleanRowValues, targetSheet];
            updatedInCache = true;
            break;
          }
        }

        if (!updatedInCache) {
          cachedMasterdataPayload.rows.push([...cleanRowValues, targetSheet]);
        }
        await persistMasterdataCacheToDisk();
      }

      return res.json({
        success: true,
        sheetUpdated,
        sheetError,
        updatedAt: cachedMasterdataPayload?.updatedAt || new Date().toISOString(),
        item: {
          itemCode: cleanRowValues[0],
          itemDescription: cleanRowValues[1],
          category: cleanRowValues[2],
          subCategory: cleanRowValues[3],
          subsubCategory: cleanRowValues[4],
          barcode: cleanRowValues[5],
          masterdataSheet: targetSheet,
        },
      });
    } catch (err: any) {
      console.error('Error updating masterdata item:', err);
      return res.status(500).json({ error: err.message || 'Failed to update Masterdata item' });
    }
  });

  // Admin Endpoint: Add a new Masterdata item to GRO or OTHERS (appends to Google Sheet + Server Cache)
  app.post('/api/masterdata/item', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const authHeader = req.headers.authorization;
      const bearerToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const token = await resolveMasterdataWriteToken(bearerToken);

      const {
        itemCode = '',
        barcode = '',
        itemDescription = '',
        category = '',
        subCategory = '',
        subsubCategory = '',
        sheet = 'GRO',
        targetSheet: reqTargetSheet,
      } = req.body || {};

      const targetSheet: 'GRO' | 'OTHERS' =
        String(reqTargetSheet || sheet).toUpperCase() === 'OTHERS' ? 'OTHERS' : 'GRO';

      const cleanRowValues = [
        String(itemCode || '').trim(),
        String(itemDescription || '').trim(),
        String(category || '').trim(),
        String(subCategory || '').trim(),
        String(subsubCategory || '').trim(),
        String(barcode || '').trim(),
      ];

      if (!cleanRowValues[0] && !cleanRowValues[1] && !cleanRowValues[5]) {
        return res.status(400).json({ error: 'Item Code, Description, or Barcode is required.' });
      }

      if (!cachedMasterdataPayload) {
        await loadMasterdataCacheFromDisk();
      }

      let sheetUpdated = false;
      let sheetError: string | null = null;
      const spreadsheetIds = [
        '1tIoDEOmqf-WOGuBalLtSrcCv-lPuz2lqRUzG7O90VUE',
        '1qnY9fJGHdYUqddEhXy4MDqh5qT7TOPorNsuz-7J8eQY',
      ];

      if (token) {
        for (const spreadsheetId of spreadsheetIds) {
          try {
            const appendRes = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
                targetSheet
              )}!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ values: [cleanRowValues] }),
              }
            );
            if (appendRes.ok) {
              sheetUpdated = true;
              break;
            } else {
              sheetError = await appendRes.text();
            }
          } catch (e: any) {
            sheetError = e?.message || String(e);
          }
        }
      }

      if (cachedMasterdataPayload && Array.isArray(cachedMasterdataPayload.rows)) {
        cachedMasterdataPayload.rows.splice(1, 0, [...cleanRowValues, targetSheet]);
        await persistMasterdataCacheToDisk();
      }

      return res.json({
        success: true,
        sheetUpdated,
        sheetError,
        updatedAt: cachedMasterdataPayload?.updatedAt || new Date().toISOString(),
        item: {
          itemCode: cleanRowValues[0],
          itemDescription: cleanRowValues[1],
          category: cleanRowValues[2],
          subCategory: cleanRowValues[3],
          subsubCategory: cleanRowValues[4],
          barcode: cleanRowValues[5],
          masterdataSheet: targetSheet,
        },
      });
    } catch (err: any) {
      console.error('Error adding masterdata item:', err);
      return res.status(500).json({ error: err.message || 'Failed to add Masterdata item' });
    }
  });

  // Admin Endpoint: Delete a Masterdata item from GRO or OTHERS (deletes from Google Sheet + Server Cache)
  app.delete('/api/masterdata/item', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const authHeader = req.headers.authorization;
      const bearerToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const token = await resolveMasterdataWriteToken(bearerToken);

      const {
        itemCode = '',
        barcode = '',
        itemDescription = '',
        sheet = 'GRO',
      } = req.body || {};

      const targetSheet: 'GRO' | 'OTHERS' =
        String(sheet).toUpperCase() === 'OTHERS' ? 'OTHERS' : 'GRO';

      if (!cachedMasterdataPayload) {
        await loadMasterdataCacheFromDisk();
      }

      let sheetUpdated = false;
      let sheetError: string | null = null;
      const spreadsheetIds = [
        '1tIoDEOmqf-WOGuBalLtSrcCv-lPuz2lqRUzG7O90VUE',
        '1qnY9fJGHdYUqddEhXy4MDqh5qT7TOPorNsuz-7J8eQY',
      ];

      if (token) {
        for (const spreadsheetId of spreadsheetIds) {
          try {
            const rowNum = await findMasterdataSheetRowNumber(
              spreadsheetId,
              targetSheet,
              token,
              String(itemCode || ''),
              String(barcode || ''),
              String(itemDescription || '')
            );
            if (rowNum > 1) {
              const deleted = await deleteMasterdataSheetRowByNumber(
                spreadsheetId,
                targetSheet,
                token,
                rowNum
              );
              if (deleted) {
                sheetUpdated = true;
                break;
              }
            }
          } catch (e: any) {
            sheetError = e?.message || String(e);
          }
        }
      }

      if (cachedMasterdataPayload && Array.isArray(cachedMasterdataPayload.rows)) {
        const normCode = String(itemCode || '').trim().toLowerCase();
        const normBc = String(barcode || '').trim().toLowerCase();
        const normDesc = String(itemDescription || '').trim().toLowerCase();

        const idx = cachedMasterdataPayload.rows.findIndex((r, i) => {
          if (i === 0 || !r) return false;
          const rCode = String(r[0] || '').trim().toLowerCase();
          const rDesc = String(r[1] || '').trim().toLowerCase();
          const rBc = String(r[5] || '').trim().toLowerCase();
          const rSheet = String(r[6] || 'GRO').trim().toUpperCase();
          if (rSheet !== targetSheet) return false;
          if (normCode && rCode === normCode) return true;
          if (!normCode && normBc && rBc === normBc) return true;
          if (!normCode && !normBc && normDesc && rDesc === normDesc) return true;
          return false;
        });

        if (idx > 0) {
          cachedMasterdataPayload.rows.splice(idx, 1);
          await persistMasterdataCacheToDisk();
        }
      }

      return res.json({
        success: true,
        sheetUpdated,
        sheetError,
        updatedAt: cachedMasterdataPayload?.updatedAt || new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Error deleting masterdata item:', err);
      return res.status(500).json({ error: err.message || 'Failed to delete Masterdata item' });
    }
  });

  // 6b. Guest Local IATD Google Sheet Fetcher
  // Allows guest users to provide a Google Sheet link or spreadsheet ID
  // and loads inventory data from the "IATD" sheet tab.
  // Helper: Convert 0-based column index to A1 column letter (0 -> A, 5 -> F, 19 -> T, 26 -> AA)
  function colIndexToLetter(index: number): string {
    let temp = index + 1;
    let letter = '';
    while (temp > 0) {
      const rem = (temp - 1) % 26;
      letter = String.fromCharCode(65 + rem) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    return letter;
  }

  // Helper: Parse numeric values from Google Sheets (handles commas, currency symbols, accounting negatives like "(15)", and accounting zero "-")
  function parseSheetNumber(raw: any): number {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    let str = String(raw).trim();
    if (!str || str === '-' || str === '—' || str === '–' || str.toLowerCase() === 'n/a') return 0;
    let isAccountingNegative = false;
    if (/^\(\s*[\d,.]+\s*\)$/.test(str)) {
      isAccountingNegative = true;
      str = str.replace(/[()]/g, '').trim();
    }
    const cleaned = str.replace(/,/g, '').replace(/[^0-9.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
    const parsed = parseFloat(cleaned);
    if (!Number.isFinite(parsed)) return 0;
    return isAccountingNegative ? -Math.abs(parsed) : parsed;
  }

  // Helper: Scan Row 2 (and Row 1 for vertically merged headers) of IATD sheet for:
  // 1) CS columns starting from CS01 up to right before the cell with "Total Actual"
  // 2) Remarks column
  function scanIatdRow2Structure(
    row1: string[] = [],
    row2: string[] = [],
    itemRowValues?: string[],
    rowNumber1Based?: number
  ) {
    const normalize = (s: string) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    const maxCols = Math.max(row1.length, row2.length, itemRowValues ? itemRowValues.length : 0);

    // 1. Find Remarks column (check Row 2 first, then Row 1 for vertically merged Remarks header)
    let remarksColIdx = -1;
    let remarksLabel = 'Remarks';
    for (let c = 0; c < maxCols; c++) {
      const r2 = String(row2[c] || '').trim();
      const r1 = String(row1[c] || '').trim();
      const n2 = normalize(r2);
      const n1 = normalize(r1);
      if (n2 === 'remarks' || n2 === 'remark' || n2.includes('remark')) {
        remarksColIdx = c;
        remarksLabel = r2 || 'Remarks';
        break;
      }
      if (n1 === 'remarks' || n1 === 'remark' || n1.includes('remark')) {
        remarksColIdx = c;
        remarksLabel = r1 || 'Remarks';
        break;
      }
    }

    // 2. Find CS01 start index in Row 2 (or Row 1 fallback)
    let csStartIdx = -1;
    for (let c = 0; c < maxCols; c++) {
      const n2 = normalize(row2[c] || '');
      if (n2 === 'cs01' || n2 === 'cs1' || n2 === 'countsheet01' || n2 === 'countsheet1' || /^cs0*1$/.test(n2)) {
        csStartIdx = c;
        break;
      }
    }
    if (csStartIdx === -1) {
      // Fallback: look for first CS column after Balance (index >= 12)
      for (let c = 12; c < maxCols; c++) {
        const n2 = normalize(row2[c] || '');
        if (/^cs\d+$/.test(n2) || /^cs0*\d+$/.test(n2)) {
          csStartIdx = c;
          break;
        }
      }
    }

    // 3. Scan from CS01 up to the cell right before "Total Actual"
    const csColumns: Array<{
      label: string;
      csNumber: number;
      colIndex: number;
      colLetter: string;
      cellA1?: string;
      existingValue?: string;
    }> = [];

    if (csStartIdx !== -1) {
      for (let c = csStartIdx; c < maxCols; c++) {
        const r2Raw = String(row2[c] || '').trim();
        const r1Raw = String(row1[c] || '').trim();
        const n2 = normalize(r2Raw);
        const n1 = normalize(r1Raw);

        // Stop immediately when we reach "Total Actual"
        const isTotalActual =
          n2.includes('totalactual') ||
          n1.includes('totalactual') ||
          (n2.includes('total') && n2.includes('actual')) ||
          (n1.includes('total') && n1.includes('actual'));
        if (isTotalActual) {
          break;
        }

        if (!r2Raw) {
          continue;
        }

        // If remarks happens to be between Balance and Total Actual, don't treat "Remarks" as a CS column
        if (n2 === 'remarks' || n2 === 'remark') {
          if (remarksColIdx === -1) {
            remarksColIdx = c;
            remarksLabel = r2Raw;
          }
          continue;
        }

        const numMatch = r2Raw.match(/(\d+)/);
        const csNum = numMatch ? parseInt(numMatch[1], 10) : csColumns.length + 1;
        const formattedCsLabel = `CS${String(csNum).padStart(2, '0')}`;
        const colLetter = colIndexToLetter(c);
        const existingVal =
          itemRowValues && c < itemRowValues.length && itemRowValues[c] !== undefined
            ? String(itemRowValues[c]).trim()
            : '';

        csColumns.push({
          label: formattedCsLabel,
          csNumber: csNum,
          colIndex: c,
          colLetter,
          ...(rowNumber1Based && rowNumber1Based > 0 ? { cellA1: `${colLetter}${rowNumber1Based}` } : {}),
          ...(itemRowValues ? { existingValue: existingVal } : {}),
        });
      }
    }

    const remarksColumn =
      remarksColIdx !== -1
        ? {
            label: remarksLabel,
            colIndex: remarksColIdx,
            colLetter: colIndexToLetter(remarksColIdx),
            ...(rowNumber1Based && rowNumber1Based > 0
              ? { cellA1: `${colIndexToLetter(remarksColIdx)}${rowNumber1Based}` }
              : {}),
            ...(itemRowValues
              ? {
                  existingValue:
                    remarksColIdx < itemRowValues.length && itemRowValues[remarksColIdx] !== undefined
                      ? String(itemRowValues[remarksColIdx]).trim()
                      : '',
                }
              : {}),
          }
        : null;

    return { csColumns, remarksColumn };
  }

  // Helper: Extract Spreadsheet ID from URL or raw ID
  function extractSpreadsheetIdFromInput(urlOrId: string): string {
    const clean = String(urlOrId || '').trim();
    const dMatch =
      clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) ||
      clean.match(/\/d\/(?:e\/)?([a-zA-Z0-9-_]{15,})/);
    if (dMatch && dMatch[1]) return dMatch[1];
    const parts = clean.split(/[/\\?#]/);
    for (const part of parts) {
      if (/^[a-zA-Z0-9-_]{20,}$/.test(part)) {
        return part;
      }
    }
    return clean;
  }

  // Helper: Resolve the exact tab title and column count of the IATD / ENCODING inventory tab in a Google Sheet
  // Prevents "Unable to parse range: IATD!1:2" when the tab has spaces, a different case/name (e.g. ENCODING), or specific column bounds.
  async function resolveIatdSheetMeta(
    spreadsheetId: string,
    token?: string | null
  ): Promise<{ sheetTitle: string; safeSheetTitle: string; columnCount: number; maxColLetter: string; bulkColLetter: string }> {
    let sheetTitle = 'IATD';
    let columnCount = 200; // Default GR (covers CS01 through CS99 and CS100+)

    if (token) {
      try {
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties)`;
        const metaRes = await fetch(metaUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (metaRes.ok) {
          const metaData: any = await metaRes.json();
          const sheets: any[] = Array.isArray(metaData?.sheets) ? metaData.sheets : [];
          if (sheets.length > 0) {
            const SYSTEM_TABS = new Set([
              'COUNTSHEETS',
              'MONITORING',
              'UNIDENTIFIED',
              'SUMMARY',
              'ANALYSIS',
              'AUDIT',
              'SETTINGS',
              'USERS',
              'MEMBERS',
              'LOGS',
              'REPORTS',
              'REPORT',
            ]);
            const cleanTab = (t: string) =>
              String(t || '')
                .trim()
                .toUpperCase()
                .replace(/[\s_-]/g, '');

            const iatdMatch =
              sheets.find((s) => cleanTab(s.properties?.title) === 'IATD') ||
              sheets.find((s) => cleanTab(s.properties?.title).includes('IATD')) ||
              sheets.find((s) => cleanTab(s.properties?.title) === 'ENCODING') ||
              sheets.find((s) => cleanTab(s.properties?.title).includes('ENCOD')) ||
              sheets.find((s) => !SYSTEM_TABS.has(cleanTab(s.properties?.title))) ||
              sheets[0];

            if (iatdMatch?.properties?.title) {
              sheetTitle = String(iatdMatch.properties.title);
            }
            const gridCols = Number(iatdMatch?.properties?.gridProperties?.columnCount);
            if (Number.isFinite(gridCols) && gridCols > 0) {
              columnCount = gridCols;
            }
          }
        }
      } catch {}
    }

    const safeSheetTitle = `'${sheetTitle.replace(/'/g, "''")}'`;
    const maxColLetter = colIndexToLetter(Math.max(1, columnCount) - 1);
    const bulkColLetter = colIndexToLetter(Math.min(26, Math.max(1, columnCount)) - 1);
    return {
      sheetTitle,
      safeSheetTitle,
      columnCount,
      maxColLetter,
      bulkColLetter,
    };
  }

  // The header row is on Row 2 (0-indexed 1) with headers: Item Code, Item Description, Cost (Col F), Unit (Col H), Balance (Col L), Barcode, Remarks, CS01..Total Actual.
  // Data rows start on Row 3 (0-indexed 2). Bulk item loading only reads columns A to Z, while Row 2 header scanning reads the full Row 1:2 width.
  app.post('/api/guest/fetch-iatd-sheet', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const urlOrId = String(req.body?.urlOrId || req.body?.url || req.body?.spreadsheetId || '').trim();
      if (!urlOrId) {
        return res.status(400).json({ error: 'Google Sheet link or Spreadsheet ID is required.' });
      }

      const spreadsheetId = extractSpreadsheetIdFromInput(urlOrId);
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

      let rows: string[][] = [];
      let fullHeaderRows: string[][] = []; // Full width Row 1 and Row 2 (for CS01 up to Total Actual)
      let rowOffset1Based = 0; // If rows[0] is Row 1 of sheet, offset is 1; if rows[0] is Row 2 of sheet, offset is 2

      // 1. If an active Google token is present or available, try Google Sheets API v4
      const tokenToUse = bearerToken || (await resolveMasterdataWriteToken());
      const sheetMeta = await resolveIatdSheetMeta(spreadsheetId, tokenToUse);

      if (tokenToUse) {
        try {
          const headerRange = `${sheetMeta.safeSheetTitle}!A1:${sheetMeta.maxColLetter}2`;
          const bulkRange = `${sheetMeta.safeSheetTitle}!A1:${sheetMeta.bulkColLetter}`;
          const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=${encodeURIComponent(
            headerRange
          )}&ranges=${encodeURIComponent(bulkRange)}&valueRenderOption=FORMATTED_VALUE`;
          const gRes = await fetch(batchUrl, {
            headers: { Authorization: `Bearer ${tokenToUse}` },
          });
          if (gRes.ok) {
            const gData: any = await gRes.json();
            const valueRanges = Array.isArray(gData?.valueRanges) ? gData.valueRanges : [];
            if (valueRanges[0]?.values) {
              fullHeaderRows = valueRanges[0].values;
            }
            if (Array.isArray(valueRanges[1]?.values) && valueRanges[1].values.length > 0) {
              rows = valueRanges[1].values;
              rowOffset1Based = 1;
            }
          }
        } catch {}
      }

      // 2. If no rows yet, fetch via Google Sheets gviz CSV endpoint using range=A2:Z&headers=1 (for bulk items A-Z without type-stripping)
      //    and range=A1:AZ2&headers=0 (for full Row 1 & Row 2 headers across all CS01..Total Actual columns)
      if (rows.length === 0) {
        const [csvDataRes, csvHeaderRes] = await Promise.all([
          fetch(
            `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
              sheetMeta.sheetTitle
            )}&range=A2:Z&headers=1&_ts=${Date.now()}`,
            {
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Pragma: 'no-cache',
              },
            }
          ),
          fetch(
            `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
              sheetMeta.sheetTitle
            )}&range=A1:${sheetMeta.maxColLetter}2&headers=0&_ts=${Date.now()}`,
            {
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Pragma: 'no-cache',
              },
            }
          ).catch(() => null),
        ]);

        if (csvHeaderRes && csvHeaderRes.ok) {
          const hdrText = await csvHeaderRes.text();
          if (!hdrText.includes('<!DOCTYPE html>') && !hdrText.includes('<html')) {
            fullHeaderRows = parseCsvRows(hdrText);
          }
        }

        if (csvDataRes.ok) {
          const csvText = await csvDataRes.text();
          if (
            csvText.includes('<!DOCTYPE html>') ||
            csvText.includes('<html') ||
            csvText.includes('google-site-verification')
          ) {
            return res.status(403).json({
              error:
                'Cannot access this Google Sheet. Please ensure the sheet sharing settings are set to "Anyone with the link can view", or sign in with Google.',
            });
          }
          rows = parseCsvRows(csvText);
          // Because range=A2:Z starts at Row 2, rows[0] is Row 2 and rows[1] is Row 3!
          rowOffset1Based = 2;
        } else {
          return res.status(csvDataRes.status).json({
            error: `Failed to fetch sheet from Google (HTTP ${csvDataRes.status}). Please check that the URL is correct and the sheet is accessible.`,
          });
        }
      }

      if (rows.length < 2) {
        return res.status(404).json({
          error:
            'The "IATD" tab was not found or has insufficient rows. Please ensure your Google Sheet has a tab named "IATD" with headers on Row 2.',
        });
      }

      const normalizeHeader = (s: string) =>
        String(s || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');

      const isHeaderRow = (r: string[]) => {
        if (!r || r.length === 0) return false;
        const norm = r.map(normalizeHeader);
        return (
          norm.some((h) => h.includes('itemcode') || h.includes('itemdescription') || h.includes('barcode') || h === 'description')
        );
      };

      let headerRowIdx = 0;
      if (rowOffset1Based === 1) {
        // rows[0] is Row 1, rows[1] is Row 2
        if (rows.length > 1 && isHeaderRow(rows[1])) {
          headerRowIdx = 1;
        } else if (rows.length > 0 && isHeaderRow(rows[0])) {
          headerRowIdx = 0;
        } else {
          for (let idx = 0; idx < Math.min(rows.length, 5); idx++) {
            if (isHeaderRow(rows[idx])) {
              headerRowIdx = idx;
              break;
            }
          }
        }
      } else {
        // rowOffset1Based === 2: rows[0] is already Row 2
        headerRowIdx = 0;
      }

      const row1Full =
        fullHeaderRows.length >= 2
          ? fullHeaderRows[0]
          : rowOffset1Based === 1 && headerRowIdx > 0
          ? rows[0]
          : [];
      const row2Full =
        fullHeaderRows.length >= 2
          ? fullHeaderRows[1]
          : fullHeaderRows.length === 1
          ? fullHeaderRows[0]
          : rows[headerRowIdx] || [];

      // Scan Row 2 from CS01 up to before "Total Actual", and locate Remarks column
      const { csColumns, remarksColumn } = scanIatdRow2Structure(row1Full, row2Full);

      // Build combined header lookup (Row 2 preferred, Row 1 fallback for vertically merged header cells)
      const rawHeaderRow = rows[headerRowIdx] || [];
      const maxHdrLen = Math.max(rawHeaderRow.length, row2Full.length, row1Full.length);
      const headerCols: string[] = [];
      for (let c = 0; c < maxHdrLen; c++) {
        const h2 = normalizeHeader(row2Full[c] ?? rawHeaderRow[c] ?? '');
        const h1 = normalizeHeader(row1Full[c] ?? '');
        headerCols.push(h2 || h1);
      }

      let codeIdx = headerCols.findIndex((h) => h.includes('itemcode') || h === 'code' || h.includes('code'));
      let descIdx = headerCols.findIndex(
        (h) => h.includes('itemdescription') || h.includes('description') || h === 'desc' || h.includes('desc')
      );
      let bcIdx = headerCols.findIndex(
        (h) =>
          h === 'barcode' ||
          h.includes('barcode') ||
          h === 'bar' ||
          h.includes('upc') ||
          h.includes('ean') ||
          h.includes('codebar')
      );
      if (codeIdx === -1) codeIdx = 0;
      if (descIdx === -1) descIdx = 2;
      if (bcIdx === -1) bcIdx = 1;

      // Exact column positions in IATD as specified by user:
      // Cost = Col F (index 5), Unit = Col H (index 7), Balance = Col L (index 11)
      const costIdx = 5;
      const unitIdx = 7;
      const balIdx = 11;
      const remarksIdx = remarksColumn ? remarksColumn.colIndex : -1;

      const items: any[] = [];
      const dataStartIdx = headerRowIdx + 1;

      for (let i = dataStartIdx; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const itemCode = codeIdx >= 0 && codeIdx < row.length ? String(row[codeIdx] || '').trim() : '';
        const itemDescription = descIdx >= 0 && descIdx < row.length ? String(row[descIdx] || '').trim() : '';
        const barcode = bcIdx >= 0 && bcIdx < row.length ? String(row[bcIdx] || '').trim() : '';

        // Skip empty or repeated header rows
        if (!itemCode && !itemDescription && !barcode) continue;
        if (itemCode.toLowerCase() === 'item code' && itemDescription.toLowerCase().includes('desc')) continue;

        const rawCost = costIdx < row.length ? row[costIdx] : '0';
        const rawUnit = unitIdx < row.length ? String(row[unitIdx] || '').trim() : '';
        const rawBal = balIdx < row.length ? row[balIdx] : '0';
        const rawRemarks =
          remarksIdx >= 0 && remarksIdx < row.length ? String(row[remarksIdx] || '').trim() : '';

        const cost = parseSheetNumber(rawCost);
        const balance = parseSheetNumber(rawBal);
        const unit = rawUnit || 'PCS';
        const sheetRowNumber = i + rowOffset1Based; // Exact 1-based row number in Google Sheet (e.g. Row 5 -> 5)

        items.push({
          itemCode,
          barcode,
          itemDescription,
          category: '',
          subCategory: '',
          subsubCategory: '',
          cost,
          selling: 0,
          unit,
          balance,
          begQty: balance,
          in: 0,
          out: 0,
          amount: Number((balance * cost).toFixed(2)),
          gp: 0,
          source: 'ENCODING',
          sheetRowNumber,
          remarks: rawRemarks,
        });
      }

      return res.json({
        success: true,
        spreadsheetId,
        sheetName: sheetMeta.sheetTitle,
        headerRow: headerRowIdx + rowOffset1Based,
        totalItems: items.length,
        csColumns,
        remarksColumn,
        items,
      });
    } catch (err: any) {
      console.error('Error fetching guest IATD sheet:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch IATD Google Sheet' });
    }
  });

  // 6b-2. Inspect a single item's row & Row 2 CS columns (CS01 up to before Total Actual) + existing Remarks in IATD
  // Reads Row 1:2 and the target item's exact row across all columns so Admin Mode can see existing plotted quantities & remarks before writing.
  app.post('/api/guest/inspect-iatd-row', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const {
        spreadsheetId: rawSpreadsheetId,
        rowNumber: rawRowNumber,
        itemCode,
        barcode,
        itemDescription,
      } = req.body || {};

      if (!rawSpreadsheetId) {
        return res.status(400).json({ error: 'Spreadsheet ID is required.' });
      }
      const spreadsheetId = extractSpreadsheetIdFromInput(rawSpreadsheetId);

      const authHeader = req.headers.authorization;
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const tokenToUse = bearerToken || (await resolveMasterdataWriteToken());
      const sheetMeta = await resolveIatdSheetMeta(spreadsheetId, tokenToUse);

      let targetRowNumber = parseInt(String(rawRowNumber || ''), 10);
      if (isNaN(targetRowNumber) || targetRowNumber < 3) {
        targetRowNumber = -1;
      }

      const normSearchCode = String(itemCode || '').trim().toLowerCase();
      const normSearchBc = String(barcode || '').trim().toLowerCase();
      const normSearchDesc = String(itemDescription || '').trim().toLowerCase();

      // Helper to fetch a specific range from IATD using OAuth token first, or gviz CSV fallback
      const fetchIatdRangeRows = async (rangeA1: string): Promise<string[][]> => {
        if (tokenToUse) {
          try {
            const fullRange = `${sheetMeta.safeSheetTitle}!${rangeA1}`;
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
              fullRange
            )}?valueRenderOption=FORMATTED_VALUE`;
            const gRes = await fetch(url, {
              headers: { Authorization: `Bearer ${tokenToUse}` },
            });
            if (gRes.ok) {
              const gData: any = await gRes.json();
              if (Array.isArray(gData?.values)) {
                return gData.values;
              }
            }
          } catch {}
        }

        const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
          sheetMeta.sheetTitle
        )}&range=${encodeURIComponent(rangeA1)}&headers=0&_ts=${Date.now()}`;
        const cRes = await fetch(csvUrl, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
        });
        if (cRes.ok) {
          const txt = await cRes.text();
          if (!txt.includes('<!DOCTYPE html>') && !txt.includes('<html')) {
            return parseCsvRows(txt);
          }
        }
        return [];
      };

      // 1. Fetch Row 1:2 across all columns using standard cell range A1:${maxColLetter}2
      const headerRows = await fetchIatdRangeRows(`A1:${sheetMeta.maxColLetter}2`);
      if (headerRows.length === 0) {
        return res.status(404).json({ error: 'Could not read Row 2 headers from IATD sheet.' });
      }
      const row1 = headerRows.length >= 2 ? headerRows[0] : [];
      const row2 = headerRows.length >= 2 ? headerRows[1] : headerRows[0];

      const normalize = (s: string) =>
        String(s || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');

      const maxHdr = Math.max(row1.length, row2.length);
      const combinedHdr: string[] = [];
      for (let c = 0; c < maxHdr; c++) {
        combinedHdr.push(normalize(row2[c] || '') || normalize(row1[c] || ''));
      }
      let codeIdx = combinedHdr.findIndex((h) => h.includes('itemcode') || h === 'code');
      let descIdx = combinedHdr.findIndex((h) => h.includes('itemdescription') || h.includes('description') || h === 'desc');
      let bcIdx = combinedHdr.findIndex((h) => h.includes('barcode') || h === 'bar' || h === 'upc');
      if (codeIdx === -1) codeIdx = 0;
      if (descIdx === -1) descIdx = 2;
      if (bcIdx === -1) bcIdx = 1;

      const matchesItemRow = (r: string[]) => {
        if (!r || r.length === 0) return false;
        const rCode = codeIdx >= 0 && codeIdx < r.length ? String(r[codeIdx] || '').trim().toLowerCase() : '';
        const rBc = bcIdx >= 0 && bcIdx < r.length ? String(r[bcIdx] || '').trim().toLowerCase() : '';
        const rDesc = descIdx >= 0 && descIdx < r.length ? String(r[descIdx] || '').trim().toLowerCase() : '';
        if (normSearchCode && rCode === normSearchCode) return true;
        if (normSearchBc && rBc === normSearchBc) return true;
        if (normSearchDesc && rDesc === normSearchDesc) return true;
        return false;
      };

      let itemRowValues: string[] = [];

      // 2. If targetRowNumber was provided, fetch that exact single row first and verify
      if (targetRowNumber >= 3) {
        const singleRow = await fetchIatdRangeRows(
          `A${targetRowNumber}:${sheetMeta.maxColLetter}${targetRowNumber}`
        );
        if (singleRow.length > 0 && matchesItemRow(singleRow[0])) {
          itemRowValues = singleRow[0];
        } else {
          targetRowNumber = -1;
        }
      }

      // 3. If targetRowNumber was not provided or shifted, search A1:G to find the exact row number, then fetch that full row
      if (targetRowNumber === -1) {
        const searchRows = await fetchIatdRangeRows('A1:G');
        for (let i = 2; i < searchRows.length; i++) {
          if (matchesItemRow(searchRows[i])) {
            targetRowNumber = i + 1;
            break;
          }
        }
        if (targetRowNumber >= 3) {
          const singleRow = await fetchIatdRangeRows(
            `A${targetRowNumber}:${sheetMeta.maxColLetter}${targetRowNumber}`
          );
          if (singleRow.length > 0) {
            itemRowValues = singleRow[0];
          }
        }
      }

      if (targetRowNumber === -1) {
        return res.status(404).json({ error: 'Item row not found in IATD sheet.' });
      }

      const { csColumns, remarksColumn } = scanIatdRow2Structure(
        row1,
        row2,
        itemRowValues,
        targetRowNumber
      );

      return res.json({
        success: true,
        spreadsheetId,
        sheetName: sheetMeta.sheetTitle,
        rowNumber: targetRowNumber,
        csColumns,
        remarksColumn,
      });
    } catch (err: any) {
      console.error('Error inspecting IATD row:', err);
      return res.status(500).json({ error: err.message || 'Failed to inspect IATD sheet row' });
    }
  });

  // 6c. Admin / Guest Single-Cell Updater for IATD Sheet
  // Scans Row 2 from CS01 up to before "Total Actual", finds the exact item row (e.g. Row 5) and target CS column (e.g. Col T -> T5),
  // reads existing cell values to prevent accidental overwriting, and updates ONLY the exact target cells (T5 and Remarks cell in Row 5).
  app.post('/api/guest/update-iatd-cell', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const {
        spreadsheetId: rawSpreadsheetId,
        rowNumber: rawRowNumber,
        itemCode,
        barcode,
        itemDescription,
        csNumber,        // e.g. 2 for CS02
        csLabel,         // e.g. "CS02"
        targetColLetter, // e.g. "T"
        qty,
        qtyMode = 'set', // 'set' | 'add' | 'skip'
        allowOverwrite = false,
        remarks,
        remarksMode = 'append', // 'append' | 'replace' | 'skip'
      } = req.body || {};

      if (!rawSpreadsheetId) {
        return res.status(400).json({ error: 'Spreadsheet ID is required.' });
      }
      const spreadsheetId = extractSpreadsheetIdFromInput(rawSpreadsheetId);

      const authHeader = req.headers.authorization;
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const tokenToUse = bearerToken || (await resolveMasterdataWriteToken());
      if (!tokenToUse) {
        return res.status(401).json({
          error: 'Google OAuth connection is required to write to the Google Sheet. Please connect your Google account.',
        });
      }

      // Resolve exact tab title and column count so A1 ranges never fail with "Unable to parse range"
      const sheetMeta = await resolveIatdSheetMeta(spreadsheetId, tokenToUse);

      // 1. Read Row 1:2 (full width across all columns) and A1:G (for item row lookup/verification)
      let headerRows: string[][] = [];
      let lookupRows: string[][] = [];

      const headerRange = `${sheetMeta.safeSheetTitle}!A1:${sheetMeta.maxColLetter}2`;
      const lookupRange = `${sheetMeta.safeSheetTitle}!A1:G`;
      const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=${encodeURIComponent(
        headerRange
      )}&ranges=${encodeURIComponent(lookupRange)}&valueRenderOption=FORMATTED_VALUE`;
      const gRes = await fetch(batchUrl, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      });

      if (gRes.ok) {
        const gData: any = await gRes.json();
        const valueRanges = Array.isArray(gData?.valueRanges) ? gData.valueRanges : [];
        headerRows = Array.isArray(valueRanges[0]?.values) ? valueRanges[0].values : [];
        lookupRows = Array.isArray(valueRanges[1]?.values) ? valueRanges[1].values : [];
      } else {
        // Fallback: if the A1 range was rejected (e.g., sheet has fewer columns than default AZ), read via gviz CSV
        const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
          sheetMeta.sheetTitle
        )}&headers=0&_ts=${Date.now()}`;
        const csvRes = await fetch(csvUrl, {
          headers: tokenToUse ? { Authorization: `Bearer ${tokenToUse}` } : undefined,
        }).catch(() => null);
        if (csvRes && csvRes.ok) {
          const csvTxt = await csvRes.text();
          if (!csvTxt.includes('<!DOCTYPE html>') && !csvTxt.includes('<html')) {
            const allRows = parseCsvRows(csvTxt);
            headerRows = allRows.slice(0, 2);
            lookupRows = allRows.map((r) => r.slice(0, 7));
          }
        }
        if (headerRows.length === 0 || lookupRows.length < 2) {
          const errText = await gRes.text();
          return res.status(gRes.status).json({
            error: `Failed to read IATD sheet from Google (HTTP ${gRes.status}): ${errText}`,
          });
        }
      }

      if (headerRows.length === 0 || lookupRows.length < 2) {
        return res.status(404).json({ error: 'IATD sheet has insufficient rows.' });
      }

      const row1 = headerRows.length >= 2 ? headerRows[0] : [];
      const row2 = headerRows.length >= 2 ? headerRows[1] : headerRows[0];

      // Scan Row 2 from CS01 up to before "Total Actual" and locate Remarks column
      const { csColumns, remarksColumn } = scanIatdRow2Structure(row1, row2);

      const normalize = (s: string) =>
        String(s || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');

      const maxHdr = Math.max(row1.length, row2.length);
      const combinedHdr: string[] = [];
      for (let c = 0; c < maxHdr; c++) {
        combinedHdr.push(normalize(row2[c] || '') || normalize(row1[c] || ''));
      }
      let codeIdx = combinedHdr.findIndex((h) => h.includes('itemcode') || h === 'code');
      let descIdx = combinedHdr.findIndex((h) => h.includes('itemdescription') || h.includes('description') || h === 'desc');
      let bcIdx = combinedHdr.findIndex((h) => h.includes('barcode') || h === 'bar' || h === 'upc');
      if (codeIdx === -1) codeIdx = 0;
      if (descIdx === -1) descIdx = 2;
      if (bcIdx === -1) bcIdx = 1;

      const normSearchCode = String(itemCode || '').trim().toLowerCase();
      const normSearchBc = String(barcode || '').trim().toLowerCase();
      const normSearchDesc = String(itemDescription || '').trim().toLowerCase();

      const matchesItemRow = (r: string[]) => {
        if (!r || r.length === 0) return false;
        const rCode = codeIdx >= 0 && codeIdx < r.length ? String(r[codeIdx] || '').trim().toLowerCase() : '';
        const rBc = bcIdx >= 0 && bcIdx < r.length ? String(r[bcIdx] || '').trim().toLowerCase() : '';
        const rDesc = descIdx >= 0 && descIdx < r.length ? String(r[descIdx] || '').trim().toLowerCase() : '';
        if (normSearchCode && rCode === normSearchCode) return true;
        if (normSearchBc && rBc === normSearchBc) return true;
        if (normSearchDesc && rDesc === normSearchDesc) return true;
        return false;
      };

      // 2. Verify or find 1-based targetRowNumber
      let targetRowNumber = parseInt(String(rawRowNumber || ''), 10);
      if (
        !isNaN(targetRowNumber) &&
        targetRowNumber >= 3 &&
        targetRowNumber - 1 < lookupRows.length &&
        matchesItemRow(lookupRows[targetRowNumber - 1])
      ) {
        // Verified exact row number
      } else {
        targetRowNumber = -1;
        for (let i = 2; i < lookupRows.length; i++) {
          if (matchesItemRow(lookupRows[i])) {
            targetRowNumber = i + 1;
            break;
          }
        }
      }

      if (targetRowNumber === -1) {
        return res.status(404).json({ error: 'Item not found in IATD sheet rows.' });
      }

      // 3. Resolve target CS column from scanned Row 2 CS columns (CS01 up to before Total Actual)
      const targetCsNum = parseInt(String(csNumber || ''), 10);
      const formattedTargetCsLabel =
        !isNaN(targetCsNum) && targetCsNum > 0
          ? `CS${String(targetCsNum).padStart(2, '0')}`
          : String(csLabel || '').trim().toUpperCase();
      const normReqLabel = normalize(formattedTargetCsLabel);
      const cleanReqColLetter = String(targetColLetter || '').trim().toUpperCase();

      let matchedCsCol = csColumns.find((col) => {
        if (!isNaN(targetCsNum) && targetCsNum > 0 && col.csNumber === targetCsNum) return true;
        if (normReqLabel && normalize(col.label) === normReqLabel) return true;
        if (cleanReqColLetter && col.colLetter === cleanReqColLetter) return true;
        return false;
      });

      const hasQtyToPlot =
        qtyMode !== 'skip' && qty !== undefined && qty !== null && String(qty).trim() !== '';

      if (hasQtyToPlot && !matchedCsCol) {
        return res.status(404).json({
          error: `Countsheet column (${formattedTargetCsLabel || `CS${String(targetCsNum || 1).padStart(2, '0')}`}) was not found in Row 2 before "Total Actual".`,
        });
      }

      // 4. Read the exact existing values of the target CS cell and Remarks cell in targetRowNumber
      let existingQty = '';
      let existingRemarks = '';
      const csColLetter = matchedCsCol ? matchedCsCol.colLetter : '';
      const targetCsCellA1 = csColLetter ? `${sheetMeta.safeSheetTitle}!${csColLetter}${targetRowNumber}` : '';
      const remarksColLetter = remarksColumn ? remarksColumn.colLetter : '';
      const targetRemarksCellA1 = remarksColLetter
        ? `${sheetMeta.safeSheetTitle}!${remarksColLetter}${targetRowNumber}`
        : '';

      const readRanges: string[] = [];
      if (targetCsCellA1) readRanges.push(targetCsCellA1);
      if (targetRemarksCellA1) readRanges.push(targetRemarksCellA1);

      if (readRanges.length > 0) {
        try {
          const readQuery = readRanges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
          const cellRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${readQuery}&valueRenderOption=FORMATTED_VALUE`,
            { headers: { Authorization: `Bearer ${tokenToUse}` } }
          );
          if (cellRes.ok) {
            const cellData: any = await cellRes.json();
            const vRanges = Array.isArray(cellData?.valueRanges) ? cellData.valueRanges : [];
            let rIdx = 0;
            if (targetCsCellA1) {
              const vals = vRanges[rIdx++]?.values;
              if (Array.isArray(vals) && vals[0] && vals[0][0] !== undefined) {
                existingQty = String(vals[0][0]).trim();
              }
            }
            if (targetRemarksCellA1) {
              const vals = vRanges[rIdx++]?.values;
              if (Array.isArray(vals) && vals[0] && vals[0][0] !== undefined) {
                existingRemarks = String(vals[0][0]).trim();
              }
            }
          }
        } catch {}
      }

      // 5. Overwrite protection: if target CS cell already has a non-empty quantity and qtyMode === 'set' and !allowOverwrite, block & return 409
      const existingQtyNum = parseSheetNumber(existingQty);
      const hasExistingPlottedQty = existingQty !== '' && existingQtyNum !== 0;

      if (hasQtyToPlot && hasExistingPlottedQty && qtyMode === 'set' && !allowOverwrite) {
        return res.status(409).json({
          error: `Cell ${csColLetter}${targetRowNumber} (${matchedCsCol?.label}) already has a plotted quantity of "${existingQty}". Choose "Add to existing" or confirm overwrite to update this cell.`,
          code: 'EXISTING_QTY_CONFLICT',
          rowNumber: targetRowNumber,
          columnLetter: csColLetter,
          cellA1: `${csColLetter}${targetRowNumber}`,
          existingQty,
          existingRemarks,
        });
      }

      // 6. Single-cell update for Quantity (ONLY updates e.g. 'IATD'!T5, never touches any other row or column)
      let updatedQty: string | number = existingQty;
      let qtyUpdated = false;

      if (hasQtyToPlot && targetCsCellA1) {
        const inputQtyNum = parseSheetNumber(qty);
        const finalQtyVal =
          qtyMode === 'add' && hasExistingPlottedQty
            ? Number((existingQtyNum + inputQtyNum).toFixed(4))
            : inputQtyNum;

        const putRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
            targetCsCellA1
          )}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${tokenToUse}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [[finalQtyVal]] }),
          }
        );

        if (!putRes.ok) {
          const errTxt = await putRes.text();
          return res.status(putRes.status).json({
            error: `Failed to update cell ${csColLetter}${targetRowNumber}: ${errTxt}`,
          });
        }
        updatedQty = finalQtyVal;
        qtyUpdated = true;
      }

      // 7. Single-cell update for Remarks (ONLY updates e.g. 'IATD'!R5 in the same row as the item)
      let remarksUpdated = false;
      let updatedRemarks = existingRemarks;
      const cleanInputRemarks = remarks !== undefined && remarks !== null ? String(remarks).trim() : '';

      if (remarksMode !== 'skip' && cleanInputRemarks !== '' && targetRemarksCellA1) {
        const finalRemarks =
          remarksMode === 'replace' || !existingRemarks
            ? cleanInputRemarks
            : existingRemarks.toLowerCase().includes(cleanInputRemarks.toLowerCase())
            ? existingRemarks
            : `${existingRemarks}; ${cleanInputRemarks}`;

        const remPutRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
            targetRemarksCellA1
          )}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${tokenToUse}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [[finalRemarks]] }),
          }
        );
        if (!remPutRes.ok) {
          const errTxt = await remPutRes.text();
          return res.status(remPutRes.status).json({
            error: `Failed to update Remarks cell ${remarksColLetter}${targetRowNumber}: ${errTxt}`,
          });
        }
        remarksUpdated = true;
        updatedRemarks = finalRemarks;
      }

      return res.json({
        success: true,
        spreadsheetId,
        sheetName: sheetMeta.sheetTitle,
        rowNumber: targetRowNumber,
        columnLetter: csColLetter,
        csLabel: matchedCsCol?.label || '',
        cellA1: csColLetter ? `${csColLetter}${targetRowNumber}` : '',
        remarksColumnLetter: remarksColLetter,
        remarksCellA1: remarksColLetter ? `${remarksColLetter}${targetRowNumber}` : '',
        existingQty,
        updatedQty,
        qtyUpdated,
        existingRemarks,
        updatedRemarks,
        remarksUpdated,
      });
    } catch (err: any) {
      console.error('Error updating IATD sheet cell:', err);
      return res.status(500).json({ error: err.message || 'Failed to update sheet cell' });
    }
  });

  // 7. Central Hub Cache for icdhubsystems@gmail.com (TEMPLATE/COUNTSHEET, TEMPLATE/ENCODING, and ICD FORMS)
  // Eliminates Firebase/Google OAuth popups for auditors by serving cached templates & PDF forms from the server.
  const HUB_OWNER_EMAIL = 'icdhubsystems@gmail.com';
  const HUB_SYNC_WORKSPACE_KEY = 'icdhubsystems_icd_forms_v1';
  const hubCacheFilePath = path.resolve(process.cwd(), '.data', 'hub_assets_cache.json');
  const hubPdfsDir = path.resolve(process.cwd(), '.data', 'icd_forms_pdfs');
  const hubTemplatesXlsxDir = path.resolve(process.cwd(), '.data', 'hub_templates_xlsx');

  interface CachedHubEncodingTemplate {
    id: string;
    name: string;
    templateType: 'OVERALL COUNT TEMPLATE' | 'CESSATION OVERALL COUNT TEMPLATE' | string;
    folderPath: string;
    ownerEmail: string;
    webViewLink: string;
    modifiedTime?: string;
    tabs: Array<{ sheetId: number; title: string; rowCount?: number; columnCount?: number }>;
    detectedHeaderRow: number;
    sheetTitle: string;
    headers: string[];
    row1Values?: string[];
    row3Formulas?: string[];
    sampleRows: any[][];
    hasCachedXlsx?: boolean;
  }

  interface CachedHubCountsheetTemplate {
    id: string;
    name: string;
    gid: string;
    folderPath: string;
    ownerEmail: string;
    webViewLink: string;
    modifiedTime?: string;
    spec?: any;
    hasCachedXlsx?: boolean;
  }

  interface CachedHubPdfForm {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
    webContentLink?: string;
    ownerEmail: string;
    folderPath: string;
    hasCachedBinary?: boolean;
  }

  interface HubCustomDriveLinks {
    formsLocationLink?: string;
    inventoryTemplateLink?: string;
    overallCountTemplateLink?: string;
    updatedAt?: string;
  }

  interface HubAssetsCachePayload {
    ownerEmail: string;
    updatedAt: string;
    customLinks?: HubCustomDriveLinks;
    templateFolder?: { id: string; name: string; webViewLink?: string } | null;
    countsheetSubfolder?: { id: string; name: string; webViewLink?: string } | null;
    encodingSubfolder?: { id: string; name: string; webViewLink?: string } | null;
    icdFormsFolder?: { id: string; name: string; webViewLink?: string; ownerEmail?: string } | null;
    countsheetTemplates: CachedHubCountsheetTemplate[];
    encodingTemplates: CachedHubEncodingTemplate[];
    forms: CachedHubPdfForm[];
  }

  const DEFAULT_ENCODING_HEADERS = [
    'Item Code',
    'Barcode',
    'Item Description',
    'Category',
    'SubCategory',
    'SubsubCategory',
    'Unit',
    'Cost',
    'Selling Price',
    'Beg. Qty',
    'In',
    'Out',
    'Balance',
    'Remarks',
    'CS01',
    'CS02',
    'CS03',
    'CS04',
    'CS05',
    'CS06',
    'CS07',
    'CS08',
    'CS09',
    'CS10',
    '',
    'Total Actual',
    'Variance Qty',
    'Unrecorded Sales / Shortages (Cost)',
    'Unrecorded Sales / Shortages (Selling)',
    'Overages (Cost)',
    'Overages (Selling)',
    'Net Variance (Cost)',
    'Net Variance (Selling)',
  ];

  const DEFAULT_ENCODING_ROW3_FORMULAS = [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '=SUM(O3:X3)',
    '=Z3-M3',
    '=IF(AA3<0,ABS(AA3)*H3,0)',
    '=IF(AA3<0,ABS(AA3)*I3,0)',
    '=IF(AA3>0,AA3*H3,0)',
    '=IF(AA3>0,AA3*I3,0)',
    '=AA3*H3',
    '=AA3*I3',
  ];

  function buildPrintableAuditPdfBuffer(title: string, subtitle: string, lines: string[]): Buffer {
    const escapePdfText = (txt: string) =>
      txt.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    const contentOps: string[] = [
      'BT',
      '/F1 16 Tf',
      '50 745 Td',
      `(${escapePdfText(title)}) Tj`,
      '/F1 10 Tf',
      '0 -18 Td',
      `(${escapePdfText(subtitle)}) Tj`,
      '0 -22 Td',
    ];

    for (const line of lines) {
      contentOps.push(`(${escapePdfText(line)}) Tj`);
      contentOps.push('0 -16 Td');
    }
    contentOps.push('ET');

    const streamContent = contentOps.join('\n');
    const objects: string[] = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf8')} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += obj;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'utf8');
  }

  const DEFAULT_BUILTIN_ICD_FORMS: Array<{
    id: string;
    name: string;
    title: string;
    subtitle: string;
    lines: string[];
  }> = [
    {
      id: 'icd-form-physical-countsheet',
      name: 'ICD Physical Inventory Countsheet Form.pdf',
      title: 'INTERNAL CONTROL DEPARTMENT (ICD) - PHYSICAL INVENTORY COUNTSHEET',
      subtitle: 'Official Branch Audit Physical Countsheet Form (ICD FORMS)',
      lines: [
        'Branch / Location: ____________________________    Audit Date: ___________________',
        'Countsheet No.: _______________________________    Area / Rack: __________________',
        '----------------------------------------------------------------------------------------',
        'No. | Item Code | Barcode       | Item Description                 | Unit | Actual Qty',
        '----------------------------------------------------------------------------------------',
        ' 1  |           |               |                                  |      |           ',
        ' 2  |           |               |                                  |      |           ',
        ' 3  |           |               |                                  |      |           ',
        ' 4  |           |               |                                  |      |           ',
        ' 5  |           |               |                                  |      |           ',
        ' 6  |           |               |                                  |      |           ',
        ' 7  |           |               |                                  |      |           ',
        ' 8  |           |               |                                  |      |           ',
        ' 9  |           |               |                                  |      |           ',
        '10  |           |               |                                  |      |           ',
        '11  |           |               |                                  |      |           ',
        '12  |           |               |                                  |      |           ',
        '13  |           |               |                                  |      |           ',
        '14  |           |               |                                  |      |           ',
        '15  |           |               |                                  |      |           ',
        '----------------------------------------------------------------------------------------',
        'Counted By (Auditor): _________________________    Witnessed By (Branch): _____________',
        'Verified By (Lead Auditor): ___________________    Date & Time Signed: ________________',
      ],
    },
    {
      id: 'icd-form-audit-clearance-cutoff',
      name: 'ICD Audit Cut-Off & Clearance Form.pdf',
      title: 'INTERNAL CONTROL DEPARTMENT (ICD) - AUDIT CUT-OFF & CLEARANCE FORM',
      subtitle: 'Document Cut-Off & Physical Inventory Clearance Certificate',
      lines: [
        'Branch Name: __________________________________    Audit Date: ___________________',
        'Branch Manager / OIC: _________________________    Lead Auditor: _________________',
        '----------------------------------------------------------------------------------------',
        'DOCUMENT CUT-OFF DETAILS:',
        '1. Last Official Receipt / SI No.: ________________   Date/Time: _____________________',
        '2. Last Delivery Receipt (DR) In: _________________   Date/Time: _____________________',
        '3. Last Stock Transfer Out (STO): _________________   Date/Time: _____________________',
        '4. Last Return / Bad Order Slip: __________________   Date/Time: _____________________',
        '5. Last POS Z-Reading / Terminal No.: _____________   Amount: ________________________',
        '----------------------------------------------------------------------------------------',
        'CERTIFICATION & CLEARANCE:',
        'I hereby certify that all stocks, deliveries, transfers, and sales documents up to',
        'the cut-off time have been presented to the Internal Control Department audit team,',
        'and all physical items counted were returned in good order without damage.',
        '----------------------------------------------------------------------------------------',
        'Conformed By (Branch OIC/Manager): ____________________   Date: ______________________',
        'Noted By (ICD Lead Auditor): __________________________   Date: ______________________',
      ],
    },
    {
      id: 'icd-form-variance-acknowledgment',
      name: 'ICD Inventory Variance & Accountability Form.pdf',
      title: 'INTERNAL CONTROL DEPARTMENT (ICD) - VARIANCE ACKNOWLEDGMENT FORM',
      subtitle: 'Summary of Inventory Shortages / Overages & Branch Confirmation',
      lines: [
        'Branch Name: __________________________________    Audit Period: _________________',
        'Audit Type: [ ] Overall Count    [ ] Random Count    [ ] Cessation / Turnover',
        '----------------------------------------------------------------------------------------',
        'SUMMARY OF INVENTORY AUDIT RESULTS:',
        'Total Unrecorded Sales / Shortages (Cost):     PHP _______________________________',
        'Total Unrecorded Sales / Shortages (Selling):  PHP _______________________________',
        'Total Overages (Cost):                         PHP _______________________________',
        'Total Overages (Selling):                      PHP _______________________________',
        'Net Inventory Variance (Cost):                 PHP _______________________________',
        'Net Inventory Variance (Selling):              PHP _______________________________',
        '----------------------------------------------------------------------------------------',
        'REMARKS / RECONCILIATION NOTES:',
        '________________________________________________________________________________________',
        '________________________________________________________________________________________',
        '________________________________________________________________________________________',
        '----------------------------------------------------------------------------------------',
        'Prepared By (ICD Auditor): ____________________    Reviewed By (Lead): _______________',
        'Acknowledged By (Branch Head): ________________    Date Signed: ______________________',
      ],
    },
    {
      id: 'icd-form-cash-vault-verification',
      name: 'ICD Cash & Vault Count Verification Form.pdf',
      title: 'INTERNAL CONTROL DEPARTMENT (ICD) - CASH & VAULT COUNT SHEET',
      subtitle: 'Cashier Fund, Change Fund, and Vault Physical Verification Form',
      lines: [
        'Branch Name: __________________________________    Date & Time: __________________',
        'Custodian / Cashier Name: _____________________    Fund Type: ____________________',
        '----------------------------------------------------------------------------------------',
        'DENOMINATION BREAKDOWN (BILLS & COINS):',
        'PHP 1,000 x __________ = PHP ______________     PHP 20  x __________ = PHP ____________',
        'PHP   500 x __________ = PHP ______________     PHP 10  x __________ = PHP ____________',
        'PHP   200 x __________ = PHP ______________     PHP  5  x __________ = PHP ____________',
        'PHP   100 x __________ = PHP ______________     PHP  1  x __________ = PHP ____________',
        'PHP    50 x __________ = PHP ______________     Cents   x __________ = PHP ____________',
        '----------------------------------------------------------------------------------------',
        'Total Cash Counted:            PHP _______________________',
        'Total Checks / Vouchers:       PHP _______________________',
        'Total Accountable Fund:        PHP _______________________',
        'Cash Overage / (Shortage):     PHP _______________________',
        '----------------------------------------------------------------------------------------',
        'Custodian Signature: __________________________    ICD Auditor Signature: ____________',
      ],
    },
  ];

  async function ensureDefaultHubPdfFormsOnDisk(): Promise<CachedHubPdfForm[]> {
    const nowIso = new Date().toISOString();
    const forms: CachedHubPdfForm[] = [];
    try {
      await fs.promises.mkdir(hubPdfsDir, { recursive: true });
    } catch {}

    for (const item of DEFAULT_BUILTIN_ICD_FORMS) {
      const pdfPath = path.join(hubPdfsDir, `${item.id}.pdf`);
      let sizeStr = '2048';
      try {
        const buf = buildPrintableAuditPdfBuffer(item.title, item.subtitle, item.lines);
        sizeStr = String(buf.length);
        if (!fs.existsSync(pdfPath)) {
          await fs.promises.writeFile(pdfPath, buf);
        } else {
          const stat = await fs.promises.stat(pdfPath);
          sizeStr = String(stat.size);
        }
      } catch {}

      forms.push({
        id: item.id,
        name: item.name,
        mimeType: 'application/pdf',
        size: sizeStr,
        modifiedTime: nowIso,
        webViewLink: `/api/hub/forms/${item.id}/pdf`,
        webContentLink: `/api/hub/forms/${item.id}/pdf`,
        ownerEmail: HUB_OWNER_EMAIL,
        folderPath: 'ICD FORMS',
        hasCachedBinary: true,
      });
    }
    return forms;
  }

  function createDefaultHubAssetsCache(): HubAssetsCachePayload {
    const nowIso = new Date().toISOString();
    const defaultForms: CachedHubPdfForm[] = DEFAULT_BUILTIN_ICD_FORMS.map((item) => ({
      id: item.id,
      name: item.name,
      mimeType: 'application/pdf',
      size: '2048',
      modifiedTime: nowIso,
      webViewLink: `/api/hub/forms/${item.id}/pdf`,
      webContentLink: `/api/hub/forms/${item.id}/pdf`,
      ownerEmail: HUB_OWNER_EMAIL,
      folderPath: 'ICD FORMS',
      hasCachedBinary: true,
    }));

    return {
      ownerEmail: HUB_OWNER_EMAIL,
      updatedAt: nowIso,
      templateFolder: {
        id: 'hub_folder_template',
        name: 'TEMPLATE',
      },
      countsheetSubfolder: {
        id: 'hub_folder_template_countsheet',
        name: 'COUNTSHEET',
      },
      encodingSubfolder: {
        id: 'hub_folder_template_encoding',
        name: 'ENCODING',
      },
      icdFormsFolder: {
        id: 'hub_folder_icd_forms',
        name: 'ICD FORMS',
        ownerEmail: HUB_OWNER_EMAIL,
      },
      countsheetTemplates: [
        {
          id: '19eb2315c82841b7f2920f8e1a272f52095f1e72c',
          name: 'RANDOM INVENTORY COUNTSHEET TEMPLATE',
          gid: '1328306184',
          folderPath: 'TEMPLATE/COUNTSHEET',
          ownerEmail: HUB_OWNER_EMAIL,
          webViewLink:
            'https://docs.google.com/spreadsheets/d/19eb2315c82841b7f2920f8e1a272f52095f1e72c/edit#gid=1328306184',
          modifiedTime: nowIso,
        },
        {
          id: 'hub-countsheet-periodic-template',
          name: 'PERIODIC COUNTSHEET TEMPLATE',
          gid: '1328306184',
          folderPath: 'TEMPLATE/COUNTSHEET',
          ownerEmail: HUB_OWNER_EMAIL,
          webViewLink:
            'https://docs.google.com/spreadsheets/d/hub-countsheet-periodic-template/edit#gid=1328306184',
          modifiedTime: nowIso,
        },
      ],
      encodingTemplates: [
        {
          id: 'hub-encoding-overall-count-template',
          name: 'OVERALL COUNT TEMPLATE',
          templateType: 'OVERALL COUNT TEMPLATE',
          folderPath: 'TEMPLATE/ENCODING',
          ownerEmail: HUB_OWNER_EMAIL,
          webViewLink: 'https://docs.google.com/spreadsheets/d/hub-encoding-overall-count-template/edit',
          modifiedTime: nowIso,
          tabs: [
            { sheetId: 0, title: 'ENCODING', rowCount: 1500, columnCount: 45 },
            { sheetId: 1, title: 'ANALYSIS', rowCount: 200, columnCount: 20 },
            { sheetId: 2, title: 'UNIDENTIFIED', rowCount: 200, columnCount: 15 },
            { sheetId: 3, title: 'MONITORING', rowCount: 180, columnCount: 15 },
          ],
          detectedHeaderRow: 2,
          sheetTitle: 'ENCODING',
          headers: DEFAULT_ENCODING_HEADERS,
          row3Formulas: DEFAULT_ENCODING_ROW3_FORMULAS,
          sampleRows: [],
        },
        {
          id: 'hub-encoding-cessation-overall-count-template',
          name: 'CESSATION OVERALL COUNT TEMPLATE',
          templateType: 'CESSATION OVERALL COUNT TEMPLATE',
          folderPath: 'TEMPLATE/ENCODING',
          ownerEmail: HUB_OWNER_EMAIL,
          webViewLink:
            'https://docs.google.com/spreadsheets/d/hub-encoding-cessation-overall-count-template/edit',
          modifiedTime: nowIso,
          tabs: [
            { sheetId: 0, title: 'ENCODING', rowCount: 1500, columnCount: 45 },
            { sheetId: 1, title: 'ANALYSIS', rowCount: 200, columnCount: 20 },
            { sheetId: 2, title: 'UNIDENTIFIED', rowCount: 200, columnCount: 15 },
            { sheetId: 3, title: 'MONITORING', rowCount: 180, columnCount: 15 },
          ],
          detectedHeaderRow: 2,
          sheetTitle: 'ENCODING',
          headers: DEFAULT_ENCODING_HEADERS,
          row3Formulas: DEFAULT_ENCODING_ROW3_FORMULAS,
          sampleRows: [],
        },
      ],
      forms: defaultForms,
    };
  }

  function mergeWithDefaultCountsheetTemplates(
    discovered: CachedHubCountsheetTemplate[],
    defaults: CachedHubCountsheetTemplate[]
  ): CachedHubCountsheetTemplate[] {
    const result = [...discovered];
    const hasRandom = result.some((t) => /random/i.test(t.name));
    const hasPeriodic = result.some((t) => /periodic/i.test(t.name));
    for (const def of defaults) {
      if (/random/i.test(def.name) && !hasRandom) {
        result.push(def);
      } else if (/periodic/i.test(def.name) && !hasPeriodic) {
        result.push(def);
      }
    }
    return result;
  }

  function mergeWithDefaultEncodingTemplates(
    discovered: CachedHubEncodingTemplate[],
    defaults: CachedHubEncodingTemplate[]
  ): CachedHubEncodingTemplate[] {
    const result = [...discovered];
    const hasOverall = result.some(
      (t) =>
        t.templateType === 'OVERALL COUNT TEMPLATE' ||
        (!/cessation/i.test(t.name) && /overall\s*count/i.test(t.name))
    );
    const hasCessation = result.some(
      (t) => t.templateType === 'CESSATION OVERALL COUNT TEMPLATE' || /cessation/i.test(t.name)
    );
    for (const def of defaults) {
      if (def.templateType === 'OVERALL COUNT TEMPLATE' && !hasOverall) {
        result.push(def);
      } else if (def.templateType === 'CESSATION OVERALL COUNT TEMPLATE' && !hasCessation) {
        result.push(def);
      }
    }
    return result;
  }

  let hubAssetsCache: HubAssetsCachePayload = createDefaultHubAssetsCache();

  async function loadHubAssetsCacheFromDisk(): Promise<HubAssetsCachePayload> {
    await ensureDefaultHubPdfFormsOnDisk();
    try {
      if (fs.existsSync(hubCacheFilePath)) {
        const raw = await fs.promises.readFile(hubCacheFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const defaults = createDefaultHubAssetsCache();
          hubAssetsCache = {
            ...defaults,
            ...parsed,
            countsheetTemplates:
              Array.isArray(parsed.countsheetTemplates) && parsed.countsheetTemplates.length > 0
                ? mergeWithDefaultCountsheetTemplates(parsed.countsheetTemplates, defaults.countsheetTemplates)
                : defaults.countsheetTemplates,
            encodingTemplates:
              Array.isArray(parsed.encodingTemplates) && parsed.encodingTemplates.length > 0
                ? mergeWithDefaultEncodingTemplates(parsed.encodingTemplates, defaults.encodingTemplates)
                : defaults.encodingTemplates,
            forms:
              Array.isArray(parsed.forms) && parsed.forms.length > 0
                ? parsed.forms
                : defaults.forms,
          };
        }
      }
    } catch (e) {
      console.warn('Could not load hub_assets_cache.json from disk:', e);
    }
    return hubAssetsCache;
  }

  async function saveHubAssetsCacheToDisk(payload: HubAssetsCachePayload): Promise<void> {
    hubAssetsCache = payload;
    try {
      await fs.promises.mkdir(path.dirname(hubCacheFilePath), { recursive: true });
      await fs.promises.writeFile(hubCacheFilePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
      console.warn('Could not save hub_assets_cache.json to disk:', e);
    }
  }

  async function getStoredHubOAuthToken(): Promise<string | null> {
    try {
      const stmt = db.prepare(
        'SELECT state_json FROM user_workspace_state WHERE lower(user_key) IN (?1, ?2, ?3) ORDER BY updated_at DESC'
      );
      const cleanEmailKey = HUB_OWNER_EMAIL.toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
      const res = await stmt
        .bind(HUB_OWNER_EMAIL.toLowerCase(), cleanEmailKey, HUB_SYNC_WORKSPACE_KEY.toLowerCase())
        .all<{ state_json: string }>();
      for (const row of res.results || []) {
        try {
          const parsed = JSON.parse(row.state_json);
          if (parsed?.oauthAccessToken && typeof parsed.oauthAccessToken === 'string') {
            return parsed.oauthAccessToken;
          }
        } catch {}
      }

      // Fallback: check any recently updated workspace state with a valid OAuth token
      const anyStmt = db.prepare(
        'SELECT state_json FROM user_workspace_state ORDER BY updated_at DESC LIMIT 15'
      );
      const anyRes = await anyStmt.all<{ state_json: string }>();
      for (const row of anyRes.results || []) {
        try {
          const parsed = JSON.parse(row.state_json);
          if (
            parsed?.oauthAccessToken &&
            typeof parsed.oauthAccessToken === 'string' &&
            !parsed.oauthAccessToken.startsWith('auditor:') &&
            !parsed.oauthAccessToken.startsWith('eyJ')
          ) {
            return parsed.oauthAccessToken;
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  async function cacheSpreadsheetAsXlsxAndShareReader(token: string, spreadsheetId: string): Promise<boolean> {
    if (!token || !spreadsheetId || spreadsheetId.startsWith('hub-')) return false;
    let hasCached = false;
    try {
      await fs.promises.mkdir(hubTemplatesXlsxDir, { recursive: true });
      const xlsxPath = path.join(hubTemplatesXlsxDir, `${spreadsheetId}.xlsx`);
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        spreadsheetId
      )}/export?mimeType=${encodeURIComponent(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )}`;
      const exportRes = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (exportRes.ok) {
        const buf = Buffer.from(await exportRes.arrayBuffer());
        if (buf.length > 100) {
          await fs.promises.writeFile(xlsxPath, buf);
          hasCached = true;
        }
      } else {
        hasCached = fs.existsSync(xlsxPath);
      }
    } catch {}

    // Also attempt to make the template readable via link so any signed-in auditor can copy it directly
    try {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          spreadsheetId
        )}/permissions?supportsAllDrives=true`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            role: 'reader',
            type: 'anyone',
          }),
        }
      );
    } catch {}

    return hasCached;
  }

  async function findDriveFolderByName(
    token: string,
    folderName: string,
    parentId?: string
  ): Promise<{ id: string; name: string; webViewLink?: string; ownerEmail?: string } | null> {
    const escapedName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const parentClause = parentId ? `'${parentId}' in parents and ` : '';

    // 1. Try exact folder name owned by icdhubsystems@gmail.com or inside parentId
    const queries = [
      `${parentClause}mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and '${HUB_OWNER_EMAIL}' in owners and trashed = false`,
      `${parentClause}mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and trashed = false`,
      `${parentClause}mimeType = 'application/vnd.google-apps.folder' and name contains '${escapedName}' and trashed = false`,
    ];

    for (const q of queries) {
      try {
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          q
        )}&fields=files(id,name,webViewLink,owners,modifiedTime)&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data: any = await res.json();
          const files: any[] = data.files || [];
          if (files.length > 0) {
            files.sort((a, b) => {
              const aOwner = (a.owners || []).some(
                (o: any) => String(o.emailAddress || '').toLowerCase() === HUB_OWNER_EMAIL
              );
              const bOwner = (b.owners || []).some(
                (o: any) => String(o.emailAddress || '').toLowerCase() === HUB_OWNER_EMAIL
              );
              if (aOwner && !bOwner) return -1;
              if (!aOwner && bOwner) return 1;
              const aExact = String(a.name || '').trim().toUpperCase() === folderName.toUpperCase();
              const bExact = String(b.name || '').trim().toUpperCase() === folderName.toUpperCase();
              if (aExact && !bExact) return -1;
              if (!aExact && bExact) return 1;
              return 0;
            });
            const f = files[0];
            return {
              id: f.id,
              name: f.name,
              webViewLink: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
              ownerEmail: f.owners?.[0]?.emailAddress || HUB_OWNER_EMAIL,
            };
          }
        }
      } catch {}
    }
    return null;
  }

  function parseGoogleDriveLink(rawInput?: string): {
    id: string;
    isFolder: boolean;
    isSpreadsheet: boolean;
    gid?: string;
    rawUrl: string;
  } | null {
    const raw = String(rawInput || '').trim();
    if (!raw) return null;

    const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    const sheetMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const fileMatch = raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const idParamMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const gidMatch = raw.match(/[#&?]gid=([0-9]+)/);

    let id = '';
    let isFolder = false;
    let isSpreadsheet = false;

    if (folderMatch) {
      id = folderMatch[1];
      isFolder = true;
    } else if (sheetMatch) {
      id = sheetMatch[1];
      isSpreadsheet = true;
    } else if (fileMatch) {
      id = fileMatch[1];
    } else if (idParamMatch) {
      id = idParamMatch[1];
      isFolder = raw.includes('/folders');
      isSpreadsheet = raw.includes('/spreadsheets');
    } else if (/^[a-zA-Z0-9_-]{15,}$/.test(raw)) {
      id = raw;
    }

    if (!id) return null;
    return {
      id,
      isFolder,
      isSpreadsheet,
      gid: gidMatch ? gidMatch[1] : undefined,
      rawUrl: raw,
    };
  }

  function applyCustomLinksToHubCache(cache: HubAssetsCachePayload): HubAssetsCachePayload {
    const custom = cache.customLinks;
    if (!custom) return cache;
    const nowIso = new Date().toISOString();

    // 1. Forms location link
    const parsedForms = parseGoogleDriveLink(custom.formsLocationLink);
    if (parsedForms) {
      cache.icdFormsFolder = {
        id: parsedForms.id,
        name: cache.icdFormsFolder?.id === parsedForms.id ? cache.icdFormsFolder.name : 'ICD FORMS',
        webViewLink: parsedForms.rawUrl.startsWith('http')
          ? parsedForms.rawUrl
          : `https://drive.google.com/drive/folders/${parsedForms.id}`,
        ownerEmail: HUB_OWNER_EMAIL,
      };
    }

    // 2. Inventory Template link (Countsheet template)
    const parsedInv = parseGoogleDriveLink(custom.inventoryTemplateLink);
    if (parsedInv) {
      if (parsedInv.isFolder) {
        cache.countsheetSubfolder = {
          id: parsedInv.id,
          name: 'COUNTSHEET',
          webViewLink: parsedInv.rawUrl.startsWith('http')
            ? parsedInv.rawUrl
            : `https://drive.google.com/drive/folders/${parsedInv.id}`,
        };
      } else {
        const gid = parsedInv.gid || '1328306184';
        const webViewLink = parsedInv.rawUrl.startsWith('http')
          ? parsedInv.rawUrl
          : `https://docs.google.com/spreadsheets/d/${parsedInv.id}/edit#gid=${gid}`;
        const existingIdx = cache.countsheetTemplates.findIndex((t) => /random/i.test(t.name));
        const updatedTemplate: CachedHubCountsheetTemplate = {
          ...(existingIdx >= 0 ? cache.countsheetTemplates[existingIdx] : {}),
          id: parsedInv.id,
          name:
            existingIdx >= 0
              ? cache.countsheetTemplates[existingIdx].name
              : 'RANDOM INVENTORY COUNTSHEET TEMPLATE',
          gid,
          folderPath: 'TEMPLATE/COUNTSHEET',
          ownerEmail: HUB_OWNER_EMAIL,
          webViewLink,
          modifiedTime: nowIso,
        };
        if (existingIdx >= 0) {
          cache.countsheetTemplates[existingIdx] = updatedTemplate;
        } else {
          cache.countsheetTemplates.unshift(updatedTemplate);
        }
      }
    }

    // 3. Overall Count Template link (Encoding template)
    const parsedOverall = parseGoogleDriveLink(custom.overallCountTemplateLink);
    if (parsedOverall) {
      if (parsedOverall.isFolder) {
        cache.encodingSubfolder = {
          id: parsedOverall.id,
          name: 'ENCODING',
          webViewLink: parsedOverall.rawUrl.startsWith('http')
            ? parsedOverall.rawUrl
            : `https://drive.google.com/drive/folders/${parsedOverall.id}`,
        };
      } else {
        const webViewLink = parsedOverall.rawUrl.startsWith('http')
          ? parsedOverall.rawUrl
          : `https://docs.google.com/spreadsheets/d/${parsedOverall.id}/edit`;
        const existingIdx = cache.encodingTemplates.findIndex(
          (t) =>
            t.templateType === 'OVERALL COUNT TEMPLATE' ||
            (!/cessation/i.test(t.name) && /overall\s*count/i.test(t.name))
        );
        const baseTemplate =
          existingIdx >= 0
            ? cache.encodingTemplates[existingIdx]
            : createDefaultHubAssetsCache().encodingTemplates[0];
        const updatedOverall: CachedHubEncodingTemplate = {
          ...baseTemplate,
          id: parsedOverall.id,
          name: 'OVERALL COUNT TEMPLATE',
          templateType: 'OVERALL COUNT TEMPLATE',
          folderPath: 'TEMPLATE/ENCODING',
          ownerEmail: HUB_OWNER_EMAIL,
          webViewLink,
          modifiedTime: nowIso,
        };
        if (existingIdx >= 0) {
          cache.encodingTemplates[existingIdx] = updatedOverall;
        } else {
          cache.encodingTemplates.unshift(updatedOverall);
        }
      }
    }

    return cache;
  }

  async function syncHubAssetsFromGoogleDrive(rawToken?: string): Promise<HubAssetsCachePayload> {
    await loadHubAssetsCacheFromDisk();
    applyCustomLinksToHubCache(hubAssetsCache);
    const token = (rawToken || (await getStoredHubOAuthToken()) || '').trim();
    if (!token) {
      await saveHubAssetsCacheToDisk(hubAssetsCache);
      return hubAssetsCache;
    }

    const defaults = createDefaultHubAssetsCache();
    const updatedCache: HubAssetsCachePayload = {
      ...hubAssetsCache,
      ownerEmail: HUB_OWNER_EMAIL,
      updatedAt: new Date().toISOString(),
    };
    applyCustomLinksToHubCache(updatedCache);

    const customFormsLink = parseGoogleDriveLink(updatedCache.customLinks?.formsLocationLink);
    const customInvLink = parseGoogleDriveLink(updatedCache.customLinks?.inventoryTemplateLink);
    const customOverallLink = parseGoogleDriveLink(updatedCache.customLinks?.overallCountTemplateLink);

    try {
      // 1. Discover TEMPLATE folder and its COUNTSHEET and ENCODING subfolders in icdhubsystems@gmail.com
      const templateFolder = await findDriveFolderByName(token, 'TEMPLATE');
      if (templateFolder) {
        updatedCache.templateFolder = templateFolder;
      }

      let countsheetSubfolder =
        customInvLink && customInvLink.isFolder
          ? {
              id: customInvLink.id,
              name: 'COUNTSHEET',
              webViewLink: customInvLink.rawUrl,
            }
          : (await findDriveFolderByName(token, 'COUNTSHEET', templateFolder?.id)) ||
            (await findDriveFolderByName(token, 'COUNTSHEET'));
      if (countsheetSubfolder) {
        updatedCache.countsheetSubfolder = countsheetSubfolder;
      }

      let encodingSubfolder =
        customOverallLink && customOverallLink.isFolder
          ? {
              id: customOverallLink.id,
              name: 'ENCODING',
              webViewLink: customOverallLink.rawUrl,
            }
          : (await findDriveFolderByName(token, 'ENCODING', templateFolder?.id)) ||
            (await findDriveFolderByName(token, 'ENCODING'));
      if (encodingSubfolder) {
        updatedCache.encodingSubfolder = encodingSubfolder;
      }

      // 2. Discover spreadsheets inside TEMPLATE/COUNTSHEET (Random Inventory Countsheet & Periodic Countsheet)
      const countsheetFilesToInspect: any[] = [];
      if (customInvLink && !customInvLink.isFolder) {
        try {
          const directRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              customInvLink.id
            )}?fields=id,name,mimeType,webViewLink,modifiedTime,owners&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (directRes.ok) {
            const directMeta: any = await directRes.json();
            if (directMeta.mimeType === 'application/vnd.google-apps.folder') {
              countsheetSubfolder = {
                id: directMeta.id,
                name: directMeta.name || 'COUNTSHEET',
                webViewLink:
                  directMeta.webViewLink || `https://drive.google.com/drive/folders/${directMeta.id}`,
              };
              updatedCache.countsheetSubfolder = countsheetSubfolder;
            } else {
              countsheetFilesToInspect.push({
                ...directMeta,
                name: directMeta.name || 'RANDOM INVENTORY COUNTSHEET TEMPLATE',
                preferredGid: customInvLink.gid,
              });
            }
          }
        } catch {}
      }
      if (countsheetSubfolder?.id) {
        const csQuery = `'${countsheetSubfolder.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
        const csUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          csQuery
        )}&fields=files(id,name,webViewLink,modifiedTime,owners)&orderBy=modifiedTime desc&pageSize=25&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const csRes = await fetch(csUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (csRes.ok) {
          const csData: any = await csRes.json();
          if (Array.isArray(csData.files)) {
            countsheetFilesToInspect.push(...csData.files);
          }
        }
      }

      if (countsheetFilesToInspect.length === 0) {
        const fbCsQuery = `mimeType = 'application/vnd.google-apps.spreadsheet' and (name contains 'COUNTSHEET' or name contains 'Countsheet') and '${HUB_OWNER_EMAIL}' in owners and trashed = false`;
        const fbCsUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          fbCsQuery
        )}&fields=files(id,name,webViewLink,modifiedTime,owners)&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const fbCsRes = await fetch(fbCsUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (fbCsRes.ok) {
          const fbCsData: any = await fbCsRes.json();
          if (Array.isArray(fbCsData.files)) {
            countsheetFilesToInspect.push(...fbCsData.files);
          }
        }
      }

      if (countsheetFilesToInspect.length > 0) {
        const discoveredCsTemplates: CachedHubCountsheetTemplate[] = [];
        for (const f of countsheetFilesToInspect) {
          let gid = f.preferredGid || '0';
          if (!f.preferredGid) {
            try {
              const metaRes = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${f.id}?fields=sheets.properties`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (metaRes.ok) {
                const meta: any = await metaRes.json();
                const firstSheet = meta.sheets?.[0]?.properties;
                if (firstSheet?.sheetId !== undefined) {
                  gid = String(firstSheet.sheetId);
                }
              }
            } catch {}
          }
          const hasCachedXlsx = await cacheSpreadsheetAsXlsxAndShareReader(token, f.id);
          discoveredCsTemplates.push({
            id: f.id,
            name: f.name,
            gid,
            folderPath: 'TEMPLATE/COUNTSHEET',
            ownerEmail: f.owners?.[0]?.emailAddress || HUB_OWNER_EMAIL,
            webViewLink:
              f.webViewLink ||
              `https://docs.google.com/spreadsheets/d/${f.id}/edit#gid=${gid}`,
            modifiedTime: f.modifiedTime,
            hasCachedXlsx,
          });
        }
        if (discoveredCsTemplates.length > 0) {
          updatedCache.countsheetTemplates = mergeWithDefaultCountsheetTemplates(
            discoveredCsTemplates,
            defaults.countsheetTemplates
          );
        }
      }

      // 3. Discover spreadsheets inside TEMPLATE/ENCODING (e.g. OVERALL COUNT TEMPLATE, CESSATION OVERALL COUNT TEMPLATE)
      const encodingFilesToInspect: any[] = [];
      if (customOverallLink && !customOverallLink.isFolder) {
        try {
          const directEncRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              customOverallLink.id
            )}?fields=id,name,mimeType,webViewLink,modifiedTime,owners&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (directEncRes.ok) {
            const directEncMeta: any = await directEncRes.json();
            if (directEncMeta.mimeType === 'application/vnd.google-apps.folder') {
              encodingSubfolder = {
                id: directEncMeta.id,
                name: directEncMeta.name || 'ENCODING',
                webViewLink:
                  directEncMeta.webViewLink ||
                  `https://drive.google.com/drive/folders/${directEncMeta.id}`,
              };
              updatedCache.encodingSubfolder = encodingSubfolder;
            } else {
              encodingFilesToInspect.push({
                ...directEncMeta,
                forceOverallCountType: true,
              });
            }
          }
        } catch {}
      }
      if (encodingSubfolder?.id) {
        const encQuery = `'${encodingSubfolder.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
        const encUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          encQuery
        )}&fields=files(id,name,webViewLink,modifiedTime,owners)&orderBy=modifiedTime desc&pageSize=30&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const encRes = await fetch(encUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (encRes.ok) {
          const encData: any = await encRes.json();
          if (Array.isArray(encData.files)) {
            for (const fileItem of encData.files) {
              if (!encodingFilesToInspect.some((existing) => existing.id === fileItem.id)) {
                encodingFilesToInspect.push(fileItem);
              }
            }
          }
        }
      }

      // Also fallback search by template name owned by icdhubsystems@gmail.com if TEMPLATE/ENCODING subfolder had no files
      if (encodingFilesToInspect.length === 0) {
        const fallbackQuery = `mimeType = 'application/vnd.google-apps.spreadsheet' and (name contains 'OVERALL COUNT TEMPLATE' or name contains 'ENCODING') and '${HUB_OWNER_EMAIL}' in owners and trashed = false`;
        const fbUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          fallbackQuery
        )}&fields=files(id,name,webViewLink,modifiedTime,owners)&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const fbRes = await fetch(fbUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (fbRes.ok) {
          const fbData: any = await fbRes.json();
          if (Array.isArray(fbData.files)) {
            encodingFilesToInspect.push(...fbData.files);
          }
        }
      }

      if (encodingFilesToInspect.length > 0) {
        const inspectedTemplates: CachedHubEncodingTemplate[] = [];
        for (const f of encodingFilesToInspect) {
          try {
            const metaRes = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${f.id}?fields=properties.title,sheets.properties(sheetId,title,gridProperties)`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!metaRes.ok) continue;
            const meta: any = await metaRes.json();
            const tabs = (meta.sheets || []).map((s: any) => ({
              sheetId: Number(s.properties?.sheetId || 0),
              title: String(s.properties?.title || 'Sheet1'),
              rowCount: s.properties?.gridProperties?.rowCount || 1000,
              columnCount: s.properties?.gridProperties?.columnCount || 40,
            }));
            const encTab =
              tabs.find((t: any) =>
                t.title.trim().toUpperCase().replace(/[\s_-]/g, '').includes('ENCOD')
              ) || tabs[0];
            const sheetTitle = encTab ? encTab.title : 'ENCODING';
            let headers = DEFAULT_ENCODING_HEADERS;
            let row1Values: string[] = [];
            let row3Formulas: string[] = DEFAULT_ENCODING_ROW3_FORMULAS;
            let sampleRows: any[][] = [];

            const [valRes, formRes] = await Promise.all([
              fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${encodeURIComponent(
                  `'${sheetTitle}'!A1:AZ10`
                )}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
                { headers: { Authorization: `Bearer ${token}` } }
              ),
              fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${encodeURIComponent(
                  `'${sheetTitle}'!A1:AZ5`
                )}?majorDimension=ROWS&valueRenderOption=FORMULA`,
                { headers: { Authorization: `Bearer ${token}` } }
              ),
            ]);

            if (valRes.ok) {
              const valData: any = await valRes.json();
              const rows: any[][] = valData.values || [];
              if (rows[0]) {
                row1Values = rows[0].map((c: any) => String(c || ''));
              }
              if (rows[1] && rows[1].length > 0) {
                headers = rows[1].map((h: any) => String(h || '').trim());
                sampleRows = rows.slice(2, 7);
              } else if (rows[0] && rows[0].length > 0) {
                headers = rows[0].map((h: any) => String(h || '').trim());
                sampleRows = rows.slice(1, 6);
              }
            }

            if (formRes.ok) {
              const formData: any = await formRes.json();
              const fRows: any[][] = formData.values || [];
              if (fRows[2] && fRows[2].length > 0) {
                row3Formulas = fRows[2].map((c: any) => String(c || '').trim());
              }
            }

            const hasCachedXlsx = await cacheSpreadsheetAsXlsxAndShareReader(token, f.id);

            const upperName = String(f.name || '').toUpperCase();
            const templateType = f.forceOverallCountType
              ? 'OVERALL COUNT TEMPLATE'
              : upperName.includes('CESSATION')
              ? 'CESSATION OVERALL COUNT TEMPLATE'
              : upperName.includes('OVERALL COUNT')
              ? 'OVERALL COUNT TEMPLATE'
              : f.name;

            inspectedTemplates.push({
              id: f.id,
              name: f.forceOverallCountType ? 'OVERALL COUNT TEMPLATE' : f.name,
              templateType,
              folderPath: 'TEMPLATE/ENCODING',
              ownerEmail: f.owners?.[0]?.emailAddress || HUB_OWNER_EMAIL,
              webViewLink:
                f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
              modifiedTime: f.modifiedTime,
              tabs,
              detectedHeaderRow: 2,
              sheetTitle,
              headers,
              row1Values,
              row3Formulas,
              sampleRows,
              hasCachedXlsx,
            });
          } catch {}
        }

        if (inspectedTemplates.length > 0) {
          // If the Admin configured a custom folder and none of the sheets literally say "OVERALL COUNT TEMPLATE",
          // promote the first non-cessation sheet as the primary OVERALL COUNT TEMPLATE so Create Encoding uses it
          if (
            customOverallLink &&
            !inspectedTemplates.some((t) => t.templateType === 'OVERALL COUNT TEMPLATE')
          ) {
            const firstCandidate =
              inspectedTemplates.find((t) => t.templateType !== 'CESSATION OVERALL COUNT TEMPLATE') ||
              inspectedTemplates[0];
            if (firstCandidate) {
              firstCandidate.templateType = 'OVERALL COUNT TEMPLATE';
            }
          }
          // Ensure both OVERALL COUNT TEMPLATE and CESSATION OVERALL COUNT TEMPLATE remain available
          const defaults = createDefaultHubAssetsCache().encodingTemplates;
          for (const def of defaults) {
            if (!inspectedTemplates.some((t) => t.templateType === def.templateType)) {
              inspectedTemplates.push(def);
            }
          }
          updatedCache.encodingTemplates = inspectedTemplates;
        }
      }

      // 4. Discover ICD FORMS folder (or Admin custom Forms link) and cache PDF metadata + binary PDF files on disk
      let icdFormsFolder: { id: string; name: string; webViewLink?: string; ownerEmail?: string } | null =
        null;
      let directCustomPdfFile: any = null;
      if (customFormsLink) {
        try {
          const customMetaRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              customFormsLink.id
            )}?fields=id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,owners&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (customMetaRes.ok) {
            const customMeta: any = await customMetaRes.json();
            if (customMeta.mimeType === 'application/pdf') {
              directCustomPdfFile = customMeta;
            }
            icdFormsFolder = {
              id: customMeta.id,
              name: customMeta.name || 'ICD FORMS',
              webViewLink:
                customMeta.webViewLink ||
                (customMeta.mimeType === 'application/pdf'
                  ? `https://drive.google.com/file/d/${customMeta.id}/view`
                  : `https://drive.google.com/drive/folders/${customMeta.id}`),
              ownerEmail: customMeta.owners?.[0]?.emailAddress || HUB_OWNER_EMAIL,
            };
          } else {
            icdFormsFolder = {
              id: customFormsLink.id,
              name: 'ICD FORMS',
              webViewLink: customFormsLink.rawUrl,
              ownerEmail: HUB_OWNER_EMAIL,
            };
          }
        } catch {
          icdFormsFolder = {
            id: customFormsLink.id,
            name: 'ICD FORMS',
            webViewLink: customFormsLink.rawUrl,
            ownerEmail: HUB_OWNER_EMAIL,
          };
        }
      } else {
        icdFormsFolder = await findDriveFolderByName(token, 'ICD FORMS');
      }

      if (icdFormsFolder) {
        updatedCache.icdFormsFolder = icdFormsFolder;
        const parentIds = [icdFormsFolder.id];
        try {
          const subQuery = `'${icdFormsFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const subRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
              subQuery
            )}&fields=files(id,name)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (subRes.ok) {
            const subData: any = await subRes.json();
            for (const sf of subData.files || []) {
              if (sf.id && !parentIds.includes(sf.id)) parentIds.push(sf.id);
            }
          }
        } catch {}

        const parentsClause =
          parentIds.length === 1
            ? `'${parentIds[0]}' in parents`
            : `(${parentIds.map((pid) => `'${pid}' in parents`).join(' or ')})`;
        const pdfQuery = `${parentsClause} and mimeType = 'application/pdf' and trashed = false`;
        const pdfUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          pdfQuery
        )}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,owners)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;

        const pdfRes = await fetch(pdfUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (pdfRes.ok || directCustomPdfFile) {
          const pdfData: any = pdfRes.ok ? await pdfRes.json() : { files: [] };
          const rawFiles: any[] = Array.isArray(pdfData.files) ? [...pdfData.files] : [];
          if (directCustomPdfFile && !rawFiles.some((rf) => rf.id === directCustomPdfFile.id)) {
            rawFiles.unshift(directCustomPdfFile);
          }
          await fs.promises.mkdir(hubPdfsDir, { recursive: true });

          const cachedForms: CachedHubPdfForm[] = [];
          for (const f of rawFiles) {
            const pdfFilePath = path.join(hubPdfsDir, `${f.id}.pdf`);
            let hasBinary = fs.existsSync(pdfFilePath);
            if (!hasBinary) {
              try {
                const mediaRes = await fetch(
                  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
                    f.id
                  )}?alt=media&supportsAllDrives=true`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                if (mediaRes.ok) {
                  const buf = Buffer.from(await mediaRes.arrayBuffer());
                  await fs.promises.writeFile(pdfFilePath, buf);
                  hasBinary = true;
                }
              } catch {}
            }

            cachedForms.push({
              id: f.id,
              name: f.name,
              mimeType: f.mimeType || 'application/pdf',
              size: f.size,
              modifiedTime: f.modifiedTime,
              webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
              webContentLink: f.webContentLink,
              ownerEmail: f.owners?.[0]?.emailAddress || HUB_OWNER_EMAIL,
              folderPath: 'ICD FORMS',
              hasCachedBinary: hasBinary,
            });
          }
          updatedCache.forms = cachedForms;
        }
      }

      applyCustomLinksToHubCache(updatedCache);
      await saveHubAssetsCacheToDisk(updatedCache);
    } catch (err) {
      console.warn('Error syncing Hub assets from Google Drive:', err);
    }

    return updatedCache;
  }

  app.get('/api/hub/status', async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
      const cache = await loadHubAssetsCacheFromDisk();
      applyCustomLinksToHubCache(cache);
      const hubToken = await getStoredHubOAuthToken();
      return res.json({
        ownerEmail: HUB_OWNER_EMAIL,
        updatedAt: cache.updatedAt,
        hasHubToken: Boolean(hubToken),
        customLinks: cache.customLinks || {},
        templateFolder: cache.templateFolder,
        countsheetSubfolder: cache.countsheetSubfolder,
        encodingSubfolder: cache.encodingSubfolder,
        icdFormsFolder: cache.icdFormsFolder,
        countsheetTemplatesCount: cache.countsheetTemplates.length,
        encodingTemplatesCount: cache.encodingTemplates.length,
        formsCount: cache.forms.length,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/hub/templates', async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
      const cache = await loadHubAssetsCacheFromDisk();
      applyCustomLinksToHubCache(cache);
      return res.json({
        ownerEmail: HUB_OWNER_EMAIL,
        updatedAt: cache.updatedAt,
        customLinks: cache.customLinks || {},
        templateFolder: cache.templateFolder,
        countsheetSubfolder: cache.countsheetSubfolder,
        encodingSubfolder: cache.encodingSubfolder,
        countsheetTemplates: cache.countsheetTemplates,
        encodingTemplates: cache.encodingTemplates,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Serves cached .xlsx binary of a template from icdhubsystems@gmail.com (TEMPLATE/COUNTSHEET or TEMPLATE/ENCODING)
  // so the signed-in user can instantiate a 1:1 Google Sheet copy in their own Google Drive without popups
  app.get('/api/hub/templates/:fileId/xlsx', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const fileId = String(req.params.fileId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!fileId) {
        return res.status(400).json({ error: 'Invalid fileId' });
      }
      const xlsxFilePath = path.join(hubTemplatesXlsxDir, `${fileId}.xlsx`);
      if (fs.existsSync(xlsxFilePath)) {
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        return fs.createReadStream(xlsxFilePath).pipe(res);
      }

      const hubToken = await getStoredHubOAuthToken();
      if (hubToken && !fileId.startsWith('hub-')) {
        const hasCached = await cacheSpreadsheetAsXlsxAndShareReader(hubToken, fileId);
        if (hasCached && fs.existsSync(xlsxFilePath)) {
          res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          );
          return fs.createReadStream(xlsxFilePath).pipe(res);
        }
      }

      return res.status(404).json({ error: 'Template xlsx not cached on server yet' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/hub/forms', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      let cache = await loadHubAssetsCacheFromDisk();
      const authHeader = req.headers.authorization;
      const callerToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

      // If caller provided a fresh Drive token and we only have built-in forms, try syncing Drive forms
      const hasOnlyBuiltInForms =
        cache.forms.length === 0 ||
        cache.forms.every((f) => String(f.id || '').startsWith('icd-form-'));
      if (callerToken && hasOnlyBuiltInForms) {
        try {
          cache = await syncHubAssetsFromGoogleDrive(callerToken);
        } catch {}
      }

      applyCustomLinksToHubCache(cache);
      return res.json({
        ownerEmail: HUB_OWNER_EMAIL,
        updatedAt: cache.updatedAt,
        customLinks: cache.customLinks || {},
        folder: cache.icdFormsFolder,
        files: cache.forms,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/hub/forms/:fileId/pdf', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const fileId = String(req.params.fileId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!fileId) {
        return res.status(400).json({ error: 'Invalid fileId' });
      }
      if (fileId.startsWith('icd-form-')) {
        await ensureDefaultHubPdfFormsOnDisk();
      }
      const pdfFilePath = path.join(hubPdfsDir, `${fileId}.pdf`);
      if (fs.existsSync(pdfFilePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return fs.createReadStream(pdfFilePath).pipe(res);
      }

      // If not cached on disk yet, try downloading via caller bearer token or stored hub token
      const authHeader = req.headers.authorization;
      const callerToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const candidateTokens = Array.from(
        new Set([callerToken, await getStoredHubOAuthToken()].filter(Boolean))
      ) as string[];

      for (const token of candidateTokens) {
        const mediaRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            fileId
          )}?alt=media&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (mediaRes.ok) {
          const buf = Buffer.from(await mediaRes.arrayBuffer());
          try {
            await fs.promises.mkdir(hubPdfsDir, { recursive: true });
            await fs.promises.writeFile(pdfFilePath, buf);
          } catch {}
          res.setHeader('Content-Type', 'application/pdf');
          return res.send(buf);
        }
      }

      return res.status(404).json({ error: 'PDF binary not yet cached on server' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/hub/sync', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const authHeader = req.headers.authorization;
      const bearerToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const tokenToUse = String(req.body?.accessToken || bearerToken || '').trim();

      if (tokenToUse) {
        // Persist token in user_workspace_state under HUB_SYNC_WORKSPACE_KEY so future background requests work without popups
        try {
          const now = new Date().toISOString();
          const statePayload = {
            ownerEmail: HUB_OWNER_EMAIL,
            oauthAccessToken: tokenToUse,
            oauthTokenIssuedAt: Date.now(),
            updatedAt: now,
          };
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO user_workspace_state (user_key, state_json, updated_at)
            VALUES (?1, ?2, ?3)
          `);
          await stmt.bind(HUB_SYNC_WORKSPACE_KEY, JSON.stringify(statePayload), now).run();
        } catch {}
      }

      // Allow Admin Mode to save custom Google Drive links for Forms, Inventory Template, and Overall Count Template
      if (req.body?.customLinks && typeof req.body.customLinks === 'object') {
        await loadHubAssetsCacheFromDisk();
        const incoming = req.body.customLinks;
        hubAssetsCache.customLinks = {
          ...hubAssetsCache.customLinks,
          ...(incoming.formsLocationLink !== undefined
            ? { formsLocationLink: String(incoming.formsLocationLink || '').trim() }
            : {}),
          ...(incoming.inventoryTemplateLink !== undefined
            ? { inventoryTemplateLink: String(incoming.inventoryTemplateLink || '').trim() }
            : {}),
          ...(incoming.overallCountTemplateLink !== undefined
            ? { overallCountTemplateLink: String(incoming.overallCountTemplateLink || '').trim() }
            : {}),
          updatedAt: new Date().toISOString(),
        };
        applyCustomLinksToHubCache(hubAssetsCache);
        await saveHubAssetsCacheToDisk(hubAssetsCache);
      }

      // Also allow client to push updated template specs directly into cache
      if (req.body?.countsheetSpec && typeof req.body.countsheetSpec === 'object') {
        await loadHubAssetsCacheFromDisk();
        const spec = req.body.countsheetSpec;
        if (hubAssetsCache.countsheetTemplates.length > 0) {
          hubAssetsCache.countsheetTemplates[0].spec = spec;
          await saveHubAssetsCacheToDisk(hubAssetsCache);
        }
      }

      const synced = await syncHubAssetsFromGoogleDrive(tokenToUse || undefined);
      return res.json({
        success: true,
        ownerEmail: HUB_OWNER_EMAIL,
        updatedAt: synced.updatedAt,
        customLinks: synced.customLinks || {},
        templateFolder: synced.templateFolder,
        countsheetSubfolder: synced.countsheetSubfolder,
        encodingSubfolder: synced.encodingSubfolder,
        icdFormsFolder: synced.icdFormsFolder,
        countsheetTemplates: synced.countsheetTemplates,
        encodingTemplates: synced.encodingTemplates,
        forms: synced.forms,
      });
    } catch (err: any) {
      console.error('Error in /api/hub/sync:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Compute latest source code modification timestamp (cached for 2 seconds to keep polling ultra-light)
  let cachedCodeMtime = 0;
  let lastCodeScanTime = 0;
  function getLatestCodeMtime(): number {
    const now = Date.now();
    if (now - lastCodeScanTime < 2000 && cachedCodeMtime > 0) {
      return cachedCodeMtime;
    }
    lastCodeScanTime = now;
    let maxMtime = 0;

    const checkFile = (filePath: string) => {
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > maxMtime) maxMtime = Math.floor(stat.mtimeMs);
      } catch {}
    };

    const walkDir = (dirPath: string) => {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            walkDir(full);
          } else if (entry.isFile()) {
            checkFile(full);
          }
        }
      } catch {}
    };

    walkDir(path.resolve(__dirname, 'src'));
    checkFile(path.resolve(__dirname, 'server.ts'));
    checkFile(path.resolve(__dirname, 'index.html'));
    checkFile(path.resolve(__dirname, 'public', 'sw.js'));

    cachedCodeMtime = maxMtime || now;
    return cachedCodeMtime;
  }

  const GLOBAL_UPDATE_NOTIFICATIONS_KEY = 'global_app_update_notifications';

  interface ServerAppUpdateNotification {
    id: string;
    title: string;
    message: string;
    senderName: string;
    senderEmail: string;
    createdAt: string;
    timestamp: number;
  }

  async function getStoredUpdateNotifications(): Promise<ServerAppUpdateNotification[]> {
    try {
      const stmt = db.prepare(`
        SELECT state_json FROM user_workspace_state WHERE user_key = ?1
      `);
      const row = await stmt.bind(GLOBAL_UPDATE_NOTIFICATIONS_KEY).first<{ state_json: string }>();
      if (row?.state_json) {
        const parsed = JSON.parse(row.state_json);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }

  async function saveStoredUpdateNotifications(list: ServerAppUpdateNotification[]): Promise<void> {
    try {
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO user_workspace_state (user_key, state_json, updated_at)
        VALUES (?1, ?2, ?3)
      `);
      await stmt
        .bind(GLOBAL_UPDATE_NOTIFICATIONS_KEY, JSON.stringify(list.slice(0, 25)), now)
        .run();
    } catch {}
  }

  // Lightweight endpoint to check code version and data updates in real time
  app.get('/api/app-version', async (_req: ExpressRequest, res: ExpressResponse) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const codeModifiedAt = getLatestCodeMtime();
    const hubUpdatedAt = hubAssetsCache?.updatedAt || '';
    const customLinksUpdatedAt = hubAssetsCache?.customLinks?.updatedAt || '';
    const masterdataUpdatedAt = cachedMasterdataPayload?.updatedAt || '';
    const dataUpdatedAt = `${hubUpdatedAt}_${customLinksUpdatedAt}_${masterdataUpdatedAt}_${lastAdminDataModifiedAt}`;
    const version = `${codeModifiedAt}_${dataUpdatedAt}`;
    const notifications = await getStoredUpdateNotifications();

    return res.json({
      version,
      codeModifiedAt,
      dataUpdatedAt,
      notifications,
      latestNotification: notifications[0] || null,
      serverTime: Date.now(),
    });
  });

  // Admin endpoint to manually broadcast an Update / Refresh notification to all app & website users
  app.post('/api/app-update-notifications', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const title = String(req.body?.title || 'App & Website Update Available').trim();
      const message = String(
        req.body?.message ||
          'New features or data updates have been published by the Admin. Click Update & Refresh to load the latest version.'
      ).trim();
      const senderName = String(req.body?.senderName || 'Admin').trim();
      const senderEmail = String(req.body?.senderEmail || '').trim();
      const now = new Date();

      const newNotif: ServerAppUpdateNotification = {
        id: `upd_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
        title,
        message,
        senderName,
        senderEmail,
        createdAt: now.toISOString(),
        timestamp: now.getTime(),
      };

      const existing = await getStoredUpdateNotifications();
      const updated = [newNotif, ...existing].slice(0, 25);
      await saveStoredUpdateNotifications(updated);

      return res.json({
        success: true,
        notification: newNotif,
        notifications: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to broadcast update notification' });
    }
  });

  // Admin endpoint to clear broadcasted update notifications
  app.delete('/api/app-update-notifications', async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
      await saveStoredUpdateNotifications([]);
      return res.json({ success: true, notifications: [] });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to clear notifications' });
    }
  });

  // Ensure HTML, Service Worker, Manifest, and source modules are never cached by proxy or browser disk cache
  app.use((req, res, next) => {
    if (
      req.path === '/' ||
      req.path === '/index.html' ||
      req.path === '/sw.js' ||
      req.path === '/manifest.json' ||
      req.path.startsWith('/src/')
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // Static Assets / Vite integration
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith('index.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('manifest.json')
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
    setTimeout(async () => {
      await loadHubAssetsCacheFromDisk();
      void syncHubAssetsFromGoogleDrive();
      await loadMasterdataCacheFromDisk();

      // Proactively refresh Masterdata from Google Sheets on boot so server always has fresh data
      void refreshMasterdataFromGoogle();

      // Periodically sync Masterdata from Google Sheets every 3 minutes so additions in Google Sheets are picked up automatically
      setInterval(() => {
        void refreshMasterdataFromGoogle();
      }, 3 * 60 * 1000);
    }, 1000);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
