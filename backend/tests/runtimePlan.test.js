const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  PLAN_CONFIG,
  mergeRuntimePlanConfig,
} = require("../services/quotaService");

describe("runtime service plans", () => {
  test("CMS values override the runtime limits and quota", () => {
    const config = mergeRuntimePlanConfig(
      {
        code: "standard",
        name: "Tiêu chuẩn mới",
        quota_minutes: 450,
        price_vnd: 175000,
        billing_cycle: "monthly",
        max_upload_mb: 350,
        max_file_duration_minutes: 180,
        enabled: true,
      },
      PLAN_CONFIG.standard,
    );

    assert.equal(config.label, "Tiêu chuẩn mới");
    assert.equal(config.quotaSeconds, 450 * 60);
    assert.equal(config.maxUploadMb, 350);
    assert.equal(config.maxFileSeconds, 180 * 60);
    assert.equal(config.priceVnd, 175000);
    assert.equal(config.enabled, true);
  });

  test("invalid CMS numbers fall back to safe plan values", () => {
    const config = mergeRuntimePlanConfig(
      {
        code: "special",
        name: "",
        quota_minutes: 0,
        price_vnd: -1,
        max_upload_mb: 0,
        max_file_duration_minutes: 0,
        enabled: false,
      },
      PLAN_CONFIG.special,
    );

    assert.equal(config.quotaSeconds, PLAN_CONFIG.special.quotaSeconds);
    assert.equal(config.maxUploadMb, PLAN_CONFIG.special.maxUploadMb);
    assert.equal(config.maxFileSeconds, PLAN_CONFIG.special.maxFileSeconds);
    assert.equal(config.priceVnd, null);
    assert.equal(config.enabled, false);
  });
});
