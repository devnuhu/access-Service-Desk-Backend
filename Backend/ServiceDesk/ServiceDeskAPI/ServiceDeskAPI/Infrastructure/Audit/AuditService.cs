using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Audit
{
    /// <summary>
    /// Audit logging, ported from People Hub. Changes: LogAsync writes through its own short-lived DbContext, so it never
    /// saves the caller's other pending changes by accident; failures go to the application log instead of the console;
    /// long values are cut to the column sizes so an audit write cannot fail on length.
    /// </summary>
    public class AuditService : IAuditService
    {
        private readonly AppDbContext _dbContext;
        private readonly DbContextOptions<AppDbContext> _options;
        private readonly ILogger<AuditService> _logger;

        public AuditService(AppDbContext dbContext, DbContextOptions<AppDbContext> options, ILogger<AuditService> logger)
        {
            _dbContext = dbContext;
            _options = options;
            _logger = logger;
        }

        public async Task LogAsync(Guid? userId, string? userDisplayName, AuditAction action, string entityType, Guid entityId,
            string? entityDisplayName, string? oldValues, string? newValues, string? ipAddress, string? userAgent, AuditModule module)
        {
            try
            {
                await using var own = new AppDbContext(_options);
                own.AuditLogs.Add(Build(userId, userDisplayName, action, entityType, entityId, entityDisplayName, oldValues, newValues, ipAddress, userAgent, module));
                await own.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                // An audit failure must not break the main operation, but it must be visible.
                _logger.LogError(ex, "Audit entry could not be written: {Action} {EntityType} {EntityId}", action, entityType, entityId);
            }
        }

        public void Stage(Guid? userId, string? userDisplayName, AuditAction action, string entityType, Guid entityId,
            string? entityDisplayName, string? oldValues, string? newValues, string? ipAddress, string? userAgent, AuditModule module)
        {
            _dbContext.AuditLogs.Add(Build(userId, userDisplayName, action, entityType, entityId, entityDisplayName, oldValues, newValues, ipAddress, userAgent, module));
        }

        private static AuditLog Build(Guid? userId, string? userDisplayName, AuditAction action, string entityType, Guid entityId,
            string? entityDisplayName, string? oldValues, string? newValues, string? ipAddress, string? userAgent, AuditModule module) => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            UserDisplayName = Cut(userDisplayName, 200),
            Action = action,
            EntityType = Cut(entityType, 100) ?? string.Empty,
            EntityId = entityId,
            EntityDisplayName = Cut(entityDisplayName, 256),
            OldValues = oldValues,
            NewValues = newValues,
            IpAddress = Cut(ipAddress, 64),
            UserAgent = Cut(userAgent, 512),
            Timestamp = DateTime.UtcNow,
            Module = module
        };

        private static string? Cut(string? value, int max) => value == null || value.Length <= max ? value : value.Substring(0, max);
    }
}