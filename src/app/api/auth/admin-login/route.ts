import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword, signAdminToken, ADMIN_COOKIE_NAME } from '@/lib/auth-admin';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    if (!password || !verifyAdminPassword(password)) {
      return NextResponse.json({ error: 'Mật khẩu quản trị không chính xác' }, { status: 401 });
    }

    const token = await signAdminToken();
    const response = NextResponse.json({ success: true });

    response.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 ngày
    });

    return response;
  } catch (error: any) {
    console.error('Error during admin login:', error);
    return NextResponse.json({ error: 'Lỗi đăng nhập' }, { status: 500 });
  }
}
