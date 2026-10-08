# QLVT - Phần mềm Quản lý vật tư · Tổng quan

_Cập nhật: 07/10/2026_

Phần mềm quản lý vật tư cho Công ty CP Đầu tư Phát triển Bắc Minh (SBM): 5 kho vật tư ở 5 nhà máy, quy trình đề xuất – duyệt – báo giá – mua sắm – nhận hàng, phiếu xuất kho BM.06. Ứng dụng nằm trong hệ sinh thái SSO giống app Payroll: mở từ SSO Portal là vào được, danh sách CBCNV / phòng ban / nhà máy / chức vụ lấy từ SSO; quản trị chỉ cần tích đơn vị nào có kho.

## 1. Yêu cầu (tóm tắt từ người dùng)

- 5 kho ở 5 nhà máy. Dữ liệu tồn kho hiện có xuất từ phần mềm cũ (file `ton-kho-2026.xlsx`: 3.760 dòng, kho KHOTACO, KHONATAU, KHOSS3, KHOTG, KHONC3).
- SSO cung cấp CBCNV, bộ phận, chức vụ; chỉ cần đăng nhập SSO là dùng được.
- Đồng bộ mọi phòng ban, nhà máy từ SSO; quản trị **tích đơn vị nào có kho**. Tên nhà máy lấy từ SSO. Thủ kho, quản lý nhà máy chỉ chọn trong nhân sự của chính nhà máy đó; các phòng ban khác chỉ dùng để cấu hình duyệt, kiểm soát, mua sắm, đánh mã hoặc xem vật tư các kho.
- Quy trình phiếu đề xuất vật tư:
  1. Mỗi nhà máy có 1–2 người tổng hợp lập đề xuất.
  2. Giám đốc nhà máy xem xét → **Chờ Trưởng bộ phận xem xét**.
  3. Trình Phòng Kỹ thuật → **Chờ PKT xem xét**; TP Kỹ thuật có thể giao 1 người kiểm soát lại vật tư.
  4. TP Kỹ thuật duyệt lần 1, trình Giám đốc / Phó giám đốc phụ trách (được phân công) → **Chờ duyệt nhu cầu**.
  5. Giám đốc duyệt → **Chờ bộ phận mua sắm xác nhận phiếu**; Phòng Kế hoạch bấm đã nhận → **Đang báo giá**.
  6. TP Kế hoạch giao tối đa 3 người, mỗi người 1 báo giá cạnh tranh độc lập; có vật tư không cần báo giá cạnh tranh.
  7. Chỉ khi mọi người được giao đều gửi xong (hoặc báo không lấy thêm được) thì TP Kế hoạch **và** Giám đốc mới thấy các báo giá.
  8. TP giao 1 trong các nhân viên tổng hợp so sánh giá → **Chờ GĐ duyệt giá** (khâu này có thể trình ngoài).
  9. **Đang mua sắm** → **Chờ chuyển hàng** → nhà máy nhận hàng → **Chờ kiểm tra hàng** → **Hoàn thành**.
  - Mỗi bước có từ chối kèm lý do, đầy đủ lịch sử duyệt / từ chối.
  - Sau khi duyệt nhu cầu, tải Excel và in theo mẫu phiếu nhu cầu; ký: Người đề xuất, GĐ nhà máy, Phòng Kỹ thuật (1 người), GĐ/PGĐ phụ trách – tên tự điền.
- Giao diện vật tư: STT, mã, tên, thông số kỹ thuật, hãng/nước sản xuất, đơn vị, số lượng, tình trạng, ghi chú.
- Phân quyền: người của từng nhà máy nhập vật tư nhà máy mình; người của công ty nhập cho tất cả; quản lý mã vật tư, người đánh mã chung toàn công ty hoặc riêng từng nhà máy; phân quyền chi tiết vào cài đặt hoặc chỉ xem.
- Phiếu xuất kho: thủ kho / người được phân công lập → GĐ nhà máy duyệt → hoàn thành (mẫu BM.06).

