/**
 * Lấy URL công khai để xem ảnh từ photoKey.
 */
export function getPhotoUrl(photoKey: string): string {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE || '';
  if (!photoKey) return '';
  if (photoKey.startsWith('http://') || photoKey.startsWith('https://')) {
    return photoKey;
  }
  if (!base) {
    // Fallback nếu chưa cấu hình public domain R2
    return `/api/photos/view?key=${encodeURIComponent(photoKey)}`;
  }
  return `${base.replace(/\/$/, '')}/${photoKey}`;
}
