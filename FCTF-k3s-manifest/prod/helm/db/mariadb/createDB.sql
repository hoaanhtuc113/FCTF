-- FCTF / CTFd baseline schema bootstrap
-- Target: MariaDB 10.11+

CREATE DATABASE IF NOT EXISTS ctfd
	CHARACTER SET utf8mb4
	COLLATE utf8mb4_unicode_ci;

USE ctfd;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS alembic_version (
	version_num VARCHAR(32) NOT NULL,
	PRIMARY KEY (version_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS brackets (
	id INT NOT NULL AUTO_INCREMENT,
	name VARCHAR(255),
	description TEXT,
	type VARCHAR(80),
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
	id INT NOT NULL AUTO_INCREMENT,
	oauth_id INT NULL,
	name VARCHAR(128),
	password VARCHAR(128),
	email VARCHAR(128) NULL,
	type VARCHAR(80),
	secret VARCHAR(128),
	website VARCHAR(128),
	affiliation VARCHAR(128),
	country VARCHAR(32),
	bracket_id INT NULL,
	hidden TINYINT(1) DEFAULT 0,
	banned TINYINT(1) DEFAULT 0,
	verified TINYINT(1) DEFAULT 0,
	language VARCHAR(32) NULL,
	team_id INT NULL,
	created DATETIME(6),
	PRIMARY KEY (id),
	UNIQUE KEY uq_users_email (email),
	UNIQUE KEY uq_users_oauth_id (oauth_id),
	KEY fk_users_bracket_id (bracket_id),
	KEY fk_users_team_id (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teams (
	id INT NOT NULL AUTO_INCREMENT,
	oauth_id INT NULL,
	name VARCHAR(128),
	email VARCHAR(128) NULL,
	password VARCHAR(128),
	secret VARCHAR(128),
	website VARCHAR(128),
	affiliation VARCHAR(128),
	country VARCHAR(32),
	bracket_id INT NULL,
	hidden TINYINT(1) DEFAULT 0,
	banned TINYINT(1) DEFAULT 0,
	captain_id INT NULL,
	created DATETIME(6),
	PRIMARY KEY (id),
	UNIQUE KEY uq_teams_email (email),
	UNIQUE KEY uq_teams_oauth_id (oauth_id),
	KEY fk_teams_bracket_id (bracket_id),
	KEY fk_teams_captain_id (captain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
	ADD CONSTRAINT fk_users_bracket_id FOREIGN KEY (bracket_id) REFERENCES brackets(id) ON DELETE SET NULL,
	ADD CONSTRAINT fk_users_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE teams
	ADD CONSTRAINT fk_teams_bracket_id FOREIGN KEY (bracket_id) REFERENCES brackets(id) ON DELETE SET NULL,
	ADD CONSTRAINT fk_teams_captain_id FOREIGN KEY (captain_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS challenges (
	id INT NOT NULL AUTO_INCREMENT,
	name VARCHAR(80),
	description TEXT,
	connection_info TEXT,
	connection_protocol VARCHAR(10) NOT NULL DEFAULT 'http',
	next_id INT NULL,
	max_attempts INT DEFAULT 0,
	value INT,
	category VARCHAR(80),
	type VARCHAR(80) DEFAULT 'standard',
	state VARCHAR(80) NOT NULL DEFAULT 'visible',
	requirements JSON,
	time_limit INT NULL,
	time_finished DATETIME(6) NULL,
	start_time DATETIME(6) NULL,
	user_id INT NOT NULL,
	cooldown INT DEFAULT 0,
	require_deploy TINYINT(1) NOT NULL DEFAULT 0,
	deploy_status TEXT NULL,
	last_update DATETIME(6) NULL,
	image_link TEXT NULL,
	deploy_file VARCHAR(256) NULL,
	cpu_limit INT NULL,
	cpu_request INT NULL,
	memory_limit INT NULL,
	memory_request INT NULL,
	use_gvisor TINYINT(1) NULL,
	harden_container TINYINT(1) DEFAULT 1,
	max_deploy_count INT NULL DEFAULT 0,
	difficulty INT NULL,
	shared_instant TINYINT(1) NOT NULL DEFAULT 0,
	PRIMARY KEY (id),
	KEY idx_challenges_next_id (next_id),
	KEY idx_challenges_user_id (user_id),
	CONSTRAINT fk_challenges_next_id FOREIGN KEY (next_id) REFERENCES challenges(id) ON DELETE SET NULL,
	CONSTRAINT fk_challenges_user_id FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS challenge_versions (
	id INT NOT NULL AUTO_INCREMENT,
	challenge_id INT NOT NULL,
	version_number INT NOT NULL DEFAULT 1,
	image_link TEXT NULL,
	deploy_file VARCHAR(256) NULL,
	cpu_limit INT NULL,
	cpu_request INT NULL,
	memory_limit INT NULL,
	memory_request INT NULL,
	use_gvisor TINYINT(1) NULL,
	harden_container TINYINT(1) DEFAULT 1,
	max_deploy_count INT DEFAULT 0,
	is_active TINYINT(1) NOT NULL DEFAULT 0,
	created_by INT NULL,
	created_at DATETIME(6) NOT NULL,
	notes TEXT NULL,
	PRIMARY KEY (id),
	KEY idx_challenge_versions_challenge_id (challenge_id),
	KEY idx_challenge_versions_created_by (created_by),
	CONSTRAINT fk_challenge_versions_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
	CONSTRAINT fk_challenge_versions_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS challenge_start_tracking (
	id INT NOT NULL AUTO_INCREMENT,
	user_id INT NULL,
	team_id INT NULL,
	challenge_id INT NOT NULL,
	started_at DATETIME(6) NOT NULL,
	stopped_at DATETIME(6) NULL,
	label VARCHAR(255) NULL,
	PRIMARY KEY (id),
	KEY idx_challenge_start_tracking_user_challenge (user_id, challenge_id),
	KEY idx_challenge_start_tracking_team_challenge (team_id, challenge_id),
	CONSTRAINT fk_challenge_start_tracking_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_challenge_start_tracking_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
	CONSTRAINT fk_challenge_start_tracking_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS topics (
	id INT NOT NULL AUTO_INCREMENT,
	value VARCHAR(255) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE KEY uq_topics_value (value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS challenge_topics (
	id INT NOT NULL AUTO_INCREMENT,
	challenge_id INT NOT NULL,
	topic_id INT NOT NULL,
	PRIMARY KEY (id),
	KEY idx_challenge_topics_challenge_id (challenge_id),
	KEY idx_challenge_topics_topic_id (topic_id),
	CONSTRAINT fk_challenge_topics_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
	CONSTRAINT fk_challenge_topics_topic_id FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
	id INT NOT NULL AUTO_INCREMENT,
	type VARCHAR(80) DEFAULT 'standard',
	location TEXT,
	sha1sum VARCHAR(40),
	challenge_id INT NULL,
	PRIMARY KEY (id),
	KEY idx_files_challenge_id (challenge_id),
	CONSTRAINT fk_files_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS flags (
	id INT NOT NULL AUTO_INCREMENT,
	challenge_id INT NOT NULL,
	type VARCHAR(80),
	content TEXT,
	data TEXT,
	PRIMARY KEY (id),
	KEY idx_flags_challenge_id (challenge_id),
	CONSTRAINT fk_flags_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hints (
	id INT NOT NULL AUTO_INCREMENT,
	type VARCHAR(80) DEFAULT 'standard',
	challenge_id INT NOT NULL,
	content TEXT,
	cost INT DEFAULT 0,
	requirements JSON,
	PRIMARY KEY (id),
	KEY idx_hints_challenge_id (challenge_id),
	CONSTRAINT fk_hints_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tags (
	id INT NOT NULL AUTO_INCREMENT,
	challenge_id INT NOT NULL,
	value VARCHAR(80),
	PRIMARY KEY (id),
	KEY idx_tags_challenge_id (challenge_id),
	CONSTRAINT fk_tags_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS awards (
	id INT NOT NULL AUTO_INCREMENT,
	user_id INT NULL,
	team_id INT NULL,
	type VARCHAR(80) DEFAULT 'standard',
	name VARCHAR(80),
	description TEXT,
	date DATETIME(6),
	value INT,
	category VARCHAR(80),
	icon TEXT,
	requirements JSON,
	PRIMARY KEY (id),
	KEY idx_awards_user_id (user_id),
	KEY idx_awards_team_id (team_id),
	CONSTRAINT fk_awards_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_awards_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS award_badges (
	id INT NOT NULL AUTO_INCREMENT,
	user_id INT NULL,
	team_id INT NULL,
	challenge_id INT NULL,
	name VARCHAR(80),
	PRIMARY KEY (id),
	KEY idx_award_badges_user_id (user_id),
	KEY idx_award_badges_team_id (team_id),
	KEY idx_award_badges_challenge_id (challenge_id),
	CONSTRAINT fk_award_badges_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_award_badges_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
	CONSTRAINT fk_award_badges_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS achievements (
	id INT NOT NULL AUTO_INCREMENT,
	user_id INT NULL,
	team_id INT NULL,
	challenge_id INT NULL,
	name VARCHAR(80),
	achievement_id INT NULL,
	PRIMARY KEY (id),
	KEY idx_achievements_user_id (user_id),
	KEY idx_achievements_team_id (team_id),
	KEY idx_achievements_challenge_id (challenge_id),
	KEY idx_achievements_achievement_id (achievement_id),
	CONSTRAINT fk_achievements_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_achievements_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
	CONSTRAINT fk_achievements_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
	CONSTRAINT fk_achievements_achievement_id FOREIGN KEY (achievement_id) REFERENCES award_badges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
	id INT NOT NULL AUTO_INCREMENT,
	type VARCHAR(80) DEFAULT 'standard',
	content TEXT,
	date DATETIME(6),
	author_id INT NULL,
	challenge_id INT NULL,
	user_id INT NULL,
	team_id INT NULL,
	PRIMARY KEY (id),
	KEY idx_comments_author_id (author_id),
	KEY idx_comments_challenge_id (challenge_id),
	KEY idx_comments_user_id (user_id),
	KEY idx_comments_team_id (team_id),
	CONSTRAINT fk_comments_author_id FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_comments_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
	CONSTRAINT fk_comments_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_comments_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS config (
	id INT NOT NULL AUTO_INCREMENT,
	`key` TEXT,
	value TEXT,
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS action_logs (
	actionId INT NOT NULL AUTO_INCREMENT,
	userId INT NULL,
	actionDate DATETIME(6) NOT NULL,
	actionType INT NOT NULL,
	actionDetail VARCHAR(255) NOT NULL,
	topicName VARCHAR(255) NULL,
	PRIMARY KEY (actionId),
	KEY idx_action_logs_userId (userId),
	CONSTRAINT fk_action_logs_userId FOREIGN KEY (userId) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS submissions (
	id INT NOT NULL AUTO_INCREMENT,
	challenge_id INT NULL,
	user_id INT NULL,
	team_id INT NULL,
	ip VARCHAR(46),
	provided TEXT,
	type VARCHAR(32),
	date DATETIME(6),
	PRIMARY KEY (id),
	KEY idx_submissions_challenge_id (challenge_id),
	KEY idx_submissions_user_id (user_id),
	KEY idx_submissions_team_id (team_id),
	CONSTRAINT fk_submissions_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
	CONSTRAINT fk_submissions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_submissions_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS solves (
	id INT NOT NULL,
	challenge_id INT NULL,
	user_id INT NULL,
	team_id INT NULL,
	PRIMARY KEY (id),
	UNIQUE KEY uq_solves_challenge_user (challenge_id, user_id),
	UNIQUE KEY uq_solves_challenge_team (challenge_id, team_id),
	KEY idx_solves_user_id (user_id),
	KEY idx_solves_team_id (team_id),
	CONSTRAINT fk_solves_id FOREIGN KEY (id) REFERENCES submissions(id) ON DELETE CASCADE,
	CONSTRAINT fk_solves_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
	CONSTRAINT fk_solves_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_solves_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unlocks (
	id INT NOT NULL AUTO_INCREMENT,
	user_id INT NULL,
	team_id INT NULL,
	target INT NULL,
	date DATETIME(6),
	type VARCHAR(32),
	PRIMARY KEY (id),
	UNIQUE KEY uq_unlocks_type_target_user_team (type, target, user_id, team_id),
	KEY idx_unlocks_user_id (user_id),
	KEY idx_unlocks_team_id (team_id),
	CONSTRAINT fk_unlocks_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_unlocks_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tracking (
	id INT NOT NULL AUTO_INCREMENT,
	type VARCHAR(32),
	ip VARCHAR(46),
	user_id INT NULL,
	date DATETIME(6),
	PRIMARY KEY (id),
	KEY idx_tracking_user_id (user_id),
	CONSTRAINT fk_tracking_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tokens (
	id INT NOT NULL AUTO_INCREMENT,
	type VARCHAR(32),
	user_id INT NULL,
	created DATETIME(6),
	expiration DATETIME(6),
	description TEXT,
	value VARCHAR(128),
	PRIMARY KEY (id),
	UNIQUE KEY uq_tokens_value (value),
	KEY idx_tokens_user_id (user_id),
	CONSTRAINT fk_tokens_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fields (
	id INT NOT NULL AUTO_INCREMENT,
	name TEXT,
	type VARCHAR(80) DEFAULT 'standard',
	field_type VARCHAR(80),
	description TEXT,
	required TINYINT(1) DEFAULT 0,
	public TINYINT(1) DEFAULT 0,
	editable TINYINT(1) DEFAULT 0,
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS field_entries (
	id INT NOT NULL AUTO_INCREMENT,
	type VARCHAR(80) DEFAULT 'standard',
	value JSON,
	field_id INT NULL,
	user_id INT NULL,
	team_id INT NULL,
	PRIMARY KEY (id),
	KEY idx_field_entries_field_id (field_id),
	KEY idx_field_entries_user_id (user_id),
	KEY idx_field_entries_team_id (team_id),
	CONSTRAINT fk_field_entries_field_id FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE,
	CONSTRAINT fk_field_entries_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_field_entries_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deploy_histories (
	id INT NOT NULL AUTO_INCREMENT,
	challenge_id INT NOT NULL,
	log_content TEXT,
	deploy_status VARCHAR(50) NOT NULL DEFAULT 'null',
	deploy_at DATETIME(6) NULL,
	PRIMARY KEY (id),
	KEY idx_deploy_histories_challenge_id (challenge_id),
	CONSTRAINT fk_deploy_histories_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dynamic_challenge (
	id INT NOT NULL,
	initial INT,
	decay INT,
	minimum INT,
	function VARCHAR(32),
	PRIMARY KEY (id),
	CONSTRAINT fk_dynamic_challenge_id FOREIGN KEY (id) REFERENCES challenges(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS multiple_choice_challenge (
	id INT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT fk_multiple_choice_challenge_id FOREIGN KEY (id) REFERENCES challenges(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
	id INT NOT NULL AUTO_INCREMENT,
	user_id INT NULL,
	team_id INT NULL,
	title TEXT,
	content TEXT,
	date DATETIME(6),
	PRIMARY KEY (id),
	KEY idx_notifications_user_id (user_id),
	KEY idx_notifications_team_id (team_id),
	CONSTRAINT fk_notifications_user_id FOREIGN KEY (user_id) REFERENCES users(id),
	CONSTRAINT fk_notifications_team_id FOREIGN KEY (team_id) REFERENCES teams(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
	id INT NOT NULL AUTO_INCREMENT,
	actor_id INT NULL,
	actor_name VARCHAR(128) NULL,
	actor_type VARCHAR(80) NULL,
	action VARCHAR(128) NOT NULL,
	target_type VARCHAR(80) NULL,
	target_id INT NULL,
	before_state JSON NULL,
	after_state JSON NULL,
	extra_data JSON NULL,
	ip_address VARCHAR(46) NULL,
	timestamp DATETIME(6) NOT NULL,
	PRIMARY KEY (id),
	KEY idx_admin_audit_logs_actor_id (actor_id),
	KEY idx_admin_audit_logs_timestamp (timestamp),
	CONSTRAINT fk_admin_audit_logs_actor_id FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- Seed migration version table with current head revision.
INSERT INTO alembic_version (version_num)
VALUES ('e9a1c2d3f4b5')
ON DUPLICATE KEY UPDATE version_num = VALUES(version_num);