## 2. Công nghệ

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Máy chủ | Node.js ≥ 22.13, Express 5 | Gọn, dễ triển khai trên Windows/Linux |
| CSDL | SQLite (`node:sqlite` có sẵn trong Node, không cần cài thêm) | 5 nhà máy, vài chục người dùng: đủ nhanh, sao lưu bằng 1 lệnh (`npm run backup`) |
| Giao diện | EJS render phía máy chủ + Bootstrap 5 | Không cần build, chạy tốt trên máy văn phòng |
| Excel | ExcelJS | Xuất phiếu theo mẫu, đọc file tồn kho cũ |
| SSO | SSO Portal của công ty (cùng giao thức với app Payroll) + chế độ giả lập | Xem mục 4 |

Phần SSO (`src/sso/`) bám đúng cách app Payroll (repo `danlesbm/Payroll`) đang giao tiếp với SSO Portal: xác thực token qua `introspect`, đọc danh bạ qua API nội bộ, tách họ tên khỏi chức danh trong tên SSO cùng quy tắc với Payroll.

## 3. Chức năng đã làm

### Phiếu đề xuất vật tư (`/de-xuat`)
- Lập phiếu nhiều dòng; gõ tên để tìm mã vật tư (hiện tồn kho tại nhà máy), vẫn đề xuất được vật tư chưa có mã.
- Số phiếu tự động theo nhà máy/năm: `32/PNC-TC&NC3-SBM` (ký hiệu chỉnh trong Cài đặt › kho).
- 15 trạng thái đúng quy trình, thanh tiến trình, nút xử lý chỉ hiện với người có quyền ở bước đó.
- Từ chối bắt buộc lý do: ở các bước duyệt nhu cầu → trả về người lập sửa và trình lại (giữ số phiếu); GĐ từ chối giá → về bước tổng hợp; nhà máy từ chối hàng → về Đang mua sắm.
- PKT (người được giao hoặc TP) được điều chỉnh danh sách vật tư, có ghi lịch sử.
- TP Kỹ thuật chọn GĐ/PGĐ phụ trách (mặc định theo nhà máy); chỉ người được phân công mới duyệt được.
- **Báo giá niêm phong**: tối đa 3 người (chỉnh được), mỗi người chỉ thấy báo giá của mình; TP Kế hoạch và Giám đốc chỉ thấy khi tất cả đã bấm "Hoàn thành báo giá" (người không lấy được báo giá phải ghi lý do). Lịch sử không ghi tên nhà cung cấp trước khi mở niêm phong. TP có thể yêu cầu một người báo giá lại, hoặc **kết thúc báo giá thay** người đi vắng (kèm lý do) để phiếu không bị treo. Sau khi đã mở niêm phong thì không giao thêm người báo giá mới được nữa (người mới có thể đã biết giá).
- Bảng so sánh giá tự tính thành tiền gồm VAT, tô xanh giá thấp nhất; người tổng hợp chọn nhà cung cấp từng vật tư và trình GĐ duyệt giá; hoặc TP ghi nhận "đã duyệt ngoài phần mềm" kèm tờ trình.
- Đính kèm file báo giá / tờ trình.
- Nhà máy nhận hàng, nhập số lượng thực nhận và tình trạng; tùy chọn **tự nhập kho** các vật tư có mã.
- Tải **Excel phiếu nhu cầu** theo mẫu PDF (A4 ngang) sau khi GĐ duyệt nhu cầu; tên 4 người ký tự điền. Người ký mục "Phòng Kỹ thuật – Kiểm tra" chọn trong Cài đặt (người kiểm soát hoặc TP Kỹ thuật).

### Phiếu xuất kho BM.06 (`/xuat-kho`)
- Thủ kho lập phiếu: người nhận, địa chỉ, lý do, kho, địa điểm; vật tư chọn từ kho, SL theo yêu cầu / thực xuất, tình trạng, ghi chú.
- Kiểm tra tồn khi trình; GĐ nhà máy duyệt → hoàn thành và **trừ tồn kho**; từ chối có lý do; lịch sử.
- Tải Excel đúng mẫu BM.06 (Lập phiếu / Người nhận hàng / Giám đốc nhà máy).

