// Quick reception is independent from the legacy advanced editor.
const quickOrderModal = document.getElementById('quick-order-modal');
const quickOrderForm = document.getElementById('quick-order-form');
let quickSelectedClient = null;
let quickCreatedOrder = null;
let quickSaving = false;
let quickSearchTimer;
let quickSearchVersion = 0;
let quickSearchController;

function stopQuickClientSearch() {
    clearTimeout(quickSearchTimer);
    quickSearchController?.abort();
    quickSearchVersion++;
    document.getElementById('quick-client-matches').replaceChildren();
    document.getElementById('quick-client-matches').classList.add('hidden');
}

function openQuickOrder() {
    if (quickSaving) return;
    stopQuickClientSearch();
    quickOrderForm.reset();
    globalThis.quickOrderExtras?.reset();
    globalThis.quickCatalog?.reset();
    quickSelectedClient = null;
    quickCreatedOrder = null;
    quickOrderForm.classList.remove('hidden');
    document.getElementById('quick-order-success').classList.add('hidden');
    document.getElementById('quick-order-error').classList.add('hidden');
    document.getElementById('quick-client-status').textContent = '';
    document.getElementById('quick-order-print-status').textContent = '';
    document.getElementById('quick-advance').setCustomValidity('');
    updateQuickBalance();
    quickOrderModal.classList.remove('hidden');
    document.getElementById('quick-client-name').focus();
}

function quickClientName(client) {
    return [client.nombre, client.apellido_paterno, client.apellido_materno].filter(Boolean).join(' ');
}

function selectQuickClient(client) {
    stopQuickClientSearch();
    quickSelectedClient = client;
    document.getElementById('quick-client-name').value = quickClientName(client);
    document.getElementById('quick-client-phone').value = client.telefono_principal || client.telefono || '';
    document.getElementById('quick-client-alt').value = client.telefono_alternativo_1 || client.telefono_alt1 || '';
    document.getElementById('quick-client-status').textContent = 'Cliente existente seleccionado.';
    if (globalThis.quickCatalog) globalThis.quickCatalog.focusDevice();
    else document.getElementById('quick-device').focus();
}

function searchQuickClients(event) {
    quickSelectedClient = null;
    stopQuickClientSearch();
    const query = event.target.value.trim();
    const status = document.getElementById('quick-client-status');
    status.textContent = '';
    if (query.length < 2) return;
    const version = quickSearchVersion;
    quickSearchTimer = setTimeout(async () => {
        quickSearchController = new AbortController();
        try {
            const response = await fetch(`${BASE_API_URL}/clientes?search=${encodeURIComponent(query)}`, { signal: quickSearchController.signal, silent: true });
            if (!response.ok) throw new Error('No se pudo buscar clientes.');
            const clients = await response.json();
            if (version !== quickSearchVersion) return;
            const matches = document.getElementById('quick-client-matches');
            matches.replaceChildren();
            clients.slice(0, 8).forEach(client => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = `${quickClientName(client)} · ${client.telefono_principal || client.telefono || ''}`;
                button.addEventListener('click', () => selectQuickClient(client));
                matches.appendChild(button);
            });
            matches.classList.toggle('hidden', !clients.length);
            status.textContent = clients.length ? 'Selecciona una coincidencia si corresponde.' : 'Sin coincidencias. El cliente se creará junto con la orden.';
        } catch (error) {
            if (error.name !== 'AbortError' && version === quickSearchVersion) status.textContent = 'No se pudo buscar clientes. Vuelve a escribir para reintentar.';
        }
    }, 200);
}

function validateQuickAdvance() {
    const cost = document.getElementById('quick-cost').value;
    const advance = document.getElementById('quick-advance');
    let message = '';
    if (Number(advance.value) > 0 && cost === '') message = 'Define el costo antes de recibir un anticipo.';
    else if (Number(advance.value) > Number(cost)) message = 'El anticipo no puede ser mayor al costo.';
    advance.setCustomValidity(message);
    updateQuickBalance(message);
}

