# Phương án: thêm **Live Pod Logs** trong Instance History

## Mục tiêu

Giữ lại khả năng xem stdout/stderr trực tiếp của Pod Kubernetes như màn hình
**Pod Logs** cũ, nhưng đặt đúng ngữ cảnh vận hành: đây là log của Pod *đang
tồn tại*, không phải dữ liệu lịch sử bền vững của một instance.

Trong bảng **Instances History**, mọi dòng có mục **Request Logs**. Với instance
còn `provisioning`, `running` hoặc `stopping`, menu có thêm mục thứ hai theo thứ tự:

1. **Request Logs**
2. **Live Pod Logs**

`Live Pod Logs` nằm ngay dưới `Request Logs`, như thiết kế mong muốn.

## Clarifications

### Session 2026-09-11

- Q: Should Live Pod Logs appear only for lifecycle provisioning/running/stopping, or also terminal history? → A: Only show it for provisioning, running, or stopping instances.
- Q: Is an in-page container selector needed? → A: No. The Instance History row selects the challenge/team outside the log page; each current challenge Pod has one `challenge` container.
- Q: Should the API use explicit HTTP statuses for Live Pod Logs states? → A: Valid Pod/log states use 200; Pod not found 404; log read failure 502; source unavailable 503; access denied 403.
- Q: What level of Audit Log is required for Live Pod Logs? → A: Audit opening Live Pod Logs, but not manual or automatic refreshes.
- Q: What limits should apply to returned log data and auto refresh? → A: Return at most the last 1,000 lines or 256 KiB; retain 5/10/30/60 second intervals and skip refresh while a request is in flight.

## Hành vi giao diện

### Request Logs

- Không thay đổi chức năng hiện có.
- Mở trang Instance Request Logs theo `instance_id`.
- Hiển thị metadata request HTTP/TCP đã được Gateway ghi nhận trong Loki.
- Dữ liệu vẫn xem được sau khi Pod đã bị stop hoặc bị Kubernetes xóa, trong
  phạm vi retention của telemetry.

### Live Pod Logs

- Mở trang log nền đen, có `Back`, `Refresh`, và Auto refresh 5/10/30/60 giây.
- Giữ nguyên cách đọc log hiện tại: DeploymentCenter tìm Pod bằng
  `challengeId` và `teamId`, rồi gọi Kubernetes để lấy stdout/stderr của Pod.
- Hiển thị một **status banner** riêng ở phía trên vùng log. Không ghi trạng
  thái lẫn vào khung log nền đen.
- Khung log chỉ hiển thị stdout/stderr khi Kubernetes đọc được log.

### Vị trí status banner và ô log

Status banner nằm **ngay phía trên** ô log nền đen. Nó là thông tin do nền tảng
Kubernetes/DeploymentCenter tạo ra; ô nền đen chỉ dành cho raw stdout/stderr
của container `challenge`.

```text
[Back] [Refresh] [Auto: Off | 5s | 10s | 30s | 60s]

[● Running / Ready]  Pod: contest-...  Checked: 09:25:10
hoặc
[⚠ Not Ready] ImagePullBackOff
hoặc
[✖ Pod not found] View Request Logs

┌─────────────────────────────────────────────────────┐
│ stdout/stderr của container `challenge`              │
│ error: ...                                           │
│ info: ...                                            │
└─────────────────────────────────────────────────────┘
```

- Khi Pod không tìm thấy, không đọc được log, hoặc hạ tầng tạm không sẵn sàng,
  banner thể hiện trạng thái tương ứng theo bảng bên dưới.
- Trong các trường hợp trên, ô nền đen chỉ để trống hoặc hiển thị dòng trung
  tính `No container log available.`; không đặt thông báo hệ thống, stack trace
  hay chi tiết lỗi hạ tầng vào ô log.
- Khi `podState` là `READY`, `NOT_READY` hoặc `TERMINATED`, banner vẫn hiển
  thị state/reason và ô nền đen hiển thị raw log nếu Kubernetes đọc được.

### Chọn Pod ở menu Actions

- Admin chọn **bên ngoài trang log**, tại dòng Instance History. Dòng đó đã có
  `challenge_id`, `team_id` (hoặc shared scope `-2`) nên xác định challenge
  deployment của đúng team.
