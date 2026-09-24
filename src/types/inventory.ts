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
  unit?: string | null;
  weight?: string | null;
  flavor?: string | null;
  expiry_date: string;
  quantity: number;
  note?: string | null;
  photo_key: string;
  rev?: number;
}

export interface ProductBatchesResponse {
  product: Product | null;
  batches: InventoryEntry[];
  totalQuantity: number;
  totalDisplay?: string;
  unitDisplay?: string;
  conversionNote?: string | null;
  isMultiUnit?: boolean;
}

export interface StockSummaryItem {
  barcode: string;
  name: string;
  unit?: string | null;
  units?: string[];
  weight?: string | null;
  flavor?: string | null;
  total_quantity: number;
  total_display?: string;
  unit_display?: string;
  conversion_note?: string | null;
  unit_breakdown?: Array<{ unit: string; quantity: number }>;
  is_multi_unit?: boolean;
  batch_count: number;
}
