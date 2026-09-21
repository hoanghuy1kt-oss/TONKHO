# Research 04 — Firestore → .xlsx export (Next.js, admin-triggered)

Date: 2026-09-17 | Scope: admin "Export to Excel" of products + inventory batches, VN text, <5k rows.

## 1. Library: use `write-excel-file`

| | `write-excel-file` | `exceljs` | `xlsx` (SheetJS) |
|---|---|---|---|
| npm status 2026 | active | **inactive** — last release 4.4.0 (Oct 2023), no commits 6+ mo, community forks (`exceljs-hardened`, `@protobi/exceljs`) exist | **not on npm** since 2023 — npm `xlsx@0.18.5` is stale w/ 2 unfixed high CVEs (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9) |
| install | normal | normal | must add `https://cdn.sheetjs.com/...` registry/tarball — awkward in CI/Vercel |
| gzip (browser) | ~15 KB (only dep: `fflate`) | ~250 KB | ~400 KB full build |
| Next.js client bundling | clean ESM `write-excel-file/browser` | known webpack pain (`fs` polyfill, must import `exceljs/dist/es5/exceljs.browser.js`, Next 13+ prod-build class errors) | ok but heavy |
| multi-sheet / widths / real Dates / frozen rows / header styling | all yes | all yes | widths yes; styling paid Pro only |
| native hyperlink object | **no** → use `=HYPERLINK()` formula | yes | Pro only |
| license | MIT | MIT | Apache-2.0 |

**Decision:** `write-excel-file`. 16x smaller, maintained, zero bundler friction, covers every stated requirement. The one gap (hyperlink) is solved with a `Formula` cell — `=HYPERLINK("url";"Xem ảnh")` renders as a real clickable link in Excel / LibreOffice / Google Sheets.
Pick `exceljs` only if later you need images embedded in cells, merged cells, conditional formatting, or reading .xlsx. Avoid `xlsx` entirely (registry + CVE + styling paywall).

## 2. Client-side, not a route handler

Admin is already Firebase-Auth'd and rows are already in memory via `onSnapshot` → generating in the browser means **zero network round-trip, zero server cost, no auth re-check, no Vercel limits**. ~15 KB, and can be `await import()`ed so it is lazy-loaded only when the button is clicked.

Server-side (`app/api/export/route.ts`) would require: verifying the Firebase ID token server-side (`firebase-admin`), re-reading Firestore (double read cost), and staying under Vercel's **4.5 MB response body** and **10 s default / 60 s max (Hobby)** function duration. Irrelevant overhead for hundreds of rows.

Go server-side later only if: export must include data the client is not allowed to subscribe to, or row counts reach 50k+ (then stream and set `export const maxDuration = 60`).

## 3. Code sketch — `src/lib/export-inventory-to-excel.ts`

```ts
// npm i write-excel-file
import type { Product, BatchEntry } from '@/types'

const HEADER = { fontWeight: 'bold', backgroundColor: '#E8EEF7', align: 'center' } as const
const DATE_FMT = 'dd/mm/yyyy'
const DATETIME_FMT = 'dd/mm/yyyy hh:mm'

export async function exportInventoryToExcel(products: Product[], entries: BatchEntry[]) {
  const writeXlsxFile = (await import('write-excel-file')).default // lazy chunk

  const productColumns = [
    { header: { value: 'Mã vạch', ...HEADER }, width: 18,
      cell: (p: Product) => ({ value: p.barcode, type: String }) },
    { header: { value: 'Tên sản phẩm', ...HEADER }, width: 40,
      cell: (p: Product) => ({ value: p.name, type: String }) },
  ]

  const entryColumns = [
    { header: { value: 'Mã vạch', ...HEADER }, width: 18,
      cell: (e: BatchEntry) => ({ value: e.barcode, type: String }) },
    { header: { value: 'Tên sản phẩm', ...HEADER }, width: 40,
      cell: (e: BatchEntry) => ({ value: e.productName, type: String }) },
    { header: { value: 'Hạn sử dụng', ...HEADER }, width: 14,
      // real Excel date serial, NOT a string → sortable/filterable
      cell: (e: BatchEntry) => ({ value: e.expiryDate?.toDate?.() ?? e.expiryDate, type: Date, format: DATE_FMT }) },
    { header: { value: 'Số lượng', ...HEADER }, width: 10, align: 'right',
      cell: (e: BatchEntry) => ({ value: e.quantity, type: Number, format: '#,##0' }) },
    { header: { value: 'Ảnh', ...HEADER }, width: 14,
      // no native hyperlink API → HYPERLINK formula. Escape " and use ; as arg separator-safe form.
      cell: (e: BatchEntry) => e.photoUrl
        ? { type: 'Formula', value: `=HYPERLINK("${e.photoUrl.replace(/"/g, '""')}","Xem ảnh")`, color: '#0563C1', fontStyle: 'underline' }
        : { value: '', type: String } },
    { header: { value: 'Ngày tạo', ...HEADER }, width: 18,
      cell: (e: BatchEntry) => ({ value: e.createdAt?.toDate?.() ?? e.createdAt, type: Date, format: DATETIME_FMT }) },
    { header: { value: 'Người tạo', ...HEADER }, width: 22,
      cell: (e: BatchEntry) => ({ value: e.createdByName, type: String }) },
  ]

  await writeXlsxFile(
    [
      { data: products, columns: productColumns, sheet: 'Sản phẩm',  stickyRowsCount: 1 },
      { data: entries,  columns: entryColumns,   sheet: 'Tồn kho',   stickyRowsCount: 1 },
    ],
    { fileName: buildFileName(), fontFamily: 'Calibri', fontSize: 11 }
  )
}