- Workflow plain và hardened hiện tại tạo một Job Pod cho deployment đó, với
  duy nhất application container tên `challenge`.
- Live Pod Logs không có dropdown Container và không nhận `container` từ
  browser. API giữ nguyên việc đọc log của container duy nhất trong Pod.
- Nếu sau này challenge Pod có sidecar hoặc nhiều application container, đây là
  thay đổi kiến trúc cần có phương án riêng; không tự thêm selector vào giai
  đoạn 1.

### Các trạng thái phải biểu diễn

Không dùng một mã `state` để gộp mọi tình huống. Một Pod có thể vừa `NOT_READY`
vừa chưa tạo log; do đó API và UI phải tách ba chiều trạng thái:

- `sourceState`: khả năng gọi DeploymentCenter/Kubernetes: `AVAILABLE` hoặc
  `UNAVAILABLE`.
- `podState`: Pod mục tiêu: `READY`, `NOT_READY`, `TERMINATED`, `NOT_FOUND`
  hoặc `UNKNOWN` khi source không sẵn sàng.
- `logState`: kết quả đọc stdout/stderr: `AVAILABLE`, `EMPTY`,
  `READ_FAILED`, `NOT_REQUESTED`.

| sourceState | podState | logState | HTTP | Banner cho admin | Vùng log / thao tác |
|---|---|---|---:|---|---|
| `AVAILABLE` | `READY` | `AVAILABLE` | 200 | `Live Pod is running and ready.` Kèm Pod name, namespace, thời điểm kiểm tra | Hiển thị log; cho Refresh/Auto refresh |
| `AVAILABLE` | `NOT_READY` | `AVAILABLE` hoặc `EMPTY` | 200 | `Pod exists but is not ready: <reason>.` Nếu log rỗng, thêm dòng `No logs yet.` | Vẫn cho Refresh/Auto refresh |
| `AVAILABLE` | `TERMINATED` | `AVAILABLE` hoặc `EMPTY` | 200 | `Pod is no longer running: <reason>.` | Hiển thị log còn đọc được; Auto refresh chuyển Off |
| `AVAILABLE` | `NOT_FOUND` | `NOT_REQUESTED` | 404 | `No Pod currently matches this challenge and team.` | Khung log rỗng; hiển thị link `View Request Logs` |
| `AVAILABLE` | `READY`, `NOT_READY` hoặc `TERMINATED` | `EMPTY` | 200 | Giữ banner theo `podState`; thêm dòng phụ `Pod has not produced stdout/stderr yet.` | Không coi là lỗi; cho Refresh/Auto refresh |
| `AVAILABLE` | `READY`, `NOT_READY` hoặc `TERMINATED` | `READ_FAILED` | 502 | Giữ banner theo `podState`; thêm dòng phụ `Pod logs could not be read: <safe reason>.` | Không hiển thị exception nội bộ; cho Retry/Refresh |
| `UNAVAILABLE` | `UNKNOWN` | `NOT_REQUESTED` | 503 | `Live Pod Logs is temporarily unavailable.` | Giữ nội dung log cũ trên màn hình nếu có; cho Retry |
| N/A | N/A | N/A | 403 | Trang lỗi phân quyền hiện có | Không lộ Pod name, namespace hoặc log |

Ưu tiên hiển thị banner là: `sourceState=UNAVAILABLE` → `podState=NOT_FOUND`
→ banner theo `podState`; `logState=EMPTY` hoặc `READ_FAILED` chỉ là thông tin
phụ bên dưới banner. Vì vậy một Pod `NOT_READY` và log rỗng vẫn được biểu diễn
đầy đủ, không bị ép chọn một mã duy nhất.

`TERMINATED` chỉ có thể xuất hiện khi instance vẫn đang `stopping` và Pod chưa
bị Kubernetes dọn dẹp. Sau khi lifecycle của instance đã terminal, menu không
còn Live Pod Logs; admin dùng Request Logs.

`<reason>` chỉ dùng reason an toàn từ Kubernetes (ví dụ `ImagePullBackOff`,
`OOMKilled`); không hiển thị stack trace, secret, token hoặc response nội bộ.

## Audit Log policy

- Ghi event `view_live_pod_logs` sau khi request đã qua authorization và trang
  Live Pod Logs được mở. Event vẫn được ghi khi `podState=NOT_FOUND` hoặc
  `sourceState=UNAVAILABLE`, vì đó vẫn là một lần truy cập chức năng vận hành.
