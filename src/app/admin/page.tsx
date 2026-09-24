'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { InventoryEntry, InventoryHistory, StockSummaryItem } from '@/types/inventory';
import { exportInventoryToExcel } from '@/lib/excel-export';
import { getPhotoUrl } from '@/lib/photo-url';
import { getSpecIcon, aggregateStockByUnit } from '@/lib/spec-utils';

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<StockSummaryItem[]>([]);
  const [entries, setEntries] = useState<InventoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'entries'>('summary');

  // Modal Chi tiết sản phẩm
  const [selectedProductDetail, setSelectedProductDetail] = useState<StockSummaryItem | null>(null);

  // Lịch sử thay đổi modal
  const [selectedEntryHistory, setSelectedEntryHistory] = useState<{
    entry: InventoryEntry;
    history: InventoryHistory[];
  } | null>(null);
  const [, setHistoryLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sumRes, entRes] = await Promise.all([
        fetch('/api/admin/summary'),
        fetch('/api/entries?all=true'),
      ]);

      if (sumRes.ok) {
        const sumData = await sumRes.json();
        setSummaries(sumData.summary || []);
      }

      if (entRes.ok) {
        const entData = await entRes.json();
        setEntries(entData.entries || []);
      }
    } catch (err) {
      console.error('Error loading admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    if (entries.length === 0) {
      alert('Chưa có dữ liệu kiểm kho để xuất file.');
      return;
    }
    await exportInventoryToExcel(entries);
  };

  const viewHistory = async (entry: InventoryEntry) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/entries/${entry.id}/history`);
      if (res.ok) {
        const data = await res.json();
        setSelectedEntryHistory({ entry, history: data.history || [] });
      }
    } catch (err) {
      console.error('Error loading history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteProduct = async (barcode: string, name: string) => {
    if (
      !confirm(
        `Bạn có chắc chắn muốn XÓA sản phẩm "${name}" (Mã: ${barcode})?\nTất cả các lô kiểm kê liên quan cũng sẽ bị xóa!`
      )
    ) {
      return;
    }
    setDeletingId(barcode);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(barcode)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Lỗi khi xóa sản phẩm');
      }
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Lỗi xóa sản phẩm');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteEntry = async (entry: InventoryEntry) => {
    if (
      !confirm(
        `Bạn có chắc chắn muốn XÓA lô này?\n- Sản phẩm: ${entry.product_name}\n- HSD: ${entry.expiry_date}\n- SL: ${entry.quantity}`
      )
    ) {
      return;
    }
    setDeletingId(entry.id);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rev: entry.rev, staff: { name: 'Admin', uid: 'admin' } }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Lỗi khi xóa lô kiểm kê');
      }
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Lỗi xóa lô kiểm kê');
    } finally {
      setDeletingId(null);
    }
  };

  const [clearingAll, setClearingAll] = useState(false);

  const handleClearAllData = async () => {
    const confirmation = prompt(
      'CẢNH BÁO NGUY HIỂM:\nHành động này sẽ XÓA TOÀN BỘ dữ liệu gồm tất cả sản phẩm, lô hàng và ảnh kiểm kho.\n\nNhập chữ "XOA" vào ô bên dưới để xác nhận:'
    );
    if (confirmation !== 'XOA') {
      if (confirmation !== null) alert('Mã xác nhận không đúng. Đã hủy thao tác.');
      return;
    }

    setClearingAll(true);
    try {
      const res = await fetch('/api/admin/clear-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi khi xóa dữ liệu');
      alert('Đã xóa sạch toàn bộ dữ liệu thành công!');
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi xóa dữ liệu');
    } finally {
      setClearingAll(false);
    }
  };

  const totalQuantityOverall = summaries.reduce((s, item) => s + (item.total_quantity || 0), 0);
  const totalBatchesOverall = summaries.reduce((s, item) => s + (item.batch_count || 0), 0);

  const filteredEntries = entries.filter((e) => {
    const q = search.toLowerCase();
    return (
      e.product_name.toLowerCase().includes(q) ||
      e.barcode.toLowerCase().includes(q) ||
      e.created_by_name.toLowerCase().includes(q) ||
      (e.unit && e.unit.toLowerCase().includes(q)) ||
      (e.weight && e.weight.toLowerCase().includes(q)) ||
      (e.flavor && e.flavor.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2 sm:py-0 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/"
              className="px-2.5 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs sm:text-sm font-bold transition shrink-0 flex items-center gap-1"
            >
              <span>←</span>
              <span>Kiểm kho</span>
            </Link>
            <div className="min-w-0">
              <h1 className="text-xs sm:text-base font-extrabold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
                Quản trị Kho
              </h1>
              <span className="text-[10px] sm:text-xs text-emerald-600 dark:text-emerald-400 font-semibold block">
                TONKHO Firebase
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={clearingAll}
              onClick={handleClearAllData}
              className="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900 text-xs font-bold flex items-center gap-1 transition disabled:opacity-50"
              title="Xóa toàn bộ sản phẩm và lô hàng"
            >
              <span>🗑️</span>
              <span className="hidden sm:inline">Reset kho</span>
              <span className="sm:hidden">Reset</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs flex items-center gap-1 transition"
            >
              <span>📥</span>
              <span className="hidden sm:inline">Xuất Excel (.xlsx)</span>
              <span className="sm:hidden">Excel</span>
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* KPI Cards (3 cột cân đối trên cả điện thoại) */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="p-3 sm:p-4 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-center sm:text-left">
            <span className="text-[10px] sm:text-xs font-semibold text-zinc-400 sm:text-zinc-500 uppercase tracking-wider block">
              Mặt hàng
            </span>
            <div className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-zinc-100 mt-0.5">
              {summaries.length}
            </div>
          </div>
          <div className="p-3 sm:p-4 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-center sm:text-left">
            <span className="text-[10px] sm:text-xs font-semibold text-zinc-400 sm:text-zinc-500 uppercase tracking-wider block">
              Số lô kiểm
            </span>
            <div className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-zinc-100 mt-0.5">
              {totalBatchesOverall}
            </div>
          </div>
          <div className="p-3 sm:p-4 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-center sm:text-left">
            <span className="text-[10px] sm:text-xs font-semibold text-zinc-400 sm:text-zinc-500 uppercase tracking-wider block">
              Tổng tồn
            </span>
            <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
              {totalQuantityOverall.toLocaleString('vi-VN')}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2.5 gap-2.5">
          <div className="flex p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-2xl w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab('summary')}
              className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold transition text-center ${
                activeTab === 'summary'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              Theo Mặt hàng ({summaries.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('entries')}
              className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold transition text-center ${
                activeTab === 'entries'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              Tất cả các Lô ({entries.length})
            </button>
          </div>

          {activeTab === 'entries' && (
            <input
              type="text"
              placeholder="🔍 Tìm tên, mã vạch, ĐVT, mùi..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-72 px-3.5 py-2.5 sm:py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-base sm:text-xs focus:ring-2 focus:ring-emerald-500"
            />
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="py-12 text-center text-zinc-400 text-sm">
            Đang tải dữ liệu tổng hợp kho...
          </div>
        )}

        {/* Tab 1: Summary Table / Mobile Cards */}
        {!loading && activeTab === 'summary' && (
          <div className="space-y-3">
            {/* Mobile Cards View (sm:hidden) */}
            <div className="block sm:hidden space-y-2.5">
              {summaries.map((item) => (
                <div
                  key={item.barcode}
                  className="p-3.5 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        {item.name}
                      </h4>
                      <span className="text-[11px] font-mono text-zinc-400 block mt-0.5">
                        Mã: {item.barcode}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] text-zinc-400 block font-semibold">TỔNG TỒN</span>
                      <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                        {item.total_display || `${item.total_quantity.toLocaleString('vi-VN')} ${item.unit || ''}`}
                      </span>
                      {item.conversion_note && (
                        <span className="text-[10px] text-zinc-400 font-normal block mt-0.5">
                          {item.conversion_note}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Attribute badges */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {(item.unit_display || item.unit) && (
                      <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1">
                        <span>ĐVT: {item.unit_display || item.unit}</span>
                        {item.is_multi_unit && (
                          <span className="px-1.5 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[9px] font-bold">
                            Nhiều ĐVT
                          </span>
                        )}
                      </span>
                    )}
                    {item.weight && (
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-[11px] font-medium">
                        {getSpecIcon(item.weight)} {item.weight}
                      </span>
                    )}
                    {item.flavor && (
                      <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[11px] font-medium">
                        🌿 {item.flavor}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[11px] font-medium ml-auto">
                      {item.batch_count} lô
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1.5 border-t border-zinc-100 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setSelectedProductDetail(item)}
                      className="flex-1 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-xs transition flex items-center justify-center gap-1"
                    >
                      👁️ Chi tiết ({item.batch_count} lô)
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === item.barcode}
                      onClick={() => handleDeleteProduct(item.barcode, item.name)}
                      className="py-2 px-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-xs transition disabled:opacity-50"
                    >
                      {deletingId === item.barcode ? '...' : '🗑️ Xóa'}
                    </button>
                  </div>
                </div>
              ))}
              {summaries.length === 0 && (
                <div className="py-12 text-center text-zinc-400 text-sm bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                  Chưa có dữ liệu sản phẩm
                </div>
              )}
            </div>

            {/* Desktop Table View (hidden sm:block) */}
            <div className="hidden sm:block bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
                    <tr>
                      <th className="py-3 px-4">Mã vạch</th>
                      <th className="py-3 px-4">Tên sản phẩm</th>
                      <th className="py-3 px-3 text-center">ĐVT</th>
                      <th className="py-3 px-3 text-center">Quy cách / Trọng lượng</th>
                      <th className="py-3 px-3">Hương vị / Mùi</th>
                      <th className="py-3 px-4 text-center">Số lô</th>
                      <th className="py-3 px-4 text-right">Tổng số lượng</th>
                      <th className="py-3 px-4 text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                    {summaries.map((item) => (
                      <tr key={item.barcode} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                        <td className="py-3 px-4 font-mono font-medium">{item.barcode}</td>
                        <td className="py-3 px-4 font-semibold text-zinc-900 dark:text-zinc-100">
                          {item.name}
                        </td>
                        <td className="py-3 px-3 text-center text-zinc-600 dark:text-zinc-300">
                          {item.unit_display || item.unit ? (
                            <div className="inline-flex items-center gap-1">
                              <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 font-medium">
                                {item.unit_display || item.unit}
                              </span>
                              {item.is_multi_unit && (
                                <span className="px-1.5 py-0.2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                                  Nhiều ĐVT
                                </span>
                              )}
                            </div>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-3 px-3 text-center text-zinc-600 dark:text-zinc-300 font-mono">
                          {item.weight || '-'}
                        </td>
                        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-300">
                          {item.flavor || '-'}
                        </td>
                        <td className="py-3 px-4 text-center text-zinc-500">{item.batch_count}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="font-bold text-emerald-600 dark:text-emerald-400">
                            {item.total_display || `${item.total_quantity.toLocaleString('vi-VN')} ${item.unit || ''}`}
                          </div>
                          {item.conversion_note && (
                            <div className="text-[10px] text-zinc-400 font-normal">
                              {item.conversion_note}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedProductDetail(item)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-xs font-semibold transition flex items-center gap-1"
                            >
                              👁️ Chi tiết
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === item.barcode}
                              onClick={() => handleDeleteProduct(item.barcode, item.name)}
                              className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 text-xs font-semibold transition disabled:opacity-50"
                            >
                              {deletingId === item.barcode ? 'Đang xóa...' : '🗑️ Xóa'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {summaries.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-zinc-400">
                          Chưa có dữ liệu sản phẩm
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: All Entries Table / Mobile Cards */}
        {!loading && activeTab === 'entries' && (
          <div className="space-y-3">
            {/* Mobile Cards View (sm:hidden) */}
            <div className="block sm:hidden space-y-2.5">
              {filteredEntries.map((row) => {
                const photo = getPhotoUrl(row.photo_key);
                return (
                  <div
                    key={row.id}
                    className="p-3.5 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-2.5"
                  >
                    <div className="flex gap-3 items-start">
                      {/* Ảnh */}
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0 border border-zinc-200 dark:border-zinc-700">
                        {photo ? (
                          <a href={photo} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo} alt="" className="w-full h-full object-cover" />
                          </a>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-400">📷</div>
                        )}
                      </div>

                      {/* Thông tin */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {row.product_name}
                          </h4>
                          <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 shrink-0">
                            SL: {row.quantity} {row.unit || ''}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 mt-0.5">Mã: {row.barcode}</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                          HSD: <strong className="text-zinc-700 dark:text-zinc-200">{row.expiry_date}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Attribute badges */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {row.unit && (
                        <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[10px] font-medium">
                          ĐVT: {row.unit}
                        </span>
                      )}
                      {row.weight && (
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-[10px] font-medium">
                          {getSpecIcon(row.weight)} {row.weight}
                        </span>
                      )}
                      {row.flavor && (
                        <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[10px] font-medium">
                          🌿 {row.flavor}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-400 ml-auto">
                        {row.created_by_name} • {new Date(row.updated_at).toLocaleDateString('vi-VN')}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1.5 border-t border-zinc-100 dark:border-zinc-800">
                      <button
                        type="button"
                        onClick={() => viewHistory(row)}
                        className="flex-1 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs transition text-center"
                      >
                        Xem vết (v{row.rev})
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === row.id}
                        onClick={() => handleDeleteEntry(row)}
                        className="py-1.5 px-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-xs transition disabled:opacity-50"
                      >
                        {deletingId === row.id ? '...' : '🗑️ Xóa'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredEntries.length === 0 && (
                <div className="py-12 text-center text-zinc-400 text-sm bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                  Không tìm thấy dữ liệu phù hợp
                </div>
              )}
            </div>

            {/* Desktop Table View (hidden sm:block) */}
            <div className="hidden sm:block bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
                    <tr>
                      <th className="py-3 px-3">Ảnh</th>
                      <th className="py-3 px-4">Sản phẩm / Mã vạch</th>
                      <th className="py-3 px-3 text-center">HSD</th>
                      <th className="py-3 px-3 text-center">SL</th>
                      <th className="py-3 px-4">Người nhập / Cập nhật</th>
                      <th className="py-3 px-3 text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                    {filteredEntries.map((row) => {
                      const photo = getPhotoUrl(row.photo_key);
                      return (
                        <tr key={row.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                          <td className="py-2.5 px-3">
                            {photo ? (
                              <a
                                href={photo}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block w-10 h-10 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 border"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={photo}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src =
                                      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23f4f4f5"/><text x="50" y="55" font-size="28" text-anchor="middle" dominant-baseline="middle">📦</text></svg>';
                                  }}
                                />
                              </a>
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs text-zinc-400">
                                📷
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {row.product_name}
                            </div>
                            <div className="text-[11px] text-zinc-400 font-mono flex items-center flex-wrap gap-1.5 mt-0.5">
                              <span>{row.barcode}</span>
                              {row.weight && (
                                <span className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 rounded text-[10px] font-medium font-sans">
                                  {getSpecIcon(row.weight)} {row.weight}
                                </span>
                              )}
                              {row.flavor && (
                                <span className="px-1.5 py-0.5 bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 rounded text-[10px] font-medium font-sans">
                                  🌿 {row.flavor}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium">{row.expiry_date}</td>
                          <td className="py-2.5 px-3 text-center font-bold text-emerald-600">
                            {row.quantity} {row.unit || ''}
                          </td>
                          <td className="py-2.5 px-4">
                            <div>{row.created_by_name}</div>
                            <div className="text-[11px] text-zinc-400">
                              {new Date(row.updated_at).toLocaleString('vi-VN')}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => viewHistory(row)}
                                className="px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] font-semibold transition"
                              >
                                Xem vết (v{row.rev})
                              </button>
                              <button
                                type="button"
                                disabled={deletingId === row.id}
                                onClick={() => handleDeleteEntry(row)}
                                className="px-2 py-1 rounded-md bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 text-[11px] font-semibold transition disabled:opacity-50"
                                title="Xóa lô này"
                              >
                                {deletingId === row.id ? '...' : '🗑️ Xóa'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredEntries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-zinc-400">
                          Không tìm thấy dữ liệu phù hợp
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal xem Lịch sử thay đổi (Audit trail) */}
      {selectedEntryHistory && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-t-[28px] sm:rounded-3xl p-5 sm:p-6 shadow-2xl border-t sm:border border-zinc-200 dark:border-zinc-800 max-h-[90dvh] sm:max-h-[85vh] flex flex-col pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {/* Mobile drag handle */}
            <div className="sm:hidden w-10 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mb-3 shrink-0" />

            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <div className="min-w-0 pr-2">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">Lịch sử kiểm kê lô</h3>
                <p className="text-xs text-zinc-500 truncate">{selectedEntryHistory.entry.product_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntryHistory(null)}
                className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3 overscroll-contain">
              {selectedEntryHistory.history.map((h) => {
                const dateStr = new Date(h.edited_at).toLocaleString('vi-VN');
                return (
                  <div
                    key={h.id}
                    className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded-md ${
                          h.change_type === 'create'
                            ? 'bg-emerald-100 text-emerald-700'
                            : h.change_type === 'delete'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {h.change_type === 'create'
                          ? 'Tạo mới'
                          : h.change_type === 'delete'
                          ? 'Xóa'
                          : 'Chỉnh sửa'} (v{h.rev})
                      </span>
                      <span className="text-zinc-400 text-[11px]">{dateStr}</span>
                    </div>

                    <div className="text-zinc-600 dark:text-zinc-300">
                      Người thực hiện: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{h.edited_by_name}</span>
                    </div>

                    {h.change_type === 'update' && (
                      <div className="text-zinc-500">
                        <div>
                          Số lượng: <span className="line-through">{h.prev_quantity}</span> →{' '}
                          <span className="font-bold text-emerald-600">{h.new_quantity}</span>
                        </div>
                        {h.prev_expiry_date !== h.new_expiry_date && (
                          <div>
                            HSD: <span className="line-through">{h.prev_expiry_date}</span> →{' '}
                            <span className="font-bold text-emerald-600">{h.new_expiry_date}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {h.change_type === 'create' && (
                      <div className="text-zinc-500">
                        Số lượng khởi tạo: <span className="font-bold text-emerald-600">{h.new_quantity}</span> | HSD: {h.new_expiry_date}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal Chi tiết sản phẩm */}
      {selectedProductDetail && (() => {
        const productSummary =
          summaries.find((s) => s.barcode === selectedProductDetail.barcode) || selectedProductDetail;
        const productBatches = entries.filter((e) => e.barcode === selectedProductDetail.barcode);
        const batchAgg = aggregateStockByUnit(productBatches, productSummary.unit, productSummary.weight);

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-xs">
            <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-t-[28px] sm:rounded-3xl p-4 sm:p-6 shadow-2xl border-t sm:border border-zinc-200 dark:border-zinc-800 max-h-[92dvh] sm:max-h-[85vh] flex flex-col pb-[max(1rem,env(safe-area-inset-bottom))]">
              {/* Mobile drag handle */}
              <div className="sm:hidden w-10 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mb-3 shrink-0" />

              {/* Header */}
              <div className="flex items-start justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
                <div className="min-w-0 pr-2">
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Chi tiết sản phẩm
                  </h3>
                  <div className="flex items-center flex-wrap gap-2 mt-1">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-sm truncate max-w-[200px] sm:max-w-none">
                      {productSummary.name}
                    </span>
                    <span className="text-xs text-zinc-400 font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md">
                      Mã: {productSummary.barcode}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProductDetail(null)}
                  className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition shrink-0"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable Content Area */}
              <div className="flex-1 overflow-y-auto overscroll-contain py-3 space-y-3.5">
                {/* Stats overview */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  <div className="p-2.5 sm:p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 text-center">
                    <span className="text-[10px] sm:text-[11px] text-zinc-400">Tổng tồn kho</span>
                    <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 break-words leading-tight mt-0.5">
                      {batchAgg.totalDisplay}
                    </div>
                    {batchAgg.conversionNote && (
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-normal block mt-1">
                        {batchAgg.conversionNote}
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 sm:p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 text-center">
                    <span className="text-[10px] sm:text-[11px] text-zinc-400">Số lượng lô</span>
                    <div className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
                      {productBatches.length} lô
                    </div>
                  </div>
                  <div className="p-2.5 sm:p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-[10px] sm:text-[11px] text-zinc-400">Đơn vị tính</span>
                      {batchAgg.isMultiUnit && (
                        <span className="px-1.5 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[9px] font-bold">
                          {batchAgg.units.length} ĐVT
                        </span>
                      )}
                    </div>
                    <div className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate mt-0.5" title={batchAgg.unitDisplay}>
                      {batchAgg.unitDisplay || 'Chưa đặt'}
                    </div>
                  </div>
                  <div className="p-2.5 sm:p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 text-center">
                    <span className="text-[10px] sm:text-[11px] text-zinc-400">Quy cách / Trọng lượng</span>
                    <div className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate mt-0.5" title={productSummary.weight || 'Chưa đặt'}>
                      {productSummary.weight || 'Chưa đặt'}
                    </div>
                  </div>
                </div>

                {batchAgg.isMultiUnit && (
                  <div className="px-3.5 py-2.5 bg-amber-50/90 dark:bg-amber-950/40 rounded-xl border border-amber-200/70 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <span className="text-base shrink-0">ℹ️</span>
                    <span>
                      Sản phẩm này có <strong>{batchAgg.units.length} đơn vị tính khác nhau</strong> ({batchAgg.unitDisplay}). Tổng tồn được phân tách chính xác: <strong>{batchAgg.totalDisplay}</strong> để tránh cộng gộp sai lệch số lượng.
                    </span>
                  </div>
                )}

                {productSummary.flavor && (
                  <div className="px-3.5 py-2 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-100 dark:border-purple-900 text-xs text-purple-700 dark:text-purple-300 flex items-center gap-2">
                    <span>🌿</span>
                    <span>Hương vị / Mùi: <strong>{productSummary.flavor}</strong></span>
                  </div>
                )}

                {/* Batches section */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                      Danh sách các lô kiểm kê ({productBatches.length})
                    </h4>
                  </div>

                  {productBatches.length === 0 ? (
                    <div className="py-8 text-center text-zinc-400 text-xs bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
                      Sản phẩm này hiện chưa có lô kiểm kê nào hoặc tất cả các lô đã bị xóa.
                    </div>
                  ) : (
                    <>
                      {/* Mobile Card View (sm:hidden) */}
                      <div className="sm:hidden space-y-2">
                        {productBatches.map((batch) => {
                          const photo = getPhotoUrl(batch.photo_key);
                          return (
                            <div
                              key={batch.id}
                              className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 flex items-center gap-3"
                            >
                              <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0 border border-zinc-200 dark:border-zinc-700">
                                {photo ? (
                                  <a href={photo} target="_blank" rel="noopener noreferrer">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={photo}
                                      alt=""
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        e.currentTarget.onerror = null;
                                        e.currentTarget.src =
                                          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23f4f4f5"/><text x="50" y="55" font-size="24" text-anchor="middle" dominant-baseline="middle">📦</text></svg>';
                                      }}
                                    />
                                  </a>
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400">
                                    📷
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                                    SL: {batch.quantity} {batch.unit || ''}
                                  </span>
                                  <span className="text-[11px] text-zinc-500 font-medium">
                                    HSD: {batch.expiry_date}
                                  </span>
                                </div>
                                <div className="text-[10px] text-zinc-400 mt-0.5 truncate">
                                  {batch.created_by_name} • {new Date(batch.updated_at).toLocaleDateString('vi-VN')}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <button
                                    type="button"
                                    onClick={() => viewHistory(batch)}
                                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-[10px] font-bold border border-zinc-200 dark:border-zinc-600 shadow-2xs"
                                  >
                                    Vết (v{batch.rev})
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deletingId === batch.id}
                                    onClick={() => handleDeleteEntry(batch)}
                                    className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-[10px] font-bold border border-rose-200 dark:border-rose-900/60 disabled:opacity-50"
                                  >
                                    {deletingId === batch.id ? '...' : '🗑️ Xóa'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Table View (hidden sm:block) */}
                      <div className="hidden sm:block border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-zinc-500 font-semibold border-b border-zinc-200 dark:border-zinc-800">
                            <tr>
                              <th className="py-2.5 px-3">Ảnh</th>
                              <th className="py-2.5 px-3 text-center">HSD</th>
                              <th className="py-2.5 px-3 text-center">Số lượng</th>
                              <th className="py-2.5 px-3">Người nhập</th>
                              <th className="py-2.5 px-3 text-center">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {productBatches.map((batch) => {
                              const photo = getPhotoUrl(batch.photo_key);
                              return (
                                <tr key={batch.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                                  <td className="py-2 px-3">
                                    {photo ? (
                                      <a
                                        href={photo}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block w-8 h-8 rounded-md overflow-hidden bg-zinc-100 dark:bg-zinc-800 border"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={photo}
                                          alt=""
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            e.currentTarget.onerror = null;
                                            e.currentTarget.src =
                                              'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23f4f4f5"/><text x="50" y="55" font-size="28" text-anchor="middle" dominant-baseline="middle">📦</text></svg>';
                                          }}
                                        />
                                      </a>
                                    ) : (
                                      <div className="w-8 h-8 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400">
                                        📷
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-center font-medium">{batch.expiry_date}</td>
                                  <td className="py-2 px-3 text-center font-bold text-emerald-600">
                                    {batch.quantity} {batch.unit || ''}
                                  </td>
                                  <td className="py-2 px-3">
                                    <div>{batch.created_by_name}</div>
                                    <div className="text-[10px] text-zinc-400">
                                      {new Date(batch.updated_at).toLocaleString('vi-VN')}
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => viewHistory(batch)}
                                        className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[10px] font-semibold transition"
                                      >
                                        Vết (v{batch.rev})
                                      </button>
                                      <button
                                        type="button"
                                        disabled={deletingId === batch.id}
                                        onClick={() => handleDeleteEntry(batch)}
                                        className="px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 text-[10px] font-semibold transition disabled:opacity-50"
                                        title="Xóa lô này"
                                      >
                                        {deletingId === batch.id ? '...' : '🗑️'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="pt-3 mt-1 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSearch(selectedProductDetail.barcode);
                    setActiveTab('entries');
                    setSelectedProductDetail(null);
                  }}
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
                >
                  🔍 Xem tất cả các lô này trên tab Lô →
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProductDetail(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
