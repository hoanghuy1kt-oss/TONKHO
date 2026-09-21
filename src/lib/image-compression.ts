import imageCompression from 'browser-image-compression';

export interface CompressOptions {
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  useWebWorker?: boolean;
}

/**
 * Nén ảnh chụp từ điện thoại (từ 5-15MB) xuống ~100-200KB và max 1280px
 */
export async function compressImage(file: File, options?: CompressOptions): Promise<File> {
  const defaultOptions = {
    maxSizeMB: 0.2,
    maxWidthOrHeight: 1280,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.75,
    ...options,
  };

  try {
    const compressed = await imageCompression(file, defaultOptions);
    return compressed;
  } catch (error) {
    console.warn('Lỗi nén ảnh, sử dụng ảnh gốc:', error);
    return file;
  }
}

/**
 * Chuyển đổi File sang chuỗi Base64
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      resolve(commaIdx !== -1 ? result.substring(commaIdx + 1) : result);
    };
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Nén ảnh và tải lên lưu trữ trực tiếp vào Firebase (collection: inventoryPhotos)
 */
export async function uploadPhotoToFirebase(
  file: File,
  barcode: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  onProgress?.(15);

  // 1. Nén ảnh với kích thước tối ưu
  const compressedFile = await compressImage(file, {
    maxSizeMB: 0.18,
    maxWidthOrHeight: 1280,
  });

  onProgress?.(45);

  // 2. Chuyển thành chuỗi Base64
  const base64Data = await fileToBase64(compressedFile);

  onProgress?.(70);

  const photoKey = `photo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // 3. Gửi lên API lưu trữ Firebase
  const res = await fetch('/api/photos/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photoKey,
      barcode: barcode || 'misc',
      base64: base64Data,
      contentType: compressedFile.type || 'image/jpeg',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Lỗi lưu trữ ảnh vào Firebase');
  }

  onProgress?.(100);
  return photoKey;
}

// Giữ lại alias để tương thích ngược
export const uploadPhotoToR2 = uploadPhotoToFirebase;