- Không ghi event cho `Refresh` thủ công hoặc Auto refresh. Điều này tránh một
  người đang debug tạo hàng trăm Audit Log giống nhau.
- Metadata audit chỉ gồm actor đã xác thực, `challenge_id`, `team_id` hoặc
  shared scope và các giá trị `sourceState`/`podState`/`logState` trả về.
  Tuyệt đối không ghi nội dung stdout/stderr, URL access, token, header hay
  secret vào Audit Log.
- Dùng cơ chế `log_audit` hiện có ở CTFd; không thêm bảng database mới.

## Giới hạn log và Auto refresh

- Mỗi request chỉ đọc phần cuối của log: tối đa **1.000 dòng** và **256 KiB**.
  DeploymentCenter phải truyền giới hạn này cho Kubernetes; không đọc toàn bộ
  stream vào RAM rồi mới cắt ở CTFd/browser.
- UI hiển thị rõ: `Showing the latest 1,000 lines / 256 KiB at most.` Người
  xem không được hiểu nhầm đây là toàn bộ log từ khi Pod khởi tạo.
- Giữ các mức Auto refresh của màn cũ: `5s`, `10s`, `30s`, `60s` và `Off`.
- Chỉ cho phép một request Live Pod Logs đang chạy trên mỗi trang. Trong lúc
  request chưa xong, nút Refresh bị disable và tick Auto refresh kế tiếp bị
  bỏ qua, không xếp hàng request mới.
- Khi `podState=TERMINATED`, Auto refresh tự chuyển sang `Off`. Với
  `podState=NOT_FOUND`, `logState=READ_FAILED` và
  `sourceState=UNAVAILABLE`, giữ lựa chọn interval của người dùng để họ có thể
  retry, nhưng vẫn áp dụng quy tắc không có request chồng nhau.
- `PodLogsDTO` bổ sung metadata giới hạn (`tailLines=1000`,
  `limitBytes=262144`) để frontend render đúng. UI luôn nói rõ đây là cửa sổ
  log cuối; không dùng boolean `truncated` vì Kubernetes không bảo đảm cho biết
  chính xác log gốc có bị cắt hay không.

## Hợp đồng API cần bổ sung

Code hiện tại đã có `PodInfo.Status` và `PodInfo.Ready` khi liệt kê Pod, nhưng
`GetPodLogs` chỉ trả `PodName` và chuỗi `Logs`. Vì vậy UI cũ không thể phân biệt
`Running/Ready`, `Waiting`, `Terminated`, log rỗng và lỗi đọc log.

Mở rộng `PodLogsDTO` và response của `pods-logs-api` theo hướng tương thích:

```json
{
  "success": true,
  "logs": "...",
  "data": {
    "sourceState": "AVAILABLE",
    "podState": "READY",
    "logState": "AVAILABLE",
    "podName": "...",
    "namespace": "...",
    "podPhase": "Running",
    "ready": true,
    "reason": null,
    "tailLines": 1000,
    "limitBytes": 262144,
    "checkedAt": "2026-09-11T02:25:05Z"
  }
}
```

- Giữ trường `logs` để không làm hỏng màn Pod Logs cũ hay client cũ.
- Trang **Live Pod Logs** dùng `data.sourceState`, `data.podState` và
  `data.logState` để vẽ status banner và dòng phụ.
- HTTP contract được chốt: source không sẵn sàng trả 503; Pod không tìm thấy
  trả 404; đọc log thất bại trả 502; những trạng thái Pod/log hợp lệ còn lại
  trả 200; phân quyền trả 403. Mọi response đều có ba trường state; frontend
  không suy luận trạng thái bằng cách so sánh chuỗi tiếng Anh trong `logs`.
- `K8sService.GetPodLogs` hiện bắt exception rồi biến nó thành chuỗi. Cần đổi
  sang trả kết quả có mã lỗi/hoặc ném lỗi có kiểm soát để DeploymentCenter phân
  biệt được `logState=EMPTY` với `logState=READ_FAILED`.
- Giai đoạn 1 không thay đổi request DTO: endpoint tiếp tục nhận
  `challengeId` và `teamId`, vì challenge Pod hiện chỉ có một container.

