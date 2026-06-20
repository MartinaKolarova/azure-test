using System;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.Data.SqlClient;
using System.Text.RegularExpressions;
using System.Linq;

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

                    using (SqlDataReader reader =
                        await selectCommand.ExecuteReaderAsync())
                    {
                        if (await reader.ReadAsync())
                        {
                            if (reader["ocr_text"] != DBNull.Value)
                            {
                                ocrText = reader["ocr_text"].ToString();
                            }

                        }
                    }
                }

                string status;
                string? fullName;
                string? email;
                string? phone;

if (string.IsNullOrWhiteSpace(ocrText))
{
    status = "NO_OCR_TEXT";
    fullName = null;
    email = null;
    phone = null;
}
else
{
  fullName = ExtractFullNameFromOcr(ocrText);
email = ExtractEmail(ocrText);
phone = ExtractPhone(ocrText);

if (!string.IsNullOrWhiteSpace(fullName)
    && !string.IsNullOrWhiteSpace(email)
    && !string.IsNullOrWhiteSpace(phone))
{
    status = "CONTACT_DONE";
}
else
{
    status = "CONTACT_PARTIAL";
}
}

                string updateSql = @"
                    UPDATE candidates
                    SET
                        full_name = @full_name,
                        email = @email,
                        phone = @phone,
                        status = @status
                    WHERE candidate_id = @candidate_id";

                using (SqlCommand updateCommand =
                    new SqlCommand(updateSql, connection))
                {
                    updateCommand.Parameters.AddWithValue(
                        "@candidate_id",
                        parsedCandidateId);

                    updateCommand.Parameters.AddWithValue(
                        "@full_name",
                        (object?)fullName ?? DBNull.Value);

                    updateCommand.Parameters.AddWithValue(
                        "@email",
                        (object?)email ?? DBNull.Value);

                    updateCommand.Parameters.AddWithValue(
                        "@phone",
                        (object?)phone ?? DBNull.Value);

                    updateCommand.Parameters.AddWithValue(
                        "@status",
                        status);

                    int rowsAffected =
                        await updateCommand.ExecuteNonQueryAsync();

                    log.LogInformation(
                        $"CandidateId={candidateId}, OcrLoaded={!string.IsNullOrWhiteSpace(ocrText)}, FullName={fullName}, Email={email}, Phone={phone}, RowsAffected={rowsAffected}");
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

       private static string? ExtractFullNameFromOcr(string text)
{
    string[] lines = text
        .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);

    foreach (string rawLine in lines.Take(20))
    {
        string line = CleanOcrLine(rawLine);

        if (string.IsNullOrWhiteSpace(line))
        {
            continue;
        }

        if (ShouldSkipFullNameLine(line))
        {
            continue;
        }

        if (IsLikelyFullName(line))
        {
            return line;
        }
    }

    return null;
}
private static string CleanOcrLine(string line)
{
    line = line.Trim();
    line = Regex.Replace(line, @"^[•\-–—\s]+", "");
    line = Regex.Replace(line, @"\s+", " ");

    return line.Trim();
}

private static bool ShouldSkipFullNameLine(string line)
{
    string lower = line.ToLowerInvariant();

    string[] skipWords =
    {
        "curriculum",
        "vitae",
        "resume",
        "životopis",
        "cv",
        "email",
        "e-mail",
        "phone",
        "telefon",
        "mobile",
        "mobil",
        "address",
        "adresa",
        "profile",
        "profil"
    };

    return skipWords.Any(lower.Contains);
}

private static bool IsLikelyFullName(string line)
{
    if (line.Length > 80)
    {
        return false;
    }

    string[] words = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);

    if (words.Length < 2 || words.Length > 4)
    {
        return false;
    }

    return Regex.IsMatch(
        line,
        @"^\p{Lu}[\p{L}'\-]+(?:\s+\p{Lu}[\p{L}'\-]+){1,3}$"
    );
}
    }
}
