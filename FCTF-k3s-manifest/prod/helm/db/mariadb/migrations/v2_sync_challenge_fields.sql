-- =============================================================================
-- Migration: v2_sync_challenge_fields
-- Mục đích: Đồng bộ thuộc tính giữa bảng `challenges` (bank) và
--           `contests_challenges` (contest instance).
--
-- challenges     → thêm các trường runtime default
-- contests_challenges → thêm các trường metadata + đổi tên last_update → updated_at
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng `challenges` — thêm các trường runtime default
--    Những trường này là giá trị mặc định sẽ được sao chép sang
--    contests_challenges khi teacher/admin kéo challenge về contest.
-- ---------------------------------------------------------------------------

ALTER TABLE `challenges`
    ADD COLUMN `max_attempt`    int(11)      NULL     DEFAULT 0        AFTER `updated_at`,
    ADD COLUMN `value`          int(11)      NULL                      AFTER `max_attempt`,
    ADD COLUMN `state`          varchar(80)  NOT NULL DEFAULT 'visible' AFTER `value`,
    ADD COLUMN `time_limit`     int(11)      NULL                      AFTER `state`,
    ADD COLUMN `start_time`     datetime(6)  NULL                      AFTER `time_limit`,
    ADD COLUMN `time_finished`  datetime(6)  NULL                      AFTER `start_time`,
    ADD COLUMN `cooldown`       int(11)      NULL     DEFAULT 0        AFTER `time_finished`,
    ADD COLUMN `require_deploy` tinyint(1)   NOT NULL DEFAULT 0        AFTER `cooldown`,
    ADD COLUMN `deploy_status`  text         NULL                      AFTER `require_deploy`,
    ADD COLUMN `connection_info` text        NULL                      AFTER `deploy_status`;

-- ---------------------------------------------------------------------------
-- 2. Bảng `contests_challenges` — thêm metadata + đổi tên cột
-- ---------------------------------------------------------------------------

-- 2a. Đổi tên cột last_update → updated_at và thêm created_at
ALTER TABLE `contests_challenges`
    CHANGE COLUMN `last_update` `updated_at` datetime(6) NULL,
    ADD COLUMN `created_at`     datetime(6)  NULL                      AFTER `updated_at`;

-- 2b. Thêm metadata challenge (đồng bộ với bảng challenges)
ALTER TABLE `contests_challenges`
    ADD COLUMN `description`    text         NULL                      AFTER `name`,
    ADD COLUMN `category`       varchar(80)  NULL                      AFTER `description`,
    ADD COLUMN `type`           varchar(80)  NULL                      AFTER `category`,
    ADD COLUMN `difficulty`     int(11)      NULL                      AFTER `type`,
    ADD COLUMN `requirements`   json         NULL                      AFTER `difficulty`;

-- 2c. Thêm deploy config (đồng bộ với bảng challenges)
ALTER TABLE `contests_challenges`
    ADD COLUMN `image_link`     text         NULL                      AFTER `requirements`,
    ADD COLUMN `deploy_file`    varchar(256) NULL                      AFTER `image_link`,
    ADD COLUMN `cpu_limit`      int(11)      NULL                      AFTER `deploy_file`,
    ADD COLUMN `cpu_request`    int(11)      NULL                      AFTER `cpu_limit`,
    ADD COLUMN `memory_limit`   int(11)      NULL                      AFTER `cpu_request`,
    ADD COLUMN `memory_request` int(11)      NULL                      AFTER `memory_limit`,
    ADD COLUMN `use_gvisor`     tinyint(1)   NULL                      AFTER `memory_request`,
    ADD COLUMN `harden_container` tinyint(1) NULL     DEFAULT 1        AFTER `use_gvisor`,
    ADD COLUMN `shared_instant` tinyint(1)   NOT NULL DEFAULT 0        AFTER `harden_container`;

-- 2d. Thêm các trường contest-instance còn thiếu (đồng bộ với bảng challenges)
ALTER TABLE `contests_challenges`
    ADD COLUMN `is_public`      tinyint(1)   NOT NULL DEFAULT 0        AFTER `shared_instant`,
    ADD COLUMN `import_count`   int(11)      NOT NULL DEFAULT 0        AFTER `is_public`;

-- 2e. Đổi tên max_attempts → max_attempt để nhất quán với challenges
--     (nếu cột max_attempts đã tồn tại)
ALTER TABLE `contests_challenges`
    CHANGE COLUMN `max_attempts` `max_attempt` int(11) NULL DEFAULT 0;

-- =============================================================================
-- Kiểm tra kết quả
-- =============================================================================
-- SHOW COLUMNS FROM `challenges`;
-- SHOW COLUMNS FROM `contests_challenges`;
