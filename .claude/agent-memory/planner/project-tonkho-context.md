---
name: project-tonkho-context
description: TONKHO is a Vietnamese-language inventory-check web app for a small business; stack and constraints were fixed by the user, not chosen by us
metadata:
  type: project
---

TONKHO = responsive web app (phone primary, laptop secondary) for a small Vietnamese business to check/track inventory: barcode scan → product lookup → batch entry (hạn sử dụng, số lượng, ảnh). All UI copy is Vietnamese. Single admin password gate; regular staff never log in.

**Why:** the user specified Firebase + GitHub + Vercel up front as a hard constraint — these were not our architectural choice, so do not re-litigate them in future plans. Next.js was recommended and accepted. The "critical" requirement the user called out by name is **real-time multi-user concurrency** (several staff on different phones during a stock count).

**Photos are on Cloudflare R2, not Firebase Storage** — the user swapped this to avoid the Blaze-plan billing requirement. Firestore/Auth stay on the free Spark tier. R2 credentials are the project's only real secrets.

**Entries are mutable, not an append-only log.** Staff scan a barcode, see existing open batches, and either correct one or add a new one. Every change appends to a `history` subcollection. Staff identify themselves with a self-reported name in `localStorage` (anonymous Firebase Auth runs underneath purely for rules gating) — the user accepted that attribution is unverified.

**How to apply:** when planning or reviewing TONKHO work, treat Firestore/Auth + R2 + Vercel as fixed. Judge every design against "does this survive 10 phones writing at once", "does this work on iOS Safari", and — since entries became editable — "what happens when two people edit the same batch". Those constraints killed most of the obvious choices (native BarcodeDetector, html5-qrcode, SheetJS, plain last-write-wins updates).

First plan: `plans/260917-2137-inventory-check-webapp/` — 6 phases, research reports under `research/` (three carry PARTIALLY SUPERSEDED banners after the 2026-09-17 revision; trust the phase files over the research).
