'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { normalizeBarcode, SUPPORTED_BARCODE_FORMATS } from '@/lib/barcode-utils';

export interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  formats?: readonly string[];
}
interface Detector {
  detect(video: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface DetectorConstructor {
  new(options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}
type CameraCapabilities = MediaTrackCapabilities & { torch?: boolean };

function playBeep() {
  try {
    const AudioCtx = window.AudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => { void ctx.close().catch(() => {}); };
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  } catch {
    // Audio is optional on browsers that require a user gesture.
  }
}

async function requestCameraStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
  } catch (error) {
    // Permission/busy-device errors must not trigger repeated permission requests.
    if (!(error instanceof Error) || error.name !== 'OverconstrainedError') throw error;
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

export function useBarcodeScanner({ onScan, formats = SUPPORTED_BARCODE_FORMATS }: UseBarcodeScannerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const optionsRef = useRef({ onScan, formats });
  useEffect(() => { optionsRef.current = { onScan, formats }; }, [onScan, formats]);

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);

  const stop = useCallback(() => {
    // Invalidate every outstanding camera/play/detector promise immediately.
    sessionRef.current += 1;
    cleanupRef.current?.();
    cleanupRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsScanning(false);
    setIsTorchOn(false);
    setHasTorch(false);
  }, []);

  const start = useCallback(async () => {
    stop();
    setError(null);
    const session = sessionRef.current;
    const isCurrent = () => sessionRef.current === session;
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    const startupTimer = setTimeout(() => {
      if (!isCurrent()) return;
      stop();
      setError('Camera hoặc bộ quét khởi động quá lâu. Hãy kiểm tra quyền camera và kết nối mạng, rồi thử lại.');
    }, 15000);
    cleanupRef.current = () => {
      clearTimeout(startupTimer);
      clearTimeout(scanTimer);
    };

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera is unavailable');
      }
      const stream = await requestCameraStream();
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.srcObject = stream;
      // play() waits for enough data itself; do not swallow playback failures.
      await video.play();
      if (!isCurrent()) return;

      const track = stream.getVideoTracks()[0];
      try {
        const capabilities = track?.getCapabilities?.() as CameraCapabilities | undefined;
        setHasTorch(Boolean(capabilities?.torch));
      } catch { /* Some mobile browsers don't implement getCapabilities. */ }

      let detector: Detector | undefined;
      const targetFormats = [...optionsRef.current.formats];
      const NativeDetector = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (NativeDetector) {
        try {
          const supported = await NativeDetector.getSupportedFormats();
          if (!isCurrent()) return;
          const valid = targetFormats.filter((format) => supported.includes(format));
          if (valid.length) detector = new NativeDetector({ formats: valid });
        } catch { /* Use the bundled fallback if native detection is unavailable. */ }
      }
      if (!isCurrent()) return;
      if (!detector) {
        const { BarcodeDetector } = await import('barcode-detector/ponyfill');
        if (!isCurrent()) return;
        const supported = await BarcodeDetector.getSupportedFormats();
        if (!isCurrent()) return;
        detector = new BarcodeDetector({ formats: supported.filter((format) => targetFormats.includes(format)) });
      }
      if (!isCurrent()) return;
      const activeDetector = detector;

      // One detection at a time, with a pause for video rendering on mobile CPUs.
      const scanLoop = async () => {
        if (!isCurrent()) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          try {
            const hits = await activeDetector.detect(video);
            if (!isCurrent()) return;
            clearTimeout(startupTimer);
            setIsScanning(true);
            const code = hits.map((hit) => normalizeBarcode(hit.rawValue)).find(Boolean);
            if (code) {
              stop();
              playBeep();
              navigator.vibrate?.(80);
              optionsRef.current.onScan(code);
              return;
            }
          } catch {
            // A transient frame error can be retried; startup remains bounded.
          }
        }
        if (isCurrent()) scanTimer = setTimeout(scanLoop, 150);
      };
      void scanLoop();
    } catch (cause) {
      if (!isCurrent()) return;
      stop();
      const name = cause instanceof Error ? cause.name : '';
      if (name === 'NotAllowedError') {
        setError('Chưa được phép dùng camera. Hãy cấp quyền máy ảnh trong cài đặt trang web rồi thử lại.');
      } else if (name === 'NotFoundError') {
        setError('Không tìm thấy camera trên thiết bị.');
      } else if (name === 'NotReadableError') {
        setError('Camera đang bận. Hãy đóng ứng dụng khác đang dùng camera rồi thử lại.');
      } else {
        setError('Không thể khởi động bộ quét. Hãy thử lại hoặc đóng để nhập mã bằng tay.');
      }
    }
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const session = sessionRef.current;
    const nextState = !isTorchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextState } as MediaTrackConstraintSet],
      });
      if (session === sessionRef.current) setIsTorchOn(nextState);
    } catch { /* Torch support is optional. */ }
  }, [isTorchOn]);

  return { videoRef, isScanning, error, hasTorch, isTorchOn, start, stop, toggleTorch };
}
