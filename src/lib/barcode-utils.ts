export const SUPPORTED_BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
] as const;

/**
 * Chuẩn hóa mã vạch: loại bỏ khoảng trắng, ký tự đặc biệt,
 * chuẩn hóa UPC-A 12 số thành EAN-13 (thêm số 0 ở đầu).
 */
export function normalizeBarcode(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, '');
  // Nếu là UPC-A 12 chữ số, chuẩn hóa thành EAN-13 có số 0 dẫn đầu
  if (/^\d{12}$/.test(cleaned)) {
    return '0' + cleaned;
  }
  return cleaned;
}

/**
 * Kiểm tra tính hợp lệ của mã vạch EAN/UPC qua thuật toán Modulo 10 Checksum.
 */
export function isValidEanChecksum(barcode: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(barcode)) {
    // Nếu là mã Code-128 hoặc định dạng khác, không bắt buộc kiểm tra EAN checksum
    return barcode.length >= 3;
  }

  const digits = barcode.split('').map(Number);
  const checkDigit = digits.pop()!;
  
  let sum = 0;
  // Trọng số xen kẽ từ phải qua trái (ngược lại): 3, 1, 3, 1...
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return checkDigit === calculatedCheck;
}
