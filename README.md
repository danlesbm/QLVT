# QLVT - Phần mềm Quản lý vật tư

Quản lý vật tư 5 nhà máy của Công ty CP Đầu tư Phát triển Bắc Minh: phiếu đề xuất nhiều cấp duyệt, báo giá cạnh tranh niêm phong, mua sắm, nhận hàng, phiếu xuất kho BM.06, tồn kho, mã vật tư và phân quyền chi tiết. Đăng nhập qua SSO dùng chung với các app nội bộ.

```bash
npm install
npm run seed:demo        # dữ liệu demo (SSO giả lập)
npm start                # http://localhost:3000
npm test
npm run backup           # sao lưu CSDL vào BACKUP_DIR (nhớ sao lưu kèm UPLOAD_DIR)
```

Yêu cầu Node.js ≥ 22.13. Cấu hình xem `.env.example`: chạy thật thì đặt `SSO_BASE_URL` và `SSO_INTERNAL_API_SECRET` giống app Payroll (đăng nhập bằng cách mở QLVT từ SSO Portal), rồi vào Cài đặt tích các đơn vị có kho. Mô tả đầy đủ yêu cầu, chức năng và việc còn lại: [TONG-QUAN.md](TONG-QUAN.md).
