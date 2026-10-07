# QLVT - Phần mềm Quản lý vật tư · Tổng quan

_Cập nhật: 07/10/2026_

Phần mềm quản lý vật tư cho Công ty CP Đầu tư Phát triển Bắc Minh (SBM): 5 kho vật tư ở 5 nhà máy, quy trình đề xuất – duyệt – báo giá – mua sắm – nhận hàng, phiếu xuất kho BM.06. Ứng dụng nằm trong hệ sinh thái SSO giống app Payroll: đăng nhập SSO, danh sách CBCNV / bộ phận / chức vụ lấy từ SSO.

## 1. Yêu cầu (tóm tắt từ người dùng)

- 5 kho ở 5 nhà máy. Dữ liệu tồn kho hiện có xuất từ phần mềm cũ (file `ton-kho-2026.xlsx`: 3.760 dòng, kho KHOTACO, KHONATAU, KHOSS3, KHOTG, KHONC3).
- SSO cung cấp CBCNV, bộ phận, chức vụ; chỉ cần đăng nhập SSO là dùng được.
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
| CSDL | SQLite (`node:sqlite` có sẵn trong Node, không cần cài thêm) | 5 nhà máy, vài chục người dùng: đủ nhanh, sao lưu chỉ là chép 1 file |
| Giao diện | EJS render phía máy chủ + Bootstrap 5 | Không cần build, chạy tốt trên máy văn phòng |
| Excel | ExcelJS | Xuất phiếu theo mẫu, đọc file tồn kho cũ |
| SSO | Adapter OIDC + chế độ giả lập | Xem mục 4 |

Repo SSO và Payroll trên GitHub hiện gần như rỗng nên chưa có mẫu giao tiếp để bám theo. Phần SSO được viết thành adapter riêng (`src/sso/`), khi có tài liệu API của SSO chỉ cần sửa adapter, không đụng nghiệp vụ.

## 3. Chức năng đã làm

### Phiếu đề xuất vật tư (`/de-xuat`)
- Lập phiếu nhiều dòng; gõ tên để tìm mã vật tư (hiện tồn kho tại nhà máy), vẫn đề xuất được vật tư chưa có mã.
- Số phiếu tự động theo nhà máy/năm: `32/PNC-TC&NC3-SBM` (ký hiệu chỉnh trong Cài đặt > Nhà máy).
- 15 trạng thái đúng quy trình, thanh tiến trình, nút xử lý chỉ hiện với người có quyền ở bước đó.
- Từ chối bắt buộc lý do: ở các bước duyệt nhu cầu → trả về người lập sửa và trình lại (giữ số phiếu); GĐ từ chối giá → về bước tổng hợp; nhà máy từ chối hàng → về Đang mua sắm.
- PKT (người được giao hoặc TP) được điều chỉnh danh sách vật tư, có ghi lịch sử.
- TP Kỹ thuật chọn GĐ/PGĐ phụ trách (mặc định theo nhà máy); chỉ người được phân công mới duyệt được.
- **Báo giá niêm phong**: tối đa 3 người (chỉnh được), mỗi người chỉ thấy báo giá của mình; TP Kế hoạch và Giám đốc chỉ thấy khi tất cả đã bấm "Hoàn thành báo giá" (người không lấy được báo giá phải ghi lý do). Lịch sử không ghi tên nhà cung cấp trước khi mở niêm phong. TP có thể yêu cầu một người báo giá lại.
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
- Nhập thêm / điều chỉnh vật tư theo quyền từng kho; sổ biến động nhập–xuất–điều chỉnh từng vật tư.
- **Import file tồn kho của phần mềm cũ** (giao diện hoặc lệnh), chuẩn hóa đơn vị CAI/BO/... thành Cái/Bộ/...
- Danh mục mã: mã chung toàn công ty hoặc riêng từng nhà máy; nhóm mã theo tiền tố; nút **gợi ý mã tiếp theo** (vd `1-01-00-00-02-02` → `...-007`).

