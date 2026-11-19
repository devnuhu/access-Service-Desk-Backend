using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Catalogue;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Tickets;

namespace ServiceDeskAPI.Infrastructure.Persistence
{
    public class AppDbContext : IdentityDbContext<User, Role, Guid>
    {
        private static readonly DateTime SeedDate = new(2026, 11, 2, 0, 0, 0, DateTimeKind.Utc);

        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        public DbSet<UserRoleAssignment> UserRoleAssignments => Set<UserRoleAssignment>();
        public DbSet<RefreshTokenStore> RefreshTokenStores => Set<RefreshTokenStore>();
        public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
        public DbSet<InAppNotification> InAppNotifications => Set<InAppNotification>();
        public DbSet<SavedReport> SavedReports { get; set; } = null!;
        public DbSet<ReportSchedule> ReportSchedules { get; set; } = null!;
        public DbSet<Department> Departments => Set<Department>();
        public DbSet<Unit> Units => Set<Unit>();
        public DbSet<UnitMember> UnitMembers => Set<UnitMember>();
        public DbSet<Absence> Absences => Set<Absence>();
        public DbSet<Category> Categories => Set<Category>();
        public DbSet<CategorySkill> CategorySkills => Set<CategorySkill>();
        public DbSet<Location> Locations => Set<Location>();
        public DbSet<Ticket> Tickets => Set<Ticket>();
        public DbSet<TicketWatcher> TicketWatchers => Set<TicketWatcher>();
        public DbSet<TicketComment> TicketComments => Set<TicketComment>();
        public DbSet<TicketAttachment> TicketAttachments => Set<TicketAttachment>();
        public DbSet<TicketAttachmentContent> TicketAttachmentContents => Set<TicketAttachmentContent>();
        public DbSet<TicketSequence> TicketSequences => Set<TicketSequence>();
        public DbSet<TicketAssignment> TicketAssignments => Set<TicketAssignment>();
        public DbSet<TicketStatusChange> TicketStatusChanges => Set<TicketStatusChange>();

        /// <summary>The audit log is append-only: any update or delete of an AuditLog row is refused before it reaches the database.</summary>
        public override int SaveChanges(bool acceptAllChangesOnSuccess)
        {
            GuardAuditLog();
            return base.SaveChanges(acceptAllChangesOnSuccess);
        }

        public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
        {
            GuardAuditLog();
            return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }

        private void GuardAuditLog()
        {
            if (ChangeTracker.Entries<AuditLog>().Any(e => e.State == EntityState.Modified || e.State == EntityState.Deleted))
                throw new InvalidOperationException("The audit log is append-only: audit entries cannot be changed or deleted.");
        }

        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);

            // Same table names as People Hub
            builder.Entity<User>().ToTable("Users");
            builder.Entity<Role>().ToTable("Roles");
            builder.Entity<IdentityUserRole<Guid>>().ToTable("UserRoles");
            builder.Entity<IdentityUserClaim<Guid>>().ToTable("UserClaims");
            builder.Entity<IdentityUserLogin<Guid>>().ToTable("UserLogins");
            builder.Entity<IdentityRoleClaim<Guid>>().ToTable("RoleClaims");
            builder.Entity<IdentityUserToken<Guid>>().ToTable("UserTokens");

            builder.Entity<User>(e =>
            {
                e.Property(u => u.AdDistinguishedName).HasMaxLength(512);
                e.Property(u => u.CorporateEmail).HasMaxLength(256);
                e.Property(u => u.FullName).HasMaxLength(200);
                e.Property(u => u.Department).HasMaxLength(200);
                e.Property(u => u.JobTitle).HasMaxLength(200);
                e.HasIndex(u => u.AdDistinguishedName).IsUnique().HasFilter("[AdDistinguishedName] IS NOT NULL");
                e.HasIndex(u => u.CorporateEmail).IsUnique().HasFilter("[CorporateEmail] IS NOT NULL");
            });

            builder.Entity<Role>(e =>
            {
                e.Property(r => r.Description).HasMaxLength(500);
                e.HasData(
                    SeedRole(AppRoles.RequesterId, AppRoles.Requester, "Any staff member. Raises tickets, follows them, and confirms or reopens resolutions."),
                    SeedRole(AppRoles.CaseWorkerId, AppRoles.CaseWorker, "Works the tickets assigned to them in their unit."),
                    SeedRole(AppRoles.HeadOfUnitId, AppRoles.HeadOfUnit, "Runs one unit: assignment, reassignment, unit reports and level 1 escalations."),
                    SeedRole(AppRoles.HODId, AppRoles.HOD, "Oversees the department and receives level 2 escalations. Does not resolve tickets."),
                    SeedRole(AppRoles.DepartmentAdminId, AppRoles.DepartmentAdmin, "A unit head named by the Super Admin who also sees and administers the whole department: every unit, every ticket, reassignment across units."),
                    SeedRole(AppRoles.SuperAdminId, AppRoles.SuperAdmin, "Full control of the system: configuration, users, roles and every unit."));
            });

