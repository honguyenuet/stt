import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Crown,
  FileAudio,
  Gift,
  Headphones,
  HelpCircle,
  Mail,
  Minus,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Star,
  UploadCloud,
  Zap,
} from "lucide-react";
import vbeeLogo from "@/assets/vbee-logo.png";
import { VbeePublicHeader } from "@/components/vbee-public-chrome";
import { useAuth } from "@/context/AuthContext";
import {
  createCheckout,
  createTopUpCheckout,
  fetchBillingCatalog,
  type BillingCatalog,
  type TopUpCode,
} from "@/lib/billing";
import { type PlanCode } from "@/lib/quota";
import {
  clearPendingPlanPurchase,
  getPendingPlanPurchase,
  savePendingPlanPurchase,
} from "@/lib/plan-purchase";

type BillingCycle = "monthly" | "yearly";
type CompareValue = string | boolean;

type Plan = {
  code: PlanCode;
  name: string;
  label: string;
  desc: string;
  price: string;
  unit: string;
  minutes: string;
  badge?: string;
  saving?: string;
  highlight?: boolean;
  cta: string;
  features: string[];
};

type TopUp = {
  code: TopUpCode;
  hours: string;
  price: string;
  desc: string;
  popular?: boolean;
};

function formatVnd(value: number | null | undefined) {
  return Number.isFinite(value)
    ? `${new Intl.NumberFormat("vi-VN").format(Number(value))}đ`
    : "Liên hệ";
}

function formatQuotaHours(seconds: number, yearly: boolean) {
  const hours = Math.round(seconds / 3600);
  return `${hours} giờ${yearly ? "/năm" : ""}`;
}

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Bảng giá Vbee AIVoice — Theo tháng và theo năm" },
      {
        name: "description",
        content:
          "Bảng giá Vbee AIVoice với lựa chọn thanh toán theo tháng và theo năm cho nhu cầu chuyển giọng nói thành văn bản.",
      },
      { property: "og:title", content: "Bảng giá Vbee AIVoice" },
      {
        property: "og:description",
        content:
          "So sánh gói Theo lượt, Tiêu chuẩn, Đặc biệt và Chuyên nghiệp cho nền tảng chuyển giọng nói thành văn bản.",
      },
    ],
  }),
  component: PricingPage,
});

const monthlyPlans: Plan[] = [
  {
    code: "standard",
    name: "Tiêu chuẩn",
    label: "Cá nhân dùng ít",
    desc: "Dành cho cá nhân cần xử lý đều đặn với quota hằng tháng và tính năng xuất file đầy đủ.",
    price: "149.000đ",
    unit: "/tháng",
    minutes: "5 giờ",
    cta: "Chọn gói Tiêu chuẩn",
    features: [
      "5 giờ xử lý mỗi tháng",
      "Upload tối đa 300MB",
      "File dài tối đa 3 giờ",
      "Lưu transcript 180 ngày",
      "API có giới hạn",
    ],
  },
  {
    code: "special",
    name: "Đặc biệt",
    label: "Freelancer / Creator",
    desc: "Cho creator, freelancer và người dùng thường xuyên cần nhiều giờ hơn.",
    price: "499.000đ",
    unit: "/tháng",
    minutes: "20 giờ",
    badge: "Khuyên dùng",
    highlight: true,
    cta: "Đăng ký Đặc biệt",
    features: [
      "20 giờ xử lý mỗi tháng",
      "Upload tối đa 1GB",
      "File dài tối đa 4 giờ",
      "API mở rộng và webhook",
      "Nhận diện nhiều người nói",
    ],
  },
  {
    code: "business",
    name: "Chuyên nghiệp",
    label: "Nâng cao",
    desc: "Cho nhóm nhỏ và chuyên gia cần 40 giờ xử lý, tốc độ cao và API đầy đủ.",
    price: "799.000đ",
    unit: "/tháng",
    minutes: "40 giờ",
    cta: "Chọn gói Chuyên nghiệp",
    features: [
      "40 giờ xử lý mỗi tháng",
      "Upload tối đa 2GB",
      "File dài tối đa 10 giờ",
      "API và webhook đầy đủ",
      "Xử lý song song 10 file",
    ],
  },
];

const yearlyPlans: Plan[] = [
  {
    code: "standard",
    name: "Tiêu chuẩn",
    label: "Tiết kiệm",
    desc: "Thanh toán năm cho cá nhân dùng đều đặn và muốn tiết kiệm chi phí.",
    price: "1.490.000đ",
    unit: "/năm",
    minutes: "60 giờ/năm",
    saving: "Tiết kiệm 2 tháng",
    cta: "Chọn gói Tiêu chuẩn",
    features: [
      "Cấp đủ 60 giờ ngay sau thanh toán",
      "Upload tối đa 300MB",
      "File dài tối đa 3 giờ",
      "Lưu transcript 180 ngày",
      "API có giới hạn",
    ],
  },
  {
    code: "special",
    name: "Đặc biệt",
    label: "Tốt nhất",
    desc: "Gói năm tối ưu cho creator và freelancer cần xử lý nhiều file.",
    price: "4.990.000đ",
    unit: "/năm",
    minutes: "240 giờ/năm",
    badge: "Tối ưu nhất",
    saving: "Tiết kiệm 2 tháng",
    highlight: true,
    cta: "Đăng ký Đặc biệt năm",
    features: [
      "Cấp đủ 240 giờ ngay sau thanh toán",
      "Upload tối đa 1GB",
      "File dài tối đa 4 giờ",
      "API mở rộng và webhook",
      "Nhận diện nhiều người nói",
    ],
  },
  {
    code: "business",
    name: "Chuyên nghiệp",
    label: "Nâng cao",
    desc: "Gói năm cho nhóm nhỏ và chuyên gia có khối lượng xử lý lớn.",
    price: "7.990.000đ",
    unit: "/năm",
    minutes: "480 giờ/năm",
    saving: "Tiết kiệm 2 tháng",
    cta: "Chọn gói Chuyên nghiệp",
    features: [
      "Cấp đủ 480 giờ ngay sau thanh toán",
      "Upload tối đa 2GB",
      "File dài tối đa 10 giờ",
      "API, webhook và queue cao nhất",
    ],
  },
];

