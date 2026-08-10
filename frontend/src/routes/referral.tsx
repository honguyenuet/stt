import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Gift,
  Link2,
  Send,
  Share2,
  Sparkles,
  UserPlus,
  UsersRound,
} from "lucide-react";
import {
  VbeePublicFooter,
  VbeePublicHeader,
} from "@/components/vbee-public-chrome";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

type ReferralSummary = {
  referralCode: string;
  rewardMinutes: number;
  rewardValidDays: number;
  joinedCount: number;
  pendingCount: number;
  rewardedCount: number;
  earnedMinutes: number;
  availableMinutes: number;
  nextExpiry: string | null;
};

export const Route = createFileRoute("/referral")({
  head: () => ({
    meta: [
      { title: "Giới thiệu bạn bè | Vbee AIVoice" },
      {
        name: "description",
        content:
          "Mời bạn bè trải nghiệm Vbee và nhận thêm thời lượng chuyển giọng nói thành văn bản.",
      },
    ],
  }),
  component: ReferralPage,
});

const STEPS = [
  {
    number: "01",
    icon: Link2,
    title: "Tạo và gửi liên kết giới thiệu",
    text: "Sao chép liên kết riêng của bạn và gửi tới bạn bè, đồng đội hoặc khách hàng cần xử lý âm thanh hoặc nội dung nghe nhìn.",
  },
  {
    number: "02",
    icon: UserPlus,
    title: "Người dùng mới tham gia",
    text: "Người nhận đăng ký bằng liên kết, kích hoạt tài khoản và bắt đầu trải nghiệm Vbee.",
  },
  {
    number: "03",
    icon: Gift,
    title: "Nhận thời lượng thưởng",
    text: "Khi điều kiện chương trình hoàn tất, thời lượng thưởng được cộng vào tài khoản Vbee của bạn.",
  },
];

const FAQS = [
  {
    question: "Tôi có thể gửi liên kết giới thiệu cho ai?",
    answer:
      "Bạn có thể chia sẻ cho bạn bè, đồng đội hoặc khách hàng mới chưa có tài khoản Vbee.",
  },
  {
    question: "Người được mời nhận được gì?",
    answer:
      "Người mới nhận 30 phút dùng thử để tải tệp, ghi âm hoặc dùng Realtime.",
  },
  {
    question: "Khi nào thời lượng thưởng được cộng?",
    answer:
      "100 phút được cộng cho người mời sau khi người được mời hoàn thành văn bản đầu tiên. Thời lượng thưởng có hiệu lực 90 ngày.",
  },
  {
    question: "Tôi xem lịch sử giới thiệu ở đâu?",
    answer:
      "Trạng thái lời mời và thời lượng thưởng sẽ hiển thị trong khu vực tài khoản khi chương trình được kích hoạt.",
  },
];