### Tồn kho (`/kho`) và mã vật tư (`/ma-vat-tu`)
- Danh sách tồn theo kho với đủ cột yêu cầu, tìm kiếm, phân trang, xuất Excel.
- Nhập thêm vật tư (cộng dồn số lượng nhập) hoặc sửa tồn thực tế của một dòng (ghi nhận là điều chỉnh, chặn ghi đè nếu tồn vừa thay đổi do phiếu xuất khác); sổ biến động nhập–xuất–điều chỉnh từng vật tư.
- Tổng tồn hiển thị trong danh mục mã vật tư chỉ tính các kho người dùng được quyền xem.
- **Import file tồn kho của phần mềm cũ** (giao diện hoặc lệnh), chuẩn hóa đơn vị CAI/BO/... thành Cái/Bộ/...
- Danh mục mã: mã chung toàn công ty hoặc riêng từng nhà máy; nhóm mã theo tiền tố; nút **gợi ý mã tiếp theo** (vd `1-01-00-00-02-02` → `...-007`).

### Đơn vị có kho và phân quyền (`/cai-dat`)
- **Đơn vị có kho**: bảng mọi phòng ban, nhà máy lấy từ SSO (kèm số nhân sự); tích đơn vị nào có kho thì đơn vị đó có kho, bỏ tích là ngưng kho (dữ liệu vẫn giữ, tích lại là dùng tiếp). HĐQT / Ban kiểm soát / Ban giám đốc trên SSO là đơn vị ảo, không có kho.
- Tên kho luôn theo tên đơn vị trên SSO (đổi tên trên SSO thì lần đồng bộ sau đổi theo). Đơn vị trùng tên nhà máy cũ (Tà Cọ, Nậm Công 3, Nà Tẩu, Suối Sập 3, Thoong Gót) tự lấy lại mã kho cũ (KHOTACO...) và ký hiệu số phiếu; đơn vị khác được đặt mã theo chữ đầu (vd Phòng Kế hoạch → PKH).
- **Nhân sự kho**: trang của từng kho liệt kê đúng người thuộc đơn vị đó trên SSO, tích ai là Thủ kho / GĐ nhà máy / Người tổng hợp đề xuất. "Người phụ trách" trên SSO (vd PGĐ công ty phụ trách nhà máy) không tính là nhân sự nhà máy. Nếu nhà máy chia nhiều bộ phận trên SSO thì gắn thêm bộ phận vào kho.
- Nhóm quyền có quyền vận hành kho (lập phiếu, GĐ nhà máy duyệt, nhận hàng, nhập/điều chỉnh kho, lập/duyệt phiếu xuất) gán theo kho chỉ cho người thuộc kho đó: gán cho người ngoài bị từ chối kèm lý do; người chuyển đơn vị trên SSO thì quyền ở kho cũ tự hết hiệu lực (hiện mờ, có nút bỏ). Gán toàn công ty thì không giới hạn (người của công ty nhập cho tất cả). Quyền duyệt, kiểm soát, mua sắm, đánh mã, xem gán cho người ở bất kỳ phòng ban nào.
- 20 quyền chi tiết chia nhóm; quyền theo kho hoặc toàn công ty.
- 10 nhóm quyền mặc định (Người tổng hợp đề xuất, GĐ nhà máy, Thủ kho, Người đánh mã, TP/CB Kỹ thuật, Ban Giám đốc, TP/NV Kế hoạch, Người xem); tạo/sửa nhóm tùy ý.
- Gán nhóm quyền cho người dùng theo từng nhà máy; quyền quản trị toàn hệ thống.
- Cài đặt thông tin công ty in trên phiếu, dòng "Kính gửi" và "Nơi nhận" (bản cứng / bản scan) của phiếu nhu cầu, kho (mã kho, mã kho phần mềm cũ, ký hiệu số phiếu, GĐ phụ trách), đồng bộ SSO.
- Trang Tổng quan: "Việc cần tôi xử lý", thống kê theo trạng thái và theo nhà máy.

