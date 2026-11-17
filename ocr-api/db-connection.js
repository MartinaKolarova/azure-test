const { readerCheckSql, assertReaderPermissions } = require('./sql-entra');

function createConnectionProvider(createPool, settings) {
  let pending;
  return function getConnection() {
    if (!pending) {
      pending = (async () => {
        const pool = createPool();
        try {
          await pool.connect();
          if (settings) {
            const result = await pool.request().query(readerCheckSql);
            assertReaderPermissions(result.recordset[0], settings);
          }
          return pool;
        } catch (error) {
          await pool.close().catch(() => {});
          throw error;
        }
      })().catch((error) => {
        pending = undefined;
        if (settings) {
          // Raw authentication errors can contain token/CLI details.
          throw new Error('Entra SQL connection failed. Check reader login, IDs, permissions and SQL network access.');
        }
        throw error;
      });
    }
    return pending;
  };
}

module.exports = { createConnectionProvider };
