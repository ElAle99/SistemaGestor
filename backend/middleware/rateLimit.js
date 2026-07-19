const buckets = new Map();

function getRequestKey(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max, keyPrefix = 'default' }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.method}:${req.originalUrl}:${getRequestKey(req)}`;
    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo mas tarde.' });
    }

    return next();
  };
}

module.exports = { rateLimit };
