# Vbee API Integration

Tài liệu tích hợp public API Vbee Voice

## 1. Môi trường

| Môi trường | Base URL | Swagger | OpenAPI JSON |
|---|---|---|---|
| UAT | `https://api-voice-uat.vbeelabs.ai` | [UAT Swagger](https://api-voice-uat.vbeelabs.ai/docs) | [UAT OpenAPI](https://api-voice-uat.vbeelabs.ai/openapi.json) |
| Production | `https://api-voice.vbeelabs.ai` | [Production Swagger](https://api-voice.vbeelabs.ai/docs) | [Production OpenAPI](https://api-voice.vbeelabs.ai/openapi.json) |
| Local | `http://localhost:8618` | [Local Swagger](http://localhost:8618/docs) | [Local OpenAPI](http://localhost:8618/openapi.json) |



```ts
export const vbeeConfig = {
  baseUrl:
    import.meta.env.VITE_VBEE_API_BASE_URL ??
    "https://api-voice-uat.vbeelabs.ai",
};
```

Base URL không có dấu `/` ở cuối.

## 2. Xác thực và bảo mật

Mọi business API thuộc `/v1/*` và `/api/v1/*` đều yêu cầu:

```http
Authorization: Bearer <VBEE_API_KEY>
```

Các endpoint không yêu cầu API key:

- `GET /health`
- `GET /docs`
- `GET /openapi.json`
- CORS preflight `OPTIONS`

Public API nghĩa là API có thể truy cập qua Internet, không có nghĩa là API cho
phép gọi ẩn danh. Request thiếu key hoặc key sai trả `401 Unauthorized`.

Trong Swagger, bấm **Authorize** và nhập trực tiếp giá trị key; không tự thêm chữ
`Bearer` vì Swagger sẽ thêm scheme này vào header.

Kiểm tra nhanh UAT:

```bash
export VBEE_API_BASE_URL="https://api-voice-uat.vbeelabs.ai"
export VBEE_API_KEY="<uat-api-key>"

curl "$VBEE_API_BASE_URL/health"
curl "$VBEE_API_BASE_URL/v1/models" \
  -H "Authorization: Bearer $VBEE_API_KEY"
```

### Request helper cho Node.js/BFF

```ts
const VBEE_API_BASE_URL = process.env.VBEE_API_BASE_URL!;
const VBEE_API_KEY = process.env.VBEE_API_KEY!;

export function vbeeFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${VBEE_API_KEY}`);
  return fetch(`${VBEE_API_BASE_URL}${path}`, {...init, headers});
}
```

Không tự đặt `Content-Type` khi gửi `FormData`; runtime sẽ tự thêm multipart
boundary.

## 3. Danh sách endpoint

| Method | Endpoint | Chức năng | Auth |
|---|---|---|---|
| `GET` | `/health` | Kiểm tra trạng thái API/GPU | Không |
| `GET` | `/v1/models` | Danh sách model TTS và ASR | Bearer |
| `GET` | `/v1/models/{model_id}` | Chi tiết một model | Bearer |
| `POST` | `/v1/audio/speech` | Text-to-Speech, binary hoặc SSE | Bearer |
| `POST` | `/api/v1/tts` | Tạo một request TTS bất đồng bộ | Bearer |
| `GET` | `/api/v1/tts/{request_id}` | Poll trạng thái và lấy kết quả | Bearer |
| `GET` | `/api/v1/tts/{request_id}/callback-result` | Kết quả các lần gửi callback | Bearer |
| `GET` | `/api/v1/tts/{request_id}/audio` | Tải audio kết quả | Bearer |
| `POST` | `/v1/audio/transcriptions` | Speech-to-Text từ file | Bearer |
| `GET` | `/api/v1/asr/models` | Catalog ASR và capability streaming | Bearer |
| `WebSocket` | `/api/v1/asr/stream` | Streaming PCM16 cho mọi model ASR | Bearer/start frame |
| `GET` | `/api/v1/voices` | Danh sách voice | Bearer |
| `POST` | `/api/v1/voices` | Upload/clone voice | Bearer |
| `PATCH` | `/api/v1/voices/{voice_id}` | Cập nhật transcript voice | Bearer |
| `GET` | `/api/v1/voices/{voice_id}/audio` | Audio tham chiếu của voice | Bearer |
| `DELETE` | `/api/v1/voices/{voice_id}` | Xóa voice | Bearer |
| `GET` | `/api/v1/history` | Danh sách history native | Bearer |
| `DELETE` | `/api/v1/history/{history_id}` | Xóa một history item | Bearer |
| `DELETE` | `/api/v1/history` | Xóa toàn bộ history | Bearer |

Ưu tiên API tương thích OpenAI cho TTS trực tiếp, ASR file và model. Dùng
`/api/v1/tts` khi cần xử lý bất đồng bộ/callback; các API native còn lại dành cho voice CRUD,
realtime ASR và history.

## 4. Health check

### `GET /health`

```bash
curl https://api-voice-uat.vbeelabs.ai/health
```

Response rút gọn:

```json
{
  "status": "ok",
  "provider_ready": true,
  "worker_alive": true,
  "worker_count": 10,
  "max_concurrent_tts_jobs": 10,
  "queue_depth": 0,
  "loaded": {
    "omnivoice": true,
    "voxcpm2": true
  }
}
```

Ý nghĩa các field cần dùng:

| Field | Ý nghĩa |
|---|---|
| `status` | API process đang hoạt động |
| `provider_ready` | Có backend inference sẵn sàng nhận request |
| `worker_alive` | Có worker xử lý đang sống |
| `queue_depth` | Số job đang chờ |
| `loaded` | Trạng thái model backend |

Chỉ bật thao tác TTS khi `provider_ready === true`. Trong lúc model khởi động,
`/health` vẫn có thể trả `200` nhưng `provider_ready` là `false`.

## 5. Models

### `GET /v1/models`

Luôn gọi endpoint này thay vì hardcode model. Catalog hiện tại có thể gồm:

- TTS: `Vbee2-pro`, `Vbee2-Medium`, `Vbee2-flash`, `Vbee1`.
- ASR batch: `chunkformer`, `gipformer`, `nvidia/nemotron-3.5-asr-streaming-0.6b`.
- ASR WebSocket: cả ba model; Nemotron là stateful, ChunkFormer/GipFormer dùng WAV tích lũy.

Gọi thêm `GET /api/v1/asr/models` để lấy `supports_batch` và
`supports_streaming`; không suy capability từ tên model.

```bash
curl "$VBEE_API_BASE_URL/v1/models" \
  -H "Authorization: Bearer $VBEE_API_KEY"
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "Vbee2-pro",
      "object": "model",
      "created": 1784700000,
      "owned_by": "vbee"
    }
  ]
}
```

### `GET /v1/models/{model_id}`

Trả một object model. `model_id` không tồn tại hoặc đang tắt trả `404` với
`error.code = "model_not_found"`.

## 6. Text-to-Speech

### `POST /v1/audio/speech`

Request sử dụng `application/json`.

| Field | Kiểu | Bắt buộc | Mặc định | Mô tả |
|---|---|---:|---|---|
| `model` | `string` | Có | — | ID lấy từ `/v1/models`, ví dụ `Vbee2-pro` |
| `input` | `string` | Có | — | Văn bản cần tổng hợp, không được rỗng |
| `voice` | `string` hoặc `{ "id": string }` | Có | — | `voice_id` lấy từ `/api/v1/voices` |
| `response_format` | `string` | Không | `mp3` | `mp3`, `opus`, `aac`, `flac`, `wav`, `pcm` |
| `speed` | `number` | Không | `1.0` | Từ `0.25` đến `4.0` |
| `pitch` | `number` | Không | `1.0` | Từ `0.8` đến `1.2`, không đổi speed yêu cầu |
| `stream_format` | `string` | Không | `audio` | `audio` hoặc `sse` |
| `instructions` | `string` | Không | `null` | Chấp nhận để tương thích client; style lấy theo voice |

### 6.1. Nhận binary audio

```bash
curl "$VBEE_API_BASE_URL/v1/audio/speech" \
  -H "Authorization: Bearer $VBEE_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "Vbee2-pro",
    "input": "Xin chào từ Vbee.",
    "voice": "hien_-_nu_truyen_cam",
    "response_format": "mp3",
    "speed": 1.0,
    "pitch": 1.0,
    "stream_format": "audio"
  }' \
  --output speech.mp3
