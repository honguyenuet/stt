# Đặc tả: Vbee Workspace UI Refresh

## Mục tiêu

Biến các màn hình đã đăng nhập từ bố cục giống landing page nhiều card thành một
workspace speech-to-text chuyên nghiệp, gọn, dễ quét và ưu tiên công việc chính.
Người dùng phải nhìn thấy thao tác quan trọng và nội dung đang làm mà không phải
cuộn qua các khối giới thiệu, quota, referral hoặc cài đặt lặp lại.

Phạm vi ưu tiên:

1. Shell điều hướng đã đăng nhập.
2. Dashboard/Không gian làm việc.
3. Tải tệp.
4. Lịch sử.
5. Transcript editor.
6. CMS/admin áp dụng cùng mật độ sau khi luồng người dùng ổn định.

Không sao chép giao diện hay nhận diện của đối thủ. Vbee giữ logo, tím đậm và
vàng; chỉ học các pattern tổ chức thông tin đã được chứng minh.

## Nghiên cứu tham chiếu

- Otter Conversation: Summary và Transcript là hai view chính; chat, outline và
  comment nằm ở panel bên phải; điều hướng conversation/folder nằm bên trái.
  https://help.otter.ai/hc/en-us/articles/5093228433687-Conversation-Page-Overview
- Otter workspace: import là thao tác nổi bật, conversation được tổ chức bằng
  folder/channel thay vì các card giới thiệu dài.
  https://help.otter.ai/hc/en-us/articles/360049722894-Otter-Quick-Start-Guide
- Descript editor: script editor là vùng trung tâm; timeline và sidebar là panel
  công cụ, có thể ẩn và thay đổi kích thước.
  https://help.descript.com/hc/en-us/articles/37585546799757-The-editor-interface
- Descript layout: cho phép collapse panel để giảm nhiễu và tập trung nội dung.
  https://help.descript.com/hc/en-us/articles/13286878359565-Customize-the-editor
- Sonix: transcript đồng bộ audio theo từng từ, speaker/timestamp/export là công
  cụ trong editor thay vì các trang/card độc lập.
  https://sonix.ai/features/automated-transcription
- Deepgram: nhóm capability theo tác vụ kỹ thuật rõ ràng như diarization, smart
  formatting và keyterm prompting.
  https://deepgram.com/product/speech-to-text

## Audit hiện trạng (1440 x 900, dữ liệu trống)

- Dashboard dài 1,83 màn hình; mobile 320 x 800 dài 5,13 màn hình.
- Header mobile cao 128px vì có cả menu và thanh điều hướng 5 mục.
- Dashboard có 17 heading, 12 link và 24 phần tử bo góc lớn trước khi có file.
- Upload dài 1,43 màn hình, có 22 phần tử bo góc lớn; quota/referral/quote cạnh
  tranh với vùng thả file.
- Dashboard lặp điều hướng ở header, breadcrumb, quick actions và luồng 4 bước.
- Các route cốt lõi dài 1.100-2.300 dòng, khiến phần trình bày khó tái sử dụng và
  dễ lệch mật độ giữa các màn hình.

## Kiến trúc giao diện

### Workspace shell

- Desktop: rail điều hướng 72px ở trái, top bar 56px cho tên trang, search/action
  theo ngữ cảnh và tài khoản.
- Mobile: top bar tối đa 56px; tối đa 4 mục chính ở bottom navigation, các mục
  phụ nằm trong menu “Thêm”.
- Không lặp breadcrumb “Không gian làm việc/Trang chủ” ngay dưới header.
- Quota hiển thị dạng chỉ báo nhỏ trong top bar; chi tiết nằm trong popover hoặc
  trang tài khoản, không phải sidebar cố định trên dashboard/upload.

### Mật độ và visual system

- Spacing chuẩn: 4, 8, 12, 16, 24, 32px; nội dung ứng dụng chủ yếu dùng 8-16px.
- Radius: 6px cho control, 8px cho panel, 12px cho modal/khối nổi bật; bỏ pill
  ở các control không cần thiết.
- Chỉ một cấp shadow nhẹ cho popover/modal; panel thường dùng border phẳng.
- Nền workspace là neutral sáng, bỏ gradient trang và các chấm trang trí.
- Vàng chỉ dành cho CTA/trạng thái cần chú ý; tím dành cho điều hướng và text
  nhấn, không phủ mọi card.
- Typography ứng dụng 13-14px, tiêu đề trang 20-24px, section 14-16px.

### Dashboard

- Một header compact chứa lời chào, nút Tải tệp và Ghi âm.
- Thống kê/quota nằm trong một strip 4 cột cao không quá 72px.
- Nội dung chính là danh sách project/transcript gần đây; empty state nhỏ gọn.
- “Luồng khách hàng” đổi thành onboarding checklist có thể đóng, không dùng 4
  card cao.
- Referral, quote và danh sách cài đặt rời khỏi luồng chính.