function updateQuickBalance(error = '') {
    const rawCost = document.getElementById('quick-cost').value;
    const cost = Number(rawCost);
    const advance = Number(document.getElementById('quick-advance').value || 0);
    const defined = rawCost !== '' && Number.isFinite(cost) && cost >= 0;
    const validAdvance = Number.isFinite(advance) && advance >= 0;
    const money = value => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
    const invalid = error || (!validAdvance || (rawCost !== '' && !defined) ? 'Revisa los importes ingresados.' : '');
    const cents = defined && validAdvance ? Math.round(cost * 100) - Math.round(advance * 100) : null;
    const balance = invalid || (cents !== null && cents < 0) ? 'Revisar importes' : defined ? money(cents / 100) : 'Por definir';
    document.getElementById('quick-summary-cost').textContent = defined ? money(cost) : 'Por definir';
    document.getElementById('quick-summary-advance').textContent = validAdvance ? money(advance) : '—';
    document.getElementById('quick-summary-balance').textContent = balance;
    document.getElementById('quick-footer-balance').textContent = balance;
    document.getElementById('quick-balance-hint').textContent = invalid || (!defined
        ? 'Agrega un costo para calcular el saldo.' : cents === 0
            ? 'Sin saldo pendiente.' : 'Este es el importe restante después del anticipo.');
}

async function showQuickOrder(print = false, silent = false) {
    if (!quickCreatedOrder) return;
    const status = document.getElementById('quick-order-print-status');
    try {
        const opened = await viewOrderDetails(quickCreatedOrder.id, { openPreview: !print || !globalThis.printerService?.isNative() });
        if (opened === false) throw new Error('No se pudo abrir la orden.');
        if (print) {
            const printed = await printReceipt(null, { silent });
            if (printed === false) status.textContent = 'La orden está guardada. Puedes reintentar la impresión desde el ticket.';
        }
    } catch (error) {
        status.textContent = 'La orden está guardada. No se pudo abrir o imprimir el ticket; vuelve a intentarlo.';
    }
}

quickOrderForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (quickSaving) return;
    if (globalThis.quickOrderExtras?.isLoading()) return;
    validateQuickAdvance();
    if (!quickOrderForm.reportValidity()) return;
    if (globalThis.quickCatalog && !globalThis.quickCatalog.validate()) return;
    const value = id => document.getElementById(id).value.trim();
    const data = {
        clientId: quickSelectedClient?.id || null,
        clientName: value('quick-client-name'), clientPhone: value('quick-client-phone'),
        clientPhoneAlt1: value('quick-client-alt'), deviceType: value('quick-device'),
        brand: value('quick-brand'), model: value('quick-model'), color: value('quick-color'),
        falla_reportada: value('quick-fault'), servicio_solicitado: value('quick-repair'),
        costo_estimado: value('quick-cost') || null, anticipo: value('quick-advance') || 0,
        ...globalThis.quickCatalog?.payload(),
        ...globalThis.quickOrderExtras?.payload()
    };
    const errorBox = document.getElementById('quick-order-error');
    const submit = document.getElementById('quick-order-submit');
    errorBox.classList.add('hidden');
    quickSaving = true;
    globalThis.quickOrderExtras?.setBusy(true);
    globalThis.quickCatalog?.setBusy(true);
    stopQuickClientSearch();
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Guardando…';
    try {
        const response = await fetch(`${BASE_API_URL}/ordenes/rapida`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo crear la orden.');
        quickCreatedOrder = result;
        quickOrderForm.classList.add('hidden');
        document.getElementById('quick-order-success-message').textContent = `Orden ${result.folio} creada correctamente.`;
        document.getElementById('quick-order-success').classList.remove('hidden');
        document.getElementById('quick-order-print').focus();
    } catch (error) {
        errorBox.textContent = error.message || 'No se pudo crear la orden. Revisa la conexión.';
        if (globalThis.AllfixUI) AllfixUI.notify(errorBox.textContent, 'error');
        else errorBox.classList.remove('hidden');
    } finally {
        quickSaving = false;
        globalThis.quickOrderExtras?.setBusy(false);
        globalThis.quickCatalog?.setBusy(false);
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
        submit.textContent = 'Crear orden';
    }
    if (quickCreatedOrder) {
        // Post-save failures must never invite submitting an already saved order again.
        const refresh = typeof refreshQuickOrderData === 'function' ? refreshQuickOrderData : loadAllData;
        Promise.resolve(refresh(Number(data.anticipo) > 0)).catch(() => {});
    }
});

['quick-client-name', 'quick-client-phone'].forEach(id => document.getElementById(id).addEventListener('input', searchQuickClients));
['quick-cost', 'quick-advance'].forEach(id => document.getElementById(id).addEventListener('input', validateQuickAdvance));
document.getElementById('quick-order-close').addEventListener('click', () => {
    if (quickSaving) return;
    stopQuickClientSearch();
    quickOrderModal.classList.add('hidden');
});
document.getElementById('quick-order-new').addEventListener('click', openQuickOrder);
document.getElementById('quick-order-view').addEventListener('click', () => showQuickOrder());
document.getElementById('quick-order-print').addEventListener('click', () => showQuickOrder(true));
