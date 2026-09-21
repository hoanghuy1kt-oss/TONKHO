# Research 05 — Next.js + Firebase + Vercel setup (Sep 2026)

> **PARTIALLY SUPERSEDED 2026-09-17.** Next.js/Firebase-SDK/Vercel/admin-gating guidance all stands. **Ignore every Storage + Blaze reference (§6.2, §6.4, §7, §8.2)** — the project uses Cloudflare R2, stays on the Spark tier, and ships no `storage.rules`. See [phase-01](../phase-01-project-scaffold-and-firebase-setup.md) and [phase-06](../phase-06-deployment-vercel-github-ci.md).

Scope: small responsive inventory app. Firestore + Storage + Auth (1 admin email/pw + Anonymous staff). GitHub → Vercel. Windows 11, empty repo.

---

## 1. Next.js version & scaffold

- **Stable: Next.js 16.3.5** (2026-09-11). React 19.2. App Router is **default + recommended**; Pages Router legacy-only.
- Turbopack is the **default bundler** in 16. ESLint or Biome; `next lint` removed (use ESLint CLI).

```powershell
npx create-next-app@latest tonkho --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

Notes: `--ts`, `--tailwind`, `--app`, `--turbopack`, `--agents-md` are already defaults; flags above are explicit/non-interactive. Add `--no-agents-md` if you don't want generated AGENTS.md/CLAUDE.md (project already has CLAUDE.md — recommend `--no-agents-md`). Tailwind v4 (CSS-first config, `@import "tailwindcss"` — no `tailwind.config.js` needed).

**Breaking changes to know (16 vs 15):**
| Change | Impact here |
|---|---|
| `params`/`searchParams` are **async** (sync access removed) | `const { id } = await params` in every dynamic page |
| `middleware.ts` → **`proxy.ts`**, export `proxy()`; Node runtime only, no edge | Naming only; we're not using it anyway (see §5) |
| `next lint` removed | use `eslint` CLI in package.json |
| Turbopack default | rare loader/webpack plugins break — we have none |
| Caching defaults tightened (`cacheComponents`) | client-side Firestore = unaffected |

Upgrade codemod if ever needed: `npx @next/codemod@canary upgrade latest`.

---

## 2. Project structure (KISS — flat, no over-engineering)

```
src/
  app/
    layout.tsx
    page.tsx                  # staff view (anon auth)
    admin/page.tsx            # admin-only, wrapped in <AuthGuard requireAdmin>
    login/page.tsx
  components/
    auth-guard.tsx
    ui/                       # buttons, dialogs (shadcn-style if used)
    inventory/                # item-list.tsx, item-form.tsx, ...
  lib/
    firebase.ts               # singleton init (client only)
    auth-context.tsx          # AuthProvider + useAuth
    inventory-repository.tsx  # (optional) firestore read/write fns
  hooks/
    use-inventory-items.ts    # onSnapshot subscriptions
  types/
    inventory.ts              # Item, StockCount, etc.
firebase.json
firestore.rules
firestore.indexes.json
storage.rules
.env.local        (gitignored)
.env.example      (committed)
```

Rules: keep files <200 LOC, kebab-case. Don't add a `services/`+`repositories/`+`dtos/` layering — one `lib/` + one `hooks/` folder is enough at this size.

---

## 3. Firebase client SDK (v12.19.0) init in App Router

`firebase` npm latest = **12.19.0**. Install: `npm i firebase`.

```ts
// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!, // <id>.firebasestorage.app
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

