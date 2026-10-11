function initPrinterConfigForm() {
    const form = document.getElementById('config-printer-form');
    const service = window.printerService;
    if (!form || !service) return;
    const el = id => document.getElementById(id);
    const printer = el('cfg-ticket-printer');
    const paper = el('cfg-ticket-paper');
    const mode = el('cfg-ticket-print-mode');
    const cut = el('cfg-ticket-cut');
    const status = el('printer-config-status');
    const connection = el('printer-connection-status');
    const native = service.isNative();
    let found = [];
    const prefs = service.readPreferences();
    paper.value = prefs.paperWidth;
    mode.value = prefs.autoPrint ? 'direct' : 'ask';
    cut.checked = prefs.cut;
    const saved = service.getSavedPrinter();
    if (saved) { printer.add(new Option(saved.name + ' (guardada)', saved.id)); printer.value = saved.id; }
    const refresh = async () => {
        try {
            const state = await service.getStatus();
            connection.textContent = native ? (state.connection === 'connected' ? 'Conectada' : 'Desconectada') : 'Navegador';
            connection.className = `printer-status printer-status-${state.connection === 'connected' || !native ? 'connected' : 'disconnected'}`;
            status.textContent = native ? `Bluetooth ${state.bluetooth ? 'encendido' : 'apagado'}. Selecciona una impresora ESC/POS.` : 'La impresora se selecciona en el diálogo de impresión del navegador.';
        } catch { connection.textContent = 'Sin conexión'; }
    };
    const action = (id, handler) => {
        const button = el(id);
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await handler(); await refresh(); }
            catch (error) { status.textContent = error.message; AllfixUI.notify(error.message); }
            finally { button.disabled = false; }
        });
    };
    action('btn-detect-printers', async () => {
        status.textContent = 'Buscando impresoras Bluetooth Classic y BLE…';
        found = await service.getPrinters();
        const selected = printer.value;
        printer.replaceChildren(new Option('Selecciona una impresora', ''));
        for (const p of found) printer.add(new Option([p.name, p.address, p.transport].filter(Boolean).join(' · '), p.id));
        const stored = service.getSavedPrinter();
        if (stored && !found.some(p => p.id === stored.id)) printer.add(new Option(stored.name + ' (guardada)', stored.id));
        printer.value = selected;
        if (!found.length) AllfixUI.notify('No se encontraron impresoras. Enciéndela y revisa el emparejamiento en Android.');
    });
    action('btn-connect-printer', () => service.connectPrinter(printer.value));
    action('btn-disconnect-printer', () => service.disconnectPrinter(printer.value));
    const test = async () => {
        if (native && !printer.value) throw new Error('Selecciona una impresora para la prueba.');
        await service.testPrint({ printerId: printer.value, paperWidth: paper.value });
        AllfixUI.notify(native ? 'Prueba enviada a la impresora.' : 'Se abrió el diálogo de impresión.');
    };
    action('btn-test-printer', test);
    action('btn-browser-print-test', test);
    el('btn-browser-print-test').hidden = native;
    for (const id of ['cfg-ticket-printer', 'btn-detect-printers', 'btn-connect-printer', 'btn-disconnect-printer', 'cfg-ticket-cut']) el(id).disabled = !native;
    function storeOptions() {
        const p = service.savePreferences({ paperWidth: paper.value, autoPrint: mode.value === 'direct', cut: cut.checked });
        Object.assign(ESTABLISHMENT_CONFIG, { ticketPaper: p.paperWidth, autoPrintTicket: p.autoPrint, ticketPrinter: p.printerName });
    }
    [paper, mode, cut].forEach(input => input.addEventListener('change', storeOptions));
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
            if (native) {
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
