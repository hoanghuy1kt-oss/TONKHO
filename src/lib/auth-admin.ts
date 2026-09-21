export const ADMIN_COOKIE_NAME = 'tonkho_admin_token';

/**
 * Mật khẩu quản trị viên đã được gỡ bỏ hoàn toàn theo yêu cầu
 */
export function verifyAdminPassword(_input?: string): boolean {
  return true;
}

/**
 * Ký token giả lập để giữ tương thích
 */
export async function signAdminToken(): Promise<string> {
  return 'unlocked_admin';
}

/**
 * Kiểm tra tính hợp lệ của token
 */
export async function verifyAdminToken(_token?: string): Promise<boolean> {
  return true;
}

/**
 * Kiểm tra quyền Admin: luôn cho phép truy cập mà không cần mật khẩu
 */
export async function checkIsAdmin(): Promise<boolean> {
  return true;
}
