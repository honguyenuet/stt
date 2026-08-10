import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Clock3,
  CreditCard,
  ExternalLink,
  QrCode,
  ShieldCheck,
  X,
} from "lucide-react";
import vbeeLogo from "@/assets/vbee-logo.png";
import { useAuth } from "@/context/AuthContext";
import {
  confirmDemoPayment,
  fetchBillingOrder,
  type BillingOrder,
} from "@/lib/billing";
import { formatPlanLabel, formatQuotaTime } from "@/lib/quota";

export const Route = createFileRoute("/checkout/$orderId")({
  component: CheckoutPage,
});

function formatMoney(amount: number, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value?: string | null) {
  if (!value) return "Không có";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function CheckoutPage() {
  const { orderId } = Route.useParams();
  const { user, token, isLoading, updateUser } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<BillingOrder | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingOrder, setLoadingOrder] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPaymentQr, setShowPaymentQr] = useState(false);
  const [paymentQrImage, setPaymentQrImage] = useState("");
  const [paymentQrError, setPaymentQrError] = useState("");

  const activeOrderId = order?.id;
  const activeOrderExpiresAt = order?.expiresAt;

  useEffect(() => {
    if (isLoading) return;
    if (!user || !token) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: `/checkout/${orderId}` },
      });
      return;
    }

    let cancelled = false;
    setLoadingOrder(true);
    setError("");
    void fetchBillingOrder(token, orderId)
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Không tải được đơn hàng",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingOrder(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoading, navigate, orderId, token, user]);

  useEffect(() => {
    if (
      !token ||
      !activeOrderId ||
      order.status !== "pending" ||
      order.provider !== "payos"
    ) {
      return;
    }

    const checkPayment = () => {
      const expiresAt = activeOrderExpiresAt
        ? new Date(activeOrderExpiresAt).getTime()
        : Number.NaN;
      if (
        Number.isFinite(expiresAt) &&
        expiresAt + 5 * 60 * 1000 < Date.now()
      ) {
        setOrder((current) =>
          current?.id === activeOrderId
            ? { ...current, status: "expired" }
            : current,
        );
        setMessage("Đơn thanh toán đã hết hạn. Vui lòng tạo đơn mới.");
        return;
      }

      void fetchBillingOrder(token, activeOrderId)
        .then((nextOrder) => {
          setOrder(nextOrder);
          if (nextOrder.status === "paid") {
            if (nextOrder.productType === "subscription") {
              updateUser({ plan: nextOrder.plan });
            }
            setMessage(
              nextOrder.productType === "top_up"
                ? `Thanh toán đã được PayOS xác thực. ${nextOrder.label} đã được cộng vào tài khoản.`
                : `Thanh toán đã được PayOS xác thực. Tài khoản đã lên gói ${nextOrder.label}.`,
            );
          }
        })
        .catch(() => {
          // A short network interruption should not replace the active checkout UI.
        });
    };

    checkPayment();
    const interval = window.setInterval(checkPayment, 4000);

    return () => window.clearInterval(interval);
  }, [
    activeOrderExpiresAt,
    activeOrderId,
    order?.provider,
    order?.status,
    token,
    updateUser,
  ]);

  useEffect(() => {
    if (order?.status === "paid") {
      if (order.productType === "subscription") {
        updateUser({ plan: order.plan });
      }
      setShowPaymentQr(false);
    }
  }, [order?.plan, order?.productType, order?.status, updateUser]);

  useEffect(() => {
    const qrPayload = order?.paymentQrCode?.trim();
    let active = true;

    setPaymentQrImage("");
    setPaymentQrError("");
    if (!qrPayload) {
      setPaymentQrError(
        "Mã QR chưa sẵn sàng. Bạn có thể mở trang PayOS bên dưới.",
      );
      return () => {
        active = false;
      };
    }

    if (qrPayload.startsWith("data:image/")) {
      setPaymentQrImage(qrPayload);
      return () => {
        active = false;
      };
    }

    void QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 420,
      color: { dark: "#21104a", light: "#ffffff" },
    })
      .then((image) => {
        if (active) setPaymentQrImage(image);
      })
      .catch(() => {
        if (active) setPaymentQrError("Không thể tạo ảnh QR cho đơn hàng này.");
      });

    return () => {
      active = false;
    };
  }, [order?.paymentQrCode]);

  async function handleConfirmPayment() {
    if (!token || !order) return;

    setConfirming(true);
    setError("");
    setMessage("");
    try {
      const result = await confirmDemoPayment(token, order.id);
      setOrder(result.order);
      updateUser({ plan: result.quota.plan });
      setMessage(
        result.order.productType === "top_up"
          ? `Thanh toán thành công. ${result.order.label} đã được cộng; tài khoản còn ${formatQuotaTime(
              result.quota.remainingSeconds,
            )} sử dụng.`
          : `Thanh toán thành công. Tài khoản đã lên gói ${formatPlanLabel(result.quota.plan)}, còn ${formatQuotaTime(
              result.quota.remainingSeconds,
            )} sử dụng.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không xác nhận được thanh toán",
      );
    } finally {
      setConfirming(false);
    }
  }

  async function copyPaymentCode() {
    if (!order?.paymentCode) return;
    try {
      await navigator.clipboard.writeText(order.paymentCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Không thể sao chép mã thanh toán. Vui lòng sao chép thủ công.");
    }
  }

  const statusLabel =
    order?.status === "paid"
      ? "Đã thanh toán"
      : order?.status === "expired"
        ? "Đã hết hạn"
        : order?.status === "failed"
          ? "Không tạo được thanh toán"
          : order?.status === "cancelled"
            ? "Đã hủy"
            : "Chờ thanh toán";

  return (
    <main className="min-h-screen bg-white px-4 py-6 text-[#21104a] md:py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src={vbeeLogo} alt="Vbee" className="h-12 w-auto" />
          </Link>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-full border border-[#e7d9c5] bg-white px-4 py-2 text-sm font-black text-[#21104a] shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Bảng giá
          </Link>
        </div>

        <section className="overflow-hidden rounded-2xl border border-[#eadfcf] bg-white shadow-[0_16px_55px_rgba(33,16,74,.08)]">
          <div className="bg-[#21104a] px-5 py-6 text-white md:px-7">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-[#ffcb05]">
              <ShieldCheck className="h-4 w-4" />
              Thanh toán bảo mật
            </div>
            <h1 className="mt-4 text-2xl font-black md:text-3xl">
              Thanh toán gói cước Vbee
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
              Mỗi đơn có số tiền và nội dung chuyển khoản riêng. Thời lượng chỉ được
              kích hoạt sau khi PayOS xác thực giao dịch qua webhook.
            </p>
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-[1.05fr_.95fr] md:p-6">
            <div>
              {loadingOrder ? (
                <div className="rounded-lg border border-[#eee8ff] bg-[#faf8ff] p-4 text-sm font-bold text-[#6a5a8f]">
                  Đang tải đơn hàng...
                </div>
              ) : error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
                  {error}
                </div>
              ) : order ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[#eee8ff] bg-[#faf8ff] p-4">
                    <p className="text-xs font-black uppercase text-[#6a5a8f]">
                      Mã đơn hàng
                    </p>
                    <p className="mt-1 break-all font-mono text-sm font-bold text-[#21104a]">
                      {order.id}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoTile
                      label={
                        order.productType === "top_up"
                          ? "Gói mua thêm"
                          : "Gói cước"
                      }
                      value={order.label}
                      sub={
                        order.productType === "top_up"
                          ? order.validDays
                            ? `Có hiệu lực ${order.validDays} ngày, không đổi chu kỳ chính`
                            : "Thời lượng đã mua không hết hạn"
                          : order.billingCycle === "yearly"
                            ? "Thanh toán năm"
                            : "Thanh toán tháng"
                      }
                    />
                    <InfoTile
                      label="Thời lượng"
                      value={formatQuotaTime(order.quotaSeconds)}
                      sub={
                        order.productType === "top_up"
                          ? "Cộng vào thời lượng hiện có"
                          : "Thời lượng được cấp sau thanh toán"
                      }
                    />
                    <InfoTile
                      label="Trạng thái"
                      value={statusLabel}
                      sub={`Kênh thanh toán: ${
                        order.provider === "payos"
                          ? "PayOS do Casso cung cấp"
                          : order.provider === "demo"
                            ? "Vbee Pay (demo)"
                            : order.provider
                      }`}
                    />
                    <InfoTile
                      label="Hết hạn đơn"
                      value={formatDate(order.expiresAt)}
                      sub="Đơn pending sẽ hết hạn"
                    />
                  </div>

                  {message && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-bold text-green-700">
                      {message}
                    </div>
                  )}

                  {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
                      {error}
                    </div>
                  )}

                  {order.provider === "payos" && order.status === "pending" && (
                    <div className="rounded-xl border border-[#f0d783] bg-[#fffaf0] p-4">
                      <p className="text-xs font-black uppercase tracking-[.12em] text-[#7a5d00]">
                        Nội dung chuyển khoản bắt buộc
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-[#eadfcf] bg-white px-3 py-2">
                        <code className="truncate text-base font-black tracking-[.08em] text-[#21104a]">
                          {order.paymentCode || "Đang tạo mã"}
                        </code>
                        <button
                          type="button"
                          onClick={() => void copyPaymentCode()}
                          disabled={!order.paymentCode}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#e7d9c5] px-2.5 py-1.5 text-xs font-black text-[#21104a] transition hover:bg-[#fff7d8] disabled:opacity-50"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copied ? "Đã chép" : "Sao chép"}
                        </button>
                      </div>
                      <p className="mt-2 text-xs font-semibold leading-5 text-[#6a5a8f]">
                        PayOS đối chiếu cả số tiền và nội dung này trước khi
                        kích hoạt gói.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <aside className="rounded-xl border border-[#eee8ff] bg-[#fffdf4] p-5">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ffcb05] text-[#21104a]">
                  <CircleDollarSign className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase text-[#7a6b1e]">
                    Tổng thanh toán
                  </p>
                  <p className="text-2xl font-black">
                    {order ? formatMoney(order.amount, order.currency) : "--"}
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3 text-sm font-semibold text-[#5f5278]">
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Kích hoạt thời lượng sau khi thanh toán thành công
                </p>
                <p className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-[#9a7b00]" />
                  Đơn hàng có thời hạn để tránh thanh toán treo
                </p>
                <p className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-[#21104a]" />
                  Thanh toán QR ngân hàng qua PayOS do Casso cung cấp
                </p>
              </div>

              {order?.provider === "payos" && order.status === "pending" ? (
                order.paymentUrl ? (
                  <button
                    type="button"
                    onClick={() => setShowPaymentQr(true)}
                    className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#21104a] px-5 py-3 text-sm font-black text-white shadow-[0_18px_50px_rgba(33,16,74,.25)] transition hover:-translate-y-0.5"
                  >
                    Hiện QR thanh toán
                    <QrCode className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="mt-7 rounded-full bg-[#eee8ff] px-5 py-3 text-center text-sm font-black text-[#6a5a8f]">
                    Link thanh toán chưa sẵn sàng
                  </div>
                )
              ) : order?.provider === "demo" ? (
                <button
                  type="button"
                  onClick={() => void handleConfirmPayment()}
                  disabled={!order || order.status === "paid" || confirming}
                  className="mt-7 w-full rounded-full bg-[#21104a] px-5 py-3 text-sm font-black text-white shadow-[0_18px_50px_rgba(33,16,74,.25)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {order?.status === "paid"
                    ? "Đã thanh toán"
                    : confirming
                      ? "Đang xác nhận..."
                      : "Xác nhận thanh toán demo"}
                </button>
              ) : null}

              {order?.status === "paid" && (
                <Link
                  to="/upload"
                  className="mt-3 block rounded-full border border-[#21104a]/20 bg-white px-5 py-3 text-center text-sm font-black text-[#21104a]"
                >
                  Tải tệp lên
                </Link>
              )}
            </aside>
          </div>
        </section>
      </div>

      {showPaymentQr && order && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#13072f]/65 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowPaymentQr(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-qr-title"
            className="relative w-full max-w-md rounded-2xl border border-[#eadfcf] bg-white p-5 shadow-2xl sm:p-6"
          >
            <button
              type="button"
              onClick={() => setShowPaymentQr(false)}
              aria-label="Đóng mã QR"
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-[#eee8ff] bg-white text-[#21104a] transition hover:bg-[#fff7d8]"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="pr-11">
              <p className="text-xs font-black uppercase tracking-[.12em] text-[#9a7b00]">
                PayOS do Casso cung cấp
              </p>
              <h2
                id="payment-qr-title"
                className="mt-1 text-xl font-black text-[#21104a]"
              >
                Quét mã để thanh toán
              </h2>
              <p className="mt-1 text-sm font-semibold text-[#6a5a8f]">
                Dùng ứng dụng ngân hàng và giữ nguyên nội dung chuyển khoản.
              </p>
            </div>

            <div className="mx-auto mt-5 flex aspect-square w-full max-w-[300px] items-center justify-center overflow-hidden rounded-xl border border-[#eee8ff] bg-white p-3">
              {paymentQrImage ? (
                <img
                  src={paymentQrImage}
                  alt={`Mã QR thanh toán đơn ${order.id}`}
                  className="h-full w-full object-contain"
                />
              ) : paymentQrError ? (
                <p className="px-5 text-center text-sm font-bold text-red-700">
                  {paymentQrError}
                </p>
              ) : (
                <p className="text-sm font-bold text-[#6a5a8f]">
                  Đang tạo mã QR...
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InfoTile
                label="Số tiền"
                value={formatMoney(order.amount, order.currency)}
                sub={order.label}
              />
              <InfoTile
                label="Nội dung"
                value={order.paymentCode || "--"}
                sub="Không thay đổi nội dung"
              />
            </div>

            {order.paymentUrl && (
              <a
                href={order.paymentUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#21104a]/20 bg-[#fffdf4] px-5 py-3 text-sm font-black text-[#21104a] transition hover:bg-[#fff7d8]"
              >
                Mở trang PayOS
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function InfoTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-[#eee8ff] bg-white p-4">
      <p className="text-xs font-black uppercase text-[#8b7aa6]">{label}</p>
      <p className="mt-1 text-lg font-black text-[#21104a]">{value}</p>
      <p className="mt-1 text-xs font-semibold text-[#7b6f93]">{sub}</p>
    </div>
  );
}
