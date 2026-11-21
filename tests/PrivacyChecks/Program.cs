using ProcessImage;

var completed = false;
await SafeExecution.RunAsync("synthetic_failure", () => { completed = true; return Task.CompletedTask; });
if (!completed) throw new Exception("Success path was not executed.");

foreach (var mode in new[] { "sync", "async", "cancelled" })
{
    var failed = false;
    try
    {
        await SafeExecution.RunAsync("synthetic_failure", () =>
        {
            var error = new Exception("synthetic.person@example.invalid OCR_PRIVATE_CANARY",
                new Exception("PRIVATE_INNER_CANARY"));
            error.Data["body"] = "PRIVATE_BODY_CANARY";
            return mode switch
            {
                "async" => Task.FromException(error),
                "cancelled" => Task.FromCanceled(new CancellationToken(true)),
                _ => throw error,
            };
        });
    }
    catch (InvalidOperationException error)
    {
        failed = true;
        if (error.Message != "synthetic_failure" || error.InnerException != null || error.Data.Count != 0
            || error.ToString().Contains("CANARY") || error.ToString().Contains("example.invalid"))
            throw new Exception("Failure boundary leaked synthetic data.");
    }
    if (!failed) throw new Exception("Failure/retry signal was swallowed.");
}
Console.WriteLine("PASS: success and three failure modes; safe exception retains failure without payload or inner error.");
