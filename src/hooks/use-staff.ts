'use client';

import { useState, useEffect } from 'react';

const STAFF_NAME_KEY = 'tonkho_staff_name';
const STAFF_UID_KEY = 'tonkho_staff_uid';

export function useStaff() {
  const [staffName, setStaffNameState] = useState<string>('');
  const [staffUid, setStaffUidState] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let uid = localStorage.getItem(STAFF_UID_KEY);
    if (!uid) {
      uid = crypto.randomUUID();
      localStorage.setItem(STAFF_UID_KEY, uid);
    }
    setStaffUidState(uid);

    const savedName = localStorage.getItem(STAFF_NAME_KEY) || '';
    setStaffNameState(savedName);
    setIsLoaded(true);
  }, []);

  const setStaffName = (name: string) => {
    const trimmed = name.trim();
    if (typeof window !== 'undefined') {
      localStorage.setItem(STAFF_NAME_KEY, trimmed);
    }
    setStaffNameState(trimmed);
  };

  return {
    staffName,
    staffUid,
    hasStaffName: Boolean(staffName),
    isLoaded,
    setStaffName,
  };
}
