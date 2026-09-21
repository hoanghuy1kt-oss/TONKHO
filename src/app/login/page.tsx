'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    // Mật khẩu đã được gỡ bỏ -> chuyển thẳng vào trang Admin
    router.replace('/admin');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-50 dark:bg-black">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-zinc-500">Đang chuyển tới trang Quản trị (Admin)...</p>
      </div>
    </div>
  );
}
