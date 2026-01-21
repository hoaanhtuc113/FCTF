namespace DeploymentConsumer;

internal enum ArgoOutboxStatus
{
    Pending = 0,
    Processing = 1,
    Completed = 2,
    Failed = 3,
}
