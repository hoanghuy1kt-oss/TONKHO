'use client';

import { InventoryEntry } from '@/types/inventory';
import { getPhotoUrl } from '@/lib/r2-client';

interface BatchCardProps {
  batch: InventoryEntry;
  onEdit: (batch: InventoryEntry) => void;
  onDelete: (batch: InventoryEntry) => void;
}

export function BatchCard({ batch, onEdit, onDelete }: BatchCardProps) {
  const photoUrl = getPhotoUrl(batch.photo_key);

  // Tính số ngày còn lại đến hạn sử dụng
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(batch.expiry_date);
  const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const isExpired = diffDays < 0;
  const isExpiringSoon = diffDays >= 0 && diffDays <= 60;

  return (
    <div className="flex items-center gap-3 p-3.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition">
      {/* Thumbnail ảnh */}
      <a
        href={photoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={batch.product_name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src =
              'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23f4f4f5"/><text x="50" y="55" font-size="32" text-anchor="middle" dominant-baseline="middle">📦</text></svg>';
          }}
        />
      </a>

      {/* Thông tin lô */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            SL: {batch.quantity}
          </span>
          <span
            className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${
              isExpired
                ? 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400'
                : isExpiringSoon
                ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
            }`}
          >
            HSD: {batch.expiry_date}
          </span>
        </div>

        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate">
          Người nhập: <span className="font-medium text-zinc-700 dark:text-zinc-300">{batch.created_by_name}</span>
          {batch.last_edited_by_name !== batch.created_by_name && (
            <span> (Sửa bởi: {batch.last_edited_by_name})</span>
          )}
        </div>

        {batch.note && (
          <p className="text-[11px] text-zinc-400 italic truncate mt-0.5">{batch.note}</p>
        )}
      </div>

      {/* Nút thao tác */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => onEdit(batch)}
          className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:text-emerald-600 dark:hover:text-emerald-400 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition"
        >
          Sửa
        </button>
        <button
          type="button"
          onClick={() => onDelete(batch)}
          className="px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 hover:bg-rose-50 dark:hover:bg-rose-950 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-semibold text-zinc-500 dark:text-zinc-400 transition"
        >
          Xóa
        </button>
      </div>
    </div>
  );
}
