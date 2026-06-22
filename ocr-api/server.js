const express = require('express');
const cors = require('cors');
const { getConnection } = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

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

    const pool = await getConnection();

    const result = await pool.request().input('searchText', `%${searchText}%`)
      .query(`
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
        WHERE
          (status IS NULL OR status <> 'DUPLICATE')
          AND (
            ocr_text LIKE @searchText
            OR full_name LIKE @searchText
            OR email LIKE @searchText
            OR phone LIKE @searchText
          )
        ORDER BY created_at DESC
      `);

    console.log(
      `Search "${searchText}" returned ${result.recordset.length} candidates`,
    );

    res.json(result.recordset);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Database error',
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
