export const UNIT_OPTIONS = [
  'Cái',
  'Bộ',
  'Hộp',
  'Thùng',
  'Chai',
  'Lon',
  'Gói',
  'Túi',
  'Bịch',
  'Vỉ',
  'Lốc',
  'Cây',
  'Cuộn',
  'Khác',
];

export interface UnitAdaptiveConfig {
  label: string;
  placeholder: string;
  defaultSubUnit: string;
  subUnits: string[];
}

/**
 * Cấu hình tự động theo Đơn vị tính (ĐVT)
 */
export function getAdaptiveConfigForUnit(unitName: string): UnitAdaptiveConfig {
  const bulkUnits = ['Thùng', 'Hộp', 'Lốc', 'Vỉ', 'Cây', 'Cuộn'];
  const liquidUnits = ['Chai', 'Lon', 'Hũ', 'Ly'];
  const itemUnits = ['Cái', 'Gói', 'Bịch', 'Túi'];

  if (bulkUnits.includes(unitName)) {
    return {
      label: 'Quy cách đóng gói *',
      placeholder: 'VD: 24 (hoặc 1)',
      defaultSubUnit: 'cái',
      subUnits: ['cái', 'gói', 'lon', 'chai', 'hộp', 'vỉ', 'bộ', 'kg', 'g', 'Khác'],
    };
  }

  if (liquidUnits.includes(unitName)) {
    return {
      label: 'Thể tích / Dung tích *',
      placeholder: 'VD: 330',
      defaultSubUnit: 'ml',
      subUnits: ['ml', 'l', 'g', 'kg', 'cái', 'Khác'],
    };
  }

  if (unitName === 'Bộ') {
    return {
      label: 'Số chi tiết / món *',
      placeholder: 'VD: 1 hoặc 6',
      defaultSubUnit: 'bộ',
      subUnits: ['bộ', 'cái', 'món', 'chi tiết', 'g', 'kg', 'Khác'],
    };
  }

  if (itemUnits.includes(unitName)) {
    // Với ĐVT Cái, Gói, Bịch, Túi: người dùng yêu cầu Cái tính theo g hoặc kg (bánh kẹo, thực phẩm...)
    return {
      label: 'Trọng lượng *',
      placeholder: 'VD: 29.5 hoặc 500',
      defaultSubUnit: 'g',
      subUnits: ['g', 'kg', 'cái', 'bộ', 'ml', 'l', 'viên', 'miếng', 'Khác'],
    };
  }

  return {
    label: 'Trọng lượng / Quy cách *',
    placeholder: 'VD: 500',
    defaultSubUnit: 'g',
    subUnits: ['g', 'kg', 'cái', 'bộ', 'ml', 'l', 'Khác'],
  };
}

/**
 * Lấy nhãn hiển thị động theo đơn vị con được chọn để tránh tình trạng "Trọng lượng: 29.5 cái"
 */
export function getSpecFieldLabel(subUnit: string, parentUnit?: string): string {
  const s = (subUnit || '').toLowerCase().trim();
  if (['g', 'kg'].includes(s)) {
    return 'Trọng lượng *';
  }
  if (['ml', 'l', 'lít', 'lit'].includes(s)) {
    return 'Thể tích / Dung tích *';
  }
  if (
    ['cái', 'bộ', 'gói', 'lon', 'chai', 'vỉ', 'hộp', 'viên', 'miếng', 'cuộn', 'tờ', 'món', 'chi tiết'].includes(s)
  ) {
    const parent = (parentUnit || '').toLowerCase().trim();
    if (['thùng', 'hộp', 'lốc', 'vỉ', 'cây', 'cuộn'].includes(parent)) {
      return 'Quy cách đóng gói *';
    }
    if (parent === 'bộ') {
      return 'Số chi tiết / món *';
    }
    return 'Quy cách con *';
  }
  return 'Quy cách / Trọng lượng *';
}

/**
 * Gợi ý placeholder phù hợp
 */
