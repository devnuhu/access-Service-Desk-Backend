using System.Reflection;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace ServiceDeskAPI.Infrastructure.Api
{
    /// <summary>Marks an action that answers 200 with a file download, so Swagger describes it as binary (not JSON).</summary>
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class FileDownloadAttribute : Attribute
    {
    }

    /// <summary>
    /// Swagger only lists response types an output formatter can write, and none writes raw files, so a download's 200 would
    /// have no schema. This filter writes it as application/octet-stream, string/binary.
    /// </summary>
    public sealed class FileDownloadOperationFilter : IOperationFilter
    {
        public void Apply(OpenApiOperation operation, OperationFilterContext context)
        {
            if (context.MethodInfo.GetCustomAttribute<FileDownloadAttribute>() == null) return;
            operation.Responses["200"] = new OpenApiResponse
            {
                Description = "The file, always sent as a download.",
                Content =
                {
                    ["application/octet-stream"] = new OpenApiMediaType { Schema = new OpenApiSchema { Type = "string", Format = "binary" } }
                }
            };
        }
    }
}