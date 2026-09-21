# Phase 05 — Realtime + Edit-Conflict Hardening + VN UX Polish

> Revised 2026-09-17: mutable entries introduced a real concurrent-edit race; this phase owns the conflict UX. Unresolved-questions list trimmed to what is genuinely still open.

## Context Links

- [plan.md](plan.md)
- [research/researcher-02-firestore-data-model.md](research/researcher-02-firestore-data-model.md) (§4 realtime)
- [phase-02](phase-02-data-layer-and-barcode-scan-ui.md), [phase-03](phase-03-photo-capture-compression-upload.md), [phase-04](phase-04-admin-auth-dashboard-excel-export.md)

## Overview

- **Priority:** P2
- **Status:** pending
- **Effort:** 4h
- **Blocked by:** Phases 03 and 04
- Make concurrent multi-device use *feel* correct: pending/offline badges, **edit-conflict recovery**, duplicate protection, error recovery, VN copy, responsive layout. This is the phase that validates the "critical: real-time multi-user" requirement.

## Key Insights

- **Firestore gives latency compensation for free**: writes hit the local cache and fire listeners before the server ack. The work here is *surfacing* that state, **not** building optimistic state — hand-rolling causes double-render.
- `includeMetadataChanges: true` + `snapshot.metadata.hasPendingWrites` / `.fromCache` drive every badge in this phase.
- **The conflict path is the new headline risk.** Creates are race-free (unique doc IDs), but edits are not. The `rev` rule makes the loser fail *loudly* — this phase makes that failure recoverable instead of confusing. A rejected write appears to the user as a Firestore `permission-denied`, which is indistinguishable from a real rules bug unless we compare `rev` before deciding the message. Do that comparison in `inventory-repository`, not in the UI.
- **Offline + required photo is a hard stop.** Firestore's offline cache would happily queue the entry write, but the R2 upload cannot happen offline, and `photoKey` is required. Block the save rather than queue a write that can never satisfy the rules.
- `serverTimestamp()` resolves to `null` in the first local snapshot — every `createdAt`/`updatedAt`/`editedAt` render path needs a `?? new Date()` guard.
- Cross-cutting phase: touches files owned by 02/03/04, so it runs **after** both, never in parallel.

## Requirements

**Functional**
- Connection/state badge: "Đang gửi..." (`hasPendingWrites`), "Ngoại tuyến" (`fromCache`), otherwise silent.
- **Edit-conflict banner**: when a `rev` conflict is detected, show "⚠️ [tên] vừa cập nhật lô này (SL: 12). Số liệu đã được tải lại." with the fresh values already loaded, and the user's typed values preserved in a "giá trị bạn vừa nhập" line so nothing is lost.
- Entries changed by *other* devices show a brief "vừa cập nhật bởi X" marker.
- Duplicate-scan protection: same barcode within 2s ignored.
- Every failure path has VN copy and a retry: camera denied, compress failed, presign 401, upload failed, write denied, conflict, offline.
- Offline: save blocked with "Không có mạng — cần mạng để tải ảnh lên".
- Laptop layout: two-column (form left, batches + feed right); phone: stacked.

**Non-functional**
- No listener leaks: one feed listener per screen, one batch listener per scanned barcode, one history listener per open drawer.
- No unbounded queries — `limit(200)` on every live query.
- Lighthouse mobile performance ≥ 80 on the staff screen.

## Architecture

```
useEntriesFeed  ──► { rows, hasPendingWrites, fromCache, error }
                         ├─► <ConnectionBadge>   "Đang gửi..." / "Ngoại tuyến"
                         ├─► <InventoryFeedList> rows keyed by doc id
                         └─► error → <ErrorBanner>

Edit submit:
  updateEntry(prev, draft)
     └─ permission-denied?
           ├─ live batch list shows rev > prev.rev  → ConflictError
           │      → <ConflictBanner> with fresh values + user's typed values retained
           └─ otherwise                             → genuine rules error → generic message + log

Guard rails:
  isSubmitting → button disabled for the whole compress+presign+PUT+writeBatch window
  scan debounce (value, 2s)
  !navigator.onLine → submit blocked with explicit copy
  post-save: reset barcode/expiry/qty/photo, KEEP staffName
```

**Pagination** if 200 proves short: keep the last `QueryDocumentSnapshot`, `startAfter(lastDoc)` with a **one-shot `getDocs`**. Never stack live listeners per page.

## Related Code Files

