# Database Schema — Multiple Contest
> Phiên bản sau khi thêm tính năng **Multiple Contest**.
> Ký hiệu: 🆕 bảng mới | ✏️ bảng sửa đổi | ✅ bảng giữ nguyên

---

## Tổng quan số lượng bảng

| Loại | Số bảng |
|------|---------|
| 🆕 Bảng mới | 4 |
| ✏️ Bảng sửa đổi | 10 |
| ✅ Bảng giữ nguyên | 22 |
| **Tổng** | **36** |

---

## Sơ đồ quan hệ tổng quát

```
    users (✏️)                      semesters (🆕)
      │                                   │
      │ created_by (admin/teacher)  1:N   │ semester_id
      ▼                                   ▼
  contests (🆕) ──────────────────────────────────────────┐
      │                                                    │
      ├──< contest_challenges (🆕) >── challenges (✅)     │
      │                                                    │
      ├──< contest_participants (🆕) >── users (✏️)        │
      │         │                                          │
      │         └── team_id ──> teams (✏️)                 │
      │                                                    │
      ├──< submissions (✏️) ──────────────────────────────┤
      ├──< solves (✏️) ────────────────────────────────────┤
      ├──< teams (✏️) ─────────────────────────────────────┤
      ├──< brackets (✏️) ──────────────────────────────────┤
      ├──< awards (✏️) ────────────────────────────────────┤
      ├──< unlocks (✏️) ───────────────────────────────────┤
      ├──< challenge_start_tracking (✏️) ─────────────────┤
      └──< tickets (✏️) ───────────────────────────────────┘
```

---

## 🆕 Bảng mới

### 1. `semesters`
Kỳ học — nhóm nhiều contest lại theo học kỳ. Một semester có nhiều contests.

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `name` | VARCHAR(100) | NO | UNIQUE, VD: "Summer2026", "Fall2025" |
| `start_date` | DATE | NO | Ngày bắt đầu kỳ học |
| `end_date` | DATE | NO | Ngày kết thúc kỳ học |
| `is_active` | TINYINT(1) DEFAULT 0 | NO | Kỳ học đang diễn ra |
| `created_at` | DATETIME(6) DEFAULT NOW(6) | NO | |

---

### 2. `contests`
Anchor trung tâm — mọi dữ liệu gameplay đều pivot qua đây.

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `name` | VARCHAR(255) | NO | VD: "Giữa kỳ SE01 - Summer2026" |
| `slug` | VARCHAR(100) | NO | UNIQUE, dùng cho URL: /contests/se01-gk |
| `description` | TEXT | YES | |
| `semester_id` | INT | YES | FK → `semesters.id` ON DELETE SET NULL |
| `status` | ENUM('draft','active','ended') DEFAULT 'draft' | NO | |
| `registration_start` | DATETIME(6) | YES | Mở đăng ký |
| `registration_end` | DATETIME(6) | YES | Đóng đăng ký |
| `start_time` | DATETIME(6) | YES | Bắt đầu thi |
| `end_time` | DATETIME(6) | YES | Kết thúc thi |
| `mode` | ENUM('users','teams') DEFAULT 'users' | NO | Thi cá nhân hay theo team |
| `score_visibility` | ENUM('public','hidden','admins_only') DEFAULT 'public' | NO | |
| `default_max_attempts` | INT | YES | Override `challenges.max_attempts` nếu NOT NULL |
| `max_participants` | INT | YES | NULL = không giới hạn |
| `max_team_size` | INT | YES | NULL nếu mode = users |
| `created_by` | INT | YES | FK → `users.id` ON DELETE SET NULL (phải có type='admin' hoặc 'teacher') |
| `created_at` | DATETIME(6) DEFAULT NOW(6) | NO | |
| `updated_at` | DATETIME(6) ON UPDATE NOW(6) | YES | |

---

### 3. `contest_challenges`
Junction table — biến `challenges` thành ngân hàng đề dùng chung giữa nhiều contest.

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `contest_id` | INT | NO | PK, FK → `contests.id` ON DELETE CASCADE |
| `challenge_id` | INT | NO | PK, FK → `challenges.id` ON DELETE CASCADE |
| `added_at` | DATETIME(6) DEFAULT NOW(6) | NO | |

> PRIMARY KEY: `(contest_id, challenge_id)`

---

