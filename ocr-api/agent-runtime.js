function createRuntimeAgent() {
  require('dotenv').config({ quiet: true });
  const { configureRuntimePrivacy, modelClientOptions } = require('./runtime-privacy');
  configureRuntimePrivacy();
  const OpenAI = require('openai');
  const { createAgent } = require('./agent');
  return createAgent({
    modelClient: new OpenAI({
      baseURL: process.env.AZURE_MODEL_BASE_URL,
      apiKey: process.env.AZURE_MODEL_API_KEY,
      ...modelClientOptions,
    }),
    deployment: process.env.AZURE_MODEL_DEPLOYMENT,
    apiBaseUrl: process.env.LOCAL_API_BASE_URL || 'http://localhost:3000',
  });
}
module.exports = { createRuntimeAgent };
