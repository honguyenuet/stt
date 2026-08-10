import { createFileRoute, Link } from "@tanstack/react-router";
import { FormEvent, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Headphones,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Send,
  Sparkles,
} from "lucide-react";
import {
  VbeePublicFooter,
  VbeePublicHeader,
} from "@/components/vbee-public-chrome";
import { useAuth } from "@/context/AuthContext";
import { createSupportTicket } from "@/lib/support";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Liên hệ Vbee" },
      {
        name: "description",
        content: "Gửi yêu cầu tư vấn và liên hệ với không gian giọng nói Vbee.",
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const { user, token } = useAuth();
  const [name, setName] = useState(
    user ? `${user.firstName} ${user.lastName}`.trim() : "",
  );
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("Tư vấn sản phẩm");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setStatus("error");
      setNotice("Vui lòng điền họ tên, thư điện tử và nội dung cần tư vấn.");
      return;
    }

    setStatus("sending");
    setNotice("");
    try {
      await createSupportTicket(token, {
        subject: `Liên hệ: ${purpose}`,
        category: "general",
        message: `${message.trim()}\n\nSố điện thoại: ${phone.trim() || "Chưa cung cấp"}`,
        email: email.trim(),
        name: name.trim(),
        pageUrl: "/contact",
        priority: purpose === "Tư vấn doanh nghiệp" ? "high" : "normal",
        metadata: { purpose, phone: phone.trim() },
      });
      setStatus("success");
      setNotice("Đã gửi thông tin. Vbee sẽ liên hệ lại qua thư điện tử bạn đã cung cấp.");
      setMessage("");
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
    <main className="min-h-screen bg-white text-[#21104a]">
      <VbeePublicHeader />

      <section className="relative overflow-hidden bg-[#f7f5ff] px-4 py-14 md:px-6 md:py-18">
        <div className="absolute right-[-5rem] top-[-6rem] h-72 w-72 rounded-full bg-[#ffcb05]/25 blur-3xl" />
        <div className="relative mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#e8e1f5] bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-[#8a7100]">
            <Sparkles className="h-4 w-4 text-[#ffcb05]" /> Liên hệ Vbee
          </span>
          <h1 className="mt-5 text-2xl font-black leading-tight md:text-3xl">
            Hãy bắt đầu một cuộc trò chuyện.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#6a5a8f]">
            Gửi nhu cầu chuyển giọng nói thành văn bản, tích hợp API hoặc triển khai cho đội
            ngũ. Vbee sẽ tiếp nhận và phản hồi theo thông tin bạn cung cấp.
          </p>
        </div>
      </section>

      <section className="px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[.82fr_1.18fr]">
          <aside>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">
              Kênh liên hệ
            </p>
            <h2 className="mt-3 text-2xl font-black leading-tight md:text-3xl">
              Kết nối theo cách thuận tiện nhất cho bạn.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#6a5a8f]">
              Với yêu cầu kỹ thuật, bạn cũng có thể gửi yêu cầu tại trung tâm hỗ
              trợ để đội ngũ theo dõi trạng thái xử lý.
            </p>

            <div className="mt-7 divide-y divide-[#e8e1f5] border-y border-[#e8e1f5]">
              <a href="mailto:contact@vbee.ai" className="flex items-start gap-4 py-4 transition hover:text-[#8a7100]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#fff3a6] text-[#21104a]">
                  <Mail className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-black">Thư điện tử</span>
                  <span className="mt-1 block text-sm text-[#6a5a8f]">contact@vbee.ai</span>
                </span>
              </a>
              <a href="tel:+842499993399" className="flex items-start gap-4 py-4 transition hover:text-[#8a7100]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#fff3a6] text-[#21104a]">
                  <Phone className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-black">Điện thoại</span>
                  <span className="mt-1 block text-sm text-[#6a5a8f]">(+84) 249 999 3399</span>
                </span>
              </a>
              <div className="flex items-start gap-4 py-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#fff3a6] text-[#21104a]">
                  <MapPin className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-black">Văn phòng</span>
                  <span className="mt-1 block text-sm leading-6 text-[#6a5a8f]">Hà Nội, Việt Nam</span>
                </span>
              </div>
            </div>

            <Link to="/support" className="mt-7 inline-flex items-center gap-2 text-sm font-black text-[#21104a] transition hover:text-[#8a7100]">
              <Headphones className="h-5 w-5 text-[#8a7100]" />
              Cần hỗ trợ kỹ thuật? Gửi yêu cầu
              <ArrowRight className="h-4 w-4" />
            </Link>
          </aside>

          <form onSubmit={handleSubmit} className="rounded-2xl border border-[#e8e1f5] bg-white p-5 shadow-[0_18px_55px_rgba(33,16,74,.08)] md:p-7">
            <div className="flex items-start justify-between gap-4 border-b border-[#eee8ff] pb-5">
              <div>
                <h2 className="text-xl font-black md:text-2xl">Gửi thông tin của bạn</h2>
                <p className="mt-1 text-sm leading-6 text-[#6a5a8f]">
                  Các trường có dấu * là bắt buộc.
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#fff3a6] text-[#21104a]">
                <MessageCircle className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Họ và tên *" value={name} onChange={setName} placeholder="Nhập họ và tên" />
              <Field label="Số điện thoại" value={phone} onChange={setPhone} placeholder="Nhập số điện thoại" type="tel" />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Thư điện tử *" value={email} onChange={setEmail} placeholder="name@company.com" type="email" />
              <label className="grid gap-2 text-[13px] font-black">
                Mục đích liên hệ *
                <select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="h-10 rounded-xl border border-[#ddd5ef] bg-white px-3 text-[13px] font-semibold text-[#21104a] outline-none transition focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20">
                  <option>Tư vấn sản phẩm</option>
                  <option>Tư vấn doanh nghiệp</option>
                  <option>Hợp tác API</option>
                  <option>Khác</option>
                </select>
              </label>
            </div>
            <label className="mt-4 grid gap-2 text-[13px] font-black">
              Nội dung *
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Bạn muốn Vbee hỗ trợ hoặc tư vấn điều gì?" rows={6} className="resize-y rounded-xl border border-[#ddd5ef] bg-white px-3 py-3 text-[13px] font-medium leading-6 text-[#21104a] outline-none transition placeholder:text-[#9a90ad] focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20" />
            </label>

            {notice && (
              <p className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${status === "success" ? "bg-[#edfbf1] text-[#17683a]" : "bg-[#fff0f0] text-[#a62c2c]"}`}>
                {status === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                {notice}
              </p>
            )}

            <button disabled={status === "sending"} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffcb05] px-5 py-3 text-[13px] font-black text-[#21104a] transition hover:bg-[#ffdc45] disabled:cursor-not-allowed disabled:opacity-60">
              {status === "sending" ? "Đang gửi..." : "Gửi thông tin của bạn"}
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </section>

      <section className="bg-[#f7f5ff] px-4 py-10 md:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
          {[
            [Clock3, "Tiếp nhận rõ ràng", "Mọi yêu cầu gửi từ form được tạo thành hồ sơ để theo dõi."],
            [MessageCircle, "Đúng nhu cầu", "Chọn đúng mục đích liên hệ giúp Vbee phân loại nhanh hơn."],
            [Headphones, "Có kênh hỗ trợ", "Vấn đề thao tác, thời lượng hoặc API có trang hỗ trợ riêng."],
          ].map(([Icon, title, text]) => {
            const ItemIcon = Icon as typeof Clock3;
            return (
              <div key={String(title)} className="flex gap-3 rounded-xl border border-[#e8e1f5] bg-white p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#fff3a6] text-[#21104a]">
                  <ItemIcon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-sm font-black">{title as string}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#6a5a8f]">{text as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <VbeePublicFooter />
    </main>
  );
}

function Field({
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
