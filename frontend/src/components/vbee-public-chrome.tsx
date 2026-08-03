import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Building2,
  ChevronDown,
  CircleHelp,
  CircleDollarSign,
  FileText,
  Headphones,
  Mail,
  Menu,
  Mic2,
  PlugZap,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { VbeeBrandLogo } from "@/components/vbee-brand-logo";
import { useAuth } from "@/context/AuthContext";

const NAVIGATION = [
  {
    label: "Sản phẩm",
    items: [
      {
        title: "Tải file",
        desc: "Audio/video thành văn bản.",
        href: "/upload",
        icon: UploadCloud,
      },
      {
        title: "Ghi âm",
        desc: "Thu âm và lưu transcript.",
        href: "/record",
        icon: Mic2,
      },
      {
        title: "Nói realtime",
        desc: "Chuyển lời nói trực tiếp thành văn bản.",
        href: "/realtime",
        icon: Zap,
      },
      {
        title: "Vbee API",
        desc: "Tích hợp speech-to-text.",
        href: "/api",
        icon: PlugZap,
      },
    ],
  },
  {
    label: "Công ty",
    items: [
      {
        title: "Về Vbee",
        desc: "Tầm nhìn, sứ mệnh và cách làm.",
        href: "/about",
        icon: Building2,
      },
      {
        title: "Liên hệ",
        desc: "Kết nối với đội ngũ tư vấn.",
        href: "/contact",
        icon: Mail,
      },
      {
        title: "Yêu cầu hỗ trợ",
        desc: "Gửi vấn đề kỹ thuật cho Vbee.",
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
        desc: "Bắt đầu với workspace.",
        href: "/#workflow",
        icon: BookOpen,
      },
      {
        title: "Câu hỏi thường gặp",
        desc: "Giải đáp về gói cước và quota.",
        href: "/pricing#faq",
        icon: CircleHelp,
      },
      {
        title: "Quản lý transcript",
        desc: "Lưu trữ và xuất văn bản.",
        href: "/history",
        icon: FileText,
      },
    ],
  },
  {
    label: "Kiếm tiền",
    items: [
      {
        title: "Giới thiệu bạn bè",
        desc: "Nhận thêm thời lượng khi mời người dùng mới.",
        href: "/referral",
        icon: Zap,
      },
      {
        title: "Đối tác API",
        desc: "Tích hợp Speech-to-Text vào sản phẩm riêng.",
        href: "/api",
        icon: PlugZap,
      },
      {
        title: "Nâng cấp gói",
        desc: "Chọn quota phù hợp nhu cầu sử dụng.",
        href: "/pricing",
        icon: CircleDollarSign,
      },
    ],
  },
] as const;

