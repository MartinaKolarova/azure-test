const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Duplex } = require('node:stream');
const { createApp } = require('../app');
const { createAgent } = require('../agent');
const { redactContacts, toModelCandidates, modelQuestion, limits } = require('../model-data');

const record = {
  id: 7, candidate_id: '7', full_name: 'Testovací Kandidát',
  email: 'synthetic.person@example.invalid', phone: '+420 777 123 456',
  file_name: 'private-file-canary.pdf', cv_file_name: 'private-file-canary.pdf',
  status: 'CONTACT_DONE', created_at: 'private-date-canary', extra: 'unexpected-field-canary',
  ocr_text: 'Testovací Kandidát\nPraxe: těžba dřeva, motorová pila, 2019-2024.\nsynthetic.person@example.invalid\n+420 777 123 456\nAdresa: Tajná ulice 17\nhttps://example.invalid/profile',
};
const sensitive = ['synthetic.person', '777 123 456', 'private-file-canary', 'private-date-canary', 'unexpected-field-canary', 'Tajná ulice', 'example.invalid/profile'];
function assertPrivate(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of sensitive) assert.equal(text.includes(secret), false, `Unexpected synthetic marker: ${secret}`);
}

test('model projection allowlists fields, redacts OCR and preserves professional facts', () => {
  const result = toModelCandidates([record, { ...record, id: 'bad' }]);
  assert.equal(result.length, 1);
  assert.deepEqual(Object.keys(result[0]), ['id', 'full_name', 'profile']);
  assertPrivate(result);
  assert.match(result[0].profile, /motorová pila/);
  assert.match(result[0].profile, /2019-2024/);
  assert.equal(record.email, 'synthetic.person@example.invalid');
});

test('contact redaction handles variants, known unusual values and truncation boundaries', () => {
  for (const text of ['a @ example . invalid', 'a[at]example[dot]invalid', '+420 (777) 123-456', '７７７１２３４５６', 'a\u200b@example.invalid']) {
    assert.match(redactContacts(text), /odstraněn/);
    assert.notEqual(redactContacts(text), text);
  }
  const projected = toModelCandidates([{ ...record, email: 'unusual-contact-canary', ocr_text: 'x'.repeat(1795) + ' unusual-contact-canary' }]);
  assert.equal(projected[0].profile.includes('unus'), false);
  assert.ok(projected[0].profile.length <= limits.excerpt);
  assert.equal(toModelCandidates(Array.from({ length: 20 }, () => record)).length, 5);
  assert.equal(toModelCandidates([{ ...record, ocr_text: 'x'.repeat(10000) }], { detail: true })[0].profile.length, 4000);
});

test('invalid questions fail closed without reproducing input', () => {
  for (const value of [null, {}, '', ' ', 'x'.repeat(501)]) assert.throws(() => modelQuestion(value), /^Error: Invalid question\.$/);
  assertPrivate(modelQuestion('Porovnej synthetic.person@example.invalid'));
});

// Real Express/JSON middleware in memory: no listener, credentials or network.
function request(app, method, url, body, raw = false) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : raw ? body : JSON.stringify(body);
    const socket = new Duplex({ read() {}, write(chunk, encoding, done) { done(); } });
    socket.remoteAddress = '127.0.0.1';
    const req = new IncomingMessage(socket);
    req.method = method; req.url = url;
    req.headers = { host: 'localhost:3000', 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload).toString() };
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    const chunks = [];
    const originalEnd = res.end;
    res.end = function (chunk, ...args) {
      if (chunk) chunks.push(Buffer.from(chunk));
      originalEnd.call(this, chunk, ...args);
      socket.destroy();
      const text = Buffer.concat(chunks).toString();
      resolve({ status: res.statusCode, headers: res.getHeaders(), text, body: text ? JSON.parse(text) : null });
      return this;
    };
    res.on('error', reject);
    app.handle(req, res);
    req.push(payload || null);
    if (payload) req.push(null);
  });
}

function fixture({ failure, answer = 'Kandidát 7 má praxi s motorovou pilou.' } = {}) {
  const logs = [], sent = [], searches = [];
  const throwPrivate = () => { throw new Error(JSON.stringify(record)); };
  const app = createApp({
    logger: { error: (...args) => logs.push(args) }, deployment: 'synthetic',
    getConnection: async () => {
      if (failure === 'db') throwPrivate();
      return { request: () => ({ input() { return this; }, query: async () => ({ recordset: [record] }) }) };
    },
    searchClient: { search: async (query, options) => {
      searches.push({ query, options });
      if (failure === 'search') throwPrivate();
      return { results: (async function* () { for (let i = 0; i < 8; i++) yield { document: record, score: 1 }; })() };
    } },
    modelClient: { chat: { completions: { create: async (payload) => {
      sent.push(structuredClone(payload));
      if (failure === 'model') throwPrivate();
      return { choices: [{ message: { content: answer } }] };
    } } } },
  });
  return { app, logs, sent, searches };
}

