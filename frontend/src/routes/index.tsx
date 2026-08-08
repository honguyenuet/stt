import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  AudioLines,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Globe2,
  History,
  Headphones,
  Languages,
  Mail,
  Menu,
  Mic2,
  PlugZap,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import vbeeLogo from "@/assets/vbee-logo.png";
import { VbeeBrandLogo } from "@/components/vbee-brand-logo";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vbee | Chuyển giọng nói thành văn bản" },
      {
        name: "description",
        content:
          "Workspace Vbee cho upload audio/video, ghi âm, realtime, quản lý transcript, dịch và gói cước.",
      },
      {
        property: "og:title",
        content: "Vbee | Chuyển giọng nói thành văn bản",
      },
      {
        property: "og:description",
        content:
          "Nền tảng chuyển giọng nói thành văn bản với trải nghiệm Vbee thống nhất.",
      },
      { property: "og:image", content: vbeeLogo },
    ],
  }),
  component: LandingPage,
});

const homeNavigation = [
  {
    label: "Sản phẩm",
    items: [
      {
        title: "Tải file",
        desc: "Audio/video thành văn bản có tính thời lượng.",
        href: "/upload",
        icon: UploadCloud,
      },
      {
        title: "Ghi âm",
        desc: "Thu âm trên trình duyệt và lưu transcript.",
        href: "/record",
        icon: Mic2,
      },
      {
        title: "Nói realtime",
        desc: "Ghi chú trực tiếp cho họp và trao đổi công việc.",
        href: "/realtime",
        icon: AudioLines,
      },
    ],
  },
  {
    label: "Công ty",
    items: [
      {
        title: "Về Vbee",
        desc: "Tầm nhìn, sứ mệnh và cách làm sản phẩm.",
        href: "/about",
        icon: Globe2,
      },
      {
        title: "Liên hệ",
        desc: "Kết nối với đội ngũ tư vấn Vbee.",
        href: "/contact",
        icon: Mail,
      },
      {
        title: "Yêu cầu hỗ trợ",
        desc: "Gửi yêu cầu kỹ thuật và theo dõi trạng thái xử lý.",
        href: "/support",
        icon: Headphones,
      },
    ],
  },
  {
    label: "Tài nguyên",
    items: [
      {
        title: "Hướng dẫn sử dụng",
        desc: "Cách tải tệp lên, ghi âm và nói realtime.",
        href: "#features",
        icon: FileText,
      },
      {
        title: "Lịch sử transcript",
        desc: "Quản lý bản ghi đã chuyển đổi.",
        href: "/history",
        icon: History,
      },
      {
        title: "Xuất và dịch văn bản",
        desc: "Copy, TXT, DOCX, SRT và dịch nội dung.",
        href: "#workspace",
        icon: Languages,
      },
    ],
  },
  {
    label: "Kiếm tiền",
    items: [
      {
        title: "Giới thiệu bạn bè",
        desc: "Nhận thêm thời lượng khi giới thiệu người dùng mới.",
        href: "/referral",
        icon: Zap,
      },
      {
        title: "Đối tác API",
        desc: "Kết nối chuyển giọng nói thành văn bản vào sản phẩm riêng.",
        href: "/api",
        icon: PlugZap,
      },
      {
        title: "Nâng cấp gói",
        desc: "Chọn gói phù hợp theo thời lượng sử dụng.",
        href: "/pricing",
        icon: Clock3,
      },
    ],
  },
];

const metrics = [
  { value: "50h", label: "Gói dùng thử có quản lý quota" },
  { value: "2GB", label: "Upload tối đa gói Chuyên nghiệp" },
  { value: "3 cách", label: "Tải tệp, ghi âm, realtime" },
  { value: "4 định dạng", label: "TXT, DOCX, SRT, copy" },
];

