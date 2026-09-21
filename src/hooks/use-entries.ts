'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { InventoryEntry } from '@/types/inventory';

export function useEntries(limitCount = 100) {
  const [entries, setEntries] = useState<InventoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());

  const subscribe = useCallback(() => {
    setLoading(true);
    // Không kết hợp where + orderBy trên server để tránh bắt buộc tạo composite index
    const q = query(
      collection(db, 'inventoryEntries'),
      orderBy('created_at', 'desc'),
      limit(limitCount)
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
        setEntries(list);
        setLastSynced(new Date());
        setLoading(false);
      },
      (error) => {
        console.error('Lỗi lắng nghe Firestore realtime:', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [limitCount]);

  useEffect(() => {
    const unsub = subscribe();
    return () => unsub();
  }, [subscribe]);

  return {
    entries,
    loading,
    lastSynced,
    refresh: subscribe,
  };
}
