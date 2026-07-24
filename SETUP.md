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

## 3. Cài đặt Backend

```bash
cd backend
copy .env.example .env
# Mở .env và điền các thông tin:
# - DB_PASSWORD, JWT_SECRET
# - SONIX_API_KEY nếu dùng Sonix.ai
# - hoặc VBEE_API_KEY nếu dùng Vbee STT
# - hoặc DEEPGRAM_API_KEY nếu dùng Deepgram
# - hoặc ASSEMBLYAI_API_KEY nếu dùng AssemblyAI

npm install
npm run dev
# Backend chạy tại http://localhost:3001
```

### Chọn provider Speech to Text

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

Ở trang Tải file, chọn `Bài hát / nhạc nền` trước khi chuyển đổi. Backend dùng Demucs để tách stem vocal, chuẩn hóa lại bằng ffmpeg rồi mới gửi file vocal sang provider speech-to-text. Khi Demucs không chạy được, backend tự fallback sang bộ lọc ffmpeg để vẫn xử lý file.

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

Deepgram dùng để chuyển giọng nói thành văn bản. Nếu muốn dịch transcript sang tiếng khác như Sonix, backend gọi thêm dịch vụ dịch văn bản. Khuyến nghị dùng Google Cloud Translation cho nhiều ngôn ngữ.

Trong `backend/.env`:

```env
TRANSLATION_PROVIDER=auto
GOOGLE_TRANSLATE_API_URL=https://translation.googleapis.com/language/translate/v2
GOOGLE_TRANSLATE_API_KEY=your_google_cloud_translation_key
```

Nếu chưa có Google key, backend vẫn có thể fallback qua LibreTranslate/MyMemory:

```env
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
```

Khi AssemblyAI là provider chính và người dùng chọn ngôn ngữ đích, backend gửi
yêu cầu Speech Understanding Translation cùng job transcript. MyMemory chỉ còn
là fallback cho các luồng chỉ có văn bản như realtime trên trình duyệt.

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
  → Đã có tài khoản → /dashboard (đăng nhập thành công)
  → Chưa có → /register (nhập first name, last name, email, password)
              → Tạo xong → /dashboard
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
| TRANSCRIPTION_PROVIDER | Provider speech-to-text | vbee, sonix, deepgram hoặc assemblyai |
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