// guard: Next.js HMR / RSC re-eval would otherwise re-init
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
```

- **`firebase.ts` itself needs no `"use client"`** but only import it from Client Components. Put `"use client"` on `auth-context.tsx`, `auth-guard.tsx`, and every hook/component calling `onSnapshot`/`getAuth`. Keep hooks in separate files from UI so the RSC boundary stays clean.
- `getAuth()` touches `window`/IndexedDB → never import it in a Server Component or `layout.tsx` without `"use client"`. Symptom of getting it wrong: `ReferenceError: window is not defined` / auth persistence warnings during build.
- **Firebase web config is NOT a secret.** Google's docs state Firebase API keys "do not need to be treated as secrets" — the apiKey identifies the project, it does not authorize anything. Anyone can read it from the JS bundle by design. `NEXT_PUBLIC_*` is correct and safe. What *is* secret: Admin SDK service-account JSON (we don't use it). **Firestore/Storage Security Rules are the actual security boundary.** Write them before any real data goes in.

---

## 4. Env vars: local + Vercel

`.env.local` (gitignored by default in create-next-app) — same 6 keys with `NEXT_PUBLIC_` prefix.
`.env.example` — committed, same keys with empty/placeholder values.

Vercel dashboard → Settings → Environment Variables → add each key, tick **Production + Preview + Development**. Same Firebase project for all three is fine for this app size (a separate `-dev` project is YAGNI here).

```powershell
# optional: pull Vercel envs into .env.local
npx vercel link
npx vercel env pull .env.local
```

Gotcha: `NEXT_PUBLIC_*` is **inlined at build time**. Changing a value in Vercel requires a **redeploy** — it will not take effect on an existing build.

Git integration: connect the GitHub repo once in Vercel → push to `main` = production deploy; every other branch/PR = preview deploy with a unique `*.vercel.app` URL.

---

## 5. Admin route protection

**Why not middleware/`proxy.ts`:** Firebase client Auth stores the ID token in **IndexedDB, not a cookie**. `proxy.ts` runs on the server and sees only cookies/headers → it cannot know if the user is signed in. Any "redirect if no cookie" scheme requires manually minting a session cookie.

**Recommended (KISS):**
1. `AuthProvider` (`onAuthStateChanged`) in a client context at the root.
2. `<AuthGuard requireAdmin>` client component wrapping `/admin` — renders a spinner while `loading`, `router.replace("/login")` if no user, and "not authorized" if `user.email !== ADMIN_EMAIL` / `user.isAnonymous`.
3. **Firestore + Storage Rules are the real boundary** — the guard is UX only, trivially bypassed in devtools.

```
// firestore.rules sketch
function isAdmin() { return request.auth != null && request.auth.token.email == "admin@example.com"
       && request.auth.token.email_verified == true; }
match /items/{id} {
  allow read: if request.auth != null;              // anon staff can read
  allow write: if isAdmin();                        // only admin mutates
}
match /counts/{id} { allow create, read: if request.auth != null; allow update, delete: if isAdmin(); }
```
(Custom claim `admin: true` via Admin SDK is cleaner long-term, but email-match is fine for a single hardcoded admin.)

**Session-cookie alternative** (`signInWithEmailAndPassword` → `getIdToken()` → API route → `createSessionCookie()` via Admin SDK → `proxy.ts` verifies): enables true server-side gating and SSR. Needs Admin SDK + a real service-account secret in Vercel. **YAGNI for this app** — one admin, no SEO need, no SSR-rendered private data.

---

## 6. Firebase Console setup (order matters)

1. **Create project** (no Analytics needed). Note the project ID.
2. **Upgrade to Blaze** — mandatory: projects created after 2024-10-30 cannot provision a Storage bucket on Spark, and the billing requirement took full effect **2026-02-03**. Free "Always Free" tier still covers this app (~$0); set a **budget alert** anyway.
3. **Firestore** → Create database → **Native mode** → location **`asia-southeast1` (Singapore)** — lowest latency for Vietnam; `asia-southeast2` (Jakarta) is the alternative. **Location is permanent.** Start in *production mode* (locked), then deploy real rules from repo.
4. **Storage** → Get started → same region. Default bucket is `<project-id>.firebasestorage.app` (**not** `.appspot.com` — use this exact string in `storageBucket`).
5. **Authentication** → Get started → enable **Email/Password** and **Anonymous**.
6. **Add admin user**: Auth → Users → Add user (email + password). Copy its UID/email into the rules.
7. **Web app**: Project settings → Add app → Web → copy config into `.env.local`.
8. **Authorized domains** (Auth → Settings → Authorized domains): add your **production domain** and the **stable Vercel project domain** (`tonkho.vercel.app`). `localhost` is pre-authorized.

---

## 7. Firebase CLI — rules in the repo

```powershell
npm i -D firebase-tools           # or: npm i -g firebase-tools
npx firebase login
npx firebase init firestore storage      # pick existing project; writes firebase.json + rules files
npx firebase deploy --only firestore:rules,firestore:indexes,storage
```

`firebase.json`:
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage":   { "rules": "storage.rules" }
}
```
Note: `--only storage` deploys storage **rules** (there is no `storage:rules` target). Composite indexes: run a query, click the console's error link, then `npx firebase firestore:indexes > firestore.indexes.json` to sync back to repo.

