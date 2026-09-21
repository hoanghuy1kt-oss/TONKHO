# Research 01 — Browser Barcode Scanning (Next.js, 2026)

Date: 2026-09-17 | Scope: phone camera in browser, no native app, no hardware scanner.

## TL;DR Recommendation

**Use `barcode-detector` (ponyfill) as the single code path. Do NOT branch on native vs fallback for v1.**

- Native `BarcodeDetector` is unavailable on iOS (all iOS browsers = WebKit) → ~half of retail staff phones miss it.
- Ponyfill = ZXing-C++ compiled to WASM, same API shape, fast enough (WASM, not the dead JS port).
- Optional micro-opt later: use native when `'BarcodeDetector' in globalThis` AND `getSupportedFormats()` covers your list; otherwise ponyfill. Same call signature → 10 lines of glue.

### Packages (verified on npm registry, 2026-09-17)

| Package | Version | Verdict |
|---|---|---|
| `barcode-detector` | **3.2.2** (pub 2026-08-16) | **PRIMARY.** Ponyfill+polyfill, dep `zxing-wasm@3.1.3` |
| `zxing-wasm` | 3.1.4 (2026-09-10) | transitive; use directly only if you need raw ZXing opts |
| `@zxing/browser` | 0.2.1 (2026-07-06) | ❌ skip — wraps `@zxing/library` (pure JS, maintenance mode) |
| `@zxing/library` | 0.23.0 (2026-04-29) | ❌ skip — JS port, slow on 1D, project seeking maintainers |
| `html5-qrcode` | **2.3.8 — last publish 2023-04-15** | ❌ dead. 3.5 yrs stale, uses old zxing-js. Don't. |
| `@yudiel/react-qr-scanner` | 2.6.0 (2026-05-13) | ⚠️ optional React wrapper, wraps `barcode-detector@^3.1.3`. Convenient, but thin — hand-rolling the hook is ~80 lines and avoids lock-in |
| `@ericblade/quagga2` | 1.12.1 (2025-12-20) | ❌ 1D only, weaker than ZXing-C++ |

```bash
npm i barcode-detector
```

## 1. Primary + Fallback Strategy

```
BarcodeDetector native (if present + formats supported)  →  barcode-detector/ponyfill (ZXing WASM)
                                                         →  manual keyboard entry (ALWAYS ship this)
```

- Import **`barcode-detector/ponyfill`**, not `barcode-detector/polyfill`. Ponyfill = no global pollution, deterministic behavior across devices (avoids "works on my Pixel, fails on iPhone" bugs from differing native engines).
  - Subpaths: `barcode-detector/ponyfill` (named export), `barcode-detector/polyfill` (side-effect), `barcode-detector` (both). Old `/pure` + `/side-effects` names deprecated.
- **Next.js/SSR:** the module touches `globalThis`/WASM → import client-side only. Mark component `"use client"` and load via `next/dynamic` with `ssr:false`, or dynamic `await import()` inside `useEffect`.
- **WASM hosting:** by default the `.wasm` is resolved relative to the bundle/CDN. Under a strict CSP or for offline/PWA use, pin it explicitly:
  ```ts
  import { prepareZXingModule, ZXING_WASM_VERSION } from "barcode-detector/ponyfill";
  prepareZXingModule({ overrides: { locateFile: (p, prefix) =>
    p.endsWith(".wasm") ? `/wasm/${p}` : prefix + p } });   // copy file into /public/wasm
  ```
  (`setZXingModuleOverrides` is deprecated.) Prewarm on mount — first detect otherwise pays ~300–800 ms WASM compile.

## 2. iOS Safari Quirks (still true in 2026)

