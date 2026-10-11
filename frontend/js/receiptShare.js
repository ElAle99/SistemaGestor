(() => {
    const downloadButton = document.getElementById('btn-download-receipt-png');
    const shareButton = document.getElementById('btn-share-receipt-whatsapp');
    const status = document.getElementById('receipt-share-status');
    const initialShareLabel = shareButton.innerHTML;
    let prepared = null;

    function currentReceipt() {
        const element = getActiveReceiptElement();
        if (!element) throw new Error('No hay un ticket listo para compartir.');
        const paper = detectConfiguredTicketPaper();
        return { element, paper, key: `${paper}:${element.outerHTML}` };
    }

    async function prepare(receipt) {
        if (typeof html2canvas !== 'function') {
            throw new Error('No se pudo cargar el generador de imagen. Recarga el sistema.');
        }
        const capture = await captureReceiptPreviewImage(receipt.element, receipt.paper);
        const bytes = Uint8Array.from(atob(capture.imageData.split(',')[1]), char => char.charCodeAt(0));
        const folio = receipt.element.querySelector('.ticket-folio-number, #thermal-val-folio')?.textContent || 'ticket';
        const filename = `${folio.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'ticket'}.png`;
        const file = new File([bytes], filename, { type: 'image/png' });
        return { key: receipt.key, file };
    }

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

    async function handleAction(share) {
        downloadButton.disabled = shareButton.disabled = true;
        try {
            const receipt = currentReceipt();
            if (!prepared || prepared.key !== receipt.key) {
                status.textContent = 'Preparando imagen del ticket…';
                prepared = await prepare(receipt);
                if (share) {
                    // A fresh click preserves the user activation required to share files
                    // and open WhatsApp, even when rendering takes several seconds.
                    shareButton.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Compartir PNG ahora';
                    status.textContent = 'Imagen lista. Pulsa Compartir PNG ahora para enviarla.';
                    return;
                }
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
    shareButton.addEventListener('click', () => handleAction(true));
    // Discard customer data and reset the prompt on close or ticket changes.
    document.getElementById('receipt-modal').addEventListener('click', event => {
        if (event.target.closest('#btn-close-receipt, #btn-close-receipt-modal, [id^="btn-show-"]')) {
            prepared = null;
            status.textContent = '';
            shareButton.innerHTML = initialShareLabel;
        }
    });
})();
