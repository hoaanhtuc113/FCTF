using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Conventions;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace ResourceShared.Utils
{
    public static class ChallengeHelper
    {
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
          return $"challenge_url_{challengeId}_{teamId}";
        }
        public static string GenerateCacheAttemptKey(int challengeId, int teamId)
        {
            var rawKey = $"challenge_status_{challengeId}_{teamId}";
            using var md5 = MD5.Create();
            var hashBytes = md5.ComputeHash(Encoding.UTF8.GetBytes(rawKey));
            return BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
        }

        public static string GetArgoWName(string chalId, string teamName)
        {
            return $"start-challenge-{chalId}-{teamName}".ToLower().Replace(" ", "-"); ;
        }

        public static string GetDeploymentAppName(string teamName,string challengeId,string challengeName)
        {
            return $"{teamName}-chal-{challengeId}-{challengeName}".ToLower().Replace(" ", "-");
        }

        public static (object payload, string secretKey) PrepareChallengePayload(Challenge challenge, int team_id,int challenge_time)
        {
            var payload = new
            {
                ChallengeId = challenge.Id.ToString(),
                TeamId = team_id.ToString() ,
                TimeLimit = challenge_time.ToString(),
                ImageLink = challenge.ImageLink ?? "",
                UnixTime = challenge_time.ToString()
            };

            var data = new Dictionary<string, string>
            {
                { "ChallengeId", challenge.Id.ToString() },
                { "TeamId", team_id.ToString() },
                { "TimeLimit", challenge_time.ToString() },
                { "ImageLink", challenge.ImageLink ?? "" }
            };
            var secretKey = SecretKeyHelper.CreateSecretKey(challenge_time,data);
            return (payload, secretKey);

        }

        public static object BuildArgoPayload(string chalId, string teamName, int nodePort)
        {
            teamName = teamName.ToLower().Replace(" ", "-");

            var payload = new
            {
                metadata = new
                {
                    generateName = $"{GetArgoWName(chalId,teamName)}-",
                    @namespace = "argo",
                    annotations = new Dictionary<string, string>
                    {
                        ["workflows.argoproj.io/description"] = "start challenge workflow"
                    }
                },
                spec = new
                {
                    entrypoint = "main",
                    serviceAccountName = "argo-sa",
                    arguments = new
                    {
                        parameters = new[]
                        {
                    new { name = "APP_NAME", value = $"{GetDeploymentAppName(teamName,chalId,"websecpro-chilp")}" },
                    new { name = "SERVICE_PORT", value = "80" },
                    new { name = "CONTAINER_PORT", value = "80" },
                    new { name = "NODE_PORT", value = nodePort.ToString() },
                    new { name = "REPLICA_COUNT", value = "1" },
                    new { name = "CONTAINER_IMAGE", value = "quachuoiscontainer/kctf-chal-wsproblem:v01" },
                    new { name = "MEMORY_LIMIT", value = "256Mi" },
                    new { name = "CPU_LIMIT", value = "500m" },
                    new { name = "CPU_REQUEST", value = "100m" },
                    new { name = "MEMORY_REQUEST", value = "128Mi" }
                }
                    },
                    templates = new object[]
                    {
                // --- Template main ---
                new
                {
                    name = "main",
                    steps = new object[]
                    {
                        new object[] { new { name = "check-workspace", template = "check-workspace" } },
                        new object[] { new { name = "deploy-challenge", template = "deploy-challenge" } }
                    }
                },

                // --- Template check-workspace ---
                new
                {
                    name = "check-workspace",
                    container = new
                    {
                        image = "quachuoiscontainer/kubectl-cli:v0.0.3",
                        imagePullPolicy = "IfNotPresent",
                        securityContext = new
                        {
                            runAsUser = 0,
                            runAsGroup = 0,
                            runAsNonRoot = false,
                            allowPrivilegeEscalation = true,
                            privileged = true
                        },
                        resources = new
                        {
                            requests = new { memory = "256Mi", cpu = "100m" },
                            limits = new { memory = "512Mi", cpu = "300m" }
                        },
                        command = new[] { "sh", "-c" },
                        args = new[]
                        {
                            "echo \"=== Checking Argo Pod Workspace ===\"\n" +
                            "echo \"Current directory: $(pwd)\"\n" +
                            "echo \"Testing kubectl connection:\"\n" +
                            "kubectl top nodes"
                        }
                    }
                },

                // --- Template deploy-challenge ---
                new
                {
                    name = "deploy-challenge",
                    container = new
                    {
                        image = "quachuoiscontainer/kubectl-cli:v0.0.3",
                        imagePullPolicy = "IfNotPresent",
                        securityContext = new
                        {
                            runAsUser = 0,
                            runAsGroup = 0,
                            runAsNonRoot = false,
                            allowPrivilegeEscalation = true,
                            privileged = true
                        },
                        resources = new
                        {
                            requests = new { memory = "256Mi", cpu = "100m" },
                            limits = new { memory = "512Mi", cpu = "300m" }
                        },
                        command = new[] { "sh", "-c" },
                        args = new[]
                        {
                            "set -e\n" +
                            "echo \"=== Deploying Challenge with direct parameters ===\"\n\n" +
                            "git clone https://github.com/fctf-git-repo/challenge-config.git\n" +
                            "cd challenge-config/websecpro_chilp-1\n\n" +
                            "export APP_NAME=\"{{workflow.parameters.APP_NAME}}\"\n" +
                            "export SERVICE_PORT=\"{{workflow.parameters.SERVICE_PORT}}\"\n" +
                            "export CONTAINER_PORT=\"{{workflow.parameters.CONTAINER_PORT}}\"\n" +
                            "export NODE_PORT=\"{{workflow.parameters.NODE_PORT}}\"\n" +
                            "export REPLICA_COUNT=\"{{workflow.parameters.REPLICA_COUNT}}\"\n" +
                            "export CONTAINER_IMAGE=\"{{workflow.parameters.CONTAINER_IMAGE}}\"\n" +
                            "export MEMORY_LIMIT=\"{{workflow.parameters.MEMORY_LIMIT}}\"\n" +
                            "export CPU_LIMIT=\"{{workflow.parameters.CPU_LIMIT}}\"\n" +
                            "export CPU_REQUEST=\"{{workflow.parameters.CPU_REQUEST}}\"\n" +
                            "export MEMORY_REQUEST=\"{{workflow.parameters.MEMORY_REQUEST}}\"\n\n" +
                            "envsubst < challenge.yaml | kubectl apply -f -\n\n" +
                            "echo \"✅ Challenge manifest submitted to cluster\""
                        }
                    }
                }
                    }
                }
            };

            return payload;
        }


        //get_wrong_submissions_per_minute
        public static async Task<int> GetWrongSubmissionsPerMinute(AppDbContext db,int accountId)
        {
            var oneMinAgo = DateTime.UtcNow.AddMinutes(-1);
            return  await db.Submissions.Where(s => s.UserId == accountId && s.Type == Enums.SubmissionTypes.INCORRECT && s.Date >= oneMinAgo).CountAsync();
        }

        public static async Task<int> GetWrongSubmissionsPerHour(AppDbContext db, int accountId)
        {
            var oneHourAgo = DateTime.UtcNow.AddHours(-1);
            return await db.Submissions.Where(s => s.UserId == accountId && s.Type == Enums.SubmissionTypes.INCORRECT && s.Date >= oneHourAgo).CountAsync();
        }

        public static async Task<AttemptDTO> Attempt(AppDbContext db, Challenge challenge, ChallengeAttemptRequest request)
        {
            var flags = await db.Flags.Where(f => f.ChallengeId == challenge.Id && f.Content.Equals(request.Submission)).ToListAsync();
            foreach (var flag in flags)
            {
                try
                {
                    if (Compare(flag, request.Submission))
                    {
                        return new AttemptDTO
                        {
                            status = true,
                            message = "Correct"
                        };
                    }
                } catch (FlagException e)
                {
                    return new AttemptDTO
                    {
                        status = false,
                        message = e.Message
                    };
                }
            }
            return new AttemptDTO
            {
                status = false,
                message = "Incorrect"
            };
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
                var m = Regex.Match(provided ?? "", saved, opts);
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