**Create**
- `src/components/ui/connection-badge.tsx`
- `src/components/ui/error-banner.tsx`
- `src/components/ui/conflict-banner.tsx`
- `src/components/ui/confirm-dialog.tsx` (soft delete, hard delete)
- `src/components/ui/toast.tsx` (30-line inline toast — do not pull a library)
- `src/lib/error-messages.ts` — error code → VN copy map

**Modify**
- `src/lib/inventory-repository.ts` — distinguish `ConflictError` from a genuine `permission-denied`
- `src/hooks/use-entries-feed.ts` — expose `error`
- `src/components/inventory/inventory-entry-form.tsx` — submit lock, conflict handling, offline block, reset policy
- `src/components/inventory/product-batch-list.tsx` — "vừa cập nhật bởi X" marker
- `src/components/inventory/inventory-feed-list.tsx` — "mới" marker, empty state
- `src/app/page.tsx`, `src/app/admin/page.tsx` — responsive layout
- `src/app/layout.tsx` — VN metadata, `lang="vi"`, theme color, `viewport-fit`

## Implementation Steps

1. `src/lib/error-messages.ts`: one map covering `permission-denied`, `unavailable`, `NotAllowedError`, `NotFoundError`, `NotReadableError`, `auth/invalid-credential`, `auth/too-many-requests`, HTTP 401/400 from the presign route, R2 PUT failure, and `ConflictError`. Fallback: "Có lỗi xảy ra, vui lòng thử lại."
2. `inventory-repository.updateEntry` / `softDeleteEntry`: on `permission-denied`, re-read the entry once (`getDoc`) — if `serverRev > prev.rev`, throw `ConflictError(serverEntry)`; otherwise rethrow. This keeps conflict detection out of every calling component (DRY).
3. `conflict-banner.tsx`: shows who changed it (`lastEditedByName`), the new values, and the values the user had typed. Two actions: "Dùng số liệu mới" (discard typed) and "Áp dụng lại thay đổi của tôi" (re-submit against the fresh `rev`).
4. `connection-badge.tsx`: driven purely by `hasPendingWrites` / `fromCache`. Silent when healthy — no permanent green-dot noise.
5. Audit every `createdAt` / `updatedAt` / `editedAt` render site for the `?? new Date()` guard.
6. Submit lock in the entry form: a single `isSubmitting` covering compress → presign → PUT → `writeBatch`. Re-enable in `finally`.
7. Offline block: disable submit when `!navigator.onLine`; listen to the `online`/`offline` events so it re-enables without a reload.
8. Batch list: mark rows updated in the last 10s with "vừa cập nhật bởi X". Feed list: "mới" highlight + empty state ("Chưa có dữ liệu — quét mã để bắt đầu").
9. Stale-product-name check: if a scanned barcode's stored `name` differs from what the user typed, confirm before overwriting (the `merge:true` upsert is last-write-wins). A confirm, not a merge UI.
10. Responsive pass at 360/390/768/1280. Tap targets ≥ 44px. `inputMode="numeric"` for quantity; native `<input type="date">` for expiry.
11. Listener audit: one feed listener per screen; `use-product-batches` unsubscribes when the barcode changes; `use-entry-history` unsubscribes on drawer close. Verify by navigating away and watching the Firestore debug log.
12. **Two-device acceptance tests** (the requirements that matter):
    - *Create:* two phones, 20 entries in 60s, alternating and simultaneous → exactly 20 docs, identical lists.
    - *Edit:* both phones open the same batch, both change the quantity, both submit within ~1s → one commits, the other shows the conflict banner with the winner's value. Repeat 5x; **zero silent overwrites**.
    - *Scenario:* A creates (qty 10) → B edits to 12 → A's screen shows 12 → history has both records in order.
13. Offline test: airplane mode → save blocked with the photo message; an *existing* entry's soft delete still queues locally (no upload needed) and commits on reconnect.
14. Optional: enable **App Check** (reCAPTCHA Enterprise) if anon-auth abuse is a concern. Note it adds a domain-registration step per deploy target and must also gate the presign route.

## Todo List

