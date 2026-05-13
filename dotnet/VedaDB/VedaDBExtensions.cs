using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System;

namespace VedaDB
{
    public static class VedaDBExtensions
    {
        public static IServiceCollection AddVedaDB(this IServiceCollection services, IConfiguration configuration)
        {
            var config = configuration.GetSection("VedaDB");
            var host = config["Host"] ?? "localhost";
            var port = int.Parse(config["Port"] ?? "6380");
            var useTls = bool.Parse(config["UseTls"] ?? "false");
            var username = config["Username"];
            var password = config["Password"];
            var poolMaxSize = int.Parse(config["PoolMaxSize"] ?? "10");

            services.AddSingleton<VedaClient>(sp =>
            {
                if (useTls || !string.IsNullOrEmpty(username))
                    return new VedaClient(host, port, useTls, username, password);
                return new VedaClient(host, port);
            });

            services.AddScoped<VedaDBAsyncClient>(sp =>
            {
                var syncClient = sp.GetRequiredService<VedaClient>();
                return new VedaDBAsyncClient(syncClient);
            });

            services.AddSingleton<VedaPool>(sp =>
            {
                var logger = sp.GetService<ILogger<VedaPool>>();
                return new VedaPool(logger, host, port, poolMaxSize, useTls, username, password);
            });

            return services;
        }

        public static IServiceCollection AddVedaDB(this IServiceCollection services, Action<VedaDBOptions> configureOptions)
        {
            var options = new VedaDBOptions();
            configureOptions(options);

            services.AddSingleton<VedaClient>(sp =>
            {
                if (options.UseTls || !string.IsNullOrEmpty(options.Username))
                    return new VedaClient(options.Host, options.Port, options.UseTls, options.Username, options.Password);
                return new VedaClient(options.Host, options.Port);
            });

            services.AddScoped<VedaDBAsyncClient>(sp =>
            {
                var syncClient = sp.GetRequiredService<VedaClient>();
                return new VedaDBAsyncClient(syncClient);
            });

            return services;
        }

        public static IApplicationBuilder UseVedaDB(this IApplicationBuilder app)
        {
            return app.UseMiddleware<VedaDBMiddleware>();
        }
    }

    public class VedaDBOptions
    {
        public string Host { get; set; } = "localhost";
        public int Port { get; set; } = 6380;
        public bool UseTls { get; set; } = false;
        public string Username { get; set; }
        public string Password { get; set; }
        public int PoolMaxSize { get; set; } = 10;
        public string Database { get; set; }
        public int CommandTimeout { get; set; } = 30;
    }
}
