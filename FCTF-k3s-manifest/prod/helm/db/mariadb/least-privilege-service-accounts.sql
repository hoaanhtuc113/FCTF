-- Least privilege MariaDB accounts for .NET services + admin account
-- Scope: database ctfd
-- Update all REPLACE_* passwords before running.

-- Baseline hardening equivalent to mysql_secure_installation tasks.
SELECT CONCAT("DROP USER '", user, "'@'", host, "';")
FROM mysql.user
WHERE user = 'root'
  AND host NOT IN ('localhost', '127.0.0.1');
DROP USER IF EXISTS ''@'localhost';
DROP USER IF EXISTS ''@'%';
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db LIKE 'test\\_%';

CREATE USER IF NOT EXISTS 'contestant_be'@'%' IDENTIFIED BY 'NKtFmlmqOKWCqmAkE8ICZAykAsTwasu5fWxdpvCeEYBgWeNbKS';
CREATE USER IF NOT EXISTS 'deployment_center'@'%' IDENTIFIED BY '2ePNjWVf2bPhnXA5bKXNMQDkmziaJT9PqDPkaSbmcutzkzUL89';
CREATE USER IF NOT EXISTS 'deployment_listener'@'%' IDENTIFIED BY 'iHOu7LxTV0cggemLl2NfDOY6Qq0u6MgueurDCNfwFcU3Awx47H';
CREATE USER IF NOT EXISTS 'deployment_consumer'@'%' IDENTIFIED BY 'UCEoSbGsU2haYN1jwFPP0JhOBqlGgC1IlociA8i5wIGageGOHF';

-- ContestantBE
GRANT SELECT ON ctfd.users TO 'contestant_be'@'%';
GRANT UPDATE ON ctfd.users TO 'contestant_be'@'%';
GRANT SELECT ON ctfd.teams TO 'contestant_be'@'%';
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
