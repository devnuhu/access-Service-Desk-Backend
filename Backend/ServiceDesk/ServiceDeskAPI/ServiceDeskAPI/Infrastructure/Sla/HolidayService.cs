using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Sla
{
    /// <summary>
    /// Keeps the SLA options' holiday list equal to "server settings + Holidays table". The options object is shared by every service that
    /// builds a BusinessClock, so replacing its list (never editing it in place) reaches them all without a restart.
    /// </summary>
    public static class HolidaySync
    {
        private static readonly ConditionalWeakTable<SlaOptions, List<string>> Baselines = new();

        private static List<string> BaselineOf(SlaOptions o) => Baselines.GetValue(o, x => (x.Holidays ?? new List<string>()).ToList());

        /// <summary>The holidays set in the server settings.</summary>
        public static List<DateOnly> Baseline(SlaOptions o)
        {
            var list = new List<DateOnly>();
            foreach (var h in BaselineOf(o))
                if (DateOnly.TryParse(h, CultureInfo.InvariantCulture, out var d)) list.Add(d);
            return list;
        }

        public static async Task ApplyAsync(AppDbContext db, SlaOptions o)
        {
            var baseline = BaselineOf(o);
            var dates = await db.Holidays.AsNoTracking().Select(h => h.Date).ToListAsync();
            o.Holidays = baseline.Concat(dates.Select(d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))).Distinct().ToList();
        }
    }

    public class HolidayService : IHolidayService
    {
        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IHttpContextAccessor _http;
        private readonly IOptions<SlaOptions> _sla;

        public HolidayService(AppDbContext db, IAuditService audit, IHttpContextAccessor http, IOptions<SlaOptions> sla)
        {
            _db = db;
            _audit = audit;
            _http = http;
            _sla = sla;
        }

        public async Task<List<HolidayDto>> ListAsync(int? year)
        {
            var rows = await _db.Holidays.AsNoTracking().ToListAsync();
            var list = rows.Select(h => new HolidayDto(h.Id, h.Date, h.Name, false)).ToList();
            foreach (var d in HolidaySync.Baseline(_sla.Value))
                if (list.All(x => x.Date != d)) list.Add(new HolidayDto(null, d, "Set in the server settings", true));
            return list.Where(h => !year.HasValue || h.Date.Year == year.Value).OrderBy(h => h.Date).ToList();
        }

        public async Task<(AdminResult Result, HolidayDto? Holiday)> CreateAsync(SaveHolidayRequest request, Guid? actorUserId)
        {
            var name = (request.Name ?? string.Empty).Trim();
            if (name.Length < 2 || name.Length > 100) return (AdminResult.Invalid("The name must be 2 to 100 characters."), null);
            if (request.Date.Year < 2000 || request.Date.Year > 2100) return (AdminResult.Invalid("Choose a date between the years 2000 and 2100."), null);
            if (await _db.Holidays.AnyAsync(h => h.Date == request.Date) || HolidaySync.Baseline(_sla.Value).Contains(request.Date))
                return (AdminResult.Conflict(request.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " is already a holiday."), null);

            var holiday = new Holiday { Id = Guid.NewGuid(), Date = request.Date, Name = name, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.Holidays.Add(holiday);
            Stage(AuditAction.ConfigurationChanged, holiday.Id, name, null, new { date = holiday.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), name });
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return (AdminResult.Conflict("That date is already a holiday."), null); }
            await HolidaySync.ApplyAsync(_db, _sla.Value);
            return (AdminResult.Ok(name + " added. The SLA clock skips that day."), new HolidayDto(holiday.Id, holiday.Date, name, false));
        }

        public async Task<AdminResult> DeleteAsync(Guid holidayId, Guid? actorUserId)
        {
            var holiday = await _db.Holidays.FirstOrDefaultAsync(h => h.Id == holidayId);
            if (holiday == null) return AdminResult.NotFound("Holiday not found.");
            _db.Holidays.Remove(holiday);
            Stage(AuditAction.ConfigurationChanged, holiday.Id, holiday.Name,
                new { date = holiday.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), holiday.Name }, null);
            await _db.SaveChangesAsync();
            await HolidaySync.ApplyAsync(_db, _sla.Value);
            return AdminResult.Ok(holiday.Name + " removed. The SLA clock counts that day again.");
        }

        private void Stage(AuditAction action, Guid id, string display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "Holiday", id, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Sla);
        }
    }

    /// <summary>Loads the holidays from the database when the API starts (in the background, so a migrating database never blocks start-up).</summary>
    public sealed class HolidayLoader : IHostedService
    {
        private readonly IServiceProvider _services;
        private readonly IOptions<SlaOptions> _sla;
        private readonly ILogger<HolidayLoader> _logger;
        private readonly CancellationTokenSource _stop = new();

        public HolidayLoader(IServiceProvider services, IOptions<SlaOptions> sla, ILogger<HolidayLoader> logger)
        {
            _services = services;
            _sla = sla;
            _logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            _ = Task.Run(LoadAsync);
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            _stop.Cancel();
            return Task.CompletedTask;
        }

        private async Task LoadAsync()
        {
            for (var attempt = 1; attempt <= 8 && !_stop.IsCancellationRequested; attempt++)
            {
                try
                {
                    using var scope = _services.CreateScope();
                    await HolidaySync.ApplyAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), _sla.Value);
                    return;
                }
                catch (Exception ex) when (!_stop.IsCancellationRequested)
                {
                    _logger.LogWarning(ex, "Loading the holidays failed (attempt {Attempt}); trying again shortly.", attempt);
                    try { await Task.Delay(TimeSpan.FromSeconds(5), _stop.Token); } catch (OperationCanceledException) { return; }
                }
            }
        }
    }
}