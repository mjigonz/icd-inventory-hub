# Export to Encoding & Countsheet Direct Workflow

Directly integrate **Create Countsheet** with **Create Encoding** (Audit Report), placing an **Export to Encoding** button in the footer when editing a saved countsheet, auto-opening the encoding items editor without a countsheet picker, changing Cancel to Back when navigated from Export to Encoding, returning to editing countsheets when Back is clicked, and featuring quick fast-to-slow slide animations between the two modals.

## User Requirements & Status

- [x] **Export to Encoding Button**: Added in the footer of **Create Countsheet**, located in the middle between **Save Countsheet** and **Create**. Only visible when editing a countsheet from recent sessions (`isEditingRecent`).
- [x] **Direct Encoding Flow**: Clicking **Export to Encoding** saves the session and immediately opens **Create Encoding** (`CreateAuditReportModal`) with the countsheet sequence and items preloaded directly into the editor (`renderPreGeneratedCountsheetEditor()`), without prompting to select a countsheet.
- [x] **Change Cancel to Back**: When opened via **Export to Encoding**, the "Cancel" button in the footer of Create Encoding dynamically changes to **Back** (with `<ChevronLeft />`).
- [x] **Return to Editing Countsheets**: Clicking **Back** closes Create Encoding and seamlessly re-opens **Create Countsheet** directly into editing that countsheet session, retaining all groups, filters, and items.
- [x] **Fast-to-Slow Slide Animation**:
  - **Forward (Countsheet -> Encoding)**: Editing Countsheet animates out to the left (`animate-slide-out-left`), while Export to Encoding animates in from the right (`animate-slide-in-right`) with quick-to-slow deceleration easing (`cubic-bezier(0.16, 1, 0.3, 1)`).
  - **Reverse (Encoding -> Countsheet)**: Export to Encoding animates out to the right (`animate-slide-out-right`), while Editing Countsheet animates in from the left (`animate-slide-in-left`) with the same fast-to-slow easing.
- [x] **Removed Import Countsheet in Create Encoding**: The "Import Countsheet Items" header button and the `showCountsheetImportPicker` modal have been completely removed.
- [x] **Verification**: All TypeScript types, build artifacts, and lint checks passed with zero errors (`tsc --noEmit` and `vite build`).

---

## 1. Overview & Flow

1. **User Flow in Create Countsheet**:
   - The user opens a saved countsheet from Recents by clicking **Edit**.
   - `isEditingRecent` is activated.
   - At the bottom footer, three buttons appear:
     1. **Save Countsheet** (green)
     2. **Export to Encoding** (indigo) — in the middle
     3. **Create** (blue)
   - When **Export to Encoding** is clicked:
     - The current countsheet snapshot and sequence are built via `buildSessionSavePayload()` and persisted.
     - **Forward Animation Triggered**: Countsheet slides out to the left, and Create Encoding slides in from the right with fast-to-slow deceleration (`cubic-bezier(0.16, 1, 0.3, 1)`).
     - In Create Encoding, the bottom button is changed from **Cancel** to **Back**.

2. **Back Navigation Flow**:
   - Clicking **Back** in Create Encoding invokes `onBackToCountsheet()`.
   - **Reverse Animation Triggered**: Create Encoding slides out to the right, and Countsheet slides back in from the left with the same fast-to-slow easing.
   - The Create Countsheet modal re-opens with `initialSession` restoring the session directly into the `FILTER_ITEMS` editor with `isEditingRecent` active.
