import { NextRequest, NextResponse } from 'next/server';
import { getPresignedUploadUrl } from '@/lib/r2-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contentType = 'image/jpeg', barcode = 'misc' } = body;

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 9);
    const photoKey = `photos/${barcode}/${timestamp}_${randomStr}.jpg`;

    const uploadUrl = await getPresignedUploadUrl(photoKey, contentType);

    return NextResponse.json({
      uploadUrl,
      photoKey,
    });
  } catch (error: any) {
    console.error('Error generating presigned upload URL:', error);
    return NextResponse.json(
      { error: error.message || 'Lỗi tạo URL upload ảnh' },
      { status: 500 }
    );
  }
}
