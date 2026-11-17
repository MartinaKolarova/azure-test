-- Run as database administrator, after successful Entra API and managed-identity
-- Functions tests, and after retiring any other consumers of the two old users.
-- Select and execute this entire file as ONE batch; do not execute single lines.
-- This script changes database users, not candidate data or Entra permissions.
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF @@TRANCOUNT <> 0
    THROW 51000, 'Finish the existing transaction before running this script.', 1;

IF DB_NAME() <> N'free-sql-db-5826968'
    THROW 51001, 'Wrong database. Connect to free-sql-db-5826968.', 1;

IF ISNULL(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CONTROL'), 0) <> 1
    THROW 51002, 'Use the database administrator connection, not the reader.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (
        SELECT 1 FROM sys.database_principals
        WHERE name = N'nordic-lumberjack-functions'
          AND type = 'E' AND authentication_type_desc = 'EXTERNAL'
    )
        THROW 51003, 'Expected Functions managed-identity database user is missing.', 1;

    IF (SELECT COUNT(*) FROM sys.database_principals
        WHERE name LIKE N'ocr-api-dev@%'
          AND type = 'E' AND authentication_type_desc = 'EXTERNAL') <> 1
        THROW 51004, 'Expected a single Entra API reader database user.', 1;

    IF EXISTS (
        SELECT 1 FROM sys.database_principals
        WHERE name IN (N'ocr_api_reader', N'ocr_functions_writer')
          AND (type <> 'S' OR authentication_type_desc <> 'DATABASE')
    )
        THROW 51005, 'An old account has an unexpected type. Nothing will be removed.', 1;

    -- DROP USER will fail if a user owns securables; do not transfer ownership
    -- or delete schemas automatically. A failure rolls back both removals.
    DROP USER IF EXISTS [ocr_api_reader];
    DROP USER IF EXISTS [ocr_functions_writer];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

SELECT COUNT(*) AS remaining_legacy_sql_users
FROM sys.database_principals
WHERE name IN (N'ocr_api_reader', N'ocr_functions_writer');
