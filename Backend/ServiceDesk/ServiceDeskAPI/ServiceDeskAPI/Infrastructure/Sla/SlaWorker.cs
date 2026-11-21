using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Sla
{
    /// <summary>Settings under "Sla". Defaults: Lagos working hours 08:00-17:00 Monday to Friday; warning at 50%, overdue at 100%, Head of Department at 150%.</summary>
    public class SlaOptions
    {
        public bool WorkerEnabled { get; set; } = true;
        /// <summary>How often the open tickets are checked.</summary>
        public int CheckMinutes { get; set; } = 5;
        /// <summary>Hours ahead of UTC (Lagos is 1, with no daylight saving).</summary>
        public int UtcOffsetHours { get; set; } = 1;
        public int WorkdayStartHour { get; set; } = 8;
        public int WorkdayEndHour { get; set; } = 17;
        public string WorkDays { get; set; } = "Mon,Tue,Wed,Thu,Fri";
        /// <summary>Public holidays as yyyy-MM-dd. The clock does not run on these days.</summary>
        public List<string> Holidays { get; set; } = new();
        public int WarnPercent { get; set; } = 50;
        /// <summary>Business hours a case worker has to acknowledge or answer a ticket after it is assigned to them. 0 switches the check off.</summary>
        public int FirstResponseHours { get; set; } = 4;
        public int L1Percent { get; set; } = 100;
        public int L2Percent { get; set; } = 150;
        /// <summary>Only tickets raised on or after this date (UTC, yyyy-MM-dd) are tracked. Empty tracks all. Set it on go-live so old tickets do not trigger alerts.</summary>
        public string TrackFrom { get; set; } = string.Empty;
    }

    /// <summary>Runs the SLA check every CheckMinutes.</summary>
    public sealed class SlaWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly SlaOptions _options;
        private readonly ILogger<SlaWorker> _logger;

        public SlaWorker(IServiceScopeFactory scopes, IOptions<SlaOptions> options, ILogger<SlaWorker> logger)
        {
            _scopes = scopes;
            _options = options.Value;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.WorkerEnabled) return;
            var interval = TimeSpan.FromMinutes(Math.Clamp(_options.CheckMinutes, 1, 60));
            try { await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    var sent = await scope.ServiceProvider.GetRequiredService<ISlaService>().CheckAsync(DateTime.UtcNow, stoppingToken);
                    if (sent > 0) _logger.LogInformation("SLA check: {Count} ticket(s) moved to a new level", sent);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "SLA check failed; trying again later");
                }

                try { await Task.Delay(interval, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }
}