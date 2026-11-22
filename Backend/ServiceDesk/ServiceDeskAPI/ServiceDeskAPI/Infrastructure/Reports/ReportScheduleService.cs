using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Sla;

namespace ServiceDeskAPI.Infrastructure.Reports
{
    /// <summary>
    /// Scheduled report emails (Step 9d). The report runs with the owner's own scope (ReportService), is attached as Excel or CSV and sent only to the owner.
    /// "Already sent" is kept on the schedule itself (LastPeriodKey), so a restart can never send a period twice.
    /// </summary>
    public sealed class ReportScheduleService : IReportScheduleService
    {
        private const int MaxRows = 20000;
        private const int MaxErrorLength = 480;

        private readonly AppDbContext _db;
        private readonly IReportService _reports;
        private readonly ISavedReportService _saved;
        private readonly IEmailService _email;
        private readonly IAuditService _audit;
        private readonly IConfiguration _config;
        private readonly SlaOptions _sla;
        private readonly ReportScheduleOptions _options;
        private readonly ILogger<ReportScheduleService> _logger;

        public ReportScheduleService(AppDbContext db, IReportService reports, ISavedReportService saved, IEmailService email, IAuditService audit,
            IConfiguration config, IOptions<SlaOptions> sla, IOptions<ReportScheduleOptions> options, ILogger<ReportScheduleService> logger)
        {
            _db = db;
            _reports = reports;
            _saved = saved;
            _email = email;
            _audit = audit;
            _config = config;
            _sla = sla.Value;
            _options = options.Value;
            _logger = logger;
        }

        private static readonly System.Text.RegularExpressions.Regex EmailShape = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", System.Text.RegularExpressions.RegexOptions.Compiled);

        private static List<string> DayNames(int mask) =>
            new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday }
                .Where(d => (mask & (1 << (int)d)) != 0).Select(d => d.ToString()).ToList();

        private static List<ReportRecipientDto> ParseCc(string? json)
        {
            try { return JsonSerializer.Deserialize<List<ReportRecipientDto>>(string.IsNullOrWhiteSpace(json) ? "[]" : json) ?? new(); }
            catch (JsonException) { return new(); }
        }

        private static ReportProblem Bad(string message) => new(400, message);

        private static string? Shorten(string? text) => text == null ? null : (text.Length > MaxErrorLength ? text.Substring(0, MaxErrorLength) : text);

