# Phase 03 — Photo Capture, Compression, Cloudflare R2 Upload

> Revised 2026-09-17: Firebase Storage SDK replaced by presigned PUT to Cloudflare R2 via a Next.js API route. Photo is now **required** on every entry.

## Context Links

- [plan.md](plan.md)
- [research/researcher-03-image-compression-upload.md](research/researcher-03-image-compression-upload.md) (compression findings still apply verbatim; the upload half is superseded below)
- [phase-01](phase-01-project-scaffold-and-firebase-setup.md) (R2 bucket, CORS, env vars)
- [phase-02](phase-02-data-layer-and-barcode-scan-ui.md) (form integration, `photoKey` field)

## Overview

- **Priority:** P1
- **Status:** pending
- **Effort:** 4h
- **Blocked by:** Phase 02
- **Parallel-safe with:** Phase 04 (disjoint files)
- Take/pick a photo, compress client-side to well under 3MB, upload **direct to R2** via a short-lived presigned PUT, and store the object key on the inventory entry.

## Key Insights

- **`browser-image-compression@2.0.2` is the only candidate that iterates to a byte target** (binary-search re-encode on `maxSizeMB`). `compressorjs` only sets a quality and hopes. Caveat: stale (last publish 2023-03) despite 1.1M dl/wk — **pin it**; migration path is compressorjs + a manual quality-step-down loop.
- **HEIC is the real trap.** Safari transcodes HEIC→JPEG *only when `accept` names concrete types*. With `accept="image/*"` you get raw HEIC, which **no browser's canvas can decode**. Two belts: `accept="image/jpeg,image/png"` **and** a runtime `isHeic()` guard that dynamic-imports `heic-to`.
- **Use `<input type="file">`, not `getUserMedia`, for the photo.** The native picker opens the real camera app (autofocus, macro, full sensor). getUserMedia yields ~1–2MP grabs that can't read expiry print. getUserMedia stays reserved for barcode scanning.
- **Upload direct to R2, never through the Vercel function.** Routing the bytes through a serverless function would hit the 4.5MB request-body limit and burn execution time. The function only signs; the browser does the transfer.
- **The presign route needs auth, and we still don't want `firebase-admin`.** Verify the Firebase ID token with `jose` against Google's public JWKS (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`, issuer `https://securetoken.google.com/<projectId>`, audience `<projectId>`). No service-account secret required — only the project ID we already have.
- **A presigned PUT can enforce size and type** by signing `Content-Type` and `Content-Length` as required headers. The client declares the compressed byte length; the server caps it at 3MB and signs *that exact length*. A mismatched upload is rejected by R2.
- **Never delete the old photo when an entry is edited** — the history record references `prevPhotoKey`. Deleting it would break the trail. Old objects are only removed on admin hard-delete.
- Low-end Android: a 12MP decode is ~48MB RGBA against a ~256MB tab budget. **Compress strictly serially, never `Promise.all`.**

## Requirements

**Functional**
- "Chụp ảnh" (camera-direct) and "Chọn ảnh" (gallery) buttons — `capture` suppresses the gallery option, so both are needed.
- Preview shows the **compressed** file (what actually uploads).
- Upload progress; submit blocked until the upload completes and a `photoKey` exists.
- **Photo required** on create. On edit, the existing photo is kept by default (no re-upload, `photoKey` unchanged); replacing it is an explicit action.
- Offline: block the save with a clear message (Firestore's offline cache does **not** cover the R2 upload).

**Non-functional**
- Output < 3MB hard, target 350–700KB.
- Compression off the main thread (`useWebWorker: true`).
- R2 credentials never reach the client bundle.
- No memory crash on a sub-2GB Android.

## Architecture

```
<input type="file" accept="image/jpeg,image/png" [capture="environment"]>
   ↓ File
isHeic(file)? → dynamic import heic-to → heicTo({type:'image/jpeg'})     [wasm, lazy]
   ↓ Blob
imageCompression(file, { maxSizeMB:1.5, maxWidthOrHeight:2048,
                         useWebWorker:true, initialQuality:0.8,
                         fileType:'image/jpeg', preserveExif:false })      [serial queue]
   ↓ File   assert size > 0   ← blank-canvas guard (iOS px cap)
URL.createObjectURL → preview   (revokeObjectURL on unmount/retake)
   ↓
POST /api/photos/presign  { entryId, size, contentType }  + Authorization: Bearer <firebase idToken>
   │   server: verify token (jose + Google JWKS)
   │           reject size > 3MB or contentType != image/jpeg
   │           key = `entries/${entryId}/${Date.now()}-${rand6}.jpg`
   │           sign PutObjectCommand (ContentType + ContentLength), expiresIn 300
   ↓ { url, key }
PUT url  (body = compressed File, headers must match signed values exactly)
   ↓ 200
photoKey = key      ← stored on the entry; public URL derived via photoUrl(key)
   ↓
writeBatch: entry + history   (Phase 02 repository)
   ↓ on Firestore failure → POST /api/photos/delete { key }   // compensating delete
```

`NEXT_PUBLIC_R2_PUBLIC_BASE + '/' + photoKey` is the read URL. Nothing stores a full URL, so the public base can change without touching data.

## Related Code Files

**Create**
- `src/app/api/photos/presign/route.ts` — POST, token-verified, returns `{ url, key }`
- `src/app/api/photos/delete/route.ts` — POST, token-verified, deletes by key (compensating delete + admin hard-delete)
- `src/lib/server/verify-firebase-token.ts` — `jose` JWKS verification (server-only)
- `src/lib/server/r2-client.ts` — S3 client configured for R2 (server-only)
- `src/lib/photo-compression.ts` — `compressPhoto(file): Promise<File>` (HEIC guard + compression + size assert + serial queue)
- `src/lib/photo-upload.ts` — `uploadPhoto(file, entryId, idToken, onProgress)` → `{ key }`; `deletePhoto(key, idToken)`
- `src/components/photo/photo-capture-field.tsx` — dual inputs, preview, progress, "giữ ảnh cũ" in edit mode

**Modify**
- `src/components/inventory/inventory-entry-form.tsx` — replace the Phase 02 photo stub; enforce required
- `package.json` — `npm i browser-image-compression@2.0.2 heic-to @aws-sdk/client-s3 @aws-sdk/s3-request-presigner jose`

## Implementation Steps

1. `npm i browser-image-compression@2.0.2 heic-to @aws-sdk/client-s3 @aws-sdk/s3-request-presigner jose` (exact pin on the first).
   *Optional later:* `aws4fetch` (~5KB) can replace the two AWS SDK packages for presigning if cold-start size ever matters. Not now — the user specified the AWS SDK.
2. `src/lib/server/r2-client.ts`:
   ```ts
   new S3Client({ region: 'auto',
     endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
     credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
   ```
   Files under `src/lib/server/` are imported **only** from `src/app/api/` — add an ESLint boundary note in the README.
3. `src/lib/server/verify-firebase-token.ts`: `createRemoteJWKSet` against Google's securetoken JWKS; `jwtVerify` with `issuer: 'https://securetoken.google.com/'+projectId`, `audience: projectId`. Return `{ uid: payload.sub }` or throw. Cache the JWKS at module scope (the helper does this).
4. `src/app/api/photos/presign/route.ts`:
   - `export const runtime = 'nodejs'` (AWS SDK needs Node).
   - Verify the bearer token; 401 on failure.
   - Validate `size <= 3 * 1024 * 1024` and `contentType === 'image/jpeg'`; 400 otherwise.
   - Validate `entryId` against `/^[A-Za-z0-9_-]{16,32}$/` — it goes into the object key.
   - Key: `entries/${entryId}/${Date.now()}-${rand6}.jpg`.
   - `getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), { expiresIn: 300 })`.
   - Return `{ url, key }`. Never return or log the credentials.
5. `src/app/api/photos/delete/route.ts`: verify token, validate the key matches `^entries/[A-Za-z0-9_-]+/[0-9]+-[a-z0-9]{6}\.jpg$`, `DeleteObjectCommand`. Keeps deletion server-side so no client ever holds delete rights.
6. `src/lib/photo-compression.ts` per research-03:
   - dynamic `await import('heic-to')`, `isHeic(file)` → convert at quality 0.9 first.
   - `imageCompression` with the locked options (`maxSizeMB: 1.5`, `maxWidthOrHeight: 2048`).
   - `if (!out.size) throw` — iOS silently returns a blank canvas above ~16.7M px.
   - Module-level serial queue (promise chain) so two rapid picks never decode concurrently.
7. `src/lib/photo-upload.ts`:
   - `const idToken = await auth.currentUser!.getIdToken()` → POST presign.
   - PUT via `XMLHttpRequest` (not `fetch`) to get real `upload.onprogress`; headers `Content-Type: image/jpeg` exactly as signed.
   - Retry wrapper: 3 tries at 1s/2s/4s on network failure. **Re-presign on each retry** — the URL is only valid 5 minutes and a retry may follow a long stall.
   - Below ~1MB show an indeterminate spinner rather than a jumpy percentage.
8. `src/components/photo/photo-capture-field.tsx`:
   - Two `<input>`s: one with `capture="environment"`, one without.
   - `if (!e.target.files?.length) return` — iOS fires `change` with an empty list on cancel.
   - `e.target.value = ''` in the handler — iOS won't re-fire `change` for the identical file.
   - `URL.revokeObjectURL` on unmount and on retake.
   - `img { image-orientation: from-image }` on the raw preview.
   - **Edit mode:** render the existing photo from `photoUrl(photoKey)` with "Giữ ảnh cũ" selected by default and a "Đổi ảnh" action.
9. Wire into `inventory-entry-form.tsx`: submit is disabled until `photoKey` is non-empty (create) or unchanged-and-present (edit). Block submit entirely when `!navigator.onLine` with "Không có mạng — ảnh không thể tải lên".
10. Compensating delete: on a Firestore write failure **for a create**, call `/api/photos/delete` with the new key. On an **edit**, do **not** delete anything — the new key is orphaned only if the batch write failed (delete that one), and the old key must survive for history.
11. Negative tests against the presign route: no token → 401; expired/garbage token → 401; `size: 5_000_000` → 400; `contentType: 'image/png'` → 400; PUT with a body longer than the signed `ContentLength` → R2 rejects.

## Todo List

- [ ] 3.1 Deps installed and pinned
- [ ] 3.2 `r2-client.ts` + `verify-firebase-token.ts` (server-only)
- [ ] 3.3 `/api/photos/presign` with token + size + type + entryId validation
- [ ] 3.4 `/api/photos/delete` with key-shape validation
- [ ] 3.5 `photo-compression.ts` with HEIC guard, size assert, serial queue
- [ ] 3.6 `photo-upload.ts` XHR PUT with progress, re-presign on retry
- [ ] 3.7 `photo-capture-field.tsx` (dual inputs, preview, iOS guards, keep-old-photo in edit mode)
- [ ] 3.8 Form enforces photo-required + offline block
- [ ] 3.9 Compensating delete on create-failure only (never on edit)
- [ ] 3.10 Negative tests on the presign route (401/400 paths)
- [ ] 3.11 Real-device test: iPhone HEIC photo, Android 12MP photo
- [ ] 3.12 Bundle check: `R2_SECRET_ACCESS_KEY` absent from every client chunk

## Success Criteria

- An iPhone photo taken via the app uploads successfully (HEIC path exercised, not crashed).
- A 12MP Android photo produces 200KB–1.5MB output; never above 3MB.
- An expiry date printed on a real product label is **legible in the uploaded image**.
- The uploaded object is publicly readable at `NEXT_PUBLIC_R2_PUBLIC_BASE + '/' + key`.
- `/api/photos/presign` returns 401 without a valid Firebase ID token.
- Forcing the Firestore write to fail on a **create** leaves **no** object in R2.
- Editing an entry's photo leaves the **old** object in place (history intact).
- No tab crash after 10 consecutive photos on a low-end Android.
- Searching every built client chunk for the R2 secret returns nothing.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| R2 secret leaks into the client bundle | Med | **Critical** | Server-only `src/lib/server/` imported solely from `src/app/api/`; grep check 3.12 |
| Presign route left unauthenticated → open upload endpoint | Med | **High** | `jose` JWKS verification is a required step, not optional; negative test 3.10 |
| CORS misconfigured → PUT blocked (often only on preview URLs) | **High** | High | `https://*.vercel.app` wildcard from day one; verified on a preview deploy in Phase 06 |
| Signed `Content-Type` / `Content-Length` mismatch → 403 from R2 | **High** during dev | Med | Send exactly the signed headers; assert `file.size` is the value sent to presign |
| Presigned URL expires during a slow upload | Med | Med | 5-minute expiry + **re-presign on every retry** |
| HEIC reaches canvas → garbage/throw | **High** on iOS | High | `accept="image/jpeg,image/png"` + runtime `isHeic` → `heic-to` |
| `browser-image-compression` unmaintained, breaks later | Low now, rising | Med | Version pinned; documented migration to compressorjs |
| Low-end Android OOM on 12MP decode | Med | High | Serial queue + web worker + 2048px cap |
| iOS blank canvas above the px cap | Low at 2048 | High (silent) | `assert out.size > 0` before upload |
| Orphaned R2 objects accumulate | Med | Low | Compensating delete on create-failure; old keys intentionally retained for history; 10GB free tier is ample |
| `r2.dev` rate limits under load | Med | Med | Custom domain preferred; switch is env-var-only |
| Photo too soft to read the expiry date | Med | High (defeats the purpose) | 2048px + native camera app; raise to 2560 if OCR is ever added |

## Security Considerations

- **The presign route is the write boundary for photos** — the R2 equivalent of Firestore rules. It must verify the Firebase ID token, cap size, pin content type, and constrain the key shape. Never let the client choose the key.
- R2 credentials are server-only env vars, scoped to one bucket with Object Read & Write.
- Deletion is server-side only; no client ever holds R2 delete rights.
- Presigned URLs are short-lived (5 min) and single-purpose (one key, one content type, one exact length).
- `preserveExif: false` strips GPS — a real privacy win.
- The bucket is publicly readable by design (durable Excel hyperlinks). Keys contain a timestamp + 6 random chars so they aren't enumerable, but treat photos as public-if-URL-known.
- Anonymous auth means "any visitor to the site", not "trusted staff" — App Check is the escalation if upload abuse appears (Phase 05).

## Rollback Plan

Photo upload is isolated behind `photo-upload.ts` and two API routes. Reverting this phase leaves Phases 01–02 functional with the photo field stubbed. No schema change beyond `photoKey`, which is already in the Phase 01 rules. Switching the public base (r2.dev ↔ custom domain) is an env-var change with no data migration.

## Next Steps

- Feeds Phase 04: `photoUrl(photoKey)` becomes the clickable HYPERLINK cell in the Excel export, and the thumbnail in the history timeline.
- Feeds Phase 05: upload-failure and offline UX.

## Unresolved Questions

1. Is OCR of the expiry date planned? If yes → `maxWidthOrHeight: 2560`, quality ≥ 0.85.
2. Should the admin hard-delete also purge every historical `prevPhotoKey` for that entry, or only the current one? Plan assumes **purge all keys referenced by that entry's history** (otherwise they are unreachable forever).
