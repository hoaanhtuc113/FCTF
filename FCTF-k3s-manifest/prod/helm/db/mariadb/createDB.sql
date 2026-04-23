/*
 Navicat Premium Data Transfer

 Source Server         : localhost
 Source Server Type    : MariaDB
 Source Server Version : 101115 (10.11.15-MariaDB-ubu2204)
 Source Host           : localhost:3306
 Source Schema         : ctfd

 Target Server Type    : MariaDB
 Target Server Version : 101115 (10.11.15-MariaDB-ubu2204)
 File Encoding         : 65001

 Date: 01/04/2026 17:12:50
*/

CREATE DATABASE IF NOT EXISTS ctfd
	CHARACTER SET utf8mb4
	COLLATE utf8mb4_unicode_ci;

USE ctfd;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for achievements
-- ----------------------------
CREATE TABLE IF NOT EXISTS `achievements`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `achievement_id` int(11) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `achievement_id`(`achievement_id`) USING BTREE,
  INDEX `challenge_id`(`challenge_id`) USING BTREE,
  INDEX `team_id`(`team_id`) USING BTREE,
  INDEX `user_id`(`user_id`) USING BTREE,
  CONSTRAINT `achievements_ibfk_1` FOREIGN KEY (`achievement_id`) REFERENCES `award_badges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `achievements_ibfk_2` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `achievements_ibfk_3` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `achievements_ibfk_4` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of achievements
-- ----------------------------

-- ----------------------------
-- Table structure for action_logs
-- ----------------------------
CREATE TABLE IF NOT EXISTS `action_logs`  (
  `actionId` int(11) NOT NULL AUTO_INCREMENT,
  `userId` int(11) NULL DEFAULT NULL,
  `actionDate` datetime NOT NULL,
  `actionType` int(11) NOT NULL,
  `actionDetail` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `topicName` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`actionId`) USING BTREE,
  INDEX `userId`(`userId`) USING BTREE,
  CONSTRAINT `userId` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of action_logs
-- ----------------------------

-- ----------------------------
-- Table structure for admin_audit_logs
-- ----------------------------
CREATE TABLE IF NOT EXISTS `admin_audit_logs`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `actor_id` int(11) NULL DEFAULT NULL,
  `actor_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `actor_type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `action` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `target_type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `target_id` int(11) NULL DEFAULT NULL,
  `before_state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL CHECK (json_valid(`before_state`)),
  `after_state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL CHECK (json_valid(`after_state`)),
  `extra_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL CHECK (json_valid(`extra_data`)),
  `ip_address` varchar(46) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `timestamp` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_admin_audit_logs_timestamp`(`timestamp`) USING BTREE,
  INDEX `ix_admin_audit_logs_actor_id_ts`(`actor_id`, `timestamp`) USING BTREE,
  INDEX `ix_admin_audit_logs_action`(`action`) USING BTREE,
  CONSTRAINT `admin_audit_logs_ibfk_1` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of admin_audit_logs
-- ----------------------------

