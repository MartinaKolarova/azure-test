using System;
using System.Threading.Tasks;

namespace ProcessImage;

public static class SafeExecution
{
    public static async Task RunAsync(string failureEvent, Func<Task> operation)
    {
        try
        {
            await operation();
        }
        catch
        {
            // The Functions host logs unhandled exceptions. Preserve failure and
            // retries, but discard SDK/SQL messages, bodies, Data and inner errors.
            throw new InvalidOperationException(failureEvent);
        }
    }
}
