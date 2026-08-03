# Hướng dẫn cài đặt & chạy

## 1. Chuẩn bị PostgreSQL

```sql
-- Mở psql và chạy:
CREATE DATABASE golden_voice;
\c golden_voice
\i database/schema.sql
```

## 2. Tạo Google OAuth Credentials

1. Vào https://console.cloud.google.com/apis/credentials
2. Tạo project mới (hoặc chọn project có sẵn)
3. Bật **Google+ API** hoặc **People API**
4. Chọn **Create Credentials → OAuth 2.0 Client IDs**
5. Application type: **Web application**
6. Thêm Authorized redirect URI: `http://localhost:3001/api/auth/google/callback`
7. Copy **Client ID** và **Client Secret**

### Facebook Login

1. Tạo ứng dụng tại `https://developers.facebook.com/apps/`.
2. Thêm sản phẩm **Facebook Login for Business** và chọn loại ứng dụng phù hợp.
3. Trong **Valid OAuth Redirect URIs**, thêm:
   `http://localhost:3001/api/auth/facebook/callback` cho môi trường local và
   callback HTTPS của backend cho production.
4. Xin quyền `public_profile` và `email`, sau đó điền:

```env
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_GRAPH_API_VERSION=v23.0
FACEBOOK_CALLBACK_URL=http://localhost:3001/api/auth/facebook/callback
```

Khi ứng dụng Facebook còn ở Development mode, chỉ tài khoản có vai trò trong
ứng dụng mới đăng nhập được. Trước khi dùng thật, hoàn tất App Review và chuyển
ứng dụng sang Live.

### Sign in with Apple

1. Trong Apple Developer, tạo **Services ID** cho website và bật
   **Sign in with Apple**.
2. Khai báo domain và Return URL trỏ đến:
   `https://ten-mien-backend/api/auth/apple/callback`.
3. Tạo Sign in with Apple key (`.p8`) rồi lấy Team ID và Key ID.
4. Lưu file `.p8` ngoài repository, giới hạn quyền đọc cho tiến trình backend,
   sau đó điền:

```env
APPLE_CLIENT_ID=com.congty.vbee.web
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY_PATH=C:\secure\AuthKey_XXXXXXXXXX.p8
APPLE_PRIVATE_KEY=
APPLE_CALLBACK_URL=https://ten-mien-backend/api/auth/apple/callback
OAUTH_STATE_TTL_MINUTES=10
```

Apple không chấp nhận callback `localhost` hoặc HTTP. Cần domain HTTPS thật
hoặc đường hầm HTTPS để kiểm thử. Chỉ dùng một trong `APPLE_PRIVATE_KEY_PATH`
và `APPLE_PRIVATE_KEY`; không commit khóa `.p8`.

## 3. Cài đặt Backend

```bash
cd backend
copy .env.example .env
# Mở .env và điền các thông tin:
# - DB_PASSWORD, JWT_SECRET
# - VBEE_API_KEY nếu dùng Vbee STT UAT
# - hoặc SONIX_API_KEY nếu dùng Sonix.ai
# - hoặc DEEPGRAM_API_KEY nếu dùng Deepgram
# - hoặc ASSEMBLYAI_API_KEY nếu dùng AssemblyAI

npm install
npm run dev
# Backend chạy tại http://localhost:3001
```

### Bật CMS quản trị

CMS không tạo sẵn tài khoản hoặc mật khẩu quản trị. Hãy đăng ký tài khoản bình thường,
sau đó thêm đúng email vào `backend/.env` và khởi động lại backend:

```env
ADMIN_EMAILS=admin@congty.vn
SUPER_ADMIN_EMAILS=quantri@congty.vn
```

CMS V1 cũng hỗ trợ tạo Super Admin có chủ đích khi khởi tạo database. Phải điền
cả hai biến dưới đây và dùng mật khẩu tối thiểu 12 ký tự; dự án không có tài
khoản hoặc mật khẩu quản trị mặc định:

```env
ADMIN_SEED_EMAIL=quantri@congty.vn
ADMIN_SEED_PASSWORD=mat-khau-rieng-toi-thieu-12-ky-tu
PROVIDER_SECRET_KEY=chuoi-ngau-nhien-rieng-de-ma-hoa-api-key
```

### Cảnh báo quota cho quản trị viên

CMS tự tạo cảnh báo khi quota thực tế còn 20%, 5% hoặc 0%. Cảnh báo được
lưu trong PostgreSQL nên không mất khi người dùng xóa transcript. Mua thêm giờ,
nâng cấp gói hoặc bắt đầu chu kỳ mới sẽ tự đóng cảnh báo đang mở.

