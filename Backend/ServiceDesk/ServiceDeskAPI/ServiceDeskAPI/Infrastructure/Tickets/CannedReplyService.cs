using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>The words a reply may use between double braces, and how they are filled in.</summary>
    public static class CannedPlaceholders
    {
        public static readonly IReadOnlyList<CannedPlaceholderDto> All = new List<CannedPlaceholderDto>
        {
            new("{{requester.name}}", "The person the ticket is for"),
            new("{{ticket.reference}}", "The ticket reference, for example CP-2026-000123"),
            new("{{ticket.subject}}", "The ticket subject"),
            new("{{ticket.category}}", "The category of the ticket"),
            new("{{unit.name}}", "The unit handling the ticket"),
            new("{{department.name}}", "The department of the ticket"),
            new("{{agent.name}}", "The signed-in person, who is writing the reply"),
            new("{{today}}", "Today's date, for example 21 Nov 2026")
        };

        private static readonly Regex Token = new(@"\{\{\s*([A-Za-z.]+)\s*\}\}", RegexOptions.Compiled);
        private static readonly HashSet<string> Known = new(All.Select(p => p.Token.Trim('{', '}')), StringComparer.OrdinalIgnoreCase);

        /// <summary>Words between double braces that are not on the list.</summary>
        public static List<string> Unknown(string text) =>
            Token.Matches(text ?? string.Empty).Select(m => m.Groups[1].Value).Where(k => !Known.Contains(k)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        /// <summary>Fills the placeholders in; each value is HTML-encoded because the reply is HTML.</summary>
        public static string Render(string html, IReadOnlyDictionary<string, string> values) =>
            Token.Replace(html ?? string.Empty, m =>
                values.TryGetValue(m.Groups[1].Value.ToLowerInvariant(), out var v) ? WebUtility.HtmlEncode(v) : m.Value);
    }

    public class CannedReplyService : ICannedReplyService
    {
        private const int MaxPerLibrary = 100;
        private const int MaxTextChars = 5000;

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IHttpContextAccessor _http;

        public CannedReplyService(AppDbContext db, IAuditService audit, IHttpContextAccessor http)
        {
            _db = db;
            _audit = audit;
            _http = http;
        }

        private static string NameOf(User? u) => u == null ? string.Empty : string.IsNullOrWhiteSpace(u.FullName) ? (u.UserName ?? string.Empty) : u.FullName!;

        // ---------------- on a ticket ----------------

        public async Task<(TicketProblem? Problem, List<TicketCannedReplyDto>? Replies)> ListForTicketAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.AsNoTracking().Include(t => t.Unit).Include(t => t.Department).Include(t => t.Category).Include(t => t.RequesterUser)
                .FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null);
            if (!actorIsSuperAdmin && !await TicketAccess.IsStaffForTicketAsync(_db, actorUserId, ticket.DepartmentId, ticket.UnitId))
                return (new TicketProblem(404, "Ticket not found."), null);

            var me = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == actorUserId);
            var values = new Dictionary<string, string>
            {
                ["requester.name"] = NameOf(ticket.RequesterUser),
                ["ticket.reference"] = ticket.Reference,
                ["ticket.subject"] = ticket.Subject,
                ["ticket.category"] = ticket.Category?.Name ?? string.Empty,
                ["unit.name"] = ticket.Unit?.Name ?? string.Empty,
                ["department.name"] = ticket.Department?.Name ?? string.Empty,
                ["agent.name"] = NameOf(me),
                ["today"] = DateTime.UtcNow.AddHours(1).ToString("d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture)
            };
            var rows = await _db.CannedReplies.AsNoTracking().Where(c => c.UnitId == ticket.UnitId || c.UnitId == null).ToListAsync();
            var list = rows.OrderBy(c => c.UnitId == null).ThenBy(c => c.Title)
                .Select(c => new TicketCannedReplyDto(c.Id, c.UnitId == null, c.Title, CannedPlaceholders.Render(c.BodyHtml, values))).ToList();
            return (null, list);
        }

        // ---------------- the library ----------------

        private async Task<bool> CanManageAsync(Guid? unitId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            if (actorIsSuperAdmin) return true;
            if (unitId == null) return false;
            return await _db.Units.AnyAsync(u => u.Id == unitId && (u.HeadUserId == actorUserId || u.Department!.AdminUserId == actorUserId));
        }

        private static readonly TicketProblem NotAllowed = new(403, "Only the head of the unit, the Department Admin or a Super Admin can keep these replies.");

        public async Task<(TicketProblem? Problem, List<CannedReplyDto>? Replies)> ListLibraryAsync(Guid? unitId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            if (unitId != null && !await _db.Units.AnyAsync(u => u.Id == unitId)) return (new TicketProblem(404, "Unit not found."), null);
            if (!await CanManageAsync(unitId, actorUserId, actorIsSuperAdmin)) return (NotAllowed, null);
            var rows = await _db.CannedReplies.AsNoTracking().Include(c => c.Unit).Where(c => c.UnitId == unitId).OrderBy(c => c.Title).ToListAsync();
            return (null, rows.Select(c => ToDto(c)).ToList());
        }

        private static CannedReplyDto ToDto(CannedReply c, string? unitName = null) =>
            new(c.Id, c.UnitId, unitName ?? c.Unit?.Name, c.UnitId == null, c.Title, c.BodyHtml, c.CreatedAt, c.UpdatedAt);

        /// <summary>Checks and cleans what was sent. A null title or body is only allowed when it is an update (keep what is there).</summary>
        private static (TicketProblem? Problem, string? Title, string? Html) Check(SaveCannedReplyRequest request, bool isCreate)
        {
            string? title = null, html = null;
            if (request.Title != null || isCreate)
            {
                title = (request.Title ?? string.Empty).Trim();
                if (title.Length < 2 || title.Length > 100) return (new TicketProblem(400, "The title must be 2 to 100 characters.", "title"), null, null);
            }
            if (request.BodyHtml != null || isCreate)
            {
                html = RichText.Clean(request.BodyHtml);
                var text = RichText.ToText(html);
                if (text.Length == 0) return (new TicketProblem(400, "Write the reply.", "bodyHtml"), null, null);
                if (text.Length > MaxTextChars) return (new TicketProblem(400, "The reply can be at most " + MaxTextChars + " characters.", "bodyHtml"), null, null);
                var unknown = CannedPlaceholders.Unknown(text);
                if (unknown.Count > 0)
                    return (new TicketProblem(400, "Unknown placeholder: " + string.Join(", ", unknown.Select(u => "{{" + u + "}}")) + ". Allowed: "
                        + string.Join(", ", CannedPlaceholders.All.Select(p => p.Token)) + ".", "bodyHtml"), null, null);
            }
            return (null, title, html);
        }

        public async Task<(TicketProblem? Problem, CannedReplyDto? Reply)> CreateAsync(Guid? unitId, SaveCannedReplyRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            Unit? unit = null;
            if (unitId != null)
            {
                unit = await _db.Units.AsNoTracking().FirstOrDefaultAsync(u => u.Id == unitId);
                if (unit == null) return (new TicketProblem(404, "Unit not found."), null);
            }
            if (!await CanManageAsync(unitId, actorUserId, actorIsSuperAdmin)) return (NotAllowed, null);
            var (problem, title, html) = Check(request, true);
            if (problem != null) return (problem, null);
            if (await _db.CannedReplies.AnyAsync(c => c.UnitId == unitId && c.Title == title)) return (new TicketProblem(409, "A reply with that title already exists.", "title"), null);
            if (await _db.CannedReplies.CountAsync(c => c.UnitId == unitId) >= MaxPerLibrary) return (new TicketProblem(400, "A library can hold at most " + MaxPerLibrary + " replies."), null);

            var reply = new CannedReply { Id = Guid.NewGuid(), UnitId = unitId, Title = title!, BodyHtml = html!, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.CannedReplies.Add(reply);
            Stage(AuditAction.Created, reply.Id, title!, null, new { unit = unit?.Code ?? "(shared)", title });
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return (new TicketProblem(409, "A reply with that title already exists.", "title"), null); }
            return (null, ToDto(reply, unit?.Name));
        }

        public async Task<(TicketProblem? Problem, CannedReplyDto? Reply)> UpdateAsync(Guid replyId, SaveCannedReplyRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reply = await _db.CannedReplies.Include(c => c.Unit).FirstOrDefaultAsync(c => c.Id == replyId);
            if (reply == null) return (new TicketProblem(404, "Reply not found."), null);
            if (!await CanManageAsync(reply.UnitId, actorUserId, actorIsSuperAdmin)) return (NotAllowed, null);
            var (problem, title, html) = Check(request, false);
            if (problem != null) return (problem, null);
            if (title == null && html == null) return (new TicketProblem(400, "Send a title or a reply to change."), null);
            if (title != null && title != reply.Title && await _db.CannedReplies.AnyAsync(c => c.UnitId == reply.UnitId && c.Title == title && c.Id != reply.Id))
                return (new TicketProblem(409, "A reply with that title already exists.", "title"), null);

            var before = new { title = reply.Title };
            if (title != null) reply.Title = title;
            if (html != null) reply.BodyHtml = html;
            reply.UpdatedAt = DateTime.UtcNow;
            reply.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, reply.Id, reply.Title, before, new { title = reply.Title, textChanged = html != null });
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return (new TicketProblem(409, "A reply with that title already exists.", "title"), null); }
            return (null, ToDto(reply));
        }

        public async Task<(TicketProblem? Problem, string? Message)> DeleteAsync(Guid replyId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reply = await _db.CannedReplies.FirstOrDefaultAsync(c => c.Id == replyId);
            if (reply == null) return (new TicketProblem(404, "Reply not found."), null);
            if (!await CanManageAsync(reply.UnitId, actorUserId, actorIsSuperAdmin)) return (NotAllowed, null);
            _db.CannedReplies.Remove(reply);
            Stage(AuditAction.Deleted, reply.Id, reply.Title, new { title = reply.Title }, null);
            await _db.SaveChangesAsync();
            return (null, "\"" + reply.Title + "\" removed.");
        }

        private void Stage(AuditAction action, Guid id, string display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "CannedReply", id, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
        }
    }
}