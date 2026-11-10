# Cloudflare Worker Deployment Fix & Share Link Restoration Plan

## Overview
Resolving the `wrangler deploy` failure on Cloudflare while preserving full compatibility with the AI Studio preview/production runtime, and restoring the Cloudflare Workers URL (`https://icd-inventory-hub.icdsystem.workers.dev`) as the primary link in the Share and Install dialogs.

## Root Cause of the Cloudflare Deploy Failure
1. **Unbundled Vite Dependency Error (`Could not resolve "@vitejs/devtools/config"`)**:
   - `server.ts` includes a static literal `await import('vite')` in development mode. When Cloudflare Wrangler runs its esbuild bundler on `server.ts`, it attempts to bundle the entire `vite` package into the Worker script and fails on optional internal Vite dependencies.
2. **Missing ES Module Worker Default Export (`Your worker has no default export`)**:
   - `wrangler.jsonc` points `"main"` to `"server.ts"`, which starts an Express listener (`startServer()`) but does not export an ES Module `export default { fetch(request, env, ctx) }` handler. Wrangler therefore falls back to legacy Service Worker (`iife`) format and rejects Node built-in imports.

## Planned Changes

### 1. Dual-Runtime Entry Point (`server.ts`)
- **Cloudflare Worker Default Export (`export default { fetch }`)**:
  - Add a standard Cloudflare Worker `fetch(request, env, ctx)` handler exported as `default` from `server.ts`.
  - Automatically initialize D1 database tables (`branch_role_assignments`, `user_activity_logs`, `workspace_presence`, `audit_Finding_logs`, `audit_schedules`, `encoding_runs`) against `env.DB` on first request in the Worker runtime.
  - Route `/api/*` requests through the Express application bridged to `env.DB` (using `cloudflare:node`'s `httpServerHandler`), and route static frontend requests (`!pathname.startsWith('/api/')`) through `env.ASSETS` with SPA fallback to `/index.html`.
- **Vite Bundler Guard for Wrangler**:
  - Replace the static `import('vite')` literal in `server.ts` with a dynamic module specifier so Wrangler's esbuild bundler skips bundling Vite into the production Cloudflare Worker while keeping local/AI Studio Vite middleware working.
- **Node.js Runtime Guard**:
  - Guard `fileURLToPath(import.meta.url)` and only invoke `startServer()` (`app.listen(3000)`) when running in the Node.js environment (AI Studio), preventing port binding during Worker initialization.

### 2. Build & Wrangler Configuration (`wrangler.jsonc` & `package.json`)
- Ensure `wrangler.jsonc` includes a top-level `build.command` (`"npm run build"`) so Cloudflare automatically builds the `./dist` frontend assets before bundling and deploying the Worker.

### 3. Primary Share & QR Code Link (`src/components/ShareModal.tsx` & `src/components/InstallModal.tsx`)
- Update the share URL resolver so `https://icd-inventory-hub.icdsystem.workers.dev` is used as the primary share and QR code link for coworkers when opened from AI Studio (`run.app`) or local dev.

## Verification Plan
- Run `npx wrangler deploy --dry-run` to verify that Wrangler compiles the Worker bundle in ES Module format with zero errors.
- Run `compile_applet` and `lint_applet` to ensure TypeScript compilation and linting pass cleanly.