export function getSpecPlaceholder(subUnit: string, parentUnit?: string): string {
  const s = (subUnit || '').toLowerCase().trim();
  if (['g', 'kg'].includes(s)) return 'VD: 29.5 hoặc 500';
  if (['ml', 'l', 'lít', 'lit'].includes(s)) return 'VD: 330 hoặc 500';
  if (['cái', 'gói', 'lon', 'chai', 'hộp', 'vỉ'].includes(s)) {
    const parent = (parentUnit || '').toLowerCase().trim();
    if (['thùng', 'hộp', 'lốc', 'vỉ', 'cây'].includes(parent)) {
      return 'VD: 24 (hoặc 1)';
    }
    return 'VD: 1 (hoặc 10)';
  }
  if (s === 'bộ') return 'VD: 1 hoặc 6';
  return 'VD: 100';
}

const KNOWN_SUB_UNITS = [
  'cái',
  'bộ',
  'gói',
  'lon',
  'chai',
  'vỉ',
  'hộp',
  'viên',
  'miếng',
  'cuộn',
  'tờ',
  'món',
  'chi tiết',
  'kg',
  'ml',
  'lít',
  'lit',
  'l',
  'm',
  'g',
];

/**
 * Tách giá trị số và đơn vị con từ chuỗi đã lưu (VD: "500g", "1.5kg", "24 cái", "330ml")
 * Tự động chuyển đổi nếu dính trường hợp lỗi "29.5 cái" -> "29.5 g"
 */
export function parseWeightOrSpec(
  raw?: string | null,
  fallbackUnit = 'g',
  parentUnit?: string
): { value: string; unit: string; customUnit: string } {
  if (!raw) return { value: '', unit: fallbackUnit, customUnit: '' };
  const trimmed = raw.trim();

  const match = trimmed.match(/^([\d.,]+)\s*(.*)$/);
  if (match) {
    const numPart = match[1];
    const unitPart = match[2].trim();
    if (unitPart) {
      const found = KNOWN_SUB_UNITS.find(
        (u) => u.toLowerCase() === unitPart.toLowerCase()
      );
      if (found) {
        // Tự động sửa trường hợp lỗi gán nhầm số lẻ thập phân cho "cái"
        // (Ví dụ Kẹo Colia: "29.5 cái" -> chuẩn hoá thành "29.5 g")
        if (
          found === 'cái' &&
          (numPart.includes('.') || numPart.includes(',')) &&
          (!parentUnit || ['Cái', 'Gói', 'Bịch', 'Túi'].includes(parentUnit))
        ) {
          return { value: numPart, unit: 'g', customUnit: '' };
        }
        return { value: numPart, unit: found, customUnit: '' };
      }
      return { value: numPart, unit: 'Khác', customUnit: unitPart };
    }
    return { value: numPart, unit: fallbackUnit, customUnit: '' };
  }

  return { value: trimmed, unit: fallbackUnit, customUnit: '' };
}

/**
 * Định dạng chuỗi lưu trữ: "500g", "1.5kg", "24 cái", "330ml"
 */
export function formatSpecDisplay(
  val: string,
  unit: string,
  customUnit?: string
): string {
  const cleanVal = val.trim();
  const cleanUnit = unit === 'Khác' ? (customUnit || '').trim() : unit.trim();
  if (!cleanUnit) return cleanVal;
  if (['g', 'kg', 'ml', 'l'].includes(cleanUnit.toLowerCase())) {
    return `${cleanVal}${cleanUnit}`;
  }
  return `${cleanVal} ${cleanUnit}`;
}

/**
 * Lấy icon biểu tượng phù hợp cho quy cách / trọng lượng
 */
export function getSpecIcon(spec?: string | null): string {
  if (!spec) return '📦';
  const lower = spec.toLowerCase().trim();
  if (lower.endsWith('g') || lower.endsWith('kg')) return '⚖️';
  if (
    lower.endsWith('ml') ||
    lower.endsWith('l') ||
    lower.endsWith('lít') ||
    lower.endsWith('lit')
  ) {
    return '🥤';
  }
  return '📦';
}

export interface BatchForAggregation {
  quantity: number;
  unit?: string | null;
  weight?: string | null;
}

export interface UnitStockSummary {
  unit: string;
  quantity: number;
}

