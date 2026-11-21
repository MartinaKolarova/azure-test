async function main() {
  const question = process.argv.slice(2).join(' ');
  if (!question) {
    console.error('Použití: node local-agent.js "dotaz na profesní zkušenosti"');
    process.exitCode = 1;
    return;
  }
  const { createRuntimeAgent } = require('./agent-runtime');
  const agent = createRuntimeAgent();
  // Intentional user output, not diagnostic logging. Never print tool payloads.
  console.log(await agent.runTurn(question));
}

if (require.main === module) main().catch(() => {
  console.error('Agent request failed. Check configuration and question length.');
  process.exitCode = 1;
});