```

Ví dụ JavaScript/TypeScript:

```ts
const response = await vbeeFetch("/v1/audio/speech", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({
    model: "Vbee2-pro",
    input: "Xin chào từ Vbee.",
    voice: "hien_-_nu_truyen_cam",
    response_format: "mp3",
    speed: 1,
    pitch: 1,
    stream_format: "audio",
  }),
});

if (!response.ok) {
  const body = await response.json();
  throw new Error(body.error?.message ?? `HTTP ${response.status}`);
}

const audioBlob = await response.blob();
const audioUrl = URL.createObjectURL(audioBlob);
audioElement.src = audioUrl;
```

Response `200` là binary audio, không phải JSON. Các header đáng chú ý:

- `Content-Type`: phụ thuộc `response_format`.
- `X-Vbee-Model`: model thực tế đã xử lý request.
- `X-Accel-Buffering: no`: yêu cầu reverse proxy không buffer response.

`stream_format: "audio"` cho phép server truyền binary theo từng chunk. Tuy nhiên,
`await response.blob()` vẫn đợi tải xong toàn bộ audio mới phát. Muốn phát ngay
trên browser, dùng SSE PCM ở phần tiếp theo.

### 6.2. Streaming SSE PCM

Gửi:

```json
{
  "model": "Vbee2-flash",
  "input": "Nội dung cần phát streaming.",
  "voice": "hien_-_nu_truyen_cam",
  "response_format": "pcm",
  "stream_format": "sse",
  "speed": 1.0,
  "pitch": 1.0
}
```

Response có `Content-Type: text/event-stream`. Đây là `POST` có JSON body và
Bearer header, vì vậy phải dùng `fetch()` + `ReadableStream`, không dùng
`EventSource`.

Audio chunk:

```text
data: {"type":"speech.audio.delta","audio":"<base64>","format":"pcm","sample_rate":24000}

