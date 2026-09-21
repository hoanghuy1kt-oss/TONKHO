import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f0fdf4"/>
      <stop offset="100%" stop-color="#dcfce7"/>
    </linearGradient>
  </defs>
  <rect width="160" height="160" rx="20" fill="url(#bg)"/>
  <g transform="translate(56, 44)" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </g>
  <text x="80" y="108" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="bold" fill="#059669" text-anchor="middle">ẢNH MẪU</text>
  <text x="80" y="124" font-family="system-ui, -apple-system, sans-serif" font-size="9" fill="#10b981" text-anchor="middle">Kiểm kho</text>
</svg>`;

export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get('key');
    if (!key || key.startsWith('sample/')) {
      return new NextResponse(FALLBACK_SVG, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const docRef = doc(getDb(), 'inventoryPhotos', key);
    const snap = await getDoc(docRef);

    if (!snap.exists() || !snap.data()?.base64) {
      return new NextResponse(FALLBACK_SVG, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const data = snap.data();
    const buffer = Buffer.from(data.base64, 'base64');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': data.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Lỗi lấy ảnh từ Firebase:', error);
    return new NextResponse(FALLBACK_SVG, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
}
