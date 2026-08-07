using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using StackExchange.Redis;

namespace ResourceShared.Utils
{
    /// <summary>
    /// The one place a Redis connection string turns into ConfigurationOptions.
    ///
    /// Parsing the string as-is meant TLS was whatever the string happened to
    /// say: drop "ssl=true" from REDIS_CONNECTION - by editing a secret, by
    /// falling back to a dev value, by copying a connection string that never
    /// had it - and the service connected in cleartext without a word, putting
    /// the ACL password, session state and every cached value on the wire for
    /// anything sharing the path to read. TLS is the default here instead, and
    /// turning it off has to be deliberate.
    ///
    /// Certificate validation is on by default too. It used to be off, on the
    /// grounds that Redis served a certificate it had signed itself which no
    /// client could check - true at the time, but it left all four services
    /// encrypting to whoever answered on the address. Redis now presents a
    /// cert-manager certificate from the fctf-internal-ca issuer, and the
    /// deployments mount that CA, so there is something real to verify against.
    /// </summary>
    public static class RedisOptionsFactory
    {
        /// <summary>
        /// Parses <paramref name="connectionString"/> and applies the transport
        /// security defaults. Callers keep setting their own timeout/retry
        /// options on the result.
        /// </summary>
        public static ConfigurationOptions Build(string connectionString)
        {
            var options = ConfigurationOptions.Parse(connectionString);

            // REDIS_ALLOW_PLAINTEXT exists for local development, where Redis
            // runs from docker-compose.dev.yml with no certificate at all.
            if (!options.Ssl && !EnvFlag("REDIS_ALLOW_PLAINTEXT", false))
            {
                options.Ssl = true;
            }

            // That escape hatch does not apply in a deployment. Every deployed
            // ConfigMap sets ASPNETCORE_ENVIRONMENT=Production, so this refuses
            // to hand back options that would put credentials and cached values
            // on the wire in cleartext - whether the connection string lost its
            // ssl=true or someone carried REDIS_ALLOW_PLAINTEXT over from a
            // local .env.
            if (!options.Ssl && IsProduction())
            {
                throw new InvalidOperationException(
                    "Redis TLS is disabled while ASPNETCORE_ENVIRONMENT=Production. " +
                    "Add ssl=true to REDIS_CONNECTION and remove REDIS_ALLOW_PLAINTEXT; " +
                    "the deployed Redis listens on a TLS port only.");
            }

            if (!options.Ssl)
            {
                return options;
            }

            // The escape hatch is still here, but it now has to be asked for.
            if (EnvFlag("REDIS_TLS_INSECURE_SKIP_VERIFY", false))
            {
                options.CertificateValidation += (_, _, _, _) => true;
                return options;
            }

            // With no CA configured, .NET validates against the container's
            // trust store - correct for a publicly issued certificate, and a
            // connection failure for an internally issued one, which is the
            // right way round.
            var caFile = Environment.GetEnvironmentVariable("REDIS_TLS_CA_FILE");
            if (string.IsNullOrWhiteSpace(caFile))
            {
                return options;
            }

            // Read once at startup, like the gateway does. cert-manager renews
            // the leaf certificates on its own, but a change of CA needs these
            // pods restarted. Throwing here is deliberate: a CA that was asked
            // for and cannot be read must not silently degrade into trusting
            // whatever the server presents.
            var trustedRoots = new X509Certificate2Collection();
            trustedRoots.ImportFromPemFile(caFile);
            if (trustedRoots.Count == 0)
            {
                throw new InvalidOperationException(
                    $"REDIS_TLS_CA_FILE '{caFile}' contains no certificate");
            }

            options.CertificateValidation += (_, certificate, _, errors) =>
                VerifyAgainstCa(certificate, errors, trustedRoots);

            return options;
        }

        /// <summary>
        /// Replaces chain validation with a check against our own CA, while
        /// leaving the hostname check to the platform - the certificate has to
        /// name the endpoint being dialled, not merely descend from the right CA.
        /// </summary>
        private static bool VerifyAgainstCa(
            X509Certificate? certificate,
            SslPolicyErrors errors,
            X509Certificate2Collection trustedRoots)
        {
            if (certificate is null || errors.HasFlag(SslPolicyErrors.RemoteCertificateNotAvailable))
            {
                return false;
            }

            if (errors.HasFlag(SslPolicyErrors.RemoteCertificateNameMismatch))
            {
                return false;
            }

            using var chain = new X509Chain();
            chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
            chain.ChainPolicy.CustomTrustStore.AddRange(trustedRoots);
            // The internal CA publishes no CRL or OCSP responder, so an online
            // revocation check would fail every handshake.
            chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;

            using var leaf = new X509Certificate2(certificate);
            return chain.Build(leaf);
        }

        private static bool IsProduction()
            => string.Equals(
                Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")?.Trim(),
                "Production",
                StringComparison.OrdinalIgnoreCase);

        private static bool EnvFlag(string name, bool fallback)
        {
            var raw = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(raw)
                ? fallback
                : raw.Equals("true", StringComparison.OrdinalIgnoreCase);
        }
    }
}
