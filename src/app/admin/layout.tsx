import { redirect } from 'next/navigation';
import { checkIsAdmin } from '@/lib/auth-admin';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await checkIsAdmin())) redirect('/login');
  return children;
}