const topUps: TopUp[] = [
  {
    code: "topup_1h",
    hours: "1 giờ",
    price: "39.000đ",
    desc: "Phù hợp để xử lý một dự án ngắn.",
  },
  {
    code: "topup_3h",
    hours: "3 giờ",
    price: "117.000đ",
    desc: "Linh hoạt cho nhu cầu không thường xuyên.",
  },
  {
    code: "topup_5h",
    hours: "5 giờ",
    price: "195.000đ",
    desc: "Lựa chọn phổ biến cho nhiều file ngắn.",
    popular: true,
  },
  {
    code: "topup_10h",
    hours: "10 giờ",
    price: "390.000đ",
    desc: "Phù hợp cho một chiến dịch nội dung.",
  },
  {
    code: "topup_20h",
    hours: "20 giờ",
    price: "780.000đ",
    desc: "Dành cho khối lượng xử lý trung bình.",
  },
  {
    code: "topup_50h",
    hours: "50 giờ",
    price: "1.950.000đ",
    desc: "Dành cho khối lượng xử lý lớn.",
  },
  {
    code: "topup_100h",
    hours: "100 giờ",
    price: "3.900.000đ",
    desc: "Gói theo lượt lớn nhất có thể mua trực tuyến.",
  },
];

const faqs = [
  {
    q: "Thời lượng mua theo lượt có hết hạn không?",
    a: "Không. Thời lượng theo lượt được giữ trong tài khoản cho đến khi dùng hết, không yêu cầu đăng ký và không có mức sử dụng tối thiểu mỗi tháng.",
  },
  {
    q: "Gói theo tháng và theo năm khác nhau như thế nào?",
    a: "Gói theo tháng linh hoạt, phù hợp dùng ngắn hạn. Gói theo năm có cùng bộ tính năng, được cấp đủ thời lượng của năm và có giá tương đương 10 tháng, tiết kiệm 2 tháng.",
  },
  {
    q: "Hết số phút xử lý thì có dùng tiếp được không?",
    a: "Bạn vẫn vào được tài khoản và xem lịch sử. Để xử lý file mới, bạn cần nâng cấp gói hoặc mua thêm phút xử lý.",
  },
  {
    q: "Có thể xuất file Word không?",
    a: "Có. Theo lượt, Tiêu chuẩn, Đặc biệt và Chuyên nghiệp đều hỗ trợ xuất TXT/DOCX; PDF và SRT/VTT khả dụng từ gói Tiêu chuẩn trở lên.",
  },
  {
    q: "Doanh nghiệp có thể tích hợp API không?",
    a: "Có. Các đơn vị cần số phút lớn, nhiều tài khoản, SLA hoặc hạ tầng riêng có thể gửi yêu cầu để Vbee tư vấn cấu hình và báo giá riêng.",
  },
  {
    q: "Có hoàn tiền khi không dùng hết phút không?",
    a: "Chính sách hoàn tiền và thời hạn sử dụng được áp dụng theo điều khoản dịch vụ tại thời điểm khách hàng đăng ký gói cước.",
  },
];

const featureGroups: Array<{
  title: string;
  rows: Array<{
    feature: string;
    free: CompareValue;
    basic: CompareValue;
    pro: CompareValue;
    business: CompareValue;
  }>;
}> = [
  {
    title: "Thanh toán và quota",
    rows: [
      {
        feature: "Thanh toán",
        free: "Theo lượt",
        basic: "Theo tháng/năm",
        pro: "Theo tháng/năm",
        business: "Theo tháng/năm",
      },
      {
        feature: "Thời lượng xử lý",
        free: "Theo sử dụng",
        basic: "5 giờ/tháng",
        pro: "20 giờ/tháng",
        business: "40 giờ/tháng",
      },
      {
        feature: "Mua thêm giờ",
        free: true,
        basic: true,
        pro: true,
        business: true,
      },
      {
        feature: "Cộng dồn giờ chưa dùng",
        free: false,
        basic: "1 tháng",
        pro: "2 tháng",
        business: "3 tháng",
      },
    ],
  },
  {
    title: "Dung lượng và xử lý",
    rows: [
      {
        feature: "Upload tối đa",
        free: "100MB",
        basic: "300MB",
        pro: "1GB",
        business: "2GB",
      },
      {
        feature: "Thời lượng tối đa mỗi file",
        free: "30 phút",
        basic: "3 giờ",
        pro: "4 giờ",
        business: "10 giờ",
      },
      {
        feature: "Lưu transcript",
        free: "5",
        basic: "100",
        pro: "Không giới hạn",
        business: "Không giới hạn",
      },
      {
        feature: "Lưu trữ",
        free: "30 ngày",
        basic: "180 ngày",
        pro: "1 năm",
        business: "Không giới hạn",
      },
      {
        feature: "Tốc độ xử lý",
        free: "Tiêu chuẩn",
        basic: "Ưu tiên",
        pro: "Ưu tiên cao",
        business: "Cao nhất",
      },
      {
        feature: "Xử lý song song",
        free: "1 file",
        basic: "3 file",
        pro: "5 file",
        business: "10 file",
      },
    ],
  },
  {
    title: "Tính năng transcript",
    rows: [
      {
        feature: "Copy văn bản",
        free: true,
        basic: true,
        pro: true,
        business: true,
      },
      {
        feature: "Xuất TXT",
        free: true,
        basic: true,
        pro: true,
        business: true,
      },
      {
        feature: "Xuất DOCX",
        free: true,
        basic: true,
        pro: true,
        business: true,
      },
      {
        feature: "Xuất PDF",
        free: false,
        basic: true,
        pro: true,
        business: true,
      },
      {
        feature: "Xuất SRT/VTT",
        free: false,
        basic: true,
        pro: true,
        business: true,
      },
      {
        feature: "Dịch đa ngôn ngữ",
        free: false,
        basic: true,
        pro: true,
        business: true,
      },
      {
        feature: "Tóm tắt AI",
        free: false,
        basic: "Giới hạn",
        pro: "Không giới hạn",
        business: "Không giới hạn",
      },
      {
        feature: "Nhận diện người nói",
        free: false,
        basic: true,
        pro: true,
        business: true,
      },
    ],
  },
  {
    title: "Quản trị và hỗ trợ",
    rows: [
      {
        feature: "API",
        free: false,
        basic: "Có giới hạn",
        pro: "Mở rộng",
        business: "Đầy đủ",
      },
      {
        feature: "Webhook",
        free: false,
        basic: false,
        pro: true,
        business: true,
      },
      {
        feature: "Quản lý nhóm",
        free: false,
        basic: false,
        pro: false,
        business: "5 người",
      },
      {
        feature: "Quyền thành viên",
        free: false,
        basic: false,
        pro: false,
        business: true,
      },
      {
        feature: "Nhật ký hoạt động",
        free: false,
        basic: false,
        pro: false,
        business: true,
      },
      {
        feature: "Hỗ trợ",
        free: "Email",
        basic: "Ưu tiên",
        pro: "Ưu tiên",
        business: "Ưu tiên + Chat",
      },
    ],
  },
];