### 4. `contest_participants`
Trạng thái của user trong một contest cụ thể. Tách biệt với identity toàn cục trong `users`.

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `contest_id` | INT | NO | FK → `contests.id` ON DELETE CASCADE |
| `user_id` | INT | NO | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | FK → `teams.id`, NULL nếu mode = users |
| `status` | ENUM('registered','active','disqualified','withdrawn') DEFAULT 'registered' | NO | |
| `registered_at` | DATETIME(6) DEFAULT NOW(6) | NO | |

> UNIQUE: `(contest_id, user_id)` — mỗi user chỉ tham gia 1 lần/contest

---

## ✏️ Bảng sửa đổi

### 5. `users` ✏️
DROP `team_id` — global team membership không còn nghĩa sau khi team scoped theo contest. Team membership quản lý qua `contest_participants.team_id`.

Mở rộng `type` để hỗ trợ phân quyền admin/teacher/user trong cùng bảng.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | — | PK |
| `oauth_id` | INT | YES | — | UNIQUE |
| `name` | VARCHAR(128) | YES | — | |
| `password` | VARCHAR(128) | YES | — | |
| `email` | VARCHAR(128) | YES | — | UNIQUE |
| `type` | VARCHAR(80) | YES | ✏️ MỞ RỘNG | Giá trị: 'admin', 'teacher', 'user' (thay vì chỉ 'admin'/'user') |
| `secret` | VARCHAR(128) | YES | — | |
| `website` | VARCHAR(128) | YES | — | |
| `affiliation` | VARCHAR(128) | YES | — | |
| `country` | VARCHAR(32) | YES | — | |
| `hidden` | TINYINT(1) | YES | — | |
| `banned` | TINYINT(1) | YES | — | |
| `verified` | TINYINT(1) | YES | — | |
| ~~`team_id`~~ | ~~INT~~ | — | 🗑️ DROP | Thay bằng `contest_participants.team_id` |
| `created` | DATETIME(6) | YES | — | |
| `language` | VARCHAR(32) | YES | — | |
| `bracket_id` | INT | YES | — | FK → `brackets.id` ON DELETE SET NULL |

---

### 6. `teams` ✏️
Thêm `contest_id` để scope team theo từng contest. DROP UNIQUE `email`, thay bằng UNIQUE `(email, contest_id)`.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | — | PK |
| `oauth_id` | INT | YES | — | |
| `name` | VARCHAR(128) | YES | — | |
| `email` | VARCHAR(128) | YES | ✏️ DROP UNIQUE cũ | UNIQUE mới: `(email, contest_id)` |
| `password` | VARCHAR(128) | YES | — | |
| `secret` | VARCHAR(128) | YES | — | |
| `website` | VARCHAR(128) | YES | — | |
| `affiliation` | VARCHAR(128) | YES | — | |
| `country` | VARCHAR(32) | YES | — | |
| `hidden` | TINYINT(1) | YES | — | |
| `banned` | TINYINT(1) | YES | — | |
| `created` | DATETIME(6) | YES | — | |
| `captain_id` | INT | YES | — | FK → `users.id` ON DELETE SET NULL |
| `bracket_id` | INT | YES | — | FK → `brackets.id` ON DELETE SET NULL |
| `contest_id` | INT | NO | 🆕 THÊM | FK → `contests.id` ON DELETE CASCADE |

> UNIQUE cũ bị DROP: `email`
> UNIQUE mới: `(email, contest_id)`

---

### 7. `brackets` ✏️
Thêm `contest_id` để bracket scoped theo contest.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | — | PK |
| `name` | VARCHAR(255) | YES | — | |
| `description` | TEXT | YES | — | |
| `type` | VARCHAR(80) | YES | — | |
| `contest_id` | INT | NO | 🆕 THÊM | FK → `contests.id` ON DELETE CASCADE |

---

### 8. `submissions` ✏️
Thêm `contest_id` để phân biệt kết quả theo từng contest.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | — | PK |
| `challenge_id` | INT | YES | — | FK → `challenges.id` ON DELETE CASCADE |
| `user_id` | INT | YES | — | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | — | FK → `teams.id` ON DELETE CASCADE |
| `ip` | VARCHAR(46) | YES | — | |
| `provided` | TEXT | YES | — | Flag đã nộp |
| `type` | VARCHAR(32) | YES | — | correct / incorrect / ... |
| `date` | DATETIME(6) | YES | — | |
| `contest_id` | INT | NO | 🆕 THÊM | FK → `contests.id` ON DELETE CASCADE |

---

