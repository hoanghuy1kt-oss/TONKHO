# Phase 04 — Admin Auth + Dashboard + History Timeline + Stock + Excel Export

> Revised 2026-09-17: adds a per-entry history timeline, a live stock-on-hand view, hard-delete with subcollection + R2 cleanup, and two extra export sheets.

## Context Links

- [plan.md](plan.md)
- [research/researcher-04-excel-export.md](research/researcher-04-excel-export.md)
- [research/researcher-05-nextjs-firebase-vercel.md](research/researcher-05-nextjs-firebase-vercel.md) (§5 admin gating)
- [phase-01](phase-01-project-scaffold-and-firebase-setup.md) (schema, rules, indexes)

## Overview

- **Priority:** P1
- **Status:** pending
- **Effort:** 5h
- **Blocked by:** Phase 02
- **Parallel-safe with:** Phase 03 (disjoint files)
- Password-gated `/admin`: all batches, per-entry edit history, live stock-on-hand per product, hard-delete, and a multi-sheet `.xlsx` export.

## Key Insights

- **Next.js middleware/`proxy.ts` cannot gate this.** Firebase client Auth stores the ID token in **IndexedDB, not a cookie**, so the server sees nothing. The client `<AuthGuard>` is UX only — **Firestore rules are the actual boundary**. Session cookies would need the Admin SDK plus a real secret: YAGNI for one admin.
- **Use `signInWithEmailAndPassword` only — never popup/redirect OAuth.** Vercel preview URLs are not in Firebase's authorized-domains allowlist and there is no auto-sync; email/password and anonymous sign-in are direct REST calls that ignore the allowlist entirely.
- **Excel library: `write-excel-file`.** SheetJS/`xlsx` is disqualified (pulled from npm 2023, registry copy frozen with two unfixed high-severity CVEs, styling is Pro-only). `exceljs@4.4.0` is unmaintained, ~250KB gzip, with known Next.js/webpack friction. `write-excel-file` is ~15KB gzip, maintained, and covers multi-sheet, widths, `stickyRowsCount`, real `Date` cells, header styling.
- **Export client-side, not via a route handler.** The admin is already authed and the rows stream from Firestore directly; a server route would mean re-verifying tokens, duplicate reads, and Vercel's 4.5MB/10s limits — pointless for hundreds of rows. **Lazy-load the lib via `await import()`.**
- **UTF-8 is a non-issue for .xlsx** (a zip of UTF-8 XML). CSV is the bad fallback: Excel on Windows falls back to ANSI without a `﻿` BOM, turning `Sản phẩm` into `Sáº£n pháº©m`.
- `write-excel-file` has **no hyperlink API** — use `{ type: 'Formula', value: '=HYPERLINK("url","Xem ảnh")' }`.
- **Hard delete is a three-part operation**: Firestore does not cascade to subcollections, and R2 knows nothing about Firestore. The admin delete handler must clear `history/*`, delete the entry doc, then delete every R2 key that entry ever referenced. Order matters — delete R2 last so a failure leaves recoverable pointers, not orphaned data.
- **Stock-on-hand comes free from the new model.** Entries are now current-state-per-batch, so `sum(quantity) where status=='active'` grouped by barcode is live stock. Reuse the export's cursor loop and reduce in memory — one code path, exact, no per-product aggregation queries (which would be N queries for N products).

## Requirements

**Functional**
- `/login`: email + password, VN error messages, redirect to `/admin`.
- `/admin` tabs:
  - **Tồn kho** — per product: name, barcode, total qty, batch count, nearest expiry. Sortable, searchable.
  - **Lô hàng** — all active batches, filterable (barcode, date range, sắp hết hạn, người nhập), with thumbnail, "Lịch sử" and "Xoá vĩnh viễn" actions.
  - **Đã xoá** — soft-deleted batches, with their history still viewable.
- **History timeline** per entry: chronological list of every create/update/delete — who, when, qty before→after, expiry before→after, photo before→after (thumbnails).
- "Xuất Excel" → a 4-sheet `.xlsx`.
- Sign-out returns to the staff screen and re-establishes anonymous auth.

**Non-functional**
- Export lib not in the main bundle (dynamic import).
- Table usable on a laptop; readable on a phone.
- Export of 2,000 entries + their history completes in < 5s on a laptop.

## Architecture

