import { NextResponse } from 'next/server';
import { firebaseRepo } from '@/lib/firebase-repository';

export async function POST() {
  try {
    const sampleProducts = [
      {
        barcode: '8934673123456',
        name: 'Sữa tươi tiệt trùng Vinamilk 100% 180ml',
        unit: 'Hộp',
        batches: [
          {
            expiry_date: '2026-10-05',
            quantity: 48,
            note: 'Kệ mặt tiền - Date gần',
            photo_key: 'sample/vinamilk_batch1.jpg',
            staff: { name: 'Nguyễn Văn An', uid: 'nv-an-01' },
          },
          {
            expiry_date: '2026-11-20',
            quantity: 120,
            note: 'Kệ A1 - Thùng nguyên',
            photo_key: 'sample/vinamilk_batch2.jpg',
            staff: { name: 'Nguyễn Văn An', uid: 'nv-an-01' },
          },
          {
            expiry_date: '2027-01-15',
            quantity: 240,
            note: 'Kho lạnh - Lô mới nhập',
            photo_key: 'sample/vinamilk_batch3.jpg',
            staff: { name: 'Trần Thị Bình', uid: 'nv-binh-02' },
          },
        ],
      },
      {
        barcode: '8934561245789',
        name: 'Mì Hảo Hảo Tôm Chua Cay 75g',
        unit: 'Gói',
        batches: [
          {
            expiry_date: '2026-12-10',
            quantity: 300,
            note: 'Kho chính - 10 thùng',
            photo_key: 'sample/haohao_batch1.jpg',
            staff: { name: 'Lê Hoàng Huy', uid: 'nv-huy-03' },
          },
          {
            expiry_date: '2027-03-25',
            quantity: 150,
            note: 'Kệ đồ khô B2',
            photo_key: 'sample/haohao_batch2.jpg',
            staff: { name: 'Trần Thị Bình', uid: 'nv-binh-02' },
          },
        ],
      },
      {
        barcode: '8935049500543',
        name: 'Nước ngọt Coca-Cola Sleek lon 320ml',
        unit: 'Lon',
        batches: [
          {
            expiry_date: '2026-11-30',
            quantity: 72,
            note: 'Tủ mát quầy thu ngân',
            photo_key: 'sample/coca_batch1.jpg',
            staff: { name: 'Lê Hoàng Huy', uid: 'nv-huy-03' },
          },
          {
            expiry_date: '2027-06-18',
            quantity: 180,
            note: 'Khu vực nước giải khát',
            photo_key: 'sample/coca_batch2.jpg',
            staff: { name: 'Nguyễn Văn An', uid: 'nv-an-01' },
          },
        ],
      },
      {
        barcode: '8936036010023',
        name: 'Bánh Chocopie Orion hộp 12 cái 396g',
        unit: 'Hộp',
        batches: [
          {
            expiry_date: '2026-12-30',
            quantity: 35,
            note: 'Kệ bánh kẹo C1',
            photo_key: 'sample/chocopie_batch1.jpg',
            staff: { name: 'Nguyễn Văn An', uid: 'nv-an-01' },
          },
          {
            expiry_date: '2027-04-12',
            quantity: 60,
            note: 'Ụ trưng bày khuyến mãi',
            photo_key: 'sample/chocopie_batch2.jpg',
            staff: { name: 'Trần Thị Bình', uid: 'nv-binh-02' },
          },
        ],
      },
      {
        barcode: '8934988010011',
        name: 'Dầu ăn thượng hạng Neptune Gold 1L',
        unit: 'Chai',
        batches: [
          {
            expiry_date: '2028-02-15',
            quantity: 90,
            note: 'Kệ gia vị thực phẩm',
            photo_key: 'sample/neptune_batch1.jpg',
            staff: { name: 'Lê Hoàng Huy', uid: 'nv-huy-03' },
          },
        ],
      },
    ];

    let totalEntries = 0;

    for (const p of sampleProducts) {
      await firebaseRepo.upsertProduct(p.barcode, p.name, p.unit);

      for (const b of p.batches) {
        await firebaseRepo.createEntry(
          {
            barcode: p.barcode,
            product_name: p.name,
            expiry_date: b.expiry_date,
            quantity: b.quantity,
            note: b.note,
            photo_key: b.photo_key,
          },
          b.staff
        );
        totalEntries++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Đã nạp thành công ${sampleProducts.length} sản phẩm và ${totalEntries} lô kiểm kê mẫu vào Firebase!`,
      productsCount: sampleProducts.length,
      entriesCount: totalEntries,
    });
  } catch (error: any) {
    console.error('Seed error:', error);
    return NextResponse.json({ error: error.message || 'Lỗi nạp dữ liệu mẫu' }, { status: 500 });
  }
}
