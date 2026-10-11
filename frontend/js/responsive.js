/* Touch layouts are isolated from the desktop UI and use the existing actions. */
(() => {
    const compact = matchMedia('(max-width: 1024px), (max-width: 1366px) and (pointer: coarse)');
    const phone = matchMedia('(max-width: 640px)');
    const app = document.getElementById('app-container');
    const sidebar = document.getElementById('app-navigation');
    const main = document.querySelector('.main-content');
    const toggle = document.getElementById('mobile-menu-toggle');
    const shade = document.createElement('button');
    shade.type = 'button';
    shade.className = 'mobile-menu-backdrop mobile-only';
    shade.tabIndex = -1;
    shade.setAttribute('aria-label', 'Cerrar menú');
    app.append(shade);

    const nav = document.createElement('nav');
    nav.className = 'mobile-bottom-nav mobile-only';
    nav.setAttribute('aria-label', 'Accesos rápidos');
    nav.innerHTML = `
        <button type="button" data-mobile-view="dashboard"><i class="fa-solid fa-house" aria-hidden="true"></i><span>Inicio</span></button>
        <button type="button" data-mobile-view="ordenes"><i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i><span>Órdenes</span></button>
        <button type="button" class="mobile-create-order"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>Nueva orden</span></button>
        <button type="button" data-mobile-view="clientes"><i class="fa-solid fa-user-group" aria-hidden="true"></i><span>Clientes</span></button>`;
    app.append(nav);
    let menuReturnFocus;
    function setMenu(open) {
        open = Boolean(open && compact.matches && !app.classList.contains('hidden'));
        if (open) menuReturnFocus = document.activeElement;
        document.body.classList.toggle('mobile-menu-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        sidebar.inert = compact.matches && !open;
        main.inert = open;
        nav.inert = open;
        if (open) document.getElementById('mobile-menu-close').focus();
        else if (compact.matches && menuReturnFocus?.isConnected) {
            menuReturnFocus.focus({ preventScroll: true });
            menuReturnFocus = null;
        }
    }
    toggle.addEventListener('click', () => setMenu(true));
    document.getElementById('mobile-menu-close').addEventListener('click', () => setMenu(false));
    shade.addEventListener('click', () => setMenu(false));
    sidebar.addEventListener('click', event => {
        if (event.target.closest('a[data-view], #btn-logout, #btn-open-profile-modal')) setMenu(false);
    });
    nav.addEventListener('click', event => {
        const button = event.target.closest('[data-mobile-view]');
        if (button) {
            document.querySelector(`.sidebar-menu [data-view="${button.dataset.mobileView}"]`)?.click();
            window.scrollTo({ top: 0 });
        }
        if (event.target.closest('.mobile-create-order')) {
            const trigger = document.querySelector('.btn-new-order-trigger:not(.hidden)');
            trigger?.click();
        }
    });

    // Keep the original save/validation flow, with its controls within thumb reach.
    const order = document.getElementById('order-modal');
    const footer = document.createElement('div');
    footer.className = 'mobile-order-footer mobile-only';
    footer.innerHTML = '<span class="mobile-step-caption" aria-live="polite"></span><div class="mobile-order-buttons"></div>';
    order.querySelector('.new-order-dialog').append(footer);
    const controls = ['btn-order-prev', 'btn-order-next', 'btn-save-order'].map(id => {
        const original = document.getElementById(id);
        const button = document.createElement('button');
        button.type = 'button';
        button.addEventListener('click', () => original.click());
        footer.lastElementChild.append(button);
        return { original, button };
    });
    function syncOrder() {
        for (const { original, button } of controls) {
            button.className = original.className;
            button.textContent = original.textContent;
            button.disabled = original.disabled;
        }
        const step = document.querySelector('.new-order-stepper-item.active');
        footer.firstElementChild.textContent = `Paso ${step?.dataset.wizardStep || 1} de 5 · ${step?.lastElementChild.textContent || 'Cliente'}`;
        order.querySelectorAll('[data-wizard-step]').forEach(button => {
            if (button === step) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
        });
    }
    const orderObserver = new MutationObserver(syncOrder);
    controls.forEach(({ original }) => orderObserver.observe(original, { attributes: true, childList: true, subtree: true }));
    syncOrder();

    // Labels follow the real headers, including tables that are rerendered after a search.
    function labelTables() {
        document.querySelectorAll('.view-section .table-responsive table, .view-section .financial-table-wrap table').forEach(table => {
            const headers = [...table.querySelectorAll('thead tr:last-child th')].map(th => th.textContent.trim());
            if (!headers.length) return;
            if (!table.classList.contains('mobile-record-table')) table.classList.add('mobile-record-table');
            table.querySelectorAll('tbody tr').forEach(row => {
                [...row.children].forEach((cell, index) => {
                    const label = cell.colSpan > 1 ? '' : headers[index] || '';
                    if (cell.dataset.label !== label) cell.dataset.label = label;
                });
            });
        });
    }
    let queued = false;
    function updateContent() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            labelTables();
            nav.querySelector('.mobile-create-order').classList.toggle('hidden', !document.querySelector('.btn-new-order-trigger:not(.hidden)'));
            nav.querySelectorAll('[data-mobile-view]').forEach(button => {
                const active = !document.getElementById(`view-${button.dataset.mobileView}`).classList.contains('hidden');
                button.classList.toggle('active', active);
                if (active) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            });
        });
    }
    new MutationObserver(updateContent).observe(document.querySelector('.view-container'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    updateContent();

    // Constrain focus to open mobile dialogs; restore it when they close.
    let activeDialog = null;
    let dialogReturnFocus = null;
    function syncDialogs() {
        const dialogs = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
        const next = compact.matches ? dialogs.at(-1) || null : null;
        if (next === activeDialog) return;
        if (next) {
            if (!activeDialog) dialogReturnFocus = document.activeElement;
            setMenu(false);
            activeDialog = next;
            next.setAttribute('role', 'dialog');
            next.setAttribute('aria-modal', 'true');
            const heading = next.querySelector('h3, h2, h4');
            if (heading) next.setAttribute('aria-label', heading.textContent);
            const close = next.querySelector('[aria-label="Cerrar"], .btn-close-modal');
            if (close) {
                if (!close.getAttribute('aria-label')) close.setAttribute('aria-label', 'Cerrar');
                close.focus({ preventScroll: true });
            }
        } else {
            activeDialog?.removeAttribute('aria-modal');
            activeDialog = null;
        }
        app.inert = Boolean(next);
        if (!next && compact.matches && dialogReturnFocus?.isConnected) {
            dialogReturnFocus.focus({ preventScroll: true });
            dialogReturnFocus = null;
        }
    }
    const modalObserver = new MutationObserver(syncDialogs);
    document.querySelectorAll('.modal-overlay').forEach(modal => modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] }));
    document.addEventListener('keydown', event => {
        if (!compact.matches || document.querySelector('.ant-modal-wrap:not([style*="display: none"])')) return;
        const menuOpen = document.body.classList.contains('mobile-menu-open');
        const clientHistory = document.getElementById('client-detail-panel');
        const container = menuOpen ? sidebar : activeDialog || (!clientHistory.classList.contains('hidden') ? clientHistory : null);
        if (!container) return;
        if (event.key === 'Escape' && menuOpen) { event.preventDefault(); setMenu(false); }
        if (event.key !== 'Tab') return;
        const focusable = [...container.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
            .filter(el => !el.disabled && el.getClientRects().length && !el.closest('[inert]'));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
            event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
            event.preventDefault(); first?.focus();
        }
    });

    function adaptCalendar() {
        if (typeof calendarInstance === 'undefined' || !calendarInstance) return;
        calendarInstance.setOption('headerToolbar', {
            left: 'prev,next today', center: 'title',
            right: phone.matches ? 'listWeek,dayGridMonth' : 'dayGridMonth,timeGridWeek,timeGridDay'
        });
        const desired = phone.matches ? 'listWeek' : 'dayGridMonth';
        if (calendarInstance.view.type !== desired) calendarInstance.changeView(desired);
        calendarInstance.updateSize();
    }
    phone.addEventListener('change', adaptCalendar);
    function syncViewport() {
        if (compact.matches) document.documentElement.style.setProperty('--mobile-viewport-height', `${window.visualViewport?.height || window.innerHeight}px`);
        else document.documentElement.style.removeProperty('--mobile-viewport-height');
    }
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.addEventListener('resize', syncViewport);
    syncViewport();
    compact.addEventListener('change', () => { setMenu(false); syncDialogs(); });
    new MutationObserver(() => { if (app.classList.contains('hidden')) setMenu(false); }).observe(app, { attributes: true, attributeFilter: ['class'] });
    setMenu(false);
    syncDialogs();
})();
