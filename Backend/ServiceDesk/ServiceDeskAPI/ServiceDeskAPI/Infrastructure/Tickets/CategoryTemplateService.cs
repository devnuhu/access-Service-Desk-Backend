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
    public class CategoryTemplateService : ICategoryTemplateService
    {
        private const int MaxSubject = 150;
        private const int MaxTextChars = 5000;
        private static readonly Regex Token = new(@"\{\{\s*([A-Za-z.]+)\s*\}\}", RegexOptions.Compiled);
        private static readonly string[] AllowedWords = { "requester.name", "ticket.category", "unit.name", "department.name", "today" };

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IHttpContextAccessor _http;

        public CategoryTemplateService(AppDbContext db, IAuditService audit, IHttpContextAccessor http)
        {
            _db = db;
            _audit = audit;
            _http = http;
        }

        private static List<string> NotAllowed(string text) =>
            Token.Matches(text ?? string.Empty).Select(m => m.Groups[1].Value)
                .Where(k => !AllowedWords.Contains(k, StringComparer.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        private static string Plain(string? text, IReadOnlyDictionary<string, string> values) =>
            Token.Replace(text ?? string.Empty, m => values.TryGetValue(m.Groups[1].Value.ToLowerInvariant(), out var v) ? v : m.Value);

        private static CategoryTemplateDto ToDto(Category c) => new(c.Id, c.Name, c.TemplateSubject, c.TemplateDescriptionHtml);

        public async Task<(TicketProblem? Problem, CategoryTemplateDto? Template)> GetAsync(Guid categoryId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, category) = await LoadAsync(categoryId, actorUserId, actorIsSuperAdmin, false);
            return problem != null ? (problem, null) : (null, ToDto(category!));
        }

        private async Task<(TicketProblem? Problem, Category? Category)> LoadAsync(Guid categoryId, Guid actorUserId, bool actorIsSuperAdmin, bool track)
        {
            var query = _db.Categories.Include(c => c.Unit).Include(c => c.Department).AsQueryable();
            if (!track) query = query.AsNoTracking();
            var category = await query.FirstOrDefaultAsync(c => c.Id == categoryId);
            if (category == null) return (new TicketProblem(404, "Category not found."), null);
            if (actorIsSuperAdmin) return (null, category);
            var keeper = category.Unit?.HeadUserId == actorUserId || category.Department?.AdminUserId == actorUserId;
            if (!keeper) return (new TicketProblem(403, "Only the head of the unit, the Department Admin or a Super Admin can keep this template."), null);
            return (null, category);
        }

        public async Task<(TicketProblem? Problem, CategoryTemplateDto? Template)> SaveAsync(Guid categoryId, SaveCategoryTemplateRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, category) = await LoadAsync(categoryId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);

            var subject = (request.Subject ?? string.Empty).Trim();
            if (subject.Length > MaxSubject) return (new TicketProblem(400, "The subject can be at most " + MaxSubject + " characters.", "subject"), null);
            var badSubject = NotAllowed(subject);
            if (badSubject.Count > 0) return (Unknown(badSubject, "subject"), null);

            string? html = null;
            if (!string.IsNullOrWhiteSpace(request.DescriptionHtml))
            {
                var cleaned = RichText.Clean(request.DescriptionHtml);
                var text = RichText.ToText(cleaned);
                if (text.Length > MaxTextChars) return (new TicketProblem(400, "The description can be at most " + MaxTextChars + " characters.", "descriptionHtml"), null);
                var badBody = NotAllowed(text);
                if (badBody.Count > 0) return (Unknown(badBody, "descriptionHtml"), null);
                if (text.Length > 0) html = cleaned;
            }

            var before = new { subject = category!.TemplateSubject, descriptionHtml = category.TemplateDescriptionHtml };
            category.TemplateSubject = subject.Length == 0 ? null : subject;
            category.TemplateDescriptionHtml = html;
            category.UpdatedAt = DateTime.UtcNow;
            category.UpdatedByUserId = actorUserId;

            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, AuditAction.Updated, "Category", category.Id, category.Name,
                JsonSerializer.Serialize(before), JsonSerializer.Serialize(new { subject = category.TemplateSubject, descriptionHtml = category.TemplateDescriptionHtml }),
                actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
            await _db.SaveChangesAsync();
            return (null, ToDto(category));
        }

        private static TicketProblem Unknown(List<string> words, string field) =>
            new(400, "Unknown placeholder: " + string.Join(", ", words.Select(w => "{{" + w + "}}")) + ". Allowed: " + string.Join(", ", AllowedWords.Select(w => "{{" + w + "}}")) + ".", field);

        public async Task<List<CatalogueTemplateDto>> ListForRequesterAsync(Guid userId)
        {
            var me = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
            var name = me == null ? string.Empty : string.IsNullOrWhiteSpace(me.FullName) ? (me.UserName ?? string.Empty) : me.FullName!;
            var today = DateTime.UtcNow.AddHours(1).ToString("d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture);

            var rows = await _db.Categories.AsNoTracking().Include(c => c.Unit).Include(c => c.Department)
                .Where(c => c.IsActive && c.Unit!.IsActive && c.Department!.IsActive && (c.TemplateSubject != null || c.TemplateDescriptionHtml != null))
                .ToListAsync();
            return rows.Select(c =>
            {
                var values = new Dictionary<string, string>
                {
                    ["requester.name"] = name,
                    ["ticket.category"] = c.Name,
                    ["unit.name"] = c.Unit?.Name ?? string.Empty,
                    ["department.name"] = c.Department?.Name ?? string.Empty,
                    ["today"] = today
                };
                return new CatalogueTemplateDto(c.Id,
                    c.TemplateSubject == null ? null : Plain(c.TemplateSubject, values),
                    c.TemplateDescriptionHtml == null ? null : CannedPlaceholders.Render(c.TemplateDescriptionHtml, values));
            }).ToList();
        }
    }
}