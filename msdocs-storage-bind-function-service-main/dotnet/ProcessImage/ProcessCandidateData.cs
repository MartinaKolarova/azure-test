using System;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.Data.SqlClient;

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

            using (SqlConnection connection =
                new SqlConnection(connectionString))
            {
                await connection.OpenAsync();

                string sql = @"
                    UPDATE candidates
                    SET profession = @profession
                    WHERE candidate_id = @candidate_id";

                using (SqlCommand command =
                    new SqlCommand(sql, connection))
                {
                    command.Parameters.AddWithValue(
                        "@candidate_id",
                        int.Parse(candidateId));

                    command.Parameters.AddWithValue(
                        "@profession",
                        $"UPDATED_{candidateId}");

                    int rowsAffected =
                        await command.ExecuteNonQueryAsync();

                    log.LogInformation(
                        $"CandidateId={candidateId}, RowsAffected={rowsAffected}");
                }
            }
        }
    }
}
