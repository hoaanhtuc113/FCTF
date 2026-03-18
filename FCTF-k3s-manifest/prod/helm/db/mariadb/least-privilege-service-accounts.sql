-- Least privilege MariaDB accounts for .NET services
-- Scope: database ctfd
-- Update all REPLACE_ME_* passwords before running.

CREATE USER IF NOT EXISTS 'contestant_be'@'%' IDENTIFIED BY 'REPLACE_ME_CONTESTANT_BE_PASSWORD';
CREATE USER IF NOT EXISTS 'deployment_center'@'%' IDENTIFIED BY 'REPLACE_ME_DEPLOYMENT_CENTER_PASSWORD';
CREATE USER IF NOT EXISTS 'deployment_listener'@'%' IDENTIFIED BY 'REPLACE_ME_DEPLOYMENT_LISTENER_PASSWORD';
CREATE USER IF NOT EXISTS 'deployment_consumer'@'%' IDENTIFIED BY 'REPLACE_ME_DEPLOYMENT_CONSUMER_PASSWORD';

-- ContestantBE
GRANT SELECT ON ctfd.users TO 'contestant_be'@'%';
GRANT UPDATE ON ctfd.users TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.teams TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.teams TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.brackets TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.config TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.challenges TO 'contestant_be'@'%';
GRANT UPDATE ON ctfd.challenges TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.dynamic_challenge TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.files TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.hints TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.flags TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.submissions TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.submissions TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.solves TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.solves TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.awards TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.awards TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.unlocks TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.unlocks TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.action_logs TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.action_logs TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.tickets TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.tickets TO 'contestant_be'@'%';
GRANT DELETE ON ctfd.tickets TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.tokens TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.tokens TO 'contestant_be'@'%';
GRANT UPDATE ON ctfd.tokens TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.tracking TO 'contestant_be'@'%';
GRANT INSERT ON ctfd.tracking TO 'contestant_be'@'%';
GRANT UPDATE ON ctfd.tracking TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.challenge_start_tracking TO 'contestant_be'@'%';

-- DeploymentCenter
GRANT SELECT ON ctfd.users TO 'deployment_center'@'%';
GRANT SELECT ON ctfd.challenges TO 'deployment_center'@'%';
GRANT UPDATE ON ctfd.challenges TO 'deployment_center'@'%';
GRANT INSERT ON ctfd.deploy_histories TO 'deployment_center'@'%';
GRANT INSERT ON ctfd.challenge_start_tracking TO 'deployment_center'@'%';

-- DeploymentListener
GRANT SELECT ON ctfd.challenge_start_tracking TO 'deployment_listener'@'%';
GRANT INSERT ON ctfd.challenge_start_tracking TO 'deployment_listener'@'%';
GRANT UPDATE ON ctfd.challenge_start_tracking TO 'deployment_listener'@'%';
GRANT SELECT ON ctfd.challenges TO 'deployment_listener'@'%';

-- DeploymentConsumer
GRANT SELECT ON ctfd.challenges TO 'deployment_consumer'@'%';

FLUSH PRIVILEGES;