function PricingPage() {
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const [planMessage, setPlanMessage] = useState("");
  const [upgradingPlan, setUpgradingPlan] = useState("");
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const pendingPurchaseStarted = useRef(false);
  const plans = useMemo(() => {
    const basePlans = billing === "monthly" ? monthlyPlans : yearlyPlans;
    return basePlans.map((plan) => {
      const catalogPlan = catalog?.plans.find(
        (item) => item.code === plan.code,
      );
      const cycle = catalogPlan?.[billing];
      return cycle
        ? {
            ...plan,
            price: formatVnd(cycle.price),
            minutes: formatQuotaHours(cycle.quotaSeconds, billing === "yearly"),
          }
        : plan;
    });
  }, [billing, catalog]);
  const resolvedTopUps = useMemo(
    () =>
      topUps.map((product) => {
        const catalogProduct = catalog?.topUps.find(
          (item) => item.code === product.code,
        );
        return catalogProduct
          ? {
              ...product,
              hours: formatQuotaHours(catalogProduct.quotaSeconds, false),
              price: formatVnd(catalogProduct.price),
            }
          : product;
      }),
    [catalog],
  );
  const hourlyPrice =
    resolvedTopUps.find((product) => product.code === "topup_1h")?.price ||
    "39.000đ";

  useEffect(() => {
    let active = true;
    void fetchBillingCatalog()
      .then((nextCatalog) => {
        if (active) setCatalog(nextCatalog);
      })
      .catch(() => {
        if (active) {
          setPlanMessage(
            "Không tải được bảng giá mới nhất. Vui lòng thử lại trước khi thanh toán.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user || !token || pendingPurchaseStarted.current) return;
    const authToken = token;

    const pending = getPendingPlanPurchase();
    if (!pending) return;
    const pendingPurchase = pending;

    pendingPurchaseStarted.current = true;
    setBilling(pendingPurchase.billingCycle);
    setUpgradingPlan(pendingPurchase.planName);
    setPlanMessage(
      `Đang đăng ký gói ${pendingPurchase.planName} đã chọn trước đó...`,
    );

    async function completePendingPurchase() {
      try {
        const checkout = await createCheckout(
          authToken,
          pendingPurchase.plan,
          pendingPurchase.billingCycle,
        );
        clearPendingPlanPurchase();
        void navigate({
          to: "/checkout/$orderId",
          params: { orderId: checkout.order.id },
        });
      } catch (error) {
        pendingPurchaseStarted.current = false;
        setPlanMessage(
          error instanceof Error
            ? error.message
            : "Không tạo được đơn hàng. Vui lòng bấm chọn gói lại.",
        );
      } finally {
        setUpgradingPlan("");
      }
    }

    void completePendingPurchase();
  }, [navigate, token, user]);

  function handleStart() {
    if (user) {
      void navigate({ to: "/upload" });
      return;
    }

    void navigate({
      to: "/login",
      search: { error: undefined, from: "/pricing" },
    });
  }

  async function handleSelectPlan(plan: Plan) {
    setPlanMessage("");

    if (!user || !token) {
      if (
        plan.code === "standard" ||
        plan.code === "special"
      ) {
        savePendingPlanPurchase(plan.code, billing, plan.name);
      }
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/pricing" },
      });
      return;
    }

    if (plan.code === "free") {
      void navigate({ to: "/upload" });
      return;
    }

    setUpgradingPlan(plan.name);
    try {
      if (
        plan.code !== "standard" &&
        plan.code !== "special" &&
        plan.code !== "business"
      ) {
        setPlanMessage("Gói này chưa hỗ trợ thanh toán tự động");
        return;
      }

      const checkout = await createCheckout(token, plan.code, billing);
      void navigate({
        to: "/checkout/$orderId",
        params: { orderId: checkout.order.id },
      });
    } catch (error) {
      setPlanMessage(
        error instanceof Error ? error.message : "Không tạo được đơn hàng",
      );
    } finally {
      setUpgradingPlan("");
    }
  }

  async function handleSelectTopUp(product: TopUp) {
    setPlanMessage("");
    if (!user || !token) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/pricing" },
      });
      return;
    }

    setUpgradingPlan(product.code);
    try {
      const checkout = await createTopUpCheckout(token, product.code);
      void navigate({
        to: "/checkout/$orderId",
        params: { orderId: checkout.order.id },
      });
    } catch (error) {
      setPlanMessage(
        error instanceof Error ? error.message : "Không tạo được đơn mua thêm",
      );
    } finally {
      setUpgradingPlan("");
    }
  }

  return (
    <main className="min-h-screen bg-white text-[#21104a]">
      <VbeePublicHeader />
      <PricingHero billing={billing} setBilling={setBilling} />
      {planMessage && (
        <div className="mx-auto mb-6 max-w-4xl px-4 md:px-6">
          <div className="rounded-2xl border border-[#ffcb05]/50 bg-white px-5 py-4 text-center text-sm font-black text-[#21104a] shadow-[0_16px_55px_rgba(33,16,74,.08)]">
            {planMessage}
          </div>
        </div>
      )}
      <PlanCards
        plans={plans}
        hourlyPrice={hourlyPrice}
        billing={billing}
        upgradingPlan={upgradingPlan}
        onSelectPlan={(plan) => void handleSelectPlan(plan)}
      />
      <TopUpCards
        products={resolvedTopUps}
        hourlyPrice={hourlyPrice}
        busyProduct={upgradingPlan}
        onSelect={(product) => void handleSelectTopUp(product)}
      />
      <PricingValueBand />
      <CompareTable
        billing={billing}
        setBilling={setBilling}
        hourlyPrice={hourlyPrice}
        plans={plans}
      />
      <PricingFaq />
      <EnterpriseCta onStart={handleStart} />
      <PricingFooter />
    </main>
  );
}

