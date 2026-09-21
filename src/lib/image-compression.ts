import imageCompression from 'browser-image-compression';

export interface CompressOptions {
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  useWebWorker?: boolean;
}

/**
 * Nén ảnh chụp từ điện thoại (từ 5-15MB) xuống < 1.5MB và max 2048px
 */
export async function compressImage(file: File, options?: CompressOptions): Promise<File> {
  const defaultOptions = {
    maxSizeMB: 1.5,
    maxWidthOrHeight: 2048,
    useWebWorker: true,
    fileType: 'image/jpeg',
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
 * Lấy presigned URL từ server và tải trực tiếp file ảnh lên Cloudflare R2
 */
export async function uploadPhotoToR2(
  file: File,
  barcode: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  // 1. Nén ảnh
  const compressedFile = await compressImage(file);

  // 2. Xin presigned PUT URL từ API route
  const presignRes = await fetch('/api/photos/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentType: 'image/jpeg',
      barcode,
    }),
  });

  if (!presignRes.ok) {
    const err = await presignRes.json();
    throw new Error(err.error || 'Không thể tạo URL tải ảnh lên Cloudflare R2');
  }

  const { uploadUrl, photoKey } = await presignRes.json();

  // 3. PUT trực tiếp lên Cloudflare R2 (dùng XMLHttpRequest để bắt progress)
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', 'image/jpeg');

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Tải ảnh lên R2 thất bại với mã lỗi HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Lỗi mạng khi tải ảnh lên Cloudflare R2'));
    xhr.send(compressedFile);
  });

  return photoKey;
}
