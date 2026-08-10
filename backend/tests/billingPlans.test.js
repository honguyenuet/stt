const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { listPlans } = require("../services/billingService");

describe("CMS billing plans", () => {
  test("public pricing uses the plan values managed in CMS", async () => {
    const rows = {
      free: {
        code: "free",
        name: "Miễn phí",
        quota_minutes: 30,
        price_vnd: 0,
        max_upload_mb: 50,
        max_file_duration_minutes: 30,
        enabled: true,
      },
      standard: {
        code: "standard",
        name: "Cá nhân",
        quota_minutes: 420,
        price_vnd: 175000,
        max_upload_mb: 250,
        max_file_duration_minutes: 150,
        enabled: true,
      },
      special: {
        code: "special",
        name: "Đặc biệt",
        quota_minutes: 1200,
        price_vnd: 449000,
        max_upload_mb: 1024,
        max_file_duration_minutes: 240,
        enabled: true,
      },
      business: {
        code: "business",
        name: "Doanh nghiệp",
        quota_minutes: 2400,
        price_vnd: 799000,
        max_upload_mb: 2048,
        max_file_duration_minutes: 480,
        enabled: false,
      },
    };
    const db = {
      async query(_sql, params) {
        return { rows: [rows[params[0]]] };
      },
    };

    const plans = await listPlans(db);
    const standard = plans.find((plan) => plan.code === "standard");
    const business = plans.find((plan) => plan.code === "business");

    assert.equal(standard.label, "Cá nhân");
    assert.equal(standard.monthly.price, 175000);
    assert.equal(standard.monthly.quotaSeconds, 420 * 60);
    assert.equal(standard.yearly.price, 175000 * 11);
    assert.equal(standard.yearly.quotaSeconds, 420 * 60 * 12);
    assert.equal(business.enabled, false);
  });
});
