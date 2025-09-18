using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Conventions;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
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
