'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import { InventoryEntry } from '@/types/inventory';

export function useEntries(limitCount = 100) {
  const [entries, setEntries] = useState<InventoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());
  const [error, setError] = useState('');

  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  const refresh = useCallback(() => setSubscriptionVersion((value) => value + 1), []);

  const subscribe = useCallback(() => {
    // Không kết hợp where + orderBy trên server để tránh bắt buộc tạo composite index
    const q = query(
      collection(getDb(), 'inventoryEntries'),
      where('status', '==', 'active')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: InventoryEntry[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Omit<InventoryEntry, 'id'>;
          if (data.status === 'active') {
            list.push({ id: docSnap.id, ...data });
          }
        });
        list.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
        setEntries(list.slice(0, limitCount));
        setLastSynced(new Date());
        setLoading(false);
        setError('');
      },
      (error) => {
        console.error('Lỗi lắng nghe Firestore realtime:', error);
        setLoading(false);
        setError('Không thể tải dữ liệu kiểm kho. Vui lòng thử làm mới.');
      }
    );

    return unsubscribe;
  }, [limitCount]);

  useEffect(() => {
    let cancelled = false;
    try {
      return subscribe();
    } catch (error) {
      console.error('Không thể kết nối Firestore:', error);
      queueMicrotask(() => {
        if (cancelled) return;
        setLoading(false);
        setError('Không thể kết nối dữ liệu kiểm kho. Vui lòng liên hệ quản trị viên.');
      });
    }
    return () => { cancelled = true; };
  }, [subscribe, subscriptionVersion]);

  return {
    entries,
    loading,
    error,
    lastSynced,
    refresh,
  };
}
