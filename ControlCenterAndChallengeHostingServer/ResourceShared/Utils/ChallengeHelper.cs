using Microsoft.EntityFrameworkCore.Metadata.Conventions;
using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
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
    }
}
