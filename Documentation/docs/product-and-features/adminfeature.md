Phân quyền dùng trong danh sách:

A: admin
J: jury
CW: challenge writer
1) Quản trị hệ thống và cấu hình

[A/CW/J] Vào cổng quản trị và điều hướng dashboard thống kê.
[A] Cấu hình plugin (đọc và lưu cấu hình plugin).
[A] Cấu hình hệ thống tổng quát (nhiều khóa config), đồng thời tự clear cache config/standings/challenges sau khi đổi.
[A] Bảo vệ các khóa config nhạy cảm (không cho CRUD qua API với một số key protected).
[A] Quản lý custom field cấu hình (fields): tạo, sửa, xóa, xem danh sách.
[A] Reset hệ thống theo phạm vi chọn lọc: challenges, accounts, submissions, logs.
[A] Luồng reset có xử lý logout, setup flag, clear cache/session.
[A] Swagger/API root v1 chỉ cho admin.
2) Import/Export dữ liệu

[A] Export full backup toàn hệ thống dạng zip.
[A] Import full backup (background import), có trạng thái start/end/error.
[A] Tải template CSV import cho users, teams, users+teams.
[A] Import CSV users/teams/users+teams với normalize header, fallback encoding, báo lỗi theo dòng.
[A] Hỗ trợ AJAX import CSV trả về warnings/errors chi tiết.
[A] Export CSV theo bảng dữ liệu.
[A] Export CSV riêng users có lọc field/q.
[A] Export users kèm reset hàng loạt mật khẩu ngẫu nhiên (ghi hash vào DB, xuất plaintext ra file).
[A/J] Export scoreboard sang Excel nhiều sheet.
[A/J] Export submissions sang Excel có đầy đủ filter.
[A] API export raw (CSV hoặc full export), có rate limit.
3) Quản trị người dùng

[A/J] Danh sách users với lọc theo role, verified, hidden, banned, query text, IP, phân trang.
[A] Tạo user mới, tùy chọn gửi email thông tin tài khoản.
[A] Sửa user (type, profile, trạng thái, password, team, bracket, verified, hidden/banned...).
[A] Chặn admin tự ban chính mình.
[A] Xóa user và dọn dữ liệu liên quan (awards, unlocks, submissions, solves, tracking...).
[A] Chặn admin tự xóa chính mình.
[A/J] Xem hồ sơ user chi tiết: solves, fails, awards, missing challenges, IP history, score, place.
[A] Gửi email trực tiếp cho user qua endpoint riêng (rate limit, kiểm tra mail provider).
4) Quản trị đội (teams)

[A/J] Danh sách teams với lọc hidden/banned/bracket/query, phân trang.
[A] Tạo team.
[A] Sửa team (email, profile, captain, hidden/banned, bracket, password...).
[A] Xóa team, tự động tách thành viên và clear session liên quan.
[A/J] Xem team chi tiết: members, solves/fails/awards, missing challenges, score, place, IP.
[A] Quản trị thành viên team qua API:
[A] Xem members.
[A] Thêm user vào team.
[A] Gỡ user khỏi team (kèm dọn submissions/awards/unlocks của user đó theo logic hiện tại).
[A] Sinh invite code cho team.
[A] CRUD bracket (tạo/sửa/xóa hạng bảng).
5) Quản trị challenge và nội dung thi

[A/CW/J] Danh sách challenge với bộ lọc mạnh: field search, category, type, difficulty, state, has prerequisites, tags.
[A/CW/J] CW chỉ thấy challenge của chính CW; admin/jury thấy đầy đủ.
[A/CW/J] Tạo challenge mới, có validation name/category/difficulty.
[A/CW/J] Sửa challenge toàn bộ metadata:
[A/CW/J] Thông tin cơ bản: name, description, category, value, state, type.
[A/CW/J] Chính sách: max_attempts, cooldown, time_limit, difficulty.
[A/CW/J] Điều kiện mở khóa: requirements/prerequisites/anonymize, next challenge.
[A/CW/J] Thuộc tính deploy: require_deploy, deploy_status, image, resource limits, hardening...
[A/CW/J] Chuyển đổi loại challenge standard to dynamic (và ngược lại) trực tiếp từ luồng update.
[A/CW/J] Xóa challenge, dọn deployment metadata/cache/files liên quan.
[A/CW/J] Preview challenge theo template render thực tế.
[A/CW/J] Xem challenge types và template/script tương ứng.
[A] Resync lại toàn bộ dynamic challenge values.
[A/CW/J] Quản trị thành phần challenge:
[A/CW/J] Flags CRUD (hỗ trợ static/regex).
[A/CW/J] Hints CRUD (validation cost, prerequisites).
[A] Tags CRUD.
[A/CW/J] Topics và mapping topic-challenge.
[A/CW/J] Files CRUD.
[A/CW/J] Endpoint xem files/tags/topics/hints/flags/requirements theo challenge.
6) Quản trị vòng đời deploy challenge và version