```
/login  → signInWithEmailAndPassword  (REST, ignores authorized-domains allowlist)
              ↓ onAuthStateChanged → AuthContext { user, isAdmin }
/admin  → <AuthGuard requireAdmin>          [UX gate only]
              ├─ useEntriesFeed(status active, limit 200)     live batch table
              ├─ useProductsFeed()                            live product list
              ├─ useEntryHistory(entryId)                     onSnapshot of the history subcollection,
              │                                               orderBy editedAt asc — mounted only when
              │                                               the timeline drawer is open
              ├─ useStockOnHand()  ── fetchAllEntries() ──► reduce by barcode → { totalQty, batches, nearestExpiry }
              └─ "Xuất Excel"
                    ↓ fetchAllEntries(): cursor loop, getDocs(limit 500, startAfter(last)) — NO listener
                    ↓ fetchHistoryFor(entryIds): per-entry getDocs (only for the history sheet)
                    ↓ await import('write-excel-file')
                      "Tồn kho" | "Lô hàng" | "Sản phẩm" | "Lịch sử"
                    ↓ Blob → ton-kho-YYYYMMDD-HHmm.xlsx
```

**Hard delete** (`deleteEntryPermanently`):
```
1. getDocs(history) → collect every prevPhotoKey / newPhotoKey (the full key set)
2. writeBatch: delete each history doc (≤500/batch, loop if more) 
3. deleteDoc(entry)
4. POST /api/photos/delete for each collected key
```
Confirm dialog states plainly that this is unrecoverable and removes the audit trail.

**Export sheets**

| Sheet | Columns |
|---|---|
| Tồn kho | Mã vạch, Tên sản phẩm, Tổng số lượng, Số lô, Hạn gần nhất (Date) |
| Lô hàng | Mã vạch, Tên sản phẩm, Hạn sử dụng (Date), Số lượng, Ghi chú, Người nhập, Thời gian nhập (Date), Người sửa cuối, Sửa lúc (Date), Số lần sửa (`rev`), Ảnh (HYPERLINK) |
| Sản phẩm | Mã vạch, Tên sản phẩm, Đơn vị, Cập nhật lúc (Date) |
| Lịch sử | Mã vạch, Tên sản phẩm, Loại thay đổi, SL trước, SL sau, HSD trước, HSD sau, Người sửa, Thời gian (Date), Ảnh trước, Ảnh sau |

## Related Code Files

**Create**
- `src/components/auth/auth-guard.tsx` — `"use client"`, spinner while `loading`, redirect if not admin
- `src/app/login/page.tsx`
- `src/app/admin/page.tsx` — tabbed dashboard
- `src/components/admin/stock-on-hand-table.tsx`
- `src/components/admin/inventory-table.tsx`
- `src/components/admin/inventory-filters.tsx`
- `src/components/admin/entry-history-timeline.tsx`
- `src/components/admin/deleted-entries-table.tsx`
- `src/components/admin/export-button.tsx`
- `src/hooks/use-products-feed.ts`
- `src/hooks/use-entry-history.ts`
- `src/hooks/use-stock-on-hand.ts`
- `src/lib/export-fetch-all.ts` — paginated one-shot fetch (cursor loop, `limit(500)`), shared by export **and** stock view
- `src/lib/export-to-excel.ts` — 4 sheet builders + download trigger
- `src/lib/admin-delete-entry.ts` — the 4-step hard-delete

**Modify**
- `src/lib/auth-context.tsx` — `signInAdmin(email, password)` / `signOutAdmin()` (sign out → re-`signInAnonymously`)
- `package.json` — `npm i write-excel-file`

## Implementation Steps

