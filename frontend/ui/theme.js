// Ant Design consumes the global CSS tokens; fallbacks support isolated fixtures.
const styles = getComputedStyle(document.documentElement);
const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
export const allfixTheme = { token: {
  colorPrimary: token('--accent-blue', '#2563eb'), colorSuccess: token('--color-success', '#15803d'), colorWarning: token('--color-warning', '#b45309'),
  colorError: token('--color-danger', '#dc2626'), colorInfo: token('--accent-blue', '#2563eb'), colorText: token('--text-main', '#17243b'),
  colorBorder: token('--border-color', '#dce3ed'), borderRadius: 10, controlHeight: 44,
  fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14,
  zIndexPopupBase: 12000
} };
