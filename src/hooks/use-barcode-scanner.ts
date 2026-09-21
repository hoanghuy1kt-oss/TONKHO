'use client';

import { useState, useRef, useCallback } from 'react';
import { normalizeBarcode } from '@/lib/barcode-utils';

export interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  formats?: readonly string[];
}

/**
 * Âm thanh bíp báo hiệu quét mã thành công (Web Audio API)
 */
function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  } catch {
    // Bỏ qua nếu trình duyệt chặn audio tự động
  }
}

/**
 * Mở luồng camera với các cấp độ fallback để đảm bảo luôn mở được trên mọi thiết bị
 */
async function requestCameraStream(): Promise<MediaStream> {
  // Cấp 1: Camera sau với độ phân giải tiêu chuẩn
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch (err1) {
    console.warn('Fallback 1: Không mở được camera phân giải cao, thử cấu hình cơ bản:', err1);
  }

  // Cấp 2: Chỉ yêu cầu camera sau (không ép độ phân giải)
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
      },
      audio: false,
    });
  } catch (err2) {
    console.warn('Fallback 2: Không mở được camera sau chuyên dụng, thử camera mặc định:', err2);
  }

  // Cấp 3: Mở bất kỳ camera nào có sẵn trên máy
  return await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });
}

export function useBarcodeScanner({ onScan }: UseBarcodeScannerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);

  const stop = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
    setIsTorchOn(false);
    setHasTorch(false);
  }, []);

  const start = useCallback(async () => {
    stop();
    setError(null);

    try {
      const targetFormats = [
        'ean_13',
        'ean_8',
        'upc_a',
        'upc_e',
        'code_128',
        'code_39',
        'code_93',
        'itf',
        'qr_code',
      ];

      // 1. Khởi tạo Camera trước để người dùng thấy video ngay lập tức
      const stream = await requestCameraStream();
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];

      if (track) {
        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities.torch) {
          setHasTorch(true);
        }
        if ((track as any).applyConstraints) {
          try {
            await (track as any).applyConstraints({
              advanced: [{ focusMode: 'continuous' }],
            });
          } catch {
            // Thiết bị không hỗ trợ continuous focus thì bỏ qua
          }
        }
      }

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // Đặt các thuộc tính bắt buộc cho trình duyệt di động (Samsung Internet, Chrome Android, iOS Safari)
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.srcObject = stream;

      // Đợi video sẵn sàng metadata trước khi play()
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) {
          resolve();
        } else {
          const onLoaded = () => {
            video.removeEventListener('loadedmetadata', onLoaded);
            resolve();
          };
          video.addEventListener('loadedmetadata', onLoaded);
          setTimeout(resolve, 800);
        }
      });

      try {
        await video.play();
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Lỗi khi phát video:', err);
        }
      }

      setIsScanning(true);

      // 2. Khởi tạo bộ nhận diện Barcode (Ưu tiên Native BarcodeDetector, fallback sang WebAssembly Ponyfill)
      let detector: any = null;
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          const NativeDetector = (window as any).BarcodeDetector;
          const supported = await NativeDetector.getSupportedFormats();
          const validFormats = targetFormats.filter((f) => supported.includes(f));
          if (validFormats.length > 0) {
            detector = new NativeDetector({ formats: validFormats });
          }
        } catch {
          detector = null;
        }
      }

      if (!detector) {
        const { BarcodeDetector } = await import('barcode-detector/ponyfill');
        detector = new BarcodeDetector({
          formats: targetFormats as any,
        });
      }

      let isDestroyed = false;
      let rafId = 0;
      let inFlight = false;

      // 3. Vòng lặp nhận diện cực nhanh dựa trên requestAnimationFrame (30 - 60 FPS)
      const scanLoop = async () => {
        if (isDestroyed) return;

        const currentVideo = videoRef.current;
        if (
          currentVideo &&
          currentVideo.readyState >= 2 &&
          currentVideo.videoWidth > 0 &&
          !inFlight &&
          detector
        ) {
          try {
            inFlight = true;
            const hits = await detector.detect(currentVideo);
            if (hits && hits.length > 0) {
              const hit = hits[0];
              if (hit.rawValue) {
                const now = Date.now();
                const normalized = normalizeBarcode(hit.rawValue);
                const { code, time } = lastScanRef.current;

                // Debounce 1.5s nếu quét cùng 1 mã
                if (code !== normalized || now - time > 1500) {
                  lastScanRef.current = { code: normalized, time: now };
                  playBeep();
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(80);
                  }
                  onScan(normalized);
                }
              }
            }
          } catch {
            // Bỏ qua lỗi từng frame để quét tiếp liên tục
          } finally {
            inFlight = false;
          }
        }

        if (!isDestroyed) {
          rafId = requestAnimationFrame(scanLoop);
        }
      };

      rafId = requestAnimationFrame(scanLoop);

      cleanupRef.current = () => {
        isDestroyed = true;
        cancelAnimationFrame(rafId);
      };
    } catch (err: any) {
      console.error('Lỗi khởi động camera:', err);
      if (err.name === 'NotAllowedError') {
        setError('Bạn đã từ chối quyền camera. Vui lòng cấp quyền máy ảnh trong cài đặt trình duyệt.');
      } else if (err.name === 'NotFoundError') {
        setError('Không tìm thấy camera trên thiết bị của bạn.');
      } else {
        setError('Không thể mở camera. Vui lòng nhập mã vạch bằng tay.');
      }
      stop();
    }
  }, [onScan, stop]);

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !isTorchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setIsTorchOn(nextState);
    } catch (err) {
      console.warn('Lỗi bật/tắt đèn flash:', err);
    }
  }, [isTorchOn]);

  return {
    videoRef,
    isScanning,
    error,
    hasTorch,
    isTorchOn,
    start,
    stop,
    toggleTorch,
  };
}
