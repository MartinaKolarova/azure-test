const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,

  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

async function getConnection() {
  try {
    const pool = await sql.connect(config);
    return pool;
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
}

module.exports = {
  sql,
  getConnection,
};
