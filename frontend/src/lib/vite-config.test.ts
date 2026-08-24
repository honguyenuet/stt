import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

describe("Vite dependency discovery", () => {
  it("scans code-split route imports before the dev server starts", () => {
    expect(typeof viteConfig).toBe("function");

    if (typeof viteConfig !== "function") return;

    const config = viteConfig({
      command: "serve",
      mode: "test",
      isSsrBuild: false,
      isPreview: false,
    });

    expect(config.optimizeDeps?.entries).toEqual([
      "src/**/*.{ts,tsx}",
      "!src/**/*.test.{ts,tsx}",
    ]);
  });
});