            builder.Entity<UserRoleAssignment>(e =>
            {
                e.ToTable("UserRoleAssignments");
                e.HasKey(a => a.Id);
                e.HasOne(a => a.User).WithMany(u => u.RoleAssignments).HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(a => a.Role).WithMany().HasForeignKey(a => a.RoleId).OnDelete(DeleteBehavior.Restrict);
                // Several roles per person, but each role only once while active (People Hub allowed one active role in total).
                e.HasIndex(a => new { a.UserId, a.RoleId })
                    .IsUnique()
                    .HasFilter("[IsActive] = 1")
                    .HasDatabaseName("IX_UserRoleAssignments_UserId_RoleId_Active");
            });

            builder.Entity<RefreshTokenStore>(e =>
            {
                e.ToTable("RefreshTokenStores");
                e.HasKey(t => t.Id);
                e.Property(t => t.TokenHash).HasMaxLength(128).IsRequired();
                e.Property(t => t.IssuedFromIpAddress).HasMaxLength(64);
                e.Property(t => t.IssuedFromUserAgent).HasMaxLength(512);
                e.HasIndex(t => t.TokenHash).IsUnique();
                e.HasIndex(t => new { t.UserId, t.IsRevoked });
                e.HasOne(t => t.User).WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
            });

            ConfigureAuditAndNotifications(builder);
            ConfigureOrganisation(builder);
            ConfigureCatalogue(builder);
            ConfigureTickets(builder);
        }

        private static void ConfigureTickets(ModelBuilder builder)
        {
            builder.Entity<Location>(e =>
            {
                e.ToTable("Locations");
                e.HasKey(l => l.Id);
                e.Property(l => l.Name).HasMaxLength(100).IsRequired();
                e.HasIndex(l => l.Name).IsUnique();
                e.HasData(new Location { Id = TicketSeed.HeadquartersLocationId, Name = TicketSeed.HeadquartersName, SortOrder = 1, IsActive = true, CreatedAt = SeedDate });
            });

            builder.Entity<Ticket>(e =>
            {
                e.ToTable("Tickets");
                e.HasKey(t => t.Id);
                e.Property(t => t.Reference).HasMaxLength(30).IsRequired();
                e.Property(t => t.EscalatedToHeadReason).HasMaxLength(1000);
                e.HasIndex(t => t.Reference).IsUnique();
                e.Property(t => t.Subject).HasMaxLength(TicketSeed.MaxSubjectChars).IsRequired();
                e.Property(t => t.DescriptionHtml).HasColumnType("nvarchar(max)").IsRequired();
                e.Property(t => t.DescriptionText).HasColumnType("nvarchar(max)").IsRequired();
                e.Property(t => t.RequesterDepartment).HasMaxLength(200);
                e.Property(t => t.RowVersion).IsRowVersion();
                e.Property(t => t.ResolutionNote).HasMaxLength(4000);
                e.HasOne(t => t.Department).WithMany().HasForeignKey(t => t.DepartmentId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.Unit).WithMany().HasForeignKey(t => t.UnitId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.Category).WithMany().HasForeignKey(t => t.CategoryId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.Location).WithMany().HasForeignKey(t => t.LocationId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.RequesterUser).WithMany().HasForeignKey(t => t.RequesterUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne<User>().WithMany().HasForeignKey(t => t.RaisedByUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.AssigneeUser).WithMany().HasForeignKey(t => t.AssigneeUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(t => new { t.RequesterUserId, t.CreatedAt });
                e.HasIndex(t => new { t.UnitId, t.Status });
                e.HasIndex(t => new { t.DepartmentId, t.Status });
                e.HasIndex(t => new { t.AssigneeUserId, t.Status });
                e.HasIndex(t => new { t.CategoryId, t.CreatedAt });
            });

            builder.Entity<TicketWatcher>(e =>
            {
                e.ToTable("TicketWatchers");
                e.HasKey(w => w.Id);
                e.HasOne(w => w.Ticket).WithMany(t => t.Watchers).HasForeignKey(w => w.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(w => w.User).WithMany().HasForeignKey(w => w.UserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(w => new { w.TicketId, w.UserId }).IsUnique();
                e.HasIndex(w => w.UserId);
            });

            builder.Entity<TicketComment>(e =>
            {
                e.ToTable("TicketComments");
                e.HasKey(c => c.Id);
                e.Property(c => c.BodyHtml).HasColumnType("nvarchar(max)").IsRequired();
                e.Property(c => c.BodyText).HasColumnType("nvarchar(max)").IsRequired();
                e.HasOne(c => c.Ticket).WithMany(t => t.Comments).HasForeignKey(c => c.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(c => c.AuthorUser).WithMany().HasForeignKey(c => c.AuthorUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(c => new { c.TicketId, c.CreatedAt });
            });

            builder.Entity<TicketAttachment>(e =>
            {
                e.ToTable("TicketAttachments");
                e.HasKey(a => a.Id);
                e.Property(a => a.FileName).HasMaxLength(255).IsRequired();
                e.Property(a => a.ContentType).HasMaxLength(100).IsRequired();
                e.Property(a => a.Sha256).HasMaxLength(64).IsRequired();
                e.HasOne(a => a.Ticket).WithMany(t => t.Attachments).HasForeignKey(a => a.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(a => a.Comment).WithMany().HasForeignKey(a => a.CommentId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne<User>().WithMany().HasForeignKey(a => a.UploadedByUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(a => a.TicketId);
            });

            builder.Entity<TicketAttachmentContent>(e =>
            {
                e.ToTable("TicketAttachmentContents");
                e.HasKey(c => c.AttachmentId);
                e.Property(c => c.Data).HasColumnType("varbinary(max)").IsRequired();
                e.HasOne<TicketAttachment>().WithOne().HasForeignKey<TicketAttachmentContent>(c => c.AttachmentId).OnDelete(DeleteBehavior.Cascade);
            });

            builder.Entity<TicketAssignment>(e =>
            {
                e.ToTable("TicketAssignments");
                e.HasKey(a => a.Id);
                e.Property(a => a.Reason).HasMaxLength(500).IsRequired();
                e.Property(a => a.ScoresJson).HasColumnType("nvarchar(max)");
                e.HasOne(a => a.Ticket).WithMany().HasForeignKey(a => a.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne<User>().WithMany().HasForeignKey(a => a.ToUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(a => new { a.TicketId, a.At });
                e.HasIndex(a => a.ToUserId);
            });

            builder.Entity<TicketStatusChange>(e =>
            {
                e.ToTable("TicketStatusChanges");
                e.HasKey(c => c.Id);
                e.Property(c => c.Reason).HasMaxLength(500);
                e.HasOne(c => c.Ticket).WithMany().HasForeignKey(c => c.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(c => new { c.TicketId, c.At });
            });

            builder.Entity<TicketSequence>(e =>
            {
                e.ToTable("TicketSequences");
                e.HasKey(q => new { q.DepartmentId, q.Year });
                e.HasOne<Department>().WithMany().HasForeignKey(q => q.DepartmentId).OnDelete(DeleteBehavior.Restrict);
            });
        }

        private static void ConfigureCatalogue(ModelBuilder builder)
        {
            builder.Entity<Category>(e =>
            {
                e.ToTable("Categories");
                e.HasKey(c => c.Id);
                e.Property(c => c.Name).HasMaxLength(100).IsRequired();
                e.Property(c => c.Description).HasMaxLength(300);
                e.HasOne(c => c.Department).WithMany().HasForeignKey(c => c.DepartmentId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(c => c.Unit).WithMany().HasForeignKey(c => c.UnitId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(c => new { c.DepartmentId, c.Name }).IsUnique();
                e.HasIndex(c => c.UnitId);
                e.HasData(CatalogueSeed.Categories.Select((c, i) => new Category
                {
                    Id = c.Id, DepartmentId = OrgSeed.ContributionProcessingId, UnitId = c.UnitId, Name = c.Name,
                    TimelineHours = 24, DefaultPriority = TicketPriority.Medium, SortOrder = i + 1, IsActive = true, CreatedAt = SeedDate
                }).ToArray());
            });

            builder.Entity<CategorySkill>(e =>
            {
                e.ToTable("CategorySkills");
                e.HasKey(s => s.Id);
                e.HasOne(s => s.Category).WithMany(c => c.Skills).HasForeignKey(s => s.CategoryId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(s => new { s.CategoryId, s.UserId }).IsUnique().HasFilter("[IsActive] = 1").HasDatabaseName("IX_CategorySkills_CategoryId_UserId_Active");
                e.HasIndex(s => s.UserId);
            });
        }

        /// <summary>Departments, units and members (Step 2a). Contribution Processing and its two units are seeded.</summary>
        private static void ConfigureOrganisation(ModelBuilder builder)
        {
            builder.Entity<Department>(e =>
            {
                e.ToTable("Departments");
                e.HasKey(d => d.Id);
                e.Property(d => d.Code).HasMaxLength(10).IsRequired();
                e.Property(d => d.Name).HasMaxLength(100).IsRequired();
                e.HasIndex(d => d.Code).IsUnique();
                e.HasIndex(d => d.Name).IsUnique();
                e.HasOne(d => d.HodUser).WithMany().HasForeignKey(d => d.HodUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(d => d.AdminUser).WithMany().HasForeignKey(d => d.AdminUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasData(new Department
                {
                    Id = OrgSeed.ContributionProcessingId,
                    Code = OrgSeed.ContributionProcessingCode,
                    Name = "Contribution Processing",
                    IsActive = true,
                    CreatedAt = SeedDate
                });
            });

            builder.Entity<Unit>(e =>
            {
                e.ToTable("Units");
                e.HasKey(u => u.Id);
                e.Property(u => u.Code).HasMaxLength(10).IsRequired();
                e.Property(u => u.Name).HasMaxLength(100).IsRequired();
                e.HasIndex(u => new { u.DepartmentId, u.Code }).IsUnique();
                e.HasIndex(u => new { u.DepartmentId, u.Name }).IsUnique();
                e.HasOne(u => u.Department).WithMany(d => d.Units).HasForeignKey(u => u.DepartmentId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(u => u.HeadUser).WithMany().HasForeignKey(u => u.HeadUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasData(
                    new Unit { Id = OrgSeed.ContributionMatchingUnitId, DepartmentId = OrgSeed.ContributionProcessingId, Code = OrgSeed.ContributionMatchingCode, Name = "Contribution Matching", IsActive = true, CreatedAt = SeedDate },
                    new Unit { Id = OrgSeed.RefundUnitId, DepartmentId = OrgSeed.ContributionProcessingId, Code = OrgSeed.RefundCode, Name = "Refund", IsActive = true, CreatedAt = SeedDate });
            });

            builder.Entity<UnitMember>(e =>
            {
                e.ToTable("UnitMembers");
                e.HasKey(m => m.Id);
                e.Property(m => m.StaffNo).HasMaxLength(30);
                e.HasOne(m => m.Unit).WithMany(u => u.Members).HasForeignKey(m => m.UnitId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);
                // Each person once per unit while active; one unit per department is checked by OrganisationService
                e.HasIndex(m => new { m.UnitId, m.UserId }).IsUnique().HasFilter("[IsActive] = 1").HasDatabaseName("IX_UnitMembers_UnitId_UserId_Active");
                e.HasIndex(m => m.UserId);
            });

            builder.Entity<Absence>(e =>
            {
                e.ToTable("Absences");
                e.HasKey(a => a.Id);
                e.Property(a => a.Note).HasMaxLength(200);
                e.HasOne(a => a.User).WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Restrict);
                // "Who is away today" and the overlap check both look up a person's periods by date
                e.HasIndex(a => new { a.UserId, a.StartDate, a.EndDate }).HasDatabaseName("IX_Absences_UserId_Dates");
            });
        }

        private static void ConfigureAuditAndNotifications(ModelBuilder builder)
        {
            builder.Entity<AuditLog>(e =>
            {
                e.ToTable("AuditLogs");
                e.HasKey(a => a.Id);
                e.Property(a => a.EntityType).HasMaxLength(100).IsRequired();
                e.Property(a => a.EntityDisplayName).HasMaxLength(256);
                e.Property(a => a.UserDisplayName).HasMaxLength(200);
                e.Property(a => a.IpAddress).HasMaxLength(64);
                e.Property(a => a.UserAgent).HasMaxLength(512);
                e.Property(a => a.OldValues).HasColumnType("nvarchar(max)");
                e.Property(a => a.NewValues).HasColumnType("nvarchar(max)");
                e.HasIndex(a => a.Timestamp).HasDatabaseName("IX_AuditLogs_Timestamp");
                e.HasIndex(a => new { a.EntityType, a.EntityId }).HasDatabaseName("IX_AuditLogs_EntityType_EntityId");
                e.HasIndex(a => a.UserId).HasDatabaseName("IX_AuditLogs_UserId");
            });

            builder.Entity<InAppNotification>(e =>
            {
                e.ToTable("InAppNotifications");
                e.HasKey(n => n.Id);
                e.Property(n => n.Title).HasMaxLength(256).IsRequired();
                e.Property(n => n.Message).HasMaxLength(2000).IsRequired();
                e.Property(n => n.RelatedEntityType).HasMaxLength(100);
                e.Property(n => n.DeepLinkUrl).HasMaxLength(500);
                e.HasOne(n => n.RecipientUser).WithMany().HasForeignKey(n => n.RecipientUserId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(n => new { n.RecipientUserId, n.IsRead, n.CreatedAt }).HasDatabaseName("IX_InAppNotifications_Recipient_IsRead_CreatedAt");
            });
        }

        private static Role SeedRole(Guid id, string name, string description) => new()
        {
            Id = id,
            Name = name,
            NormalizedName = name.ToUpperInvariant(),
            ConcurrencyStamp = id.ToString(),
            Description = description,
            CreatedAt = SeedDate
        };
    }
}