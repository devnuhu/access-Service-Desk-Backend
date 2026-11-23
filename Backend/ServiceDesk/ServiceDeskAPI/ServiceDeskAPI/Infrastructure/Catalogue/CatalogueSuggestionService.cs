using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Catalogue
{
    public sealed class CatalogueSuggestionService : ICatalogueSuggestionService
    {
        private const int RecentMax = 5;
        private const int PopularMax = 6;
        private readonly AppDbContext _db;

        public CatalogueSuggestionService(AppDbContext db) => _db = db;

        public async Task<CatalogueSuggestionsDto> GetAsync(Guid userId)
        {
            var now = DateTime.UtcNow;
            var recentSince = now.AddDays(-90);
            var popularSince = now.AddDays(-30);

            // only what a requester could raise right now
            var live = _db.Categories.AsNoTracking().Where(c => c.IsActive && c.Unit!.IsActive && c.Department!.IsActive);

            var recentIds = await _db.Tickets.AsNoTracking()
                .Where(t => t.RequesterUserId == userId && t.CreatedAt >= recentSince)
                .GroupBy(t => t.CategoryId).Select(g => new { CategoryId = g.Key, Last = g.Max(t => t.CreatedAt) })
                .OrderByDescending(x => x.Last).Take(RecentMax * 3).Select(x => x.CategoryId).ToListAsync();
            var popularIds = await _db.Tickets.AsNoTracking()
                .Where(t => t.CreatedAt >= popularSince)
                .GroupBy(t => t.CategoryId).Select(g => new { CategoryId = g.Key, Count = g.Count() })
                .OrderByDescending(x => x.Count).Take(PopularMax * 3).Select(x => x.CategoryId).ToListAsync();

            var wanted = recentIds.Concat(popularIds).Distinct().ToList();
            var categories = await live.Where(c => wanted.Contains(c.Id))
                .Select(c => new CatalogueSuggestionDto
                {
                    CategoryId = c.Id, CategoryName = c.Name, Description = c.Description, DepartmentId = c.DepartmentId, DepartmentName = c.Department!.Name
                }).ToListAsync();
            var byId = categories.ToDictionary(c => c.CategoryId);

            return new CatalogueSuggestionsDto
            {
                Recent = recentIds.Where(byId.ContainsKey).Select(id => byId[id]).Take(RecentMax).ToList(),
                Popular = popularIds.Where(byId.ContainsKey).Select(id => byId[id]).Take(PopularMax).ToList()
            };
        }
    }
}