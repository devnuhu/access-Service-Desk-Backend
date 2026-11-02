using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Organisation
{
    /// <summary>Step 2b: leave and out of office, who is available, and who may see and change it (BRD 5.3).</summary>
    public class AvailabilityTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AvailabilityTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private DateOnly Today()
        {
            using var scope = _factory.Services.CreateScope();
            return scope.ServiceProvider.GetRequiredService<IAvailabilityService>().Today();
        }

        /// <summary>A new person who can sign in (test.* name, test password), added to the unit by the Super Admin.</summary>
        private async Task<(Guid Id, string UserName)> NewMemberAsync(Guid unitId)
        {
            Guid id;
            var name = "test.av" + Guid.NewGuid().ToString("N").Substring(0, 8);
            using (var scope = _factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
                var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
                Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
                await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
                id = user.Id;
            }
            var join = await (await As("test.superadmin")).PostAsJsonAsync($"/api/admin/units/{unitId}/members", new { userId = id });
            Assert.Equal(HttpStatusCode.OK, join.StatusCode);
            return (id, name);
        }

        private static object Period(DateOnly start, DateOnly end, Guid? userId = null, int kind = 1) =>
            new { userId, kind, startDate = start, endDate = end, note = "Annual leave" };

        private async Task<Absence> AbsenceRow(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Absences.AsNoTracking().SingleAsync(a => a.Id == id);
        }

        private async Task<Guid> IdOf(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        [Fact]
        public async Task Leave_from_today_makes_a_case_worker_unavailable_and_tells_their_head()
        {
            var today = Today();
            var (person, name) = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            var client = await As(name);

            var response = await client.PostAsJsonAsync("/api/availability/absences", Period(today, today.AddDays(2)));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var absence = await response.Content.ReadFromJsonAsync<AbsenceDto>();

            var mine = await client.GetFromJsonAsync<MyAvailabilityDto>("/api/availability/me");
            Assert.True(mine!.InStructure);
            Assert.False(mine.AvailableNow);
            Assert.Equal(absence!.Id, mine.Current!.Id);

            using (var scope = _factory.Services.CreateScope())
            {
                var service = scope.ServiceProvider.GetRequiredService<IAvailabilityService>();
                var available = await service.AvailableMemberIdsAsync(OrgSeed.ContributionMatchingUnitId);
                Assert.DoesNotContain(person, available);
                Assert.Contains(await IdOf("test.caseworker1"), available);
                Assert.False(await service.IsAvailableAsync(person));

                var hou = await IdOf("test.hou");
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == hou && n.RelatedEntityId == absence.Id));
            }

            var unit = await (await As("test.hou")).GetFromJsonAsync<UnitAvailabilityDto>($"/api/availability/units/{OrgSeed.ContributionMatchingUnitId}");
            var row = Assert.Single(unit!.Members, m => m.UserId == person);
            Assert.False(row.AvailableNow);
            Assert.True(unit.AvailableCount < unit.MemberCount);
        }

        [Fact]
        public async Task Future_leave_keeps_a_person_available_until_it_starts()
        {
            var today = Today();
            var (person, name) = await NewMemberAsync(OrgSeed.RefundUnitId);
            var client = await As(name);

            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(10), today.AddDays(12), kind: 2))).StatusCode);

            var mine = await client.GetFromJsonAsync<MyAvailabilityDto>("/api/availability/me");
            Assert.True(mine!.AvailableNow);
            Assert.Null(mine.Current);
            var only = Assert.Single(mine.Absences);
            Assert.Equal(AbsenceKind.OutOfOffice, only.Kind);

            var unit = await (await As("test.hou2")).GetFromJsonAsync<UnitAvailabilityDto>($"/api/availability/units/{OrgSeed.RefundUnitId}");
            var row = Assert.Single(unit!.Members, m => m.UserId == person);
            Assert.True(row.AvailableNow);
            Assert.Single(row.Upcoming);
        }

        [Fact]
        public async Task Heads_record_leave_for_their_own_unit_and_the_HOD_for_the_department()
        {
            var today = Today();
            var (matching, _) = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            var (refund, _) = await NewMemberAsync(OrgSeed.RefundUnitId);
            var (other, _) = await NewMemberAsync(OrgSeed.RefundUnitId);
            var hou = await As("test.hou");

            var own = await hou.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(2), matching));
            var notMine = await hou.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(2), refund));
            var byHod = await (await As("test.hod")).PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(2), refund));
            var byWorker = await (await As("test.caseworker1")).PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(5), today.AddDays(6), matching));
            var bySuperAdmin = await (await As("test.superadmin")).PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(1), other));
            var requesterOwn = await (await As("test.requester")).PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(1)));

            Assert.Equal(HttpStatusCode.OK, own.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, notMine.StatusCode);
            Assert.Equal(HttpStatusCode.OK, byHod.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, byWorker.StatusCode);
            Assert.Equal(HttpStatusCode.OK, bySuperAdmin.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, requesterOwn.StatusCode);

            // The person is told when someone else records their leave
            var recorded = await own.Content.ReadFromJsonAsync<AbsenceDto>();
            Assert.Equal("Test Head of Unit", recorded!.RecordedBy);
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == matching && n.RelatedEntityId == recorded.Id));
        }

        [Fact]
        public async Task Dates_are_checked_and_periods_do_not_overlap()
        {
            var today = Today();
            var (_, name) = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            var client = await As(name);
            async Task<HttpStatusCode> Post(object body) => (await client.PostAsJsonAsync("/api/availability/absences", body)).StatusCode;

            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(3), today.AddDays(1))));
            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(-3), today.AddDays(-1))));
            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(-40), today)));
            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(1), today.AddDays(400))));
            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(1), today.AddDays(2), kind: 9)));

            var missing = await client.PostAsJsonAsync("/api/availability/absences", new { kind = 1, endDate = today });
            Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
            var error = await missing.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(error.GetProperty("errors").TryGetProperty("startDate", out _));

            Assert.Equal(HttpStatusCode.OK, await Post(Period(today.AddDays(5), today.AddDays(7))));
            Assert.Equal(HttpStatusCode.Conflict, await Post(Period(today.AddDays(7), today.AddDays(9))));
            Assert.Equal(HttpStatusCode.OK, await Post(Period(today.AddDays(8), today.AddDays(9))));
        }

        [Fact]
        public async Task Cancelling_removes_future_leave_and_ending_current_leave_early_keeps_the_days_taken()
        {
            var today = Today();
            var (_, name) = await NewMemberAsync(OrgSeed.RefundUnitId);
            var client = await As(name);
            var current = await (await client.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(-2), today.AddDays(3)))).Content.ReadFromJsonAsync<AbsenceDto>();
            var future = await (await client.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(20), today.AddDays(21)))).Content.ReadFromJsonAsync<AbsenceDto>();

            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.hou")).DeleteAsync($"/api/availability/absences/{future!.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As("test.hou2")).DeleteAsync($"/api/availability/absences/{future.Id}")).StatusCode);
            Assert.True((await AbsenceRow(future.Id)).IsCancelled);

            Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync($"/api/availability/absences/{current!.Id}")).StatusCode);
            var ended = await AbsenceRow(current.Id);
            Assert.False(ended.IsCancelled);
            Assert.Equal(today.AddDays(-1), ended.EndDate);

            var mine = await client.GetFromJsonAsync<MyAvailabilityDto>("/api/availability/me");
            Assert.True(mine!.AvailableNow);
            Assert.Empty(mine.Absences);

            Assert.Equal(HttpStatusCode.BadRequest, (await client.DeleteAsync($"/api/availability/absences/{current.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/api/availability/absences/{future.Id}")).StatusCode);
        }

        [Fact]
        public async Task Only_the_unit_head_the_HOD_and_a_Super_Admin_see_unit_availability()
        {
            var worker = await As("test.caseworker1");
            var hou = await As("test.hou");

            Assert.Equal(HttpStatusCode.Forbidden, (await worker.GetAsync($"/api/availability/units/{OrgSeed.ContributionMatchingUnitId}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await hou.GetAsync($"/api/availability/units/{OrgSeed.RefundUnitId}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await hou.GetAsync($"/api/availability/departments/{OrgSeed.ContributionProcessingId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await hou.GetAsync($"/api/availability/units/{Guid.NewGuid()}")).StatusCode);

            var matching = await hou.GetFromJsonAsync<UnitAvailabilityDto>($"/api/availability/units/{OrgSeed.ContributionMatchingUnitId}");
            Assert.Contains(matching!.Members, m => m.UserName == "test.caseworker1");
            Assert.Contains(matching.Members, m => m.UserName == "test.caseworker3");
            Assert.True(matching.Members[0].IsHead);

            var department = await (await As("test.hod")).GetFromJsonAsync<List<UnitAvailabilityDto>>($"/api/availability/departments/{OrgSeed.ContributionProcessingId}");
            Assert.Equal(2, department!.Count);

            var refund = await (await As("test.superadmin")).GetFromJsonAsync<UnitAvailabilityDto>($"/api/availability/units/{OrgSeed.RefundUnitId}");
            Assert.Equal("test.hou2", refund!.Members[0].UserName);
            Assert.Contains(refund.Members, m => m.UserName == "test.caseworker4");
        }
    }
}