Để gửi email cảnh báo, cấu hình SMTP và danh sách người nhận:

```env
QUOTA_ALERT_EMAIL_ENABLED=true
QUOTA_ALERT_EMAIL_INTERVAL_SECONDS=30
QUOTA_ALERT_EMAIL_MAX_ATTEMPTS=5
QUOTA_ALERT_ADMIN_EMAILS=admin@congty.vn,vanhanh@congty.vn
```

Nếu `QUOTA_ALERT_ADMIN_EMAILS` để trống, hệ thống dùng `ADMIN_EMAILS`. Khi chưa
có SMTP, cảnh báo vẫn xuất hiện trong tab **Cảnh báo quota** của CMS.

Có thể phân tách nhiều email bằng dấu phẩy. `Super Admin` được cấp vai trò cho nhân sự
khác; `Admin` quản lý người dùng, gói và vận hành; `Support` và `Finance` chỉ thấy các
phân hệ phù hợp. Sau khi đăng nhập bằng tài khoản có quyền, mở `http://localhost:3000/admin`
hoặc chọn **Trung tâm quản trị** trong menu tài khoản.

### Chọn provider Speech to Text

Để dùng Vbee STT UAT bằng một API key, cấu hình:

```env
TRANSCRIPTION_PROVIDER=auto
TRANSCRIPTION_PROVIDER_CHAIN=vbee,assemblyai,deepgram,sonix
VBEE_API_KEY=your_vbee_api_key
VBEE_API_KEY_HEADER=X-API-Key
VBEE_API_KEY_SCHEME=
VBEE_STT_API_BASE_URL=https://uat-api.vbeelabs.ai
```

Giữ `VBEE_API_KEY_SCHEME` trống khi dùng header `X-API-Key`. Chế độ `auto`
chọn provider đầu tiên đã có khóa hợp lệ và chuyển sang provider tiếp theo khi
gặp lỗi hạ tầng, xác thực hoặc quota.

Trong `backend/.env`, đặt:

```env
TRANSCRIPTION_PROVIDER=sonix
SONIX_API_KEY=your_sonix_api_key_here
SONIX_LANGUAGE=vi
```

Lấy Sonix API key tại `https://my.sonix.ai/api`. Sonix API dùng Bearer token, upload media qua `/v1/media`, poll trạng thái `/v1/media/<id>`, rồi lấy transcript từ `/v1/media/<id>/transcript.json`.

Nếu muốn dùng Deepgram:

```env
TRANSCRIPTION_PROVIDER=deepgram
DEEPGRAM_API_KEY=your_deepgram_api_key_here
DEEPGRAM_MODEL=nova-3
DEEPGRAM_LANGUAGE=vi
DEEPGRAM_SMART_FORMAT=true
DEEPGRAM_PUNCTUATE=true
DEEPGRAM_PARAGRAPHS=true
DEEPGRAM_UTTERANCES=true
```

Deepgram API dùng header `Authorization: Token <apiKey>` và nhận file trực tiếp tại `POST https://api.deepgram.com/v1/listen`. Khi bật "nhận diện nhiều người nói" trên app, backend sẽ gửi thêm `diarize=true` hoặc `DEEPGRAM_DIARIZE_MODEL` nếu bạn cấu hình model riêng.

Nếu muốn dùng Vbee STT:

```env
TRANSCRIPTION_PROVIDER=vbee
VBEE_API_KEY=your_vbee_stt_api_key_here
VBEE_API_BASE_URL=https://api-voice-uat.vbeelabs.ai
VBEE_TRANSCRIBE_PATH=/v1/audio/transcriptions
VBEE_MODEL=chunkformer
VBEE_RESPONSE_FORMAT=json
VBEE_RESULT_PATH_TEMPLATE=/v1/transcribe/{id}
VBEE_LANGUAGE=vi
```

Vbee STT adapter gửi file dạng `multipart/form-data`, mặc định theo tài liệu Vbee Voice API: field `file`, `model=chunkformer`, `language=vi`, `response_format=json`, header `Authorization: Bearer <apiKey>`. Endpoint submit UAT là `https://api-voice-uat.vbeelabs.ai/v1/audio/transcriptions`. Bạn có thể cấu hình bằng base/path như trên, hoặc nhập full URL này vào Admin CMS > Nhà cung cấp API. Nếu response path khác mặc định, cấu hình thêm `VBEE_ID_PATH`, `VBEE_STATUS_PATH`, `VBEE_TEXT_PATH`, `VBEE_WORDS_PATH`.

