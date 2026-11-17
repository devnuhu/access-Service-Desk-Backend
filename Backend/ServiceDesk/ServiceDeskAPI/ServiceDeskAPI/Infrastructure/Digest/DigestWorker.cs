using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Digest
{
    /// <summary>Checks every few minutes whether a digest is due. The service decides (working day, send window, once per period).</summary>
    public sealed class DigestWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly DigestOptions _options;
        private readonly ILogger<DigestWorker> _logger;

        public DigestWorker(IServiceScopeFactory scopes, IOptions<DigestOptions> options, ILogger<DigestWorker> logger)
        {
            _scopes = scopes;
            _options = options.Value;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.WorkerEnabled) return;
            var interval = TimeSpan.FromMinutes(Math.Clamp(_options.CheckMinutes, 1, 60));
            try { await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    var sent = await scope.ServiceProvider.GetRequiredService<IDigestService>().RunAsync(DateTime.UtcNow, stoppingToken);
                    if (sent > 0) _logger.LogInformation("Digests: {Count} sent", sent);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
                catch (Exception ex) { _logger.LogError(ex, "The digest check failed; trying again later"); }

                try { await Task.Delay(interval, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }
}