## Liên kết từ menu Actions

Tại template Instance History, chỉ bổ sung link dưới `Request Logs` khi
instance đang `provisioning`, `running` hoặc `stopping`:

```jinja2
{% if row.lifecycle_state in ['provisioning', 'running', 'stopping'] %}
  {% set live_team_id = -2 if row.instance_scope == 'shared' else row.instance_owner_team_id %}
<a class="action-menu-item"
   href="{{ url_for('challengeHistory.get_pods_logs',
                    challenge_id=row.challenge_id,
                    team_id=live_team_id) }}">
  <i class="fas fa-file-alt fa-fw"></i> Live Pod Logs
</a>
{% endif %}
```

Ý nghĩa tham số:

- `challenge_id`: challenge của dòng instance đang xem.
- `team_id`: team sở hữu instance; ví dụ dòng trong ảnh là team `#2` thì URL
  phải có `?team_id=2`.
- `-2`: giá trị mà code hiện tại dùng cho shared instance. Shared instance
  không có `instance_owner_team_id`, nên không được truyền `-1`.
- Instance terminal (`stopped`, `expired`, `failed`, hoặc state kết thúc tương
  đương) chỉ có `Request Logs`; không hiển thị `Live Pod Logs`.

Route hiện có đã nhận đúng các tham số này:

```text
GET /deploy_History/<challenge_id>/pods-logs?team_id=<team_id>
```

Từ menu Instance History, route page cũng mang thêm `instance_id` dưới dạng tham
số **tùy chọn**. Giá trị này chỉ được CTFd kiểm tra để dựng link `View Request
Logs` khi Pod không còn tồn tại; nó không được gửi sang DeploymentCenter và
không được dùng để chọn Pod. Vì vậy định danh của Live Pod Logs giai đoạn 1
vẫn là `challenge_id` + `team_id`.

Giai đoạn đầu tái sử dụng route, quyền truy cập và cơ chế auto-refresh hiện
có. API chỉ được **mở rộng tương thích** để trả trạng thái Pod có cấu trúc;
không thay thế cơ chế đọc stdout/stderr hiện hữu.

## Phân biệt rõ hai chức năng

| Tiêu chí | Request Logs | Live Pod Logs |
|---|---|---|
| Định danh chính | `instance_id` | `challenge_id` + `team_id` |
| Nguồn dữ liệu | Gateway telemetry trong Loki | stdout/stderr trực tiếp từ Kubernetes Pod |
| Dùng khi | Audit request HTTP/TCP, điều tra lưu lượng | Debug runtime: crash, exception, DB/network error |
| Sau khi Pod bị xóa | Vẫn xem được telemetry đã lưu | Không xem được; trả HTTP 404 với `podState=NOT_FOUND` |
| Ý nghĩa lịch sử | Có, theo retention | Không; chỉ live/current Pod |

## Cảnh báo live data

Đặt một dòng cảnh báo ngay phía trên vùng log:

> Live view only. This log belongs to the currently active Pod matching this
> challenge and team; it may not be the historical Pod of this instance.

## Files sẽ tác động

### Bắt buộc sửa

