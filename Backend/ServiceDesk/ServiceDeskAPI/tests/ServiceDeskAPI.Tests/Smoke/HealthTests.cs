using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Controllers;
using Xunit;

namespace ServiceDeskAPI.Tests.Smoke;

public class HealthTests
{
    [Fact]
    public void Health_returns_ok()
    {
        var result = new HealthController().Get();
        Assert.IsType<OkObjectResult>(result);
    }
}