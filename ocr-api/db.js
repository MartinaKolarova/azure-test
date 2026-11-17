const sql = require('mssql');
const path = require('node:path');
const { AzureCliCredential } = require('@azure/identity');
const { buildDatabaseConfig } = require('./db-config');
const { createConnectionProvider } = require('./db-connection');
const { cliConfigDirectory, createReaderCredential } = require('./sql-entra');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { config, settings } = buildDatabaseConfig(process.env, (identity) => {
  // This process uses only the SQL reader's CLI profile, never ~/.azure.
  process.env.AZURE_CONFIG_DIR = cliConfigDirectory;
  return createReaderCredential(new AzureCliCredential({
    tenantId: identity.tenantId,
    processTimeoutInMs: 15000,
  }), identity);
});

const getConnection = createConnectionProvider(() => {
  const pool = new sql.ConnectionPool(config);
  pool.on('error', () => console.error('SQL connection pool error.'));
  return pool;
}, settings);

module.exports = {
  sql,
  getConnection,
};
