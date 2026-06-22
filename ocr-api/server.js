require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { getConnection } = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX_NAME,
  new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY),
);

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