### Kỹ thuật
- Chống CSRF cho mọi form, phiên đăng nhập lưu CSDL, cookie httpOnly, chỉ chuyển hướng trong nội bộ ứng dụng; cho SSO Portal nhúng app (`frame-ancestors`), có `/health` cho giám sát.
- 55 bài kiểm thử tự động (`npm test`): toàn bộ quy trình, niêm phong báo giá, phân quyền theo nhà máy, xuất kho trừ tồn, xuất Excel, chặn CSRF, đăng nhập qua SSO Portal (dựng SSO giả), đồng bộ danh bạ, đơn vị có kho, nhân sự kho chỉ trong nhà máy, và các bài hồi quy cho các đợt rà soát. CI GitHub Actions chạy test.
- Sao lưu: `npm run backup` tạo bản sao nhất quán của CSDL (`VACUUM INTO`, an toàn khi đang bật WAL) vào `BACKUP_DIR`; cần sao lưu kèm thư mục `UPLOAD_DIR` (tệp báo giá, tờ trình).

## 4. Kết nối SSO

Giống app Payroll, không cần sửa SSO. Khi có `SSO_BASE_URL` app chạy chế độ SSO Portal:

- **Đăng nhập**: SSO Portal mở app kèm `?token=...`; app gọi `GET {SSO_BASE_URL}/api/auth/introspect?token=...` → `{ active, user: { id, username, email, displayName, role, status } }`, tạo phiên riêng của QLVT rồi bỏ token khỏi địa chỉ. Tài khoản bị khóa trên SSO không vào được; `role = admin` trên SSO là quản trị QLVT (`SSO_ADMIN_IS_ADMIN`). Mở thẳng một trang khi chưa đăng nhập thì màn hình hướng dẫn mở lại từ SSO Portal, vào xong quay về đúng trang đó.
- **Danh bạ**: `GET {SSO_BASE_URL}/api/internal/directory` (header `X-Internal-Secret: SSO_INTERNAL_API_SECRET`) → `{ users: [{ id, name, username, email, status }], departments: [{ id, name }], assignments: [{ userId, deptId, role }] }`. Đồng bộ lúc khởi động, mỗi `SYNC_INTERVAL_MIN` phút, khi bấm "Đồng bộ ngay", khi người mới đăng nhập lần đầu, và khi SSO gọi `POST /api/internal/sync` (cùng header).
- Tên SSO dạng "Chức vụ - Họ tên" / "Họ tên - NV bộ phận" được tách lấy họ tên. Chức vụ không gắn phòng (HĐQT, Ban kiểm soát, Giám đốc / Phó GĐ) gom vào đơn vị ảo. Người có nhiều phân công: đơn vị chính là phòng ban mình là nhân sự, chức vụ là chức vụ cao nhất.
- An toàn: SSO trả về thiếu (rỗng hoặc ít hơn một nửa số đang có) thì không ngưng hoạt động ai và giữ nguyên phân công, chỉ cảnh báo. Đơn vị có kho không còn trên SSO thì cảnh báo, kho vẫn giữ.
- Cấu hình: `SSO_BASE_URL`, `SSO_INTERNAL_API_SECRET` (trùng với SSO, như Payroll), `FRAME_ANCESTORS`, `SYNC_INTERVAL_MIN`; xem `.env.example`.

Không có `SSO_BASE_URL` thì chạy SSO giả lập (màn hình đăng nhập liệt kê danh bạ mẫu, cùng định dạng danh bạ thật). Khi `NODE_ENV=production` mà chưa cấu hình SSO Portal thì app không khởi động, tránh lỡ mở chế độ giả lập. Dòng `SSO_MODE` của bản trước (`oidc`) không còn dùng: còn trong `.env` thì app báo lỗi cấu hình và không khởi động, xóa dòng đó đi.

## 5. Chạy thử

```bash
npm install
npm run seed:demo                                   # danh bạ SSO giả lập, 5 nhà máy có kho, phân quyền mẫu
npm run import:tonkho -- duong-dan/ton-kho-2026.xlsx # nạp tồn kho từ phần mềm cũ
npm start                                           # http://localhost:3000
```

