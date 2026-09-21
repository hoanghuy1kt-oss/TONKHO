'use client';

import { useState, useEffect, useRef } from 'react';
import { InventoryEntry, EntryDraft } from '@/types/inventory';
import { uploadPhotoToFirebase } from '@/lib/image-compression';
import { getPhotoUrl } from '@/lib/photo-url';

interface EntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  barcode: string;
  productName: string;
  existingBatch?: InventoryEntry | null;
  staff: { name: string; uid: string };
  onSuccess: () => void;
}

export function EntryModal({
  isOpen,
  onClose,
  barcode,
  productName,
  existingBatch,
  staff,
  onSuccess,
}: EntryModalProps) {
  const isEditing = Boolean(existingBatch);
  const [name, setName] = useState(productName);
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

  useEffect(() => {
    setName(productName);
    setSelectedFile(null);
    if (existingBatch) {
      setQuantity(existingBatch.quantity);
      setExpiryDate(existingBatch.expiry_date);
      setNote(existingBatch.note || '');
      setPhotoKey(existingBatch.photo_key);
      setPhotoPreview(getPhotoUrl(existingBatch.photo_key));
    } else {
      setQuantity(1);
      setExpiryDate(new Date().toISOString().split('T')[0]);
      setNote('');
      setPhotoKey('');
      setPhotoPreview('');
      setSelectedFile(null);
    }
    setError('');
  }, [existingBatch, productName, isOpen]);

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

    if (!name.trim()) {
      setError('Vui lòng nhập tên sản phẩm');
      return;
    }

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

      // Nếu có file ảnh mới được chụp/chọn -> tải lên R2
      if (selectedFile) {
        setUploading(true);
        currentPhotoKey = await uploadPhotoToFirebase(selectedFile, barcode, (percent) => {
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
          barcode,
          product_name: name.trim(),
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
      console.error('Submit error:', err);
      setError(err.message || 'Đã xảy ra lỗi khi lưu');
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl p-5 sm:p-6 shadow-2xl border border-zinc-200 dark:border-zinc-800 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              {isEditing ? 'Chỉnh sửa lô hàng' : 'Thêm lô mới'}
            </span>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              Mã: {barcode}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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
              placeholder="VD: Sữa tắm Lifebuoy 850g"
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>

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
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Số lượng */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Số lượng kiểm đếm *
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-12 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-lg font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center transition"
              >
                -
              </button>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="flex-1 text-center font-bold text-lg h-11 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={() => setQuantity(quantity + 1)}
                className="w-12 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-lg font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center transition"
              >
                +
              </button>
            </div>
          </div>

          {/* Hình ảnh chụp thực tế */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Ảnh chụp lô hàng (bắt buộc) *
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
              <div className="relative rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 aspect-video flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Ảnh kiểm kê"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-black/70 hover:bg-black text-white text-xs font-medium backdrop-blur-xs flex items-center gap-1.5 transition"
                >
                  📷 Chụp lại
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-6 px-4 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-emerald-500 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-emerald-50/20 text-zinc-600 dark:text-zinc-400 flex flex-col items-center justify-center gap-2 transition"
              >
                <span className="text-2xl">📸</span>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Bấm để chụp ảnh hoặc chọn từ máy
                </span>
                <span className="text-[11px] text-zinc-400">
                  Ảnh sẽ được tự động nén tối ưu trước khi lưu
                </span>
              </button>
            )}

            {uploading && (
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Đang tải ảnh lên Cloudflare R2...</span>
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
              className="w-full px-3.5 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-600 dark:text-rose-400 text-xs font-medium">
              {error}
            </div>
          )}

          {/* Nút hành động */}
          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting || uploading}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold shadow-xs flex items-center justify-center gap-2 transition"
            >
              {submitting ? 'Đang lưu...' : isEditing ? 'Lưu thay đổi' : 'Tạo lô kiểm kê'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
