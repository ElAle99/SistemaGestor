(() => {
    const downloadButton = document.getElementById('btn-download-receipt-png');
    const shareButton = document.getElementById('btn-share-receipt-whatsapp');
    const previewButton = document.getElementById('btn-preview-share-ticket');
    const preview = document.getElementById('share-ticket-preview');
    const previewImage = document.getElementById('share-ticket-preview-image');
    let previewUrl = null;
    const status = { set textContent(value) {
        document.getElementById('receipt-share-status').textContent = value;
        const previewStatus = document.getElementById('share-preview-status');
        if (previewStatus) previewStatus.textContent = value;
    } };
    const initialShareLabel = shareButton.innerHTML;
    let prepared = null;
    let pending = null;
    const modal = document.getElementById('receipt-modal');

    function currentReceipt() {
        const element = getActiveReceiptElement();
        if (!element) throw new Error('No hay un ticket listo para compartir.');
        if (!window.visualTickets) throw new Error('No se pudo cargar el generador visual. Recarga el sistema.');
        const type = element.id === 'ticket-venta-container' ? 'sale' : element.id === 'ticket-corte-container' ? 'cashClosing' : 'service';
        const raw = type === 'sale' ? APP_STATE.selectedSaleForReceipt : type === 'cashClosing' ? APP_STATE.selectedCajaForReceipt : APP_STATE.selectedOrderForReceipt;
        if (!raw) throw new Error('Abre una orden o venta para compartir su comprobante.');
        const ticket = window.visualTickets.build(type, raw, ESTABLISHMENT_CONFIG);
        return { ticket, key: JSON.stringify(ticket) };
    }

    async function prepare(receipt) {
        const capture = await window.visualTickets.generateShareTicketImage(receipt.ticket);
        const folio = receipt.ticket.folio;
        const filename = `${folio.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'ticket'}.png`;
        const file = new File([capture.blob], filename, { type: 'image/png' });
        return { key: receipt.key, file };
    }

    function ensurePrepared(receipt) {
        if (prepared?.key === receipt.key) return Promise.resolve(prepared);
        if (pending?.key === receipt.key) return pending.promise;
        const job = { key: receipt.key };
        job.promise = prepare(receipt).then(result => {
            if (!modal.classList.contains('hidden') && currentReceipt().key === result.key) prepared = result;
            return result;
        }).finally(() => { if (pending === job) pending = null; });
        pending = job;
        return job.promise;
    }

    // Prepare only the visible receipt, sharing the same work with button clicks.
    let warmupTimer;
    function clearPreview() {
        if (preview?.open) preview.close();
        previewImage?.removeAttribute('src');
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
    const observer = new MutationObserver(records => {
        if (records.every(record => record.target.closest?.('.modal-footer'))) return;
        clearTimeout(warmupTimer);
        let receipt;
        if (!modal.classList.contains('hidden')) {
            try { receipt = currentReceipt(); } catch { /* No authorized receipt selected yet. */ }
            // Layout changes (including mobile resize) must not close a valid preview.
            if (receipt && (prepared?.key === receipt.key || pending?.key === receipt.key)) return;
        }
        prepared = null;
        clearPreview();
        status.textContent = '';
        shareButton.innerHTML = initialShareLabel;
        if (!receipt) return;
        warmupTimer = setTimeout(async () => {
            try { await ensurePrepared(receipt); } catch { /* Retry on explicit action. */ }
        }, 120);
    });
    observer.observe(modal, { attributes: true, childList: true, characterData: true, subtree: true });

    function download(file) {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    async function handleAction(share, showPreview = false) {
        if (downloadButton.disabled) return;
        downloadButton.disabled = shareButton.disabled = true;
        try {
            const receipt = currentReceipt();
            if (!prepared || prepared.key !== receipt.key) {
                status.textContent = 'Preparando imagen del ticket…';
                const result = await ensurePrepared(receipt);
                if (modal.classList.contains('hidden') || currentReceipt().key !== result.key) {
                    status.textContent = 'El ticket cambió. Vuelve a pulsar para compartir el actual.';
                    return;
                }
                prepared = result;
                if (share && !navigator.userActivation?.isActive) {
                    // A fresh click preserves the user activation required to share files
                    // and open WhatsApp, even when rendering takes several seconds.
                    shareButton.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Compartir PNG ahora';
                    status.textContent = 'Imagen lista. Pulsa Compartir PNG ahora para enviarla.';
                    return;
                }
            }
            if (showPreview) {
                clearPreview();
                previewUrl = URL.createObjectURL(prepared.file);
                previewImage.src = previewUrl;
                document.getElementById('share-ticket-image-info').textContent = `PNG · 800 px · ${Math.round(prepared.file.size / 1024)} KB`;
                preview.showModal();
                return;
            }
            if (!share) {
                download(prepared.file);
                status.textContent = 'Ticket PNG descargado.';
                return;
            }
            const files = [prepared.file];
            if (navigator.share && navigator.canShare?.({ files })) {
                await navigator.share({ files, title: 'Ticket', text: 'Te comparto tu ticket.' });
                status.textContent = 'Se compartió el ticket.';
            } else {
                window.open('https://wa.me/?text=' + encodeURIComponent('Te comparto tu ticket.'), '_blank', 'noopener,noreferrer');
                download(prepared.file);
                status.textContent = 'Adjunta el PNG descargado en WhatsApp. Si no se abrió, abre WhatsApp manualmente.';
            }
        } catch (error) {
            status.textContent = error.name === 'AbortError'
                ? 'Envío cancelado. Puedes volver a compartir el ticket.'
                : (error.message || 'No se pudo generar o compartir el ticket. Intenta descargar el PNG.');
        } finally {
            downloadButton.disabled = shareButton.disabled = false;
        }
    }

    downloadButton.addEventListener('click', () => handleAction(false));
    previewButton?.addEventListener('click', () => handleAction(false, true));
    document.getElementById('btn-close-share-preview')?.addEventListener('click', clearPreview);
    document.getElementById('btn-download-share-preview')?.addEventListener('click', () => handleAction(false));
    document.getElementById('btn-share-preview')?.addEventListener('click', () => handleAction(true));
    preview?.addEventListener('cancel', () => clearPreview());
    window.addEventListener?.('pagehide', () => { prepared = null; clearPreview(); clearTimeout(warmupTimer); });
    function shareServiceTicket() { return handleAction(true); }
    shareButton.addEventListener('click', shareServiceTicket);
    // Discard customer data and reset the prompt on close or ticket changes.
    document.getElementById('receipt-modal').addEventListener('click', event => {
        if (event.target.closest('#btn-close-receipt, #btn-close-receipt-modal, [id^="btn-show-"]')) {
            prepared = null;
            clearPreview();
            status.textContent = '';
            shareButton.innerHTML = initialShareLabel;
        }
    });
})();
