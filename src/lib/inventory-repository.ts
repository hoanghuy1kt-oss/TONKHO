import { d1 } from './d1-client';
import { InventoryEntry, InventoryHistory, Product, ProductBatchesResponse, EntryDraft } from '@/types/inventory';

export class InventoryRepository {
  /**
   * Tra cứu sản phẩm và các lô hàng đang active
   */
  async lookupProduct(barcode: string): Promise<ProductBatchesResponse> {
    const [productRes, batchesRes] = await Promise.all([
      d1.query<Product>('SELECT * FROM products WHERE barcode = ?', [barcode]),
      d1.query<InventoryEntry>(
        'SELECT * FROM inventory_entries WHERE barcode = ? AND status = "active" ORDER BY expiry_date ASC',
        [barcode]
      ),
    ]);

    const product = productRes.results[0] || null;
    const batches = batchesRes.results || [];
    const totalQuantity = batches.reduce((sum, b) => sum + (b.quantity || 0), 0);

    return { product, batches, totalQuantity };
  }

  /**
   * Tạo hoặc cập nhật thông tin sản phẩm
   */
  async upsertProduct(barcode: string, name: string, unit?: string | null): Promise<void> {
    const now = Date.now();
    await d1.query(
      `INSERT INTO products (barcode, name, unit, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(barcode) DO UPDATE SET
         name = excluded.name,
         unit = COALESCE(excluded.unit, products.unit),
         updated_at = excluded.updated_at`,
      [barcode, name, unit || null, now]
    );
  }

