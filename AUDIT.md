# Audit TONKHO — 2026-09-21

Phạm vi: đọc mã nguồn, kiểm tra build production, TypeScript, lint và kiểm thử hồi quy bằng Firestore transaction double. Chưa truy cập cấu hình Vercel/Firebase/R2 đang triển khai; không đọc/ghi dữ liệu thật. Đây không phải chứng nhận hệ thống không còn lỗi.

## Lỗi đã sửa

| Mức | Lỗi và tác động | Thay đổi |
| --- | --- | --- |
| P1 | Import Firebase Auth tại module scope làm build Vercel dừng với `auth/invalid-api-key`. | Bỏ Auth không được sử dụng, khởi tạo Firestore khi cần và báo thiếu cấu hình rõ ràng. |
| P1 | Đọc rev rồi writeBatch cho phép hai người cùng rev ghi đè số lượng và tạo lịch sử trùng phiên bản. | Đọc/kiểm tra/ghi trong transaction; áp dụng cả cập nhật và xóa. |
| P1 | `/admin`, API tổng hợp, seed và xóa sản phẩm không kiểm tra đăng nhập; JWT và mật khẩu có giá trị mặc định công khai. | Thêm server layout và kiểm tra cookie cho các API này; bắt buộc cấu hình mật khẩu/secret riêng. Đây chỉ là bảo vệ tầng ứng dụng. |
| P1 | API chấp nhận số lượng âm, số thập phân, chuỗi/boolean được ép thành số và ngày không tồn tại. | Kiểm tra số nguyên dương, ngày lịch hợp lệ, rev và người thực hiện trước khi đọc/ghi lô. |
| P1 | Xuất Excel/chi tiết quản trị chỉ dựa trên 500 lô dù tổng hợp tính toàn bộ. | API lấy toàn bộ lô active cho quản trị đã đăng nhập. |
| P2 | Tạo lại cùng ID ghi đè lô, reset rev nhưng giữ lịch sử cũ. | Transaction từ chối ID đã tồn tại. |
| P2 | Tạo lô làm unit của sản phẩm thành null; tạo sản phẩm và lô không nguyên tử. | Giữ unit; tạo/cập nhật sản phẩm, lô và lịch sử trong cùng transaction. |
| P2 | Xóa lô bỏ qua rev khi không có body, xóa document nhưng để lại lịch sử mồ côi. | Yêu cầu rev/người thực hiện và xóa mềm, ghi lịch sử xóa. |
| P2 | Lọc active sau limit khiến các lô đã xóa che mất lô active cũ. | Lọc active trước rồi sắp xếp/giới hạn. |
| P2 | Mỗi lần refresh tạo thêm onSnapshot không được hủy. | React effect dọn subscription cũ trước khi đăng ký lại. |
| P2 | Các request tra mã trả về đảo thứ tự có thể hiển thị tên/lô mã A dưới mã B. | Chỉ nhận kết quả request mới nhất và xóa chi tiết cũ khi bắt đầu tra mã. |
| P2 | Đổi lô trong modal giữ file ảnh đã chọn của lô trước; đổi tên khi sửa không được lưu. | Reset file mỗi lần mở/đổi lô; tên chỉ đọc khi sửa lô. |
| P2 | R2 dùng account ID dự phòng không nhất quán, client import module chứa SDK ký upload. | Yêu cầu account ID cấu hình; tách hàm URL ảnh khỏi module R2. |

## Vấn đề còn lại

