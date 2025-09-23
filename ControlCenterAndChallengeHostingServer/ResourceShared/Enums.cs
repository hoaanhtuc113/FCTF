using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared
{
    public static class Enums
    {
        public static class Mode
        {
            public  const string User = "users";
            public const string Team = "teams";
        }

        public static class ConfigTypes
        {
            public const string CHALLENGE_VISIBILITY = "challenge_visibility";
            public const string SCORE_VISIBILITY = "score_visibility";
            public const string ACCOUNT_VISIBILITY = "account_visibility";
            public const string REGISTRATION_VISIBILITY = "registration_visibility";
        }

        public static class SubmissionTypes
        {
            public const string CORRECT = "correct";
            public const string INCORRECT = "incorrect";
            public const string DISCARD = "discard";
        }
    }
}