test('RAG preview equals actual model messages and keeps all raw data out', async () => {
  const f = fixture();
  const input = { question: 'Porovnej synthetic.person@example.invalid' };
  const preview = await request(f.app, 'POST', '/candidates/rag', input);
  const answer = await request(f.app, 'POST', '/candidates/rag-answer', input);
  assert.equal(preview.status, 200); assert.equal(answer.status, 200);
  assert.equal(preview.body.retrieved_candidates_count, 3);
  assert.deepEqual(preview.body.messages, f.sent[0].messages);
  assertPrivate([preview.body, answer.body, f.sent, f.logs, f.searches]);
  assert.match(answer.body.answer, /motorovou pilou/);
  assert.equal(answer.headers['cache-control'], 'no-store');
});

test('search is bounded; original contacts and OCR remain available to UI', async () => {
  const f = fixture();
  const search = await request(f.app, 'POST', '/candidates/search', { query: 'pila' });
  assert.equal(search.body.length, 5); assertPrivate(search.body);
  for (const url of ['/candidates', '/candidates/7']) {
    const result = await request(f.app, 'GET', url);
    assert.equal(result.body[0].email, record.email);
    assert.equal(result.body[0].ocr_text, record.ocr_text);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(f.logs, []);
});

test('SQL, Search, model, parsing and unknown-route failures never log or echo payloads', async () => {
  for (const [failure, method, url] of [
    ['db', 'GET', '/candidates'], ['db', 'GET', '/candidates/7'],
    ['search', 'POST', '/candidates/search'], ['search', 'POST', '/candidates/rag'],
    ['model', 'POST', '/candidates/rag-answer'],
  ]) {
    const f = fixture({ failure });
    const result = await request(f.app, method, url, { question: 'pila', query: 'pila' });
    assert.equal(result.status, 500); assertPrivate([result, f.logs]);
    assert.equal(f.logs.length, 1);
  }
  const f = fixture();
  for (const [method, url, body, raw, status] of [
    ['POST', '/candidates/rag-answer', '{"synthetic.person@example.invalid":', true, 400],
    ['POST', '/candidates/rag-answer', 'x'.repeat(9000), true, 413],
    ['GET', '/candidates/rag-answer/synthetic.person@example.invalid', undefined, false, 404],
    ['GET', '/unknown/synthetic.person@example.invalid', undefined, false, 404],
    ['GET', '/candidates/not-a-number', undefined, false, 400],
    ['POST', '/candidates/rag-answer', { question: {} }, false, 400],
  ]) {
    const result = await request(f.app, method, url, body, raw);
    assert.equal(result.status, status); assertPrivate([result, f.logs]);
  }
  assert.equal(f.sent.length, 0);
});

test('RAG output redacts generated contacts too', async () => {
  const f = fixture({ answer: record.email });
  const result = await request(f.app, 'POST', '/candidates/rag-answer', { question: 'pila' });
  assertPrivate(result.body);
});

test('AI rate limit rejects excess requests without calling the model', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) {
    assert.equal((await request(f.app, 'POST', '/candidates/rag-answer', { question: 'pila' })).status, 200);
  }
  const result = await request(f.app, 'POST', '/candidates/rag-answer', { question: record.email });
  assert.equal(result.status, 429);
  assert.equal(f.sent.length, 10);
  assertPrivate([result, f.logs]);
});

function agentFixture(replies, fetchImpl = async () => ({ ok: true, json: async () => [record] })) {
  const sent = [], fetched = [];
  const agent = createAgent({ deployment: 'synthetic',
    fetchImpl: async (...args) => { fetched.push(args); return fetchImpl(...args); },
    modelClient: { chat: { completions: { create: async (payload) => {
      sent.push(structuredClone(payload));
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return { choices: [{ message: reply }] };
    } } } },
  });
  return { agent, sent, fetched };
}
const tool = (name, args, id = 'call_1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('agent search/detail results and replayed arguments pass through minimisation', async () => {
  const f = agentFixture([
    { content: record.email, tool_calls: [tool('search_candidates', { query: 'pila ' + record.email })] },
    { tool_calls: [tool('get_candidate_detail', { id: 7 })] },
    { content: 'Testovací Kandidát, ID 7: motorová pila.' },
  ]);
  assert.match(await f.agent.runTurn('pila ' + record.email), /motorová pila/);
  assertPrivate([f.sent, f.fetched]);
  assert.equal(f.fetched[0][0], 'http://localhost:3000/candidates/search');
  assert.equal(f.fetched[1][0], 'http://localhost:3000/candidates/7');
  const result = JSON.parse(f.sent[2].messages.at(-1).content);
  assert.deepEqual(Object.keys(result.candidates[0]), ['id', 'full_name', 'profile']);
});

