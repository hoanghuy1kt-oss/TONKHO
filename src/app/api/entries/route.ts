import { checkIsAdmin } from '@/lib/auth-admin';
import { ValidationError } from '@/lib/inventory-validation';
import { NextRequest, NextResponse } from 'next/server';
import { firebaseRepo } from '@/lib/firebase-repository';
import { EntryDraft } from '@/types/inventory';
import { normalizeBarcode } from '@/lib/barcode-utils';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    if (searchParams.get('all') === 'true') {
      if (!(await checkIsAdmin())) {
        return NextResponse.json({ error: 'Cần đăng nhập quản trị viên' }, { status: 401 });
      }
      return NextResponse.json({ entries: await firebaseRepo.listRecentEntries(null) });
    }
    const limit = Number(searchParams.get('limit') || '100');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2500) {
      return NextResponse.json({ error: 'limit phải từ 1 đến 2500' }, { status: 400 });
    }

    const entries = await firebaseRepo.listRecentEntries(limit);
    return NextResponse.json({ entries });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error fetching entries:', error);
    return NextResponse.json({ error: error.message || 'Lỗi tải danh sách kiểm kê' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { draft, staff } = body as { draft: EntryDraft; staff: { name: string; uid: string } };

    if (!draft || !draft.barcode || !draft.product_name || !draft.expiry_date || !draft.quantity) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc của lô kiểm kê' }, { status: 400 });
    }

    if (!draft.unit || !draft.unit.trim()) {
      return NextResponse.json({ error: 'Đơn vị tính là bắt buộc' }, { status: 400 });
    }

    if (!draft.weight || !draft.weight.trim()) {
      return NextResponse.json({ error: 'Trọng lượng (g/kg) là bắt buộc' }, { status: 400 });
    }

    if (!draft.photo_key) {
      return NextResponse.json({ error: 'Hình ảnh kiểm kê là bắt buộc' }, { status: 400 });
    }

    if (!staff || !staff.name || !staff.uid) {
      return NextResponse.json({ error: 'Thiếu thông tin người thực hiện' }, { status: 400 });
    }

    const normalizedDraft = {
      ...draft,
      barcode: normalizeBarcode(draft.barcode),
      quantity: draft.quantity,
    };

    const created = await firebaseRepo.createEntry(normalizedDraft, staff);
    return NextResponse.json({ entry: created });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error creating entry:', error);
    return NextResponse.json({ error: error.message || 'Lỗi tạo lô kiểm kê' }, { status: 500 });
  }
}
