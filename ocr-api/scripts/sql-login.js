const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cliConfigDirectory, getEntraSettings, readCliAccount, assertCliAccount, formatLoginError } = require('../sql-entra');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
let stage = 'configuration';

async function main() {
  const action = process.argv[2];
  if (!['login', 'logout'].includes(action)) throw new Error('Choose login or logout.');
  const settings = action === 'login' ? getEntraSettings(process.env) : null;
  stage = 'profile';
  if (action === 'logout' && !fs.existsSync(cliConfigDirectory)) {
    console.log('No SQL reader CLI profile exists.');
    return;
  }
  if (fs.existsSync(cliConfigDirectory)) {
    const info = fs.lstatSync(cliConfigDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid SQL reader CLI profile directory.');
  }
  process.umask(0o077);
  fs.mkdirSync(cliConfigDirectory, { mode: 0o700, recursive: true });
  fs.chmodSync(cliConfigDirectory, 0o700);
  // CLI login discovers subscriptions through ARM, even for a SQL-only user.
  // Complete ARM's interactive MFA first; the API requests its own SQL token.
  const args = action === 'login'
    ? ['login', '--tenant', settings.tenantId, '--allow-no-subscriptions',
      '--use-device-code', '--scope', 'https://management.core.windows.net//.default', '--output', 'none']
    : ['logout', '--output', 'none'];
  if (settings) {
    console.log(`Sign in as ${settings.username}. Open the Microsoft device-login page yourself.`);
    console.log('Do not share the device code. This uses a separate SQL reader CLI profile.');
  }
  stage = 'cli';
  const result = spawnSync('az', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      AZURE_CONFIG_DIR: cliConfigDirectory,
      AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off',
    },
  });
  if (result.error || result.status !== 0) throw new Error(`Azure CLI ${action} did not complete.`);
  if (settings) {
    stage = 'account';
    assertCliAccount(await readCliAccount(), settings);
    console.log('SQL reader CLI account verified. The API will also check SQL identity and permissions.');
  } else {
    console.log('Signed out of the SQL reader CLI profile. Browser and DBeaver sessions are separate.');
  }
}

main().catch((error) => {
  console.error(formatLoginError(error, stage));
  process.exitCode = 1;
});
