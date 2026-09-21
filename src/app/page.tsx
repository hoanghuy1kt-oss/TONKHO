'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useStaff } from '@/hooks/use-staff';
import { useEntries } from '@/hooks/use-entries';
import { InventoryEntry, Product } from '@/types/inventory';
import { normalizeBarcode } from '@/lib/barcode-utils';
import { BarcodeScannerModal } from '@/components/scanner/barcode-scanner-modal';
import { StaffModal } from '@/components/staff/staff-modal';
import { EntryModal } from '@/components/inventory/entry-modal';
import { BatchCard } from '@/components/inventory/batch-card';
import { RecentFeed } from '@/components/inventory/recent-feed';

export default function Home() {
  const { staffName, staffUid, hasStaffName, isLoaded, setStaffName } = useStaff();
  const { entries, loading: feedLoading, error: feedError, lastSynced, refresh: refreshFeed } = useEntries(2500);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Trạng thái modal
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);

  // Dữ liệu sản phẩm đang tra cứu
  const [barcodeInput, setBarcodeInput] = useState('');
  const [activeBarcode, setActiveBarcode] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [batches, setBatches] = useState<InventoryEntry[]>([]);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [lookupLoading, setLookupLoading] = useState(false);
  const lookupVersion = useRef(0);

  // Lô được chọn để chỉnh sửa (null = thêm lô mới)
  const [selectedBatchForEdit, setSelectedBatchForEdit] = useState<InventoryEntry | null>(null);

  // Mở modal nhập tên nếu chưa có
  useEffect(() => {
    if (isLoaded && !hasStaffName) {
      setIsStaffModalOpen(true);
    }
  }, [isLoaded, hasStaffName]);

  // Tự động nhận diện và tra cứu nhanh khi mã vạch được quét vào ô (máy bắn mã vạch / paste / gõ đủ số)
  useEffect(() => {
    const clean = barcodeInput.trim();
    if (/^\d{8,14}$/.test(clean)) {
      const timer = setTimeout(() => {
        handleLookupBarcode(clean);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [barcodeInput]);

  // Tra cứu thông tin sản phẩm và các lô hàng theo mã vạch
  const handleLookupBarcode = useCallback(async (code: string) => {
    const normalized = normalizeBarcode(code);
    if (!normalized) return;

    const version = ++lookupVersion.current;
    setActiveBarcode(normalized);
    setProduct(null);
    setBatches([]);
    setTotalQuantity(0);
    setLookupLoading(true);

    try {
      const res = await fetch(`/api/products/${encodeURIComponent(normalized)}`);
      if (res.ok) {
        const data = await res.json();
        if (version !== lookupVersion.current) return;
        setProduct(data.product);
        setBatches(data.batches || []);
        setTotalQuantity(data.totalQuantity || 0);
      }
    } catch (err) {
      console.error('Lookup error:', err);
    } finally {
      if (version === lookupVersion.current) setLookupLoading(false);
    }
  }, []);

  const handleScanSuccess = (scannedCode: string) => {
    setIsScannerOpen(false);
    setBarcodeInput(scannedCode);
    handleLookupBarcode(scannedCode);
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (barcodeInput.trim()) {
      handleLookupBarcode(barcodeInput);
    }
  };

  const openAddBatch = () => {
    if (!hasStaffName) {
      setIsStaffModalOpen(true);
      return;
    }
    setSelectedBatchForEdit(null);
    setIsEntryModalOpen(true);
  };

  const openEditBatch = (batch: InventoryEntry) => {
    if (!hasStaffName) {
      setIsStaffModalOpen(true);
      return;
    }
    setSelectedBatchForEdit(batch);
    setIsEntryModalOpen(true);
  };

  const handleDeleteBatch = async (batch: InventoryEntry) => {
    if (!hasStaffName) {
      setIsStaffModalOpen(true);
      return;
    }
    if (!confirm(`Bạn có chắc chắn muốn xóa lô SL ${batch.quantity} (HSD: ${batch.expiry_date})?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/entries/${batch.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rev: batch.rev,
          staff: { name: staffName, uid: staffUid },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Xóa thất bại');
        return;
      }

      // Làm mới dữ liệu
      handleLookupBarcode(activeBarcode);
      refreshFeed();
    } catch (err) {
      console.error('Delete error:', err);
      alert('Đã xảy ra lỗi khi xóa');
    }
  };

  const handleEntrySuccess = () => {
    if (activeBarcode) {
      handleLookupBarcode(activeBarcode);
    }
    refreshFeed();
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📦</span>
            <span className="font-extrabold text-base tracking-tight">TONKHO</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Tên nhân viên chip */}
            <button
              type="button"
              onClick={() => setIsStaffModalOpen(true)}
              className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition"
            >
              <span>👤</span>
              <span className="max-w-[100px] truncate" suppressHydrationWarning>
                {mounted && staffName ? staffName : 'Chưa đặt tên'}
              </span>
              <span className="text-[10px] text-zinc-400">✏️</span>
            </button>

            {/* Admin link */}
            <Link
              href="/admin"
              className="p-2 rounded-xl text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
              title="Trang quản trị"
            >
              ⚙️ Admin
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-xl w-full mx-auto px-4 py-4 space-y-5">
        {feedError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{feedError}</p>}
        {/* Scanner & Search Action Box */}
        <section className="bg-white dark:bg-zinc-900 rounded-3xl p-4 sm:p-5 shadow-xs border border-zinc-200 dark:border-zinc-800 space-y-3.5">
          {/* Nút to mở Camera Quét mã */}
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="w-full py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-base shadow-sm flex items-center justify-center gap-2.5 transition"
          >
            <span className="text-xl">📷</span>
            <span>BẬT CAMERA QUÉT MÃ</span>
          </button>

          {/* Ô nhập mã vạch thủ công */}
          <form onSubmit={handleManualSearch} className="flex gap-2">
            <input
              type="text"
              placeholder="Hoặc nhập mã vạch (EAN/UPC)..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-bold transition"
            >
              Tra cứu
            </button>
          </form>
        </section>

        {/* Kết quả tra cứu mã vạch */}
        {activeBarcode && (
          <section className="bg-white dark:bg-zinc-900 rounded-3xl p-4 sm:p-5 shadow-xs border border-zinc-200 dark:border-zinc-800 space-y-4">
            {lookupLoading ? (
              <div className="py-8 text-center text-zinc-400 text-sm">Đang tải thông tin sản phẩm...</div>
            ) : (
              <>
                {/* Tiêu đề sản phẩm */}
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
                      Mã: {activeBarcode}
                    </span>
                    <h2 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 mt-0.5">
                      {product?.name || 'Sản phẩm mới (chưa có tên)'}
                    </h2>
                  </div>

                  {/* Tổng tồn kho */}
                  <div className="text-right shrink-0">
                    <span className="text-[11px] text-zinc-400 font-semibold block">TỔNG TỒN</span>
                    <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                      {totalQuantity}
                    </span>
                  </div>
                </div>

                {/* Danh sách các lô hiện có */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                      Các lô hàng mở ({batches.length})
                    </h3>
                    <button
                      type="button"
                      onClick={openAddBatch}
                      className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-400 text-xs font-bold transition flex items-center gap-1"
                    >
                      ➕ Thêm lô mới
                    </button>
                  </div>

                  {batches.length > 0 ? (
                    <div className="space-y-2">
                      {batches.map((batch) => (
                        <BatchCard
                          key={batch.id}
                          batch={batch}
                          onEdit={openEditBatch}
                          onDelete={handleDeleteBatch}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 px-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 text-center space-y-2 border border-dashed border-zinc-200 dark:border-zinc-800">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Chưa có lô kiểm kê nào cho mã vạch này.
                      </p>
                      <button
                        type="button"
                        onClick={openAddBatch}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs inline-block transition"
                      >
                        Thêm lô đầu tiên
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* Luồng cập nhật trực tiếp (Live Feed) */}
        <section className="space-y-3 pt-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Kiểm kê gần đây (Đồng bộ trực tiếp)
              </h3>
            </div>
            <span className="text-[11px] text-zinc-400" suppressHydrationWarning>
              {mounted
                ? lastSynced.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '--:--:--'}
            </span>
          </div>

          <RecentFeed
            entries={entries}
            loading={feedLoading}
            onSelectEntry={(entry) => {
              setBarcodeInput(entry.barcode);
              handleLookupBarcode(entry.barcode);
            }}
          />
        </section>
      </main>

      {/* Modals */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />

      <StaffModal
        isOpen={isStaffModalOpen}
        currentName={staffName}
        onSave={(name) => {
          setStaffName(name);
          setIsStaffModalOpen(false);
        }}
        onClose={() => setIsStaffModalOpen(false)}
        isDismissable={hasStaffName}
      />

      <EntryModal
        isOpen={isEntryModalOpen}
        onClose={() => setIsEntryModalOpen(false)}
        barcode={activeBarcode}
        productName={product?.name || ''}
        existingBatch={selectedBatchForEdit}
        staff={{ name: staffName, uid: staffUid }}
        onSuccess={handleEntrySuccess}
      />
    </div>
  );
}
