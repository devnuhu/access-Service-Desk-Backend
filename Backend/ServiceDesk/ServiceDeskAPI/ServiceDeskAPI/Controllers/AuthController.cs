using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Middleware;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Sign-in (ported from People Hub).
    /// POST /api/auth/login, POST /api/auth/refresh, GET /api/auth/me, POST /api/auth/logout.
    /// Tokens are set as HttpOnly cookies (Service Desk names, see AuthCookies) and also returned in the body.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Produces("application/json")]
    public class AuthController : ControllerBase
    {
        private readonly IAuthService _authService;
        private readonly ILogger<AuthController> _logger;
        private readonly JwtSettings _jwt;
        private readonly IHostEnvironment _environment;
        private readonly IAuditService _audit;

        public AuthController(IAuthService authService, ILogger<AuthController> logger, IOptions<JwtSettings> jwt, IHostEnvironment environment, IAuditService audit)
        {
            _authService = authService;
            _logger = logger;
            _jwt = jwt.Value;
            _environment = environment;
            _audit = audit;
        }

        /// <summary>Sign in with AD credentials (or a Development test account).</summary>
        [HttpPost("login")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status429TooManyRequests)]
        public async Task<ActionResult<ApiResponse<LoginResponse>>> Login([FromBody] LoginRequest request)
        {
            var (success, message, response) = await _authService.LoginAsync(request);
            if (!success || response == null)
                return Unauthorized(new ApiResponse<LoginResponse> { StatusCode = 401, Message = message });

            SetAuthenticationCookies(response);
            return Ok(new ApiResponse<LoginResponse> { StatusCode = 200, Message = message, Data = response });
        }

        /// <summary>New tokens from a refresh token (cookie first, then body). The old refresh token stops working.</summary>
        [HttpPost("refresh")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status429TooManyRequests)]
        public async Task<ActionResult<ApiResponse<LoginResponse>>> RefreshToken([FromBody] RefreshTokenRequest? request)
        {
            var refreshToken = AuthCookies.ReadRefreshToken(Request);
            if (string.IsNullOrWhiteSpace(refreshToken))
                refreshToken = request?.RefreshToken;

            if (string.IsNullOrWhiteSpace(refreshToken))
                return BadRequest(new ApiResponse<LoginResponse> { StatusCode = 400, Message = "Refresh token is required." });

            var (success, message, response) = await _authService.RefreshTokenAsync(refreshToken);
            if (!success || response == null)
            {
                ClearAuthenticationCookies();
                return Unauthorized(new ApiResponse<LoginResponse> { StatusCode = 401, Message = message });
            }

            SetAuthenticationCookies(response);
            return Ok(new ApiResponse<LoginResponse> { StatusCode = 200, Message = message, Data = response });
        }

        /// <summary>The signed-in person and every role they hold.</summary>
        [HttpGet("me")]
        [Authorize]
        [ProducesResponseType(typeof(ApiResponse<UserProfileDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(typeof(ApiResponse<UserProfileDto>), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<ApiResponse<UserProfileDto>>> GetCurrentUser()
        {
            if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
                return Unauthorized(new ApiResponse<UserProfileDto> { StatusCode = 401, Message = "Invalid user context" });

            var (success, message, user) = await _authService.GetCurrentUserAsync(userId);
            if (!success)
                return NotFound(new ApiResponse<UserProfileDto> { StatusCode = 404, Message = message });

            return Ok(new ApiResponse<UserProfileDto> { StatusCode = 200, Message = message, Data = user });
        }

        /// <summary>
        /// A fresh CSRF token for a signed-in browser, for example after a page reload. Sets the CSRF cookie and returns the value.
        /// </summary>
        [HttpGet("csrf")]
        [Authorize]
        [ProducesResponseType(typeof(ApiResponse<string>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public ActionResult<ApiResponse<string>> Csrf()
        {
            var token = CsrfProtectionMiddleware.Issue(HttpContext, _environment.IsDevelopment(), DateTime.UtcNow.AddDays(_jwt.RefreshTokenExpiryDays));
            return Ok(new ApiResponse<string> { StatusCode = 200, Message = "CSRF token issued.", Data = token });
        }

        /// <summary>
        /// Sign out: revokes the refresh token and clears the cookies. Open to anonymous callers so an expired
        /// access token never leaves a person unable to sign out.
        /// </summary>
        [HttpPost("logout")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status200OK)]
        public async Task<ActionResult<ApiResponse>> Logout([FromBody] RefreshTokenRequest? request)
        {
            var refreshToken = AuthCookies.ReadRefreshToken(Request);
            if (string.IsNullOrWhiteSpace(refreshToken))
                refreshToken = request?.RefreshToken;

            try
            {
                if (!string.IsNullOrWhiteSpace(refreshToken))
                    await _authService.RevokeRefreshTokenAsync(refreshToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not revoke the refresh token during logout");
            }

            _logger.LogInformation("User logged out: {Username}", User.FindFirst(ClaimTypes.Name)?.Value ?? "(token expired)");
            var actor = AuditActor.From(HttpContext);
            if (actor.UserId is Guid userId)
                await _audit.LogAsync(userId, actor.DisplayName, AuditAction.Logout, "User", userId, User.FindFirst(ClaimTypes.Name)?.Value,
                    null, null, actor.IpAddress, actor.UserAgent, AuditModule.Authentication);
            ClearAuthenticationCookies();
            return Ok(new ApiResponse { StatusCode = 200, Message = "Logout successful." });
        }

        private void SetAuthenticationCookies(LoginResponse tokens)
        {
            var isHttps = Request.IsHttps;
            var isDevelopment = _environment.IsDevelopment();

            // Same rules as People Hub: SameSite=None in Development (frontend on another port), Strict over HTTPS, otherwise Lax.
            CookieOptions Options(DateTime expires) => new()
            {
                HttpOnly = true,
                Secure = isDevelopment || isHttps,
                SameSite = isDevelopment ? SameSiteMode.None : (isHttps ? SameSiteMode.Strict : SameSiteMode.Lax),
                Path = "/",
                Expires = expires
            };

            Response.Cookies.Append(isHttps ? AuthCookies.AccessHttps : AuthCookies.AccessHttp, tokens.AccessToken,
                Options(DateTime.UtcNow.AddMinutes(_jwt.AccessTokenExpiryMinutes)));
            Response.Cookies.Append(isHttps ? AuthCookies.RefreshHttps : AuthCookies.RefreshHttp, tokens.RefreshToken,
                Options(DateTime.UtcNow.AddDays(_jwt.RefreshTokenExpiryDays)));

            // A new CSRF token with every sign-in and refresh (cookie + X-CSRF-Token header + body)
            tokens.CsrfToken = CsrfProtectionMiddleware.Issue(HttpContext, isDevelopment, DateTime.UtcNow.AddDays(_jwt.RefreshTokenExpiryDays));
        }

        private void ClearAuthenticationCookies()
        {
            var expired = new CookieOptions
            {
                HttpOnly = true,
                Secure = true,
                SameSite = Request.IsHttps ? SameSiteMode.Strict : SameSiteMode.Lax,
                Path = "/",
                Expires = DateTime.UtcNow.AddDays(-1)
            };
            var current = Request.IsHttps
                ? new[] { AuthCookies.AccessHttps, AuthCookies.RefreshHttps, AuthCookies.CsrfHttps }
                : new[] { AuthCookies.AccessHttp, AuthCookies.RefreshHttp, AuthCookies.CsrfHttp };
            var all = new[] { AuthCookies.AccessHttps, AuthCookies.AccessHttp, AuthCookies.RefreshHttps, AuthCookies.RefreshHttp, AuthCookies.CsrfHttps, AuthCookies.CsrfHttp };
            foreach (var name in all)
            {
                if (current.Contains(name) || Request.Cookies.ContainsKey(name))
                    Response.Cookies.Append(name, string.Empty, expired);
            }
        }
    }
}