# Vbee AI Speech Workspace Design System

Tai lieu nay la quy chuan thiet ke cho du an Vbee AI Speech Workspace. File nay giup doi code giu giao dien dong nhat theo nhan dien Vbee khi sua trang chu, upload, ghi am, realtime, lich su, bang gia va checkout.

## 1. Dinh vi san pham

Ten san pham: Vbee AI Speech Workspace.

Muc tieu: tao mot workspace AI de nguoi dung co the upload audio/video, ghi am, noi realtime, tao transcript, dich, tao phu de, xuat tai lieu, quan ly lich su va mua goi cuoc theo quota.

Nguyen tac:
- Vbee-first: uu tien logo, mau tim dam va vang Vbee.
- Transcript-first: moi luong xu ly phai dua nguoi dung ve ket qua van ban ro rang.
- Quota-transparent: nguoi dung luon thay thoi gian con lai, da dung bao nhieu va gioi han goi.
- Mobile-first: cac trang phai dung tot tren dien thoai.
- Business-ready: giao dien phai du de trinh bay voi ban giam doc, doi tac va khach hang.

## 2. Mau sac

Dung cac token trong `frontend/src/styles.css` truoc khi them mau moi.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#21104a` | Nen chinh, hero, footer |
| `--card` | `#2b155f` | Panel toi, sidebar |
| `--primary` | `#ffcb05` | CTA, diem nhan, progress |
| `--primary-glow` | `#ffe36b` | Hover, glow nhe |
| `--secondary` | `#f8f5ff` | Nen workspace sang |
| `--secondary-foreground` | `#21104a` | Chu tren nen sang |
| `--muted` | `#32166f` | Nen phu trong vung toi |
| `--muted-foreground` | `#cabee9` | Chu phu tren nen toi |
| `--destructive` | `#ef4444` | Loi quota, API, upload |

Quy tac:
- CTA chinh dung vang Vbee.
- Header, footer, hero dung tim dam.
- Card noi dung dung trang hoac tim nhat de de doc.
- Khong doi sang he mau xanh Sonix lam mau chinh.

## 3. Chu va khoang cach

Font chinh: `Be Vietnam Pro`, fallback `system-ui, sans-serif`.

Cap bac:
- Page title: 36-56px desktop, 28-36px mobile, font-black.
- Section title: 24-34px, font-black.
- Card title: 18-22px, font-extrabold.
- Body: 14-16px, line-height 1.55-1.75.
- Caption/meta: 12-13px, uppercase hoac muted.

Radius:
- Button/pill: `999px`.
- Control nho: `12px`.
- Card chuan: `16px`.
- Workspace panel lon: `24px` den `32px`.

## 4. Component chinh

### AppHeader

Dung chung cho trang sau dang nhap:
- Home
- Upload
- Record
- Realtime
- History
- Pricing
- Settings

Yeu cau:
- Logo Vbee ben trai.
- Menu active ro.
- Co thong tin goi cuoc/quota khi can.
- Mobile gom menu vao hamburger, khong che noi dung.

### QuotaStatusPanel

Vai tro: bao cho user biet con bao nhieu phut/gio va gioi han goi.

Noi dung toi thieu:
- Ten goi: Free, Standard, Special/Business.
- Thoi gian con lai.
- Da dung / tong quota.
- Progress bar.
- Canh bao sap het quota.
- CTA nang cap goi di qua pricing/checkout.

### UploadWorkspace

Vai tro: upload audio/video va tao transcript.

Trang thai bat buoc:
- Empty: chon file, keo tha, hoac link neu backend ho tro.
- Ready: hien ten file, dung luong, thoi luong uoc tinh.
- Processing: dang upload/transcribe va thoi gian uoc tinh.
- Done: transcript editor va nut export.
- Error: loi API, quota, file qua lon, dinh dang khong ho tro.

### RecorderPanel

Vai tro: ghi am trong trinh duyet roi transcribe.

Trang thai:
- Permission needed.
- Ready.
- Recording.
- Stopped/preview.
- Processing.
- Done/error.

Quy tac:
- Chi co mot SupportWidget tren mot man hinh.
- Nut Start/Stop phai ro trang thai.
- Kiem tra quota truoc khi bat dau ghi am.

### RealtimeSpeechPanel

Vai tro: noi realtime va thay transcript cap nhat theo dong.

Can co:
- Chon ngon ngu dau vao.
- Trang thai microphone.
- Partial transcript va final transcript tach ro.
- Nut copy, export, save vao history.