### 9. `solves` ✏️
Thêm `contest_id`. DROP UNIQUE cũ, tạo lại với `contest_id` để user có thể solve cùng challenge ở nhiều contest.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT | NO | — | PK, FK → `submissions.id` ON DELETE CASCADE |
| `challenge_id` | INT | YES | — | FK → `challenges.id` ON DELETE CASCADE |
| `user_id` | INT | YES | — | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | — | FK → `teams.id` ON DELETE CASCADE |
| `contest_id` | INT | NO | 🆕 THÊM | FK → `contests.id` ON DELETE CASCADE |

> UNIQUE cũ bị DROP: `(challenge_id, team_id)` và `(challenge_id, user_id)`
> UNIQUE mới: `(challenge_id, user_id, contest_id)` và `(challenge_id, team_id, contest_id)`

---

### 10. `awards` ✏️
Thêm `contest_id` để award scoped theo contest.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | — | PK |
| `user_id` | INT | YES | — | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | — | FK → `teams.id` ON DELETE CASCADE |
| `name` | VARCHAR(80) | YES | — | |
| `description` | TEXT | YES | — | |
| `date` | DATETIME(6) | YES | — | |
| `value` | INT | YES | — | |
| `category` | VARCHAR(80) | YES | — | |
| `icon` | TEXT | YES | — | |
| `requirements` | LONGTEXT (JSON) | YES | — | |
| `type` | VARCHAR(80) DEFAULT 'standard' | YES | — | |
| `contest_id` | INT | NO | 🆕 THÊM | FK → `contests.id` ON DELETE CASCADE |

---

### 11. `unlocks` ✏️
Thêm `contest_id`. DROP UNIQUE cũ `(team_id, target)`, tạo lại với `contest_id`.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | — | PK |
| `user_id` | INT | YES | — | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | — | FK → `teams.id` ON DELETE CASCADE |
| `target` | INT | YES | — | hint_id được unlock |
| `date` | DATETIME(6) | YES | — | |
| `type` | VARCHAR(32) | YES | — | |
| `contest_id` | INT | NO | 🆕 THÊM | FK → `contests.id` ON DELETE CASCADE |

> UNIQUE cũ bị DROP: `(team_id, target)`
> UNIQUE mới: `(team_id, target, contest_id)`

---

### 12. `challenge_start_tracking` ✏️
Thêm `contest_id` để track deploy instance theo từng contest.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | — | PK |
| `user_id` | INT | YES | — | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | — | FK → `teams.id` ON DELETE CASCADE |
| `challenge_id` | INT | NO | — | FK → `challenges.id` ON DELETE CASCADE |
| `started_at` | DATETIME(6) | NO | — | |
| `stopped_at` | DATETIME(6) | YES | — | |
| `label` | VARCHAR(255) | YES | — | |
| `contest_id` | INT | NO | 🆕 THÊM | FK → `contests.id` ON DELETE CASCADE |

---

### 13. `tickets` ✏️
Thêm `contest_id` để ticket scoped theo contest.

| Cột | Kiểu | Nullable | Thay đổi | Ghi chú |
|-----|------|----------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | — | PK |
| `author_id` | INT | YES | — | FK → `users.id` ON DELETE CASCADE |
| `title` | VARCHAR(255) | YES | — | |
| `type` | VARCHAR(80) | YES | — | |
| `description` | TEXT | YES | — | |
| `replier_id` | INT | YES | — | FK → `users.id` ON DELETE CASCADE |
| `replier_message` | TEXT | YES | — | |
| `status` | VARCHAR(80) | YES | — | |
| `create_at` | DATETIME(6) | YES | — | |
| `contest_id` | INT | NO | 🆕 THÊM | FK → `contests.id` ON DELETE CASCADE |

---

## ✅ Bảng giữ nguyên

### 14. `admin_audit_logs`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `actor_id` | INT | YES | FK → `users.id` ON DELETE SET NULL |
| `actor_name` | VARCHAR(128) | YES | |
| `actor_type` | VARCHAR(80) | YES | |
| `action` | VARCHAR(128) | NO | |
| `target_type` | VARCHAR(80) | YES | |
| `target_id` | INT | YES | |
| `before_state` | LONGTEXT (JSON) | YES | |
| `after_state` | LONGTEXT (JSON) | YES | |
| `extra_data` | LONGTEXT (JSON) | YES | |
| `ip_address` | VARCHAR(46) | YES | |
| `timestamp` | DATETIME(6) DEFAULT NOW(6) | NO | |

---