### Tách vocal cho bài hát

Ở trang Tải file, chọn `Bài hát / nhạc nền` trước khi chuyển đổi. Backend dùng
Demucs để tách stem vocal rồi mới gửi file vocal sang provider speech-to-text.
Khi Demucs không chạy được, backend giữ nguyên file gốc thay vì áp bộ lọc có
thể làm méo giọng hát.

Backend kiểm tra độ tin cậy trung bình và lượng từ nhận được của transcript bài
hát. Kết quả dưới ngưỡng sẽ bị từ chối để tránh lưu văn bản do mô hình suy đoán:

```env
SONG_MIN_TRANSCRIPT_CONFIDENCE=0.7
SONG_MIN_WORDS_PER_MINUTE=18
```

Speaker diarization được tự động tắt trong chế độ bài hát vì các lớp vocal và
nhạc nền có thể bị nhận nhầm thành nhiều người nói.

```env
AUDIO_PREPROCESSING_ENABLED=true
DEMUCS_ENABLED=auto
DEMUCS_PYTHON_PATH=python
DEMUCS_MODEL=htdemucs
DEMUCS_TIMEOUT_MS=600000
```

Cài Demucs trên server:

```powershell
python -m pip install -U demucs
```

### Nhập video YouTube

Trang Tải file hỗ trợ dán một link video YouTube, đọc metadata, kiểm tra quota, lấy audio rồi đưa vào cùng hàng đợi transcript với file tải lên. Chỉ sử dụng video bạn sở hữu hoặc đã được cho phép sử dụng.

```env
YOUTUBE_IMPORT_ENABLED=true
YT_DLP_PATH=
YOUTUBE_COOKIES_FILE=
YOUTUBE_METADATA_TIMEOUT_MS=45000
YOUTUBE_DOWNLOAD_TIMEOUT_MS=600000
```

`npm install` tự cài `yt-dlp`. Máy chủ dùng Node làm JavaScript runtime và `ffmpeg-static` để trích audio. Nếu YouTube yêu cầu xác minh máy chủ, hãy xuất `cookies.txt` từ một tài khoản dịch vụ riêng, lưu ngoài repository với quyền đọc giới hạn cho tiến trình backend, rồi đặt đường dẫn tuyệt đối vào `YOUTUBE_COOKIES_FILE`. Không dùng cookies trình duyệt cá nhân và không commit file này lên Git.

### Dịch transcript sang ngôn ngữ khác

Deepgram/Vbee dùng để chuyển giọng nói thành văn bản. Nếu muốn dịch transcript sang tiếng khác như Sonix, backend gọi thêm dịch vụ dịch văn bản. Chế độ `auto` thử MyMemory trước, tự chuyển sang AssemblyAI khi MyMemory hết quota hoặc lỗi, rồi chuyển sang Google Cloud Translation nếu AssemblyAI không xử lý được.

Trong `backend/.env`:

```env
TRANSLATION_PROVIDER=auto
TRANSLATION_PROVIDER_CHAIN=mymemory,assemblyai,google-cloud-translation
ASSEMBLYAI_UNDERSTANDING_URL=https://llm-gateway.assemblyai.com/v1/understanding
ASSEMBLYAI_API_KEY=your_assemblyai_key
GOOGLE_TRANSLATE_API_URL=https://translation.googleapis.com/language/translate/v2
GOOGLE_TRANSLATE_API_KEY=your_google_cloud_translation_key
```

Với transcript do AssemblyAI tạo, backend dùng lại transcript ID để dịch. Với transcript do Vbee/Deepgram tạo, AssemblyAI cần đọc lại file âm thanh. Google Cloud Translation dịch trực tiếp transcript text và chỉ hoạt động khi có `GOOGLE_TRANSLATE_API_KEY`.

LibreTranslate có thể được thêm cuối chuỗi nếu cần:

```env
TRANSLATION_PROVIDER_CHAIN=mymemory,assemblyai,google-cloud-translation,libretranslate
LIBRETRANSLATE_API_URL=https://libretranslate.com
LIBRETRANSLATE_API_KEY=
MYMEMORY_API_URL=https://api.mymemory.translated.net
MYMEMORY_EMAIL=
```

Nếu dùng bản tự host miễn phí:

```env
LIBRETRANSLATE_API_URL=http://localhost:5000
LIBRETRANSLATE_API_KEY=
```

