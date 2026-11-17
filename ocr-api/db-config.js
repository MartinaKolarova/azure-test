const { getEntraSettings } = require('./sql-entra');

function buildDatabaseConfig(env, makeCredential) {
  const mode = env.DB_AUTH_MODE ?? 'entra';
  if (mode !== 'entra') throw new Error('Only DB_AUTH_MODE=entra is supported. SQL-password authentication has been retired.');
  const settings = getEntraSettings(env);
  const config = {
    server: env.DB_SERVER,
    database: env.DB_NAME,
    options: { encrypt: true, trustServerCertificate: false },
  };
  config.authentication = {
    type: 'token-credential',
    options: { credential: makeCredential(settings) },
  };
  return { config, settings };
}

module.exports = { buildDatabaseConfig };
