using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The first-response figures on the Reports page: per case worker for a head, per unit for the Head of Department.</summary>
    public class FirstResponseReportTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public FirstResponseReportTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, Guid CategoryId, Guid HeadId, Guid WorkerId);

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<Guid> NewUserAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.fr" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return user.Id;
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        /// <summary>A unit with a head and one mapped case worker.</summary>
        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "R" + tag, name = "Response Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Response Unit " + tag }));
            var head = await NewUserAsync();
            var worker = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = head }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = worker }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Response category " + tag, timelineHours = 24, defaultPriority = 2 }));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Units.FirstAsync(u => u.Id == unit.Id)).HeadUserId = head;
            db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = category.Id, UserId = worker, IsActive = true, AddedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
            return new Lab(unit.Id, category.Id, head, worker);
        }

        private async Task<Guid> RaiseAssignedAsync(Lab lab)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(lab.CategoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("First response test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var created = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
            for (var i = 0; i < 60; i++)
            {
                using var scope = _factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                if (await db.Tickets.AsNoTracking().AnyAsync(t => t.Id == created.Id && t.AssigneeUserId == lab.WorkerId)) return created.Id;
                await Task.Delay(250);
            }
            throw new Xunit.Sdk.XunitException("The ticket was not assigned to the case worker.");
        }

        private async Task ChangeAsync(Guid ticketId, Action<Ticket> change)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ticket = await db.Tickets.FirstAsync(t => t.Id == ticketId);
            change(ticket);
            await db.SaveChangesAsync();
        }

        private async Task CheckSlaAsync()
        {
            using var scope = _factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<ISlaService>().CheckAsync(DateTime.UtcNow);
        }

        private async Task<Ticket> LoadAsync(Guid ticketId)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().FirstAsync(t => t.Id == ticketId);
        }

        private async Task<ReportResultDto> RunAsync(Lab lab, string groupBy)
        {
            var spec = new ReportSpec
            {
                Preset = "last30", GroupBy = groupBy, UnitIds = new List<Guid> { lab.UnitId },
                Measures = new List<string> { "firstResponseMissed", "firstResponseMetPercent", "count" }
            };
            using var scope = _factory.Services.CreateScope();
            var (problem, result) = await scope.ServiceProvider.GetRequiredService<IReportService>().RunAsync(spec, lab.HeadId, false);
            Assert.Null(problem);
            return result!;
        }

        [Fact]
        public async Task A_head_sees_the_miss_against_the_case_worker_and_the_unit_figure_agrees()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => { t.CreatedAt = DateTime.UtcNow.AddDays(-7); t.AssignedAt = DateTime.UtcNow.AddDays(-7); });
            await CheckSlaAsync();

            var person = await RunAsync(lab, "assignee");
            Assert.Equal(new[] { "group", "firstResponseMissed", "firstResponseMetPercent", "count" }, person.Columns.Select(c => c.Key).ToArray());
            var row = Assert.Single(person.Rows);
            Assert.Equal(1, Convert.ToInt32(row[1]));
            Assert.Equal(0.0, Convert.ToDouble(row[2]));
            Assert.Equal(1, Convert.ToInt32(row[3]));

            var unit = await RunAsync(lab, "unit");
            var unitRow = Assert.Single(unit.Rows);
            Assert.Equal(1, Convert.ToInt32(unitRow[1]));
        }

        [Fact]
        public async Task An_answered_ticket_counts_as_responded_in_time()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => { t.AssignedAt = DateTime.UtcNow.AddDays(-7); t.FirstRespondedAt = DateTime.UtcNow.AddDays(-7).AddMinutes(20); });
            await CheckSlaAsync();

            var row = Assert.Single((await RunAsync(lab, "assignee")).Rows);
            Assert.Equal(0, Convert.ToInt32(row[1]));
            Assert.Equal(100.0, Convert.ToDouble(row[2]));
        }

        [Fact]
        public async Task The_catalogue_offers_the_new_measures_and_the_two_performance_reports()
        {
            var lab = await NewLabAsync();
            using var scope = _factory.Services.CreateScope();
            var (problem, catalogue) = await scope.ServiceProvider.GetRequiredService<IReportService>().CatalogueAsync(lab.HeadId, false);
            Assert.Null(problem);
            Assert.Contains(catalogue!.Measures, m => m.Key == "firstResponseMissed");
            Assert.Contains(catalogue.Measures, m => m.Key == "firstResponseMetPercent");
            Assert.Contains(catalogue.Measures, m => m.Key == "reopenedPercent");
            Assert.Equal("assignee", catalogue.BuiltIn.Single(r => r.Code == "R10").Definition.GroupBy);
            Assert.Equal("unit", catalogue.BuiltIn.Single(r => r.Code == "R11").Definition.GroupBy);
        }
    }
}