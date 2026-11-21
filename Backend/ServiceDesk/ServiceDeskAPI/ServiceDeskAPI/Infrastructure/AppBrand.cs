namespace ServiceDeskAPI.Infrastructure
{
    /// <summary>
    /// The name of the application, in one place. Users see it in emails, notifications and messages. Change it here and nowhere else.
    /// The emails also read EmailSettings:Brand:AppName, which overrides this default when it is set.
    /// </summary>
    public static class AppBrand
    {
        public const string Name = "Servio";
    }
}