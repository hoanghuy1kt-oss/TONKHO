'use client';

import { InventoryEntry } from '@/types/inventory';
import { getPhotoUrl } from '@/lib/photo-url';

interface RecentFeedProps {
  entries: InventoryEntry[];
  loading: boolean;
  onSelectEntry?: (entry: InventoryEntry) => void;
}

export function RecentFeed({ entries, loading, onSelectEntry }: RecentFeedProps) {
  if (loading && entries.length === 0) {
    return (
      <div className="py-12 text-center text-zinc-400 text-sm">
        Đang tải dữ liệu kiểm kho gần đây...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-12 text-center text-zinc-400 text-sm">
        Chưa có lượt kiểm kê nào. Hãy quét hoặc nhập mã vạch để bắt đầu!
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {entries.map((entry) => {
        const photoUrl = getPhotoUrl(entry.photo_key);
        const timeStr = new Date(entry.updated_at).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div
            key={entry.id}
            onClick={() => onSelectEntry?.(entry)}
            className="flex items-center gap-3 p-3 bg-white dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl hover:border-emerald-500/50 transition cursor-pointer group"
          >
            {/* Ảnh thumbnail */}
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0 border border-zinc-100 dark:border-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt={entry.product_name}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src =
                    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23f4f4f5"/><text x="50" y="55" font-size="28" text-anchor="middle" dominant-baseline="middle">📦</text></svg>';
                }}
              />
            </div>

            {/* Chi tiết */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-emerald-600 transition">
                  {entry.product_name}
                </h4>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                  SL: {entry.quantity}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                <span className="truncate">
                  Mã: {entry.barcode} • HSD: {entry.expiry_date}
                </span>
                <span className="text-[11px] text-zinc-400 shrink-0 ml-2">
                  {entry.last_edited_by_name} • {timeStr}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
