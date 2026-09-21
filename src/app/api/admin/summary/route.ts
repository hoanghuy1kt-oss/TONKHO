import { NextResponse } from 'next/server';
import { firebaseRepo } from '@/lib/firebase-repository';

export async function GET() {
  try {
    const summary = await firebaseRepo.getAdminStockSummary();
    return NextResponse.json({ summary });
  } catch (error: any) {
    console.error('Error fetching admin stock summary:', error);
    return NextResponse.json({ error: error.message || 'Lỗi tải tổng hợp kho' }, { status: 500 });
  }
}
