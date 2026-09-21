export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Mật khẩu đã được gỡ bỏ, cho phép truy cập trực tiếp vào trang Admin
  return <>{children}</>;
}