const features = [
  {
    icon: UploadCloud,
    title: "Tải audio/video",
    desc: "Nhận MP3, WAV, M4A, OGG, FLAC, AAC, MP4 và WebM; hiện thời lượng trước khi xử lý.",
  },
  {
    icon: Mic2,
    title: "Ghi âm trên trình duyệt",
    desc: "Mở microphone, ghi âm, đếm giờ và chuyển thành transcript trong cùng workspace.",
  },
  {
    icon: AudioLines,
    title: "Nói realtime",
    desc: "Phù hợp ghi chú nhanh, họp trực tuyến và luồng nói trực tiếp.",
  },
  {
    icon: Languages,
    title: "Dịch và xuất văn bản",
    desc: "Quản lý transcript, dịch sang ngôn ngữ khác và xuất tài liệu để chia sẻ.",
  },
];

const workflow = [
  {
    title: "Đăng nhập",
    desc: "Người dùng vào workspace và thấy ngay quota còn lại.",
    icon: ShieldCheck,
  },
  {
    title: "Chọn nguồn",
    desc: "Tải file, ghi âm hoặc nói realtime theo nhu cầu.",
    icon: UploadCloud,
  },
  {
    title: "Xử lý AI",
    desc: "Hệ thống kiểm tra giới hạn, ước tính thời gian và tạo transcript.",
    icon: Zap,
  },
  {
    title: "Lưu và nâng cấp",
    desc: "Lưu vào lịch sử, xuất file và mua gói khi gần hết quota.",
    icon: BarChart3,
  },
];

const plans = [
  {
    name: "Theo lượt",
    label: "Không thuê bao",
    price: "39.000đ · 1 giờ",
    desc: "Mua đúng số giờ cần dùng, không có quota thuê bao cố định.",
    points: ["Theo sử dụng", "Không phí duy trì", "Thanh toán qua PayOS"],
  },
  {
    name: "Tiêu chuẩn",
    label: "Cá nhân",
    price: "149.000đ · 5 giờ",
    desc: "Cho cá nhân dùng ít nhưng cần quota hằng tháng ổn định.",
    points: ["Upload 300MB", "File tối đa 3 giờ", "API có giới hạn"],
  },
  {
    name: "Đặc biệt",
    label: "Creator",
    price: "499.000đ · 20 giờ",
    desc: "Cho freelancer, creator và người dùng thường xuyên.",
    points: ["Upload 1GB", "File tối đa 4 giờ", "Webhook mở rộng"],
    featured: true,
  },
  {
    name: "Chuyên nghiệp",
    label: "Nâng cao",
    price: "799.000đ · 40 giờ",
    desc: "Cho nhóm nhỏ và chuyên gia cần API đầy đủ.",
    points: ["Upload 2GB", "File tối đa 10 giờ", "Xử lý song song 10 file"],
  },
];

function LandingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  function startApp() {
    if (user) {
      void navigate({ to: "/dashboard" });
      return;
    }
    void navigate({
      to: "/login",
      search: { error: undefined, from: undefined },
    });
  }

  return (
    <main className="min-h-screen bg-white text-[#21104a]">
      <Header onStart={startApp} />
      <Hero onStart={startApp} />
      <Metrics />
      <Features onStart={startApp} />
      <WorkspacePreview onStart={startApp} />
      <Workflow onStart={startApp} />
      <Plans onStart={startApp} />
      <FinalCta onStart={startApp} />
      <Footer />
    </main>
  );
}

