import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));

// Explicit handler for Service Worker with correct MIME type & headers
app.get('/sw.js', (_req: Request, res: Response) => {
  const swPath = path.resolve(__dirname, 'public', 'sw.js');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (fs.existsSync(swPath)) {
    return res.sendFile(swPath);
  }
  return res.status(404).send('Service worker not found');
});

// Explicit handler for Web App Manifest
app.get(['/manifest.json', '/manifest.webmanifest'], (_req: Request, res: Response) => {
  const manifestPath = path.resolve(__dirname, 'public', 'manifest.json');
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (fs.existsSync(manifestPath)) {
    return res.sendFile(manifestPath);
  }
  return res.status(404).send('Manifest not found');
});

// Serve public directory assets
app.use(
  express.static(path.resolve(__dirname, 'public'), {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('sw.js')) {
        res.setHeader('Service-Worker-Allowed', '/');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (filePath.endsWith('manifest.json')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  })
);

// Ensure data directory exists
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ROLES_FILE = path.join(DATA_DIR, 'branch_roles.json');

interface BranchMember {
  role: 'owner' | 'encoder';
  email: string;
  name: string;
  assignedAt: string;
}

interface BranchRecord {
  spreadsheetId: string;
  spreadsheetName: string;
  ownerEmail: string;
  ownerName: string;
  claimedAt: string;
  members: Record<string, BranchMember>;
}

function loadBranchRoles(): Record<string, BranchRecord> {
  try {
    if (fs.existsSync(ROLES_FILE)) {
      const data = fs.readFileSync(ROLES_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading branch roles file:', err);
  }
  return {};
}

function saveBranchRoles(data: Record<string, BranchRecord>) {
  try {
    fs.writeFileSync(ROLES_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing branch roles file:', err);
  }
}

// Google OAuth token verification helper
async function verifyGoogleToken(token: string): Promise<{ email: string; name: string; sub: string } | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      email: data.email?.toLowerCase(),
      name: data.name || data.email?.split('@')[0] || 'User',
      sub: data.sub,
    };
  } catch (err) {
    console.error('Error verifying token with Google:', err);
    return null;
  }
}

// Middleware to extract and verify bearer token
async function authMiddleware(req: Request, res: Response, next: () => void) {
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
app.get('/api/roles/status', authMiddleware, (req: Request, res: Response) => {
  const spreadsheetId = req.query.spreadsheetId as string;
  if (!spreadsheetId) {
    return res.status(400).json({ error: 'spreadsheetId query param is required' });
  }

  const user = (req as any).user;
  const store = loadBranchRoles();
  const branch = store[spreadsheetId];

  if (!branch) {
    return res.json({
      hasOwner: false,
      ownerEmail: null,
      ownerName: null,
      currentRole: 'unassigned',
    });
  }

  const userMember = branch.members[user.email];
  const isOwner = branch.ownerEmail === user.email;

  return res.json({
    hasOwner: Boolean(branch.ownerEmail),
    ownerEmail: branch.ownerEmail,
    ownerName: branch.ownerName,
    currentRole: isOwner ? 'owner' : userMember ? userMember.role : 'unassigned',
  });
});

// 2. Claim role (Owner or Encoder)
app.post('/api/roles/claim', authMiddleware, (req: Request, res: Response) => {
  const { spreadsheetId, spreadsheetName, requestedRole } = req.body;
  if (!spreadsheetId || !requestedRole) {
    return res.status(400).json({ error: 'spreadsheetId and requestedRole are required' });
  }

  if (requestedRole !== 'owner' && requestedRole !== 'encoder') {
    return res.status(400).json({ error: 'Role must be either "owner" or "encoder"' });
  }

  const user = (req as any).user;
  const store = loadBranchRoles();
  let branch = store[spreadsheetId];

  if (!branch) {
    branch = {
      spreadsheetId,
      spreadsheetName: spreadsheetName || 'Branch Inventory',
      ownerEmail: '',
      ownerName: '',
      claimedAt: new Date().toISOString(),
      members: {},
    };
  }

  if (requestedRole === 'owner') {
    // If an owner already exists and is NOT this user, reject!
    if (branch.ownerEmail && branch.ownerEmail !== user.email) {
      return res.status(409).json({
        error: 'This branch already has an owner.',
        ownerEmail: branch.ownerEmail,
        ownerName: branch.ownerName,
      });
    }

    branch.ownerEmail = user.email;
    branch.ownerName = user.name;
    branch.members[user.email] = {
      role: 'owner',
      email: user.email,
      name: user.name,
      assignedAt: new Date().toISOString(),
    };
  } else {
    // Claiming encoder
    branch.members[user.email] = {
      role: 'encoder',
      email: user.email,
      name: user.name,
      assignedAt: new Date().toISOString(),
    };
  }

  if (spreadsheetName) {
    branch.spreadsheetName = spreadsheetName;
  }

  store[spreadsheetId] = branch;
  saveBranchRoles(store);

  return res.json({
    success: true,
    role: requestedRole,
    ownerEmail: branch.ownerEmail,
    ownerName: branch.ownerName,
  });
});

// 3. Delete Countsheet - Server-side role enforcement (Only branch Owner can delete!)
app.post('/api/sheets/delete-countsheet', authMiddleware, async (req: Request, res: Response) => {
  const { spreadsheetId, csNumber } = req.body;
  if (!spreadsheetId || csNumber === undefined) {
    return res.status(400).json({ error: 'spreadsheetId and csNumber are required' });
  }

  const user = (req as any).user;
  const token = (req as any).token;
  const store = loadBranchRoles();
  const branch = store[spreadsheetId];

  // Enforce server-side ownership
  if (!branch || branch.ownerEmail !== user.email) {
    return res.status(403).json({
      error: 'Only the branch Owner can delete an entire countsheet.',
      ownerEmail: branch?.ownerEmail,
    });
  }

  try {
    // 1. Fetch current COUNTSHEETS tab
    const getRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/COUNTSHEETS!A:N`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!getRes.ok) {
      const errText = await getRes.text();
      return res.status(getRes.status).json({ error: `Google Sheets error: ${errText}` });
    }

    const sheetData = await getRes.json();
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

    // Keep rows where CS column is not targetCsStr (also check index 12 if legacy)
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

// Start server
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CountSheet Server running on http://0.0.0.0:${PORT}`);
  });
}

start();