Tài khoản demo: Quản trị hệ thống (toàn quyền), Quàng Văn Thư (lập phiếu Tà Cọ), Lò Văn Thìn (GĐ NM Tà Cọ), Trần Minh Khoa (TP Kỹ thuật), Phạm Văn Hảo (CB PKT), Nguyễn Văn Hùng / Lê Đắc Dần (Ban GĐ), Đỗ Thị Lan (TP Kế hoạch), Nguyễn Thị An / Vũ Đức Bình / Hoàng Văn Cường (NV Kế hoạch), Lường Thị Mai (Thủ kho Tà Cọ), Cầm Văn Sơn / Tòng Văn Phúc (Nậm Công 3); Lò Văn Thanh, Hồ Đăng Thành (Suối Sập 3), Vì Văn Long (Thoong Gót), Hà Văn Quý (Nà Tẩu) chưa được phân quyền để thử trang Nhân sự kho.

## 6. Đợt rà soát và sửa lỗi (07/10/2026)

Sau khi hoàn thiện chức năng, toàn bộ mã nguồn được rà soát lại trên 5 khía cạnh (quy trình, phân quyền, giao diện web, hạ tầng, xuất Excel) và từng lỗi được kiểm chứng lại bằng cách dựng lại tình huống. 36 lỗi đã sửa, nhóm lại như sau:

**Làm sai dữ liệu người dùng nhập**
- Form nhận hàng và form so sánh giá: khi phiếu có id vật tư là số nhỏ, thư viện phân tích form gộp thành mảng làm số lượng nhận / nhà cung cấp chọn bị gán sang dòng khác. Đã đổi tên trường thành `i<id>` và có bài kiểm thử đi qua đúng các form này.
- Ô gợi ý mã vật tư bị khung bảng che mất, không mở ở form thêm dòng mới, và giữ lại mã cũ khi người dùng gõ lại tên khác; đổi nhà máy không xóa mã riêng đã chọn.
- Nhập lại tồn kho: trước đây sửa một dòng là đặt lại số lượng, nay tách rõ "nhập thêm" (cộng dồn) và "sửa tồn thực tế" (có chặn ghi đè khi tồn vừa thay đổi).

**Lọt dữ liệu / phân quyền**
- API gợi ý vật tư trả mã riêng và tồn kho của nhà máy người dùng không có quyền.
- Tổng tồn trong danh mục mã vật tư tính cả kho người dùng không được xem.
- Tên nhà cung cấp lọt vào lịch sử phiếu khi báo giá còn niêm phong; báo giá mở niêm phong sớm khi TP bỏ giao người chưa gửi.
- Chuyển hướng sau đăng nhập có thể bị lợi dụng để đưa người dùng ra trang ngoài.

**Phiếu bị treo / lỗi 500**
- Phiếu đứng ở "Đang báo giá" khi một người được giao đi vắng: thêm thao tác "TP kết thúc báo giá thay" kèm lý do.
- Bộ lọc danh sách phiếu trả lỗi 500 với tham số lạ trên URL.
- Vật tư không cần báo giá cạnh tranh làm bước tổng hợp so sánh giá không trình được.
- Số phiếu trùng nhau giữa các nhà máy dùng chung ký hiệu (vd `PNC-TC&NC3-SBM`).
- Phiếu xuất kho có nhiều dòng cùng một vật tư không cộng dồn khi kiểm tra tồn.

**Vận hành**
- Sao lưu: SQLite bật WAL nên chép 1 file là không đủ; thêm `npm run backup` dùng `VACUUM INTO`.
- Đồng bộ SSO: nếu SSO lỗi hoặc phân trang trả về thiếu người thì trước đây ngưng hoạt động hàng loạt CBCNV; nay bỏ qua bước đó và cảnh báo.
- Đường dẫn CSDL / thư mục tệp tính theo thư mục cài đặt thay vì thư mục đang chạy lệnh.
- Tệp đính kèm quá 20MB, cookie hỏng, dữ liệu SSO lạ: báo lỗi rõ ràng thay vì lỗi hệ thống; lỗi khi lưu form giữ lại dữ liệu đã nhập.
- Excel phiếu nhu cầu và BM.06: lặp lại dòng tiêu đề khi in nhiều trang, "Nơi nhận" lấy theo cài đặt.