        private static DateTime? Utc(DateTime? value) => value.HasValue ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc) : null;

        private ReportScheduleDto ToDto(ReportSchedule s, string reportName, BusinessClock clock)
        {
            DateTime? next = s.Enabled ? ReportScheduleTimes.NextUtc(s, DateTime.UtcNow, _sla.UtcOffsetHours, clock) : null;
            return new ReportScheduleDto
            {
                Id = s.Id, SavedReportId = s.SavedReportId, ReportName = reportName,
                Frequency = s.Frequency.ToString().ToLowerInvariant(),
                WeekDay = s.Frequency == ReportFrequency.Weekly ? s.WeekDay.ToString() : null,
                WeekDays = s.Frequency == ReportFrequency.Custom ? DayNames(s.DaysMask) : null,
                Cc = ParseCc(s.CcJson),
                DayOfMonth = s.Frequency == ReportFrequency.Monthly ? s.DayOfMonth : (int?)null,
                SendHour = s.SendHour, Format = s.Format, Enabled = s.Enabled,
                NextRunAt = next, LastSentAt = Utc(s.LastSentAt), LastStatus = s.LastStatus, LastError = s.LastError,
                CreatedAt = DateTime.SpecifyKind(s.CreatedAt, DateTimeKind.Utc), UpdatedAt = Utc(s.UpdatedAt)
            };
        }

        private async Task<Dictionary<Guid, string>> NamesAsync(IEnumerable<Guid> reportIds)
        {
            var ids = reportIds.Distinct().ToList();
            return await _db.SavedReports.AsNoTracking().Where(r => ids.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.Name);
        }

        public async Task<(ReportProblem? Problem, List<ReportScheduleDto>? Schedules)> ListAsync(Guid userId, bool isSuperAdmin)
        {
            var (problem, _) = await _reports.CatalogueAsync(userId, isSuperAdmin);
            if (problem != null) return (problem, null);
            var mine = await _db.ReportSchedules.AsNoTracking().Where(s => s.OwnerUserId == userId).OrderBy(s => s.CreatedAt).ToListAsync();
            var names = await NamesAsync(mine.Select(s => s.SavedReportId));
            var clock = BusinessClock.From(_sla);
            return (null, mine.Select(s => ToDto(s, names.TryGetValue(s.SavedReportId, out var n) ? n : string.Empty, clock)).ToList());
        }

        public async Task<(ReportProblem? Problem, ReportScheduleDto? Schedule)> SaveAsync(Guid? id, SaveReportScheduleRequest request, Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles)
        {
            var (scopeProblem, _) = await _reports.CatalogueAsync(userId, isSuperAdmin);
            if (scopeProblem != null) return (scopeProblem, null);
            if (request == null) return (Bad("The schedule is missing."), null);

            if (!Enum.TryParse<ReportFrequency>((request.Frequency ?? string.Empty).Trim(), true, out var frequency) || !Enum.IsDefined(frequency))
                return (Bad("Frequency must be daily, weekly, monthly or custom."), null);
            if (request.SendHour < 0 || request.SendHour > 23) return (Bad("SendHour must be from 0 to 23 (Lagos time)."), null);
            var weekDay = DayOfWeek.Monday;
            if (frequency == ReportFrequency.Weekly
                && (!Enum.TryParse<DayOfWeek>((request.WeekDay ?? string.Empty).Trim(), true, out weekDay) || !Enum.IsDefined(weekDay)))
                return (Bad("WeekDay must be a day name such as Monday."), null);
            var daysMask = 0;
            if (frequency == ReportFrequency.Custom)
            {
                foreach (var dayName in request.WeekDays ?? new List<string>())
                {
                    if (!Enum.TryParse<DayOfWeek>((dayName ?? string.Empty).Trim(), true, out var chosen) || !Enum.IsDefined(chosen) || chosen == DayOfWeek.Saturday || chosen == DayOfWeek.Sunday)
                        return (Bad("WeekDays must be day names from Monday to Friday."), null);
                    daysMask |= 1 << (int)chosen;
                }
                if (daysMask == 0) return (Bad("Choose at least one weekday."), null);
            }
            var cc = new List<ReportRecipientDto>();
            foreach (var person in request.Cc ?? new List<ReportRecipientDto>())
            {
                var address = (person.Email ?? string.Empty).Trim().ToLowerInvariant();
                if (address.Length == 0) continue;
                if (address.Length > 254 || !EmailShape.IsMatch(address)) return (Bad("'" + address + "' is not a valid email address."), null);
                if (cc.Any(c => c.Email == address)) continue;
                var copyName = (person.Name ?? string.Empty).Trim();
                if (copyName.Length > 100) copyName = copyName.Substring(0, 100);
                cc.Add(new ReportRecipientDto { Name = copyName, Email = address });
            }
            if (cc.Count > 10) return (Bad("You can copy up to 10 people."), null);
            var dayOfMonth = 1;
            if (frequency == ReportFrequency.Monthly)
            {
                if (!request.DayOfMonth.HasValue || request.DayOfMonth.Value < 1 || request.DayOfMonth.Value > 28) return (Bad("DayOfMonth must be from 1 to 28."), null);
                dayOfMonth = request.DayOfMonth.Value;
            }
            var format = (request.Format ?? "xlsx").Trim().ToLowerInvariant();
            if (format != "xlsx" && format != "csv") return (Bad("Format must be xlsx or csv."), null);

            var (listProblem, visible) = await _saved.ListAsync(userId, isSuperAdmin, roles);
            if (listProblem != null || visible == null) return (listProblem ?? new ReportProblem(403, "Reports are not available to you."), null);
            var report = visible.FirstOrDefault(r => r.Id == request.SavedReportId);
            if (report == null) return (new ReportProblem(404, "Saved report not found."), null);

            ReportSchedule entity;
            if (id.HasValue)
            {
                var existing = await _db.ReportSchedules.FirstOrDefaultAsync(s => s.Id == id.Value && s.OwnerUserId == userId);
                if (existing == null) return (new ReportProblem(404, "Schedule not found."), null);
                entity = existing;
                entity.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                if (await _db.ReportSchedules.CountAsync(s => s.OwnerUserId == userId) >= Math.Max(1, _options.MaxPerPerson))
                    return (new ReportProblem(409, "You have " + _options.MaxPerPerson + " schedules. Delete one first."), null);
                entity = new ReportSchedule { Id = Guid.NewGuid(), OwnerUserId = userId, CreatedAt = DateTime.UtcNow };
                _db.ReportSchedules.Add(entity);
            }
            if (await _db.ReportSchedules.AnyAsync(s => s.OwnerUserId == userId && s.SavedReportId == request.SavedReportId && s.Id != entity.Id))
            {
                if (!id.HasValue) _db.Entry(entity).State = EntityState.Detached;
                return (new ReportProblem(409, "You already have a schedule for this report. Change that one instead."), null);
            }

            entity.SavedReportId = request.SavedReportId;
            entity.Frequency = frequency;
            entity.WeekDay = weekDay;
            entity.DayOfMonth = dayOfMonth;
            entity.SendHour = request.SendHour;
            entity.Format = format;
            entity.DaysMask = daysMask;
            entity.CcJson = JsonSerializer.Serialize(cc);
            entity.Enabled = request.Enabled;
            entity.StartsAfterUtc = DateTime.UtcNow;      // the first send is the next scheduled time after saving
            entity.PendingPeriodKey = null;
            entity.PendingAttempts = 0;
            entity.LastError = null;
            await _db.SaveChangesAsync();
            return (null, ToDto(entity, report.Name, BusinessClock.From(_sla)));
        }

        public async Task<ReportProblem?> DeleteAsync(Guid id, Guid userId)
        {
            var entity = await _db.ReportSchedules.FirstOrDefaultAsync(s => s.Id == id && s.OwnerUserId == userId);
            if (entity == null) return new ReportProblem(404, "Schedule not found.");
            _db.ReportSchedules.Remove(entity);
            await _db.SaveChangesAsync();
            return null;
        }

        // ---------------- the run ----------------

        public async Task<int> RunDueAsync(DateTime nowUtc, CancellationToken cancellationToken = default)
        {
            if (EmailSetup.Provider(_config) == "Off") return 0;   // email is not set up: send nothing and use up no period
            var clock = BusinessClock.From(_sla);
            var offset = _sla.UtcOffsetHours;
            var maxAttempts = Math.Max(1, _options.MaxAttempts);
            var ids = await _db.ReportSchedules.AsNoTracking().Where(s => s.Enabled).OrderBy(s => s.CreatedAt).Select(s => s.Id).ToListAsync(cancellationToken);
            var sent = 0;
            foreach (var id in ids)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var s = await _db.ReportSchedules.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
                    if (s == null || !s.Enabled) continue;
                    var due = ReportScheduleTimes.Due(s, nowUtc, offset, _options.WindowHours, clock);
                    if (due == null) continue;
                    var key = due.Value.Key;
                    if (s.LastPeriodKey == key) continue;
                    if (s.PendingPeriodKey != key) { s.PendingPeriodKey = key; s.PendingAttempts = 0; }
                    if (s.PendingAttempts >= maxAttempts)
                    {
                        s.LastPeriodKey = key;
                        s.LastStatus = "Failed";
                        await _db.SaveChangesAsync(cancellationToken);
                        continue;
                    }
                    if (s.PendingAttempts > 0 && s.LastAttemptAt.HasValue && s.LastAttemptAt.Value > nowUtc.AddMinutes(-10)) continue;   // waiting before the next try

                    var (outcome, error) = await SendOneAsync(s, nowUtc, cancellationToken);
                    s.LastAttemptAt = nowUtc;
                    if (outcome == "Sent")
                    {
                        s.LastPeriodKey = key;
                        s.LastStatus = "Sent";
                        s.LastSentAt = nowUtc;
                        s.LastError = Shorten(error);
                        s.PendingPeriodKey = null;
                        s.PendingAttempts = 0;
                        sent++;
                    }
                    else if (outcome == "Skipped")
                    {
                        s.LastPeriodKey = key;
                        s.LastStatus = "Skipped";
                        s.LastError = Shorten(error);
                    }
                    else
                    {
                        s.PendingAttempts++;
                        s.LastError = Shorten(error);
                        if (s.PendingAttempts >= maxAttempts) { s.LastPeriodKey = key; s.LastStatus = "Failed"; }
                        else s.LastStatus = "Retrying";
                    }
                    await _db.SaveChangesAsync(cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "A scheduled report could not be processed; the next check will try again.");
                    _db.ChangeTracker.Clear();
                }
            }
            return sent;
        }

        private static string Plain(object? value) => value switch
        {
            null => string.Empty,
            bool b => b ? "Yes" : "No",
            double d => d.ToString("0.##", CultureInfo.InvariantCulture),
            float f => f.ToString("0.##", CultureInfo.InvariantCulture),
            decimal m => m.ToString("0.##", CultureInfo.InvariantCulture),
            int i => i.ToString(CultureInfo.InvariantCulture),
            long l => l.ToString(CultureInfo.InvariantCulture),
            DateTime t => EmailTemplates.LagosText(DateTime.SpecifyKind(t, DateTimeKind.Utc)),
            _ => value.ToString() ?? string.Empty
        };

        private async Task<(string Outcome, string? Error)> SendOneAsync(ReportSchedule s, DateTime nowUtc, CancellationToken cancellationToken)
        {
            var person = await _db.Users.AsNoTracking().Where(u => u.Id == s.OwnerUserId && u.IsActive)
                .Select(u => new { u.FullName, u.UserName, u.CorporateEmail, u.Email }).FirstOrDefaultAsync(cancellationToken);
            var to = person == null ? null : (!string.IsNullOrWhiteSpace(person.CorporateEmail) ? person.CorporateEmail : person.Email)?.Trim();
            if (person == null || string.IsNullOrWhiteSpace(to) || !to.Contains('@'))
                return ("Skipped", "The person is blocked or has no email address.");

            var roles = await RoleAssignments.GetActiveRoleNamesAsync(_db, s.OwnerUserId);
            var isSuperAdmin = roles.Contains(AppRoles.SuperAdmin);
            var (listProblem, visible) = await _saved.ListAsync(s.OwnerUserId, isSuperAdmin, roles);
            if (listProblem != null || visible == null) return ("Skipped", "The owner can no longer run reports.");
            var report = visible.FirstOrDefault(r => r.Id == s.SavedReportId);
            if (report == null) return ("Skipped", "The saved report is no longer shared with this person.");

            var spec = report.Definition;
            if (string.IsNullOrWhiteSpace(spec.Title)) spec.Title = report.Name;
            spec.Limit ??= MaxRows;
            var (problem, result) = await _reports.RunAsync(spec, s.OwnerUserId, isSuperAdmin, cancellationToken);
            if (problem != null || result == null) return ("Failed", problem?.Message ?? "The report could not be run.");

            var offset = _sla.UtcOffsetHours;
            var isCsv = s.Format == "csv";
            var bytes = isCsv ? ReportExporter.ToCsv(result, offset) : ReportExporter.ToXlsx(result, offset);
            var fileName = ReportExporter.FileName(result, isCsv ? "csv" : "xlsx", nowUtc, offset);
            var attach = bytes.Length <= Math.Max(1, _options.MaxAttachmentMb) * 1024 * 1024;

            var brand = EmailBrand.Current;
            var frontend = (_config["Frontend:Url"] ?? "http://localhost:5174").Split(',')[0].Trim();
            var link = NotificationEmail.LinkFor(_options.LinkPath, frontend);
            var period = result.From == null && result.To == null ? "All time" : (result.From ?? "start") + " to " + (result.To ?? "today");
            var blocks = new List<EmailBlock>
            {
                EmailBlock.Paragraph(attach ? "Your scheduled report **" + result.Title + "** is attached." : "Your scheduled report **" + result.Title + "** is too big to attach. Please open it in " + brand.AppName + "."),
                EmailBlock.Details(("Report", report.Name), ("Period", period), ("Lines", Plain(result.Rows.Count) + (result.Truncated ? " (the first lines only)" : string.Empty)),
                    ("Made", EmailTemplates.LagosText(result.GeneratedAt)))
            };
            if (result.Columns.Count > 0 && result.Rows.Count > 0)
            {
                var shownColumns = Math.Min(result.Columns.Count, 8);
                var shownRows = result.Rows.Take(25).ToList();
                blocks.Add(EmailBlock.Table(result.Columns.Take(shownColumns).Select(col => col.Label),
                    shownRows.Select(line => (IEnumerable<string>)line.Take(shownColumns).Select(cell => Plain(cell)).ToList()).ToList()));
                if (result.Rows.Count > shownRows.Count || result.Columns.Count > shownColumns)
                    blocks.Add(EmailBlock.Note("The email shows the first " + shownRows.Count + " lines and " + shownColumns + " columns. The full report is in the attachment and in " + brand.AppName + "."));
            }
            if (result.Totals != null && result.Columns.Count > 0)
            {
                var totals = new List<(string, string)>();
                for (var c = 0; c < result.Columns.Count && c < result.Totals.Count && totals.Count < 10; c++)
                    if (result.Totals[c] != null) totals.Add((result.Columns[c].Label, Plain(result.Totals[c])));
                if (totals.Count > 0) { blocks.Add(EmailBlock.Paragraph("**Totals**")); blocks.Add(EmailBlock.Details(totals.ToArray())); }
            }
            if (link != null) blocks.Add(EmailBlock.Button("Open reports in " + brand.AppName, link));
            blocks.Add(EmailBlock.Note("You are receiving this because you scheduled this report in " + brand.AppName + ". You can change or stop it under Reports, then Schedules. The report shows only what you are allowed to see. This is an automatic message."));

            var first = (person.FullName ?? person.UserName ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty;
            var parts = EmailTemplates.Build(new EmailContent
            {
                Subject = "Scheduled report: " + result.Title,
                Heading = result.Title,
                Preheader = "Your scheduled report is ready.",
                Greeting = first.Length > 0 ? "Hello " + first + "," : "Hello,",
                Label = "Scheduled report",
                LabelTone = "info",
                Automatic = true,
                Blocks = blocks
            }, brand);

            var (ok, message) = attach
                ? await _email.SendEmailWithAttachmentsAsync(to, parts.Subject, parts.Html, new[] { new EmailAttachment(fileName, bytes, isCsv ? "text/csv" : ReportExporter.XlsxType) })
                : await _email.SendEmailAsync(to, parts.Subject, parts.Html);
            var copyFailures = new List<string>();
            var copyList = ParseCc(s.CcJson).Where(x => !string.Equals(x.Email, to, StringComparison.OrdinalIgnoreCase)).ToList();
            if (ok && copyList.Count > 0)
            {
                var ownerName = (person.FullName ?? person.UserName ?? string.Empty).Trim();
                var copyBlocks = new List<EmailBlock>(blocks);
                copyBlocks[0] = EmailBlock.Paragraph(ownerName + " copied you on the scheduled report **" + result.Title + "**" + (attach ? ", attached." : "."));
                copyBlocks[copyBlocks.Count - 1] = EmailBlock.Note("You are receiving a copy because " + ownerName + " added you to this scheduled report in " + brand.AppName + ".");
                var copyParts = EmailTemplates.Build(new EmailContent
                {
                    Subject = "Scheduled report: " + result.Title, Heading = result.Title, Preheader = "A scheduled report copied to you.",
                    Greeting = "Hello,", Label = "Scheduled report", LabelTone = "info", Automatic = true, Blocks = copyBlocks
                }, brand);
                foreach (var recipient in copyList)
                {
                    var (copySent, copyMessage) = attach
                        ? await _email.SendEmailWithAttachmentsAsync(recipient.Email, copyParts.Subject, copyParts.Html, new[] { new EmailAttachment(fileName, bytes, isCsv ? "text/csv" : ReportExporter.XlsxType) })
                        : await _email.SendEmailAsync(recipient.Email, copyParts.Subject, copyParts.Html);
                    if (!copySent) { copyFailures.Add(recipient.Email); _logger.LogWarning("A copy of the scheduled report was not sent to {Email}: {Message}", recipient.Email, copyMessage); }
                }
            }
            if (!ok)
            {
                _logger.LogWarning("The scheduled report for user {UserId} was not sent: {Message}", s.OwnerUserId, message);
                return ("Failed", message);
            }

            try
            {
                await _audit.LogAsync(s.OwnerUserId, person.UserName, AuditAction.Exported, "Report", s.SavedReportId, result.Title, null,
                    JsonSerializer.Serialize(new { format = isCsv ? "csv" : "xlsx", rows = result.Rows.Count, source = result.Source, mode = result.Mode, scheduled = true }),
                    "system", "Report schedule worker", AuditModule.Reports);
            }
            catch (Exception ex) { _logger.LogWarning(ex, "The scheduled report was sent but the audit entry could not be written."); }
            return ("Sent", copyFailures.Count == 0 ? null : "Sent to you, but not to: " + string.Join(", ", copyFailures));
        }
    }
}