### Phân quyền (`/cai-dat`)
- 20 quyền chi tiết chia nhóm; quyền theo nhà máy hoặc toàn công ty.
- 10 nhóm quyền mặc định (Người tổng hợp đề xuất, GĐ nhà máy, Thủ kho, Người đánh mã, TP/CB Kỹ thuật, Ban Giám đốc, TP/NV Kế hoạch, Người xem); tạo/sửa nhóm tùy ý.
- Gán nhóm quyền cho người dùng theo từng nhà máy; quyền quản trị toàn hệ thống.
- Cài đặt thông tin công ty in trên phiếu, nhà máy (mã kho, ký hiệu số phiếu, GĐ phụ trách, bộ phận SSO thuộc nhà máy), đồng bộ SSO.
- Trang Tổng quan: "Việc cần tôi xử lý", thống kê theo trạng thái và theo nhà máy.

### Kỹ thuật
- Chống CSRF cho mọi form, phiên đăng nhập lưu CSDL, cookie httpOnly.
- 11 bài kiểm thử tự động (`npm test`): toàn bộ quy trình, niêm phong báo giá, phân quyền theo nhà máy, xuất kho trừ tồn, xuất Excel, chặn CSRF. CI GitHub Actions chạy test.

## 4. Kết nối SSO

`SSO_MODE=mock` (mặc định): màn hình đăng nhập liệt kê danh bạ mẫu để chạy thử.

`SSO_MODE=oidc`: đăng nhập OpenID Connect (Authorization Code + PKCE) và đồng bộ danh bạ định kỳ:

- `GET {SSO_DIRECTORY_URL}/departments` → `[{ id, code, name }]`
- `GET {SSO_DIRECTORY_URL}/positions` → `[{ id, code, name }]`
- `GET {SSO_DIRECTORY_URL}/employees` → `[{ id, username, full_name, email, phone, department_id, position_id }]`

(header `Authorization: Bearer SSO_DIRECTORY_TOKEN`; chấp nhận cả dạng `{ data: [...] }`, một số tên trường thay thế như `name`, `departmentId`). Cấu hình mẫu trong `.env.example`. Bộ phận SSO có mã trùng mã nhà máy được tự gán vào nhà máy đó.

## 5. Chạy thử

```bash
npm install
npm run seed:demo                                   # danh bạ SSO giả lập + phân quyền mẫu
npm run import:tonkho -- duong-dan/ton-kho-2026.xlsx # nạp tồn kho từ phần mềm cũ
npm start                                           # http://localhost:3000
```

Tài khoản demo: Quản trị hệ thống (toàn quyền), Quàng Văn Thư (lập phiếu Tà Cọ), Lò Văn Thìn (GĐ NM Tà Cọ), Trần Minh Khoa (TP Kỹ thuật), Phạm Văn Hảo (CB PKT), Nguyễn Văn Hùng / Lê Đắc Dần (Ban GĐ), Đỗ Thị Lan (TP Kế hoạch), Nguyễn Thị An / Vũ Đức Bình / Hoàng Văn Cường (NV Kế hoạch), Lường Thị Mai (Thủ kho Tà Cọ).

## 6. Việc còn lại / cần người dùng xác nhận

- [ ] **Tên đầy đủ 3 nhà máy** theo mã kho KHONATAU, KHOSS3, KHOTG (đang tạm "NMTĐ Nậm Tàu", "NMTĐ SS3", "NMTĐ TG") và ký hiệu số phiếu từng nhà máy – sửa được trong Cài đặt.
- [ ] **Thông tin API của SSO** (địa chỉ, client id, định dạng danh bạ) để chuyển sang `SSO_MODE=oidc`; nếu SSO không theo OIDC thì viết thêm adapter.
- [ ] Logo SBM trên phiếu Excel (hiện là chữ "SBM").
- [ ] Thông báo email / Zalo khi có phiếu chờ xử lý (hiện có danh sách "Việc cần tôi xử lý" trong app).
- [ ] Xuất Excel bảng so sánh giá để trình ký ngoài.
- [ ] Báo cáo nhập–xuất–tồn theo kỳ, cảnh báo tồn tối thiểu.
- [ ] Hướng dẫn triển khai lên máy chủ công ty (Windows service / Docker, HTTPS, sao lưu file CSDL).