### Upload

- Vùng thả file xuất hiện trong viewport đầu tiên trên desktop.
- Chọn nguồn bằng tab compact; các tùy chọn ngôn ngữ, speaker, thư mục nằm trong
  panel cài đặt bên phải hoặc collapsible.
- Stepper chỉ thể hiện tiến độ hiện tại, không chiếm một hàng card lớn.
- Không lặp lời chào, quota, referral và quote.

### History

- Toolbar duy nhất: tiêu đề, search, filter và CTA.
- Desktop dùng list/table mật độ cao; mobile dùng row card nhỏ.
- Stats chỉ xuất hiện khi có giá trị hữu ích; empty state không chiếm quá nửa
  viewport.

### Transcript editor

- Giữ editor/audio theo viewport và sidebar công cụ có thể thu gọn đã triển khai.
- Bổ sung tab Summary/Transcript khi dữ liệu summary sẵn sàng; không thêm card
  dài vào sidebar.
- Công cụ review, speaker, version, translation giữ contextual và cuộn riêng.

## Tech stack và cấu trúc

- React 19, TanStack Start/Router, TypeScript, Tailwind CSS 4, Radix UI.
- `frontend/src/components/workspace/`: shell, rail, top bar, page header.
- `frontend/src/components/ui/`: primitive hiện có, không tạo bản sao.
- `frontend/src/routes/`: route container và data/state; presentation lớn được
  tách thành component theo màn hình.
- `frontend/src/styles.css`: semantic token và utility dùng chung.

Ví dụ convention:

```tsx
<WorkspacePage
  title="Lịch sử"
  actions={<UploadButton />}
>
  <HistoryToolbar />
  <TranscriptList />
</WorkspacePage>
```

- Component PascalCase, file kebab-case.
- Ưu tiên composition, không tạo component cấu hình hàng chục prop.
- Dùng token semantic/shared utility thay vì tiếp tục rải raw hex mới.

## Lệnh kiểm tra

Từ thư mục `frontend` và chạy tuần tự:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Browser QA tại 320x800, 768x800, 1024x768, 1440x900; kiểm tra DOM, screenshot,
console và overflow.

## Testing strategy

- Test SSR/component cho shell, trạng thái active navigation và section collapse.
- Giữ toàn bộ test hiện có; không bỏ/skip test để làm CI xanh.
- Browser test cho desktop/mobile, keyboard focus, overflow và chiều cao trang.
- Mỗi phase phải pass test/typecheck/lint/build trước khi commit.

## Biên an toàn

### Luôn làm

- Giữ nguyên logic auth, quota, upload, transcript và CMS.
- Giữ wording đã được xác nhận: “Không gian làm việc”, “Không gian làm việc sẵn
  sàng” và “Đăng nhập”.
- Thay đổi theo lát nhỏ, commit độc lập, cập nhật PR hiện tại.

### Hỏi trước

- Thêm dependency, đổi API/database, xóa tính năng, đổi logo hoặc palette Vbee.
- Merge PR hoặc deploy production.

### Không làm

- Sao chép assets/code của đối thủ.
- Chạm `.env`, credential, dữ liệu người dùng hoặc build artifact.
- Đổi hành vi nghiệp vụ chỉ để thuận tiện cho layout.

## Kế hoạch triển khai

### Phase 1: Foundation

- Tạo workspace shell, rail/top bar responsive và token density.
- Acceptance: mobile header <= 56px; không tràn ngang; active route đúng.
- Verify: component tests + browser 4 breakpoint.

### Phase 2: Core workspace

- Thu gọn dashboard và upload; bỏ sidebar marketing khỏi luồng chính.
- Acceptance: dashboard trống <= 1,1 màn hình desktop và <= 2,5 màn hình mobile;
  drop zone upload xuất hiện trong viewport đầu desktop.
- Verify: screenshot before/after, console sạch, chức năng upload vẫn render đúng.

### Phase 3: Library and editor consistency

- Đổi history sang toolbar/list mật độ cao; đồng bộ transcript với shell.
- Acceptance: history empty state <= 0,5 viewport; editor/audio/sidebar vẫn cuộn
  độc lập; export/speaker/review/version không mất.
- Verify: component tests và browser interaction.

### Phase 4: CMS/admin density

- Áp dụng token, toolbar, table và form density cho CMS.
- Acceptance: các trang danh sách không có card marketing; action chính ở toolbar;
  table/form usable tại 1024px và 1440px.
- Verify: toàn bộ CMS tests, browser smoke test các route admin.

### Checkpoint hoàn tất

- Frontend test/typecheck/lint/build xanh local và CI.
- Không còn console error/warning trên các màn hình đã sửa.
- Working tree sạch, PR chứa các commit rollback được theo phase.

## Câu hỏi cần duyệt

- Duyệt hướng “workspace-first”: rail trái desktop + top bar compact + bottom nav
  mobile, giữ nguyên thương hiệu Vbee.
