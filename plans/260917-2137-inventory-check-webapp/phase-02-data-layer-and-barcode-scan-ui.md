# Phase 02 — Data Layer + Barcode Scan + Batch Lookup + Entry Form

> Revised 2026-09-17: entries are now **mutable batches** with a history trail; scanning shows existing open batches so staff can correct one or add a new one; staff identity via a name prompt stored in `localStorage`.

## Context Links

- [plan.md](plan.md)
- [research/researcher-01-barcode-scanning.md](research/researcher-01-barcode-scanning.md)
- [research/researcher-02-firestore-data-model.md](research/researcher-02-firestore-data-model.md) (baseline; schema amended in [phase-01](phase-01-project-scaffold-and-firebase-setup.md#firestore-schema-amended))

## Overview

- **Priority:** P1 (core of the app)
- **Status:** pending
- **Effort:** 7h
- **Blocked by:** Phase 01
- The staff screen: name-once prompt → scan or type a barcode → see the product **and its open batches** → either **sửa lô** (correct qty/expiry/photo of an existing batch) or **thêm lô mới** → live shared feed.

## Key Insights

- **`BarcodeDetector` is unavailable on iOS in 2026** (all iOS browsers are WebKit; Shape Detection flagged off, broken since iOS 18). Use `barcode-detector/ponyfill` (ZXing-C++ WASM) as the *single* code path. `html5-qrcode` is dead (2023); `@zxing/*` are slow pure-JS ports.
- **Restricting formats is the single biggest perf win** — ZXing runs one reader pass per enabled format.
- **Creation is still race-free** (doc-per-entry `setDoc` with a pre-generated ID). **Editing is not.** Two staff correcting the same batch is a genuine lost-update race, solved by the rules-enforced `rev == resource.rev + 1` — the second writer is *rejected*, not silently overwritten.
- **Entry update + history append must be one `writeBatch`.** Batches are atomic and reads-free; if the `rev` rule rejects the entry update, the history record is rejected with it. A transaction would add a round-trip for no benefit here.
- **Firestore does not delete subcollections with the parent doc** → staff "delete" is a **soft delete** (`status: 'deleted'` + a `changeType:'delete'` history record). Hard delete is admin-only and must clear `history` explicitly.
- **Do not hand-roll optimistic UI.** Firestore latency compensation already applies writes to the local cache and fires listeners before the server ack.
- Product doc ID **is** the barcode → zero-query lookup; `setDoc(..., {merge:true})` makes the "two phones first-scan the same new barcode" race a non-event.
- The staff name is **self-reported and unverified**. It is a convenience label, not an identity. `createdByUid` / `lastEditedByUid` are the only trustworthy attribution.

## Requirements

**Functional**
- First visit: blocking prompt "Tên của bạn" → saved to `localStorage.staffName`. Never asked again; changeable from a settings affordance in the header.
- Manual barcode text input always available (permanent escape hatch).
- "Quét mã" opens the camera; scans EAN-13/EAN-8/UPC-A/UPC-E/CODE-128.
- Known barcode → shows product name **plus a list of active batches** (expiry, qty, thumbnail, who entered it, last edited), sorted by expiry ascending, with **total tồn kho** for that product.
- Each batch row → "Sửa" (loads it into the form in edit mode) and "Xoá" (soft delete, with confirm).
- "Thêm lô mới" → empty form pre-filled with the product name.
- Unknown barcode → no batch list, name field empty and required.
- Photo is **required** on both create and edit (an edit that keeps the existing photo reuses its `photoKey` — no re-upload).
- Live feed of the latest 200 active entries, newest first, updating across devices.

**Non-functional**
- Scanner component is client-only, dynamically imported, `ssr:false`.
- Mobile-first; one-handed; tap targets ≥ 44px; VN labels throughout.
- Camera stream fully released on unmount.

## Architecture

**Data flow — scan to batch decision**

```
first visit → <StaffNamePrompt> → localStorage.staffName
     ↓
tap "Quét mã" → getUserMedia({facingMode:{ideal:'environment'}})   [tap handler, iOS requirement]
     ↓ setInterval(120ms) → rAF → detector.detect(video)
normalizeBarcode()  (UPC-A → 13 digits, mod-10 check digit)
     ↓ debounce (same value within 2s ignored)
     ├─ getDoc(products/{barcode})                              → product name (1 read, no query)
     └─ onSnapshot(inventoryEntries
            where barcode == x, where status == 'active',
            orderBy expiryDate asc)                             → OPEN BATCHES (live)
     ↓
     ┌──────────────── user decides ────────────────┐
     │ "Sửa lô"  (existing entryId, rev known)      │ "Thêm lô mới"
     ↓                                              ↓
 photo: keep existing photoKey OR re-upload    photo: upload (required)
     ↓                                              ↓
 writeBatch:                                   writeBatch:
   update inventoryEntries/{id}                  set inventoryEntries/{newId}  (rev 1, status active)
     rev: rev + 1, updatedAt: serverTimestamp     create .../history/{id} changeType 'create'
     lastEditedByUid/Name                            ↓
   create .../history/{id} changeType 'update'   setDoc(products/{barcode}, {merge:true})
     prev* snapshot + new* values
     ↓ rules check rev == resource.rev + 1
     ├─ pass → committed, all devices update via onSnapshot
     └─ FAIL → "Ai đó vừa cập nhật lô này" + refresh from the live batch list
```

**Stock on hand** for the scanned product = client-side sum of `quantity` over the already-loaded active batch list. Free, exact, no extra query. (Admin's all-product totals use a different path — see Phase 04.)

**Soft delete**: `writeBatch` → update entry `{ status:'deleted', rev+1, updatedAt, lastEditedBy* }` + history `{ changeType:'delete', prev* }`. Same `rev` rule applies, so deletes race-check too.

Schema, rules and indexes: see [phase-01](phase-01-project-scaffold-and-firebase-setup.md#firestore-schema-amended).

## Related Code Files

**Create**
- `src/types/inventory.ts` — `Product`, `InventoryEntry`, `HistoryRecord`, `EntryDraft`, plus `ENTRY_FIELDS` (single source matching the rules whitelist)
- `src/lib/barcode-utils.ts` — `normalizeBarcode()`, `isValidEan()` (mod-10), `BARCODE_FORMATS`
- `src/lib/date-utils.ts` — `toVnMidnightTimestamp()`, `formatVnDate()`
- `src/lib/inventory-repository.ts` — `lookupProduct`, `upsertProduct`, `createEntry`, `updateEntry`, `softDeleteEntry` (all history-aware, all `writeBatch`)
- `src/lib/history-utils.ts` — builds the history record from `(prev, next, changeType, staff)`; keeps the diff logic in one place (DRY)
- `src/hooks/use-barcode-scanner.ts` — camera + detect loop + cleanup
- `src/hooks/use-entries-feed.ts` — `onSnapshot`, `status=='active'`, `orderBy createdAt desc`, `limit(200)`
- `src/hooks/use-product-batches.ts` — `onSnapshot` of active batches for one barcode + derived total
- `src/hooks/use-staff-name.ts` — `localStorage` read/write + `hasName` flag
- `src/components/staff/staff-name-prompt.tsx` — first-visit blocking modal
- `src/components/staff/staff-name-badge.tsx` — header chip + "đổi tên" affordance
- `src/components/scanner/barcode-scanner-modal.tsx` — video overlay, guarded torch button
- `src/components/scanner/barcode-input-field.tsx` — manual input + "Quét" trigger
- `src/components/inventory/product-batch-list.tsx` — open batches + total + Sửa/Xoá actions
- `src/components/inventory/inventory-entry-form.tsx` — create **and** edit modes
- `src/components/inventory/inventory-feed-list.tsx`
- `src/components/inventory/inventory-entry-card.tsx`

**Modify**
- `src/app/page.tsx` — staff screen composition
- `package.json` — `npm i barcode-detector`

## Implementation Steps

1. `npm i barcode-detector` (v3.2.2).
2. `src/types/inventory.ts` — mirror the Phase 01 schema exactly. Export `ENTRY_CREATE_FIELDS` / `ENTRY_UPDATE_FIELDS` arrays so the rules whitelist and the client payload can never drift.
3. `src/lib/barcode-utils.ts`: `BARCODE_FORMATS = ["ean_13","ean_8","upc_a","upc_e","code_128"]`; `normalizeBarcode` (trim, strip non-alphanumerics, left-pad 12-digit UPC-A to 13); `isValidEan` mod-10 — reject before hitting Firestore. Reject anything containing `/` (illegal in a doc ID).
4. `src/lib/date-utils.ts`: build expiry at **local midnight Asia/Ho_Chi_Minh**, then `Timestamp.fromDate`; emit the `YYYY-MM-DD` mirror from the same source of truth.
5. `src/hooks/use-staff-name.ts`: read `localStorage.staffName` on mount (guard SSR — `useEffect`, not module scope). Expose `{ staffName, hasName, setStaffName }`. Trim to 1–40 chars to match the rules.
6. `src/components/staff/staff-name-prompt.tsx`: renders only when `!hasName`; blocks interaction with the form (writes would be rejected by rules without a valid name anyway). `staff-name-badge.tsx` shows the current name in the header and reopens the prompt on tap.
7. `src/hooks/use-barcode-scanner.ts` per research-01 §4:
   - `start()` **from a tap handler** (iOS requirement).
   - `await import("barcode-detector/ponyfill")` inside the effect; `prepareZXingModule` + a 1×1 dummy detect on mount to prewarm (saves 300–800ms).
   - `setInterval(120ms)` pacing wrapping one `requestAnimationFrame`; `inFlight` guard.
   - Duplicate debounce `(value, 2000ms)`; `navigator.vibrate?.(60)` on hit.
   - Cleanup: stop every track, null `srcObject`, clear interval, cancel rAF; idempotent for StrictMode.
   - Re-acquire on `visibilitychange` and `track.onended`.
   - Map `NotAllowedError` / `NotFoundError` / `NotReadableError` to VN copy.
8. `barcode-scanner-modal.tsx`: `<video playsInline muted autoPlay>` (non-negotiable on iOS), scan-band overlay (80% w × 30% h), torch button **only if** `track.getCapabilities().torch === true`. Load via `next/dynamic({ ssr:false })`.
9. `src/hooks/use-product-batches.ts`: `onSnapshot(query(collection(db,'inventoryEntries'), where('barcode','==',bc), where('status','==','active'), orderBy('expiryDate','asc')))`. Returns `{ batches, totalQuantity, loading }`. Unsubscribe when the barcode changes or the component unmounts — this listener is re-created on every scan, so leaks are easy here.
10. `src/lib/history-utils.ts`: `buildHistoryRecord(prev | null, next, changeType, { uid, name }, rev)` → the exact history document. All three repository write paths use it — one place to change if the trail format evolves.
11. `src/lib/inventory-repository.ts`:
    - `lookupProduct(barcode)` → `getDoc(doc(db,'products',barcode))`.
    - `upsertProduct({barcode,name,unit})` → `setDoc(..., {merge:true})`, `updatedAt: serverTimestamp()`. No `createdAt` on product docs so merge can't clobber.
    - `createEntry(draft, staff)` → pre-generate `entryId = doc(collection(db,'inventoryEntries')).id` (Phase 03 needs it for the photo key), then `writeBatch`: `set(entry, { rev:1, status:'active', createdAt/updatedAt: serverTimestamp() })` + `set(history, changeType:'create')`.
    - `updateEntry(prev, draft, staff)` → `writeBatch`: `update(entry, { ...draft, rev: prev.rev + 1, updatedAt: serverTimestamp(), lastEditedBy* })` + `set(history, changeType:'update')` with `prev*` and `new*` values.
    - `softDeleteEntry(prev, staff)` → `writeBatch`: `update(entry, { status:'deleted', rev: prev.rev + 1, ... })` + `set(history, changeType:'delete')`.
    - Every path catches `permission-denied` and rethrows a typed `ConflictError` when `prev.rev` is stale, so the UI can show the right message.
12. `src/hooks/use-entries-feed.ts`: `onSnapshot(q, { includeMetadataChanges: true }, ...)` with `where('status','==','active')`, `orderBy('createdAt','desc')`, `limit(200)`. Expose `hasPendingWrites` / `fromCache`. Return `unsub`. Guard `createdAt?.toDate() ?? new Date()` — `serverTimestamp()` is `null` in the first local snapshot.
13. `product-batch-list.tsx`: one row per active batch — expiry (VN format), qty, thumbnail (from `photoUrl(photoKey)`), `enteredByName`, "đã sửa bởi X" when `lastEditedByName !== enteredByName`. Header shows **"Tồn kho: N"**. Actions: "Sửa", "Xoá" (confirm). Empty state: "Chưa có lô nào — thêm lô mới".
14. `inventory-entry-form.tsx`: single component, two modes.
    - `mode: 'create' | 'edit'`; in edit mode it carries `entryId` and `rev`.
    - Client validation mirrors the rules (qty int 1–100000, name ≤120, note ≤500, photo present).
    - Submit disabled during the whole compress+upload+write window (Phase 03 wires the upload).
    - On success: reset barcode/expiry/qty/photo, **keep the staff name**, and return to create mode.
    - On `ConflictError`: show "Ai đó vừa cập nhật lô này. Đã tải lại số liệu mới." and reload the row from the live batch list rather than retrying blind.
15. `src/app/page.tsx`: header (staff name badge + connection badge) → barcode field → product card → batch list → entry form → feed list.

## Todo List

- [ ] 2.1 `barcode-detector` installed; WASM prewarm verified
- [ ] 2.2 `types/inventory.ts` incl. `ENTRY_*_FIELDS` matching the rules whitelist
- [ ] 2.3 `barcode-utils.ts` normalize + mod-10, unit-tested
- [ ] 2.4 `date-utils.ts` VN-midnight Timestamp + `YYYY-MM-DD` mirror, unit-tested
- [ ] 2.5 `use-staff-name.ts` + `staff-name-prompt.tsx` + `staff-name-badge.tsx`
- [ ] 2.6 `use-barcode-scanner.ts` with full cleanup + visibilitychange re-acquire
- [ ] 2.7 `barcode-scanner-modal.tsx` (playsInline/muted/autoPlay, scan band, guarded torch)
- [ ] 2.8 `use-product-batches.ts` live batch list + total, listener swapped cleanly per scan
- [ ] 2.9 `history-utils.ts` single history-record builder
- [ ] 2.10 `inventory-repository.ts`: create / update / soft-delete, each a `writeBatch` with history
- [ ] 2.11 `ConflictError` surfaced from stale-`rev` rejections
- [ ] 2.12 `use-entries-feed.ts` with `status=='active'` + metadata flags + unsubscribe
- [ ] 2.13 `product-batch-list.tsx` with total, Sửa/Xoá
- [ ] 2.14 `inventory-entry-form.tsx` create + edit modes
- [ ] 2.15 `inventory-feed-list.tsx` + `inventory-entry-card.tsx`
- [ ] 2.16 `src/app/page.tsx` composed, mobile-first
- [ ] 2.17 Two-device concurrent **create** test passes
- [ ] 2.18 Two-device concurrent **edit of the same batch** test: one wins, one gets ConflictError

## Success Criteria

- On a real iPhone (Safari) and Android (Chrome), a printed EAN-13 scans in < 2s from tapping "Quét mã".
- Camera LED goes off immediately when the modal closes.
- **Scenario test (user's own):** A scans `X`, enters "bánh choco", HSD 10/12/2026, SL 10 → saved. B scans `X` on another phone → sees name + that batch with qty 10 → B edits qty to 12 → A's screen shows 12 within 2s → a history record exists with `prevQuantity: 10`, `newQuantity: 12`, `editedByName: "B"`.
- B can instead choose "Thêm lô mới" with a different expiry → two batches listed, total = sum of both.
- Two phones editing the same batch simultaneously: one commits, the other gets a VN conflict message — **never** a silent overwrite.
- Soft-deleted batches vanish from the list and the feed but their history is still readable.
- Name prompt appears exactly once per device; the name auto-attaches to every write afterwards.
- A write with `quantity: 0`, a missing `photoKey`, or a non-incrementing `rev` is rejected by rules (verified in devtools).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| iOS camera fails (no HTTPS / no user gesture / missing `playsInline`) | **High** | High | HTTPS-only testing; `start()` only from tap; explicit attrs as a review checklist item |
| **Lost update on concurrent batch edit** | **High** (new) | **High** | Rules-enforced `rev` increment + `writeBatch` atomicity + `ConflictError` UX; test 2.18 |
| History write succeeds but entry update fails (or vice versa) | Med | High | Single `writeBatch` — atomic by construction. Never two separate awaits |
| Hard delete orphans the history subcollection | Med | Med | Staff path is soft delete only; rules deny staff `delete` |
| Cheap-phone camera can't focus on small EAN | Med | High | 1280×720+, scan-band crop, "giữ cách 10–20cm" hint, manual entry fallback |
| Misread barcode creates a junk product doc | Med | Med | mod-10 check digit before lookup; admin can delete products |
| Wrong expiry date by one day (TZ) | Med | Med | `expiryDateStr` mirror is the display/export source |
| `use-product-batches` listener leaks on rapid re-scans | Med | Med | Unsubscribe keyed on barcode; audited in Phase 05 |
| Rules `hasOnly` mismatch → all writes denied | Med | High | `ENTRY_*_FIELDS` in `types/inventory.ts` as the single source |
| Staff name blank/garbage → useless attribution | Med | Low | 1–40 char validation client-side **and** in rules |
| Feed listener cost grows unbounded | Low | Med | `limit(200)` always; pagination via `startAfter` one-shot `getDocs` |

## Security Considerations

- Every write carries `lastEditedByUid == request.auth.uid` (rule-enforced) and, on create, `createdByUid`. **These are the only trustworthy attribution.**
- **Known, accepted trust tradeoff:** `enteredByName` / `editedByName` are self-reported free text from `localStorage`. Anyone can type any name, or clear storage and pick another. The user explicitly chose this over staff accounts. The history trail is therefore *tamper-evident for data* (rules pin `createdAt`, `enteredByName`, and force monotonic `rev`) but *not identity-proof for people*. If attribution ever needs to be dependable, staff accounts — not more client-side validation — is the fix.
- `createdAt` / `updatedAt` / `editedAt` are pinned to `request.time`, blocking spoofed timestamps.
- History is append-only: `allow update: if false` for everyone, including the admin.
- Staff can soft-delete but not hard-delete, so the trail survives.
- Barcode is a doc ID → sanitize (`/`, `.`, `..`, ≤1500 bytes) before any `doc()` call.
- Anonymous auth is scriptable; App Check is the mitigation if abuse appears (Phase 05).

## Next Steps

- Unblocks Phase 03 (photo → R2) and Phase 04 (admin, history view, stock totals) — parallel-safe.
- The form leaves the photo slot stubbed; Phase 03 fills it and enforces "photo required".

## Unresolved Questions

1. Are internal labels CODE-128/QR, or manufacturer EAN-13 only? Trimming the format list is a direct speed win.
2. Repeat scan of a barcode that already has a batch with the **same expiry** — merge into that batch automatically, or still offer both choices? Plan currently always offers the choice (explicit > clever).