### 15. `challenges`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `name` | VARCHAR(80) | YES | |
| `description` | TEXT | YES | |
| `max_attempts` | INT | YES | |
| `value` | INT | YES | Điểm mặc định |
| `category` | VARCHAR(80) | YES | |
| `type` | VARCHAR(80) | YES | standard / dynamic / ... |
| `state` | VARCHAR(80) | NO | visible / hidden |
| `requirements` | LONGTEXT (JSON) | YES | |
| `connection_info` | TEXT | YES | |
| `next_id` | INT | YES | FK → `challenges.id` ON DELETE SET NULL |
| `time_limit` | INT | YES | Giây |
| `require_deploy` | TINYINT(1) | NO | |
| `deploy_status` | TEXT | YES | |
| `last_update` | DATETIME(6) | YES | |
| `time_finished` | DATETIME(6) | YES | |
| `start_time` | DATETIME(6) | YES | |
| `image_link` | TEXT | YES | Docker image |
| `user_id` | INT | NO | FK → `users.id` (người tạo) |
| `cooldown` | INT | YES | Giây |
| `deploy_file` | VARCHAR(256) | YES | |
| `cpu_limit` | INT | YES | millicores |
| `cpu_request` | INT | YES | millicores |
| `memory_limit` | INT | YES | MB |
| `memory_request` | INT | YES | MB |
| `use_gvisor` | TINYINT(1) | YES | |
| `max_deploy_count` | INT DEFAULT 0 | YES | |
| `difficulty` | INT | YES | |
| `harden_container` | TINYINT(1) DEFAULT 1 | YES | |
| `shared_instant` | TINYINT(1) DEFAULT 0 | NO | |
| `connection_protocol` | VARCHAR(10) DEFAULT 'http' | NO | http / tcp |

---

### 15. `flags`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `challenge_id` | INT | YES | FK → `challenges.id` ON DELETE CASCADE |
| `type` | VARCHAR(80) | YES | static / regex |
| `content` | TEXT | YES | Giá trị flag |
| `data` | TEXT | YES | Config thêm (case-sensitive...) |

---

### 16. `hints`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `type` | VARCHAR(80) | YES | |
| `challenge_id` | INT | YES | FK → `challenges.id` ON DELETE CASCADE |
| `content` | TEXT | YES | Nội dung gợi ý |
| `cost` | INT | YES | Điểm trừ khi dùng hint |
| `requirements` | LONGTEXT (JSON) | YES | |

---

### 17. `files`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `type` | VARCHAR(80) | YES | challenge / page |
| `location` | TEXT | YES | Đường dẫn file |
| `challenge_id` | INT | YES | FK → `challenges.id` ON DELETE CASCADE |
| `sha1sum` | VARCHAR(40) | YES | Hash kiểm tra toàn vẹn |

---

### 18. `tags`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `challenge_id` | INT | YES | FK → `challenges.id` ON DELETE CASCADE |
| `value` | VARCHAR(80) | YES | Tên tag |

---

### 19. `dynamic_challenge`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT | NO | PK, FK → `challenges.id` ON DELETE CASCADE |
| `initial` | INT | YES | Điểm ban đầu |
| `minimum` | INT | YES | Điểm tối thiểu |
| `decay` | INT | YES | Tốc độ giảm điểm |
| `function` | VARCHAR(32) | YES | linear / logarithmic |

---

### 20. `multiple_choice_challenge`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT | NO | PK, FK → `challenges.id` ON DELETE CASCADE |

---

### 21. `challenge_topics`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `challenge_id` | INT | YES | FK → `challenges.id` ON DELETE CASCADE |
| `topic_id` | INT | YES | FK → `topics.id` ON DELETE CASCADE |

---

### 22. `challenge_versions`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `challenge_id` | INT | NO | FK → `challenges.id` ON DELETE CASCADE |
| `version_number` | INT DEFAULT 1 | NO | |
| `image_link` | TEXT | YES | |
| `deploy_file` | VARCHAR(256) | YES | |
| `cpu_limit` | INT | YES | |
| `cpu_request` | INT | YES | |
| `memory_limit` | INT | YES | |
| `memory_request` | INT | YES | |
| `use_gvisor` | TINYINT(1) | YES | |
| `max_deploy_count` | INT DEFAULT 0 | YES | |
| `is_active` | TINYINT(1) DEFAULT 0 | NO | |
| `created_by` | INT | YES | FK → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME(6) | NO | |
| `notes` | TEXT | YES | |
| `harden_container` | TINYINT(1) DEFAULT 1 | YES | |

---

