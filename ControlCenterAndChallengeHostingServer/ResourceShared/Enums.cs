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
            public const string Admin = "admin";
            public const string User = "user";
        }

        public static class Mode
        {
            public const string User = "users";
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
            public const string INITIAL = "Initial";
            public const string PENDING = "Pending";
            public const string RUNING = "Running";
            public const string STOPPED = "Stopped";
            public const string DELETING = "Deleting";

            public const string FAILED = "Failed";
            public const string SUCCEEDED = "Succeeded";

            // These three land in ctfd.challenges.deploy_status, a column the
            // management platform writes and reads too, so the spelling has to be
            // the one it knows (CTFd/constants/status_challenge.py). It used to
            // say DEPLOY_SUCCEEDED here, which matched nothing on that side: the
            // admin UI fell through both its branches and a built challenge never
            // showed as deployed.
            public const string PENDING_DEPLOY = "PENDING_DEPLOY";
            public const string DEPLOY_FAILED = "DEPLOY_FAILED";
            public const string DEPLOY_SUCCESS = "DEPLOY_SUCCESS";
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

        /// <summary>
        /// Maps an Argo workflow phase onto the deploy_status a challenge row carries.
        /// </summary>
        /// <remarks>
        /// Error is a terminal phase like Failed - the workflow is over and nothing
        /// will report on it again. Letting it fall through to the default returned
        /// PENDING_DEPLOY, which is the state the uploader refuses to overwrite, so
        /// one errored build left the challenge unable to accept another upload.
        /// Only phases that really are still in flight map to PENDING_DEPLOY.
        /// </remarks>
        public static string GetDeploymentStatus(string status)
        {
            if (string.IsNullOrWhiteSpace(status))
                return DeploymentStatus.PENDING_DEPLOY;

            if (status.Equals(DeploymentStatus.FAILED, StringComparison.OrdinalIgnoreCase)
                || status.Equals(nameof(WorkflowPhase.Error), StringComparison.OrdinalIgnoreCase)
                || status.Equals(nameof(WorkflowPhase.Terminated), StringComparison.OrdinalIgnoreCase))
                return DeploymentStatus.DEPLOY_FAILED;

            if (status.Equals(DeploymentStatus.SUCCEEDED, StringComparison.OrdinalIgnoreCase))
                return DeploymentStatus.DEPLOY_SUCCESS;

            return DeploymentStatus.PENDING_DEPLOY;
        }
        public enum DeploymentStatusEnum
        {
            Initial,
            Pending,
            Running,
            Stopped,
            Deleting,
            Failed,
            Succeeded,
            PENDING_DEPLOY,
            DEPLOY_FAILED,
            DEPLOY_SUCCEEDED,
            TIMEOUT,
            NOT_FOUND
        }

        public enum DeploymentCheckResult
        {
            Locked = -1,
            Pass = 0,
            LimitExceeded = 1,
            AlreadyExists = 2
        }
    }
}
