import { NextRequest, NextResponse } from 'next/server';
import { doc, setDoc } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { photoKey, barcode, base64, contentType = 'image/jpeg' } = body;

    if (!photoKey || !base64) {
      return NextResponse.json({ error: 'Thiếu dữ liệu ảnh' }, { status: 400 });
    }

    const photoRef = doc(getDb(), 'inventoryPhotos', photoKey);
    await setDoc(photoRef, {
      barcode: barcode || 'misc',
      base64,
      contentType,
      created_at: Date.now(),
    });

    return NextResponse.json({
      success: true,
      photoKey,
    });
  } catch (error: any) {
    console.error('Lỗi lưu ảnh vào Firebase:', error);
    return NextResponse.json(
      { error: error.message || 'Lỗi lưu trữ ảnh vào Firebase' },
      { status: 500 }
    );
  }
}
