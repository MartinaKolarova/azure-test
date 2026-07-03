require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { getConnection } = require('./db');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');

const app = express();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
});

app.use('/candidates/rag-answer', aiLimiter);
app.use(
  cors({
    origin: 'http://localhost:5173',
  }),
);
app.use(express.json());

const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX_NAME,
  new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY),
);

const modelClient = new OpenAI({
  baseURL: process.env.AZURE_MODEL_BASE_URL,
  apiKey: process.env.AZURE_MODEL_API_KEY,
});

app.get('/', (req, res) => {
  res.send('OCR API is running');
});

app.get('/candidates', async (req, res) => {
  try {
    const pool = await getConnection();

    const result = await pool.request().query(`
      SELECT
        candidate_id AS id,
        cv_file_name AS file_name,
        full_name,
        email,
        phone,
        status,
        ocr_text,
        created_at
      FROM candidates
      WHERE status IS NULL
         OR status <> 'DUPLICATE'
      ORDER BY created_at DESC
    `);

    console.log(`Returned ${result.recordset.length} candidates`);

    res.json(result.recordset);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Database error',
    });
  }
});

app.get('/candidates/search/:text', async (req, res) => {
  try {
    const searchText = req.params.text;

    const searchResults = await searchClient.search(searchText, {
      filter: "status ne 'DUPLICATE'",
      select: [
        'candidate_id',
        'cv_file_name',
        'full_name',
        'email',
        'phone',
        'status',
        'ocr_text',
      ],
      top: 50,
    });

    const candidates = [];

    for await (const result of searchResults.results) {
      const document = result.document;

      candidates.push({
        id: document.candidate_id,
        file_name: document.cv_file_name,
        full_name: document.full_name,
        email: document.email,
        phone: document.phone,
        status: document.status,
        ocr_text: document.ocr_text,
        score: result.score,
      });
    }

    console.log(
      `Azure AI Search "${searchText}" returned ${candidates.length} candidates`,
    );

    res.json(candidates);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Azure AI Search error',
    });
  }
});
app.get('/candidates/rag/:question', async (req, res) => {
  try {
    const question = req.params.question?.trim();

    if (!question || question.length > 500) {
      return res.status(400).json({
        error: 'Question is required and must be shorter than 500 characters.',
      });
    }
    const searchResults = await searchClient.search(question, {
      filter: "status ne 'DUPLICATE'",
      select: [
        'candidate_id',
        'cv_file_name',
        'full_name',
        'email',
        'phone',
        'status',
        'ocr_text',
      ],
      top: 3,
    });

    const candidates = [];

    for await (const result of searchResults.results) {
      const document = result.document;

      candidates.push({
        id: document.candidate_id,
        file_name: document.cv_file_name,
        full_name: document.full_name,
        email: document.email,
        phone: document.phone,
        status: document.status,
        ocr_text: document.ocr_text,
        score: result.score,
      });
    }

    const context = candidates
      .map((candidate, index) => {
        const shortenedOcrText = candidate.ocr_text
          ? candidate.ocr_text.slice(0, 2500)
          : 'No OCR text available.';

        return `
Candidate ${index + 1}
ID: ${candidate.id}
Name: ${candidate.full_name || 'Unknown'}
Email: ${candidate.email || 'Unknown'}
Phone: ${candidate.phone || 'Unknown'}
Status: ${candidate.status || 'Unknown'}
File: ${candidate.file_name || 'Unknown'}
Search score: ${candidate.score}

Candidate text:
${shortenedOcrText}
`;
      })
      .join('\n---\n');

    const promptForModel = `
You are helping evaluate candidates for a lumberjack role.

User question:
${question}

Use only the candidate data below.
Do not invent missing facts.
If the data is insufficient, say that clearly.
Answer in Czech.
Compare the candidates briefly and explain which one looks most relevant.

Candidate data:
${context}
`;

    res.json({
      question,
      retrieved_candidates_count: candidates.length,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        file_name: candidate.file_name,
        full_name: candidate.full_name,
        email: candidate.email,
        phone: candidate.phone,
        status: candidate.status,
        score: candidate.score,
      })),
      prompt_for_model: promptForModel,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'RAG preview error',
    });
  }
});

app.get('/candidates/rag-answer/:question', aiLimiter, async (req, res) => {
  try {
    const question = req.params.question?.trim();

    if (!question || question.length > 500) {
      return res.status(400).json({
        error: 'Question is required and must be shorter than 500 characters.',
      });
    }
    const searchResults = await searchClient.search(question, {
      filter: "status ne 'DUPLICATE'",
      select: [
        'candidate_id',
        'cv_file_name',
        'full_name',
        'status',
        'ocr_text',
      ],
      top: 3,
    });

    const candidates = [];

    for await (const result of searchResults.results) {
      const document = result.document;

      candidates.push({
        id: document.candidate_id,
        file_name: document.cv_file_name,
        full_name: document.full_name,
        status: document.status,
        ocr_text: document.ocr_text,
        score: result.score,
      });
    }

    const context = candidates
      .map((candidate, index) => {
        const shortenedOcrText = candidate.ocr_text
          ? candidate.ocr_text.slice(0, 1800)
          : 'No OCR text available.';

        return `
Kandidát ${index + 1}
ID: ${candidate.id}
Jméno: ${candidate.full_name || 'Neznámé'}
Soubor: ${candidate.file_name || 'Neznámý'}
Search score: ${candidate.score}

Text životopisu:
${shortenedOcrText}
`;
      })
      .join('\n---\n');

    const completion = await modelClient.chat.completions.create({
      model: process.env.AZURE_MODEL_DEPLOYMENT,
      messages: [
        {
          role: 'system',
          content:
            'Jsi asistent pro vyhodnocování kandidátů. Odpovídej pouze podle dodaných dat. Nevymýšlej chybějící informace. Pokud data nestačí, řekni to jasně. Odpovídej česky.',
        },
        {
          role: 'user',
          content: `
Otázka:
${question}

Dostupná data kandidátů:
${context}

Úkol:
Odpověz česky, stručně a přehledně.

Použij tento formát:

1. Shrnutí
Krátce shrň, co z dodaných dat vyplývá.

2. Porovnání kandidátů
U každého relevantního kandidáta uveď:
- jméno
- relevantní zkušenosti
- slabší nebo chybějící informace

3. Doporučení
Uveď nejvhodnějšího kandidáta podle dodaných dat a stručně vysvětli proč.

Pravidla:
- Používej pouze dodaná data.
- Nevymýšlej chybějící fakta.
- Pokud některá informace v datech není, napiš "v dodaných datech neuvedeno".
`,
        },
      ],
      max_completion_tokens: 1500,
      reasoning_effort: 'minimal',
    });

    res.json({
      question,
      retrieved_candidates_count: candidates.length,
      answer: completion.choices[0].message.content,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        file_name: candidate.file_name,
        full_name: candidate.full_name,
        status: candidate.status,
        score: candidate.score,
      })),
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'RAG answer error',
    });
  }
});

app.get('/candidates/:id', async (req, res) => {
  try {
    const candidateId = req.params.id;

    const pool = await getConnection();

    const result = await pool.request().input('id', candidateId).query(`
        SELECT
          candidate_id AS id,
          cv_file_name AS file_name,
          full_name,
          email,
          phone,
          status,
          ocr_text,
          created_at
        FROM candidates
        WHERE candidate_id = @id
      `);

    res.json(result.recordset);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Database error',
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