export function buildFileName(prefix = 'ton-kho') {
  // Asia/Ho_Chi_Minh, sortable, ASCII-only
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(/[- :]/g, '')      // 20260917_2137 → 202609172137
  return `${prefix}-${p.slice(0, 8)}-${p.slice(8)}.xlsx`   // ton-kho-20260917-2137.xlsx
}
```

Notes:
- `stickyRowsCount: 1` = frozen header row, per sheet.
- "Auto" widths: `write-excel-file` has no auto-fit; compute it — `width: Math.min(50, Math.max(header.length, ...rows.map(r => String(v).length)) + 2)`. Excel widths are in characters; VN diacritics count as 1 char so no adjustment needed.
- Always pass Firestore `Timestamp` through `.toDate()`. Passing the Timestamp object or an ISO string yields a text cell.
- `Intl` handles the timezone — do not use `toISOString()` (UTC, off by 7h).

## 4. Vietnamese / UTF-8

- .xlsx is a zip of UTF-8 XML → diacritics are **not** an encoding problem; write the JS strings directly. No BOM, no escaping.
- Only real risk: **font**. Use Calibri / Arial / Times New Roman (all cover Vietnamese Latin Extended Additional). Avoid exotic fonts.
- Normalize on write if data came from mixed sources: `s.normalize('NFC')` — precomposed `ệ` vs decomposed `ê`+combining dot look identical but break Excel's find/sort.
- Sheet names: `Sản phẩm` / `Tồn kho` are fine (Excel allows Unicode, ≤31 chars, no `: \ / ? * [ ]`).
- **Why not CSV:** Excel on Windows ignores the declared encoding on double-click and falls back to the ANSI code page (1252/1258) unless a UTF-8 BOM (`﻿`) is prepended — so `Sản phẩm` becomes `Sáº£n pháº©m`. Even with the BOM you lose: real date cells, number formatting, multiple sheets, hyperlinks, frozen headers, and column widths. And VN Excel installs often default the list separator to `;`, breaking comma-delimited files. CSV is strictly worse here.

## 5. Filename + Content-Disposition (only if server-side)

Keep the *filename* ASCII (`ton-kho-20260917-2137.xlsx`) — simplest and safest. If a Vietnamese filename is required, send both forms per RFC 5987/6266:

```ts
// app/api/export/route.ts
const buf = await writeXlsxFile(sheets, { buffer: true })     // 'write-excel-file/node'
const name = 'Báo cáo tồn kho 17-09-2026.xlsx'
const ascii = 'bao-cao-ton-kho-20260917-2137.xlsx'            // fallback, no non-ASCII/quotes

return new Response(buf, {
  headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  },
})
```

- `filename*` must come **after** `filename`; `encodeURIComponent` also escapes the spaces (`%20`) which is valid RFC 5987.
- Add `export const runtime = 'nodejs'` (fflate works on edge too, but `firebase-admin` does not).

## Unresolved questions

1. Should the export honour the dashboard's current filter/search state, or always dump everything?
2. Photo URLs — Firebase Storage signed URLs that expire? If so a hyperlink degrades over time; consider storing the permanent `gs://`-derived download URL instead.
3. One row per batch entry (assumed), or also a roll-up sheet of total quantity per product?
4. Does the admin need to re-import this file later? If yes, reading .xlsx requires a second library (`write-excel-file` is write-only) — that would tilt the choice toward `exceljs`.

## Sources

- [SheetJS #2667 — why the move away from npm](https://git.sheetjs.com/sheetjs/sheetjs/issues/2667)
- [SheetJS #3316 — registry vulnerabilities](https://git.sheetjs.com/sheetjs/sheetjs/issues/3316)
- [GitLab advisories for npm/xlsx](https://advisories.gitlab.com/pkg/npm/xlsx/)
- [exceljs on Snyk (maintenance: inactive)](https://security.snyk.io/package/npm/exceljs)
- [exceljs #2557 — Next.js 13 build failure](https://github.com/exceljs/exceljs/issues/2557)
- [write-excel-file README](https://github.com/catamphetamine/write-excel-file)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Vercel 4.5 MB body limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
