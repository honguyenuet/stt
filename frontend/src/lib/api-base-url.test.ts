import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./api-base-url";

describe("resolveApiBaseUrl", () => {
  it("uses the local backend when the frontend is opened from localhost", () => {
    expect(
      resolveApiBaseUrl({
        envApiUrl: "https://myth-mowing-reliant.ngrok-free.dev",
        hostname: "localhost",
      }),
    ).toBe("http://localhost:3001");

    expect(
      resolveApiBaseUrl({
        envApiUrl: "https://myth-mowing-reliant.ngrok-free.dev",
        hostname: "127.0.0.1",
      }),
    ).toBe("http://localhost:3001");
  });

  it("uses the configured public backend when the frontend is opened from a domain", () => {
    expect(
      resolveApiBaseUrl({
        envApiUrl: "https://api-example.ngrok-free.dev",
        hostname: "frontend-example.ngrok-free.dev",
      }),
    ).toBe("https://api-example.ngrok-free.dev");
  });
});
