# Phase 01 — Project Scaffold + Firebase + Cloudflare R2 Setup

> Revised 2026-09-17: Firebase Storage + Blaze replaced by Cloudflare R2. `storage.rules` removed. Firestore rules rewritten for mutable entries + history subcollection + staff write rights.

## Context Links

- [plan.md](plan.md)
- [research/researcher-05-nextjs-firebase-vercel.md](research/researcher-05-nextjs-firebase-vercel.md)
- [research/researcher-02-firestore-data-model.md](research/researcher-02-firestore-data-model.md) (rules + indexes baseline, amended below)

## Overview

- **Priority:** P1 (blocks everything)
- **Status:** pending
- **Effort:** 3h
- **Blocked by:** none
- Scaffold Next.js 16, create the Firebase project (Firestore + Auth only), create the Cloudflare R2 bucket, wire the client SDK singleton, commit and deploy Firestore rules + indexes.

## Key Insights

- **No Blaze plan needed.** Firestore + Auth on Spark is free and sufficient; Storage was the only Blaze trigger and it's gone. Photos live in R2 (free tier ~10GB, zero egress, no card).
- Firebase web config is **not a secret** (apiKey identifies, doesn't authorize). `NEXT_PUBLIC_*` is correct. Firestore rules are the boundary for data.
- **R2 credentials ARE real secrets.** `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` must be server-only env vars — never `NEXT_PUBLIC_`, never in the client bundle. This is a posture change from the original plan, which had no secrets at all.
- Firestore location `asia-southeast1` is **permanent**.
- Test-mode rules auto-expire ~30 days then lock everything out. Ship real rules now.
- **`r2.dev` public subdomain is rate-limited and Cloudflare labels it development-only.** A custom domain on the bucket is the production answer. Because we store `photoKey` (not a full URL) and derive the URL from `NEXT_PUBLIC_R2_PUBLIC_BASE`, switching from r2.dev to a custom domain later is an env-var change with **zero data migration**.
- Next 16 breaking changes that touch us: `params`/`searchParams` are async; `middleware.ts` → `proxy.ts`; `next lint` removed.

## Requirements

**Functional**
- App builds and runs locally over HTTPS (camera needs a secure context).
- Anonymous sign-in happens silently on load; admin email/password account exists.
- `firestore.rules` + `firestore.indexes.json` live in the repo and are deployed.
- R2 bucket exists, is publicly readable at a known base URL, and accepts CORS PUT from localhost + Vercel domains.

**Non-functional**
- Files < 200 LOC, kebab-case names.
- No `firebase-admin` (no service-account secret). Firebase ID tokens are verified in the API route with `jose` against Google's public JWKS — see Phase 03.
- `git config core.autocrlf true` on Windows.

## Architecture

```
Browser (client components only)
  └─ src/lib/firebase.ts  ── singleton (getApps().length ? getApp() : initializeApp)
       ├─ auth  → signInAnonymously (staff)  |  signInWithEmailAndPassword (admin)
       └─ db    → Firestore, asia-southeast1, Spark tier

Photos (Phase 03)
  Browser → POST /api/photos/presign  (server verifies Firebase ID token)
          → PUT presigned URL → Cloudflare R2 bucket        [direct, bypasses Vercel body limit]
          → public read via NEXT_PUBLIC_R2_PUBLIC_BASE + photoKey
```

### Firestore schema (amended)

```ts
// products/{barcode}                       ← doc ID IS the barcode
{ barcode: string, name: string, unit?: string, updatedAt: Timestamp }

// inventoryEntries/{entryId}               ← MUTABLE batch document
{
  barcode: string, productName: string,
  expiryDate: Timestamp, expiryDateStr: string,   // "YYYY-MM-DD" mirror
  quantity: number,                                // int > 0, corrected in place
  note?: string,
  photoKey: string,                                // R2 object key — REQUIRED
  status: 'active' | 'deleted',                    // soft delete
  rev: number,                                     // optimistic-concurrency counter, starts at 1
  createdAt: Timestamp, createdByUid: string, enteredByName: string,
  updatedAt: Timestamp, lastEditedByUid: string, lastEditedByName: string,
}

// inventoryEntries/{entryId}/history/{historyId}  ← APPEND-ONLY
{
  changeType: 'create' | 'update' | 'delete',
  prevQuantity: number | null,
  prevExpiryDateStr: string | null,
  prevPhotoKey: string | null,
  newQuantity: number | null,
  newExpiryDateStr: string | null,
  newPhotoKey: string | null,
  editedByUid: string, editedByName: string,
  editedAt: Timestamp,   // serverTimestamp(), rule-enforced
  rev: number,           // the rev this change produced
}
```

**Why soft delete:** Firestore does **not** delete subcollections when the parent doc is deleted — a hard delete would orphan the entire history trail the user asked for. `status: 'deleted'` + a `changeType:'delete'` history record preserves it. Only the admin hard-deletes, and must then delete the subcollection explicitly (Phase 04).

**Why `rev`:** entries are now mutable, so "two staff correct the same batch" is a genuine lost-update race. The rule `request.resource.data.rev == resource.data.rev + 1` makes the **second** concurrent writer fail server-side — no transaction, no extra round-trip, no silent overwrite. Entry + history are written in a single `writeBatch`, so a rejected rev also rejects the history record.

### `firestore.rules` (replaces research-02 §5)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isStaff() { return request.auth != null; }            // incl. anonymous
    function isAdmin() { return request.auth != null &&
                          (request.auth.uid == 'PASTE_ADMIN_UID' ||
                           request.auth.token.admin == true); }
    function d() { return request.resource.data; }

    match /products/{barcode} {
      allow read: if isStaff();
      allow create, update: if isStaff()
        && d().keys().hasOnly(['barcode','name','unit','updatedAt'])
        && d().barcode == barcode
        && d().name is string && d().name.size() > 0 && d().name.size() <= 120
        && d().updatedAt == request.time;
      allow delete: if isAdmin();
    }

    match /inventoryEntries/{entryId} {
      function baseValid() {
        return d().barcode is string && d().barcode.size() >= 4 && d().barcode.size() <= 64
          && d().productName is string && d().productName.size() <= 120
          && d().expiryDate is timestamp
          && d().expiryDateStr is string && d().expiryDateStr.matches('^\\d{4}-\\d{2}-\\d{2}$')
          && d().quantity is int && d().quantity > 0 && d().quantity <= 100000
          && (!('note' in d()) || (d().note is string && d().note.size() <= 500))
          && d().photoKey is string && d().photoKey.size() > 0 && d().photoKey.size() <= 200
          && d().status in ['active','deleted']
          && d().enteredByName is string && d().enteredByName.size() >= 1 && d().enteredByName.size() <= 40
          && d().lastEditedByName is string && d().lastEditedByName.size() >= 1 && d().lastEditedByName.size() <= 40
          && d().updatedAt == request.time
          && d().lastEditedByUid == request.auth.uid;
      }

      allow read: if isStaff();

      allow create: if isStaff() && baseValid()
        && d().keys().hasAll(['barcode','productName','expiryDate','expiryDateStr','quantity',
              'photoKey','status','rev','createdAt','createdByUid','enteredByName',
              'updatedAt','lastEditedByUid','lastEditedByName'])
        && d().keys().hasOnly(['barcode','productName','expiryDate','expiryDateStr','quantity','note',
              'photoKey','status','rev','createdAt','createdByUid','enteredByName',
              'updatedAt','lastEditedByUid','lastEditedByName'])
        && d().rev == 1
        && d().status == 'active'
        && d().createdAt == request.time
        && d().createdByUid == request.auth.uid;

      // staff may correct a batch; immutable provenance fields are pinned
      allow update: if isStaff() && baseValid()
        && d().rev == resource.data.rev + 1                 // optimistic concurrency
        && d().barcode == resource.data.barcode
        && d().createdAt == resource.data.createdAt
        && d().createdByUid == resource.data.createdByUid
        && d().enteredByName == resource.data.enteredByName;

      allow delete: if isAdmin();                            // staff use soft delete (status)

      match /history/{historyId} {
        allow read: if isStaff();
        allow create: if isStaff()
          && d().changeType in ['create','update','delete']
          && d().editedByUid == request.auth.uid
          && d().editedByName is string && d().editedByName.size() >= 1 && d().editedByName.size() <= 40
          && d().editedAt == request.time
          && d().rev is int && d().rev > 0;
        allow update: if false;                              // append-only, even for admin
        allow delete: if isAdmin();                          // only for hard-delete cleanup
      }
    }

    match /admin/{doc=**} { allow read, write: if isAdmin(); }
    match /{document=**}  { allow read, write: if false; }
  }
}
```

Notes: `updatedAt == request.time` / `createdAt == request.time` / `editedAt == request.time` only pass when the client sends `serverTimestamp()` — the canonical anti-spoof check. `enteredByName` is pinned on update so a later editor cannot rewrite who first entered the batch.

### `firestore.indexes.json` (amended — `status` filter changes every query)

```json
{ "indexes": [
  { "collectionGroup": "inventoryEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
  { "collectionGroup": "inventoryEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "barcode", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "expiryDate", "order": "ASCENDING" } ] },
  { "collectionGroup": "inventoryEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "expiryDate", "order": "ASCENDING" } ] },
  { "collectionGroup": "inventoryEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "enteredByName", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] }
], "fieldOverrides": [
  { "collectionGroup": "inventoryEntries", "fieldPath": "photoKey", "indexes": [] },
  { "collectionGroup": "inventoryEntries", "fieldPath": "note", "indexes": [] },
  { "collectionGroup": "inventoryEntries", "fieldPath": "productName", "indexes": [] }
] }
```

Index 2 also serves the stock-on-hand aggregation (`where barcode == x && status == 'active'`, `sum('quantity')`) — a prefix of the composite covers it.

## Related Code Files

**Create**
- `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx` (from `create-next-app`)
- `src/lib/firebase.ts` — SDK singleton (Firestore + Auth only, **no** `getStorage`)
- `src/lib/auth-context.tsx` — `"use client"` AuthProvider: silent `signInAnonymously`, exposes `{ user, loading, isAdmin }`
- `src/lib/admin-config.ts` — exported `ADMIN_EMAIL` constant (public)
- `src/lib/r2-config.ts` — `photoUrl(key)` helper reading `NEXT_PUBLIC_R2_PUBLIC_BASE`
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`
- `.env.example` (committed), `.env.local` (gitignored)

**Modify**
- `src/app/layout.tsx` — wrap in `<AuthProvider>`, `lang="vi"`, mobile viewport

**Delete / not created**
- ~~`storage.rules`~~ — no Firebase Storage in this project

## Implementation Steps

1. **Scaffold**:
   ```powershell
   npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-agents-md
   npm i firebase
   npm i -D firebase-tools
   git config core.autocrlf true
   ```
2. **Firebase console** (Spark tier — do **not** upgrade to Blaze):
   1. Create project → note project ID.
   2. Firestore → Create database → **Native mode** → **`asia-southeast1`** → production mode (locked).
   3. **Skip Storage entirely.**
   4. Authentication → enable **Email/Password** and **Anonymous**.
   5. Auth → Users → Add user = the admin. **Copy the UID.**
   6. Project settings → Add app → Web → copy the config (5 keys; `storageBucket` is unused, omit it).
3. **Cloudflare R2**:
   1. Create a Cloudflare account (free, no card for R2's free tier).
   2. R2 → Create bucket, e.g. `tonkho-photos`, location hint Asia-Pacific.
   3. **Public access**: attach a custom domain (preferred, e.g. `anh.<yourdomain>`) or enable the `r2.dev` dev subdomain. Record the base URL → `NEXT_PUBLIC_R2_PUBLIC_BASE`.
   4. **CORS policy** on the bucket:
      ```json
      [{ "AllowedOrigins": ["http://localhost:3000","https://localhost:3000","https://*.vercel.app","https://<prod-domain>"],
         "AllowedMethods": ["PUT","GET"],
         "AllowedHeaders": ["content-type"],
         "MaxAgeSeconds": 3600 }]
      ```
   5. R2 → Manage API tokens → create an **Object Read & Write** token scoped to this bucket. Record Access Key ID + Secret + Account ID.
4. **Env vars** — `.env.local`, mirrored as empty keys in `.env.example`:
   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=            NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=         NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
   NEXT_PUBLIC_FIREBASE_APP_ID=             NEXT_PUBLIC_R2_PUBLIC_BASE=
   R2_ACCOUNT_ID=       R2_BUCKET=       R2_ACCESS_KEY_ID=       R2_SECRET_ACCESS_KEY=
   ```
   The last four are **secrets** — no `NEXT_PUBLIC_` prefix, ever.
5. **`src/lib/firebase.ts`**: singleton, Firestore + Auth only. No `"use client"` on this file; import only from client components.
6. **`src/lib/auth-context.tsx`**: `onAuthStateChanged`; if `!user`, `signInAnonymously(auth)`. Expose `loading`. `isAdmin = !!user && !user.isAnonymous && user.email === ADMIN_EMAIL`.
7. **`src/lib/r2-config.ts`**: `export const photoUrl = (key: string) => `${process.env.NEXT_PUBLIC_R2_PUBLIC_BASE}/${key}`;` — single place that knows the public base (DRY; makes the r2.dev → custom-domain switch one-line).
8. **Rules + indexes**: paste the two blocks above, replacing `PASTE_ADMIN_UID`.
9. **Deploy**:
   ```powershell
   npx firebase login
   npx firebase init firestore        # storage NOT selected
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```
10. **HTTPS dev**: add `"dev:https": "next dev --experimental-https"`.
11. **Smoke tests**:
    - Console shows an anonymous UID on a real phone.
    - A hand-crafted write with `rev: 5` on a new doc is **denied** (must be 1).
    - An update that keeps `rev` unchanged is **denied**.
    - `curl -X PUT` a file to the R2 public base **without** a presigned signature → denied.

## Todo List

- [ ] 1.1 `create-next-app` scaffold + deps, `npm run build` passes
- [ ] 1.2 Firebase project created on **Spark** (no Blaze, no Storage)
- [ ] 1.3 Firestore created in `asia-southeast1`, production mode
- [ ] 1.4 Email/Password + Anonymous enabled; admin user created, UID copied
- [ ] 1.5 Cloudflare account + R2 bucket created
- [ ] 1.6 R2 public base URL decided (custom domain vs r2.dev) and recorded
- [ ] 1.7 R2 CORS policy applied (incl. `https://*.vercel.app`)
- [ ] 1.8 R2 API token created, keys stored as server-only env vars
- [ ] 1.9 `.env.local` + `.env.example` written; secrets confirmed non-public
- [ ] 1.10 `src/lib/firebase.ts` singleton (no Storage)
- [ ] 1.11 `src/lib/auth-context.tsx` with silent anonymous sign-in + `isAdmin`
- [ ] 1.12 `src/lib/r2-config.ts` URL helper
- [ ] 1.13 `firestore.rules` + `firestore.indexes.json` committed with real admin UID
- [ ] 1.14 Rules + indexes deployed; 4 composite indexes show *Enabled*
- [ ] 1.15 Negative tests: bad `rev` on create, non-incrementing `rev` on update, unsigned R2 PUT

## Success Criteria

- `npm run build` succeeds with zero `window is not defined` errors.
- Opening the app on a phone silently produces an anonymous auth UID.
- Firebase billing page still shows **Spark** — no card attached anywhere.
- `firebase deploy --only firestore:rules` succeeds; 4 composite indexes *Enabled*.
- All three negative writes are denied; unsigned R2 PUT is refused.
- `grep -r "R2_SECRET" src/` returns nothing outside the API route.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Wrong Firestore region chosen (permanent) | Med | High | Explicit checklist step; verify before any write |
| R2 secret leaks into the client bundle | Med | **Critical** | No `NEXT_PUBLIC_` prefix; only imported inside `src/app/api/`; grep check in 1.15 |
| `r2.dev` rate limits bite in production | Med | Med | Custom domain preferred; **`photoKey`-not-URL storage makes the switch migration-free** |
| R2 CORS omits preview domains → uploads fail only on previews | **High** if forgotten | Med | `https://*.vercel.app` wildcard in the policy from day one |
| `rev` rule wrong → every update denied, or conflicts undetected | Med | High | Explicit negative tests 1.15; two-device edit test in Phase 05 |
| Subcollection orphaned on delete | Med | Med | Soft delete by default; admin hard-delete explicitly clears `history` (Phase 04) |
| Rules `hasOnly` mismatch → all writes denied | Med | High | `types/inventory.ts` is the single source for the field list (Phase 02) |
| Camera untestable on LAN HTTP | High | Med | `--experimental-https` + preview deploy as the canonical test surface |

## Security Considerations

- Firestore rules are the boundary for data; the R2 presign API route is the boundary for photo writes.
- R2 keys are the only real secrets in the project. Scope the token to a single bucket with Object Read & Write — not account-wide.
- The R2 bucket is **publicly readable** by design (durable links for the Excel export). Object keys include a random component so they aren't enumerable, but treat photos as public-if-URL-known. Confirm this is acceptable to the user.
- Anonymous Auth over open rules: revocable uid, `request.auth != null` gating, App Check compatibility.
- Staff-reported names are **unverified** — see Phase 02 Security Considerations.
- Never commit `.env.local`.

## Next Steps

- Unblocks Phase 02 (data layer + scanner + batch lookup).
- Defer: GitHub remote + Vercel connection → Phase 06 (R2 secrets must be added there too).

## Unresolved Questions

1. Custom domain available for the R2 bucket, or start on `r2.dev` and migrate later? (Migration is env-var-only by design.)
2. Is a publicly-readable photo bucket acceptable, or should photos be served through an authenticated proxy route? (Proxy costs Vercel bandwidth and breaks durable Excel hyperlinks.)