- [ ] 5.1 `error-messages.ts` VN map covering all known codes incl. presign HTTP errors
- [ ] 5.2 `ConflictError` detection centralized in `inventory-repository`
- [ ] 5.3 `conflict-banner.tsx` with both recovery actions
- [ ] 5.4 `connection-badge.tsx` wired to metadata flags
- [ ] 5.5 Timestamp null-guard audit complete
- [ ] 5.6 Submit lock across compress+presign+PUT+writeBatch
- [ ] 5.7 Offline submit block + `online`/`offline` listeners
- [ ] 5.8 "vừa cập nhật bởi X" + "mới" markers + empty states
- [ ] 5.9 Stale product-name confirm before overwrite
- [ ] 5.10 Responsive pass at 360/390/768/1280
- [ ] 5.11 Listener leak audit (feed / batches / history)
- [ ] 5.12 Two-device **create** test (20 entries) passes
- [ ] 5.13 Two-device **concurrent edit** test (5 rounds) — zero silent overwrites
- [ ] 5.14 User's A→B scenario verified end-to-end incl. history order
- [ ] 5.15 Lighthouse mobile ≥ 80 on `/`
- [ ] 5.16 Decision recorded on App Check

## Success Criteria

- **Two phones, 20 entries in 60s: exactly 20 documents, zero lost writes, both screens identical within 2s.**
- **Two phones editing the same batch: one wins, the other sees a Vietnamese conflict banner with the fresh value — never a silent overwrite, never a raw `permission-denied`.**
- The writer's own device shows its change immediately with an "Đang gửi..." badge that clears on commit.
- Offline save attempt is blocked with a clear photo-related message, not a mysterious failure.
- No error is ever shown as a raw Firebase code or HTTP status.
- Staff screen is one-handed usable at 360px; admin tables readable at 1280px.
- Navigating away from any screen leaves zero active listeners.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Conflict shown as a raw `permission-denied` → looks like a broken app | **High** if unhandled | High | Centralized `ConflictError` detection (5.2) + dedicated banner |
| Conflict banner loses the user's typed values | Med | Med | Banner retains and can re-apply them |
| Hand-rolled optimistic state added "for safety" → double entries in UI | Med | Med | Documented: rely on latency compensation only |
| Timestamp null crash on the writer's device | **High** if unguarded | High | Audit 5.5 |
| Double-submit creates duplicate batches | Med | Med | `isSubmitting` lock + 2s scan debounce |
| Offline save queued but unsatisfiable (no photo) | Med | Med | Hard block + explicit copy (5.7) |
| Listener leak from per-scan batch listeners | Med | Med | Audit 5.11 — this hook re-subscribes on every scan |
| Product name overwritten by a typo from another device | Med | Med | Confirm-before-overwrite (5.9) |
| Feed `limit(200)` hides older entries during a big stock count | Med | Low | "Xem thêm" via `startAfter` one-shot fetch |

## Security Considerations

- Error messages must not leak rule internals — map `permission-denied` to a generic VN message once a conflict has been ruled out.
- The conflict banner reveals another staff member's self-reported name; that is intended and harmless here.
- App Check is the only real defense against scripted anon-auth writes and presign-route abuse; rules and the presign route limit blast radius (field shape, size, key shape) but not volume.
- Confirm dialogs on both soft delete and hard delete; hard delete is unrecoverable and destroys the audit trail.

## Rollback Plan

Additive UI + guards. Rollback = revert the commit range; Phases 02–04 remain functional (minus banners and guards), though concurrent edits would then fail with a raw error rather than a friendly one. No schema change, no rules change — unless App Check is enabled, which is toggled in the Cloudflare/Firebase consoles independently of the code.

## Next Steps

- Unblocks Phase 06. **Do not deploy to production before 5.12, 5.13 and 5.14 pass.**

## Unresolved Questions (consolidated, current)

1. **Multi-store / multi-location later?** If yes, add `storeId` now and prefix every composite index with it — cheap today, painful after there is data.
2. **Repo private + custom domain, or `*.vercel.app`?** Also decides whether the R2 bucket gets a custom domain or stays on rate-limited `r2.dev`.
3. **Device floor** — any iOS < 16 or sub-2GB Android phones in the staff fleet? Affects WASM scanning and photo memory limits.
4. **Is a publicly-readable photo bucket acceptable**, or should photos be proxied behind auth? (Proxying breaks durable Excel hyperlinks and bills Vercel bandwidth.)
5. **App Check** — enable now, or wait for evidence of abuse?
6. **Same-expiry rescan** — auto-merge into the existing batch, or always offer "sửa lô / thêm lô mới"? Plan currently always offers the choice.

*Resolved 2026-09-17 and removed: Blaze billing (moot — R2 replaces Firebase Storage); photo required (yes); stock-on-hand totals (yes, derived from active batches); staff edit/delete rights (yes, with history trail); offline behavior with a required photo (block the save); entry mutability (mutable + soft delete); admin-only editing (superseded).*
