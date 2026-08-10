import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Handshake,
  HeartHandshake,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Waves,
} from "lucide-react";
import {
  VbeePublicFooter,
  VbeePublicHeader,
} from "@/components/vbee-public-chrome";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "Về không gian giọng nói Vbee" },
      {
        name: "description",
        content:
          "Tầm nhìn, sứ mệnh và nguyên tắc xây dựng không gian giọng nói Vbee.",
      },
    ],
  }),
  component: AboutPage,
});

const VALUES = [
  {
    icon: HeartHandshake,
    title: "Lấy người dùng làm trung tâm",
    text: "Mỗi thao tác từ tải tệp đến xuất văn bản đều cần rõ ràng, nhanh và có phản hồi cho người dùng.",
  },
  {
    icon: ShieldCheck,
    title: "Tôn trọng dữ liệu",
    text: "Tệp, bản ghi và lịch sử xử lý được gắn với tài khoản để người dùng chủ động quản lý.",
  },
  {
    icon: Lightbulb,
    title: "Công nghệ có ích",
    text: "AI chỉ thật sự có giá trị khi biến cuộc trò chuyện thành thông tin có thể tiếp tục sử dụng.",
  },
  {
    icon: UsersRound,
    title: "Cùng phát triển",
    text: "Sản phẩm được hoàn thiện dựa trên phản hồi của người dùng, đội vận hành và đối tác triển khai.",
  },
];

const PRINCIPLES = [
  ["01", "Rõ trạng thái", "Mọi tệp và bản ghi đều cho biết đang chờ, xử lý, hoàn tất hay cần người dùng thao tác."],
  ["02", "Dễ kiểm soát", "Người dùng nhìn thấy thời lượng còn lại, giới hạn gói cước và lịch sử văn bản của mình."],
  ["03", "Sẵn sàng tích hợp", "Đăng nhập là điểm bắt đầu; API giúp doanh nghiệp đưa giọng nói vào quy trình riêng."],
];