-- ----------------------------
-- Table structure for alembic_version
-- ----------------------------
CREATE TABLE IF NOT EXISTS `alembic_version`  (
  `version_num` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  PRIMARY KEY (`version_num`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of alembic_version
-- ----------------------------
INSERT INTO `alembic_version` (`version_num`)
SELECT 'e9a1c2d3f4b5'
WHERE NOT EXISTS (
  SELECT 1 FROM `alembic_version` LIMIT 1
);

-- ----------------------------
-- Table structure for award_badges
-- ----------------------------
CREATE TABLE IF NOT EXISTS `award_badges`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `challenge_id`(`challenge_id`) USING BTREE,
  INDEX `team_id`(`team_id`) USING BTREE,
  INDEX `user_id`(`user_id`) USING BTREE,
  CONSTRAINT `award_badges_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `award_badges_ibfk_2` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `award_badges_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of award_badges
-- ----------------------------

-- ----------------------------
-- Table structure for awards
-- ----------------------------
CREATE TABLE IF NOT EXISTS `awards`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  `name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `date` datetime(6) NULL DEFAULT NULL,
  `value` int(11) NULL DEFAULT NULL,
  `category` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `icon` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `requirements` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL CHECK (json_valid(`requirements`)),
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'standard',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `awards_ibfk_1`(`team_id`) USING BTREE,
  INDEX `awards_ibfk_2`(`user_id`) USING BTREE,
  CONSTRAINT `awards_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `awards_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of awards
-- ----------------------------

-- ----------------------------
-- Table structure for brackets
-- ----------------------------
CREATE TABLE IF NOT EXISTS `brackets`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of brackets
-- ----------------------------

-- ----------------------------
-- Table structure for challenge_start_tracking
-- ----------------------------
CREATE TABLE IF NOT EXISTS `challenge_start_tracking`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  `challenge_id` int(11) NOT NULL,
  `started_at` datetime(6) NOT NULL,
  `stopped_at` datetime(6) NULL DEFAULT NULL,
  `label` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `fk_challenge_start_tracking_challenge_id`(`challenge_id`) USING BTREE,
  INDEX `idx_challenge_start_tracking_team_challenge`(`team_id`, `challenge_id`) USING BTREE,
  INDEX `idx_challenge_start_tracking_user_challenge`(`user_id`, `challenge_id`) USING BTREE,
  CONSTRAINT `fk_challenge_start_tracking_challenge_id` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `fk_challenge_start_tracking_team_id` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `fk_challenge_start_tracking_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of challenge_start_tracking
-- ----------------------------

-- ----------------------------
-- Table structure for challenge_topics
-- ----------------------------
CREATE TABLE IF NOT EXISTS `challenge_topics`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `topic_id` int(11) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `challenge_id`(`challenge_id`) USING BTREE,
  INDEX `topic_id`(`topic_id`) USING BTREE,
  CONSTRAINT `challenge_topics_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `challenge_topics_ibfk_2` FOREIGN KEY (`topic_id`) REFERENCES `topics` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of challenge_topics
-- ----------------------------

-- ----------------------------
-- Table structure for challenge_versions
-- ----------------------------
CREATE TABLE IF NOT EXISTS `challenge_versions`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `challenge_id` int(11) NOT NULL,
  `version_number` int(11) NOT NULL DEFAULT 1,
  `image_link` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `deploy_file` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `cpu_limit` int(11) NULL DEFAULT NULL,
  `cpu_request` int(11) NULL DEFAULT NULL,
  `memory_limit` int(11) NULL DEFAULT NULL,
  `memory_request` int(11) NULL DEFAULT NULL,
  `use_gvisor` tinyint(1) NULL DEFAULT NULL,
  `max_deploy_count` int(11) NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 0,
  `created_by` int(11) NULL DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `notes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `harden_container` tinyint(1) NULL DEFAULT 1,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `fk_challenge_versions_created_by`(`created_by`) USING BTREE,
  INDEX `idx_challenge_versions_challenge_id`(`challenge_id`) USING BTREE,
  INDEX `idx_challenge_versions_active`(`challenge_id`, `is_active`) USING BTREE,
  CONSTRAINT `fk_challenge_versions_challenge_id` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `fk_challenge_versions_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of challenge_versions
-- ----------------------------

-- ----------------------------
-- Table structure for challenges
-- ----------------------------
CREATE TABLE IF NOT EXISTS `challenges`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `max_attempts` int(11) NULL DEFAULT NULL,
  `value` int(11) NULL DEFAULT NULL,
  `category` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `state` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `requirements` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL CHECK (json_valid(`requirements`)),
  `connection_info` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `next_id` int(11) NULL DEFAULT NULL,
  `time_limit` int(11) NULL DEFAULT NULL,
  `require_deploy` tinyint(1) NOT NULL,
  `deploy_status` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `last_update` datetime(6) NULL DEFAULT NULL,
  `time_finished` datetime(6) NULL DEFAULT NULL,
  `start_time` datetime(6) NULL DEFAULT NULL,
  `image_link` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `cooldown` int(11) NULL DEFAULT NULL,
  `deploy_file` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `cpu_limit` int(11) NULL DEFAULT NULL,
  `cpu_request` int(11) NULL DEFAULT NULL,
  `memory_limit` int(11) NULL DEFAULT NULL,
  `memory_request` int(11) NULL DEFAULT NULL,
  `use_gvisor` tinyint(1) NULL DEFAULT NULL,
  `max_deploy_count` int(11) NULL DEFAULT 0,
  `difficulty` int(11) NULL DEFAULT NULL,
  `harden_container` tinyint(1) NULL DEFAULT 1,
  `shared_instant` tinyint(1) NOT NULL DEFAULT 0,
  `connection_protocol` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'http',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `next_id`(`next_id`) USING BTREE,
  INDEX `user_id`(`user_id`) USING BTREE,
  CONSTRAINT `challenges_ibfk_1` FOREIGN KEY (`next_id`) REFERENCES `challenges` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `challenges_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of challenges
-- ----------------------------

-- ----------------------------
-- Table structure for comments
-- ----------------------------
CREATE TABLE IF NOT EXISTS `comments`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `date` datetime(6) NULL DEFAULT NULL,
  `author_id` int(11) NULL DEFAULT NULL,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `author_id`(`author_id`) USING BTREE,
  INDEX `challenge_id`(`challenge_id`) USING BTREE,
  INDEX `team_id`(`team_id`) USING BTREE,
  INDEX `user_id`(`user_id`) USING BTREE,
  CONSTRAINT `comments_ibfk_1` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `comments_ibfk_2` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `comments_ibfk_4` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `comments_ibfk_5` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of comments
-- ----------------------------

-- ----------------------------
-- Table structure for config
-- ----------------------------
CREATE TABLE IF NOT EXISTS `config`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of config
-- ----------------------------
INSERT INTO `config` (`id`, `key`, `value`)
SELECT s.`id`, s.`key`, s.`value`
FROM (
  SELECT 1 AS `id`, 'ctf_theme' AS `key`, 'core-beta' AS `value`
  UNION ALL
  SELECT 2 AS `id`, 'version_latest' AS `key`, 'https://github.com/CTFd/CTFd/releases/tag/3.8.2' AS `value`
  UNION ALL
  SELECT 3 AS `id`, 'next_update_check' AS `key`, '1775081408' AS `value`
) AS s
WHERE NOT EXISTS (
  SELECT 1 FROM `config` LIMIT 1
);

-- ----------------------------
-- Table structure for deploy_histories
-- ----------------------------
CREATE TABLE IF NOT EXISTS `deploy_histories`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `challenge_id` int(11) NOT NULL,
  `log_content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `deploy_status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `deploy_at` datetime(6) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `challenge_id`(`challenge_id`) USING BTREE,
  CONSTRAINT `deploy_histories_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of deploy_histories
-- ----------------------------

-- ----------------------------
-- Table structure for dynamic_challenge
-- ----------------------------
CREATE TABLE IF NOT EXISTS `dynamic_challenge`  (
  `id` int(11) NOT NULL,
  `initial` int(11) NULL DEFAULT NULL,
  `minimum` int(11) NULL DEFAULT NULL,
  `decay` int(11) NULL DEFAULT NULL,
  `function` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  CONSTRAINT `dynamic_challenge_ibfk_1` FOREIGN KEY (`id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of dynamic_challenge
-- ----------------------------

-- ----------------------------
-- Table structure for field_entries
-- ----------------------------
CREATE TABLE IF NOT EXISTS `field_entries`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL CHECK (json_valid(`value`)),
  `field_id` int(11) NULL DEFAULT NULL,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `field_id`(`field_id`) USING BTREE,
  INDEX `team_id`(`team_id`) USING BTREE,
  INDEX `user_id`(`user_id`) USING BTREE,
  CONSTRAINT `field_entries_ibfk_1` FOREIGN KEY (`field_id`) REFERENCES `fields` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `field_entries_ibfk_2` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `field_entries_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of field_entries
-- ----------------------------

-- ----------------------------
-- Table structure for fields
-- ----------------------------
CREATE TABLE IF NOT EXISTS `fields`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `field_type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `required` tinyint(1) NULL DEFAULT NULL,
  `public` tinyint(1) NULL DEFAULT NULL,
  `editable` tinyint(1) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of fields
-- ----------------------------

-- ----------------------------
-- Table structure for files
-- ----------------------------
CREATE TABLE IF NOT EXISTS `files`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `location` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `sha1sum` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `files_ibfk_1`(`challenge_id`) USING BTREE,
  CONSTRAINT `files_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of files
-- ----------------------------

-- ----------------------------
-- Table structure for flags
-- ----------------------------
CREATE TABLE IF NOT EXISTS `flags`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `data` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `flags_ibfk_1`(`challenge_id`) USING BTREE,
  CONSTRAINT `flags_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of flags
-- ----------------------------

-- ----------------------------
-- Table structure for hints
-- ----------------------------
CREATE TABLE IF NOT EXISTS `hints`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `cost` int(11) NULL DEFAULT NULL,
  `requirements` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL CHECK (json_valid(`requirements`)),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `hints_ibfk_1`(`challenge_id`) USING BTREE,
  CONSTRAINT `hints_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of hints
-- ----------------------------

-- ----------------------------
-- Table structure for multiple_choice_challenge
-- ----------------------------
CREATE TABLE IF NOT EXISTS `multiple_choice_challenge`  (
  `id` int(11) NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  CONSTRAINT `multiple_choice_challenge_ibfk_1` FOREIGN KEY (`id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of multiple_choice_challenge
-- ----------------------------

-- ----------------------------
-- Table structure for solves
-- ----------------------------
CREATE TABLE IF NOT EXISTS `solves`  (
  `id` int(11) NOT NULL,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `challenge_id`(`challenge_id`, `team_id`) USING BTREE,
  UNIQUE INDEX `challenge_id_2`(`challenge_id`, `user_id`) USING BTREE,
  INDEX `team_id`(`team_id`) USING BTREE,
  INDEX `user_id`(`user_id`) USING BTREE,
  CONSTRAINT `solves_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `solves_ibfk_2` FOREIGN KEY (`id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `solves_ibfk_3` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `solves_ibfk_4` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of solves
-- ----------------------------

-- ----------------------------
-- Table structure for submissions
-- ----------------------------
CREATE TABLE IF NOT EXISTS `submissions`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  `ip` varchar(46) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `provided` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `date` datetime(6) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `challenge_id`(`challenge_id`) USING BTREE,
  INDEX `team_id`(`team_id`) USING BTREE,
  INDEX `user_id`(`user_id`) USING BTREE,
  CONSTRAINT `submissions_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `submissions_ibfk_2` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `submissions_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of submissions
-- ----------------------------

-- ----------------------------
-- Table structure for tags
-- ----------------------------
CREATE TABLE IF NOT EXISTS `tags`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `challenge_id` int(11) NULL DEFAULT NULL,
  `value` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `tags_ibfk_1`(`challenge_id`) USING BTREE,
  CONSTRAINT `tags_ibfk_1` FOREIGN KEY (`challenge_id`) REFERENCES `challenges` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of tags
-- ----------------------------

-- ----------------------------
-- Table structure for teams
-- ----------------------------
CREATE TABLE IF NOT EXISTS `teams`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `oauth_id` int(11) NULL DEFAULT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `email` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `password` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `secret` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `website` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `affiliation` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `country` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `hidden` tinyint(1) NULL DEFAULT NULL,
  `banned` tinyint(1) NULL DEFAULT NULL,
  `created` datetime(6) NULL DEFAULT NULL,
  `captain_id` int(11) NULL DEFAULT NULL,
  `bracket_id` int(11) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `email`(`email`) USING BTREE,
  UNIQUE INDEX `id`(`id`, `oauth_id`) USING BTREE,
  UNIQUE INDEX `oauth_id`(`oauth_id`) USING BTREE,
  INDEX `team_captain_id`(`captain_id`) USING BTREE,
  INDEX `fk_teams_bracket_id`(`bracket_id`) USING BTREE,
  CONSTRAINT `fk_teams_bracket_id` FOREIGN KEY (`bracket_id`) REFERENCES `brackets` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `team_captain_id` FOREIGN KEY (`captain_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of teams
-- ----------------------------

-- ----------------------------
-- Table structure for tickets
-- ----------------------------
CREATE TABLE IF NOT EXISTS `tickets`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `author_id` int(11) NULL DEFAULT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `replier_id` int(11) NULL DEFAULT NULL,
  `replier_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `status` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `create_at` datetime(6) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `author_id`(`author_id`) USING BTREE,
  INDEX `replier_id`(`replier_id`) USING BTREE,
  CONSTRAINT `tickets_ibfk_1` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `tickets_ibfk_2` FOREIGN KEY (`replier_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of tickets
-- ----------------------------

-- ----------------------------
-- Table structure for tokens
-- ----------------------------
CREATE TABLE IF NOT EXISTS `tokens`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `user_id` int(11) NULL DEFAULT NULL,
  `created` datetime(6) NULL DEFAULT NULL,
  `expiration` datetime(6) NULL DEFAULT NULL,
  `value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `value`(`value`) USING HASH,
  INDEX `user_id`(`user_id`) USING BTREE,
  CONSTRAINT `tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of tokens
-- ----------------------------

-- ----------------------------
-- Table structure for topics
-- ----------------------------
CREATE TABLE IF NOT EXISTS `topics`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `value` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `value`(`value`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of topics
-- ----------------------------

-- ----------------------------
-- Table structure for tracking
-- ----------------------------
CREATE TABLE IF NOT EXISTS `tracking`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `ip` varchar(46) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `user_id` int(11) NULL DEFAULT NULL,
  `date` datetime(6) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `tracking_ibfk_1`(`user_id`) USING BTREE,
  CONSTRAINT `tracking_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of tracking
-- ----------------------------

-- ----------------------------
-- Table structure for unlocks
-- ----------------------------
CREATE TABLE IF NOT EXISTS `unlocks`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NULL DEFAULT NULL,
  `team_id` int(11) NULL DEFAULT NULL,
  `target` int(11) NULL DEFAULT NULL,
  `date` datetime(6) NULL DEFAULT NULL,
  `type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `unlocks_unique`(`team_id`, `target`) USING BTREE,
  INDEX `unlocks_ibfk_2`(`user_id`) USING BTREE,
  CONSTRAINT `unlocks_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `unlocks_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of unlocks
-- ----------------------------

-- ----------------------------
-- Table structure for users
-- ----------------------------
CREATE TABLE IF NOT EXISTS `users`  (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `oauth_id` int(11) NULL DEFAULT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `password` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `email` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `type` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `secret` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `website` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `affiliation` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `country` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `hidden` tinyint(1) NULL DEFAULT NULL,
  `banned` tinyint(1) NULL DEFAULT NULL,
  `verified` tinyint(1) NULL DEFAULT NULL,
  `created` datetime(6) NULL DEFAULT NULL,
  `language` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `bracket_id` int(11) NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `email`(`email`) USING BTREE,
  UNIQUE INDEX `id`(`id`, `oauth_id`) USING BTREE,
  UNIQUE INDEX `oauth_id`(`oauth_id`) USING BTREE,
  INDEX `fk_users_bracket_id`(`bracket_id`) USING BTREE,
  CONSTRAINT `fk_users_bracket_id` FOREIGN KEY (`bracket_id`) REFERENCES `brackets` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of users
-- ----------------------------

-- ----------------------------
-- Table structure for users_teams
-- ----------------------------
CREATE TABLE IF NOT EXISTS `users_teams`  (
  `user_id` int(11) NOT NULL,
  `team_id` int(11) NOT NULL,
  `joined_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`user_id`, `team_id`) USING BTREE,
  INDEX `fk_users_teams_team`(`team_id`) USING BTREE,
  CONSTRAINT `fk_users_teams_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `fk_users_teams_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of users_teams
-- ----------------------------

SET FOREIGN_KEY_CHECKS = 1;
