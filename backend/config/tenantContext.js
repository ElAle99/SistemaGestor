const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const validTenant = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(value) : null;
function withTenant(value, callback) {
  const negocioId = validTenant(value);
  if (!negocioId) throw new Error('La sesión no tiene un negocio válido.');
  return context.run({ negocioId }, callback);
}
const withSystemContext = callback => context.run({ system: true }, callback);
const currentTenant = () => context.getStore()?.negocioId || null;

// Dedicated connection per unit of work: session scope never crosses pooled connections.
function createTenantPool(nativePool) {
  const api = {
    async connect() {
      const client = await nativePool.connect();
      const release = client.release.bind(client);
      const tenant = currentTenant() || '';
      let active = false, automatic = false, failed = false, released = false;
      const start = async auto => {
        await client.query('BEGIN'); active = true; automatic = auto; failed = false;
        await client.query("SELECT set_config('app.negocio_id', $1, true)", [tenant]);
      };
      const wrapper = {
        async query(sql, ...params) {
          if (released) throw new Error('Connection already released');
          const command = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
          try {
            if (/^BEGIN\b/.test(command)) {
              if (active && automatic) { await client.query('COMMIT'); active = false; }
              if (!active) { await start(false); return { rows: [], rowCount: null, command: 'BEGIN' }; }
            }
            if (/^(COMMIT|ROLLBACK)\b/.test(command)) {
              const result = await client.query(sql, ...params); active = false; automatic = false; return result;
            }
            if (!active) await start(true);
            return await client.query(sql, ...params);
          } catch (error) { failed = true; throw error; }
        },
        release(error) {
        if (released) return;
        released = true;
          // Explicit unfinished transactions always roll back. SET LOCAL expires
          // at COMMIT/ROLLBACK; the socket is held until cleanup completes.
          const finish = active ? client.query(automatic && !failed && !error ? 'COMMIT' : 'ROLLBACK') : Promise.resolve();
          finish.then(() => release(error)).catch(cleanupError => release(cleanupError));
        }
      };
      return wrapper;
    },
    async query(...args) {
      const client = await api.connect();
      try { const result = await client.query(...args); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    end: () => nativePool.end(),
    on: (...args) => nativePool.on(...args)
  };
  return api;
}
module.exports = { withTenant, withSystemContext, currentTenant, validTenant, createTenantPool };