Trên giao diện upload/ghi âm/API, chọn `Ngôn ngữ âm thanh` và `Dịch văn bản sang`. Nếu chưa cấu hình được dịch vụ dịch, app vẫn giữ transcript gốc và báo lỗi dịch riêng.

Nếu muốn dùng provider cũ:

```env
TRANSCRIPTION_PROVIDER=assemblyai
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here
ASSEMBLYAI_TRANSLATION_ENABLED=true
ASSEMBLYAI_SPEECH_MODELS=universal-3-5-pro,universal-2
```

Khi AssemblyAI là provider chính và người dùng chọn ngôn ngữ đích, backend gửi
yêu cầu Speech Understanding Translation cùng job transcript. MyMemory chỉ còn
là fallback cho các luồng chỉ có văn bản như realtime trên trình duyệt.

Khi người dùng chọn một ngôn ngữ cụ thể, backend gửi `language_code` thay vì
tự nhận diện. Lựa chọn `Tiếng Việt + English (đa ngôn ngữ)` dùng
`universal-2`, bật tự nhận diện và code switching để giữ nguyên tiếng Việt hoặc
tiếng Anh theo từng đoạn. Ở chế độ `Bài hát / nhạc nền`, lựa chọn tự nhận diện
cũng giới hạn phạm vi dự kiến về tiếng Việt và tiếng Anh để tránh nhận nhầm
sang hệ chữ khác. Các job này ưu tiên AssemblyAI trước chuỗi provider; nếu API
không sẵn sàng, cơ chế failover hiện có mới chuyển sang provider tiếp theo.

## 4. Cài đặt & chạy Frontend

```bash
cd frontend
copy .env.example .env
# .env chỉ có 1 biến: VITE_API_URL=http://localhost:3001

npm install
npm run dev
# Frontend chạy tại http://localhost:3000
```

## 5. Luồng hoạt động

```
Trang chủ → Bấm nút → Chuyển đến /login
/login → Bấm "Đăng nhập bằng Google" → Google OAuth
       → Bấm "Facebook" → Facebook Login
       → Bấm "Apple" → Sign in with Apple
  → Danh tính mạng xã hội đã có → /dashboard
  → Danh tính mới có email xác minh → tạo tài khoản Free → /dashboard
  → Email đã thuộc phương thức khác → yêu cầu đăng nhập bằng phương thức cũ
```

## Biến môi trường Backend (.env)

