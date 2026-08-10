import { createFileRoute, Link } from "@tanstack/react-router";
import { FormEvent, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FileText,
  Headphones,
  Mail,
  MessageCircle,
  Send,
  Sparkles,
  UploadCloud,
  Wallet,
} from "lucide-react";
import {
  VbeePublicFooter,
  VbeePublicHeader,
} from "@/components/vbee-public-chrome";
import { useAuth } from "@/context/AuthContext";
import { createSupportTicket } from "@/lib/support";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Trung tâm hỗ trợ Vbee" },
      {
        name: "description",
        content: "Gửi yêu cầu hỗ trợ về tải tệp, ghi âm, thời lượng, thanh toán và API.",
      },
    ],
  }),
  component: SupportPage,
});

const QUICK_HELP = [
  {
    icon: UploadCloud,
    title: "Không tải tệp lên được",
    text: "Kiểm tra định dạng, dung lượng tệp và thời lượng còn lại của gói.",
  },
  {
    icon: AlertTriangle,
    title: "Lỗi API hoặc xử lý",
    text: "Gửi mã lỗi và thao tác vừa thực hiện để đội ngũ kiểm tra nhanh hơn.",
  },
  {
    icon: Wallet,
    title: "Gói cước và thời lượng",
    text: "Kiểm tra thời lượng sau khi mua gói hoặc yêu cầu hỗ trợ thanh toán.",
  },
  {
    icon: FileText,
    title: "Văn bản và xuất tệp",
    text: "Hỗ trợ các vấn đề về văn bản, dịch hoặc định dạng xuất dữ liệu.",
  },
];

