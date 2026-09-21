-- TONKHO D1 Schema Migration 0001: Initial Schema

-- Bảng danh mục sản phẩm (Products)
CREATE TABLE IF NOT EXISTS products (
  barcode TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT,
  updated_at INTEGER NOT NULL
);

-- Bảng các lô kiểm kê (Inventory Entries - Mutable batches)
CREATE TABLE IF NOT EXISTS inventory_entries (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL REFERENCES products(barcode),
  product_name TEXT NOT NULL,
  expiry_date TEXT NOT NULL,          -- Định dạng YYYY-MM-DD
  quantity INTEGER NOT NULL,           -- Số lượng kiểm kê (int > 0)
  note TEXT,                           -- Ghi chú bổ sung
  photo_key TEXT NOT NULL,             -- Khóa object ảnh trên R2
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'deleted' (xóa mềm)
  rev INTEGER NOT NULL DEFAULT 1,      -- Optimistic concurrency counter
  created_at INTEGER NOT NULL,         -- Unix timestamp (ms)
  created_by_name TEXT NOT NULL,       -- Tên nhân viên tạo lô
  created_by_uid TEXT NOT NULL,        -- UUID thiết bị tạo lô
  updated_at INTEGER NOT NULL,         -- Unix timestamp (ms)
  last_edited_by_name TEXT NOT NULL,   -- Tên người sửa gần nhất
  last_edited_by_uid TEXT NOT NULL     -- UUID người sửa gần nhất
);

-- Bảng vết lịch sử kiểm kê (Inventory History - Append-only audit log)
CREATE TABLE IF NOT EXISTS inventory_history (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES inventory_entries(id),
  change_type TEXT NOT NULL,           -- 'create' | 'update' | 'delete'
  prev_quantity INTEGER,
  prev_expiry_date TEXT,
  prev_photo_key TEXT,
  new_quantity INTEGER,
  new_expiry_date TEXT,
  new_photo_key TEXT,
  edited_by_name TEXT NOT NULL,
  edited_by_uid TEXT NOT NULL,
  edited_at INTEGER NOT NULL,          -- Unix timestamp (ms)
  rev INTEGER NOT NULL                 -- Phiên bản sau khi thay đổi
);

-- Các chỉ mục (Indexes) tối ưu hóa truy vấn
CREATE INDEX IF NOT EXISTS idx_entries_status_created ON inventory_entries(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_barcode_status ON inventory_entries(barcode, status);
CREATE INDEX IF NOT EXISTS idx_history_entry ON inventory_history(entry_id, rev DESC);