function AboutPage() {
  return (
    <main className="min-h-screen bg-white text-[#21104a]">
      <VbeePublicHeader />

      <section className="relative overflow-hidden bg-[#21104a] px-4 py-14 text-white md:px-6 md:py-20">
        <div className="absolute left-1/2 top-0 h-80 w-80 -translate-x-1/2 rounded-full bg-[#ffcb05]/20 blur-3xl" />
        <div className="absolute inset-0 opacity-20 vbee-foundation-grid" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-[#ffdc45]">
              <Sparkles className="h-4 w-4 text-[#ffcb05]" /> Về Vbee
            </span>
            <h1 className="mt-5 max-w-3xl text-2xl font-black leading-tight md:text-3xl">
              Đưa giọng nói vào quy trình làm việc hằng ngày.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              Không gian giọng nói Vbee được xây dựng để đội ngũ có thể biến âm thanh,
              hình ảnh động và cuộc họp thành văn bản có cấu trúc, dễ tìm kiếm và sẵn
              sàng chia sẻ.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-5 py-2.5 text-[13px] font-black text-[#21104a] shadow-[0_14px_35px_rgba(255,203,5,.3)] transition hover:-translate-y-0.5 hover:bg-[#ffdc45]"
              >
                Liên hệ Vbee <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/pricing"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-2.5 text-[13px] font-black text-white transition hover:bg-white/20"
              >
                Xem gói dịch vụ
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/12 bg-white/10 p-5 backdrop-blur">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#ffcb05] text-[#21104a]">
                <Waves className="h-6 w-6" />
              </span>
              <p className="mt-5 text-xl font-black">Giọng nói</p>
              <p className="mt-2 text-sm leading-6 text-white/70">
                Là đầu vào tự nhiên nhất của cuộc trò chuyện và tri thức nội bộ.
              </p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white p-5 text-[#21104a] shadow-[0_20px_60px_rgba(0,0,0,.18)] sm:translate-y-8">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#f3efff] text-[#21104a]">
                <BrainCircuit className="h-6 w-6" />
              </span>
              <p className="mt-5 text-xl font-black">Dữ liệu</p>
              <p className="mt-2 text-sm leading-6 text-[#6a5a8f]">
                Được tổ chức thành văn bản để tiếp tục tra cứu, dịch và xuất.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2">
          <article className="rounded-2xl border border-[#e8e1f5] bg-[#f8f6ff] p-6 md:p-8">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#21104a] text-[#ffcb05]">
              <Lightbulb className="h-6 w-6" />
            </span>
            <p className="mt-6 text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">
              Tầm nhìn
            </p>
            <h2 className="mt-3 text-2xl font-black leading-tight md:text-3xl">
              Để tri thức trong mỗi cuộc trò chuyện không bị bỏ lỡ.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#6a5a8f]">
              Cuộc họp, phỏng vấn và nội dung sáng tạo chứa nhiều quyết định quan
              trọng. Vbee giúp biến những khoảnh khắc đó thành dữ liệu có thể tìm
              lại và dùng tiếp.
            </p>
          </article>
          <article className="rounded-2xl border border-[#e8e1f5] bg-white p-6 md:p-8">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#fff3a6] text-[#21104a]">
              <Handshake className="h-6 w-6" />
            </span>
            <p className="mt-6 text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">
              Sứ mệnh
            </p>
            <h2 className="mt-3 text-2xl font-black leading-tight md:text-3xl">
              Tạo trải nghiệm chuyển giọng nói thành văn bản đơn giản và đáng tin cậy.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#6a5a8f]">
              Từ người dùng cá nhân đến đội ngũ doanh nghiệp, sản phẩm tập trung
              vào thao tác rõ ràng, trạng thái minh bạch và khả năng tích hợp theo
              nhu cầu.
            </p>
          </article>
        </div>
      </section>

      <section className="bg-[#f7f5ff] px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">
              Giá trị cốt lõi
            </p>
            <h2 className="mt-3 text-2xl font-black md:text-3xl">
              Những nguyên tắc định hình sản phẩm.
            </h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((value) => {
              const Icon = value.icon;
              return (
                <article key={value.title} className="rounded-2xl border border-[#e8e1f5] bg-white p-5 shadow-[0_12px_35px_rgba(33,16,74,.05)]">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff3a6] text-[#21104a]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-black">{value.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#6a5a8f]">{value.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">
            Cách Vbee thiết kế sản phẩm
          </p>
          <h2 className="mt-3 max-w-3xl text-2xl font-black leading-tight md:text-3xl">
            Một quy trình đơn giản để người dùng luôn biết điều gì đang diễn ra.
          </h2>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {PRINCIPLES.map(([number, title, text]) => (
              <article key={number} className="border-t-2 border-[#ffcb05] pt-5">
                <p className="text-sm font-black text-[#8a7100]">{number}</p>
                <h3 className="mt-3 text-lg font-black">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-[#6a5a8f]">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#21104a] px-4 py-14 text-white md:px-6">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 md:flex-row md:items-center">
          <div>
            <span className="inline-flex items-center gap-2 text-sm font-black text-[#ffcb05]">
              <BadgeCheck className="h-5 w-5" /> Kết nối cùng Vbee
            </span>
            <h2 className="mt-3 text-2xl font-black md:text-3xl">Cần tư vấn cho đội ngũ của bạn?</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/68">
              Gửi nhu cầu sử dụng, tích hợp hoặc triển khai. Đội ngũ Vbee sẽ phản
              hồi qua kênh liên hệ bạn để lại.
            </p>
          </div>
          <Link to="/contact" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 py-2.5 text-[13px] font-black text-[#21104a] transition hover:bg-[#ffdc45]">
            Liên hệ tư vấn <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <VbeePublicFooter />
    </main>
  );
}
