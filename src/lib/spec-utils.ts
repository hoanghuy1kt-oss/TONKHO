export const UNIT_OPTIONS = [
  'Cái',
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
  const bulkUnits = ['Thùng', 'Hộp', 'Lốc', 'Vỉ', 'Cây'];
  const liquidUnits = ['Chai', 'Lon', 'Hũ', 'Ly'];
  const itemUnits = ['Cái', 'Gói', 'Bịch', 'Túi'];

  if (bulkUnits.includes(unitName)) {
    return {
      label: 'Quy cách con *',
      placeholder: 'VD: 24',
      defaultSubUnit: 'cái',
      subUnits: ['cái', 'gói', 'lon', 'chai', 'vỉ', 'hộp', 'kg', 'g', 'Khác'],
    };
  }

  if (liquidUnits.includes(unitName)) {
    return {
      label: 'Thể tích / Khối lượng *',
      placeholder: 'VD: 330',
      defaultSubUnit: 'ml',
      subUnits: ['ml', 'l', 'g', 'kg', 'cái', 'Khác'],
    };
  }

  if (itemUnits.includes(unitName)) {
    return {
      label: 'Trọng lượng *',
      placeholder: 'VD: 500',
      defaultSubUnit: 'g',
      subUnits: ['g', 'kg', 'ml', 'l', 'viên', 'miếng', 'cái', 'Khác'],
    };
  }

  return {
    label: 'Quy cách / Định lượng *',
    placeholder: 'VD: 100',
    defaultSubUnit: 'cái',
    subUnits: ['cái', 'g', 'kg', 'm', 'ml', 'Khác'],
  };
}

const KNOWN_SUB_UNITS = [
  'cái',
  'gói',
  'lon',
  'chai',
  'vỉ',
  'hộp',
  'viên',
  'miếng',
  'cuộn',
  'tờ',
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
 */
export function parseWeightOrSpec(
  raw?: string | null,
  fallbackUnit = 'cái'
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
