// app.js - Lógica interactiva y conexión API para el Sistema Gestor de AllFix Bacalar

// ==========================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
const APP_STATE = {
    currentUser: null, // Guardado en sesión
    currentRole: 'Administrador', // Administrador, Técnico, Recepcionista
    clientes: [],
    ordenes: [],
    inventario: [],
    ventas: [],
    usuarios: [],
    cart: [],
    selectedOrderPayment: null,
    selectedOrderForReceipt: null,
    selectedSaleForReceipt: null,
    selectedCajaForReceipt: null,
    cotizaciones: [],
    eventos: [],
    garantias: [],
    garantiaStats: null,
    cajaActiva: null,
    cajaHistorial: [],
    notifications: [],
    cotizacionesPollId: null,
    currentOrderParts: [],
    selectedOrderPart: null,
    currentWarrantyCostParts: []
};

const BASE_API_URL = String(
    window.SISTEMA_GESTOR_API_URL ||
    window.APP_CONFIG?.API_URL ||
    '/api'
).replace(/\/$/, '');
let currentInventorySection = 'refacciones';
const ORDER_PHOTO_FIELDS = [
    { key: 'recepcion', label: 'Recepción' },
    { key: 'diagnostico', label: 'Diagnóstico' },
    { key: 'reparacion', label: 'Reparación' },
    { key: 'entrega', label: 'Listo / Entrega' }
];
const ORDER_PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const WARRANTY_PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ORDER_STATUS_THEMES = {
    recibido: { color: '#2563eb', badgeClass: 'status-recibido' },
    diagnostico: { color: '#06b6d4', badgeClass: 'status-diagnostico' },
    esperando_pieza: { color: '#8b5cf6', badgeClass: 'status-refaccion' },
    reparacion: { color: '#f59e0b', badgeClass: 'status-reparacion' },
    retrasado: { color: '#ef4444', badgeClass: 'status-retrasado' },
    listo: { color: '#10b981', badgeClass: 'status-listo' },
    terminado: { color: '#0d9488', badgeClass: 'status-terminado' },
    entregado: { color: '#22c55e', badgeClass: 'status-entregado' },
    esperando_autorizacion: { color: '#f59e0b', badgeClass: 'status-autorizacion' },
    cancelado: { color: '#ef4444', badgeClass: 'status-cancelado' },
    default: { color: '#64748b', badgeClass: 'status-default' }
};

function normalizeInventoryItem(item) {
    return {
        ...item,
        costo: Number(item?.costo ?? 0),
        precio: Number(item?.precio ?? 0),
        stock: Number(item?.stock ?? 0),
        stock_minimo: Number(item?.stock_minimo ?? 0)
    };
}

function normalizeVenta(venta) {
    return {
        ...venta,
        subtotal: Number(venta?.subtotal ?? venta?.total ?? 0),
        descuento: Number(venta?.descuento ?? 0),
        total: Number(venta?.total ?? 0),
        monto_recibido: Number(venta?.monto_recibido ?? 0),
        efectivo_recibido: Number(venta?.efectivo_recibido ?? venta?.monto_recibido ?? 0),
        transferencia_recibida: Number(venta?.transferencia_recibida ?? 0),
        referencia_transferencia: venta?.referencia_transferencia || '',
        observaciones_ticket: venta?.observaciones_ticket || '',
        cambio: Number(venta?.cambio ?? 0),
        items: (venta?.items || []).map(item => ({
            ...item,
            cantidad: Number(item?.cantidad ?? 0),
            precio_unitario: Number(item?.precio_unitario ?? 0),
            subtotal: Number(item?.subtotal ?? 0)
        }))
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatCurrency(value) {
    const number = Number(value || 0);
    return `$${(Number.isFinite(number) ? number : 0).toFixed(2)}`;
}

function todayDateString() {
    return new Date().toISOString().split('T')[0];
}

function addDaysToDate(dateValue, daysValue) {
    const date = new Date(`${dateValue || todayDateString()}T00:00:00`);
    date.setDate(date.getDate() + (parseInt(daysValue, 10) || 0));
    return date.toISOString().split('T')[0];
}

function formatDateOnly(value) {
    if (!value) return '-';
    const raw = String(value).slice(0, 10);
    const [year, month, day] = raw.split('-');
    return year && month && day ? `${day}/${month}/${year}` : raw;
}

function formatTicketAmount(value) {
    const numeric = Number(String(value ?? 0).replace(/[^0-9.-]/g, ''));
    const safeNumber = Number.isFinite(numeric) ? numeric : 0;
    return safeNumber % 1 === 0 ? `$${safeNumber.toFixed(0)}` : `$${safeNumber.toFixed(2)}`;
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizeScannedCode(value) {
    return String(value || '')
        .trim()
        .replace(/[‘’´`'"]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/-+/g, '-');
}

function getOrderStatusTheme(status) {
    const normalized = normalizeText(status);
    if (normalized === 'recibido') return ORDER_STATUS_THEMES.recibido;
    if (normalized.includes('diagnostico')) return ORDER_STATUS_THEMES.diagnostico;
    if (normalized.includes('refaccion') || normalized.includes('pieza')) return ORDER_STATUS_THEMES.esperando_pieza;
    if (normalized.includes('reparacion')) return ORDER_STATUS_THEMES.reparacion;
    if (normalized.includes('retrasado')) return ORDER_STATUS_THEMES.retrasado;
    if (normalized.includes('terminado')) return ORDER_STATUS_THEMES.terminado;
    if (normalized.includes('entregado')) return ORDER_STATUS_THEMES.entregado;
    if (normalized.includes('listo')) return ORDER_STATUS_THEMES.listo;
    if (normalized.includes('autorizacion')) return ORDER_STATUS_THEMES.esperando_autorizacion;
    if (normalized.includes('cancelado')) return ORDER_STATUS_THEMES.cancelado;
    return ORDER_STATUS_THEMES.default;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function getOrderPhotos(orderOrPhotos) {
    const raw = orderOrPhotos?.fotos || orderOrPhotos?.fotografias || orderOrPhotos || [];
    let parsed = raw;

    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            parsed = [];
        }
    }

    if (Array.isArray(parsed)) {
        return parsed.filter(Boolean);
    }

    if (parsed && typeof parsed === 'object') {
        return ORDER_PHOTO_FIELDS.map(field => parsed[field.key]).filter(Boolean);
    }

    return [];
}

function renderOrderPhotoPreviews(photos = []) {
    const list = document.getElementById('order-photos-preview-list');
    const form = document.getElementById('order-form');
    const countLabel = document.getElementById('order-photo-count');
    if (!list) return;

    const normalizedPhotos = getOrderPhotos(photos);
    if (form) form.dataset.currentPhotos = JSON.stringify(normalizedPhotos);
    if (countLabel) countLabel.textContent = `${normalizedPhotos.length} ${normalizedPhotos.length === 1 ? 'foto' : 'fotos'}`;

    if (normalizedPhotos.length === 0) {
        list.innerHTML = `
            <div class="photo-empty-state photo-empty-state-large">
                <i class="fa-regular fa-images"></i>
                <span>Sin fotos cargadas</span>
            </div>
        `;
        return;
    }

    list.innerHTML = normalizedPhotos.map((src, index) => `
        <div class="order-photo-thumb">
            <img src="${src}" alt="Foto de evidencia ${index + 1}">
            <span class="order-photo-index">Foto ${index + 1}</span>
            <button type="button" class="order-photo-remove" data-photo-index="${index}" title="Eliminar foto">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `).join('');

    list.querySelectorAll('[data-photo-index]').forEach(button => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.photoIndex);
            const nextPhotos = getOrderPhotos(form?.dataset.currentPhotos || []);
            nextPhotos.splice(index, 1);
            renderOrderPhotoPreviews(nextPhotos);
        });
    });
}

function evidenceDefaultVisible(estado) {
    const normalized = String(estado || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return ['recibido', 'diagnostico', 'listo para entregar', 'entregado'].includes(normalized);
}

function updateEvidenceStateUI() {
    const status = document.getElementById('form-order-status')?.value || 'Recibido';
    const label = document.getElementById('evidence-current-state');
    const dropState = document.getElementById('photo-drop-state');
    const visibleInput = document.getElementById('evidence-visible-client');
    if (label) label.textContent = status;
    if (dropState) dropState.textContent = `Se guardarán en ${status}`;
    if (visibleInput && !visibleInput.dataset.touched) {
        visibleInput.checked = evidenceDefaultVisible(status);
    }
}

function renderEvidenceHistory(order = {}) {
    const container = document.getElementById('order-evidence-history');
    const countLabel = document.getElementById('evidence-history-count');
    if (!container) return;

    const groups = Array.isArray(order.evidenciasPorEstado) ? order.evidenciasPorEstado : [];
    const evidenceCount = groups.reduce((total, group) => total + (Array.isArray(group.fotos) ? group.fotos.length : 0), 0);
    if (countLabel) countLabel.textContent = `${evidenceCount} ${evidenceCount === 1 ? 'evidencia' : 'evidencias'}`;

    if (groups.length === 0) {
        container.innerHTML = `
            <div class="photo-empty-state photo-empty-state-large">
                <i class="fa-regular fa-folder-open"></i>
                <span>Sin evidencias registradas</span>
            </div>
        `;
        return;
    }

    container.innerHTML = groups.map(group => {
        const fotos = Array.isArray(group.fotos) ? group.fotos : [];
        const photosHtml = fotos.map(photo => `
            <div class="evidence-history-photo">
                <img src="${photo.url_imagen || photo.url}" alt="Evidencia ${escapeHtml(group.estado)}">
                <button type="button" class="order-photo-remove" data-evidence-id="${photo.id}" title="Eliminar evidencia">
                    <i class="fa-solid fa-xmark"></i>
                </button>
                <span class="evidence-visibility-badge ${photo.visible_cliente ? 'visible' : 'private'}">
                    ${photo.visible_cliente ? 'Cliente' : 'Interna'}
                </span>
            </div>
        `).join('');

        return `
            <section class="evidence-history-group">
                <div class="evidence-history-head">
                    <div>
                        <strong>${escapeHtml(group.estado)}</strong>
                        <span>${group.fecha ? new Date(group.fecha).toLocaleString('es-MX') : 'Sin fecha'}</span>
                    </div>
                    <small>${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'} · ${escapeHtml(group.usuario || 'Usuario no registrado')}</small>
                </div>
                ${group.comentario ? `<p>${escapeHtml(group.comentario)}</p>` : ''}
                <div class="evidence-history-grid">${photosHtml || '<span class="text-muted">Sin fotos.</span>'}</div>
            </section>
        `;
    }).join('');

    container.querySelectorAll('[data-evidence-id]').forEach(button => {
        button.addEventListener('click', async () => {
            const orderId = document.getElementById('form-order-id')?.value;
            const evidenceId = button.dataset.evidenceId;
            if (!orderId || !evidenceId) return;
            if (!confirm('¿Eliminar esta evidencia?')) return;

            const response = await fetch(`${BASE_API_URL}/ordenes/${orderId}/evidencias/${evidenceId}`, { method: 'DELETE' });
            if (!response.ok) {
                alert('No se pudo eliminar la evidencia.');
                return;
            }

            const refreshed = await fetch(`${BASE_API_URL}/ordenes/${orderId}`).then(res => res.json());
            renderEvidenceHistory(refreshed);
            loadAllData();
        });
    });
}
function getInventoryCategoryGroup(category) {
    const normalized = String(category || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (normalized.startsWith('accesorio')) return 'Accesorios';
    if (normalized.startsWith('refaccion')) return 'Refacciones';
    return 'Refacciones';
}

function normalizeSessionUser(rawUser) {
    if (!rawUser) return null;

    const payload = rawUser.user || rawUser;
    if (!payload) return null;

    return {
        ...payload,
        id: payload.id ?? payload.userId,
        username: payload.username ?? payload.user ?? payload.email,
        rol: payload.rol ?? payload.role,
        nombre: payload.nombre ?? payload.name ?? payload.username ?? payload.user
    };
}

function getStoredSession() {
    const savedUser = sessionStorage.getItem('allfix_user');
    if (!savedUser) return null;
    try {
        return JSON.parse(savedUser);
    } catch (err) {
        console.error('No se pudo leer la sesión guardada:', err);
        return null;
    }
}

function getAuthToken() {
    const sessionData = getStoredSession();
    return sessionData?.token || null;
}

function clearSessionState() {
    sessionStorage.removeItem('allfix_user');
    APP_STATE.currentUser = null;
    APP_STATE.currentRole = 'Administrador';
    stopCotizacionesPolling();
}

function decodeJwtPayload(token) {
    if (!token || typeof token !== 'string') return null;
    const payload = token.split('.')[1];
    if (!payload) return null;

    try {
        const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
        const paddedPayload = normalizedPayload.padEnd(normalizedPayload.length + ((4 - normalizedPayload.length % 4) % 4), '=');
        return JSON.parse(atob(paddedPayload));
    } catch (err) {
        console.warn('No se pudo leer la sesión guardada:', err);
        return null;
    }
}

function isTokenExpired(token) {
    const payload = decodeJwtPayload(token);
    if (!payload?.exp) return false;
    return Date.now() >= payload.exp * 1000;
}

function persistSession(sessionData) {
    const normalizedUser = normalizeSessionUser(sessionData);
    sessionStorage.setItem('allfix_user', JSON.stringify({
        ...(sessionData || {}),
        user: normalizedUser,
        token: sessionData?.token || null
    }));
}

const originalFetch = window.fetch.bind(window);
window.fetch = async function(resource, options = {}) {
    const token = getAuthToken();
    const headers = new Headers(options.headers || {});

    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    if (options.body instanceof FormData) {
        if (headers.has('Content-Type')) headers.delete('Content-Type');
    } else if (!headers.has('Content-Type') && options.body !== undefined) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await originalFetch(resource, { ...options, headers });
    const requestUrl = typeof resource === 'string' ? resource : resource?.url || '';
    const isLoginRequest = requestUrl.includes('/api/auth/login');

    if (!isLoginRequest && response.status === 401 && token) {
        const clonedResponse = response.clone();
        const errorPayload = await clonedResponse.json().catch(() => ({}));
        const errorMessage = String(errorPayload.error || '').toLowerCase();
        if (errorMessage.includes('token')) {
            clearSessionState();
            showLoginContainer();
        }
    }

    return response;
};

// ==========================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await loadEstablishmentConfig();
    initNavigation();
    initLogin();
    await initInitialSetup();
    initNotifications();
    initClientAutocomplete();
    initDeviceAutocomplete();
    initPatternLock();
    initSignaturePad();
    initOrderFormTabs();
    initOrderPhotoInputs();
    initOrderPartsUI();
    initAutoGrowTextareas();
    initOrderRegistration();
    initPOS();
    initCaja();
    initReportFilters();
    initUsuarios();
    initEstablishmentConfigForm();
    initPrinterConfigForm();
    initCotizaciones();
    initCalendarioEvents();
    checkSession();
});

// ==========================================
// NAVEGACIÓN Y LOGUEO
// ==========================================
function checkSession() {
    const sessionData = getStoredSession();
    if (sessionData) {
        const user = normalizeSessionUser(sessionData);
        if (!user || isTokenExpired(sessionData.token)) {
            clearSessionState();
            showLoginContainer();
            if (user && isTokenExpired(sessionData.token)) {
                alert('Tu sesión expiró. Inicia sesión nuevamente para guardar cambios.');
            }
            return;
        }

        APP_STATE.currentUser = user;
        APP_STATE.currentRole = user.rol || 'Administrador';
        updateSidebarProfile(user);
        document.getElementById('sidebar-avatar').innerText = (user.nombre || user.username || 'U').charAt(0).toUpperCase();
        
        showAppContainer();
    } else {
        showLoginContainer();
    }
}

function updateSidebarProfile(user) {
    const displayName = user?.nombre || user?.username || 'Usuario';
    const role = user?.rol || APP_STATE.currentRole || 'Usuario';
    const usernameEl = document.getElementById('sidebar-username');
    if (usernameEl) {
        usernameEl.innerText = `${displayName} (${role})`;
    }
}

function showLoginContainer() {
    document.getElementById('login-container').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
}

function showAppContainer() {
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    loadEstablishmentConfig().then(syncConfigForms);
    applyRolePermissions();
    loadAllData();
    startCotizacionesPolling();
}

function initLogin() {
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const errorMsg = document.getElementById('login-error-msg');

        errorMsg.classList.add('hidden');

        try {
            const response = await fetch(`${BASE_API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (response.ok) {
                const userObj = await response.json();
                const normalizedUser = normalizeSessionUser(userObj);
                if (normalizedUser) {
                    persistSession(userObj);
                    checkSession();
                } else {
                    errorMsg.classList.remove('hidden');
                }
            } else {
                errorMsg.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Error during login fetch:', err);
            errorMsg.classList.remove('hidden');
        }
    });

    const logoutButton = document.getElementById('btn-logout');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            stopCotizacionesPolling();
            sessionStorage.removeItem('allfix_user');
            showLoginContainer();
        });
    }

    const registerLink = document.getElementById('btn-register-link');
    if (registerLink) {
        registerLink.addEventListener('click', () => {
            alert("El registro de nuevos operadores se realiza desde el módulo de Configuración.");
        });
    }
    applyRolePermissions();
}

async function initInitialSetup() {
    const setupPanel = document.getElementById('setup-initial-panel');
    const showSetupButton = document.getElementById('btn-show-setup-admin');
    const setupForm = document.getElementById('setup-admin-form');
    const setupMessage = document.getElementById('setup-admin-message');
    const forgotForm = document.getElementById('forgot-password-form');
    const resetForm = document.getElementById('reset-password-form');

    if (!setupPanel || !showSetupButton || !setupForm || !setupMessage) return;

    showSetupButton.addEventListener('click', () => {
        showSetupButton.classList.add('hidden');
        setupForm.classList.remove('hidden');
        document.getElementById('setup-admin-name')?.focus();
    });

    document.querySelectorAll('[data-setup-toggle-password]').forEach(button => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.setupTogglePassword);
            const icon = button.querySelector('i');
            if (!input) return;

            const shouldShow = input.type === 'password';
            input.type = shouldShow ? 'text' : 'password';
            button.setAttribute('aria-label', shouldShow ? 'Ocultar contrasena' : 'Mostrar contrasena');
            icon?.classList.toggle('fa-eye', !shouldShow);
            icon?.classList.toggle('fa-eye-slash', shouldShow);
        });
    });

    document.getElementById('btn-show-forgot-password')?.addEventListener('click', () => {
        setLoginCardMode('forgot');
        document.getElementById('forgot-password-email')?.focus();
    });

    document.getElementById('btn-cancel-forgot-password')?.addEventListener('click', () => {
        forgotForm?.reset();
        clearAuthMessage('forgot-password-message');
        setLoginCardMode('login');
    });

    document.getElementById('btn-cancel-reset-password')?.addEventListener('click', () => {
        resetForm?.reset();
        clearAuthMessage('reset-password-message');
        window.history.replaceState({}, document.title, window.location.pathname);
        setLoginCardMode('login');
    });

    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nombre = document.getElementById('setup-admin-name')?.value.trim() || '';
        const username = document.getElementById('setup-admin-username')?.value.trim() || '';
        const correo = document.getElementById('setup-admin-email')?.value.trim() || '';
        const telefono = document.getElementById('setup-admin-phone')?.value.trim() || '';
        const password = document.getElementById('setup-admin-password')?.value || '';
        const confirmPassword = document.getElementById('setup-admin-password-confirm')?.value || '';
        const submitButton = document.getElementById('btn-create-setup-admin');

        if (password !== confirmPassword) {
            showSetupAdminMessage('Las contrasenas no coinciden.', 'error');
            return;
        }

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerText = 'Creando...';
        }

        try {
            const response = await fetch(`${BASE_API_URL}/setup/create-admin`, {
                method: 'POST',
                body: JSON.stringify({ username, password, nombre, correo, telefono })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                showSetupAdminMessage(data.error || 'No se pudo crear el administrador.', 'error');
                return;
            }

            setupForm.reset();
            showSetupAdminMessage(data.message || 'Administrador creado correctamente.', 'success');
            setTimeout(() => {
                setLoginCardMode('login');
                refreshInitialSetupStatus();
                document.getElementById('login-username')?.focus();
            }, 1400);
        } catch (error) {
            console.error('Error durante configuracion inicial:', error);
            showSetupAdminMessage('No se pudo conectar con el servidor.', 'error');
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerText = 'Crear administrador';
            }
        }
    });

    forgotForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const correo = document.getElementById('forgot-password-email')?.value.trim() || '';
        try {
            const response = await fetch(`${BASE_API_URL}/auth/forgot-password`, {
                method: 'POST',
                body: JSON.stringify({ correo })
            });
            const data = await response.json().catch(() => ({}));
            showAuthMessage('forgot-password-message', data.message || 'Si el correo esta registrado, enviaremos instrucciones.', 'success');
        } catch (error) {
            console.error('Error al solicitar recuperacion:', error);
            showAuthMessage('forgot-password-message', 'No se pudo solicitar la recuperacion.', 'error');
        }
    });

    resetForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = new URLSearchParams(window.location.search).get('reset_token') || '';
        const password = document.getElementById('reset-password-new')?.value || '';
        const confirmPassword = document.getElementById('reset-password-confirm')?.value || '';

        if (password !== confirmPassword) {
            showAuthMessage('reset-password-message', 'Las contrasenas no coinciden.', 'error');
            return;
        }

        try {
            const response = await fetch(`${BASE_API_URL}/auth/reset-password`, {
                method: 'POST',
                body: JSON.stringify({ token, password })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                showAuthMessage('reset-password-message', data.error || 'El enlace no es valido o expiro.', 'error');
                return;
            }

            resetForm.reset();
            showAuthMessage('reset-password-message', data.message || 'Contrasena actualizada correctamente.', 'success');
            window.history.replaceState({}, document.title, window.location.pathname);
            setTimeout(() => setLoginCardMode('login'), 1400);
        } catch (error) {
            console.error('Error al restablecer contrasena:', error);
            showAuthMessage('reset-password-message', 'No se pudo restablecer la contrasena.', 'error');
        }
    });

    await refreshInitialSetupStatus();

    if (new URLSearchParams(window.location.search).get('reset_token')) {
        setLoginCardMode('reset');
        document.getElementById('reset-password-new')?.focus();
    }
}

async function refreshInitialSetupStatus() {
    try {
        const response = await fetch(`${BASE_API_URL}/setup/user-creation-status`, {
            method: 'GET',
            cache: 'no-store'
        });

        if (!response.ok) {
            setInitialSetupVisible(false, {});
            return;
        }

        const data = await response.json();
        setInitialSetupVisible(Boolean(data.canCreateAdmin), data);
    } catch (error) {
        console.warn('No se pudo consultar configuracion inicial:', error);
        setInitialSetupVisible(false, {});
    }
}

function setInitialSetupVisible(isVisible, state = {}) {
    const setupPanel = document.getElementById('setup-initial-panel');
    const showSetupButton = document.getElementById('btn-show-setup-admin');
    const setupForm = document.getElementById('setup-admin-form');
    const setupCopy = document.getElementById('setup-initial-copy');

    setupPanel?.classList.toggle('hidden', !isVisible);

    if (setupCopy) {
        setupCopy.textContent = state.setupRequired
            ? 'No se encontro un administrador. Crea el primer acceso seguro para comenzar.'
            : 'La creacion temporal de administradores esta habilitada. Crea tu nuevo acceso y desactivala despues.';
    }

    if (!isVisible) {
        showSetupButton?.classList.remove('hidden');
        setupForm?.classList.add('hidden');
        clearSetupAdminMessage();
    }
}

function setLoginCardMode(mode) {
    const loginForm = document.getElementById('login-form');
    const setupPanel = document.getElementById('setup-initial-panel');
    const forgotForm = document.getElementById('forgot-password-form');
    const resetForm = document.getElementById('reset-password-form');
    const divider = document.querySelector('.login-divider-text');
    const notice = document.querySelector('.login-system-notice');

    if (mode === 'login') {
        loginForm?.classList.remove('hidden');
        forgotForm?.classList.add('hidden');
        resetForm?.classList.add('hidden');
        divider?.classList.remove('hidden');
        notice?.classList.remove('hidden');
    } else if (mode === 'forgot' || mode === 'reset') {
        loginForm?.classList.add('hidden');
        setupPanel?.classList.add('hidden');
        forgotForm?.classList.toggle('hidden', mode !== 'forgot');
        resetForm?.classList.toggle('hidden', mode !== 'reset');
        divider?.classList.add('hidden');
        notice?.classList.add('hidden');
    }
}

function showSetupAdminMessage(message, type) {
    const setupMessage = document.getElementById('setup-admin-message');
    if (!setupMessage) return;

    setupMessage.textContent = message;
    setupMessage.classList.remove('hidden', 'is-error', 'is-success');
    setupMessage.classList.add(type === 'success' ? 'is-success' : 'is-error');
}

function clearSetupAdminMessage() {
    const setupMessage = document.getElementById('setup-admin-message');
    if (!setupMessage) return;

    setupMessage.textContent = '';
    setupMessage.classList.add('hidden');
    setupMessage.classList.remove('is-error', 'is-success');
}

function showAuthMessage(elementId, message, type) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = message;
    element.classList.remove('hidden', 'is-error', 'is-success');
    element.classList.add(type === 'success' ? 'is-success' : 'is-error');
}

function clearAuthMessage(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = '';
    element.classList.add('hidden');
    element.classList.remove('is-error', 'is-success');
}

function initNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const viewName = item.getAttribute('data-view');
            if (item.id === 'inventory-menu-toggle') {
                toggleInventorySubmenu();
                return;
            }
            switchView(viewName);
        });
    });

    document.querySelectorAll('.submenu-item[data-view="inventario"]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            currentInventorySection = item.dataset.inventorySection || 'refacciones';
            switchView('inventario');
            renderInventario();
        });
    });

    // Sidebar triggers para nuevas ordenes
    document.querySelectorAll('.btn-new-order-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
            openOrderModal();
        });
    });

    document.addEventListener('click', (event) => {
        const preview = document.getElementById('order-quick-preview');
        if (!preview || preview.classList.contains('hidden')) return;
        if (preview.contains(event.target) || event.target.closest('.order-click-row')) return;
        hideOrderQuickPreview();
    });
}

function getInputValue(id, fallback = '') {
    return document.getElementById(id)?.value ?? fallback;
}

function setInputValue(id, value = '') {
    const input = document.getElementById(id);
    if (input) input.value = value ?? '';
}

function getCheckboxValue(id) {
    return document.getElementById(id)?.checked ? 1 : 0;
}

function setCheckboxValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.checked = value === 1 || value === true || value === '1';
}

function getRadioValue(name, fallback = '') {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function setRadioValue(name, value) {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
}

function splitFullClientName(name = '') {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return { nombres: name || '', apellidoPaterno: '', apellidoMaterno: '' };
    if (parts.length === 2) return { nombres: parts[0], apellidoPaterno: parts[1], apellidoMaterno: '' };
    return {
        nombres: parts.slice(0, -2).join(' '),
        apellidoPaterno: parts[parts.length - 2],
        apellidoMaterno: parts[parts.length - 1]
    };
}

function normalizeClientLookupText(value) {
    return normalizeText(value).trim().replace(/\s+/g, ' ');
}

function normalizeClientPhone(value) {
    return String(value || '').replace(/\D/g, '');
}

function joinClientLastNames(apellidoPaterno = '', apellidoMaterno = '') {
    return [apellidoPaterno, apellidoMaterno].map(value => String(value || '').trim()).filter(Boolean).join(' ');
}

function readCompoundLastName(tokens, startIndex = 0) {
    const normalized = index => normalizeClientLookupText(tokens[index] || '');
    if (normalized(startIndex) === 'de' && normalized(startIndex + 1) === 'la' && tokens[startIndex + 2]) {
        return { value: tokens.slice(startIndex, startIndex + 3).join(' '), nextIndex: startIndex + 3 };
    }
    if (normalized(startIndex) === 'de' && normalized(startIndex + 1) === 'los' && tokens[startIndex + 2]) {
        return { value: tokens.slice(startIndex, startIndex + 3).join(' '), nextIndex: startIndex + 3 };
    }
    if ((normalized(startIndex) === 'del' || normalized(startIndex) === 'de' || normalized(startIndex) === 'san') && tokens[startIndex + 1]) {
        return { value: tokens.slice(startIndex, startIndex + 2).join(' '), nextIndex: startIndex + 2 };
    }
    return null;
}

function splitClientLastNames(lastNames = '') {
    const cleanValue = String(lastNames || '').trim().replace(/\s+/g, ' ');
    const tokens = cleanValue.split(' ').filter(Boolean);
    if (tokens.length === 0) return { apellidoPaterno: '', apellidoMaterno: '' };
    if (tokens.length === 1) return { apellidoPaterno: tokens[0], apellidoMaterno: '' };
    if (tokens.length === 2) return { apellidoPaterno: tokens[0], apellidoMaterno: tokens[1] };

    // Conservative rule: split clear compound surnames; preserve ambiguous multi-word input together.
    const firstCompound = readCompoundLastName(tokens, 0);
    if (firstCompound) {
        return {
            apellidoPaterno: firstCompound.value,
            apellidoMaterno: tokens.slice(firstCompound.nextIndex).join(' ')
        };
    }

    for (let index = 1; index < tokens.length; index += 1) {
        const secondCompound = readCompoundLastName(tokens, index);
        if (secondCompound && secondCompound.nextIndex === tokens.length) {
            return {
                apellidoPaterno: tokens.slice(0, index).join(' '),
                apellidoMaterno: secondCompound.value
            };
        }
    }

    return { apellidoPaterno: cleanValue, apellidoMaterno: '' };
}

function syncClientLastNameFields() {
    const visualInput = document.getElementById('form-client-lastnames');
    if (!visualInput) return;
    const split = splitClientLastNames(visualInput.value);
    setInputValue('form-client-lastname-paternal', split.apellidoPaterno);
    setInputValue('form-client-lastname-maternal', split.apellidoMaterno);
}

function setClientLastNames(apellidoPaterno = '', apellidoMaterno = '') {
    setInputValue('form-client-lastnames', joinClientLastNames(apellidoPaterno, apellidoMaterno));
    setInputValue('form-client-lastname-paternal', apellidoPaterno || '');
    setInputValue('form-client-lastname-maternal', apellidoMaterno || '');
}

function buildClientFullName() {
    syncClientLastNameFields();
    return [
        getInputValue('form-client-name').trim(),
        getInputValue('form-client-lastname-paternal').trim(),
        getInputValue('form-client-lastname-maternal').trim()
    ].filter(Boolean).join(' ');
}

function getClientStoredLastNames(client = {}) {
    return joinClientLastNames(
        client.apellido_paterno || client.clientLastNamePaternal || '',
        client.apellido_materno || client.clientLastNameMaternal || ''
    );
}

function getClientFirstNames(client = {}) {
    const rawName = String(client.nombre || client.clientName || '').trim().replace(/\s+/g, ' ');
    const storedLastNames = getClientStoredLastNames(client);
    if (!storedLastNames) return splitFullClientName(rawName).nombres;

    const nameTokens = rawName.split(/\s+/).filter(Boolean);
    const lastTokens = storedLastNames.split(/\s+/).filter(Boolean);
    const hasLastNameSuffix = lastTokens.length > 0
        && nameTokens.length > lastTokens.length
        && lastTokens.every((token, index) => normalizeClientLookupText(token) === normalizeClientLookupText(nameTokens[nameTokens.length - lastTokens.length + index]));

    return hasLastNameSuffix ? nameTokens.slice(0, -lastTokens.length).join(' ') : rawName;
}

function getClientDisplayName(client = {}) {
    const firstNames = getClientFirstNames(client);
    const lastNames = getClientStoredLastNames(client);
    return [firstNames, lastNames].filter(Boolean).join(' ') || client.nombre || 'Cliente sin nombre';
}

function maskClientPhone(phone = '') {
    const digits = normalizeClientPhone(phone);
    if (!digits) return 'Sin telefono';
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 3)}${'x'.repeat(Math.max(0, digits.length - 6))}${digits.slice(-3)}`;
}

function getClientPhones(client = {}) {
    return [
        client.telefono,
        client.telefono_principal,
        client.telefono_alt1,
        client.telefono_alt2,
        client.telefono_alt3,
        client.telefono_alternativo_1,
        client.telefono_alternativo_2,
        client.telefono_alternativo_3
    ].map(normalizeClientPhone).filter(Boolean);
}

function getClientSearchText(client = {}) {
    return normalizeClientLookupText([
        client.id,
        getClientFirstNames(client),
        client.apellido_paterno,
        client.apellido_materno,
        getClientDisplayName(client),
        client.nombre,
        client.telefono,
        client.telefono_principal,
        client.telefono_alt1
    ].filter(Boolean).join(' '));
}

function scoreClientSearch(client, query) {
    const normalizedQuery = normalizeClientLookupText(query);
    const displayName = normalizeClientLookupText(getClientDisplayName(client));
    const searchText = getClientSearchText(client);
    if (displayName === normalizedQuery || normalizeClientPhone(query) && getClientPhones(client).includes(normalizeClientPhone(query))) return 0;
    if (displayName.startsWith(normalizedQuery)) return 1;
    if (searchText.split(' ').some(token => token.startsWith(normalizedQuery))) return 2;
    return 3;
}

function findClientSearchMatches(query) {
    const normalizedQuery = normalizeClientLookupText(query);
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    if (queryTokens.length === 0) return [];

    return (APP_STATE.clientes || [])
        .filter(client => {
            const searchable = getClientSearchText(client);
            return queryTokens.every(token => searchable.includes(token));
        })
        .sort((a, b) => scoreClientSearch(a, normalizedQuery) - scoreClientSearch(b, normalizedQuery))
        .slice(0, 10);
}

function findClientDuplicateFromInputs() {
    syncClientLastNameFields();
    const form = document.getElementById('order-form');
    const selectedClientId = form?.dataset.selectedClientId || '';
    const fullName = normalizeClientLookupText(buildClientFullName());
    const phone = normalizeClientPhone(getInputValue('form-client-phone'));
    if (!fullName && !phone) return null;

    let possibleMatch = null;
    for (const client of (APP_STATE.clientes || [])) {
        if (selectedClientId && String(client.id) === String(selectedClientId)) continue;
        const clientFullName = normalizeClientLookupText(getClientDisplayName(client));
        const phoneMatch = phone && getClientPhones(client).includes(phone);
        const fullNameMatch = fullName && clientFullName === fullName;
        if (phoneMatch) return { type: 'strong', reason: 'phone', client, fullNameMatch };
        if (!possibleMatch && fullNameMatch) {
            possibleMatch = { type: 'possible', reason: 'name', client, fullNameMatch };
        }
    }
    return possibleMatch;
}

function updateOrderConditionalFields() {
    const accOtherGroup = document.getElementById('acc-otro-group');
    const accOtherInput = document.getElementById('form-acc-otro-text');
    const inspectionOtherGroup = document.getElementById('inspeccion-otro-group');
    const inspectionOtherInput = document.getElementById('form-inspeccion-obs');

    const showAccOther = document.getElementById('chk-acc-otro')?.checked;
    accOtherGroup?.classList.toggle('hidden', !showAccOther);
    if (!showAccOther && accOtherInput) accOtherInput.value = '';

    const showInspectionOther = document.getElementById('chk-vis-otro')?.checked;
    inspectionOtherGroup?.classList.toggle('hidden', !showInspectionOther);
    if (!showInspectionOther && inspectionOtherInput) inspectionOtherInput.value = '';
}

function initNotifications() {
    const trigger = document.getElementById('notifications-trigger');
    const drawer = document.getElementById('notifications-drawer');
    const closeButton = document.getElementById('btn-close-notifications');

    if (!trigger || !drawer) return;

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        renderNotificationsDrawer();
        drawer.classList.toggle('hidden');
    });

    if (closeButton) {
        closeButton.addEventListener('click', () => {
            drawer.classList.add('hidden');
        });
    }

    document.addEventListener('click', (e) => {
        if (!drawer.classList.contains('hidden') && !drawer.contains(e.target) && !trigger.contains(e.target)) {
            drawer.classList.add('hidden');
        }
    });
}

function renderNotificationsDrawer() {
    const list = document.getElementById('notifications-list');
    if (!list) return;

    if (!APP_STATE.notifications.length) {
        list.innerHTML = '<div class="text-muted text-center">Sin alertas pendientes.</div>';
        return;
    }

    list.innerHTML = APP_STATE.notifications.map((notification, index) => {
        let icon = 'fa-circle-info';
        if (notification.type === 'danger') icon = 'fa-circle-exclamation';
        if (notification.type === 'warning') icon = 'fa-triangle-exclamation';
        if (notification.type === 'success') icon = 'fa-circle-check';

        return `
            <div class="alert-list-item ${notification.type} ${notification.action ? 'notification-clickable' : ''}" data-notification-index="${index}">
                <i class="fa-solid ${icon}"></i>
                <div class="alert-item-content">
                    <span class="alert-item-title">${notification.title}</span>
                    <span class="alert-item-desc">${notification.desc}</span>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('[data-notification-index]').forEach(item => {
        item.addEventListener('click', () => {
            const notification = APP_STATE.notifications[Number(item.dataset.notificationIndex)];
            handleNotificationClick(notification);
        });
    });
}

function startCotizacionesPolling() {
    if (APP_STATE.cotizacionesPollId) return;

    APP_STATE.cotizacionesPollId = setInterval(async () => {
        if (!APP_STATE.currentUser) return;

        const previousPendingIds = new Set(
            APP_STATE.cotizaciones
                .filter(q => q.estado === 'Pendiente')
                .map(q => q.id)
        );
        const previousLowStockIds = new Set(
            APP_STATE.inventario
                .filter(p => p.stock <= p.stock_minimo)
                .map(p => p.id)
        );

        await Promise.all([loadCotizaciones(), loadInventario()]);
        updateQuotesMenuBadge();
        updateInventoryMenuBadge();

        const hasNewPendingQuote = APP_STATE.cotizaciones.some(q => q.estado === 'Pendiente' && !previousPendingIds.has(q.id));
        const hasNewLowStock = APP_STATE.inventario.some(p => p.stock <= p.stock_minimo && !previousLowStockIds.has(p.id));
        if (hasNewPendingQuote || hasNewLowStock || !document.getElementById('notifications-drawer')?.classList.contains('hidden')) {
            renderDashboard();
            renderNotificationsDrawer();
        }

        const activeCotizacionesView = !document.getElementById('view-cotizaciones')?.classList.contains('hidden');
        if (activeCotizacionesView) {
            renderCotizaciones();
        }
    }, 15000);
}

function stopCotizacionesPolling() {
    if (!APP_STATE.cotizacionesPollId) return;
    clearInterval(APP_STATE.cotizacionesPollId);
    APP_STATE.cotizacionesPollId = null;
}

function handleNotificationClick(notification) {
    if (!notification || !notification.action) return;

    const drawer = document.getElementById('notifications-drawer');
    if (drawer) drawer.classList.add('hidden');

    if (notification.action === 'openQuote') {
        const statusFilter = document.getElementById('quote-status-filter');
        const searchInput = document.getElementById('quote-search');
        if (statusFilter) statusFilter.value = 'Pendiente';
        if (searchInput) searchInput.value = '';

        switchView('cotizaciones');
        renderCotizaciones();
        setTimeout(() => {
            window.openQuoteDetail(notification.quoteId);
        }, 80);
    }

    if (notification.action === 'openInventory') {
        const searchInput = document.getElementById('inventory-search');
        if (searchInput) searchInput.value = '';
        const item = APP_STATE.inventario.find(p => p.id === notification.itemId);
        currentInventorySection = getInventoryCategoryGroup(item?.categoria).toLowerCase();

        switchView('inventario');
        renderInventario();
        setTimeout(() => {
            focusInventoryItem(notification.itemId);
        }, 80);
    }
}

function updateQuotesMenuBadge() {
    const badge = document.getElementById('quotes-menu-badge');
    if (!badge) return;

    const pendingCount = APP_STATE.cotizaciones.filter(q => q.estado === 'Pendiente').length;
    badge.textContent = pendingCount;
    badge.classList.toggle('hidden', pendingCount === 0);
}

function updateInventoryMenuBadge() {
    const badge = document.getElementById('inventory-menu-badge');
    if (!badge) return;

    const lowStockCount = APP_STATE.inventario.filter(p => p.stock <= p.stock_minimo).length;
    badge.textContent = lowStockCount;
    badge.classList.toggle('hidden', lowStockCount === 0);
}

function toggleInventorySubmenu(forceOpen = null) {
    const submenu = document.getElementById('inventory-submenu');
    const toggle = document.getElementById('inventory-menu-toggle');
    const group = document.getElementById('inventory-menu-group');
    if (!submenu || !toggle || !group) return;

    const shouldOpen = forceOpen ?? submenu.classList.contains('hidden');
    submenu.classList.toggle('hidden', !shouldOpen);
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    group.classList.toggle('open', shouldOpen);
}

function switchView(viewName) {
    // Cambiar clases activas del menu
    document.querySelectorAll('.menu-item').forEach(item => {
        if (item.getAttribute('data-view') === viewName) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    document.querySelectorAll('.submenu-item').forEach(item => {
        const isInventorySubitem = viewName === 'inventario' && item.dataset.inventorySection === currentInventorySection;
        item.classList.toggle('active', isInventorySubitem);
    });
    toggleInventorySubmenu(viewName === 'inventario');

    // Ocultar todas las vistas y mostrar la seleccionada
    document.querySelectorAll('.view-section').forEach(section => {
        if (section.id === `view-${viewName}`) {
            section.classList.remove('hidden');
        } else {
            section.classList.add('hidden');
        }
    });

    // Actualizar título de cabecera
    const viewTitles = {
        dashboard: 'Dashboard General',
        clientes: 'Gestión de Clientes',
        ordenes: 'Órdenes de Servicio',
        cotizaciones: 'Solicitudes de Cotización',
        garantias: 'Garantias',
        inventario: currentInventorySection === 'accesorios' ? 'Inventario de Accesorios' : 'Inventario de Refacciones',
        pos: 'Ventas',
        caja: 'Caja',
        calendario: 'Calendario de Entregas',
        reportes: 'Reportes Financieros',
        configuracion: 'Configuración del Sistema'
    };
    document.getElementById('current-view-title').innerText = viewTitles[viewName] || 'Sistema Gestor';

    // Renderizar FullCalendar al mostrar la vista para evitar problemas de redimensionamiento
    if (viewName === 'calendario' && typeof calendarInstance !== 'undefined' && calendarInstance) {
        setTimeout(() => {
            calendarInstance.render();
        }, 150);
    }

    if (viewName === 'caja') {
        renderCaja();
    }
    if (viewName === 'garantias') {
        renderGarantias();
    }
}

function applyRolePermissions() {
    const role = APP_STATE.currentRole;
    document.querySelectorAll('.admin-only').forEach(el => {
        if (role === 'Administrador') {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    // Restricciones específicas para Técnico
    if (role === 'Técnico') {
        document.querySelectorAll('.btn-new-order-trigger').forEach(el => el.classList.add('hidden'));
        document.getElementById('btn-add-client-modal').classList.add('hidden');
        document.getElementById('btn-add-inventory-modal').classList.add('hidden');
    } else {
        document.querySelectorAll('.btn-new-order-trigger').forEach(el => el.classList.remove('hidden'));
        document.getElementById('btn-add-client-modal').classList.remove('hidden');
        document.getElementById('btn-add-inventory-modal').classList.remove('hidden');
    }
}

// ==========================================
// CARGA DE DATOS DESDE LA API REAL (SQLITE)
// ==========================================
async function loadAllData() {
    try {
        const promises = [
            loadClientes(),
            loadOrdenes(),
            loadInventario(),
            loadVentas(),
            loadCaja(),
            loadCotizaciones(),
            loadEventos(),
            loadGarantias()
        ];
        if (APP_STATE.currentRole === 'Administrador') {
            promises.push(loadUsuarios());
        }
        await Promise.all(promises);
        renderDashboard();
        renderClientes();
        renderOrdenes();
        renderGarantias();
        renderInventario();
        renderCotizaciones();
        renderCalendario();
        renderReportes();
        renderPOSCatalog();
        renderCaja();
        if (APP_STATE.currentRole === 'Administrador') {
            renderUsuarios();
        }
    } catch (error) {
        console.error('Error al cargar datos del backend:', error);
    }
}

async function loadClientes() {
    const response = await fetch(`${BASE_API_URL}/clientes`);
    if (response.ok) {
        APP_STATE.clientes = await response.json();
    }
}

async function loadOrdenes() {
    const response = await fetch(`${BASE_API_URL}/ordenes`);
    if (response.ok) {
        APP_STATE.ordenes = await response.json();
    }
}

async function loadInventario() {
    const response = await fetch(`${BASE_API_URL}/inventario`);
    if (response.ok) {
        APP_STATE.inventario = (await response.json()).map(normalizeInventoryItem);
    }
}

async function loadVentas() {
    const response = await fetch(`${BASE_API_URL}/pos/ventas`);
    if (response.ok) {
        APP_STATE.ventas = (await response.json()).map(normalizeVenta);
    }
}

async function loadCaja() {
    const [activeResponse, historyResponse] = await Promise.all([
        fetch(`${BASE_API_URL}/caja/activa`),
        fetch(`${BASE_API_URL}/caja/historial`)
    ]);

    if (activeResponse.ok) {
        const data = await activeResponse.json();
        APP_STATE.cajaActiva = data.caja || null;
    }

    if (historyResponse.ok) {
        const historial = await historyResponse.json();
        APP_STATE.cajaHistorial = await Promise.all(historial.map(async caja => {
            try {
                const detailResponse = await fetch(`${BASE_API_URL}/caja/${caja.id}`);
                return detailResponse.ok ? await detailResponse.json() : caja;
            } catch (error) {
                console.warn(`No se pudo cargar el detalle de caja #${caja.id}:`, error);
                return caja;
            }
        }));
    }
}

async function loadCotizaciones() {
    const response = await fetch(`${BASE_API_URL}/cotizaciones`);
    if (response.ok) {
        APP_STATE.cotizaciones = await response.json();
    }
}

async function loadEventos() {
    const response = await fetch(`${BASE_API_URL}/calendario/orders`);
    if (response.ok) {
        APP_STATE.eventos = await response.json();
    }
}

async function loadGarantias() {
    const [listResponse, statsResponse] = await Promise.all([
        fetch(`${BASE_API_URL}/garantias`),
        fetch(`${BASE_API_URL}/garantias/estadisticas`)
    ]);
    if (listResponse.ok) {
        APP_STATE.garantias = await listResponse.json();
    }
    if (statsResponse.ok) {
        APP_STATE.garantiaStats = await statsResponse.json();
    }
}

// ==========================================
// RENDER: DASHBOARD
// ==========================================
function renderDashboard() {
    // 1. Contar estados
    const counts = {
        recibido: 0,
        diagnostico: 0,
        reparacion: 0,
        refaccion: 0,
        retrasado: 0,
        listo: 0,
        terminado: 0,
        entregado: 0
    };
    
    APP_STATE.ordenes.forEach(o => {
        const badgeClass = getStatusBadgeClass(o.status);
        if (badgeClass === 'status-recibido') counts.recibido++;
        if (badgeClass === 'status-diagnostico') counts.diagnostico++;
        if (badgeClass === 'status-reparacion') counts.reparacion++;
        if (badgeClass === 'status-refaccion') counts.refaccion++;
        if (badgeClass === 'status-retrasado') counts.retrasado++;
        if (badgeClass === 'status-listo') counts.listo++;
        if (badgeClass === 'status-terminado') counts.terminado++;
        if (badgeClass === 'status-entregado') counts.entregado++;
    });

    document.getElementById('dash-status-recibido').innerText = counts.recibido;
    document.getElementById('dash-status-diagnostico').innerText = counts.diagnostico;
    document.getElementById('dash-status-reparacion').innerText = counts.reparacion;
    document.getElementById('dash-status-refaccion').innerText = counts.refaccion;
    document.getElementById('dash-status-retrasado').innerText = counts.retrasado;
    document.getElementById('dash-status-listo').innerText = counts.listo;
    document.getElementById('dash-status-terminado').innerText = counts.terminado;
    document.getElementById('dash-status-entregado').innerText = counts.entregado;

    // 2. Rellenar tabla de Últimas ordenes
    const tableBody = document.querySelector('#dashboard-orders-table tbody');
    tableBody.innerHTML = '';
    
    const latest = APP_STATE.ordenes.slice(0, 5);
    if (latest.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No hay Órdenes registradas.</td></tr>';
    } else {
        latest.forEach(o => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${o.folio}</strong></td>
                <td>${o.clientName}</td>
                <td>${o.deviceType} ${o.brand} ${o.model}</td>
                <td>${o.falla_reportada || 'Revisión'}</td>
                <td>${o.dateIn}</td>
                <td><span class="badge ${getStatusBadgeClass(o.status)}">${o.status}</span></td>
                <td>
                    <button class="btn btn-xs btn-secondary" onclick="viewOrderDetails(${o.id})"><i class="fa-solid fa-eye"></i></button>
                    <button class="btn btn-xs btn-primary" onclick="editOrderDetails(${o.id})"><i class="fa-solid fa-pen"></i></button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // 3. Generar Alertas dinámicas
    const alertsList = document.getElementById('dashboard-alerts-list');
    alertsList.innerHTML = '';
    APP_STATE.notifications = [];
    updateQuotesMenuBadge();
    updateInventoryMenuBadge();

    const pendingQuotes = APP_STATE.cotizaciones.filter(q => q.estado === 'Pendiente');
    pendingQuotes.forEach(q => {
            const clientName = getQuoteValue(q, ['cliente_nombre', 'nombre'], 'Cliente');
            const device = `${getQuoteValue(q, ['tipo_equipo', 'equipo'], 'Equipo')} ${getQuoteValue(q, ['marca'])} ${getQuoteValue(q, ['modelo'])}`.trim();
            APP_STATE.notifications.push({
                type: 'info',
                title: 'Nueva cotización',
                desc: `${clientName} solicit? cotización para ${device}.`,
                action: 'openQuote',
                quoteId: q.id
            });
    });

    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    let alertsCount = 0;

    // Alertas por entregar hoy/mañana
    APP_STATE.ordenes.forEach(o => {
        if (o.status !== 'Entregado' && o.status !== 'Cancelado') {
            if (o.estimatedDate === todayStr) {
                addAlertItem('warning', 'Entrega Programada Hoy', `Folio ${o.folio} (${o.brand} ${o.model}) vence hoy.`);
                alertsCount++;
            } else if (o.estimatedDate === tomorrowStr) {
                addAlertItem('info', 'Entrega Mañana', `Folio ${o.folio} (${o.brand} ${o.model}) vence mañana.`);
                alertsCount++;
            } else if (o.status === 'Retrasado') {
                addAlertItem('danger', 'Equipo Retrasado', `Folio ${o.folio} marcado como retrasado.`);
                alertsCount++;
            }
        }
    });

    // Alertas de stock mínimo
    APP_STATE.inventario.forEach(p => {
        if (p.stock <= p.stock_minimo) {
            const isOut = p.stock <= 0;
            addAlertItem(
                'danger',
                isOut ? 'Inventario agotado' : 'Inventario bajo',
                `El producto "${p.nombre}" cuenta con ${p.stock} unidades. Stock mínimo: ${p.stock_minimo}.`,
                { action: 'openInventory', itemId: p.id }
            );
            alertsCount++;
        }
    });

    const alertCountEl = document.getElementById('alert-count');
    const notificationCount = APP_STATE.notifications.length;
    alertCountEl.innerText = notificationCount;
    alertCountEl.classList.toggle('hidden', notificationCount === 0);
    if (alertsCount === 0) {
        alertsList.innerHTML = '<li class="text-muted text-center">Sin alertas pendientes.</li>';
    }
    renderNotificationsDrawer();

    // 4. Calcular métricas reales del Dashboard
    let daySales = 0;
    let monthSales = 0;
    let monthProfit = 0;
    let monthRepairsCount = 0;

    APP_STATE.ordenes.forEach(o => {
        const rev = o.costo_real !== null && o.costo_real !== undefined ? o.costo_real : o.costo_estimado;
        const exp = o.costo_refaccion || 0;
        const profit = rev - exp;

        if (isDateInRange(o.dateIn, 'day')) {
            daySales += rev;
        }
        if (isDateInRange(o.dateIn, 'month')) {
            monthSales += rev;
            monthProfit += profit;
            monthRepairsCount++;
        }
    });

    APP_STATE.ventas.forEach(v => {
        const rev = v.total;
        let exp = 0;
        if (v.items) {
            v.items.forEach(item => {
                exp += (item.cantidad * (item.costo || 0));
            });
        }
        const profit = rev - exp;

        if (isDateInRange(v.fecha, 'day')) {
            daySales += rev;
        }
        if (isDateInRange(v.fecha, 'month')) {
            monthSales += rev;
            monthProfit += profit;
        }
    });

    document.getElementById('dash-sales-day').innerText = `$${daySales.toFixed(2)}`;
    document.getElementById('dash-sales-month').innerText = `$${monthSales.toFixed(2)}`;
    document.getElementById('dash-profit-month').innerText = `$${monthProfit.toFixed(2)}`;
    document.getElementById('dash-repairs-month').innerText = monthRepairsCount;
    
    const lowStockCount = APP_STATE.inventario.filter(p => p.stock <= p.stock_minimo).length;
    document.getElementById('dash-low-stock').innerText = `${lowStockCount} items`;
    updateDashboardChart();
}

function addAlertItem(type, title, desc, metadata = {}) {
    APP_STATE.notifications.push({ type, title, desc, ...metadata });

    const list = document.getElementById('dashboard-alerts-list');
    if (!list) return;

    const li = document.createElement('li');
    li.className = `alert-list-item ${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'danger') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    li.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <div class="alert-item-content">
            <span class="alert-item-title">${title}</span>
            <span class="alert-item-desc">${desc}</span>
        </div>
    `;
    list.appendChild(li);
}

function getStatusBadgeClass(status) {
    return getOrderStatusTheme(status).badgeClass;
}

// ==========================================
// RENDER: CLIENTES & HISTORIAL
// ==========================================
function getClientInitials(client = {}) {
    const parts = String(client.nombre || 'Cliente').trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || 'C';
}

function getClientOrders(client = {}) {
    const clientPhones = [
        client.telefono,
        client.telefono_principal,
        client.telefono_alt1,
        client.telefono_alt2,
        client.telefono_alt3
    ].map(normalizeText).filter(Boolean);

    return APP_STATE.ordenes.filter(order => {
        if (Number(order.clientId) === Number(client.id)) return true;
        const orderPhone = normalizeText(order.clientPhone);
        return orderPhone && clientPhones.includes(orderPhone);
    });
}

function renderClientes() {
    const tableBody = document.querySelector('#clients-table tbody');
    tableBody.innerHTML = '';
    
    const searchVal = normalizeText(document.getElementById('client-search').value);
    
    const filtered = APP_STATE.clientes.filter(c => [
        c.nombre,
        c.apellido_paterno,
        c.apellido_materno,
        c.telefono,
        c.telefono_principal,
        c.id
    ].some(value => normalizeText(value).includes(searchVal)));

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center">No se encontraron clientes.</td></tr>';
    } else {
        filtered.forEach(c => {
            const orders = getClientOrders(c);
            const lastOrder = orders
                .slice()
                .sort((a, b) => new Date(b.dateIn || b.created_at || 0) - new Date(a.dateIn || a.created_at || 0))[0];
            const phone = c.telefono || c.telefono_principal || 'No proporcionado';
            const tr = document.createElement('tr');
            tr.className = 'client-table-row';
            tr.innerHTML = `
                <td><span class="client-id-pill">CLI-${String(c.id).padStart(4, '0')}</span></td>
                <td>
                    <div class="client-cell-identity">
                        <span class="client-avatar-sm">${escapeHtml(getClientInitials(c))}</span>
                        <div>
                            <strong>${escapeHtml(c.nombre)}</strong>
                            <small>${orders.length} ${orders.length === 1 ? 'orden registrada' : 'órdenes registradas'}</small>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="client-contact-stack">
                        <span><i class="fa-solid fa-phone"></i>${escapeHtml(phone)}</span>
                        ${c.telefono_alt1 ? `<small>Alt: ${escapeHtml(c.telefono_alt1)}</small>` : ''}
                    </div>
                </td>
                <td>
                    <div class="client-contact-stack">
                        <span>${escapeHtml(c.email || 'N/A')}</span>
                        <small>${lastOrder ? `Última orden: ${escapeHtml(lastOrder.folio || '-')}` : 'Sin historial'}</small>
                    </div>
                </td>
                <td class="client-actions-cell">
                    <button class="btn btn-xs btn-secondary" onclick="openClientDetail(${c.id})"><i class="fa-solid fa-clock-rotate-left"></i> Historial</button>
                    <button class="btn btn-xs btn-primary" onclick="openEditClientModal(${c.id})" title="Editar cliente"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-xs btn-danger admin-only" onclick="deleteClient(${c.id})" title="Eliminar cliente y sus órdenes"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }
    applyRolePermissions();
}

document.getElementById('client-search').addEventListener('input', renderClientes);

function openClientDetail(id) {
    const client = APP_STATE.clientes.find(c => c.id === id);
    if (!client) return;

    const repairs = getClientOrders(client)
        .slice()
        .sort((a, b) => new Date(b.dateIn || b.created_at || 0) - new Date(a.dateIn || a.created_at || 0));
    const activeOrders = repairs.filter(o => !['Entregado', 'Cancelado'].includes(o.status));
    const historicalTotal = repairs.reduce((sum, order) => {
        const amount = Number(order.costo_real ?? order.costo_estimado ?? 0);
        return sum + amount;
    }, 0);

    document.getElementById('detail-client-avatar').innerText = getClientInitials(client);
    document.getElementById('detail-client-name').innerText = client.nombre;
    document.getElementById('detail-client-num').innerText = `CLI-${String(client.id).padStart(4, '0')}`;
    document.getElementById('detail-client-phone').innerText = client.telefono || client.telefono_principal || 'No proporcionado';
    document.getElementById('detail-client-email').innerText = client.email || 'No proporcionado';
    document.getElementById('detail-client-address').innerText = client.direccion || 'No proporcionada';
    document.getElementById('detail-client-remarks').innerText = client.observaciones || 'Sin comentarios.';
    document.getElementById('detail-client-orders-count').innerText = repairs.length;
    document.getElementById('detail-client-active-count').innerText = activeOrders.length;
    document.getElementById('detail-client-total').innerText = `$${historicalTotal.toFixed(2)}`;
    document.getElementById('detail-client-history-label').innerText = `${repairs.length} ${repairs.length === 1 ? 'orden' : 'órdenes'}`;

    // Teléfonos alternativos
    const altsContainer = document.getElementById('detail-client-alts');
    altsContainer.innerHTML = '';
    if (client.telefono_alt1) altsContainer.innerHTML += `<li>${escapeHtml(client.telefono_alt1)}</li>`;
    if (client.telefono_alt2) altsContainer.innerHTML += `<li>${escapeHtml(client.telefono_alt2)}</li>`;
    if (client.telefono_alt3) altsContainer.innerHTML += `<li>${escapeHtml(client.telefono_alt3)}</li>`;
    if (altsContainer.innerHTML === '') altsContainer.innerHTML = '<li>Ninguno</li>';

    // Cargar historial de reparaciones filtrando ordenes
    const historyContainer = document.getElementById('detail-client-history');
    historyContainer.innerHTML = '';

    if (repairs.length === 0) {
        historyContainer.innerHTML = `
            <div class="client-empty-history">
                <i class="fa-regular fa-folder-open"></i>
                <p>Este cliente no cuenta con órdenes de servicio previas.</p>
            </div>
        `;
    } else {
        repairs.forEach(o => {
            const item = document.createElement('div');
            item.className = 'history-repair-item';
            const amount = Number(o.costo_real ?? o.costo_estimado ?? 0);
            item.innerHTML = `
                <div class="history-repair-info">
                    <span class="history-repair-folio">${escapeHtml(o.folio || 'Sin folio')}</span>
                    <strong>${escapeHtml(`${o.deviceType || 'Equipo'} ${o.brand || ''} ${o.model || ''}`.trim())}</strong>
                    <span>${escapeHtml(o.falla_reportada || 'Revisión')}</span>
                    <small>Ingreso: ${escapeHtml(o.dateIn || 'N/A')} · Estimada: ${escapeHtml(o.estimatedDate || 'N/A')}</small>
                </div>
                <div class="history-repair-side">
                    <span class="badge ${getStatusBadgeClass(o.status)}">${escapeHtml(o.status || 'Sin estado')}</span>
                    <strong>$${amount.toFixed(2)}</strong>
                    <button class="btn btn-xs btn-secondary" onclick="editOrderDetails(${o.id})"><i class="fa-solid fa-eye"></i> Ver</button>
                </div>
            `;
            historyContainer.appendChild(item);
        });
    }

    document.getElementById('client-detail-panel').classList.remove('hidden');
}

function closeClientDetail() {
    document.getElementById('client-detail-panel').classList.add('hidden');
}

document.getElementById('btn-close-client-detail').addEventListener('click', closeClientDetail);
document.getElementById('client-detail-panel').addEventListener('click', (event) => {
    if (event.target.id === 'client-detail-panel') closeClientDetail();
});
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeClientDetail();
    if (clientModal && !clientModal.classList.contains('hidden')) closeClientModal();
});

// Modal de agregar cliente directo
const clientModal = document.getElementById('client-modal');
const clientForm = document.getElementById('client-form');
const clientExtraContact = document.getElementById('client-extra-contact');
const clientMoreToggle = document.getElementById('btn-toggle-client-more');
const clientSaveButton = document.getElementById('btn-save-client');

function setClientExtraContactVisible(isVisible) {
    clientExtraContact?.classList.toggle('hidden', !isVisible);
    if (!clientMoreToggle) return;
    clientMoreToggle.setAttribute('aria-expanded', String(isVisible));
    clientMoreToggle.innerHTML = isVisible
        ? '<i class="fa-solid fa-chevron-down"></i> Ocultar datos opcionales'
        : '<i class="fa-solid fa-chevron-down"></i> Más datos opcionales';
}

function closeClientModal() {
    clientModal.classList.add('hidden');
}

function openClientModal({ client = null } = {}) {
    const isEditing = Boolean(client);
    clientForm.reset();
    document.getElementById('modal-client-id').value = isEditing ? client.id : '';
    document.querySelector('#client-modal h3').innerText = isEditing ? 'Editar Cliente' : 'Registrar Nuevo Cliente';
    clientSaveButton.innerText = isEditing ? 'Guardar cambios' : 'Registrar Cliente';

    if (isEditing) {
        document.getElementById('modal-client-name').value = client.nombre || '';
        document.getElementById('modal-client-phone').value = client.telefono || client.telefono_principal || '';
        document.getElementById('modal-client-preferred-contact').value = client.contacto_preferido || client.preferredContact || 'WhatsApp';
        document.getElementById('modal-client-email').value = client.email || client.correo || '';
        document.getElementById('modal-client-phone-alt1').value = client.telefono_alt1 || client.telefono_alternativo_1 || '';
        document.getElementById('modal-client-address').value = client.direccion || '';
        document.getElementById('modal-client-phone-alt2').value = client.telefono_alt2 || client.telefono_alternativo_2 || '';
        document.getElementById('modal-client-phone-alt3').value = client.telefono_alt3 || client.telefono_alternativo_3 || '';
        document.getElementById('modal-client-remarks').value = client.observaciones || client.notas || '';
    } else {
        document.getElementById('modal-client-preferred-contact').value = 'WhatsApp';
    }

    setClientExtraContactVisible(Boolean(
        isEditing && (client.telefono_alt2 || client.telefono_alternativo_2 || client.telefono_alt3 || client.telefono_alternativo_3 || client.observaciones || client.notas)
    ));
    clientModal.classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-client-name')?.focus(), 0);
}

document.getElementById('btn-add-client-modal').addEventListener('click', () => openClientModal());
document.getElementById('btn-close-client-modal').addEventListener('click', closeClientModal);
document.getElementById('btn-cancel-client').addEventListener('click', closeClientModal);
clientMoreToggle?.addEventListener('click', () => {
    setClientExtraContactVisible(clientExtraContact?.classList.contains('hidden'));
});
clientModal?.addEventListener('click', (event) => {
    if (event.target === clientModal) closeClientModal();
});

document.getElementById('client-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('modal-client-id').value;
    const isEditing = id !== '';

    const data = {
        nombre: document.getElementById('modal-client-name').value.trim(),
        telefono: document.getElementById('modal-client-phone').value.trim(),
        contacto_preferido: document.getElementById('modal-client-preferred-contact').value,
        telefono_alt1: document.getElementById('modal-client-phone-alt1').value.trim() || null,
        telefono_alt2: document.getElementById('modal-client-phone-alt2').value.trim() || null,
        telefono_alt3: document.getElementById('modal-client-phone-alt3').value.trim() || null,
        email: document.getElementById('modal-client-email').value.trim() || null,
        direccion: document.getElementById('modal-client-address').value.trim() || null,
        observaciones: document.getElementById('modal-client-remarks').value.trim() || null
    };

    try {
        let url = `${BASE_API_URL}/clientes`;
        let method = 'POST';
        if (isEditing) {
            url = `${BASE_API_URL}/clientes/${id}`;
            method = 'PUT';
        }

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (response.ok) {
            alert(isEditing ? 'Cliente actualizado con éxito.' : 'Cliente registrado con éxito.');
            closeClientModal();
            loadAllData();
        } else {
            const err = await response.json();
            alert('Error: ' + err.error);
        }
    } catch (err) {
        console.error(err);
    }
});

window.openEditClientModal = function(id) {
    const client = APP_STATE.clientes.find(c => c.id === id);
    if (!client) return;
    openClientModal({ client });
};

window.deleteClient = async function(id) {
    const client = APP_STATE.clientes.find(c => Number(c.id) === Number(id));
    if (!client) return;
    const relatedOrders = APP_STATE.ordenes.filter(o => Number(o.clientId) === Number(id)).length;
    const confirmation = relatedOrders > 0
        ? `¿Eliminar al cliente "${client.nombre}" y sus ${relatedOrders} orden(es)? Esta acción también devolverá al inventario las refacciones usadas en esas órdenes.`
        : `¿Eliminar al cliente "${client.nombre}"?`;
    if (!confirm(confirmation)) return;

    try {
        const response = await fetch(`${BASE_API_URL}/clientes/${id}`, { method: 'DELETE' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert('Error: ' + (result.error || 'No se pudo eliminar el cliente.'));
            return;
        }

        alert(`Cliente eliminado correctamente. Órdenes eliminadas: ${result.ordenes_eliminadas || 0}.`);
        document.getElementById('client-detail-panel')?.classList.add('hidden');
        await loadAllData();
    } catch (err) {
        console.error(err);
        alert('No se pudo eliminar el cliente por un error de red.');
    }
};

// ==========================================
// RENDER: ÓRDENES
// ==========================================
function renderOrdenes() {
    const tableBody = document.querySelector('#orders-main-table tbody');
    tableBody.innerHTML = '';
    
    const searchVal = document.getElementById('order-search').value.toLowerCase();
    const filterStatus = document.getElementById('filter-order-status').value;

    const filtered = APP_STATE.ordenes.filter(o => {
        const matchSearch = o.folio.toLowerCase().includes(searchVal) ||
                            o.clientName.toLowerCase().includes(searchVal) ||
                            o.model.toLowerCase().includes(searchVal) ||
                            (o.imei && o.imei.includes(searchVal));
        
        const matchStatus = filterStatus === 'ALL' || o.status === filterStatus;
        return matchSearch && matchStatus;
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center">No se encontraron Órdenes de servicio.</td></tr>';
    } else {
        filtered.forEach(o => {
            const tr = document.createElement('tr');
            tr.classList.add('order-click-row');
            tr.innerHTML = `
                <td><strong>${o.folio}</strong></td>
                <td>${o.clientName}</td>
                <td>${o.deviceType} ${o.brand} ${o.model}</td>
                <td>${o.falla_reportada || 'Revisión'}</td>
                <td>${o.estimatedDate || 'N/A'}</td>
                <td>$${(o.costo_estimado || 0).toFixed(2)}</td>
                <td>
                    <select class="form-select quick-status-select ${getStatusBadgeClass(o.status)}" data-order-id="${o.id}" data-current-status="${escapeHtml(o.status)}">
                        ${getOrderStatusOptions(o.status)}
                    </select>
                </td>
                <td>
                    <button class="btn btn-xs btn-secondary" onclick="viewOrderDetails(${o.id})" title="Ver Ticket/QR"><i class="fa-solid fa-print"></i></button>
                    <button class="btn btn-xs btn-primary" onclick="editOrderDetails(${o.id})" title="Editar Orden"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-xs btn-danger admin-only" onclick="deleteOrder(${o.id})" title="Eliminar Orden"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            tr.addEventListener('click', (event) => {
                if (event.target.closest('button') || event.target.closest('select')) return;
                showOrderQuickPreview(o, event);
            });

            tableBody.appendChild(tr);
        });
    }
}

// ==========================================
// RENDER: GARANTIAS
// ==========================================
function getWarrantyBadgeClass(status = '') {
    const normalized = normalizeText(status);
    if (normalized.includes('proxima')) return 'proxima';
    if (normalized.includes('vencida')) return 'vencida';
    if (normalized.includes('revision')) return 'revision';
    if (normalized.includes('aplicada')) return 'aplicada';
    if (normalized.includes('rechazada')) return 'rechazada';
    return 'vigente';
}

function renderGarantias() {
    const tableBody = document.querySelector('#warranty-table tbody');
    if (!tableBody) return;

    const stats = APP_STATE.garantiaStats || {};
    setTextContent('warranty-stat-active', Number(stats.vigentes || 0) + Number(stats.proximas || 0));
    setTextContent('warranty-stat-expired', stats.vencidas || 0);
    setTextContent('warranty-stat-review', stats.en_revision || 0);
    setTextContent('warranty-stat-applied', stats.aplicadas || 0);
    setTextContent('warranty-stat-rejected', stats.rechazadas || 0);
    setTextContent('warranty-stat-cost', formatCurrency(stats.costo_total || 0));

    const search = normalizeText(document.getElementById('warranty-search')?.value || '');
    const state = document.getElementById('warranty-state-filter')?.value || '';
    const dateFrom = document.getElementById('warranty-date-from')?.value || '';
    const dateTo = document.getElementById('warranty-date-to')?.value || '';

    const filtered = APP_STATE.garantias.filter(g => {
        const haystack = normalizeText([
            g.folio,
            g.folio_orden,
            g.cliente,
            g.telefono,
            g.marca,
            g.modelo,
            g.servicio_cubierto
        ].join(' '));
        const matchSearch = !search || haystack.includes(search);
        const matchState = !state || g.estado_garantia === state;
        const matchFrom = !dateFrom || String(g.fecha_inicio || '') >= dateFrom;
        const matchTo = !dateTo || String(g.fecha_inicio || '') <= dateTo;
        return matchSearch && matchState && matchFrom && matchTo;
    });

    setTextContent('warranty-results-count', `${filtered.length} ${filtered.length === 1 ? 'garantía' : 'garantías'}`);
    renderWarrantyRepairTags();

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="11" class="text-center">No se encontraron garantías.</td></tr>';
        return;
    }

    tableBody.innerHTML = filtered.map(g => {
        const status = g.estado_garantia || g.estado || 'Vigente';
        const canIngress = ['Vigente', 'Próxima a vencer'].includes(status);
        return `
            <tr>
                <td data-label="Folio"><strong>${escapeHtml(g.folio || g.folio_orden || '-')}</strong></td>
                <td data-label="Cliente">${escapeHtml(g.cliente || '-')}<br><small>${escapeHtml(g.telefono || '')}</small></td>
                <td data-label="Equipo">${escapeHtml(g.equipo || '-')}</td>
                <td data-label="Marca">${escapeHtml(g.marca || '-')}</td>
                <td data-label="Modelo">${escapeHtml(g.modelo || '-')}</td>
                <td data-label="Reparación">${escapeHtml(g.servicio_cubierto || g.reparacion_realizada || '-')}</td>
                <td data-label="Inicio" class="warranty-date-cell">${formatDateOnly(g.fecha_inicio)}</td>
                <td data-label="Vencimiento" class="warranty-date-cell">${formatDateOnly(g.fecha_vencimiento)}</td>
                <td data-label="Días" class="warranty-days-cell">${Number(g.dias_restantes || 0)}</td>
                <td data-label="Estado"><span class="warranty-badge ${getWarrantyBadgeClass(status)}">${escapeHtml(status)}</span></td>
                <td data-label="Acciones">
                    <div class="warranty-actions">
                        <button class="btn btn-xs btn-secondary" onclick="viewWarrantyDetail(${g.id})" title="Ver historial"><i class="fa-solid fa-eye"></i></button>
                        ${canIngress ? `<button class="btn btn-xs btn-primary" onclick="openWarrantyIngressModal(${g.id})" title="Registrar ingreso por garantía"><i class="fa-solid fa-rotate-left"></i></button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderWarrantyRepairTags() {
    const container = document.getElementById('warranty-repair-tags');
    if (!container) return;
    const repairs = APP_STATE.garantiaStats?.reparaciones_mas_garantias || [];
    if (repairs.length === 0) {
        container.innerHTML = '<span class="text-muted">Sin estadísticas aún.</span>';
        return;
    }
    container.innerHTML = repairs.map(item => `
        <span class="warranty-repair-tag">
            ${escapeHtml(item.reparacion)}
            <small>${Number(item.total || 0)} casos · ${formatCurrency(item.costo_total || 0)}</small>
        </span>
    `).join('');
}

async function refreshWarrantyModule() {
    await Promise.all([loadGarantias(), loadInventario()]);
    renderGarantias();
}

async function fetchWarrantyDetail(id) {
    const response = await fetch(`${BASE_API_URL}/garantias/${id}`);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo consultar la garantía.');
    }
    return response.json();
}

window.viewWarrantyDetail = async function(id) {
    try {
        const garantia = await fetchWarrantyDetail(id);
        const title = document.getElementById('warranty-detail-title');
        if (title) title.textContent = `Garantía ${garantia.folio || garantia.folio_orden || ''}`;
        renderWarrantyDetail(garantia);
        document.getElementById('warranty-detail-modal')?.classList.remove('hidden');
    } catch (error) {
        alert(error.message);
    }
};

function renderWarrantyDetail(g = {}) {
    const container = document.getElementById('warranty-detail-content');
    if (!container) return;
    const status = g.estado_garantia || g.estado || 'Vigente';
    const ingresos = g.ingresos || [];
    const historial = g.historial || [];
    const fotos = g.fotos || [];
    const costos = g.costos || [];
    const canTechnicalActions = ['Administrador', 'Técnico'].includes(APP_STATE.currentRole);

    container.innerHTML = `
        <div class="warranty-detail-grid">
            <div class="warranty-detail-item"><span>Orden original</span><strong>${escapeHtml(g.folio || '-')}</strong></div>
            <div class="warranty-detail-item"><span>Cliente</span><strong>${escapeHtml(g.cliente || '-')}</strong></div>
            <div class="warranty-detail-item"><span>Equipo</span><strong>${escapeHtml(`${g.equipo || ''} ${g.marca || ''} ${g.modelo || ''}`.trim() || '-')}</strong></div>
            <div class="warranty-detail-item"><span>Reparación cubierta</span><strong>${escapeHtml(g.servicio_cubierto || '-')}</strong></div>
            <div class="warranty-detail-item"><span>Vigencia</span><strong>${formatDateOnly(g.fecha_inicio)} - ${formatDateOnly(g.fecha_vencimiento)}</strong></div>
            <div class="warranty-detail-item"><span>Estado</span><strong><span class="warranty-badge ${getWarrantyBadgeClass(status)}">${escapeHtml(status)}</span></strong></div>
        </div>

        <div class="card">
            <div class="card-header flex-header">
                <h3>Reingresos</h3>
                ${['Vigente', 'Próxima a vencer'].includes(status) ? `<button class="btn btn-sm btn-primary" onclick="openWarrantyIngressModal(${g.id})"><i class="fa-solid fa-rotate-left"></i> Registrar ingreso</button>` : ''}
            </div>
            <div class="card-body table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Falla</th>
                            <th>Diagnóstico</th>
                            <th>Validación</th>
                            <th>Seguimiento</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ingresos.length === 0 ? '<tr><td colspan="6" class="text-center">Sin reingresos registrados.</td></tr>' : ingresos.map(ingreso => `
                            <tr>
                                <td>${formatDateOnly(ingreso.fecha_ingreso)}</td>
                                <td>${escapeHtml(ingreso.falla_reportada || '-')}</td>
                                <td>${escapeHtml(ingreso.diagnostico_tecnico || '-')}</td>
                                <td>${escapeHtml(ingreso.estado_validacion || '-')}</td>
                                <td>${escapeHtml(ingreso.estado_seguimiento || '-')}</td>
                                <td>
                                    <div class="warranty-actions">
                                        ${canTechnicalActions ? `<button class="btn btn-xs btn-primary" onclick="openWarrantyValidationModal(${ingreso.id})" title="Validar"><i class="fa-solid fa-check"></i></button>` : ''}
                                        ${canTechnicalActions ? `<button class="btn btn-xs btn-secondary" onclick="openWarrantyCostModal(${g.id}, ${ingreso.id})" title="Costos"><i class="fa-solid fa-coins"></i></button>` : ''}
                                        ${canTechnicalActions ? `<button class="btn btn-xs btn-secondary" onclick="openWarrantyCloseModal(${ingreso.id})" title="Cerrar ingreso"><i class="fa-solid fa-box-open"></i></button>` : ''}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="card">
            <div class="card-header"><h3>Historial cronológico</h3></div>
            <div class="card-body warranty-timeline">
                ${historial.length === 0 ? '<div class="text-muted">Sin historial.</div>' : historial.map(item => `
                    <div class="warranty-timeline-item">
                        <span>${formatDateOnly(item.fecha)} · ${escapeHtml(item.evento || 'Seguimiento')} · ${escapeHtml(item.usuario_nombre || 'Sistema')}</span>
                        <p>${escapeHtml(item.comentario || '-')}</p>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="card">
            <div class="card-header flex-header">
                <h3>Costos internos</h3>
                <strong>${formatCurrency(g.costo_total || 0)}</strong>
            </div>
            <div class="card-body table-responsive">
                <table class="table">
                    <thead><tr><th>Tipo</th><th>Descripción</th><th>Cant.</th><th>Costo</th><th>Subtotal</th></tr></thead>
                    <tbody>
                        ${costos.length === 0 ? '<tr><td colspan="5" class="text-center">Sin costos registrados.</td></tr>' : costos.map(costo => `
                            <tr>
                                <td>${escapeHtml(costo.tipo_costo || '-')}</td>
                                <td>${escapeHtml(costo.descripcion || costo.producto_nombre || '-')}</td>
                                <td>${Number(costo.cantidad || 0)}</td>
                                <td>${formatCurrency(costo.costo_unitario || 0)}</td>
                                <td>${formatCurrency(costo.subtotal || 0)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="card">
            <div class="card-header"><h3>Fotografías de garantía</h3></div>
            <div class="card-body warranty-photo-grid">
                ${fotos.length === 0 ? '<div class="text-muted">Sin fotografías.</div>' : fotos.map(foto => `<img src="${escapeHtml(foto.url_imagen)}" alt="Evidencia de garantía">`).join('')}
            </div>
        </div>
    `;
}

window.openWarrantyIngressModal = function(garantiaId) {
    const form = document.getElementById('warranty-ingress-form');
    form?.reset();
    setInputValue('warranty-ingress-garantia-id', garantiaId);
    setInputValue('warranty-ingress-date', todayDateString());
    const technicianSelect = document.getElementById('warranty-ingress-technician');
    if (technicianSelect) {
        const fallbackUsers = APP_STATE.usuarios.length > 0
            ? APP_STATE.usuarios
            : (APP_STATE.currentUser ? [APP_STATE.currentUser] : []);
        technicianSelect.innerHTML = '<option value="">Sin asignar</option>' + fallbackUsers
            .filter(u => u.activo !== false && ['Técnico', 'Administrador'].includes(u.rol))
            .map(u => `<option value="${u.id}">${escapeHtml(u.nombre || u.username)}</option>`)
            .join('');
    }
    document.getElementById('warranty-ingress-modal')?.classList.remove('hidden');
};

async function uploadWarrantyPhotos(garantiaId, ingresoId, inputId, comentario = '') {
    const input = document.getElementById(inputId);
    if (!input?.files?.length) return null;
    const formData = new FormData();
    Array.from(input.files).forEach(file => {
        if (WARRANTY_PHOTO_ACCEPTED_TYPES.includes(file.type)) formData.append('fotos', file);
    });
    formData.append('ingreso_garantia_id', ingresoId || '');
    formData.append('comentario', comentario || 'Evidencia de reingreso por garantía');
    const response = await fetch(`${BASE_API_URL}/garantias/${garantiaId}/fotos`, {
        method: 'POST',
        body: formData
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron subir las fotos de garantía.');
    }
    return response.json();
}

function closeWarrantyModal(id) {
    document.getElementById(id)?.classList.add('hidden');
}

document.getElementById('btn-close-warranty-detail')?.addEventListener('click', () => closeWarrantyModal('warranty-detail-modal'));
document.getElementById('btn-close-warranty-ingress')?.addEventListener('click', () => closeWarrantyModal('warranty-ingress-modal'));
document.getElementById('btn-cancel-warranty-ingress')?.addEventListener('click', () => closeWarrantyModal('warranty-ingress-modal'));
document.getElementById('btn-close-warranty-validation')?.addEventListener('click', () => closeWarrantyModal('warranty-validation-modal'));
document.getElementById('btn-cancel-warranty-validation')?.addEventListener('click', () => closeWarrantyModal('warranty-validation-modal'));
document.getElementById('btn-close-warranty-cost')?.addEventListener('click', () => closeWarrantyModal('warranty-cost-modal'));
document.getElementById('btn-cancel-warranty-cost')?.addEventListener('click', () => closeWarrantyModal('warranty-cost-modal'));
document.getElementById('btn-close-warranty-close')?.addEventListener('click', () => closeWarrantyModal('warranty-close-modal'));
document.getElementById('btn-cancel-warranty-close')?.addEventListener('click', () => closeWarrantyModal('warranty-close-modal'));

document.getElementById('warranty-ingress-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const garantiaId = getInputValue('warranty-ingress-garantia-id');
    try {
        let garantia = null;
        const response = await fetch(`${BASE_API_URL}/garantias/${garantiaId}/ingresos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fecha_ingreso: getInputValue('warranty-ingress-date'),
                falla_reportada: getInputValue('warranty-ingress-failure'),
                diagnostico_tecnico: getInputValue('warranty-ingress-diagnosis') || null,
                accesorios_recibidos: getInputValue('warranty-ingress-accessories') || null,
                observaciones: getInputValue('warranty-ingress-notes') || null,
                tecnico_responsable_id: getInputValue('warranty-ingress-technician') || null
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'No se pudo registrar el ingreso.');
        garantia = result;
        const ingresoId = garantia.ingresos?.[0]?.id || '';
        await uploadWarrantyPhotos(garantiaId, ingresoId, 'warranty-ingress-photos', getInputValue('warranty-ingress-notes'));
        closeWarrantyModal('warranty-ingress-modal');
        await refreshWarrantyModule();
        await viewWarrantyDetail(garantiaId);
        alert('Ingreso por garantía registrado correctamente.');
    } catch (error) {
        alert(error.message);
    }
});

window.openWarrantyValidationModal = function(ingressId) {
    document.getElementById('warranty-validation-form')?.reset();
    setInputValue('warranty-validation-ingress-id', ingressId);
    document.getElementById('warranty-reject-reason-group')?.classList.add('hidden');
    document.getElementById('warranty-validation-modal')?.classList.remove('hidden');
};

document.getElementById('warranty-validation-state')?.addEventListener('change', (event) => {
    const rejected = event.target.value === 'Garantía rechazada';
    document.getElementById('warranty-reject-reason-group')?.classList.toggle('hidden', !rejected);
    const reason = document.getElementById('warranty-reject-reason');
    if (reason) reason.required = rejected;
});

document.getElementById('warranty-validation-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ingressId = getInputValue('warranty-validation-ingress-id');
    try {
        const response = await fetch(`${BASE_API_URL}/garantias/ingresos/${ingressId}/validacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                estado_validacion: getInputValue('warranty-validation-state'),
                motivo_rechazo: getInputValue('warranty-reject-reason') || null,
                explicacion_rechazo: getInputValue('warranty-validation-diagnosis') || null,
                diagnostico_tecnico: getInputValue('warranty-validation-diagnosis') || null
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'No se pudo guardar la validación.');
        closeWarrantyModal('warranty-validation-modal');
        await refreshWarrantyModule();
        await viewWarrantyDetail(result.id);
        alert('Validación registrada correctamente.');
    } catch (error) {
        alert(error.message);
    }
});

window.openWarrantyCostModal = function(garantiaId, ingresoId = '') {
    document.getElementById('warranty-cost-form')?.reset();
    APP_STATE.currentWarrantyCostParts = [];
    setInputValue('warranty-cost-garantia-id', garantiaId);
    setInputValue('warranty-cost-ingress-id', ingresoId || '');
    const productSelect = document.getElementById('warranty-cost-product');
    if (productSelect) {
        productSelect.innerHTML = '<option value="">Selecciona refacción</option>' + APP_STATE.inventario
            .filter(item => item.activo !== false && normalizeText(item.categoria || '').includes('refaccion'))
            .map(item => `<option value="${item.id}">${escapeHtml(item.nombre)} · Stock ${Number(item.stock || 0)} · ${formatCurrency(item.costo || 0)}</option>`)
            .join('');
    }
    renderWarrantyCostParts();
    document.getElementById('warranty-cost-modal')?.classList.remove('hidden');
};

function renderWarrantyCostParts() {
    const tbody = document.querySelector('#warranty-cost-parts-table tbody');
    if (!tbody) return;
    const parts = APP_STATE.currentWarrantyCostParts;
    if (parts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Sin refacciones agregadas</td></tr>';
    } else {
        tbody.innerHTML = parts.map((part, index) => `
            <tr>
                <td>${escapeHtml(part.nombre)}</td>
                <td>${Number(part.stock || 0)}</td>
                <td>${Number(part.cantidad || 0)}</td>
                <td>${formatCurrency(part.costo_unitario || 0)}</td>
                <td>${formatCurrency((part.cantidad || 0) * (part.costo_unitario || 0))}</td>
                <td><button type="button" class="btn btn-xs btn-danger" onclick="removeWarrantyCostPart(${index})"><i class="fa-solid fa-trash"></i></button></td>
            </tr>
        `).join('');
    }
    updateWarrantyCostTotal();
}

function updateWarrantyCostTotal() {
    const partsTotal = APP_STATE.currentWarrantyCostParts.reduce((sum, part) => sum + Number(part.cantidad || 0) * Number(part.costo_unitario || 0), 0);
    const labor = Number(getInputValue('warranty-labor-cost') || 0);
    const other = Number(getInputValue('warranty-other-cost') || 0);
    setTextContent('warranty-cost-total', formatCurrency(partsTotal + labor + other));
}

document.getElementById('btn-add-warranty-cost-part')?.addEventListener('click', () => {
    const productId = Number(getInputValue('warranty-cost-product'));
    const qty = Number(getInputValue('warranty-cost-qty') || 1);
    const product = APP_STATE.inventario.find(item => Number(item.id) === productId);
    if (!product || qty <= 0) return;
    if (Number(product.stock || 0) < qty) {
        alert(`Stock insuficiente para ${product.nombre}.`);
        return;
    }
    const existing = APP_STATE.currentWarrantyCostParts.find(part => Number(part.producto_id) === productId);
    if (existing) existing.cantidad += qty;
    else APP_STATE.currentWarrantyCostParts.push({
        producto_id: product.id,
        nombre: product.nombre,
        stock: Number(product.stock || 0),
        cantidad: qty,
        costo_unitario: Number(product.costo || 0)
    });
    renderWarrantyCostParts();
});

window.removeWarrantyCostPart = function(index) {
    APP_STATE.currentWarrantyCostParts.splice(index, 1);
    renderWarrantyCostParts();
};

document.getElementById('warranty-labor-cost')?.addEventListener('input', updateWarrantyCostTotal);
document.getElementById('warranty-other-cost')?.addEventListener('input', updateWarrantyCostTotal);

document.getElementById('warranty-cost-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const garantiaId = getInputValue('warranty-cost-garantia-id');
    const other = Number(getInputValue('warranty-other-cost') || 0);
    const response = await fetch(`${BASE_API_URL}/garantias/${garantiaId}/costos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ingreso_garantia_id: getInputValue('warranty-cost-ingress-id') || null,
            refacciones: APP_STATE.currentWarrantyCostParts,
            mano_obra_interna: Number(getInputValue('warranty-labor-cost') || 0),
            otros_gastos: other > 0 ? [{ descripcion: getInputValue('warranty-other-description') || 'Otros gastos', monto: other }] : []
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        alert(result.error || 'No se pudieron registrar costos.');
        return;
    }
    closeWarrantyModal('warranty-cost-modal');
    await refreshWarrantyModule();
    await viewWarrantyDetail(result.id);
    alert('Costos de garantía registrados correctamente.');
});

window.openWarrantyCloseModal = function(ingressId) {
    document.getElementById('warranty-close-form')?.reset();
    setInputValue('warranty-close-ingress-id', ingressId);
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setInputValue('warranty-close-date', now.toISOString().slice(0, 16));
    document.getElementById('warranty-close-modal')?.classList.remove('hidden');
};

document.getElementById('warranty-close-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ingressId = getInputValue('warranty-close-ingress-id');
    const response = await fetch(`${BASE_API_URL}/garantias/ingresos/${ingressId}/cerrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fecha_entrega_garantia: getInputValue('warranty-close-date') || null,
            resolucion_final: getInputValue('warranty-close-resolution')
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        alert(result.error || 'No se pudo cerrar el ingreso.');
        return;
    }
    closeWarrantyModal('warranty-close-modal');
    await refreshWarrantyModule();
    await viewWarrantyDetail(result.id);
    alert('Ingreso de garantía cerrado correctamente.');
});

function getOrderFirstPhoto(order) {
    const photos = getOrderPhotos(order);
    return photos.find(Boolean) || '';
}

function getOrderQuickPreviewEl() {
    let preview = document.getElementById('order-quick-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'order-quick-preview';
        preview.className = 'order-quick-preview hidden';
        document.body.appendChild(preview);
    }
    return preview;
}

function showOrderQuickPreview(order, event) {
    const preview = getOrderQuickPreviewEl();
    const firstPhoto = getOrderFirstPhoto(order);
    const pending = Math.max((Number(order.costo_estimado) || 0) - (Number(order.anticipo) || 0), 0);

    preview.innerHTML = `
        <div class="order-quick-preview-header">
            <div>
                <strong>${escapeHtml(order.folio)}</strong>
                <span>${escapeHtml(order.status || 'Sin estado')}</span>
            </div>
            <div class="order-quick-preview-actions">
                <button type="button" class="btn btn-xs btn-primary" data-edit-order="${order.id}">
                    <i class="fa-solid fa-pen"></i> Editar
                </button>
                <button type="button" class="btn btn-xs btn-secondary" data-close-order-preview title="Cerrar">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
        <div class="order-quick-preview-body">
            <div class="order-quick-preview-photo">
                ${firstPhoto ? `<img src="${firstPhoto}" alt="Foto de la orden">` : '<i class="fa-regular fa-image"></i>'}
            </div>
            <div class="order-quick-preview-data">
                <p><b>Cliente:</b> ${escapeHtml(order.clientName || 'N/A')}</p>
                <p><b>Tel:</b> ${escapeHtml(order.clientPhone || 'N/A')}</p>
                <p><b>Equipo:</b> ${escapeHtml(`${order.deviceType || ''} ${order.brand || ''} ${order.model || ''}`.trim())}</p>
                <p><b>IMEI/Serie:</b> ${escapeHtml(order.imei || order.serial || 'N/A')}</p>
                <p><b>Falla:</b> ${escapeHtml(order.falla_reportada || 'Revisión')}</p>
                <p><b>Ingreso:</b> ${escapeHtml(order.dateIn || 'N/A')}</p>
                <p><b>Estimado:</b> ${escapeHtml(order.estimatedDate || 'N/A')}</p>
                <p><b>Pendiente:</b> $${pending.toFixed(2)}</p>
            </div>
        </div>
    `;

    preview.querySelector('[data-edit-order]').addEventListener('click', () => {
        hideOrderQuickPreview();
        editOrderDetails(order.id);
    });
    preview.querySelector('[data-close-order-preview]').addEventListener('click', hideOrderQuickPreview);

    preview.classList.remove('hidden');
    positionOrderQuickPreview(event);
}

function positionOrderQuickPreview(event) {
    const preview = getOrderQuickPreviewEl();
    if (preview.classList.contains('hidden')) return;

    const margin = 14;
    const rect = preview.getBoundingClientRect();
    let left = event.clientX + margin;
    let top = event.clientY + margin;

    if (left + rect.width > window.innerWidth - margin) {
        left = event.clientX - rect.width - margin;
    }
    if (top + rect.height > window.innerHeight - margin) {
        top = window.innerHeight - rect.height - margin;
    }

    preview.style.left = `${Math.max(margin, left)}px`;
    preview.style.top = `${Math.max(margin, top)}px`;
}

function hideOrderQuickPreview() {
    const preview = getOrderQuickPreviewEl();
    preview.classList.add('hidden');
}

document.getElementById('order-search').addEventListener('input', renderOrdenes);
document.getElementById('filter-order-status').addEventListener('change', renderOrdenes);
document.getElementById('warranty-search')?.addEventListener('input', renderGarantias);
document.getElementById('warranty-state-filter')?.addEventListener('change', renderGarantias);
document.getElementById('warranty-date-from')?.addEventListener('change', renderGarantias);
document.getElementById('warranty-date-to')?.addEventListener('change', renderGarantias);

window.deleteOrder = async function(id) {
    const order = APP_STATE.ordenes.find(o => Number(o.id) === Number(id));
    if (!order) return;
    if (!confirm(`¿Eliminar la orden ${order.folio}? Si tiene refacciones utilizadas, se devolverán al inventario.`)) return;

    try {
        const response = await fetch(`${BASE_API_URL}/ordenes/${id}`, { method: 'DELETE' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert('Error: ' + (result.error || 'No se pudo eliminar la orden.'));
            return;
        }

        alert('Orden eliminada correctamente.');
        hideOrderQuickPreview();
        await loadAllData();
    } catch (err) {
        console.error(err);
        alert('No se pudo eliminar la orden por un error de red.');
    }
};

function getOrderStatusOptions(currentStatus) {
    const statuses = [
        'Recibido',
        'Diagnóstico',
        'Esperando autorización',
        'En reparación',
        'Esperando refacción',
        'Retrasado',
        'Listo para entregar',
        'Terminado',
        'Entregado',
        'Cancelado'
    ];
    return statuses
        .map(status => `<option value="${status}" ${status === currentStatus ? 'selected' : ''}>${status}</option>`)
        .join('');
}

document.querySelector('#orders-main-table tbody').addEventListener('change', async (event) => {
    const select = event.target.closest('.quick-status-select');
    if (!select) return;

    const orderId = select.dataset.orderId;
    const previousStatus = select.dataset.currentStatus;
    const nextStatus = select.value;

    try {
        const response = await fetch(`${BASE_API_URL}/ordenes/${orderId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nextStatus, comentario: `Cambio rapido de estado a ${nextStatus}.` })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'No se pudo actualizar el estado.');
        }

        const updated = await response.json();
        const index = APP_STATE.ordenes.findIndex(o => o.id === Number(orderId));
        if (index >= 0) APP_STATE.ordenes[index] = updated;
        renderOrdenes();
        renderDashboard();
        renderCalendario();
    } catch (error) {
        alert(error.message || 'No se pudo actualizar el estado.');
        select.value = previousStatus;
    }
});

// ==========================================
// REGISTRO Y EDICIÓN DE ÓRDENES (CON CANVAS)
// ==========================================
const orderModal = document.getElementById('order-modal');
document.getElementById('btn-close-order-modal')?.addEventListener('click', () => orderModal.classList.add('hidden'));
document.getElementById('btn-cancel-order')?.addEventListener('click', () => orderModal.classList.add('hidden'));

function initOrderFormTabs() {
    const stepperButtons = document.querySelectorAll('#order-modal .new-order-stepper-item');
    const prevButton = document.getElementById('btn-order-prev');
    const nextButton = document.getElementById('btn-order-next');

    stepperButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetStep = Number(button.dataset.wizardStep || 1);
            goToOrderWizardStep(targetStep);
        });
    });

    prevButton?.addEventListener('click', () => {
        setOrderWizardStep(getOrderWizardStep() - 1);
    });

    nextButton?.addEventListener('click', () => {
        goToOrderWizardStep(getOrderWizardStep() + 1);
    });

    document.getElementById('new-order-summary-grid')?.addEventListener('click', (event) => {
        const editButton = event.target.closest('[data-summary-step]');
        if (!editButton) return;
        setOrderWizardStep(Number(editButton.dataset.summaryStep || 1));
    });

    setOrderWizardStep(1);
}

function getOrderWizardStep() {
    return Number(document.getElementById('order-form')?.dataset.currentStep || 1);
}

function setOrderWizardStep(step) {
    const form = document.getElementById('order-form');
    const nextStep = Math.min(Math.max(Number(step) || 1, 1), 5);
    if (form) form.dataset.currentStep = String(nextStep);

    document.querySelectorAll('#order-modal .new-order-step').forEach(section => {
        const isActive = Number(section.dataset.step) === nextStep;
        section.classList.toggle('hidden', !isActive);
        section.classList.toggle('active', isActive);
    });

    document.querySelectorAll('#order-modal .new-order-stepper-item').forEach(button => {
        const buttonStep = Number(button.dataset.wizardStep);
        button.classList.toggle('active', buttonStep === nextStep);
        button.classList.toggle('completed', buttonStep < nextStep);
        const index = button.querySelector('.step-index');
        if (index) index.textContent = buttonStep < nextStep ? '✓' : String(buttonStep);
    });

    const prevButton = document.getElementById('btn-order-prev');
    if (prevButton) {
        prevButton.disabled = nextStep === 1;
        prevButton.classList.toggle('is-disabled', nextStep === 1);
    }
    document.getElementById('btn-order-next')?.classList.toggle('hidden', nextStep === 5);
    const saveButton = document.getElementById('btn-save-order');
    if (saveButton) {
        saveButton.classList.toggle('hidden', nextStep !== 5);
        saveButton.textContent = getInputValue('form-order-id') ? 'Guardar cambios' : 'Crear Orden';
    }

    if (nextStep === 5) renderOrderWizardSummaryCards();
    clearOrderWizardError();
    document.querySelector('#order-modal .new-order-wizard')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToOrderWizardStep(targetStep) {
    const currentStep = getOrderWizardStep();
    const nextStep = Math.min(Math.max(Number(targetStep) || 1, 1), 5);
    if (nextStep === currentStep) return true;

    if (nextStep > currentStep) {
        for (let step = currentStep; step < nextStep; step++) {
            if (!validateOrderWizardStep(step)) return false;
        }
    }

    setOrderWizardStep(nextStep);
    return true;
}

function clearOrderWizardError() {
    const error = document.getElementById('new-order-step-error');
    if (!error) return;
    error.textContent = '';
    error.classList.add('hidden');
}

function showOrderWizardError(message, fieldId = null) {
    const error = document.getElementById('new-order-step-error');
    if (error) {
        error.textContent = message;
        error.classList.remove('hidden');
    }
    if (fieldId) {
        setTimeout(() => document.getElementById(fieldId)?.focus(), 50);
    }
}

function validateOrderWizardStep(step) {
    clearOrderWizardError();

    if (step === 1) {
        const clientId = document.getElementById('order-form')?.dataset.selectedClientId || '';
        const clientName = buildClientFullName();
        if (!clientId && !clientName) {
            showOrderWizardError('Escribe el nombre del cliente o selecciona un cliente existente.', 'form-client-name');
            return false;
        }
        const duplicateMatch = checkClientDuplicateState();
        if (duplicateMatch) {
            showOrderWizardError(
                duplicateMatch.type === 'strong'
                    ? 'Selecciona el cliente existente antes de continuar.'
                    : 'Confirma si deseas usar el cliente existente o continuar como nuevo.',
                'form-client-name'
            );
            return false;
        }
    }

    if (step === 2) {
        const deviceType = getInputValue('form-device-type').trim();
        const brand = getInputValue('form-device-brand').trim();
        const model = getInputValue('form-device-model').trim();
        const deviceDescription = getInputValue('form-device-description').trim();
        if (!deviceType) {
            showOrderWizardError('Selecciona el tipo de equipo.', 'form-device-type');
            return false;
        }
        if (!(brand && model) && !deviceDescription) {
            showOrderWizardError('Escribe marca y modelo, o una descripción clara del equipo.', 'form-device-brand');
            return false;
        }
        if (!validateOrderWizardLock()) return false;
    }

    if (step === 3) {
        const falla = getInputValue('form-falla-reportada').trim();
        const service = getInputValue('form-servicio-solicitado').trim();
        if (!falla && !service) {
            showOrderWizardError('Describe la falla reportada o el servicio solicitado.', 'form-falla-reportada');
            return false;
        }
        if (!document.querySelector('input[name="order_type"]:checked')) {
            showOrderWizardError('Selecciona el tipo de orden.');
            return false;
        }
    }

    if (step === 4) {
        const warrantyData = collectOrderWarrantyData();
        const selectedStatus = getInputValue('form-order-status') || 'Recibido';
        const reasonRequired = selectedStatus === 'Retrasado' || selectedStatus === 'Cancelado';
        if (reasonRequired && !getInputValue('form-status-reason').trim()) {
            showOrderWizardError('Indica el motivo requerido para el estado seleccionado.', 'form-status-reason');
            return false;
        }
        if (warrantyData.tiene_garantia && selectedStatus !== 'Entregado') {
            showOrderWizardError('La garantía solo puede activarse cuando la orden esté marcada como Entregado.', 'form-order-status');
            return false;
        }
        if (warrantyData.tiene_garantia && (!warrantyData.duracion_dias || !warrantyData.servicio_cubierto)) {
            showOrderWizardError('Indica la duración y el servicio cubierto por la garantía.', 'form-warranty-days');
            return false;
        }
    }

    return true;
}

function validateOrderWizardLock() {
    const hasLock = document.getElementById('equipment-has-lock');
    if (!hasLock?.checked) return true;

    const selectedLock = document.querySelector('input[name="lock_type"]:checked');
    const lockType = selectedLock?.value || 'Ninguno';
    if (lockType === 'Ninguno') {
        showOrderWizardError('Selecciona el tipo de bloqueo: PIN, Contraseña o Patrón.');
        return false;
    }
    if (lockType === 'PIN' && !getInputValue('form-lock-pin').trim()) {
        showOrderWizardError('Escribe el PIN del equipo.', 'form-lock-pin');
        return false;
    }
    if (lockType === 'Contraseña' && !getInputValue('form-lock-pass').trim()) {
        showOrderWizardError('Escribe la contraseña del equipo.', 'form-lock-pass');
        return false;
    }
    if (lockType === 'Patrón') {
        const sequence = getInputValue('form-lock-pattern-sequence').split('-').filter(Boolean);
        const patternDescription = getInputValue('form-lock-pattern-description').trim();
        if (sequence.length < 4 && !patternDescription) {
            showOrderWizardError('Dibuja mínimo 4 puntos o describe el patrón.', 'form-lock-pattern-description');
            return false;
        }
    }
    return true;
}

function validateOrderWizardAll() {
    for (let step = 1; step <= 4; step++) {
        if (!validateOrderWizardStep(step)) {
            setOrderWizardStep(step);
            validateOrderWizardStep(step);
            return false;
        }
    }
    return true;
}

function getCheckedOrderLabels(selector) {
    return Array.from(document.querySelectorAll(selector))
        .filter(input => input.checked)
        .map(input => input.closest('label')?.textContent.trim())
        .filter(Boolean)
        .join(', ') || 'Sin seleccionar';
}

function renderOrderWizardSummary() {
    updateOrderCostState();
    const summary = document.getElementById('new-order-summary-grid');
    if (!summary) return;

    const warrantyEnabled = document.getElementById('form-warranty-enabled')?.checked;
    const items = [
        ['Cliente', buildClientFullName() || 'Sin cliente'],
        ['Equipo', [getInputValue('form-device-type'), getInputValue('form-device-brand'), getInputValue('form-device-model')].filter(Boolean).join(' ') || getInputValue('form-device-description') || 'Sin equipo'],
        ['Falla', getInputValue('form-falla-reportada') || 'Sin falla'],
        ['Servicio', getInputValue('form-servicio-solicitado') || 'Sin servicio'],
        ['Accesorios', getCheckedOrderLabels('#tab-accesorios input[type="checkbox"]')],
        ['Inspección', getCheckedOrderLabels('#tab-inspeccion input[type="checkbox"]')],
        ['Costo', `$${(parseFloat(getInputValue('form-costo-estimado')) || 0).toFixed(2)}`],
        ['Anticipo', `$${(parseFloat(getInputValue('form-anticipo')) || 0).toFixed(2)}`],
        ['Saldo', `$${(parseFloat(getInputValue('form-saldo-pendiente')) || 0).toFixed(2)}`],
        ['Fecha estimada', getInputValue('form-fecha-entrega') || 'Sin fecha'],
        ['Estado', getInputValue('form-order-status') || 'Recibido'],
        ['Garantía', warrantyEnabled ? `${getInputValue('form-warranty-days') || 0} días` : 'Sin garantía']
    ];

    summary.innerHTML = items.map(([label, value]) => `
        <div class="new-order-summary-item">
            <span>${label}</span>
            <strong>${escapeHtml(String(value))}</strong>
        </div>
    `).join('');
}

function renderOrderWizardSummaryCards() {
    updateOrderCostState();
    const summary = document.getElementById('new-order-summary-grid');
    if (!summary) return;

    const warrantyEnabled = document.getElementById('form-warranty-enabled')?.checked;
    const evidenceCount = document.getElementById('order-photo-count')?.textContent || '0 fotos';
    const blocks = [
        {
            title: 'Cliente',
            step: 1,
            items: [
                ['Nombre', buildClientFullName() || 'Sin cliente'],
                ['Telefono', getInputValue('form-client-phone') || 'Sin telefono']
            ]
        },
        {
            title: 'Equipo',
            step: 2,
            items: [
                ['Equipo', [getInputValue('form-device-type'), getInputValue('form-device-brand'), getInputValue('form-device-model')].filter(Boolean).join(' ') || getInputValue('form-device-description') || 'Sin equipo'],
                ['Bloqueo', document.getElementById('equipment-has-lock')?.checked ? getRadioValue('lock_type', 'Con bloqueo') : 'Sin bloqueo']
            ]
        },
        {
            title: 'Falla',
            step: 3,
            items: [
                ['Falla', getInputValue('form-falla-reportada') || 'Sin falla'],
                ['Servicio', getInputValue('form-servicio-solicitado') || 'Sin servicio'],
                ['Accesorios', getCheckedOrderLabels('#tab-accesorios input[type="checkbox"]')],
                ['Inspeccion', getCheckedOrderLabels('#tab-inspeccion input[type="checkbox"]')]
            ]
        },
        {
            title: 'Costos',
            step: 4,
            items: [
                ['Costo', `$${(parseFloat(getInputValue('form-costo-estimado')) || 0).toFixed(2)}`],
                ['Anticipo', `$${(parseFloat(getInputValue('form-anticipo')) || 0).toFixed(2)}`],
                ['Saldo', `$${(parseFloat(getInputValue('form-saldo-pendiente')) || 0).toFixed(2)}`],
                ['Estado', getInputValue('form-order-status') || 'Recibido']
            ]
        },
        {
            title: 'Evidencia',
            step: 5,
            items: [
                ['Fotos', evidenceCount],
                ['Visible cliente', document.getElementById('evidence-visible-client')?.checked ? 'Si' : 'No']
            ]
        },
        {
            title: 'Garantia',
            step: 4,
            items: [
                ['Estado', warrantyEnabled ? 'Con garantia' : 'Sin garantia'],
                ['Duracion', warrantyEnabled ? `${getInputValue('form-warranty-days') || 0} dias` : 'No aplica']
            ]
        }
    ];

    summary.innerHTML = blocks.map(block => `
        <div class="new-order-summary-card">
            <div class="new-order-summary-card-head">
                <strong>${escapeHtml(block.title)}</strong>
                <button type="button" class="btn btn-xs btn-secondary" data-summary-step="${block.step}">Editar</button>
            </div>
            <div class="new-order-summary-card-body">
                ${block.items.map(([label, value]) => `
                    <div class="new-order-summary-item">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(String(value))}</strong>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function initOrderPhotoInputs() {
    const input = document.getElementById('photo-input-evidencias');
    const uploadButton = document.getElementById('btn-upload-order-photos');
    if (!input || !uploadButton) return;

    uploadButton.addEventListener('click', () => input.click());

    async function addOrderPhotoFiles(files) {
        if (!files || files.length === 0) return;
        const currentPhotos = getOrderPhotos(document.getElementById('order-form')?.dataset.currentPhotos || []);
        const newPhotos = [];

        for (const file of Array.from(files)) {
            if (!ORDER_PHOTO_ACCEPTED_TYPES.includes(file.type)) {
                alert(`Formato no permitido: ${file.name}. Usa JPG, JPEG, PNG o WEBP.`);
                continue;
            }

            try {
                newPhotos.push(await fileToDataUrl(file));
            } catch (err) {
                console.error('No se pudo leer la foto de la orden:', err);
                alert(`No se pudo cargar la foto: ${file.name}`);
            }
        }

        renderOrderPhotoPreviews([...currentPhotos, ...newPhotos]);
    }

    input.addEventListener('change', async () => {
        await addOrderPhotoFiles(input.files);
        input.value = '';
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadButton.addEventListener(eventName, (event) => {
            event.preventDefault();
            uploadButton.classList.add('is-dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadButton.addEventListener(eventName, (event) => {
            event.preventDefault();
            uploadButton.classList.remove('is-dragover');
        });
    });

    uploadButton.addEventListener('drop', async (event) => {
        await addOrderPhotoFiles(event.dataTransfer?.files);
    });
}

async function collectOrderPhotos() {
    const form = document.getElementById('order-form');
    return getOrderPhotos(form?.dataset.currentPhotos || []);
}

function isDiagnosisOrderSelected() {
    return document.querySelector('input[name="order_type"]:checked')?.value === 'Inspección / diagnóstico para presupuesto posterior';
}

function updateOrderCostState() {
    const estimatedInput = document.getElementById('form-costo-estimado');
    const advanceInput = document.getElementById('form-anticipo');
    const balanceInput = document.getElementById('form-saldo-pendiente');
    const laborInput = document.getElementById('form-mano-obra');
    const realInput = document.getElementById('form-costo-real');
    const partsCostInput = document.getElementById('form-costo-refaccion');
    const profitInput = document.getElementById('form-ganancia-label');
    const partsTotal = getOrderPartsTotal();
    const labor = parseFloat(laborInput?.value) || 0;
    const shouldAutoTotal = APP_STATE.currentOrderParts.length > 0 || labor > 0;
    const estimated = shouldAutoTotal ? labor + partsTotal : (parseFloat(estimatedInput?.value) || 0);
    const advance = parseFloat(advanceInput?.value) || 0;
    const balance = Math.max(estimated - advance, 0);

    if (shouldAutoTotal && estimatedInput) estimatedInput.value = estimated.toFixed(2);
    if (shouldAutoTotal && realInput) realInput.value = estimated.toFixed(2);
    if (partsCostInput) partsCostInput.value = partsTotal.toFixed(2);
    if (profitInput) profitInput.value = Math.max(estimated - partsTotal, 0).toFixed(2);
    if (balanceInput) balanceInput.value = balance.toFixed(2);
    setTextContent('order-parts-total', `$${partsTotal.toFixed(2)}`);
    setTextContent('order-labor-total', `$${labor.toFixed(2)}`);
    setTextContent('order-repair-total', `$${estimated.toFixed(2)}`);
    setTextContent('order-balance-total', `$${balance.toFixed(2)}`);
    if (estimatedInput) {
        estimatedInput.placeholder = isDiagnosisOrderSelected() ? 'Pendiente de presupuesto' : 'Opcional';
    }
}

function setTextContent(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function updateOrderWarrantyDates() {
    const startInput = document.getElementById('form-warranty-start');
    const daysInput = document.getElementById('form-warranty-days');
    const endInput = document.getElementById('form-warranty-end');
    if (!startInput || !daysInput || !endInput) return;
    if (!startInput.value) startInput.value = todayDateString();
    endInput.value = addDaysToDate(startInput.value, daysInput.value || 0);
}

function updateOrderWarrantyUI() {
    const enabled = document.getElementById('form-warranty-enabled')?.checked;
    const fields = document.getElementById('warranty-order-fields');
    fields?.classList.toggle('hidden', !enabled);
    setTextContent('warranty-order-status', enabled ? 'Garantía activa' : 'Sin garantía');
    if (enabled) {
        if (!getInputValue('form-warranty-service')) {
            setInputValue('form-warranty-service', getInputValue('form-servicio-solicitado') || getInputValue('form-falla-reportada'));
        }
        updateOrderWarrantyDates();
    }
}

function resetOrderWarrantyFields() {
    const enabled = document.getElementById('form-warranty-enabled');
    if (enabled) enabled.checked = false;
    setInputValue('form-warranty-days', '30');
    setInputValue('form-warranty-start', todayDateString());
    setInputValue('form-warranty-end', addDaysToDate(todayDateString(), 30));
    setInputValue('form-warranty-service', '');
    setInputValue('form-warranty-conditions', '');
    setInputValue('form-warranty-notes', '');
    updateOrderWarrantyUI();
}

function populateOrderWarrantyFields(garantia = null) {
    if (!garantia) {
        resetOrderWarrantyFields();
        return;
    }
    const enabled = document.getElementById('form-warranty-enabled');
    if (enabled) enabled.checked = garantia.activo !== false;
    setInputValue('form-warranty-days', garantia.duracion_dias || 30);
    setInputValue('form-warranty-start', garantia.fecha_inicio || todayDateString());
    setInputValue('form-warranty-end', garantia.fecha_vencimiento || addDaysToDate(garantia.fecha_inicio || todayDateString(), garantia.duracion_dias || 30));
    setInputValue('form-warranty-service', garantia.servicio_cubierto || garantia.reparacion_realizada || '');
    setInputValue('form-warranty-conditions', garantia.condiciones || '');
    setInputValue('form-warranty-notes', garantia.observaciones || '');
    updateOrderWarrantyUI();
}

function collectOrderWarrantyData() {
    const enabled = document.getElementById('form-warranty-enabled')?.checked || false;
    return {
        tiene_garantia: enabled,
        duracion_dias: parseInt(getInputValue('form-warranty-days'), 10) || 0,
        fecha_inicio: getInputValue('form-warranty-start') || todayDateString(),
        fecha_vencimiento: getInputValue('form-warranty-end') || '',
        servicio_cubierto: getInputValue('form-warranty-service'),
        condiciones: getInputValue('form-warranty-conditions') || null,
        observaciones: getInputValue('form-warranty-notes') || null
    };
}

function getOrderPartsTotal() {
    return APP_STATE.currentOrderParts.reduce((sum, part) => {
        const cantidad = Number(part.cantidad || 0);
        const precio = Number(part.precio_unitario || 0);
        return sum + cantidad * precio;
    }, 0);
}

function getOrderPartInventoryStock(part) {
    const inventoryItem = APP_STATE.inventario.find(item => Number(item.id) === Number(part.producto_id));
    if (inventoryItem) return Number(inventoryItem.stock || 0);
    return Number(part.stock_disponible || 0);
}

function getOrderPartMaxQuantity(part) {
    return getOrderPartInventoryStock(part) + Number(part.originalCantidad || 0);
}

function getProductBarcode(product = {}) {
    return product.codigo_barras || product.codigo || 'S/C';
}

function normalizeOrderPart(product, options = {}) {
    const productoId = Number(product.producto_id || product.id);
    const inventoryItem = APP_STATE.inventario.find(item => Number(item.id) === productoId) || product;
    const precio = Number(options.precio_unitario ?? product.precio_unitario ?? inventoryItem.precio ?? product.precio_actual ?? 0);
    const cantidad = Number(options.cantidad ?? product.cantidad ?? 1);
    return {
        producto_id: productoId,
        refaccion: product.refaccion || product.nombre || inventoryItem.nombre || 'Refacción',
        nombre: product.nombre || product.refaccion || inventoryItem.nombre || 'Refacción',
        codigo: product.codigo_barras || inventoryItem.codigo_barras || product.codigo || inventoryItem.codigo || 'S/C',
        codigo_barras: product.codigo_barras || inventoryItem.codigo_barras || null,
        descripcion: product.descripcion || inventoryItem.descripcion || '',
        categoria: product.categoria || inventoryItem.categoria || '',
        stock_disponible: Number(product.stock_disponible ?? inventoryItem.stock ?? 0),
        cantidad,
        originalCantidad: Number(options.originalCantidad ?? product.originalCantidad ?? product.cantidad ?? 0),
        precio_unitario: precio,
        subtotal: cantidad * precio
    };
}

function inventoryMatchesOrderPartSearch(product, query) {
    const searchable = [
        product.nombre,
        product.codigo,
        product.codigo_barras,
        product.descripcion,
        product.categoria
    ].map(normalizeText).join(' ');
    return searchable.includes(query);
}

function renderOrderPartSuggestions() {
    const input = document.getElementById('order-part-search');
    const dropdown = document.getElementById('order-part-suggestions');
    if (!input || !dropdown) return;

    const query = normalizeText(input.value);
    dropdown.innerHTML = '';
    APP_STATE.selectedOrderPart = null;
    if (!query) {
        dropdown.classList.add('hidden');
        return;
    }

    const matches = APP_STATE.inventario
        .filter(product => getInventoryCategoryGroup(product.categoria) === 'Refacciones')
        .filter(product => inventoryMatchesOrderPartSearch(product, query))
        .slice(0, 8);

    if (matches.length === 0) {
        dropdown.classList.add('hidden');
        return;
    }

    dropdown.classList.remove('hidden');
    matches.forEach(product => {
        const div = document.createElement('div');
        const code = getProductBarcode(product);
        div.innerHTML = `<strong>${escapeHtml(product.nombre)}</strong><small>${escapeHtml(code)} · Stock ${Number(product.stock || 0)} · $${Number(product.precio || 0).toFixed(2)}</small>`;
        div.addEventListener('click', () => {
            APP_STATE.selectedOrderPart = normalizeOrderPart(product, { originalCantidad: 0 });
            input.value = `${product.nombre} (${code})`;
            dropdown.classList.add('hidden');
        });
        dropdown.appendChild(div);
    });
}

function addSelectedOrderPart() {
    const selected = APP_STATE.selectedOrderPart;
    const qtyInput = document.getElementById('order-part-qty');
    const searchInput = document.getElementById('order-part-search');
    const cantidad = parseInt(qtyInput?.value, 10) || 0;

    if (!selected) {
        alert('Selecciona una refacción del inventario.');
        searchInput?.focus();
        return;
    }
    if (cantidad <= 0) {
        alert('La cantidad debe ser mayor a cero.');
        qtyInput?.focus();
        return;
    }

    const existing = APP_STATE.currentOrderParts.find(part => Number(part.producto_id) === Number(selected.producto_id));
    if (existing) {
        const maxQty = getOrderPartMaxQuantity(existing);
        const nextQty = Number(existing.cantidad || 0) + cantidad;
        if (nextQty > maxQty) {
            alert(`Stock insuficiente para "${existing.nombre}". Disponible: ${maxQty} pz.`);
            return;
        }
        existing.cantidad = nextQty;
        existing.subtotal = existing.cantidad * existing.precio_unitario;
    } else {
        const part = normalizeOrderPart(selected, { cantidad, originalCantidad: 0 });
        const maxQty = getOrderPartMaxQuantity(part);
        if (cantidad > maxQty) {
            alert(`Stock insuficiente para "${part.nombre}". Disponible: ${maxQty} pz.`);
            return;
        }
        APP_STATE.currentOrderParts.push(part);
    }

    APP_STATE.selectedOrderPart = null;
    if (searchInput) searchInput.value = '';
    if (qtyInput) qtyInput.value = 1;
    renderOrderPartsTable();
}

function updateOrderPartQuantity(productoId, cantidad) {
    const part = APP_STATE.currentOrderParts.find(item => Number(item.producto_id) === Number(productoId));
    if (!part) return;
    const nextQty = parseInt(cantidad, 10) || 0;
    const maxQty = getOrderPartMaxQuantity(part);
    if (nextQty <= 0) {
        alert('La cantidad debe ser mayor a cero.');
        renderOrderPartsTable();
        return;
    }
    if (nextQty > maxQty) {
        alert(`Stock insuficiente para "${part.nombre}". Disponible: ${maxQty} pz.`);
        renderOrderPartsTable();
        return;
    }
    part.cantidad = nextQty;
    part.subtotal = part.cantidad * part.precio_unitario;
    renderOrderPartsTable();
}

function removeOrderPart(productoId) {
    APP_STATE.currentOrderParts = APP_STATE.currentOrderParts.filter(part => Number(part.producto_id) !== Number(productoId));
    renderOrderPartsTable();
}

function renderOrderPartsTable() {
    const tbody = document.querySelector('#order-parts-table tbody');
    if (!tbody) return;
    const count = APP_STATE.currentOrderParts.length;
    setTextContent('order-parts-count', `${count} ${count === 1 ? 'refacción' : 'refacciones'}`);

    if (count === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Sin refacciones agregadas</td></tr>';
        updateOrderCostState();
        return;
    }

    tbody.innerHTML = APP_STATE.currentOrderParts.map(part => {
        const maxQty = getOrderPartMaxQuantity(part);
        const subtotal = Number(part.cantidad || 0) * Number(part.precio_unitario || 0);
        return `
            <tr>
                <td>${escapeHtml(part.nombre || part.refaccion)}</td>
                <td>${escapeHtml(part.codigo || 'S/C')}</td>
                <td>${maxQty}</td>
                <td>
                    <input type="number" class="form-control order-part-qty-input" min="1" max="${maxQty}" step="1" value="${Number(part.cantidad || 1)}" data-producto-id="${part.producto_id}">
                </td>
                <td>$${Number(part.precio_unitario || 0).toFixed(2)}</td>
                <td>$${subtotal.toFixed(2)}</td>
                <td>
                    <button type="button" class="btn btn-xs btn-danger btn-remove-order-part" data-producto-id="${part.producto_id}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.order-part-qty-input').forEach(input => {
        input.addEventListener('change', () => updateOrderPartQuantity(input.dataset.productoId, input.value));
    });
    tbody.querySelectorAll('.btn-remove-order-part').forEach(button => {
        button.addEventListener('click', () => removeOrderPart(button.dataset.productoId));
    });
    updateOrderCostState();
}

function collectOrderParts() {
    return APP_STATE.currentOrderParts.map(part => ({
        producto_id: Number(part.producto_id),
        cantidad: Number(part.cantidad || 0),
        precio_unitario: Number(part.precio_unitario || 0),
        subtotal: Number(part.cantidad || 0) * Number(part.precio_unitario || 0)
    }));
}

function setOrderParts(parts = []) {
    APP_STATE.currentOrderParts = (parts || []).map(part => normalizeOrderPart(part, {
        cantidad: Number(part.cantidad || 0),
        originalCantidad: Number(part.cantidad || 0),
        precio_unitario: Number(part.precio_unitario ?? part.precio_actual ?? 0)
    }));
    renderOrderPartsTable();
}

function initOrderPartsUI() {
    const searchInput = document.getElementById('order-part-search');
    const addButton = document.getElementById('btn-add-order-part');
    if (!searchInput || !addButton) return;

    searchInput.addEventListener('input', renderOrderPartSuggestions);
    searchInput.addEventListener('focus', renderOrderPartSuggestions);
    addButton.addEventListener('click', addSelectedOrderPart);
    document.getElementById('order-part-qty')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addSelectedOrderPart();
        }
    });
    document.getElementById('form-mano-obra')?.addEventListener('input', updateOrderCostState);
    document.addEventListener('click', event => {
        const dropdown = document.getElementById('order-part-suggestions');
        if (!dropdown || searchInput.contains(event.target) || dropdown.contains(event.target)) return;
        dropdown.classList.add('hidden');
    });
}

function initAutoGrowTextareas() {
    document.querySelectorAll('textarea.auto-grow-textarea').forEach(textarea => {
        const resize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        };
        textarea.addEventListener('input', resize);
        resize();
    });
}

function validateOrderMinimums() {
    const clientId = document.getElementById('order-form')?.dataset.selectedClientId || '';
    const clientName = buildClientFullName();
    const deviceType = getInputValue('form-device-type').trim();
    const brand = getInputValue('form-device-brand').trim();
    const model = getInputValue('form-device-model').trim();
    const deviceDescription = getInputValue('form-device-description').trim();
    const falla = getInputValue('form-falla-reportada').trim();
    const service = getInputValue('form-servicio-solicitado').trim();

    if (!clientId && !clientName) {
        alert('Escribe el nombre del cliente o selecciona un cliente existente.');
        document.getElementById('form-client-name')?.focus();
        return false;
    }
    const duplicateMatch = checkClientDuplicateState();
    if (duplicateMatch) {
        alert(duplicateMatch.type === 'strong'
            ? 'Ya existe un cliente registrado con este telefono. Usa el cliente existente.'
            : 'Revisa la posible coincidencia de cliente antes de guardar.');
        document.getElementById('form-client-name')?.focus();
        return false;
    }
    if (!deviceType) {
        alert('Selecciona el tipo de equipo.');
        document.getElementById('form-device-type')?.focus();
        return false;
    }
    if (!(brand && model) && !deviceDescription) {
        alert('Escribe marca y modelo, o una descripción clara del equipo.');
        document.getElementById('form-device-brand')?.focus();
        return false;
    }
    if (!falla && !service) {
        alert('Describe la falla reportada o el servicio solicitado.');
        document.getElementById('form-falla-reportada')?.focus();
        return false;
    }
    return true;
}

function openOrderModal() {
    document.getElementById('order-form').reset();
    document.getElementById('order-form').dataset.currentPhotos = JSON.stringify(getOrderPhotos({}));
    document.getElementById('order-form').dataset.selectedClientId = '';
    document.getElementById('order-form').dataset.allowDuplicateClient = '';
    document.getElementById('form-order-id').value = '';
    document.getElementById('form-order-status').value = 'Recibido';
    document.getElementById('form-order-status').dispatchEvent(new Event('change'));
    document.getElementById('order-modal-title').innerText = 'Nueva Orden de Servicio';
    const evidenceComment = document.getElementById('evidence-comment');
    if (evidenceComment) evidenceComment.value = '';
    const evidenceVisible = document.getElementById('evidence-visible-client');
    if (evidenceVisible) {
        evidenceVisible.dataset.touched = '';
        evidenceVisible.checked = true;
    }
    const photoInput = document.getElementById('photo-input-evidencias');
    if (photoInput) photoInput.value = '';
    renderOrderPhotoPreviews(getOrderPhotos({}));
    renderEvidenceHistory({});
    setOrderParts([]);
    setInputValue('form-mano-obra', '0');
    setInputValue('form-costo-refaccion', '0');
    setInputValue('form-costo-real', '');
    resetOrderWarrantyFields();
    
    // Reiniciar Canvas
    clearSignature();
    clearPattern();
    
    document.querySelectorAll('#order-modal .modal-tab-content').forEach(content => {
        content.classList.remove('hidden');
    });
    document.querySelector('#order-modal .new-order-advanced-panel')?.removeAttribute('open');
    setOrderWizardStep(1);
    resetLockState();
    setRadioValue('client_contact_method', 'WhatsApp');
    setRadioValue('client_type', 'existing');
    document.getElementById('existing-client-search-group')?.classList.remove('hidden');
    hideClientDuplicateAlert();
    hideClientExistingSelectedNotice();
    updateOrderConditionalFields();

    // Default dates
    const date = new Date();
    date.setDate(date.getDate() + 3); // 3 dias despues
    document.getElementById('form-fecha-entrega').value = date.toISOString().split('T')[0];
    updateEvidenceStateUI();
    updateOrderCostState();
    updateOrderWarrantyUI();
    updateOrderConditionalFields();

    // Ocultar sección de ganancias para no administradores
    applyRolePermissions();

    orderModal.classList.remove('hidden');
}

// Lógica de autocompletado de cliente al crear orden
function initClientAutocomplete() {
    const radioExisting = document.querySelector('input[name="client_type"][value="existing"]');
    const radioNew = document.querySelector('input[name="client_type"][value="new"]');
    const searchGroup = document.getElementById('existing-client-search-group');
    const searchInput = document.getElementById('order-client-search');
    const resultsDropdown = document.getElementById('order-client-search-results');
    const nameInput = document.getElementById('form-client-name');
    const lastNamesInput = document.getElementById('form-client-lastnames');
    const phoneInput = document.getElementById('form-client-phone');
    const useDuplicateButton = document.getElementById('btn-use-duplicate-client');
    const continueNewButton = document.getElementById('btn-continue-new-client');
    let searchDebounce = null;
    let duplicateDebounce = null;

    radioExisting.addEventListener('change', () => {
        searchGroup.classList.remove('hidden');
        clearClientInputs();
    });
    radioNew.addEventListener('change', () => {
        searchGroup.classList.add('hidden');
        clearClientInputs();
        enableClientInputs();
    });

    const renderMatches = () => {
        const val = searchInput.value;
        resultsDropdown.innerHTML = '';
        if (!normalizeClientLookupText(val)) {
            resultsDropdown.classList.add('hidden');
            return;
        }

        const matches = findClientSearchMatches(val);

        if (matches.length > 0) {
            resultsDropdown.classList.remove('hidden');
            matches.forEach(c => {
                const div = document.createElement('div');
                const phone = c.telefono || c.telefono_principal || 'Sin teléfono';
                const name = document.createElement('strong');
                const phoneLabel = document.createElement('span');
                name.textContent = getClientDisplayName(c);
                phoneLabel.textContent = maskClientPhone(phone);
                div.append(name, phoneLabel);
                div.addEventListener('click', () => {
                    selectExistingClient(c);
                    resultsDropdown.classList.add('hidden');
                    searchInput.value = getClientDisplayName(c);
                });
                resultsDropdown.appendChild(div);
            });
        } else {
            resultsDropdown.classList.add('hidden');
        }
    };

    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(renderMatches, 300);
    });

    [nameInput, lastNamesInput, phoneInput].forEach(input => {
        input?.addEventListener('input', () => {
            const form = document.getElementById('order-form');
            if (form) form.dataset.allowDuplicateClient = '';
            if (input === lastNamesInput) syncClientLastNameFields();
            clearTimeout(duplicateDebounce);
            duplicateDebounce = setTimeout(() => checkClientDuplicateState(), 300);
        });
    });

    useDuplicateButton?.addEventListener('click', () => {
        const match = findClientDuplicateFromInputs();
        if (match?.client) {
            selectExistingClient(match.client, { showNotice: true });
            hideClientDuplicateAlert();
        }
    });

    continueNewButton?.addEventListener('click', () => {
        const form = document.getElementById('order-form');
        if (form) form.dataset.allowDuplicateClient = 'true';
        hideClientDuplicateAlert();
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDropdown.contains(e.target)) {
            resultsDropdown.classList.add('hidden');
        }
    });
}

function clearClientInputs() {
    const form = document.getElementById('order-form');
    if (form) {
        form.dataset.selectedClientId = '';
        form.dataset.allowDuplicateClient = '';
    }
    setInputValue('form-client-name', '');
    setInputValue('form-client-lastnames', '');
    setInputValue('form-client-lastname-paternal', '');
    setInputValue('form-client-lastname-maternal', '');
    setInputValue('form-client-phone', '');
    setInputValue('form-client-phone-alt1', '');
    setInputValue('form-client-email', '');
    setInputValue('form-client-address', '');
    setRadioValue('client_contact_method', 'WhatsApp');
    hideClientDuplicateAlert();
    hideClientExistingSelectedNotice();
}

function enableClientInputs() {
    document.getElementById('form-client-name').disabled = false;
    document.getElementById('form-client-phone').disabled = false;
}

function populateClientInputs(c) {
    const form = document.getElementById('order-form');
    if (form) {
        form.dataset.selectedClientId = c.id || '';
        form.dataset.allowDuplicateClient = '';
    }
    const splitName = splitFullClientName(c.nombre || '');
    const apellidoPaterno = c.apellido_paterno || splitName.apellidoPaterno || '';
    const apellidoMaterno = c.apellido_materno || splitName.apellidoMaterno || '';
    setInputValue('form-client-name', getClientFirstNames(c) || splitName.nombres);
    setClientLastNames(apellidoPaterno, apellidoMaterno);
    setInputValue('form-client-phone', c.telefono || c.telefono_principal || '');
    setInputValue('form-client-phone-alt1', c.telefono_alt1 || c.telefono_alternativo_1 || '');
    setInputValue('form-client-email', c.email || c.correo || '');
    setInputValue('form-client-address', c.direccion || '');
    setRadioValue('client_contact_method', c.contacto_preferido || c.preferredContact || 'WhatsApp');
}

function selectExistingClient(client, options = {}) {
    const radioExisting = document.querySelector('input[name="client_type"][value="existing"]');
    const searchGroup = document.getElementById('existing-client-search-group');
    const searchInput = document.getElementById('order-client-search');
    if (radioExisting) radioExisting.checked = true;
    searchGroup?.classList.remove('hidden');
    populateClientInputs(client);
    if (searchInput) searchInput.value = getClientDisplayName(client);
    if (options.showNotice) showClientExistingSelectedNotice();
}

function hideClientDuplicateAlert() {
    document.getElementById('client-duplicate-alert')?.classList.add('hidden');
}

function hideClientExistingSelectedNotice() {
    document.getElementById('client-existing-selected-notice')?.classList.add('hidden');
}

function showClientExistingSelectedNotice() {
    const notice = document.getElementById('client-existing-selected-notice');
    if (!notice) return;
    notice.classList.remove('hidden');
    setTimeout(() => notice.classList.add('hidden'), 3500);
}

function showClientDuplicateAlert(match) {
    const alertBox = document.getElementById('client-duplicate-alert');
    if (!alertBox || !match?.client) return;
    const title = document.getElementById('client-duplicate-title');
    const message = document.getElementById('client-duplicate-message');
    const found = document.getElementById('client-duplicate-match');
    const continueButton = document.getElementById('btn-continue-new-client');
    const phone = match.client.telefono || match.client.telefono_principal || '';

    if (title) title.textContent = match.type === 'strong'
        ? 'Ya existe un cliente registrado con este telefono.'
        : 'Encontramos un cliente con datos similares.';
    if (message) message.textContent = match.type === 'strong'
        ? 'Reutiliza el cliente existente para evitar duplicados.'
        : 'Puede ser un homonimo. Revisa la coincidencia antes de continuar.';
    if (found) found.textContent = `${getClientDisplayName(match.client)} - ${maskClientPhone(phone)}`;
    if (continueButton) continueButton.classList.toggle('hidden', match.type === 'strong');
    alertBox.classList.remove('hidden');
}

function checkClientDuplicateState() {
    hideClientExistingSelectedNotice();
    const form = document.getElementById('order-form');
    const radioExisting = document.querySelector('input[name="client_type"][value="existing"]');
    const radioNew = document.querySelector('input[name="client_type"][value="new"]');
    const match = findClientDuplicateFromInputs();

    if (!match) {
        hideClientDuplicateAlert();
        return null;
    }

    if (radioExisting?.checked && (match.type === 'strong' || match.fullNameMatch)) {
        selectExistingClient(match.client, { showNotice: true });
        hideClientDuplicateAlert();
        return null;
    }

    if (radioNew?.checked && form?.dataset.allowDuplicateClient !== 'true') {
        showClientDuplicateAlert(match);
        return match;
    }

    hideClientDuplicateAlert();
    return null;
}

function updateLockVisibility() {
    const hasLock = document.getElementById('equipment-has-lock');
    const lockContainer = document.querySelector('#order-modal .lock-setup-container');
    const lockStatus = document.getElementById('equipment-lock-status');
    const lockPinGroup = document.getElementById('lock-pin-group');
    const lockPassGroup = document.getElementById('lock-pass-group');
    const lockPatternGroup = document.getElementById('lock-pattern-group');
    const lockPinInput = document.getElementById('form-lock-pin');
    const lockPassInput = document.getElementById('form-lock-pass');
    const lockPatternInput = document.getElementById('form-lock-pattern-sequence');
    const lockPatternDescriptionInput = document.getElementById('form-lock-pattern-description');
    const selectedLock = document.querySelector('input[name="lock_type"]:checked');
    const noneRadio = document.querySelector('input[name="lock_type"][value="Ninguno"]');

    if (!hasLock || !lockContainer) return;
    if (lockStatus) lockStatus.textContent = hasLock.checked ? 'Con bloqueo' : 'Sin bloqueo';

    lockPinGroup?.classList.add('hidden');
    lockPassGroup?.classList.add('hidden');
    lockPatternGroup?.classList.add('hidden');
    if (lockPinInput) lockPinInput.required = false;
    if (lockPassInput) lockPassInput.required = false;
    if (lockPatternInput) lockPatternInput.required = false;

    if (!hasLock.checked) {
        if (noneRadio) noneRadio.checked = true;
        if (lockPinInput) lockPinInput.value = '';
        if (lockPassInput) lockPassInput.value = '';
        if (lockPatternInput) lockPatternInput.value = '';
        if (lockPatternDescriptionInput) lockPatternDescriptionInput.value = '';
        lockContainer.classList.add('hidden');
        return;
    }

    lockContainer.classList.remove('hidden');
    const value = selectedLock?.value || 'Ninguno';

    if (value === 'PIN') {
        lockPinGroup?.classList.remove('hidden');
        if (lockPinInput) lockPinInput.required = true;
    } else if (value === 'Contraseña') {
        lockPassGroup?.classList.remove('hidden');
        if (lockPassInput) lockPassInput.required = true;
    } else if (value === 'Patrón') {
        lockPatternGroup?.classList.remove('hidden');
        if (lockPatternInput) lockPatternInput.required = true;
    }
}

function resetLockState() {
    const hasLock = document.getElementById('equipment-has-lock');
    const noneRadio = document.querySelector('input[name="lock_type"][value="Ninguno"]');
    if (hasLock) hasLock.checked = false;
    if (noneRadio) noneRadio.checked = true;
    updateLockVisibility();
}

function validateOrderLock() {
    const hasLock = document.getElementById('equipment-has-lock');
    if (!hasLock?.checked) return true;

    const selectedLock = document.querySelector('input[name="lock_type"]:checked');
    const lockType = selectedLock?.value || 'Ninguno';

    if (lockType === 'Ninguno') {
        alert('Selecciona el tipo de bloqueo: PIN, Contraseña o Patrón.');
        return false;
    }
    if (lockType === 'PIN' && !document.getElementById('form-lock-pin').value.trim()) {
        alert('Escribe el PIN del equipo.');
        document.getElementById('form-lock-pin').focus();
        return false;
    }
    if (lockType === 'Contraseña' && !document.getElementById('form-lock-pass').value.trim()) {
        alert('Escribe la contraseña del equipo.');
        document.getElementById('form-lock-pass').focus();
        return false;
    }
    if (lockType === 'Patrón') {
        const sequence = document.getElementById('form-lock-pattern-sequence').value
            .split('-')
            .filter(Boolean);
        const patternDescription = document.getElementById('form-lock-pattern-description')?.value.trim();
        if (sequence.length < 4 && !patternDescription) {
            alert('Dibuja mínimo 4 puntos o describe el patrón.');
            return false;
        }
    }

    return true;
}

// Autocompletado de Marcas, Modelos y Fallas
function initDeviceAutocomplete() {
    const deviceTypeInput = document.getElementById('form-device-type');
    const brandInput = document.getElementById('form-device-brand');
    const brandDropdown = document.getElementById('brand-suggestions');
    const modelInput = document.getElementById('form-device-model');
    const modelDropdown = document.getElementById('model-suggestions');
    const fallaInput = document.getElementById('form-falla-reportada');
    const fallaDropdown = document.getElementById('falla-suggestions');
    const serviceInput = document.getElementById('form-servicio-solicitado');
    const serviceDropdown = document.getElementById('service-suggestions');

    brandInput.setAttribute('autocomplete', 'new-password');
    brandInput.setAttribute('name', `allfix-device-brand-${Date.now()}`);
    modelInput.setAttribute('autocomplete', 'new-password');
    modelInput.setAttribute('name', `allfix-device-model-${Date.now()}`);
    fallaInput.setAttribute('autocomplete', 'new-password');
    fallaInput.setAttribute('name', `allfix-falla-${Date.now()}`);
    serviceInput.setAttribute('autocomplete', 'new-password');
    serviceInput.setAttribute('name', `allfix-service-${Date.now()}`);

    const deviceAutocompleteCatalog = {
        Celular: {
            brands: ['Samsung', 'Apple', 'Xiaomi', 'Motorola', 'Huawei', 'Oppo', 'Vivo', 'Honor', 'Tecno', 'Infinix', 'LG'],
            models: {
                Samsung: ['Galaxy S25 Ultra', 'Galaxy S24 Ultra', 'Galaxy S23 Ultra', 'Galaxy A56 5G', 'Galaxy A55 5G', 'Galaxy A36 5G', 'Galaxy A35 5G', 'Galaxy A16', 'Galaxy Z Flip6', 'Galaxy Z Fold6'],
                Apple: ['iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16', 'iPhone 15 Pro Max', 'iPhone 15', 'iPhone 14', 'iPhone 13', 'iPhone 11', 'iPhone XR'],
                Xiaomi: ['Xiaomi 15', 'Xiaomi 14T', 'Xiaomi 13T', 'Redmi Note 14 Pro', 'Redmi Note 13 Pro', 'Redmi 14C', 'Poco F6', 'Poco X6 Pro', 'Poco C65'],
                Motorola: ['Razr 50 Ultra', 'Edge 50 Pro', 'Edge 50 Neo', 'Moto G85', 'Moto G84', 'Moto G54', 'Moto G34', 'Moto E14'],
                Huawei: ['Pura 70', 'Pura 70 Pro', 'Mate 60 Pro', 'Nova 12', 'Nova 11', 'Y9a'],
                Oppo: ['Reno 12', 'Reno 11', 'Find X7', 'A60', 'A78', 'A58'],
                Vivo: ['V40', 'V30', 'Y28', 'Y38', 'Y18'],
                Honor: ['Magic6 Pro', 'Honor 200', 'Honor 90', 'X9b', 'X8b'],
                Tecno: ['Spark 20', 'Spark 20 Pro', 'Camon 30', 'Pova 6 Pro'],
                Infinix: ['Hot 40', 'Hot 40 Pro', 'Note 40', 'Zero 30'],
                LG: ['K51', 'K61', 'Velvet', 'Wing', 'G8 ThinQ']
            }
        },
        Tablet: {
            brands: ['Apple', 'Samsung', 'Lenovo', 'Xiaomi', 'Huawei', 'Honor', 'Amazon', 'Microsoft'],
            models: {
                Apple: ['iPad 10th Gen', 'iPad Air 11', 'iPad Air 13', 'iPad Pro 11', 'iPad Pro 13', 'iPad mini 6'],
                Samsung: ['Galaxy Tab S10 Ultra', 'Galaxy Tab S10+', 'Galaxy Tab S9', 'Galaxy Tab S9 FE', 'Galaxy Tab A9+', 'Galaxy Tab A9'],
                Lenovo: ['Tab M11', 'Tab Plus', 'Tab P12', 'Yoga Tab Plus', 'Legion Tab'],
                Xiaomi: ['Xiaomi Pad 7', 'Xiaomi Pad 6', 'Redmi Pad Pro', 'Redmi Pad SE'],
                Huawei: ['MatePad 11.5', 'MatePad Pro', 'MatePad SE', 'MatePad T10'],
                Honor: ['Honor Pad 9', 'Honor Pad X9', 'Honor Pad 8'],
                Amazon: ['Fire HD 8', 'Fire HD 10', 'Fire Max 11'],
                Microsoft: ['Surface Pro 9', 'Surface Pro 10', 'Surface Go 4']
            }
        },
        Laptop: {
            brands: ['Apple', 'Dell', 'HP', 'Lenovo', 'ASUS', 'Acer', 'MSI', 'Microsoft', 'Huawei', 'Samsung', 'Razer'],
            models: {
                Apple: ['MacBook Air 13', 'MacBook Air 15', 'MacBook Pro 14', 'MacBook Pro 16'],
                Dell: ['XPS 13', 'XPS 14', 'XPS 16', 'Inspiron 14', 'Inspiron 15', 'Latitude 5450', 'Precision 5680', 'Alienware m16', 'Dell Pro 14', 'Dell Pro Max 16'],
                HP: ['Pavilion 15', 'Envy x360', 'Spectre x360', 'OmniBook 7', 'Victus 15', 'Omen 16', 'EliteBook 840', 'ProBook 450', 'ZBook Studio'],
                Lenovo: ['ThinkPad X1 Carbon', 'ThinkPad T14', 'ThinkPad E14', 'IdeaPad Slim 3', 'Yoga 7', 'Yoga 9i', 'Legion 5', 'Legion Pro 7', 'LOQ 15', 'ThinkBook 14'],
                ASUS: ['Zenbook 14', 'Zenbook A14', 'Vivobook 15', 'Vivobook S14', 'ROG Zephyrus G14', 'ROG Strix G16', 'TUF Gaming A15', 'ExpertBook B5', 'ProArt P16'],
                Acer: ['Aspire 5', 'Swift Go 14', 'Spin 5', 'TravelMate P2', 'Nitro V 15', 'Predator Helios Neo 16'],
                MSI: ['Modern 14', 'Prestige 14', 'Katana 15', 'Cyborg 15', 'Stealth 16', 'Raider GE78'],
                Microsoft: ['Surface Laptop 6', 'Surface Laptop 7', 'Surface Pro 10', 'Surface Laptop Go 3', 'Surface Laptop Studio 2'],
                Huawei: ['MateBook D 14', 'MateBook D 16', 'MateBook X Pro', 'MateBook 14'],
                Samsung: ['Galaxy Book4', 'Galaxy Book4 Pro', 'Galaxy Book4 Ultra', 'Galaxy Book5 Pro'],
                Razer: ['Blade 14', 'Blade 15', 'Blade 16', 'Blade 18']
            }
        },
        Consola: {
            brands: ['Sony', 'Microsoft', 'Nintendo', 'Valve', 'ASUS', 'Lenovo', 'MSI'],
            models: {
                Sony: ['PlayStation 5', 'PlayStation 5 Slim', 'PlayStation 5 Digital Edition', 'PlayStation 5 Pro', 'PlayStation 4', 'PlayStation 4 Pro'],
                Microsoft: ['Xbox Series X', 'Xbox Series S', 'Xbox One', 'Xbox One S', 'Xbox One X'],
                Nintendo: ['Switch 2', 'Switch OLED', 'Switch', 'Switch Lite', '3DS', '2DS'],
                Valve: ['Steam Deck LCD', 'Steam Deck OLED'],
                ASUS: ['ROG Ally', 'ROG Ally X'],
                Lenovo: ['Legion Go', 'Legion Go S'],
                MSI: ['Claw A1M', 'Claw 8 AI+']
            }
        },
        Bocina: {
            brands: ['JBL', 'Sony', 'Bose', 'Marshall', 'Ultimate Ears', 'Sonos', 'Harman Kardon', 'Xiaomi', 'Anker Soundcore', 'Philips'],
            models: {
                JBL: ['Go 4', 'Clip 5', 'Flip 6', 'Charge 5', 'Xtreme 4', 'Boombox 3', 'PartyBox 110', 'PartyBox 310', 'PartyBox Stage 320'],
                Sony: ['SRS-XB100', 'SRS-XB23', 'SRS-XB33', 'SRS-XB43', 'ULT Field 1', 'ULT Field 7', 'ULT Tower 10'],
                Bose: ['SoundLink Flex', 'SoundLink Micro', 'SoundLink Revolve+', 'Portable Smart Speaker'],
                Marshall: ['Willen', 'Emberton II', 'Middleton', 'Stockwell II', 'Acton III', 'Stanmore III', 'Woburn III'],
                'Ultimate Ears': ['Wonderboom 4', 'Boom 4', 'Megaboom 4', 'Epicboom', 'Hyperboom', 'Miniroll'],
                Sonos: ['Roam 2', 'Move 2', 'Era 100', 'Era 300'],
                'Harman Kardon': ['Onyx Studio 7', 'Onyx Studio 8', 'Aura Studio 4', 'Go + Play 3'],
                Xiaomi: ['Mi Portable Bluetooth Speaker', 'Sound Outdoor', 'Sound Pocket', 'Smart Speaker IR Control'],
                'Anker Soundcore': ['Motion+', 'Motion 300', 'Motion X600', 'Boom 2', 'Rave Neo 2', 'Select 4 Go'],
                Philips: ['TAS2307', 'TAS2505', 'TAS4807', 'TAX2208']
            }
        },
        'Audífonos': {
            brands: ['Apple', 'Samsung', 'Sony', 'Bose', 'JBL', 'Beats', 'Sennheiser', 'Skullcandy', 'Huawei', 'Xiaomi', 'HyperX', 'Logitech', 'Razer', 'SteelSeries'],
            models: {
                Apple: ['AirPods 2', 'AirPods 3', 'AirPods 4', 'AirPods Pro 2', 'AirPods Max'],
                Samsung: ['Galaxy Buds FE', 'Galaxy Buds2', 'Galaxy Buds2 Pro', 'Galaxy Buds3', 'Galaxy Buds3 Pro'],
                Sony: ['WH-1000XM5', 'WH-1000XM4', 'WF-1000XM5', 'WF-C700N', 'WH-CH720N', 'INZONE H9'],
                Bose: ['QuietComfort Ultra Headphones', 'QuietComfort Headphones', 'QuietComfort Ultra Earbuds', 'QuietComfort Earbuds II'],
                JBL: ['Tune 520BT', 'Tune 720BT', 'Tune 770NC', 'Live 770NC', 'Live Pro 2', 'Endurance Peak 3', 'Quantum 100'],
                Beats: ['Solo 4', 'Studio Pro', 'Fit Pro', 'Studio Buds+', 'Powerbeats Pro'],
                Sennheiser: ['Momentum 4 Wireless', 'Momentum True Wireless 4', 'Accentum Wireless', 'HD 450BT'],
                Skullcandy: ['Crusher ANC 2', 'Crusher Evo', 'Dime 3', 'Rail ANC', 'Indy Evo'],
                Huawei: ['FreeBuds Pro 3', 'FreeBuds 6i', 'FreeBuds SE 2', 'FreeClip'],
                Xiaomi: ['Redmi Buds 5', 'Redmi Buds 5 Pro', 'Xiaomi Buds 5', 'Xiaomi Buds 4 Pro'],
                HyperX: ['Cloud II', 'Cloud III', 'Cloud Alpha', 'Cloud Stinger 2'],
                Logitech: ['G435', 'G733', 'G Pro X', 'Zone Vibe 100'],
                Razer: ['BlackShark V2', 'Kraken V3', 'Barracuda X', 'Hammerhead Pro HyperSpeed'],
                SteelSeries: ['Arctis Nova 1', 'Arctis Nova 5', 'Arctis Nova 7', 'Arctis Nova Pro']
            }
        },
        Otro: {
            brands: ['Genérico', 'Otra marca'],
            models: {
                Genérico: ['Modelo personalizado'],
                'Otra marca': ['Escribe modelo personalizado']
            }
        }
    };
    const deviceIssueServiceCatalog = {
        Celular: {
            fallas: ['Pantalla rota o sin imagen', 'Touch no responde', 'Batería inflada/no retiene carga', 'Centro de carga dañado', 'No enciende', 'Se reinicia solo', 'Mojado o con humedad', 'Cámara dañada/empañada', 'Micrófono no funciona', 'Bocina rota/distorsionada', 'Sin señal/SIM no detectada', 'WiFi o Bluetooth no funciona', 'Falla de software/bucle de arranque', 'Equipo lento o se traba', 'Face ID/huella no funciona'],
            servicios: ['Diagnóstico general', 'Cambio de pantalla', 'Cambio de batería', 'Cambio de centro de carga', 'Limpieza por humedad', 'Cambio de cámara', 'Cambio de micrófono', 'Cambio de bocina/auricular', 'Reparación de señal/antena', 'Reinstalación o actualización de software', 'Respaldo y recuperación de datos', 'Mantenimiento interno', 'Desbloqueo o restauración', 'Cambio de tapa trasera']
        },
        Tablet: {
            fallas: ['Pantalla rota o sin imagen', 'Touch no responde', 'Batería no retiene carga', 'Puerto de carga dañado', 'No enciende', 'Se reinicia sola', 'Mojada o con humedad', 'WiFi/Bluetooth no funciona', 'Cámara no funciona', 'Bocina distorsionada', 'Botones dañados', 'Sistema lento o bloqueado'],
            servicios: ['Diagnóstico de tablet', 'Cambio de pantalla/touch', 'Cambio de batería', 'Cambio de puerto de carga', 'Limpieza por humedad', 'Reparación de WiFi/Bluetooth', 'Cambio de bocina', 'Cambio de cámara', 'Actualización/restauración de sistema', 'Mantenimiento interno']
        },
        Laptop: {
            fallas: ['No enciende', 'No carga', 'Pantalla rota o sin imagen', 'Teclado no funciona', 'Touchpad no responde', 'Se calienta demasiado', 'Se apaga sola', 'Equipo lento', 'Disco duro/SSD dañado', 'Bisagras dañadas', 'Ventilador ruidoso o trabado', 'Puerto USB/HDMI dañado', 'WiFi no funciona', 'Sistema no inicia', 'Derrame de líquido'],
            servicios: ['Diagnóstico de laptop', 'Cambio de pantalla', 'Cambio de batería', 'Cambio de cargador/jack DC', 'Cambio de teclado', 'Cambio de touchpad', 'Limpieza interna y cambio de pasta térmica', 'Instalación de SSD/HDD', 'Instalación o reparación de Windows', 'Respaldo y recuperación de datos', 'Reparación de bisagras/carcasa', 'Cambio de ventilador', 'Reparación de puertos USB/HDMI', 'Limpieza por líquido']
        },
        Consola: {
            fallas: ['No enciende', 'No da imagen', 'Puerto HDMI dañado', 'Se calienta demasiado', 'Se apaga sola', 'No lee discos', 'Disco atorado', 'Control no sincroniza', 'Stick drift en control', 'No conecta a internet', 'Fuente de poder dañada', 'Almacenamiento lleno o dañado', 'Sistema corrupto/no inicia', 'Ventilador ruidoso'],
            servicios: ['Diagnóstico de consola', 'Cambio de puerto HDMI', 'Mantenimiento profundo y pasta térmica', 'Reparación de fuente de poder', 'Cambio de lector de discos', 'Extracción de disco atorado', 'Reparación de control', 'Cambio de joystick/stick', 'Reparación de módulo WiFi/Bluetooth', 'Reinstalación de sistema', 'Cambio o ampliación de almacenamiento', 'Cambio de ventilador']
        },
        Bocina: {
            fallas: ['No enciende', 'No carga', 'Puerto de carga dañado', 'Batería no retiene carga', 'No suena', 'Sonido distorsionado', 'Bajo volumen', 'No conecta Bluetooth', 'Botones no funcionan', 'Se apaga sola', 'Mojada o con humedad', 'Corneta/parlante dañado', 'Amplificador interno dañado'],
            servicios: ['Diagnóstico de bocina', 'Cambio de batería', 'Cambio de puerto de carga', 'Reparación de módulo Bluetooth', 'Cambio de parlante/corneta', 'Reparación de amplificador', 'Limpieza por humedad', 'Reparación de botones', 'Mantenimiento interno', 'Revisión de tarjeta lógica']
        },
        'Audífonos': {
            fallas: ['No encienden', 'No cargan', 'Batería no dura', 'No sincronizan por Bluetooth', 'Se escucha solo un lado', 'Audio distorsionado', 'Micrófono no funciona', 'Diadema rota', 'Almohadillas dañadas', 'Cable dañado', 'Puerto de carga dañado', 'Botones/touch no responden', 'Estuche no carga audífonos', 'Mojados o con humedad'],
            servicios: ['Diagnóstico de audífonos', 'Cambio de batería', 'Cambio de puerto de carga', 'Reparación de Bluetooth/sincronización', 'Cambio de bocina/driver', 'Reparación de micrófono', 'Cambio de cable', 'Reparación de diadema', 'Cambio de almohadillas', 'Reparación de estuche de carga', 'Limpieza por humedad', 'Mantenimiento y limpieza']
        },
        Otro: {
            fallas: ['No enciende', 'No carga', 'No funciona correctamente', 'Falla intermitente', 'Golpe o daño físico', 'Mojado o con humedad', 'Puerto/conector dañado', 'Botones no funcionan'],
            servicios: ['Diagnóstico general', 'Revisión técnica', 'Mantenimiento', 'Limpieza por humedad', 'Reparación de conector', 'Cambio de pieza', 'Servicio personalizado']
        }
    };

    function getCurrentDeviceCatalog() {
        return deviceAutocompleteCatalog[deviceTypeInput.value] || deviceAutocompleteCatalog.Celular;
    }

    function getCurrentBrandSuggestions() {
        return getCurrentDeviceCatalog().brands || [];
    }

    function getModelSuggestionsForBrand(brandValue = brandInput.value) {
        const catalog = getCurrentDeviceCatalog();
        const selectedBrand = (catalog.brands || []).find(brand => normalizeText(brand) === normalizeText(brandValue));
        return selectedBrand ? catalog.models[selectedBrand] || [] : [];
    }

    function getCurrentIssueCatalog() {
        return deviceIssueServiceCatalog[deviceTypeInput.value] || deviceIssueServiceCatalog.Celular;
    }

    function getCurrentFailureSuggestions() {
        return getCurrentIssueCatalog().fallas || [];
    }

    function getCurrentServiceSuggestions() {
        return getCurrentIssueCatalog().servicios || [];
    }

    function updateDeviceAutocompleteContext() {
        const currentBrands = getCurrentBrandSuggestions();
        const selectedBrand = currentBrands.find(brand => normalizeText(brand) === normalizeText(brandInput.value));
        if (brandInput.value && !selectedBrand) {
            brandInput.value = '';
            modelInput.value = '';
        } else if (modelInput.value) {
            const validModels = getModelSuggestionsForBrand(selectedBrand || brandInput.value);
            const selectedModel = validModels.find(model => normalizeText(model) === normalizeText(modelInput.value));
            if (!selectedModel) modelInput.value = '';
        }

        if (fallaInput.value) {
            const validFailures = getCurrentFailureSuggestions();
            const selectedFailure = validFailures.find(falla => normalizeText(falla) === normalizeText(fallaInput.value));
            if (!selectedFailure) fallaInput.value = '';
        }

        if (serviceInput.value) {
            const validServices = getCurrentServiceSuggestions();
            const selectedService = validServices.find(service => normalizeText(service) === normalizeText(serviceInput.value));
            if (!selectedService) serviceInput.value = '';
        }

        brandDropdown.classList.add('hidden');
        modelDropdown.classList.add('hidden');
        fallaDropdown.classList.add('hidden');
        serviceDropdown.classList.add('hidden');
    }

    deviceTypeInput.addEventListener('change', updateDeviceAutocompleteContext);

    // Autocomplete Brand
    brandInput.addEventListener('focus', () => renderSuggestions(getCurrentBrandSuggestions(), brandInput, brandDropdown, () => {
        modelInput.value = '';
    }));
    brandInput.addEventListener('input', () => {
        const filtered = getCurrentBrandSuggestions().filter(b => normalizeText(b).includes(normalizeText(brandInput.value)));
        renderSuggestions(filtered, brandInput, brandDropdown, () => {
            modelInput.value = '';
        });
    });

    // Autocomplete Model
    modelInput.addEventListener('focus', () => {
        const suggestions = getModelSuggestionsForBrand();
        renderSuggestions(suggestions, modelInput, modelDropdown);
    });
    modelInput.addEventListener('input', () => {
        const allModels = getModelSuggestionsForBrand();
        const filtered = allModels.filter(m => normalizeText(m).includes(normalizeText(modelInput.value)));
        renderSuggestions(filtered, modelInput, modelDropdown);
    });

    // Autocomplete Fallas
    fallaInput.addEventListener('focus', () => renderSuggestions(getCurrentFailureSuggestions(), fallaInput, fallaDropdown));
    fallaInput.addEventListener('input', () => {
        const filtered = getCurrentFailureSuggestions().filter(f => normalizeText(f).includes(normalizeText(fallaInput.value)));
        renderSuggestions(filtered, fallaInput, fallaDropdown);
    });

    // Autocomplete Servicios
    serviceInput.addEventListener('focus', () => renderSuggestions(getCurrentServiceSuggestions(), serviceInput, serviceDropdown));
    serviceInput.addEventListener('input', () => {
        const filtered = getCurrentServiceSuggestions().filter(service => normalizeText(service).includes(normalizeText(serviceInput.value)));
        renderSuggestions(filtered, serviceInput, serviceDropdown);
    });

    function renderSuggestions(arr, input, dropdown, onSelect = null) {
        dropdown.innerHTML = '';
        if (arr.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }
        dropdown.classList.remove('hidden');
        arr.forEach(item => {
            const div = document.createElement('div');
            div.innerText = item;
            div.addEventListener('click', () => {
                input.value = item;
                if (typeof onSelect === 'function') onSelect(item);
                dropdown.classList.add('hidden');
            });
            dropdown.appendChild(div);
        });
    }

    document.addEventListener('click', (e) => {
        if (!brandInput.contains(e.target)) brandDropdown.classList.add('hidden');
        if (!modelInput.contains(e.target)) modelDropdown.classList.add('hidden');
        if (!fallaInput.contains(e.target)) fallaDropdown.classList.add('hidden');
        if (!serviceInput.contains(e.target)) serviceDropdown.classList.add('hidden');
    });
}

// Canvas del patrón de seguridad
function initPatternLock() {
    const canvas = document.getElementById('pattern-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const display = document.getElementById('pattern-sequence-display');
    const inputSeq = document.getElementById('form-lock-pattern-sequence');

    const size = 240;
    const r = 18;
    const sequence = [];
    const selected = new Set();
    let isDrawing = false;
    let currentPointer = null;

    canvas.width = size;
    canvas.height = size;

    const dots = [];
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            dots.push({
                id: row * 3 + col + 1,
                row,
                col,
                x: 40 + col * 80,
                y: 40 + row * 80
            });
        }
    }

    function updateSequenceDisplay() {
        const seqStr = sequence.join('-');
        display.innerText = seqStr || 'Ninguna';
        inputSeq.value = seqStr;
    }

    function getDotById(id) {
        return dots.find(dot => dot.id === id);
    }

    function drawGrid() {
        ctx.clearRect(0, 0, size, size);

        if (sequence.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = '#0d6efd';
            ctx.lineWidth = 6;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            const startDot = getDotById(sequence[0]);
            ctx.moveTo(startDot.x, startDot.y);

            for (let i = 1; i < sequence.length; i++) {
                const nextDot = getDotById(sequence[i]);
                ctx.lineTo(nextDot.x, nextDot.y);
            }

            if (isDrawing && currentPointer) {
                ctx.lineTo(currentPointer.x, currentPointer.y);
            }

            ctx.stroke();
        }

        dots.forEach(dot => {
            const isActive = selected.has(dot.id);

            ctx.beginPath();
            ctx.arc(dot.x, dot.y, r, 0, Math.PI * 2);
            ctx.fillStyle = isActive ? '#0d6efd' : '#cbd5e1';
            ctx.fill();
            ctx.lineWidth = isActive ? 4 : 2;
            ctx.strokeStyle = isActive ? '#bfdbfe' : '#e2e8f0';
            ctx.stroke();

            if (isActive) {
                ctx.beginPath();
                ctx.arc(dot.x, dot.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            }
        });
    }

    function getPointerPos(e) {
        const rect = canvas.getBoundingClientRect();
        const source = e.touches ? e.touches[0] : e.changedTouches ? e.changedTouches[0] : e;
        return {
            x: (source.clientX - rect.left) * (canvas.width / rect.width),
            y: (source.clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    function checkCollision(pos) {
        for (const dot of dots) {
            const dist = Math.hypot(pos.x - dot.x, pos.y - dot.y);
            if (dist <= r * 2.2) return dot;
        }
        return null;
    }

    function getIntermediateDot(lastDot, nextDot) {
        const rowDiff = nextDot.row - lastDot.row;
        const colDiff = nextDot.col - lastDot.col;

        if (Math.abs(rowDiff) === 2 && colDiff === 0) {
            return dots.find(dot => dot.row === lastDot.row + rowDiff / 2 && dot.col === lastDot.col);
        }
        if (rowDiff === 0 && Math.abs(colDiff) === 2) {
            return dots.find(dot => dot.row === lastDot.row && dot.col === lastDot.col + colDiff / 2);
        }
        if (Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 2) {
            return dots.find(dot => dot.row === lastDot.row + rowDiff / 2 && dot.col === lastDot.col + colDiff / 2);
        }

        return null;
    }

    function addDot(dot) {
        if (!dot || selected.has(dot.id)) return;

        const lastId = sequence[sequence.length - 1];
        if (lastId) {
            const lastDot = getDotById(lastId);
            const intermediateDot = getIntermediateDot(lastDot, dot);
            if (intermediateDot && !selected.has(intermediateDot.id)) {
                selected.add(intermediateDot.id);
                sequence.push(intermediateDot.id);
            }
        }

        selected.add(dot.id);
        sequence.push(dot.id);
        updateSequenceDisplay();
    }

    function processPointer(e, start = false) {
        const pos = getPointerPos(e);
        currentPointer = pos;
        const hit = checkCollision(pos);

        if (hit) {
            addDot(hit);
        }

        if (start && !hit) currentPointer = pos;
        drawGrid();
    }

    function handleStart(e) {
        e.preventDefault();
        isDrawing = true;
        if (e.pointerId !== undefined && canvas.setPointerCapture) {
            canvas.setPointerCapture(e.pointerId);
        }
        processPointer(e, true);
    }

    function handleMove(e) {
        if (!isDrawing) return;
        e.preventDefault();
        processPointer(e);
    }

    function handleEnd(e) {
        isDrawing = false;
        currentPointer = null;
        if (e?.pointerId !== undefined && canvas.releasePointerCapture) {
            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch (err) {
                // El navegador puede liberar la captura automáticamente.
            }
        }
        drawGrid();
    }

    if (window.PointerEvent) {
        canvas.addEventListener('pointerdown', handleStart);
        canvas.addEventListener('pointermove', handleMove);
        canvas.addEventListener('pointerup', handleEnd);
        canvas.addEventListener('pointercancel', handleEnd);
    } else {
        canvas.addEventListener('mousedown', handleStart);
        canvas.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);

        canvas.addEventListener('touchstart', handleStart, { passive: false });
        canvas.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('touchend', handleEnd);
        window.addEventListener('touchcancel', handleEnd);
    }

    function setPatternSequence(value) {
        sequence.length = 0;
        selected.clear();

        String(value || '')
            .split('-')
            .map(num => parseInt(num, 10))
            .filter(num => num >= 1 && num <= 9)
            .forEach(num => {
                if (!selected.has(num)) {
                    selected.add(num);
                    sequence.push(num);
                }
            });

        updateSequenceDisplay();
        drawGrid();
    }

    window.setPatternSequence = setPatternSequence;

    window.clearPattern = function() {
        sequence.length = 0;
        selected.clear();
        currentPointer = null;
        updateSequenceDisplay();
        drawGrid();
    };

    document.getElementById('btn-clear-pattern').addEventListener('click', window.clearPattern);
    document.getElementById('equipment-has-lock')?.addEventListener('change', () => {
        if (!document.getElementById('equipment-has-lock').checked) {
            window.clearPattern();
            document.getElementById('form-lock-pin').value = '';
            document.getElementById('form-lock-pass').value = '';
        }
        updateLockVisibility();
    });

    document.querySelectorAll('input[name="lock_type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateLockVisibility();
            if (document.querySelector('input[name="lock_type"]:checked')?.value === 'Patrón') drawGrid();
        });
    });

    drawGrid();
    updateLockVisibility();
}
// Canvas para la Firma Digital
function initSignaturePad() {
    const canvas = document.getElementById('signature-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    function startDrawing(e) {
        e.preventDefault();
        isDrawing = true;
        const pos = getMousePos(e);
        lastX = pos.x;
        lastY = pos.y;
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();
        const pos = getMousePos(e);
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        
        lastX = pos.x;
        lastY = pos.y;
    }

    function stopDrawing() {
        isDrawing = false;
    }

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDrawing);

    canvas.addEventListener('touchstart', startDrawing);
    canvas.addEventListener('touchmove', draw);
    window.addEventListener('touchend', stopDrawing);

    window.clearSignature = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    document.getElementById('btn-clear-signature').addEventListener('click', window.clearSignature);
}

// Lógica de envío del registro de Ordenes
function initOrderRegistration() {
    const orderForm = document.getElementById('order-form');
    
    // Manejo de condicionales de estados (Motivo obligatorio de Cancelado o Retrasado)
    const statusSelect = document.getElementById('form-order-status');
    const reasonGroup = document.getElementById('status-reason-group');
    const reasonLabel = document.getElementById('status-reason-label');
    const reasonInput = document.getElementById('form-status-reason');
    const evidenceVisibleInput = document.getElementById('evidence-visible-client');

    if (evidenceVisibleInput) {
        evidenceVisibleInput.addEventListener('change', () => {
            evidenceVisibleInput.dataset.touched = 'true';
        });
    }

    document.getElementById('form-costo-estimado')?.addEventListener('input', updateOrderCostState);
    document.getElementById('form-anticipo')?.addEventListener('input', updateOrderCostState);
    document.getElementById('form-warranty-enabled')?.addEventListener('change', updateOrderWarrantyUI);
    document.getElementById('form-warranty-days')?.addEventListener('input', updateOrderWarrantyDates);
    document.getElementById('form-warranty-start')?.addEventListener('change', updateOrderWarrantyDates);
    document.getElementById('form-servicio-solicitado')?.addEventListener('input', () => {
        if (document.getElementById('form-warranty-enabled')?.checked && !getInputValue('form-warranty-service')) {
            setInputValue('form-warranty-service', getInputValue('form-servicio-solicitado'));
        }
    });
    document.querySelectorAll('input[name="order_type"]').forEach(radio => {
        radio.addEventListener('change', updateOrderCostState);
    });
    document.getElementById('chk-acc-otro')?.addEventListener('change', updateOrderConditionalFields);
    document.getElementById('chk-vis-otro')?.addEventListener('change', updateOrderConditionalFields);

    statusSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'Retrasado') {
            reasonGroup.classList.remove('hidden');
            reasonLabel.innerText = 'Motivo del Retraso *';
            reasonInput.required = true;
        } else if (val === 'Cancelado') {
            reasonGroup.classList.remove('hidden');
            reasonLabel.innerText = 'Motivo de la Cancelación *';
            reasonInput.required = true;
        } else {
            reasonGroup.classList.add('hidden');
            reasonInput.required = false;
        }
        updateEvidenceStateUI();
    });

    orderForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (getOrderWizardStep() !== 5) {
            goToOrderWizardStep(getOrderWizardStep() + 1);
            return;
        }

        const orderId = document.getElementById('form-order-id').value;
        const isEditing = orderId !== '';

        if (!validateOrderWizardAll()) return;
        if (!validateOrderMinimums()) return;
        if (!validateOrderLock()) return;
        syncClientLastNameFields();

        // Obtener la firma digital en Base64
        const sigCanvas = document.getElementById('signature-canvas');
        const signatureDataUrl = sigCanvas.toDataURL(); // Imagen PNG en Base64
        const orderPhotos = await collectOrderPhotos();
        updateOrderCostState();
        const orderParts = collectOrderParts();
        const warrantyData = collectOrderWarrantyData();
        const selectedStatus = isEditing ? document.getElementById('form-order-status').value : 'Recibido';
        if (warrantyData.tiene_garantia && selectedStatus !== 'Entregado') {
            alert('La garantía solo puede activarse cuando la orden esté marcada como Entregado.');
            return;
        }
        if (warrantyData.tiene_garantia && (!warrantyData.duracion_dias || !warrantyData.servicio_cubierto)) {
            alert('Indica la duración y el servicio cubierto por la garantía.');
            return;
        }

        const orderData = {
            // Cliente
            clientName: getInputValue('form-client-name'),
            clientFullName: buildClientFullName(),
            clientLastNamePaternal: getInputValue('form-client-lastname-paternal') || null,
            clientLastNameMaternal: getInputValue('form-client-lastname-maternal') || null,
            clientId: document.getElementById('order-form')?.dataset.selectedClientId || null,
            clientPhone: getInputValue('form-client-phone'),
            clientPhoneAlt1: getInputValue('form-client-phone-alt1') || null,
            clientPhoneAlt2: null,
            clientPhoneAlt3: null,
            clientEmail: getInputValue('form-client-email') || null,
            clientAddress: getInputValue('form-client-address') || null,
            clientPreferredContact: getRadioValue('client_contact_method', 'WhatsApp'),
            clientRemarks: null,
            
            // Equipo
            deviceType: document.getElementById('form-device-type').value,
            color: document.getElementById('form-device-color').value || null,
            brand: document.getElementById('form-device-brand').value,
            model: document.getElementById('form-device-model').value,
            deviceDescription: getInputValue('form-device-description') || null,
            imei: document.getElementById('form-device-imei1').value || null,
            imei2: document.getElementById('form-device-imei2').value || null,
            serial: document.getElementById('form-device-serial').value || null,
            
            // Desbloqueos
            sec_android: document.getElementById('form-sec-android').value || null,
            sec_patch: document.getElementById('form-sec-patch').value || null,
            sec_imei_orig: document.getElementById('form-sec-imei-orig').value || null,
            sec_imei_mod: document.getElementById('form-sec-imei-mod').value || null,

            // Bloqueo
            lock_type: document.getElementById('equipment-has-lock')?.checked
                ? document.querySelector('input[name="lock_type"]:checked').value
                : 'Ninguno',
            lock_pin: document.getElementById('form-lock-pin').value || null,
            lock_pass: document.getElementById('form-lock-pass').value || null,
            lock_pattern: document.getElementById('form-lock-pattern-sequence').value || getInputValue('form-lock-pattern-description') || null,

            // Inspección visual / Fallas
            vis_pantalla_rota: getCheckboxValue('chk-vis-pantalla-rota'),
            vis_pantalla_rayada: getCheckboxValue('chk-vis-pantalla-rayada'),
            vis_tapa_rota: getCheckboxValue('chk-vis-tapa-rota'),
            vis_tapa_rayada: getCheckboxValue('chk-vis-tapa-rayada'),
            vis_lente_camara: getCheckboxValue('chk-vis-lente-camara'),
            vis_humedad: getCheckboxValue('chk-vis-humedad'),
            vis_no_enciende: getCheckboxValue('chk-vis-no-enciende'),
            vis_doblado: getCheckboxValue('chk-vis-doblado'),
            vis_tornillos: getCheckboxValue('chk-vis-tornillos'),
            vis_botones: getCheckboxValue('chk-vis-botones'),
            vis_tapa: getCheckboxValue('chk-vis-tapa-rota'),
            vis_camara: getCheckboxValue('chk-vis-camara'),
            vis_marco: getCheckboxValue('chk-vis-marco'),
            vis_puerto: getCheckboxValue('chk-vis-puerto'),
            vis_otro: getCheckboxValue('chk-vis-otro'),
            
            // Accesorios
            acc_funda: getCheckboxValue('chk-acc-funda'),
            acc_sim: getCheckboxValue('chk-acc-sim'),
            acc_memoria: getCheckboxValue('chk-acc-memoria'),
            acc_cargador: getCheckboxValue('chk-acc-cargador'),
            acc_cable: getCheckboxValue('chk-acc-cable'),
            acc_caja: getCheckboxValue('chk-acc-caja'),
            acc_templado: getCheckboxValue('chk-acc-templado'),
            acc_otro: getCheckboxValue('chk-acc-otro'),
            acc_otro_text: getInputValue('form-acc-otro-text') || null,

            falla_reportada: document.getElementById('form-falla-reportada').value,
            servicio_solicitado: getInputValue('form-servicio-solicitado') || null,
            inspeccion_obs: document.getElementById('form-inspeccion-obs').value || null,
            descripcion_falla: document.getElementById('form-descripcion-falla').value || null,

            // Económicos
            costo_estimado: parseFloat(document.getElementById('form-costo-estimado').value) || 0,
            anticipo: parseFloat(document.getElementById('form-anticipo').value) || 0,
            metodo_pago_anticipo: document.getElementById('form-anticipo-metodo')?.value || 'Efectivo',
            costo_real: parseFloat(document.getElementById('form-costo-real').value) || null,
            costo_refaccion: parseFloat(document.getElementById('form-costo-refaccion').value) || 0,
            mano_obra: parseFloat(document.getElementById('form-mano-obra').value) || 0,
            refacciones: orderParts,
            tipo_orden: document.querySelector('input[name="order_type"]:checked')?.value || 'Reparación directa',
            pendiente_presupuesto: isDiagnosisOrderSelected(),
            
            // Estado
            status: selectedStatus,
            status_reason: reasonInput.value || null,
            publicRemarks: document.getElementById('form-order-comentario').value || 'Avance registrado en recepción.',
            estimatedDate: document.getElementById('form-fecha-entrega').value || null,
            
            firma_imagen: signatureDataUrl,
            evidenciasNuevas: orderPhotos,
            evidenciaEstado: isEditing ? document.getElementById('form-order-status').value : 'Recibido',
            evidenciaComentario: getInputValue('evidence-comment') || null,
            evidenciaVisibleCliente: document.getElementById('evidence-visible-client')?.checked ?? true,
            garantia: warrantyData
        };

        try {
            let url = `${BASE_API_URL}/ordenes`;
            let method = 'POST';

            if (isEditing) {
                url = `${BASE_API_URL}/ordenes/${orderId}`;
                method = 'PUT';
            }

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            });

            if (response.ok) {
                const finalOrder = await response.json();
                alert(isEditing ? 'Orden actualizada correctamente.' : 'Orden creada con éxito.');
                orderModal.classList.add('hidden');
                loadAllData();

                if (!isEditing) {
                    // Previsualizar Ticket inmediatamente al crear una nueva orden
                    viewOrderDetails(finalOrder.id);
                }
            } else {
                const err = await response.json();
                alert('Error al registrar orden: ' + err.error);
            }
        } catch (err) {
            console.error('Error de red:', err);
        }
    });

    // Cambiar ganancia automáticamente al ingresar costos reales y refacciones (Admin Only)
    const costoRealInput = document.getElementById('form-costo-real');
    const costoRefaccionInput = document.getElementById('form-costo-refaccion');
    const gananciaLabel = document.getElementById('form-ganancia-label');

    function calculateProfit() {
        const cReal = parseFloat(costoRealInput.value) || 0;
        const cRef = parseFloat(costoRefaccionInput.value) || 0;
        const profit = cReal - cRef;
        gananciaLabel.value = profit.toFixed(2);
    }

    costoRealInput.addEventListener('input', calculateProfit);
    costoRefaccionInput.addEventListener('input', calculateProfit);
}

// Edición de detalles
async function editOrderDetails(id) {
    const response = await fetch(`${BASE_API_URL}/ordenes/${id}`);
    if (!response.ok) {
        alert('No se pudo cargar la orden.');
        return;
    }

    const o = await response.json();

    openOrderModal();
    document.getElementById('order-modal-title').innerText = `Editar Orden - ${o.folio}`;
    document.getElementById('form-order-id').value = o.id;

    // Rellenar datos
    const splitName = splitFullClientName(o.clientName || '');
    document.getElementById('form-client-name').value = splitName.nombres;
    setClientLastNames(
        o.clientLastNamePaternal || splitName.apellidoPaterno || '',
        o.clientLastNameMaternal || splitName.apellidoMaterno || ''
    );
    document.getElementById('form-client-phone').value = o.clientPhone || '';
    setRadioValue('client_contact_method', o.clientPreferredContact || 'WhatsApp');
    document.getElementById('order-form').dataset.selectedClientId = o.clientId || '';
    
    // Cargar datos del cliente si existen en el estado
    const c = o.clientPhone ? APP_STATE.clientes.find(cli => cli.telefono === o.clientPhone || cli.telefono_principal === o.clientPhone) : null;
    if (c) {
        populateClientInputs(c);
    }

    document.getElementById('form-device-type').value = o.deviceType;
    document.getElementById('form-device-color').value = o.color || '';
    document.getElementById('form-device-brand').value = o.brand;
    document.getElementById('form-device-model').value = o.model;
    setInputValue('form-device-description', o.deviceDescription || '');
    document.getElementById('form-device-imei1').value = o.imei || '';
    document.getElementById('form-device-imei2').value = o.imei2 || '';
    document.getElementById('form-device-serial').value = o.serial || '';
    
    document.getElementById('form-sec-android').value = o.sec_android || '';
    document.getElementById('form-sec-patch').value = o.sec_patch || '';
    document.getElementById('form-sec-imei-orig').value = o.sec_imei_orig || '';
    document.getElementById('form-sec-imei-mod').value = o.sec_imei_mod || '';

    // Bloqueo
    const hasLockInput = document.getElementById('equipment-has-lock');
    if (hasLockInput) {
        hasLockInput.checked = !!(o.lock_type && o.lock_type !== 'Ninguno');
    }
    const lockRadio = document.querySelector(`input[name="lock_type"][value="${o.lock_type || 'Ninguno'}"]`);
    if (lockRadio) {
        lockRadio.click();
    }
    updateLockVisibility();
    document.getElementById('form-lock-pin').value = o.lock_pin || '';
    document.getElementById('form-lock-pass').value = o.lock_pass || '';
    
    if (o.lock_type === 'Patrón' && o.lock_pattern) {
        const isPatternSequence = /^\d(?:-\d)*$/.test(String(o.lock_pattern));
        document.getElementById('form-lock-pattern-sequence').value = o.lock_pattern;
        document.getElementById('pattern-sequence-display').innerText = isPatternSequence ? o.lock_pattern : 'Descrito';
        setInputValue('form-lock-pattern-description', isPatternSequence ? '' : o.lock_pattern);
        if (isPatternSequence && typeof window.setPatternSequence === 'function') {
            window.setPatternSequence(o.lock_pattern);
        }
    }

    // Checkboxes de inspección
    setCheckboxValue('chk-vis-pantalla-rota', o.vis_pantalla_rota);
    setCheckboxValue('chk-vis-pantalla-rayada', o.vis_pantalla_rayada || o.vis_pantalla_manchada);
    setCheckboxValue('chk-vis-tapa-rota', o.vis_tapa_rota || o.vis_tapa);
    setCheckboxValue('chk-vis-tapa-rayada', o.vis_tapa_rayada);
    setCheckboxValue('chk-vis-marco', o.vis_marco);
    setCheckboxValue('chk-vis-camara', o.vis_camara);
    setCheckboxValue('chk-vis-lente-camara', o.vis_lente_camara);
    setCheckboxValue('chk-vis-puerto', o.vis_puerto);
    setCheckboxValue('chk-vis-botones', o.vis_botones);
    setCheckboxValue('chk-vis-humedad', o.vis_humedad || o.vis_otro);
    setCheckboxValue('chk-vis-no-enciende', o.vis_no_enciende);
    setCheckboxValue('chk-vis-doblado', o.vis_doblado);
    setCheckboxValue('chk-vis-tornillos', o.vis_tornillos);
    setCheckboxValue('chk-vis-otro', o.vis_otro);

    // Checkboxes de accesorios
    setCheckboxValue('chk-acc-funda', o.acc_funda);
    setCheckboxValue('chk-acc-sim', o.acc_sim);
    setCheckboxValue('chk-acc-memoria', o.acc_memoria);
    setCheckboxValue('chk-acc-cargador', o.acc_cargador);
    setCheckboxValue('chk-acc-cable', o.acc_cable);
    setCheckboxValue('chk-acc-caja', o.acc_caja);
    setCheckboxValue('chk-acc-templado', o.acc_templado);
    setCheckboxValue('chk-acc-otro', o.acc_otro);
    setInputValue('form-acc-otro-text', o.acc_otro_text || '');

    document.getElementById('form-falla-reportada').value = o.falla_reportada || '';
    setInputValue('form-servicio-solicitado', o.servicio_solicitado || '');
    document.getElementById('form-inspeccion-obs').value = o.inspeccion_obs || '';
    updateOrderConditionalFields();
    document.getElementById('form-descripcion-falla').value = o.descripcion_falla || '';

    // Económicos
    document.getElementById('form-costo-estimado').value = o.costo_estimado || 0;
    document.getElementById('form-anticipo').value = o.anticipo || 0;
    const anticipoMetodoInput = document.getElementById('form-anticipo-metodo');
    if (anticipoMetodoInput) anticipoMetodoInput.value = 'Efectivo';
    document.getElementById('form-costo-real').value = o.costo_real || '';
    document.getElementById('form-costo-refaccion').value = o.costo_refaccion || 0;
    setInputValue('form-mano-obra', o.mano_obra ?? Math.max((o.costo_real || o.costo_estimado || 0) - (o.costo_refaccion || 0), 0));
    setOrderParts(o.refacciones || o.refacciones_utilizadas || []);
    
    const profit = (o.costo_real || 0) - (o.costo_refaccion || 0);
    document.getElementById('form-ganancia-label').value = profit.toFixed(2);
    const orderTypeInput = document.querySelector(`input[name="order_type"][value="${o.tipo_orden || 'Reparación directa'}"]`);
    if (orderTypeInput) orderTypeInput.checked = true;
    updateOrderCostState();
    populateOrderWarrantyFields(o.garantia || null);
    document.querySelectorAll('textarea.auto-grow-textarea').forEach(textarea => textarea.dispatchEvent(new Event('input')));

    // Estado
    document.getElementById('form-order-status').value = o.status;
    document.getElementById('form-order-status').dispatchEvent(new Event('change'));
    if (o.status === 'Retrasado' || o.status === 'Cancelado') {
        document.getElementById('form-status-reason').value = o.status_reason || '';
    }
    
    document.getElementById('form-fecha-entrega').value = o.estimatedDate || '';

    const orderForm = document.getElementById('order-form');
    orderForm.dataset.currentPhotos = JSON.stringify([]);
    const evidenceComment = document.getElementById('evidence-comment');
    if (evidenceComment) evidenceComment.value = '';
    const evidenceVisible = document.getElementById('evidence-visible-client');
    if (evidenceVisible) {
        evidenceVisible.dataset.touched = '';
        evidenceVisible.checked = evidenceDefaultVisible(o.status || 'Recibido');
    }
    const photoInput = document.getElementById('photo-input-evidencias');
    if (photoInput) photoInput.value = '';
    renderOrderPhotoPreviews([]);
    renderEvidenceHistory(o);
    updateEvidenceStateUI();

    // Firma
    if (o.firma_imagen) {
        const sigCanvas = document.getElementById('signature-canvas');
        const ctx = sigCanvas.getContext('2d');
        const img = new Image();
        img.onload = function() {
            ctx.drawImage(img, 0, 0);
        };
        img.src = o.firma_imagen;
    }
}

// ==========================================
// DETALLE DE TICKET (PDF Y TERMICA)
// ==========================================
const receiptModal = document.getElementById('receipt-modal');
const receiptPrint80Button = document.getElementById('btn-print-action');
const saleSuccessModal = document.getElementById('sale-success-modal');
const saleSuccessPrintButton = document.getElementById('btn-sale-success-print');
const saleSuccessPreviewButton = document.getElementById('btn-sale-success-preview');
const saleSuccessCloseButton = document.getElementById('btn-sale-success-close');
let AVAILABLE_TICKET_PRINTERS = [];
const THERMAL_PRINT_DOTS = {
    '80mm': 576,
    '58mm': 360
};
const THERMAL_PRINT_DPI = 203;
const THERMAL_CAPTURE_SCALE = 5;
document.getElementById('btn-close-receipt-modal').addEventListener('click', () => receiptModal.classList.add('hidden'));
document.getElementById('btn-close-receipt').addEventListener('click', () => receiptModal.classList.add('hidden'));
saleSuccessCloseButton?.addEventListener('click', () => saleSuccessModal?.classList.add('hidden'));
saleSuccessPreviewButton?.addEventListener('click', () => {
    saleSuccessModal?.classList.add('hidden');
    receiptModal.classList.add('sale-ticket-only');
    setReceiptPrintLabels('Ticket de Venta');
    document.getElementById('btn-show-ticket-venta')?.click();
    receiptModal.classList.remove('hidden');
});
saleSuccessPrintButton?.addEventListener('click', async () => {
    const printed = await printReceipt(null, { silent: false });
    if (printed && APP_STATE.selectedSaleForReceipt) {
        showSaleSuccessModal(APP_STATE.selectedSaleForReceipt, { printed: true });
    }
});

function setReceiptPrintLabels(label = 'Ticket Térmico') {
    if (receiptPrint80Button) {
        receiptPrint80Button.innerHTML = `<i class="fa-solid fa-print"></i> Imprimir ${label}`;
    }
}

function setReceiptPrintSize(paper) {
    const detectedPaper = normalizeTicketPaper(paper);
    clearReceiptPrintSize();
    const widthMm = detectedPaper === '58mm' ? 58 : 80;
    const className = detectedPaper === '58mm' ? 'receipt-print-58mm' : 'receipt-print-80mm';
    document.documentElement.classList.add(className);
    document.body.classList.add(className);

    const pageSizeStyle = document.createElement('style');
    pageSizeStyle.id = 'receipt-print-page-size';
    pageSizeStyle.textContent = `
@media print {
  @page { size: ${widthMm}mm auto; margin: 0; }
  html, body { width: ${widthMm}mm !important; min-width: ${widthMm}mm !important; }
  #receipt-modal, #receipt-modal .modal-container { width: ${widthMm}mm !important; max-width: ${widthMm}mm !important; }
}
`;
    document.head.appendChild(pageSizeStyle);
}

function clearReceiptPrintSize() {
    document.documentElement.classList.remove('receipt-print-58mm', 'receipt-print-80mm');
    document.body.classList.remove('receipt-print-58mm', 'receipt-print-80mm');
    const pageSizeStyle = document.getElementById('receipt-print-page-size');
    if (pageSizeStyle) {
        pageSizeStyle.remove();
    }
}

function normalizeTicketPaper(paper) {
    if (paper === '58mm' || paper === '80mm') return paper;
    if (paper === undefined || paper === null || paper === '') return '80mm';
    const widthMm = Number(paper);
    if (Number.isFinite(widthMm)) return widthMm <= 65 ? '58mm' : '80mm';
    return '80mm';
}

function getSelectedPrinterMeta(printerName = ESTABLISHMENT_CONFIG.ticketPrinter || '') {
    return AVAILABLE_TICKET_PRINTERS.find(printer => printer.name === printerName)
        || AVAILABLE_TICKET_PRINTERS.find(printer => printer.isDefault)
        || null;
}

function detectConfiguredTicketPaper() {
    const printer = getSelectedPrinterMeta();
    return normalizeTicketPaper(printer?.ticketPaper || printer?.paperMm || ESTABLISHMENT_CONFIG.ticketPaper);
}

function getThermalPrintWidthPx(paper) {
    return THERMAL_PRINT_DOTS[normalizeTicketPaper(paper)] || THERMAL_PRINT_DOTS['80mm'];
}

function getReceiptTextWidth(size) {
    return normalizeTicketPaper(size) === '58mm' ? 32 : 42;
}

function receiptText(id) {
    return String(document.getElementById(id)?.textContent || '').trim();
}

function buildOrderLockLabel(order = {}) {
    const lockType = String(order.lock_type || 'Ninguno').trim();
    const normalizedLockType = normalizeText(lockType).trim();
    if (!lockType || normalizedLockType === 'ninguno') return '';
    if (normalizedLockType === 'pin') return hasReceiptValue(order.lock_pin) ? `PIN: ${order.lock_pin}` : '';
    if (normalizedLockType === 'contrasena') return hasReceiptValue(order.lock_pass) ? `Contrasena: ${order.lock_pass}` : '';
    if (normalizedLockType === 'patron') return hasReceiptValue(order.lock_pattern) ? `Patron: ${order.lock_pattern}` : '';

    const lockValue = order.lock_pin || order.lock_pass || order.lock_pattern;
    return hasReceiptValue(lockValue) ? `${lockType}: ${lockValue}` : '';
}

const EMPTY_RECEIPT_VALUES = new Set([
    'n/a',
    'na',
    'no proporcionado',
    'ninguno',
    'ninguna',
    'sin color',
    'sin detalle',
    'sin detalles',
    'sin detalles.',
    'sin detalle reportado',
    'sin detalle reportado.',
    'sin observaciones',
    'sin observaciones.',
    'sin observaciones visuales',
    'sin observaciones visuales.'
]);

function normalizeReceiptValue(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hasReceiptValue(value, options = {}) {
    const text = normalizeReceiptValue(value);
    if (!text) return false;
    if (EMPTY_RECEIPT_VALUES.has(text.toLowerCase())) return false;
    if (options.zeroIsEmpty && /^[$\s]*0(?:[.,]0{1,2})?$/.test(text)) return false;
    return true;
}

function setReceiptFieldText(id, value, options = {}) {
    const element = document.getElementById(id);
    if (!element) return '';

    const text = hasReceiptValue(value, options) ? normalizeReceiptValue(value) : '';
    element.innerText = text;

    const row = element.closest('p');
    if (row) {
        row.classList.toggle('receipt-field-empty', !text);
    }

    return text;
}

function refreshReceiptOptionalFields(container = document) {
    container.querySelectorAll('.ticket-service-receipt .ticket-section-data p').forEach(row => {
        const valueElement = row.querySelector('span[id^="ticket-val-"]');
        if (!valueElement) return;

        const zeroIsEmpty = Boolean(valueElement.closest('.ticket-outstanding'))
            || valueElement.id === 'ticket-val-advance';
        const hasValue = hasReceiptValue(valueElement.textContent, { zeroIsEmpty });
        row.classList.toggle('receipt-field-empty', !hasValue);
    });
}

function refreshReceiptOptionalSections(container = document) {
    refreshReceiptOptionalFields(container);

    container.querySelectorAll('.ticket-section-data').forEach(section => {
        const rows = Array.from(section.children).filter(child => child.matches?.('p'));
        if (!rows.length) return;

        const hasVisibleRow = rows.some(row => !row.classList.contains('receipt-field-empty'));
        section.classList.toggle('receipt-section-empty', !hasVisibleRow);
    });
}

function renderFolioBarcodes(folio) {
    const value = String(folio || '').trim();
    if (!value || typeof JsBarcode !== 'function') return;

    [
        { selector: '#ticket-folio-barcode', height: 58, width: 1.55, fontSize: 16 },
        { selector: '#thermal-folio-barcode', height: 34, width: 1.08, fontSize: 10 }
    ].forEach(config => {
        const element = document.querySelector(config.selector);
        if (!element) return;

        try {
            JsBarcode(element, value, {
                format: 'CODE128',
                width: config.width,
                height: config.height,
                displayValue: true,
                fontSize: config.fontSize,
                fontOptions: 'bold',
                margin: 0,
                lineColor: '#000000',
                background: '#ffffff'
            });
        } catch (err) {
            console.warn('No se pudo generar el código de barras del folio:', err);
            element.replaceChildren();
        }
    });
}

function receiptRepeat(char, width) {
    return String(char).repeat(width);
}

function receiptLine(width) {
    return receiptRepeat('_', width);
}

function receiptCenter(value, width) {
    const text = String(value || '').trim();
    if (text.length >= width) return text.slice(0, width);
    const left = Math.floor((width - text.length) / 2);
    return `${' '.repeat(left)}${text}`;
}

function receiptWrap(value, width) {
    const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let current = '';

    words.forEach(word => {
        if (word.length > width) {
            if (current) {
                lines.push(current);
                current = '';
            }
            for (let i = 0; i < word.length; i += width) {
                lines.push(word.slice(i, i + width));
            }
            return;
        }

        const next = current ? `${current} ${word}` : word;
        if (next.length > width) {
            lines.push(current);
            current = word;
        } else {
            current = next;
        }
    });

    if (current) lines.push(current);
    return lines.length ? lines : [''];
}

function receiptField(lines, label, value, width) {
    const prefix = `${label}: `;
    const wrapped = receiptWrap(value || '-', Math.max(8, width - prefix.length));
    lines.push(`${prefix}${wrapped[0]}`.slice(0, width));
    wrapped.slice(1).forEach(line => lines.push(`${' '.repeat(prefix.length)}${line}`.slice(0, width)));
}

function receiptOptionalField(lines, label, value, width, options = {}) {
    if (!hasReceiptValue(value, options)) return false;
    receiptField(lines, label, value, width);
    return true;
}

function receiptOptionalSection(lines, title, fields, width) {
    const sectionLines = [];
    fields.forEach(field => receiptOptionalField(sectionLines, field.label, field.value, width, field.options));
    if (!sectionLines.length) return false;

    lines.push(receiptLine(width));
    lines.push(receiptCenter(title, width));
    lines.push(...sectionLines);
    return true;
}

function receiptMoney(value) {
    const numeric = Number(String(value || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? `$${numeric.toFixed(2)}` : String(value || '$0.00');
}

function receiptColumns(values, widths, aligns = []) {
    return values.map((value, index) => {
        const text = String(value || '');
        const width = widths[index];
        const truncated = text.length > width ? text.slice(0, width) : text;
        if (aligns[index] === 'right') return truncated.padStart(width, ' ');
        if (aligns[index] === 'center') return truncated.padStart(Math.floor((width + truncated.length) / 2), ' ').padEnd(width, ' ');
        return truncated.padEnd(width, ' ');
    }).join(' ');
}

function receiptHeader(lines, width, title, subtitle = '') {
    lines.push(receiptCenter(ESTABLISHMENT_CONFIG.name.toUpperCase(), width));
    if (subtitle) lines.push(receiptCenter(subtitle, width));
    receiptWrap(`${ESTABLISHMENT_CONFIG.address} Tel: ${ESTABLISHMENT_CONFIG.phone}`, width)
        .forEach(line => lines.push(receiptCenter(line, width)));
    const contactLine = getTicketContactLine();
    if (contactLine) {
        receiptWrap(contactLine, width).forEach(line => lines.push(receiptCenter(line, width)));
    }
    lines.push(receiptLine(width));
    lines.push(receiptCenter(title, width));
    lines.push(receiptLine(width));
}

function getSaleReceiptKind(sale) {
    const items = sale?.items || [];
    const hasRepair = items.some(item => item.tipo_item === 'reparacion' || item.tipo === 'reparacion' || item.type === 'repair');
    const hasProducts = items.some(item => !(item.tipo_item === 'reparacion' || item.tipo === 'reparacion' || item.type === 'repair'));
    if (hasRepair && hasProducts) {
        return {
            key: 'mixed',
            title: 'SERVICIO + ACCESORIOS',
            label: 'Servicio + accesorios',
            itemsTitle: 'Detalle combinado',
            note: 'Servicio cobrado y accesorios entregados'
        };
    }
    if (hasRepair) {
        return {
            key: 'service',
            title: 'COBRO DE SERVICIO',
            label: 'Cobro de servicio',
            itemsTitle: 'Servicio cobrado',
            note: 'Pago registrado a una orden de servicio'
        };
    }
    return {
        key: 'sale',
        title: 'TICKET DE VENTA',
        label: 'Ticket de venta',
        itemsTitle: 'Productos y accesorios',
        note: 'Gracias por su preferencia'
    };
}

function buildSaleReceiptText(size) {
    const width = getReceiptTextWidth(size);
    const is58 = size === '58mm';
    const qtyWidth = 4;
    const priceWidth = is58 ? 6 : 8;
    const totalWidth = is58 ? 7 : 8;
    const conceptWidth = width - qtyWidth - priceWidth - totalWidth - 3;
    const lines = [];
    const saleKind = {
        title: receiptText('ticket-venta-type-label').toUpperCase() || 'TICKET DE VENTA',
        note: receiptText('ticket-venta-service-note') || 'Gracias por su preferencia'
    };

    receiptHeader(lines, width, saleKind.title);
    receiptField(lines, 'Venta', receiptText('ticket-venta-id'), width);
    receiptField(lines, 'Fecha', receiptText('ticket-venta-date').replace(/^Fecha:\s*/i, ''), width);
    receiptField(lines, 'Pago', receiptText('ticket-venta-paymethod'), width);
    lines.push(receiptLine(width));

    const ticketRows = Array.from(document.querySelectorAll('#ticket-venta-items-table tbody tr'));
    const hasProductRows = ticketRows.some(row => !row.classList.contains('ticket-sale-group-row') && !row.classList.contains('ticket-repair-detail-row'));
    if (hasProductRows) {
        lines.push(receiptColumns(['Cant', 'Concepto', 'P.U.', 'Total'], [qtyWidth, conceptWidth, priceWidth, totalWidth], ['center', 'left', 'right', 'right']));
        lines.push(receiptLine(width));
    }

    ticketRows.forEach(row => {
        if (row.classList.contains('ticket-sale-group-row')) {
            const label = row.textContent.trim();
            if (label) {
                lines.push(receiptLine(width));
                lines.push(receiptCenter(label.toUpperCase(), width));
                lines.push(receiptLine(width));
            }
            return;
        }

        if (row.classList.contains('ticket-repair-detail-row')) {
            row.querySelectorAll('.ticket-repair-detail p').forEach(paragraph => {
                receiptWrap(paragraph.textContent.trim(), width).forEach(line => lines.push(line));
            });
            return;
        }

        const cells = Array.from(row.children).map(cell => cell.textContent.trim());
        const conceptLines = receiptWrap(cells[1] || 'Producto', conceptWidth);
        lines.push(receiptColumns([
            cells[0] || '1',
            conceptLines[0],
            receiptMoney(cells[2]),
            receiptMoney(cells[3])
        ], [qtyWidth, conceptWidth, priceWidth, totalWidth], ['center', 'left', 'right', 'right']));
        conceptLines.slice(1).forEach(line => {
            lines.push(receiptColumns(['', line, '', ''], [qtyWidth, conceptWidth, priceWidth, totalWidth]));
        });
    });

    lines.push(receiptLine(width));
    receiptField(lines, 'Subtotal', receiptMoney(receiptText('ticket-venta-subtotal')), width);
    receiptField(lines, 'Descuento', receiptMoney(receiptText('ticket-venta-discount')), width);
    lines.push(receiptColumns(['TOTAL', receiptMoney(receiptText('ticket-venta-total'))], [width - 12, 11], ['left', 'right']));
    receiptField(lines, 'Efectivo', receiptMoney(receiptText('ticket-venta-cash')), width);
    receiptField(lines, 'Transfer.', receiptMoney(receiptText('ticket-venta-transfer')), width);
    const transferReference = receiptText('ticket-venta-reference');
    if (transferReference && transferReference !== '-') {
        receiptField(lines, 'Ref.', transferReference, width);
    }
    receiptField(lines, 'Cambio', receiptMoney(receiptText('ticket-venta-change')), width);
    const observations = receiptText('ticket-venta-observations');
    if (observations && observations !== 'Sin observaciones') {
        lines.push(receiptLine(width));
        lines.push('Observaciones:');
        receiptWrap(observations, width).forEach(line => lines.push(line));
    }
    lines.push(receiptLine(width));
    lines.push(receiptCenter(saleKind.note, width));
    lines.push('');
    lines.push('');
    return lines.join('\n');
}

function buildOrderReceiptText(size) {
    const width = getReceiptTextWidth(size);
    const lines = [];

    receiptHeader(lines, width, 'FOLIO DE SERVICIO', 'Servicio Técnico Profesional');
    lines.push(receiptCenter(receiptText('ticket-val-folio'), width));
    lines.push(receiptCenter(receiptText('ticket-val-date'), width));

    receiptOptionalSection(lines, 'DATOS DEL CLIENTE', [
        { label: 'Nombre', value: receiptText('ticket-val-client-name') },
        { label: 'Teléfono', value: receiptText('ticket-val-client-phone') },
        { label: 'Correo', value: receiptText('ticket-val-client-email') }
    ], width);

    receiptOptionalSection(lines, 'DATOS DEL EQUIPO', [
        { label: 'Equipo', value: receiptText('ticket-val-device') },
        { label: 'Accesorios', value: receiptText('ticket-val-accessories') }
    ], width);

    receiptOptionalSection(lines, 'DETALLE TÉCNICO', [
        { label: 'Falla Reportada', value: receiptText('ticket-val-falla') },
        { label: 'Servicio a realizar', value: receiptText('ticket-val-desc') },
        { label: 'Inspección', value: receiptText('ticket-val-inspection') }
    ], width);

    const moneyLines = [];
    receiptOptionalField(moneyLines, 'Costo Estimado', receiptText('ticket-val-cost-est'), width);
    receiptOptionalField(moneyLines, 'Anticipo Dejado', receiptText('ticket-val-advance'), width, { zeroIsEmpty: true });
    if (hasReceiptValue(receiptText('ticket-val-pending'), { zeroIsEmpty: true })) {
        moneyLines.push(receiptLine(width));
        moneyLines.push(receiptCenter(`PAGAR AL ENTREGAR: ${receiptText('ticket-val-pending')}`, width));
        moneyLines.push(receiptLine(width));
    }
    if (moneyLines.length) {
        lines.push(receiptLine(width));
        lines.push(receiptCenter('INFORMACIÓN ECONÓMICA', width));
        lines.push(...moneyLines);
    }

    lines.push(receiptLine(width));
    receiptWrap(receiptText('ticket-rec-legal-text'), width).forEach(line => lines.push(line));
    lines.push(receiptLine(width));
    lines.push(receiptCenter('Firma de Conformidad del Cliente', width));
    lines.push('________________________________');
    lines.push('');
    lines.push('');
    return lines.join('\n');
}

function buildLabelReceiptText(size) {
    const width = getReceiptTextWidth(size);
    const lines = [];
    lines.push(receiptCenter(receiptText('thermal-business-name'), width));
    lines.push(receiptCenter('||| | |||| | || ||| ||', width));
    lines.push(receiptCenter(receiptText('thermal-val-folio'), width));
    lines.push(receiptLine(width));
    receiptField(lines, 'Cliente', receiptText('thermal-val-client'), width);
    receiptOptionalField(lines, 'Tel', receiptText('thermal-val-phone'), width);
    receiptField(lines, 'Equipo', receiptText('thermal-val-device'), width);
    receiptOptionalField(lines, 'Bloqueo', receiptText('thermal-val-lock'), width);
    receiptField(lines, 'Fecha', receiptText('thermal-val-date'), width);
    lines.push('');
    return lines.join('\n');
}

function buildDirectReceiptText(size) {
    if (!document.getElementById('ticket-venta-container')?.classList.contains('hidden')) {
        return buildSaleReceiptText(size);
    }
    if (!document.getElementById('etiqueta-pequena-container')?.classList.contains('hidden')) {
        return buildLabelReceiptText(size);
    }
    return buildOrderReceiptText(size);
}

function setReceiptPrintBusy(isBusy) {
    [receiptPrint80Button, saleSuccessPrintButton].forEach(button => {
        if (!button) return;
        button.disabled = isBusy;
        button.classList.toggle('disabled', isBusy);
    });
}

async function printReceipt(size, options = {}) {
    const activeReceiptElement = getActiveReceiptElement();
    if (activeReceiptElement) {
        refreshReceiptOptionalSections(activeReceiptElement);
    }
    const detectedPaper = normalizeTicketPaper(
        size || (activeReceiptElement?.id === 'ticket-corte-container' ? '58mm' : detectConfiguredTicketPaper())
    );

    setReceiptPrintBusy(true);

    try {
        const receiptElement = activeReceiptElement;
        if (!receiptElement) {
            throw new Error('No hay un ticket listo para imprimir.');
        }

        if (typeof html2canvas !== 'function') {
            throw new Error('No se pudo cargar el generador de imagen del ticket. Recarga el sistema e intenta de nuevo.');
        }

        await sendReceiptPreviewToPrinter(receiptElement, detectedPaper);
        return true;
    } catch (err) {
        console.error('Error de impresion:', err);
        if (!options.silent) {
            alert(err.message || 'No se pudo enviar el ticket a la impresora.');
        }
        return false;
    } finally {
        setReceiptPrintBusy(false);
    }
}

function getActiveReceiptElement() {
    const candidates = [
        document.getElementById('ticket-venta-container'),
        document.getElementById('ticket-corte-container'),
        document.getElementById('etiqueta-pequena-container'),
        document.getElementById('ticket-recepcion-container')
    ];
    return candidates.find(element => element && !element.classList.contains('hidden')) || null;
}

async function captureReceiptPreviewImage(receiptElement, paper) {
    const detectedPaper = normalizeTicketPaper(paper);
    const widthMm = detectedPaper === '58mm' ? 58 : 80;
    const targetWidthPx = getThermalPrintWidthPx(detectedPaper);
    const captureWidth = detectedPaper === '58mm' ? `${targetWidthPx}px` : `${widthMm}mm`;
    const captureStage = document.createElement('div');
    const captureNode = receiptElement.cloneNode(true);

    captureStage.className = 'receipt-capture-stage';
    captureStage.style.width = captureWidth;
    captureStage.dataset.paper = detectedPaper;
    captureNode.classList.remove('hidden');
    refreshReceiptOptionalSections(captureNode);
    captureStage.appendChild(captureNode);
    document.body.appendChild(captureStage);

    try {
        const sourceCanvas = await html2canvas(captureNode, {
            backgroundColor: '#ffffff',
            scale: Math.max(THERMAL_CAPTURE_SCALE, window.devicePixelRatio || 1),
            useCORS: true,
            allowTaint: true,
            logging: false,
            removeContainer: true
        });
        const outputCanvas = normalizeReceiptCanvasForThermalPrint(sourceCanvas, targetWidthPx);

        return {
            imageData: outputCanvas.toDataURL('image/png'),
            pixelWidth: outputCanvas.width,
            pixelHeight: outputCanvas.height,
            sourcePixelWidth: sourceCanvas.width,
            sourcePixelHeight: sourceCanvas.height,
            renderScale: Math.max(THERMAL_CAPTURE_SCALE, window.devicePixelRatio || 1)
        };
    } finally {
        captureStage.remove();
    }
}

function normalizeReceiptCanvasForThermalPrint(sourceCanvas, targetWidthPx) {
    const outputCanvas = document.createElement('canvas');
    const aspectRatio = sourceCanvas.height / Math.max(1, sourceCanvas.width);
    outputCanvas.width = targetWidthPx;
    outputCanvas.height = Math.max(1, Math.ceil(targetWidthPx * aspectRatio));

    const context = outputCanvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(sourceCanvas, 0, 0, outputCanvas.width, outputCanvas.height);

    return outputCanvas;
}

async function sendReceiptPreviewToPrinter(receiptElement, paper) {
    const detectedPaper = normalizeTicketPaper(paper);
    const capture = await captureReceiptPreviewImage(receiptElement, detectedPaper);
    const response = await fetch(`${BASE_API_URL}/configuracion/imprimir-ticket`, {
        method: 'POST',
        body: JSON.stringify({
            imageData: capture.imageData,
            pixelWidth: capture.pixelWidth,
            pixelHeight: capture.pixelHeight,
            sourcePixelWidth: capture.sourcePixelWidth,
            sourcePixelHeight: capture.sourcePixelHeight,
            renderScale: capture.renderScale,
            dpi: THERMAL_PRINT_DPI,
            printerName: ESTABLISHMENT_CONFIG.ticketPrinter || '',
            paper: detectedPaper,
            detectedPaper,
            copies: 1
        })
    });

    if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'No se pudo enviar el ticket a la impresora.');
    }
}

function showSaleSuccessModal(sale, options = {}) {
    if (!saleSuccessModal) return;
    const normalizedSale = normalizeVenta(sale);
    const saleKind = getSaleReceiptKind(normalizedSale);
    const printed = Boolean(options.printed);
    const directMode = ESTABLISHMENT_CONFIG.autoPrintTicket !== false;

    const title = document.getElementById('sale-success-title');
    const message = document.getElementById('sale-success-message');
    const total = document.getElementById('sale-success-total');
    const method = document.getElementById('sale-success-method');

    if (title) title.textContent = `${saleKind.label} confirmado`;
    if (message) {
        message.textContent = printed
            ? 'El cobro se registró y el ticket se envió a imprimir con el mismo diseño de la previsualización.'
            : directMode
                ? 'El cobro se registró. Revisa la impresora o imprime manualmente el ticket.'
                : 'El cobro se registró. Puedes imprimir el ticket ahora o revisarlo antes.';
    }
    if (total) total.textContent = `$${normalizedSale.total.toFixed(2)}`;
    if (method) method.textContent = normalizedSale.metodo_pago || 'Pago registrado';

    saleSuccessPrintButton?.classList.toggle('btn-secondary', printed);
    saleSuccessPrintButton?.classList.toggle('btn-primary', !printed);
    saleSuccessModal.classList.remove('hidden');
}

async function handleCompletedSale(completedVenta) {
    saleSuccessModal?.classList.add('hidden');
    viewVentaDetails(completedVenta);
}

window.printReceipt = printReceipt;
window.addEventListener('afterprint', clearReceiptPrintSize);

function getConfiguredTicketPaper() {
    return detectConfiguredTicketPaper();
}

async function viewOrderDetails(id) {
    receiptModal.classList.remove('sale-ticket-only');
    setReceiptPrintLabels('Ticket Térmico');

    const response = await fetch(`${BASE_API_URL}/ordenes/${id}`);
    if (!response.ok) {
        alert('No se pudo obtener información de la orden.');
        return;
    }

    const o = await response.json();
    APP_STATE.selectedOrderForReceipt = o;

    // Inyectar Datos del Establecimiento dinámicos
    document.getElementById('ticket-rec-business-name').innerText = ESTABLISHMENT_CONFIG.name.toUpperCase();
    document.getElementById('ticket-rec-business-info').innerText = `${ESTABLISHMENT_CONFIG.address} | Tel: ${ESTABLISHMENT_CONFIG.phone}`;
    applyTicketContactInfo();
    document.getElementById('ticket-rec-legal-text').innerHTML = `<strong>IMPORTANTE:</strong> ${ESTABLISHMENT_CONFIG.terms}`;
    document.getElementById('thermal-business-name').innerText = ESTABLISHMENT_CONFIG.name.toUpperCase();

    // Rellenar previsualización de ticket
    document.getElementById('ticket-val-folio').innerText = o.folio;
    renderFolioBarcodes(o.folio);
    document.getElementById('ticket-val-date').innerText = `Fecha: ${o.dateIn} 09:00`;
    setReceiptFieldText('ticket-val-client-name', o.clientName);
    setReceiptFieldText('ticket-val-client-phone', o.clientPhone);
    setReceiptFieldText('ticket-val-client-email', o.clientEmail);
    
    const deviceLabel = o.deviceDescription || [o.deviceType, o.brand, o.model].filter(Boolean).join(' ');
    const deviceColor = hasReceiptValue(o.color) ? o.color : '';
    const deviceLabelWithColor = deviceColor ? `${deviceLabel} (${deviceColor})` : deviceLabel;
    setReceiptFieldText('ticket-val-device', deviceLabelWithColor);
    
    // Accesorios listados
    const accList = [];
    if (o.acc_funda) accList.push('Funda');
    if (o.acc_sim) accList.push('SIM');
    if (o.acc_memoria) accList.push('Memoria');
    if (o.acc_cargador) accList.push('Cargador');
    if (o.acc_cable) accList.push('Cable USB');
    if (o.acc_caja) accList.push('Caja');
    if (o.acc_templado) accList.push('Templado');
    if (o.acc_otro) accList.push(o.acc_otro_text || 'Otros');
    setReceiptFieldText('ticket-val-accessories', accList.join(', '));

    setReceiptFieldText('ticket-val-falla', o.falla_reportada || o.servicio_solicitado);
    setReceiptFieldText('ticket-val-desc', o.servicio_solicitado || o.descripcion_falla);
    setReceiptFieldText('ticket-val-inspection', o.inspeccion_obs);

    // Dinero
    const costEst = Number(o.costo_estimado || 0);
    const adv = Number(o.anticipo || 0);
    const pending = Math.max(costEst - adv, 0);
    const hasCostEstimate = o.pendiente_presupuesto || costEst > 0;
    const hasAdvance = adv > 0;
    const hasPending = o.pendiente_presupuesto || costEst > 0 || adv > 0;
    setReceiptFieldText('ticket-val-cost-est', o.pendiente_presupuesto ? 'Pendiente de presupuesto' : (hasCostEstimate ? `$${costEst.toFixed(2)}` : ''));
    setReceiptFieldText('ticket-val-advance', hasAdvance ? `$${adv.toFixed(2)}` : '', { zeroIsEmpty: true });
    setReceiptFieldText('ticket-val-pending', o.pendiente_presupuesto ? 'Por definir' : (hasPending ? `$${pending.toFixed(2)}` : ''), { zeroIsEmpty: true });

    // Firma
    const sigImg = document.getElementById('ticket-val-signature-img');
    if (o.firma_imagen) {
        sigImg.src = o.firma_imagen;
        sigImg.classList.remove('hidden');
    } else {
        sigImg.classList.add('hidden');
    }

    // Rellenar etiqueta térmica
    document.getElementById('thermal-val-folio').innerText = o.folio;
    document.getElementById('thermal-val-client').innerText = o.clientName;
    setReceiptFieldText('thermal-val-phone', o.clientPhone);
    document.getElementById('thermal-val-device').innerText = deviceLabel;
    setReceiptFieldText('thermal-val-lock', buildOrderLockLabel(o));
    document.getElementById('thermal-val-date').innerText = o.dateIn;

    refreshReceiptOptionalSections(document.getElementById('ticket-recepcion-container'));

    // Toggle de pestañas en visualización
    document.getElementById('btn-show-ticket-recepcion').click();

    receiptModal.classList.remove('hidden');
}

document.getElementById('btn-show-ticket-recepcion').addEventListener('click', () => {
    document.getElementById('btn-show-ticket-recepcion').className = 'btn btn-sm btn-primary active';
    document.getElementById('btn-show-ticket-venta').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-etiqueta-pequena').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-ticket-corte').className = 'btn btn-sm btn-secondary hidden';
    document.getElementById('ticket-recepcion-container').classList.remove('hidden');
    document.getElementById('ticket-venta-container').classList.add('hidden');
    document.getElementById('etiqueta-pequena-container').classList.add('hidden');
    document.getElementById('ticket-corte-container').classList.add('hidden');
});

document.getElementById('btn-show-ticket-venta').addEventListener('click', () => {
    document.getElementById('btn-show-ticket-recepcion').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-ticket-venta').className = 'btn btn-sm btn-primary active';
    document.getElementById('btn-show-etiqueta-pequena').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-ticket-corte').className = 'btn btn-sm btn-secondary hidden';
    document.getElementById('ticket-recepcion-container').classList.add('hidden');
    document.getElementById('ticket-venta-container').classList.remove('hidden');
    document.getElementById('etiqueta-pequena-container').classList.add('hidden');
    document.getElementById('ticket-corte-container').classList.add('hidden');
});

document.getElementById('btn-show-etiqueta-pequena').addEventListener('click', () => {
    document.getElementById('btn-show-ticket-recepcion').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-ticket-venta').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-etiqueta-pequena').className = 'btn btn-sm btn-primary active';
    document.getElementById('btn-show-ticket-corte').className = 'btn btn-sm btn-secondary hidden';
    document.getElementById('ticket-recepcion-container').classList.add('hidden');
    document.getElementById('ticket-venta-container').classList.add('hidden');
    document.getElementById('etiqueta-pequena-container').classList.remove('hidden');
    document.getElementById('ticket-corte-container').classList.add('hidden');
});

document.getElementById('btn-show-ticket-corte')?.addEventListener('click', () => {
    document.getElementById('btn-show-ticket-recepcion').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-ticket-venta').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-etiqueta-pequena').className = 'btn btn-sm btn-secondary';
    document.getElementById('btn-show-ticket-corte').className = 'btn btn-sm btn-primary active';
    document.getElementById('ticket-recepcion-container').classList.add('hidden');
    document.getElementById('ticket-venta-container').classList.add('hidden');
    document.getElementById('etiqueta-pequena-container').classList.add('hidden');
    document.getElementById('ticket-corte-container').classList.remove('hidden');
});

// ==========================================
// RENDER: INVENTARIO
// ==========================================
const inventoryModal = document.getElementById('inventory-modal');
let inventoryStockFilter = 'all';

function getInventoryCategoryFromCurrentSection() {
    return currentInventorySection === 'accesorios' ? 'Accesorios' : 'Refacciones';
}

document.getElementById('btn-add-inventory-modal').addEventListener('click', () => {
    document.getElementById('inventory-form').reset();
    document.getElementById('inv-id').value = '';
    document.getElementById('inv-categoria').value = getInventoryCategoryFromCurrentSection();
    delete document.getElementById('inventory-form').dataset.currentFoto;
    setInventoryPhotoPreview();
    document.querySelector('#inventory-modal h3').innerText = 'Agregar producto';
    inventoryModal.classList.remove('hidden');
});
document.getElementById('btn-close-inventory-modal').addEventListener('click', () => inventoryModal.classList.add('hidden'));
document.getElementById('btn-cancel-inventory').addEventListener('click', () => inventoryModal.classList.add('hidden'));

function setInventoryPhotoPreview(src = '', filename = '') {
    const preview = document.getElementById('inventory-photo-preview');
    const label = document.getElementById('inventory-photo-filename');
    if (!preview || !label) return;

    preview.innerHTML = src
        ? `<img src="${escapeHtml(src)}" alt="Fotografía del producto">`
        : '<i class="fa-solid fa-camera"></i>';
    label.textContent = filename || (src ? 'Fotografía actual' : 'PNG, JPG o WEBP');
}

function renderInventario() {
    const refaccionesBody = document.querySelector('#inventory-table-refacciones tbody');
    const accesoriosBody = document.querySelector('#inventory-table-accesorios tbody');
    if (!refaccionesBody || !accesoriosBody) return;

    refaccionesBody.innerHTML = '';
    accesoriosBody.innerHTML = '';
    updateInventoryMenuBadge();
    
    const searchVal = document.getElementById('inventory-search').value.toLowerCase().trim();

    const filtered = APP_STATE.inventario
        .filter(p => {
            const searchable = [
                p.nombre,
                p.codigo,
                p.codigo_barras,
                p.categoria,
                p.descripcion
            ].join(' ').toLowerCase();
            return !searchVal || searchable.includes(searchVal);
        })
        .filter(p => {
            const item = normalizeInventoryItem(p);
            if (inventoryStockFilter === 'low') return item.stock <= item.stock_minimo;
            if (inventoryStockFilter === 'out') return item.stock <= 0;
            return true;
        });

    const refacciones = filtered.filter(p => getInventoryCategoryGroup(p.categoria) === 'Refacciones');
    const accesorios = filtered.filter(p => getInventoryCategoryGroup(p.categoria) === 'Accesorios');
    document.getElementById('inventory-refacciones-count').textContent = `${refacciones.length} productos`;
    document.getElementById('inventory-accesorios-count').textContent = `${accesorios.length} productos`;

    renderInventoryRows(refaccionesBody, refacciones, 'refacciones');
    renderInventoryRows(accesoriosBody, accesorios, 'accesorios');
    document.getElementById('inventory-card-refacciones')?.classList.toggle('hidden', currentInventorySection !== 'refacciones');
    document.getElementById('inventory-card-accesorios')?.classList.toggle('hidden', currentInventorySection !== 'accesorios');

    applyRolePermissions();
}

function renderInventoryRows(tableBody, items, categoryLabel) {
    if (items.length === 0) {
        tableBody.innerHTML = `<tr class="inventory-empty-state"><td colspan="11" class="text-center">Sin ${categoryLabel} registradas con esos filtros.</td></tr>`;
        return;
    }

    items.forEach(p => {
        const item = normalizeInventoryItem(p);
        const isLow = item.stock <= item.stock_minimo;
        const isOut = item.stock <= 0;
        const categoryGroup = getInventoryCategoryGroup(item.categoria);
        const statusLabel = isOut ? 'Sin stock' : isLow ? 'Bajo stock' : 'Disponible';
        const statusClass = isOut ? 'bg-danger' : isLow ? 'bg-warning' : 'bg-success';
        const tr = document.createElement('tr');
        tr.id = `inventory-row-${item.id}`;
        tr.innerHTML = `
            <td><code>${escapeHtml(getProductBarcode(item))}</code></td>
            <td>
                ${item.foto_url ? `<img src="${escapeHtml(item.foto_url)}" class="inventory-item-photo" alt="${escapeHtml(item.nombre)}">` : `<div class="inventory-item-photo-placeholder"><i class="fa-solid fa-box"></i></div>`}
            </td>
            <td>
                <span class="inventory-name-cell">
                    <strong>${escapeHtml(item.nombre)}</strong>
                    <small>${escapeHtml(item.codigo || 'Sin código')}</small>
                </span>
            </td>
            <td><span class="badge ${categoryGroup === 'Refacciones' ? 'bg-primary' : 'bg-info'}">${categoryGroup}</span></td>
            <td class="inventory-description-cell">${escapeHtml(item.descripcion || 'N/A')}</td>
            <td class="admin-only">$${item.costo.toFixed(2)}</td>
            <td>$${item.precio.toFixed(2)}</td>
            <td><span class="badge ${isOut ? 'bg-danger' : isLow ? 'bg-warning' : 'bg-success'}">${item.stock} pz</span></td>
            <td>${item.stock_minimo} pz</td>
            <td><span class="badge ${statusClass}">${statusLabel}</span></td>
            <td>
                <div class="inventory-actions">
                    <button class="btn btn-xs btn-primary inventory-stock-action" onclick="editStockItem(${p.id})" title="Sumar stock" aria-label="Sumar stock"><i class="fa-solid fa-plus"></i></button>
                    <button class="btn btn-xs btn-secondary" onclick="openEditInventoryModal(${p.id})" title="Editar producto"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-xs btn-danger admin-only" onclick="deleteInventoryItem(${p.id})" title="Eliminar producto"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function focusInventoryItem(id) {
    const row = document.getElementById(`inventory-row-${id}`);
    if (!row) return;

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('row-highlight');
    setTimeout(() => row.classList.remove('row-highlight'), 2500);
}

document.getElementById('inventory-search').addEventListener('input', renderInventario);
document.getElementById('inventory-clear-search')?.addEventListener('click', () => {
    document.getElementById('inventory-search').value = '';
    renderInventario();
});

document.querySelectorAll('.inventory-filter-chip').forEach(button => {
    button.addEventListener('click', () => {
        inventoryStockFilter = button.dataset.inventoryFilter || 'all';
        document.querySelectorAll('.inventory-filter-chip').forEach(chip => {
            chip.classList.toggle('active', chip === button);
        });
        renderInventario();
    });
});

document.getElementById('inv-foto-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) {
        const currentFoto = document.getElementById('inventory-form').dataset.currentFoto || '';
        setInventoryPhotoPreview(currentFoto);
        return;
    }

    const reader = new FileReader();
    reader.onload = () => setInventoryPhotoPreview(reader.result, file.name);
    reader.readAsDataURL(file);
});

document.getElementById('inventory-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('inv-id').value;
    const isEditing = id !== '';
    const codigo = document.getElementById('inv-codigo').value.trim();
    const codigoBarras = document.getElementById('inv-codigo-barras').value.trim();

    let uploadedFotoUrl = document.getElementById('inventory-form').dataset.currentFoto || '';
    const fileInput = document.getElementById('inv-foto-file');
    
    if (fileInput.files.length > 0) {
        const formData = new FormData();
        formData.append('foto', fileInput.files[0]);
        try {
            const uploadRes = await fetch(`${BASE_API_URL}/inventario/upload`, {
                method: 'POST',
                body: formData
            });
            if (uploadRes.ok) {
                const uploadData = await uploadRes.json();
                uploadedFotoUrl = uploadData.url;
            } else {
                alert('No se pudo subir la foto del producto. Continuando sin foto.');
            }
        } catch (err) {
            console.error('Error subiendo foto:', err);
        }
    }

    const itemData = {
        codigo: codigo || null,
        codigo_barras: codigoBarras || null,
        nombre: document.getElementById('inv-nombre').value,
        categoria: document.getElementById('inv-categoria').value,
        descripcion: document.getElementById('inv-descripcion').value || '',
        costo: parseFloat(document.getElementById('inv-costo').value) || 0,
        precio: parseFloat(document.getElementById('inv-precio').value) || 0,
        stock: parseInt(document.getElementById('inv-stock').value) || 0,
        stock_minimo: parseInt(document.getElementById('inv-stock-min').value) || 2,
        foto_url: uploadedFotoUrl
    };

    try {
        let url = `${BASE_API_URL}/inventario`;
        let method = 'POST';
        if (isEditing) {
            url = `${BASE_API_URL}/inventario/${id}`;
            method = 'PUT';
        }

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(itemData)
        });

        if (response.ok) {
            alert(isEditing ? 'Producto actualizado correctamente.' : 'Producto registrado en el catálogo.');
            inventoryModal.classList.add('hidden');
            loadAllData();
        } else {
            const err = await response.json();
            alert('Error al guardar producto: ' + err.error);
        }
    } catch (err) {
        console.error('Error de red:', err);
    }
});

window.openEditInventoryModal = function(id) {
    const item = APP_STATE.inventario.find(p => p.id === id);
    if (!item) return;

    document.getElementById('inventory-form').reset();
    document.getElementById('inv-id').value = item.id;
    document.getElementById('inv-nombre').value = item.nombre;
    document.getElementById('inv-codigo').value = item.codigo || '';
    document.getElementById('inv-codigo-barras').value = item.codigo_barras || '';
    document.getElementById('inv-categoria').value = item.categoria;
    document.getElementById('inv-costo').value = item.costo;
    document.getElementById('inv-precio').value = item.precio;
    document.getElementById('inv-stock').value = item.stock;
    document.getElementById('inv-stock-min').value = item.stock_minimo;
    document.getElementById('inv-descripcion').value = item.descripcion || '';
    
    // Store current image URL
    const currentFoto = item.foto_url || item.fotografia || '';
    document.getElementById('inventory-form').dataset.currentFoto = currentFoto;
    document.getElementById('inv-foto-file').value = '';
    setInventoryPhotoPreview(currentFoto);

    document.querySelector('#inventory-modal h3').innerText = 'Editar producto';
    inventoryModal.classList.remove('hidden');
};

window.deleteInventoryItem = async function(id) {
    if (confirm('¿Está seguro de eliminar este producto del inventario?')) {
        try {
            const response = await fetch(`${BASE_API_URL}/inventario/${id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                alert('Producto eliminado del inventario.');
                loadAllData();
            } else {
                const err = await response.json();
                alert('Error al eliminar producto: ' + err.error);
            }
        } catch (err) {
            console.error(err);
        }
    }
};

async function editStockItem(id) {
    const item = APP_STATE.inventario.find(p => p.id === id);
    if (!item) return;
    const add = prompt(`Ingresa la cantidad a SUMAR al stock de "${item.nombre}" (Stock actual: ${item.stock}):`, "5");
    const num = parseInt(add, 10);
    if (!isNaN(num) && num > 0) {
        const updatedItem = { ...item, stock: item.stock + num };
        try {
            const response = await fetch(`${BASE_API_URL}/inventario/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedItem)
            });
            if (response.ok) {
                alert('Stock actualizado con éxito.');
                loadAllData();
            } else {
                const err = await response.json();
                alert('Error al actualizar stock: ' + err.error);
            }
        } catch (err) {
            console.error(err);
        }
    }
}

// ==========================================
// RENDER: CAJA
// ==========================================
function initCaja() {
    document.getElementById('caja-open-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const monto = Number(document.getElementById('caja-monto-inicial')?.value || 0);
        try {
            const response = await fetch(`${BASE_API_URL}/caja/abrir`, {
                method: 'POST',
                body: JSON.stringify({ monto_inicial: monto })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                alert(data.error || 'No se pudo abrir caja.');
                return;
            }
            APP_STATE.cajaActiva = data.caja || null;
            await loadCaja();
            renderCaja();
            document.getElementById('caja-monto-inicial').value = '';
            if (data.alreadyOpen) alert('Ya existe una caja activa. Se mostrara la caja abierta.');
        } catch (error) {
            console.error(error);
            alert('No se pudo abrir caja por un error de red.');
        }
    });

    document.getElementById('btn-caja-entrada')?.addEventListener('click', () => openCajaMovementModal('entrada_manual'));
    document.getElementById('btn-caja-salida')?.addEventListener('click', () => openCajaMovementModal('salida_manual'));
    document.getElementById('btn-caja-cerrar')?.addEventListener('click', openCajaCloseModal);
    document.getElementById('btn-close-caja-movement')?.addEventListener('click', closeCajaMovementModal);
    document.getElementById('btn-cancel-caja-movement')?.addEventListener('click', closeCajaMovementModal);
    document.getElementById('btn-close-caja-close')?.addEventListener('click', closeCajaCloseModal);
    document.getElementById('btn-cancel-caja-close')?.addEventListener('click', closeCajaCloseModal);
    document.getElementById('btn-close-caja-detail')?.addEventListener('click', closeCajaDetailModal);
    document.getElementById('btn-close-caja-detail-footer')?.addEventListener('click', closeCajaDetailModal);
    document.getElementById('btn-print-caja-corte')?.addEventListener('click', printSelectedCajaCorte);
    document.getElementById('caja-close-counted')?.addEventListener('input', updateCajaCloseDifference);
    document.getElementById('caja-movement-form')?.addEventListener('submit', saveCajaManualMovement);
    document.getElementById('caja-close-form')?.addEventListener('submit', closeCajaFromModal);
    document.getElementById('caja-movement-date-filter')?.addEventListener('change', () => renderCajaMovimientos());
}

function cajaDate(value) {
    if (!value) return 'Sin fecha';
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function cajaTypeLabel(type = '') {
    const labels = {
        apertura: 'Apertura',
        venta_pos: 'Venta POS',
        cobro_orden: 'Cobro orden',
        anticipo: 'Anticipo',
        abono: 'Abono',
        liquidacion: 'Liquidacion',
        entrada_manual: 'Entrada manual',
        salida_manual: 'Salida manual',
        ajuste: 'Ajuste',
        devolucion: 'Devolucion'
    };
    return labels[type] || String(type || '-').replace(/_/g, ' ');
}

function cajaMethodLabel(method = '') {
    const labels = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };
    return labels[String(method || '').toLowerCase()] || method || '-';
}

function cajaResultLabel(result = '') {
    const labels = { exacto: 'Exacto', sobrante: 'Sobrante', faltante: 'Faltante', abierta: 'Abierta' };
    return labels[result] || result || '-';
}

function cajaResultClass(caja = {}) {
    if (caja.resultado === 'faltante') return 'caja-status-faltante';
    if (caja.resultado === 'sobrante') return 'caja-status-sobrante';
    if (caja.estado === 'abierta') return 'caja-status-abierta';
    return 'caja-status-exacto';
}

function cajaMovementTone(type = '') {
    const value = String(type || '').toLowerCase();
    if (value.includes('salida') || value.includes('devolucion')) return 'caja-money-out';
    if (value.includes('ajuste')) return 'caja-money-neutral';
    return 'caja-money-in';
}

function cajaInputDate(value) {
    if (!value) return '';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function getCajaSummary(caja = APP_STATE.cajaActiva) {
    return caja?.resumen || {
        fondo_inicial: 0,
        ventas_pos_efectivo: 0,
        cobros_reparaciones_efectivo: 0,
        anticipos: 0,
        abonos: 0,
        entradas_manuales: 0,
        salidas_manuales: 0,
        total_esperado: 0,
        transferencias: 0,
        tarjeta: 0,
        total_ingresos: 0,
        total_salidas: 0
    };
}

function renderCaja() {
    const caja = APP_STATE.cajaActiva;
    document.getElementById('caja-open-card')?.classList.toggle('hidden', Boolean(caja));
    document.getElementById('caja-active-card')?.classList.toggle('hidden', !caja);

    if (caja) {
        const summary = getCajaSummary(caja);
        setTextContent('caja-active-meta', `Caja #${caja.id} abierta por ${caja.usuario_nombre || 'usuario'} el ${cajaDate(caja.fecha_apertura)}`);
        setTextContent('caja-active-user', caja.usuario_nombre || 'Usuario');
        setTextContent('caja-active-opened', cajaDate(caja.fecha_apertura));
        setTextContent('caja-active-fund', formatCurrency(summary.fondo_inicial));
        setTextContent('caja-sum-fondo', formatCurrency(summary.fondo_inicial));
        setTextContent('caja-sum-ventas', formatCurrency(summary.ventas_pos_efectivo));
        setTextContent('caja-sum-reparaciones', formatCurrency(summary.cobros_reparaciones_efectivo));
        setTextContent('caja-sum-anticipos', formatCurrency(summary.anticipos));
        setTextContent('caja-sum-abonos', formatCurrency(summary.abonos));
        setTextContent('caja-sum-entradas', formatCurrency(summary.entradas_manuales));
        setTextContent('caja-sum-salidas', formatCurrency(summary.salidas_manuales));
        setTextContent('caja-sum-esperado', formatCurrency(summary.total_esperado));
        setTextContent('caja-sum-transferencias', formatCurrency(summary.transferencias));
        setTextContent('caja-sum-tarjeta', formatCurrency(summary.tarjeta));
    }

    renderCajaMovimientos();
    renderCajaHistorial();
    renderCajaHistorySummary();
}

function renderCajaMovimientos(movimientos = APP_STATE.cajaActiva?.movimientos || [], tableId = 'caja-movimientos-table') {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    let visibleMovements = movimientos;

    if (tableId === 'caja-movimientos-table') {
        const filterValue = document.getElementById('caja-movement-date-filter')?.value || '';
        if (filterValue) {
            visibleMovements = movimientos.filter(movement => cajaInputDate(movement.created_at) === filterValue);
        }
    }

    if (!visibleMovements.length) {
        const title = APP_STATE.cajaActiva ? 'No hay movimientos registrados.' : 'Primero debes abrir una caja.';
        const text = APP_STATE.cajaActiva
            ? 'Los cobros, entradas y salidas apareceran aqui durante el turno.'
            : 'Abre una caja para habilitar el registro de movimientos en efectivo.';
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="caja-empty-state">
                        <i class="fa-solid fa-receipt"></i>
                        <strong>${title}</strong>
                        <span>${text}</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = visibleMovements.map(movement => `
        <tr>
            <td>${cajaDate(movement.created_at)}</td>
            <td>${escapeHtml(movement.usuario_nombre || '-')}</td>
            <td><span class="caja-type-pill ${cajaMovementTone(movement.tipo_movimiento)}">${escapeHtml(cajaTypeLabel(movement.tipo_movimiento))}</span></td>
            <td>${escapeHtml(cajaMethodLabel(movement.metodo_pago))}</td>
            <td><span class="caja-money ${cajaMovementTone(movement.tipo_movimiento)}">${formatCurrency(movement.monto)}</span></td>
            <td>${escapeHtml(movement.descripcion || '-')}</td>
            <td>${escapeHtml(movement.referencia_tipo || '-')}${movement.referencia_id ? ` #${movement.referencia_id}` : ''}</td>
        </tr>
    `).join('');
}

function renderCajaHistorial() {
    const tbody = document.querySelector('#caja-historial-table tbody');
    if (!tbody) return;
    const rows = APP_STATE.cajaHistorial || [];

    if (!rows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10">
                    <div class="caja-empty-state">
                        <i class="fa-solid fa-folder-open"></i>
                        <strong>Sin cortes registrados.</strong>
                        <span>Cuando cierres caja, el corte aparecera en este historial.</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rows.map(caja => `
        <tr>
            <td>${cajaDate(caja.fecha_cierre || caja.fecha_apertura)}</td>
            <td>${escapeHtml(caja.usuario_nombre || '-')}</td>
            <td>${formatCurrency(caja.monto_inicial)}</td>
            <td><span class="caja-money caja-money-in">${formatCurrency(caja.total_ingresos)}</span></td>
            <td><span class="caja-money caja-money-out">${formatCurrency(caja.total_salidas)}</span></td>
            <td>${formatCurrency(caja.total_esperado)}</td>
            <td>${caja.monto_contado === null || caja.monto_contado === undefined ? '-' : formatCurrency(caja.monto_contado)}</td>
            <td><span class="caja-money caja-money-difference">${caja.diferencia === null || caja.diferencia === undefined ? '-' : formatCurrency(caja.diferencia)}</span></td>
            <td><span class="caja-status-pill ${cajaResultClass(caja)}">${escapeHtml(cajaResultLabel(caja.resultado))}</span></td>
            <td>
                <button type="button" class="btn btn-sm btn-secondary caja-action-btn" onclick="viewCajaDetalle(${caja.id})" title="Ver detalle">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function renderCajaHistorySummary() {
    const rows = APP_STATE.cajaHistorial || [];
    const totals = rows.reduce((acc, caja) => {
        acc.fondo += Number(caja.monto_inicial || 0);
        acc.ingresos += Number(caja.total_ingresos || 0);
        acc.salidas += Number(caja.total_salidas || 0);
        acc.contado += Number(caja.monto_contado || 0);
        acc.diferencia += Number(caja.diferencia || 0);
        return acc;
    }, { fondo: 0, ingresos: 0, salidas: 0, contado: 0, diferencia: 0 });

    setTextContent('caja-history-sum-fondo', formatCurrency(totals.fondo));
    setTextContent('caja-history-sum-ingresos', formatCurrency(totals.ingresos));
    setTextContent('caja-history-sum-salidas', formatCurrency(totals.salidas));
    setTextContent('caja-history-sum-contado', formatCurrency(totals.contado));
    setTextContent('caja-history-sum-diferencia', formatCurrency(totals.diferencia));
}

function openCajaMovementModal(type) {
    if (!APP_STATE.cajaActiva) {
        alert('No hay caja abierta.');
        return;
    }
    const isEntrada = type === 'entrada_manual';
    setTextContent('caja-movement-title', isEntrada ? 'Registrar entrada de efectivo' : 'Registrar salida de efectivo');
    document.getElementById('caja-movement-type').value = type;
    document.getElementById('caja-movement-amount').value = '';
    document.getElementById('caja-movement-description').value = '';
    document.getElementById('caja-movement-modal')?.classList.remove('hidden');
}

function closeCajaMovementModal() {
    document.getElementById('caja-movement-modal')?.classList.add('hidden');
}

async function saveCajaManualMovement(event) {
    event.preventDefault();
    const type = document.getElementById('caja-movement-type')?.value;
    const monto = Number(document.getElementById('caja-movement-amount')?.value || 0);
    const descripcion = document.getElementById('caja-movement-description')?.value.trim();
    const endpoint = type === 'salida_manual' ? 'salida' : 'entrada';

    try {
        const response = await fetch(`${BASE_API_URL}/caja/${endpoint}`, {
            method: 'POST',
            body: JSON.stringify({ monto, descripcion })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(data.error || 'No se pudo guardar el movimiento.');
            return;
        }
        APP_STATE.cajaActiva = data;
        await loadCaja();
        renderCaja();
        closeCajaMovementModal();
    } catch (error) {
        console.error(error);
        alert('No se pudo guardar el movimiento por un error de red.');
    }
}

function openCajaCloseModal() {
    if (!APP_STATE.cajaActiva) {
        alert('No hay caja abierta para cerrar.');
        return;
    }
    const expected = Number(getCajaSummary().total_esperado || 0);
    setTextContent('caja-close-expected', formatCurrency(expected));
    document.getElementById('caja-close-counted').value = expected.toFixed(2);
    document.getElementById('caja-close-observations').value = '';
    updateCajaCloseDifference();
    document.getElementById('caja-close-modal')?.classList.remove('hidden');
}

function closeCajaCloseModal() {
    document.getElementById('caja-close-modal')?.classList.add('hidden');
}

function updateCajaCloseDifference() {
    const expected = Number(getCajaSummary().total_esperado || 0);
    const counted = Number(document.getElementById('caja-close-counted')?.value || 0);
    setTextContent('caja-close-difference', formatCurrency(counted - expected));
}

async function closeCajaFromModal(event) {
    event.preventDefault();
    const monto_contado = Number(document.getElementById('caja-close-counted')?.value || 0);
    const observaciones = document.getElementById('caja-close-observations')?.value.trim();
    if (!confirm('¿Cerrar caja? Después del corte no se podrán registrar más movimientos en esta caja.')) return;

    try {
        const response = await fetch(`${BASE_API_URL}/caja/cerrar`, {
            method: 'POST',
            body: JSON.stringify({ monto_contado, observaciones })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(data.error || 'No se pudo cerrar caja.');
            return;
        }
        closeCajaCloseModal();
        APP_STATE.selectedCajaForReceipt = data;
        await loadCaja();
        renderCaja();
        await viewCajaDetalle(data.id);
    } catch (error) {
        console.error(error);
        alert('No se pudo cerrar caja por un error de red.');
    }
}

window.viewCajaDetalle = async function(id) {
    try {
        const response = await fetch(`${BASE_API_URL}/caja/${id}`);
        const caja = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(caja.error || 'No se pudo abrir el corte.');
            return;
        }
        APP_STATE.selectedCajaForReceipt = caja;
        renderCajaDetail(caja);
        document.getElementById('caja-detail-modal')?.classList.remove('hidden');
    } catch (error) {
        console.error(error);
        alert('No se pudo abrir el corte por un error de red.');
    }
};

function closeCajaDetailModal() {
    document.getElementById('caja-detail-modal')?.classList.add('hidden');
}

function renderCajaDetail(caja) {
    const summary = getCajaSummary(caja);
    const detail = document.getElementById('caja-detail-summary');
    if (detail) {
        detail.innerHTML = [
            ['Fondo inicial', summary.fondo_inicial],
            ['Total ingresos', summary.total_ingresos],
            ['Total salidas', summary.total_salidas],
            ['Total esperado', caja.total_esperado ?? summary.total_esperado],
            ['Dinero contado', caja.monto_contado],
            ['Diferencia', caja.diferencia],
            ['Resultado', cajaResultLabel(caja.resultado)]
        ].map(([label, value]) => `
            <div class="caja-summary-item">
                <span>${escapeHtml(label)}</span>
                <strong>${typeof value === 'number' ? formatCurrency(value) : escapeHtml(value ?? '-')}</strong>
            </div>
        `).join('');
    }
    renderCajaMovimientos(caja.movimientos || [], 'caja-detail-movements-table');
}

function populateCajaCorteTicket(caja) {
    const summary = getCajaSummary(caja);
    document.getElementById('ticket-corte-business-name').innerText = ESTABLISHMENT_CONFIG.name.toUpperCase();
    applyTicketContactInfo();
    setTextContent('ticket-corte-id', String(caja.id).padStart(4, '0'));
    setTextContent('ticket-corte-date', `Fecha: ${cajaDate(caja.fecha_cierre || caja.fecha_apertura)}`);
    setTextContent('ticket-corte-user', caja.usuario_nombre || 'Usuario');
    setTextContent('ticket-corte-fondo', formatCurrency(summary.fondo_inicial));
    setTextContent('ticket-corte-ventas', formatCurrency(summary.ventas_pos_efectivo));
    setTextContent('ticket-corte-reparaciones', formatCurrency(summary.cobros_reparaciones_efectivo));
    setTextContent('ticket-corte-anticipos', formatCurrency(summary.anticipos));
    setTextContent('ticket-corte-abonos', formatCurrency(summary.abonos));
    setTextContent('ticket-corte-entradas', formatCurrency(summary.entradas_manuales));
    setTextContent('ticket-corte-salidas', formatCurrency(summary.salidas_manuales));
    setTextContent('ticket-corte-esperado', formatCurrency(caja.total_esperado ?? summary.total_esperado));
    setTextContent('ticket-corte-contado', caja.monto_contado === null || caja.monto_contado === undefined ? '-' : formatCurrency(caja.monto_contado));
    setTextContent('ticket-corte-diferencia', caja.diferencia === null || caja.diferencia === undefined ? '-' : formatCurrency(caja.diferencia));
    setTextContent('ticket-corte-transferencias', formatCurrency(summary.transferencias));
    setTextContent('ticket-corte-tarjeta', formatCurrency(summary.tarjeta));
    setTextContent('ticket-corte-resultado', `Resultado: ${cajaResultLabel(caja.resultado)}`);
    setTextContent('ticket-corte-observaciones', caja.observaciones || 'Sin observaciones');
}

async function printSelectedCajaCorte() {
    const caja = APP_STATE.selectedCajaForReceipt;
    if (!caja) {
        alert('No hay corte seleccionado.');
        return;
    }
    populateCajaCorteTicket(caja);
    document.getElementById('caja-detail-modal')?.classList.add('hidden');
    document.getElementById('btn-show-ticket-corte')?.classList.remove('hidden');
    document.getElementById('btn-show-ticket-corte')?.click();
    receiptModal?.classList.remove('sale-ticket-only');
    setReceiptPrintLabels('Corte de Caja');
    receiptModal?.classList.remove('hidden');
}

// ==========================================
// RENDER: VENTAS
// ==========================================
function getPOSSubtotal() {
    return Number(APP_STATE.cart.reduce((sum, item) => sum + (Number(item.precio || 0) * Number(item.qty || 0)), 0).toFixed(2));
}

function getPOSDiscount() {
    const subtotal = getPOSSubtotal();
    const discountInput = document.getElementById('pos-descuento');
    const rawDiscount = Number(discountInput?.value || 0);
    const discount = Number(Math.min(Math.max(rawDiscount, 0), subtotal).toFixed(2));
    if (discountInput && rawDiscount > subtotal) {
        discountInput.value = subtotal.toFixed(2);
    }
    return discount;
}

function getPOSTotal() {
    return Number(Math.max(getPOSSubtotal() - getPOSDiscount(), 0).toFixed(2));
}

function getPOSPaymentState() {
    const method = document.getElementById('pos-metodo-pago')?.value || 'Efectivo';
    const total = getPOSTotal();
    const cashReceived = method === 'Efectivo' || method === 'Mixto'
        ? Number(document.getElementById('pos-monto-recibido')?.value || 0)
        : 0;
    let transferReceived = method === 'Transferencia' || method === 'Mixto'
        ? Number(document.getElementById('pos-transferencia-recibida')?.value || 0)
        : 0;

    if (method === 'Transferencia' && transferReceived <= 0) {
        transferReceived = total;
    }

    const totalReceived = cashReceived + transferReceived;
    const change = method === 'Efectivo' || method === 'Mixto'
        ? Number(Math.min(Math.max(totalReceived - total, 0), cashReceived).toFixed(2))
        : 0;
    const cashApplied = Number(Math.max(cashReceived - change, 0).toFixed(2));
    const primaryReceived = method === 'Transferencia'
        ? transferReceived
        : method === 'Tarjeta'
            ? total
            : cashReceived;

    return {
        method,
        cashReceived,
        transferReceived,
        cashApplied,
        change,
        primaryReceived
    };
}

function getPOSProductImage(product = {}) {
    const src = product.foto_url || product.fotografia || product.imagen_url || '';
    return src ? String(src) : '';
}

function getPOSCartProduct(item = {}) {
    if (item.type === 'repair') return null;
    return normalizeInventoryItem(APP_STATE.inventario.find(product => String(product.id) === String(item.id)) || {});
}

function initPOS() {
    const barcodeInput = document.getElementById('pos-barcode-input');
    const searchInput = document.getElementById('pos-search-input');
    const payMethodSelect = document.getElementById('pos-metodo-pago');
    const cashGroup = document.getElementById('pos-efectivo-group');
    const changeGroup = document.getElementById('pos-cambio-group');
    const cashInput = document.getElementById('pos-monto-recibido');
    const transferGroup = document.getElementById('pos-transferencia-group');
    const transferInput = document.getElementById('pos-transferencia-recibida');
    const transferReferenceGroup = document.getElementById('pos-transferencia-referencia-group');
    const transferReferenceInput = document.getElementById('pos-transferencia-referencia');
    const discountInput = document.getElementById('pos-descuento');
    const observationsInput = document.getElementById('pos-ticket-observaciones');
    const observationsGroup = observationsInput?.closest('.pos-notes-group');
    const observationsToggle = document.getElementById('btn-pos-toggle-notes');
    const methodButtons = document.querySelectorAll('.pos-method-btn[data-pos-method]');
    const changeDisplay = document.getElementById('pos-cambio');
    const clearButton = document.getElementById('btn-pos-clear');
    const payButton = document.getElementById('btn-pos-pay');
    const printLastTicketButton = document.getElementById('btn-pos-print-last-ticket');
    if (!payMethodSelect || !cashInput || !changeDisplay || !clearButton || !payButton) return;

    const updatePaymentFields = () => {
        const val = payMethodSelect.value;
        const usesCash = val === 'Efectivo' || val === 'Mixto';
        const usesTransferAmount = val === 'Mixto';
        const usesTransferReference = val === 'Transferencia' || val === 'Mixto';

        if (usesCash) {
            cashGroup.classList.remove('hidden');
        } else {
            cashGroup.classList.add('hidden');
            cashInput.value = '';
        }

        if (usesTransferAmount) {
            transferGroup?.classList.remove('hidden');
        } else {
            transferGroup?.classList.add('hidden');
            if (transferInput) transferInput.value = '';
        }

        if (usesTransferReference) {
            transferReferenceGroup?.classList.remove('hidden');
        } else {
            transferReferenceGroup?.classList.add('hidden');
            if (transferReferenceInput) transferReferenceInput.value = '';
        }

        changeGroup.style.display = 'flex';
        methodButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.posMethod === val);
        });
        recalculatePOSChange();
    };

    payMethodSelect.addEventListener('change', updatePaymentFields);
    methodButtons.forEach(button => {
        button.addEventListener('click', () => {
            payMethodSelect.value = button.dataset.posMethod;
            payMethodSelect.dispatchEvent(new Event('change'));
        });
    });
    observationsToggle?.addEventListener('click', () => {
        observationsGroup?.classList.toggle('hidden');
        const isOpen = !observationsGroup?.classList.contains('hidden');
        observationsToggle.classList.toggle('active', isOpen);
        observationsToggle.innerHTML = isOpen
            ? '<i class="fa-solid fa-chevron-up"></i> Ocultar observaciones'
            : '<i class="fa-solid fa-note-sticky"></i> Agregar observaciones';
        if (isOpen) observationsInput?.focus();
    });

    cashInput.addEventListener('input', () => {
        recalculatePOSChange();
    });
    transferInput?.addEventListener('input', () => {
        recalculatePOSChange();
    });
    discountInput?.addEventListener('input', () => {
        updateCartUI();
    });

    if (barcodeInput) {
        barcodeInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const code = barcodeInput.value.trim();
                barcodeInput.value = '';
                if (code) {
                    const scannedCode = normalizeScannedCode(code);
                    const normalizedCode = scannedCode.toLowerCase();
                    const item = APP_STATE.inventario.find(p =>
                        normalizeScannedCode(p.codigo).toLowerCase() === normalizedCode ||
                        normalizeScannedCode(p.codigo_barras).toLowerCase() === normalizedCode
                    );
                    if (item) {
                        addToCart(item.id);
                    } else {
                        await addRepairOrderToCart(scannedCode);
                    }
                }
            }
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', renderPOSCatalog);
    }

    clearButton.addEventListener('click', () => {
        APP_STATE.cart = [];
        if (discountInput) discountInput.value = '';
        if (cashInput) cashInput.value = '';
        if (transferInput) transferInput.value = '';
        if (transferReferenceInput) transferReferenceInput.value = '';
        if (observationsInput) observationsInput.value = '';
        observationsGroup?.classList.add('hidden');
        observationsToggle?.classList.remove('active');
        if (observationsToggle) observationsToggle.innerHTML = '<i class="fa-solid fa-note-sticky"></i> Agregar observaciones';
        updateCartUI();
    });

    printLastTicketButton?.addEventListener('click', async () => {
        printLastTicketButton.disabled = true;
        printLastTicketButton.classList.add('disabled');
        try {
            let lastSale = APP_STATE.selectedSaleForReceipt || APP_STATE.ventas[0];
            if (!lastSale) {
                await loadVentas();
                lastSale = APP_STATE.ventas[0];
            }

            if (!lastSale) {
                alert('Aún no hay un ticket de venta para imprimir.');
                return;
            }

            viewVentaDetails(lastSale);
        } finally {
            printLastTicketButton.disabled = false;
            printLastTicketButton.classList.remove('disabled');
        }
    });

    payButton.addEventListener('click', async () => {
        if (APP_STATE.cart.length === 0) {
            alert('El carrito de compras está vacío.');
            return;
        }

        const subtotal = getPOSSubtotal();
        const descuento = getPOSDiscount();
        const total = getPOSTotal();
        const metodo = payMethodSelect.value;
        const payment = getPOSPaymentState();

        if (payment.cashApplied > 0 && !APP_STATE.cajaActiva) {
            alert('No hay caja abierta. Abre caja antes de cobrar en efectivo.');
            switchView('caja');
            return;
        }
        
        if (metodo === 'Efectivo' && payment.cashReceived < total) {
            alert('El efectivo recibido es menor al total a cobrar.');
            return;
        }
        if (metodo === 'Transferencia' && payment.transferReceived < total) {
            alert('La transferencia recibida es menor al total a cobrar.');
            return;
        }
        if (metodo === 'Mixto' && payment.cashReceived + payment.transferReceived < total) {
            alert('El pago mixto no cubre el total a cobrar.');
            return;
        }

        const ventaData = {
            subtotal: Number(subtotal.toFixed(2)),
            descuento: Number(descuento.toFixed(2)),
            total: Number(total.toFixed(2)),
            metodo_pago: metodo,
            efectivo_recibido: Number(payment.cashReceived.toFixed(2)),
            transferencia_recibida: Number(payment.transferReceived.toFixed(2)),
            referencia_transferencia: transferReferenceInput?.value.trim() || null,
            observaciones_ticket: observationsInput?.value.trim() || null,
            monto_recibido: Number(payment.primaryReceived.toFixed(2)),
            cambio: Number(payment.change.toFixed(2)),
            items: APP_STATE.cart.map(item => ({
                tipo: item.type === 'repair' ? 'reparacion' : 'producto',
                producto_id: item.type === 'repair' ? null : item.id,
                orden_id: item.type === 'repair' ? item.orderId : null,
                orden_folio: item.type === 'repair' ? item.folio : null,
                nombre: item.nombre,
                cantidad: Number(item.qty),
                precio_unitario: Number(item.precio),
                descripcion: item.description || null
            })),
            usuario_id: APP_STATE.currentUser?.id || null
        };

        try {
            const response = await fetch(`${BASE_API_URL}/pos/venta`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ventaData)
            });

            if (response.ok) {
                const completedVenta = await response.json();
                
                APP_STATE.cart = [];
                updateCartUI();
                if (discountInput) discountInput.value = '';
                cashInput.value = '';
                if (transferInput) transferInput.value = '';
                if (transferReferenceInput) transferReferenceInput.value = '';
                if (observationsInput) observationsInput.value = '';
                observationsGroup?.classList.add('hidden');
                observationsToggle?.classList.remove('active');
                if (observationsToggle) observationsToggle.innerHTML = '<i class="fa-solid fa-note-sticky"></i> Agregar observaciones';
                changeDisplay.innerText = '$0.00';
                await loadAllData();
                await handleCompletedSale(completedVenta);
            } else {
                const err = await response.json();
                alert('Error al procesar cobro: ' + err.error);
            }
        } catch (err) {
            console.error('Error de red:', err);
        }
    });

    updatePaymentFields();
}


async function addRepairOrderToCart(folio) {
    try {
        const response = await fetch(`${BASE_API_URL}/pos/order/${encodeURIComponent(folio)}`);
        if (!response.ok) {
            alert('No se encontro producto ni orden con ese codigo.');
            return;
        }

        const order = await response.json();
        const paid = normalizeText(order.estado_pago) === 'pagado';
        if (paid || (normalizeText(order.estado) === 'entregado' && paid)) {
            alert('Esta orden ya fue pagada');
            return;
        }

        const balance = Number(order.saldo_pendiente || 0);
        if (balance <= 0) {
            alert('La orden no tiene saldo pendiente.');
            return;
        }

        if (APP_STATE.cart.some(item => item.type === 'repair' && item.folio === order.folio)) {
            alert('Esta orden ya esta agregada al carrito.');
            return;
        }

        APP_STATE.cart.push({
            id: `repair-${order.id}`,
            type: 'repair',
            orderId: order.id,
            folio: order.folio,
            nombre: `Servicio de reparacion - ${order.folio}`,
            cliente: order.cliente,
            equipo: order.equipo,
            total_reparacion: Number(order.total || 0),
            anticipo: Number(order.anticipo || 0),
            saldo: balance,
            precio: balance,
            qty: 1,
            description: `Cliente: ${order.cliente || '-'} | Equipo: ${order.equipo || '-'} | Total reparacion: $${Number(order.total || 0).toFixed(2)} | Anticipo: $${Number(order.anticipo || 0).toFixed(2)} | Saldo pendiente: $${balance.toFixed(2)}`
        });
        updateCartUI();
    } catch (error) {
        alert(error.message || 'No se pudo consultar la orden.');
    }
}

function getRepairTicketDetails(item) {
    const descriptionParts = {};
    String(item.descripcion || item.description || '')
        .split('|')
        .forEach(part => {
            const separatorIndex = part.indexOf(':');
            if (separatorIndex === -1) return;
            const label = normalizeText(part.slice(0, separatorIndex)).trim();
            const value = part.slice(separatorIndex + 1).trim();
            if (label && value) descriptionParts[label] = value;
        });

    const folioFromName = String(item.nombre || '').match(/[A-Z]+-\d{4}-\d+/i)?.[0];
    const total = item.total_reparacion ?? item.total ?? descriptionParts['total reparacion'] ?? item.subtotal ?? 0;
    const anticipo = item.anticipo ?? descriptionParts.anticipo ?? 0;
    const saldo = item.saldo
        ?? descriptionParts['saldo pendiente']
        ?? descriptionParts['saldo completado']
        ?? item.subtotal
        ?? (Number(item.precio_unitario || 0) * Number(item.cantidad || 1));

    return {
        folio: item.orden_folio || item.folio || folioFromName || '-',
        cliente: item.cliente || descriptionParts.cliente || '-',
        equipo: item.equipo || descriptionParts.equipo || '-',
        total,
        anticipo,
        saldo
    };
}

function renderRepairTicketItem(item, tableBody) {
    const details = getRepairTicketDetails(item);
    const tr = document.createElement('tr');
    tr.className = 'ticket-repair-detail-row';
    tr.innerHTML = `
        <td colspan="4">
            <div class="ticket-repair-detail">
                <p><strong>Reparación:</strong> ${escapeHtml(details.folio)}</p>
                <p><strong>Cliente:</strong> ${escapeHtml(details.cliente)}</p>
                <p><strong>Equipo:</strong> ${escapeHtml(details.equipo)}</p>
                <p><strong>Total:</strong> ${formatTicketAmount(details.total)} <strong>Anticipo:</strong> ${formatTicketAmount(details.anticipo)}</p>
                <p><strong>Saldo pendiente:</strong> ${formatTicketAmount(details.saldo)}</p>
            </div>
        </td>
    `;
    tableBody.appendChild(tr);
}


window.viewVentaDetails = function(venta, options = {}) {
    const sale = normalizeVenta(venta);
    APP_STATE.selectedSaleForReceipt = sale;
    const saleKind = getSaleReceiptKind(sale);
    const serviceItems = sale.items.filter(item => item.tipo_item === 'reparacion' || item.tipo === 'reparacion' || item.type === 'repair');
    const productItems = sale.items.filter(item => !(item.tipo_item === 'reparacion' || item.tipo === 'reparacion' || item.type === 'repair'));

    // Inyectar Datos del Establecimiento dinámicos
    document.getElementById('ticket-venta-business-name').innerText = ESTABLISHMENT_CONFIG.name.toUpperCase();
    document.getElementById('ticket-venta-business-info').innerText = `${ESTABLISHMENT_CONFIG.address} | Tel: ${ESTABLISHMENT_CONFIG.phone}`;
    applyTicketContactInfo();
    document.getElementById('ticket-venta-type-label').innerText = saleKind.label;
    document.getElementById('ticket-venta-items-title').innerText = saleKind.itemsTitle;
    document.getElementById('ticket-venta-service-note').innerText = saleKind.note;
    document.getElementById('ticket-venta-container').dataset.ticketType = saleKind.key;

    document.getElementById('ticket-venta-id').innerText = String(sale.id).padStart(4, '0');
    document.getElementById('ticket-venta-date').innerText = `Fecha: ${sale.fecha || new Date().toLocaleString()}`;
    document.getElementById('ticket-venta-paymethod').innerText = sale.metodo_pago;
    document.getElementById('ticket-venta-subtotal').innerText = `$${sale.subtotal.toFixed(2)}`;
    document.getElementById('ticket-venta-discount').innerText = `$${sale.descuento.toFixed(2)}`;
    document.getElementById('ticket-venta-total').innerText = `$${sale.total.toFixed(2)}`;
    document.getElementById('ticket-venta-cash').innerText = `$${(sale.efectivo_recibido || 0).toFixed(2)}`;
    document.getElementById('ticket-venta-transfer').innerText = `$${(sale.transferencia_recibida || 0).toFixed(2)}`;
    document.getElementById('ticket-venta-reference').innerText = sale.referencia_transferencia || '-';
    document.getElementById('ticket-venta-change').innerText = `$${(sale.cambio || 0).toFixed(2)}`;
    document.getElementById('ticket-venta-observations').innerText = sale.observaciones_ticket || 'Sin observaciones';

    const tbody = document.querySelector('#ticket-venta-items-table tbody');
    tbody.innerHTML = '';

    function appendGroupLabel(label) {
        const groupRow = document.createElement('tr');
        groupRow.className = 'ticket-sale-group-row';
        groupRow.innerHTML = `<td colspan="4">${escapeHtml(label)}</td>`;
        tbody.appendChild(groupRow);
    }

    function appendSaleItem(item) {
        if (item.tipo_item === 'reparacion' || item.tipo === 'reparacion' || item.type === 'repair') {
            renderRepairTicketItem(item, tbody);
            return;
        }

        const tr = document.createElement('tr');
        const itemTotal = item.precio_unitario * item.cantidad;
        const detail = item.descripcion
            ? `<br><small>${escapeHtml(item.descripcion)}</small>`
            : (item.tipo_item === 'reparacion' || item.tipo === 'reparacion')
                ? '<br><small>Saldo de reparación completado.</small>'
                : '';
        tr.innerHTML = `
            <td>${item.cantidad}</td>
            <td>${escapeHtml(item.nombre || 'Producto')}${detail}</td>
            <td>$${item.precio_unitario.toFixed(2)}</td>
            <td>$${itemTotal.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    }

    if (saleKind.key === 'mixed') {
        appendGroupLabel('Servicio técnico');
        serviceItems.forEach(appendSaleItem);
        appendGroupLabel('Accesorios / productos');
        productItems.forEach(appendSaleItem);
    } else {
        sale.items.forEach(appendSaleItem);
    }

    // Abrir el modal y seleccionar la pestaña de ticket de venta
    receiptModal.classList.add('sale-ticket-only');
    setReceiptPrintLabels('Ticket de Venta');
    document.getElementById('btn-show-ticket-venta').click();

    if (options.openPreview === false) {
        return;
    }

    receiptModal.classList.remove('hidden');
};

function renderPOSCatalog() {
    const grid = document.getElementById('pos-products-grid');
    grid.innerHTML = '';
    const searchVal = document.getElementById('pos-search-input').value.toLowerCase();

    const filtered = APP_STATE.inventario.filter(p => {
        const item = normalizeInventoryItem(p);
        const categoryGroup = getInventoryCategoryGroup(p.categoria);
        const matchesSearch =
            String(item.nombre || '').toLowerCase().includes(searchVal) ||
            String(item.codigo || '').toLowerCase().includes(searchVal) ||
            categoryGroup.toLowerCase().includes(searchVal);
        return matchesSearch;
    });
    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="pos-products-empty">
                <i class="fa-solid fa-magnifying-glass"></i>
                <strong>Sin productos disponibles</strong>
                <span>Prueba con otro nombre, categoría o código.</span>
            </div>
        `;
    } else {
        filtered.forEach(rawProduct => {
            const p = normalizeInventoryItem(rawProduct);
            const categoryGroup = getInventoryCategoryGroup(p.categoria);
            const isOut = p.stock <= 0;
            const photo = getPOSProductImage(p);
            const div = document.createElement('div');
            div.className = `pos-product-card ${isOut ? 'is-disabled' : ''}`;
            div.innerHTML = `
                <div class="pos-product-img">
                    ${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(p.nombre || 'Producto')}">` : `<i class="fa-solid fa-box"></i>`}
                </div>
                <div class="pos-product-info">
                    <span class="pos-product-name">${escapeHtml(p.nombre || 'Producto')}</span>
                    <span class="pos-product-category">${escapeHtml(categoryGroup)}</span>
                </div>
                <div class="pos-product-meta">
                    <span class="pos-product-price">$${p.precio.toFixed(2)}</span>
                    <span class="pos-product-stock ${isOut ? 'is-out' : ''}">${isOut ? 'Sin stock' : `${p.stock} pz`}</span>
                </div>
                <button type="button" class="pos-add-product-btn" ${isOut ? 'disabled' : ''}>
                    <i class="fa-solid fa-plus"></i> Agregar
                </button>
            `;
            if (!isOut) {
                div.addEventListener('click', () => addToCart(p.id));
                div.querySelector('.pos-add-product-btn')?.addEventListener('click', (event) => {
                    event.stopPropagation();
                    addToCart(p.id);
                });
            }
            grid.appendChild(div);
        });
    }
}

function addToCart(id) {
    const p = normalizeInventoryItem(APP_STATE.inventario.find(prod => prod.id === id));
    if (!p) return;

    const existing = APP_STATE.cart.find(item => item.id === id);
    if (existing) {
        if (existing.qty < p.stock) {
            existing.qty++;
        } else {
            alert('Límite de stock disponible alcanzado.');
        }
    } else {
        APP_STATE.cart.push({
            id: p.id,
            type: 'product',
            nombre: p.nombre,
            precio: p.precio,
            qty: 1
        });
    }
    updateCartUI();
}

function updateCartUI() {
    const list = document.getElementById('pos-cart-list');
    if (!list) return;

    list.innerHTML = '';

    if (APP_STATE.cart.length === 0) {
        list.innerHTML = `
            <div class="empty-cart-message">
                <i class="fa-solid fa-basket-shopping"></i>
                <strong>Carrito vacío</strong>
                <p>Escanea o agrega productos para iniciar la venta.</p>
            </div>
        `;
        document.getElementById('pos-subtotal').innerText = '$0.00';
        document.getElementById('pos-descuento-display').innerText = '$0.00';
        document.getElementById('pos-total').innerText = '$0.00';
        if (typeof recalculatePOSChange === 'function') recalculatePOSChange();
        return;
    }

    let subtotal = 0;
    APP_STATE.cart.forEach(item => {
        const itemTotal = item.precio * item.qty;
        subtotal += itemTotal;
        const product = getPOSCartProduct(item);
        const photo = product ? getPOSProductImage(product) : '';

        const div = document.createElement('div');
        div.className = `pos-cart-item ${item.type === 'repair' ? 'repair-cart-item' : ''}`;
        if (item.type === 'repair') {
            div.innerHTML = `
                <div class="pos-cart-thumb"><i class="fa-solid fa-screwdriver-wrench"></i></div>
                <div class="pos-item-details repair-item-details">
                    <span class="pos-item-name">${escapeHtml(item.nombre)}</span>
                    <span>Cliente: ${escapeHtml(item.cliente || '-')}</span>
                    <span>Equipo: ${escapeHtml(item.equipo || '-')}</span>
                    <span>Total reparacion: $${Number(item.total_reparacion || 0).toFixed(2)}</span>
                    <span>Anticipo: $${Number(item.anticipo || 0).toFixed(2)}</span>
                    <strong>Saldo a pagar: $${Number(item.saldo || item.precio || 0).toFixed(2)}</strong>
                </div>
                <div class="pos-cart-line-actions">
                    <button class="qty-btn danger" onclick="removeCartItem('${item.id}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    <span class="pos-item-total">$${itemTotal.toFixed(2)}</span>
                </div>
            `;
        } else {
            div.innerHTML = `
                <div class="pos-cart-thumb">
                    ${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(item.nombre)}">` : `<i class="fa-solid fa-box"></i>`}
                </div>
                <div class="pos-item-details">
                    <span class="pos-item-name">${escapeHtml(item.nombre)}</span>
                    <span class="pos-item-price">$${item.precio.toFixed(2)} c/u</span>
                </div>
                <div class="pos-item-qty-control">
                    <button class="qty-btn" onclick="changeCartQty(${item.id}, -1)"><i class="fa-solid fa-minus"></i></button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="changeCartQty(${item.id}, 1)"><i class="fa-solid fa-plus"></i></button>
                </div>
                <div class="pos-cart-line-actions">
                    <button class="qty-btn danger" onclick="removeCartItem('${item.id}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    <span class="pos-item-total">$${itemTotal.toFixed(2)}</span>
                </div>
            `;
        }
        list.appendChild(div);
    });

    const subtotalEl = document.getElementById('pos-subtotal');
    const discountEl = document.getElementById('pos-descuento-display');
    const totalEl = document.getElementById('pos-total');
    const discount = getPOSDiscount();
    const total = Math.max(subtotal - discount, 0);
    if (subtotalEl) subtotalEl.innerText = `$${subtotal.toFixed(2)}`;
    if (discountEl) discountEl.innerText = `$${discount.toFixed(2)}`;
    if (totalEl) totalEl.innerText = `$${total.toFixed(2)}`;
    if (typeof recalculatePOSChange === 'function') recalculatePOSChange();
}

function recalculatePOSChange() {
    const changeDisplay = document.getElementById('pos-cambio');
    if (!changeDisplay) return;
    const payment = getPOSPaymentState();
    changeDisplay.innerText = `$${payment.change.toFixed(2)}`;
}

window.changeCartQty = function(id, delta) {
    const item = APP_STATE.cart.find(c => c.id === id);
    if (!item) return;

    if (delta > 0) {
        const p = APP_STATE.inventario.find(prod => prod.id === id);
        if (p && item.qty >= p.stock) {
            alert('Límite de stock disponible alcanzado.');
            return;
        }
    }

    item.qty += delta;
    if (item.qty <= 0) {
        APP_STATE.cart = APP_STATE.cart.filter(c => c.id !== id);
    }
    updateCartUI();
};

window.removeCartItem = function(id) {
    APP_STATE.cart = APP_STATE.cart.filter(item => String(item.id) !== String(id));
    updateCartUI();
};

// ==========================================
// RENDER: CALENDARIO DE ENTREGAS
// ==========================================
let calendarInstance = null;

function renderCalendario() {
    const calendarEl = document.getElementById('full-calendar-container');
    if (!calendarEl) return;
    
    // Preparar eventos para el calendario
    const events = [];
    
    // 1. Agregar Órdenes de Servicio como eventos
    APP_STATE.ordenes.forEach(o => {
        if (o.status === 'Cancelado') return; // Ignorar canceladas
        
        const color = getCalendarStatusColor(o.status);
        
        // Si tiene fecha de entrega
        if (o.estimatedDate) {
            events.push({
                id: 'order-' + o.id,
                title: `[${o.folio}] ${o.clientName} - ${o.brand} ${o.model}`,
                start: o.estimatedDate,
                allDay: true,
                color: color,
                extendedProps: {
                    type: 'order',
                    orderId: o.id
                }
            });
        }
    });
    
    // 2. Agregar Eventos Manuales
    APP_STATE.eventos.forEach(e => {
        const category = e.categoria || e.tipo_evento || 'otro';
        events.push({
            id: 'event-' + e.id,
            title: e.titulo,
            start: e.fecha_inicio,
            end: e.fecha_fin || null,
            color: getManualEventColor(e),
            description: e.descripcion,
            extendedProps: {
                type: 'manual',
                eventId: e.id,
                category,
                description: e.descripcion
            }
        });
    });
    
    if (calendarInstance) {
        calendarInstance.destroy();
    }
    
    calendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'es',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        buttonText: {
            today: 'Hoy',
            month: 'Mes',
            week: 'Semana',
            day: 'Día'
        },
        events: events,
        eventClick: function(info) {
            const props = info.event.extendedProps;
            if (props.type === 'order') {
                // Abrir detalle de la orden
                editOrderDetails(props.orderId);
            } else if (props.type === 'manual') {
                // Abrir edición del evento manual
                openEditEventModal(props.eventId);
            }
        },
        dateClick: function(info) {
            const eventModal = document.getElementById('event-modal');
            let dateVal = info.dateStr;
            if (dateVal.length === 10) {
                dateVal += 'T09:00';
            } else {
                dateVal = dateVal.substring(0, 16);
            }
            resetManualEventModal(dateVal);
            eventModal.classList.remove('hidden');
        }
    });
    
    calendarInstance.render();
}

// ==========================================
// UTILERÍA DE FECHAS PARA REPORTES Y DASHBOARD
// ==========================================
function parseReportDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const normalized = String(value).trim();
    if (!normalized) return null;
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
        return new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
            Number(match[4] || 0),
            Number(match[5] || 0),
            Number(match[6] || 0)
        );
    }
    const parsed = new Date(normalized.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getStartOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function getEndOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function formatDateForInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatReportDate(date) {
    if (!date) return '-';
    return date.toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function getReportDateBounds(range = getActiveReportRange()) {
    const now = new Date();
    let start = getStartOfDay(now);
    let end = getEndOfDay(now);

    if (range === 'week') {
        const day = start.getDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        start = getStartOfDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + mondayOffset));
        end = getEndOfDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
    } else if (range === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        end = getEndOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    } else if (range === 'year') {
        start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        end = getEndOfDay(new Date(now.getFullYear(), 11, 31));
    } else if (range === 'custom') {
        const fromInput = document.getElementById('report-date-from');
        const toInput = document.getElementById('report-date-to');
        const fromDate = parseReportDate(fromInput?.value);
        const toDate = parseReportDate(toInput?.value);
        start = fromDate ? getStartOfDay(fromDate) : getStartOfDay(now);
        end = toDate ? getEndOfDay(toDate) : getEndOfDay(now);
        if (start.getTime() > end.getTime()) {
            const previousStart = start;
            start = getStartOfDay(end);
            end = getEndOfDay(previousStart);
        }
    }

    return { start, end };
}

function isDateInRange(dateStr, range) {
    const itemDate = parseReportDate(dateStr);
    if (!itemDate) return false;
    const { start, end } = getReportDateBounds(range);
    return itemDate.getTime() >= start.getTime() && itemDate.getTime() <= end.getTime();
}

// ==========================================
// RENDER: REPORTES Y ESTADÍSTICAS
// ==========================================
function initReportFilters() {
    const rangeBtns = document.querySelectorAll('.date-filters button');
    const customRange = document.getElementById('report-custom-range');
    const dateFrom = document.getElementById('report-date-from');
    const dateTo = document.getElementById('report-date-to');
    const today = formatDateForInput(new Date());

    if (dateFrom && !dateFrom.value) dateFrom.value = today;
    if (dateTo && !dateTo.value) dateTo.value = today;

    function updateCustomRangeVisibility() {
        const activeRange = getActiveReportRange();
        if (customRange) customRange.classList.toggle('hidden', activeRange !== 'custom');
    }

    rangeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateCustomRangeVisibility();
            renderReportes();
        });
    });

    dateFrom?.addEventListener('change', renderReportes);
    dateTo?.addEventListener('change', renderReportes);
    updateCustomRangeVisibility();
    document.getElementById('btn-print-report')?.addEventListener('click', exportCurrentReport);
}

function getOperationTimestamp(value) {
    const date = value ? new Date(String(value).replace(' ', 'T')) : new Date(0);
    const time = date.getTime();
    return Number.isNaN(time) ? 0 : time;
}

function formatOperationDateTime(value) {
    const timestamp = getOperationTimestamp(value);
    if (!timestamp) return 'Sin fecha';
    return new Date(timestamp).toLocaleString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getActiveReportRange() {
    const activeRangeBtn = document.querySelector('.date-filters button.active');
    return activeRangeBtn ? activeRangeBtn.getAttribute('data-range') : 'day';
}

function getReportRangeLabel(range) {
    const labels = {
        day: 'Hoy',
        week: 'Esta semana',
        month: 'Este mes',
        year: 'Este año'
    };
    if (range === 'custom') {
        const { start, end } = getReportDateBounds(range);
        return `Personalizado: ${formatReportDate(start)} al ${formatReportDate(end)}`;
    }
    return labels[range] || 'Reporte';
}

function toMoneyNumber(value) {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

function getCurrentReportUserLabel() {
    const user = APP_STATE.currentUser || {};
    return user.nombre || user.username || user.email || APP_STATE.currentRole || 'Usuario';
}

function getAllCajaDetails() {
    const cajas = [...(APP_STATE.cajaHistorial || [])];
    if (APP_STATE.cajaActiva && !cajas.some(caja => Number(caja.id) === Number(APP_STATE.cajaActiva.id))) {
        cajas.unshift(APP_STATE.cajaActiva);
    }
    return cajas.filter(Boolean);
}

function getCajaMovementsInRange(range) {
    return getAllCajaDetails().flatMap(caja => (caja.movimientos || []).map(movement => ({
        ...movement,
        caja_id: caja.id,
        caja_fecha_apertura: caja.fecha_apertura,
        caja_fecha_cierre: caja.fecha_cierre
    }))).filter(movement => isDateInRange(movement.fecha, range));
}

function isReportOutgoingType(type = '') {
    const normalized = normalizeText(type);
    return normalized.includes('salida') || normalized.includes('devolucion') || normalized.includes('retiro') || normalized.includes('gasto');
}

function isReportRepairType(type = '') {
    const normalized = normalizeText(type);
    return normalized.includes('reparacion')
        || normalized.includes('liquidacion')
        || normalized.includes('cobro')
        || normalized.includes('anticipo')
        || normalized.includes('abono');
}

function isReportProductType(type = '') {
    return normalizeText(type).includes('venta_pos') || normalizeText(type).includes('producto');
}

function getReportPaymentBreakdown(source = {}) {
    const method = normalizeText(source.metodo_pago || source.method || '');
    const total = toMoneyNumber(source.total ?? source.monto ?? source.amount);
    const cashReceived = toMoneyNumber(source.efectivo_recibido ?? source.monto_recibido);
    const transferReceived = toMoneyNumber(source.transferencia_recibida);
    const change = toMoneyNumber(source.cambio);
    const breakdown = { efectivo: 0, transferencia: 0, tarjeta: 0, mixto: 0 };

    if (method.includes('mixto')) {
        breakdown.efectivo = Math.max(cashReceived - change, 0);
        breakdown.transferencia = Math.max(Math.min(transferReceived, Math.max(total - breakdown.efectivo, 0)), 0);
        breakdown.tarjeta = Math.max(total - breakdown.efectivo - breakdown.transferencia, 0);
        breakdown.mixto = total;
    } else if (method.includes('transfer')) {
        breakdown.transferencia = total;
    } else if (method.includes('tarjeta')) {
        breakdown.tarjeta = total;
    } else {
        breakdown.efectivo = total;
    }

    return breakdown;
}

function getVentaItems(venta = {}) {
    return venta.items || venta.detalles || venta.detalle || [];
}

function isRepairSaleItem(item = {}) {
    const text = normalizeText(`${item.tipo_item || item.tipo || ''} ${item.nombre || ''} ${item.descripcion || ''}`);
    return text.includes('reparacion') || text.includes('orden') || Boolean(item.orden_id);
}

function getInventoryItemCost(item = {}) {
    const inventory = APP_STATE.inventario.find(product => Number(product.id) === Number(item.producto_id));
    return toMoneyNumber(item.costo ?? item.costo_unitario ?? inventory?.costo ?? 0);
}

function getOrderByIdOrFolio(item = {}, venta = {}) {
    const itemText = `${item.orden_id || ''} ${item.folio || ''} ${item.orden_folio || ''} ${item.descripcion || ''} ${item.nombre || ''} ${venta.folio || ''}`;
    return APP_STATE.ordenes.find(order => (
        Number(order.id) === Number(item.orden_id)
        || (order.folio && itemText.includes(order.folio))
    ));
}

function getMovementReference(movement = {}) {
    if (movement.referencia_id) return `${movement.referencia_tipo || 'Ref.'} #${movement.referencia_id}`;
    const match = String(movement.descripcion || '').match(/#?([A-Z]{2,}-\d{4}-\d+|\d{1,})/i);
    return match ? match[0] : '-';
}

function buildReportData(range = getActiveReportRange()) {
    let totalIngresos = 0;
    let totalGastos = 0;
    let ingresosReparaciones = 0;
    let ingresosPos = 0;
    let descuentos = 0;
    const paymentTotals = { efectivo: 0, transferencia: 0, tarjeta: 0, mixto: 0 };
    let repairsCount = 0;
    let salesCount = 0;
    const operations = [];
    const expenses = [];
    const cajaMovements = getCajaMovementsInRange(range);
    const saleIdsWithCajaMovement = new Set(cajaMovements
        .filter(movement => movement.referencia_tipo === 'venta' && movement.referencia_id)
        .map(movement => String(movement.referencia_id)));
    const repairSaleIdsWithCajaMovement = new Set(cajaMovements
        .filter(movement => movement.referencia_tipo === 'venta' && movement.referencia_id && isReportRepairType(movement.tipo_movimiento))
        .map(movement => String(movement.referencia_id)));
    const orderFoliosWithCajaMovement = new Set();

    cajaMovements.forEach(movement => {
        const description = String(movement.descripcion || '');
        const folioMatch = description.match(/[A-Z]{2,}-\d{4}-\d+/i);
        if (folioMatch) orderFoliosWithCajaMovement.add(folioMatch[0]);
    });

    APP_STATE.ventas.forEach(v => {
        if (!isDateInRange(v.fecha, range)) return;
        const revenue = toMoneyNumber(v.total);
        let expense = 0;
        let repairRevenue = 0;
        let productRevenue = 0;
        const items = getVentaItems(v);
        const hasRepairItems = items.some(isRepairSaleItem);
        const isRepairSale = hasRepairItems || repairSaleIdsWithCajaMovement.has(String(v.id)) || normalizeText(v.observaciones_ticket).includes('reparacion');

        items.forEach(item => {
            const quantity = toMoneyNumber(item.cantidad || 1);
            const itemSubtotal = toMoneyNumber(item.subtotal || (quantity * toMoneyNumber(item.precio_unitario)));
            const order = getOrderByIdOrFolio(item, v);
            const itemExpense = isRepairSaleItem(item)
                ? toMoneyNumber(order?.costo_refaccion || 0)
                : quantity * getInventoryItemCost(item);
            expense += itemExpense;
            if (isRepairSaleItem(item)) {
                repairRevenue += itemSubtotal;
            } else {
                productRevenue += itemSubtotal;
            }
        });

        if (!items.length || (repairRevenue + productRevenue) === 0) {
            if (isRepairSale) repairRevenue = revenue;
            else productRevenue = revenue;
        }

        const profit = revenue - expense;
        const payment = getReportPaymentBreakdown(v);

        descuentos += toMoneyNumber(v.descuento);
        paymentTotals.efectivo += payment.efectivo;
        paymentTotals.transferencia += payment.transferencia;
        paymentTotals.tarjeta += payment.tarjeta;
        paymentTotals.mixto += payment.mixto;
        totalIngresos += revenue;
        totalGastos += expense;
        ingresosReparaciones += repairRevenue;
        ingresosPos += productRevenue;
        if (repairRevenue > 0 || isRepairSale) repairsCount++;
        if (productRevenue > 0 || !isRepairSale) salesCount++;

        if (expense > 0) {
            expenses.push({
                timestamp: getOperationTimestamp(v.fecha),
                dateLabel: formatOperationDateTime(v.fecha),
                concept: isRepairSale ? `Refacciones usadas en venta #${v.id}` : `Costo de productos vendidos #${v.id}`,
                amount: expense,
                user: v.usuario_nombre || v.operador || '-',
                notes: isRepairSale ? 'Costo asociado a reparación' : 'Costo de inventario vendido'
            });
        }

        operations.push({
            timestamp: getOperationTimestamp(v.fecha),
            dateLabel: formatOperationDateTime(v.fecha),
            concept: `${isRepairSale ? 'Reparación' : 'Venta POS'} #${v.id}`,
            typeLabel: isRepairSale ? 'Reparación' : 'Venta',
            badgeClass: isRepairSale ? 'bg-success' : 'bg-primary',
            revenue,
            expense,
            profit,
            operator: v.usuario_nombre || v.operador || 'Cajero System'
        });
    });

    cajaMovements.forEach(movement => {
        const amount = toMoneyNumber(movement.monto);
        const outgoing = isReportOutgoingType(movement.tipo_movimiento);
        const type = normalizeText(movement.tipo_movimiento);
        const alreadyCountedSale = movement.referencia_tipo === 'venta' && saleIdsWithCajaMovement.has(String(movement.referencia_id));
        const movementIsIncome = !outgoing && type !== 'apertura';

        if (movementIsIncome && !alreadyCountedSale && !type.includes('venta_pos') && !type.includes('liquidacion')) {
            totalIngresos += amount;
            if (isReportRepairType(type)) ingresosReparaciones += amount;
            if (isReportProductType(type)) ingresosPos += amount;
            const payment = getReportPaymentBreakdown({ ...movement, total: amount });
            paymentTotals.efectivo += payment.efectivo;
            paymentTotals.transferencia += payment.transferencia;
            paymentTotals.tarjeta += payment.tarjeta;
            paymentTotals.mixto += payment.mixto;
            operations.push({
                timestamp: getOperationTimestamp(movement.fecha),
                dateLabel: formatOperationDateTime(movement.fecha),
                concept: cajaTypeLabel(movement.tipo_movimiento),
                typeLabel: isReportRepairType(type) ? 'Reparación' : 'Entrada',
                badgeClass: isReportRepairType(type) ? 'bg-success' : 'bg-info',
                revenue: amount,
                expense: 0,
                profit: amount,
                operator: movement.usuario_nombre || '-'
            });
            if (isReportRepairType(type)) repairsCount++;
        }

        if (outgoing) {
            totalGastos += amount;
            expenses.push({
                timestamp: getOperationTimestamp(movement.fecha),
                dateLabel: formatOperationDateTime(movement.fecha),
                concept: cajaTypeLabel(movement.tipo_movimiento),
                amount,
                user: movement.usuario_nombre || '-',
                notes: movement.descripcion || '-'
            });
        }
    });

    APP_STATE.ordenes.forEach(o => {
        const operationDate = o.pagado_en || o.fecha_entrega_real || o.fecha_actualizacion || o.dateIn;
        if (!isDateInRange(operationDate, range)) return;
        if (o.folio && orderFoliosWithCajaMovement.has(o.folio)) return;
        const status = normalizeText(o.status || o.estado || '');
        const appearsPaid = status.includes('entregado') || status.includes('terminado') || status.includes('pagado') || o.pagado_en;
        if (!appearsPaid) return;

        const revenue = toMoneyNumber(o.costo_real ?? o.costo_estimado);
        if (revenue <= 0) return;
        const expense = toMoneyNumber(o.costo_refaccion);
        const profit = revenue - expense;
        totalIngresos += revenue;
        totalGastos += expense;
        ingresosReparaciones += revenue;
        repairsCount++;

        if (expense > 0) {
            expenses.push({
                timestamp: getOperationTimestamp(operationDate),
                dateLabel: formatOperationDateTime(operationDate),
                concept: `Refacciones usadas en ${o.folio}`,
                amount: expense,
                user: o.technicianName || o.tecnicoAsignado || '-',
                notes: `${o.brand || o.marca || ''} ${o.model || o.modelo || ''}`.trim() || '-'
            });
        }

        operations.push({
            timestamp: getOperationTimestamp(operationDate),
            dateLabel: formatOperationDateTime(operationDate),
            concept: `Reparación: ${o.folio} (${[o.brand || o.marca, o.model || o.modelo].filter(Boolean).join(' ') || 'Equipo'})`,
            typeLabel: 'Reparación',
            badgeClass: 'bg-success',
            revenue,
            expense,
            profit,
            operator: o.technicianName || o.tecnicoAsignado || 'Admin System'
        });
    });

    const cashCuts = getAllCajaDetails()
        .filter(caja => isDateInRange(caja.fecha_cierre || caja.fecha_apertura, range))
        .sort((a, b) => getOperationTimestamp(b.fecha_cierre || b.fecha_apertura) - getOperationTimestamp(a.fecha_cierre || a.fecha_apertura));

    const cashSummary = cashCuts.reduce((summary, caja) => {
        const resumen = caja.resumen || {};
        summary.initial += toMoneyNumber(caja.monto_inicial ?? resumen.fondo_inicial);
        summary.inflows += toMoneyNumber(resumen.total_ingresos);
        summary.outflows += toMoneyNumber(resumen.total_salidas);
        summary.expected += toMoneyNumber(caja.total_esperado ?? resumen.total_esperado);
        summary.counted += toMoneyNumber(caja.monto_contado);
        summary.difference += toMoneyNumber(caja.diferencia);
        return summary;
    }, { initial: 0, inflows: 0, outflows: 0, expected: 0, counted: 0, difference: 0 });

    if (!cashCuts.length && APP_STATE.cajaActiva && isDateInRange(APP_STATE.cajaActiva.fecha_apertura, range)) {
        const resumen = APP_STATE.cajaActiva.resumen || {};
        cashSummary.initial = toMoneyNumber(APP_STATE.cajaActiva.monto_inicial ?? resumen.fondo_inicial);
        cashSummary.inflows = toMoneyNumber(resumen.total_ingresos);
        cashSummary.outflows = toMoneyNumber(resumen.total_salidas);
        cashSummary.expected = toMoneyNumber(APP_STATE.cajaActiva.total_esperado ?? resumen.total_esperado);
        cashSummary.counted = toMoneyNumber(APP_STATE.cajaActiva.monto_contado);
        cashSummary.difference = toMoneyNumber(APP_STATE.cajaActiva.diferencia);
    }

    let runningTotal = 0;
    const movements = cajaMovements
        .slice()
        .sort((a, b) => getOperationTimestamp(a.fecha) - getOperationTimestamp(b.fecha))
        .map(movement => {
            const amount = toMoneyNumber(movement.monto);
            const outgoing = isReportOutgoingType(movement.tipo_movimiento);
            const entrada = outgoing || normalizeText(movement.tipo_movimiento) === 'apertura' ? 0 : amount;
            const salida = outgoing ? amount : 0;
            runningTotal += entrada - salida;
            return {
                timestamp: getOperationTimestamp(movement.fecha),
                dateLabel: formatOperationDateTime(movement.fecha),
                typeLabel: cajaTypeLabel(movement.tipo_movimiento),
                reference: getMovementReference(movement),
                method: cajaMethodLabel(movement.metodo_pago),
                description: movement.descripcion || '-',
                entrada,
                salida,
                total: runningTotal,
                user: movement.usuario_nombre || '-'
            };
        });

    operations.sort((a, b) => b.timestamp - a.timestamp);
    expenses.sort((a, b) => b.timestamp - a.timestamp);
    return {
        range,
        rangeLabel: getReportRangeLabel(range),
        bounds: getReportDateBounds(range),
        generatedAt: new Date(),
        generatedBy: getCurrentReportUserLabel(),
        businessName: ESTABLISHMENT_CONFIG.name || 'AllFix Bacalar',
        logoUrl: getBusinessLogoUrl(),
        operations,
        totalIngresos,
        totalGastos,
        totalRefacciones: totalGastos,
        totalProfit: totalIngresos - totalGastos,
        ingresosReparaciones,
        ingresosPos,
        paymentTotals,
        descuentos,
        expenses,
        cashCuts,
        cashSummary,
        movements,
        repairsCount,
        salesCount
    };
}

function setReportText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function renderFinancialEmptyRow(tbody, colspan, message) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="financial-empty-row">${escapeHtml(message)}</td></tr>`;
}

function renderReportExpenses(report) {
    const tbody = document.querySelector('#report-expenses-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!report.expenses.length) {
        renderFinancialEmptyRow(tbody, 5, 'Sin gastos registrados en el rango seleccionado.');
        return;
    }
    report.expenses.forEach(expense => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(expense.dateLabel)}</td>
            <td>${escapeHtml(expense.concept)}</td>
            <td class="text-right financial-money-out">${formatCurrency(expense.amount)}</td>
            <td>${escapeHtml(expense.user)}</td>
            <td>${escapeHtml(expense.notes)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderReportCashCuts(report) {
    const tbody = document.querySelector('#report-cashcut-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!report.cashCuts.length) {
        renderFinancialEmptyRow(tbody, 9, 'Sin cortes cerrados en el rango seleccionado.');
        return;
    }
    report.cashCuts.forEach(caja => {
        const resumen = caja.resumen || {};
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(formatOperationDateTime(caja.fecha_cierre || caja.fecha_apertura))}</td>
            <td>${escapeHtml(caja.usuario_nombre || '-')}</td>
            <td class="text-right">${formatCurrency(caja.monto_inicial ?? resumen.fondo_inicial)}</td>
            <td class="text-right financial-money-in">${formatCurrency(resumen.total_ingresos)}</td>
            <td class="text-right financial-money-out">${formatCurrency(resumen.total_salidas)}</td>
            <td class="text-right">${formatCurrency(caja.total_esperado ?? resumen.total_esperado)}</td>
            <td class="text-right">${caja.monto_contado === null || caja.monto_contado === undefined ? '-' : formatCurrency(caja.monto_contado)}</td>
            <td class="text-right ${toMoneyNumber(caja.diferencia) < 0 ? 'financial-money-out' : 'financial-money-in'}">${formatCurrency(caja.diferencia)}</td>
            <td><span class="financial-status ${cajaResultClass(caja)}">${escapeHtml(cajaResultLabel(caja.resultado))}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderReportMovements(report) {
    const tbody = document.querySelector('#report-movements-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!report.movements.length) {
        renderFinancialEmptyRow(tbody, 8, 'Sin movimientos financieros registrados en el rango seleccionado.');
        return;
    }
    report.movements.forEach(movement => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(movement.dateLabel)}</td>
            <td>${escapeHtml(movement.typeLabel)}</td>
            <td>${escapeHtml(movement.reference)}</td>
            <td>${escapeHtml(movement.method)}</td>
            <td>${escapeHtml(movement.description)}</td>
            <td class="text-right financial-money-in">${movement.entrada ? formatCurrency(movement.entrada) : '-'}</td>
            <td class="text-right financial-money-out">${movement.salida ? formatCurrency(movement.salida) : '-'}</td>
            <td class="text-right">${formatCurrency(movement.total)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderReportes() {
    const tableBody = document.querySelector('#reportes-details-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const report = buildReportData();
    const logo = document.getElementById('financial-report-logo');
    if (logo) logo.src = report.logoUrl;

    setReportText('financial-report-business', report.businessName);
    setReportText('financial-report-generated', report.generatedAt.toLocaleString('es-MX'));
    setReportText('financial-report-range', report.rangeLabel);
    setReportText('financial-report-user', report.generatedBy);

    if (report.operations.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-muted text-center">Sin operaciones en el rango seleccionado.</td></tr>';
    }

    report.operations
        .forEach(operation => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
            <td>${operation.dateLabel}</td>
            <td><strong>${operation.concept}</strong></td>
            <td><span class="badge ${operation.badgeClass}">${operation.typeLabel}</span></td>
            <td class="text-right">${formatCurrency(operation.revenue)}</td>
            <td class="admin-only text-right">${formatCurrency(operation.expense)}</td>
            <td class="admin-only text-right indicator-profit">${formatCurrency(operation.profit)}</td>
            <td>${escapeHtml(operation.operator)}</td>
        `;
        tableBody.appendChild(tr);
    });

    // Rellenar paneles
    setReportText('rep-ingresos', formatCurrency(report.totalIngresos));
    setReportText('rep-gastos', formatCurrency(report.totalGastos));
    setReportText('rep-ganancias', formatCurrency(report.totalProfit));
    setReportText('rep-caja-inicial', formatCurrency(report.cashSummary.initial));
    setReportText('rep-caja-esperado', formatCurrency(report.cashSummary.expected));
    setReportText('rep-caja-diferencia', formatCurrency(report.cashSummary.difference));
    setReportText('rep-reparaciones', report.repairsCount);
    setReportText('rep-ventas', report.salesCount);
    setReportText('rep-ingresos-reparaciones', formatCurrency(report.ingresosReparaciones));
    setReportText('rep-ingresos-pos', formatCurrency(report.ingresosPos));
    setReportText('rep-pagos-efectivo', formatCurrency(report.paymentTotals.efectivo));
    setReportText('rep-pagos-transferencia', formatCurrency(report.paymentTotals.transferencia));
    setReportText('rep-pagos-tarjeta', formatCurrency(report.paymentTotals.tarjeta));
    setReportText('rep-pagos-mixtos', formatCurrency(report.paymentTotals.mixto));
    setReportText('rep-descuentos', formatCurrency(report.descuentos));

    renderReportExpenses(report);
    renderReportCashCuts(report);
    renderReportMovements(report);

    // Si es Admin, mostrar valores completos en el dashboard
    if (APP_STATE.currentRole === 'Administrador') {
        document.getElementById('dash-sales-day').innerText = formatCurrency(report.totalIngresos);
        document.getElementById('dash-sales-month').innerText = formatCurrency(report.totalIngresos);
        document.getElementById('dash-profit-month').innerText = formatCurrency(report.totalProfit);
    }

    applyRolePermissions();
}

function sanitizePdfText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, '')
        .trim();
}

function escapePdfText(value) {
    return sanitizePdfText(value)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function truncatePdfText(value, maxLength) {
    const text = sanitizePdfText(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function pdfTextLine(text, x, y, size = 9, font = 'F1') {
    return `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET\n`;
}

function buildPdfDocument(pageContents) {
    const objects = [];
    const pageRefs = [];

    objects.push('');
    objects.push('');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    pageContents.forEach(content => {
        const contentRef = objects.length + 1;
        objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
        const pageRef = objects.length + 1;
        pageRefs.push(pageRef);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentRef} 0 R >>`);
    });

    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    offsets.slice(1).forEach(offset => {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new Blob([pdf], { type: 'application/pdf' });
}

function buildReportPdf(report) {
    const isAdmin = APP_STATE.currentRole === 'Administrador';
    const pageWidth = 842;
    const pageHeight = 595;
    const margin = 34;
    const rowHeight = 20;
    const tableBottom = 42;
    const pageContents = [];
    const columns = isAdmin
        ? [
            { label: 'Fecha / Hora', x: margin, width: 86, max: 18 },
            { label: 'Concepto / Folio', x: 124, width: 266, max: 48 },
            { label: 'Tipo', x: 398, width: 72, max: 13 },
            { label: 'Monto', x: 476, width: 70, max: 12 },
            { label: 'Refaccion', x: 550, width: 78, max: 12 },
            { label: 'Ganancia', x: 632, width: 76, max: 12 },
            { label: 'Operador', x: 714, width: 94, max: 16 }
        ]
        : [
            { label: 'Fecha / Hora', x: margin, width: 90, max: 18 },
            { label: 'Concepto / Folio', x: 132, width: 380, max: 64 },
            { label: 'Tipo', x: 520, width: 80, max: 14 },
            { label: 'Monto', x: 608, width: 82, max: 12 },
            { label: 'Operador', x: 700, width: 110, max: 20 }
        ];

    let content = '';
    let y = pageHeight - margin;
    let pageNumber = 1;

    function addText(text, x, size = 9, lineGap = 14) {
        content += pdfTextLine(text, x, y, size);
        y -= lineGap;
    }

    function drawTableHeader() {
        content += '0.93 0.95 0.98 rg\n';
        content += `${margin - 4} ${y - 13} ${pageWidth - margin * 2 + 8} 20 re f\n`;
        content += '0 0 0 rg\n';
        columns.forEach(column => {
            content += pdfTextLine(column.label, column.x, y - 7, 8);
        });
        y -= 24;
    }

    function finishPage() {
        content += pdfTextLine(`Pagina ${pageNumber}`, pageWidth - margin - 62, 22, 8);
        pageContents.push(content);
        content = '';
        pageNumber += 1;
        y = pageHeight - margin;
    }

    function startPage(includeSummary = false) {
        content += pdfTextLine('Reporte financiero AllFix Bacalar', margin, y, 16);
        content += pdfTextLine(`Rango: ${report.rangeLabel}`, pageWidth - margin - 150, y, 9);
        y -= 20;
        content += pdfTextLine(`Generado: ${report.generatedAt.toLocaleString('es-MX')}`, margin, y, 9);
        y -= 20;

        if (includeSummary) {
            addText('Resumen', margin, 11, 16);
            addText(`Ingresos totales: $${report.totalIngresos.toFixed(2)}`, margin);
            if (isAdmin) {
                addText(`Gastos refacciones: $${report.totalRefacciones.toFixed(2)}`, margin);
                addText(`Ganancia neta: $${report.totalProfit.toFixed(2)}`, margin);
            }
            addText(`Reparaciones completadas: ${report.repairsCount}`, margin);
            addText(`Ventas realizadas: ${report.salesCount}`, margin, 9, 20);
        }

        drawTableHeader();
    }

    startPage(true);

    report.operations.forEach(operation => {
        if (y < tableBottom) {
            finishPage();
            startPage(false);
        }

        content += '0.86 0.89 0.94 RG\n';
        content += `${margin - 4} ${y - 7} ${pageWidth - margin * 2 + 8} 0.5 re S\n`;

        const values = isAdmin
            ? [
                operation.dateLabel,
                operation.concept,
                operation.typeLabel,
                `$${operation.revenue.toFixed(2)}`,
                `$${operation.expense.toFixed(2)}`,
                `$${operation.profit.toFixed(2)}`,
                operation.operator
            ]
            : [
                operation.dateLabel,
                operation.concept,
                operation.typeLabel,
                `$${operation.revenue.toFixed(2)}`,
                operation.operator
            ];

        values.forEach((value, index) => {
            const column = columns[index];
            content += pdfTextLine(truncatePdfText(value, column.max), column.x, y, 8);
        });
        y -= rowHeight;
    });

    finishPage();
    return buildPdfDocument(pageContents);
}

function buildPrintableFinancialTable(headers, rows, emptyMessage) {
    const headerHtml = headers.map(header => `<th>${escapeHtml(header)}</th>`).join('');
    const rowsHtml = rows.length
        ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${headers.length}" class="empty">${escapeHtml(emptyMessage)}</td></tr>`;
    return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function buildPrintableReportHtml(report) {
    const expensesRows = report.expenses.map(expense => [
        escapeHtml(expense.dateLabel),
        escapeHtml(expense.concept),
        `<strong>${formatCurrency(expense.amount)}</strong>`,
        escapeHtml(expense.user),
        escapeHtml(expense.notes)
    ]);
    const cashRows = report.cashCuts.map(caja => {
        const resumen = caja.resumen || {};
        return [
            escapeHtml(formatOperationDateTime(caja.fecha_cierre || caja.fecha_apertura)),
            escapeHtml(caja.usuario_nombre || '-'),
            formatCurrency(caja.monto_inicial ?? resumen.fondo_inicial),
            formatCurrency(resumen.total_ingresos),
            formatCurrency(resumen.total_salidas),
            formatCurrency(caja.total_esperado ?? resumen.total_esperado),
            caja.monto_contado === null || caja.monto_contado === undefined ? '-' : formatCurrency(caja.monto_contado),
            formatCurrency(caja.diferencia),
            escapeHtml(cajaResultLabel(caja.resultado))
        ];
    });
    const movementRows = report.movements.map(movement => [
        escapeHtml(movement.dateLabel),
        escapeHtml(movement.typeLabel),
        escapeHtml(movement.reference),
        escapeHtml(movement.method),
        escapeHtml(movement.description),
        movement.entrada ? `<strong>${formatCurrency(movement.entrada)}</strong>` : '-',
        movement.salida ? `<strong>${formatCurrency(movement.salida)}</strong>` : '-',
        formatCurrency(movement.total)
    ]);
    const operationRows = report.operations.map(operation => [
        escapeHtml(operation.dateLabel),
        escapeHtml(operation.concept),
        escapeHtml(operation.typeLabel),
        `<strong>${formatCurrency(operation.revenue)}</strong>`,
        formatCurrency(operation.expense),
        formatCurrency(operation.profit),
        escapeHtml(operation.operator)
    ]);

    return `
        <header class="report-header">
            <div class="brand">
                <img src="${escapeHtml(report.logoUrl)}" alt="AllFix Bacalar">
                <div>
                    <h1>${escapeHtml(report.businessName)}</h1>
                    <p>Reporte financiero</p>
                </div>
            </div>
            <div class="meta">
                <p><strong>Generado:</strong> ${escapeHtml(report.generatedAt.toLocaleString('es-MX'))}</p>
                <p><strong>Rango:</strong> ${escapeHtml(report.rangeLabel)}</p>
                <p><strong>Usuario:</strong> ${escapeHtml(report.generatedBy)}</p>
            </div>
        </header>

        <section class="summary-grid">
            <article><span>Total ingresos</span><strong>${formatCurrency(report.totalIngresos)}</strong></article>
            <article><span>Total gastos</span><strong>${formatCurrency(report.totalGastos)}</strong></article>
            <article><span>Ganancia neta</span><strong>${formatCurrency(report.totalProfit)}</strong></article>
            <article><span>Caja inicial</span><strong>${formatCurrency(report.cashSummary.initial)}</strong></article>
            <article><span>Caja esperada</span><strong>${formatCurrency(report.cashSummary.expected)}</strong></article>
            <article><span>Diferencia caja</span><strong>${formatCurrency(report.cashSummary.difference)}</strong></article>
            <article><span>Órdenes cobradas</span><strong>${report.repairsCount}</strong></article>
            <article><span>Ventas POS</span><strong>${report.salesCount}</strong></article>
        </section>

        <section>
            <h2>Detalle de ingresos</h2>
            <div class="breakdown">
                <p><span>Reparaciones</span><strong>${formatCurrency(report.ingresosReparaciones)}</strong></p>
                <p><span>Ventas punto de venta</span><strong>${formatCurrency(report.ingresosPos)}</strong></p>
                <p><span>Efectivo</span><strong>${formatCurrency(report.paymentTotals.efectivo)}</strong></p>
                <p><span>Transferencia</span><strong>${formatCurrency(report.paymentTotals.transferencia)}</strong></p>
                <p><span>Tarjeta</span><strong>${formatCurrency(report.paymentTotals.tarjeta)}</strong></p>
                <p><span>Pagos mixtos</span><strong>${formatCurrency(report.paymentTotals.mixto)}</strong></p>
                <p><span>Descuentos</span><strong>${formatCurrency(report.descuentos)}</strong></p>
            </div>
        </section>

        <section>
            <h2>Detalle de gastos</h2>
            ${buildPrintableFinancialTable(['Fecha', 'Concepto', 'Monto', 'Usuario', 'Observaciones'], expensesRows, 'Sin gastos registrados.')}
        </section>

        <section>
            <h2>Corte de caja</h2>
            ${buildPrintableFinancialTable(['Fecha', 'Usuario', 'Inicial', 'Entradas', 'Salidas', 'Esperado', 'Contado', 'Diferencia', 'Estado'], cashRows, 'Sin cortes cerrados.')}
        </section>

        <section>
            <h2>Movimientos financieros</h2>
            ${buildPrintableFinancialTable(['Fecha', 'Tipo', 'Referencia', 'Método', 'Descripción', 'Entrada', 'Salida', 'Total'], movementRows, 'Sin movimientos registrados.')}
        </section>

        <section>
            <h2>Operaciones del periodo</h2>
            ${buildPrintableFinancialTable(['Fecha', 'Concepto', 'Tipo', 'Monto', 'Costo', 'Ganancia', 'Operador'], operationRows, 'Sin operaciones registradas.')}
        </section>
    `;
}

function getPrintableReportStyles() {
    return `
        @page { size: letter; margin: 12mm; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: Arial, Helvetica, sans-serif;
            color: #172033;
            background: #ffffff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .report-page { width: 100%; }
        .report-header {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            padding-bottom: 18px;
            border-bottom: 3px solid #2563eb;
            margin-bottom: 18px;
        }
        .brand { display: flex; align-items: center; gap: 14px; }
        .brand img {
            width: 68px;
            height: 68px;
            object-fit: contain;
            border: 1px solid #d8e0ee;
            border-radius: 10px;
            padding: 6px;
        }
        h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
        h2 { margin: 22px 0 10px; font-size: 14px; color: #0f172a; }
        p { margin: 0; }
        .brand p { margin-top: 4px; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 12px; }
        .meta { min-width: 235px; font-size: 11px; color: #475569; line-height: 1.7; text-align: right; }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 18px;
        }
        .summary-grid article {
            border: 1px solid #d8e0ee;
            border-left: 4px solid #2563eb;
            border-radius: 8px;
            padding: 10px;
            background: #f8fafc;
            min-height: 62px;
        }
        .summary-grid span,
        .breakdown span {
            display: block;
            color: #64748b;
            font-size: 10px;
            text-transform: uppercase;
            font-weight: 700;
        }
        .summary-grid strong {
            display: block;
            margin-top: 6px;
            font-size: 17px;
        }
        .breakdown {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px 18px;
            border: 1px solid #d8e0ee;
            border-radius: 8px;
            padding: 12px;
        }
        .breakdown p {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding-bottom: 7px;
            border-bottom: 1px solid #edf2f7;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            page-break-inside: auto;
        }
        tr { page-break-inside: avoid; page-break-after: auto; }
        th {
            background: #eaf1ff;
            color: #1e3a8a;
            text-align: left;
            font-size: 9px;
            text-transform: uppercase;
            padding: 8px 7px;
            border: 1px solid #cad6ea;
        }
        td {
            padding: 7px;
            border: 1px solid #d8e0ee;
            vertical-align: top;
        }
        tbody tr:nth-child(even) td { background: #f8fafc; }
        .empty { text-align: center; color: #64748b; padding: 14px; }
        @media print {
            body { width: auto; min-width: 0; }
            .report-page { page-break-after: auto; }
        }
    `;
}

function openPrintableReport(report) {
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
        alert('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para exportar el reporte.');
        return;
    }
    const baseHref = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}`;

    printWindow.document.open();
    printWindow.document.write(`
        <!doctype html>
        <html lang="es">
        <head>
            <meta charset="utf-8">
            <base href="${escapeHtml(baseHref)}">
            <title>Reporte financiero ${escapeHtml(report.rangeLabel)}</title>
            <style>${getPrintableReportStyles()}</style>
        </head>
        <body>
            <main class="report-page">${buildPrintableReportHtml(report)}</main>
            <script>
                window.addEventListener('load', function() {
                    setTimeout(function() {
                        window.focus();
                        window.print();
                    }, 350);
                });
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function getFinancialPdfDayjs(value = new Date()) {
    const dayjsLib = window.dayjs;
    if (!dayjsLib) return null;
    if (typeof dayjsLib.locale === 'function') dayjsLib.locale('es');
    const normalized = typeof value === 'string' ? value.replace(' ', 'T') : value;
    const parsed = dayjsLib(normalized);
    return parsed.isValid() ? parsed : null;
}

function formatFinancialPdfDate(value) {
    const parsed = getFinancialPdfDayjs(value);
    return parsed ? parsed.format('DD/MM/YYYY') : String(value || '-');
}

function formatFinancialPdfDateTime(value) {
    const parsed = getFinancialPdfDayjs(value);
    return parsed ? parsed.format('DD/MM/YYYY HH:mm') : String(value || '-');
}

function getFinancialPdfPeriodLabel(report) {
    const labels = {
        day: 'Hoy',
        week: 'Esta semana',
        month: 'Este mes',
        year: 'Este año',
        custom: 'Personalizado'
    };
    return labels[report.range] || report.rangeLabel || 'Reporte';
}

function getFinancialPdfRangeText(report) {
    const start = report.bounds?.start;
    const end = report.bounds?.end;
    if (start && end) return `${formatFinancialPdfDate(start)} al ${formatFinancialPdfDate(end)}`;
    return report.rangeLabel || '-';
}

function formatFinancialPdfCurrency(value) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2
    }).format(toMoneyNumber(value));
}

function formatFinancialPdfPercent(value) {
    const numeric = Number(value || 0);
    return `${Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0'}%`;
}

function getFinancialPdfFilename(report) {
    const stamp = getFinancialPdfDayjs(report.generatedAt)?.format('YYYY-MM-DD_HH-mm') || new Date().toISOString().slice(0, 16).replace(':', '-');
    return `reporte-financiero-allfix-${report.range}-${stamp}.pdf`;
}

function getFinancialPdfCajaStatus(report) {
    const diff = toMoneyNumber(report.cashSummary?.difference);
    if (!report.cashCuts?.length && APP_STATE.cajaActiva) return 'Caja abierta';
    if (diff > 0) return 'Con sobrante';
    if (diff < 0) return 'Con faltante';
    return 'Correcto';
}

function getFinancialPdfPercentage(value, total) {
    const base = toMoneyNumber(total);
    if (base <= 0) return 0;
    return (toMoneyNumber(value) / base) * 100;
}

function getFinancialPdfLibraries() {
    const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
    const autoTable = window.jspdfAutoTable?.autoTable || window.autoTable;
    return { jsPDF, autoTable };
}

function runFinancialAutoTable(doc, options) {
    const { autoTable } = getFinancialPdfLibraries();
    if (typeof doc.autoTable === 'function') {
        doc.autoTable(options);
        return;
    }
    if (typeof autoTable === 'function') {
        autoTable(doc, options);
        return;
    }
    throw new Error('jspdf-autotable no está disponible.');
}

function getFinancialPdfPageSize(doc) {
    return {
        width: doc.internal.pageSize.getWidth(),
        height: doc.internal.pageSize.getHeight()
    };
}

function getFinancialPdfY(doc, fallback = 30) {
    return doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 10 : fallback;
}

function getFinancialPdfTableTheme() {
    return {
        styles: {
            font: 'helvetica',
            fontSize: 8,
            cellPadding: 2.2,
            overflow: 'linebreak',
            lineColor: [214, 224, 238],
            lineWidth: 0.2,
            textColor: [15, 23, 42]
        },
        headStyles: {
            fillColor: [232, 241, 255],
            textColor: [30, 64, 175],
            fontStyle: 'bold'
        },
        alternateRowStyles: {
            fillColor: [248, 250, 252]
        },
        margin: { top: 28, right: 14, bottom: 20, left: 14 },
        tableLineColor: [214, 224, 238],
        tableLineWidth: 0.2,
        showHead: 'everyPage'
    };
}

function addFinancialPdfSectionTitle(doc, title, subtitle = '') {
    const y = getFinancialPdfY(doc, 32);
    const { width } = getFinancialPdfPageSize(doc);
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(14, y - 6, width - 28, 12, 2, 2, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(title, 18, y + 1);
    if (subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(subtitle, width - 18, y + 1, { align: 'right' });
    }
    return y + 12;
}

function addFinancialPdfHeaderFooter(doc, report, logoDataUrl) {
    const pageCount = doc.internal.getNumberOfPages();
    const periodLabel = getFinancialPdfPeriodLabel(report);
    const rangeText = getFinancialPdfRangeText(report);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        doc.setPage(pageNumber);
        const { width, height } = getFinancialPdfPageSize(doc);

        if (pageNumber > 1) {
            doc.setFillColor(255, 255, 255);
            doc.rect(0, 0, width, 22, 'F');
            if (logoDataUrl) {
                doc.addImage(logoDataUrl, 'PNG', 14, 6, 10, 10);
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(15, 23, 42);
            doc.text(report.businessName, logoDataUrl ? 28 : 14, 11);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text(`Reporte financiero | ${periodLabel}`, width - 14, 9, { align: 'right' });
            doc.text(`Del ${rangeText}`, width - 14, 15, { align: 'right' });
            doc.setDrawColor(214, 224, 238);
            doc.line(14, 21, width - 14, 21);
        }

        doc.setDrawColor(214, 224, 238);
        doc.line(14, height - 13, width - 14, height - 13);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('Allfix Bacalar - Reporte financiero', 14, height - 7);
        doc.text(`Página ${pageNumber} de ${pageCount}`, width - 14, height - 7, { align: 'right' });
    }
}

function getImageDataUrlForPdf(src) {
    if (!src) return Promise.resolve(null);
    return new Promise(resolve => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth || image.width;
                canvas.height = image.naturalHeight || image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (error) {
                console.warn('No se pudo convertir el logo para PDF:', error);
                resolve(null);
            }
        };
        image.onerror = () => resolve(null);
        image.src = new URL(src, window.location.href).href;
    });
}

function drawFinancialPdfCover(doc, report, logoDataUrl) {
    const { width, height } = getFinancialPdfPageSize(doc);
    const periodLabel = getFinancialPdfPeriodLabel(report);
    const rangeText = getFinancialPdfRangeText(report);

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, width, height, 'F');
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 14, width - 28, 46, 4, 4, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const metaX = width - 78;
    doc.text(`Periodo: ${periodLabel}`, metaX, 24);
    doc.text(`Rango: ${rangeText}`, metaX, 30);
    doc.text(`Generado: ${formatFinancialPdfDateTime(report.generatedAt)}`, metaX, 36);
    doc.text(`Usuario: ${report.generatedBy}`, metaX, 42);

    if (logoDataUrl) {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(width / 2 - 15, 18, 30, 26, 3, 3, 'F');
        doc.addImage(logoDataUrl, 'PNG', width / 2 - 11, 22, 22, 18);
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(report.businessName, width / 2, 72, { align: 'center' });
    doc.setFontSize(23);
    doc.text('REPORTE FINANCIERO', width / 2, 87, { align: 'center' });
    doc.setDrawColor(0, 102, 255);
    doc.setLineWidth(0.8);
    doc.line(width / 2 - 38, 94, width / 2 + 38, 94);

    const cards = [
        ['Total ingresos', formatFinancialPdfCurrency(report.totalIngresos)],
        ['Total gastos', formatFinancialPdfCurrency(report.totalGastos)],
        ['Ganancia neta', formatFinancialPdfCurrency(report.totalProfit)],
        ['Órdenes cobradas', String(report.repairsCount)],
        ['Ventas POS', String(report.salesCount)],
        ['Caja inicial', formatFinancialPdfCurrency(report.cashSummary.initial)],
        ['Caja esperada', formatFinancialPdfCurrency(report.cashSummary.expected)],
        ['Diferencia caja', formatFinancialPdfCurrency(report.cashSummary.difference)]
    ];
    const startX = 14;
    const startY = 112;
    const gap = 6;
    const cardW = (width - 28 - gap * 3) / 4;
    const cardH = 22;
    cards.forEach((card, index) => {
        const x = startX + (index % 4) * (cardW + gap);
        const y = startY + Math.floor(index / 4) * (cardH + 7);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(214, 224, 238);
        doc.roundedRect(x, y, cardW, cardH, 3, 3, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(card[0], x + 4, y + 7);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.6);
        doc.setTextColor(index === 1 || index === 7 && toMoneyNumber(report.cashSummary.difference) < 0 ? 220 : 15, index === 1 ? 38 : 23, index === 1 ? 38 : 42);
        doc.text(card[1], x + 4, y + 16);
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('Documento administrativo generado por el Sistema Gestor Allfix Bacalar', width / 2, height - 30, { align: 'center' });
}

function buildFinancialPdfExecutiveRows(report) {
    const repairAverage = report.repairsCount ? report.ingresosReparaciones / report.repairsCount : 0;
    const posAverage = report.salesCount ? report.ingresosPos / report.salesCount : 0;
    const margin = report.totalIngresos ? (report.totalProfit / report.totalIngresos) * 100 : 0;
    return [
        ['Ingresos totales', formatFinancialPdfCurrency(report.totalIngresos)],
        ['Gastos totales', formatFinancialPdfCurrency(report.totalGastos)],
        ['Ganancia neta', formatFinancialPdfCurrency(report.totalProfit)],
        ['Margen de utilidad', formatFinancialPdfPercent(margin)],
        ['Ticket promedio por reparación', formatFinancialPdfCurrency(repairAverage)],
        ['Ticket promedio POS', formatFinancialPdfCurrency(posAverage)],
        ['Total de descuentos', formatFinancialPdfCurrency(report.descuentos)],
        ['Total efectivo', formatFinancialPdfCurrency(report.paymentTotals.efectivo)],
        ['Total transferencia', formatFinancialPdfCurrency(report.paymentTotals.transferencia)],
        ['Total tarjeta', formatFinancialPdfCurrency(report.paymentTotals.tarjeta)],
        ['Total pagos mixtos', formatFinancialPdfCurrency(report.paymentTotals.mixto)],
        ['Estado general de caja', getFinancialPdfCajaStatus(report)]
    ];
}

function buildFinancialPdfIncomeRows(report) {
    return [
        ['Reparaciones', formatFinancialPdfCurrency(report.ingresosReparaciones), formatFinancialPdfPercent(getFinancialPdfPercentage(report.ingresosReparaciones, report.totalIngresos))],
        ['Ventas punto de venta', formatFinancialPdfCurrency(report.ingresosPos), formatFinancialPdfPercent(getFinancialPdfPercentage(report.ingresosPos, report.totalIngresos))],
        ['Efectivo', formatFinancialPdfCurrency(report.paymentTotals.efectivo), formatFinancialPdfPercent(getFinancialPdfPercentage(report.paymentTotals.efectivo, report.totalIngresos))],
        ['Transferencia', formatFinancialPdfCurrency(report.paymentTotals.transferencia), formatFinancialPdfPercent(getFinancialPdfPercentage(report.paymentTotals.transferencia, report.totalIngresos))],
        ['Tarjeta', formatFinancialPdfCurrency(report.paymentTotals.tarjeta), formatFinancialPdfPercent(getFinancialPdfPercentage(report.paymentTotals.tarjeta, report.totalIngresos))],
        ['Pagos mixtos', formatFinancialPdfCurrency(report.paymentTotals.mixto), formatFinancialPdfPercent(getFinancialPdfPercentage(report.paymentTotals.mixto, report.totalIngresos))],
        ['Descuentos', formatFinancialPdfCurrency(report.descuentos), formatFinancialPdfPercent(getFinancialPdfPercentage(report.descuentos, report.totalIngresos))]
    ];
}

function getFinancialPdfExpenseRows(report) {
    if (!report.expenses.length) {
        return [['Sin gastos registrados en este periodo.', '', '', '', '']];
    }
    return report.expenses.map(expense => [
        formatFinancialPdfDateTime(expense.dateLabel),
        expense.concept,
        formatFinancialPdfCurrency(expense.amount),
        expense.user,
        expense.notes
    ]);
}

function getFinancialPdfCashRows(report) {
    if (!report.cashCuts.length) {
        return [['Sin cortes de caja cerrados en este periodo.', '', '', '', '', '', '', '', '']];
    }
    return report.cashCuts.map(caja => {
        const resumen = caja.resumen || {};
        return [
            formatFinancialPdfDateTime(caja.fecha_cierre || caja.fecha_apertura),
            caja.usuario_nombre || '-',
            formatFinancialPdfCurrency(caja.monto_inicial ?? resumen.fondo_inicial),
            formatFinancialPdfCurrency(resumen.total_ingresos),
            formatFinancialPdfCurrency(resumen.total_salidas),
            formatFinancialPdfCurrency(caja.total_esperado ?? resumen.total_esperado),
            caja.monto_contado === null || caja.monto_contado === undefined ? '-' : formatFinancialPdfCurrency(caja.monto_contado),
            formatFinancialPdfCurrency(caja.diferencia),
            cajaResultLabel(caja.resultado)
        ];
    });
}

function getFinancialPdfMovementRows(report) {
    if (!report.movements.length) {
        return [['Sin movimientos financieros registrados en este periodo.', '', '', '', '', '', '', '']];
    }
    return report.movements.map(movement => [
        formatFinancialPdfDateTime(movement.dateLabel),
        movement.typeLabel,
        movement.reference,
        movement.method,
        movement.description,
        movement.entrada ? formatFinancialPdfCurrency(movement.entrada) : '-',
        movement.salida ? formatFinancialPdfCurrency(movement.salida) : '-',
        formatFinancialPdfCurrency(movement.total)
    ]);
}

function getFinancialPdfOperationRows(report) {
    if (!report.operations.length) {
        return [['Sin operaciones registradas en este periodo.', '', '', '', '', '', '']];
    }
    return report.operations.map(operation => [
        formatFinancialPdfDateTime(operation.dateLabel),
        operation.concept,
        operation.typeLabel,
        formatFinancialPdfCurrency(operation.revenue),
        formatFinancialPdfCurrency(operation.expense),
        formatFinancialPdfCurrency(operation.profit),
        operation.operator
    ]);
}

function colorFinancialPdfMoneyCells(data, positiveIndexes = [], negativeIndexes = []) {
    if (data.section !== 'body') return;
    if (positiveIndexes.includes(data.column.index)) {
        data.cell.styles.textColor = [5, 150, 105];
        data.cell.styles.fontStyle = 'bold';
    }
    if (negativeIndexes.includes(data.column.index)) {
        data.cell.styles.textColor = [220, 38, 38];
        data.cell.styles.fontStyle = 'bold';
    }
}

function addFinancialPdfFinalPage(doc, report) {
    doc.addPage('letter', 'portrait');
    const { width } = getFinancialPdfPageSize(doc);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text('CIERRE DEL REPORTE', 12, 38);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text('Observaciones:', 12, 58);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(12, 64, width - 24, 48, 3, 3, 'S');
    doc.text('Responsable:', 12, 132);
    doc.line(45, 132, width - 24, 132);
    doc.text('Firma del responsable:', 12, 160);
    doc.line(58, 160, width - 24, 160);
    doc.text(`Fecha de impresión: ${formatFinancialPdfDateTime(new Date())}`, 12, 188);
    doc.text(`Empresa: ${report.businessName}`, 12, 198);
}

async function generateFinancialReportPDF(report) {
    const { jsPDF } = getFinancialPdfLibraries();
    if (!jsPDF) {
        alert('No se pudo cargar jsPDF. Revisa que /vendor/jspdf esté disponible.');
        return;
    }

    const logoDataUrl = await getImageDataUrlForPdf(report.logoUrl);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    const tableTheme = getFinancialPdfTableTheme();

    drawFinancialPdfCover(doc, report, logoDataUrl);

    doc.addPage('letter', 'portrait');
    let startY = addFinancialPdfSectionTitle(doc, 'Resumen ejecutivo', 'Indicadores principales del periodo');
    runFinancialAutoTable(doc, {
        ...tableTheme,
        startY,
        head: [['Indicador', 'Valor']],
        body: buildFinancialPdfExecutiveRows(report),
        columnStyles: { 0: { cellWidth: 88 }, 1: { halign: 'right', fontStyle: 'bold' } }
    });

    startY = addFinancialPdfSectionTitle(doc, 'Detalle de ingresos', 'Distribución de ingresos y métodos de pago');
    runFinancialAutoTable(doc, {
        ...tableTheme,
        startY,
        head: [['Concepto', 'Monto', 'Porcentaje del total']],
        body: buildFinancialPdfIncomeRows(report),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
        didParseCell: data => colorFinancialPdfMoneyCells(data, [1], [])
    });

    startY = addFinancialPdfSectionTitle(doc, 'Detalle de gastos', 'Costos, salidas y observaciones');
    runFinancialAutoTable(doc, {
        ...tableTheme,
        startY,
        head: [['Fecha', 'Concepto', 'Monto', 'Usuario', 'Observaciones']],
        body: getFinancialPdfExpenseRows(report),
        columnStyles: { 0: { cellWidth: 30 }, 2: { halign: 'right', cellWidth: 26 }, 3: { cellWidth: 28 } },
        didParseCell: data => colorFinancialPdfMoneyCells(data, [], [2])
    });

    startY = addFinancialPdfSectionTitle(doc, 'Corte de caja', 'Aperturas, cierres y diferencias');
    runFinancialAutoTable(doc, {
        ...tableTheme,
        startY,
        head: [['Fecha', 'Usuario', 'Inicial', 'Entradas', 'Salidas', 'Esperado', 'Contado', 'Diferencia', 'Estado']],
        body: getFinancialPdfCashRows(report),
        styles: { ...tableTheme.styles, fontSize: 6.4, cellPadding: 1.7 },
        columnStyles: {
            0: { cellWidth: 24 },
            1: { cellWidth: 22 },
            2: { halign: 'right', cellWidth: 20 },
            3: { halign: 'right', cellWidth: 20 },
            4: { halign: 'right', cellWidth: 20 },
            5: { halign: 'right', cellWidth: 22 },
            6: { halign: 'right', cellWidth: 20 },
            7: { halign: 'right', cellWidth: 22 },
            8: { cellWidth: 17 }
        },
        didParseCell: data => colorFinancialPdfMoneyCells(data, [3], [4, 7])
    });

    doc.addPage('letter', 'portrait');
    startY = addFinancialPdfSectionTitle(doc, 'Movimientos financieros', 'Flujo financiero ordenado por fecha');
    runFinancialAutoTable(doc, {
        ...tableTheme,
        startY,
        head: [['Fecha', 'Tipo', 'Referencia', 'Método', 'Descripción', 'Entrada', 'Salida', 'Total']],
        body: getFinancialPdfMovementRows(report),
        styles: { ...tableTheme.styles, fontSize: 6.4, cellPadding: 1.7 },
        columnStyles: {
            0: { cellWidth: 24 },
            1: { cellWidth: 22 },
            2: { cellWidth: 20 },
            3: { cellWidth: 20 },
            4: { cellWidth: 43 },
            5: { halign: 'right', cellWidth: 19 },
            6: { halign: 'right', cellWidth: 19 },
            7: { halign: 'right', cellWidth: 20 }
        },
        didParseCell: data => colorFinancialPdfMoneyCells(data, [5], [6])
    });

    startY = addFinancialPdfSectionTitle(doc, 'Operaciones del periodo', 'Ventas y órdenes consideradas para el resumen');
    runFinancialAutoTable(doc, {
        ...tableTheme,
        startY,
        head: [['Fecha', 'Concepto', 'Tipo', 'Monto', 'Costo', 'Ganancia', 'Operador']],
        body: getFinancialPdfOperationRows(report),
        styles: { ...tableTheme.styles, fontSize: 6.5, cellPadding: 1.8 },
        columnStyles: {
            0: { cellWidth: 24 },
            1: { cellWidth: 52 },
            2: { cellWidth: 18 },
            3: { halign: 'right', cellWidth: 20 },
            4: { halign: 'right', cellWidth: 18 },
            5: { halign: 'right', cellWidth: 20 },
            6: { cellWidth: 34 }
        },
        didParseCell: data => colorFinancialPdfMoneyCells(data, [3, 5], [4])
    });

    addFinancialPdfFinalPage(doc, report);
    addFinancialPdfHeaderFooter(doc, report, logoDataUrl);
    doc.save(getFinancialPdfFilename(report));
}

async function exportCurrentReport() {
    const report = buildReportData();
    if (!report.operations.length && !report.movements.length && !report.cashCuts.length) {
        alert('No hay operaciones para exportar en el rango seleccionado.');
        return;
    }

    try {
        await generateFinancialReportPDF(report);
    } catch (error) {
        console.error('Error al generar PDF financiero:', error);
        alert('No se pudo generar el PDF financiero. Revisa la consola para más detalles.');
    }
}

// ==========================================
// OPERACIONES DE USUARIOS (CRUD REAL)
// ==========================================
async function loadUsuarios() {
    const response = await fetch(`${BASE_API_URL}/users`);
    if (response.ok) {
        APP_STATE.usuarios = await response.json();
    }

    const settingsResponse = await fetch(`${BASE_API_URL}/users/settings`);
    if (settingsResponse.ok) {
        APP_STATE.userSettings = await settingsResponse.json();
    }
}

function renderUsuarios() {
    const tableBody = document.querySelector('#users-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    renderUserCreationSetting();
    
    APP_STATE.usuarios.forEach(u => {
        const tr = document.createElement('tr');
        const statusAction = u.activo
            ? `<button class="btn btn-xs btn-outline" onclick="toggleUsuarioStatus(${u.id}, false)"><i class="fa-solid fa-ban"></i> Desactivar</button>`
            : `<button class="btn btn-xs btn-secondary" onclick="toggleUsuarioStatus(${u.id}, true)"><i class="fa-solid fa-circle-check"></i> Activar</button>`;
            
        tr.innerHTML = `
            <td><code>USR-${String(u.id).padStart(3, '0')}</code></td>
            <td><strong>${escapeHtml(u.nombre || '-')}</strong></td>
            <td>${escapeHtml(u.username || '-')}</td>
            <td>${escapeHtml(u.correo || '-')}</td>
            <td>${escapeHtml(u.telefono || '-')}</td>
            <td><span class="badge ${getStatusBadgeClass(u.rol)}">${escapeHtml(u.rol || '-')}</span></td>
            <td><span class="badge ${u.activo ? 'status-entregado' : 'status-cancelado'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td>
                <div class="user-actions">
                    <button class="btn btn-xs btn-secondary" onclick="editUsuario(${u.id})"><i class="fa-solid fa-pen"></i> Editar</button>
                    ${statusAction}
                </div>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function renderUserCreationSetting() {
    const checkbox = document.getElementById('allow-user-creation-switch');
    const source = document.getElementById('user-creation-setting-source');
    const settings = APP_STATE.userSettings || {};
    if (!checkbox) return;

    checkbox.checked = Boolean(settings.allowUserCreation);
    if (source) {
        source.innerText = settings.envOverrideActive
            ? 'Activado temporalmente por ALLOW_USER_CREATION=true en Railway.'
            : 'Controlado desde PostgreSQL.';
    }
}

window.toggleUsuarioStatus = async function(id, activo) {
    const action = activo ? 'activar' : 'desactivar';
    if (!confirm(`¿Deseas ${action} este usuario?`)) return;
    try {
        const response = await fetch(`${BASE_API_URL}/users/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ activo })
        });
        if (response.ok) {
            alert(`Usuario ${activo ? 'activado' : 'desactivado'} correctamente.`);
            await loadAllData();
        } else {
            const err = await response.json();
            alert('Error: ' + err.error);
        }
    } catch (err) {
        console.error(err);
    }
};

window.editUsuario = function(id) {
    const user = APP_STATE.usuarios.find(item => Number(item.id) === Number(id));
    if (!user) return;
    openUserModal(user);
};

function openUserModal(user = null) {
    const userModal = document.getElementById('user-modal');
    const userForm = document.getElementById('user-form');
    const title = document.getElementById('user-modal-title');
    const saveButton = document.getElementById('btn-save-user');
    if (!userModal || !userForm) return;

    userForm.reset();
    document.getElementById('user-id').value = user?.id || '';
    document.getElementById('user-nombre').value = user?.nombre || '';
    document.getElementById('user-username').value = user?.username || '';
    document.getElementById('user-correo').value = user?.correo || '';
    document.getElementById('user-telefono').value = user?.telefono || '';
    document.getElementById('user-rol').value = user?.rol || 'Recepcionista';
    document.getElementById('user-activo').checked = user ? Boolean(user.activo) : true;
    document.getElementById('user-password').required = !user;

    if (title) title.innerText = user ? 'Editar Operador' : 'Registrar Nuevo Operador';
    if (saveButton) saveButton.innerText = user ? 'Guardar Cambios' : 'Registrar Operador';
    userModal.classList.remove('hidden');
}

window.deleteUsuario = async function(id) {
    if (!confirm('¿Está seguro de eliminar este operador?')) return;
    try {
        const response = await fetch(`${BASE_API_URL}/configuracion/usuarios/${id}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            alert('Operador eliminado con éxito.');
            await loadAllData();
        } else {
            const err = await response.json();
            alert('Error: ' + err.error);
        }
    } catch (err) {
        console.error(err);
    }
};

function initUsuarios() {
    const userModal = document.getElementById('user-modal');
    const btnAdd = document.getElementById('btn-add-user-modal');
    const btnClose = document.getElementById('btn-close-user-modal');
    const btnCancel = document.getElementById('btn-cancel-user');
    const userForm = document.getElementById('user-form');
    const allowSwitch = document.getElementById('allow-user-creation-switch');
    
    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            openUserModal();
        });
    }
    if (btnClose) {
        btnClose.addEventListener('click', () => userModal.classList.add('hidden'));
    }
    if (btnCancel) {
        btnCancel.addEventListener('click', () => userModal.classList.add('hidden'));
    }
    
    if (userForm) {
        userForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const userId = document.getElementById('user-id').value;
            const data = {
                nombre: document.getElementById('user-nombre').value.trim(),
                username: document.getElementById('user-username').value.trim(),
                correo: document.getElementById('user-correo').value.trim(),
                telefono: document.getElementById('user-telefono').value.trim(),
                password: document.getElementById('user-password').value,
                rol: document.getElementById('user-rol').value,
                activo: document.getElementById('user-activo').checked
            };
            
            try {
                const response = await fetch(`${BASE_API_URL}/users${userId ? `/${userId}` : ''}`, {
                    method: userId ? 'PUT' : 'POST',
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    alert(userId ? 'Usuario actualizado correctamente.' : 'Operador registrado con exito.');
                    userModal.classList.add('hidden');
                    await loadAllData();
                } else {
                    const err = await response.json();
                    alert('Error: ' + err.error);
                }
            } catch (err) {
                console.error(err);
            }
        });
    }

    allowSwitch?.addEventListener('change', async () => {
        try {
            const response = await fetch(`${BASE_API_URL}/users/settings`, {
                method: 'PUT',
                body: JSON.stringify({ allowUserCreation: allowSwitch.checked })
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                alert(err.error || 'No se pudo actualizar la configuracion.');
                allowSwitch.checked = !allowSwitch.checked;
                return;
            }
            await loadUsuarios();
            renderUsuarios();
        } catch (error) {
            console.error('Error al actualizar creacion de usuarios:', error);
            allowSwitch.checked = !allowSwitch.checked;
        }
    });

    initProfileModal();
}

function initProfileModal() {
    const modal = document.getElementById('profile-modal');
    const openButton = document.getElementById('btn-open-profile-modal');
    const closeButton = document.getElementById('btn-close-profile-modal');
    const profileForm = document.getElementById('profile-form');
    const passwordForm = document.getElementById('profile-password-form');

    openButton?.addEventListener('click', () => {
        const user = APP_STATE.currentUser || {};
        document.getElementById('profile-nombre').value = user.nombre || '';
        document.getElementById('profile-correo').value = user.correo || '';
        document.getElementById('profile-telefono').value = user.telefono || '';
        modal?.classList.remove('hidden');
    });
    closeButton?.addEventListener('click', () => modal?.classList.add('hidden'));

    profileForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            nombre: document.getElementById('profile-nombre').value.trim(),
            correo: document.getElementById('profile-correo').value.trim(),
            telefono: document.getElementById('profile-telefono').value.trim()
        };
        const response = await fetch(`${BASE_API_URL}/users/me/profile`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(payload.error || 'No se pudo actualizar el perfil.');
            return;
        }
        APP_STATE.currentUser = { ...APP_STATE.currentUser, ...payload };
        persistSession({ ...getStoredSession(), user: APP_STATE.currentUser, token: getAuthToken() });
        updateSidebarProfile(APP_STATE.currentUser);
        alert('Perfil actualizado correctamente.');
    });

    passwordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('profile-current-password').value;
        const newPassword = document.getElementById('profile-new-password').value;
        const confirmPassword = document.getElementById('profile-confirm-password').value;
        if (newPassword !== confirmPassword) {
            alert('Las contrasenas no coinciden.');
            return;
        }
        const response = await fetch(`${BASE_API_URL}/users/me/password`, {
            method: 'PUT',
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(payload.error || 'No se pudo actualizar la contrasena.');
            return;
        }
        passwordForm.reset();
        alert(payload.message || 'Contrasena actualizada correctamente.');
    });
}

// ==========================================
// AJUSTES DEL ESTABLECIMIENTO
// ==========================================
const ESTABLISHMENT_CONFIG = {
    name: 'AllFix Bacalar',
    phone: '983 123 4567',
    whatsapp: '983 190 96 56',
    redes_sociales: JSON.stringify({
        facebook: 'Allfix bacalar reparación de celulares',
        tiktok: '@allfixbacalar',
        instagram: '@allfixbacalar'
    }),
    address: 'Avenida Costera N° 45, Bacalar, Q. Roo',
    terms: 'IMPORTANTE: Una vez que su equipo esté listo y haya sido notificado, contará con un plazo máximo de 30 días para recogerlo. Después de ese plazo el establecimiento podrá disponer del equipo conforme a sus políticas internas.',
    logoUrl: '',
    ticketLogoUrl: '',
    ticketPrinter: '',
    ticketPaper: '80mm',
    autoPrintTicket: true
};

const TICKET_SOCIAL_CONTACTS = {
    whatsapp: '983 190 96 56',
    facebook: 'Allfix Bacalar',
    tiktok: '@allfixbacalar',
    instagram: '@allfixbacalar'
};

const DEFAULT_BUSINESS_LOGO = 'img/logoallfixv2.png';
const DEFAULT_TICKET_LOGO = 'img/logoallfix-ticket.png';

function getBusinessLogoUrl() {
    return ESTABLISHMENT_CONFIG.logoUrl || DEFAULT_BUSINESS_LOGO;
}

function getTicketLogoUrl() {
    return ESTABLISHMENT_CONFIG.ticketLogoUrl || DEFAULT_TICKET_LOGO;
}

function hasCustomBusinessLogo() {
    return Boolean(ESTABLISHMENT_CONFIG.logoUrl && ESTABLISHMENT_CONFIG.logoUrl !== DEFAULT_BUSINESS_LOGO);
}

function hasCustomTicketLogo() {
    return Boolean(ESTABLISHMENT_CONFIG.ticketLogoUrl);
}

function splitBusinessNameForSidebar(name = ESTABLISHMENT_CONFIG.name) {
    const parts = String(name || 'AllFix Bacalar').trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
        return { main: parts[0] || 'Negocio', sub: 'Sistema gestor' };
    }
    return {
        main: parts.slice(0, -1).join(' '),
        sub: parts.at(-1)
    };
}

function applyBusinessBranding() {
    const logoUrl = getBusinessLogoUrl();
    applyBusinessLogoSource(logoUrl);
    applyTicketLogoSource();
    applyBusinessName();
    applyTicketContactInfo();
}

function applyBusinessLogoSource(logoUrl = getBusinessLogoUrl()) {
    const sidebarLogo = document.getElementById('sidebar-business-logo');
    if (sidebarLogo) sidebarLogo.src = logoUrl || DEFAULT_BUSINESS_LOGO;

    document.querySelectorAll('.business-ticket-logo').forEach(img => {
        img.src = logoUrl || DEFAULT_BUSINESS_LOGO;
        img.style.display = '';
    });
}

function applyTicketLogoSource(logoUrl = getTicketLogoUrl()) {
    document.querySelectorAll('.thermal-ticket-logo').forEach(img => {
        const header = img.closest('.ticket-main-header');
        img.onload = () => header?.classList.add('has-ticket-logo');
        img.onerror = () => {
            img.style.display = 'none';
            header?.classList.remove('has-ticket-logo');
        };
        img.src = logoUrl || DEFAULT_TICKET_LOGO;
        img.style.display = '';
        if (img.complete) {
            if (img.naturalWidth > 0) header?.classList.add('has-ticket-logo');
            else header?.classList.remove('has-ticket-logo');
        }
    });
}

function applyBusinessName() {
    const sidebarName = document.getElementById('sidebar-business-name');
    const sidebarLocation = document.getElementById('sidebar-business-location');
    const nameParts = splitBusinessNameForSidebar();

    if (sidebarName) sidebarName.textContent = nameParts.main;
    if (sidebarLocation) sidebarLocation.textContent = nameParts.sub;

    document.title = `Sistema Gestor - ${ESTABLISHMENT_CONFIG.name}`;
}

function parseSocialProfiles(value = ESTABLISHMENT_CONFIG.redes_sociales) {
    if (value && typeof value === 'object') return value;
    const raw = String(value || '').trim();
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : { raw };
    } catch (err) {
        return { raw };
    }
}

function serializeSocialProfiles({ tiktok = '', facebook = '', instagram = '' } = {}) {
    return JSON.stringify({
        tiktok: String(tiktok || '').trim(),
        facebook: String(facebook || '').trim(),
        instagram: String(instagram || '').trim()
    });
}

function getTicketContactLine() {
    const socials = parseSocialProfiles();
    const parts = [];
    const whatsapp = String(ESTABLISHMENT_CONFIG.whatsapp || ESTABLISHMENT_CONFIG.phone || '').trim();

    if (whatsapp) parts.push(`WhatsApp: ${whatsapp}`);
    if (socials.tiktok) parts.push(`TikTok: ${socials.tiktok}`);
    if (socials.facebook) parts.push(`Facebook: ${socials.facebook}`);
    if (socials.instagram) parts.push(`Instagram: ${socials.instagram}`);
    if (socials.raw) parts.push(socials.raw);

    return parts.join(' | ');
}

function getTicketContactItems() {
    return [
        { icon: 'fa-brands fa-whatsapp', label: 'WhatsApp', value: TICKET_SOCIAL_CONTACTS.whatsapp },
        { icon: 'fa-brands fa-facebook', label: 'Facebook', value: TICKET_SOCIAL_CONTACTS.facebook },
        { icon: 'fa-brands fa-tiktok', label: 'TikTok', value: TICKET_SOCIAL_CONTACTS.tiktok },
        { icon: 'fa-brands fa-instagram', label: 'Instagram', value: TICKET_SOCIAL_CONTACTS.instagram }
    ].filter(item => item.value);
}

function applyTicketContactInfo() {
    const items = getTicketContactItems();
    document.querySelectorAll('.ticket-social-info').forEach(element => {
        element.innerHTML = items.map(item => `
            <span class="ticket-social-row">
                <i class="${item.icon}" aria-hidden="true"></i>
                <span class="ticket-social-value" aria-label="${escapeHtml(item.label)}">${escapeHtml(item.value)}</span>
            </span>
        `).join('');
        element.classList.toggle('hidden', items.length === 0);
    });
}

function setBusinessLogoPreview(src = getBusinessLogoUrl(), filename = '', options = {}) {
    const preview = document.getElementById('cfg-logo-preview');
    const filenameEl = document.getElementById('cfg-logo-filename');
    const logoSrc = src || DEFAULT_BUSINESS_LOGO;
    if (preview) preview.src = logoSrc;
    if (options.apply !== false) applyBusinessLogoSource(logoSrc);
    if (filenameEl) {
        filenameEl.textContent = filename || (hasCustomBusinessLogo() ? 'Logo personalizado guardado' : 'Logo actual del sistema');
    }
}

function setTicketLogoPreview(src = getTicketLogoUrl(), filename = '', options = {}) {
    const preview = document.getElementById('cfg-ticket-logo-preview');
    const filenameEl = document.getElementById('cfg-ticket-logo-filename');
    const logoSrc = src || DEFAULT_TICKET_LOGO;
    if (preview) preview.src = logoSrc;
    if (options.apply !== false) applyTicketLogoSource(logoSrc);
    if (filenameEl) {
        filenameEl.textContent = filename || (hasCustomTicketLogo() ? 'Logo térmico personalizado guardado' : 'Logo base de impresión');
    }
}

async function uploadBusinessLogoIfNeeded() {
    const fileInput = document.getElementById('cfg-business-logo');
    const file = fileInput?.files?.[0];
    if (!file) return ESTABLISHMENT_CONFIG.logoUrl || '';

    const formData = new FormData();
    formData.append('logo', file);

    const response = await fetch(`${BASE_API_URL}/configuracion/logo`, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 401) {
            throw new Error('Tu sesión expiró. Inicia sesión nuevamente y vuelve a guardar el logo.');
        }
        throw new Error(err.error || 'No se pudo subir el logo.');
    }

    const data = await response.json();
    return data.url || '';
}

async function uploadTicketLogoIfNeeded() {
    const fileInput = document.getElementById('cfg-ticket-logo');
    const file = fileInput?.files?.[0];
    if (!file) return ESTABLISHMENT_CONFIG.ticketLogoUrl || '';

    const formData = new FormData();
    formData.append('logo', file);

    const response = await fetch(`${BASE_API_URL}/configuracion/logo`, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 401) {
            throw new Error('Tu sesión expiró. Inicia sesión nuevamente y vuelve a guardar el logo del ticket.');
        }
        throw new Error(err.error || 'No se pudo subir el logo del ticket.');
    }

    const data = await response.json();
    return data.url || '';
}

async function loadEstablishmentConfig() {
    const saved = localStorage.getItem('allfix_establishment_config');
    if (saved) {
        Object.assign(ESTABLISHMENT_CONFIG, JSON.parse(saved));
    }

    try {
        const response = await fetch(`${BASE_API_URL}/configuracion/negocio`);
        if (response.ok) {
            const serverConfig = await response.json();
            const mappedConfig = {
                name: serverConfig.nombre || serverConfig.name || ESTABLISHMENT_CONFIG.name,
                phone: serverConfig.telefono || serverConfig.phone || ESTABLISHMENT_CONFIG.phone,
                address: serverConfig.direccion || serverConfig.address || ESTABLISHMENT_CONFIG.address,
                terms: serverConfig.terminos_legales || serverConfig.terms || ESTABLISHMENT_CONFIG.terms,
                logoUrl: serverConfig.logo_url || serverConfig.logoUrl || ESTABLISHMENT_CONFIG.logoUrl || '',
                ticketLogoUrl: serverConfig.logo_ticket_url || serverConfig.ticketLogoUrl || ESTABLISHMENT_CONFIG.ticketLogoUrl || '',
                whatsapp: serverConfig.whatsapp || ESTABLISHMENT_CONFIG.whatsapp || '',
                redes_sociales: serverConfig.redes_sociales || ESTABLISHMENT_CONFIG.redes_sociales || '',
                ticketPrinter: serverConfig.impresora_ticket || serverConfig.ticketPrinter || ESTABLISHMENT_CONFIG.ticketPrinter || '',
                ticketPaper: serverConfig.papel_ticket === '58mm' ? '58mm' : '80mm',
                autoPrintTicket: serverConfig.auto_imprimir_ticket !== false
            };
            Object.assign(ESTABLISHMENT_CONFIG, mappedConfig);
            localStorage.setItem('allfix_establishment_config', JSON.stringify(ESTABLISHMENT_CONFIG));
        }
    } catch (err) {
        console.warn('No se pudo cargar la configuración del establecimiento desde el backend:', err);
    }

    applyBusinessBranding();
}

async function saveEstablishmentConfig(config) {
    const normalizedConfig = {
        name: config.name || config.nombre || ESTABLISHMENT_CONFIG.name,
        phone: config.phone || config.telefono || ESTABLISHMENT_CONFIG.phone,
        address: config.address || config.direccion || ESTABLISHMENT_CONFIG.address,
        terms: config.terms || config.terminos_legales || ESTABLISHMENT_CONFIG.terms,
        logoUrl: config.logoUrl ?? config.logo_url ?? ESTABLISHMENT_CONFIG.logoUrl ?? '',
        ticketLogoUrl: config.ticketLogoUrl ?? config.logo_ticket_url ?? ESTABLISHMENT_CONFIG.ticketLogoUrl ?? '',
        whatsapp: config.whatsapp ?? ESTABLISHMENT_CONFIG.whatsapp ?? '',
        redes_sociales: config.redes_sociales ?? ESTABLISHMENT_CONFIG.redes_sociales ?? '',
        ticketPrinter: config.ticketPrinter ?? config.impresora_ticket ?? ESTABLISHMENT_CONFIG.ticketPrinter ?? '',
        ticketPaper: (config.ticketPaper || config.papel_ticket || ESTABLISHMENT_CONFIG.ticketPaper) === '58mm' ? '58mm' : '80mm',
        autoPrintTicket: config.autoPrintTicket ?? config.auto_imprimir_ticket ?? ESTABLISHMENT_CONFIG.autoPrintTicket ?? true
    };

    Object.assign(ESTABLISHMENT_CONFIG, normalizedConfig);
    localStorage.setItem('allfix_establishment_config', JSON.stringify(ESTABLISHMENT_CONFIG));

    const response = await fetch(`${BASE_API_URL}/configuracion/negocio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nombre: normalizedConfig.name,
            telefono: normalizedConfig.phone,
            direccion: normalizedConfig.address,
            terminos_legales: normalizedConfig.terms,
            logo_url: normalizedConfig.logoUrl,
            logo_ticket_url: normalizedConfig.ticketLogoUrl,
            whatsapp: normalizedConfig.whatsapp,
            redes_sociales: normalizedConfig.redes_sociales,
            impresora_ticket: normalizedConfig.ticketPrinter,
            papel_ticket: normalizedConfig.ticketPaper,
            auto_imprimir_ticket: normalizedConfig.autoPrintTicket
        })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 401) {
            throw new Error('Tu sesión expiró. Inicia sesión nuevamente y vuelve a guardar los cambios.');
        }
        throw new Error(err.error || 'No se pudo guardar la configuración del establecimiento.');
    }

    applyBusinessBranding();
    return true;
}

function syncConfigForms() {
    const nameInput = document.getElementById('cfg-business-name');
    const phoneInput = document.getElementById('cfg-business-phone');
    const whatsappInput = document.getElementById('cfg-business-whatsapp');
    const tiktokInput = document.getElementById('cfg-business-tiktok');
    const facebookInput = document.getElementById('cfg-business-facebook');
    const instagramInput = document.getElementById('cfg-business-instagram');
    const addressInput = document.getElementById('cfg-business-address');
    const termsTextarea = document.getElementById('cfg-business-terms');
    const printerInput = document.getElementById('cfg-ticket-printer');
    const paperDetected = document.getElementById('cfg-ticket-paper-detected');
    const printModeSelect = document.getElementById('cfg-ticket-print-mode');
    
    if (nameInput) nameInput.value = ESTABLISHMENT_CONFIG.name;
    if (phoneInput) phoneInput.value = ESTABLISHMENT_CONFIG.phone;
    if (whatsappInput) whatsappInput.value = ESTABLISHMENT_CONFIG.whatsapp || '';
    const socials = parseSocialProfiles();
    if (tiktokInput) tiktokInput.value = socials.tiktok || '';
    if (facebookInput) facebookInput.value = socials.facebook || '';
    if (instagramInput) instagramInput.value = socials.instagram || '';
    if (addressInput) addressInput.value = ESTABLISHMENT_CONFIG.address;
    if (termsTextarea) termsTextarea.value = ESTABLISHMENT_CONFIG.terms;
    if (printerInput) populatePrinterOptions([], ESTABLISHMENT_CONFIG.ticketPrinter || '');
    if (paperDetected) paperDetected.textContent = getDetectedPaperLabel();
    if (printModeSelect) printModeSelect.value = ESTABLISHMENT_CONFIG.autoPrintTicket !== false ? 'direct' : 'ask';
    setBusinessLogoPreview();
    setTicketLogoPreview();
    applyBusinessBranding();
}

function initEstablishmentConfigForm() {
    const form = document.getElementById('config-general-form');
    if (!form) return;

    syncConfigForms();

    const nameInput = document.getElementById('cfg-business-name');
    const phoneInput = document.getElementById('cfg-business-phone');
    const whatsappInput = document.getElementById('cfg-business-whatsapp');
    const tiktokInput = document.getElementById('cfg-business-tiktok');
    const facebookInput = document.getElementById('cfg-business-facebook');
    const instagramInput = document.getElementById('cfg-business-instagram');
    const addressInput = document.getElementById('cfg-business-address');
    const termsTextarea = document.getElementById('cfg-business-terms');
    const logoInput = document.getElementById('cfg-business-logo');
    const selectLogoButton = document.getElementById('btn-select-business-logo');
    const removeLogoButton = document.getElementById('btn-remove-business-logo');

    selectLogoButton?.addEventListener('click', () => logoInput?.click());

    logoInput?.addEventListener('change', () => {
        const file = logoInput.files?.[0];
        if (!file) {
            setBusinessLogoPreview();
            return;
        }

        const reader = new FileReader();
        reader.onload = () => setBusinessLogoPreview(reader.result, file.name);
        reader.onerror = () => alert('No se pudo leer el logo seleccionado.');
        reader.readAsDataURL(file);
    });

    removeLogoButton?.addEventListener('click', () => {
        ESTABLISHMENT_CONFIG.logoUrl = '';
        if (logoInput) logoInput.value = '';
        setBusinessLogoPreview(DEFAULT_BUSINESS_LOGO, 'Se usará el logo base al guardar');
        applyBusinessBranding();
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const logoUrl = await uploadBusinessLogoIfNeeded();
            await saveEstablishmentConfig({
                name: nameInput.value.trim(),
                phone: phoneInput.value.trim(),
                address: addressInput.value.trim(),
                terms: termsTextarea.value.trim(),
                logoUrl,
                whatsapp: whatsappInput?.value.trim() || '',
                redes_sociales: serializeSocialProfiles({
                    tiktok: tiktokInput?.value,
                    facebook: facebookInput?.value,
                    instagram: instagramInput?.value
                })
            });
            if (logoInput) logoInput.value = '';
            setBusinessLogoPreview();
            alert('Configuración del establecimiento guardada con éxito.');
        } catch (err) {
            alert(err.message || 'No se pudo guardar la configuración del establecimiento.');
        }
    });
}

async function detectAvailablePrinters() {
    try {
        const response = await fetch(`${BASE_API_URL}/configuracion/impresoras`);
        if (response.ok) {
            const printers = await response.json();
            return (printers || []).map(normalizePrinterInfo).filter(printer => printer.name);
        }
    } catch (err) {
        console.warn('No se pudieron consultar impresoras desde el backend:', err);
    }

    const printerProviders = [
        window.allfixPrinterBridge,
        window.allfixPrinter,
        window.printerAPI,
        window.electronAPI
    ].filter(Boolean);

    for (const provider of printerProviders) {
        const getPrinters = provider.getPrinters || provider.listPrinters;
        if (typeof getPrinters !== 'function') continue;

        const printers = await getPrinters.call(provider);
        return (printers || []).map(normalizePrinterInfo).filter(printer => printer.name);
    }

    return [];
}

function normalizePrinterInfo(printer) {
    if (typeof printer === 'string') {
        return { name: printer, isDefault: false, paperMm: null, ticketPaper: null };
    }

    return {
        name: printer?.name || printer?.displayName || printer?.printerName || '',
        isDefault: Boolean(printer?.isDefault || printer?.default),
        paperMm: printer?.paperMm || printer?.paperWidthMm || null,
        ticketPaper: printer?.ticketPaper || normalizeTicketPaper(printer?.paperMm || printer?.paperWidthMm)
    };
}

function getDetectedPaperLabel() {
    const printer = getSelectedPrinterMeta();
    const paper = detectConfiguredTicketPaper();
    const details = printer?.paperMm ? ` (${Number(printer.paperMm).toFixed(0)} mm detectados)` : '';
    return `${paper.replace('mm', ' mm')}${details}`;
}

function refreshDetectedPaperLabel() {
    const paperDetected = document.getElementById('cfg-ticket-paper-detected');
    if (paperDetected) paperDetected.textContent = getDetectedPaperLabel();
}

function populatePrinterOptions(printers = [], selectedPrinter = ESTABLISHMENT_CONFIG.ticketPrinter || '') {
    const printerSelect = document.getElementById('cfg-ticket-printer');
    if (!printerSelect) return;

    AVAILABLE_TICKET_PRINTERS = printers.map(normalizePrinterInfo).filter(printer => printer.name);
    const uniqueNames = [...new Set(AVAILABLE_TICKET_PRINTERS.map(printer => printer.name))];
    if (selectedPrinter && !uniqueNames.includes(selectedPrinter)) {
        uniqueNames.unshift(selectedPrinter);
        AVAILABLE_TICKET_PRINTERS.unshift({ name: selectedPrinter, isDefault: false, paperMm: null, ticketPaper: ESTABLISHMENT_CONFIG.ticketPaper });
    }

    printerSelect.innerHTML = [
        '<option value="">Impresora predeterminada del sistema</option>',
        ...uniqueNames
            .map(printer => `<option value="${escapeHtml(printer)}">${escapeHtml(printer)}</option>`)
    ].join('');

    printerSelect.value = selectedPrinter || '';
    refreshDetectedPaperLabel();
}

function initPrinterConfigForm() {
    const form = document.getElementById('config-printer-form');
    if (!form) return;

    const printerInput = document.getElementById('cfg-ticket-printer');
    const paperDetected = document.getElementById('cfg-ticket-paper-detected');
    const printModeSelect = document.getElementById('cfg-ticket-print-mode');
    const detectButton = document.getElementById('btn-detect-printers');
    const status = document.getElementById('printer-config-status');
    const ticketLogoInput = document.getElementById('cfg-ticket-logo');
    const selectTicketLogoButton = document.getElementById('btn-select-ticket-logo');
    const removeTicketLogoButton = document.getElementById('btn-remove-ticket-logo');

    populatePrinterOptions([], ESTABLISHMENT_CONFIG.ticketPrinter || '');
    if (paperDetected) paperDetected.textContent = getDetectedPaperLabel();
    if (printModeSelect) printModeSelect.value = ESTABLISHMENT_CONFIG.autoPrintTicket !== false ? 'direct' : 'ask';
    setTicketLogoPreview();

    selectTicketLogoButton?.addEventListener('click', () => ticketLogoInput?.click());

    ticketLogoInput?.addEventListener('change', () => {
        const file = ticketLogoInput.files?.[0];
        if (!file) {
            setTicketLogoPreview();
            return;
        }

        const reader = new FileReader();
        reader.onload = () => setTicketLogoPreview(reader.result, file.name);
        reader.onerror = () => alert('No se pudo leer el logo seleccionado para el ticket.');
        reader.readAsDataURL(file);
    });

    removeTicketLogoButton?.addEventListener('click', () => {
        ESTABLISHMENT_CONFIG.ticketLogoUrl = '';
        if (ticketLogoInput) ticketLogoInput.value = '';
        setTicketLogoPreview(DEFAULT_TICKET_LOGO, 'Se usará el logo base al guardar');
        applyTicketLogoSource();
    });

    printerInput?.addEventListener('change', () => {
        ESTABLISHMENT_CONFIG.ticketPrinter = printerInput.value.trim();
        ESTABLISHMENT_CONFIG.ticketPaper = detectConfiguredTicketPaper();
        refreshDetectedPaperLabel();
    });

    async function refreshAvailablePrinters(showStatus = false) {
        if (showStatus && status) status.innerText = 'Buscando impresoras disponibles...';

        try {
            const printers = await detectAvailablePrinters();
            populatePrinterOptions(printers, printerInput.value);

            if (printers.length) {
                if (!printerInput.value) printerInput.value = printers[0].name || '';
                ESTABLISHMENT_CONFIG.ticketPrinter = printerInput.value.trim();
                ESTABLISHMENT_CONFIG.ticketPaper = detectConfiguredTicketPaper();
                refreshDetectedPaperLabel();
                if (status) status.innerText = `${printers.length} impresora(s) disponible(s). Tamaño: ${getDetectedPaperLabel()}.`;
            } else if (showStatus && status) {
                status.innerText = 'No se detectaron impresoras disponibles en este equipo.';
            }
        } catch (err) {
            if (showStatus && status) status.innerText = 'No se pudieron detectar impresoras en este equipo.';
        }
    }

    detectButton?.addEventListener('click', () => refreshAvailablePrinters(true));
    refreshAvailablePrinters(false);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        try {
            const ticketLogoUrl = await uploadTicketLogoIfNeeded();
            await saveEstablishmentConfig({
                ticketPrinter: printerInput.value.trim(),
                ticketPaper: detectConfiguredTicketPaper(),
                autoPrintTicket: (printModeSelect?.value || 'direct') === 'direct',
                ticketLogoUrl
            });
            if (ticketLogoInput) ticketLogoInput.value = '';
            setTicketLogoPreview();
            if (status) status.innerText = 'Configuración de impresión guardada.';
            alert('Configuración de impresión guardada con éxito.');
        } catch (err) {
            alert(err.message || 'No se pudo guardar la configuración de impresión.');
        }
    });
}

// ==========================================
// GRÁFICO SVG MENSUAL DINÁMICO (ÚLTIMOS 6 MESES)
// ==========================================
function updateDashboardChart() {
    const chart = document.querySelector('.dashboard-chart');
    if (!chart) return;
    
    const now = new Date();
    const monthsData = [];
    
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthsData.push({
            year: d.getFullYear(),
            month: d.getMonth(),
            label: d.toLocaleString('es-ES', { month: 'short' }).substring(0, 3),
            revenue: 0
        });
    }
    
    APP_STATE.ordenes.forEach(o => {
        if (!o.dateIn) return;
        const parts = o.dateIn.split('-');
        if (parts.length !== 3) return;
        const oYear = parseInt(parts[0], 10);
        const oMonth = parseInt(parts[1], 10) - 1;
        
        const match = monthsData.find(m => m.year === oYear && m.month === oMonth);
        if (match) {
            const rev = o.costo_real !== null && o.costo_real !== undefined ? o.costo_real : o.costo_estimado;
            match.revenue += rev;
        }
    });
    
    APP_STATE.ventas.forEach(v => {
        if (!v.fecha) return;
        const datePart = v.fecha.split(' ')[0];
        const parts = datePart.split('-');
        if (parts.length !== 3) return;
        const vYear = parseInt(parts[0], 10);
        const vMonth = parseInt(parts[1], 10) - 1;
        
        const match = monthsData.find(m => m.year === vYear && m.month === vMonth);
        if (match) {
            match.revenue += v.total;
        }
    });
    
    const maxRev = Math.max(...monthsData.map(m => m.revenue), 1000);
    
    const rects = chart.querySelectorAll('rect');
    const texts = chart.querySelectorAll('text');
    
    monthsData.forEach((mData, idx) => {
        const barHeight = Math.max(5, (mData.revenue / maxRev) * 140);
        const yPos = 170 - barHeight;
        
        if (rects[idx]) {
            rects[idx].setAttribute('y', yPos);
            rects[idx].setAttribute('height', barHeight);
            rects[idx].setAttribute('title', `$${mData.revenue.toFixed(2)}`);
        }
    });
    
    let monthTextIdx = 0;
    texts.forEach(txt => {
        const x = parseFloat(txt.getAttribute('x'));
        const y = parseFloat(txt.getAttribute('y'));
        if (y > 175 && monthTextIdx < 6) {
            const lbl = monthsData[monthTextIdx].label;
            txt.textContent = lbl.charAt(0).toUpperCase() + lbl.slice(1);
            monthTextIdx++;
        }
        
        if (x === 30) {
            if (y === 75) {
                txt.textContent = `$${(maxRev * 0.5 / 1000).toFixed(1)}k`;
            } else if (y === 125) {
                txt.textContent = `$${(maxRev * 0.25 / 1000).toFixed(1)}k`;
            } else if (y === 35) {
                txt.textContent = `$${(maxRev / 1000).toFixed(1)}k`;
            }
        }
    });
}

// ==========================================
// MÓDULO COTIZACIONES (GESTIÓN Y DETALLES)
// ==========================================
function initCotizaciones() {
    const quoteModal = document.getElementById('quote-modal');
    
    document.getElementById('btn-close-quote-modal').addEventListener('click', () => quoteModal.classList.add('hidden'));
    document.getElementById('btn-cancel-quote').addEventListener('click', () => quoteModal.classList.add('hidden'));
    
    document.getElementById('quote-search').addEventListener('input', renderCotizaciones);
    document.getElementById('quote-status-filter').addEventListener('change', renderCotizaciones);
    document.getElementById('quote-sort').addEventListener('change', renderCotizaciones);
    
    document.getElementById('quote-action-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('quote-detail-id').value;
        const estado = document.getElementById('quote-detail-status').value;
        const observaciones = document.getElementById('quote-detail-observations').value;
        
        try {
            const response = await fetch(`${BASE_API_URL}/cotizaciones/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado, observaciones_internas: observaciones })
            });
            if (response.ok) {
                alert('Cotización actualizada.');
                quoteModal.classList.add('hidden');
                loadAllData();
            } else {
                const err = await response.json();
                alert('Error al actualizar: ' + err.error);
            }
        } catch (err) {
            console.error(err);
        }
    });

    document.getElementById('btn-delete-quote').addEventListener('click', async () => {
        const id = document.getElementById('quote-detail-id').value;
        if (confirm('¿Está seguro de eliminar esta cotización?')) {
            try {
                const response = await fetch(`${BASE_API_URL}/cotizaciones/${id}`, {
                    method: 'DELETE'
                });
                if (response.ok) {
                    alert('Cotización eliminada.');
                    quoteModal.classList.add('hidden');
                    loadAllData();
                } else {
                    const err = await response.json();
                    alert('Error al eliminar: ' + err.error);
                }
            } catch (err) {
                console.error(err);
            }
        }
    });

    document.getElementById('btn-convert-quote').addEventListener('click', async () => {
        const id = document.getElementById('quote-detail-id').value;
        if (confirm('¿Desea convertir esta cotización en una Orden de Servicio activa? Se creará el cliente y la orden automáticamente.')) {
            try {
                const response = await fetch(`${BASE_API_URL}/cotizaciones/${id}/convertir`, {
                    method: 'POST'
                });
                if (response.ok) {
                    const result = await response.json();
                    alert(`Orden de Servicio creada con éxito. Folio generado: ${result.folio}`);
                    quoteModal.classList.add('hidden');
                    loadAllData();
                    editOrderDetails(result.ordenId);
                } else {
                    const err = await response.json();
                    alert('Error al convertir cotización: ' + err.error);
                }
            } catch (err) {
                console.error(err);
            }
        }
    });
}

function getQuoteValue(quote, keys, fallback = '') {
    for (const key of keys) {
        const value = quote?.[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
}

function getQuotePhotos(quote) {
    if (Array.isArray(quote?.photos)) return quote.photos;
    if (Array.isArray(quote?.fotografias)) return quote.fotografias;

    const raw = quote?.photos || quote?.fotografias || '[]';
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error("Error al parsear fotos de cotización:", e);
        return [];
    }
}

function renderCotizaciones() {
    const tableBody = document.querySelector('#quotes-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    updateQuotesMenuBadge();
    const resultsCount = document.getElementById('quote-results-count');
    
    const searchVal = document.getElementById('quote-search').value.toLowerCase().trim();
    const statusFilter = document.getElementById('quote-status-filter').value;
    const sortValue = document.getElementById('quote-sort').value;
    
    const filtered = APP_STATE.cotizaciones
        .filter(q => !statusFilter || q.estado === statusFilter)
        .filter(q => {
            if (!searchVal) return true;
            const searchable = [
                getQuoteValue(q, ['cliente_nombre', 'nombre']),
                getQuoteValue(q, ['cliente_telefono', 'telefono']),
                getQuoteValue(q, ['correo', 'email']),
                getQuoteValue(q, ['tipo_equipo', 'equipo']),
                getQuoteValue(q, ['marca']),
                getQuoteValue(q, ['modelo']),
                getQuoteValue(q, ['problema_reportado', 'problema'])
            ].join(' ').toLowerCase();

            return searchable.includes(searchVal);
        })
        .sort((a, b) => {
            if (sortValue === 'fecha_asc') return new Date(getQuoteValue(a, ['fecha', 'fecha_creacion'], 0)) - new Date(getQuoteValue(b, ['fecha', 'fecha_creacion'], 0));
            if (sortValue === 'cliente_asc') return getQuoteValue(a, ['cliente_nombre', 'nombre']).localeCompare(getQuoteValue(b, ['cliente_nombre', 'nombre']));
            if (sortValue === 'estado_asc') return getQuoteValue(a, ['estado']).localeCompare(getQuoteValue(b, ['estado']));
            return new Date(getQuoteValue(b, ['fecha', 'fecha_creacion'], 0)) - new Date(getQuoteValue(a, ['fecha', 'fecha_creacion'], 0));
        });

    if (resultsCount) {
        resultsCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'solicitud' : 'solicitudes'}`;
    }

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr class="quote-empty-state"><td colspan="8" class="text-center">No hay cotizaciones con esos criterios.</td></tr>';
        return;
    }
    
    filtered.forEach(q => {
        const tr = document.createElement('tr');
        tr.className = 'quote-row';
        const fecha = getQuoteValue(q, ['fecha', 'fecha_creacion']);
        const cliente = getQuoteValue(q, ['cliente_nombre', 'nombre']);
        const telefono = getQuoteValue(q, ['cliente_telefono', 'telefono']);
        const equipo = getQuoteValue(q, ['tipo_equipo', 'equipo']);
        const marca = getQuoteValue(q, ['marca']);
        const modelo = getQuoteValue(q, ['modelo']);
        const problema = getQuoteValue(q, ['problema_reportado', 'problema']);
        
        let badgeClass = 'bg-primary';
        if (q.estado === 'Pendiente') badgeClass = 'bg-secondary';
        else if (q.estado === 'Contactado') badgeClass = 'bg-info';
        else if (q.estado === 'Cotizado') badgeClass = 'bg-warning';
        else if (q.estado === 'Aceptado') badgeClass = 'bg-success';
        else if (q.estado === 'Rechazado') badgeClass = 'bg-danger';
        
        const dateStr = fecha ? String(fecha).split('T')[0].split(' ')[0] : '';
        
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><strong>${cliente}</strong></td>
            <td>${telefono}</td>
            <td>${equipo}</td>
            <td>${marca} ${modelo}</td>
            <td>${problema}</td>
            <td><span class="badge ${badgeClass}">${q.estado}</span></td>
            <td>
                <button class="btn btn-xs btn-secondary quote-view-button" onclick="openQuoteDetail(${q.id})"><i class="fa-solid fa-eye"></i> Ver</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

window.openQuoteDetail = function(id) {
    const quote = APP_STATE.cotizaciones.find(q => q.id === id);
    if (!quote) return;
    const quoteDate = getQuoteValue(quote, ['fecha', 'fecha_creacion']);
    const contactValue = String(getQuoteValue(quote, ['medio_contacto', 'preferred_contact'], 'whatsapp')).toLowerCase();
    const contactLabel = contactValue.includes('call') || contactValue.includes('llamada')
        ? 'Llamada'
        : contactValue.includes('whatsapp')
            ? 'WhatsApp'
            : contactValue || 'No especificado';
    
    document.getElementById('quote-detail-id').value = quote.id;
    document.getElementById('quote-detail-date').textContent = formatOperationDateTime(quoteDate);
    document.getElementById('quote-detail-client').textContent = getQuoteValue(quote, ['cliente_nombre', 'nombre']);
    document.getElementById('quote-detail-phone').textContent = getQuoteValue(quote, ['cliente_telefono', 'telefono']);
    document.getElementById('quote-detail-contact').textContent = contactLabel;
    document.getElementById('quote-detail-device').textContent = getQuoteValue(quote, ['tipo_equipo', 'equipo']);
    document.getElementById('quote-detail-brand-model').textContent = `${getQuoteValue(quote, ['marca'])} ${getQuoteValue(quote, ['modelo'])}`;
    document.getElementById('quote-detail-problem').textContent = getQuoteValue(quote, ['problema_reportado', 'problema']);
    
    const badgeEl = document.getElementById('quote-detail-status-badge');
    badgeEl.textContent = quote.estado;
    let badgeClass = 'badge quote-status-badge bg-primary';
    if (quote.estado === 'Pendiente') badgeClass = 'badge quote-status-badge bg-secondary';
    else if (quote.estado === 'Contactado') badgeClass = 'badge quote-status-badge bg-info';
    else if (quote.estado === 'Cotizado') badgeClass = 'badge quote-status-badge bg-warning';
    else if (quote.estado === 'Aceptado') badgeClass = 'badge quote-status-badge bg-success';
    else if (quote.estado === 'Rechazado') badgeClass = 'badge quote-status-badge bg-danger';
    badgeEl.className = badgeClass;
    
    document.getElementById('quote-detail-status').value = quote.estado;
    document.getElementById('quote-detail-observations').value = quote.observaciones_internas || '';
    
    const convertBtn = document.getElementById('btn-convert-quote');
    if (quote.estado === 'Aceptado' || quote.orden_id) {
        convertBtn.disabled = true;
        convertBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Convertido en Orden`;
    } else {
        convertBtn.disabled = false;
        convertBtn.innerHTML = `<i class="fa-solid fa-file-signature"></i> Convertir en Orden`;
    }
    
    const photosDiv = document.getElementById('quote-detail-photos');
    photosDiv.innerHTML = '';
    
    const photosList = getQuotePhotos(quote);
    
    if (photosList.length === 0) {
        document.getElementById('quote-detail-photos-container').style.display = 'none';
    } else {
        document.getElementById('quote-detail-photos-container').style.display = 'block';
        photosList.forEach(photoBase64 => {
            const img = document.createElement('img');
            img.src = photoBase64;
            img.className = 'quote-photo-thumbnail';
            
            img.addEventListener('click', () => {
                const w = window.open();
                w.document.write(`<img src="${photoBase64}" style="max-width:100%; max-height:100vh; display:block; margin:auto;">`);
            });
            
            photosDiv.appendChild(img);
        });
    }
    
    document.getElementById('quote-modal').classList.remove('hidden');
};

// ==========================================
// MÓDULO CALENDARIO (EVENTOS MANUALES)
// ==========================================
function getManualEventColor(event = {}) {
    const category = event.categoria || event.tipo_evento || event.category || event.extendedProps?.category || 'otro';
    const colors = {
        reunion: '#8b5cf6',
        personal: '#10b981',
        importante: '#ef4444',
        otro: '#3b82f6',
        general: '#3b82f6'
    };
    return event.color || colors[category] || '#3b82f6';
}

function setEventColorSelection(color = '#3b82f6') {
    const colorInput = document.getElementById('event-color');
    if (colorInput) colorInput.value = color;
    document.querySelectorAll('.calendar-color-swatch').forEach(button => {
        button.classList.toggle('active', button.dataset.eventColor === color);
    });
}

function resetManualEventModal(startValue = '') {
    const eventForm = document.getElementById('event-form');
    eventForm.reset();
    document.getElementById('event-id').value = '';
    document.getElementById('event-modal-title').innerText = 'Agregar evento';
    document.getElementById('btn-delete-event').classList.add('hidden');
    document.getElementById('event-all-day').checked = false;
    document.getElementById('event-category').value = 'otro';
    setEventColorSelection('#3b82f6');
    if (startValue) document.getElementById('event-start').value = startValue;
}

function syncAllDayEventFields() {
    const allDay = document.getElementById('event-all-day');
    const start = document.getElementById('event-start');
    const end = document.getElementById('event-end');
    if (!allDay?.checked || !start?.value) return;

    const day = start.value.slice(0, 10);
    start.value = `${day}T09:00`;
    end.value = `${day}T18:00`;
}

function initCalendarioEvents() {
    const eventModal = document.getElementById('event-modal');
    const eventForm = document.getElementById('event-form');
    
    document.getElementById('btn-close-event-modal').addEventListener('click', () => eventModal.classList.add('hidden'));
    document.getElementById('btn-cancel-event').addEventListener('click', () => eventModal.classList.add('hidden'));
    
    document.getElementById('btn-add-event-modal').addEventListener('click', () => {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        resetManualEventModal(now.toISOString().slice(0, 16));
        eventModal.classList.remove('hidden');
    });

    document.querySelectorAll('.calendar-color-swatch').forEach(button => {
        button.addEventListener('click', () => setEventColorSelection(button.dataset.eventColor));
    });

    document.getElementById('event-all-day')?.addEventListener('change', syncAllDayEventFields);
    document.getElementById('event-start')?.addEventListener('change', syncAllDayEventFields);
    document.getElementById('event-category')?.addEventListener('change', (event) => {
        setEventColorSelection(getManualEventColor({ categoria: event.target.value }));
    });

    eventForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('event-id').value;
        const isEditing = id !== '';
        syncAllDayEventFields();
        
        const data = {
            titulo: document.getElementById('event-title').value.trim(),
            descripcion: document.getElementById('event-desc').value.trim(),
            fecha_inicio: document.getElementById('event-start').value,
            fecha_fin: document.getElementById('event-end').value || null,
            categoria: document.getElementById('event-category').value,
            color: document.getElementById('event-color').value
        };
        
        try {
            let url = `${BASE_API_URL}/eventos`;
            let method = 'POST';
            if (isEditing) {
                url = `${BASE_API_URL}/eventos/${id}`;
                method = 'PUT';
            }
            
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                alert(isEditing ? 'Evento actualizado.' : 'Evento guardado.');
                eventModal.classList.add('hidden');
                loadAllData();
            } else {
                const err = await response.json();
                alert('Error al guardar: ' + err.error);
            }
        } catch (err) {
            console.error(err);
        }
    });

    document.getElementById('btn-delete-event').addEventListener('click', async () => {
        const id = document.getElementById('event-id').value;
        if (confirm('¿Está seguro de eliminar este evento?')) {
            try {
                const response = await fetch(`${BASE_API_URL}/eventos/${id}`, {
                    method: 'DELETE'
                });
                if (response.ok) {
                    alert('Evento eliminado.');
                    eventModal.classList.add('hidden');
                    loadAllData();
                } else {
                    const err = await response.json();
                    alert('Error al eliminar: ' + err.error);
                }
            } catch (err) {
                console.error(err);
            }
        }
    });
}

function buildLocalCalendarFallbackEvents() {
    return APP_STATE.ordenes
        .filter(o => o.status !== 'Cancelado')
        .map(o => {
            const start = o.estimatedDate || o.dateIn;
            if (!start) return null;
            return {
                id: `order-${o.id}`,
                title: `${o.folio} ? ${o.clientName}`,
                start,
                allDay: true,
                color: getCalendarStatusColor(o.status),
                extendedProps: {
                    type: 'order',
                    orderId: o.id,
                    folio: o.folio,
                    cliente: o.clientName,
                    equipo: `${o.deviceType || 'Equipo'} ${o.brand || ''} ${o.model || ''}`.trim(),
                    estado: o.status,
                    fecha_entrega: o.estimatedDate || null
                }
            };
        })
        .filter(Boolean);
}

function getCalendarStatusColor(status) {
    return getOrderStatusTheme(status).color;
}

function renderCalendario() {
    const calendarEl = document.getElementById('full-calendar-container');
    if (!calendarEl) return;

    const events = (Array.isArray(APP_STATE.eventos) && APP_STATE.eventos.length > 0
        ? APP_STATE.eventos
        : buildLocalCalendarFallbackEvents())
        .map(event => {
            const props = event.extendedProps || {};
            const estado = props.estado || event.estado;
            const isOrderEvent = props.type === 'order' || event.source === 'order' || String(event.id || '').startsWith('order-');
            const isManualEvent = props.type === 'manual' || event.source === 'manual' || String(event.id || '').startsWith('event-') || event.tipo_evento;
            if (isManualEvent && !isOrderEvent) {
                return {
                    ...event,
                    color: getManualEventColor({
                        ...event,
                        category: props.category
                    })
                };
            }
            if (!isOrderEvent) return event;
            return {
                ...event,
                color: getCalendarStatusColor(estado)
            };
        });

    if (calendarInstance) {
        calendarInstance.destroy();
    }

    calendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'es',
        height: 'auto',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        buttonText: {
            today: 'Hoy',
            month: 'Mes',
            week: 'Semana',
            day: 'Día'
        },
        events,
        eventContent: function(arg) {
            const props = arg.event.extendedProps || {};
            if (props.type === 'manual') {
                return {
                    html: `
                        <div class="calendar-event-card">
                            <strong>${escapeHtml(arg.event.title)}</strong>
                            <span>${escapeHtml(props.description || '')}</span>
                            <em>${escapeHtml(props.category || 'Evento')}</em>
                        </div>
                    `
                };
            }
            return {
                html: `
                    <div class="calendar-event-card">
                        <strong>${escapeHtml(props.folio || arg.event.title)}</strong>
                        <span>${escapeHtml(props.cliente || '')}</span>
                        <small>${escapeHtml(props.equipo || '')}</small>
                        <em>${escapeHtml(props.estado || '')}</em>
                    </div>
                `
            };
        },
        eventDidMount: function(info) {
            const props = info.event.extendedProps || {};
            info.el.title = [
                props.folio,
                props.cliente,
                props.equipo,
                props.estado,
                props.fecha_entrega ? `Entrega: ${props.fecha_entrega}` : ''
            ].filter(Boolean).join(' | ');
        },
        eventClick: function(info) {
            const props = info.event.extendedProps || {};
            if (props.type === 'order') {
                editOrderDetails(props.orderId);
            } else if (props.type === 'manual') {
                openEditEventModal(props.eventId);
            } else if (props.type === 'quote' && typeof window.openQuoteDetail === 'function') {
                switchView('cotizaciones');
                window.openQuoteDetail(props.quoteId);
            }
        },
        dateClick: function(info) {
            const eventModal = document.getElementById('event-modal');
            resetManualEventModal(`${info.dateStr}T09:00`.substring(0, 16));
            eventModal.classList.remove('hidden');
        }
    });

    calendarInstance.render();
}

function openEditEventModal(eventId) {
    const event = APP_STATE.eventos.find(e => String(e.eventId || e.id).replace('event-', '') === String(eventId));
    if (!event) return;
    const props = event.extendedProps || event;
    const startValue = String(event.start || event.fecha_inicio || '').substring(0, 16);
    const endValue = String(event.end || event.fecha_fin || '').substring(0, 16);
    document.getElementById('event-id').value = eventId;
    document.getElementById('event-modal-title').innerText = 'Editar evento';
    document.getElementById('event-title').value = event.title || event.titulo || '';
    document.getElementById('event-desc').value = props.description || event.descripcion || '';
    document.getElementById('event-start').value = startValue;
    document.getElementById('event-end').value = endValue;
    document.getElementById('event-category').value = props.category || event.tipo_evento || 'otro';
    document.getElementById('event-all-day').checked = Boolean(startValue.endsWith('T09:00') && endValue.endsWith('T18:00'));
    setEventColorSelection(getManualEventColor({ ...event, category: props.category }));
    document.getElementById('btn-delete-event').classList.remove('hidden');
    document.getElementById('event-modal').classList.remove('hidden');
}

