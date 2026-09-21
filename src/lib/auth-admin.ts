import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const ADMIN_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET || 'tonkho_admin_secret_key_default_32_characters_minimum'
);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tonkho123';
export const ADMIN_COOKIE_NAME = 'tonkho_admin_token';

/**
 * Xác thực mật khẩu quản trị viên
 */
export function verifyAdminPassword(input: string): boolean {
  return input === ADMIN_PASSWORD;
}

/**
 * Ký JWT token cho session Admin
 */
export async function signAdminToken(): Promise<string> {
  return await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(ADMIN_SECRET);
}

/**
 * Kiểm tra tính hợp lệ của token Admin
 */
export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, ADMIN_SECRET);
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
