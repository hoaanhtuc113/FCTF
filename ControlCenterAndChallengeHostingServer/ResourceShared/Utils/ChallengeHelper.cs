using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ResourceShared.Utils
{
    public static class ChallengeHelper
    {
        private static byte[] Secret => GetSecretBytes();

        private static byte[] GetSecretBytes()
        {
            var secret = Environment.GetEnvironmentVariable("PRIVATE_KEY");
            if (string.IsNullOrWhiteSpace(secret))
            {
                throw new InvalidOperationException("Missing PRIVATE_KEY");
            }
            return Encoding.UTF8.GetBytes(secret);
        }

        public static string ModifyDescription(Challenge challenge)
        {
            var inputText = challenge.Description;
            if (!string.IsNullOrWhiteSpace(inputText) && challenge.Type == "multiple_choice")
            {
                try
                {
                    var lines = inputText.Trim().Split('\n');
                    var questionLines = new StringBuilder();
                    var options = new List<string>();

                    foreach (var rawLine in lines)
                    {
                        var line = rawLine.Trim();
                        if (line.StartsWith("* ()"))
                        {
                            options.Add(line.Substring(4).Trim());
                        }
                        else
                        {
                            if (questionLines.Length > 0) questionLines.Append(" ");
                            questionLines.Append(line);
                        }
                    }

                    if (questionLines.Length == 0 || options.Count == 0)
                        throw new Exception("Invalid format");

                    var description = new StringBuilder();
                    description.Append($@"<div className=""space-y-4"">
                        <p className=""text-lg font-medium mb-4"">{questionLines.ToString().Trim()}<br /></p>");

                    for (int idx = 0; idx < options.Count; idx++)
                    {
                        description.Append($@"
                    <div className=""flex items-center""><input 
                            type=""radio"" 
                            name=""radio-group"" 
                            value=""{options[idx]}"" 
                            className=""w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"" 
                        /><label 
                            htmlFor=""option-{idx}"" 
                            className=""ml-2 text-sm text-gray-700""
                        > {options[idx]}</label></div>");
                    }

                    description.Append("</div>");
                    return description.ToString();
                }
                catch
                {
                    return challenge.Description;
                }
            }
            return challenge.Description;
        }

        public static string GetCacheKey(int challengeId, int teamId)
        {
            return $"deploy_challenge_{challengeId}_{teamId}";
        }

        public static string GetZSetKKey(int teamId)
        {
            return $"active_deploys_team_{teamId}";
        }

        public static string GenerateChallengeToken(
            string routeInfo,
            DateTimeOffset expiryUtc)
        {
            var payload = new
            {
                exp = expiryUtc.ToUnixTimeSeconds(),
                route = routeInfo
            };

            var payloadJson = JsonSerializer.Serialize(payload);
            var payloadB64 = Base64UrlEncode(Encoding.UTF8.GetBytes(payloadJson));

            using var hmac = new HMACSHA256(Secret);
            var signature = hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadB64));
            var signatureB64 = Base64UrlEncode(signature);

            return $"{payloadB64}.{signatureB64}";
        }

        private static string Base64UrlEncode(byte[] data)
            => Convert.ToBase64String(data)
                .Replace("+", "-")
                .Replace("/", "_")
                .TrimEnd('=');


        // public static string GenerateCacheAttemptKey(int challengeId, int teamId)
        // {
        //     var rawKey = $"challenge_status_{challengeId}_{teamId}";
        //     using var md5 = MD5.Create();
        //     var hashBytes = md5.ComputeHash(Encoding.UTF8.GetBytes(rawKey));
        //     return BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
        // }

        public static string GetDeploymentAppName(int teamId, int challengeId, string challengeName)
        {
            var date = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var challName = ParseAlphaNumeric(challengeName);
            teamId = teamId == -1 ? 0 : teamId;
            string srtTeamId = teamId == -2 ? "shared" : null;

            if(!string.IsNullOrEmpty(srtTeamId))
            {
                return $"team-{srtTeamId}-{challengeId}-{challName}-{date}".ToLower().Replace(" ", "-");
            }

            return $"team-{teamId}-{challengeId}-{challName}-{date}".ToLower().Replace(" ", "-");
        }

        public static (int teamId, int challengeId) ParseDeploymentAppName(string appName)
        {
            var parts = appName.Split('-', StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length < 3 || !parts[0].StartsWith("team"))
                throw new ArgumentException("Invalid app name format", nameof(appName));

            int teamId;
            if (string.Equals(parts[1], "shared", StringComparison.OrdinalIgnoreCase))
            {
                teamId = -2;
            }
            else if (!int.TryParse(parts[1], out teamId))
            {
                throw new FormatException("Invalid teamId in app name");
            }

            if (!int.TryParse(parts[2], out int challengeId))
                throw new FormatException("Invalid challengeId in app name");

            teamId = teamId == 0 ? -1 : teamId;
            return (teamId, challengeId);
        }


        public static string ParseAlphaNumeric(string input)
        {
            if (string.IsNullOrWhiteSpace(input))
                return string.Empty;
            string normalized = input.Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder(input.Length);

            foreach (char c in normalized)
            {
                var unicodeCategory = CharUnicodeInfo.GetUnicodeCategory(c);
                if (unicodeCategory != UnicodeCategory.NonSpacingMark)
                {
                    if (char.IsLetterOrDigit(c))
                        sb.Append(char.ToLowerInvariant(c));
                    else if (char.IsWhiteSpace(c))
                        sb.Append('-');
                }
            }
            return sb.ToString().Normalize(NormalizationForm.FormC);
        }

        public static (object payload, string appName) BuildArgoPayload(
            Challenge challenge,
            int teamId,
            ChallengeImageDTO challengeImage,
            string cpu_limit,
            string cpu_request,
            string memory_limit,
            string memory_request,
            bool use_gvisor,
            bool harden_container,
            string pow_difficulty,
            string? flagValue = null,
            string? correlationId = null)
        {
            var isTemp = true;
            if (challenge.TimeLimit.HasValue && challenge.TimeLimit.Value <= 0)
            {
                //isTemp = false;

                //NOTE: Sau này sẽ fix lại chỗ này để lấy từ tbl config
                challenge.TimeLimit = 1;
            }

            var deploymentAppName = GetDeploymentAppName(teamId, challenge.Id, challenge.Name);
            var startChallengeTemplate = Environment.GetEnvironmentVariable("START_CHALLENGE_TEMPLATE")
                ?? throw new InvalidOperationException("Missing START_CHALLENGE_TEMPLATE");

            var labelTeamId = teamId == -2 ? "shared" : teamId <= 0 ? "0" : teamId.ToString();

            var parameters = new List<string>
            {
                $"CHALLENGE_NAME={deploymentAppName}",
                $"CONTAINER_PORT={challengeImage.exposedPort}",
                $"CONTAINER_IMAGE={challengeImage.imageLink}",
                $"CPU_LIMIT={cpu_limit}",
                $"CPU_REQUEST={cpu_request}",
                $"MEMORY_LIMIT={memory_limit}",
                $"MEMORY_REQUEST={memory_request}",
                $"USE_GVISOR={use_gvisor.ToString().ToLower()}",
                $"HARDEN_CONTAINER={harden_container.ToString().ToLower()}",
                $"IS_TEMPORARY={isTemp.ToString().ToLower()}",
                $"CHALLENGE_TIMEOUT={challenge.TimeLimit++}m",
                $"POW_DIFFICULTY_SECONDS={pow_difficulty}",
                $"CONTEST_ID={challenge.ContestId}",
                $"CHALLENGE_ID={challenge.Id}",
                $"TEAM_ID={labelTeamId}",
            };

            // The manifest carries the flag as `value: "${CHALLENGE_FLAG}"`, and
            // envsubst drops the value in as raw text before anything parses YAML.
            // Dynamic flags are hex and land intact either way, but a static flag is
            // whatever the author typed - one double quote in it and the rendered
            // manifest stops being valid YAML, so the deploy fails with an error that
            // points at the template rather than at the flag.
            if (!string.IsNullOrEmpty(flagValue))
                parameters.Add($"CHALLENGE_FLAG={EscapeForYamlDoubleQuoted(flagValue)}");

            // Carried as a submit-time label rather than a workflow parameter: a
            // parameter would have to be declared and threaded through every
            // template that takes it, while a label lands on the workflow object
            // itself. That is what the Kubernetes audit log records, so it is the
            // join that turns "some shared ServiceAccount acted on this namespace"
            // into "this request, from this user, did it" - the one audit-policy.yaml
            // describes and until now had no field to perform.
            var labels = string.IsNullOrEmpty(correlationId)
                ? null
                : $"fctf.correlation-id={correlationId}";

            return (new
            {
                resourceKind = "WorkflowTemplate",
                resourceName = startChallengeTemplate,
                submitOptions = new
                {
                    entryPoint = "main",
                    parameters,
                    labels
                }
            },
            deploymentAppName);
        }

        private static string EscapeForYamlDoubleQuoted(string value)
        {
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n")
                .Replace("\t", "\\t");
        }

        /// <summary>
        /// Resolves the flag value a deployment should hand its pod, for whichever
        /// flag type the challenge carries. The pod gets its flag from here rather
        /// than from a value baked into the image, so the flag the platform accepts
        /// and the flag the container serves always come from the same row.
        ///
        /// A dynamic flag is generated for the team on its first deploy and reused
        /// after that. Static flags are taken as they are - the only one if the
        /// challenge has one, otherwise one drawn at random from the set.
        ///
        /// Returns null when there is nothing to inject, and the caller then omits
        /// CHALLENGE_FLAG so the workflow template's empty default applies.
        /// </summary>
        public static async Task<string?> ResolveDeploymentFlagAsync(
            AppDbContext db,
            int challengeId,
            int teamId,
            CancellationToken cancellationToken = default)
        {
            var flags = await db.Flags
                .Where(f => f.ChallengeId == challengeId)
                .OrderBy(f => f.Id)
                .ToListAsync(cancellationToken);

            if (flags.Count == 0)
                return null;

            var dynamicFlag = flags.FirstOrDefault(
                f => string.Equals(f.Type, "dynamic", StringComparison.OrdinalIgnoreCase));

            if (dynamicFlag != null)
            {
                // Shared instances run one pod for the whole contest (team id -2), so
                // there is no team to mint a per-team flag for - and no row in teams
                // for fk_dfi_team to point at either. Fall through to the static flag
                // if the challenge also has one.
                if (teamId > 0)
                    return await GetOrCreateDynamicFlagValueAsync(db, dynamicFlag, challengeId, teamId, cancellationToken);
            }

            // Regex flags are deliberately not injected: the stored content is a
            // pattern, not a flag, so there is no single value to give the pod.
            var staticFlags = flags
                .Where(f => string.Equals(f.Type, "static", StringComparison.OrdinalIgnoreCase)
                         && !string.IsNullOrEmpty(f.Content))
                .ToList();

            if (staticFlags.Count == 0)
                return null;

            // One flag is simply that flag. With several, the pod gets one of
            // them drawn at random - grading matches a submission against every
            // flag the challenge has, so each is a complete answer on its own and
            // which one a given deployment serves does not change who solves it.
            if (staticFlags.Count == 1)
                return staticFlags[0].Content;

            return staticFlags[Random.Shared.Next(staticFlags.Count)].Content;
        }

        private static async Task<string> GetOrCreateDynamicFlagValueAsync(
            AppDbContext db,
            Flag flag,
            int challengeId,
            int teamId,
            CancellationToken cancellationToken)
        {
            var existing = await db.DynamicFlagInstances
                .Where(d => d.FlagId == flag.Id && d.TeamId == teamId)
                .Select(d => d.Value)
                .FirstOrDefaultAsync(cancellationToken);

            if (existing != null)
                return existing;

            var prefix = string.IsNullOrEmpty(flag.Content) ? "FCTF{" : flag.Content;
            var instance = new DynamicFlagInstance
            {
                FlagId = flag.Id,
                ChallengeId = challengeId,
                TeamId = teamId,
                Value = $"{prefix}{Guid.NewGuid():N}}}",
            };

            db.DynamicFlagInstances.Add(instance);

            try
            {
                await db.SaveChangesAsync(cancellationToken);
                return instance.Value;
            }
            catch (DbUpdateException)
            {
                // uq_dfi_team rejected the insert, so a concurrent deploy for this
                // team already issued the flag. The pod has to get the value that
                // row holds - the one submissions are checked against - not the one
                // this call just minted and failed to save.
                db.Entry(instance).State = EntityState.Detached;

                var issued = await db.DynamicFlagInstances
                    .Where(d => d.FlagId == flag.Id && d.TeamId == teamId)
                    .Select(d => d.Value)
                    .FirstOrDefaultAsync(cancellationToken);

                if (issued == null)
                    throw;

                return issued;
            }
        }


        //get_wrong_submissions_per_minute
        public static async Task<int> GetWrongSubmissionsPerMinute(AppDbContext db, int accountId)
        {
            var oneMinAgo = DateTime.UtcNow.AddMinutes(-1);
            return await db.Submissions.Where(s => s.UserId == accountId && s.Type == Enums.SubmissionTypes.INCORRECT && s.Date >= oneMinAgo).CountAsync();
        }

        public static async Task<int> GetWrongSubmissionsPerHour(AppDbContext db, int accountId)
        {
            var oneHourAgo = DateTime.UtcNow.AddHours(-1);
            return await db.Submissions.Where(s => s.UserId == accountId && s.Type == Enums.SubmissionTypes.INCORRECT && s.Date >= oneHourAgo).CountAsync();
        }

        public static async Task<AttemptDTO> Attempt(AppDbContext db, Challenge challenge, ChallengeAttemptRequest request, int? teamId = null)
        {
            var flags = await db.Flags.Where(f => f.ChallengeId == challenge.Id).ToListAsync();

            // Which store holds the right answer is decided by the challenge's
            // current flag mode, not flag by flag. A challenge that carries a
            // dynamic flag is graded against dynamic_flag_instances alone: the
            // team's own generated value is the answer, and any static row left
            // over from before the switch is a stale value that must not still
            // open the challenge. flags.content is only consulted in the other
            // direction - after a switch back to static it holds the prefix the
            // generator used, which is not an answer to anything.
            var dynamicFlag = flags.FirstOrDefault(
                f => f.Type?.Equals("dynamic", StringComparison.OrdinalIgnoreCase) == true);

            if (dynamicFlag != null)
            {
                var matched = await CompareDynamic(db, dynamicFlag, request.Submission, teamId);
                return new AttemptDTO
                {
                    status = matched,
                    message = matched ? "Correct" : "Incorrect",
                };
            }

            foreach (var flag in flags)
            {
                try
                {
                    if (Compare(flag, request.Submission))
                    {
                        return new AttemptDTO { status = true, message = "Correct" };
                    }
                }
                catch (FlagException e)
                {
                    return new AttemptDTO { status = false, message = e.Message };
                }
            }
            return new AttemptDTO { status = false, message = "Incorrect" };
        }

        private static async Task<bool> CompareDynamic(AppDbContext db, Flag flag, string? provided, int? teamId)
        {
            if (string.IsNullOrEmpty(provided) || teamId == null)
                return false;

            var instance = await db.DynamicFlagInstances
                .FirstOrDefaultAsync(d => d.FlagId == flag.Id && d.TeamId == teamId);

            if (instance == null)
                return false;

            return CompareConstantTime(instance.Value, provided);
        }

        private static bool Compare(Flag flag, string provided)
        {
            if (flag.Type.Equals("static", StringComparison.OrdinalIgnoreCase))
            {
                return CompareStatic(flag, provided);
            }
            else if (flag.Type.Equals("regex", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    return CompareRegex(flag, provided);
                }
                catch (Exception ex)
                {
                    throw new FlagException("Regex parse error occured", ex);
                }
            }
            else
            {
                throw new ArgumentException($"Unknown flag type: {flag.Type}");
            }
        }

        private static bool CompareConstantTime(string saved, string provided)
        {
            if (saved.Length != provided.Length)
                return false;
            int result = 0;
            for (int i = 0; i < saved.Length; i++)
                result |= (saved[i] ^ provided[i]);
            return result == 0;
        }

        private static bool CompareStatic(Flag flag, string provided)
        {
            var saved = flag.Content ?? "";
            var data = flag.Data;

            if (saved.Length != (provided?.Length ?? 0))
                return false;

            int result = 0;
            if (data == "case_insensitive")
            {
                for (int i = 0; i < saved.Length; i++)
                {
                    result |= (char.ToLowerInvariant(saved[i]) ^ char.ToLowerInvariant(provided[i]));
                }
            }
            else
            {
                for (int i = 0; i < saved.Length; i++)
                {
                    result |= (saved[i] ^ provided[i]);
                }
            }
            return result == 0;
        }

        private static bool CompareRegex(Flag flag, string provided)
        {
            var saved = flag.Content ?? "";
            var data = flag.Data;

            try
            {
                var opts = (data == "case_insensitive") ? RegexOptions.IgnoreCase : RegexOptions.None;
                var m = Regex.Match(provided ?? "", saved, opts, TimeSpan.FromMilliseconds(100));
                return m.Success && m.Value == provided;
            }
            catch (ArgumentException ex)
            {
                throw new FlagException("Regex parse error occured", ex);
            }
        }

    }

    public class FlagException : Exception
    {
        public FlagException(string message, Exception? inner = null) : base(message, inner) { }
    }
}