**Optional GitHub Action** (only if rules change often — otherwise manual deploy is fine, YAGNI):
```yaml
# .github/workflows/deploy-rules.yml
on: { push: { branches: [main], paths: ['firestore.rules','storage.rules','firestore.indexes.json'] } }
jobs:
  rules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm i -g firebase-tools
      - run: firebase deploy --only firestore:rules,firestore:indexes,storage --project ${{ secrets.FIREBASE_PROJECT_ID }}
        env: { GOOGLE_APPLICATION_CREDENTIALS: ./sa.json }
```
Auth: prefer **Workload Identity Federation** (`google-github-actions/auth`) over a committed SA key; if using a key, store base64 in `secrets.FIREBASE_SERVICE_ACCOUNT` and decode at runtime. Service account needs **Firebase Rules Admin** + **Cloud Datastore Index Admin**.

---

## 8. Vercel + Firebase gotchas (2026)

1. **Preview-deploy auth domain mismatch** — every PR gets a new `*-git-<branch>-<team>.vercel.app` URL that is *not* in Firebase's authorized-domains allowlist. This breaks `signInWithPopup`/`signInWithRedirect` (`auth/unauthorized-domain`). There is still no automatic sync. **Mitigation: use `signInWithEmailAndPassword` + `signInAnonymously` only** — those are direct REST calls and **ignore the authorized-domains allowlist entirely**, so previews just work. This matches our requirements (no Google/OAuth sign-in needed). Bonus: no popup blockers, no Safari ITP issues.
2. **Storage bucket suffix**: `.firebasestorage.app`, not `.appspot.com`. Copying an old tutorial config → `storage/unknown` errors.
3. **`NEXT_PUBLIC_` inlined at build** — env change ⇒ redeploy (see §4).
4. **Firestore location is permanent** — pick `asia-southeast1` at creation, no migration later.
5. **Don't import `firebase-admin`** anywhere in client bundles; we aren't using it at all, which also dodges Vercel serverless cold-start/init-twice issues.
6. **Rules must be deployed** — Vercel deploys only the Next.js app. Test-mode rules expire ~30 days and then lock everything out; deploy real rules early.
7. **`next build` + Firebase**: keep `getAuth()`/`getStorage()` out of module scope of any file that a Server Component imports, or the build fails on `window is not defined`.
8. Windows: use PowerShell; `npx firebase` avoids global-install PATH issues. Git line endings — set `git config core.autocrlf true` to avoid noisy diffs.

---

## Unresolved questions

- Admin identity: hardcoded email match in rules vs. custom claim `admin:true` (needs a one-off Admin SDK script)? Recommend email match now.
- Single Firebase project for prod+preview, or separate `-dev` project? Recommend single (KISS).
- Does staff need write access (submitting stock counts) or read-only? Rules sketch above assumes staff can `create` counts.
- Image uploads: client-side compression before Storage upload — needed, or are photos small?

## Sources

- [Next.js blog / releases](https://nextjs.org/blog), [create-next-app CLI](https://nextjs.org/docs/app/api-reference/cli/create-next-app), [Upgrading to v16](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [firebase npm](https://www.npmjs.com/package/firebase), [Firebase API keys](https://firebase.google.com/docs/projects/api-keys), [Storage changes FAQ](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024), [Manage & deploy Rules](https://firebase.google.com/docs/rules/manage-deploy), [SSR apps](https://firebase.google.com/docs/web/ssr-apps)
- [Vercel env vars](https://vercel.com/docs/environment-variables), [Environments](https://vercel.com/docs/deployments/environments)
- [Vercel preview domain + Firebase auth discussion](https://github.com/firebase/firebase-js-sdk/discussions/6359)
