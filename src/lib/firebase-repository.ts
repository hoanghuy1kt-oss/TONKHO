import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
  runTransaction,
} from 'firebase/firestore';
import { getDb } from './firebase';
import { ValidationError, validateEntryValues, validateStaff, validateRevision } from './inventory-validation';
import {
  InventoryEntry,
  InventoryHistory,
  Product,
  ProductBatchesResponse,
  EntryDraft,
} from '@/types/inventory';

export class FirebaseInventoryRepository {
  /**
   * Tra cứu sản phẩm và các lô hàng đang active
   */
  async lookupProduct(barcode: string): Promise<ProductBatchesResponse> {
    const productRef = doc(getDb(), 'products', barcode);
    const productSnap = await getDoc(productRef);
    const product = productSnap.exists() ? (productSnap.data() as Product) : null;

    const entriesRef = collection(getDb(), 'inventoryEntries');
    const q = query(
      entriesRef,
      where('barcode', '==', barcode)
    );
    const entriesSnap = await getDocs(q);

    const batches: InventoryEntry[] = [];
    entriesSnap.forEach((docSnap) => {
      const data = docSnap.data() as Omit<InventoryEntry, 'id'>;
      if (data.status === 'active') {
        batches.push({ id: docSnap.id, ...data });
      }
    });

    // Sắp xếp theo hạn sử dụng tăng dần (HSD gần nhất lên trước)
    batches.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));

    const totalQuantity = batches.reduce((sum, b) => sum + (b.quantity || 0), 0);

    return { product, batches, totalQuantity };
  }

  /**
   * Tạo hoặc cập nhật thông tin sản phẩm
   */
  async upsertProduct(barcode: string, name: string, unit?: string | null): Promise<void> {
    const productRef = doc(getDb(), 'products', barcode);
    await setDoc(
      productRef,
      {
        barcode,
        name,
        ...(unit !== undefined ? { unit } : {}),
        updated_at: Date.now(),
      },
      { merge: true }
    );
  }

  /**
   * Tạo một lô kiểm kê mới + ghi vết lịch sử (nguyên tử qua transaction)
   */
  async createEntry(
    draft: EntryDraft,
    staff: { name: string; uid: string }
  ): Promise<InventoryEntry> {
    validateEntryValues(draft.quantity, draft.expiry_date);
    validateStaff(staff);
    if (typeof draft.barcode !== 'string' || !draft.barcode.trim() || draft.barcode.includes('/') ||
        typeof draft.product_name !== 'string' || !draft.product_name.trim() ||
        typeof draft.photo_key !== 'string' || !draft.photo_key.trim()) {
      throw new ValidationError('Mã vạch, tên sản phẩm và ảnh là bắt buộc.');
    }
    const now = Date.now();
    const entryId = draft.id || crypto.randomUUID();
    const historyId = crypto.randomUUID();

    return runTransaction(getDb(), async (batch) => {
      const entryRef = doc(getDb(), 'inventoryEntries', entryId);
      if ((await batch.get(entryRef)).exists()) {
        throw new Error('Xung đột dữ liệu: Mã lô đã tồn tại.');
      }
      batch.set(doc(getDb(), 'products', draft.barcode), {
        barcode: draft.barcode, name: draft.product_name, updated_at: now,
      }, { merge: true });
      const newEntry: Omit<InventoryEntry, 'id'> = {
        barcode: draft.barcode,
        product_name: draft.product_name,
        expiry_date: draft.expiry_date,
        quantity: draft.quantity,
        note: draft.note || null,
        photo_key: draft.photo_key,
        status: 'active',
        rev: 1,
        created_at: now,
        created_by_name: staff.name,
        created_by_uid: staff.uid,
        updated_at: now,
        last_edited_by_name: staff.name,
        last_edited_by_uid: staff.uid,
      };
      batch.set(entryRef, newEntry);

      const historyRef = doc(getDb(), 'inventoryEntries', entryId, 'history', historyId);
      const newHistory: InventoryHistory = {
        id: historyId,
        entry_id: entryId,
        change_type: 'create',
        prev_quantity: null,
        prev_expiry_date: null,
        prev_photo_key: null,
        new_quantity: draft.quantity,
        new_expiry_date: draft.expiry_date,
        new_photo_key: draft.photo_key,
        edited_by_name: staff.name,
        edited_by_uid: staff.uid,
        edited_at: now,
        rev: 1,
      };
      batch.set(historyRef, newHistory);

      return { id: entryId, ...newEntry };
    });
  }

  /**
   * Cập nhật một lô kiểm kê hiện có với Optimistic Concurrency Lock (rev)
   */
  async updateEntry(
    id: string,
    expectedRev: number,
    updates: {
      quantity: number;
      expiry_date: string;
      photo_key?: string;
      note?: string | null;
    },
    staff: { name: string; uid: string }
  ): Promise<InventoryEntry> {
    validateEntryValues(updates.quantity, updates.expiry_date);
    validateRevision(expectedRev);
    validateStaff(staff);
    return runTransaction(getDb(), async (batch) => {
      const entryRef = doc(getDb(), 'inventoryEntries', id);
      const entrySnap = await batch.get(entryRef);

      if (!entrySnap.exists()) {
        throw new Error('Lô kiểm kê không tồn tại.');
      }

      const current = entrySnap.data() as InventoryEntry;
      if (current.status !== 'active' || current.rev !== expectedRev) {
        throw new Error('Xung đột dữ liệu: Lô này vừa được người khác cập nhật. Vui lòng tải lại dữ liệu.');
      }

      const now = Date.now();
      const nextRev = expectedRev + 1;
      const historyId = crypto.randomUUID();
      const finalPhotoKey = updates.photo_key || current.photo_key;

      batch.update(entryRef, {
        quantity: updates.quantity,
        expiry_date: updates.expiry_date,
        photo_key: finalPhotoKey,
        note: updates.note !== undefined ? updates.note : current.note,
        rev: nextRev,
        updated_at: now,
        last_edited_by_name: staff.name,
        last_edited_by_uid: staff.uid,
      });

      const historyRef = doc(getDb(), 'inventoryEntries', id, 'history', historyId);
      const newHistory: InventoryHistory = {
        id: historyId,
        entry_id: id,
        change_type: 'update',
        prev_quantity: current.quantity,
        prev_expiry_date: current.expiry_date,
        prev_photo_key: current.photo_key,
        new_quantity: updates.quantity,
        new_expiry_date: updates.expiry_date,
        new_photo_key: finalPhotoKey,
        edited_by_name: staff.name,
        edited_by_uid: staff.uid,
        edited_at: now,
        rev: nextRev,
      };
      batch.set(historyRef, newHistory);

      return {
        ...current,
        id,
        quantity: updates.quantity,
        expiry_date: updates.expiry_date,
        photo_key: finalPhotoKey,
        note: updates.note !== undefined ? updates.note : current.note,
        rev: nextRev,
        updated_at: now,
        last_edited_by_name: staff.name,
        last_edited_by_uid: staff.uid,
      };
    });
  }

  /**
   * Xóa mềm lô kiểm kê, giữ lịch sử để đối soát
   */
  async deleteEntry(
    id: string,
    expectedRev: number,
    staff: { name: string; uid: string }
  ): Promise<void> {
    return this.softDeleteEntry(id, expectedRev, staff);
  }

  /**
   * Xóa mềm một lô kiểm kê (status = 'deleted') kèm ghi nhận lịch sử
   */
  async softDeleteEntry(
    id: string,
    expectedRev: number,
    staff: { name: string; uid: string }
  ): Promise<void> {
    validateRevision(expectedRev);
    validateStaff(staff);
    return runTransaction(getDb(), async (batch) => {
      const entryRef = doc(getDb(), 'inventoryEntries', id);
      const entrySnap = await batch.get(entryRef);

      if (!entrySnap.exists()) {
        throw new Error('Lô kiểm kê không tồn tại.');
      }

      const current = entrySnap.data() as InventoryEntry;
      if (current.status !== 'active' || current.rev !== expectedRev) {
        throw new Error('Xung đột dữ liệu: Lô này vừa được người khác cập nhật. Vui lòng tải lại dữ liệu.');
      }

      const now = Date.now();
      const nextRev = expectedRev + 1;
      const historyId = crypto.randomUUID();

      batch.update(entryRef, {
        status: 'deleted',
        rev: nextRev,
        updated_at: now,
        last_edited_by_name: staff.name,
        last_edited_by_uid: staff.uid,
      });

      const historyRef = doc(getDb(), 'inventoryEntries', id, 'history', historyId);
      batch.set(historyRef, {
        id: historyId,
        entry_id: id,
        change_type: 'delete',
        prev_quantity: current.quantity,
        prev_expiry_date: current.expiry_date,
        prev_photo_key: current.photo_key,
        new_quantity: null,
        new_expiry_date: null,
        new_photo_key: null,
        edited_by_name: staff.name,
        edited_by_uid: staff.uid,
        edited_at: now,
        rev: nextRev,
      });

    });
  }

  /**
   * Xóa sản phẩm và tất cả các lô hàng liên quan
   */
  async deleteProduct(barcode: string): Promise<void> {
    const productRef = doc(getDb(), 'products', barcode);
    await deleteDoc(productRef);

    // Xóa các lô kiểm kê liên quan
    const entriesSnap = await getDocs(
      query(collection(getDb(), 'inventoryEntries'), where('barcode', '==', barcode))
    );

    if (!entriesSnap.empty) {
      const batch = writeBatch(getDb());
      entriesSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
    }
  }

  /**
   * Lấy danh sách các lượt kiểm kê mới nhất (active)
   */
  async listRecentEntries(limitCount: number | null = 100): Promise<InventoryEntry[]> {
    const entriesRef = collection(getDb(), 'inventoryEntries');
    const q = query(
      entriesRef,
      where('status', '==', 'active')
    );

    const snap = await getDocs(q);
    const list: InventoryEntry[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Omit<InventoryEntry, 'id'>;
      if (data.status === 'active') {
        list.push({ id: docSnap.id, ...data });
      }
    });
    list.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    return limitCount === null ? list : list.slice(0, limitCount);
  }

  /**
   * Lấy toàn bộ lịch sử thay đổi của một lô
   */
  async getEntryHistory(entryId: string): Promise<InventoryHistory[]> {
    const historyRef = collection(getDb(), 'inventoryEntries', entryId, 'history');
    const q = query(historyRef, orderBy('rev', 'desc'));
    const snap = await getDocs(q);

    const list: InventoryHistory[] = [];
    snap.forEach((docSnap) => {
      list.push({ id: docSnap.id, ...(docSnap.data() as Omit<InventoryHistory, 'id'>) });
    });
    return list;
  }

  /**
   * Thống kê tổng hợp cho Admin: tổng số lượng theo từng mặt hàng
   */
  async getAdminStockSummary(): Promise<
    Array<{ barcode: string; name: string; unit?: string | null; total_quantity: number; batch_count: number }>
  > {
    const productsSnap = await getDocs(collection(getDb(), 'products'));
    const productsMap = new Map<string, { barcode: string; name: string; unit?: string | null; total_quantity: number; batch_count: number }>();

    productsSnap.forEach((docSnap) => {
      const p = docSnap.data() as Product;
      productsMap.set(p.barcode, {
        barcode: p.barcode,
        name: p.name,
        unit: p.unit || null,
        total_quantity: 0,
        batch_count: 0,
      });
    });

    const entriesSnap = await getDocs(
      query(collection(getDb(), 'inventoryEntries'), where('status', '==', 'active'))
    );

    entriesSnap.forEach((docSnap) => {
      const e = docSnap.data() as InventoryEntry;
      let item = productsMap.get(e.barcode);
      if (!item) {
        item = {
          barcode: e.barcode,
          name: e.product_name,
          unit: null,
          total_quantity: 0,
          batch_count: 0,
        };
        productsMap.set(e.barcode, item);
      }
      item.total_quantity += e.quantity || 0;
      item.batch_count += 1;
    });

    const result = Array.from(productsMap.values());
    result.sort((a, b) => b.total_quantity - a.total_quantity);
    return result;
  }
}

export const firebaseRepo = new FirebaseInventoryRepository();
