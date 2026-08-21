import { Link } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import { PhilosophyQuoteCard } from "@/components/philosophy-quote-card";
import { QuotaStatusPanel } from "@/components/quota-status-panel";
import { VbeePublicFooter } from "@/components/vbee-public-chrome";
import type { QuotaStatus } from "@/lib/quota";

type AccountUsageCardProps = {
  firstName: string;
  refreshKey?: number;
  onQuotaChange?: (quota: QuotaStatus) => void;
  showAlert?: boolean;
  showReferral?: boolean;
  compact?: boolean;
};

export function VbeeAccountUsageCard({
  firstName,
  refreshKey,
  onQuotaChange,
  showAlert = true,
  showReferral = true,
  compact = false,
}: AccountUsageCardProps) {
  return (
    <div
      className={`rounded-xl border border-[#e5dfef] bg-white shadow-[0_8px_24px_rgba(33,16,74,0.06)] ${compact ? "p-3.5" : "p-5"}`}
    >
      <div
        className={`flex items-center ${compact ? "mb-3.5 gap-3" : "mb-5 gap-4"}`}
      >
        <div
          className={`flex shrink-0 items-center justify-center rounded-full bg-[#ffdc45] font-black text-[#21104a] ${compact ? "h-11 w-11 text-base" : "h-14 w-14 text-lg"}`}
        >
          {firstName.slice(0, 2).toUpperCase()}
        </div>
        <h2
          className={`font-black leading-tight text-[#21104a] ${compact ? "text-xl" : "text-2xl"}`}
        >
          Xin chào,
          <br />
          {firstName}
        </h2>
      </div>

      <div className={compact ? "mb-3.5" : "mb-5"}>
        <QuotaStatusPanel
          compact={compact}
          variant="account"
          refreshKey={refreshKey}
          onQuotaChange={onQuotaChange}
          showAlert={showAlert}
        />
      </div>

      {showReferral && (
        <Link
          to="/referral"
          className={`flex items-center rounded-xl border border-[#e5dfef] bg-[#fbf8ef] transition hover:border-[#ffcb05] ${compact ? "gap-2.5 px-3 py-3.5" : "gap-3 px-4 py-5"}`}
        >
          <Gift
            className={`text-[#21104a] ${compact ? "h-5 w-5" : "h-7 w-7"}`}
          />
          <p
            className={`font-black text-[#21104a] ${compact ? "text-xs leading-4" : "text-sm leading-5"}`}
          >
            GIỚI THIỆU BẠN BÈ
            <br />
            NHẬN 100 PHÚT MIỄN PHÍ
          </p>
        </Link>
      )}
    </div>
  );
}

export function VbeePreferencesSidebar({
  firstName,
  refreshKey,
  onQuotaChange,
}: {
  firstName: string;
  refreshKey?: number;
  onQuotaChange?: (quota: QuotaStatus) => void;
}) {
  return (
    <aside className="self-start space-y-4 lg:pt-[52px]">
      <VbeeAccountUsageCard
        firstName={firstName}
        refreshKey={refreshKey}
        onQuotaChange={onQuotaChange}
      />

      <PhilosophyQuoteCard compact />
    </aside>
  );
}

export function VbeePreferencesFooter() {
  return <VbeePublicFooter />;
}
