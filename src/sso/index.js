'use strict';
const config = require('../config');
const { syncDirectory } = require('./sync');

let provider;
function getProvider() {
  if (provider) return provider;
  if (config.sso.mode === 'portal') provider = require('./portal').create(config.sso);
  else if (config.sso.mode === 'mock') provider = require('./mock');
  else throw new Error(config.sso.configError || `SSO_MODE không hợp lệ: ${config.sso.mode}`);
  return provider;
}

async function runSync(db) {
  const dir = await getProvider().fetchDirectory();
  const result = syncDirectory(db, dir, { adminSsoIds: config.adminSsoIds, bootstrapEmails: config.bootstrapEmails });
  db.run(`INSERT INTO settings (key, value) VALUES ('sso_last_sync', datetime('now','localtime'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  return result;
}

module.exports = { getProvider, runSync };
