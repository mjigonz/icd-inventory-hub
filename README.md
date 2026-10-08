# Inventory Hub (CountSheet)

Mobile-first physical inventory counting and audit monitoring PWA with Google Sheets integration, barcode scanning, offline caching, and multi-sheet audit mapping.

---

## External Application Integration & Deep-Linking Guide

Inventory Hub supports URL-based deep linking, enabling external web applications (such as a Vercel-hosted intranet, management portal, or ERP system) to open directly into specific branches and features.

> **Note**: Do not hardcode a specific production domain in external applications until your Cloudflare Pages / custom domain URL is finalized. Store `INVENTORY_HUB_URL` in an environment variable (e.g., `NEXT_PUBLIC_INVENTORY_HUB_URL` or `VITE_INVENTORY_HUB_URL`).

### 1. Supported Query Parameters

| Parameter | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `branch` | `string` | Target branch name or keyword. Used to auto-select matching cached branches or pre-populate Drive search. | `?branch=BATANGAS` |
| `feature` | `string` | Target feature/view to open upon landing. | `?feature=count` |
| `spreadsheetId` | `string` | Direct Google Sheets spreadsheet ID. Pre-selects or pre-populates branch ID. | `?spreadsheetId=1BxiMVs0XRA5n...` |

### 2. Supported Feature Targets

The `feature` parameter routes to the following views:

- `home`: Branch selection and inventory overview dashboard (`BranchView`)
- `count`: Physical countsheet entry and item scanning (`CountView`)
- `inventory`: Masterdata and encoding item catalog lookup (`InventoryView`)
- `monitoring`: 5-sheet block progress and auditor monitoring (`MonitoringView`)
- `audit`: Audit Report generator modal (IATD to Encoding template mapper)

*If `feature` is omitted or unrecognized, Inventory Hub safely defaults to the standard landing page (restoring the last active branch or branch selector).*

### 3. Integration Examples for External Applications

#### Example A: Opening a Specific Feature via JavaScript
In a Vercel-hosted React/Next.js/HTML portal:
```javascript
const INVENTORY_HUB_URL = process.env.NEXT_PUBLIC_INVENTORY_HUB_URL || "https://INVENTORY_HUB_URL";

// Open Countsheet entry for Batangas branch
window.location.href = `${INVENTORY_HUB_URL}/?branch=BATANGAS&feature=count`;
```

#### Example B: Opening Monitoring for a Specific Google Spreadsheet ID
```javascript
window.location.href = `${INVENTORY_HUB_URL}/?spreadsheetId=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms&feature=monitoring`;
```

#### Example C: Direct Audit Report Generation
```javascript
window.location.href = `${INVENTORY_HUB_URL}/?feature=audit`;
```

#### Example D: HTML Anchor Link
```html
<a
  href="https://INVENTORY_HUB_URL/?branch=LIPA&feature=inventory"
  target="_blank"
  rel="noopener noreferrer"
>
  Open Lipa Inventory Catalog
</a>
```

### 4. Security & Safety Principles

1. **Zero Destructive Actions**: Deep-link query parameters **only** control navigation and context. They never trigger deletions, sheet resets, or overwrites.
2. **Context, Not Authorization**: `branch`, `spreadsheetId`, and `feature` parameters are not authentication tokens. Access to Google Drive spreadsheets and data is strictly governed by Google OAuth Bearer tokens and Firebase Authentication.
3. **Graceful Fallback**: Missing, malformed, or unauthorized parameters never crash the application; the app safely falls back to standard user landing.

---

## Local Development & Build

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run type check
npm run lint

# Build production assets
npm run build
```
