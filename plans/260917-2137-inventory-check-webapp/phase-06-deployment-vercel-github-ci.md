# Phase 06 — GitHub + Vercel Deployment + Rules CI

> Revised 2026-09-17: adds R2 server-only secrets to Vercel and the R2 CORS/preview-domain gotcha. Firebase Storage rules removed from the deploy set.

## Context Links

- [plan.md](plan.md)
- [research/researcher-05-nextjs-firebase-vercel.md](research/researcher-05-nextjs-firebase-vercel.md) (§4, §7, §8)

## Overview

- **Priority:** P1 (nothing ships without it)
- **Status:** pending
- **Effort:** 2h
- **Blocked by:** Phase 05
- Push to GitHub, connect Vercel, configure env vars, verify the production URL on real phones, document the ops runbook.

## Key Insights

- `NEXT_PUBLIC_*` values are **inlined at build time** — changing one in the Vercel dashboard does nothing until a **redeploy**. This is the #1 "why is prod still broken" confusion. (The four R2 secrets are server-only and read at request time, so they do *not* need a redeploy — an easy inconsistency to trip over.)
- **Vercel deploys only the Next.js app.** Firestore rules and indexes deploy separately via the Firebase CLI. A deploy that "succeeds" with stale rules is a live security hole. There are no Storage rules in this project — R2 is guarded by the presign API route instead.
- **R2 CORS is a third deploy target that nobody remembers.** Preview URLs change per branch; without `https://*.vercel.app` in `AllowedOrigins`, photo upload fails *only on previews* while working perfectly in prod.
- Preview deploys get fresh `*-git-<branch>-<team>.vercel.app` URLs that are not in Firebase's authorized-domains allowlist — harmless here **only because** we use `signInWithEmailAndPassword` + `signInAnonymously`, which bypass the allowlist. Do not introduce popup OAuth later without revisiting this.
- Still add the **stable** production domain to Auth → Authorized domains as hygiene.
- A rules-deploy GitHub Action is optional; for a single admin with rarely-changing rules, manual `firebase deploy` is fine (YAGNI). Add it only if rules start churning.

## Requirements

**Functional**
- `main` pushes auto-deploy to production; PRs get preview URLs.
- Production app works end-to-end on a real iPhone and a real Android over HTTPS.
- `README.md` documents setup, env vars, rules deploy, and admin password reset.

**Non-functional**
- `npm run build` clean (no type errors, no `window is not defined`).
- Secrets: nothing but `.env.local` locally; no service-account key anywhere.

## Architecture

```
local repo ──push──► GitHub (main)
                        │
                        ├─ Vercel Git integration ──► production deploy  (NEXT_PUBLIC_* inlined, R2 secrets at runtime)
                        └─ PR branches            ──► preview deploys

repo files firestore.rules / firestore.indexes.json
                        └─ firebase CLI (manual, or optional GH Action) ──► Firebase project

Cloudflare R2 bucket (console-managed)
                        └─ CORS AllowedOrigins must cover localhost + *.vercel.app + prod domain
```

**Three** independent deploy targets: Vercel (app), Firebase CLI (rules + indexes), Cloudflare (bucket CORS + public base). All three must be current.

## Related Code Files

**Create**
- `README.md` — setup + ops runbook
- `.github/workflows/deploy-rules.yml` — *optional*, only if rules churn
- `docs/system-architecture.md`, `docs/codebase-summary.md` — per project documentation rules

**Modify**
- `package.json` — scripts: `dev`, `dev:https`, `build`, `lint` (note `next lint` was removed in Next 16 — use the `eslint` CLI), `rules:deploy`
- `.gitignore` — confirm `.env*.local`, `.firebase/`, `certificates/`

## Implementation Steps

1. **GitHub**:
   ```powershell
   gh repo create tonkho --private --source . --remote origin
   git add -A
   git commit -m "feat: inventory check web app with barcode scanning and realtime sync"
   git push -u origin main
   ```
   Verify `.env.local` is **not** in the commit (`git log --stat` / `git ls-files | Select-String env`).
2. **Vercel**: import the GitHub repo. Framework auto-detected (Next.js). Add env vars, ticked for **Production + Preview + Development**:
   - Public (inlined at build): `NEXT_PUBLIC_FIREBASE_API_KEY`, `..._AUTH_DOMAIN`, `..._PROJECT_ID`, `..._MESSAGING_SENDER_ID`, `..._APP_ID`, `NEXT_PUBLIC_R2_PUBLIC_BASE`
   - **Secret (server-only, never `NEXT_PUBLIC_`)**: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   Deploy.
3. **Firebase authorized domains**: add the production Vercel domain (e.g. `tonkho.vercel.app`) and any custom domain. `localhost` is pre-authorized.
4. **R2 CORS**: confirm `AllowedOrigins` includes `https://*.vercel.app` and the production domain. Test a photo upload on a **preview** deploy, not just prod — this is where it breaks.
5. **Rules re-deploy** (in case anything changed after Phase 01):
   ```powershell
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```
   Add `"rules:deploy"` to `package.json` scripts so this is never forgotten.
6. **Index sync back to repo** after any console-created index:
   ```powershell
   npx firebase firestore:indexes > firestore.indexes.json
   ```
7. **Production smoke test on real devices** (not desktop emulation):
   - iPhone Safari: camera permission prompt appears, EAN-13 scans, HEIC photo uploads to R2.
   - Android Chrome: same, plus torch button appears.
   - Two devices simultaneously: creates cross-appear; concurrent edit of one batch produces a conflict banner on the loser.
   - Admin login → stock view → history timeline → Excel export downloads and opens.
