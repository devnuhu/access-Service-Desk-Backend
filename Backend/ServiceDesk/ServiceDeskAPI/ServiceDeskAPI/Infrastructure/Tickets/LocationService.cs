using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>Locations (decision of 3 Nov 2026): required on every ticket, pre-filled from the person's last ticket. HQ seeded.</summary>
    public class LocationService : ILocationService
    {
        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IHttpContextAccessor _http;

        public LocationService(AppDbContext db, IAuditService audit, IHttpContextAccessor http)
        {
            _db = db;
            _audit = audit;
            _http = http;
        }

        public async Task<LocationChoicesDto> GetChoicesAsync(Guid userId)
        {
            var active = await _db.Locations.AsNoTracking().Where(l => l.IsActive).OrderBy(l => l.SortOrder).ThenBy(l => l.Name)
                .Select(l => new LocationDto(l.Id, l.Name, l.SortOrder, l.IsActive)).ToListAsync();
            var last = await _db.Tickets.AsNoTracking().Where(t => t.RequesterUserId == userId)
                .OrderByDescending(t => t.CreatedAt).Select(t => (Guid?)t.LocationId).FirstOrDefaultAsync();
            Guid? preferred = last.HasValue && active.Any(l => l.Id == last.Value) ? last
                : active.Count == 1 ? active[0].Id : null;
            return new LocationChoicesDto { Locations = active, DefaultLocationId = preferred };
        }

        public async Task<List<LocationDto>> ListAsync() =>
            await _db.Locations.AsNoTracking().OrderByDescending(l => l.IsActive).ThenBy(l => l.SortOrder).ThenBy(l => l.Name)
                .Select(l => new LocationDto(l.Id, l.Name, l.SortOrder, l.IsActive)).ToListAsync();

        public async Task<(AdminResult Result, LocationDto? Location)> CreateAsync(SaveLocationRequest request, Guid? actorUserId)
        {
            var name = (request.Name ?? string.Empty).Trim();
            if (name.Length < 2 || name.Length > 100) return (AdminResult.Invalid("The name must be 2 to 100 characters."), null);
            if (await _db.Locations.AnyAsync(l => l.Name == name)) return (AdminResult.Conflict("A location named " + name + " already exists."), null);
            var order = request.SortOrder ?? (await _db.Locations.MaxAsync(l => (int?)l.SortOrder) ?? 0) + 1;
            var location = new Location { Id = Guid.NewGuid(), Name = name, SortOrder = order, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.Locations.Add(location);
            Stage(AuditAction.Created, location.Id, name, null, new { name, order });
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return (AdminResult.Conflict("A location named " + name + " already exists."), null); }
            return (AdminResult.Ok("Location " + name + " added."), new LocationDto(location.Id, name, order, true));
        }

        public async Task<AdminResult> UpdateAsync(Guid locationId, SaveLocationRequest request, Guid? actorUserId)
        {
            var location = await _db.Locations.FirstOrDefaultAsync(l => l.Id == locationId);
            if (location == null) return AdminResult.NotFound("Location not found.");
            var before = new { location.Name, location.SortOrder, location.IsActive };
            if (request.Name != null)
            {
                var name = request.Name.Trim();
                if (name.Length < 2 || name.Length > 100) return AdminResult.Invalid("The name must be 2 to 100 characters.");
                if (await _db.Locations.AnyAsync(l => l.Id != locationId && l.Name == name)) return AdminResult.Conflict("A location named " + name + " already exists.");
                location.Name = name;
            }
            if (request.SortOrder.HasValue)
            {
                if (request.SortOrder.Value < 0 || request.SortOrder.Value > 9999) return AdminResult.Invalid("The order must be between 0 and 9999.");
                location.SortOrder = request.SortOrder.Value;
            }
            if (request.IsActive == false && location.IsActive && !await _db.Locations.AnyAsync(l => l.Id != locationId && l.IsActive))
                return AdminResult.Invalid("At least one location must stay on: tickets need one.");
            if (request.IsActive.HasValue) location.IsActive = request.IsActive.Value;
            location.UpdatedAt = DateTime.UtcNow;
            location.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, location.Id, location.Name, before, new { location.Name, location.SortOrder, location.IsActive });
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return AdminResult.Conflict("A location with that name already exists."); }
            return AdminResult.Ok("Location " + location.Name + " updated.");
        }

        private void Stage(AuditAction action, Guid id, string display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "Location", id, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Administration);
        }
    }
}