using System;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.Data.SqlClient;
using System.Text.RegularExpressions;

namespace ProcessImage
{
    public class ProcessCandidateData
    {
        [Function("ProcessCandidateData")]
        public async Task Run(
            [QueueTrigger("candidate-processing", Connection = "StorageConnection")]
            string candidateId,
            FunctionContext context)
        {
            var log = context.GetLogger("ProcessCandidateData");

            string connectionString =
                Environment.GetEnvironmentVariable("SqlConnection");

            if (string.IsNullOrEmpty(connectionString))
            {
                throw new Exception("SqlConnection is NULL");
            }

            if (!int.TryParse(candidateId, out int parsedCandidateId))
            {
                log.LogError($"Invalid candidate_id from queue: {candidateId}");
                return;
            }

            using (SqlConnection connection =
                new SqlConnection(connectionString))
            {
                await connection.OpenAsync();

                string selectSql = @"
                    SELECT ocr_text
                    FROM candidates
                    WHERE candidate_id = @candidate_id";

                string? ocrText = null;

                using (SqlCommand selectCommand =
                    new SqlCommand(selectSql, connection))
                {
                    selectCommand.Parameters.AddWithValue(
                        "@candidate_id",
                        parsedCandidateId);

                    object result =
                        await selectCommand.ExecuteScalarAsync();

                    if (result != null && result != DBNull.Value)
                    {
                        ocrText = result.ToString();
                    }
                }

                string status;
                string? profession;
                string? skills;
                string? email;
                string? phone;

                if (string.IsNullOrWhiteSpace(ocrText))
                {
                    status = "NO_OCR_TEXT";
                    profession = null;
                    skills = null;
                    email = null;
                    phone = null;
                }
                else
                {
                    status = "ENRICHED_CONTACT";
                    profession = "ENRICHMENT_TEST";
                    skills = "ocr_loaded";
                    email = ExtractEmail(ocrText);
                    phone = ExtractPhone(ocrText);
                }

                string updateSql = @"
                    UPDATE candidates
                    SET
                        email = @email,
                        phone = @phone,
                        profession = @profession,
                        skills = @skills,
                        status = @status
                    WHERE candidate_id = @candidate_id";

                using (SqlCommand updateCommand =
                    new SqlCommand(updateSql, connection))
                {
                    updateCommand.Parameters.AddWithValue(
                        "@candidate_id",
                        parsedCandidateId);

                    updateCommand.Parameters.AddWithValue(
                        "@email",
                        (object?)email ?? DBNull.Value);

                    updateCommand.Parameters.AddWithValue(
                        "@phone",
                        (object?)phone ?? DBNull.Value);

                    updateCommand.Parameters.AddWithValue(
                        "@profession",
                        (object?)profession ?? DBNull.Value);

                    updateCommand.Parameters.AddWithValue(
                        "@skills",
                        (object?)skills ?? DBNull.Value);

                    updateCommand.Parameters.AddWithValue(
                        "@status",
                        status);

                    int rowsAffected =
                        await updateCommand.ExecuteNonQueryAsync();

                    log.LogInformation(
                        $"CandidateId={candidateId}, OcrLoaded={!string.IsNullOrWhiteSpace(ocrText)}, Email={email}, Phone={phone}, RowsAffected={rowsAffected}");
                }
            }
        }

        private static string? ExtractEmail(string text)
        {
            Match match = Regex.Match(
                text,
                @"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}",
                RegexOptions.IgnoreCase
            );

            if (match.Success)
            {
                return match.Value.Trim();
            }

            return null;
        }

        private static string? ExtractPhone(string text)
        {
            Match labeledPhone = Regex.Match(
                text,
                @"(?im)^\s*(tel\.?|telefon|phone|mobile|mobil)\s*[:\-]?\s*(\+?\d[\d\s().\-]{6,}\d)"
            );

            if (labeledPhone.Success)
            {
                return NormalizePhone(labeledPhone.Groups[2].Value);
            }

            return null;
        }

        private static string? NormalizePhone(string rawPhone)
        {
            string trimmed = Regex.Replace(rawPhone.Trim(), @"\s+", " ");
            string digitsOnly = Regex.Replace(trimmed, @"\D", "");

            if (digitsOnly.Length < 9 || digitsOnly.Length > 15)
            {
                return null;
            }

            return trimmed;
        }
    }
}
