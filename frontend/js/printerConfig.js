function initPrinterConfigForm() {
    const form = document.getElementById('config-printer-form');
    const service = window.printerService, manager = window.printerManager;
    if (!form || !service || form.dataset.initialized) return;
    form.dataset.initialized = 'true';
    const el = id => document.getElementById(id);
    const printer = el('cfg-ticket-printer'), paper = el('cfg-ticket-paper'), mode = el('cfg-ticket-print-mode');
    const cut = el('cfg-ticket-cut'), status = el('printer-config-status'), connection = el('printer-connection-status');
    const capabilities = manager.capabilities();
    const native = service.isNative();
    let found = [], busy = false, lastError = null;
    const fields = { connection: 'cfg-print-connection', dots: 'cfg-print-dots', printableMm: 'cfg-print-mm',
        columns: 'cfg-print-columns', dpi: 'cfg-print-dpi', copies: 'cfg-print-copies', feedLines: 'cfg-print-feed',
        baudRate: 'cfg-print-baud', codepage: 'cfg-print-codepage', compatibilityProfile: 'cfg-print-mapping' };
    const prefs = service.readPreferences();
    paper.value = prefs.paperWidth; mode.value = prefs.autoPrint ? 'direct' : 'ask'; cut.checked = prefs.cut;
    for (const [key, id] of Object.entries(fields)) el(id).value = prefs[key];
    el('cfg-print-qr').checked = prefs.showQr; el('cfg-print-logo').checked = prefs.showLogo;
    for (const option of el(fields.connection).options) option.disabled = option.value !== 'auto' && !capabilities[option.value];
    el('printer-capabilities').textContent = 'Disponibles: ' + Object.keys(capabilities).filter(key => capabilities[key]).join(', ');
    function diagnose(error, live = false) {
        if (error) lastError = error.printerDiagnostic || { name: error.name, message: error.message };
        const diagnostic = live ? manager.getDiagnostics() : service.diagnostics();
        if (live) console.debug('[Impresora: diagnóstico previo]', diagnostic);
        el('printer-diagnostics').textContent = JSON.stringify({ ...diagnostic, ...(lastError ? { error: lastError } : {}) }, null, 2);
        if (error) el('printer-advanced').open = true;
    }
    function storeOptions() {
        const values = Object.fromEntries(Object.entries(fields).map(([key,id]) => [key,el(id).value]));
        const p = service.savePreferences({ ...values, paperWidth: paper.value, autoPrint: mode.value === 'direct',
            cut: cut.checked, showQr: el('cfg-print-qr').checked, showLogo: el('cfg-print-logo').checked });
        Object.assign(ESTABLISHMENT_CONFIG, { ticketPaper: p.paperWidth, autoPrintTicket: p.autoPrint, ticketPrinter: p.printerName });
    }
    const refresh = async () => {
        const state = await service.getStatus(), method = manager.resolveMethod();
        connection.textContent = state.connection === 'connected' ? 'Conectada' : 'Desconectada';
        connection.className = 'printer-status printer-status-' + state.connection;
        el('btn-detect-printers').hidden = method !== 'native';
        el('btn-detect-printers').disabled = busy || method !== 'native';
        for (const id of ['btn-connect-printer','btn-select-other-printer']) el(id).disabled = busy || (method === 'browser' && !(capabilities.qz && service.readPreferences().connection === 'auto'));
        const qzActive = Boolean(manager.transports.qz?.qz.websocket.isActive());
        el('btn-disconnect-printer').disabled = busy || (state.connection !== 'connected' && !qzActive);
        el('printer-qz-help').hidden = !capabilities.qz || manager.transports.qz.available !== false;
        diagnose();
    };
    async function refreshChoices() {
        const selected = printer.value;
        const devices = await service.refreshDevices();
        printer.replaceChildren(new Option(capabilities.qz ? 'Selecciona una impresora' : 'Automática (recomendado)', ''));
        for (const p of devices) printer.add(new Option(p.name, p.id));
        for (const p of found) printer.add(new Option(p.name || 'Impresora Bluetooth', p.id));
        const saved = service.getSavedPrinter();
        if (native && saved && !found.some(p => p.id === saved.id)) printer.add(new Option(saved.name || 'Impresora Bluetooth guardada', saved.id));
        const name = service.readPreferences().printerName;
        if (name && !devices.length && !native) printer.options[0].textContent = name + ' (reconectar)';
        const preferred = manager.selectedDevice?.id || selected;
        if (Array.from(printer.options).some(option => option.value === preferred)) printer.value = preferred;
        if (!preferred && devices.length === 1 && devices[0].method !== 'qz') printer.value = devices[0].id;
        service.selectDevice(native ? '' : printer.value);
        await refresh();
    }
    const action = (id, handler) => {
        el(id).addEventListener('click', async () => {
            if (busy) return;
            busy = true; lastError = null; el(id).disabled = true;
            try {
                // handler is invoked immediately on the click: no awaited refresh before device selectors.
                await handler();
            } catch (error) { status.textContent = error.message; diagnose(error); AllfixUI.notify(error.message); }
            finally { busy = false; el(id).disabled = false; await refresh(); }
        });
    };
    async function connect(selectNew = false) {
        storeOptions();
        diagnose(null, true);
        if (manager.resolveMethod() === 'native' && (selectNew || !printer.value)) {
            found = await service.getPrinters(); await refreshChoices();
            status.textContent = found.length ? 'Selecciona tu impresora y pulsa Conectar impresora.' : 'No se encontraron impresoras Bluetooth.';
            return;
        }
        const result = await service.connectPrinter(native ? printer.value : '', { selectNew });
        await refreshChoices();
        status.textContent = result.method === 'qz'
            ? (result.connected && !selectNew ? `QZ Tray conectado. ${service.readPreferences().qzPrinterName} seleccionada. Pulsa Imprimir prueba.` : 'QZ Tray conectado. Selecciona tu impresora de Windows en la lista.')
            : 'Impresora conectada. Pulsa Imprimir prueba para comprobar el ticket.';
        if (result.method === 'qz' && (selectNew || !result.connected)) printer.focus();
    }
    action('btn-connect-printer', () => connect());
    action('btn-select-other-printer', () => connect(true));
    action('btn-disconnect-printer', async () => { await service.disconnectPrinter(); status.textContent = 'Impresora desconectada.'; });
    action('btn-detect-printers', async () => { found = await service.getPrinters(); await refreshChoices(); });
    action('btn-test-printer', async () => { storeOptions(); await service.testPrint(); status.textContent = 'Prueba enviada. Comprueba la impresión.'; });
    action('btn-browser-print-test', () => service.testPrint({ connection: 'browser' }));
    printer.addEventListener('change', () => {
        service.selectDevice(native ? '' : printer.value);
        if (native) service.savePreferences({ printerId: printer.value, printerName: found.find(p => p.id === printer.value)?.name || '' });
        if (manager.selectedDevice?.method === 'qz') status.textContent = `QZ Tray conectado. ${manager.selectedDevice.name} seleccionada. Pulsa Imprimir prueba.`;
        refresh();
    });
    paper.addEventListener('change', () => {
        const profile = service.paperProfile(paper.value);
        for (const [key,value] of Object.entries(profile)) if (fields[key]) el(fields[key]).value = value;
        storeOptions();
    });
    for (const input of [mode, cut, ...Object.values(fields).map(el), el('cfg-print-qr'), el('cfg-print-logo')]) input.addEventListener('change', () => { storeOptions(); refresh(); });
    refreshChoices().catch(error => { status.textContent = error.message; });
    const logo = el('cfg-ticket-logo');
    setTicketLogoPreview();
    el('btn-select-ticket-logo').addEventListener('click', () => logo.click());
    logo.addEventListener('change', () => {
        const file = logo.files?.[0];
        if (!file) return setTicketLogoPreview();
        const reader = new FileReader();
        reader.onload = () => setTicketLogoPreview(reader.result, file.name);
        reader.readAsDataURL(file);
    });
    el('btn-remove-ticket-logo').addEventListener('click', () => {
        ESTABLISHMENT_CONFIG.ticketLogoUrl = '';
        logo.value = '';
        setTicketLogoPreview(DEFAULT_TICKET_LOGO);
        applyTicketLogoSource();
    });
    form.addEventListener('submit', withFormFeedback(async event => {
        event.preventDefault();
        try {
            storeOptions();
            if (native && manager.resolveMethod() === 'native') {
                const selected = found.find(p => p.id === printer.value) || service.getSavedPrinter();
                if (!selected) throw new Error('Selecciona una impresora.');
                await service.savePrinter(selected);
            }
            const ticketLogoUrl = await uploadTicketLogoIfNeeded();
            await saveEstablishmentConfig({ ticketLogoUrl });
            logo.value = '';
            setTicketLogoPreview();
            await refresh();
            AllfixUI.notify('Preferencias de impresión guardadas en este dispositivo.');
        } catch (error) { AllfixUI.notify(error.message); }
    }));
    document.querySelector('[data-view="configuracion"]')?.addEventListener('click', refresh);
    window.addEventListener('focus', refresh);
    refresh();
}