export function VbeePublicHeader() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpenMenu, setDesktopOpenMenu] = useState<string | null>(null);
  const workspaceHref = user ? "/upload" : "/login";

  return (
    <header className="sticky top-0 z-50 border-b border-[#ece6ff] bg-white/92 shadow-[0_10px_35px_rgba(33,16,74,.05)] backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <Link
          to="/"
          className="flex items-center"
          aria-label="Về trang chủ Vbee"
        >
          <VbeeBrandLogo />
        </Link>

        <div className="hidden items-center gap-5 lg:flex">
          {NAVIGATION.map((group, groupIndex) => {
            const isOpen = desktopOpenMenu === group.label;
            const menuId = `public-navigation-${groupIndex}`;

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
                  className="inline-flex items-center gap-1 rounded-full px-2 py-2 text-[13px] font-black text-[#21104a] transition hover:text-[#6b5200]"
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
                  <div className="rounded-2xl border border-[#eee8ff] bg-white p-3 shadow-[0_24px_80px_rgba(33,16,74,.18)]">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <a
                          key={item.title}
                          href={item.href}
                          role="menuitem"
                          onClick={() => setDesktopOpenMenu(null)}
                          className="flex gap-3 rounded-xl p-3 transition hover:bg-[#f8f5ff] focus:bg-[#f8f5ff] focus:outline-none"
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#fff3a6] text-[#21104a]">
                            <Icon className="h-5 w-5" />
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
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          <a
            href="/pricing"
            className="rounded-full bg-[#fff2a3] px-5 py-2.5 text-[13px] font-black text-[#21104a] shadow-[0_10px_25px_rgba(255,203,5,.25)] transition hover:bg-[#ffdf55]"
          >
            Bảng giá
          </a>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <a
            href={workspaceHref}
            className="rounded-full px-4 py-2 text-[13px] font-black text-[#21104a] transition hover:bg-[#f1eef7]"
          >
            {user ? "Workspace" : "Đăng nhập"}
          </a>
          <a
            href={workspaceHref}
            className="inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-5 py-2.5 text-[13px] font-black text-[#21104a] shadow-[0_12px_30px_rgba(255,203,5,.35)] transition hover:-translate-y-0.5 hover:bg-[#ffdc45]"
          >
            {user ? "Mở ứng dụng" : "Dùng thử"}{" "}
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <button
          onClick={() => setMobileOpen((value) => !value)}
          className="grid h-11 w-11 place-items-center rounded-full bg-[#f2f0f7] text-[#21104a] lg:hidden"
          aria-label={mobileOpen ? "Đóng menu" : "Mở menu"}
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
            {NAVIGATION.map((group) => (
              <details
                key={group.label}
                className="rounded-xl bg-[#f8f5ff] p-3"
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
                      className="rounded-lg bg-white px-3 py-2 text-[13px] font-bold text-[#37235f]"
                    >
                      {item.title}
                    </a>
                  ))}
                </div>
              </details>
            ))}
            <a
              href="/pricing"
              onClick={() => setMobileOpen(false)}
              className="block rounded-xl bg-[#fff2a3] px-4 py-3 font-black text-[#21104a]"
            >
              Bảng giá
            </a>
            <a
              href={workspaceHref}
              className="block rounded-xl bg-[#ffcb05] px-5 py-3 text-center font-black text-[#21104a]"
            >
              {user ? "Mở workspace" : "Bắt đầu miễn phí"}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

const FOOTER_COLUMNS = [
  {
    title: "Sản phẩm",
    links: [
      ["Tải file lên", "/upload"],
      ["Ghi âm", "/record"],
      ["Nói realtime", "/realtime"],
      ["Vbee API", "/api"],
    ],
  },
  {
    title: "Công ty",
    links: [
      ["Về Vbee", "/about"],
      ["Liên hệ", "/contact"],
      ["Trung tâm hỗ trợ", "/support"],
      ["Bảng giá", "/pricing"],
    ],
  },
  {
    title: "Liên hệ",
    links: [
      ["contact@vbee.ai", "mailto:contact@vbee.ai"],
      ["(+84) 249 999 3399", "tel:+842499993399"],
      ["Hà Nội, Việt Nam", "/contact"],
    ],
  },
] as const;

export function VbeePublicFooter() {
  return (
    <footer className="bg-[#21104a] px-4 py-10 text-white md:px-6">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.35fr_1fr_1fr_1fr]">
        <div>
          <VbeeBrandLogo size="compact" className="rounded-lg bg-white p-1.5" />
          <p className="mt-4 max-w-sm text-[13px] font-semibold leading-6 text-white/68">
            Vbee Speech Workspace giúp đội ngũ biến âm thanh, cuộc họp và video
            thành dữ liệu văn bản có thể tìm kiếm, dịch và chia sẻ.
          </p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title}>
            <h2 className="text-[13px] font-black text-[#ffcb05]">
              {column.title}
            </h2>
            <div className="mt-3 grid gap-2 text-[13px] font-semibold text-white/68">
              {column.links.map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  className="transition hover:text-[#ffdc45]"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-white/12 pt-5 text-xs font-semibold text-white/45 md:flex-row md:items-center md:justify-between">
        <p>© 2026 Vbee Speech Workspace. Bảo lưu mọi quyền.</p>
        <div className="flex gap-4">
          <a href="/" className="transition hover:text-white">
            Điều khoản dịch vụ
          </a>
          <a href="/" className="transition hover:text-white">
            Chính sách bảo mật
          </a>
        </div>
      </div>
    </footer>
  );
}
