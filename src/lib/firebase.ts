import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAuITzHu23U0JAve5HNqBo5GxNj2CHePaA',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'tonkho-691c7.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'tonkho-691c7',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'tonkho-691c7.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '1078902711273',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:1078902711273:web:7f9e6b16a92d7a6d186178',
};

// Khởi tạo Firestore kết nối trực tiếp dự án tonkho-691c7
export function getDb() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}
