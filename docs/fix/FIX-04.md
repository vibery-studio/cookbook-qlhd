# FIX-04: Drawer Phân quyền không hiện lỗi khi gửi yêu cầu (nút "chớp" rồi im)

Status: Fixed 2026-10-01

## 1. What happens vs what should
- Steps: admin → Phân quyền → drawer «Giám đốc» → tick thêm 1 quyền (vd. Xem cờ tính năng) → «Gửi yêu cầu (+1)».
- Actual: API trả 409 `no-eligible-approver` (người duy nhất khác có `roles:write` là Giám đốc, mang vai trò `giam_doc`; luật own_role cấm duyệt việc THÊM quyền cho vai trò mình đang mang; bớt quyền vẫn 201). UI: nút chớp, không thấy gì — `<Alert>` lỗi render cuối thân drawer cuộn dài, dưới checklist, ngoài màn hình. Câu chung "Không còn người nào khác…migration" cũng sai với trường hợp này.
- Expected: lỗi/"Đã lưu." luôn thấy sau thao tác (footer cố định, trên các nút); 409 khi THÊM quyền nói đúng nguyên nhân + cách gỡ — agreed where: lời bạn (báo lỗi 2026-10-01).

## 2. Failing test — before touching the code
- `roles-screen.test.tsx` › "FIX-04: 409 no-eligible-approver on ADDED permissions shows the accurate sentence in the sticky footer, not the body" → đỏ trên code cũ:
  ```
  TestingLibraryElementError: Unable to find an element by: [data-testid="role-drawer-footer"]
   Test Files  1 failed (1)
        Tests  1 failed | 16 passed (17)
  ```

## 3. Cause
- `role-drawer.tsx` đặt Alert/notice trong vùng cuộn thay vì footer cố định; và `roleError` chỉ có một câu cho `no-eligible-approver` (trường hợp "không còn ai có roles:write"), không phân biệt yêu cầu thêm quyền.

## 4. Fix + proof
- Changed: `role-drawer.tsx` — Alert + notice chuyển vào footer (`data-testid="role-drawer-footer"`) phía trên nút; lỗi field-level giữ nguyên. Khi `sendRequest` gặp `no-eligible-approver` mà yêu cầu có quyền THÊM → câu chính xác (người duyệt cần Quản lý vai trò, không phải bạn, không mang vai trò «nhãn»; bớt quyền vẫn gửi được; muốn thêm cấp Quản lý vai trò cho người thứ ba). Các trường hợp khác giữ câu chung. `problem-messages.ts` không đổi.
- Test xanh; web test 354/354 (23 file), typecheck + lint sạch.