  /**
   * Tạo một lô kiểm kê mới + ghi vết lịch sử
   */
  async createEntry(
    draft: EntryDraft,
    staff: { name: string; uid: string }
  ): Promise<InventoryEntry> {
    const id = draft.id || crypto.randomUUID();
    const historyId = crypto.randomUUID();
    const now = Date.now();

    // Đảm bảo thông tin sản phẩm đã có trong bảng products
    await this.upsertProduct(draft.barcode, draft.product_name);

    const entrySql = `
      INSERT INTO inventory_entries (
        id, barcode, product_name, expiry_date, quantity, note, photo_key,
        status, rev, created_at, created_by_name, created_by_uid,
        updated_at, last_edited_by_name, last_edited_by_uid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?)
    `;

    const historySql = `
      INSERT INTO inventory_history (
        id, entry_id, change_type, prev_quantity, prev_expiry_date, prev_photo_key,
        new_quantity, new_expiry_date, new_photo_key, edited_by_name, edited_by_uid,
        edited_at, rev
      ) VALUES (?, ?, 'create', NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)
    `;

    await d1.batch([
      {
        sql: entrySql,
        params: [
          id,
          draft.barcode,
          draft.product_name,
          draft.expiry_date,
          draft.quantity,
          draft.note || null,
          draft.photo_key,
          now,
          staff.name,
          staff.uid,
          now,
          staff.name,
          staff.uid,
        ],
      },
      {
        sql: historySql,
        params: [
          historyId,
          id,
          draft.quantity,
          draft.expiry_date,
          draft.photo_key,
          staff.name,
          staff.uid,
          now,
        ],
      },
    ]);

    return {
      id,
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
  }

  /**
   * Cập nhật một lô kiểm kê hiện có với kiểm tra Optimistic Locking (rev)
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
    // 1. Lấy trạng thái hiện tại của lô
    const curRes = await d1.query<InventoryEntry>('SELECT * FROM inventory_entries WHERE id = ?', [id]);
    const current = curRes.results[0];
    if (!current) {
      throw new Error('Lô kiểm kê không tồn tại.');
    }
    if (current.rev !== expectedRev) {
      throw new Error('Xung đột dữ liệu: Lô này vừa được người khác cập nhật. Vui lòng tải lại dữ liệu.');
    }

    const now = Date.now();
    const nextRev = expectedRev + 1;
    const historyId = crypto.randomUUID();
    const finalPhotoKey = updates.photo_key || current.photo_key;

    const updateSql = `
      UPDATE inventory_entries SET
        quantity = ?,
        expiry_date = ?,
        photo_key = ?,
        note = ?,
        rev = ?,
        updated_at = ?,
        last_edited_by_name = ?,
        last_edited_by_uid = ?
      WHERE id = ? AND rev = ?
    `;

    const historySql = `
      INSERT INTO inventory_history (
        id, entry_id, change_type, prev_quantity, prev_expiry_date, prev_photo_key,
        new_quantity, new_expiry_date, new_photo_key, edited_by_name, edited_by_uid,
        edited_at, rev
      ) VALUES (?, ?, 'update', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const batchRes = await d1.batch([
      {
        sql: updateSql,
        params: [
          updates.quantity,
          updates.expiry_date,
          finalPhotoKey,
          updates.note !== undefined ? updates.note : current.note,
          nextRev,
          now,
          staff.name,
          staff.uid,
          id,
          expectedRev,
        ],
      },
      {
        sql: historySql,
        params: [
          historyId,
          id,
          current.quantity,
          current.expiry_date,
          current.photo_key,
          updates.quantity,
          updates.expiry_date,
          finalPhotoKey,
          staff.name,
          staff.uid,
          now,
          nextRev,
        ],
      },
    ]);

    const updateResult = batchRes[0];
    if (updateResult.meta.changes === 0) {
      throw new Error('Xung đột dữ liệu: Lô này vừa được người khác cập nhật. Vui lòng tải lại dữ liệu.');
    }

    return {
      ...current,
      quantity: updates.quantity,
      expiry_date: updates.expiry_date,
      photo_key: finalPhotoKey,
      note: updates.note !== undefined ? updates.note : current.note,
      rev: nextRev,
      updated_at: now,
      last_edited_by_name: staff.name,
      last_edited_by_uid: staff.uid,
    };
  }

  /**
   * Xóa mềm một lô kiểm kê (status = 'deleted') kèm ghi nhận lịch sử
   */
  async softDeleteEntry(
    id: string,
    expectedRev: number,
    staff: { name: string; uid: string }
  ): Promise<void> {
    const curRes = await d1.query<InventoryEntry>('SELECT * FROM inventory_entries WHERE id = ?', [id]);
    const current = curRes.results[0];
    if (!current) {
      throw new Error('Lô kiểm kê không tồn tại.');
    }
    if (current.rev !== expectedRev) {
      throw new Error('Xung đột dữ liệu: Lô này vừa được người khác cập nhật. Vui lòng tải lại dữ liệu.');
    }

    const now = Date.now();
    const nextRev = expectedRev + 1;
    const historyId = crypto.randomUUID();

    await d1.batch([
      {
        sql: `UPDATE inventory_entries SET
                status = 'deleted',
                rev = ?,
                updated_at = ?,
                last_edited_by_name = ?,
                last_edited_by_uid = ?
              WHERE id = ? AND rev = ?`,
        params: [nextRev, now, staff.name, staff.uid, id, expectedRev],
      },
      {
        sql: `INSERT INTO inventory_history (
                id, entry_id, change_type, prev_quantity, prev_expiry_date, prev_photo_key,
                new_quantity, new_expiry_date, new_photo_key, edited_by_name, edited_by_uid,
                edited_at, rev
              ) VALUES (?, ?, 'delete', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
        params: [
          historyId,
          id,
          current.quantity,
          current.expiry_date,
          current.photo_key,
          staff.name,
          staff.uid,
          now,
          nextRev,
        ],
      },
    ]);
  }

  /**
   * Lấy danh sách các lượt kiểm kê mới nhất (active)
   */
  async listRecentEntries(limit = 200, since?: number): Promise<InventoryEntry[]> {
    if (since) {
      const res = await d1.query<InventoryEntry>(
        'SELECT * FROM inventory_entries WHERE status = "active" AND updated_at > ? ORDER BY updated_at DESC LIMIT ?',
        [since, limit]
      );
      return res.results || [];
    }

    const res = await d1.query<InventoryEntry>(
      'SELECT * FROM inventory_entries WHERE status = "active" ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return res.results || [];
  }

  /**
   * Lấy toàn bộ lịch sử thay đổi của một lô
   */
  async getEntryHistory(entryId: string): Promise<InventoryHistory[]> {
    const res = await d1.query<InventoryHistory>(
      'SELECT * FROM inventory_history WHERE entry_id = ? ORDER BY rev DESC',
      [entryId]
    );
    return res.results || [];
  }

  /**
   * Thống kê tổng hợp cho Admin: tổng số lượng theo từng mặt hàng
   */
  async getAdminStockSummary(): Promise<Array<{ barcode: string; name: string; total_quantity: number; batch_count: number }>> {
    const res = await d1.query<{ barcode: string; name: string; total_quantity: number; batch_count: number }>(`
      SELECT 
        p.barcode,
        p.name,
        COALESCE(SUM(e.quantity), 0) as total_quantity,
        COUNT(e.id) as batch_count
      FROM products p
      LEFT JOIN inventory_entries e ON p.barcode = e.barcode AND e.status = 'active'
      GROUP BY p.barcode, p.name
      ORDER BY total_quantity DESC
    `);
    return res.results || [];
  }
}

export const inventoryRepo = new InventoryRepository();
