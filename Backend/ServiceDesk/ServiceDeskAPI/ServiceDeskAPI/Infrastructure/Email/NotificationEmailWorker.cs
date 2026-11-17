using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// Sends the email copy of notifications and records the outcome on the notification row, so an email is sent once and never lost.
    /// Two ways in: the queue (a notification was just saved: sent at once) and a sweep every minute (anything still Pending: a failed
    /// attempt, or a restart). One instance of the API is assumed (one IIS site); a gate makes the two ways safe against each other.
    /// </summary>
    public sealed class NotificationEmailWorker : BackgroundService
    {
        public const int MaxAttempts = 5;
        private static readonly TimeSpan SweepEvery = TimeSpan.FromSeconds(60);
        private static readonly TimeSpan GiveUpAfter = TimeSpan.FromDays(3);

        private readonly NotificationMailQueue _queue;
        private readonly IServiceScopeFactory _scopes;
        private readonly IConfiguration _config;
        private readonly ILogger<NotificationEmailWorker> _logger;
        private readonly SemaphoreSlim _gate = new(1, 1);

        public NotificationEmailWorker(NotificationMailQueue queue, IServiceScopeFactory scopes, IConfiguration config, ILogger<NotificationEmailWorker> logger)
        {
            _queue = queue;
            _scopes = scopes;
            _config = config;
            _logger = logger;
        }

        protected override Task ExecuteAsync(CancellationToken stoppingToken) => Task.WhenAll(ReadQueueAsync(stoppingToken), SweepAsync(stoppingToken));

        private async Task ReadQueueAsync(CancellationToken ct)
        {
            try
            {
                await foreach (var mail in _queue.ReadAllAsync(ct))
                {
                    if (!mail.NotificationId.HasValue) continue;
                    try { await ProcessAsync(mail.NotificationId.Value, false, ct); }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                    catch (Exception ex) { _logger.LogWarning(ex, "A notification email could not be processed; the sweep will try again."); }
                }
            }
            catch (OperationCanceledException) { /* the app is stopping */ }
        }

        private async Task SweepAsync(CancellationToken ct)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(30), ct);
                while (!ct.IsCancellationRequested)
                {
                    try
                    {
                        List<Guid> due;
                        using (var scope = _scopes.CreateScope())
                        {
                            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                            var cutoff = DateTime.UtcNow.AddMinutes(-1);
                            due = await db.InAppNotifications.AsNoTracking()
                                .Where(n => n.EmailState == NotificationEmailState.Pending && n.CreatedAt <= cutoff)
                                .OrderBy(n => n.CreatedAt).Select(n => n.Id).Take(100).ToListAsync(ct);
                        }
                        foreach (var id in due) await ProcessAsync(id, true, ct);
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                    catch (Exception ex) { _logger.LogWarning(ex, "The notification email sweep failed; it will run again."); }
                    await Task.Delay(SweepEvery, ct);
                }
            }
            catch (OperationCanceledException) { /* the app is stopping */ }
        }

        /// <summary>Sends the email copy of one notification if it is still Pending. Safe to call twice: the second call does nothing.</summary>
        public async Task ProcessAsync(Guid notificationId, bool fromSweep, CancellationToken ct = default)
        {
            await _gate.WaitAsync(ct);
            try
            {
                using var scope = _scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var n = await db.InAppNotifications.FirstOrDefaultAsync(x => x.Id == notificationId, ct);
                if (n == null || n.EmailState != NotificationEmailState.Pending) return;

                var now = DateTime.UtcNow;
                if (fromSweep && n.EmailLastAttemptAt.HasValue && n.EmailLastAttemptAt.Value > now.AddMinutes(-5 * Math.Max(1, n.EmailAttempts))) return; // waiting before the next try
                if (n.CreatedAt < now - GiveUpAfter) { await FinishAsync(db, n, NotificationEmailState.Failed, "Too old to send.", ct); return; }
                if (EmailSetup.Provider(_config) == "Off") { await FinishAsync(db, n, NotificationEmailState.Skipped, "Email is off.", ct); return; }
                if (!NotificationMailPolicy.ShouldSend(_config, n.Category)) { await FinishAsync(db, n, NotificationEmailState.Skipped, "Switched off in settings.", ct); return; }

                var person = await db.Users.AsNoTracking().Where(u => u.Id == n.RecipientUserId && u.IsActive)
                    .Select(u => new { u.FullName, u.UserName, u.CorporateEmail, u.Email }).FirstOrDefaultAsync(ct);
                var to = person == null ? null : (!string.IsNullOrWhiteSpace(person.CorporateEmail) ? person.CorporateEmail : person.Email)?.Trim();
                if (person == null || string.IsNullOrWhiteSpace(to) || !to.Contains('@'))
                {
                    await FinishAsync(db, n, NotificationEmailState.Skipped, "The person is blocked or has no email address.", ct);
                    return;
                }

                var frontend = (_config["Frontend:Url"] ?? "http://localhost:5174").Split(',')[0].Trim();
                var parts = NotificationEmail.Build(person.FullName ?? person.UserName ?? string.Empty, n.Title, n.Message, n.Type, n.Category, n.DeepLinkUrl, frontend);
                var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
                var (ok, message) = await email.SendEmailAsync(to, parts.Subject, parts.Html);

                n.EmailAttempts++;
                n.EmailLastAttemptAt = DateTime.UtcNow;
                if (ok)
                {
                    n.EmailState = NotificationEmailState.Sent;
                    n.EmailSentAt = DateTime.UtcNow;
                    n.EmailLastError = null;
                }
                else
                {
                    n.EmailLastError = Trim(message);
                    if (n.EmailAttempts >= MaxAttempts) n.EmailState = NotificationEmailState.Failed;
                    _logger.LogWarning("The notification email to user {UserId} was not sent (attempt {Attempt}): {Message}", n.RecipientUserId, n.EmailAttempts, message);
                }
                await db.SaveChangesAsync(ct);
            }
            finally { _gate.Release(); }
        }

        private static async Task FinishAsync(AppDbContext db, InAppNotification n, NotificationEmailState state, string reason, CancellationToken ct)
        {
            n.EmailState = state;
            n.EmailLastError = reason;
            await db.SaveChangesAsync(ct);
        }

        private static string? Trim(string? text) => text == null ? null : (text.Length > 300 ? text.Substring(0, 300) : text);
    }
}