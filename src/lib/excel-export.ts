import writeXlsxFile from 'write-excel-file/browser';
import { InventoryEntry } from '@/types/inventory';
import { getPhotoUrl } from './photo-url';

/**
 * Xuất danh sách kiểm kê ra file Excel (.xlsx) chuẩn tiếng Việt
 */
export async function exportInventoryToExcel(entries: InventoryEntry[], filename = 'kiem-kho-tonkho.xlsx') {
  const HEADER_ROW = [
    { value: 'Mã vạch (Barcode)', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff', align: 'center' as const },
    { value: 'Tên sản phẩm', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff' },
    { value: 'Đơn vị tính', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff', align: 'center' as const },
    { value: 'Quy cách / Trọng lượng', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff', align: 'center' as const },
    { value: 'Hương vị / Mùi', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff' },
    { value: 'Hạn sử dụng (EXP)', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff', align: 'center' as const },
    { value: 'Số lượng', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff', align: 'right' as const },
    { value: 'Người tạo', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff' },
    { value: 'Người sửa cuối', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff' },
    { value: 'Ngày cập nhật', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff', align: 'center' as const },
    { value: 'Ghi chú', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff' },
    { value: 'Link ảnh kiểm kê', fontWeight: 'bold' as const, backgroundColor: '#10b981', color: '#ffffff' },
  ];

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const dataRows = entries.map((row) => {
    const rawUrl = getPhotoUrl(row.photo_key);
    const fullUrl = rawUrl
      ? rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
        ? rawUrl
        : `${origin}${rawUrl}`
      : '';

    const photoCell = fullUrl
      ? {
          type: 'Formula' as const,
          value: `HYPERLINK("${fullUrl}", "${fullUrl}")`,
          color: '#0284c7',
          underline: true,
        }
      : {
          type: String,
          value: 'Không có ảnh',
          color: '#9ca3af',
        };

    return [
      { type: String, value: row.barcode },
      { type: String, value: row.product_name },
      { type: String, value: row.unit || '', align: 'center' as const },
      { type: String, value: row.weight || '', align: 'center' as const },
      { type: String, value: row.flavor || '' },
      { type: String, value: row.expiry_date, align: 'center' as const },
      { type: Number, value: row.quantity, align: 'right' as const },
      { type: String, value: row.created_by_name },
      { type: String, value: row.last_edited_by_name },
      { type: Date, value: new Date(row.updated_at), format: 'yyyy-mm-dd hh:mm', align: 'center' as const },
      { type: String, value: row.note || '' },
      photoCell,
    ];
  });

  const xlsx = writeXlsxFile([HEADER_ROW, ...dataRows], {
    columns: [
      { width: 18 },
      { width: 32 },
      { width: 14 },
      { width: 22 },
      { width: 18 },
      { width: 16 },
      { width: 12 },
      { width: 18 },
      { width: 18 },
      { width: 20 },
      { width: 25 },
      { width: 50 },
    ],
  });

  await xlsx.toFile(filename);
}
