'use client';

import { useState, useEffect } from 'react';

interface StaffModalProps {
  isOpen: boolean;
  currentName: string;
  onSave: (name: string) => void;
  onClose?: () => void;
  isDismissable?: boolean;
}

export function StaffModal({
  isOpen,
  currentName,
  onSave,
  onClose,
  isDismissable = false,
}: StaffModalProps) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Vui lòng nhập tên của bạn');
      return;
    }
    if (trimmed.length < 2) {
      setError('Tên tối thiểu 2 ký tự');
      return;
    }
    onSave(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-xl border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1">
          {currentName ? 'Đổi tên nhân viên' : 'Chào bạn! Tên bạn là gì?'}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          Tên này sẽ được gắn vào lịch sử kiểm kê để theo dõi ai đã quét hoặc sửa lô hàng.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              autoFocus
              placeholder="VD: Huy Hoàng, Lan Anh..."
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              className="w-full px-4 py-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
            {error && <p className="text-xs text-rose-500 mt-1.5">{error}</p>}
          </div>

          <div className="flex gap-2">
            {isDismissable && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
              >
                Hủy
              </button>
            )}
            <button
              type="submit"
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition shadow-xs"
            >
              Lưu tên
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
