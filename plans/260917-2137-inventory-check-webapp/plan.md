---
title: "Inventory Check Web App (TONKHO) — barcode scan, editable batches, realtime multi-user, admin export"
description: "Responsive Next.js app: camera barcode scan, product + open-batch lookup, editable batch entries (expiry/qty/photo) with edit history, live multi-device sync, Cloudflare R2 photos, password-gated admin with Excel export."
status: pending
priority: P1
effort: 25h
branch: main
tags: [nextjs, firebase, firestore, cloudflare-r2, barcode, inventory, vercel, realtime]
created: 2026-09-17
updated: 2026-09-17
---

# TONKHO — Inventory Check Web App

Mobile-first (laptop-capable) web app for a small VN business. Staff scan/type a barcode; the app shows the product **and its existing open batches**. Staff either **correct an existing batch** (qty/expiry/photo) or **add a new batch** (different expiry). Every edit is recorded in a per-entry history trail. Multiple phones write concurrently, all screens update live. One admin password-gate views everything, sees per-entry history and live stock-on-hand, and exports .xlsx.

## Locked Stack Decisions

| Area | Decision | Why |
|---|---|---|
| Framework | Next.js 16.3.5, App Router, TS, Tailwind v4, `src/` | Vercel-native, client-SDK friendly |
| Scanning | `barcode-detector@3.2.2` ponyfill (ZXing WASM), single code path | `BarcodeDetector` absent on all iOS browsers in 2026 |
| DB | Firestore **Spark/free**, `asia-southeast1`, flat `products/{barcode}` + `inventoryEntries/{entryId}` + `inventoryEntries/{entryId}/history/{historyId}` | data-only usage stays inside the free tier once Storage is gone |
| Entry lifecycle | **Mutable** batch docs, `rev` counter, **soft delete** (`status`) | staff correct quantities; history + soft delete keep the trail intact |
| Write conflicts | Rules-enforced `rev == resource.rev + 1` + `writeBatch(entry + history)` | detects concurrent edits server-side; no transaction round-trip needed |
| Photos | `browser-image-compression@2.0.2` → 2048px/1.5MB → **presigned PUT to Cloudflare R2** | R2 free tier needs no card, zero egress; browser uploads direct, bypassing Vercel's 4.5MB body limit |
| Photo identity | Store **`photoKey`** only; URL derived from `NEXT_PUBLIC_R2_PUBLIC_BASE` at render | public base can change (r2.dev → custom domain) with **zero data migration** |
| Auth | Anonymous (staff, silent) + Email/Password (1 admin) | no popup → Vercel preview domains just work |
| Staff identity | Firebase anon uid (for rules) **+** self-reported name in `localStorage` | zero-friction; name is unverified — documented trust tradeoff |
| Excel | `write-excel-file` (lazy-loaded, client-side) | SheetJS npm is CVE-frozen; exceljs unmaintained + 250KB |
| Hosting | Vercel (GitHub main → prod, PR → preview) | per requirement |

**Superseded (2026-09-17):** Firebase Storage + Blaze plan. Replaced by Cloudflare R2, which removes the billing hard-blocker entirely. `storage.rules` is no longer part of this project; the R2 presign API route is the new write boundary.

## Phases

| # | Phase | Status | Effort | Blocked by | Owns |
|---|---|---|---|---|---|
| 01 | [Project scaffold + Firebase + R2 setup](phase-01-project-scaffold-and-firebase-setup.md) | pending | 3h | — | repo root, `src/lib/firebase.ts`, `firestore.rules`, `firestore.indexes.json` |
| 02 | [Data layer + scan + batch lookup + entry form](phase-02-data-layer-and-barcode-scan-ui.md) | pending | 7h | 01 | `src/types/`, `src/hooks/`, `src/lib/inventory-*.ts`, `src/app/page.tsx`, `src/components/scanner/`, `src/components/inventory/`, `src/components/staff/` |
| 03 | [Photo capture, compression, R2 upload](phase-03-photo-capture-compression-upload.md) | pending | 4h | 02 | `src/lib/photo-*.ts`, `src/components/photo/`, `src/app/api/photos/` |
| 04 | [Admin auth + dashboard + history + Excel export](phase-04-admin-auth-dashboard-excel-export.md) | pending | 5h | 02 | `src/app/login/`, `src/app/admin/`, `src/components/auth/`, `src/components/admin/`, `src/lib/export-*.ts` |
| 05 | [Realtime + edit-conflict hardening + polish](phase-05-realtime-hardening-and-polish.md) | pending | 4h | 03, 04 | `src/components/ui/`, cross-cutting edits |
| 06 | [GitHub + Vercel deploy + rules CI](phase-06-deployment-vercel-github-ci.md) | pending | 2h | 05 | `.github/`, Vercel config, `README.md` |

Phases 03 and 04 are **parallel-safe** (disjoint file ownership) once 02 lands.

## Key Dependencies

- **Cloudflare account + R2 bucket** (free tier, no card) — blocks Phase 01 completion. Needs: bucket, CORS policy, S3 API token, and a **public read path** (custom domain preferred; `r2.dev` subdomain is rate-limited and Cloudflare marks it dev-only).
- Firestore region `asia-southeast1` is **permanent** — must be right at creation.
- R2 credentials are the project's **first real secrets** (server-only env vars on Vercel, never `NEXT_PUBLIC_`).
- HTTPS required for camera — no LAN-IP testing; use `next dev --experimental-https` or a preview deploy.
- Admin UID (from Firebase console) must be pasted into `firestore.rules` before Phase 04.
- R2 CORS `AllowedOrigins` must cover Vercel preview URLs (`https://*.vercel.app`) or photo upload fails only on previews.

## Success Criteria (whole project)

1. Two phones scanning simultaneously both see each other's entries appear in < 2s with no lost writes.
2. Scanning a known barcode shows the product name **and its open batches with quantities**, so staff can pick "sửa lô này" vs "thêm lô mới".
3. Two phones editing the **same batch** concurrently: one write wins, the other is **rejected and told to refresh** — never a silent lost update.
4. Every create/update/delete appends a history record; the admin can see a per-entry timeline of who changed what, when.
5. A 12MP phone photo uploads at < 3MB (target 350–700KB) direct to R2 from iOS Safari and Android Chrome.
6. `/admin` is unreachable without the admin password **and** Firestore rules deny writes from an unauthenticated client.
7. Admin sees live stock-on-hand per product (sum of active batch quantities) and exports it to Excel with correct Vietnamese diacritics, real date cells, clickable photo links.
8. Production URL live on Vercel, auto-deploying from GitHub `main`.

## Open Questions

Consolidated in [phase-05](phase-05-realtime-hardening-and-polish.md#unresolved-questions). Resolved and removed on 2026-09-17: Blaze billing (moot — R2), photo required (yes), stock totals (yes, derived), staff edit rights (yes), offline behavior with required photo (block save).
