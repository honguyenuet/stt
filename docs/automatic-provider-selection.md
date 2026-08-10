# Đặc tả: Tự động chọn API chuyển giọng nói

## Mục tiêu

Khi `TRANSCRIPTION_PROVIDER=auto`, hệ thống phải xếp hạng các API STT đang bật cho từng file trước khi gửi dữ liệu. Quyết định dựa trên yêu cầu nhận dạng và đặc điểm file, sau đó tiếp tục dùng cơ chế failover hiện có nếu API được chọn lỗi hoặc trả kết quả không đạt chất lượng.

Hệ thống không gửi thử cùng một file đến nhiều API chỉ để so sánh vì việc đó làm tăng chi phí và phạm vi chia sẻ dữ liệu.

## Hợp đồng

Đầu vào của bộ xếp hạng:

- danh sách provider theo cấu hình hiện tại;
- ngôn ngữ, chế độ `speech`/`song`, yêu cầu tách người nói và dịch;
- số người nói dự kiến, dung lượng, thời lượng và định dạng file nếu có;
- health, tỷ lệ thành công, độ trễ, chi phí và routing rule từ CMS.

Đầu ra là danh sách ổn định gồm `provider`, `score`, `rank` và `reasons`. Không chứa API key hoặc dữ liệu âm thanh. Chế độ chọn provider thủ công giữ nguyên thứ tự do quản trị viên cấu hình.

## Cấu trúc

- `backend/services/providerSelectionService.js`: chuẩn hóa profile, chấm điểm và xếp hạng thuần.
- `backend/services/transcriptionService.js`: gọi bộ xếp hạng trước vòng lặp failover và ghi lý do vào `providerAttempts`.
- `backend/services/transcriptionQueue.js`: chuyển thời lượng đã kiểm tra vào profile của job.
- `backend/tests/providerSelection.test.js`: kiểm thử hành vi xếp hạng.

## Quy tắc chính

- Tiếng Việt dạng hội thoại ưu tiên Vbee khi các tín hiệu vận hành tương đương.
- Nội dung đa ngôn ngữ, bài hát, dịch tích hợp hoặc tách người nói ưu tiên provider có năng lực tương ứng.
- File dài/lớn ưu tiên provider phù hợp xử lý media dài.
- Provider `down` bị đẩy xuống cuối; health, tỷ lệ thành công và độ trễ thực tế có trọng số cao.
- CMS rule khớp ngôn ngữ/chế độ được cộng ưu tiên nhưng không thể đưa provider `down` lên đầu.
- Mọi điểm bằng nhau giữ nguyên thứ tự cấu hình để kết quả xác định.

## Phong cách mã

CommonJS, hàm thuần, tên camelCase và không thêm dependency mới.

```js
const ranked = rankProvidersForAudio({ providers, configs, profile });
// [{ provider: "vbee", rank: 1, score: 42, reasons: ["vietnamese_speech"] }]
```

## Kiểm thử

```powershell
cd backend
npm.cmd test

cd ..\frontend
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Các ca bắt buộc: hội thoại tiếng Việt, bài hát đa ngôn ngữ, diarization, file dài/lớn, provider mất health và chế độ manual.

## Ranh giới

- Luôn: xác thực/chuẩn hóa mọi số liệu CMS và metadata file; giữ failover; không ghi secrets.
- Không tự làm: gọi thử nhiều API, đổi schema database hoặc thêm dependency.
- Không bao giờ: chọn provider đang `down` trước một provider khỏe chỉ vì chi phí thấp.

## Tiêu chí hoàn thành

- Auto mode chọn provider theo profile thay vì chỉ theo mặc định.
- Manual mode luôn đặt provider được chọn thủ công lên đầu, giữ nguyên thứ tự chain cho các provider dự phòng và chỉ dùng failover khi đã bật.
- `providerAttempts` lưu `selectionRank`, `selectionScore` và `selectionReasons`.
- Toàn bộ test, lint, build và kiểm tra runtime đạt.
