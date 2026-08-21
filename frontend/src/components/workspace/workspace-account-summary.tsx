import { Crown, Gift } from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import {
  formatPlanLabel,
  formatQuotaTime,
  type QuotaStatus,
} from "@/lib/quota";
import { getAccountBadge } from "./workspace-account";

type WorkspaceAccountSummaryProps = {
  firstName: string;
  lastName: string;
  avatar: string | null;
  quota: QuotaStatus | null;
};

function clampQuotaPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function WorkspaceAccountSummary({
  firstName,
  lastName,
  avatar,
  quota,
}: WorkspaceAccountSummaryProps) {
  const fullName = `${firstName} ${lastName}`.trim();
  const quotaPercent = clampQuotaPercent(quota?.percentUsed ?? 0);
  const planLabel = quota ? formatPlanLabel(quota.plan) : "";

  return (
    <section
      className="bg-white p-4 text-[#21104a] sm:p-5"
      aria-label={`Tài khoản và gói đăng ký của ${fullName}`}
    >
      <div className="flex items-center gap-3">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="h-14 w-14 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full bg-[#ffda4f] text-lg font-black"
            aria-hidden="true"
          >
            {getAccountBadge(firstName, lastName)}
          </span>
        )}
        <p className="text-xl font-black leading-tight">
          <span className="block">Xin chào,</span>
          <span className="block">{fullName}</span>
        </p>
      </div>

      {quota ? (
        <div
          className="mt-5 rounded-xl border border-[#e5dcc9] bg-white p-4"
          aria-label={`Gói đăng ký ${planLabel}`}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-[#ffcb05]/55 bg-[#fff8d7] px-3 py-1.5 text-sm font-black">
            <AppIcon icon={Crown} size="sm" />
            {planLabel}
          </span>

          <p className="mt-4 text-2xl font-black leading-none">
            {formatQuotaTime(quota.remainingSeconds)} còn lại
          </p>
          <p className="mt-1 text-sm font-semibold text-[#756894]">
            Đã dùng {formatQuotaTime(quota.usedSeconds)} /{" "}
            {formatQuotaTime(quota.quotaSeconds)}
          </p>

          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-[#ece6ff]"
            role="progressbar"
            aria-label="Thời lượng đã sử dụng"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={quotaPercent}
          >
            <div
              className={`h-full rounded-full ${quota.isLimitReached ? "bg-destructive" : "bg-[#ffcb05]"}`}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[#eee7da] pt-4 text-xs font-semibold leading-5 text-[#756894]">
            <span>
              Tải lên:
              <br />
              {quota.limits.maxUploadMb}MB
            </span>
            <span>
              Ghi âm: {formatQuotaTime(quota.limits.maxRecordSeconds)}
            </span>
            <span>Tệp: {formatQuotaTime(quota.limits.maxFileSeconds)}</span>
          </div>

          {quota.topUpRemainingSeconds > 0 && (
            <p className="mt-2 text-xs font-bold text-[#6a5a8f]">
              Gồm {formatQuotaTime(quota.topUpRemainingSeconds)} mua thêm
            </p>
          )}
        </div>
      ) : (
        <div
          className="mt-5 rounded-xl border border-[#e5dcc9] bg-[#fbf8ef] p-4 text-sm font-semibold text-[#756894]"
          role="status"
        >
          Đang tải gói đăng ký...
        </div>
      )}

      <a
        href="/referral"
        className="mt-4 flex items-center gap-3 rounded-xl border border-[#e5e0f0] bg-[#fbf8ef] p-4 font-black transition hover:border-[#ffcb05] hover:bg-[#fff8d7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcb05]"
      >
        <AppIcon icon={Gift} size="lg" className="shrink-0" />
        <span className="text-sm leading-5">
          GIỚI THIỆU BẠN BÈ
          <span className="block">NHẬN 100 PHÚT MIỄN PHÍ</span>
        </span>
      </a>
    </section>
  );
}
