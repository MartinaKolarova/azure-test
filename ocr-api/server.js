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
        id,
        file_name,
        ocr_text,
        detected_objects,
        created_at
      FROM photo_analysis
      ORDER BY created_at DESC
    `);
    console.log(`Returned ${result.recordset.length} records`);
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
          id,
          file_name,
          ocr_text,
          detected_objects,
          created_at
        FROM photo_analysis
        WHERE ocr_text LIKE @searchText
        ORDER BY created_at DESC
      `);

    console.log(
      `Search "${searchText}" returned ${result.recordset.length} records`,
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
          id,
          file_name,
          ocr_text,
          detected_objects,
          created_at
        FROM photo_analysis
        WHERE id = @id
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
