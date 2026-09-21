export class ValidationError extends Error {}

export function validateEntryValues(quantity: unknown, expiryDate: unknown) {
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new ValidationError('Số lượng phải là số nguyên dương hợp lệ.');
  }
  if (typeof expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    throw new ValidationError('Hạn sử dụng phải có định dạng YYYY-MM-DD.');
  }
  const date = new Date(`${expiryDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expiryDate) {
    throw new ValidationError('Hạn sử dụng không hợp lệ.');
  }
}

export function validateStaff(staff: { name: string; uid: string }) {
  if (!staff || typeof staff.name !== 'string' || !staff.name.trim() ||
      typeof staff.uid !== 'string' || !staff.uid.trim()) {
    throw new ValidationError('Thiếu thông tin người thực hiện.');
  }
}

export function validateRevision(rev: unknown) {
  if (typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 1) {
    throw new ValidationError('Phiên bản lô kiểm kê không hợp lệ.');
  }
}
