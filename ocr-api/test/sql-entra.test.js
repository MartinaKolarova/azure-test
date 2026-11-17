const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildDatabaseConfig } = require('../db-config');
const { createConnectionProvider } = require('../db-connection');
const { sqlScope, getEntraSettings, assertCliAccount, createReaderCredential, assertReaderPermissions, formatLoginError } = require('../sql-entra');

const env = {
  DB_AUTH_MODE: 'entra', DB_SERVER: 'synthetic.database.windows.net', DB_NAME: 'synthetic',
  AZURE_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  DB_ENTRA_OBJECT_ID: '22222222-2222-2222-2222-222222222222',
  DB_ENTRA_USERNAME: 'reader@example.invalid',
  DB_USER: 'old-sql-user', DB_PASSWORD: 'synthetic-unused-password',
};
const settings = getEntraSettings(env);
const account = { tenantId: settings.tenantId, user: { name: settings.username, type: 'user' } };
const reader = {
  object_id: settings.objectId, type_desc: 'EXTERNAL_USER', can_read: 1,
  can_insert: 0, can_update: 0, can_delete: 0, can_alter: 0, can_control_database: 0,
};

test('login diagnostics identify invalid settings without exposing their values', () => {
  for (const key of ['AZURE_TENANT_ID', 'DB_ENTRA_OBJECT_ID', 'DB_ENTRA_USERNAME']) {
    for (const value of ['', 'synthetic-sensitive-value']) {
      assert.throws(() => getEntraSettings({ ...env, [key]: value }), (error) => {
        const message = formatLoginError(error, 'configuration');
        assert.ok(message.includes(key));
        assert.equal(message.includes('synthetic-sensitive-value'), false);
        return true;
      });
    }
  }
});

test('login diagnostics suppress raw errors at every phase', () => {
  for (const stage of ['configuration', 'profile', 'cli', 'account', 'unknown']) {
    const message = formatLoginError(new Error('synthetic-sensitive-value'), stage);
    assert.equal(message.includes('synthetic-sensitive-value'), false);
    assert.ok(message.length > 0);
  }
});

test('Entra config excludes SQL passwords and keeps certificate validation', () => {
  const credential = { getToken() {} };
  const { config } = buildDatabaseConfig(env, () => credential);
  assert.equal(config.authentication.type, 'token-credential');
  assert.equal(config.authentication.options.credential, credential);
  assert.equal('user' in config, false);
  assert.equal('password' in config, false);
  assert.deepEqual(config.options, { encrypt: true, trustServerCertificate: false });
});

test('invalid Entra settings never fall back to SQL passwords', () => {
  for (const key of ['AZURE_TENANT_ID', 'DB_ENTRA_OBJECT_ID', 'DB_ENTRA_USERNAME']) {
    assert.throws(() => buildDatabaseConfig({ ...env, [key]: '' }, () => ({})));
  }
  assert.throws(() => buildDatabaseConfig({ ...env, DB_AUTH_MODE: 'entraa' }, () => ({})));
});

test('legacy SQL mode is rejected even with SQL credentials present', () => {
  for (const mode of ['sql', '', 'entraa']) {
    assert.throws(() => buildDatabaseConfig({ ...env, DB_AUTH_MODE: mode }, () => {
      assert.fail('Invalid mode must fail before credential construction');
    }), /Only DB_AUTH_MODE=entra/);
  }
});

test('omitting the migration switch still requires Entra and never SQL passwords', () => {
  const withoutMode = { ...env };
  delete withoutMode.DB_AUTH_MODE;
  const { config, settings: identity } = buildDatabaseConfig(withoutMode, () => ({}));
  assert.equal(config.authentication.type, 'token-credential');
  assert.equal('user' in config, false);
  assert.equal('password' in config, false);
  assert.equal(identity.objectId, settings.objectId);
  delete withoutMode.AZURE_TENANT_ID;
  assert.throws(() => buildDatabaseConfig(withoutMode, () => ({})), /AZURE_TENANT_ID/);
});

test('pool cannot bypass SQL identity checks by omitting Entra settings', () => {
  assert.throws(() => createConnectionProvider(() => {
    assert.fail('No pool may be created');
  }, null), /Entra reader settings are required/);
});