### 23. `deploy_histories`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `challenge_id` | INT | NO | FK → `challenges.id` ON DELETE RESTRICT |
| `log_content` | TEXT | YES | |
| `deploy_status` | VARCHAR(50) | NO | |
| `deploy_at` | DATETIME(6) | YES | |

---

### 24. `topics`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `value` | VARCHAR(255) | YES | UNIQUE |

---

### 25. `config`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `key` | TEXT | YES | |
| `value` | TEXT | YES | |

---

### 26. `tokens`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `type` | VARCHAR(32) | YES | |
| `user_id` | INT | YES | FK → `users.id` ON DELETE CASCADE |
| `created` | DATETIME(6) | YES | |
| `expiration` | DATETIME(6) | YES | |
| `value` | TEXT | YES | UNIQUE (HASH) |
| `description` | TEXT | YES | |

---

### 27. `tracking`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `type` | VARCHAR(32) | YES | |
| `ip` | VARCHAR(46) | YES | |
| `user_id` | INT | YES | FK → `users.id` ON DELETE CASCADE |
| `date` | DATETIME(6) | YES | |

---

### 28. `action_logs`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `actionId` | INT AUTO_INCREMENT | NO | PK |
| `userId` | INT | YES | FK → `users.id` ON DELETE RESTRICT |
| `actionDate` | DATETIME | NO | |
| `actionType` | INT | NO | |
| `actionDetail` | VARCHAR(255) | NO | |
| `topicName` | VARCHAR(255) | YES | |

---

### 29. `comments`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `type` | VARCHAR(80) | YES | challenge / user / team |
| `content` | TEXT | YES | |
| `date` | DATETIME(6) | YES | |
| `author_id` | INT | YES | FK → `users.id` ON DELETE CASCADE |
| `challenge_id` | INT | YES | FK → `challenges.id` ON DELETE CASCADE |
| `user_id` | INT | YES | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | FK → `teams.id` ON DELETE CASCADE |

---

### 30. `fields`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `name` | TEXT | YES | |
| `type` | VARCHAR(80) | YES | user / team |
| `field_type` | VARCHAR(80) | YES | text / boolean / ... |
| `description` | TEXT | YES | |
| `required` | TINYINT(1) | YES | |
| `public` | TINYINT(1) | YES | |
| `editable` | TINYINT(1) | YES | |

---

### 31. `field_entries`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `type` | VARCHAR(80) | YES | |
| `value` | LONGTEXT (JSON) | YES | |
| `field_id` | INT | YES | FK → `fields.id` ON DELETE CASCADE |
| `user_id` | INT | YES | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | FK → `teams.id` ON DELETE CASCADE |

---

### 32. `achievements`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `user_id` | INT | YES | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | FK → `teams.id` ON DELETE CASCADE |
| `challenge_id` | INT | YES | FK → `challenges.id` ON DELETE CASCADE |
| `name` | VARCHAR(80) | YES | |
| `achievement_id` | INT | YES | FK → `award_badges.id` ON DELETE CASCADE |

---

### 33. `award_badges`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `user_id` | INT | YES | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | FK → `teams.id` ON DELETE CASCADE |
| `challenge_id` | INT | YES | FK → `challenges.id` ON DELETE CASCADE |
| `name` | VARCHAR(80) | YES | |

---

### 34. `notifications`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `id` | INT AUTO_INCREMENT | NO | PK |
| `title` | TEXT | YES | |
| `content` | TEXT | YES | |
| `date` | DATETIME(6) | YES | |
| `user_id` | INT | YES | FK → `users.id` ON DELETE CASCADE |
| `team_id` | INT | YES | FK → `teams.id` ON DELETE CASCADE |

---

### 35. `alembic_version`

| Cột | Kiểu | Nullable | Ghi chú |
|-----|------|----------|---------|
| `version_num` | VARCHAR(32) | NO | PK |

---

## Tóm tắt thay đổi UNIQUE constraints

| Bảng | UNIQUE bị DROP | UNIQUE mới |
|------|---------------|------------|
| `solves` | `(challenge_id, team_id)` | `(challenge_id, team_id, contest_id)` |
| `solves` | `(challenge_id, user_id)` | `(challenge_id, user_id, contest_id)` |
| `unlocks` | `(team_id, target)` | `(team_id, target, contest_id)` |
| `teams` | `email` | `(email, contest_id)` |

## Tóm tắt cột bị DROP

| Bảng | Cột bị DROP | Lý do |
|------|------------|-------|
| `users` | `team_id` | Team membership quản lý qua `contest_participants.team_id` |