```

Kết thúc:

```text
data: {"type":"speech.audio.done","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}

```

Frontend cần:

1. Đọc stream và tách event theo hai ký tự xuống dòng `\n\n`.
2. Parse phần sau `data:` thành JSON.
3. Với `speech.audio.delta`, decode Base64 thành PCM16 little-endian.
4. Dùng đúng `sample_rate` của event để tạo `AudioBuffer`.
5. Xếp các buffer liên tiếp trên một `AudioContext`, không phát từng chunk độc lập.
6. Chỉ đánh dấu hoàn tất khi nhận `speech.audio.done`.

Nếu event có object `error`, dừng phát và hiển thị `error.message`. Nếu người dùng
hủy, gọi `AbortController.abort()` và đóng các audio source đang chờ.

## 7. Batch TTS, Callback và Get Request

Nhóm API này cung cấp cơ chế Batch API bất đồng bộ tương tự luồng
[Vbee Text-to-Speech](https://api-docs.vbee.vn/vbee-api/text-to-speech): client tạo
request, nhận `request_id` ngay, sau đó nhận callback hoặc chủ động poll kết quả.
Mỗi request chỉ chứa một trường nội dung `text`. Luồng này không thay thế
`/v1/audio/speech`; hãy dùng khi không muốn giữ HTTP connection trong suốt thời
gian inference.

### 7.1. Trạng thái

| Status | Ý nghĩa |
|---|---|
| `QUEUED` | Đã nhận request, đang chờ worker |
| `IN_PROGRESS` | Worker đang xử lý request |
| `SUCCESS` | Tạo audio thành công |
| `FAILURE` | Tạo audio thất bại |

`SUCCESS` và `FAILURE` là trạng thái kết thúc.

### 7.2. Create speech request

#### `POST /api/v1/tts`

API trả `202 Accepted`; inference tiếp tục chạy nền sau khi response đã kết thúc.
Request chỉ nhận một nội dung qua trường `text`; `input_text` và `sentences` không
thuộc schema và sẽ bị từ chối với `422`.

Các field dùng chung:

| Field | Bắt buộc | Mặc định | Mô tả |
|---|---:|---|---|
| `app_id` | Không | `null` | ID do hệ thống tích hợp tự quản lý, chỉ dùng làm metadata |
| `response_type` | Không | `indirect` | Hiện chỉ hỗ trợ `indirect` |
| `callback_url` | Không | `null` | Webhook HTTPS nhận kết quả cuối; bỏ trống nếu chỉ polling |
| `text` | Có | — | Nội dung cần chuyển thành giọng nói |
| `voice_code` | Có | — | `voice_id` lấy từ `/api/v1/voices` |
| `model` | Không | `Vbee2-pro` | Model dùng để tổng hợp audio |
| `audio_type` | Không | `mp3` | `mp3` hoặc `wav` |
| `bitrate` | Không | `128` | Bitrate MP3 theo kbps: `8`, `16`, `32`, `64`, `128` |
| `speed_rate` | Không | `1.0` | Từ `0.25` đến `4.0` |
| `pitch` | Không | `1.0` | Từ `0.8` đến `1.2` |

Nội dung của một request tối đa mặc định 1.000.000 ký tự.

```bash
curl "$VBEE_API_BASE_URL/api/v1/tts" \
  -H "Authorization: Bearer $VBEE_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "app_id": "news-service",
    "response_type": "indirect",
    "callback_url": "https://backend.example.com/webhooks/vbee-tts",
    "text": "Xin chào từ Batch API.",
    "voice_code": "hien_-_nu_truyen_cam",
    "model": "Vbee2-pro",
    "audio_type": "mp3",
    "bitrate": 128,
    "speed_rate": 1.0,
    "pitch": 1.0
  }'
