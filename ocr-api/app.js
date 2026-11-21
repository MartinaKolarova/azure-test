'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createLocalAccessGuard, frontendOrigins } = require('./local-access');
const { candidateId, modelQuestion, toModelCandidates, ragMessages, redactContacts } = require('./model-data');

// Importing this module does not read configuration, connect or listen.
function createApp({ getConnection, searchClient, modelClient, deployment, port = 3000, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(createLocalAccessGuard(port));
  app.use(cors({ origin: frontendOrigins }));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '8kb' }));
  const aiLimiter = rateLimit({
    windowMs: 60000, max: 10,
    // One loopback application, one budget. Do not log validation errors that
    // interpolate attacker-controlled IP/forwarding header values.
    keyGenerator: () => 'local-api', validate: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many AI requests.' }),
  });

  const fail = (res, event, message) => {
    // Constant event names only. No errors, requests, records or SDK bodies.
    logger.error(event);
    res.status(500).json({ error: message });
  };

  async function search(query, top) {
    const results = await searchClient.search(query, {
      filter: "status ne 'DUPLICATE'",
      // Contact fields are used locally to remove exact values from free text.
      select: ['candidate_id', 'full_name', 'email', 'phone', 'ocr_text'], top,
    });
    const records = [];
    for await (const result of results.results) {
      records.push(result.document);
      if (records.length >= top) break;
    }
    return toModelCandidates(records);
  }

  app.get('/', (req, res) => res.send('OCR API is running'));
  app.get('/candidates', async (req, res) => {
    try {
      const pool = await getConnection();
      const result = await pool.request().query(`
        SELECT candidate_id AS id, cv_file_name AS file_name, full_name,
               email, phone, status, ocr_text, created_at
        FROM candidates
        WHERE status IS NULL OR status <> 'DUPLICATE'
        ORDER BY created_at DESC
      `);
      res.json(result.recordset);
    } catch { fail(res, 'candidate_list_failed', 'Database error'); }
  });

  // Text belongs in a POST body, never in access-log/browser-history URLs.
  app.post('/candidates/search', async (req, res) => {
    let query;
    try { query = modelQuestion(req.body?.query); }
    catch { return res.status(400).json({ error: 'Query must contain 1–500 characters.' }); }
    try { res.json(await search(query, 5)); }
    catch { fail(res, 'candidate_search_failed', 'Search error'); }
  });

  function ragHandler(preview) {
    return async (req, res) => {
      let question;
      try { question = modelQuestion(req.body?.question); }
      catch { return res.status(400).json({ error: 'Question must contain 1–500 characters.' }); }
      try {
        const candidates = await search(question, 3);
        const messages = ragMessages(question, candidates);
        if (preview) return res.json({ retrieved_candidates_count: candidates.length, candidates, messages });
        const completion = await modelClient.chat.completions.create({
          model: deployment, messages, max_completion_tokens: 1500, reasoning_effort: 'minimal',
        });
        res.json({
          retrieved_candidates_count: candidates.length,
          answer: redactContacts(completion.choices[0].message.content),
          candidates: candidates.map(({ id, full_name }) => ({ id, full_name })),
        });
      } catch { fail(res, preview ? 'rag_preview_failed' : 'rag_answer_failed', 'RAG request failed'); }
    };
  }
  app.post('/candidates/rag', ragHandler(true));
  app.post('/candidates/rag-answer', aiLimiter, ragHandler(false));

  app.get('/candidates/:id', async (req, res) => {
    const id = candidateId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid candidate ID.' });
    try {
      const pool = await getConnection();
      const result = await pool.request().input('id', id).query(`
        SELECT candidate_id AS id, cv_file_name AS file_name, full_name,
               email, phone, status, ocr_text, created_at
        FROM candidates WHERE candidate_id = @id
      `);
      res.json(result.recordset);
    } catch { fail(res, 'candidate_detail_failed', 'Database error'); }
  });

  // Override Express defaults: neither URLs nor parse errors may echo input
  // or reach the default stack/error logger.
  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return res.end();
    const status = error?.type === 'entity.too.large' ? 413
      : error?.type === 'entity.parse.failed' || error instanceof URIError ? 400 : 500;
    logger.error('request_rejected');
    res.status(status).json({ error: 'Request could not be processed.' });
  });
  return app;
}

module.exports = { createApp };
