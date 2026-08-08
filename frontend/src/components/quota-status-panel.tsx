import { useEffect, useState } from "react";
import { ArrowRight, CalendarX2, Clock3, Crown, RotateCcw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  cancelPlanAtPeriodEnd,
  resumeCancelledPlan,
} from "@/lib/billing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  fetchQuota,
  formatQuotaTime,
  type QuotaStatus,
} from "@/lib/quota";

function formatPlanDate(value?: string | null) {
  if (!value) return "cuối chu kỳ hiện tại";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "long" }).format(
    new Date(value),
  );
}

export function QuotaStatusPanel({
  compact = false,
  variant = "default",
  refreshKey = 0,
  onQuotaChange,
}: {
  compact?: boolean;
  variant?: "default" | "account";
  refreshKey?: number;
  onQuotaChange?: (quota: QuotaStatus) => void;
}) {
  const { token, updateUser } = useAuth();
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [message, setMessage] = useState("");
  const [changingPlan, setChangingPlan] = useState(false);

  async function loadQuota() {
    if (!token) return;
    try {
      const data = await fetchQuota(token);
      setQuota(data);
      updateUser({ plan: data.plan });
      onQuotaChange?.(data);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Không tải được quota",
      );
    }
  }

  useEffect(() => {
    void loadQuota();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, refreshKey]);

  function handleUpgrade() {
    window.location.assign("/pricing");
  }

  async function handleCancelPlan() {
    if (!token) return;
    setChangingPlan(true);
    setMessage("");
    try {
      const updatedQuota = await cancelPlanAtPeriodEnd(token);
      setQuota(updatedQuota);
      onQuotaChange?.(updatedQuota);
      setMessage("Đã ghi nhận yêu cầu hủy gói vào cuối chu kỳ.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không hủy được gói cước");
    } finally {
      setChangingPlan(false);
    }
  }

  async function handleResumePlan() {
    if (!token) return;
    setChangingPlan(true);
    setMessage("");
    try {
      const updatedQuota = await resumeCancelledPlan(token);
      setQuota(updatedQuota);
      onQuotaChange?.(updatedQuota);
      setMessage("Đã hoàn tác yêu cầu hủy gói.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Không hoàn tác được yêu cầu hủy",
      );
    } finally {
      setChangingPlan(false);
    }
  }

  if (!quota) {
    return (
      <div className="rounded-md border border-[#e8decc] bg-white p-3 text-sm text-[#756894]">
        Đang tải quota...
      </div>
    );
  }

  const isPaid = quota.plan !== "free";

  if (variant === "account") {
    return (
      <div className={`rounded-lg border border-[#e8decc] bg-white text-[#21104a] ${compact ? "p-3" : "p-4"}`}>
        <span className={`inline-flex items-center gap-2 rounded-full border border-[#ffcb05]/45 bg-[#fff8d7] font-black ${compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"}`}>
          <Crown className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {quota.label}
        </span>

        <h3 className={`font-black leading-none ${compact ? "mt-3 text-xl" : "mt-4 text-2xl"}`}>
          {formatQuotaTime(quota.remainingSeconds)} còn lại
        </h3>
        <p className={`mt-1 font-semibold text-[#756894] ${compact ? "text-xs" : "text-sm"}`}>
          Đã dùng {formatQuotaTime(quota.usedSeconds)} /{" "}
          {formatQuotaTime(quota.quotaSeconds)}
        </p>
        <div className={`${compact ? "mt-3 h-1.5" : "mt-4 h-2"} overflow-hidden rounded-full bg-[#ece6ff]`}>
          <div
            className={`h-full rounded-full ${quota.isLimitReached ? "bg-destructive" : "bg-[#ffcb05]"}`}
            style={{ width: `${quota.percentUsed}%` }}
          />
        </div>

        <div className={`grid grid-cols-3 border-t border-[#eee7da] font-semibold text-[#756894] ${compact ? "mt-3 gap-2 pt-3 text-xs leading-4" : "mt-4 gap-3 pt-4 text-sm leading-5"}`}>
          <span>
            Tải lên:
            <br />
            {quota.limits.maxUploadMb}MB
          </span>
          <span>
            Ghi âm: {formatQuotaTime(quota.limits.maxRecordSeconds)}
          </span>
          <span>
            File: {formatQuotaTime(quota.limits.maxFileSeconds)}
          </span>
        </div>

        {quota.topUpRemainingSeconds > 0 && (
          <p className="mt-2 text-xs font-bold text-[#6a5a8f]">
            Gồm {formatQuotaTime(quota.topUpRemainingSeconds)} mua thêm
            {quota.topUpNextExpiry
              ? `, dùng trước ${formatPlanDate(quota.topUpNextExpiry)}`
              : ""}
          </p>
        )}

        {isPaid && !compact && (
          quota.cancelAtPeriodEnd ? (
            <div className="mt-4 rounded-lg border border-[#f0d783] bg-[#fffaf0] p-3">
              <p className="text-sm font-black text-[#21104a]">
                Gói sẽ kết thúc vào {formatPlanDate(quota.planExpiresAt)}
              </p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[#756894]">
                Bạn vẫn sử dụng toàn bộ quyền lợi và quota đến hết ngày này.
              </p>
              <button
                type="button"
                onClick={() => void handleResumePlan()}
                disabled={changingPlan}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#e8decc] bg-white px-3 py-2 text-xs font-black text-[#21104a] transition hover:border-[#ffcb05] disabled:opacity-60"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {changingPlan ? "Đang xử lý..." : "Hoàn tác hủy gói"}
              </button>
            </div>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={changingPlan}
                  className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-[#756894] underline decoration-[#d8cde9] underline-offset-4 transition hover:text-[#21104a] disabled:opacity-60"
                >
                  <CalendarX2 className="h-3.5 w-3.5" />
                  Hủy gói cước
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md rounded-xl border-[#e8decc] bg-white text-[#21104a]">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-black text-[#21104a]">
                    Xác nhận hủy gói {quota.label}?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="leading-6 text-[#756894]">
                    Gói vẫn hoạt động đến {formatPlanDate(quota.planExpiresAt)} rồi
                    chuyển về Theo lượt. Thao tác này không tự động hoàn tiền và bạn có
                    thể hoàn tác trước ngày hết hạn.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Giữ gói hiện tại</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void handleCancelPlan()}
                    className="bg-[#21104a] font-black text-white hover:bg-[#32196f]"
                  >
                    Hủy vào cuối chu kỳ
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        )}

        {message && (
          <p className="mt-3 text-xs font-bold text-[#756894]">{message}</p>
        )}
      </div>
    );
  }

  const usageSummary = (
    <div className={`rounded-lg bg-[#fbf8ef] text-[#21104a] ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`inline-flex items-center gap-2 font-black ${compact ? "text-xs" : "text-sm"}`}>
          <Clock3 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          Thời gian sử dụng
          <ArrowRight className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </p>
        {!compact && (
          <span className="rounded-full border border-[#ffcb05]/35 bg-[#fff8cc] px-2.5 py-1 text-[11px] font-bold">
            {quota.label}
          </span>
        )}
      </div>
      <h3 className={`font-black leading-none ${compact ? "mt-2.5 text-xl" : "mt-3 text-2xl"}`}>
        {formatQuotaTime(quota.remainingSeconds)} còn lại
      </h3>
      <p className={`mt-1 font-semibold text-[#756894] ${compact ? "text-xs" : "text-sm"}`}>
        Đã dùng {formatQuotaTime(quota.usedSeconds)} /{" "}
        {formatQuotaTime(quota.quotaSeconds)}
      </p>
      <div className={`${compact ? "mt-3 h-1.5" : "mt-4 h-2"} overflow-hidden rounded-full bg-white`}>
        <div
          className={`h-full rounded-full ${quota.isLimitReached ? "bg-destructive" : "bg-[#ffcb05]"}`}
          style={{ width: `${quota.percentUsed}%` }}
        />
      </div>
      {quota.topUpRemainingSeconds > 0 && (
        <p className="mt-2 text-[11px] font-bold text-[#6a5a8f]">
          Có {formatQuotaTime(quota.topUpRemainingSeconds)} thời lượng mua thêm
        </p>
      )}
    </div>
  );

  if (compact) return usageSummary;

  return (
    <div className="rounded-lg border border-[#e8decc] bg-white p-3 text-[#21104a] shadow-[0_6px_18px_rgba(33,16,74,.045)]">
      {usageSummary}

      <div className="mt-3 grid gap-2 text-xs text-[#756894] sm:grid-cols-3">
        <span>Tải lên: {quota.limits.maxUploadMb}MB</span>
        <span>Ghi âm: {formatQuotaTime(quota.limits.maxRecordSeconds)}</span>
        <span>File: {formatQuotaTime(quota.limits.maxFileSeconds)}</span>
      </div>

      {!isPaid && (
        <button
          onClick={handleUpgrade}
          className="mt-3 rounded-full bg-[#ffcb05] px-3 py-1.5 text-xs font-bold text-[#21104a] transition hover:bg-[#ffdc45]"
        >
          Nâng cấp gói
        </button>
      )}

      {message && (
        <p className="mt-3 text-xs font-bold text-[#21104a]">{message}</p>
      )}
    </div>
  );
}
