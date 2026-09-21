import { NextRequest, NextResponse } from 'next/server';
import { firebaseRepo } from '@/lib/firebase-repository';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { rev, updates, staff } = body;

    if (rev === undefined || typeof rev !== 'number') {
      return NextResponse.json({ error: 'Thiếu rev hiện tại để kiểm tra phiên bản' }, { status: 400 });
    }

    if (!updates || !updates.quantity || !updates.expiry_date) {
      return NextResponse.json({ error: 'Thiếu thông tin cập nhật (số lượng, HSD)' }, { status: 400 });
    }

    if (!staff || !staff.name || !staff.uid) {
      return NextResponse.json({ error: 'Thiếu thông tin người thực hiện' }, { status: 400 });
    }

    const updated = await firebaseRepo.updateEntry(
      id,
      rev,
      {
        quantity: Number(updates.quantity),
        expiry_date: updates.expiry_date,
        photo_key: updates.photo_key,
        note: updates.note,
      },
      staff
    );

    return NextResponse.json({ entry: updated });
  } catch (error: any) {
    console.error('Error updating entry:', error);
    const isConflict = error.message && error.message.includes('Xung đột');
    return NextResponse.json(
      { error: error.message || 'Lỗi cập nhật lô kiểm kê' },
      { status: isConflict ? 409 : 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let rev: number | undefined = undefined;
    let staff = { name: 'Admin', uid: 'admin' };

    try {
      const body = await request.json();
      if (body?.rev !== undefined && typeof body.rev === 'number') {
        rev = body.rev;
      }
      if (body?.staff?.name && body?.staff?.uid) {
        staff = body.staff;
      }
    } catch {
      // Body may be empty or not json, which is permitted
    }

    await firebaseRepo.deleteEntry(id, rev, staff);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting entry:', error);
    const isConflict = error.message && error.message.includes('Xung đột');
    return NextResponse.json(
      { error: error.message || 'Lỗi xóa lô kiểm kê' },
      { status: isConflict ? 409 : 500 }
    );
  }
}
