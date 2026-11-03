# Instant Preview Mode & Global Masterdata Access

Enable immediate, popup-free entry into **Instant Preview & Field Auditor Mode** with full access to the global **Masterdata** catalog (76,179+ GRO and OTHERS items), while clearly gating Google-linked workflows (Google Drive spreadsheet selection, Create Encoding, and Create Countsheet/Inventory) until a Google account is connected.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following behavior was confirmed and will govern the Instant Preview experience across authentication, Branch operations, and Masterdata lookup:

- **Confirmed Decision 1 — Immediate Entry Without Google Popup**: Clicking **Instant Preview & Field Auditor Mode** on the sign-in screen enters the workspace immediately using an offline/preview session without triggering a Google OAuth popup—even if a previously remembered account has an expired token.
- **Confirmed Decision 2 — Restrict Google-Linked Features Until Connected**: While in Instant Preview (no active Google OAuth token connected), features that depend on the user's personal Google Drive or Google Sheets—specifically **selecting/browsing Google Sheets in Branch**, **Create Encoding**, and **Create Countsheet / Inventory**—are locked with a clear prompt and one-click action to connect a Google account.
- **Confirmed Decision 3 — Full Masterdata Access in Instant Preview**: Features that are independent of the user's Google account—specifically the **Masterdata** catalog (GRO & OTHERS) and **Forms**—remain immediately accessible and searchable in Instant Preview mode.

---

## 1. Overview & Core Concept

- **What It Does**: Separates local/global audit capabilities from personal Google Workspace integrations. Users entering via Instant Preview bypass Google OAuth popups to immediately inspect the Masterdata catalog or preview the interface, while Google Drive-dependent actions clearly indicate that a Google account link is required.
- **Target Audience / Persona**: Field auditors, branch personnel, and reviewers who need instant access to global Masterdata item lookups or offline tools without authenticating a personal Google Drive account first.
- **Key Value**: Eliminates unexpected Google sign-in popups when launching Instant Preview while preventing confusing API errors on Google Drive-dependent features.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Instant Preview Entry**: On the sign-in screen, clicking **Instant Preview & Field Auditor Mode** (or submitting an auditor name) immediately opens the application in Preview Mode without invoking a Google OAuth popup.
  2. **Masterdata Lookup (Unrestricted)**: Navigating to **Inventory → Masterdata** immediately loads and searches the 76,179+ global GRO and OTHERS catalog (from local IndexedDB snapshot or server Masterdata cache) even when no branch is selected and no Google account is linked. Switching to the **Local** inventory tab when no branch is connected displays a clear prompt to connect a Google account and select a branch.
  3. **Branch & Creation Gating (Restricted in Instant Preview)**:
     - In the **Branch** tab, the Google Drive spreadsheet browser, manual spreadsheet URL/ID loader, **Create Encoding**, and **Create Countsheet** buttons display a locked state and a dedicated **Google Account Not Connected** banner with a **Connect Google Account** CTA button.
     - In the top header menu, selecting **Create Encoding** or **Create Countsheet** while in Instant Preview prompts the user to connect their Google account first.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Clean utilitarian enterprise dashboard matching the existing slate, blue, and amber status system in both light and dark modes.
  - *Color Palette & Mood*: Uses `--background` (`bg-slate-50` / `dark:bg-slate-950`), `--primary` (`bg-blue-600`), and amber/slate informational callouts (`bg-amber-50/90 dark:bg-amber-950/40`, `border-amber-200 dark:border-amber-800/80`) to distinguish preview-restricted states from destructive errors.
- **Interactive Feedback & Motion**:
  - Disabled Google-dependent buttons show a lock indicator and clear tooltip explaining that a Google account connection is required.
  - Clicking **Connect Google Account** from the Branch banner triggers the standard Google OAuth sign-in popup and immediately unlocks Drive search, Create Encoding, and Create Countsheet upon completion.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dedicated Unlinked Session Token for Instant Preview**
  - *Chosen Approach*: Ensure Instant Preview always issues an explicit `auditor:` session token when clicked rather than reusing `handleInstantContinue`'s automatic OAuth popup fallback, and expose a boolean `isGoogleConnected` state derived from `isGoogleOAuthAccessToken(effectiveAccessToken)`.
  - *Why*: Previously, if a user had a remembered email with an expired OAuth token, clicking Instant Preview routed through `handleInstantContinue`, which forced a Google OAuth popup. Explicit session separation guarantees zero popups on entry and deterministic feature gating.
  - *Alternatives Considered*: Silently failing Google Drive API calls in Branch view—rejected because it shows confusing "Session Expired / 401" errors instead of a clean "Google Account Not Connected" state.
