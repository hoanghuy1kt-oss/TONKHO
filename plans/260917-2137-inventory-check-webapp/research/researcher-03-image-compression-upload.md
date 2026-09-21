# Research 03 — Client-Side Image Compression + Firebase Storage Upload

> **PARTIALLY SUPERSEDED 2026-09-17.** §1, §2, §4 and §5 (compression, HEIC, capture UX, pitfalls) still stand and are the basis of the plan. **§3 and the upload half of the code block are obsolete** — the project moved to Cloudflare R2 with presigned PUTs. Do not implement `uploadBytesResumable` / `storage.rules`. See [phase-03](../phase-03-photo-capture-compression-upload.md).

Date: 2026-09-17 | Stack: Next.js (App Router) / React, mobile web, Firebase anon auth

## 1. Library choice

| | browser-image-compression | compressorjs | Canvas manual |
|---|---|---|---|
| npm | `browser-image-compression` | `compressorjs` | — |
| Version / published | **2.0.2** (2023-03-06) | **1.3.0** (2026-04-06) | — |
| Repo activity | last push 2024-03, 65 open issues | active (2026-09), 5 issues | — |
| Weekly dl | ~1.12M | ~300k | — |
| Bundle (gz) | ~20 KB (+`uzip` dep) | ~12 KB (2 deps) | 0 |
| Web worker | **Yes** (`useWebWorker: true`) | No (main-thread `toBlob`) | DIY |
| Guarantees target size | **Yes** — binary-search re-encode loop on `maxSizeMB` | No (quality only) | DIY |
| EXIF orientation | handled | handled | DIY, painful |

**Recommend: `browser-image-compression`.** The requirement is "guarantee < 3MB" — it is the only one that *iterates* until the byte target is met; compressorjs only sets a quality and hopes. Web worker matters on low-end Android (a 12MP re-encode blocks the main thread ~1–3s).

Caveat: it's stale (no release since 2023). It is stable and battle-tested at 1.1M dl/wk — acceptable. Pin the version. If it ever breaks, `compressorjs` + a manual quality-step-down loop is the migration path.

Do **not** hand-roll Canvas: you'd reimplement EXIF, iOS canvas area caps, and worker plumbing for no gain.

Companion: **`heic-to` 1.5.2** (2026-05, ~592k dl/wk, libheif-wasm) for HEIC fallback. Prefer over `heic2any` (abandoned 2023). Import it **dynamically** — the wasm is multi-MB.

```
npm i browser-image-compression@2.0.2 heic-to
```

## 2. Config for < 3MB from 12MP+ phone photos

```ts
{
  maxSizeMB: 1.5,          // headroom: rules cap at 3MB, target half
  maxWidthOrHeight: 2048,  // long edge; see below
  useWebWorker: true,
  initialQuality: 0.8,
  fileType: 'image/jpeg',  // force JPEG — normalizes HEIC/PNG/WebP output
  alwaysKeepResolution: false,
  preserveExif: false,     // strips GPS (privacy) + saves bytes
}
```

**Why 2048px:** a 12MP photo is 4032×3024. Downscaling the long edge to 2048 keeps ~3.1MP — an expiry date printed at ~2% of frame width still resolves to ~40px of text height, comfortably legible and OCR-able. 1280 is too soft for small date codes; 3000+ buys nothing and costs memory. Typical output at 2048 + q0.8: **350–700 KB**, far under 3MB.

If OCR is ever added, bump to `maxWidthOrHeight: 2560` and `maxSizeMB: 2.5`.

**HEIC on iOS — the real behavior (2026):**
- Safari transcodes HEIC → JPEG **only when `accept` names concrete convertible types**. With `accept="image/*"` it hands you the **raw HEIC**.
- Canvas/`createImageBitmap` **cannot decode HEIC** in any browser, including Safari. `browser-image-compression` will throw/produce garbage.
- **Workaround (both belts):**
  1. `accept="image/jpeg,image/png"` (not `image/*`) → triggers Apple's native transcode in the common case.
  2. Runtime guard: `await isHeic(file)` → dynamic-import `heic-to`, convert to JPEG blob, *then* compress. Covers Android HEIC, Safari 17 regressions, and files shared from other apps.

