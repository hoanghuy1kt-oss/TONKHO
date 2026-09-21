export interface Product {
  barcode: string;
  name: string;
  unit?: string | null;
  weight?: string | null;
  flavor?: string | null;
  updated_at: number;
}

export type EntryStatus = 'active' | 'deleted';

export interface InventoryEntry {
  id: string;
  barcode: string;
  product_name: string;
  unit?: string | null;
  weight?: string | null;
  flavor?: string | null;
  expiry_date: string; // YYYY-MM-DD
  quantity: number;
  note?: string | null;
  photo_key: string;
  status: EntryStatus;
  rev: number;
  created_at: number; // Unix ms
  created_by_name: string;
  created_by_uid: string;
  updated_at: number; // Unix ms
  last_edited_by_name: string;
  last_edited_by_uid: string;
}

export type HistoryChangeType = 'create' | 'update' | 'delete';

export interface InventoryHistory {
  id: string;
  entry_id: string;
  change_type: HistoryChangeType;
  prev_quantity: number | null;
  prev_expiry_date: string | null;
  prev_photo_key: string | null;
  new_quantity: number | null;
  new_expiry_date: string | null;
  new_photo_key: string | null;
  edited_by_name: string;
  edited_by_uid: string;
  edited_at: number; // Unix ms
  rev: number;
}

export interface EntryDraft {
  id?: string;
  barcode: string;
  product_name: string;
  unit?: string;
  weight?: string;
  flavor?: string;
  expiry_date: string;
  quantity: number;
  note?: string;
  photo_key: string;
  rev?: number;
}

export interface ProductBatchesResponse {
  product: Product | null;
  batches: InventoryEntry[];
  totalQuantity: number;
}
