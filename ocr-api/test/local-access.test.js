const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createLocalAccessGuard } = require('../local-access');

function request(headers, port = 3000) {
  const result = { reachedHandler: false, status: undefined };
  const response = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  createLocalAccessGuard(port)({ headers }, response, () => {
    result.reachedHandler = true;
  });
  return result;
}

const allowed = [
  ['local CLI', { host: '127.0.0.1:3000' }],
  ['localhost CLI', { host: 'localhost:3000' }],
  ['direct navigation', { host: '127.0.0.1:3000', 'sec-fetch-site': 'none' }],
  ['same-origin API request', { host: 'localhost:3000', origin: 'http://localhost:3000' }],
  ['frontend on localhost', { host: 'localhost:3000', origin: 'http://localhost:5173' }],
  ['frontend on IPv4 loopback', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:5173' }],
  ['frontend using a different loopback name', {
    host: 'localhost:3000', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'cross-site',
  }],
  ['preview on localhost', { host: 'localhost:3000', origin: 'http://localhost:4173' }],
  ['preview on IPv4 loopback', { host: 'localhost:3000', origin: 'http://127.0.0.1:4173' }],
];

for (const [name, headers] of allowed) {
  test(`allows ${name}`, () => {
    assert.equal(request(headers).reachedHandler, true);
  });
}

const denied = [
  ['remote web origin', { host: '127.0.0.1:3000', origin: 'https://untrusted.example' }],
  ['opaque origin', { host: '127.0.0.1:3000', origin: 'null' }],
  ['unexpected frontend port', { host: 'localhost:3000', origin: 'http://localhost:5174' }],
  ['lookalike origin', { host: 'localhost:3000', origin: 'http://localhost:5173.untrusted.example' }],
  ['DNS rebinding host', { host: 'untrusted.example:3000' }],
  ['missing Host', {}],
  ['unexpected API port', { host: 'localhost:3001' }],
  ['cross-site image without Origin', { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }],
  ['forged forwarded host', { host: 'untrusted.example:3000', 'x-forwarded-host': 'localhost:3000' }],
  ['forged forwarded origin', {
    host: 'localhost:3000', origin: 'https://untrusted.example',
    'x-forwarded-host': 'localhost:5173',
  }],
];

for (const [name, headers] of denied) {
  test(`rejects ${name} before reaching the handler`, () => {
    const result = request(headers);
    assert.equal(result.status, 403);
    assert.equal(result.reachedHandler, false);
  });
}

test('uses the configured API port', () => {
  assert.equal(request({ host: 'localhost:3001' }, 3001).reachedHandler, true);
  assert.equal(request({ host: 'localhost:3000' }, 3001).status, 403);
});

test('accepts the implicit port only for HTTP port 80', () => {
  assert.equal(request({ host: 'localhost' }, 80).reachedHandler, true);
  assert.equal(request({ host: 'localhost' }, 3000).status, 403);
});

test('rejects invalid listener ports', () => {
  for (const port of [0, -1, 65536, 3000.5, NaN, '3000', '/tmp/api.sock']) {
    assert.throws(() => createLocalAccessGuard(port), /PORT/);
  }
});
