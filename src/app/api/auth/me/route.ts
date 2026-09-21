import { NextResponse } from 'next/server';
import { checkIsAdmin } from '@/lib/auth-admin';

export async function GET() {
  const isAdmin = await checkIsAdmin();
  return NextResponse.json({ isAdmin });
}
