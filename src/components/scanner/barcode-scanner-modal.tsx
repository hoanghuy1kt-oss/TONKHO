'use client';

import { useEffect } from 'react';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (barcode: string) => void;
}

export function BarcodeScannerModal({ isOpen, onClose, onScanSuccess }: BarcodeScannerModalProps) {
  const { videoRef, isScanning, error, hasTorch, isTorchOn, start, stop, toggleTorch } =
    useBarcodeScanner({
      onScan: (barcode) => {
        stop();
        onScanSuccess(barcode);
      },
    });

  useEffect(() => {
    if (isOpen) {
      start();
    } else {
      stop();
    }
    return () => stop();
  }, [isOpen, start, stop]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-zinc-800">
        <h2 className="text-base font-semibold">Quét mã vạch</h2>
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              onClick={toggleTorch}
              type="button"
              className={`p-2 rounded-full border transition-colors ${
                isTorchOn ? 'bg-amber-400 border-amber-400 text-black' : 'border-zinc-700 bg-zinc-800 text-white'
              }`}
              title="Đèn flash"
            >
              ⚡
            </button>
          )}
          <button
            onClick={onClose}
            type="button"
            className="p-2 rounded-full border border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
            title="Đóng"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Video Viewport & Scanning Aim Frame */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Khung ngắm quét */}
        <div className="relative z-10 w-72 h-44 sm:w-80 sm:h-48 border-2 border-emerald-400/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] flex flex-col items-center justify-between p-2">
          {/* 4 góc viền highlight */}
          <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
          <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
          <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />

          {/* Tia laser quét chuyển động */}
          <div className="w-full h-0.5 bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
          <p className="text-xs text-emerald-200/90 font-medium bg-black/60 px-3 py-1 rounded-full">
            Đặt mã vạch vào khung này
          </p>
        </div>

        {/* Thông báo lỗi nếu có */}
        {error && (
          <div className="absolute bottom-6 inset-x-4 z-20 p-4 bg-rose-950/90 border border-rose-600 rounded-xl text-center text-sm text-rose-200">
            {error}
          </div>
        )}
      </div>

      {/* Footer 안내 */}
      <div className="p-4 text-center text-xs text-zinc-400 bg-black/60">
        Hỗ trợ EAN-13, EAN-8, UPC-A, UPC-E, Code-128
      </div>
    </div>
  );
}