| File | Thay đổi | Lý do |
|---|---|---|
| `FCTF-ManagementPlatform/CTFd/themes/admin/templates/instances_history/instances_history.html` | Với lifecycle active, thêm `Live Pod Logs` ngay dưới `Request Logs`; truyền `challenge_id` và `team_id` đúng scope (`-2` cho shared). | Đây là menu Actions của trang Instances History toàn cục. |
| `FCTF-ManagementPlatform/CTFd/themes/admin/templates/contests/sections/instances.html` | Thêm cùng điều kiện lifecycle, cùng tham số và cùng thứ tự. | Đây là danh sách Instance History khi xem bên trong một contest; nếu không sửa, hai màn hình sẽ khác nhau. |
| `FCTF-ManagementPlatform/CTFd/themes/admin/templates/challenges/pod_logs.html` | Đổi title thành Live Pod Logs; thêm status banner, link View Request Logs, thông báo giới hạn log và chặn refresh chồng nhau. | Đây là màn hình cũ được tái sử dụng để hiển thị log trực tiếp. |
| `FCTF-ManagementPlatform/CTFd/DeployHistory.py` | Ghi một Audit Log khi mở trang; giữ route cũ nhưng trả response API có `success`, HTTP status và ba state trong `data` thay vì luôn đóng gói lỗi thành `logs` thành công. | CTFd phải chuyển trạng thái có cấu trúc tới UI và là nơi có actor đã xác thực. |
| `FCTF-ManagementPlatform/CTFd/utils/connector/multiservice_connector.py` | Giữ lại body/status có cấu trúc từ DeploymentCenter và vẫn hỗ trợ trường `logs` tương thích. | Connector hiện tại chỉ trả một chuỗi log/message và làm mất trạng thái. |
| `FCTF-ManagementPlatform/CTFd/utils/logging/audit_logger.py` | Khai báo action `view_live_pod_logs` là target kiểu challenge. | Audit có target, contest và metadata đúng nhưng không chứa nội dung log. |
| `ControlCenterAndChallengeHostingServer/ResourceShared/DTOs/Deployments/PodLogsDTO.cs` | Bổ sung source/Pod/log state, Pod phase, readiness, reason an toàn, namespace, giới hạn và checked time. | Đây là contract trả từ DeploymentCenter sang CTFd. |
| `ControlCenterAndChallengeHostingServer/ResourceShared/DTOs/Deployments/PodInfo.cs` | Bổ sung phase, reason và cờ terminated lấy từ Kubernetes. | DeploymentCenter phân loại chính xác trạng thái Pod thay vì suy luận từ chuỗi log. |
| `ControlCenterAndChallengeHostingServer/DeploymentCenter/Services/DeployService.cs` | Phân loại Pod thành các state trong bảng, rồi trả DTO có cấu trúc và HTTP status phù hợp. | Đây là nơi hiện tại chọn Pod theo `challengeId + teamId` và mới chỉ trả PodName/Logs. |
| `ControlCenterAndChallengeHostingServer/ResourceShared/Services/K8sService.cs` — `IK8sService` | Thêm lookup Pod có thể báo source unavailable; đổi kết quả đọc log để phân biệt log rỗng với lỗi đọc log và áp dụng tail 1.000 dòng/256 KiB ngay tại Kubernetes API. | Hàm hiện tại bắt exception và đổi thành chuỗi, khiến `logState=READ_FAILED` không phân biệt được `logState=EMPTY`; interface và caller phải đổi cùng nhau. |
| `LivePodLogs.md` | Cập nhật phương án, trạng thái và test plan khi implementation thay đổi. | Tài liệu thiết kế phải khớp contract thực tế. |

### Cũng sửa để mọi menu vận hành dùng cùng cách gọi

| File | Lý do |
|---|---|
| `FCTF-ManagementPlatform/CTFd/themes/admin/templates/monitoring.html` | Menu Actions tạo bằng JavaScript hiện có `Pod Logs` và `Request Logs`; cần đổi nhãn thành `Live Pod Logs` và đặt sau `Request Logs`. |
| `FCTF-ManagementPlatform/CTFd/themes/admin/templates/contests/sections/monitoring.html` | Bản Monitoring bên trong contest cũng có menu Actions tương tự; cần đồng nhất thứ tự và nhãn. |

Không cần migration hay thay đổi schema database cho giai đoạn này. Live Pod Logs tiếp tục đọc trạng thái/live logs từ Kubernetes; dữ liệu Instance History chỉ cung cấp `challenge_id` và `owner_team_id` cho link menu.

### Test cần bổ sung

Repository hiện chưa có test chuyên biệt cho Pod Logs. Cần thêm test unit/integration tại vị trí theo test project đang dùng khi triển khai, tối thiểu bao phủ:

1. Pod Running + Ready trả `AVAILABLE`/`READY`/`AVAILABLE` và log.
2. Pod Waiting/Not Ready trả `AVAILABLE`/`NOT_READY` cùng reason; nếu log
   rỗng thì đồng thời trả `logState=EMPTY`.
3. Pod Terminated trong lúc instance `stopping` trả `AVAILABLE`/`TERMINATED`
   cùng reason.
4. Không tìm thấy Pod trả `podState=NOT_FOUND`/HTTP 404.
5. Log rỗng trả `logState=EMPTY`; Kubernetes read failure trả
   `logState=READ_FAILED`/HTTP 502.
