const { readerCheckSql, assertReaderPermissions } = require('./sql-entra');

function createConnectionProvider(createPool, settings) {
  if (!settings) throw new Error('Entra reader settings are required.');
  let pending;
  return function getConnection() {
    if (!pending) {
      pending = (async () => {
        const pool = createPool();
        try {
          await pool.connect();
          const result = await pool.request().query(readerCheckSql);
          assertReaderPermissions(result.recordset[0], settings);
          return pool;
        } catch (error) {
          await pool.close().catch(() => {});
          throw error;
        }
      })().catch(() => {
        pending = undefined;
        // Raw authentication errors can contain token/CLI details.
        throw new Error('Entra SQL connection failed. Check reader login, IDs, permissions and SQL network access.');
      });
    }
    return pending;
  };
}

module.exports = { createConnectionProvider };
