const { decryptProviderSecret } = require("./providerSecrets");

const DEFAULT_ENDPOINTS = {
  assemblyai: "https://api.assemblyai.com",
  deepgram: "https://api.deepgram.com/v1",
  sonix: "https://api.sonix.ai/v1",
  vbee: "https://uat-api.vbeelabs.ai",
};

function cleanEndpoint(value, fallback) {
  return String(value || fallback || "")
    .trim()
    .replace(/\/+$/, "");
}

function buildProviderHealthRequest({
  code: rawCode,
  endpoint,
  apiKey,
  vbeeHeader = process.env.VBEE_API_KEY_HEADER || "Authorization",
  vbeeScheme = process.env.VBEE_API_KEY_SCHEME ?? "Bearer",
  vbeeHealthPath =
    process.env.VBEE_HEALTH_PATH ||
    "/api/v1/models?category=speech-to-text",
}) {
  const code = String(rawCode || "").trim().toLowerCase();
  const key = String(apiKey || "").trim();
  if (!DEFAULT_ENDPOINTS[code]) throw new Error("Provider không được hỗ trợ");
  if (!key) throw new Error("Provider chưa có API key");
  const baseUrl = cleanEndpoint(endpoint, DEFAULT_ENDPOINTS[code]);

  if (code === "assemblyai") {
    const versionedBase = /\/v2$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v2`;
    return {
      url: `${versionedBase}/transcript?limit=1`,
      options: { headers: { Authorization: key } },
    };
  }
  if (code === "deepgram") {
    return {
      url: `${baseUrl}/projects`,
      options: { headers: { Authorization: `Token ${key}` } },
    };
  }
  if (code === "sonix") {
    return {
      url: `${baseUrl}/media?limit=1`,
      options: { headers: { Authorization: `Bearer ${key}` } },
    };
  }

  const header = String(vbeeHeader || "Authorization").trim();
  if (!/^[A-Za-z0-9-]+$/.test(header)) {
    throw new Error("VBEE_API_KEY_HEADER không hợp lệ");
  }
  const path = `/${String(
    vbeeHealthPath || "api/v1/models?category=speech-to-text",
  ).replace(/^\/+/, "")}`;
  return {
    url: `${baseUrl}${path}`,
    options: {
      headers: {
        [header]: vbeeScheme ? `${vbeeScheme} ${key}` : key,
      },
    },
  };
}

async function checkProviderHealth(
  provider,
  { fetchImpl = global.fetch, timeoutMs = 10_000 } = {},
) {
  const envKeys = {
    assemblyai: process.env.ASSEMBLYAI_API_KEY,
    deepgram: process.env.DEEPGRAM_API_KEY,
    sonix: process.env.SONIX_API_KEY,
    vbee: process.env.VBEE_API_KEY || process.env.AIMP_API_KEY,
  };
  const apiKey =
    decryptProviderSecret(provider.api_key_encrypted) ||
    envKeys[String(provider.code || "").toLowerCase()];
  const request = buildProviderHealthRequest({
    code: provider.code,
    endpoint: provider.endpoint,
    apiKey,
  });
  if (typeof fetchImpl !== "function") {
    throw new Error("Runtime không hỗ trợ health check");
  }
  const startedAt = Date.now();
  const response = await fetchImpl(request.url, {
    method: "GET",
    redirect: "error",
    ...request.options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const latencyMs = Math.max(1, Date.now() - startedAt);
  if (!response.ok) {
    const error = new Error(`Provider phản hồi HTTP ${response.status}`);
    error.statusCode = response.status;
    error.latencyMs = latencyMs;
    throw error;
  }
  return { healthy: true, latencyMs, statusCode: response.status };
}

module.exports = {
  buildProviderHealthRequest,
  checkProviderHealth,
};