```

Response:

```json
{
  "status": 1,
  "result": {
    "app_id": "news-service",
    "request_id": "2a5eeaf2-b55a-4a10-9cc6-42fb52f2d16d",
    "characters": 40,
    "status": "QUEUED",
    "progress": 0,
    "created_at": "2026-07-22T10:30:00.000Z",
    "started_at": null,
    "completed_at": null,
    "voice_code": "hien_-_nu_truyen_cam",
    "model": "Vbee2-pro",
    "audio_type": "mp3",
    "bitrate": 128,
    "speed_rate": 1.0,
    "pitch": 1.0,
    "sample_rate": null,
    "audio_duration": null,
    "audio_size": null,
    "audio_link": null,
    "audio_expired": false,
    "error_message": null
  }
}
```

Worker có thể nhận job rất nhanh nên response ban đầu cũng có thể đã chuyển sang
`IN_PROGRESS` hoặc một trạng thái kết thúc.

Response được làm phẳng vì mỗi request chỉ có một `text`; API không trả mảng
`results`, các bộ đếm item hoặc `item_id`.

### 7.3. Get Request

#### `GET /api/v1/tts/{request_id}`

```bash
curl "$VBEE_API_BASE_URL/api/v1/tts/$REQUEST_ID" \
  -H "Authorization: Bearer $VBEE_API_KEY"
