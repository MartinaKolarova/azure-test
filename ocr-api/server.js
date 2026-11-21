async function main() {
  require('dotenv').config({ quiet: true });
  const { configureRuntimePrivacy, modelClientOptions } = require('./runtime-privacy');
  configureRuntimePrivacy();
  const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
  const OpenAI = require('openai');
  const { getConnection } = require('./db');
  const { createApp } = require('./app');
  const port = Number(process.env.PORT || 3000);
  const app = createApp({
    getConnection, port,
    searchClient: new SearchClient(process.env.AZURE_SEARCH_ENDPOINT,
      process.env.AZURE_SEARCH_INDEX_NAME, new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY)),
    modelClient: new OpenAI({
      baseURL: process.env.AZURE_MODEL_BASE_URL,
      apiKey: process.env.AZURE_MODEL_API_KEY,
      ...modelClientOptions,
    }),
    deployment: process.env.AZURE_MODEL_DEPLOYMENT,
  });
  const server = app.listen(port, '127.0.0.1', () => console.log('Local API ready.'));
  server.on('error', () => {
    console.error('API listener failed.');
    process.exitCode = 1;
  });
}

if (require.main === module) main().catch(() => {
  console.error('API startup failed. Check local configuration.');
  process.exitCode = 1;
});
