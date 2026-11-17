const { getEntraSettings } = require('./sql-entra');

function buildDatabaseConfig(env, makeCredential) {
  const mode = env.DB_AUTH_MODE || 'sql';
  const config = {
    server: env.DB_SERVER,
    database: env.DB_NAME,
    options: { encrypt: true, trustServerCertificate: false },
  };
  if (mode === 'entra') {
    const settings = getEntraSettings(env);
    config.authentication = {
      type: 'token-credential',
      options: { credential: makeCredential(settings) },
    };
    return { config, settings };
  }
  if (mode !== 'sql') throw new Error('DB_AUTH_MODE must be sql or entra.');
  // Explicit temporary migration path. Entra failures never fall back here.
  config.user = env.DB_USER;
  config.password = env.DB_PASSWORD;
  return { config, settings: null };
}

module.exports = { buildDatabaseConfig };