8. **`README.md`**: Firebase + Cloudflare setup order, env var table (marking which four are secrets), `rules:deploy` command, admin password reset, the "NEXT_PUBLIC is build-time" warning, and the **three-deploy-targets** warning.
9. **Docs** per project rules: `docs/system-architecture.md` (the data-flow diagram from Phase 02 + the R2 presign flow from Phase 03) and `docs/codebase-summary.md` (file map).
10. **R2 usage check**: confirm the bucket is within the free tier and note where usage is visible in the Cloudflare dashboard.
11. *Optional*: add `.github/workflows/deploy-rules.yml` triggered on changes to `firestore.rules` / `firestore.indexes.json`, authenticating via **Workload Identity Federation** (preferred over a committed SA key). Service account needs **Firebase Rules Admin** + **Cloud Datastore Index Admin**. Skip unless rules churn.

## Todo List

- [ ] 6.1 GitHub repo created and pushed; **no R2 secrets in history**
- [ ] 6.2 Vercel connected; 6 public + 4 secret env vars set across all 3 environments
- [ ] 6.3 Production deploy green; `npm run build` clean locally
- [ ] 6.4 Production + custom domain added to Firebase authorized domains
- [ ] 6.5 R2 CORS verified by uploading a photo from a **preview** deploy
- [ ] 6.6 Rules + indexes deployed and verified in console
- [ ] 6.7 `rules:deploy` npm script added
- [ ] 6.8 Real-device smoke test: iPhone + Android, scan + photo + concurrent create
- [ ] 6.9 Concurrent-edit conflict verified on production (two devices, one batch)
- [ ] 6.10 Admin login + stock view + history timeline + Excel export verified on production
- [ ] 6.11 `README.md` ops runbook written (incl. three deploy targets)
- [ ] 6.12 `docs/system-architecture.md` + `docs/codebase-summary.md` written
- [ ] 6.13 R2 usage within free tier; client bundle grep for `R2_SECRET` returns nothing

## Success Criteria

- Pushing to `main` produces a working production deploy with no manual steps.
- Both a real iPhone and a real Android complete a full scan → photo → save cycle on the production URL.
- Photo upload works on a **preview** deploy as well as production (CORS proven).
- Two devices on production show each other's entries within 2s; a concurrent edit of one batch yields a conflict banner, not a silent overwrite.
- Admin exports a 4-sheet `.xlsx` from production that opens correctly in Excel.
- `git log -p` contains no R2 credentials and no Firebase credentials beyond the public web config.
- Firebase project is still on **Spark** — no billing attached.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `NEXT_PUBLIC_*` set in Vercel but not redeployed → prod uses stale/empty config | **High** | High | README warning + redeploy as an explicit step after any public env change |
| Rules not deployed / stale → open database in production | Med | **Critical** | `rules:deploy` script + 6.6 console verification before announcing the URL |
| **R2 CORS missing preview origins → uploads fail only on previews** | **High** | Med | `https://*.vercel.app` wildcard; proven by test 6.5 |
| **R2 secret committed or leaked into the client bundle** | Low | **Critical** | `.gitignore` check 6.1 + bundle grep 6.13; rotate the token immediately if it ever lands in git history |
| `.env.local` committed | Low | High | `.gitignore` verified pre-push (6.1) |
| Build fails on Vercel but passed locally (case-sensitive imports on Linux) | Med | Med | Keep all filenames kebab-case lowercase; verify the first deploy build log |
| Camera works locally but not on prod (mixed content / permissions policy) | Low | High | Vercel is HTTPS by default; real-device test 6.8 is the gate |
| Firestore free (Spark) tier exceeded by an unexpected loop | Low | Med | `limit(200)` on all live queries; stock/export use bounded cursor loops |
| Custom domain added later breaks auth | Low | Med | Add it to Firebase authorized domains **and** R2 CORS at the same time |

## Security Considerations

- Only the Firebase **web config** is public — correct by design. No Admin SDK, no service-account JSON in the repo or in Vercel.
- **The four R2 variables are the project's only real secrets.** Server-only on Vercel, scoped to one bucket, Object Read & Write. If one ever reaches git history, rotating the R2 API token is the fix — removing the commit is not.
- If the optional GitHub Action is added, use Workload Identity Federation rather than a long-lived key.
- The repo should be **private** — not because the web config is secret, but to avoid advertising the admin email and rules structure.
- Announce the production URL only after 6.6 (rules verified) — test-mode rules in production would be a full data breach.

## Rollback Plan

- App: Vercel → Deployments → promote the previous deployment (instant, no rebuild).
- Rules: versioned in git; `git revert` the rules commit and re-run `rules:deploy`. Firebase console also retains a rules version history with one-click rollback.
- Indexes: deleting an index is safe but rebuilding takes minutes — avoid churn.
- R2 public base: changing `NEXT_PUBLIC_R2_PUBLIC_BASE` (r2.dev ↔ custom domain) is an env change + redeploy with **no data migration**, because entries store `photoKey`, not a URL.
- R2 CORS: console-edited, takes effect immediately, no deploy needed.
- Data: no migration in v1, so no data rollback path is needed. If a schema change ever lands, note that `rev` and `status` are load-bearing for the rules — a dual-read migration plan would be required.

## Next Steps

- Hand over: walk the user through adding a product, doing a stock count with two phones (including one deliberate concurrent edit so they see the conflict banner), viewing an entry's history, and exporting.
- Post-launch watch list: Firestore read counts, R2 storage/ops usage, any `permission-denied` spikes (sign of a rules/field mismatch or a `rev` bug).

## Unresolved Questions

1. Custom domain, or is `*.vercel.app` acceptable to the business? (Also decides the R2 public base.)
2. Private repo (recommended) or public?
3. Does the user want the optional rules-deploy GitHub Action, or is manual CLI deploy fine? Plan recommends **manual** (YAGNI).