```

Khi hoàn tất:

```json
{
  "status": 1,
  "result": {
    "request_id": "2a5eeaf2-b55a-4a10-9cc6-42fb52f2d16d",
    "status": "SUCCESS",
    "progress": 100,
    "voice_code": "hien_-_nu_truyen_cam",
    "model": "Vbee2-pro",
    "audio_type": "mp3",
    "bitrate": 128,
    "speed_rate": 1.0,
    "pitch": 1.0,
    "sample_rate": 24000,
    "audio_duration": 3.42,
    "audio_size": 82144,
    "audio_link": "https://api-voice-uat.vbeelabs.ai/api/v1/tts/2a5eeaf2-b55a-4a10-9cc6-42fb52f2d16d/audio",
    "audio_expired": false,
    "error_message": null
  }
}
```

Polling khuyến nghị mỗi 1-2 giây và tăng dần khoảng chờ nếu nội dung dài. Dừng poll
khi gặp trạng thái kết thúc. Request không tồn tại hoặc đã hết retention trả `404`.

`audio_link` yêu cầu cùng Bearer header. Mặc định request và file audio được
giữ 72 giờ; đây là link API được bảo vệ chứ không phải URL public có chữ ký.

### 7.4. Callback API

Nếu có `callback_url`, sau khi request kết thúc Vbee gửi `POST` với
`Content-Type: application/json`. Payload có cùng dữ liệu với Get Request và thêm
event:

```json
{
  "event": "tts.completed",
  "app_id": "news-service",
  "request_id": "2a5eeaf2-b55a-4a10-9cc6-42fb52f2d16d",
  "status": "SUCCESS",
  "progress": 100,
  "audio_link": "https://api-voice-uat.vbeelabs.ai/api/v1/tts/2a5eeaf2-b55a-4a10-9cc6-42fb52f2d16d/audio",
  "audio_expired": false,
  "audio_duration": 3.42,
  "audio_size": 82144,
  "error_message": null
}
```

Header callback:

| Header | Mô tả |
|---|---|
| `Idempotency-Key` | Bằng `request_id`; dùng để loại callback trùng |
| `X-Vbee-Event` | `tts.completed` |
| `X-Vbee-Request-Id` | ID request |
| `X-Vbee-Timestamp` | Unix timestamp lúc ký callback |
| `X-Vbee-Signature` | `sha256=<HMAC_HEX>` |

Chữ ký được tạo bằng:

```text
HMAC_SHA256(VBEE_API_KEY, X-Vbee-Timestamp + "." + raw_request_body)
```

Phải xác minh trên raw body trước khi parse JSON và dùng so sánh constant-time.
Ví dụ Node.js:

```ts
import crypto from "node:crypto";

function verifyVbeeCallback(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
) {
  const expected = `sha256=${crypto
    .createHmac("sha256", process.env.VBEE_API_KEY!)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex")}`;
  const received = Buffer.from(signature);
  const calculated = Buffer.from(expected);
  return (
    received.length === calculated.length &&
    crypto.timingSafeEqual(received, calculated)
  );
}
```

Callback receiver phải trả HTTP `2xx` nhanh sau khi đã lưu event. Hệ thống mặc
định thử tối đa 3 lần, exponential backoff từ 1 giây khi gặp lỗi mạng, `408`,
`429` hoặc `5xx`. Các `4xx` khác không retry.

Delivery có semantics **at least once**: callback có thể đến nhiều lần nếu server
nhận callback đã xử lý nhưng response bị mất. Luôn deduplicate bằng `request_id`
hoặc `Idempotency-Key`.

Để chống SSRF, `callback_url` mặc định phải dùng HTTPS, resolve tới địa chỉ public
và redirect không được follow. Callback tới localhost/private network chỉ có thể
bật riêng bằng `batch_tts.allow_private_callback_urls = true` trong môi trường
local cô lập.

### 7.5. Get Callback Result

#### `GET /api/v1/tts/{request_id}/callback-result`

Endpoint cho biết callback đang chờ, đã thành công hay thất bại và chi tiết từng
lần gửi:

```json
{
  "status": 1,
  "result": {
    "request_id": "2a5eeaf2-b55a-4a10-9cc6-42fb52f2d16d",
    "callback_url": "https://backend.example.com/webhooks/vbee-tts",
    "status": "SUCCESS",
    "completed_at": "2026-07-22T10:31:10.000Z",
    "attempts": [
      {
        "attempt": 1,
        "created_at": "2026-07-22T10:31:10.000Z",
        "status_code": 200,
        "response": "OK",
        "error": null
      }
    ]
  }
}
```

Request không truyền `callback_url` trả `404` ở endpoint này. Kết quả callback
không làm thay đổi trạng thái TTS: audio vẫn có thể `SUCCESS` ngay cả khi callback
gửi thất bại.

Batch state được lưu bằng SQLite và job `QUEUED`/`IN_PROGRESS` được đưa lại vào
hàng đợi khi API process khởi động lại. Deployment API hiện giới hạn một
process/replica; nếu mở rộng nhiều replica độc lập, cần chuyển store/queue sang
database và message broker dùng chung. Callback dùng pool worker riêng nên thời
gian timeout/retry webhook không chiếm worker synthesis.

## 8. Speech-to-Text từ file

### `POST /v1/audio/transcriptions`

Request sử dụng `multipart/form-data`.

| Field | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---:|---|---|
| `file` | file | Có | — | Tối đa `100 MB` |
| `model` | `string` | Có | — | Một model có `supports_batch=true` trong catalog ASR |
| `language` | `string` | Không | Theo model | ChunkFormer/GIPFormer: `vi`; Nemotron: `vi`, `vi-VN`, `auto` |
| `response_format` | `string` | Không | `json` | `json`, `text`, `verbose_json`, `srt`, `vtt` |
| `prompt` | `string` | Không | — | Nhận để tương thích, hiện chưa tác động inference |
| `temperature` | `number` | Không | `0` | Từ `0` đến `1`, hiện chưa tác động inference |
| `stream` | `boolean` | Không | `false` | Upload multipart luôn là batch; realtime dùng WebSocket bên dưới |

File hỗ trợ: `wav`, `mp3`, `flac`, `m4a`, `mp4`, `mpeg`, `mpga`, `ogg`, `webm`.
`diarized_json` và `timestamp_granularities` hiện chưa được hỗ trợ và trả `400`.

```bash
curl "$VBEE_API_BASE_URL/v1/audio/transcriptions" \
  -H "Authorization: Bearer $VBEE_API_KEY" \
  -F "file=@recording.wav" \
  -F "model=chunkformer" \
  -F "language=vi" \
  -F "response_format=json"
