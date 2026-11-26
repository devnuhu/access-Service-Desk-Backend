using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Every response, even a refusal, carries the basic browser security headers.</summary>
    public class SecurityHeaderTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public SecurityHeaderTests(ServiceDeskApiFactory factory) => _factory = factory;

        [Fact]
        public async Task Every_response_carries_the_basic_security_headers()
        {
            var client = ApiTestHelpers.Client(_factory);
            var response = await client.GetAsync("/api/tickets");   // signed out: refused, but the headers are still there
            Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
            Assert.Equal("DENY", Assert.Single(response.Headers.GetValues("X-Frame-Options")));
            Assert.True(response.Headers.Contains("Referrer-Policy"));   // already set elsewhere in the pipeline
        }
    }
}