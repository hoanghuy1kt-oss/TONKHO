'use client';

import { useState, useEffect, useRef } from 'react';
import { InventoryEntry, EntryDraft } from '@/types/inventory';
import { uploadPhotoToFirebase } from '@/lib/image-compression';
import { getPhotoUrl } from '@/lib/photo-url';
import {
  UNIT_OPTIONS,
  getAdaptiveConfigForUnit,
  parseWeightOrSpec,
  formatSpecDisplay,
} from '@/lib/spec-utils';

export { UNIT_OPTIONS };

interface EntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  barcode: string;
  productName: string;
  productUnit?: string | null;
  productWeight?: string | null;
  productFlavor?: string | null;
  existingBatch?: InventoryEntry | null;
  staff: { name: string; uid: string };
  onSuccess: () => void;
}

export function EntryModal({
  isOpen,
  onClose,
  barcode,
  productName,
  productUnit,
  productWeight,
  productFlavor,
  existingBatch,
  staff,
  onSuccess,
}: EntryModalProps) {
  const isEditing = Boolean(existingBatch);
  const [currentBarcode, setCurrentBarcode] = useState(barcode);
  const [name, setName] = useState(productName);
  const [unit, setUnit] = useState<string>('Hộp');
  const [customUnit, setCustomUnit] = useState<string>('');
  const [weightValue, setWeightValue] = useState<string>('');
  const [weightUnit, setWeightUnit] = useState<string>('cái');
  const [customWeightUnit, setCustomWeightUnit] = useState<string>('');
  const [flavor, setFlavor] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(existingBatch?.quantity || 1);
  const [expiryDate, setExpiryDate] = useState<string>(
    existingBatch?.expiry_date || new Date().toISOString().split('T')[0]
  );
  const [note, setNote] = useState<string>(existingBatch?.note || '');
  const [photoKey, setPhotoKey] = useState<string>(existingBatch?.photo_key || '');
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveUnit = (unit === 'Khác' ? customUnit : unit).trim();
  const adaptiveConfig = getAdaptiveConfigForUnit(effectiveUnit || unit);

  const handleUnitChange = (newUnit: string) => {
    setUnit(newUnit);
    const cfg = getAdaptiveConfigForUnit(newUnit === 'Khác' ? customUnit : newUnit);
    if (!weightValue || !cfg.subUnits.includes(weightUnit)) {
      setWeightUnit(cfg.defaultSubUnit);
      setCustomWeightUnit('');
    }
  };

  useEffect(() => {
    setCurrentBarcode(barcode);
    setName(productName);
    setSelectedFile(null);
    if (existingBatch) {
      setQuantity(existingBatch.quantity);
      setExpiryDate(existingBatch.expiry_date);
      setNote(existingBatch.note || '');
      setPhotoKey(existingBatch.photo_key);
      setPhotoPreview(getPhotoUrl(existingBatch.photo_key));

      const existingUnit = existingBatch.unit || 'Hộp';
      if (UNIT_OPTIONS.includes(existingUnit)) {
        setUnit(existingUnit);
        setCustomUnit('');
      } else {
        setUnit('Khác');
        setCustomUnit(existingUnit);
      }

      const cfg = getAdaptiveConfigForUnit(existingUnit);
      const pw = parseWeightOrSpec(existingBatch.weight, cfg.defaultSubUnit);
      setWeightValue(pw.value);
      setWeightUnit(pw.unit);
      setCustomWeightUnit(pw.customUnit || '');
      setFlavor(existingBatch.flavor || '');
    } else {
      setQuantity(1);
      setExpiryDate(new Date().toISOString().split('T')[0]);
      setNote('');
      setPhotoKey('');
      setPhotoPreview('');
      setSelectedFile(null);

      const defaultUnit = productUnit || 'Hộp';
      if (UNIT_OPTIONS.includes(defaultUnit)) {
        setUnit(defaultUnit);
        setCustomUnit('');
      } else if (defaultUnit) {
        setUnit('Khác');
        setCustomUnit(defaultUnit);
      } else {
        setUnit('Hộp');
        setCustomUnit('');
      }

      const cfg = getAdaptiveConfigForUnit(defaultUnit);
      if (productWeight) {
        const pw = parseWeightOrSpec(productWeight, cfg.defaultSubUnit);
        setWeightValue(pw.value);
        setWeightUnit(pw.unit);
        setCustomWeightUnit(pw.customUnit || '');
      } else {
        setWeightValue('');
        setWeightUnit(cfg.defaultSubUnit);
        setCustomWeightUnit('');
      }
      setFlavor(productFlavor || '');
    }
    setError('');
  }, [existingBatch, productName, productUnit, productWeight, productFlavor, barcode, isOpen]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPhotoPreview(URL.createObjectURL(file));
      setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const effectiveBarcode = (isEditing ? barcode : currentBarcode).trim();
    if (!effectiveBarcode) {
      setError('Mã vạch không được để trống');
      return;
    }

    if (!name.trim()) {
      setError('Vui lòng nhập tên sản phẩm');
      return;
    }

    const effectiveUnit = (unit === 'Khác' ? customUnit : unit).trim();
    if (!effectiveUnit) {
      setError('Đơn vị tính là bắt buộc (vui lòng chọn hoặc nhập)');
      return;
    }

    const parsedWeightNum = parseFloat(weightValue);
    if (!weightValue.trim() || isNaN(parsedWeightNum) || parsedWeightNum <= 0) {
      setError(`${adaptiveConfig.label.replace(' *', '')} là bắt buộc (phải lớn hơn 0)`);
      return;
    }
    if (weightUnit === 'Khác' && !customWeightUnit.trim()) {
      setError('Vui lòng nhập đơn vị quy cách con');
      return;
    }
    const effectiveWeight = formatSpecDisplay(weightValue, weightUnit, customWeightUnit);
    const effectiveFlavor = flavor.trim() || null;

    if (!quantity || quantity <= 0) {
      setError('Số lượng phải lớn hơn 0');
      return;
    }

    if (!expiryDate) {
      setError('Vui lòng chọn hạn sử dụng');
      return;
    }

    if (!photoKey && !selectedFile) {
      setError('Ảnh chụp sản phẩm / lô hàng là bắt buộc');
      return;
    }

    try {
      setSubmitting(true);
      let currentPhotoKey = photoKey;

      // Nếu có file ảnh mới được chụp/chọn -> tải lên Firebase
      if (selectedFile) {
        setUploading(true);
        currentPhotoKey = await uploadPhotoToFirebase(selectedFile, effectiveBarcode, (percent) => {
          setUploadProgress(percent);
        });
        setUploading(false);
      }

      if (isEditing && existingBatch) {
        // Cập nhật lô hiện tại (PATCH)
        const res = await fetch(`/api/entries/${existingBatch.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rev: existingBatch.rev,
            updates: {
              quantity,
              expiry_date: expiryDate,
              photo_key: currentPhotoKey,
              note: note.trim() || null,
              unit: effectiveUnit,
              weight: effectiveWeight,
              flavor: effectiveFlavor,
            },
            staff,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Cập nhật thất bại');
        }
      } else {
        // Thêm lô mới (POST)
        const draft: EntryDraft = {
          barcode: effectiveBarcode,
          product_name: name.trim(),
          unit: effectiveUnit,
          weight: effectiveWeight,
          flavor: effectiveFlavor || undefined,
          expiry_date: expiryDate,
          quantity,
          note: note.trim() || undefined,
          photo_key: currentPhotoKey,
        };

        const res = await fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft, staff }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Tạo lô kiểm kê thất bại');
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Submit entry error:', err);
      setError(err.message || 'Lỗi lưu thông tin');
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-t-[28px] sm:rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-200">
        <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="shrink-0 px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {isEditing ? 'Chỉnh sửa lô hàng' : 'Thêm lô mới'}
              </span>
              {isEditing ? (
                <h2 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-100 font-mono">
                  Mã: {barcode}
                </h2>
              ) : (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs font-bold text-zinc-400">Mã:</span>
                  <input
                    type="text"
                    value={currentBarcode}
                    onChange={(e) => setCurrentBarcode(e.target.value)}
                    placeholder="Mã vạch..."
                    required
                    className="px-2 py-0.5 text-sm font-mono font-bold rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
              title="Đóng"
            >
              ✕
            </button>
          </div>

          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-3.5 space-y-3">
            {/* Tên sản phẩm */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Tên sản phẩm *
              </label>
              <input
                type="text"
                required
                readOnly={isEditing}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Sữa tắm Lifebuoy"
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Đơn vị tính & Trọng lượng (2 cột trên cả mobile) */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Đơn vị tính */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Đơn vị tính *
                </label>
                <div className="space-y-1">
                  <select
                    required
                    value={unit}
                    onChange={(e) => handleUnitChange(e.target.value)}
                    className="w-full h-11 px-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base sm:text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  {unit === 'Khác' && (
                    <input
                      type="text"
                      required
                      value={customUnit}
                      onChange={(e) => setCustomUnit(e.target.value)}
                      placeholder="Gõ ĐVT..."
                      className="w-full px-2.5 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 text-base sm:text-xs focus:ring-2 focus:ring-emerald-500"
                    />
                  )}
                </div>
              </div>

              {/* Quy cách / Trọng lượng */}
              <div>
                <label
                  className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1 truncate"
                  title={adaptiveConfig.label}
                >
                  {adaptiveConfig.label}
                </label>
                <div className="space-y-1">
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      required
                      value={weightValue}
                      onChange={(e) => setWeightValue(e.target.value)}
                      placeholder={adaptiveConfig.placeholder}
                      className="flex-1 min-w-0 h-11 px-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                    <select
                      value={weightUnit}
                      onChange={(e) => setWeightUnit(e.target.value)}
                      className="w-20 h-11 px-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base sm:text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-center"
                    >
                      {adaptiveConfig.subUnits.map((su) => (
                        <option key={su} value={su}>
                          {su}
                        </option>
                      ))}
                    </select>
                  </div>
                  {weightUnit === 'Khác' && (
                    <input
                      type="text"
                      required
                      value={customWeightUnit}
                      onChange={(e) => setCustomWeightUnit(e.target.value)}
                      placeholder="Gõ đơn vị..."
                      className="w-full px-2.5 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 text-base sm:text-xs focus:ring-2 focus:ring-emerald-500"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Hương vị / mùi (tùy chọn) */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Hương vị / mùi (tùy chọn)
              </label>
              <input
                type="text"
                value={flavor}
                onChange={(e) => setFlavor(e.target.value)}
                placeholder="VD: Dâu, Vani, Tôm chua cay..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Hạn sử dụng & Số lượng (2 cột trên cả mobile) */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Hạn sử dụng */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Hạn sử dụng (EXP) *
                </label>
                <input
                  type="date"
                  required
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full h-11 px-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Số lượng */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Số lượng *
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-lg font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 flex items-center justify-center transition shrink-0"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 min-w-0 text-center font-bold text-base h-11 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-lg font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 flex items-center justify-center transition shrink-0"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Hình ảnh chụp thực tế */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Ảnh chụp thực tế (bắt buộc) *
              </label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />

              {photoPreview ? (
                <div className="flex items-center gap-3 p-2.5 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700">
                  <div className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold block">
                      ✓ Đã có ảnh lô hàng
                    </span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 underline font-medium"
                    >
                      Chụp lại / Đổi ảnh khác
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3.5 px-4 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-emerald-500 active:scale-[0.99] bg-zinc-50 dark:bg-zinc-800/40 hover:bg-emerald-50/20 text-zinc-700 dark:text-zinc-300 flex items-center justify-center gap-2.5 transition"
                >
                  <span className="text-xl">📷</span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    Bấm chụp ảnh hoặc chọn từ máy
                  </span>
                </button>
              )}

              {uploading && (
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>Đang tải ảnh lên Firebase...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Ghi chú */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Ghi chú thêm (tùy chọn)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Bao bì hơi trầy xước..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {error && (
              <p role="alert" className="text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/50 p-2.5 rounded-xl border border-rose-200 dark:border-rose-900 font-medium">
                {error}
              </p>
            )}
          </div>

          {/* Sticky Action Footer */}
          <div className="shrink-0 px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/90 backdrop-blur-xs flex gap-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-bold text-xs text-zinc-700 dark:text-zinc-300 transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting || uploading}
              className="flex-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] font-bold text-xs text-white shadow-sm disabled:opacity-50 transition"
            >
              {submitting ? 'Đang lưu...' : isEditing ? 'Lưu thay đổi' : 'Tạo lô kiểm kê'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
