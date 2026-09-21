/**
 * Lấy URL công khai để xem ảnh từ photoKey.
 */
export function getPhotoUrl(photoKey: string): string {
  if (!photoKey) return '';
  if (
    photoKey.startsWith('http://') ||
    photoKey.startsWith('https://') ||
    photoKey.startsWith('data:image/')
  ) {
    return photoKey;
  }
  return `/api/photos/view?key=${encodeURIComponent(photoKey)}`;
}
