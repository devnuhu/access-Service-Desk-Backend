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
    /// <summary>
    /// Knowledge-base articles per department. Creating, editing, publishing, unpublishing and deleting are audited (module Catalogue).
    /// A published article is changed by a publisher only (head of unit, Head of Department, Department Admin, Super Admin); staff edit drafts.
    /// </summary>
    public class KnowledgeBaseService : IKnowledgeBaseService
    {
        private const int MaxPerDepartment = 500;

        private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
        {
            "the", "and", "for", "with", "how", "can", "you", "not", "this", "that", "from", "have", "has", "was", "are", "but", "please", "need", "want", "help", "about", "when", "what", "who", "why"
        };

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IHttpContextAccessor _http;

        public KnowledgeBaseService(AppDbContext db, IAuditService audit, IHttpContextAccessor http)
        {
            _db = db;
            _audit = audit;
            _http = http;
        }

        private sealed class Rights
        {
            public bool All;
            public HashSet<Guid> Write = new();
            public HashSet<Guid> Publish = new();
            public bool CanWrite(Guid departmentId) => All || Write.Contains(departmentId);
            public bool CanPublish(Guid departmentId) => All || Publish.Contains(departmentId);
        }

        private async Task<Rights> RightsAsync(Guid userId, bool isSuperAdmin)
        {
            if (isSuperAdmin) return new Rights { All = true };
            var member = await _db.UnitMembers.AsNoTracking().Where(m => m.UserId == userId && m.IsActive).Select(m => m.Unit!.DepartmentId).ToListAsync();
            var heads = await _db.Units.AsNoTracking().Where(u => u.HeadUserId == userId && u.IsActive).Select(u => u.DepartmentId).ToListAsync();
            var lead = await _db.Departments.AsNoTracking().Where(d => d.HodUserId == userId || d.AdminUserId == userId).Select(d => d.Id).ToListAsync();
            var rights = new Rights();
            foreach (var d in heads.Concat(lead)) rights.Publish.Add(d);
            foreach (var d in rights.Publish.Concat(member)) rights.Write.Add(d);
            return rights;
        }

        private static TicketProblem NotFound() => new(404, "Article not found.");

        private async Task<Dictionary<Guid, (int Yes, int No)>> VoteCountsAsync(List<Guid> ids)
        {
            if (ids.Count == 0) return new Dictionary<Guid, (int Yes, int No)>();
            var rows = await _db.KbArticleVotes.AsNoTracking().Where(v => ids.Contains(v.ArticleId))
                .GroupBy(v => v.ArticleId)
                .Select(g => new { Id = g.Key, Yes = g.Count(x => x.IsHelpful), No = g.Count(x => !x.IsHelpful) }).ToListAsync();
            return rows.ToDictionary(r => r.Id, r => (r.Yes, r.No));
        }

        public async Task<(TicketProblem? Problem, KbListDto? List)> ListAsync(KbListQuery query, Guid actorUserId, bool actorIsSuperAdmin, bool manage)
        {
            query ??= new KbListQuery();
            var rights = await RightsAsync(actorUserId, actorIsSuperAdmin);
            IQueryable<KbArticle> q = _db.KbArticles.AsNoTracking();
            if (manage)
            {
                if (!rights.All)
                {
                    var allowed = rights.Write.ToList();
                    q = q.Where(a => allowed.Contains(a.DepartmentId));
                }
                var status = (query.Status ?? string.Empty).Trim().ToLowerInvariant();
                if (status == "draft") q = q.Where(a => a.Status == KbArticleStatus.Draft);
                else if (status == "published") q = q.Where(a => a.Status == KbArticleStatus.Published);
            }
            else q = q.Where(a => a.Status == KbArticleStatus.Published);

            if (query.CategoryId.HasValue)
            {
                var categoryId = query.CategoryId.Value;
                q = q.Where(a => a.CategoryId == categoryId);
            }
            var term = (query.Search ?? string.Empty).Trim();
            if (term.Length > 0) q = q.Where(a => a.Title.Contains(term) || a.Summary.Contains(term) || a.BodyText.Contains(term));

            var counts = await q.GroupBy(a => a.DepartmentId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync();
            var countIds = counts.Select(c => c.Id).ToList();
            var names = await _db.Departments.AsNoTracking().Where(d => countIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.Name);

            if (query.DepartmentId.HasValue)
            {
                var departmentId = query.DepartmentId.Value;
                q = q.Where(a => a.DepartmentId == departmentId);
            }
            var page = Math.Max(1, query.Page);
            var size = Math.Clamp(query.PageSize <= 0 ? 20 : query.PageSize, 1, 50);
            var total = await q.CountAsync();
            var rows = await q.OrderByDescending(a => a.UpdatedAt ?? a.CreatedAt).ThenBy(a => a.Title)
                .Skip((page - 1) * size).Take(size)
                .Select(a => new
                {
                    a.Id, a.Title, a.Summary, a.Status, a.DepartmentId,
                    DepartmentName = a.Department!.Name,
                    a.CategoryId,
                    CategoryName = a.Category == null ? null : a.Category.Name,
                    When = a.UpdatedAt ?? a.CreatedAt
                }).ToListAsync();
            var votes = await VoteCountsAsync(rows.Select(r => r.Id).ToList());

            var list = new KbListDto
            {
                Total = total, Page = page, PageSize = size,
                Items = rows.Select(r => new KbArticleListItemDto
                {
                    Id = r.Id, Title = r.Title, Summary = r.Summary, Status = r.Status.ToString(), UpdatedAt = r.When,
                    Department = new KbRefDto { Id = r.DepartmentId, Name = r.DepartmentName },
                    Category = r.CategoryId.HasValue ? new KbRefDto { Id = r.CategoryId.Value, Name = r.CategoryName ?? string.Empty } : null,
                    Yes = votes.TryGetValue(r.Id, out var v) ? v.Yes : 0,
                    No = votes.TryGetValue(r.Id, out var w) ? w.No : 0
                }).ToList(),
                Departments = counts.Select(c => new KbDepartmentCountDto { Id = c.Id, Name = names.TryGetValue(c.Id, out var n) ? n : string.Empty, Count = c.Count })
                    .OrderBy(d => d.Name).ToList()
            };
            return (null, list);
        }

        private async Task<KbArticleDto> ToDtoAsync(KbArticle a, Rights rights, Guid actorUserId)
        {
            var votes = await VoteCountsAsync(new List<Guid> { a.Id });
            var mine = await _db.KbArticleVotes.AsNoTracking().Where(v => v.ArticleId == a.Id && v.UserId == actorUserId).Select(v => (bool?)v.IsHelpful).FirstOrDefaultAsync();
            var author = await _db.Users.AsNoTracking().Where(u => u.Id == a.CreatedByUserId).Select(u => new { u.Id, u.UserName, u.FullName }).FirstOrDefaultAsync();
            var department = a.Department ?? await _db.Departments.AsNoTracking().FirstAsync(d => d.Id == a.DepartmentId);
            var category = a.CategoryId.HasValue ? (a.Category ?? await _db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == a.CategoryId.Value)) : null;
            var canWrite = rights.CanWrite(a.DepartmentId);
            var canPublish = rights.CanPublish(a.DepartmentId);
            var draft = a.Status == KbArticleStatus.Draft;
            return new KbArticleDto
            {
                Id = a.Id, Title = a.Title, Summary = a.Summary, BodyHtml = a.BodyHtml,
                Department = new KbRefDto { Id = department.Id, Name = department.Name },
                Category = category == null ? null : new KbRefDto { Id = category.Id, Name = category.Name },
                Status = a.Status.ToString(), CreatedAt = a.CreatedAt, UpdatedAt = a.UpdatedAt, PublishedAt = a.PublishedAt,
                Author = author == null ? null : new PersonDto(author.Id, author.UserName ?? string.Empty, author.FullName),
                Yes = votes.TryGetValue(a.Id, out var v) ? v.Yes : 0,
                No = votes.TryGetValue(a.Id, out var w) ? w.No : 0,
                MyVote = mine,
                CanEdit = canWrite && (draft || canPublish),
                CanPublish = canPublish,
                CanDelete = canPublish || (canWrite && draft && a.CreatedByUserId == actorUserId)
            };
        }

        public async Task<(TicketProblem? Problem, KbArticleDto? Article)> GetAsync(Guid id, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var a = await _db.KbArticles.AsNoTracking().Include(x => x.Department).Include(x => x.Category).FirstOrDefaultAsync(x => x.Id == id);
            if (a == null) return (NotFound(), null);
            var rights = await RightsAsync(actorUserId, actorIsSuperAdmin);
            if (a.Status != KbArticleStatus.Published && !rights.CanWrite(a.DepartmentId)) return (NotFound(), null);
            return (null, await ToDtoAsync(a, rights, actorUserId));
        }

        private sealed class Hit
        {
            public Guid Id;
            public string Title = string.Empty;
            public string Summary = string.Empty;
            public string Department = string.Empty;
            public DateTime When;
            public int Score;
        }

        private static void AddHit(Dictionary<Guid, Hit> hits, Guid id, string title, string summary, string department, DateTime when, int score)
        {
            if (hits.TryGetValue(id, out var hit)) hit.Score += score;
            else hits[id] = new Hit { Id = id, Title = title, Summary = summary, Department = department, When = when, Score = score };
        }

        public async Task<(TicketProblem? Problem, List<KbSuggestionDto>? Items)> SuggestAsync(Guid? categoryId, string? text, Guid actorUserId)
        {
            var hits = new Dictionary<Guid, Hit>();
            if (categoryId.HasValue)
            {
                var c = categoryId.Value;
                var rows = await _db.KbArticles.AsNoTracking()
                    .Where(a => a.Status == KbArticleStatus.Published && a.CategoryId == c)
                    .OrderByDescending(a => a.UpdatedAt ?? a.CreatedAt).Take(10)
                    .Select(a => new { a.Id, a.Title, a.Summary, Department = a.Department!.Name, When = a.UpdatedAt ?? a.CreatedAt }).ToListAsync();
                foreach (var r in rows) AddHit(hits, r.Id, r.Title, r.Summary, r.Department, r.When, 5);
            }
            var tokens = Regex.Matches((text ?? string.Empty).ToLowerInvariant(), "[a-z0-9]{3,}").Select(m => m.Value)
                .Where(t => !StopWords.Contains(t)).Distinct().Take(5).ToList();
            foreach (var token in tokens)
            {
                var t = token;
                var rows = await _db.KbArticles.AsNoTracking()
                    .Where(a => a.Status == KbArticleStatus.Published && (a.Title.Contains(t) || a.Summary.Contains(t) || a.BodyText.Contains(t)))
                    .OrderByDescending(a => a.UpdatedAt ?? a.CreatedAt).Take(20)
                    .Select(a => new { a.Id, a.Title, a.Summary, Department = a.Department!.Name, When = a.UpdatedAt ?? a.CreatedAt }).ToListAsync();
                foreach (var r in rows)
                {
                    var score = r.Title.ToLowerInvariant().Contains(t) ? 3 : r.Summary.ToLowerInvariant().Contains(t) ? 2 : 1;
                    AddHit(hits, r.Id, r.Title, r.Summary, r.Department, r.When, score);
                }
            }
            var items = hits.Values.OrderByDescending(h => h.Score).ThenByDescending(h => h.When).Take(3)
                .Select(h => new KbSuggestionDto { Id = h.Id, Title = h.Title, Summary = h.Summary, DepartmentName = h.Department }).ToList();
            return (null, items);
        }

        public async Task<(TicketProblem? Problem, List<KbOptionDto>? Options)> OptionsAsync(Guid actorUserId, bool actorIsSuperAdmin)
        {
            var rights = await RightsAsync(actorUserId, actorIsSuperAdmin);
            var departments = (await _db.Departments.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Name).ToListAsync())
                .Where(d => rights.CanWrite(d.Id)).ToList();
            var ids = departments.Select(d => d.Id).ToList();
            var categories = await _db.Categories.AsNoTracking().Where(c => c.IsActive && ids.Contains(c.DepartmentId))
                .OrderBy(c => c.SortOrder).ThenBy(c => c.Name).Select(c => new { c.Id, c.Name, c.DepartmentId }).ToListAsync();
            var options = departments.Select(d => new KbOptionDto
            {
                Id = d.Id, Name = d.Name, CanPublish = rights.CanPublish(d.Id),
                Categories = categories.Where(c => c.DepartmentId == d.Id).Select(c => new KbRefDto { Id = c.Id, Name = c.Name }).ToList()
            }).ToList();
            return (null, options);
        }

        /// <summary>Checks the fields. Returns the cleaned title, summary, HTML and plain text.</summary>
        private async Task<(TicketProblem? Problem, string Title, string Summary, string Html, string Text)> CheckAsync(KbArticleRequest request, Guid departmentId, Guid? exceptId)
        {
            var errors = new Dictionary<string, string>();
            var title = (request.Title ?? string.Empty).Trim();
            var summary = (request.Summary ?? string.Empty).Trim();
            if (title.Length < 5 || title.Length > 200) errors["title"] = "Give the article a title of 5 to 200 characters.";
            if (summary.Length < 10 || summary.Length > 500) errors["summary"] = "Write a summary of 10 to 500 characters.";
            var html = RichText.Clean(request.BodyHtml);
            var text = RichText.ToText(html);
            if (text.Length < 20) errors["bodyHtml"] = "Write the article (at least 20 characters).";
            else if (text.Length > 30000 || html.Length > 100000) errors["bodyHtml"] = "The article is too long. Split it into two articles.";
            if (request.CategoryId.HasValue)
            {
                var categoryId = request.CategoryId.Value;
                var ok = await _db.Categories.AsNoTracking().AnyAsync(c => c.Id == categoryId && c.DepartmentId == departmentId);
                if (!ok) errors["categoryId"] = "Choose a category of this department, or none.";
            }
            if (!errors.ContainsKey("title"))
            {
                var clash = await _db.KbArticles.AsNoTracking().AnyAsync(a => a.DepartmentId == departmentId && a.Title == title && (!exceptId.HasValue || a.Id != exceptId.Value));
                if (clash) errors["title"] = "This department already has an article with this title.";
            }
            if (errors.Count > 0)
            {
                var first = errors.First();
                return (new TicketProblem(400, errors.Count == 1 ? first.Value : "Check the " + errors.Count + " highlighted fields.", first.Key, errors), title, summary, html, text);
            }
            return (null, title, summary, html, text);
        }

        public async Task<(TicketProblem? Problem, KbArticleDto? Article)> CreateAsync(KbArticleRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            request ??= new KbArticleRequest();
            var department = await _db.Departments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == request.DepartmentId && d.IsActive);
            if (department == null) return (new TicketProblem(400, "Choose the department this article is for.", "departmentId"), null);
            var rights = await RightsAsync(actorUserId, actorIsSuperAdmin);
            if (!rights.CanWrite(department.Id)) return (new TicketProblem(403, "You cannot write articles for this department."), null);
            if (await _db.KbArticles.CountAsync(a => a.DepartmentId == department.Id) >= MaxPerDepartment)
                return (new TicketProblem(400, "A department can have at most " + MaxPerDepartment + " articles."), null);
            var (bad, title, summary, html, text) = await CheckAsync(request, department.Id, null);
            if (bad != null) return (bad, null);

            var article = new KbArticle
            {
                Id = Guid.NewGuid(), DepartmentId = department.Id, CategoryId = request.CategoryId, Title = title, Summary = summary,
                BodyHtml = html, BodyText = text, Status = KbArticleStatus.Draft, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId
            };
            _db.KbArticles.Add(article);
            Stage(AuditAction.Created, article, null, new { title, department = department.Code, categoryId = request.CategoryId, status = "Draft" });
            await _db.SaveChangesAsync();
            return await GetAsync(article.Id, actorUserId, actorIsSuperAdmin);
        }

        public async Task<(TicketProblem? Problem, KbArticleDto? Article)> UpdateAsync(Guid id, KbArticleRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            request ??= new KbArticleRequest();
            var article = await _db.KbArticles.FirstOrDefaultAsync(a => a.Id == id);
            if (article == null) return (NotFound(), null);
            var rights = await RightsAsync(actorUserId, actorIsSuperAdmin);
            if (!rights.CanWrite(article.DepartmentId))
                return article.Status == KbArticleStatus.Published ? (new TicketProblem(403, "You cannot change this article."), null) : (NotFound(), null);
            if (article.Status == KbArticleStatus.Published && !rights.CanPublish(article.DepartmentId))
                return (new TicketProblem(403, "Only a head of unit or the Head of Department can change a published article. Ask them to unpublish it first."), null);
            var (bad, title, summary, html, text) = await CheckAsync(request, article.DepartmentId, article.Id);
            if (bad != null) return (bad, null);

            var before = new { title = article.Title, summary = article.Summary, categoryId = article.CategoryId, status = article.Status.ToString() };
            article.Title = title;
            article.Summary = summary;
            article.CategoryId = request.CategoryId;
            article.BodyHtml = html;
            article.BodyText = text;
            article.UpdatedAt = DateTime.UtcNow;
            article.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, article, before, new { title, summary, categoryId = request.CategoryId, status = article.Status.ToString() });
            await _db.SaveChangesAsync();
            return await GetAsync(article.Id, actorUserId, actorIsSuperAdmin);
        }

        public async Task<(TicketProblem? Problem, KbArticleDto? Article)> SetPublishedAsync(Guid id, bool publish, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var article = await _db.KbArticles.FirstOrDefaultAsync(a => a.Id == id);
            if (article == null) return (NotFound(), null);
            var rights = await RightsAsync(actorUserId, actorIsSuperAdmin);
            if (!rights.CanWrite(article.DepartmentId))
                return article.Status == KbArticleStatus.Published ? (new TicketProblem(403, "You cannot change this article."), null) : (NotFound(), null);
            if (!rights.CanPublish(article.DepartmentId))
                return (new TicketProblem(403, "Only a head of unit or the Head of Department can publish or unpublish an article."), null);

            var target = publish ? KbArticleStatus.Published : KbArticleStatus.Draft;
            if (article.Status != target)
            {
                var now = DateTime.UtcNow;
                var before = new { status = article.Status.ToString() };
                article.Status = target;
                article.PublishedAt = publish ? now : null;
                article.PublishedByUserId = publish ? actorUserId : null;
                article.UpdatedAt = now;
                article.UpdatedByUserId = actorUserId;
                Stage(AuditAction.StatusChanged, article, before, new { status = target.ToString(), title = article.Title });
                await _db.SaveChangesAsync();
            }
            return await GetAsync(article.Id, actorUserId, actorIsSuperAdmin);
        }

        public async Task<(TicketProblem? Problem, string? Message)> DeleteAsync(Guid id, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var article = await _db.KbArticles.FirstOrDefaultAsync(a => a.Id == id);
            if (article == null) return (NotFound(), null);
            var rights = await RightsAsync(actorUserId, actorIsSuperAdmin);
            var canWrite = rights.CanWrite(article.DepartmentId);
            if (!canWrite)
                return article.Status == KbArticleStatus.Published ? (new TicketProblem(403, "You cannot delete this article."), null) : (NotFound(), null);
            var mayDelete = rights.CanPublish(article.DepartmentId) || (article.Status == KbArticleStatus.Draft && article.CreatedByUserId == actorUserId);
            if (!mayDelete) return (new TicketProblem(403, "You can delete your own drafts. A head of unit or the Head of Department deletes the rest."), null);
            Stage(AuditAction.Deleted, article, new { title = article.Title, status = article.Status.ToString() }, null);
            _db.KbArticles.Remove(article);
            await _db.SaveChangesAsync();
            return (null, "Article deleted.");
        }

        public async Task<(TicketProblem? Problem, KbVoteDto? Vote)> VoteAsync(Guid id, bool helpful, Guid actorUserId)
        {
            var published = await _db.KbArticles.AsNoTracking().AnyAsync(a => a.Id == id && a.Status == KbArticleStatus.Published);
            if (!published) return (NotFound(), null);
            var vote = await _db.KbArticleVotes.FirstOrDefaultAsync(v => v.ArticleId == id && v.UserId == actorUserId);
            if (vote == null) _db.KbArticleVotes.Add(new KbArticleVote { Id = Guid.NewGuid(), ArticleId = id, UserId = actorUserId, IsHelpful = helpful, VotedAt = DateTime.UtcNow });
            else if (vote.IsHelpful != helpful) { vote.IsHelpful = helpful; vote.VotedAt = DateTime.UtcNow; }
            await _db.SaveChangesAsync();
            var counts = await VoteCountsAsync(new List<Guid> { id });
            counts.TryGetValue(id, out var c);
            return (null, new KbVoteDto { Yes = c.Yes, No = c.No, MyVote = helpful });
        }

        private void Stage(AuditAction action, KbArticle article, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "KbArticle", article.Id, "KB-" + article.Id.ToString("N").Substring(0, 8).ToUpperInvariant(),
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Catalogue);
        }
    }
}