- **BarcodeDetector: NOT available.** caniuse shows Safari + iOS Safari through 27.1 as "disabled by default" (Shape Detection behind an experimental WebKit flag, "Under Consideration" since 2024, and broken on iOS since 18). Treat as absent. All iOS browsers are WebKit → no escape via Chrome iOS.
- **HTTPS mandatory.** `getUserMedia` + `BarcodeDetector` both require a secure context. `localhost` is secure; a LAN IP (`192.168.x.x`) is **not** → use `next dev --experimental-https`, ngrok/Cloudflare Tunnel, or deploy to test on a real phone.
- **User gesture:** Safari is far happier when `getUserMedia()` is triggered from a click/tap handler. Never call it on mount — render a "Scan" button. Permission is **per-page-session**, not remembered like Chrome → user re-prompts on every fresh load.
- **`<video>` attributes are non-negotiable:** `playsInline muted autoPlay` (React: `playsInline`). Without `playsinline` iOS takes the video fullscreen; without `muted` autoplay is blocked.
- Always `await video.play()` and catch `NotAllowedError` — retry inside the tap handler. Low Power Mode blocks autoplay even when muted.
- **facingMode:** use `{ video: { facingMode: { ideal: "environment" }, width: {ideal:1280}, height:{ideal:720} } }`. Do **not** use `exact` — it throws `OverconstrainedError` on some devices/desktops. iOS may pick the ultra-wide lens or auto-switch lenses mid-stream; if barcodes read blurry, enumerate devices and pick the plain back camera by label, or request `width: { ideal: 1920 }` to bias toward the wide lens.
- **One stream at a time.** Multiple concurrent `getUserMedia()` calls break on iOS. Stop the old stream before requesting a new one (e.g. camera switch).
- **Backgrounding kills the stream.** On PWA/tab return the track goes `muted`/`ended`. Listen to `visibilitychange` + `track.onended` and re-acquire.
- `ImageCapture` is absent on Safari → no torch via that route (see §5).

## 3. Formats for Retail

Needed: **EAN-13** (global retail, incl. VN), **EAN-8** (small packs), **UPC-A / UPC-E** (US goods), **CODE-128** (internal/warehouse/logistics labels), optionally **ITF-14** (carton) and **QR** (internal labels).

```ts
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] as const;
const detector = new BarcodeDetector({ formats: [...FORMATS] });
```

- **Restricting formats is the single biggest perf win** — ZXing WASM runs one reader pass per enabled format; `any` can be 5–10x slower and multiplies false reads.
- UPC-A is EAN-13 with a leading `0`. Normalize before DB lookup: store/query 13 digits, left-pad UPC-A. UPC-E must be expanded to UPC-A/EAN-13 — ZXING returns the compressed form for `upc_e`, so either expand it or just include `upc_a` and let the reader expand.
- Validate the check digit yourself (mod-10) before hitting the API — kills most misreads for free.
- Don't add `qr_code`/`pdf417`/`data_matrix` unless actually used.

## 4. React Hook Sketch

```tsx
"use client";
import { useEffect, useRef, useState, useCallback } from "react";

export function useBarcodeScanner({ onScan, formats, enabled }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRef = useRef({ code: "", t: 0 });
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {           // CALL FROM A TAP HANDLER (iOS)
    const { BarcodeDetector } = await import("barcode-detector/ponyfill");
    const detector = new BarcodeDetector({ formats });
    let stopped = false, raf = 0, timer: any;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" },
                 width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();                                // needs playsInline + muted

      // Throttled loop: ~8 fps is plenty; rAF alone burns battery & blocks paint.
      const tick = async () => {
        if (stopped || v.readyState < 2) return;
        try {
          const [hit] = await detector.detect(v);    // detect(video) directly — no canvas copy
          if (hit?.rawValue) {
            const now = Date.now();
            const { code, t } = lastRef.current;
            if (code !== hit.rawValue || now - t > 2000) {   // duplicate debounce
              lastRef.current = { code: hit.rawValue, t: now };
              navigator.vibrate?.(60);
              onScan(hit.rawValue, hit.format);
            }
          }
        } catch { /* ignore per-frame decode errors */ }
      };
      timer = setInterval(() => { raf = requestAnimationFrame(tick); }, 120);
    } catch (e: any) { setError(e.name); }

    return () => {                                   // CLEANUP
      stopped = true;
      clearInterval(timer); cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach(t => t.stop());   // MUST stop tracks
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null; // MUST null srcObject
    };
  }, [formats, onScan]);

  useEffect(() => { /* wire start()/stop() + visibilitychange re-acquire */ }, [enabled]);
  return { videoRef, start, error };
}
```

