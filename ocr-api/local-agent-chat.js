function main() {
  const { createRuntimeAgent } = require('./agent-runtime');
  const agent = createRuntimeAgent();
  const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => { closed = true; agent.reset(); });
  function ask() {
    if (closed) return;
    rl.question('\nTy: ', async (input) => {
      const question = input.trim();
      if (question.toLowerCase() === 'exit') { rl.close(); return; }
      if (question.toLowerCase() === 'reset') { agent.reset(); ask(); return; }
      if (!question) { ask(); return; }
      try {
        // Intentional answer for the user; no debug dump or raw SDK exception.
        const answer = await agent.runTurn(question);
        if (closed) agent.reset();
        else console.log('\nAgent:\n' + answer);
      } catch {
        console.error('Agent request failed. Check configuration and question length.');
      }
      ask();
    });
  }
  console.log('Lokální agent spuštěn. exit = konec, reset = vymazání kontextu.');
  ask();
}

if (require.main === module) {
  try { main(); } catch {
    console.error('Agent startup failed. Check local configuration.');
    process.exitCode = 1;
  }
}
