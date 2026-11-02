using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Api
{
    /// <summary>
    /// Turns the automatic "invalid request" answer of [ApiController] into the one error shape:
    /// { message, errors: { field: "what is wrong" } }, with field names as the web app sends them (camelCase).
    /// </summary>
    public static class ApiErrors
    {
        public const string ValidationMessage = "Some details are missing or not valid. Check the highlighted fields.";

        public static IActionResult ValidationResponse(ActionContext context)
        {
            var error = new ApiError(ValidationMessage);
            foreach (var (key, entry) in context.ModelState)
            {
                if (entry.Errors.Count == 0) continue;
                var field = FieldName(key);
                if (error.Errors.ContainsKey(field)) continue;
                var first = entry.Errors[0];
                error.Errors[field] = !string.IsNullOrWhiteSpace(first.ErrorMessage) ? first.ErrorMessage : "This value is not valid.";
            }
            return new BadRequestObjectResult(error) { ContentTypes = { "application/json" } };
        }

        /// <summary>"Username" -> "username", "$.roleId" -> "roleId", "Items[0].Name" -> "items[0].name", "" or "$" -> "body".</summary>
        public static string FieldName(string key)
        {
            var k = (key ?? string.Empty).Trim();
            if (k.StartsWith("$.")) k = k.Substring(2);
            if (k.Length == 0 || k == "$") return "body";
            var parts = k.Split('.');
            for (var i = 0; i < parts.Length; i++)
                if (parts[i].Length > 0) parts[i] = char.ToLowerInvariant(parts[i][0]) + parts[i].Substring(1);
            return string.Join('.', parts);
        }
    }
}