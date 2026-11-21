'use strict';

const { candidateId, modelQuestion, toModelCandidates, redactContacts, systemPrompt } = require('./model-data');

const tools = [
  { type: 'function', function: {
    name: 'search_candidates', description: 'Find up to five candidates using a professional-skills query. Use first when finding candidates.',
    parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 500 } }, required: ['query'], additionalProperties: false },
  } },
  { type: 'function', function: {
    name: 'get_candidate_detail', description: 'Get a limited professional profile by candidate ID for detailed comparison. Contacts and original OCR are available only in the local UI.',
    parameters: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'], additionalProperties: false },
  } },
];

function safeToolCall(call, index) {
  const id = /^[a-zA-Z0-9_-]{1,128}$/.test(call.id) ? call.id : `call_invalid_${index}`;
  try {
    const args = JSON.parse(call.function.arguments);
    if (call.function.name === 'search_candidates') {
      return { id, type: 'function', function: { name: 'search_candidates', arguments: JSON.stringify({ query: modelQuestion(args.query) }) } };
    }
    if (call.function.name === 'get_candidate_detail' && candidateId(args.id) !== null) {
      return { id, type: 'function', function: { name: 'get_candidate_detail', arguments: JSON.stringify({ id: candidateId(args.id) }) } };
    }
  } catch { /* Never replay malformed arguments or JSON parser exceptions. */ }
  return { id, type: 'function', function: { name: 'unsupported_tool', arguments: '{}' } };
}

function createAgent({ modelClient, deployment, apiBaseUrl = 'http://localhost:3000', fetchImpl = fetch }) {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Agent requires a loopback API URL.');
  }
  const base = url.origin;
  let history = [];

  async function execute(call) {
    try {
      const args = JSON.parse(call.function.arguments);
      let response;
      if (call.function.name === 'search_candidates') {
        response = await fetchImpl(`${base}/candidates/search`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: args.query }),
        });
      } else if (call.function.name === 'get_candidate_detail') {
        response = await fetchImpl(`${base}/candidates/${args.id}`);
      } else return { error: 'Unsupported tool or invalid arguments.' };
      if (!response.ok) return { error: 'Candidate data unavailable.' };
      // Enforce the boundary here even if an API returns unexpected/new fields.
      const records = await response.json();
      const detail = call.function.name === 'get_candidate_detail';
      const selected = detail && Array.isArray(records)
        ? records.filter((record) => candidateId(record?.id ?? record?.candidate_id) === args.id).slice(0, 1)
        : records;
      return { candidates: toModelCandidates(selected, { detail }) };
    } catch { return { error: 'Candidate data unavailable.' }; }
  }

  async function runTurn(input) {
    const question = modelQuestion(input);
    const messages = [
      { role: 'system', content: `${systemPrompt} Pro detail nebo porovnání použij get_candidate_detail. Neopakuj již získaný detail. Nepopisuj interní postup. Nepokládej otázky ani nenabízej další akce.` },
      ...history,
      { role: 'user', content: question },
    ];
    const cache = new Map();
    let calls = 0;
    const incomplete = 'Agent nedokončil odpověď v povoleném rozsahu. Zužte dotaz.';
    try {
      for (let step = 0; step < 8; step += 1) {
        if (JSON.stringify(messages).length > 32000) return incomplete;
        const completion = await modelClient.chat.completions.create({
          model: deployment, messages, tools, tool_choice: 'auto',
          max_completion_tokens: 900, reasoning_effort: 'minimal',
        });
        const message = completion.choices[0].message;
        if (!message.tool_calls?.length) {
          const answer = redactContacts(message.content).slice(0, 6000);
          // Only two completed exchanges survive a turn, never tool payloads.
          history = [...history, { role: 'user', content: question }, { role: 'assistant', content: answer }].slice(-4);
          return answer;
        }
        if (message.tool_calls.length > 5 || calls + message.tool_calls.length > 10) return incomplete;
        const safeCalls = message.tool_calls.map(safeToolCall);
        messages.push({ role: 'assistant', content: null, tool_calls: safeCalls });
        for (const call of safeCalls) {
          calls += 1;
          const key = JSON.stringify(call.function);
          if (!cache.has(key)) cache.set(key, await execute(call));
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(cache.get(key)) });
        }
      }
      return incomplete;
    } catch {
      // Keep prior completed turns; discard this turn's incomplete protocol.
      throw new Error('Agent request failed.');
    }
  }
  return { runTurn, reset() { history = []; } };
}

module.exports = { createAgent };