### TranscriptHistory

Vai tro: quan ly transcript tu upload, record va realtime.

Can co:
- Loc theo source.
- Tim kiem theo file name/noi dung.
- Trang thai: processing, transcribed, failed.
- Hanh dong: open, copy, export, delete.

### PricingCard va CheckoutCard

Vai tro: mua goi va cap quota dung quy trinh.

Luong dung:
1. User vao Pricing.
2. Bam mua goi.
3. Backend tao order.
4. User vao Checkout.
5. Thanh toan hoac demo confirm trong moi truong dev.
6. Backend cap nhat plan/quota.
7. UI refresh QuotaStatusPanel.

Khong cap goi truc tiep khi chua co order/payment.

### SupportWidget

Vai tro: ho tro khach hang tren upload, record, realtime, pricing.

Man hinh:
- Home: loi chao, send message, search help.
- Messages: khong co tin nhan, nut gui tin.
- Chat: khung nhap, nut gui, trang thai online/offline.
- Help: danh sach cau hoi va collection.

Quy tac:
- Khong render hai nut ho tro cung luc.
- Tren mobile khong che nut Start Recording hoac Checkout.

## 5. Page Pattern

### Logged-in Home

Can co:
- Welcome.
- Quota hien tai.
- CTA: Upload, Record, Realtime.
- Recent transcripts.
- Trang thai goi cuoc.

### Upload Page

Layout:
- AppHeader.
- Khu upload/dropzone.
- Quota panel.
- Transcript editor.
- History compact.

### Record Page

Layout:
- AppHeader.
- Recorder visual.
- Controls.
- Permission/status text.
- Transcript result.
- SupportWidget chi mot instance.

### Realtime Page

Layout:
- AppHeader.
- Microphone status.
- Language selector.
- Transcript stream.
- Save/export.

### History Page

Layout:
- AppHeader.
- Search/filter.
- Transcript table/cards.
- Empty state co CTA upload/record.

## 6. Luong trai nghiem khach hang

Luong chinh tham khao cac san pham transcription nhu Sonix, nhung copy va mau sac phai theo Vbee.

### First-time user

1. Vao landing page va hieu ngay gia tri chinh: chuyen giong noi thanh van ban AI.
2. Bam CTA vao register/login.
3. Sau khi dang nhap, dashboard phai hien quota va 3 hanh dong chinh: Upload, Record, Realtime.
4. Neu chua co transcript, empty state phai goi y tai file dau tien hoac ghi am ngay.
5. Sau khi xu ly xong, user duoc dua ve transcript co the copy/export/save.

### Returning user

1. Vao dashboard va thay recent transcripts.
2. Co the mo lich su de tim transcript cu.
3. Co the tao transcript moi bang upload/record/realtime.
4. Quota panel luon cho biet con bao nhieu thoi gian.
5. Neu het quota, CTA di den Pricing/Checkout.

### Tac vu tao transcript

1. Chon input: Upload file, Record, Realtime.
2. Validate: dang nhap, quota, file type, file size, mic permission.
3. Process: hien trang thai dang xu ly va uoc tinh thoi gian.
4. Result: hien transcript, word timestamp neu co, ban dich neu chon ngon ngu dich.
5. Output: copy, export TXT/DOCX, luu vao history.

### Diem can tranh

- Khong de user sau dang nhap chi thay file list ma khong biet buoc tiep theo.
- Khong de Upload, Record, Realtime co header/trang thai khac nhau.
- Khong de nut ho tro che CTA chinh.
- Khong de loi API provider chi hien ma loi ky thuat; phai noi user can lam gi tiep.
- Khong cap goi cuoc truc tiep neu chua qua checkout/order.

## 7. Loi va trang thai API

Moi API call phai co:
- Loading state.
- Error state.
- Success state.
- Empty state neu khong co data.

Thong diep loi nen de hieu:
- Loi API provider: bao user kiem tra API key/backend.
- Het quota: bao con bao nhieu va dua ve pricing.
- File qua lon: bao gioi han theo goi.
- Dinh dang khong ho tro: goi y dinh dang hop le.

## 8. Checklist truoc khi hoan thanh UI

- Header dung va active nav ro.
- Mobile khong bi tran, chong, cat chu.
- Co loading, empty, error, success.
- Quota hien dung neu tac vu ton thoi gian.
- Nut mua goi di qua checkout.
- Mau chinh van la Vbee purple/yellow.
- Transcript co the copy/export/save neu da transcribe xong.
- Build frontend thanh cong.