export interface StockAggregateResult {
  totalDisplay: string;
  unitDisplay: string;
  units: string[];
  isMultiUnit: boolean;
  breakdown: UnitStockSummary[];
  conversionNote: string | null;
  totalNumeric: number;
}

const UNIT_ORDER = [
  'Thùng',
  'Cây',
  'Lốc',
  'Hộp',
  'Vỉ',
  'Bịch',
  'Túi',
  'Gói',
  'Chai',
  'Lon',
  'Ly',
  'Hũ',
  'Bộ',
  'Cái',
  'Cuộn',
];

/**
 * Gom nhóm và tính toán tổng tồn kho theo từng đơn vị tính,
 * xử lý trường hợp 1 mã hàng có nhiều đơn vị khác nhau (ví dụ: 1 Thùng + 100 Lon)
 */
export function aggregateStockByUnit(
  batches: BatchForAggregation[],
  fallbackUnit?: string | null,
  fallbackWeight?: string | null
): StockAggregateResult {
  const counts = new Map<string, number>();
  const unitSpecs = new Map<string, { value: number; subUnit: string }>();

  let totalNumeric = 0;

  for (const b of batches) {
    const rawUnit = (b.unit || fallbackUnit || '').trim();
    const u = rawUnit || 'Chưa đặt';
    const q = Number(b.quantity) || 0;
    counts.set(u, (counts.get(u) || 0) + q);
    totalNumeric += q;

    const w = (b.weight || fallbackWeight || '').trim();
    if (w && !unitSpecs.has(u)) {
      const parsed = parseWeightOrSpec(w);
      const numVal = parseFloat(parsed.value);
      if (!isNaN(numVal) && numVal > 0 && parsed.unit && parsed.unit !== 'Khác') {
        unitSpecs.set(u, { value: numVal, subUnit: parsed.unit.toLowerCase() });
      }
    }
  }

  // Sắp xếp các đơn vị theo thứ tự ưu tiên container lớn -> nhỏ
  const sortedUnits = Array.from(counts.keys()).sort((a, b) => {
    const idxA = UNIT_ORDER.indexOf(a);
    const idxB = UNIT_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b, 'vi');
  });

  const breakdown: UnitStockSummary[] = sortedUnits.map((u) => ({
    unit: u,
    quantity: counts.get(u) || 0,
  }));

  const isMultiUnit = breakdown.length > 1;

  let totalDisplay = '';
  let unitDisplay = '';

  if (breakdown.length === 0) {
    totalDisplay = '0';
    unitDisplay = fallbackUnit || 'Chưa đặt';
  } else if (breakdown.length === 1) {
    const b = breakdown[0];
    totalDisplay = `${b.quantity.toLocaleString('vi-VN')} ${b.unit}`;
    unitDisplay = b.unit;
  } else {
    // Nhiều đơn vị tính: "1 Thùng + 100 Lon"
    totalDisplay = breakdown
      .map((b) => `${b.quantity.toLocaleString('vi-VN')} ${b.unit}`)
      .join(' + ');
    unitDisplay = sortedUnits.join(', ');
  }

  // Tính toán quy đổi thông minh nếu có quy cách khớp
  let conversionNote: string | null = null;
  if (isMultiUnit) {
    for (const [parentUnit, spec] of unitSpecs.entries()) {
      const matchedUnit = sortedUnits.find(
        (u) => u.toLowerCase() === spec.subUnit.toLowerCase()
      );
      if (matchedUnit && matchedUnit !== parentUnit) {
        let totalConverted = 0;
        let canConvertAll = true;

        for (const b of breakdown) {
          if (b.unit === matchedUnit) {
            totalConverted += b.quantity;
          } else if (b.unit === parentUnit) {
            totalConverted += b.quantity * spec.value;
          } else {
            canConvertAll = false;
            break;
          }
        }

        if (canConvertAll && totalConverted > 0) {
          conversionNote = `Quy đổi: ~${totalConverted.toLocaleString('vi-VN')} ${matchedUnit}`;
          break;
        }
      }
    }
  }

  return {
    totalDisplay,
    unitDisplay,
    units: sortedUnits,
    isMultiUnit,
    breakdown,
    conversionNote,
    totalNumeric,
  };
}