**Kiểm chứng lại sau khi sửa** (rà soát bản sửa theo 4 góc nhìn, phản biện từng phát hiện bằng chạy thử), sửa thêm:
- Form lập phiếu bị từ chối vì không có quyền vẫn hiện lại tồn kho của nhà máy khác.
- Import tồn kho đặt tồn về 0 khi file không có cột số lượng hoặc số lượng ghi dạng chữ không rõ nghĩa (vd "1,250"): nay từ chối cả file và chỉ rõ dòng lỗi, chưa ghi gì vào kho.
- Bấm "Lưu" 2 lần hoặc quay lại gửi lại form nhập thêm làm tồn bị cộng 2 lần: mỗi form có mã dùng một lần, nút Lưu bị khóa khi đang gửi.
- Phiếu đang chờ nhân viên báo giá hiện nhầm trong "Việc cần tôi xử lý" của TP Kế hoạch.
- Nhập thêm vào dòng tồn đang âm (dữ liệu cũ) bị chặn; đổi ký hiệu số phiếu của một nhà máy có thể làm trùng số; mã kho trùng nhau khác hoa thường; sửa mã riêng của nhà máy đã ngưng hoạt động làm mã thành mã chung; chọn mã không có thông số xóa mất chữ người dùng tự gõ; `npm run backup` khi sai đường dẫn CSDL tạo file rỗng.

**Rà soát phần kết nối SSO và đơn vị có kho** (08/10/2026), sửa thêm:
- `SSO_MODE` sai (vd `oidc` của bản trước) hoặc đặt `mock` trong khi có `SSO_BASE_URL`: app báo lỗi cấu hình thay vì lặng lẽ chạy SSO giả lập.
- Danh bạ SSO trả thiếu phân công phòng ban (lỗi, phân trang): giữ nguyên đơn vị của CBCNV thay vì làm mọi người rơi khỏi kho; người đã rời SSO bị bỏ khỏi nhân sự kho.
- Phòng ban chỉ thấy trong phân công không còn ghi đè tên phòng ban đã có; tên viết tắt (BKS, GĐ, PGĐ, NV) cạnh chữ có dấu được nhận đúng khi làm sạch tên.
- Tích kho cho đơn vị có tên gần giống nhà máy cũ (vd "Suối Sập 2", "Nậm Chiến 3") không lấy nhầm mã kho / ký hiệu số phiếu của nhà máy cũ; kho cũ khớp nhiều đơn vị thì chờ quản trị chọn.
- Gắn lại kho cũ (đang giữ tồn kho) vào đơn vị lỡ tích nhầm trước đó; đổi đơn vị thì tên kho tự đặt đổi theo; nhãn "Quản trị (SSO)" cho người là quản trị trên SSO.

## 7. Việc còn lại / cần người dùng xác nhận

- [ ] Khi triển khai: đặt `SSO_BASE_URL`, `SSO_INTERNAL_API_SECRET` giống Payroll, thêm QLVT vào danh sách ứng dụng của SSO Portal, rồi vào Cài đặt tích các đơn vị có kho và phân công nhân sự kho.
- [ ] Logo SBM trên phiếu Excel (hiện là chữ "SBM").
- [ ] Thông báo email / Zalo khi có phiếu chờ xử lý (hiện có danh sách "Việc cần tôi xử lý" trong app).
- [ ] Xuất Excel bảng so sánh giá để trình ký ngoài.
- [ ] Báo cáo nhập–xuất–tồn theo kỳ, cảnh báo tồn tối thiểu.
- [ ] Hướng dẫn triển khai lên máy chủ công ty (Windows service / Docker, HTTPS, hẹn giờ chạy `npm run backup`).
