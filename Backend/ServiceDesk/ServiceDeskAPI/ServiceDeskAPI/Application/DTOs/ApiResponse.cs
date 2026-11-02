namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>Response wrapper, as in People Hub.</summary>
    public class ApiResponse
    {
        public int StatusCode { get; set; }
        public string Message { get; set; } = string.Empty;
        /// <summary>Field errors, same shape as ApiError: { field: "what is wrong" }. Empty when none.</summary>
        public Dictionary<string, string> Errors { get; set; } = new();
    }

    /// <summary>Response wrapper with a typed payload, as in People Hub.</summary>
    public class ApiResponse<T>
    {
        public int StatusCode { get; set; }
        public string Message { get; set; } = string.Empty;
        public T? Data { get; set; }
        /// <summary>Field errors, same shape as ApiError: { field: "what is wrong" }. Empty when none.</summary>
        public Dictionary<string, string> Errors { get; set; } = new();
    }
}