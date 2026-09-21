import { NextRequest, NextResponse } from 'next/server';
import { firebaseRepo } from '@/lib/firebase-repository';
import { normalizeBarcode } from '@/lib/barcode-utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  try {
    const { barcode } = await params;
    const normalized = normalizeBarcode(barcode);
    const data = await firebaseRepo.lookupProduct(normalized);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error looking up product:', error);
    return NextResponse.json({ error: error.message || 'Lỗi tra cứu sản phẩm' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  try {
    const { barcode } = await params;
    const body = await request.json();
    const { name, unit } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Tên sản phẩm không được để trống' }, { status: 400 });
    }

    const normalized = normalizeBarcode(barcode);
    await firebaseRepo.upsertProduct(normalized, name.trim(), unit);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error upserting product:', error);
    return NextResponse.json({ error: error.message || 'Lỗi cập nhật sản phẩm' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  try {
    const { barcode } = await params;
    const normalized = normalizeBarcode(barcode);
    await firebaseRepo.deleteProduct(normalized);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting product:', error);
    return NextResponse.json({ error: error.message || 'Lỗi xóa sản phẩm' }, { status: 500 });
  }
}

