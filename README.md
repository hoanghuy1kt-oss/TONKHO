This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

### Cấu hình TONKHO

1. Trong Vercel → Project → Settings → Environment Variables, nhập các biến trong `.env.example`. Chọn Production và Preview nếu dùng cả hai. `.env.local` trên máy không tự được đưa lên Vercel.
2. Lấy `NEXT_PUBLIC_FIREBASE_*` từ Firebase Console → Project settings → Your apps → Web app → SDK configuration. Không dùng service-account private key làm API key. Firebase cần ít nhất API key, project ID và app ID; nên sao chép đầy đủ cấu hình của đúng Web app.
3. Đặt `ADMIN_PASSWORD` riêng và `ADMIN_JWT_SECRET` ngẫu nhiên dài ít nhất 32 ký tự. Ứng dụng không còn dùng mật khẩu hoặc khóa JWT mặc định.
4. Đặt `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` để tải ảnh. Bucket cần CORS cho origin của website, phương thức PUT và header Content-Type. `NEXT_PUBLIC_R2_PUBLIC_BASE` là tùy chọn; bỏ trống để xem ảnh qua API.
5. Redeploy sau khi thay biến môi trường. Các biến `NEXT_PUBLIC_*` được đóng vào bundle lúc build; sửa biến mà không build lại sẽ chưa có tác dụng.

Lỗi `auth/invalid-api-key` trong bước collect page data trước đây do import khởi tạo Firebase Auth dù ứng dụng không sử dụng Auth. Đã bỏ khởi tạo này và chỉ tạo Firestore khi cần. Build có thể hoàn tất khi chưa có Firebase, nhưng ứng dụng chỉ đọc/ghi được khi cấu hình đúng trước lúc build.

**Trước khi dùng dữ liệu thật:** đọc `AUDIT.md`. Rules hiện tại cho phép truy cập Firestore công khai; kiểm tra cookie trên API quản trị chưa bảo vệ đường truy cập trực tiếp Firestore.

Kiểm thử hồi quy, không truy cập database thật (Node 24):

```bash
node --test --test-isolation=none tests/inventory.test.mjs
npm run build
```

Tài liệu: [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables), [Vercel settings và redeploy](https://vercel.com/academy/vercel-foundations/vercel-settings), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
