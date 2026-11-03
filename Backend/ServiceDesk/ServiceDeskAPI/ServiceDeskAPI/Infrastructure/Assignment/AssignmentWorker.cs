using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Assignment
{
    /// <summary>Settings under "Assignment" (BRD FR-7.4). Defaults follow the BRD.</summary>
    public class AssignmentOptions
    {
        /// <summary>How often the queue is tried again (FR-3.6: 5 minutes).</summary>
        public int RetryMinutes { get; set; } = 5;
        public int WeightCritical { get; set; } = 3;
        public int WeightHigh { get; set; } = 2;
        public int WeightMedium { get; set; } = 1;
        public int WeightLow { get; set; } = 1;
        /// <summary>Turns the background retry off (the engine still runs when a ticket is raised).</summary>
        public bool WorkerEnabled { get; set; } = true;
    }

    /// <summary>A single-slot wake-up: many pokes while the queue is running collapse into one more pass.</summary>
    public sealed class AssignmentSignal : IAssignmentSignal
    {
        private readonly SemaphoreSlim _poked = new(0, 1);

        public void Poke()
        {
            try { _poked.Release(); }
            catch (SemaphoreFullException) { /* already poked */ }
        }

        public Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken) => _poked.WaitAsync(timeout, cancellationToken);
    }

    /// <summary>Runs the assignment queue every RetryMinutes, and soon after a poke.</summary>
    public sealed class AssignmentWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly IAssignmentSignal _signal;
        private readonly AssignmentOptions _options;
        private readonly ILogger<AssignmentWorker> _logger;

        public AssignmentWorker(IServiceScopeFactory scopes, IAssignmentSignal signal, Microsoft.Extensions.Options.IOptions<AssignmentOptions> options, ILogger<AssignmentWorker> logger)
        {
            _scopes = scopes;
            _signal = signal;
            _options = options.Value;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.WorkerEnabled) return;
            var interval = TimeSpan.FromMinutes(Math.Clamp(_options.RetryMinutes, 1, 60));
            // Give the app a moment to finish starting (migrations, seeding)
            try { await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    var assigned = await scope.ServiceProvider.GetRequiredService<IAssignmentService>().ProcessQueueAsync(stoppingToken);
                    if (assigned > 0) _logger.LogInformation("Assignment queue: {Count} ticket(s) assigned", assigned);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Assignment queue pass failed; trying again later");
                }

                try { await _signal.WaitAsync(interval, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }
}