function SupportPage() {
  const { user, token } = useAuth();
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [platform, setPlatform] = useState("Trang đăng nhập web");
  const [category, setCategory] = useState("upload");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !subject.trim() || !message.trim()) {
      setStatus("error");
      setNotice("Vui lòng nhập thư điện tử, tiêu đề và nội dung cần hỗ trợ.");
      return;
    }

    setStatus("sending");
    setNotice("");
    try {
      await createSupportTicket(token, {
        subject: subject.trim(),
        category,
        message: `${message.trim()}\n\nNền tảng: ${platform}\nSố điện thoại: ${phone.trim() || "Chưa cung cấp"}`,
        email: email.trim(),
        name: user ? `${user.firstName} ${user.lastName}`.trim() : undefined,
        pageUrl: "/support",
        priority: category === "api" || category === "payment" ? "high" : "normal",
        metadata: { platform, phone: phone.trim() },
      });
      setSubject("");
      setMessage("");
      setStatus("success");
      setNotice("Đã tạo yêu cầu hỗ trợ. Vbee sẽ phản hồi qua thư điện tử của bạn.");
    } catch (error) {
      setStatus("error");
      setNotice(
        error instanceof Error
          ? error.message
          : "Không gửi được yêu cầu. Vui lòng thử lại sau.",
      );
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f5ff] text-[#21104a]">
      <VbeePublicHeader />

      <section className="relative overflow-hidden bg-[#21104a] px-4 py-14 text-white md:px-6 md:py-16">
        <div className="absolute left-1/2 top-[-9rem] h-80 w-80 -translate-x-1/2 rounded-full bg-[#ffcb05]/20 blur-3xl" />
        <div className="absolute inset-0 opacity-20 vbee-foundation-grid" />
        <div className="relative mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-[#ffdc45]">
            <Sparkles className="h-4 w-4 text-[#ffcb05]" /> Trung tâm hỗ trợ
          </span>
          <h1 className="mt-5 text-2xl font-black leading-tight md:text-3xl">
            Vbee có thể hỗ trợ gì cho bạn?
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/72">
            Gửi chi tiết vấn đề bạn gặp phải. Yêu cầu sẽ được tạo thành hồ sơ
            để theo dõi trạng thái xử lý.
          </p>
        </div>
      </section>

      <section className="px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.18fr_.82fr]">
          <form onSubmit={handleSubmit} className="rounded-2xl border border-[#e8e1f5] bg-white p-5 shadow-[0_18px_55px_rgba(33,16,74,.08)] md:p-7">
            <div className="flex items-start justify-between gap-4 border-b border-[#eee8ff] pb-5">
              <div>
                <h2 className="text-xl font-black md:text-2xl">Gửi yêu cầu hỗ trợ</h2>
                <p className="mt-1 text-sm leading-6 text-[#6a5a8f]">
                  Mô tả càng rõ, Vbee càng có thể hỗ trợ nhanh hơn.
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#fff3a6] text-[#21104a]">
                <Headphones className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <SupportField label="Thư điện tử *" value={email} onChange={setEmail} placeholder="name@company.com" type="email" />
              <SupportField label="Số điện thoại" value={phone} onChange={setPhone} placeholder="Nhập số điện thoại" type="tel" />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <SelectField label="Nền tảng" value={platform} onChange={setPlatform} options={["Trang đăng nhập web", "Vbee API", "Ứng dụng nội bộ"]} />
              <SelectField label="Danh mục" value={category} onChange={setCategory} options={["upload", "record", "realtime", "quota", "payment", "api", "general"]} labels={["Tải tệp lên", "Ghi âm", "Realtime", "Thời lượng / gói cước", "Thanh toán", "API nhà cung cấp", "Khác"]} />
            </div>
            <div className="mt-4">
              <SupportField label="Tiêu đề *" value={subject} onChange={setSubject} placeholder="Tóm tắt vấn đề bạn gặp phải" />
            </div>
            <label className="mt-4 grid gap-2 text-[13px] font-black">
              Nội dung *
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ví dụ: tên tệp, thao tác bạn vừa thực hiện, thông báo lỗi hoặc thời điểm xảy ra vấn đề." rows={7} className="resize-y rounded-xl border border-[#ddd5ef] bg-white px-3 py-3 text-[13px] font-medium leading-6 text-[#21104a] outline-none transition placeholder:text-[#9a90ad] focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20" />
            </label>

            {notice && (
              <p className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${status === "success" ? "bg-[#edfbf1] text-[#17683a]" : "bg-[#fff0f0] text-[#a62c2c]"}`}>
                {status === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                {notice}
              </p>
            )}

            <button disabled={status === "sending"} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffcb05] px-5 py-3 text-[13px] font-black text-[#21104a] transition hover:bg-[#ffdc45] disabled:cursor-not-allowed disabled:opacity-60">
              {status === "sending" ? "Đang gửi yêu cầu..." : "Gửi yêu cầu"}
              <Send className="h-4 w-4" />
            </button>
          </form>

          <aside className="space-y-5">
            <div className="rounded-2xl border border-[#e8e1f5] bg-white p-5">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">Cần phản hồi nhanh?</p>
              <h2 className="mt-3 text-xl font-black md:text-2xl">Chọn kênh phù hợp.</h2>
              <a href="mailto:contact@vbee.ai" className="mt-5 flex items-center justify-between rounded-xl border border-[#e8e1f5] px-4 py-3 text-sm font-black transition hover:bg-[#fff9d7]">
                <span className="flex items-center gap-3"><Mail className="h-5 w-5 text-[#8a7100]" /> Thư điện tử Vbee</span>
                <ChevronRight className="h-4 w-4" />
              </a>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("vbee:open-support"))} className="mt-3 flex w-full items-center justify-between rounded-xl border border-[#e8e1f5] px-4 py-3 text-left text-sm font-black transition hover:bg-[#fff9d7]">
                <span className="flex items-center gap-3"><MessageCircle className="h-5 w-5 text-[#8a7100]" /> Mở hỗ trợ trực tiếp</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-2xl border border-[#e8e1f5] bg-[#21104a] p-5 text-white">
              <CircleHelp className="h-6 w-6 text-[#ffcb05]" />
              <h2 className="mt-4 text-lg font-black">Đã có tài khoản?</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">Bạn có thể xem những yêu cầu đã gửi ở bảng hỗ trợ khi đăng nhập.</p>
              <Link
                to="/login"
                search={{ error: undefined, from: undefined }}
                className="mt-5 inline-flex items-center gap-2 text-sm font-black text-[#ffcb05]"
              >
                Đăng nhập <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </aside>
        </div>
      </section>

      <section className="bg-white px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">Gợi ý nhanh</p>
          <h2 className="mt-3 text-2xl font-black md:text-3xl">Những vấn đề thường gặp</h2>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            {QUICK_HELP.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.title} to="/support" className="flex gap-4 rounded-xl border border-[#e8e1f5] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#ffcb05]/60 hover:shadow-[0_14px_40px_rgba(33,16,74,.08)]">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#fff3a6] text-[#21104a]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-black">{item.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-[#6a5a8f]">{item.text}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <VbeePublicFooter />
    </main>
  );
}

function SupportField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "email" | "tel";
}) {
  return (
    <label className="grid gap-2 text-[13px] font-black">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 rounded-xl border border-[#ddd5ef] bg-white px-3 text-[13px] font-semibold text-[#21104a] outline-none transition placeholder:text-[#9a90ad] focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20" />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labels?: string[];
}) {
  return (
    <label className="grid gap-2 text-[13px] font-black">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-xl border border-[#ddd5ef] bg-white px-3 text-[13px] font-semibold text-[#21104a] outline-none transition focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20">
        {options.map((option, index) => (
          <option key={option} value={option}>{labels?.[index] || option}</option>
        ))}
      </select>
    </label>
  );
}
