---
name: push-project-to-github
description: "Hướng dẫn đẩy code của project hiện tại lên GitHub an toàn. Dùng khi người dùng hỏi cách push code, đồng bộ repository, chọn remote hoặc branch, đặc biệt với repository https://github.com/honguyenuet/stt.git."
argument-hint: "Nhập URL repository hoặc tên remote và branch muốn push"
user-invocable: true
---

# Đẩy Project Lên GitHub

## Khi sử dụng

- Người dùng muốn push code lên GitHub.
- Người dùng muốn thêm hoặc kiểm tra remote repository.
- Người dùng cần đồng bộ một branch local với GitHub.
- Người dùng muốn push project có backend, frontend hoặc file cấu hình môi trường.

## Quy trình

### 1. Kiểm tra repository local

Chạy các lệnh sau từ thư mục gốc project:

```powershell
git status --short --branch
git remote -v
git branch --show-current
```

Nếu thư mục chưa phải Git repository, khởi tạo trước:

```powershell
git init
```

### 2. Kiểm tra secret trước khi stage

Không commit các file như `.env`, `.env.*`, private key, token, password, database dump hoặc file upload. Kiểm tra nhanh:

```powershell
git status --short
git ls-files | Select-String -Pattern '(^|/)(\.env|.*\.pem|.*\.key)$'
```

Nếu `.env` đã từng được track, xóa khỏi index nhưng giữ file local:

```powershell
git rm --cached backend/.env
```

Sau khi secret đã từng được commit hoặc bị chia sẻ, phải rotate/revoke secret đó. Không đưa secret vào `.env.example`; chỉ dùng tên biến và giá trị mẫu không nhạy cảm.

### 3. Xác nhận remote đích

Với project này, remote đích là:

```powershell
git remote get-url stt
```

Nếu remote chưa tồn tại:

```powershell
git remote add stt https://github.com/honguyenuet/stt.git
```

Nếu `stt` trỏ sai URL, sửa sau khi xác nhận với người dùng:

```powershell
git remote set-url stt https://github.com/honguyenuet/stt.git
```

Luôn kiểm tra lại URL trước khi push. Không dùng `origin` chỉ vì đó là tên mặc định; repository này có thể có nhiều remote.

### 4. Stage và review thay đổi

```powershell
git add -A
git status --short
git diff --cached --stat
git diff --cached --name-only
```

Nếu phát hiện file secret, file build lớn, log hoặc dữ liệu cá nhân, dừng lại, cập nhật `.gitignore`, bỏ file khỏi staging rồi kiểm tra lại.

### 5. Commit thay đổi

Chỉ commit sau khi người dùng đã xem danh sách file staged:

```powershell
git commit -m "Mô tả ngắn gọn thay đổi"
```

Nếu không có thay đổi để commit, không tạo commit rỗng; chuyển sang bước push nếu commit cần push đã tồn tại.

### 6. Push đúng branch

Mặc định giữ nguyên tên branch hiện tại:

```powershell
$branch = git branch --show-current
git push -u stt $branch
```

Nếu muốn đưa code lên branch `main`, phải xác nhận rõ trước rồi dùng:

```powershell
git push stt HEAD:main
```

Không dùng `git push --force` hoặc `--force-with-lease` nếu chưa kiểm tra lịch sử remote và chưa được người dùng yêu cầu.

Nếu Git báo remote có commit mới, không ghi đè. Kiểm tra và tích hợp trước:

```powershell
git fetch stt
git log --oneline --decorate --graph HEAD..stt/<branch>
```

Sau đó chọn merge hoặc rebase theo quy ước project, xử lý conflict, chạy kiểm tra rồi push lại.

### 7. Xác minh sau khi push

```powershell
git status --short --branch
git log -1 --oneline
git ls-remote --heads stt <branch>
```

Báo cho người dùng remote, branch, commit đã push và mọi kiểm tra chưa chạy. Không khẳng định push thành công nếu lệnh trả về lỗi.

## Quy tắc hoàn tất

- URL remote đúng repository người dùng yêu cầu.
- Không có secret trong staging hoặc commit mới.
- Người dùng biết branch nào đã được push.
- Push không dùng force ngoài phạm vi được xác nhận.
- Có kết quả xác minh sau push.