function Header({ onStart }: { onStart: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpenMenu, setDesktopOpenMenu] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-50 border-b border-[#ece6ff] bg-white/92 shadow-[0_10px_35px_rgba(33,16,74,.05)] backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <Link
          to="/"
          className="flex items-center gap-2"
          aria-label="Về trang chủ Vbee"
          title="Về trang chủ"
        >
          <VbeeBrandLogo />
        </Link>

        <div className="hidden items-center gap-5 lg:flex">
          {homeNavigation.map((group, groupIndex) => {
            const isOpen = desktopOpenMenu === group.label;
            const menuId = `home-navigation-${groupIndex}`;

            return (
              <div
                key={group.label}
                className="group relative"
                onMouseEnter={() => setDesktopOpenMenu(group.label)}
                onMouseLeave={() => setDesktopOpenMenu(null)}
                onBlur={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  ) {
                    setDesktopOpenMenu(null);
                  }
                }}
              >
                <button
                  type="button"
                  onClick={() => setDesktopOpenMenu(group.label)}
                  onFocus={() => setDesktopOpenMenu(group.label)}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  aria-controls={menuId}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-2 text-sm font-black text-[#21104a] transition hover:text-[#6b5200]"
                >
                  {group.label}
                  <ChevronDown
                    className={`h-4 w-4 transition ${isOpen ? "rotate-180" : "group-hover:rotate-180"}`}
                  />
                </button>
                <div
                  id={menuId}
                  role="menu"
                  className={`absolute left-0 top-full z-40 w-[320px] pt-2 transition-opacity ${
                    isOpen ? "visible opacity-100" : "invisible opacity-0"
                  }`}
                >
                  <div className="rounded-[1.5rem] border border-[#eee8ff] bg-white p-3 shadow-[0_24px_80px_rgba(33,16,74,.18)]">
                    {group.items.map((item) => (
                      <a
                        key={item.title}
                        href={item.href}
                        role="menuitem"
                        onClick={() => setDesktopOpenMenu(null)}
                        className="flex gap-3 rounded-2xl p-3 transition hover:bg-[#f8f5ff] focus:bg-[#f8f5ff] focus:outline-none"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#fff3a6] text-[#21104a]">
                          <item.icon className="h-5 w-5" />
                        </span>
                        <span>
                          <span className="block text-sm font-black text-[#21104a]">
                            {item.title}
                          </span>
                          <span className="mt-0.5 block text-xs font-semibold leading-5 text-[#756894]">
                            {item.desc}
                          </span>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          <Link
            to="/pricing"
            className="rounded-full bg-[#fff2a3] px-5 py-2.5 text-sm font-black text-[#21104a] shadow-[0_10px_25px_rgba(255,203,5,.25)] transition hover:bg-[#ffdf55]"
          >
            Bảng giá
          </Link>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <button
            onClick={onStart}
            className="rounded-full px-4 py-2 text-sm font-black text-[#21104a] transition hover:bg-[#f1eef7]"
          >
            Đăng nhập
          </button>
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-5 py-2.5 text-sm font-black text-[#21104a] shadow-[0_12px_30px_rgba(255,203,5,.35)] transition hover:-translate-y-0.5 hover:bg-[#ffdc45]"
          >
            Dùng thử <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={() => setMobileOpen((value) => !value)}
          className="grid h-11 w-11 place-items-center rounded-full bg-[#f2f0f7] text-[#21104a] lg:hidden"
          aria-label="Mở menu"
        >
          {mobileOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </button>
      </nav>

      {mobileOpen && (
        <div className="border-t border-[#eee8ff] bg-white px-4 py-4 lg:hidden">
          <div className="space-y-3">
            {homeNavigation.map((group) => (
              <details
                key={group.label}
                className="rounded-2xl bg-[#f8f5ff] p-3"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between font-black text-[#21104a]">
                  {group.label} <ChevronDown className="h-4 w-4" />
                </summary>
                <div className="mt-3 grid gap-2">
                  {group.items.map((item) => (
                    <a
                      key={item.title}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-[#37235f]"
                    >
                      {item.title}
                    </a>
                  ))}
                </div>
              </details>
            ))}
            <Link
              to="/pricing"
              onClick={() => setMobileOpen(false)}
              className="block rounded-2xl bg-[#fff2a3] px-4 py-3 font-black text-[#21104a]"
            >
              Bảng giá
            </Link>
            <button
              onClick={onStart}
              className="w-full rounded-2xl bg-[#ffcb05] px-5 py-3 font-black text-[#21104a]"
            >
              Bắt đầu miễn phí
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="relative overflow-hidden bg-[#21104a] px-4 pb-8 pt-10 text-white md:px-6 md:pb-12 md:pt-12">
      <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-[#ffcb05]/20 blur-3xl" />
      <div className="absolute right-[12%] top-20 h-52 w-52 rounded-full bg-[#6c45ae]/45 blur-3xl" />
      <div className="absolute inset-0 opacity-20 vbee-foundation-grid" />

      <div className="relative mx-auto max-w-7xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-[#ffdc45]">
          <Sparkles className="h-4 w-4 text-[#ffcb05]" /> Vbee chuyển giọng nói thành văn bản
        </div>
        <h1 className="mx-auto mt-5 max-w-4xl text-2xl font-black leading-tight tracking-tight text-white md:text-3xl lg:text-4xl">
          Chuyển giọng nói thành văn bản, gọn và chính xác
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/72">
          Tải file, ghi âm, nói realtime, dịch và xuất transcript trong một
          không gian làm việc thống nhất, bảo mật và dễ sử dụng.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            onClick={onStart}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-6 py-3 text-sm font-black text-[#21104a] shadow-[0_14px_35px_rgba(255,203,5,.35)] transition hover:-translate-y-0.5 hover:bg-[#ffdc45]"
          >
            Vào workspace <ArrowRight className="h-4 w-4" />
          </button>
          <Link
            to="/pricing"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 bg-white/10 px-6 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white/20"
          >
            Xem bảng giá <ChevronDown className="h-4 w-4 -rotate-90" />
          </Link>
        </div>

        <div className="mx-auto mt-8 max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-white text-left shadow-[0_22px_70px_rgba(5,0,25,.3)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e0f0] bg-[#f7f5ff] px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#21104a] text-[#ffcb05]">
                <AudioLines className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-black text-[#21104a]">
                  Bản ghi đang xử lý
                </p>
                <p className="text-xs font-semibold text-[#756894]">
                  meeting-audio.mp3 · 18m 42s
                </p>
              </div>
            </div>
            <span className="rounded-full bg-[#fff2a3] px-4 py-2 text-xs font-black text-[#21104a] shadow-inner">
              50h 0m còn lại
            </span>
          </div>

          <div className="grid md:grid-cols-[220px_1fr_220px]">
            <aside className="border-b border-[#eee8ff] bg-[#fbfaff] p-4 md:border-b-0 md:border-r">
              {["Tải file", "Ghi âm", "Trực tiếp", "Lịch sử"].map(
                (item, index) => (
                  <div
                    key={item}
                    className={`mb-2 rounded-2xl px-3 py-2 text-sm font-black ${
                      index === 0 ? "bg-[#21104a] text-white" : "text-[#5d5077]"
                    }`}
                  >
                    {item}
                  </div>
                ),
              )}
            </aside>
            <div className="p-4 md:p-5">
              <div className="space-y-3">
                {[
                  ["00:04", "Hôm nay chúng ta tổng hợp tính năng chuyển giọng nói thành văn bản của Vbee."],
                  ["00:21", "Người dùng có thể tải file, ghi âm hoặc nói realtime."],
                  ["01:08", "Sau khi xử lý, transcript được lưu vào lịch sử để xuất file."],
                ].map(([time, text]) => (
                  <p
                    key={time}
                    className="rounded-2xl border border-[#eee8ff] bg-white px-4 py-3 text-sm font-semibold leading-6"
                  >
                    <span className="mr-3 font-black text-[#21104a]">
                      {time}
                    </span>
                    <span className="text-[#4d405f]">{text}</span>
                  </p>
                ))}
              </div>
            </div>
            <aside className="border-t border-[#eee8ff] bg-[#fbfaff] p-4 md:border-l md:border-t-0">
              <p className="text-sm font-black text-[#21104a]">Tác vụ nhanh</p>
              <div className="mt-3 grid gap-2">
                {["Dịch văn bản", "Xuất DOCX", "Tạo phụ đề"].map((item) => (
                  <button
                    key={item}
                    className="rounded-2xl border border-[#eee8ff] bg-white px-3 py-2 text-left text-sm font-bold text-[#21104a] transition hover:bg-[#fff7c2]"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metrics() {
  return (
    <section className="bg-white px-4 pb-10 md:px-6 md:pb-12">
      <div className="mx-auto grid max-w-7xl gap-3 md:grid-cols-4">
        {metrics.map((item) => (
          <div
            key={item.value}
            className="rounded-2xl border border-[#e5e0f0] bg-white p-4 shadow-[0_12px_40px_rgba(33,16,74,.05)]"
          >
            <p className="text-2xl font-black text-[#21104a]">{item.value}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#6a5a8f]">
              {item.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features({ onStart }: { onStart: () => void }) {
  return (
    <section id="features" className="bg-[#f7f5ff] px-4 py-10 md:px-6 md:py-12">
      <div className="mx-auto max-w-7xl">
        <SectionTitle
          eyebrow="Tính năng chính"
          title="Một nền tảng cho toàn bộ quy trình speech-to-text"
          desc="Từ nguồn âm thanh đến transcript, bản dịch và file xuất ra, mọi thao tác được gom trong cùng trải nghiệm Vbee."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map((item) => (
            <article
              key={item.title}
              className="rounded-xl border border-[#e5e0f0] bg-white p-5 shadow-[0_10px_35px_rgba(33,16,74,.05)] transition hover:-translate-y-1"
            >
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#21104a] text-[#ffcb05]">
                <item.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-black text-[#21104a]">
                {item.title}
              </h3>
              <p className="mt-2 text-sm font-semibold leading-7 text-[#6a5a8f]">
                {item.desc}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-10 text-center">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-6 py-3 text-sm font-black text-[#21104a] shadow-[0_12px_30px_rgba(255,203,5,.35)] transition hover:-translate-y-0.5 hover:bg-[#ffdc45]"
          >
            Dùng thử tính năng <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

function WorkspacePreview({ onStart }: { onStart: () => void }) {
  return (
    <section id="workspace" className="bg-white px-4 py-10 md:px-6 md:py-12">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#fff7c2] px-4 py-2 text-xs font-black uppercase tracking-wide text-[#725a00]">
            <Sparkles className="h-4 w-4 text-[#ffcb05]" /> Vbee workspace
          </div>
          <h2 className="mt-4 text-2xl font-black leading-tight text-[#21104a] md:text-3xl">
            Giao diện gọn, rõ và tập trung vào công việc
          </h2>
          <p className="mt-4 max-w-xl text-sm font-semibold leading-7 text-[#6a5a8f]">
            Người dùng nhìn thấy ngay file đang xử lý, thời lượng còn lại,
            transcript và các thao tác xuất file cần thiết.
          </p>
          <div className="mt-6 grid gap-3">
            {[
              "Tổng quan file, trạng thái và quota được đặt ngay trong tầm mắt.",
              "Nút hành động nổi bật giúp người dùng bắt đầu nhanh.",
              "Các tác vụ dịch, xuất file và quản lý transcript luôn dễ tìm.",
            ].map((point) => (
              <div
                key={point}
                className="flex gap-3 text-sm font-bold leading-6 text-[#4d3c75]"
              >
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#17b26a]" />
                {point}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#e5e0f0] bg-[#f7f5ff] p-4 shadow-[0_14px_45px_rgba(33,16,74,.06)]">
          <div className="rounded-[1.5rem] bg-white p-5 shadow-[0_10px_40px_rgba(33,16,74,.05)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-[#21104a]">Xử lý file</p>
                <p className="mt-1 text-xs font-semibold text-[#756894]">
                  meeting-audio.mp3 · 32m 16s
                </p>
              </div>
              <span className="rounded-full bg-[#e8fff2] px-3 py-1 text-xs font-black text-[#147a45]">
                Đã chuyển đổi
              </span>
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#eee8ff]">
              <div className="h-full w-[68%] rounded-full bg-[#ffcb05]" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["Ngôn ngữ", "Tiếng Việt"],
                ["Thời gian", "~4 phút"],
                ["Xuất file", "DOCX/SRT"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-[#eee8ff] bg-[#fbfaff] p-3"
                >
                  <p className="text-xs font-semibold text-[#756894]">
                    {label}
                  </p>
                  <p className="mt-1 text-sm font-black text-[#21104a]">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onStart}
            className="mt-4 w-full rounded-full bg-[#21104a] px-4 py-3 text-sm font-black text-white transition hover:bg-[#30116b]"
          >
            Mở workspace
          </button>
        </div>
      </div>
    </section>
  );
}

function Workflow({ onStart }: { onStart: () => void }) {
  return (
    <section id="workflow" className="bg-[#f7f5ff] px-4 py-10 md:px-6 md:py-12">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-2xl bg-[#21104a] p-6 text-white shadow-[0_20px_70px_rgba(33,16,74,.18)] md:p-8">
        <SectionTitle
          dark
          eyebrow="Luồng khách hàng"
          title="Đi từ đăng nhập đến transcript trong 4 bước"
          desc="Luôn giữ người dùng biết mình đang ở đâu, còn bao nhiêu quota và bước tiếp theo là gì."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-4">
          {workflow.map((step, index) => (
            <article
              key={step.title}
              className="rounded-2xl border border-white/10 bg-white/[0.07] p-5"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ffcb05] text-[#21104a]">
                  <step.icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-black text-white/35">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-black">{step.title}</h3>
              <p className="mt-2 text-sm font-semibold leading-7 text-white/68">
                {step.desc}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-10 text-center">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-6 py-3 text-sm font-black text-[#21104a] transition hover:-translate-y-0.5 hover:bg-[#ffdc45]"
          >
            Bắt đầu chuyển đổi <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

function Plans({ onStart }: { onStart: () => void }) {
  return (
    <section id="pricing" className="bg-white px-4 py-10 md:px-6 md:py-12">
      <div className="mx-auto max-w-7xl">
        <SectionTitle
          eyebrow="Gói cước"
          title="Gói cước rõ ràng theo nhu cầu sử dụng"
          desc="Người dùng có thể bắt đầu miễn phí, nâng cấp khi cần thêm thời lượng hoặc triển khai API cho doanh nghiệp."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border p-5 shadow-[0_14px_45px_rgba(33,16,74,.06)] transition hover:-translate-y-1 ${
                plan.featured
                  ? "border-[#ffcb05] bg-[#21104a] text-white shadow-[0_20px_70px_rgba(33,16,74,.18)]"
                  : "border-[#eee4d3] bg-white text-[#21104a]"
              }`}
            >
              {plan.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#ffcb05] px-4 py-1.5 text-xs font-black text-[#21104a] shadow-[0_10px_30px_rgba(255,203,5,.35)]">
                  Đề xuất
                </div>
              )}
              <span
                className={`w-fit rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide ${
                  plan.featured
                    ? "bg-white/10 text-[#ffcb05]"
                    : "bg-[#fff7c2] text-[#725a00]"
                }`}
              >
                {plan.label}
              </span>
              <h3 className="mt-5 text-2xl font-black">{plan.name}</h3>
              <p className="mt-3 text-2xl font-black tracking-tight">
                {plan.price}
              </p>
              <p
                className={`mt-4 min-h-[56px] text-sm font-semibold leading-7 ${plan.featured ? "text-white/70" : "text-[#6a5a8f]"}`}
              >
                {plan.desc}
              </p>
              <div className="mt-6 space-y-3">
                {plan.points.map((point) => (
                  <div
                    key={point}
                    className="flex items-start gap-3 text-sm font-bold leading-6"
                  >
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#17b26a]" />
                    <span
                      className={
                        plan.featured ? "text-white/78" : "text-[#4d3c75]"
                      }
                    >
                      {point}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={onStart}
                className={`mt-8 w-full rounded-full px-5 py-3 text-sm font-black transition ${
                  plan.featured
                    ? "bg-[#ffcb05] text-[#21104a] hover:bg-[#ffd842]"
                    : "bg-[#21104a] text-white hover:bg-[#30116b]"
                }`}
              >
                Chọn gói
              </button>
            </article>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-full border border-[#e8decc] bg-[#fbf8ef] px-5 py-3 text-sm font-black text-[#21104a] transition hover:bg-[#fff7c2]"
          >
            Xem bảng giá đầy đủ <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function FinalCta({ onStart }: { onStart: () => void }) {
  return (
    <section className="bg-[#f7f5ff] px-4 py-10 md:px-6 md:py-12">
      <div className="mx-auto grid max-w-7xl overflow-hidden rounded-2xl bg-[#21104a] text-white shadow-[0_20px_70px_rgba(33,16,74,.18)] lg:grid-cols-[1.05fr_.95fr]">
        <div className="relative p-6 md:p-8 lg:p-10">
          <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-[#ffcb05]/20 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-[#ffcb05]">
              <Globe2 className="h-4 w-4" /> Bắt đầu sử dụng
            </div>
            <h2 className="mt-5 text-2xl font-black leading-tight md:text-3xl">
              Vào workspace để thử upload, ghi âm và lịch sử transcript.
            </h2>
            <p className="mt-4 max-w-2xl text-sm font-semibold leading-7 text-white/70">
              Đăng nhập để tải file, ghi âm, nói realtime và quản lý mọi
              transcript trong workspace Vbee.
            </p>
          </div>
        </div>
        <div className="bg-white p-6 text-[#21104a] md:p-8 lg:p-10">
          <div className="rounded-[1.5rem] border border-[#e5e0f0] bg-[#f7f5ff] p-5 md:p-6">
            <h3 className="text-xl font-black">Bắt đầu chuyển đổi</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#6a5a8f]">
              Dùng tài khoản hiện tại hoặc đăng nhập để vào workspace.
            </p>
            <button
              onClick={onStart}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-6 py-3 font-black text-[#21104a] transition hover:bg-[#ffd842]"
            >
              Mở ứng dụng <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[#21104a] px-4 py-10 text-white md:px-6">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <img
            src={vbeeLogo}
            alt="Vbee"
            className="h-14 w-auto rounded-xl bg-white p-2"
          />
          <p className="mt-4 max-w-sm text-sm font-semibold leading-7 text-white/65">
            Vbee AI Speech Workspace tập trung vào chuyển giọng nói thành văn bản, realtime,
            transcript, quota và gói cước trong một giao diện thống nhất.
          </p>
        </div>
        {[
          ["Sản phẩm", ["Tải tệp lên", "Ghi âm", "Realtime", "Lịch sử"]],
          ["Hệ thống", ["API", "Quota", "Thanh toán", "Hỗ trợ"]],
          ["Liên hệ", ["contact@vbee.ai", "(+84) 249 999 3399", "Hà Nội, Việt Nam"]],
        ].map(([title, links]) => (
          <div key={String(title)}>
            <h3 className="text-sm font-black text-[#ffcb05]">{title}</h3>
            <div className="mt-3 space-y-2 text-sm font-semibold text-white/68">
              {(links as string[]).map((link) => (
                <p key={link}>{link}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-8 max-w-7xl border-t border-white/12 pt-5 text-sm font-semibold text-white/45">
        © 2026 Vbee AI Speech Workspace. Điều khoản dịch vụ · Chính sách bảo
        mật.
      </div>
    </footer>
  );
}

function SectionTitle({
  eyebrow,
  title,
  desc,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  dark?: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <span
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-wide ${
          dark
            ? "bg-white/10 text-[#ffcb05]"
            : "border border-[#e2d7c3] bg-white text-[#725a00] shadow-[0_14px_40px_rgba(33,16,74,.06)]"
        }`}
      >
        <Sparkles className="h-4 w-4 text-[#ffcb05]" /> {eyebrow}
      </span>
      <h2
        className={`mt-4 text-2xl font-black leading-tight md:text-3xl ${
          dark ? "text-white" : "text-[#21104a]"
        }`}
      >
        {title}
      </h2>
      <p
        className={`mx-auto mt-3 max-w-2xl text-sm font-semibold leading-7 ${
          dark ? "text-white/65" : "text-[#6a5a8f]"
        }`}
      >
        {desc}
      </p>
    </div>
  );
}
