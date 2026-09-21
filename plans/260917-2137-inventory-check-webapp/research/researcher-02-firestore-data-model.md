# Researcher-02 — Firestore Data Model, Concurrency, Realtime & Rules

> **PARTIALLY SUPERSEDED 2026-09-17.** §4 (realtime) and the flat-collection / barcode-as-doc-ID decisions still stand. **§2 fields, §3 concurrency, §5 rules and §6 indexes are obsolete** — entries became mutable with a `rev` counter, soft delete, a `history` subcollection, staff write rights, and `photoKey` instead of `photoUrl`. The authoritative schema, rules and indexes now live in [phase-01](../phase-01-project-scaffold-and-firebase-setup.md#firestore-schema-amended).

Scope: barcode inventory-check app, ~2–10 anon staff on phones + 1 admin (email/pw). Next.js client SDK.

## 1. Schema — Recommendation: two top-level collections

**`products/{barcode}` + `inventoryEntries/{autoId}`** (flat). NOT `products/{barcode}/entries/{id}`.

| Query | Flat top-level | Subcollection |
|---|---|---|
| All entries ordered by createdAt | plain collection query | needs `collectionGroup('entries')` + collection-group index |
| Entries of one product | `where('barcode','==',x)` + composite index | natural, cheapest |
| Excel export of everything | 1 paged query, 1 read/doc | collectionGroup query, same reads, extra index scope |
| Security rules | one `match /inventoryEntries/{id}` block | wildcard path, rules must guard parent too |

Both work; flat wins because the **primary screen is the global feed** and export is a single stream. Subcollection only wins if entries-per-product got huge (not the case: small shop).

**Product doc ID = the barcode itself.** Recommended.
- Pros: `doc(db,'products',barcode)` = zero-query lookup after scan (1 read, instant); uniqueness enforced by Firestore for free; create-if-missing is idempotent; no "duplicate product" race.
- Cons: barcode is immutable as an ID — a mistyped/changed barcode means create-new + migrate; doc IDs can't contain `/`, can't be `.`/`..`, ≤1500 bytes (EAN-8/13, UPC, Code128 digits are all fine). Sanitize/trim before use.
- Auto-ID + indexed `barcode` field only pays off if one product may have multiple barcodes (pack sizes). Not needed now → YAGNI.

## 2. Fields

```ts
// products/{barcode}
{
  barcode:    string,     // same as doc ID, duplicated for export readability
  name:       string,     // free text, VN
  unit?:      string,     // "hộp" | "thùng" | "chai"...
  updatedAt:  Timestamp,  // serverTimestamp()
}

// inventoryEntries/{autoId}
{
  barcode:      string,     // denormalized link -> products/{barcode}
  productName:  string,     // snapshot at scan time: export needs NO join
  expiryDate:   Timestamp,  // canonical, see below
  expiryDateStr:string,     // "YYYY-MM-DD" mirror (display + Excel, TZ-proof)
  quantity:     number,     // integer > 0
  note?:        string,     // <= 500 chars
  photoUrl:     string,     // Storage download URL (may expire/rotate)
  photoPath:    string,     // "entries/{entryId}/{ts}.jpg" -> delete/re-sign later
  createdAt:    Timestamp,  // serverTimestamp(), rule-enforced
  createdBy:    string,     // free-text device/staff label, 1..40 chars
  uid:          string,     // anonymous auth uid, traceability
}
```

**expiry: Timestamp, not string.** Justification: range queries (`where('expiryDate','<=',in30Days)`) and `orderBy` work natively and cheaply; `xlsx` writes a real Excel date cell; sorting is numeric not lexicographic. The known trap is timezone: build it at **local midnight Asia/Ho_Chi_Minh (UTC+7)** before storing, else a date can render one day off. The `expiryDateStr` mirror (4 extra bytes/doc) removes that risk for display/export — cheap insurance, keep both. (A string-only design blocks "expiring soon" alerts unless you rely on `YYYY-MM-DD` lexicographic tricks — avoid.)

`quantity` as `number` (Firestore has no int type distinction in JS; validate integer in rules). Never store as string.

## 3. Concurrency

**Doc-per-entry is the whole answer.** Every scan = `addDoc()` → new auto-ID doc → two staff never write the same document, so there is no read-modify-write, no lost update, no transaction. Firestore's ~1 sustained write/sec soft limit is *per document*; 10 phones creating distinct docs is nowhere near any limit.

**Where a race actually exists:** first scan of an unknown barcode by two phones at once.

```ts
// Preferred — idempotent, 1 write, no retry, no read:
await setDoc(doc(db,'products',barcode),
  { barcode, name, updatedAt: serverTimestamp() }, { merge: true });
```
Both writers succeed; last-write-wins on overlapping fields. Because there is no `createdAt` on the product doc (deliberately omitted — derive "first seen" from entries), merge has no field it can clobber destructively.

Use a **transaction only** when you need read-then-decide semantics, e.g. "don't overwrite an existing name" or "flag this as a brand-new product":
```ts
await runTransaction(db, async tx => {
  const snap = await tx.get(ref);
  if (!snap.exists()) tx.set(ref, { barcode, name, updatedAt: serverTimestamp() });
});
```
Tradeoff: +1 round trip, automatic retry on contention, and concurrent txns on the same doc serialize. `setDoc(merge)` is ~2x faster on a 3G phone. Recommend merge; transaction only if "preserve first-entered name" becomes a requirement.

**Do not add shared counters** (`product.totalQty`, `product.entryCount`) — every scan then contends on one doc and you inherit the 1 write/sec ceiling plus lost-update risk. For totals use server-side aggregation queries (`getCountFromServer`, `sum()`/`average()` on an aggregate query) — billed at ~1 read per 1000 index entries, no counter to maintain. **Distributed counters are YAGNI here.**

## 4. Realtime (Next.js client components)

```tsx
'use client';
export function useEntriesFeed(pageSize = 200) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const q = query(collection(db,'inventoryEntries'),
                    orderBy('createdAt','desc'), limit(pageSize));
    const unsub = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() } as Entry)));
      setPending(snap.metadata.hasPendingWrites || snap.metadata.fromCache);
    }, err => console.error(err));
    return () => unsub();          // MUST unsubscribe on unmount
  }, [pageSize]);
  return { rows, pending };
}
```

- **Free from the SDK (latency compensation):** the write is applied to the local cache and your listeners fire *before* the server ack. The new entry appears at the top of the list instantly, even offline; the SDK retries and reconciles on reconnect. Do **not** hand-roll optimistic state — you'd double-render.
- `includeMetadataChanges: true` gives a second snapshot when the write commits; `metadata.hasPendingWrites` → show a "đang gửi" dot, `metadata.fromCache` → "offline" badge. Without the flag you only get the data-change snapshots.
- `serverTimestamp()` resolves to `null` in the first local snapshot — guard the render (`createdAt?.toDate() ?? new Date()`), or read `snapshotOptions` estimate.
- **Cleanup:** return `unsub` from `useEffect`. React StrictMode double-mounts in dev → subscribe/unsubscribe/subscribe, harmless. Never create listeners inside render or per-row.
- **Limits:** always `limit(200)` on the feed. Cost is 1 read per doc per initial load + 1 per changed doc; an unbounded listener on a growing collection re-reads everything on reconnect.
- **Pagination:** keep the last `QueryDocumentSnapshot` and `startAfter(lastDoc)` with a one-shot `getDocs` for older pages (don't stack live listeners per page). Export uses the same cursor loop with `limit(500)` — no listener at all.

## 5. Security Rules

**Use Firebase Anonymous Auth, not open rules.** Open rules (`allow read, write: if true`) let anyone who extracts the public web config write to your DB forever, with no uid to trace or revoke. Anonymous auth is still zero-friction for staff (silent `signInAnonymously()` on app load, no UI), but gives: `request.auth != null` gating, a `uid` stamped on each entry, the ability to disable anonymous sign-up in one click, and compatibility with **App Check** (recommended: App Check + reCAPTCHA Enterprise blocks non-app clients). Admin = the single email/password account.

Admin identity: for one admin, a **hardcoded UID constant in rules** is simplest and needs no Cloud Function / Admin SDK. Upgrade path is the `admin: true` custom claim (`request.auth.token.admin == true`) when a second admin appears. Prefer UID over email match (email is mutable, and `token.email` needs `email_verified`).

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isStaff()  { return request.auth != null; }             // incl. anonymous
    function isAdmin()  { return request.auth != null &&
                                 (request.auth.uid == 'PASTE_ADMIN_UID' ||
                                  request.auth.token.admin == true); }
    function d()        { return request.resource.data; }

    match /products/{barcode} {
      allow read: if isStaff();
      // staff may create/upsert a product, but only these fields
      allow create, update: if isStaff()
        && d().keys().hasOnly(['barcode','name','unit','updatedAt'])
        && d().barcode == barcode
        && d().name is string && d().name.size() > 0 && d().name.size() <= 120
        && d().updatedAt == request.time;
      allow delete: if isAdmin();
    }

    match /inventoryEntries/{entryId} {
      allow read: if isStaff();

      allow create: if isStaff()
        && d().keys().hasAll(['barcode','productName','expiryDate','expiryDateStr',
                              'quantity','photoUrl','photoPath','createdAt',
                              'createdBy','uid'])
        && d().keys().hasOnly(['barcode','productName','expiryDate','expiryDateStr',
                               'quantity','note','photoUrl','photoPath','createdAt',
                               'createdBy','uid'])
        && d().barcode is string && d().barcode.size() between(4, 64)
        && d().productName is string && d().productName.size() <= 120
        && d().expiryDate is timestamp
        && d().expiryDateStr is string && d().expiryDateStr.matches('^\\d{4}-\\d{2}-\\d{2}$')
        && d().quantity is int && d().quantity > 0 && d().quantity <= 100000
        && (!('note' in d()) || (d().note is string && d().note.size() <= 500))
        && d().photoUrl is string && d().photoUrl.matches('^https://.*')
        && d().photoPath is string && d().photoPath.size() > 0
        && d().createdBy is string && d().createdBy.size() between(1, 40)
        && d().uid == request.auth.uid
        && d().createdAt == request.time;   // blocks client-spoofed timestamps

      allow update, delete: if isAdmin();   // staff cannot edit/erase history
    }

    match /admin/{doc=**}    { allow read, write: if isAdmin(); }  // settings, export logs
    match /{document=**}     { allow read, write: if false; }      // default deny
  }
}
```

Notes: `d().createdAt == request.time` only passes when the client sent `serverTimestamp()` — that is the canonical anti-spoof check. `hasOnly` prevents field injection/bloat. Mirror this in Storage rules: `match /entries/{entryId}/{file} { allow write: if request.auth != null && request.resource.size < 5*1024*1024 && request.resource.contentType.matches('image/.*'); allow read: if request.auth != null; }`.

## 6. Composite indexes

Automatic single-field indexes already cover: `orderBy('createdAt','desc') + limit(200)` (main feed) and `where('expiryDate','<=',X) + orderBy('expiryDate')`. Needed composites:

```json
{ "indexes": [
  { "collectionGroup": "inventoryEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "barcode",   "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
  { "collectionGroup": "inventoryEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "barcode",    "order": "ASCENDING" },
      { "fieldPath": "expiryDate", "order": "ASCENDING" } ] },
  { "collectionGroup": "inventoryEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "createdBy", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] }
], "fieldOverrides": [
  { "collectionGroup": "inventoryEntries", "fieldPath": "photoUrl",
    "indexes": [] },
  { "collectionGroup": "inventoryEntries", "fieldPath": "photoPath",
    "indexes": [] },
  { "collectionGroup": "inventoryEntries", "fieldPath": "note",
    "indexes": [] }
] }
```
The `fieldOverrides` exempt never-queried fields from automatic indexing — smaller storage bill, faster writes. Ship `firestore.indexes.json` + `firestore.rules` in the repo and deploy with `firebase deploy --only firestore`. Rule of thumb confirmed in docs: any query mixing an equality filter on field A with `orderBy` on field B needs a composite index; Firestore's error message contains a one-click creation link.

## Unresolved questions
1. Should an entry be editable by staff for N minutes after creation (typo fix), or strictly admin-only? Rules above are admin-only.
2. Is "stock on hand" ever needed (sum of quantities per product), or is this purely an expiry-audit log? Affects whether aggregation queries suffice.
3. Multi-store / multi-location in future? If yes, add `storeId` now and prefix indexes with it — cheap today, painful later.
4. Photo retention: delete Storage object when admin deletes an entry (needs a Cloud Function or admin-side client delete via `photoPath`).

Sources: [Firestore rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions), [Rules data validation](https://firebase.google.com/docs/rules/data-validation), [Realtime updates](https://firebase.google.com/docs/firestore/query-data/listen), [Index overview](https://firebase.google.com/docs/firestore/query-data/index-overview), [Custom claims](https://firebase.google.com/docs/auth/admin/custom-claims), [Rules and Auth](https://firebase.google.com/docs/rules/rules-and-auth)