| Biến | Ý nghĩa | Ví dụ |
|------|---------|-------|
| PORT | Port backend | 3001 |
| FRONTEND_URL | URL frontend | http://localhost:3000 |
| DB_HOST | Host PostgreSQL | localhost |
| DB_PORT | Port PostgreSQL | 5432 |
| DB_NAME | Tên database | golden_voice |
| DB_USER | User PostgreSQL | postgres |
| DB_PASSWORD | Password PostgreSQL | your_password |
| GOOGLE_CLIENT_ID | Google OAuth Client ID | ... |
| GOOGLE_CLIENT_SECRET | Google OAuth Client Secret | ... |
| GOOGLE_CALLBACK_URL | Google OAuth callback URL | http://localhost:3001/api/auth/google/callback |
| FACEBOOK_APP_ID | Facebook App ID | ... |
| FACEBOOK_APP_SECRET | Facebook App Secret | ... |
| FACEBOOK_CALLBACK_URL | Facebook OAuth callback URL | http://localhost:3001/api/auth/facebook/callback |
| APPLE_CLIENT_ID | Apple Services ID | com.congty.vbee.web |
| APPLE_TEAM_ID | Apple Developer Team ID | ... |
| APPLE_KEY_ID | ID của Sign in with Apple key | ... |
| APPLE_PRIVATE_KEY_PATH | Đường dẫn tuyệt đối đến khóa `.p8` | C:\secure\AuthKey_XXXXXXXXXX.p8 |
| APPLE_CALLBACK_URL | Apple callback HTTPS | https://api.example.com/api/auth/apple/callback |
| TRANSCRIPTION_PROVIDER | Provider speech-to-text hoặc chế độ tự chọn | auto, vbee, sonix, deepgram hoặc assemblyai |
| TRANSCRIPTION_PROVIDER_CHAIN | Thứ tự API chính và dự phòng, phân cách bằng dấu phẩy | vbee,assemblyai,deepgram,sonix |
| PROVIDER_FAILOVER_ENABLED | Chuyển sang API kế tiếp khi API hiện tại lỗi hạ tầng, quota hoặc xác thực | true |
| PROVIDER_RETRY_ATTEMPTS | Số lần thử tối đa trên cùng một API trước khi chuyển tiếp | 2 |
| PROVIDER_CIRCUIT_FAILURE_THRESHOLD | Số yêu cầu lỗi liên tiếp trước khi tạm ngắt API | 3 |
| PROVIDER_CIRCUIT_OPEN_SECONDS | Thời gian tạm ngắt lần đầu | 120 |
| PROVIDER_CIRCUIT_MAX_OPEN_SECONDS | Thời gian tạm ngắt tối đa khi API tiếp tục lỗi | 1800 |
| PROVIDER_CIRCUIT_PROBE_SECONDS | Thời gian khóa một job thăm dò ở trạng thái half-open | 90 |
| VBEE_API_KEY | API key Vbee, chỉ lưu ở backend | ... |
| VBEE_API_KEY_HEADER | Tên header chứa API key | X-API-Key |
| VBEE_API_KEY_SCHEME | Tiền tố key; để trống với X-API-Key |  |
| VBEE_STT_API_BASE_URL | Endpoint Vbee STT UAT | https://uat-api.vbeelabs.ai |
| VBEE_TRANSCRIBE_PATH | Path gửi file; đổi theo tài liệu API Vbee đang dùng | /stt |
| VBEE_RESULT_PATH_TEMPLATE | Path polling, dùng `{id}` cho mã job | /stt/transcripts/{id} |
| VBEE_ID_PATH | Dot path tới mã job nếu response không dùng trường mặc định | data.id |
| VBEE_STATUS_PATH | Dot path tới trạng thái job | data.status |
| VBEE_TEXT_PATH | Dot path tới văn bản kết quả | data.text |
| PROVIDER_SECRET_KEY | Khóa riêng để mã hóa API key lưu trong CMS | random_long_string |
| SONIX_API_KEY | API key Sonix.ai | your_sonix_api_key |
| SONIX_LANGUAGE | Mã ngôn ngữ Sonix | vi |
| DEEPGRAM_API_KEY | API key Deepgram | your_deepgram_api_key |
| DEEPGRAM_MODEL | Model Deepgram | nova-3 |
| DEEPGRAM_LANGUAGE | Mã ngôn ngữ Deepgram | vi |
| VBEE_API_KEY | API key Vbee STT | your_vbee_stt_api_key |
| VBEE_API_BASE_URL | Endpoint gốc Vbee STT | https://api-voice-uat.vbeelabs.ai |
| VBEE_TRANSCRIBE_PATH | Path submit file STT Vbee | /v1/audio/transcriptions |
| VBEE_MODEL | Model STT gửi lên Vbee | chunkformer |
| VBEE_RESPONSE_FORMAT | Định dạng response Vbee | json |
| VBEE_RESULT_PATH_TEMPLATE | Path poll kết quả, dùng `{id}` cho job id | /v1/transcribe/{id} |
| VBEE_TEXT_PATH | Dot path tới transcript nếu response Vbee không dùng `text`/`transcript` mặc định | data.text |
| YOUTUBE_IMPORT_ENABLED | Bật nhập một video YouTube từ URL | true |
| YOUTUBE_COOKIES_FILE | Đường dẫn tuyệt đối đến cookies.txt của tài khoản dịch vụ khi YouTube yêu cầu xác minh | C:\\secrets\\youtube-cookies.txt |
| DEEPGRAM_DETECT_LANGUAGE | Tự phát hiện ngôn ngữ thay vì dùng DEEPGRAM_LANGUAGE | false |
| TRANSLATION_PROVIDER | Provider dịch transcript | auto, google, libretranslate hoặc mymemory |
| GOOGLE_TRANSLATE_API_URL | Endpoint Google Cloud Translation | https://translation.googleapis.com/language/translate/v2 |
| GOOGLE_TRANSLATE_API_KEY | API key Google Cloud Translation | ... |
| LIBRETRANSLATE_API_URL | Endpoint dịch transcript | https://libretranslate.com |
| LIBRETRANSLATE_API_KEY | API key LibreTranslate nếu endpoint yêu cầu | ... |
| MYMEMORY_API_URL | Endpoint MyMemory fallback | https://api.mymemory.translated.net |
| MYMEMORY_EMAIL | Email MyMemory để tăng quota nếu có | your@email.com |
| ASSEMBLYAI_API_KEY | API key AssemblyAI | your_assemblyai_api_key |
| JWT_SECRET | Chuỗi bí mật cho JWT | random_long_string |