1. `npm i write-excel-file`.
2. `auth-context.tsx`: add `signInAdmin` / `signOutAdmin`. After sign-out, immediately `signInAnonymously` so the staff screen keeps working.
3. `auth-guard.tsx`: three states — `loading` (spinner, never flash the redirect), not-signed-in/anonymous → `router.replace('/login')`, signed-in-but-not-admin → "Không có quyền truy cập".
4. `src/app/login/page.tsx`: map Firebase codes to VN copy (`auth/invalid-credential` → "Sai email hoặc mật khẩu", `auth/too-many-requests` → "Thử lại sau ít phút"). No password-reset UI for v1 — reset via console, documented in the README.
5. `src/lib/export-fetch-all.ts`: `fetchAllEntries({ includeDeleted })` cursor loop with `getDocs` at `limit(500)`, **no listener**. Stops on a short page. Hard cap of 20 pages with a surfaced warning. This is the single source for both the export and the stock view (DRY).
6. `src/hooks/use-stock-on-hand.ts`: calls `fetchAllEntries({ includeDeleted:false })`, reduces to `Map<barcode, { name, totalQty, batchCount, nearestExpiry }>`. Manual refresh button + auto-refresh on mount. (Deliberately **not** a live listener — a full-collection listener is the one query that could get expensive.)
7. `src/hooks/use-entry-history.ts`: `onSnapshot(collection(db,'inventoryEntries',entryId,'history'), orderBy('editedAt','asc'))`. **Mount only while the drawer is open** — one listener per open timeline, unsubscribed on close.
8. `entry-history-timeline.tsx`: vertical timeline; each node renders `changeType` as VN copy ("Tạo mới" / "Sửa" / "Xoá"), `editedByName`, `editedAt`, and a before→after diff for quantity, expiry and photo (thumbnails via `photoUrl(key)`). Show `rev` as "lần sửa thứ N". Note visibly that the name is self-reported.
9. `stock-on-hand-table.tsx`: total qty per product, batch count, nearest expiry with a warning color inside 30 days. Search by name/barcode.
10. `inventory-table.tsx` + `inventory-filters.tsx`: reuse `useEntriesFeed`. Filters — barcode equality, expiry range, "sắp hết hạn trong 30 ngày", `enteredByName`. These rely on the Phase 01 composite indexes (all include `status`). Thumbnails via plain `<img loading="lazy">` (skip the Next image optimizer — R2 is already a CDN, and the optimizer would bill Vercel).
11. `src/lib/admin-delete-entry.ts`: the 4-step sequence above. Collect keys **before** deleting history, or they become unreachable. Batch history deletes in chunks of 500.
12. `deleted-entries-table.tsx`: soft-deleted batches, with "Xem lịch sử" and "Xoá vĩnh viễn". A restore action (`status:'active'`, rev+1, history `changeType:'update'`) is cheap — include it.
13. `src/lib/export-to-excel.ts`:
    - Lazy `const writeXlsxFile = (await import('write-excel-file')).default`.
    - Schema-based columns with `width`, header `fontWeight:'bold'` + `backgroundColor`, `stickyRowsCount: 1`.
    - `Timestamp.toDate()` → real `Date` cells, `format: 'DD/MM/YYYY'` (expiry) / `'DD/MM/YYYY HH:mm'` (createdAt, updatedAt, editedAt).
    - Photo cells: `{ type:'Formula', value:'=HYPERLINK("'+photoUrl(key)+'","Xem ảnh")' }` — escape `"` in the URL.
    - Manual column widths (no auto-fit): `max(headerLen, maxCellLen) * 1.1`, clamped 10–40.
    - Filename `ton-kho-YYYYMMDD-HHmm.xlsx` via `Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Ho_Chi_Minh' })` — **not** `toISOString()` (UTC, 7h off).
    - Calibri/Arial only, for VN diacritic coverage.
    - The "Lịch sử" sheet needs one `getDocs` per entry — show progress and warn if entry count > 500.
14. `export-button.tsx`: disabled + "Đang xuất... (N/M)" during fetch; toast on completion; errors surfaced.
15. Verify in devtools that a **staff** (anonymous) session gets `permission-denied` on `deleteDoc(inventoryEntries/...)` (hard delete is admin-only) while `update` with a correct `rev` **succeeds** (staff edit rights are intended).

## Todo List

- [ ] 4.1 `write-excel-file` installed
- [ ] 4.2 `signInAdmin` / `signOutAdmin` (sign-out re-anon)
- [ ] 4.3 `auth-guard.tsx` with loading / unauth / not-admin states
- [ ] 4.4 `/login` with VN error mapping
- [ ] 4.5 `export-fetch-all.ts` cursor loop, shared by export + stock
- [ ] 4.6 `use-stock-on-hand.ts` reduce-by-barcode
- [ ] 4.7 `stock-on-hand-table.tsx` with nearest-expiry warning
- [ ] 4.8 `use-entry-history.ts` (listener only while drawer open)
- [ ] 4.9 `entry-history-timeline.tsx` with before→after diffs + photo thumbnails
- [ ] 4.10 `inventory-table.tsx` + `inventory-filters.tsx`
- [ ] 4.11 `deleted-entries-table.tsx` with restore + hard delete
- [ ] 4.12 `admin-delete-entry.ts` 4-step cascade (keys → history → doc → R2)
- [ ] 4.13 `export-to-excel.ts` 4 sheets, Date cells, HYPERLINK, widths, sticky header
- [ ] 4.14 `export-button.tsx` with progress
- [ ] 4.15 Rules tests: anon **can** update with correct rev, **cannot** hard-delete
- [ ] 4.16 Open the exported file in real Excel — diacritics, dates, links, all 4 sheets

