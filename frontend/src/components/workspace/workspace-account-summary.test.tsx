import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { QuotaStatus } from "@/lib/quota";
import { WorkspaceAccountSummary } from "./workspace-account-summary";
import { getAccountBadge } from "./workspace-account";

const quota: QuotaStatus = {
  plan: "free",
  label: "Theo lượt",
  baseQuotaSeconds: 1_800,
  quotaSeconds: 1_806,
  topUpGrantedSeconds: 6,
  topUpRemainingSeconds: 6,
  usedSeconds: 0,
  remainingSeconds: 1_806,
  percentUsed: 130,
  alertSeconds: 60,
  maxAlertSeconds: 1_806,
  cancelAtPeriodEnd: false,
  shouldAlert: false,
  isLimitReached: false,
  limits: {
    maxUploadMb: 50,
    maxRecordSeconds: 600,
    maxFileSeconds: 1_800,
  },
};

describe("workspace account summary", () => {
  it("shows the registered plan, quota limits and referral benefit", () => {
    const html = renderToStaticMarkup(
      <WorkspaceAccountSummary
        firstName="Hồ"
        lastName=""
        avatar={null}
        quota={quota}
      />,
    );

    expect(html).toContain("Xin chào,");
    expect(html).toContain("Hồ");
    expect(html).toContain("Miễn phí");
    expect(html).toContain("30m 6s còn lại");
    expect(html).toContain("Đã dùng 0s / 30m 6s");
    expect(html).toContain("Tải lên:");
    expect(html).toContain("50MB");
    expect(html).toContain("Ghi âm: 10m 0s");
    expect(html).toContain("Tệp: 30m 0s");
    expect(html).toContain("Gồm 6s mua thêm");
    expect(html).toContain("NHẬN 100 PHÚT MIỄN PHÍ");
    expect(html).toContain('href="/referral"');
  });

  it("clamps an invalid quota percentage before rendering progress", () => {
    const html = renderToStaticMarkup(
      <WorkspaceAccountSummary
        firstName="Hồ"
        lastName=""
        avatar={null}
        quota={quota}
      />,
    );

    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('style="width:100%"');
  });

  it("uses a short first name on the avatar and initials for longer names", () => {
    expect(getAccountBadge("Hồ", "")).toBe("HỒ");
    expect(getAccountBadge("Nguyễn", "Văn An")).toBe("NV");
  });
});
