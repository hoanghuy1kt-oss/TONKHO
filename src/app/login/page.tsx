'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Mật khẩu không đúng');
      }

      router.push('/admin');
    } catch (err: any) {
      setError(err.message || 'Lỗi đăng nhập');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-50 dark:bg-black">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
        <div className="text-center mb-6">
          <Link href="/" className="inline-block text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
            ← Quay lại trang kiểm kho
          </Link>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            Quản trị viên (Admin)
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Nhập mật khẩu quản trị để xem tổng hợp và xuất Excel
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Mật khẩu Admin
            </label>
            <input
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-base focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
            {error && <p className="text-xs text-rose-500 mt-1.5">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition shadow-xs disabled:opacity-50"
          >
            {loading ? 'Đang xác thực...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}
