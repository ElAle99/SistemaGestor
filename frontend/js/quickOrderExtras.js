// Reuses the advanced editor's pattern pad and photo reader; no upload endpoint.
(() => {
    const el = id => document.getElementById(id);
    const type = el('quick-lock-type');
    if (!type) return;
    const pad = initPatternLock({ canvasId: 'quick-pattern-canvas', displayId: 'quick-pattern-display', inputId: 'quick-lock-pattern', clearId: 'quick-pattern-clear' });
    let photos = [];
    let generation = 0;
    let pending = 0;
    let saving = false;
    let queue = Promise.resolve();
    const status = el('quick-photo-status');
    const photoBytes = () => photos.reduce((sum, photo) => sum + photo.length, 0);

    function setButtons() {
        el('quick-order-submit').disabled = saving || pending > 0;
        ['quick-photo-choose', 'quick-photo-camera', 'quick-lock-type', 'quick-lock-pin', 'quick-lock-pass', 'quick-pattern-clear'].forEach(id => { el(id).disabled = saving; });
        el('quick-pattern-canvas').style.pointerEvents = saving ? 'none' : '';
    }
    function showAccess() {
        el('quick-pin-group').classList.toggle('hidden', type.value !== 'PIN');
        el('quick-password-group').classList.toggle('hidden', type.value !== 'Contraseña');
        el('quick-pattern-group').classList.toggle('hidden', type.value !== 'Patrón');
        if (type.value !== 'PIN') el('quick-lock-pin').value = '';
        if (type.value !== 'Contraseña') el('quick-lock-pass').value = '';
        if (type.value !== 'Patrón') pad.clear();
    }
    function render() {
        const preview = el('quick-photo-previews');
        preview.replaceChildren();
        photos.forEach((photo, index) => {
            const item = document.createElement('div');
            item.className = 'quick-photo-item';
            const img = document.createElement('img');
            img.src = photo; img.alt = `Evidencia ${index + 1}`;
            const remove = document.createElement('button');
            remove.type = 'button'; remove.className = 'btn btn-secondary btn-sm';
            remove.textContent = '×'; remove.setAttribute('aria-label', `Eliminar foto ${index + 1}`);
            remove.disabled = saving;
            remove.addEventListener('click', () => { if (!saving) { photos.splice(index, 1); render(); } });
            item.append(img, remove); preview.appendChild(item);
        });
    }
    function addFiles(files) {
        if (saving || !files?.length) return;
        const batch = Array.from(files);
        const version = generation;
        pending++; setButtons(); status.textContent = 'Preparando fotos…';
        queue = queue.then(async () => {
            let warning = '';
            for (const file of batch) {
                if (version !== generation) return;
                if (photos.length >= 12) { warning = 'Puedes adjuntar hasta 12 fotos.'; break; }
                if (photoBytes() + Math.ceil(file.size / 3) * 4 + 32 > 20 * 1024 * 1024) { warning = 'Las fotos no deben superar 15 MB en total.'; continue; }
                const read = await readOrderPhotoFiles([file], { maxBytes: 8 * 1024 * 1024, onError: message => { warning = message; } });
                if (version !== generation) return;
                photos.push(...read); render();
            }
            if (version === generation) status.textContent = warning || `${photos.length} foto(s) listas.`;
        }).catch(() => { if (version === generation) status.textContent = 'No se pudieron preparar las fotos. Intenta nuevamente.'; })
            .finally(() => { if (version === generation) { pending--; setButtons(); } });
    }
    type.addEventListener('change', showAccess);
    el('quick-photo-choose').addEventListener('click', () => el('quick-photo-files').click());
    el('quick-photo-camera').addEventListener('click', () => el('quick-photo-capture').click());
    for (const id of ['quick-photo-files', 'quick-photo-capture']) el(id).addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
    const drop = el('quick-photo-drop');
    for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) drop.addEventListener(eventName, event => {
        event.preventDefault(); drop.classList.toggle('is-dragover', eventName === 'dragenter' || eventName === 'dragover');
        if (eventName === 'drop') addFiles(event.dataTransfer?.files);
    });
    globalThis.quickOrderExtras = {
        reset() {
            generation++; photos = []; pending = 0; saving = false;
            type.value = 'Ninguno'; pad.clear(); showAccess(); render(); setButtons(); status.textContent = '';
            el('quick-photo-files').value = ''; el('quick-photo-capture').value = '';
        },
        isLoading: () => pending > 0,
        setBusy(value) { saving = value; setButtons(); render(); },
        payload() {
            return { lock_type: type.value,
                lock_pin: type.value === 'PIN' ? el('quick-lock-pin').value || null : null,
                lock_pass: type.value === 'Contraseña' ? el('quick-lock-pass').value || null : null,
                lock_pattern: type.value === 'Patrón' ? el('quick-lock-pattern').value || null : null,
                evidenciasNuevas: photos.slice() };
        }
    };
})();