function PricingHero({
  billing,
  setBilling,
}: {
  billing: BillingCycle;
  setBilling: (billing: BillingCycle) => void;
}) {
  return (
    <section className="relative overflow-hidden bg-[#21104a] px-4 pb-10 pt-10 text-white md:px-6 md:pb-14 md:pt-12">
      <div className="absolute inset-0 opacity-20 vbee-foundation-grid" />

      <div className="relative mx-auto max-w-7xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-[#ffdc45]">
          <Sparkles className="h-4 w-4 text-[#ffcb05]" /> Bảng giá dịch vụ
        </div>
        <h1 className="mx-auto mt-5 max-w-3xl text-2xl font-black leading-tight tracking-tight text-white md:text-3xl lg:text-4xl">
          Chọn gói Vbee AIVoice phù hợp với nhu cầu của bạn
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/72">
          Chọn gói theo thời lượng xử lý, nhu cầu xuất dữ liệu và mức độ hỗ trợ.
          Bạn có thể chuyển giữa giá theo tháng và theo năm.
        </p>

        <BillingToggle
          billing={billing}
          setBilling={setBilling}
          className="mt-8"
        />
        <p className="mt-4 text-xs font-bold text-white/70">
          Tài khoản mới được tặng 30 phút dùng thử một lần. Không cần thẻ thanh
          toán.
        </p>

        <div className="mx-auto mt-6 grid max-w-3xl gap-3 text-left md:grid-cols-3">
          {[
            [Clock3, "Linh hoạt", "Nâng cấp hoặc đổi gói theo nhu cầu xử lý."],
            [
              ShieldCheck,
              "Bảo mật",
              "Lịch sử và file được gắn với tài khoản đăng nhập.",
            ],
            [Gift, "Tiết kiệm", "Gói năm phù hợp người dùng thường xuyên."],
          ].map(([Icon, title, desc]) => {
            const TypedIcon = Icon as typeof Clock3;
            return (
              <div
                key={String(title)}
                className="rounded-2xl border border-white/15 bg-white/10 p-4"
              >
                <TypedIcon className="h-5 w-5 text-[#ffcb05]" />
                <p className="mt-3 font-black text-white">{title as string}</p>
                <p className="mt-1 text-xs leading-5 text-white/65">
                  {desc as string}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BillingToggle({
  billing,
  setBilling,
  className = "",
}: {
  billing: BillingCycle;
  setBilling: (billing: BillingCycle) => void;
  className?: string;
}) {
  const itemClass =
    "relative z-10 rounded-full px-5 py-2.5 text-[13px] font-black transition md:px-7";

  return (
    <div
      className={`inline-flex rounded-full border border-[#e8decc] bg-white p-1 shadow-[0_16px_45px_rgba(33,16,74,.08)] ${className}`}
    >
      <button
        type="button"
        onClick={() => setBilling("monthly")}
        className={`${itemClass} ${billing === "monthly" ? "bg-[#21104a] text-white shadow-[0_10px_30px_rgba(33,16,74,.22)]" : "text-[#6a5a8f] hover:text-[#21104a]"}`}
      >
        Theo tháng
      </button>
      <button
        type="button"
        onClick={() => setBilling("yearly")}
        className={`${itemClass} ${billing === "yearly" ? "bg-[#ffcb05] text-[#21104a] shadow-[0_10px_30px_rgba(255,203,5,.32)]" : "text-[#6a5a8f] hover:text-[#21104a]"}`}
      >
        Theo năm{" "}
        <span className="ml-1 hidden rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black text-[#7a5d00] sm:inline">
          tiết kiệm
        </span>
      </button>
    </div>
  );
}

function PlanCards({
  plans,
  hourlyPrice,
  billing,
  upgradingPlan,
  onSelectPlan,
}: {
  plans: Plan[];
  hourlyPrice: string;
  billing: BillingCycle;
  upgradingPlan: string;
  onSelectPlan: (plan: Plan) => void;
}) {
  return (
    <section id="plans" className="px-4 py-12 md:px-6 md:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-black uppercase tracking-wide text-[#9a7b00]">
              {billing === "monthly"
                ? "Bảng giá theo tháng"
                : "Bảng giá theo năm"}
            </p>
            <h2 className="mt-2 text-xl font-black text-[#21104a] md:text-3xl">
              {billing === "monthly"
                ? "Thanh toán linh hoạt hàng tháng"
                : "Thanh toán năm tiết kiệm hơn"}
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-[#6a5a8f]">
            Mua theo lượt khi nhu cầu không đều, hoặc đăng ký thuê bao để có
            quota định kỳ và được ưu tiên xử lý nhanh hơn.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <article className="relative flex min-h-[460px] flex-col rounded-2xl border border-[#eee4d3] bg-white p-5 text-[#21104a] shadow-[0_14px_45px_rgba(33,16,74,.06)] transition hover:-translate-y-1">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="rounded-full bg-[#fff7c2] px-3 py-1 text-[11px] font-black uppercase tracking-wide text-[#725a00]">
                  Không thuê bao
                </span>
                <h3 className="mt-5 text-2xl font-black">Trả theo giờ</h3>
              </div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f7f3ff] text-[#21104a]">
                <Clock3 className="h-5 w-5" />
              </div>
            </div>

            <p className="mt-4 min-h-[72px] text-sm leading-6 text-[#6a5a8f]">
              Chỉ trả tiền cho số giờ cần dùng. Không có quota thuê bao cố định
              hoặc cộng dồn giờ theo chu kỳ.
            </p>

            <div className="mt-5 rounded-2xl border border-current/10 p-4">
              <p className="text-xs font-bold text-[#6a5a8f]">Thời lượng</p>
              <p className="mt-1 text-lg font-black">Từ 1 giờ</p>
            </div>

            <div className="mt-6 flex items-end gap-1">
              <span className="text-2xl font-black tracking-tight md:text-3xl">
                {hourlyPrice}
              </span>
              <span className="pb-1 text-sm font-bold text-[#6a5a8f]">
                /giờ
              </span>
            </div>
            <p className="mt-2 text-xs text-[#9b90ad]">Không phí duy trì</p>

            <a
              href="#pay-as-you-go"
              className="mt-6 w-full rounded-full bg-[#21104a] px-5 py-3 text-center text-sm font-black text-white transition hover:bg-[#30116b]"
            >
              Chọn số giờ
            </a>

            <div className="mt-6 space-y-3">
              {[
                "Không yêu cầu đăng ký",
                "Không có mức dùng tối thiểu",
                "Theo sử dụng, không cộng dồn chu kỳ",
                "Thanh toán trực tuyến qua PayOS",
              ].map((feature) => (
                <div
                  key={feature}
                  className="flex items-start gap-3 text-sm font-semibold leading-6"
                >
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#17b26a]" />
                  <span className="text-[#4d3c75]">{feature}</span>
                </div>
              ))}
            </div>
          </article>

          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`relative flex min-h-[460px] flex-col rounded-2xl border p-5 shadow-[0_14px_45px_rgba(33,16,74,.06)] transition hover:-translate-y-1 ${
                plan.highlight
                  ? "border-[#ffcb05] bg-[#21104a] text-white shadow-[0_20px_70px_rgba(33,16,74,.18)]"
                  : "border-[#eee4d3] bg-white text-[#21104a]"
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#ffcb05] px-4 py-1.5 text-xs font-black text-[#21104a] shadow-[0_10px_30px_rgba(255,203,5,.35)]">
                  {plan.badge}
                </div>
              )}

              <div className="flex items-start justify-between gap-4">
                <div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide ${plan.highlight ? "bg-white/10 text-[#ffcb05]" : "bg-[#fff7c2] text-[#725a00]"}`}
                  >
                    {plan.label}
                  </span>
                  <h3 className="mt-5 text-2xl font-black">{plan.name}</h3>
                </div>
                <div
                  className={`grid h-11 w-11 place-items-center rounded-2xl ${plan.highlight ? "bg-[#ffcb05] text-[#21104a]" : "bg-[#f7f3ff] text-[#21104a]"}`}
                >
                  {plan.highlight ? (
                    <Crown className="h-5 w-5" />
                  ) : (
                    <FileAudio className="h-5 w-5" />
                  )}
                </div>
              </div>

              <p
                className={`mt-4 min-h-[72px] text-sm leading-6 ${plan.highlight ? "text-white/70" : "text-[#6a5a8f]"}`}
              >
                {plan.desc}
              </p>

              <div className="mt-5 rounded-2xl border border-current/10 p-4">
                <p
                  className={`text-xs font-bold ${plan.highlight ? "text-white/60" : "text-[#6a5a8f]"}`}
                >
                  Thời lượng
                </p>
                <p className="mt-1 text-lg font-black">{plan.minutes}</p>
              </div>

              <div className="mt-6 flex items-end gap-1">
                <span className="text-2xl font-black tracking-tight md:text-3xl">
                  {plan.price}
                </span>
                {plan.unit && (
                  <span
                    className={`pb-1 text-sm font-bold ${plan.highlight ? "text-white/60" : "text-[#6a5a8f]"}`}
                  >
                    {plan.unit}
                  </span>
                )}
              </div>

              {plan.saving ? (
                <p
                  className={`mt-2 text-xs font-black ${plan.highlight ? "text-[#ffcb05]" : "text-[#9a7b00]"}`}
                >
                  {plan.saving}
                </p>
              ) : (
                <p
                  className={`mt-2 text-xs ${plan.highlight ? "text-white/50" : "text-[#9b90ad]"}`}
                >
                  Không phí cài đặt
                </p>
              )}

              <button
                onClick={() => onSelectPlan(plan)}
                disabled={upgradingPlan === plan.name}
                className={`mt-6 w-full rounded-full px-5 py-3 text-sm font-black transition ${
                  plan.highlight
                    ? "bg-[#ffcb05] text-[#21104a] hover:bg-[#ffd842]"
                    : "bg-[#21104a] text-white hover:bg-[#30116b]"
                } disabled:cursor-not-allowed disabled:opacity-65`}
              >
                {upgradingPlan === plan.name ? "Đang nâng cấp..." : plan.cta}
              </button>

              <div className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <div
                    key={feature}
                    className="flex items-start gap-3 text-sm font-semibold leading-6"
                  >
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#17b26a]" />
                    <span
                      className={
                        plan.highlight ? "text-white/78" : "text-[#4d3c75]"
                      }
                    >
                      {feature}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function TopUpCards({
  products,
  hourlyPrice,
  busyProduct,
  onSelect,
}: {
  products: TopUp[];
  hourlyPrice: string;
  busyProduct: string;
  onSelect: (product: TopUp) => void;
}) {
  const [selectedCode, setSelectedCode] = useState<TopUpCode>("topup_5h");
  const selectedProduct =
    products.find((product) => product.code === selectedCode) ?? products[0];

  if (!selectedProduct) return null;

  return (
    <section
      id="pay-as-you-go"
      className="border-y border-[#eee8ff] bg-[#f7f5ff] px-4 py-10 md:px-6 md:py-14"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid overflow-hidden rounded-2xl border border-[#e7def5] bg-white shadow-[0_18px_60px_rgba(33,16,74,.1)] lg:grid-cols-[.8fr_1.2fr]">
          <div className="bg-[#21104a] p-6 text-white md:p-8 lg:p-10">
            <p className="text-xs font-black uppercase tracking-wide text-[#ffcb05]">
              Thanh toán theo từng lần sử dụng
            </p>
            <h2 className="mt-4 text-2xl font-black leading-tight md:text-3xl">
              Mua đúng số giờ bạn cần
            </h2>
            <p className="mt-4 text-sm leading-7 text-white/72">
              Phù hợp với dự án không thường xuyên. Không cần đăng ký thuê bao,
              không yêu cầu mức sử dụng tối thiểu hằng tháng.
            </p>

            <div className="mt-7 space-y-4 border-t border-white/15 pt-6 text-sm font-semibold text-white/82">
              {[
                `${hourlyPrice} cho mỗi giờ chuyển đổi`,
                "Không có quota thuê bao cố định",
                "Cộng trực tiếp vào quota hiện có",
                "Thanh toán QR ngay trên website",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#ffcb05]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 md:p-8 lg:p-10">
            <p className="text-sm font-black text-[#21104a]">
              Chọn số giờ phù hợp
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {products.map((product) => {
                const selected = product.code === selectedProduct.code;
                return (
                  <button
                    key={product.code}
                    type="button"
                    onClick={() => setSelectedCode(product.code)}
                    className={`relative rounded-full border px-4 py-3 text-sm font-black transition ${
                      selected
                        ? "border-[#21104a] bg-[#21104a] text-white shadow-[0_10px_30px_rgba(33,16,74,.2)]"
                        : "border-[#e7def5] bg-white text-[#21104a] hover:border-[#ffcb05]"
                    }`}
                    aria-pressed={selected}
                  >
                    {product.popular && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-[#ffcb05] px-2 py-0.5 text-[9px] font-black uppercase text-[#21104a]">
                        Phổ biến
                      </span>
                    )}
                    {product.hours}
                  </button>
                );
              })}
            </div>

            <div className="mt-7 border-y border-[#eee8ff] py-5">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-[#9a7b00]">
                    Gói đã chọn
                  </p>
                  <p className="mt-2 text-xl font-black text-[#21104a]">
                    {selectedProduct.hours}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#6a5a8f]">
                    {selectedProduct.desc}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-[#6a5a8f]">
                    Tổng thanh toán
                  </p>
                  <p className="mt-2 text-2xl font-black text-[#21104a]">
                    {selectedProduct.price}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSelect(selectedProduct)}
              disabled={busyProduct === selectedProduct.code}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3.5 text-sm font-black text-[#21104a] transition hover:bg-[#ffd842] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyProduct === selectedProduct.code
                ? "Đang tạo đơn thanh toán..."
                : `Tiếp tục thanh toán · ${selectedProduct.price}`}
              <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs font-bold text-[#8d829f]">
              <ShieldCheck className="h-4 w-4 text-[#17b26a]" /> Thanh toán an
              toàn qua PayOS by Casso
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingValueBand() {
  const values = [
    {
      icon: Sparkles,
      title: "Đổi giọng thành văn bản",
      desc: "Chuyển đổi giọng nói thành văn bản chính xác và nhanh chóng.",
    },
    {
      icon: Clock3,
      title: "Tiết kiệm đến 90%",
      desc: "Nhấn mạnh lợi ích giảm thời gian ghi âm, xử lý nội dung và vận hành đội nhóm.",
    },
    {
      icon: PlugZap,
      title: "API sẵn sàng mở rộng",
      desc: "Kết nối API và webhook để đưa quy trình chuyển đổi vào hệ thống vận hành hiện có.",
    },
  ];

  return (
    <section className="bg-[#f7f5ff] px-4 py-10 md:px-6 md:py-12">
      <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
        {values.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-[#eee4d3] bg-white p-5 shadow-[0_10px_35px_rgba(33,16,74,.05)]"
          >
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#21104a] text-[#ffcb05]">
              <item.icon className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-black text-[#21104a]">
              {item.title}
            </h3>
            <p className="mt-2 text-sm leading-7 text-[#6a5a8f]">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompareTable({
  billing,
  setBilling,
  hourlyPrice,
  plans,
}: {
  billing: BillingCycle;
  setBilling: (billing: BillingCycle) => void;
  hourlyPrice: string;
  plans: Plan[];
}) {
  const yearlyMultiplier = billing === "yearly";

  const getDisplayRows = featureGroups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => {
      if (!yearlyMultiplier || row.feature !== "Thời lượng xử lý") return row;
      return {
        ...row,
        free: "Theo sử dụng",
        basic: "60 giờ/năm",
        pro: "240 giờ/năm",
        business: "480 giờ/năm",
      };
    }),
  }));

  return (
    <section className="bg-white px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#fff7c2] px-4 py-2 text-xs font-black uppercase tracking-wide text-[#725a00]">
              <BadgeCheck className="h-4 w-4" /> So sánh chi tiết
            </div>
            <h2 className="mt-4 text-2xl font-black text-[#21104a] md:text-3xl">
              Bảng so sánh tính năng
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#6a5a8f]">
              So sánh nhanh thời lượng, giới hạn file, xuất dữ liệu, API và hỗ
              trợ để chọn gói phù hợp trước khi thanh toán.
            </p>
          </div>
          <BillingToggle billing={billing} setBilling={setBilling} />
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-[#eee8ff] bg-white shadow-[0_14px_45px_rgba(33,16,74,.06)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#fbf8ef] text-[#21104a]">
                  <th className="w-[28%] px-5 py-5 text-xs font-black uppercase tracking-wide text-[#6a5a8f]">
                    Tính năng
                  </th>
                  <PlanHead name="Theo lượt" price={`${hourlyPrice}/giờ`} />
                  <PlanHead
                    name="Tiêu chuẩn"
                    price={
                      plans.find((plan) => plan.code === "standard")?.price ||
                      "Liên hệ"
                    }
                  />
                  <PlanHead
                    name="Đặc biệt"
                    price={
                      plans.find((plan) => plan.code === "special")?.price ||
                      "Liên hệ"
                    }
                    highlight
                  />
                  <PlanHead
                    name="Chuyên nghiệp"
                    price={
                      plans.find((plan) => plan.code === "business")?.price ||
                      "Liên hệ"
                    }
                  />
                </tr>
              </thead>
              <tbody>
                {getDisplayRows.map((group) => (
                  <FragmentGroup
                    key={group.title}
                    title={group.title}
                    rows={group.rows}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-[#eee4d3] bg-[#fbf8ef] p-5 text-sm leading-7 text-[#6a5a8f]">
          <strong className="text-[#21104a]">Ghi chú:</strong> Giá, thời lượng
          và tính năng có thể thay đổi theo chính sách gói cước tại thời điểm
          đăng ký.
        </div>
      </div>
    </section>
  );
}

function PlanHead({
  name,
  price,
  highlight = false,
}: {
  name: string;
  price: string;
  highlight?: boolean;
}) {
  return (
    <th
      className={`px-5 py-5 ${highlight ? "bg-[#21104a] text-white" : "text-[#21104a]"}`}
    >
      <div className="flex items-center gap-2">
        {highlight && (
          <Star className="h-4 w-4 fill-[#ffcb05] text-[#ffcb05]" />
        )}
        <span className="text-base font-black">{name}</span>
      </div>
      <p
        className={`mt-1 text-lg font-black ${highlight ? "text-[#ffcb05]" : "text-[#21104a]"}`}
      >
        {price}
      </p>
    </th>
  );
}

function FragmentGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    feature: string;
    free: CompareValue;
    basic: CompareValue;
    pro: CompareValue;
    business: CompareValue;
  }>;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={5}
          className="border-t border-[#eee8ff] bg-[#f7f3ff] px-5 py-3 text-xs font-black uppercase tracking-wide text-[#21104a]"
        >
          {title}
        </td>
      </tr>
      {rows.map((row, index) => (
        <tr
          key={row.feature}
          className={index % 2 === 0 ? "bg-white" : "bg-[#fcfbff]"}
        >
          <td className="border-t border-[#eee8ff] px-5 py-4 font-bold text-[#4d3c75]">
            {row.feature}
          </td>
          <CompareCell value={row.free} />
          <CompareCell value={row.basic} />
          <CompareCell value={row.pro} highlight />
          <CompareCell value={row.business} />
        </tr>
      ))}
    </>
  );
}

function CompareCell({
  value,
  highlight = false,
}: {
  value: CompareValue;
  highlight?: boolean;
}) {
  if (typeof value === "boolean") {
    return (
      <td
        className={`border-t border-[#eee8ff] px-5 py-4 text-center ${highlight ? "bg-[#fffdf2]" : ""}`}
      >
        {value ? (
          <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-[#ecfdf3] text-[#17b26a]">
            <Check className="h-4 w-4" />
          </span>
        ) : (
          <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-[#f5f2ea] text-[#aaa0b9]">
            <Minus className="h-4 w-4" />
          </span>
        )}
      </td>
    );
  }

  return (
    <td
      className={`border-t border-[#eee8ff] px-5 py-4 text-center font-semibold text-[#4d3c75] ${highlight ? "bg-[#fffdf2]" : ""}`}
    >
      {value}
    </td>
  );
}

function PricingFaq() {
  return (
    <section id="faq" className="bg-[#f7f5ff] px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-[#725a00] shadow-[0_12px_35px_rgba(33,16,74,.06)]">
            <HelpCircle className="h-4 w-4 text-[#ffcb05]" /> Câu hỏi thường gặp
          </div>
          <h2 className="mt-4 text-2xl font-black text-[#21104a] md:text-3xl">
            Giải đáp trước khi mua gói
          </h2>
        </div>

        <div className="mt-10 space-y-4">
          {faqs.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-[#eee4d3] bg-white p-4 shadow-[0_10px_32px_rgba(33,16,74,.05)]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-black text-[#21104a]">
                <span>{item.q}</span>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f7f3ff] text-[#21104a] transition group-open:rotate-180">
                  <ChevronDown className="h-5 w-5" />
                </span>
              </summary>
              <p className="mt-4 text-sm leading-7 text-[#6a5a8f]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function EnterpriseCta({ onStart }: { onStart: () => void }) {
  return (
    <section id="enterprise" className="bg-white px-4 py-12 md:px-6 md:py-14">
      <div className="mx-auto grid max-w-7xl overflow-hidden rounded-2xl bg-[#21104a] text-white shadow-[0_20px_70px_rgba(33,16,74,.18)] lg:grid-cols-[1.05fr_.95fr]">
        <div className="p-6 md:p-8 lg:p-10">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-[#ffcb05]">
              <Headphones className="h-4 w-4" /> Tư vấn gói phù hợp
            </div>
            <h2 className="mt-5 text-2xl font-black leading-tight md:text-3xl">
              Doanh nghiệp cần số phút lớn hoặc tích hợp API?
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70">
              Vbee hỗ trợ tư vấn gói riêng cho đội nhóm có nhu cầu xử lý số phút
              lớn, tích hợp API hoặc yêu cầu vận hành đặc thù.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                [Zap, "SLA riêng"],
                [ShieldCheck, "Bảo mật"],
                [UploadCloud, "API tích hợp"],
              ].map(([Icon, label]) => {
                const TypedIcon = Icon as typeof Zap;
                return (
                  <div
                    key={String(label)}
                    className="rounded-2xl border border-white/10 bg-white/[0.07] p-4"
                  >
                    <TypedIcon className="h-5 w-5 text-[#ffcb05]" />
                    <p className="mt-3 text-sm font-black">{label as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white p-5 text-[#21104a] md:p-6 lg:p-8">
          <div className="rounded-xl border border-[#eee8ff] bg-[#fbf8ef] p-5">
            <h3 className="text-2xl font-black">Nhận tư vấn bảng giá</h3>
            <p className="mt-2 text-sm leading-6 text-[#6a5a8f]">
              Để lại thông tin để Vbee tư vấn gói cước phù hợp với nhu cầu sử
              dụng.
            </p>
            <div className="mt-5 space-y-3">
              <input
                className="w-full rounded-2xl border border-[#e8decc] bg-white px-4 py-3 text-sm font-semibold text-[#21104a] outline-none transition focus:border-[#ffcb05]"
                placeholder="Họ và tên"
              />
              <input
                className="w-full rounded-2xl border border-[#e8decc] bg-white px-4 py-3 text-sm font-semibold text-[#21104a] outline-none transition focus:border-[#ffcb05]"
                placeholder="Email hoặc số điện thoại"
              />
              <textarea
                className="min-h-28 w-full rounded-2xl border border-[#e8decc] bg-white px-4 py-3 text-sm font-semibold text-[#21104a] outline-none transition focus:border-[#ffcb05]"
                placeholder="Nhu cầu xử lý mỗi tháng/năm"
              />
            </div>
            <button
              onClick={onStart}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-6 py-3 font-black text-[#21104a] transition hover:bg-[#ffd842]"
            >
              Gửi yêu cầu tư vấn <ArrowRight className="h-4 w-4" />
            </button>
            <a
              href="mailto:vbee@gmail.com"
              className="mt-4 flex items-center justify-center gap-2 text-sm font-bold text-[#6a5a8f] hover:text-[#21104a]"
            >
              <Mail className="h-4 w-4" /> vbee@gmail.com
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingFooter() {
  return (
    <footer className="bg-[#21104a] px-4 py-12 text-white md:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.1fr_.9fr_.9fr_.9fr]">
        <div>
          <img
            src={vbeeLogo}
            alt="Vbee"
            className="h-14 w-auto rounded-xl bg-white/95 p-1"
          />
          <p className="mt-5 max-w-sm text-sm leading-7 text-white/65">
            Vbee AIVoice — bảng giá theo tháng và theo năm cho nền tảng
            chuyển giọng nói thành văn bản.
          </p>
        </div>
        {[
          [
            "Sản phẩm",
            ["Chuyển giọng nói thành văn bản", "Ghi âm", "Lịch sử", "Xuất DOCX"],
          ],
          [
            "Bảng giá",
            ["Theo lượt", "Tiêu chuẩn", "Đặc biệt", "Chuyên nghiệp"],
          ],
          [
            "Liên hệ",
            ["vbee@gmail.com", "0916 168 475", "Đại học Vinh", "Việt Nam"],
          ],
        ].map(([title, links]) => (
          <div key={String(title)}>
            <h3 className="font-black text-[#ffcb05]">{title}</h3>
            <div className="mt-4 space-y-3 text-sm text-white/65">
              {(links as string[]).map((link) => (
                <p key={link}>{link}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-6 text-sm text-white/50">
        © 2026 Vbee AIVoice. Đã đăng ký bản quyền.
      </div>
    </footer>
  );
}
