using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared
{
    public static class Enums
    {

        public static class UserType
        {
            public const string User = "user";
        }

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

        public static class ChallengeState
        {
            public const string VISIBLE = "visible";
            public const string HIDDEN = "hidden";
        }

        public static class DeploymentStatus
        {
            public const string PROCESS = "pending";
            public const string RUNING = "running";

            public const string FAILED = "failed";
            public const string SUCCEEDED = "succeeded";

            public const string PENDING_DEPLOY = "PENDING_DEPLOY";
            public const string DEPLOY_FAILED = "DEPLOY_FAILED";
            public const string DEPLOY_SUCCEEDED = "DEPLOY_SUCCEEDED";
        }

        public static class ArgoMessageType
        {
            public const string UP = "up";
            public const string START = "start";
        }

        public enum WorkflowPhase
        {
            Pending,
            Running,
            Succeeded,
            Failed,
            Error,
            Terminating,
            Terminated,
            Skipped,
            Unknown
        }

        public static string GetDeploymentStatus(string status)
        {
            return status.ToLower() switch
            {
                DeploymentStatus.FAILED => DeploymentStatus.DEPLOY_FAILED,
                DeploymentStatus.SUCCEEDED => DeploymentStatus.DEPLOY_SUCCEEDED,
                _ => DeploymentStatus.PENDING_DEPLOY,
            };
        }
    }
}
