import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('src/hooks/use-barcode-scanner.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

// Small hook host to exercise real async lifecycle code without a physical camera.
function fixture() {
  const slots = [];
  let index = 0;
  let effects = [];
  let timerId = 0;
  const timers = new Map();
  const camera = deferred();
  const track = { stops: 0, stop() { this.stops++; }, getCapabilities: () => ({ torch: true }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { srcObject: null, readyState: 2, videoWidth: 1280, play: async () => {} };
  let requests = 0;
  let detections = 0;
  let detect = async () => [];
  class Detector {
    static async getSupportedFormats() { return ['ean_13']; }
    detect(video) { detections++; return detect(video); }
  }
  const equal = (a, b) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(value) { const i = index++; return slots[i] ??= { current: value }; },
    useState(value) {
      const i = index++;
      if (!(i in slots)) slots[i] = value;
      return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useCallback(fn, deps) {
      const i = index++;
      if (!equal(slots[i]?.deps, deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!equal(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const loaded = { exports: {} };
  new Function('require', 'exports', 'window', 'navigator', 'setTimeout', 'clearTimeout', source)(
    (name) => {
      if (name === 'react') return react;
      if (name === '@/lib/barcode-utils') return { normalizeBarcode: (s) => s.trim(), SUPPORTED_BARCODE_FORMATS: ['ean_13'] };
      throw new Error(`Unexpected dependency ${name}`);
    }, loaded.exports, { BarcodeDetector: Detector },
    { mediaDevices: { getUserMedia: () => { requests++; return camera.promise; } } },
    (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    (id) => timers.delete(id),
  );
  const render = (onScan = () => {}) => {
    index = 0; effects = [];
    const hook = loaded.exports.useBarcodeScanner({ onScan });
    hook.videoRef.current = video;
    effects.forEach((fn) => fn());
    return hook;
  };
  return { render, camera, stream, track, video, timers,
    setDetect: (fn) => { detect = fn; },
    requests: () => requests, detections: () => detections,
  };
}

test('state changes and new inline callbacks do not restart the camera', async () => {
  const f = fixture();
  const initial = f.render();
  const pending = initial.start();
  f.camera.resolve(f.stream);
  await pending; await flush();
  const updated = f.render(() => {});
  assert.equal(updated.start, initial.start);
  assert.equal(updated.stop, initial.stop);
  assert.equal(updated.isScanning, true);
  assert.equal(f.requests(), 1);
  assert.equal(f.track.stops, 0);
  updated.stop();
});

test('closing while permission is pending stops a late stream without attaching it', async () => {
  const f = fixture();
  const hook = f.render();
  const pending = hook.start();
  hook.stop();
  f.camera.resolve(f.stream);
  await pending;
  assert.equal(f.track.stops, 1);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.detections(), 0);
});

test('closing during detection discards late barcode results', async () => {
  const f = fixture();
  const result = deferred();
  let scanned = 0;
  f.setDetect(() => result.promise);
  const hook = f.render(() => scanned++);
  f.camera.resolve(f.stream);
  await hook.start();
  hook.stop();
  result.resolve([{ rawValue: '123' }]);
  await flush();
  assert.equal(scanned, 0);
  assert.equal(f.timers.size, 0);
});

test('scan uses the latest callback without restarting and stops after one result', async () => {
  const f = fixture();
  const result = deferred();
  let oldCalls = 0, newCalls = 0;
  f.setDetect(() => result.promise);
  const hook = f.render(() => oldCalls++);
  f.camera.resolve(f.stream);
  await hook.start();
  f.render(() => newCalls++);
  result.resolve([{ rawValue: '123' }]);
  await flush();
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 1);
  assert.equal(f.track.stops, 1);
  assert.equal(f.timers.size, 0);
});

test('camera permission denial is not retried automatically', async () => {
  const f = fixture();
  const hook = f.render();
  const pending = hook.start();
  f.camera.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  await pending;
  assert.equal(f.requests(), 1);
  assert.match(f.render().error, /cấp quyền/);
  assert.equal(f.timers.size, 0);
});

test('startup timeout shows an error and releases a late permission grant', async () => {
  const f = fixture();
  const hook = f.render();
  const pending = hook.start();
  [...f.timers.values()].find((timer) => timer.ms === 15000).fn();
  assert.match(f.render().error, /quá lâu/);
  f.camera.resolve(f.stream);
  await pending;
  assert.equal(f.track.stops, 1);
  assert.equal(f.video.srcObject, null);
});

test('detection waits 150ms between completed frames', async () => {
  const f = fixture();
  const hook = f.render();
  f.camera.resolve(f.stream);
  await hook.start(); await flush();
  assert.equal(f.detections(), 1);
  assert.deepEqual([...f.timers.values()].map((timer) => timer.ms), [150]);
  hook.stop();
});
