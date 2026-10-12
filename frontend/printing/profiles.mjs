export function paperProfile(paperWidth = '58mm') {
  return { paperWidth, dots: paperWidth === '80mm' ? 576 : 384, printableMm: paperWidth === '80mm' ? 72 : 48,
    columns: paperWidth === '80mm' ? 48 : 32, dpi: 203, codepage: 'cp850', feedLines: 4 };
}
export function compatibilityMapping(profile, name = '') {
  if (profile !== 'auto') return { generic: 'epson', 'pos-5890': 'pos-5890', xprinter: 'xprinter', mpt: 'mpt' }[profile] || 'epson';
  return /(?:pos|zj)[\s-]*5890/i.test(name) ? 'pos-5890' : 'epson';
}
