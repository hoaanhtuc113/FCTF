export type DeploymentStatus =
    | 'Initial'
    | 'Pending'
    | 'Running'
    | 'Stopped'
    | 'Deleting'
    | 'Failed'
    | 'Succeeded'
    | 'PENDING_DEPLOY'
    | 'DEPLOY_FAILED'
    | 'DEPLOY_SUCCEEDED'
    | 'TIMEOUT'
    ;
