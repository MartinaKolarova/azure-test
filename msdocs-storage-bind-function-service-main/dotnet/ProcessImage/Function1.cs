using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.CognitiveServices.Vision.ComputerVision;
using Microsoft.Azure.CognitiveServices.Vision.ComputerVision.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.Data.SqlClient;

namespace ProcessImage
{
    public class ProcessImage
    {
        // Azure Function name and output Binding to Table Storage
[Function("ProcessImageUpload")]       
        // Trigger binding runs when an image is uploaded to the blob container below
        public async Task Run([BlobTrigger("imageanalysis/{name}", Connection = "StorageConnection")]Stream myBlob, string name, ILogger log)
        {
            // Get connection configurations
            string subscriptionKey = Environment.GetEnvironmentVariable("ComputerVisionKey");
            string endpoint = Environment.GetEnvironmentVariable("ComputerVisionEndpoint");
            
            string imgUrl = $"https://{ Environment.GetEnvironmentVariable("StorageAccountName")}.blob.core.windows.net/imageanalysis/{name}";

            ComputerVisionClient client = new ComputerVisionClient(new ApiKeyServiceClientCredentials(subscriptionKey)) { Endpoint = endpoint };

            // Get the analyzed image contents
var textContext = await AnalyzeImageContent(client, myBlob);

string connectionString =
    Environment.GetEnvironmentVariable("SqlConnection");

using (SqlConnection connection = new SqlConnection(connectionString))
{
    await connection.OpenAsync();

    string sql = @"
        INSERT INTO photo_analysis
        (file_name, ocr_text, created_at)
        VALUES
        (@file_name, @ocr_text, GETDATE())";

    using (SqlCommand command = new SqlCommand(sql, connection))
    {
        command.Parameters.AddWithValue("@file_name", name);
        command.Parameters.AddWithValue("@ocr_text", textContext);

        await command.ExecuteNonQueryAsync();
    }
}
        }

        static async Task<string> AnalyzeImageContent(ComputerVisionClient client, Stream fileStream)
        {
            // Analyze the file using Computer Vision Client
var textHeaders = await client.ReadInStreamAsync(fileStream);
            string operationLocation = textHeaders.OperationLocation;
            Thread.Sleep(2000);

            const int numberOfCharsInOperationId = 36;
            string operationId = operationLocation.Substring(operationLocation.Length - numberOfCharsInOperationId);

            // Read back the results from the analysis request
            ReadOperationResult results;
            do
            {
                results = await client.GetReadResultAsync(Guid.Parse(operationId));
            }
            while ((results.Status == OperationStatusCodes.Running ||
                results.Status == OperationStatusCodes.NotStarted));

            var textUrlFileResults = results.AnalyzeResult.ReadResults;

            // Assemble into readable string
            StringBuilder text = new StringBuilder();
            foreach (ReadResult page in textUrlFileResults)
            {
                foreach (Line line in page.Lines)
                {
                    text.AppendLine(line.Text);
                }
            }

            return text.ToString();
        }
    }
}