```

```json
{
  "text": "Nội dung nhận dạng được."
}
```

Ví dụ JavaScript/TypeScript:

```ts
const form = new FormData();
form.append("file", audioFile);
form.append("model", "chunkformer");
form.append("language", "vi");
form.append("response_format", "json");

const response = await vbeeFetch("/v1/audio/transcriptions", {
  method: "POST",
  body: form,
});

const result = await response.json();
if (!response.ok) {
  throw new Error(result.error?.message ?? `HTTP ${response.status}`);
}
console.log(result.text);
```

## 9. Realtime ASR

### `WebSocket /api/v1/asr/stream`

Input luôn là mono signed PCM 16-bit
little-endian ở 16 kHz và frame binary có thể có kích thước bất kỳ.

Frame đầu tiên là JSON text:

```json
{
  "type": "session.start",
  "model": "chunkformer",
  "language": "vi-VN",
  "encoding": "pcm_s16le",
  "sample_rate": 16000,
  "update_interval_ms": 500
}
```

`model` nhận `chunkformer`, `gipformer` hoặc
`nvidia/nemotron-3.5-asr-streaming-0.6b`. `update_interval_ms` (500–30000) nên đặt là 500, chỉ
điều khiển chu kỳ WAV snapshot của hai model cumulative; Nemotron cập nhật theo
độ trễ native của model.

Sau `session.started`, gửi các frame binary PCM liên tục. Khi hết audio, gửi:

```json
{"type":"input_audio_buffer.commit"}
```

Server trả các event JSON text theo thứ tự:

- `session.started`: model, encoding, sample rate, `streaming_mode` và độ trễ/chu kỳ cập nhật.
- `transcript.partial`: `text` đầy đủ từ đầu phiên đến snapshot hiện tại, `is_partial=true`.
- `transcript.final`: transcript đã chốt, thời lượng audio và thời gian xử lý.
- `session.done`: phiên đã giải phóng.
- `error`: `code` và `message`; kết nối được đóng khi lỗi không thể phục hồi.

Python client tối giản:

```python
import asyncio
import json
import wave

from websockets.asyncio.client import connect


async def main():
    async with connect(
        "ws://localhost:8618/api/v1/asr/stream",
        additional_headers={"Authorization": "Bearer local-key"},
    ) as ws:
        await ws.send(json.dumps({
            "type": "session.start",
            "model": "nvidia/nemotron-3.5-asr-streaming-0.6b",
            "language": "vi-VN",
            "encoding": "pcm_s16le",
            "sample_rate": 16000,
        }))
        print(json.loads(await ws.recv()))  # session.started

        with wave.open("mono-16k.wav", "rb") as audio:
            assert audio.getnchannels() == 1
            assert audio.getsampwidth() == 2
            assert audio.getframerate() == 16000
            while chunk := audio.readframes(3200):  # 200 ms
                await ws.send(chunk)

        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        async for raw_event in ws:
            event = json.loads(raw_event)
            print(event)
            if event["type"] == "session.done":
                break