## Success Criteria

- `/admin` redirects an unauthenticated visitor to `/login` without flashing content.
- Wrong password shows a Vietnamese message, not a raw Firebase code.
- An anonymous session can `update` an entry (correct `rev`) but gets `permission-denied` on `deleteDoc`.
- The history timeline for the user's scenario shows: "Tạo mới — 10 — A", then "Sửa — 10 → 12 — B", with correct timestamps.
- **Tồn kho** total for a product equals the sum of its active batches, and matches the staff screen's per-product total.
- Hard-deleting an entry removes the doc, every history record, and every R2 object it referenced — verified in the R2 dashboard.
- Exported `.xlsx` opens in Excel with 4 sheets, `Hạn sử dụng` sortable as a date, `Xem ảnh` opening the photo, frozen headers, correct diacritics.
- Export of 2,000 entries finishes in < 5s; the bundle without clicking export contains no xlsx code.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Someone assumes the client guard is the security boundary | Med | **High** | Rules written in Phase 01; negative test 4.15; documented in README |
| Hard delete leaves an orphaned `history` subcollection | **High** if naive | Med | Explicit 4-step cascade; Firestore does not cascade |
| Hard delete leaves orphaned R2 objects | Med | Low | Keys collected from history **before** deleting it |
| R2 delete fails midway → partial cleanup | Med | Low | Delete R2 last; failures logged and retryable; 10GB free tier absorbs leftovers |
| Stock totals computed from the `limit(200)` feed → wrong numbers | Med | **High** | `use-stock-on-hand` uses the full cursor loop, never the feed listener |
| History sheet = one `getDocs` per entry → slow/costly at scale | Med | Med | Progress UI; warn above 500 entries; make the sheet optional via a checkbox |
| Full-collection live listener added "for convenience" → cost blowup | Med | Med | Stock view is explicitly a manual/mount-time fetch, documented inline |
| Excel lib bloats the main bundle | Med | Low | Dynamic `import()` in the click handler; verified by bundle check |
| Dates export as text → admin can't sort | Med | Med | Real `Date` cells + explicit `format`; verified 4.16 |
| Photo hyperlinks break after an R2 base change | Low | Med | URLs derived from `photoKey` at export time, not stored — a base change fixes itself |
| Admin password reset needed, no UI | Low | Low | Reset from Firebase console; documented in README |

## Security Considerations

- Admin identity in rules by **UID** (immutable) rather than email. Upgrade path: `request.auth.token.admin == true`.
- The admin password is the only real user credential in the system — enforce a strong one; Firebase Auth rate-limits brute force.
- **History is append-only for everyone, including the admin** (`allow update: if false`). The admin can hard-delete a trail but cannot silently rewrite one — deletion is visible by absence, edits would not be.
- Staff now have update + soft-delete rights. This is intentional, and the reason the history trail exists: the trail is the compensating control for broad write access.
- Attribution names are self-reported and unverified (see Phase 02). The admin UI must not present them as authenticated identities.
- Export contains public photo URLs — treat the `.xlsx` as sensitive-ish.
- No `firebase-admin`, no service-account key. The only secrets are the R2 credentials (Phase 03).

## Rollback Plan

Additive UI over the Phase 02 data model. Reverting this phase leaves the staff app fully functional; only the admin surface disappears. No schema change. `admin-delete-entry.ts` is the sole destructive path — ship it behind a typed confirmation and it can be disabled independently.

## Next Steps

- Phase 05 hardens realtime + edit-conflict UX across both surfaces.

## Unresolved Questions

1. Does export honour the current dashboard filters, or always export everything? Plan assumes **everything**, filters are UI-only.
2. Will the admin ever need to **re-import** the .xlsx? `write-excel-file` is write-only — a read requirement tilts the choice back toward `exceljs`.
3. Should the "Lịch sử" sheet be on by default, or an opt-in checkbox (it is the slow part of the export)?
