const buckets = new Map();
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 60000);
cleanup.unref();

function getRequestKey(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max, keyPrefix = 'default' }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.method}:${getRequestKey(req)}`;
    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo mas tarde.' });
    }

    return next();
  };
}

module.exports = { rateLimit };
