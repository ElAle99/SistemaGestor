const transientCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', '57P01', '57P02', '57P03', '53300']);
function safeCode(error) {
  const code = error?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,30}$/.test(code) ? code : 'DB_UNAVAILABLE';
}
function isTransient(error) {
  return transientCodes.has(error?.code) || error?.message === 'Connection terminated unexpectedly' || error?.message === 'Connection terminated due to connection timeout' ||
    (error?.errors?.length > 0 && error.errors.every(isTransient));
}
async function retryStartup(check, { attempts = 3, delayMs = 1000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.error } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await check(); }
    catch (error) {
      log('Validación PostgreSQL:', safeCode(error), `intento ${attempt}/${attempts}`);
      if (!isTransient(error) || attempt === attempts) throw error;
      await sleep(delayMs * attempt);
    }
  }
}
function handlePoolErrors(pool) {
  pool.on?.('error', error => console.error('Conexión PostgreSQL inactiva descartada:', safeCode(error)));
}
function installShutdown(server, pool, { signalSource = process, timeoutMs = 10000 } = {}) {
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => { console.error('Tiempo de apagado agotado.'); signalSource.exit(1); }, timeoutMs);
    deadline.unref();
    server.close(async () => {
      try { await pool.end(); } catch { signalSource.exitCode = 1; }
      finally { clearTimeout(deadline); }
    });
    server.closeIdleConnections?.();
  };
  signalSource.once('SIGTERM', shutdown);
  signalSource.once('SIGINT', shutdown);
  return shutdown;
}
module.exports = { safeCode, isTransient, retryStartup, handlePoolErrors, installShutdown };