test('CLI account must match tenant, user and account type', () => {
  assert.doesNotThrow(() => assertCliAccount(account, settings));
  for (const other of [
    { ...account, tenantId: env.DB_ENTRA_OBJECT_ID },
    { ...account, user: { name: 'admin@example.invalid', type: 'user' } },
    { ...account, user: { name: settings.username, type: 'servicePrincipal' } }, {},
  ]) assert.throws(() => assertCliAccount(other, settings));
});

test('wrong CLI user is rejected before acquiring a token', async () => {
  let called = false;
  const credential = createReaderCredential({ getToken() { called = true; } }, settings,
    async () => ({ ...account, user: { name: 'admin@example.invalid', type: 'user' } }));
  await assert.rejects(credential.getToken(sqlScope), /reader login/);
  assert.equal(called, false);
});

test('credential accepts only SQL scope and obtains fresh tokens through its provider', async () => {
  let calls = 0;
  const credential = createReaderCredential({ async getToken() {
    calls += 1;
    return { token: `synthetic-token-${calls}`, expiresOnTimestamp: Date.now() + 60000 };
  } }, settings, async () => account);
  await assert.rejects(credential.getToken('https://storage.azure.com/.default'), /restricted/);
  await assert.rejects(credential.getToken([sqlScope, 'other']), /restricted/);
  assert.equal(calls, 0);
  assert.equal((await credential.getToken(sqlScope)).token, 'synthetic-token-1');
  assert.equal((await credential.getToken([sqlScope])).token, 'synthetic-token-2');
});

test('raw identity errors cannot reach application logs', async () => {
  const credential = createReaderCredential({ async getToken() {
    throw new Error('synthetic-sensitive-output');
  } }, settings, async () => account);
  await assert.rejects(credential.getToken(sqlScope), (error) => {
    assert.equal(String(error).includes('synthetic-sensitive-output'), false);
    return true;
  });
});

test('SQL validation rejects wrong identity, write rights and unknown permissions', () => {
  assert.doesNotThrow(() => assertReaderPermissions(reader, settings));
  for (const row of [undefined, { ...reader, type_desc: 'SQL_USER' },
    { ...reader, object_id: env.AZURE_TENANT_ID }, { ...reader, can_read: 0 }]) {
    assert.throws(() => assertReaderPermissions(row, settings));
  }
  for (const key of ['can_insert', 'can_update', 'can_delete', 'can_alter', 'can_control_database']) {
    assert.throws(() => assertReaderPermissions({ ...reader, [key]: 1 }, settings));
    assert.throws(() => assertReaderPermissions({ ...reader, [key]: null }, settings));
  }
});

function fakePool(row) {
  return {
    closed: false, checks: 0,
    async connect() {},
    request() { return { query: async () => {
      this.checks += 1;
      return { recordset: row ? [row] : [] };
    } }; },
    async close() { this.closed = true; },
  };
}

test('concurrent requests receive one verified pool', async () => {
  let created = 0;
  const pool = fakePool(reader);
  const getConnection = createConnectionProvider(() => { created += 1; return pool; }, settings);
  const results = await Promise.all([getConnection(), getConnection(), getConnection()]);
  assert.equal(created, 1);
  assert.equal(pool.checks, 1);
  assert.ok(results.every((result) => result === pool));
});

test('wrong SQL rights close the pool, with a clean retry after fixing login', async () => {
  const rejected = fakePool({ ...reader, can_control_database: 1 });
  const accepted = fakePool(reader);
  const pools = [rejected, accepted];
  const getConnection = createConnectionProvider(() => pools.shift(), settings);
  await assert.rejects(getConnection(), /Entra SQL connection failed/);
  assert.equal(rejected.closed, true);
  assert.equal(await getConnection(), accepted);
});

test('failed connect closes the pool and suppresses raw auth details', async () => {
  const pool = fakePool(reader);
  pool.connect = async () => { throw new Error('synthetic-sensitive-output'); };
  const getConnection = createConnectionProvider(() => pool, settings);
  await assert.rejects(getConnection(), (error) => {
    assert.equal(String(error).includes('synthetic-sensitive-output'), false);
    return true;
  });
  assert.equal(pool.closed, true);
  assert.equal(pool.checks, 0);
});