## 3. Firebase Storage upload

- **Use `uploadBytesResumable` always.** Even at ~500KB it gives `state_changed` progress, `pause/resume/cancel`, and — critically — chunked resumable session recovery on flaky mobile networks. `uploadBytes` is one-shot: a dropped connection restarts from zero with no signal.
- Progress: `snapshot.bytesTransferred / snapshot.totalBytes`. Note the SDK reports in 256KB chunks, so small files jump 0→100; show an indeterminate spinner below ~1MB.
- URL: `await getDownloadURL(task.snapshot.ref)` **after** the task promise resolves.
- Path convention: `inventory/{entryId}/{timestamp}-{rand6}.jpg` — `entryId` scopes rules + enables `deleteFolder` cleanup; `timestamp` orders; `rand6` prevents collision on double-tap.
- Set `contentType` + a `customMetadata.uploadedBy` in the upload metadata; rules validate both.

**Storage rules (anonymous auth, size + type enforced):**

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /inventory/{entryId}/{fileName} {
      allow read: if request.auth != null;

      allow create: if request.auth != null
        && request.resource.size < 3 * 1024 * 1024
        && request.resource.contentType == 'image/jpeg'
        && fileName.matches('.*\\.jpg')
        && request.resource.metadata.uploadedBy == request.auth.uid;

      allow update: if false;                     // immutable once written
      allow delete: if request.auth != null
        && resource.metadata.uploadedBy == request.auth.uid;
    }
    match /{allPaths=**} { allow read, write: if false; }  // deny by default
  }
}
```

Tighten further if anon abuse is a concern: gate on `request.auth.token.firebase.sign_in_provider == 'anonymous'` plus a Firestore-backed App Check requirement.

## 4. Mobile capture UX

**Use `<input type="file">`, not `getUserMedia`.** getUserMedia gives you a ~1–2MP video-frame grab with no autofocus control, no HDR, no flash, and iOS pauses the stream on backgrounding — it produces visibly worse label photos and triples the code. The native picker opens the real camera app: tap-to-focus, macro mode on modern iPhones, full sensor resolution. Reserve getUserMedia for live barcode scanning only.

```html
<!-- Primary CTA: straight to camera -->
<input type="file" accept="image/jpeg,image/png" capture="environment" />
<!-- Secondary: gallery (omit `capture`, which suppresses the gallery option) -->
<input type="file" accept="image/jpeg,image/png" />
```

Ship both — `capture` forces camera-only and users frequently have the photo already.

**Preview:** `URL.createObjectURL(compressedFile)` and **`URL.revokeObjectURL` on unmount** (leaks blobs on repeated retakes). Preview the *compressed* file so the user sees what actually uploads.

**EXIF orientation:** `browser-image-compression` normalizes rotation during the canvas re-encode, and output JPEGs carry no orientation tag (`preserveExif: false`), so they render upright everywhere. For the raw-file preview before compression, add `img { image-orientation: from-image }` (default since 2020, but explicit is safer in resets that override it).

## 5. Pitfalls

1. **Low-end Android OOM.** A 12MP decode is ~48MB of RGBA in a device with a ~256MB tab budget; two in flight crashes the tab. → Compress **strictly one at a time** (serial queue, never `Promise.all`), and `useWebWorker: true` so the bitmap lives in worker heap.
2. **iOS canvas area cap.** Safari silently returns a blank canvas above ~16.7M px (4096²) on older devices. `maxWidthOrHeight: 2048` keeps you well clear. Always assert `compressed.size > 0` before uploading — a blank canvas yields a tiny all-white JPEG.
3. **`accept="image/*"` leaks HEIC** (see §2). Also: iOS Safari fires `change` with an empty `files` list if the user cancels — guard `if (!e.target.files?.length) return`.
4. **Same-file reselect.** iOS won't fire `change` when picking the identical file twice. Reset `e.target.value = ''` in the handler.
5. **Flaky/offline network.** `uploadBytesResumable` retries internally, but a full offline period rejects with `storage/retry-limit-exceeded`. → Wrap in exponential backoff (3 tries, 1s/2s/4s), listen to `navigator.onLine` + the `online` event, and persist a pending-upload queue (IndexedDB) so a backgrounded PWA resumes. Firestore's offline persistence does **not** cover Storage.
6. **Orphaned files if the Firestore write fails.** Storage and Firestore are not transactional. → **Upload first, write Firestore second, and on Firestore failure `deleteObject(ref)` in a `catch`.** For the case where the tab dies mid-flight, add a scheduled Cloud Function sweeping `inventory/**` for objects older than 24h with no matching Firestore doc. Alternative (heavier): write a `status: 'pending'` doc first, flip to `'ready'` after upload, and sweep stale pendings.
7. **Double-submit.** Disable the submit button for the whole compress+upload window; the `rand6` in the path prevents overwrite but not duplicate cost.

## Code: compress + upload

```ts
// lib/upload-inventory-photo.ts
import imageCompression from 'browser-image-compression';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';

const OPTS = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 2048,
  useWebWorker: true,
  initialQuality: 0.8,
  fileType: 'image/jpeg' as const,
  preserveExif: false,
};

export async function compressPhoto(file: File): Promise<File> {
  let input: Blob = file;

  // HEIC guard — dynamic import keeps the wasm out of the main bundle
  const { isHeic, heicTo } = await import('heic-to');
  if (await isHeic(file)) {
    input = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
  }

  const out = await imageCompression(
    new File([input], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }),
    OPTS,
  );
  if (!out.size) throw new Error('Compression produced an empty file');
  return out;
}

export async function uploadPhoto(
  file: File,
  entryId: string,
  uid: string,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; path: string }> {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const path = `inventory/${entryId}/${name}`;
  const storageRef = ref(getStorage(), path);

  const task = uploadBytesResumable(storageRef, file, {
    contentType: 'image/jpeg',
    customMetadata: { uploadedBy: uid, entryId },
  });

  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      reject,
      () => resolve(),
    );
  });

  return { url: await getDownloadURL(task.snapshot.ref), path };
}

// Caller — compensating delete keeps Storage and Firestore consistent
export async function addEntryWithPhoto(file: File, entryId: string, uid: string, write: (url: string, path: string) => Promise<void>) {
  const compressed = await compressPhoto(file);          // serial: never Promise.all
  const { url, path } = await uploadPhoto(compressed, entryId, uid);
  try {
    await write(url, path);
  } catch (err) {
    await deleteObject(ref(getStorage(), path)).catch(() => {});  // avoid orphan
    throw err;
  }
}
```

## Unresolved questions

- Is OCR of the expiry date planned? If yes, revisit `maxWidthOrHeight` (2560) and keep quality ≥ 0.85.
- Is App Check enabled? Anonymous-auth Storage writes are open to scripted abuse without it; the rules above limit blast radius but not volume.
- Target device floor — if sub-2GB Android is in scope, consider capping at 1600px and testing on a real low-end device.
- Retention: are photos ever deleted with the inventory entry? Determines whether the orphan-sweep function also needs an entry-deletion hook.

## Sources

- [browser-image-compression (npm)](https://www.npmjs.com/package/browser-image-compression) · [repo](https://github.com/Donaldcwl/browser-image-compression)
- [compressorjs (npm)](https://www.npmjs.com/package/compressorjs) · [repo](https://github.com/fengyuanchen/compressorjs)
- [npm-compare: browser-image-compression vs compressorjs](https://npm-compare.com/browser-image-compression,compressorjs)
- [heic-to](https://github.com/hoppergee/heic-to)
- [Firebase — Cloud Storage Security Rules](https://firebase.google.com/docs/storage/security) · [rules conditions](https://firebase.google.com/docs/storage/security/rules-conditions)
- [firebase-js-sdk #7366 — resumable upload progress granularity](https://github.com/firebase/firebase-js-sdk/issues/7366)
- [Safari 17+ HEIC file-input behavior (Apple Developer Forums)](https://developer.apple.com/forums/thread/743049)
- [Coping with HEIC in the browser](https://shkspr.mobi/blog/2020/12/coping-with-heic-in-the-browser/)
- [MDN — image-orientation](https://developer.mozilla.org/en-US/docs/Web/CSS/image-orientation)
