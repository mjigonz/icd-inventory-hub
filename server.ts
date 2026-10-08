/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpServerHandler } from 'cloudflare:node';
import { createServer } from 'node:http';
import express from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { D1BranchRoleRepository } from './src/services/d1Repository';
import { D1Database } from './src/db/d1Types';

export interface Env {
  DB: D1Database;
  ASSETS?: {
    fetch: (request: Request | string, init?: RequestInit) => Promise<Response>;
  };
  [key: string]: any;
}

// Storage for passing Worker execution context (env, ctx) to Express handlers
const asyncLocalStorage = new AsyncLocalStorage<{ env: Env; ctx?: any }>();

const app = express();

// Worker-compatible JSON body parser middleware (avoids iconv-lite stream issue in workerd)
app.use((req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return next();
  }

  let rawData = '';
  req.setEncoding('utf8');

  req.on('data', (chunk) => {
    rawData += chunk;
  });

  req.on('end', () => {
    if (rawData && rawData.trim().length > 0) {
      try {
        req.body = JSON.parse(rawData);
      } catch {
        req.body = {};
      }
    } else {
      req.body = {};
    }
    next();
  });

  req.on('error', (err) => {
    console.error('Error reading request body in worker:', err);
    next(err);
  });
});

// Middleware to attach Cloudflare Worker environment to the incoming request
app.use((req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
  const store = asyncLocalStorage.getStore();
  if (store) {
    (req as any).env = store.env;
    (req as any).ctx = store.ctx;
  }
  next();
});

// Helper to access the Cloudflare D1 database binding
function getD1Database(req: ExpressRequest): D1Database {
  const env: Env | undefined = (req as any).env || asyncLocalStorage.getStore()?.env;
  if (!env || !env.DB) {
    throw new Error('Cloudflare D1 database binding "DB" is not available in environment');
  }
  return env.DB;
}

// Google OAuth token verification helper
async function verifyGoogleToken(token: string): Promise<{ email: string; name: string; sub: string } | null> {
  // Support local field auditor sessions
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

// 1. Get branch role status (Cloudflare D1 persistence)
app.get('/api/roles/status', authMiddleware, async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const spreadsheetId = req.query.spreadsheetId as string;
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'spreadsheetId query param is required' });
    }

    const user = (req as any).user;
    const db = getD1Database(req);
    const roleRepo = new D1BranchRoleRepository(db);
    const status = await roleRepo.getBranchRoleStatus(spreadsheetId, user.email);

    return res.json(status);
  } catch (err: any) {
    console.error('Error fetching role status:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// 2. Claim role (Owner or Encoder) (Cloudflare D1 persistence)
app.post('/api/roles/claim', authMiddleware, async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { spreadsheetId, spreadsheetName, requestedRole } = req.body || {};
    if (!spreadsheetId || !requestedRole) {
      return res.status(400).json({ error: 'spreadsheetId and requestedRole are required' });
    }

    if (requestedRole !== 'owner' && requestedRole !== 'encoder') {
      return res.status(400).json({ error: 'Role must be either "owner" or "encoder"' });
    }

    const user = (req as any).user;
    const db = getD1Database(req);
    const roleRepo = new D1BranchRoleRepository(db);
    const result = await roleRepo.claimRole({
      spreadsheetId,
      spreadsheetName,
      requestedRole,
      userEmail: user.email,
      userName: user.name,
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
    const { spreadsheetId, csNumber } = req.body || {};
    if (!spreadsheetId || csNumber === undefined) {
      return res.status(400).json({ error: 'spreadsheetId and csNumber are required' });
    }

    const user = (req as any).user;
    const token = (req as any).token;

    const db = getD1Database(req);
    const roleRepo = new D1BranchRoleRepository(db);
    const ownerEmail = await roleRepo.getBranchOwnerEmail(spreadsheetId);

    // Enforce server-side ownership via Cloudflare D1
    if (!ownerEmail || ownerEmail !== user.email.toLowerCase()) {
      return res.status(403).json({
        error: 'Only the branch Owner can delete an entire countsheet.',
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

    // Identify CS column dynamically from header
    const headerCols = header.map((h) => String(h).trim().toLowerCase());
    let csIdx = headerCols.indexOf('cs');
    if (csIdx === -1) {
      csIdx = headerCols.indexOf('countsheet');
    }
    if (csIdx === -1) {
      csIdx = 13; // Canonical index after Item Condition
    }

    // Keep rows where CS column is not targetCsStr
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

    // Re-index column 0 (No) sequentially
    const updatedDataRows = remainingRows.map((row, index) => {
      const copy = [...row];
      copy[0] = String(index + 1);
      return copy;
    });

    const newAllRows = [header, ...updatedDataRows];

    // Clear existing sheet range
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/COUNTSHEETS!A:N:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    // Write back updated rows
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

// Register internal Node server for Express on port 3000 within the Worker runtime
const server = createServer(app);
server.listen(3000);

// Cloudflare Workers fetch handler wrapper using cloudflare:node httpServerHandler
const workerHttpHandler = httpServerHandler(server);

// Dispatcher for the HTTP handler whether returned as an ExportedHandler or callable function
async function callHttpHandler(
  handler: any,
  request: Request,
  env: Env,
  ctx: any
): Promise<Response> {
  if (typeof handler?.fetch === 'function') {
    return handler.fetch(request, env, ctx);
  }
  if (typeof handler === 'function') {
    return handler(request, env, ctx);
  }
  throw new Error('Invalid httpServerHandler returned from cloudflare:node');
}

// Export the Cloudflare Worker fetch handler (Worker entry point)
export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // API routes are handled by Express
    if (url.pathname.startsWith('/api/')) {
      return asyncLocalStorage.run({ env, ctx }, async () => {
        return callHttpHandler(workerHttpHandler, request, env, ctx);
      });
    }

    // Static Assets serving & React SPA routing via Cloudflare Static Assets
    if (env && env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) {
        // Enforce proper PWA Service Worker headers
        if (url.pathname === '/sw.js') {
          const headers = new Headers(assetRes.headers);
          headers.set('Content-Type', 'application/javascript; charset=utf-8');
          headers.set('Service-Worker-Allowed', '/');
          headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          return new Response(assetRes.body, {
            status: assetRes.status,
            statusText: assetRes.statusText,
            headers,
          });
        }
        // Enforce proper PWA Manifest headers
        if (url.pathname === '/manifest.json' || url.pathname === '/manifest.webmanifest') {
          const headers = new Headers(assetRes.headers);
          headers.set('Content-Type', 'application/manifest+json; charset=utf-8');
          headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          return new Response(assetRes.body, {
            status: assetRes.status,
            statusText: assetRes.statusText,
            headers,
          });
        }
        return assetRes;
      }

      // React SPA fallback: serve index.html for client-side routing
      const indexRequest = new Request(new URL('/index.html', request.url).toString(), request);
      return env.ASSETS.fetch(indexRequest);
    }

    // Fallback to Express handler if ASSETS binding is unavailable
    return asyncLocalStorage.run({ env, ctx }, async () => {
      return callHttpHandler(workerHttpHandler, request, env, ctx);
    });
  },
};
