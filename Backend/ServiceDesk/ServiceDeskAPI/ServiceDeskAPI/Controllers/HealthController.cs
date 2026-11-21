using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Controllers;

/// <summary>Liveness check. Replaced by the full health checks in a later step.</summary>
[ApiController]
[Route("api/health")]
[Produces("application/json")]
public class HealthController : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(HealthDto), StatusCodes.Status200OK)]
    public IActionResult Get() => Ok(new HealthDto("ok", ServiceDeskAPI.Infrastructure.AppBrand.Name));
}