import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

function getAdminSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_JWT_SECRET phải được cấu hình với ít nhất 32 ký tự.');
  }
  return new TextEncoder().encode(secret);
}
export const ADMIN_COOKIE_NAME = 'tonkho_admin_token';

/**
 * Xác thực mật khẩu quản trị viên
 */
export function verifyAdminPassword(input: string): boolean {
  const password = process.env.ADMIN_PASSWORD;
  return Boolean(password) && typeof input === 'string' && input === password;
}

/**
 * Ký JWT token cho session Admin
 */
export async function signAdminToken(): Promise<string> {
  return await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getAdminSecret());
}

/**
 * Kiểm tra tính hợp lệ của token Admin
 */
export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getAdminSecret(), { algorithms: ['HS256'] });
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Kiểm tra quyền Admin từ cookie trong request (cho Server Components & API routes)
 */
export async function checkIsAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return false;
  return await verifyAdminToken(token);
}
