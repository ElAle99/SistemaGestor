/* Progressive enhancements: reuse original navigation/actions and permission state. */
(() => {
  const app = document.getElementById('app-container');
  const main = document.querySelector('.main-content');
  if (!app || !main) return;
  main.id = 'allfix-main'; main.tabIndex = -1;
  const skip = document.createElement('a');
  skip.href = '#allfix-main'; skip.className = 'allfix-skip'; skip.textContent = 'Ir al contenido';
  app.prepend(skip);
  const collapse = document.createElement('button');
  collapse.type = 'button'; collapse.className = 'allfix-collapse';
  collapse.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
  collapse.setAttribute('aria-controls', 'app-navigation');
  function setCollapsed(value) {
    document.body.classList.toggle('sidebar-collapsed', value);
    collapse.setAttribute('aria-expanded', String(!value));
    collapse.setAttribute('aria-label', value ? 'Expandir menú' : 'Colapsar menú');
    collapse.title = collapse.getAttribute('aria-label');
  }
  try { setCollapsed(localStorage.getItem('allfix-sidebar-collapsed') === 'true'); } catch { setCollapsed(false); }
  collapse.addEventListener('click', () => {
    const value = !document.body.classList.contains('sidebar-collapsed'); setCollapsed(value);
    try { localStorage.setItem('allfix-sidebar-collapsed', String(value)); } catch { /* optional preference */ }
  });
  document.querySelector('.topbar-left').prepend(collapse);
  document.querySelectorAll('.sidebar-menu [data-view]').forEach(link => { link.title = link.textContent.trim(); });

  const network = document.createElement('div');
  network.className = 'allfix-network hidden'; network.setAttribute('role', 'status');
  network.textContent = 'Sin conexión · Revisa tu red antes de guardar'; app.append(network);
  function updateNetwork() { network.classList.toggle('hidden', navigator.onLine); }
  window.addEventListener('online', updateNetwork); window.addEventListener('offline', updateNetwork); updateNetwork();

  // Hidden views are not permission restrictions; hidden controls/groups are.
  function allowed(target) {
    if (!target || target.disabled || target.classList.contains('hidden')) return false;
    return !target.parentElement?.closest('.admin-only.hidden, .menu-group.hidden, [hidden]');
  }
  function syncPermissions() {
    document.querySelectorAll('.mobile-bottom-nav [data-mobile-view]').forEach(button => {
      button.classList.toggle('hidden', !allowed(document.querySelector(`.sidebar-menu [data-view="${button.dataset.mobileView}"]`)));
    });
    document.querySelectorAll('.sidebar-menu [data-view]').forEach(link => {
      if (link.classList.contains('active')) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }
  const observer = new MutationObserver(syncPermissions);
  document.querySelectorAll('.sidebar-menu [data-view], .btn-new-order-trigger').forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['class', 'disabled'] }));
  syncPermissions();

  // Preserve native validation, but present its message beside the offending field.
  document.addEventListener('invalid', event => {
    const field = event.target;
    if (!field.id) return;
    event.preventDefault();
    field.setAttribute('aria-invalid', 'true');
    const id = `${field.id}-validation`;
    let error = document.getElementById(id);
    if (!error) { error = document.createElement('small'); error.id = id; error.className = 'allfix-field-error'; field.after(error); }
    error.textContent = field.validationMessage;
    const described = new Set((field.getAttribute('aria-describedby') || '').split(' ').filter(Boolean)); described.add(id);
    field.setAttribute('aria-describedby', [...described].join(' '));
    // Fieldsets also match :invalid; select an actual control so the first error
    // scrolls into view even when the user submits from the bottom of a long form.
    const first = field.form?.querySelector('input:invalid, select:invalid, textarea:invalid');
    if (first === field) { field.focus(); field.scrollIntoView({ block: 'center' }); }
  }, true);
  document.addEventListener('input', event => {
    const field = event.target;
    if (!field.matches('[aria-invalid=true]') || !field.validity?.valid) return;
    field.removeAttribute('aria-invalid');
    const id = `${field.id}-validation`; document.getElementById(id)?.remove();
    field.setAttribute('aria-describedby', (field.getAttribute('aria-describedby') || '').split(' ').filter(value => value !== id).join(' '));
  });
  // Add names to legacy icon-only actions without replacing their handlers.
  const iconNames = { 'fa-eye': 'Ver detalle', 'fa-pen': 'Editar', 'fa-trash': 'Eliminar', 'fa-print': 'Imprimir', 'fa-xmark': 'Cerrar', 'fa-bell': 'Notificaciones' };
  function labelActions(root) {
    root.querySelectorAll('button:not([aria-label]), [role=button]:not([aria-label])').forEach(button => {
      if (button.textContent.trim()) return;
      const name = button.title || Object.entries(iconNames).find(([icon]) => button.querySelector(`.${icon}`))?.[1];
      if (name) { button.setAttribute('aria-label', name); button.title = name; }
    });
  }
  labelActions(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) labelActions(node.parentElement || node);
  }).observe(app, { childList: true, subtree: true });
  const bell = document.getElementById('notifications-trigger');
  bell.setAttribute('role', 'button'); bell.tabIndex = 0; bell.setAttribute('aria-label', 'Notificaciones');
  bell.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); bell.click(); } });
})();