function ReferralPage() {
  const { user, token } = useAuth();
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const referralCode =
    summary?.referralCode ||
    (user ? `VBEE-${String(user.id).padStart(6, "0")}` : "VBEE-FRIEND");

  useEffect(() => {
    if (!token) {
      setSummary(null);
      return;
    }

    let active = true;
    async function loadSummary() {
      try {
        const response = await fetch(`${API_URL}/api/referrals/me`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await response.json()) as ReferralSummary & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || "Không tải được dữ liệu giới thiệu");
        }
        if (active) {
          setSummary(data);
          setSummaryError("");
        }
      } catch (error) {
        if (active) {
          setSummaryError(
            error instanceof Error
              ? error.message
              : "Không tải được dữ liệu giới thiệu",
          );
        }
      }
    }

    void loadSummary();
    const refreshTimer = window.setInterval(() => {
      void loadSummary();
    }, 15_000);

    function refreshOnFocus() {
      void loadSummary();
    }
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [token]);

  function invitationLink() {
    return `${window.location.origin}/register?ref=${referralCode}`;
  }

  async function copyReferralLink() {
    try {
      await navigator.clipboard.writeText(invitationLink());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  }

  async function shareReferralLink() {
    if (typeof navigator.share !== "function") {
      await copyReferralLink();
      return;
    }

    try {
      await navigator.share({
        title: "Trải nghiệm Vbee AIVoice",
        text: "Mời bạn trải nghiệm chuyển giọng nói thành văn bản cùng Vbee.",
        url: invitationLink(),
      });
      setShared(true);
      window.setTimeout(() => setShared(false), 2400);
    } catch {
      // Người dùng có thể đóng hộp chia sẻ gốc của thiết bị mà không cần báo lỗi.
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f5ff] text-[#21104a]">
      <VbeePublicHeader />

      <section className="relative overflow-hidden bg-[#21104a] px-4 py-12 text-white md:px-6 md:py-16">
        <div className="absolute inset-0 opacity-20 vbee-foundation-grid" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-9 lg:grid-cols-[1.08fr_.92fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase text-[#ffdc45]">
              <Sparkles className="h-4 w-4 text-[#ffcb05]" /> Giới thiệu Vbee
            </span>
            <h1 className="mt-5 max-w-2xl text-3xl font-black leading-tight md:text-4xl">
              Cùng nhau nhận thêm thời lượng sử dụng Vbee.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/74">
              Gửi lời mời tới những người đang cần chuyển âm thanh, nội dung nghe nhìn và cuộc họp thành văn bản. Khi họ bắt đầu cùng Vbee, bạn nhận thêm thời lượng cho công việc tiếp theo.
            </p>

            {user ? (
              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void copyReferralLink()}
                  className="inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3 text-sm font-black text-[#21104a] shadow-[0_14px_35px_rgba(255,203,5,.3)] transition hover:bg-[#ffdc45]"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Đã sao chép liên kết" : "Sao chép liên kết"}
                </button>
                <button
                  type="button"
                  onClick={() => void shareReferralLink()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:bg-white/20"
                >
                  {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                  {shared ? "Đã mở chia sẻ" : "Chia sẻ ngay"}
                </button>
              </div>
            ) : (
              <Link
                to="/register"
                search={{ from: undefined, ref: undefined }}
                className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3 text-sm font-black text-[#21104a] shadow-[0_14px_35px_rgba(255,203,5,.3)] transition hover:bg-[#ffdc45]"
              >
                Tạo liên kết giới thiệu <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>

          <div className="rounded-2xl border border-white/14 bg-white p-5 text-[#21104a] shadow-[0_24px_70px_rgba(4,0,27,.28)] md:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-[#eee8ff] pb-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-[#ffdc45] text-[#21104a]">
                  <UsersRound className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-black">Lời mời của bạn</p>
                  <p className="mt-0.5 text-xs font-semibold text-[#756894]">Sẵn sàng chia sẻ cùng Vbee</p>
                </div>
              </div>
              <span className="rounded-full bg-[#fff8d7] px-3 py-1 text-xs font-black text-[#725a00]">
                {summary?.rewardMinutes ?? 100} phút/lượt
              </span>
            </div>

            <div className="mt-5 rounded-xl border border-[#e8decc] bg-[#fbf8ef] p-4">
              <p className="text-xs font-black text-[#756894]">Mã giới thiệu</p>
              <p className="mt-1 font-mono text-lg font-black text-[#21104a]">{referralCode}</p>
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs font-bold text-[#6a5a8f]">
                <span>{summary?.pendingCount ?? 0} đang chờ</span>
                <span>{summary?.rewardedCount ?? 0} đã nhận thưởng</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#756894]">Mỗi lời mời đủ điều kiện sẽ mở thêm thời lượng cho tài khoản của bạn.</p>
              {summaryError && (
                <p className="mt-2 text-xs font-semibold text-red-600">
                  {summaryError}
                </p>
              )}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <ReferralMetric
                label="Đã tham gia"
                value={String(summary?.joinedCount ?? 0)}
              />
              <ReferralMetric
                label="Đã nhận"
                value={`${summary?.earnedMinutes ?? 0} phút`}
              />
              <ReferralMetric
                label="Còn hiệu lực"
                value={`${summary?.availableMinutes ?? 0} phút`}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase text-[#8a7100]">Ba bước đơn giản</p>
            <h2 className="mt-3 text-2xl font-black md:text-3xl">Mời bạn bè, nhận thêm thời lượng.</h2>
            <p className="mt-3 text-sm leading-7 text-[#6a5a8f]">Luồng giới thiệu được thiết kế rõ ràng để cả người gửi và người nhận đều biết bước tiếp theo của mình.</p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <article key={step.number} className="rounded-xl border border-[#e8e1f5] bg-white p-5 shadow-[0_12px_32px_rgba(33,16,74,.05)]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-black text-[#8a7100]">{step.number}</span>
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#fff3a6] text-[#21104a]">
                      <Icon className="h-5 w-5" />
                    </span>
                  </div>
                  <h3 className="mt-5 text-lg font-black">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#6a5a8f]">{step.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[.94fr_1.06fr]">
          <div className="rounded-2xl bg-[#21104a] p-6 text-white md:p-7">
            <Clock3 className="h-6 w-6 text-[#ffcb05]" />
            <p className="mt-5 text-xs font-black uppercase text-[#ffcb05]">Thưởng theo hành trình</p>
            <h2 className="mt-3 text-2xl font-black leading-tight">Cộng thêm thời lượng khi lời mời bắt đầu sử dụng.</h2>
            <p className="mt-3 text-sm leading-7 text-white/70">Vbee ưu tiên phần thưởng có thể sử dụng ngay để tải tệp, ghi âm và chuyển đổi văn bản.</p>
          </div>
          <div className="rounded-2xl border border-[#e8e1f5] bg-white p-6 md:p-7">
            <p className="text-xs font-black uppercase text-[#8a7100]">Quyền lợi chương trình</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Benefit title="Người gửi" text="Nhận 100 phút sau văn bản đầu tiên của người được mời." />
              <Benefit title="Người nhận" text="Bắt đầu với 30 phút dùng thử và các tính năng cốt lõi." />
              <Benefit title="Theo dõi rõ ràng" text="Xem mã giới thiệu và tiến độ lời mời ngay trong tài khoản." />
              <Benefit title="Dùng cho công việc" text="Dùng phần thưởng cho âm thanh, nội dung nghe nhìn, ghi âm và Realtime." />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-4xl">
          <div className="text-center">
            <p className="text-xs font-black uppercase text-[#8a7100]">Câu hỏi thường gặp</p>
            <h2 className="mt-3 text-2xl font-black md:text-3xl">Hiểu chương trình trong vài phút.</h2>
          </div>
          <div className="mt-8 divide-y divide-[#eee8ff] rounded-xl border border-[#e8e1f5] bg-white px-5">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-black text-[#21104a]">
                  {faq.question}
                  <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
                </summary>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-[#6a5a8f]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-5 rounded-2xl border border-[#e8e1f5] bg-[#fff9d7] px-6 py-7 text-center md:flex-row md:text-left">
          <div>
            <h2 className="text-xl font-black">Sẵn sàng gửi lời mời đầu tiên?</h2>
            <p className="mt-2 text-sm leading-6 text-[#6a5a8f]">Mời thêm người cùng làm việc với giọng nói và văn bản trên Vbee.</p>
          </div>
          {user ? (
            <button type="button" onClick={() => void copyReferralLink()} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#21104a] px-5 py-3 text-sm font-black text-white transition hover:bg-[#32166f]">
              <Send className="h-4 w-4" /> {copied ? "Đã sao chép" : "Gửi lời mời"}
            </button>
          ) : (
            <Link
              to="/register"
              search={{ from: undefined, ref: undefined }}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#21104a] px-5 py-3 text-sm font-black text-white transition hover:bg-[#32166f]"
            >
              Đăng ký miễn phí <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </section>

      <VbeePublicFooter />
    </main>
  );
}

function ReferralMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-[#eee8ff] pl-3 first:border-l-0 first:pl-0">
      <p className="text-xs font-semibold text-[#756894]">{label}</p>
      <p className="mt-1 text-sm font-black text-[#21104a]">{value}</p>
    </div>
  );
}

function Benefit({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#fff3a6] text-[#21104a]">
        <Check className="h-3 w-3" />
      </span>
      <div>
        <h3 className="text-sm font-black">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-[#6a5a8f]">{text}</p>
      </div>
    </div>
  );
}
