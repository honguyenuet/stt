const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  applyCmsRoutingRules,
  orderCmsProviderRows,
} = require("../services/transcriptionService");

describe("CMS provider routing", () => {
  test("uses the default provider and its explicit failover chain first", () => {
    const rows = [
      {
        id: 1,
        code: "vbee",
        is_default: true,
        failover_provider_id: 3,
        health_status: "degraded",
      },
      {
        id: 2,
        code: "deepgram",
        health_status: "healthy",
        success_rate: 99,
      },
      {
        id: 3,
        code: "assemblyai",
        failover_provider_id: 2,
        health_status: "healthy",
      },
      { id: 4, code: "unsupported", health_status: "healthy" },
    ];

    assert.deepEqual(
      orderCmsProviderRows(rows).map((provider) => provider.code),
      ["vbee", "assemblyai", "deepgram"],
    );
  });

  test("orders remaining providers by health and observed success", () => {
    const rows = [
      { id: 1, code: "vbee", is_default: true, health_status: "healthy" },
      {
        id: 2,
        code: "deepgram",
        health_status: "degraded",
        success_rate: 99,
      },
      {
        id: 3,
        code: "assemblyai",
        health_status: "healthy",
        success_rate: 80,
      },
      {
        id: 4,
        code: "sonix",
        health_status: "healthy",
        success_rate: 95,
      },
    ];

    assert.deepEqual(
      orderCmsProviderRows(rows).map((provider) => provider.code),
      ["vbee", "sonix", "assemblyai", "deepgram"],
    );
  });

  test("rule-based routing prioritizes a matching language and audio mode", () => {
    const providers = ["vbee", "assemblyai", "deepgram"];
    const configs = new Map([
      [
        "deepgram",
        {
          routingMode: "rule_based",
          routingRules: {
            languages: ["vi"],
            audio_modes: ["speech"],
            priority: 200,
          },
        },
      ],
    ]);

    assert.deepEqual(
      applyCmsRoutingRules(providers, configs, "vi", "speech"),
      ["deepgram", "vbee", "assemblyai"],
    );
    assert.deepEqual(
      applyCmsRoutingRules(providers, configs, "en", "speech"),
      providers,
    );
  });
});
