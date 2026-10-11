import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ConfigProvider from 'antd/es/config-provider';
import App from 'antd/es/app';
import Spin from 'antd/es/spin';
import esES from 'antd/locale/es_ES';
import { allfixTheme } from './theme';

const recent = new Map();
let api;
const pending = [];
const inferType = text => /error|no se pudo|no fue posible|falló|fallo al/i.test(text) ? 'error'
  : /insuficiente|selecciona|completa|debe|inválid|mayor|no hay|no se puede|expir/i.test(text) ? 'warning'
  : /éxito|correctamente|actualizado|eliminad|registrad|guardad|enviado|creada/i.test(text) ? 'success' : 'info';
const titles = { success: 'Listo', error: 'No se pudo completar', warning: 'Revisa este dato', info: 'Información' };
function notify(message, type = inferType(String(message))) {
  if (!api) { pending.push(() => notify(message, type)); return; }
  const text = String(message), key = `${type}:${text}`;
  if (Date.now() - (recent.get(key) || 0) < 1800) return;
  recent.set(key, Date.now());
  for (const [id, time] of recent) if (Date.now() - time > 10000) recent.delete(id);
  api.notification[type]({ key, message: titles[type], description: text, placement: 'topRight', duration: type === 'error' ? 7 : 4, role: type === 'error' ? 'alert' : 'status' });
}
let confirming;
function confirm(message) {
  if (confirming) return Promise.resolve(false);
  confirming = new Promise(resolve => {
    let accepted = false;
    const run = () => api.modal.confirm({ title: 'Confirmar acción', content: String(message),
      okText: 'Confirmar', cancelText: 'Cancelar', autoFocusButton: 'cancel', centered: true,
      okButtonProps: { danger: /eliminar|cancelar|cerrar caja|desactivar/i.test(message) },
      onOk: () => { accepted = true; }, onCancel: () => { accepted = false; },
      afterClose: () => resolve(accepted) });
    if (api) run(); else pending.push(run);
  }).finally(() => { confirming = null; });
  return confirming;
}
let requests = 0;
let refreshLoading = () => {};
function loading() {
  requests++; refreshLoading(requests);
  let finished = false;
  return () => { if (!finished) { finished = true; requests = Math.max(0, requests - 1); refreshLoading(requests); } };
}
window.AllfixUI = { notify, confirm, loading };
function FeedbackHost() {
  api = App.useApp();
  const [count, setCount] = React.useState(requests);
  React.useLayoutEffect(() => { refreshLoading = setCount; return () => { refreshLoading = () => {}; }; }, []);
  React.useEffect(() => { pending.splice(0).forEach(action => action()); }, []);
  return count > 0 ? <div className="allfix-load-status" role="status" aria-live="polite"><div className="allfix-loading" /><Spin size="small" /> Actualizando…</div> : null;
}
const host = document.createElement('div');
host.id = 'allfix-feedback';
document.body.append(host);
flushSync(() => createRoot(host).render(<ConfigProvider theme={allfixTheme} locale={esES}>
  <App notification={{ maxCount: 3 }}><FeedbackHost /></App>
</ConfigProvider>));
window.addEventListener('offline', () => notify('Sin conexión. Revisa tu red antes de guardar.', 'warning'));
window.addEventListener('online', () => notify('Conexión restablecida.', 'success'));
