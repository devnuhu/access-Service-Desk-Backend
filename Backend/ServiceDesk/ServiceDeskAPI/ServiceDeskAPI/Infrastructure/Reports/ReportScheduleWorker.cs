using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Reports
{
    /// <summary>Checks every few minutes whether a scheduled report is due. The service decides (day, hour, window, once per period).</summary>
    public sealed class ReportScheduleWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ReportScheduleOptions _options;
        private readonly ILogger<ReportScheduleWorker> _logger;

        public ReportScheduleWorker(IServiceScopeFactory scopes, IOptions<ReportScheduleOptions> options, ILogger<ReportScheduleWorker> logger)
        {
            _scopes = scopes;
            _options = options.Value;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.WorkerEnabled) return;
            var interval = TimeSpan.FromMinutes(Math.Clamp(_options.CheckMinutes, 1, 60));
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    var sent = await scope.ServiceProvider.GetRequiredService<IReportScheduleService>().RunDueAsync(DateTime.UtcNow, stoppingToken);
                    if (sent > 0) _logger.LogInformation("Scheduled reports: {Count} sent", sent);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
                catch (Exception ex) { _logger.LogError(ex, "The scheduled report check failed; trying again later"); }

                try { await Task.Delay(interval, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }
}