asyncio.run(main())
```

Client phải thay toàn bộ transcript hiện tại bằng `event.text`, không nối thêm
text giữa các event partial. Khi `segment_finalized=true`, `stable_text` chứa các
đoạn đã chốt và `segment_index` cho biết chỉ số đoạn vừa xử lý.

`nemotron_lookahead_tokens` trong `config.toml` chọn độ trễ/chất lượng:
`0/3/6/13` tương ứng khoảng `80/320/560/1120 ms`. Cấu hình mặc định là `6`.
Mỗi phiên bị giới hạn bởi `streaming_max_session_seconds`. Phiên Nemotron đồng
thời bị giới hạn bởi `nemotron_max_streams`; ChunkFormer/GipFormer dùng
`batch_streaming_max_streams`, `batch_streaming_interval_seconds` và các cấu hình
`streaming_segment_*` cho policy 10/20/30 giây.

## 10. Voice library

### 10.1. Danh sách voice

#### `GET /api/v1/voices`

```json
{
  "count": 1,
  "voices": [
    {
      "voice_id": "hien_-_nu_truyen_cam",
      "name": "Hiền - Nữ truyền cảm",
      "gender": "female",
      "language": "vi",
      "style": "truyền cảm",
      "description": null,
      "ref_text": "...",
      "enhanced": false,
      "voxcpm2_ready": true,
      "audio_url": "https://api-voice-uat.vbeelabs.ai/api/v1/voices/hien_-_nu_truyen_cam/audio"
    }
  ]
}
```

Dùng `voice_id` cho field `voice` của `/v1/audio/speech`. Không hardcode toàn bộ
danh sách voice vì thư viện có thể thay đổi.

`audio_url` cũng là business API và yêu cầu Bearer header. Thẻ
`<audio src="...">` không cho gắn Authorization header; hãy tải bằng `fetch`, đổi
response thành `Blob`, sau đó dùng `URL.createObjectURL(blob)`.

### 10.2. Upload/clone voice

#### `POST /api/v1/voices`

Request `multipart/form-data`:

| Field | Bắt buộc | Mặc định | Mô tả |
|---|---:|---|---|
| `name` | Có | — | Tên voice; server sinh `voice_id` an toàn |
| `audio` | Có | — | File audio tham chiếu |
| `gender` | Không | `unspecified` | Giới tính/nhãn metadata |
| `language` | Không | `vi` | Ngôn ngữ |
| `style` | Không | `null` | Phong cách đọc |
| `description` | Không | `null` | Mô tả |
| `ref_text` | Không | `null` | Transcript đúng với audio tham chiếu |
| `enhance_audio` | Không | `false` | Khử nhiễu trước khi lưu |
| `infer_ref_text_if_empty` | Không | `true` | Tự ASR khi không truyền `ref_text` |

```ts
const form = new FormData();
form.append("name", "Giọng demo");
form.append("audio", audioFile);
form.append("language", "vi");
form.append("ref_text", referenceText);
form.append("infer_ref_text_if_empty", "true");

