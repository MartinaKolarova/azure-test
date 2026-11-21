'use strict';

function configureRuntimePrivacy() {
  // Run before importing SDKs: HTTP debug traces can include bodies and URLs.
  process.env.AZURE_LOG_LEVEL = '';
  process.env.DEBUG = '';
  process.env.OPENAI_LOG = 'off';
}

const modelClientOptions = Object.freeze({ logLevel: 'off' });
module.exports = { configureRuntimePrivacy, modelClientOptions };
