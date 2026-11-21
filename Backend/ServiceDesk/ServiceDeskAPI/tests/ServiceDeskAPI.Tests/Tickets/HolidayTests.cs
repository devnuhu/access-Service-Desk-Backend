using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Infrastructure.Sla;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Company holidays: kept by the Super Admin and skipped by the SLA clock straight away.</summary>
    public class HolidayTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public HolidayTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private BusinessClock Clock() => BusinessClock.From(_factory.Services.GetRequiredService<IOptions<SlaOptions>>().Value);

        [Fact]
        public async Task A_holiday_is_skipped_by_the_clock_at_once_and_counted_again_when_removed()
        {
            var admin = await As("test.superadmin");
            var wednesday = new DateTime(2031, 3, 5);              // a Wednesday
            var tuesdayLate = new DateTime(2031, 3, 4, 15, 0, 0, DateTimeKind.Utc); // 16:00 in Lagos, one hour before closing

            Assert.True(Clock().IsWorkingDay(wednesday));
            Assert.Equal(new DateTime(2031, 3, 5, 8, 0, 0, DateTimeKind.Utc), Clock().AddBusinessMinutes(tuesdayLate, 120)); // Wednesday 09:00 Lagos

            var add = await admin.PostAsJsonAsync("/api/admin/holidays", new { date = "2031-03-05", name = "Test Holiday" });
            Assert.Equal(HttpStatusCode.OK, add.StatusCode);
            var holiday = (await add.Content.ReadFromJsonAsync<HolidayDto>())!;
            Assert.False(holiday.FromConfig);

            Assert.False(Clock().IsWorkingDay(wednesday));
            Assert.Equal(new DateTime(2031, 3, 6, 8, 0, 0, DateTimeKind.Utc), Clock().AddBusinessMinutes(tuesdayLate, 120));    // skips to Thursday 09:00 Lagos

            var listed = await admin.GetFromJsonAsync<List<HolidayDto>>("/api/admin/holidays?year=2031");
            Assert.Contains(listed!, h => h.Id == holiday.Id && h.Name == "Test Holiday");

            Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/admin/holidays/{holiday.Id}")).StatusCode);
            Assert.True(Clock().IsWorkingDay(wednesday));
        }

        [Fact]
        public async Task Duplicates_bad_input_and_non_admins_are_refused()
        {
            var admin = await As("test.superadmin");
            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/admin/holidays", new { date = "2031-03-12", name = "Once" })).StatusCode);

            Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/admin/holidays", new { date = "2031-03-12", name = "Twice" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/holidays", new { date = "2031-03-13", name = "x" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/holidays", new { date = "1990-01-01", name = "Too old" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/admin/holidays/{Guid.NewGuid()}")).StatusCode);

            var head = await As("test.hou");
            Assert.Equal(HttpStatusCode.Forbidden, (await head.GetAsync("/api/admin/holidays")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await head.PostAsJsonAsync("/api/admin/holidays", new { date = "2031-03-14", name = "Nope" })).StatusCode);
        }
    }
}