[A/CW/J] Upload gói deploy challenge (zip), kiểm tra hợp lệ.
[A/CW/J] Triển khai qua workflow, cập nhật trạng thái deploy.
[A/CW/J] Lưu version challenge tự động khi deploy.
[A/CW/J] Xem danh sách versions challenge.
[A/CW/J] Xem chi tiết từng version.
[A] Rollback challenge về version cũ (set active version + áp config version vào challenge).
[A/CW/J] Theo dõi thời gian deploy còn lại qua endpoint deploy-duration (phase, started_at, remaining_time).
[A/CW] Trigger start preview challenge từ admin panel.
7) Quản trị instance đang chạy và vận hành

[A/CW/J] Dừng instance theo challenge/team (stop-by-admin).
[A/CW/J] Dừng hàng loạt theo danh sách instance (stop-bulk).
[A/CW/J ở app, A enforced ở Deployment Center] Dừng toàn bộ instance (stop-all có check admin ở service deploy).
[A] Lấy danh sách toàn bộ instance đang chạy từ cache, có:
[A] Filter team/user/challenge/category/status.
[A] Sort theo nhiều cột.
[A] Pagination.
[A] Trả danh sách giá trị để render dropdown filter.
[A] Trang quản lý instance riêng.
8) Lịch sử deploy và log vận hành

[A/CW/J] Xem lịch sử deploy theo challenge.
[A/CW/J] Xem chi tiết từng lần deploy.
[A/CW/J] Lấy workflow logs.
[A/CW/J] Xem pod logs (HTML view) + API refresh JSON.
[A/CW/J] Xem request logs (HTML view) + API refresh JSON.
[A/J] Trang instances history với lọc user/team/challenge/date/quick range.
[A/J] Export instances history CSV.
9) Chấm bài và submissions

[A/J] Trang submissions có lọc team/user/challenge/date/query/type + phân trang.
[A] API submissions CRUD đầy đủ.
[A] Chỉnh trạng thái submission incorrect/correct (chuyển qua solves/submissions theo logic hiện tại).
[A] Xóa submission có xử lý giảm Redis attempt counter cho incorrect.
[A] Sau thay đổi submissions tự clear standings/challenges cache.
10) Scoreboard, thống kê, thành tích

[A/J] Trang scoreboard admin:
[A/J] Standings theo bracket.
[A/J] User standings (khi team mode).
[A/J] Top submitter / top solves.
[A/J] Teams clear theo topic.
[A/J] Last submission theo challenge.
[A/J] First blood listing.
[A/J] Challenge masters.
[A/J] Tự chạy calculate_and_assign_awards khi mở trang scoreboard.
[A/CW/J] Trang statistics tổng quan (users/teams/challenges/points/IP/wrong/solve, most/least solved).
[A/CW/J] API statistics nâng cao:
[A/CW/J] challenge solves, solve percentages, challenge analytics.
[A/CW/J] score distribution.
[A/CW/J] submission/challenge property counts.
[A] user/team registration stats và user property counts.
[Public theo visibility] Scoreboard API top/chi tiết có bracket filter.
[Public theo visibility] Fastest submissions endpoint.
11) Hệ thống rewards nâng cao (admin panel riêng)

[A/J] Query rewards theo rule engine (validate + execute).
[A/J] Danh sách template rewards.
[A/J] Xem chi tiết template.
[A/J] Preview template với params tùy biến.
[A/J] Presets multi-criteria.
[A/J] Preview multi-criteria với combine method:
[A/J] intersection.
[A/J] union.
[A/J] weighted_score.
[A/J] Drill-down details theo entity/template (ví dụ first blood, perfect solver, no-hints...).
[A/J] API helper dữ liệu categories/challenges/teams/brackets cho UI builder.
12) Action logs và audit trail

[A/J] Trang action logs với lọc user/team/action type, phân trang.
[A/J] Export action logs CSV.
[A/J] Export action logs XLSX, tách sheet theo user/team mode.
[A/J] Trang admin audit trail (mọi mutation đặc quyền) với filter actor/role/action/target/date.
[A/J] Export admin audit CSV, gồm before/after/extra/ip.
[A] API action logs delete.
[A/CW/J/A actions] Rất nhiều thao tác CRUD quan trọng có ghi audit log: users, teams, challenges, submissions, config, hints, flags, tags, awards, files, comments, brackets, reset, bulk password reset.
13) Ticket hỗ trợ

[Admin UI] Xem danh sách ticket với filter status/type/search + phân trang.
[Admin UI] Xem chi tiết ticket.
[Admin UI] Trả lời ticket và đóng ticket.
[A] Xóa nhiều ticket hàng loạt.
Lưu ý thực thi hiện tại: một số route ticket dùng trong admin UI chưa gắn decorator admins_only trực tiếp, nhưng chức năng đang đặt trong khu vực admin.