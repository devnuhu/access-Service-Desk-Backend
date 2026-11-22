using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Sla
{
    public sealed class SlaPolicyService : ISlaPolicyService
    {
        private readonly AppDbContext _db;

        public SlaPolicyService(AppDbContext db) => _db = db;

        public async Task<SlaPoliciesDto> GetAsync()
        {
            var rows = await _db.SlaPolicies.AsNoTracking().ToListAsync();
            var departments = await _db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, d => d.Name);
            var categories = (await _db.Categories.AsNoTracking().Select(c => new { c.Id, c.Name }).ToListAsync()).ToDictionary(c => c.Id, c => c.Name);

            var result = new SlaPoliciesDto();
            foreach (var priority in new[] { TicketPriority.Critical, TicketPriority.High, TicketPriority.Medium, TicketPriority.Low })
            {
                var saved = rows.FirstOrDefault(r => r.DepartmentId == null && r.CategoryId == null && r.Priority == priority);
                var (response, resolution) = SlaTargets.Defaults[priority];
                result.Global.Add(new SlaPolicyRowDto
                {
                    Id = saved?.Id, Scope = "global", Priority = priority, IsDefault = saved == null,
                    ResponseHours = saved?.ResponseHours ?? response, ResolutionHours = saved?.ResolutionHours ?? resolution
                });
            }

            result.Overrides = rows.Where(r => r.DepartmentId != null || r.CategoryId != null)
                .Select(r => new SlaPolicyRowDto
                {
                    Id = r.Id, Scope = r.CategoryId != null ? "category" : "department", Priority = r.Priority, IsDefault = false,
                    DepartmentId = r.DepartmentId, DepartmentName = r.DepartmentId.HasValue && departments.TryGetValue(r.DepartmentId.Value, out var dn) ? dn : null,
                    CategoryId = r.CategoryId, CategoryName = r.CategoryId.HasValue && categories.TryGetValue(r.CategoryId.Value, out var cn) ? cn : null,
                    ResponseHours = r.ResponseHours, ResolutionHours = r.ResolutionHours
                })
                .OrderBy(r => r.Scope).ThenBy(r => r.DepartmentName ?? r.CategoryName).ThenByDescending(r => (int)r.Priority)
                .ToList();
            return result;
        }

        public async Task<(TicketProblem? Problem, SlaPolicyRowDto? Row)> SaveAsync(SaveSlaPolicyRequest request, Guid actorUserId)
        {
            var scope = (request.Scope ?? string.Empty).Trim().ToLowerInvariant();
            if (scope != "global" && scope != "department" && scope != "category")
                return (new TicketProblem(400, "Scope must be global, department or category.", "scope"), null);
            if (!Enum.IsDefined(request.Priority))
                return (new TicketProblem(400, "Choose Low, Medium, High or Critical.", "priority"), null);
            if (request.ResponseHours < 1 || request.ResponseHours > 720)
                return (new TicketProblem(400, "The first-response time must be 1 to 720 working hours.", "responseHours"), null);
            if (request.ResolutionHours < 1 || request.ResolutionHours > 4000)
                return (new TicketProblem(400, "The resolution time must be 1 to 4000 working hours.", "resolutionHours"), null);
            if (request.ResolutionHours < request.ResponseHours)
                return (new TicketProblem(400, "The resolution time cannot be shorter than the first-response time.", "resolutionHours"), null);

            Guid? departmentId = null, categoryId = null;
            string? departmentName = null, categoryName = null;
            if (scope == "department")
            {
                if (!request.DepartmentId.HasValue) return (new TicketProblem(400, "Choose the department.", "departmentId"), null);
                departmentName = await _db.Departments.AsNoTracking().Where(d => d.Id == request.DepartmentId.Value).Select(d => d.Name).FirstOrDefaultAsync();
                if (departmentName == null) return (new TicketProblem(404, "Department not found.", "departmentId"), null);
                departmentId = request.DepartmentId;
            }
            else if (scope == "category")
            {
                if (!request.CategoryId.HasValue) return (new TicketProblem(400, "Choose the category.", "categoryId"), null);
                categoryName = await _db.Categories.AsNoTracking().Where(c => c.Id == request.CategoryId.Value).Select(c => c.Name).FirstOrDefaultAsync();
                if (categoryName == null) return (new TicketProblem(404, "Category not found.", "categoryId"), null);
                categoryId = request.CategoryId;
            }

            var row = await _db.SlaPolicies.FirstOrDefaultAsync(r => r.DepartmentId == departmentId && r.CategoryId == categoryId && r.Priority == request.Priority);
            if (row == null)
            {
                row = new SlaPolicy { Id = Guid.NewGuid(), DepartmentId = departmentId, CategoryId = categoryId, Priority = request.Priority };
                _db.SlaPolicies.Add(row);
            }
            row.ResponseHours = request.ResponseHours;
            row.ResolutionHours = request.ResolutionHours;
            row.UpdatedAt = DateTime.UtcNow;
            row.UpdatedByUserId = actorUserId;
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { _db.ChangeTracker.Clear(); return (new TicketProblem(409, "Someone saved this level at the same moment. Try again."), null); }

            return (null, new SlaPolicyRowDto
            {
                Id = row.Id, Scope = scope, DepartmentId = departmentId, DepartmentName = departmentName, CategoryId = categoryId, CategoryName = categoryName,
                Priority = row.Priority, ResponseHours = row.ResponseHours, ResolutionHours = row.ResolutionHours, IsDefault = false
            });
        }

        public async Task<TicketProblem?> DeleteAsync(Guid id)
        {
            var row = await _db.SlaPolicies.FirstOrDefaultAsync(r => r.Id == id);
            if (row == null) return new TicketProblem(404, "That service level was not found.");
            _db.SlaPolicies.Remove(row);
            await _db.SaveChangesAsync();
            return null;
        }
    }
}