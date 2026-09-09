(function initQZPrinterService(global) {
    'use strict';

    const STORAGE_KEYS = {
        printerName: 'allfix_printer_name',
        paperWidth: 'allfix_paper_width',
        autoPrint: 'allfix_auto_print'
    };

    let connectionPromise = null;
    let printPromise = null;

    function getQZ() {
        const qz = global.qz;
        if (!qz?.websocket || !qz?.printers || !qz?.configs || typeof qz.print !== 'function') {
            throw createError('QZ_NOT_LOADED', 'No se pudo cargar la integración con QZ Tray.');
        }
        return qz;
    }

    function createError(code, message, cause) {
        const error = new Error(message);
        error.code = code;
        if (cause) error.cause = cause;
        return error;
    }

    function normalizeError(error, fallbackMessage = 'No fue posible comunicarse con QZ Tray.') {
        if (error?.code && error?.userMessage) return error;

        const rawMessage = String(error?.message || error || '').toLowerCase();
        let code = error?.code || 'QZ_ERROR';
        let userMessage = fallbackMessage;

        if (
            code === 'QZ_NOT_LOADED'
            || rawMessage.includes('unable to establish')
            || rawMessage.includes('unable to create')
            || rawMessage.includes('websocket')
            || rawMessage.includes('connection')
        ) {
            code = 'QZ_UNAVAILABLE';
            userMessage = 'QZ Tray no está disponible en esta computadora. Verifica que esté instalado y abierto.';
        } else if (rawMessage.includes('printer') || rawMessage.includes('impresora')) {
            code = 'PRINTER_ERROR';
            userMessage = 'La impresora seleccionada no está disponible o rechazó el trabajo.';
        }

        const normalized = createError(code, userMessage, error);
        normalized.userMessage = userMessage;
        return normalized;
    }

    function isQZConnected() {
        try {
            return Boolean(global.qz?.websocket?.isActive?.());
        } catch (error) {
            return false;
        }
    }

    async function connectQZ() {
        if (isQZConnected()) return true;
        if (connectionPromise) return connectionPromise;

        connectionPromise = (async () => {
            try {
                const qz = getQZ();
                await qz.websocket.connect({ retries: 2, delay: 1 });
                return true;
            } catch (error) {
                throw normalizeError(error, 'No fue posible conectar con QZ Tray.');
            } finally {
                connectionPromise = null;
            }
        })();

        return connectionPromise;
    }

    async function ensureQZConnection() {
        return isQZConnected() ? true : connectQZ();
    }

    async function disconnectQZ() {
        if (!isQZConnected()) return;
        try {
            await getQZ().websocket.disconnect();
        } catch (error) {
            throw normalizeError(error, 'No fue posible desconectar QZ Tray.');
        }
    }

    async function getPrinters() {
        await ensureQZConnection();
        try {
            const printers = await getQZ().printers.find();
            const values = Array.isArray(printers) ? printers : (printers ? [printers] : []);
            return values.map(String).filter(Boolean);
        } catch (error) {
            throw normalizeError(error, 'No fue posible consultar las impresoras de esta computadora.');
        }
    }

    async function getDefaultPrinter() {
        await ensureQZConnection();
        try {
            return String(await getQZ().printers.getDefault() || '');
        } catch (error) {
            throw normalizeError(error, 'No fue posible consultar la impresora predeterminada de Windows.');
        }
    }

    async function getPrinterDetails() {
        await ensureQZConnection();
        try {
            return await getQZ().printers.details();
        } catch (error) {
            console.warn('QZ Tray no proporcionó detalles de impresoras; la lista básica sigue disponible.');
            return [];
        }
    }

    function readPreferences() {
        return {
            printerName: localStorage.getItem(STORAGE_KEYS.printerName) || '',
            paperWidth: localStorage.getItem(STORAGE_KEYS.paperWidth) === '80mm' ? '80mm' : '58mm',
            autoPrint: localStorage.getItem(STORAGE_KEYS.autoPrint) !== 'false'
        };
    }

    function savePreferences(preferences = {}) {
        if (Object.prototype.hasOwnProperty.call(preferences, 'printerName')) {
            localStorage.setItem(STORAGE_KEYS.printerName, String(preferences.printerName || ''));
        }
        if (Object.prototype.hasOwnProperty.call(preferences, 'paperWidth')) {
            localStorage.setItem(STORAGE_KEYS.paperWidth, preferences.paperWidth === '80mm' ? '80mm' : '58mm');
        }
        if (Object.prototype.hasOwnProperty.call(preferences, 'autoPrint')) {
            localStorage.setItem(STORAGE_KEYS.autoPrint, String(preferences.autoPrint !== false));
        }
        return readPreferences();
    }

    async function printImageTicket(options = {}) {
        if (printPromise) return printPromise;

        printPromise = (async () => {
            const printerName = String(options.printerName || readPreferences().printerName || '').trim();
            if (!printerName) {
                throw createError('PRINTER_REQUIRED', 'Selecciona una impresora antes de imprimir.');
            }
            if (!options.imageData) {
                throw createError('TICKET_REQUIRED', 'No hay un ticket listo para imprimir.');
            }

            await ensureQZConnection();
            const paperWidth = options.paperWidth === '80mm' ? 80 : 58;
            const dpi = Number(options.density || 203);
            const pixelHeight = Number(options.pixelHeight);
            if (!Number.isFinite(dpi) || dpi < 180 || dpi > 600 || !Number.isSafeInteger(pixelHeight) || pixelHeight <= 0) {
                throw createError('TICKET_SIZE_INVALID', 'No se pudo determinar el tamaño del ticket. Genera la vista previa nuevamente.');
            }
            const config = getQZ().configs.create(printerName, {
                copies: 1,
                colorType: 'blackwhite',
                // QZ interprets density in the same units as page size: use DPI/inches.
                density: dpi,
                interpolation: 'nearest-neighbor',
                margins: 0,
                orientation: 'portrait',
                rasterize: false,
                scaleContent: false,
                size: { width: paperWidth / 25.4, height: pixelHeight / dpi + 2 / 25.4 },
                units: 'in',
                jobName: options.jobName || 'Allfix - Ticket'
            });
            const data = [{
                type: 'pixel',
                format: 'image',
                flavor: 'base64',
                data: String(options.imageData).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
            }];

            try {
                await getQZ().print(config, data);
                return { printerName, paperWidth: `${paperWidth}mm` };
            } catch (error) {
                throw normalizeError(error, `No fue posible imprimir en ${printerName}.`);
            }
        })().finally(() => {
            printPromise = null;
        });

        return printPromise;
    }

    async function printHtmlTicket(options = {}) {
        if (printPromise) return printPromise;

        printPromise = (async () => {
            const printerName = String(options.printerName || readPreferences().printerName || '').trim();
            if (!printerName) throw createError('PRINTER_REQUIRED', 'Selecciona una impresora antes de imprimir.');
            if (!options.html) throw createError('TICKET_REQUIRED', 'No hay contenido para imprimir.');

            await ensureQZConnection();
            const paperWidth = options.paperWidth === '80mm' ? 80 : 58;
            const config = getQZ().configs.create(printerName, {
                copies: 1,
                colorType: 'blackwhite',
                density: 203,
                interpolation: 'nearest-neighbor',
                margins: 0,
                orientation: 'portrait',
                rasterize: true,
                scaleContent: true,
                size: { width: paperWidth / 25.4 },
                units: 'in',
                jobName: options.jobName || 'Allfix - Ticket'
            });
            await getQZ().print(config, [{
                type: 'pixel',
                format: 'html',
                flavor: 'plain',
                data: options.html
            }]);
            return { printerName, paperWidth: `${paperWidth}mm` };
        })().catch(error => {
            throw normalizeError(error);
        }).finally(() => {
            printPromise = null;
        });

        return printPromise;
    }

    function buildTestTicketHtml(printerName, paperWidth) {
        const width = paperWidth === '80mm' ? '80mm' : '58mm';
        const date = new Intl.DateTimeFormat('es-MX', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date());
        const escape = value => String(value).replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        })[char]);

        return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@page { margin: 0; }
