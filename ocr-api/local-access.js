const frontendOrigins = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

function createLocalAccessGuard(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const hosts = new Set([
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    ...(port === 80 ? ['localhost', '127.0.0.1'] : []),
  ]);
  const origins = new Set(frontendOrigins);
  for (const host of hosts) origins.add(`http://${host}`);

  return function localAccessGuard(req, res, next) {
    // Validate the actual Host header, not proxy-supplied forwarded headers.
    const host = req.headers.host;
    if (typeof host !== 'string' || !hosts.has(host.toLowerCase())) {
      return res.status(403).json({ error: 'Local API host required.' });
    }

    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      return res.status(403).json({ error: 'Origin not allowed.' });
    }

    // Local CLI clients and direct navigation have no Origin. Block cross-site
    // browser requests such as embedded images that also omit that header.
    if (origin === undefined && req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'Cross-site request not allowed.' });
    }

    next();
  };
}

module.exports = { createLocalAccessGuard, frontendOrigins };
