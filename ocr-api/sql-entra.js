const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const cliConfigDirectory = path.join(__dirname, '.azure-sql');
const sqlScope = 'https://database.windows.net/.default';

class EntraConfigurationError extends Error {}

function formatLoginError(error, stage) {
  // Only locally generated configuration messages are safe to display.
  if (error instanceof EntraConfigurationError) return error.message;
  const messages = {
    configuration: 'Could not validate SQL login configuration.',
    profile: 'Could not prepare the private ocr-api/.azure-sql directory. Check its permissions.',
    cli: 'Azure CLI login/logout did not complete. Check that az is installed and review its output locally.',
    account: 'Could not verify the SQL reader account. Run npm run login:sql and select the configured reader account.',
  };
  return messages[stage] || 'SQL reader login/logout failed.';
}

function getEntraSettings(env) {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ['AZURE_TENANT_ID', 'DB_ENTRA_OBJECT_ID']) {
    if (!guid.test(env[key] || '')) {
      const problem = env[key] ? 'has an invalid format' : 'is missing or empty';
      throw new EntraConfigurationError(`${key} ${problem}. In ocr-api/.env, use the GUID in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. The value is not displayed.`);
    }
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(env.DB_ENTRA_USERNAME || '')) {
    throw new EntraConfigurationError('DB_ENTRA_USERNAME is missing or invalid. In ocr-api/.env, use the full reader account UPN (name@domain). The value is not displayed.');
  }
  return {
    tenantId: env.AZURE_TENANT_ID.toLowerCase(),
    objectId: env.DB_ENTRA_OBJECT_ID.toLowerCase(),
    username: env.DB_ENTRA_USERNAME.toLowerCase(),
  };
}

function assertCliAccount(account, settings) {
  if (account?.tenantId?.toLowerCase() !== settings.tenantId ||
      account?.user?.name?.toLowerCase() !== settings.username ||
      account?.user?.type?.toLowerCase() !== 'user') {
    throw new Error('SQL CLI profile has a different account. Run npm run login:sql as the reader.');
  }
}

async function readCliAccount() {
  const info = fs.lstatSync(cliConfigDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('SQL CLI profile must be a private directory. Run npm run login:sql.');
  }
  const { stdout } = await execFileAsync('az', [
    'account', 'show', '--query', '{tenantId:tenantId,user:user}', '--output', 'json',
    '--only-show-errors',
  ], {
    env: { ...process.env, AZURE_CONFIG_DIR: cliConfigDirectory },
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function createReaderCredential(upstream, settings, readAccount = readCliAccount) {
  return {
    async getToken(scopes, options) {
      const requested = Array.isArray(scopes) ? scopes : [scopes];
      if (requested.length !== 1 || requested[0] !== sqlScope) {
        throw new Error('This credential is restricted to Azure SQL.');
      }
      try {
        assertCliAccount(await readAccount(), settings);
      } catch {
        throw new Error('SQL reader login missing or incorrect. Run npm run login:sql.');
      }
      try {
        const token = await upstream.getToken(scopes, options);
        if (!token) throw new Error('No token returned.');
        return token;
      } catch {
        // Do not forward raw CLI/identity errors: they can contain auth details.
        throw new Error('Could not obtain a SQL reader token. Run npm run login:sql again.');
      }
    },
  };
}

const readerCheckSql = `
SELECT
    CASE WHEN DATALENGTH(sid) = 16
         THEN CONVERT(varchar(36), CONVERT(uniqueidentifier, sid)) END AS object_id,
    type_desc,
    HAS_PERMS_BY_NAME(N'dbo.candidates', 'OBJECT', 'SELECT') AS can_read,
    HAS_PERMS_BY_NAME(N'dbo.candidates', 'OBJECT', 'INSERT') AS can_insert,
    HAS_PERMS_BY_NAME(N'dbo.candidates', 'OBJECT', 'UPDATE') AS can_update,
    HAS_PERMS_BY_NAME(N'dbo.candidates', 'OBJECT', 'DELETE') AS can_delete,
    HAS_PERMS_BY_NAME(N'dbo.candidates', 'OBJECT', 'ALTER') AS can_alter,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CONTROL') AS can_control_database
FROM sys.database_principals
WHERE principal_id = USER_ID();`;

function assertReaderPermissions(row, settings) {
  if (!row || row.type_desc !== 'EXTERNAL_USER' ||
      row.object_id?.toLowerCase() !== settings.objectId || row.can_read !== 1 ||
      ['can_insert', 'can_update', 'can_delete', 'can_alter', 'can_control_database']
        .some((key) => row[key] !== 0)) {
    throw new Error('SQL identity or permissions differ from the expected read-only Entra account.');
  }
}

module.exports = {
  formatLoginError,
  cliConfigDirectory, sqlScope, getEntraSettings, assertCliAccount,
  readCliAccount, createReaderCredential, readerCheckSql, assertReaderPermissions,
};
