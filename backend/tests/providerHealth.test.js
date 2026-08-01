const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProviderHealthRequest,
} = require("../services/providerHealthService");

test("provider health checks use non-billing authenticated endpoints", () => {
  const assembly = buildProviderHealthRequest({
    code: "assemblyai",
    endpoint: "https://api.assemblyai.com",
    apiKey: "assembly-key",
  });
  assert.equal(
    assembly.url,
    "https://api.assemblyai.com/v2/transcript?limit=1",
  );
  assert.equal(assembly.options.headers.Authorization, "assembly-key");

  const deepgram = buildProviderHealthRequest({
    code: "deepgram",
    endpoint: "https://api.deepgram.com/v1",
    apiKey: "deepgram-key",
  });
  assert.equal(deepgram.url, "https://api.deepgram.com/v1/projects");
  assert.equal(deepgram.options.headers.Authorization, "Token deepgram-key");

  const sonix = buildProviderHealthRequest({
    code: "sonix",
    endpoint: "https://api.sonix.ai/v1",
    apiKey: "sonix-key",
  });
  assert.equal(sonix.url, "https://api.sonix.ai/v1/media?limit=1");
  assert.equal(sonix.options.headers.Authorization, "Bearer sonix-key");
});

test("Vbee health request respects the configured API key header and path", () => {
  const vbee = buildProviderHealthRequest({
    code: "vbee",
    endpoint: "https://uat-api.vbeelabs.ai/",
    apiKey: "vbee-key",
    vbeeHeader: "Authorization",
    vbeeScheme: "Bearer",
    vbeeHealthPath: "/api/v1/models?category=speech-to-text",
  });

  assert.equal(
    vbee.url,
    "https://uat-api.vbeelabs.ai/api/v1/models?category=speech-to-text",
  );
  assert.equal(vbee.options.headers.Authorization, "Bearer vbee-key");
});