1. **P1 — Firestore công khai (`firestore.rules:5`).** `allow read, write: if true` cho phép truy cập trực tiếp để đọc, thay số lượng, xóa dữ liệu hoặc giả lịch sử. UID nhân viên hiện là localStorage và API tin thông tin client cung cấp. Chỉ chặn các API admin không khắc phục việc này. Cần chọn cơ chế xác thực nhân viên, triển khai Firebase Auth + rules theo quyền hoặc server SDK + phiên đăng nhập; không thể chỉ đổi rules sang yêu cầu auth vì API hiện dùng Web SDK không đăng nhập và realtime cũng chưa xác thực. Chưa thay rules trên dịch vụ.
2. **P1 — API ghi lô/sản phẩm và ký upload vẫn công khai.** Người ngoài có thể gửi request trực tiếp, giả tên nhân viên hoặc dùng kho ảnh. Cần cơ chế xác thực ở mục 1; đồng thời giới hạn tốc độ/khối lượng upload và chống dò mật khẩu admin. Không có rate limit bền vững trong code hiện tại.
3. **P2 — Xóa toàn bộ sản phẩm chưa nguyên tử (`FirebaseInventoryRepository.deleteProduct`).** Xóa product trước khi xóa các lô; lỗi ở batch sau có thể để dữ liệu không nhất quán. Batch lớn có giới hạn và xóa document không xóa subcollection history. Đồng thời thêm lô khi xóa sản phẩm cũng chưa được phối hợp. Cần thiết kế xóa mềm sản phẩm hoặc job xóa có khả năng tiếp tục và chính sách giữ lịch sử.
4. **P2 — Nạp mẫu nhiều lần tạo lô mới mỗi lần (`api/seed`).** Đã yêu cầu admin nhưng chưa chống nhập mẫu lặp. Không nên sử dụng API này trên kho thật.
5. **P2 — Lỗi tải dữ liệu quản trị có thể bị hiển thị như bảng trống.** `admin/page.tsx` chỉ log lỗi và bỏ qua response không OK. Cần trạng thái lỗi và retry để phân biệt kho trống với tải thất bại.
6. **P2 — Ảnh và tài nguyên.** Khi nén lỗi, upload vẫn khai báo JPEG dù file gốc có thể là PNG/HEIC; object URL preview chưa được revoke. API xem ảnh trả placeholder HTTP 200 và cache cả khi tải lỗi, có thể che mất lỗi cấu hình R2. Upload thành công rồi lưu lô thất bại có thể để ảnh mồ côi.
7. **Khả năng mở rộng.** Để lọc active trước limit mà không yêu cầu composite index mới, truy vấn hiện đọc toàn bộ lô active và sắp xếp trong bộ nhớ. Tổng hợp và xuất toàn bộ cũng đọc toàn bộ. Khi dữ liệu lớn cần index `(status, created_at)`, phân trang và quy trình export theo trang; tránh tải toàn kho trên mỗi thiết bị.
8. **Code D1 cũ chưa được API sử dụng.** `inventory-repository.ts` vẫn có lịch sử ghi ngay cả khi UPDATE không đổi dòng do rev, và softDelete không kiểm tra số dòng thay đổi. Không chuyển API sang repository này trước khi sửa/kiểm thử transaction SQL.

## Kiểm tra

- Production build với `.env.local`: đạt.
- Production build với toàn bộ `NEXT_PUBLIC_FIREBASE_*` rỗng trong môi trường tiến trình: đạt; không sửa `.env.local` và không coi đây là kiểm tra kết nối database.
- `next typegen` + `tsc --noEmit`: đạt.
- 8 kiểm thử hồi quy: đạt. Các trường hợp đồng thời dùng double mô phỏng kiểm tra xung đột/retry, chưa thay thế kiểm thử Firebase Emulator hoặc dịch vụ thật.
- Smoke test HTTP trên production server local: trang chủ 200; `/admin` chuyển hướng đăng nhập; API tổng hợp và export toàn bộ trả 401 khi chưa đăng nhập; limit và số lượng âm trả 400 trước khi truy cập database.
- Lint riêng các module Firebase/repository/validation/auth/realtime, layout admin và bộ test: đạt.
- Lint trước sửa: 37 errors, 3 warnings; còn lỗi `any`, React Hooks và scanner. Build không chạy lint nên build đạt không đồng nghĩa lint đạt.
- Chưa kiểm thử camera trên điện thoại, upload R2 thật, tải Excel trong trình duyệt hoặc deploy lên Vercel.

## Cấu hình triển khai

Làm theo README và `.env.example`. Firebase public config phải có trước build; ADMIN_PASSWORD/ADMIN_JWT_SECRET và R2 credentials chỉ ở môi trường server. Redeploy sau khi cập nhật. Báo cáo dựa trên ảnh lỗi do người dùng cung cấp; chưa xác minh API key nào đang được Vercel sử dụng.