const response = await vbeeFetch("/api/v1/voices", {
  method: "POST",
  body: form,
});
const result = await response.json();
```

Response thành công:

```json
{
  "status": "ok",
  "voice": {
    "voice_id": "giong_demo",
    "name": "Giọng demo",
    "ref_text": "..."
  }
}
```

Upload có thể mất thời gian do server chuẩn hóa audio, chạy ASR và chuẩn bị voice.
Không retry mù request upload sau timeout; trước tiên gọi lại danh sách voice để
kiểm tra voice đã được tạo hay chưa.

### 10.3. Cập nhật transcript

#### `PATCH /api/v1/voices/{voice_id}`

```json
{
  "ref_text": "Transcript tham chiếu mới"
}
```

`ref_text` tối đa `20.000` ký tự. Response trả `status` và object `voice` đã cập
nhật.

### 10.4. Lấy audio tham chiếu

#### `GET /api/v1/voices/{voice_id}/audio`

Response là binary audio. Ví dụ:

```ts
const response = await vbeeFetch(
  `/api/v1/voices/${encodeURIComponent(voiceId)}/audio`,
);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
audioElement.src = URL.createObjectURL(await response.blob());
```

### 10.5. Xóa voice

#### `DELETE /api/v1/voices/{voice_id}`

```json
{
  "status": "ok",
  "deleted": "giong_demo"
}
```

Xóa voice không thể hoàn tác. Sau thao tác upload, update hoặc delete, tải lại
`GET /api/v1/voices`.

## 11. History

| Method | Endpoint | Chức năng |
|---|---|---|
| `GET` | `/api/v1/history` | Lấy danh sách history |
| `DELETE` | `/api/v1/history/{history_id}` | Xóa một item và file audio |
| `DELETE` | `/api/v1/history` | Xóa toàn bộ item và file audio |

Luồng `/v1/audio/speech` không tự tạo history. Nếu chỉ dùng API tương thích
OpenAI, ứng dụng nên tự quản lý history trong database của mình và có thể bỏ qua
toàn bộ nhóm endpoint này.

Các `audio_url`/`download_url` trả về trong history thuộc `/api/v1/*`, vì vậy vẫn
phải tải bằng Bearer header. Các thao tác xóa không thể hoàn tác.

## 12. Error handling

### `/v1/*` — định dạng tương thích OpenAI

```json
{
  "error": {
    "message": "Incorrect API key provided.",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}
```

Lấy thông báo từ `body.error.message`.

### `/api/v1/*` — định dạng FastAPI native

```json
{
  "detail": "Invalid API key."
}
```

Lấy thông báo từ `body.detail`. Với lỗi validation `422`, `detail` có thể là một
mảng object thay vì string.

```ts
export async function readVbeeError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return `HTTP ${response.status}`;
  }
  const body = await response.json();
  return (
    body.error?.message ??
    (typeof body.detail === "string"
      ? body.detail
      : JSON.stringify(body.detail)) ??
    `HTTP ${response.status}`
  );
}
```

Các status thường gặp:

| Status | Ý nghĩa |
|---:|---|
| `400` | Request không được hỗ trợ hoặc audio không hợp lệ |
| `401` | Thiếu/sai `VBEE_API_KEY` |
| `404` | Không tìm thấy model, voice hoặc history item |
| `413` | File ASR vượt giới hạn |
| `422` | Sai kiểu dữ liệu, thiếu field hoặc vượt range |
| `500` | Lỗi xử lý nội bộ |
| `502`/`503` | Backend inference chưa sẵn sàng hoặc không truy cập được |

Không tự động retry `400`, `401`, `404`, `413`, `422`. Có thể retry có backoff
với lỗi mạng, `502` hoặc `503`; riêng upload/delete phải kiểm tra trạng thái tài
nguyên trước khi retry.

## 13. Checklist tích hợp

1. Cấu hình UAT base URL ngoài source code.
2. Lưu `VBEE_API_KEY` ở backend/BFF hoặc secret manager, không đưa vào browser.
3. Xác nhận origin frontend đã được whitelist nếu browser gọi trực tiếp.
4. Gọi `/health` và kiểm tra `provider_ready`.
5. Gọi `/v1/models` và `/api/v1/voices`; không hardcode catalog.
6. Tích hợp TTS binary trước, sau đó mới thêm SSE PCM nếu cần phát realtime.
7. Dùng Batch API cho nội dung dài/nhiều câu; lưu `request_id` trước khi poll.
8. Xác minh HMAC, deduplicate và trả `2xx` nhanh tại callback receiver.
9. Tích hợp ASR file; dùng WebSocket Nemotron khi cần transcript realtime và
   không giả lập streaming bằng ChunkFormer/GIPFormer.
10. Xử lý riêng error shape của `/v1/*` và `/api/v1/*`.
11. Hủy stream/request khi người dùng rời màn hình.
12. Chuyển sang Production bằng cách đổi duy nhất base URL và Production API key.