test('agent tool failures, unknown tools and malformed arguments never replay error data', async () => {
  const f = agentFixture([
    { tool_calls: [tool('get_candidate_detail', { id: 7 }), tool(record.email, { private: record.email }, 'call_2'),
      { id: 'call_3', function: { name: 'search_candidates', arguments: '{' + record.email } }] },
    { content: 'Data nejsou dostupná.' },
  ], async () => { throw new Error(JSON.stringify(record)); });
  await f.agent.runTurn('porovnej');
  assertPrivate(f.sent);
  assert.equal(f.fetched.length, 1);
  assert.match(f.sent[1].messages.at(-3).content, /unavailable/);
});

test('agent caches duplicate tool results and bounds history without tool transcripts', async () => {
  const f = agentFixture([
    { tool_calls: [tool('get_candidate_detail', { id: 7 }), tool('get_candidate_detail', { id: 7 }, 'call_2')] },
    { content: 'První odpověď pro ID 7.' },
    ...Array.from({ length: 5 }, () => ({ content: 'Další odpověď.' })),
  ]);
  for (let i = 0; i < 5; i++) await f.agent.runTurn(`Dotaz ${i}`);
  assert.equal(f.fetched.length, 1);
  assert.equal(f.sent.at(-1).messages.length, 6);
  assert.equal(f.sent.at(-1).messages.some((m) => m.role === 'tool' || m.tool_calls), false);
  f.agent.reset();
  await f.agent.runTurn('Po resetu');
  assert.equal(f.sent.at(-1).messages.length, 2);
});

test('failed agent turns discard pending tool protocol and suppress provider errors', async () => {
  const f = agentFixture([{ tool_calls: [tool('get_candidate_detail', { id: 7 })] },
    new Error(JSON.stringify(record)), { content: 'Obnoveno.' }]);
  await assert.rejects(f.agent.runTurn('pila'), /^Error: Agent request failed\.$/);
  await f.agent.runTurn('znovu');
  assert.equal(f.sent.at(-1).messages.length, 2);
  assertPrivate(f.sent);
});

test('agent refuses excessive tool fanout and never sends context over its budget', async () => {
  const oversized = agentFixture([{ tool_calls: Array.from({ length: 6 }, (_, i) => tool('get_candidate_detail', { id: i + 1 }, `call_${i}`)) }]);
  assert.match(await oversized.agent.runTurn('pila'), /povoleném rozsahu/);
  assert.equal(oversized.fetched.length, 0);
  const f = agentFixture(Array.from({ length: 3 }, (_, step) => ({
    tool_calls: Array.from({ length: 5 }, (_, i) => tool('get_candidate_detail', { id: step * 5 + i + 1 }, `call_${i}`)),
  })), async (url) => ({ ok: true, json: async () => [{ ...record, id: Number(url.split('/').at(-1)), ocr_text: 'pila '.repeat(1000) }] }));
  assert.match(await f.agent.runTurn('porovnej'), /povoleném rozsahu/);
  assert.ok(f.sent.every((payload) => JSON.stringify(payload.messages).length <= 32000));
});

test('runtime suppresses SDK debug output even when verbose logging was requested', async () => {
  const { configureRuntimePrivacy, modelClientOptions } = require('../runtime-privacy');
  const keys = ['DEBUG', 'AZURE_LOG_LEVEL', 'OPENAI_LOG'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const logs = [];
  const methods = ['debug', 'log', 'info', 'warn', 'error'];
  const original = Object.fromEntries(methods.map((key) => [key, console[key]]));
  try {
    process.env.DEBUG = '*'; process.env.AZURE_LOG_LEVEL = 'verbose'; process.env.OPENAI_LOG = 'debug';
    configureRuntimePrivacy();
    assert.equal(process.env.DEBUG, '');
    assert.equal(require('@azure/logger').getLogLevel(), undefined);
    for (const key of methods) console[key] = (...args) => logs.push(args);
    const OpenAI = require('openai');
    const client = new OpenAI({ ...modelClientOptions, apiKey: 'synthetic-not-a-key',
      baseURL: 'http://model.invalid', maxRetries: 0,
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: record.email } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    await client.chat.completions.create({ model: 'synthetic', messages: [{ role: 'user', content: record.ocr_text }] });
    assert.deepEqual(logs, []);
  } finally {
    for (const key of methods) console[key] = original[key];
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});
