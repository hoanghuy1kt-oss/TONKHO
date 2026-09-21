import { NextRequest, NextResponse } from 'next/server';
import { firebaseRepo } from '@/lib/firebase-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const history = await firebaseRepo.getEntryHistory(id);
    return NextResponse.json({ history });
  } catch (error: any) {
    console.error('Error fetching entry history:', error);
    return NextResponse.json({ error: error.message || 'Lỗi tải lịch sử lô' }, { status: 500 });
  }
}