html, body { width: ${width}; margin: 0; padding: 0; }
* { box-sizing: border-box; }
body { padding: 3mm; background: #fff; color: #000; font: bold 13px/1.35 Arial, sans-serif; text-align: center; }
h1 { font-size: 18px; margin: 0 0 8px; }
p { margin: 5px 0; overflow-wrap: anywhere; }
.line { border-top: 1px dashed #000; margin: 8px 0; }
</style></head><body>
<h1>ALLFIX BACALAR</h1>
<div class="line"></div>
<p><strong>Prueba de impresión</strong></p>
<p>Impresora:<br>${escape(printerName)}</p>
<p>Papel: ${escape(width)}</p>
<p>Impresión configurada correctamente</p>
<p>Fecha:<br>${escape(date)}</p>
</body></html>`;
    }

    async function printTestTicket(options = {}) {
        const preferences = readPreferences();
        const printerName = String(options.printerName || preferences.printerName || '').trim();
        const paperWidth = options.paperWidth || preferences.paperWidth;
        return printHtmlTicket({
            printerName,
            paperWidth,
            jobName: 'Allfix - Prueba de impresión',
            html: buildTestTicketHtml(printerName, paperWidth)
        });
    }

    global.qzPrinterService = Object.freeze({
        STORAGE_KEYS,
        connectQZ,
        disconnectQZ,
        isQZConnected,
        ensureQZConnection,
        getPrinters,
        getDefaultPrinter,
        getPrinterDetails,
        printHtmlTicket,
        printImageTicket,
        printTestTicket,
        readPreferences,
        savePreferences,
        normalizeError
    });
})(window);
