export function connectionDiagnostics(environment = globalThis, androidBridge = false) {
  const policy = environment.document?.permissionsPolicy || environment.document?.featurePolicy;
  const allowed = feature => { try { return policy?.allowsFeature ? policy.allowsFeature(feature) : null; } catch { return null; } };
  return { origin: environment.location?.origin || '', isSecureContext: environment.isSecureContext === true,
    navigatorSerial: Boolean(environment.navigator?.serial), navigatorUsb: Boolean(environment.navigator?.usb),
    androidBridge: Boolean(androidBridge), serialPolicy: allowed('serial'), usbPolicy: allowed('usb'),
    userActivation: environment.navigator?.userActivation?.isActive ?? null };
}

export function printerError(error, context = {}) {
  if (error?.printerDiagnostic) return error;
  const name = error?.name || 'Error', message = String(error?.message || '').slice(0, 1000);
  const { phase = 'connect', method = '', diagnostics = {} } = context;
  let explanation = message || 'No se pudo conectar la impresora.';
  if (name === 'SecurityError') {
    if (method === 'usb' && phase === 'open' && /access denied/i.test(message)) explanation = 'Windows denegó el acceso directo a la impresora USB. Con un controlador como usbprint utiliza QZ Tray o Impresión normal. No es un problema de HTTPS ni de permisos del sitio. Este dispositivo no volverá a intentarse automáticamente por USB en esta sesión.';
    else if (diagnostics.isSecureContext === false) explanation = 'Esta página no es un contexto seguro. Abre el sistema en localhost o HTTPS.';
    else if (diagnostics[method === 'usb' ? 'usbPolicy' : 'serialPolicy'] === false) explanation = 'La política de permisos de esta página bloquea el acceso al dispositivo.';
    else if (/gesture|activation/i.test(message)) explanation = 'El navegador requiere un clic directo para abrir el selector. Pulsa Conectar impresora.';
    else if (phase === 'claim') explanation = 'El navegador o el sistema impide reclamar la interfaz USB. Comprueba el controlador; el problema no es localhost.';
    else explanation = 'El navegador bloqueó esta operación. El contexto es seguro; revisa el detalle original y los permisos del sitio.';
  } else if (name === 'NotAllowedError') explanation = 'Permiso denegado para acceder a la impresora. Revisa los permisos del sitio o la política del navegador.';
  else if (phase === 'select' && ['AbortError', 'NotFoundError'].includes(name)) explanation = 'Selección cancelada: no se eligió una impresora. Puedes volver a conectar.';
  else if (name === 'AbortError') explanation = phase === 'write' ? 'Escritura interrumpida. Reconecta la impresora y comprueba si salió un ticket parcial.' : 'La operación del dispositivo se interrumpió. Revisa la conexión y vuelve a intentar.';
  else if (name === 'NotFoundError') explanation = 'Dispositivo no encontrado o desconectado. Revisa el cable y elige otra impresora.';
  else if (name === 'NotSupportedError') explanation = 'La API o la interfaz del dispositivo no es compatible con este método.';
  else if (name === 'InvalidStateError') explanation = /already open|busy|locked|in use/i.test(message)
    ? 'Puerto ocupado. Cierra otros programas o pestañas que utilicen la impresora.'
    : 'El dispositivo no está en un estado válido para esta operación. Desconecta y vuelve a conectar.';
  else if (name === 'NetworkError') explanation = phase === 'write'
    ? 'Escritura interrumpida: la impresora se desconectó o dejó de responder. Comprueba si salió un ticket parcial.'
    : phase === 'claim' ? 'No se pudo reclamar la interfaz USB. Puede estar ocupada por el controlador de Windows u otro programa. Usa Impresión normal si no permite acceso directo.'
      : 'Error al abrir el dispositivo: puede estar desconectado u ocupado por otro programa o controlador.';
  const result = new Error(explanation, { cause: error }); result.name = name;
  result.printerDiagnostic = { name, message, phase, method };
  return result;
}