## 9. Vbee UI System

Day la cach ap dung quy chuan thiet ke moi vao code hien tai. Muc tieu la de moi trang co cung nen tang, component va luong xu ly, khong phai moi man hinh tu viet mot kieu rieng.

### Foundations

Foundations la cac token va quy tac co ban:
- Mau sac: dung token trong `frontend/src/styles.css`, uu tien `--background`, `--card`, `--primary`, `--secondary`.
- Typography: dung `Be Vietnam Pro`; title ngan, ro; body de doc tren mobile.
- Radius: card 16-24px, button/pill 999px.
- Shadow: dung nhe cho card sang, glow vang cho CTA chinh.
- State: moi component co empty, loading, error, success.

### Utilities dung chung

Da them cac utility trong `frontend/src/styles.css`:
- `vbee-page-band`: nen section sang theo mau Vbee.
- `vbee-foundation-grid`: grid nen nhe de section co cau truc.
- `vbee-surface`: card/panel sang.
- `vbee-surface-dark`: panel toi Vbee.
- `vbee-token-card`: card hien token/metric nho.
- `vbee-chip` va `vbee-chip-dark`: nhan trang thai/tag.
- `vbee-button-primary` va `vbee-button-secondary`: CTA dung chung.

Khi lam UI moi, uu tien ghep cac utility tren truoc khi viet class mau rieng.

### Component Registry

Nhung component nen duoc giu cung logic tren cac trang:
- `AppHeader`: logo, nav, active state, mobile menu.
- `QuotaPanel`: ten goi, thoi gian con lai, da dung/tong quota, progress, canh bao.
- `UploadWorkspace`: file type, dung luong, gioi han goi, processing, transcript.
- `RecorderPanel`: mic permission, timer, audio level, stop/start, transcribe.
- `RealtimeSpeechPanel`: ngon ngu, partial/final transcript, save/export.
- `TranscriptCard`: title, source, status, content, actions.
- `PricingCard`: goi cuoc, quota, gia, CTA vao checkout.
- `SupportWidget`: Home, Messages, Chat, Help, chi render mot instance.

### Pattern cho flow speech-to-text

Moi tac vu speech-to-text nen di theo flow:
1. Input: upload file, ghi am, hoac realtime.
2. Validate: login, quota, file type, file size, microphone permission.
3. Process: tinh thoi gian uoc tinh, hien loading, goi provider API.
4. Result: transcript, ban dich neu co, subtitle neu can.
5. Manage: save vao history, copy, export, delete.
6. Billing: neu vuot quota thi dua ve Pricing/Checkout.

### Quy tac mobile

- Khong de support button che nut Start Recording, Upload hoac Checkout.
- Section lon chuyen ve 1 cot.
- Table nen chuyen sang card list.
- Text dai phai wrap, khong cat noi dung quan trong.
- CTA chinh dat trong tam voi nguoi dung, khong nam qua xa ket qua transcript.

### Icon System

He icon chinh gom hai nguon:
- `lucide-react`: hanh dong, dieu huong, trang thai va cong cu trong san pham.
- `simple-icons`: logo cua ben thu ba nhu Google, Facebook va Apple.
- Logo Vbee la tai san thuong hieu rieng, khong thay bang icon chung.

Quy tac ky thuat:
- Dung `AppIcon` va `BrandIcon` trong `frontend/src/components/ui/app-icon.tsx` cho code moi.
- Chi dung ba co: `sm` = 16px, `md` = 20px, `lg` = 24px.
- Lucide dung `strokeWidth=2`; khong tron icon net 1.5, 2 va 2.5 trong cung mot control.
- SVG dung `currentColor`; mau duoc truyen tu text/design token cua component cha.
- Simple Icons co the dung `tone="brand"` khi can mau thuong hieu chinh thuc.
- Icon nam canh text la trang tri va phai `aria-hidden`.
- Icon truyen dat thong tin doc lap phai co `label`.
- Nut chi co icon phai co `aria-label` tren `button` hoac `Link`; tooltip chi bo sung, khong thay the ten truy cap.
- Vung bam tren mobile toi thieu 44x44px, ke ca khi icon chi co 16px hoac 20px.
- Khong viet SVG thu cong neu Lucide hoac Simple Icons da co bieu tuong phu hop.
