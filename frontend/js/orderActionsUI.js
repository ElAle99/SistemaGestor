// Presentation only. Native dialog retains the existing close guards and focus trap.
(() => {
    const dialog = document.getElementById('order-print-selector');
    let previous = null;
    const lock = () => {
        if (previous) return;
        const body = document.body;
        const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        previous = {
            focus: document.activeElement,
            x: window.scrollX, y: window.scrollY,
            overflow: body.style.overflow, padding: body.style.paddingRight
        };
        const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
        body.style.overflow = 'hidden';
        if (scrollbar) body.style.paddingRight = `${padding + scrollbar}px`;
        document.getElementById('order-print-customer').focus({ preventScroll: true });
    };
    const unlock = () => {
        if (!previous) return;
        const saved = previous;
        previous = null;
        document.body.style.overflow = saved.overflow;
        document.body.style.paddingRight = saved.padding;
        if (saved.focus?.isConnected) saved.focus.focus({ preventScroll: true });
        window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
    };
    // Capture the opener before showModal moves focus into the dialog.
    const open = window.openOrderActionsModal;
    window.openOrderActionsModal = (order, options) => {
        const opener = document.activeElement;
        open(order, options);
        if (dialog.open && !previous) {
            lock();
            previous.focus = opener;
        }
    };
    dialog.addEventListener('close', unlock);

    const toast = document.createElement('div');
    toast.className = 'order-folio-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    let toastTimer;
    function notifyCopy(message) {
        clearTimeout(toastTimer);
        toast.textContent = message;
        toast.classList.add('is-visible');
        toastTimer = setTimeout(() => {
            toast.classList.remove('is-visible');
            toast.textContent = '';
        }, 1800);
    }
    window.copyOrderFolio = async folio => {
        try {
            if (!folio) throw new Error('Folio no disponible');
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(String(folio));
            } else {
                const focus = document.activeElement;
                const input = document.createElement('textarea');
                input.value = String(folio);
                input.readOnly = true;
                input.className = 'order-folio-clipboard';
                document.body.appendChild(input);
                try {
                    input.focus({ preventScroll: true });
                    input.select();
                    if (!document.execCommand('copy')) throw new Error('Portapapeles no disponible');
                } finally {
                    input.remove();
                    focus?.focus({ preventScroll: true });
                }
            }
            notifyCopy(`Folio ${folio} copiado`);
        } catch { notifyCopy('No se pudo copiar el folio'); }
    };
})();
