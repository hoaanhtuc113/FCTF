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
            public const string PROCESS = "Pending";
            public const string RUNING = "Running";

            public const string FAILED = "Failed";
            public const string SUCCEEDED = "Succeeded";

            public const string PENDING_DEPLOY = "PENDING_DEPLOY";
            public const string DEPLOY_FAILED = "DEPLOY_FAILED";
            public const string DEPLOY_SUCCEEDED = "DEPLOY_SUCCEEDED";
        }

        public static class DeploymentReason
        {
            public const string WAITING = "Waiting";
            public const string TERMINATED = "Terminated";
            public const string TIMEOUT = "TIMEOUT";
            public const string CONTAINER_CREATING = "ContainerCreating";
            public const string IMAGE_PULL_BACK_OFF = "ImagePullBackOff";
            public const string ERR_IMAGE_PULL = "ErrImagePull";
            public const string INVALID_IMAGE_NAME = "InvalidImageName";
            public const string CRASH_LOOP_BACK_OFF = "CrashLoopBackOff";
            public const string CREATE_CONTAINER_CONFIG_ERROR = "CreateContainerConfigError";
            public const string CREATE_CONTAINER_ERROR = "CreateContainerError";
            public const string OOM_KILLED = "OOMKilled";
        }

        public static class ArgoMessageType
        {
            public const string UP = "up";
            public const string START = "start";
        }

        public enum WorkflowPhase
        {
            Pending,
            Waiting,
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