6. DeploymentCenter không khả dụng trả `sourceState=UNAVAILABLE`/HTTP 503.
7. Mỗi row active chọn Pod ở menu Actions bằng challenge/team; màn Live Pod
   Logs không có dropdown Container hoặc `container` parameter.
8. Hai trang Instance History và hai menu Monitoring (nếu áp dụng) đều có thứ tự `Request Logs` rồi `Live Pod Logs`.
9. Mở Live Pod Logs tạo một Audit Log metadata-only; Refresh và Auto refresh
   không tạo Audit Log.
10. Một response log không vượt 1.000 dòng/256 KiB; Auto refresh không tạo
    request chồng nhau và tự tắt với `podState=TERMINATED`.

## Phạm vi triển khai giai đoạn 1

1. Trong menu **Actions** của `Instances History`, thêm `Live Pod Logs` dưới
   `Request Logs` chỉ khi lifecycle là `provisioning`, `running` hoặc
   `stopping`; shared instance truyền `team_id=-2`.
2. Tái sử dụng route `challengeHistory.get_pods_logs` và template
   `admin/challenges/pod_logs.html` hiện có.
3. Mở rộng `PodLogsDTO`/`pods-logs-api` để trả source/Pod/log state, Pod
   phase, readiness, reason an toàn và thời điểm kiểm tra; vẫn giữ trường
   `logs` tương thích.
4. Đổi tiêu đề màn hình từ `Pod Logs - Challenge ID ...` thành
   `Live Pod Logs - Challenge ID ...`.
5. Hiển thị status banner theo ba state; không dùng một thông báo chung cho
   Pod không tìm thấy, Pod chưa ready, log rỗng và lỗi hạ tầng.
6. Giữ nguyên phân quyền hiện có: admin, challenge writer và jury mới xem được.

## Hướng nâng cấp sau này (không thuộc giai đoạn 1)

Để liên kết chắc chắn với đúng Pod của một instance, **DeploymentCenter API**
cần nhận `instance_id`, sau đó dùng Pod UID/tên Pod đã lưu trong
`ChallengeInstance.Pods` để đối chiếu. Tham số `instance_id` tùy chọn ở route
CTFd giai đoạn 1 chỉ phục vụ link điều hướng và không đáp ứng mục tiêu này. Khi
đó UI có thể báo rõ `historical Pod no longer available` thay vì vô tình đọc Pod
của lần deploy mới. Việc này là thay đổi API và hành vi nên không gộp vào mục
tiêu “giữ nguyên chức năng ảnh 1”.

## Tiêu chí nghiệm thu

1. Với mọi dòng Instance History, menu Actions hiện `Request Logs`; chỉ dòng
   `provisioning`, `running` hoặc `stopping` hiện thêm `Live Pod Logs` ở dưới.
2. Với instance đang chạy và Ready của team `2`, Live Pod Logs gửi
   `challenge_id` và `team_id=2`, hiển thị
   `AVAILABLE`/`READY`/`AVAILABLE`, stdout/stderr và Refresh hoạt động.
3. Với Pod Waiting/Not Ready và Pod Terminated, UI hiển thị reason riêng;
   `logState=EMPTY` hoặc `READ_FAILED` vẫn hiện là thông tin phụ, không ghi đè
   `podState`.
4. Khi không có Pod phù hợp, UI hiển thị `podState=NOT_FOUND` cùng link sang
   Request Logs, HTTP 404, không báo đây là lỗi hệ thống.
5. Khi DeploymentCenter hoặc Kubernetes tạm không truy cập được, UI hiển thị
   `sourceState=UNAVAILABLE`/HTTP 503 và cho Retry; lỗi đọc log riêng lẻ là
   `logState=READ_FAILED`/HTTP 502.
6. Request Logs vẫn truy vấn theo `instance_id` và tiếp tục hiển thị telemetry
   sau khi Pod bị xóa.
7. Audit Log có đúng một event khi mở trang và không tăng khi người dùng
   Refresh/Auto refresh; không có raw log hoặc token trong metadata audit.
8. Response không vượt 1.000 dòng hoặc 256 KiB, UI hiển thị giới hạn này;
   Auto refresh 5/10/30/60 giây bỏ qua tick khi request trước chưa hoàn tất và
   tự chuyển Off khi Pod terminated.