- **Decision 2: Global Masterdata Decoupling from Branch & OAuth State**
  - *Chosen Approach*: Keep Masterdata (`__SNAP_MAST_GLOBAL_V3__` and `/api/masterdata`) accessible regardless of `isGoogleConnected` or `selectedBranch`, while gating branch-level Google Sheet sync and Local Inventory sync behind `isGoogleConnected`.
  - *Why*: Masterdata is a non-movable global catalog shared across all branches and served via the backend snapshot, so it does not require a user's personal Google Drive token.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              SignInView                                  │
│  ┌────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │    Google Sign-In / Continue   │  │ Instant Preview & Auditor Mode │  │
│  │  (OAuth Token -> Full Access)  │  │ (Immediate Entry -> No Popup)  │  │
│  └───────────────┬────────────────┘  └───────────────┬────────────────┘  │
└──────────────────┼───────────────────────────────────┼───────────────────┘
                   │                                   │
                   ▼                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   App Auth State & Token Resolution                      │
│       isGoogleConnected = isGoogleOAuthAccessToken(effectiveToken)       │
└──────────────────┬───────────────────────────────────┬───────────────────┘
                   │                                   │
      ┌────────────┴────────────┐         ┌────────────┴────────────┐
      ▼                         ▼         ▼                         ▼
┌───────────┐             ┌───────────┐   │               ┌───────────────────┐
│BranchView │             │HeaderMenu │   │               │   InventoryView   │
│ & Modals  │             │  Actions  │   │               │                   │
├───────────┤             ├───────────┤   │               ├───────────────────┤
│If !Google:│             │If !Google:│   └──────────────►│ • MASTERDATA Tab: │
│• Lock     │             │• Lock     │                   │   Always Active   │
│  Drive    │             │  Create   │                   │   (GRO & OTHERS)  │
│  Sheets   │             │  Encoding │                   │ • LOCAL Tab:      │
│• Lock     │             │  & Count  │                   │   Requires Linked │
│  Create   │             │  Modals   │                   │   Branch Sheet    │
│  Encoding │             │• Forms    │                   └───────────────────┘
│  & Count  │             │  Active   │
└───────────┘             └───────────┘
```

- **Data Model & State**:
  - `isGoogleConnected`: Boolean computed from `isGoogleOAuthAccessToken(effectiveAccessToken)`. True only when the user has an active Google OAuth 2.0 access token; false when using an `auditor:` Instant Preview session.
  - `SNAP_MASTERDATA_KEY` (`__SNAP_MAST_GLOBAL_V3__`): Global IndexedDB store holding the 76,179+ GRO and OTHERS items, hydrated from `/api/masterdata` without requiring user OAuth headers.
- **Interactive Component & State Mapping**:
  - **Sign-In Flow**: Clicking **Instant Preview & Field Auditor Mode** invokes `directAuditorSignIn` directly (bypassing `googleSignIn` popup checks) and sets an `auditor:` session token so the user enters the app immediately.
  - **Branch View Gating**: When `!isGoogleConnected`, `BranchView` skips calling `searchDriveSpreadsheets`, disables the Drive search input, manual URL/ID input, **Create Encoding**, and **Create Countsheet** buttons, and renders a **Connect Google Account** card that triggers `onConnectGoogleAccount` (`handleSignIn`).
  - **Navigation & Header Menu Gating**: Attempting to open **Create Encoding** or **Create Countsheet** while `!isGoogleConnected` prompts the user to connect their Google account, whereas **Forms** and **Inventory (Masterdata)** open immediately.
  - **Inventory View Masterdata Access**: Defaults to or allows switching to the **Masterdata** tab with full search, category filtering (GRO / OTHERS), and item inspection even when `branch` is `null` and `!isGoogleConnected`.
