import { checkIsAdmin } from '@/lib/auth-admin';
import { NextResponse } from 'next/server';
import { firebaseRepo } from '@/lib/firebase-repository';

export async function POST() {
  if (!(await checkIsAdmin())) {
    return NextResponse.json({ error: 'Cần đăng nhập quản trị viên' }, { status: 401 });
  }
  try {
    const result = await firebaseRepo.clearAllData();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Error clearing all data:', error);
    return NextResponse.json({ error: error.message || 'Lỗi khi xóa toàn bộ dữ liệu' }, { status: 500 });
  }
}