**rAF vs interval:** neither alone. Use `setInterval(100–150ms)` to pace, and wrap the actual work in one `requestAnimationFrame` so it pauses when the tab is hidden. Pure rAF (60 fps) wastes CPU/battery and makes cheap phones overheat; pure `setInterval` keeps decoding in background tabs. An async detect can overlap — guard with an `inFlight` boolean if you drop the interval below ~100 ms.

**Cleanup checklist (leaks = camera LED stuck on):** stop every track, null `srcObject`, clear interval + cancel rAF, guard against React 18 StrictMode double-invoke (the effect runs twice in dev — idempotent start/stop).

## 5. Known Pitfalls

- **Torch/flash:** `track.applyConstraints({ advanced: [{ torch: true }] })` works on **Chrome/Android only**, and only if `track.getCapabilities().torch === true`. **Always feature-check** — unguarded calls throw `OverconstrainedError`. iOS Safari never exposes torch (no `ImageCapture` either). Hide the button when unsupported; provide a bright white overlay/"screen flash" as a weak substitute, and rely on store lighting.
- **Focus on cheap cams:** `focusMode` / `focusDistance` constraints are Chrome-Android-only, absent on iOS. Practical mitigations: (a) request 1280×720+ so the barcode has enough pixels; (b) draw a scan-window overlay and tell users to hold 10–20 cm away; (c) `track.applyConstraints({ zoom })` where supported to fill the frame; (d) tap-to-focus does not exist on web — instead, briefly stop/restart the track to force a refocus if stuck; (e) macro/ultra-wide lens on iPhone gives soft images — bias to the wide lens.
- **Duplicate scans:** same barcode decodes ~8x/sec. Debounce by `(value, 1.5–2 s)` as above. For inventory counting, prefer *explicit accumulate* (each accepted scan increments qty and shows a toast + haptic) over silently ignoring — a cashier really may scan the same SKU twice. Give a visible "scanned N" list with undo.
- **Glare/curved packaging:** EAN on bottles/bags warps. Crop a horizontal scan band (e.g. 80% width × 30% height) from the video onto a small canvas and feed that to `detect()` — smaller input = faster + fewer false hits. Optionally retry rotated ±30° only after a straight pass fails.
- **First-scan latency:** preload the WASM (`prepareZXingModule` + a dummy 1×1 detect) while the user is still on the previous screen.
- **Permissions UX:** handle `NotAllowedError` (denied), `NotFoundError` (no camera), `NotReadableError` (camera busy — another app). Show a manual-entry input as permanent escape hatch; warehouse Wi-Fi + old phones will fail sometimes.
- **HTTP on LAN** is the #1 "camera doesn't work" support ticket. Enforce HTTPS.

## Unresolved Questions

1. Target device mix — any iOS < 16 or budget Androids < 3 GB RAM? Affects whether WASM-only is acceptable.
2. Are internal warehouse labels CODE-128/QR, or only manufacturer EAN-13? Determines the format list.
3. Offline/PWA required (warehouse dead zones)? If yes, must self-host the `.wasm` in `/public` and precache it.
4. Is a hardware Bluetooth HID scanner ever in scope later? If so, add a hidden keyboard-wedge input path now (cheap, big speed win for bulk counting).

Sources: [caniuse BarcodeDetector](https://caniuse.com/mdn-api_barcodedetector), [MDN Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API), [Sec-ant/barcode-detector](https://github.com/Sec-ant/barcode-detector), [npm barcode-detector](https://www.npmjs.com/package/barcode-detector), [WebKit bug 281848](https://bugs.webkit.org/show_bug.cgi?id=281848), [Guide to Safari WebRTC](https://webrtchacks.com/guide-to-safari-webrtc/), [Dynamsoft camera focus control](https://www.dynamsoft.com/codepool/camera-focus-control-on-web.html), [Open-source JS barcode scanners](https://scanbot.io/blog/popular-open-source-javascript-barcode-scanners/)
